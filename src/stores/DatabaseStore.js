require("dotenv").config();
const mysql = require("mysql2/promise");
const { createClient } = require("redis");
const bcrypt = require("bcrypt");

const BCRYPT_ROUNDS = 12;

class DatabaseStore {
  constructor(sessionId = "global") {
    this.sessionId = sessionId.replace(/[\/\\:*?"<>|]/g, "_");

    this.mysqlPool = mysql.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "whatsapp",
      connectionLimit: 20,
      queueLimit: 200,
      waitForConnections: true,
      timezone: "+00:00",
      supportBigNumbers: true,
      bigNumberStrings: true,
      namedPlaceholders: true,
      multipleStatements: true,
    });

    this.useRedis = !!process.env.REDIS_URL;
    this.redis = null;
    this.redisReady = false;

    if (this.useRedis) {
      this.redis = createClient({
        url: process.env.REDIS_URL,
        socket: { reconnectStrategy: (retries) => Math.min(retries * 250, 5000) },
      });

      this.redis.on("error", () => { this.redisReady = false; });
      this.redis.on("ready", () => { this.redisReady = true; });
      this.redis.connect().catch(() => { });
    }

    this.picCache = new Map();

    this.mysqlPool.getConnection()
      .then(conn => {
        console.log(`[DB:${this.sessionId}] pool ready (connection acquired successfully)`);
        conn.release();
      })
      .catch(err => {
        console.error(`[DB:${this.sessionId}] pool startup failed:`, err.message);
      });

    if (sessionId === "global") {
      this.ensureTables().catch(err => {
        console.error("[DatabaseStore] Failed to ensure tables:", err);
      });
    }
  }

