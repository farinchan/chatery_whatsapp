require("dotenv").config();
const mysql = require("mysql2/promise");
const { createClient } = require("redis");

const fs = require("fs");
const path = require("path");
const { downloadMediaMessage, getContentType } = require("@whiskeysockets/baileys");


class DatabaseStore {
  constructor(sessionId = "global") {
    this.sessionId = sessionId.replace(/[\/\\:*?"<>|]/g, "_");

    this.mysqlPool = mysql.createPool({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "whatsapp",
      connectionLimit: 100,
      queueLimit: 1500,
      waitForConnections: true,
      timezone: "+00:00",
      supportBigNumbers: true,
      bigNumberStrings: true,
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
        console.log("pool ready");
        conn.release();
      })
      .catch(err => {
        console.error({ err }, "pool startup failed");
      });

    if (sessionId === "global") {
      this.ensureTables().catch(err => {
        console.error({ err }, "Failed to ensure tables");
      });
    }
  }

  async ensureTables() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS call_logs (
        session_id VARCHAR(100) NOT NULL,
        call_id VARCHAR(100) NOT NULL,
        caller_jid VARCHAR(255) NOT NULL,
        is_group TINYINT(1) DEFAULT 0,
        is_video TINYINT(1) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'unknown',
        timestamp BIGINT NOT NULL,
        duration_seconds INT DEFAULT NULL,
        PRIMARY KEY (session_id, call_id),
        INDEX idx_session (session_id),
        INDEX idx_timestamp (session_id, timestamp DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

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

      `CREATE TABLE IF NOT EXISTS chats_overview (
        session_id VARCHAR(100) NOT NULL,
        chat_id VARCHAR(255) NOT NULL,
        last_message_preview LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
        unread_count INT DEFAULT 0,
        PRIMARY KEY (session_id, chat_id),
        INDEX idx_session (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

      `CREATE TABLE IF NOT EXISTS contacts (
        session_id VARCHAR(100) NOT NULL,
        id VARCHAR(255) NOT NULL,
        lid VARCHAR(255) DEFAULT NULL,
        phone_number VARCHAR(50) DEFAULT NULL,
        name VARCHAR(255) DEFAULT NULL,
        notify VARCHAR(255) DEFAULT NULL,
        verified_name VARCHAR(255) DEFAULT NULL,
        profile_picture_url TEXT DEFAULT NULL,
        about TEXT DEFAULT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id, id),
        INDEX idx_phone_number (session_id, phone_number),
        INDEX idx_name (session_id, name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

      `CREATE TABLE IF NOT EXISTS device_blocklist (
        session_id VARCHAR(100) NOT NULL,
        blocked_jids LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

      `CREATE TABLE IF NOT EXISTS group_metadata (
        session_id VARCHAR(100) NOT NULL,
        id VARCHAR(255) NOT NULL,
        subject VARCHAR(255) DEFAULT NULL,
        subject_owner VARCHAR(255) DEFAULT NULL,
        subject_time BIGINT DEFAULT NULL,
        description TEXT DEFAULT NULL,
        is_restricted TINYINT(1) DEFAULT 0,
        is_announced TINYINT(1) DEFAULT 0,
        participant_count INT DEFAULT NULL,
        creation BIGINT DEFAULT NULL,
        owner VARCHAR(255) DEFAULT NULL,
        participants LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id, id),
        INDEX idx_session (session_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

      `CREATE TABLE IF NOT EXISTS messages (
        session_id VARCHAR(100) NOT NULL,
        chat_id VARCHAR(255) NOT NULL,
        message_id VARCHAR(255) NOT NULL,
        sender_jid VARCHAR(255) NOT NULL,
        from_me TINYINT(1) DEFAULT 0,
        type ENUM('text','image','video','audio','document','sticker','location','contact','reaction','revoke','other') DEFAULT 'other',
        content TEXT DEFAULT NULL,
        caption TEXT DEFAULT NULL,
        timestamp BIGINT NOT NULL,
        status ENUM('sent','delivered','read','played','failed') DEFAULT 'sent',
        media_path VARCHAR(512) DEFAULT NULL,
        raw_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
        PRIMARY KEY (session_id, chat_id, message_id),
        INDEX idx_chat (session_id, chat_id),
        INDEX idx_timestamp (session_id, timestamp DESC),
        INDEX idx_sender (session_id, sender_jid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

      `CREATE TABLE IF NOT EXISTS profile_pictures (
        session_id VARCHAR(100) NOT NULL,
        jid VARCHAR(255) NOT NULL,
        url TEXT DEFAULT NULL,
        thumbnail_url TEXT DEFAULT NULL,
        fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id, jid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
    ];

    for (const query of queries) {
      try {
        await this.mysqlQuery(query);
      } catch (err) {
        console.error({ err }, "Failed to create table");
      }
    }
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
        console.warn({
          attempt,
          maxRetries,
          sql: sql,
          params,
          error: err.message
        }, "mysqlQuery failed");

        if (attempt === maxRetries) throw err;

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
      console.error({ err }, "mysqlTransaction failed");
      throw err;
    } finally {
      if (conn) conn.release();
    }
  }

  async redisGet(key) { return this.redisReady ? await this.redis.get(key).catch(() => null) : null; }
  async redisSetEx(key, sec, val) { if (this.redisReady) await this.redis.setEx(key, sec, val).catch(() => { }); }
  async redisDel(...keys) { if (this.redisReady && keys.length) await this.redis.del(keys).catch(() => { }); }

  async downloadAndSaveMedia(msg) {
    if (!msg?.message || !this.sock) return null;

    const contentType = getContentType(msg.message);
    if (!['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(contentType)) return null;

    try {
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger: this.logger.child({ module: 'downloadMedia' }) }
      );

      const extMap = {
        imageMessage: 'jpg',
        videoMessage: 'mp4',
        audioMessage: msg.message.audioMessage?.ptt ? 'ogg' : 'mp3',
        documentMessage: msg.message.documentMessage?.fileName?.split('.').pop() || 'bin',
        stickerMessage: 'webp'
      };

      const ext = extMap[contentType] || 'bin';
      const filename = `${msg.key.id}.${ext}`;
      const mediaDir = path.join(process.cwd(), 'public', 'media', this.sessionId);
      const fullPath = path.join(mediaDir, filename);
      const publicUrl = `/media/${this.sessionId}/${filename}`;

      if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

      fs.writeFileSync(fullPath, buffer);

      console.log({ messageId: msg.key.id, type: contentType, url: publicUrl }, "Media saved");

      await this.mysqlQuery(
        `UPDATE messages 
         SET media_path = ? 
         WHERE session_id = ? AND chat_id = ? AND message_id = ?`,
        [publicUrl, this.sessionId, msg.key.remoteJid, msg.key.id]
      );

      return publicUrl;
    } catch (err) {
      console.error({ messageId: msg.key?.id, err }, "Media download failed");
      return null;
    }
  }

  async _bulkUpsertContacts(contacts) {
    if (!Array.isArray(contacts) || contacts.length === 0) return;

    const values = [];
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    for (const contact of contacts) {
      if (!contact?.id) continue;

      const contactId       = contact.id;
      const contactLid      = contact.lid || null;
      let contactPhone      = contact.phoneNumber || null;
      const contactName     = contact.name || contact.pushName || null;
      const contactNotify   = contact.notify || null;
      const verifiedName    = contact.verifiedName || contact.verified_name || null;
      const profilePicUrl   = contact.imgUrl || contact.profilePictureUrl || null;
      const about           = contact.status || contact.about || null;

      let resolvedPhone = null;
      if (!contactPhone && contactId?.endsWith('@lid') && this.sock?.signalRepository?.lidMapping) {
        try {
          resolvedPhone = await this.sock.signalRepository.lidMapping.getPNForLID(contactId);
          if (resolvedPhone) {
            console.log({ contactId, resolvedPhone }, "contact resolve success");
            contactPhone = resolvedPhone;
          }
        } catch (err) {}
      }

      let derivedPhone = null;
      if (!contactPhone) {
        if (contactId?.endsWith('@s.whatsapp.net')) {
          derivedPhone = contactId.split('@')[0];
        } else if (contactLid?.endsWith('@s.whatsapp.net')) {
          derivedPhone = contactLid.split('@')[0];
        }
      }

      const finalPhone = contactPhone || derivedPhone || null;

      values.push([
        this.sessionId,
        contactId,
        contactLid,
        finalPhone,
        contactName,
        contactNotify,
        verifiedName,
        profilePicUrl,
        about,
        now
      ]);
    }

    if (values.length === 0) return;

    const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    const sql = `
      INSERT INTO contacts (
        session_id, id, lid, phone_number, name, notify, verified_name,
        profile_picture_url, about, updated_at
      ) VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        lid = VALUES(lid),
        phone_number = VALUES(phone_number),
        name = VALUES(name),
        notify = VALUES(notify),
        verified_name = VALUES(verified_name),
        profile_picture_url = VALUES(profile_picture_url),
        about = VALUES(about),
        updated_at = NOW()
    `;

    try {
      await this.mysqlQuery(sql, values.flat());
      console.log({ count: values.length }, "Bulk upserted contacts");
    } catch (err) {
      console.error({ err, count: values.length }, "Bulk contacts upsert failed");
      throw err;
    }
  }

  bind(ev, sock) {
    this.sock = sock;
    ev.on("connection.update", () => { });
    ev.on("chats.set", async ({ chats }) => {
      if (!Array.isArray(chats)) return;
      await this.mysqlTransaction(async (conn) => {
        for (const chat of chats) await this._upsertChat(chat, conn);
      });
    });
ev.on("chats.upsert", async (chats) => {
  if (!Array.isArray(chats)) return;
  for (const chat of chats) {
    await this._upsertChat(chat);
    await this._upsertChatOverview(chat.id, {
      unread_count: chat.unreadCount || 0
    });
  }
});
ev.on("chats.update", async (updates) => {
  if (!Array.isArray(updates)) return;
  for (const u of updates) {
    await this._upsertChat(u);
    if ('unreadCount' in u) {
      await this._upsertChatOverview(u.id, {
        unread_count: u.unreadCount
      });
    }
  }
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
      await this._bulkUpsertContacts(contacts);
    });
    ev.on("contacts.upsert", async (contacts) => {
      await this._bulkUpsertContacts(contacts);
    });
    ev.on("contacts.update", async (updates) => {
      await this._bulkUpsertContacts(updates);
    });
    ev.on('lid-mapping.update', (update) => {
      for (const mapping of update.mapping || []) {
        const lid = mapping.lid;
        const pn = mapping.pn;
        console.log({ lid, pn }, "LID mapping update");
        this.mysqlQuery(
          `UPDATE contacts SET phone_number = ? WHERE session_id = ? AND id = ?`,
          [pn, this.sessionId, lid]
        ).catch(err => console.warn({ err }, "lid-mapping.update DB update failed"));
      }
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
        if (jsonStr.length > 2000000) {
          console.warn({ msgId: msg.key.id }, "Skipping huge message");
          continue;
        }

        values.push([
          this.sessionId,
          msg.key.remoteJid,
          msg.key.id,
          msg.key.fromMe ? 1 : 0,
          msg.key.participant || msg.key.remoteJid,
          msg.messageTimestamp || Math.floor(Date.now() / 1000),
          jsonStr
        ]);

        const ct = getContentType(msg.message);
        if (ct && ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'].includes(ct)) {
          this.downloadAndSaveMedia(msg).catch(err => console.warn({ err }, "Auto media download failed"));
        }
      }

      if (values.length === 0) return;

      const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");
      await this.mysqlQuery(
        `INSERT INTO messages (session_id, chat_id, message_id, from_me, sender_jid, timestamp, raw_json)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE timestamp=VALUES(timestamp), raw_json=VALUES(raw_json)`,
        values.flat()
      );
      if (messages.length > 0) {
        const latest = messages[messages.length - 1];
        if (latest?.key?.remoteJid) {
          const preview = require('../services/whatsapp/MessageFormatter').formatLastMessagePreview(latest);
          if (preview) {
            await this._upsertChatOverview(latest.key.remoteJid, {
              last_message_preview: preview
            });
          }
        }
      }

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
    ev.on("groups.set", async ({ groups }) => {
      if (!Array.isArray(groups)) return;
      await this.mysqlTransaction(async (conn) => {
        for (const group of groups) await this._upsertGroupMetadata(group, conn);
      });
    });

    ev.on("groups.upsert", async (groups) => {
      if (!Array.isArray(groups)) return;
      await this.mysqlTransaction(async (conn) => {
        for (const group of groups) await this._upsertGroupMetadata(group, conn);
      });
    });

    ev.on("groups.update", async (updates) => {
      if (!Array.isArray(updates)) return;
      for (const update of updates) await this._upsertGroupMetadata(update);
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
    if (!contact?.id) return;

    const q = conn ? conn.execute.bind(conn) : this.mysqlQuery.bind(this);

    const contactId       = contact.id;
    const contactLid      = contact.lid || null;
    let contactPhone      = contact.phoneNumber || null;
    const contactName     = contact.name || contact.pushName || null;
    const contactNotify   = contact.notify || null;
    const verifiedName    = contact.verifiedName || contact.verified_name || null;
    const profilePicUrl   = contact.imgUrl || contact.profilePictureUrl || null;
    const about           = contact.status || contact.about || null;

    let resolvedPhone = null;

    if (!contactPhone && contactId?.endsWith('@lid') && this.sock?.signalRepository?.lidMapping) {
      try {
        resolvedPhone = await this.sock.signalRepository.lidMapping.getPNForLID(contactId);
        if (resolvedPhone) {
          console.log({ contactId, resolvedPhone }, "contact resolve success");
          contactPhone = resolvedPhone;
        }
      } catch (err) {}
    }

    let derivedPhone = null;
    if (!contactPhone) {
      if (contactId?.endsWith('@s.whatsapp.net')) {
        derivedPhone = contactId.split('@')[0];
      } else if (contactLid?.endsWith('@s.whatsapp.net')) {
        derivedPhone = contactLid.split('@')[0];
      }
    }

    const finalPhone = contactPhone || derivedPhone || null;

    console.log({
      id: contactId,
      lid: contactLid || '-',
      phone: finalPhone || 'missing',
      source: contactPhone ? 'server' : derivedPhone ? 'derived' : 'none'
    }, "contact upsert");

    await q(
      `INSERT INTO contacts (
          session_id, id, lid, phone_number, name, notify, verified_name,
          profile_picture_url, about, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
          lid                  = VALUES(lid),
          phone_number         = VALUES(phone_number),
          name                 = VALUES(name),
          notify               = VALUES(notify),
          verified_name        = VALUES(verified_name),
          profile_picture_url  = VALUES(profile_picture_url),
          about                = VALUES(about),
          updated_at           = NOW()`,
      [
        this.sessionId,
        contactId,
        contactLid,
        finalPhone,
        contactName,
        contactNotify,
        verifiedName,
        profilePicUrl,
        about
      ]
    );
  }

  async _upsertMessage(msg, conn = null) {
    if (!msg?.key?.id || !msg?.key?.remoteJid) return;

    const jsonStr = JSON.stringify(msg);
    if (jsonStr.length > 2000000) {
      console.warn({ msgId: msg.key.id }, "Skipping huge message");
      return;
    }

    const q = conn ? conn.execute.bind(conn) : this.mysqlQuery.bind(this);
    await q(
      `INSERT INTO messages (session_id, chat_id, message_id, from_me, sender_jid, timestamp, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE timestamp=VALUES(timestamp), raw_json=VALUES(raw_json)`,
      [
        this.sessionId,
        msg.key.remoteJid,
        msg.key.id,
        msg.key.fromMe ? 1 : 0,
        msg.key.participant || msg.key.remoteJid,
        msg.messageTimestamp || Math.floor(Date.now() / 1000),
        jsonStr
      ]
    );
  }

  async _updateMessage(update) {
    if (!update.key?.id || !update.key?.remoteJid) return;
    if (update.update?.status) {
      await this.mysqlQuery(
        "UPDATE messages SET raw_json = JSON_SET(raw_json, '$.status', ?) WHERE session_id = ? AND chat_id = ? AND message_id = ?",
        [update.update.status, this.sessionId, update.key.remoteJid, update.key.id]
      );
    }
  }

  async _updateReceipt({ key, receipt }) {
    if (!key?.id || !key?.remoteJid) return;
    await this.mysqlQuery(
      "UPDATE messages SET raw_json = JSON_SET(raw_json, '$.userReceipt', ?) WHERE session_id = ? AND chat_id = ? AND message_id = ?",
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

  async _upsertGroupMetadata(group, conn = null) {
    if (!group?.id) return;

    const q = conn ? conn.execute.bind(conn) : this.mysqlQuery.bind(this);

    await q(
      `INSERT INTO group_metadata (
        session_id, id, subject, subject_owner, subject_time, description,
        is_restricted, is_announced, participant_count, creation, owner, participants
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        subject=VALUES(subject),
        subject_owner=VALUES(subject_owner),
        subject_time=VALUES(subject_time),
        description=VALUES(description),
        is_restricted=VALUES(is_restricted),
        is_announced=VALUES(is_announced),
        participant_count=VALUES(participant_count),
        creation=VALUES(creation),
        owner=VALUES(owner),
        participants=VALUES(participants),
        updated_at=NOW()`,
      [
        this.sessionId,
        group.id,
        group.subject || null,
        group.subjectOwner || null,
        group.subjectTime || null,
        group.desc || group.description || null,
        group.restrict ? 1 : 0,
        group.announce ? 1 : 0,
        group.participants?.length || null,
        group.creation || null,
        group.owner || null,
        JSON.stringify(group.participants || [])
      ]
    );
  }
async _upsertChatOverview(chatId, updates = {}) {
  const fields = [];
  const values = [this.sessionId, chatId];
  const updateClauses = [];

  if ('last_message_preview' in updates) {
    fields.push("last_message_preview = ?");
    values.push(updates.last_message_preview ? JSON.stringify(updates.last_message_preview) : null);
    updateClauses.push("last_message_preview = VALUES(last_message_preview)");
  }

  if ('unread_count' in updates) {
    fields.push("unread_count = ?");
    values.push(updates.unread_count);
    updateClauses.push("unread_count = VALUES(unread_count)");
  }

  if (fields.length === 0) return;

  const insertFields = fields.length ? `, ${fields.join(', ')}` : '';
  const insertValues = fields.length ? `, ${fields.map(() => '?').join(', ')}` : '';

  const sql = `
    INSERT INTO chats_overview (session_id, chat_id ${insertFields})
    VALUES (?, ? ${insertValues})
    ON DUPLICATE KEY UPDATE ${updateClauses.join(', ')}
  `;

  await this.mysqlQuery(sql, values);
}
  async _upsertCall(call) {
    console.log(call);
    if (!call?.id || !call?.from) return;

    const status = call.status 
      ? String(call.status).trim() || 'unknown' 
      : 'unknown';

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
        status,
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
    const tables = ["chats", "chats_overview", "contacts", "messages", "group_metadata", "profile_pictures", "sessions"];
    const counts = await Promise.all(tables.map(async t => {
      const rows = await this.mysqlQuery(
        `SELECT COUNT(*) as cnt FROM ${t} ${t !== "sessions" ? "WHERE session_id = ?" : ""}`,
        t !== "sessions" ? [sessionId] : []
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

  async deleteSessionData(sessionId) {
    if (!sessionId?.trim()) {
      throw new Error("Session ID is required");
    }

    const targetSessionId = sessionId.trim();

    console.log({ targetSessionId }, "Starting deletion of session data");

    return this.mysqlTransaction(async (conn) => {
      try {
        await conn.execute("DELETE FROM call_logs WHERE session_id = ?", [targetSessionId]);
        await conn.execute("DELETE FROM chats_overview WHERE session_id = ?", [targetSessionId]);
        await conn.execute("DELETE FROM chats WHERE session_id = ?", [targetSessionId]);
        await conn.execute("DELETE FROM contacts WHERE session_id = ?", [targetSessionId]);
        await conn.execute("DELETE FROM device_blocklist WHERE session_id = ?", [targetSessionId]);
        await conn.execute("DELETE FROM group_metadata WHERE session_id = ?", [targetSessionId]);
        await conn.execute("DELETE FROM messages WHERE session_id = ?", [targetSessionId]);
        await conn.execute("DELETE FROM profile_pictures WHERE session_id = ?", [targetSessionId]);

        const [sessionResult] = await conn.execute("DELETE FROM sessions WHERE session_id = ?", [targetSessionId]);

        if (this.useRedis) {
          await this.redisDel(
            `blocklist:${targetSessionId}`,
            `session:config:${targetSessionId}`
          );
        }

        console.log({ targetSessionId, affectedSessions: sessionResult.affectedRows }, "Session data deleted successfully");

        return {
          success: true,
          deletedSessionId: targetSessionId,
          message: "Session data and all related records deleted"
        };
      } catch (err) {
        console.error({ targetSessionId, err }, "Failed to delete session data");
        throw err;
      }
    });
  }
}

module.exports = DatabaseStore;