  async ensureTables() {
    console.log("[DatabaseStore] Checking and creating tables if needed...");

    const queries = [
      // call_logs (unchanged)
      `CREATE TABLE IF NOT EXISTS call_logs (
      session_id VARCHAR(100) NOT NULL,
      call_id VARCHAR(100) NOT NULL,
      caller_jid VARCHAR(255) NOT NULL,
      is_group TINYINT(1) DEFAULT 0,
      is_video TINYINT(1) DEFAULT 0,
      status ENUM('missed','answered','rejected','unknown') DEFAULT 'unknown',
      timestamp BIGINT NOT NULL,
      duration_seconds INT DEFAULT NULL,
      PRIMARY KEY (session_id, call_id),
      INDEX idx_session (session_id),
      INDEX idx_timestamp (session_id, timestamp DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

      // chats (unchanged)
      `CREATE TABLE IF NOT EXISTS chats (
      session_id VARCHAR(100) NOT NULL,
      id VARCHAR(255) NOT NULL,
      name VARCHAR(255) DEFAULT NULL,
      is_group TINYINT(1) DEFAULT 0,
      unread_count INT DEFAULT 0,
      last_message_timestamp BIGINT DEFAULT NULL,
      archived TINYINT(1) DEFAULT 0,
      pinned TINYINT(1) DEFAULT 0,
      muted_until BIGINT DEFAULT 0,
      PRIMARY KEY (session_id, id),
      INDEX idx_session (session_id),
      INDEX idx_timestamp (session_id, last_message_timestamp DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

      // chats_overview (unchanged - no DEFAULT on LONGTEXT)
      `CREATE TABLE IF NOT EXISTS chats_overview (
      session_id VARCHAR(100) NOT NULL,
      chat_id VARCHAR(255) NOT NULL,
      last_message_preview LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (JSON_VALID(last_message_preview)),
      unread_count INT DEFAULT 0,
      PRIMARY KEY (session_id, chat_id),
      INDEX idx_session (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

      // contacts (unchanged)
      `CREATE TABLE IF NOT EXISTS contacts (
      session_id VARCHAR(100) NOT NULL,
      id VARCHAR(255) NOT NULL,
      lid VARCHAR(255) DEFAULT NULL,
      phone VARCHAR(50) DEFAULT NULL,
      name VARCHAR(255) DEFAULT NULL,
      notify VARCHAR(255) DEFAULT NULL,
      verified_name VARCHAR(255) DEFAULT NULL,
      PRIMARY KEY (id),
      INDEX idx_session (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

      // device_blocklist — FIXED: removed DEFAULT '[]'
      `CREATE TABLE IF NOT EXISTS device_blocklist (
      session_id VARCHAR(100) NOT NULL,
      blocked_jids LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

      // group_metadata (unchanged - no DEFAULT on participants)
      `CREATE TABLE IF NOT EXISTS group_metadata (
      session_id VARCHAR(100) NOT NULL,
      id VARCHAR(255) NOT NULL,
      subject VARCHAR(255) DEFAULT NULL,
      subject_owner VARCHAR(255) DEFAULT NULL,
      subject_time BIGINT DEFAULT NULL,
      description TEXT DEFAULT NULL,
      is_restricted TINYINT(1) DEFAULT 0,
      is_announced TINYINT(1) DEFAULT 0,
      size INT DEFAULT NULL,
      creation BIGINT DEFAULT NULL,
      owner VARCHAR(255) DEFAULT NULL,
      participants LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (JSON_VALID(participants)),
      PRIMARY KEY (id),
      INDEX idx_session (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

      // media_files, messages, profile_pictures, users — unchanged
      // ... (keep as they are - no problematic DEFAULTs)
    ];

    for (const query of queries) {
      try {
        await this.mysqlQuery(query);
        const tableName = query.match(/TABLE IF NOT EXISTS\s+`?(\w+)`?/)?.[1] || 'unknown';
        console.log(`[DatabaseStore] Table ensured: ${tableName}`);
      } catch (err) {
        console.error(`[DatabaseStore] Failed to create table:`, err.message);
      }
    }

    console.log("[DatabaseStore] All tables checked/created successfully");
  }

  async mysqlQuery(sql, params = [], maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let conn;
      try {
        conn = await this.mysqlPool.getConnection();
        const [rows] = await conn.execute(sql, params);
        return rows;
      } catch (err) {
        lastError = err;
        console.warn(`[mysqlQuery] attempt ${attempt}/${maxRetries} failed`, {
          message: err.message,
          sql: sql.substring(0, 150)
        });

        if (attempt === maxRetries) throw err;

        // Exponential backoff: 200ms → 800ms → 1800ms
        await new Promise(r => setTimeout(r, 200 * attempt * attempt));
      } finally {
        if (conn) conn.release();
      }
    }
    throw lastError;
  }

  async mysqlTransaction(asyncFn) {
    let conn;
    try {
      conn = await this.mysqlPool.getConnection();
      await conn.beginTransaction();
      const result = await asyncFn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      if (conn) await conn.rollback();
      console.error("[mysqlTransaction] failed", err.message);
      throw err;
    } finally {
      if (conn) conn.release();
    }
  }

  async redisGet(key) { return this.redisReady ? await this.redis.get(key).catch(() => null) : null; }
  async redisSetEx(key, sec, val) { if (this.redisReady) await this.redis.setEx(key, sec, val).catch(() => { }); }
  async redisDel(...keys) { if (this.redisReady && keys.length) await this.redis.del(keys).catch(() => { }); }

  async createUser({ username, password, apiKey, role = "user" }) {
    if (!username?.trim() || !password || password.length < 6 || !apiKey?.trim()) {
      throw new Error("username, password (min 6 chars), apiKey required");
    }
    const trimmedUser = username.trim();
    const trimmedKey = apiKey.trim();

    const existing = await this.mysqlQuery(
      "SELECT 1 FROM users WHERE username = ? OR api_key = ? LIMIT 1",
      [trimmedUser, trimmedKey]
    );
    if (existing.length) throw new Error("Username or API key already exists");

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.mysqlQuery(
      "INSERT INTO users (username, password_hash, api_key, role, created_at) VALUES (?, ?, ?, ?, NOW())",
      [trimmedUser, hash, trimmedKey, role]
    );

    return { username: trimmedUser, apiKey: trimmedKey, role };
  }

  async authenticateUser(username, password) {
    console.log('[DB AUTH] === START ===');
    console.log('[DB AUTH] Username:', username);
    console.log('[DB AUTH] Password received (raw):', JSON.stringify(password));
    console.log('[DB AUTH] Password char codes:', password.split('').map(c => c.charCodeAt(0)));
    console.log('[DB AUTH] Password length:', password.length);

    const rows = await this.mysqlQuery(
      "SELECT username, password_hash, api_key, role FROM users WHERE username = ?",
      [username]
    );

    console.log('[DB AUTH] Rows found:', rows.length);
    if (rows.length === 0) return null;

    const storedHash = rows[0].password_hash;
    console.log('[DB AUTH] Stored hash:', storedHash);

    const match = await bcrypt.compare(password, storedHash);

    console.log('[DB AUTH] bcrypt.compare result:', match);
    console.log('[DB AUTH] === END ===');

    if (!match) return null;

    return {
      username: rows[0].username,
      apiKey: rows[0].api_key,
      role: rows[0].role,
    };
  }

  async userExists(username) {
    if (!username) return false;
    const rows = await this.mysqlQuery("SELECT 1 FROM users WHERE username = ? LIMIT 1", [username]);
    return rows.length > 0;
  }

  async getUser(username) {
    const rows = await this.mysqlQuery(
      "SELECT username, api_key, role, created_at FROM users WHERE username = ? LIMIT 1",
      [username]
    );
    return rows[0] || null;
  }

  async getAllUsers() {
    return this.mysqlQuery("SELECT username, api_key, role, created_at FROM users ORDER BY username ASC");
  }

  async updateUser(username, updates) {
    const fields = [];
    const values = [];

    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined || v === null) continue;
      if (k === "password") {
        if (typeof v !== "string" || v.length < 6) throw new Error("Password too short");
        fields.push("password_hash = ?");
        values.push(await bcrypt.hash(v, BCRYPT_ROUNDS));
      } else if (k === "api_key") {
        if (typeof v !== "string" || !v.trim()) throw new Error("Invalid api_key");
        const key = v.trim();
        const conflict = await this.mysqlQuery(
          "SELECT 1 FROM users WHERE api_key = ? AND username != ? LIMIT 1",
          [key, username]
        );
        if (conflict.length) throw new Error("API key already in use");
        fields.push("api_key = ?");
        values.push(key);
      } else if (k === "role" && ["admin", "moderator", "user"].includes(v)) {
        fields.push("role = ?");
        values.push(v);
      }
    }

    if (!fields.length) return false;
    values.push(username);

    const sql = `UPDATE users SET ${fields.join(", ")}, updated_at = NOW() WHERE username = ?`;
    const { affectedRows } = await this.mysqlQuery(sql, values);
    return affectedRows > 0;
  }

  async deleteUser(username) {
    if (!username) return false;
    return this.mysqlTransaction(async (conn) => {
      await conn.execute(
        `DELETE s, ac, c, co, m, gm, pp, mf
         FROM sessions s
         LEFT JOIN auth_creds ac ON ac.session_id = s.session_id
         LEFT JOIN chats c ON c.session_id = s.session_id
         LEFT JOIN chats_overview co ON co.session_id = s.session_id
         LEFT JOIN messages m ON m.session_id = s.session_id
         LEFT JOIN group_metadata gm ON gm.session_id = s.session_id
         LEFT JOIN profile_pictures pp ON pp.session_id = s.session_id
         LEFT JOIN media_files mf ON mf.session_id = s.session_id
         WHERE s.owner = ?`,
        [username]
      );
      const [{ affectedRows }] = await conn.execute("DELETE FROM users WHERE username = ?", [username]);
      await this.redisDel(`user:${username}`);
      return affectedRows > 0;
    });
  }

  async readSessionConfig(sessionId) {
    const cacheKey = `session:config:${sessionId}`;
    if (this.useRedis) {
      const cached = await this.redisGet(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    const rows = await this.mysqlQuery(
      "SELECT metadata, webhooks, owner, token FROM sessions WHERE session_id = ? LIMIT 1",
      [sessionId]
    );

    if (!rows.length) {
      const data = { metadata: {}, webhooks: [], owner: "", token: "" };
      if (this.useRedis) await this.redisSetEx(cacheKey, 300, JSON.stringify(data));
      return data;
    }

    const r = rows[0];
    const data = {
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
      webhooks: r.webhooks ? JSON.parse(r.webhooks) : [],
      owner: r.owner || "",
      token: r.token || "",
    };

    if (this.useRedis) await this.redisSetEx(cacheKey, 300, JSON.stringify(data));
    return data;
  }

  async saveSessionConfig(sessionId, { metadata = {}, webhooks = [], owner = "", token = "" }) {
    console.log(sessionId, metadata, webhooks, owner, token);
    await this.mysqlQuery(
      `INSERT INTO sessions (session_id, metadata, webhooks, owner, token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE metadata=VALUES(metadata), webhooks=VALUES(webhooks),
         owner=VALUES(owner), token=VALUES(token), updated_at=NOW()`,
      [sessionId, JSON.stringify(metadata), JSON.stringify(webhooks), owner, token]
    );

    // Invalidate cache
    if (this.useRedis) await this.redisDel(`session:config:${sessionId}`);
  }

  bind(ev) {
    ev.on("connection.update", () => { });
    ev.on("creds.update", async (creds) => {
      await this.setAuthCred("creds", creds);
    });
    ev.on("chats.set", async ({ chats }) => {
      if (!Array.isArray(chats)) return;
      await this.mysqlTransaction(async (conn) => {
        for (const chat of chats) await this._upsertChat(chat, conn);
      });
    });
    ev.on("chats.upsert", async (chats) => {
      if (!Array.isArray(chats)) return;
      for (const chat of chats) await this._upsertChat(chat);
    });
    ev.on("chats.update", async (updates) => {
      if (!Array.isArray(updates)) return;
      for (const u of updates) await this._upsertChat(u);
    });
    ev.on("chats.delete", async (ids) => {
      if (!Array.isArray(ids)) ids = [ids];
      if (!ids.length) return;
      const ph = ids.map(() => "?").join(",");
      await this.mysqlQuery(
        `DELETE FROM chats WHERE session_id = ? AND id IN (${ph});
         DELETE FROM chats_overview WHERE session_id = ? AND chat_id IN (${ph});
         DELETE FROM messages WHERE session_id = ? AND chat_id IN (${ph})`,
        [this.sessionId, ...ids, this.sessionId, ...ids, this.sessionId, ...ids]
      );
      if (this.useRedis) {
        const keys = ids.flatMap(id => [
          `chat:overview:${this.sessionId}:${id}`,
          `chat:messages:recent:${this.sessionId}:${id}`
        ]);
        await this.redisDel(...keys);
      }
    });
    ev.on("contacts.set", async ({ contacts }) => {
      if (!Array.isArray(contacts)) return;
      await this.mysqlTransaction(async (conn) => {
        for (const c of contacts) await this._upsertContact(c, conn);
      });
    });
    ev.on("contacts.upsert", async (contacts) => {
      if (!Array.isArray(contacts)) return;
      for (const c of contacts) await this._upsertContact(c);
    });
    ev.on("contacts.update", async (updates) => {
      if (!Array.isArray(updates)) return;
      for (const u of updates) await this._upsertContact(u);
    });
    ev.on("messages.set", async ({ messages }) => {
      if (!Array.isArray(messages)) return;
      await this.mysqlTransaction(async (conn) => {
        for (const msg of messages) await this._upsertMessage(msg, conn);
      });
    });
    ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;

      const values = [];
      for (const msg of messages) {
        if (!msg?.key?.id || !msg?.key?.remoteJid) continue;

        const jsonStr = JSON.stringify(msg);
        if (jsonStr.length > 2_000_000) {
          console.warn(`[${this.sessionId}] Skipping huge message ${msg.key.id}`);
          continue;
        }

        values.push([
          this.sessionId,
          msg.key.remoteJid,
          msg.key.id,
          msg.messageTimestamp || Math.floor(Date.now() / 1000),
          jsonStr
        ]);
      }

      if (values.length === 0) return;

      const placeholders = values.map(() => "(?, ?, ?, ?, ?)").join(",");
      await this.mysqlQuery(
        `INSERT INTO messages (session_id, chat_id, msg_id, timestamp, full_message)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE timestamp=VALUES(timestamp), full_message=VALUES(full_message)`,
        values.flat()
      );
    });
    ev.on("messages.update", async (updates) => {
      if (!Array.isArray(updates)) return;
      for (const upd of updates) await this._updateMessage(upd);
    });
    ev.on("message-receipt.update", async (updates) => {
      if (!Array.isArray(updates)) return;
      for (const upd of updates) await this._updateReceipt(upd);
    });
    ev.on("group-participants.update", async (update) => {
      await this._updateGroupParticipants(update);
    });
    ev.on("groups.update", async (updates) => {
      if (!Array.isArray(updates)) return;
      for (const g of updates) await this._upsertGroupMetadata(g);
    });
    ev.on("group-join", async (update) => {
      await this._upsertGroupMetadata(update);
    });
    ev.on("group-leave", async ({ id }) => {
      await this.mysqlQuery("DELETE FROM group_metadata WHERE session_id = ? AND id = ?", [this.sessionId, id]);
    });
    ev.on("call", async (calls) => {
      for (const call of calls) await this._upsertCall(call);
    });
    ev.on("blocklist.set", async ({ blocklist }) => {
      await this._upsertBlocklist(blocklist);
    });
    ev.on("blocklist.update", async (update) => {
      await this._updateBlocklist(update);
    });
  }

  async _upsertChat(chat, conn = null) {
    const q = conn ? conn.execute.bind(conn) : this.mysqlQuery.bind(this);
    await q(
      `INSERT INTO chats (session_id, id, name, is_group, unread_count, last_message_timestamp, archived, pinned, muted_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), is_group=VALUES(is_group), unread_count=VALUES(unread_count),
         last_message_timestamp=VALUES(last_message_timestamp), archived=VALUES(archived), pinned=VALUES(pinned),
         muted_until=VALUES(muted_until)`,
      [
        this.sessionId, chat.id, chat.name || null, chat.isGroup ? 1 : 0,
        chat.unreadCount || 0, chat.lastMessageTimestamp || null,
        chat.archived ? 1 : 0, chat.pinned ? 1 : 0, chat.mute || 0
      ]
    );
  }

  async _upsertContact(contact, conn = null) {
    const q = conn ? conn.execute.bind(conn) : this.mysqlQuery.bind(this);
    await q(
      `INSERT INTO contacts (session_id, id, lid, phone, name, notify, verified_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE lid=VALUES(lid), phone=VALUES(phone), name=VALUES(name),
         notify=VALUES(notify), verified_name=VALUES(verified_name)`,
      [
        this.sessionId, contact.id, contact.lid || null, contact.phone || null,
        contact.name || null, contact.notify || null, contact.verifiedName || null
      ]
    );
  }

  async _upsertMessage(msg, conn = null) {
    if (!msg?.key?.id || !msg?.key?.remoteJid) return;

    const jsonStr = JSON.stringify(msg);
    if (jsonStr.length > 2_000_000) {
      console.warn(`[${this.sessionId}] Skipping huge message ${msg.key.id}`);
      return;
    }

    const q = conn ? conn.execute.bind(conn) : this.mysqlQuery.bind(this);
    await q(
      `INSERT INTO messages (session_id, chat_id, msg_id, timestamp, full_message)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE timestamp=VALUES(timestamp), full_message=VALUES(full_message)`,
      [
        this.sessionId,
        msg.key.remoteJid,
        msg.key.id,
        msg.messageTimestamp || Math.floor(Date.now() / 1000),
        jsonStr
      ]
    );
  }

  async saveMediaPath(sessionId, msgId, filePath) {
    await this.mysqlQuery(
      `INSERT INTO media_files (session_id, msg_id, file_path)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE file_path = VALUES(file_path), updated_at = NOW()`,
      [sessionId, msgId, filePath]
    );
  }

  async _updateMessage(update) {
    if (!update.key?.id || !update.key?.remoteJid) return;
    if (update.update?.status) {
      await this.mysqlQuery(
        "UPDATE messages SET full_message = JSON_SET(full_message, '$.status', ?) WHERE session_id = ? AND chat_id = ? AND msg_id = ?",
        [update.update.status, this.sessionId, update.key.remoteJid, update.key.id]
      );
    }
  }

  async _updateReceipt({ key, receipt }) {
    if (!key?.id || !key?.remoteJid) return;
    await this.mysqlQuery(
      "UPDATE messages SET full_message = JSON_SET(full_message, '$.userReceipt', ?) WHERE session_id = ? AND chat_id = ? AND msg_id = ?",
      [JSON.stringify(receipt), this.sessionId, key.remoteJid, key.id]
    );
  }

  async _updateGroupParticipants({ id, participants, action }) {
    if (!id || !Array.isArray(participants)) return;
    const current = await this.mysqlQuery(
      "SELECT participants FROM group_metadata WHERE session_id = ? AND id = ? LIMIT 1",
      [this.sessionId, id]
    );
    let list = current.length ? JSON.parse(current[0].participants || "[]") : [];
    if (action === "add") {
      list = [...new Set([...list, ...participants])];
    } else if (action === "remove") {
      list = list.filter(p => !participants.includes(p));
    } else if (action === "promote" || action === "demote") {
      list = list.map(p =>
        participants.includes(p.id || p) ? { ...p, admin: action === "promote" } : p
      );
    }
    await this.mysqlQuery(
      "UPDATE group_metadata SET participants = ? WHERE session_id = ? AND id = ?",
      [JSON.stringify(list), this.sessionId, id]
    );
  }

  async _upsertGroupMetadata(group) {
    if (!group?.id) return;
    await this.mysqlQuery(
      `INSERT INTO group_metadata (session_id, id, subject, subject_owner, subject_time, description,
        is_restricted, is_announced, size, creation, owner, participants)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         subject=VALUES(subject), subject_owner=VALUES(subject_owner), subject_time=VALUES(subject_time),
         description=VALUES(description), is_restricted=VALUES(is_restricted), is_announced=VALUES(is_announced),
         size=VALUES(size), creation=VALUES(creation), owner=VALUES(owner), participants=VALUES(participants)`,
      [
        this.sessionId, group.id, group.subject || null, group.subjectOwner || null,
        group.subjectTime || null, group.desc || null, group.restrict ? 1 : 0, group.announce ? 1 : 0,
        group.size || null, group.creation || null, group.owner || null,
        JSON.stringify(group.participants || [])
      ]
    );
  }

  async _upsertCall(call) {
    if (!call?.id || !call?.from) return;
    await this.mysqlQuery(
      `INSERT INTO call_logs (session_id, call_id, caller_jid, is_group, is_video, status, timestamp, duration_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         duration_seconds = VALUES(duration_seconds)`,
      [
        this.sessionId,
        call.id,
        call.from,
        call.isGroup ? 1 : 0,
        call.isVideo ? 1 : 0,
        call.status || "unknown",
        call.timestamp || Math.floor(Date.now() / 1000),
        call.duration || null
      ]
    );
  }

  async _upsertBlocklist(blocklist) {
    if (!Array.isArray(blocklist)) return;
    const normalized = blocklist
      .filter(jid => typeof jid === "string" && jid.includes("@"))
      .map(jid => jid.trim());
    if (!normalized.length) return;
    await this.mysqlQuery(
      `INSERT INTO device_blocklist (session_id, blocked_jids)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE blocked_jids = VALUES(blocked_jids), last_updated = NOW()`,
      [this.sessionId, JSON.stringify(normalized)]
    );
    if (this.useRedis) {
      await this.redisSetEx(`blocklist:${this.sessionId}`, 3600, JSON.stringify(normalized));
    }
  }

  async _updateBlocklist({ blocklist, type }) {
    if (!Array.isArray(blocklist) || !["add", "remove"].includes(type)) return;
    const normalized = blocklist
      .filter(jid => typeof jid === "string" && jid.includes("@"))
      .map(jid => jid.trim());
    if (!normalized.length) return;

    const rows = await this.mysqlQuery(
      "SELECT blocked_jids FROM device_blocklist WHERE session_id = ? LIMIT 1",
      [this.sessionId]
    );
    let current = [];
    if (rows.length) {
      try { current = JSON.parse(rows[0].blocked_jids || "[]"); } catch { }
    }

    let updated;
    if (type === "add") {
      updated = [...new Set([...current, ...normalized])];
    } else {
      updated = current.filter(jid => !normalized.includes(jid));
    }

    if (updated.length === current.length && type === "add") return;

    await this.mysqlQuery(
      `INSERT INTO device_blocklist (session_id, blocked_jids)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE blocked_jids = VALUES(blocked_jids), last_updated = NOW()`,
      [this.sessionId, JSON.stringify(updated)]
    );

    if (this.useRedis) {
      await this.redisSetEx(`blocklist:${this.sessionId}`, 3600, JSON.stringify(updated));
    }
  }

  async getBlocklist() {
    if (this.useRedis) {
      const cached = await this.redisGet(`blocklist:${this.sessionId}`);
      if (cached) return JSON.parse(cached);
    }
    const rows = await this.mysqlQuery(
      "SELECT blocked_jids FROM device_blocklist WHERE session_id = ? LIMIT 1",
      [this.sessionId]
    );
    if (!rows.length) return [];
    try {
      return JSON.parse(rows[0].blocked_jids || "[]");
    } catch {
      return [];
    }
  }

  async checkConnection() {
    try {
      await this.mysqlQuery("SELECT 1");
      return { mysql: "connected" };
    } catch (err) {
      return { mysql: "error", error: err.message };
    }
  }

  async getStats(sessionId = this.sessionId) {
    const tables = ["chats", "chats_overview", "contacts", "messages", "group_metadata", "profile_pictures", "media_files", "sessions", "auth_creds", "users"];
    const counts = await Promise.all(tables.map(async t => {
      const rows = await this.mysqlQuery(
        `SELECT COUNT(*) as cnt FROM ${t} ${t !== "users" ? "WHERE session_id = ?" : ""}`,
        t !== "users" ? [sessionId] : []
      );
      return [t, rows[0]?.cnt ?? 0];
    }));
    return Object.fromEntries(counts);
  }

  async readAllSessions() {
    return await this.mysqlQuery(
      "SELECT session_id, metadata, webhooks, owner, token FROM sessions ORDER BY session_id"
    );
  }
}

module.exports = DatabaseStore;