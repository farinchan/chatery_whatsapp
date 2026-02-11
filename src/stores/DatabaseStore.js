require("dotenv").config();
const mysql = require("mysql2/promise");
const { createClient } = require("redis");

const fs = require("fs");
const path = require("path");
const { downloadMediaMessage, getContentType } = require("@whiskeysockets/baileys");

class DatabaseStore {
  constructor(sessionId = "global", username = null) {
    this.sessionId = sessionId.replace(/[\/\\:*?"<>|]/g, "_");
    this.username = username; 

    console.log('DatabaseStore', this.username);

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

    // Redis setup
    this.useRedis = !!process.env.REDIS_HOST || !!process.env.REDIS_URL;
    this.redis = null;
    this.redisReady = false;

    if (this.useRedis) {
      let redisConfig;

      if (process.env.REDIS_URL) {
        redisConfig = { url: process.env.REDIS_URL };
      } else {
        const host = process.env.REDIS_HOST || "127.0.0.1";
        const port = Number(process.env.REDIS_PORT) || 6379;
        const password = process.env.REDIS_PASSWORD || undefined;
        const db = Number(process.env.REDIS_DB) || 0;

        redisConfig = {
          socket: { host, port, reconnectStrategy: (retries) => Math.min(retries * 250, 5000) },
          database: db,
        };
        if (password) redisConfig.password = password;
      }

      this.redis = createClient(redisConfig);

      this.redis.on("error", (err) => {
        console.error(`[${this.sessionId}] Redis error: ${err.message}`, err);
        this.redisReady = false;
      });

      this.redis.on("ready", () => {
        console.log(`[${this.sessionId}] Redis connected → ${process.env.REDIS_URL || `${redisConfig.socket.host}:${redisConfig.socket.port} (DB ${redisConfig.database})`}`);
        this.redisReady = true;
      });

      this.redis.connect().catch((err) => {
        console.error(`[${this.sessionId}] Redis connection failed: ${err.message}`, err);
      });
    } else {
      console.log(`[${this.sessionId}] Redis disabled (no REDIS_HOST or REDIS_URL)`);
    }

    this.mysqlPool.getConnection()
      .then((conn) => {
        console.log(`[${this.sessionId}] MySQL pool ready`);
        conn.release();
      })
      .catch((err) => {
        console.error(`[${this.sessionId}] MySQL pool startup failed: ${err.message}`, err);
      });

    if (sessionId === "global") {
      this.ensureTables().catch((err) => {
        console.error(`[${this.sessionId}] Failed to ensure tables: ${err.message}`, err);
      });
    }
  }

async ensureTables() {
  if (this.sessionId !== "global") {
    console.log(`[${this.sessionId}] Skipping global table creation (only done in global instance)`);
    return;
  }

  console.log(`[${this.sessionId}] Ensuring all global tables, indexes and triggers...`);

  const createTableQueries = [
    // 1. Users (global)
    `CREATE TABLE IF NOT EXISTS users (
      username VARCHAR(255) NOT NULL PRIMARY KEY,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin', 'moderator', 'user') DEFAULT 'user',
      api_key VARCHAR(255) UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_api_key (api_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 2. Call logs
    `CREATE TABLE IF NOT EXISTS call_logs (
      session_id VARCHAR(100) NOT NULL,
      username VARCHAR(100) DEFAULT NULL,
      call_id VARCHAR(100) NOT NULL,
      caller_jid VARCHAR(255) NOT NULL,
      is_group TINYINT(1) DEFAULT 0,
      is_video TINYINT(1) DEFAULT 0,
      status VARCHAR(50) DEFAULT 'unknown',
      timestamp BIGINT NOT NULL,
      duration_seconds INT DEFAULT NULL,
      PRIMARY KEY (session_id, call_id),
      INDEX idx_session_timestamp (session_id, timestamp DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 3. Chats
    `CREATE TABLE IF NOT EXISTS chats (
      session_id VARCHAR(100) NOT NULL,
      username VARCHAR(100) DEFAULT NULL,
      id VARCHAR(255) NOT NULL,
      name VARCHAR(255) DEFAULT NULL,
      is_group TINYINT(1) DEFAULT 0,
      unread_count INT DEFAULT 0,
      last_message_timestamp BIGINT DEFAULT NULL,
      archived TINYINT(1) DEFAULT 0,
      pinned TINYINT(1) DEFAULT 0,
      muted_until BIGINT DEFAULT 0,
      PRIMARY KEY (session_id, id),
      INDEX idx_session_timestamp (session_id, last_message_timestamp DESC),
      INDEX idx_session_pinned (session_id, pinned DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 4. Chats overview – labels JSON DEFAULT NULL (fixed)
    `CREATE TABLE IF NOT EXISTS chats_overview (
      session_id VARCHAR(100) NOT NULL,
      username VARCHAR(100) DEFAULT NULL,
      chat_id VARCHAR(255) NOT NULL,
      last_message_preview LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
      last_message_id VARCHAR(255) DEFAULT NULL,
      last_message_timestamp BIGINT DEFAULT 0,
      unread_count INT DEFAULT 0,
      is_pinned TINYINT(1) DEFAULT 0,
      is_archived TINYINT(1) DEFAULT 0,
      is_muted TINYINT(1) DEFAULT 0,
      mute_end BIGINT DEFAULT NULL,
      labels JSON DEFAULT NULL,
      PRIMARY KEY (session_id, chat_id),
      INDEX idx_session_timestamp (session_id, last_message_timestamp DESC),
      INDEX idx_session_pinned (session_id, is_pinned DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 5. Contacts
    `CREATE TABLE IF NOT EXISTS contacts (
      session_id VARCHAR(100) NOT NULL,
      username VARCHAR(100) DEFAULT NULL,
      id VARCHAR(255) NOT NULL,
      lid VARCHAR(255) DEFAULT NULL,
      phone_number VARCHAR(50) DEFAULT NULL,
      name VARCHAR(255) DEFAULT NULL,
      notify VARCHAR(255) DEFAULT NULL,
      verified_name VARCHAR(255) DEFAULT NULL,
      profile_picture_url TEXT DEFAULT NULL,
      about TEXT DEFAULT NULL,
      business_profile JSON DEFAULT NULL,
      last_seen_privacy VARCHAR(56) DEFAULT NULL,
      profile_photo_privacy VARCHAR(56) DEFAULT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, id),
      INDEX idx_session_phone (session_id, phone_number),
      INDEX idx_session_name (session_id, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 6. Contact changes
    `CREATE TABLE IF NOT EXISTS contact_changes (
      change_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(100) NOT NULL,
      username VARCHAR(100) DEFAULT NULL,
      contact_id VARCHAR(255) NOT NULL,
      changed_field VARCHAR(50) NOT NULL,
      old_value TEXT,
      new_value TEXT,
      change_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_session_contact (session_id, contact_id),
      INDEX idx_timestamp (change_timestamp DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 7. Message reactions
    `CREATE TABLE IF NOT EXISTS message_reactions (
      reaction_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(100) NOT NULL,
      username VARCHAR(100) DEFAULT NULL,
      chat_id VARCHAR(255) NOT NULL,
      message_id VARCHAR(255) NOT NULL,
      reactor_jid VARCHAR(255) NOT NULL,
      emoji VARCHAR(20) NOT NULL,
      timestamp BIGINT NOT NULL,
      INDEX idx_session_message (session_id, chat_id, message_id),
      INDEX idx_session_reactor (session_id, reactor_jid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 8. Polls
    `CREATE TABLE IF NOT EXISTS polls (
      poll_id BIGINT AUTO_INCREMENT PRIMARY KEY,
      session_id VARCHAR(100) NOT NULL,
      username VARCHAR(100) DEFAULT NULL,
      chat_id VARCHAR(255) NOT NULL,
      message_id VARCHAR(255) NOT NULL,
      poll_name TEXT NOT NULL,
      options JSON DEFAULT NULL,
      selectable_count INT DEFAULT 1,
      timestamp BIGINT NOT NULL,
      INDEX idx_session_message (session_id, chat_id, message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 9. Device blocklist
    `CREATE TABLE IF NOT EXISTS device_blocklist (
      session_id VARCHAR(100) NOT NULL,
      username VARCHAR(100) DEFAULT NULL,
      blocked_jids LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    // 10. Group metadata
    `CREATE TABLE IF NOT EXISTS group_metadata (
      session_id VARCHAR(100) NOT NULL,
      username VARCHAR(100) DEFAULT NULL,
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

    // 11. Messages
    `CREATE TABLE IF NOT EXISTS messages (
      session_id VARCHAR(100) NOT NULL,
      username VARCHAR(100) DEFAULT NULL,
      chat_id VARCHAR(255) NOT NULL,
      message_id VARCHAR(255) NOT NULL,
      sender_jid VARCHAR(255) NOT NULL,
      from_me TINYINT(1) DEFAULT 0,
      type VARCHAR(56) DEFAULT 'other',
      content TEXT DEFAULT NULL,
      caption TEXT DEFAULT NULL,
      timestamp BIGINT NOT NULL,
      status VARCHAR(56) DEFAULT 'sent',
      media_path VARCHAR(512) DEFAULT NULL,
      quoted_message_id VARCHAR(255) DEFAULT NULL,
      raw_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
      PRIMARY KEY (session_id, chat_id, message_id),
      INDEX idx_session_chat_timestamp (session_id, chat_id, timestamp DESC),
      INDEX idx_session_sender (session_id, sender_jid),
      INDEX idx_session_quoted (session_id, quoted_message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
  ];

  return this.mysqlTransaction(async (conn) => {
    try {
      // === 1. Create / ensure all tables ===
      for (const query of createTableQueries) {
        await conn.query(query);
      }

      // === 2. Triggers – DROP + CREATE separately (no DELIMITER needed) ===
      await conn.query(`DROP TRIGGER IF EXISTS tr_messages_after_insert_unread`);
      await conn.query(`
        CREATE TRIGGER tr_messages_after_insert_unread
        AFTER INSERT ON messages
        FOR EACH ROW
        BEGIN
          IF NEW.from_me = 0 AND NEW.status != 'read' THEN
            INSERT INTO chats_overview (
              session_id, username, chat_id,
              last_message_id, last_message_timestamp, unread_count,
              is_pinned, is_archived, is_muted, mute_end, labels
            )
            VALUES (
              NEW.session_id, NEW.username, NEW.chat_id,
              NEW.message_id, NEW.timestamp, 1,
              0, 0, 0, NULL, NULL
            )
            ON DUPLICATE KEY UPDATE
              last_message_id         = NEW.message_id,
              last_message_timestamp   = NEW.timestamp,
              unread_count            = unread_count + 1;
          END IF;
        END
      `);

      await conn.query(`DROP TRIGGER IF EXISTS tr_messages_after_update_read`);
      await conn.query(`
        CREATE TRIGGER tr_messages_after_update_read
        AFTER UPDATE ON messages
        FOR EACH ROW
        BEGIN
          IF OLD.from_me = 0 
             AND OLD.status != 'read' 
             AND NEW.status = 'read' THEN
            UPDATE chats_overview
            SET unread_count = GREATEST(unread_count - 1, 0)
            WHERE session_id = NEW.session_id
              AND chat_id = NEW.chat_id;
          END IF;
        END
      `);

      // === 3. Indexes – safe check + create ===
      const indexes = [
        {
          table: 'messages',
          name: 'idx_session_type_timestamp',
          columns: 'session_id, type, timestamp DESC'
        },
        {
          table: 'chats_overview',
          name: 'idx_session_unread',
          columns: 'session_id, unread_count DESC'
        },
        {
          table: 'group_metadata',
          name: 'idx_session_subject',
          columns: 'session_id, subject'
        },
        // ← add more indexes here if needed
      ];

      for (const idx of indexes) {
        const [rows] = await conn.query(
          `SHOW INDEX FROM ?? WHERE Key_name = ?`,
          [idx.table, idx.name]
        );

        if (rows.length === 0) {
          await conn.query(
            `ALTER TABLE ?? ADD INDEX ?? (${idx.columns})`,
            [idx.table, idx.name]
          );
          console.log(`[${this.sessionId}] Created index ${idx.name} on ${idx.table}`);
        } else {
          console.log(`[${this.sessionId}] Index ${idx.name} on ${idx.table} already exists`);
        }
      }

      console.log(`[${this.sessionId}] All global tables, triggers, and indexes ensured successfully`);
    } catch (err) {
      console.error(`[${this.sessionId}] Critical error during ensureTables:`, err.message, err);
      throw err; // rollback
    }
  });
}

  async mysqlQuery(sql, params = [], maxRetries = 1) {
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
          session: this.sessionId,
          attempt,
          maxRetries,
          sqlSnippet: sql.substring(0, 100) + (sql.length > 100 ? "..." : ""),
          paramsLength: params.length,
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
      console.error(`[${this.sessionId}] Transaction failed: ${err.message}`, err);
      throw err;
    } finally {
      if (conn) conn.release();
    }
  }

  async redisGet(key) {
    if (!this.redisReady) return null;
    try {
      return await this.redis.get(key);
    } catch (err) {
      console.warn(`[${this.sessionId}] Redis GET failed for key ${key}: ${err.message}`);
      return null;
    }
  }

  async redisSetEx(key, sec, val) {
    if (!this.redisReady) return;
    try {
      await this.redis.setEx(key, sec, val);
    } catch (err) {
      console.warn(`[${this.sessionId}] Redis SETEX failed for key ${key}: ${err.message}`);
    }
  }

  async redisDel(...keys) {
    if (!this.redisReady || !keys.length) return;
    try {
      await this.redis.del(keys);
      console.log(`[${this.sessionId}] Redis deleted keys: ${keys.join(", ")}`);
    } catch (err) {
      console.warn(`[${this.sessionId}] Redis DEL failed for keys ${keys.join(", ")}: ${err.message}`);
    }
  }

  async downloadAndSaveMedia(msg) {
    if (!msg?.message || !this.sock) {
      console.warn(`[${this.sessionId}] Media download skipped: no message or sock`);
      return null;
    }

    const contentType = getContentType(msg.message);
    if (!["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(contentType)) {
      return null;
    }

    try {
      console.log(`[${this.sessionId}] Starting media download | msgId: ${msg.key?.id} | type: ${contentType}`);

      const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger: console });

      const extMap = {
        imageMessage: "jpg",
        videoMessage: "mp4",
        audioMessage: msg.message.audioMessage?.ptt ? "ogg" : "mp3",
        documentMessage: msg.message.documentMessage?.fileName?.split(".").pop() || "bin",
        stickerMessage: "webp",
      };

      const ext = extMap[contentType] || "bin";
      const filename = `${msg.key.id}.${ext}`;
      const mediaDir = path.join(process.cwd(), "public", "media", this.sessionId);
      const fullPath = path.join(mediaDir, filename);
      const publicUrl = `/media/${this.sessionId}/${filename}`;

      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
        console.log(`[${this.sessionId}] Created media directory: ${mediaDir}`);
      }

      fs.writeFileSync(fullPath, buffer);
      console.log(`[${this.sessionId}] Media saved | path: ${fullPath} | url: ${publicUrl}`);

      await this.mysqlQuery(
        `UPDATE messages SET media_path = ? WHERE session_id = ? AND chat_id = ? AND message_id = ?`,
        [publicUrl, this.sessionId, msg.key.remoteJid, msg.key.id]
      );

      return publicUrl;
    } catch (err) {
      console.error(`[${this.sessionId}] Media download failed | msgId: ${msg.key?.id} | ${err.message}`, err);
      return null;
    }
  }

  async _bulkUpsertChats(chats) {
    if (!Array.isArray(chats) || chats.length === 0) return;

    const values = chats.map((chat) => [
      this.sessionId,
      this.username,
      chat.id,
      chat.name || null,
      chat.isGroup ? 1 : 0,
      chat.unreadCount || 0,
      chat.lastMessageTimestamp || null,
      chat.archived ? 1 : 0,
      chat.pinned ? 1 : 0,
      chat.mute || 0,
    ]);

    const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    const sql = `
      INSERT INTO chats (session_id, username, id, name, is_group, unread_count, last_message_timestamp, archived, pinned, muted_until)
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE name=VALUES(name), is_group=VALUES(is_group), unread_count=VALUES(unread_count),
        last_message_timestamp=VALUES(last_message_timestamp), archived=VALUES(archived), pinned=VALUES(pinned),
        muted_until=VALUES(muted_until)
    `;

    try {
      await this.mysqlQuery(sql, values.flat());
      console.log(`[${this.sessionId}] Bulk upserted ${values.length} chats`);
    } catch (err) {
      console.error(`[${this.sessionId}] Bulk chats upsert failed (${values.length} items): ${err.message}`, err);
    }
  }

  async _bulkUpsertGroups(groups) {
    if (!Array.isArray(groups) || groups.length === 0) return;

    const values = groups.map((group) => [
      this.sessionId,
      this.username,
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
      JSON.stringify(group.participants || []),
    ]);

    const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    const sql = `
      INSERT INTO group_metadata (
        session_id, username, id, subject, subject_owner, subject_time, description,
        is_restricted, is_announced, participant_count, creation, owner, participants
      ) VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        subject=VALUES(subject), subject_owner=VALUES(subject_owner), subject_time=VALUES(subject_time),
        description=VALUES(description), is_restricted=VALUES(is_restricted), is_announced=VALUES(is_announced),
        participant_count=VALUES(participant_count), creation=VALUES(creation), owner=VALUES(owner),
        participants=VALUES(participants), updated_at=NOW()
    `;

    try {
      await this.mysqlQuery(sql, values.flat());
      console.log(`[${this.sessionId}] Bulk upserted ${values.length} groups`);
    } catch (err) {
      console.error(`[${this.sessionId}] Bulk groups upsert failed (${values.length} items): ${err.message}`, err);
    }
  }

  async _bulkUpsertContacts(contacts) {
    if (!Array.isArray(contacts) || contacts.length === 0) return;

    const contactIds = contacts.map(c => c?.id).filter(Boolean);
    if (contactIds.length === 0) return;

    const placeholders = contactIds.map(() => '?').join(',');
    let existingRows = [];
    try {
      existingRows = await this.mysqlQuery(
        `SELECT id, lid, phone_number, name, notify, verified_name,
                profile_picture_url, about, business_profile
        FROM contacts 
        WHERE session_id = ? AND id IN (${placeholders})`,
        [this.sessionId, ...contactIds]
      );
    } catch (err) {
      console.warn(`[${this.sessionId}] Failed to fetch existing contacts for diff: ${err.message}`);
    }

    const existingMap = new Map(existingRows.map(row => [row.id, row]));

    const toInsert = [];
    const toUpdate = [];
    const changeLogs = [];

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    for (const contact of contacts) {
      if (!contact?.id) continue;

      let contactId = contact.id;
      let contactLid = contact.lid || null;
      let contactPhone = contact.phoneNumber || null;
      const contactName = contact.name || contact.pushName || null;
      const contactNotify = contact.notify || null;
      let verifiedName = contact.verifiedName || contact.verified_name || null;
      let profilePicUrl = contact.imgUrl || contact.profilePictureUrl || null;
      let about = contact.status || contact.about || null;
      let businessProfile = null;

      const isLidAsId = contactId.endsWith("@lid");

      let resolvedJid = null;
      let resolvedPhone = null;

      if (isLidAsId && this.sock?.signalRepository?.lidMapping) {
        try {
          resolvedPhone = await this.sock.signalRepository.lidMapping.getPNForLID(contactId);
          if (resolvedPhone) {
            resolvedJid = resolvedPhone + "@s.whatsapp.net";
            contactPhone = resolvedPhone;
            console.log(`[${this.sessionId}] LID resolved | ${contactId} → ${resolvedPhone}`);
          }
        } catch (err) {
          console.warn(`[${this.sessionId}] LID resolution failed for ${contactId}: ${err.message}`);
        }
      }

      if (isLidAsId) {
        contactLid = contactId;
        if (resolvedJid) contactId = resolvedJid;
      }

      let derivedPhone = null;
      if (!contactPhone) {
        if (contactId.endsWith("@s.whatsapp.net")) derivedPhone = contactId.split("@")[0];
        else if (contactLid?.endsWith("@s.whatsapp.net")) derivedPhone = contactLid.split("@")[0];
      }
      const finalPhone = contactPhone || derivedPhone || null;

      // Fetch profile picture if missing
      if (!profilePicUrl && this.sock) {
        try {
          profilePicUrl = await this.sock.profilePictureUrl(contactId, "image");
          console.log(`[${this.sessionId}] Fetched profile pic for ${contactId}`);
        } catch (err) {
          if (err?.data !== 404) {
            console.warn(`[${this.sessionId}] Profile pic fetch failed ${contactId}: ${err.message}`);
          }
        }
      }

      // Fetch status/about if missing
      if (!about && this.sock) {
        try {
          const statusRes = await this.sock.fetchStatus(contactId);
          about = statusRes?.status || null;
          if (about) console.log(`[${this.sessionId}] Fetched about for ${contactId}`);
        } catch (err) {
          console.warn(`[${this.sessionId}] Status fetch failed ${contactId}: ${err.message}`);
        }
      }

      // Business profile
      if (contact.isBusiness || contact.businessProfile || this.sock) {
        try {
          const bp = await this.sock.getBusinessProfile(contactId);
          if (bp) {
            businessProfile = JSON.stringify(bp);
            console.log(`[${this.sessionId}] Fetched business profile ${contactId}`);
          }
        } catch (err) {
          console.warn(`[${this.sessionId}] Business profile fetch failed ${contactId}: ${err.message}`);
        }
      }

      // ────────────────────────────────────────────────
      // Prepare final data object for easy comparison
      // ────────────────────────────────────────────────
      const final = {
        id: contactId,
        lid: contactLid,
        phone_number: finalPhone,
        name: contactName,
        notify: contactNotify,
        verified_name: verifiedName,
        profile_picture_url: profilePicUrl,
        about: about,
        business_profile: businessProfile || null,
      };

      const existing = existingMap.get(final.id);

      if (!existing) {
        // ── New contact ──
        toInsert.push([
          this.sessionId,
          this.username,
          final.id,
          final.lid,
          final.phone_number,
          final.name,
          final.notify,
          final.verified_name,
          final.profile_picture_url,
          final.about,
          final.business_profile,
          now
        ]);
        continue;
      }

      // ── Compare fields ───────────────────────────────────────
      const changes = [];

      if (existing.lid !== final.lid)
        changes.push(['lid', existing.lid, final.lid]);

      if (existing.phone_number !== final.phone_number)
        changes.push(['phone_number', existing.phone_number, final.phone_number]);

      if (existing.name !== final.name)
        changes.push(['name', existing.name, final.name]);

      if (existing.notify !== final.notify)
        changes.push(['notify', existing.notify, final.notify]);

      if (existing.verified_name !== final.verified_name)
        changes.push(['verified_name', existing.verified_name, final.verified_name]);

      if (existing.profile_picture_url !== final.profile_picture_url)
        changes.push(['profile_picture_url', existing.profile_picture_url, final.profile_picture_url]);

      if (existing.about !== final.about)
        changes.push(['about', existing.about, final.about]);

      const exBp = existing.business_profile ? JSON.parse(existing.business_profile) : null;
      const newBp = final.business_profile ? JSON.parse(final.business_profile) : null;
      if (JSON.stringify(exBp) !== JSON.stringify(newBp))
        changes.push(['business_profile', existing.business_profile, final.business_profile]);

      // ── Nothing changed? → skip completely ──
      if (changes.length === 0) {
        continue;
      }

      // ── Something changed → prepare update + logs ──
      toUpdate.push([
        this.sessionId,
        this.username,
        final.id,
        final.lid,
        final.phone_number,
        final.name,
        final.notify,
        final.verified_name,
        final.profile_picture_url,
        final.about,
        final.business_profile,
        now,
        final.id   // for WHERE clause in real UPDATE (but we use INSERT ... ON DUPLICATE here)
      ]);

      changes.forEach(([field, oldVal, newVal]) => {
        changeLogs.push([
          this.sessionId,
          this.username,
          final.id,
          field,
          oldVal == null ? null : String(oldVal),
          newVal == null ? null : String(newVal)
        ]);
      });
    }

    // ────────────────────────────────────────────────
    // Execute bulk operations
    // ────────────────────────────────────────────────

    // 1. Insert brand new contacts
    if (toInsert.length > 0) {
      const ph = toInsert.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      await this.mysqlQuery(
        `INSERT INTO contacts (
          session_id, username, id, lid, phone_number, name, notify,
          verified_name, profile_picture_url, about, business_profile, updated_at
        ) VALUES ${ph}`,
        toInsert.flat()
      );
      console.log(`[${this.sessionId}] Inserted ${toInsert.length} new contacts`);
    }

    // 2. Update only contacts that actually changed
    if (toUpdate.length > 0) {
      const ph = toUpdate.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      await this.mysqlQuery(
        `INSERT INTO contacts (
          session_id, username, id, lid, phone_number, name, notify,
          verified_name, profile_picture_url, about, business_profile, updated_at
        ) VALUES ${ph}
        ON DUPLICATE KEY UPDATE
          lid             = VALUES(lid),
          phone_number    = VALUES(phone_number),
          name            = VALUES(name),
          notify          = VALUES(notify),
          verified_name   = VALUES(verified_name),
          profile_picture_url = VALUES(profile_picture_url),
          about           = VALUES(about),
          business_profile = VALUES(business_profile),
          updated_at      = VALUES(updated_at)`,
        toUpdate.flat()
      );
      console.log(`[${this.sessionId}] Updated ${toUpdate.length} contacts (real changes)`);
    }

    // 3. Log only real field changes (bulk)
    if (changeLogs.length > 0) {
      const logPh = changeLogs.map(() => '(?,?,?,?,?,?)').join(',');
      await this.mysqlQuery(
        `INSERT INTO contact_changes 
        (session_id, username, contact_id, changed_field, old_value, new_value)
        VALUES ${logPh}`,
        changeLogs.flat()
      );
      console.log(`[${this.sessionId}] Logged ${changeLogs.length / 6} real contact field changes`);
    }
  }

  bind(ev, sock) {
    this.sock = sock;

    ev.on("chats.set", async ({ chats }) => {
      if (!Array.isArray(chats)) return;
      await this._bulkUpsertChats(chats);
    });

    ev.on("chats.upsert", async (chats) => {
      if (!Array.isArray(chats)) return;
      await this._bulkUpsertChats(chats);
      for (const chat of chats) {
        await this._upsertChatOverview(chat.id, { unread_count: chat.unreadCount || 0 });
      }
    });

    ev.on("chats.update", async (updates) => {
      if (!Array.isArray(updates)) return;
      await this._bulkUpsertChats(updates);
      for (const u of updates) {
        if ("unreadCount" in u) {
          await this._upsertChatOverview(u.id, { unread_count: u.unreadCount });
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

    ev.on("contacts.set", async ({ contacts }) => await this._bulkUpsertContacts(contacts));
    ev.on("contacts.upsert", async (contacts) => await this._bulkUpsertContacts(contacts));
    ev.on("contacts.update", async (updates) => await this._bulkUpsertContacts(updates));

    ev.on('lid-mapping.update', (update) => {
      for (const mapping of update.mapping || []) {
        const lid = mapping.lid;
        const pn = mapping.pn;
        console.log(`[${this.sessionId}] LID mapping update | lid: ${lid} → phone: ${pn}`);
        this.mysqlQuery(
          `UPDATE contacts SET phone_number = ? WHERE session_id = ? AND id = ?`,
          [pn, this.sessionId, lid]
        ).catch(err => console.warn(`[${this.sessionId}] lid-mapping.update DB failed for lid ${lid}: ${err.message}`));
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

      console.log(`[${this.sessionId}] Processing ${messages.length} new messages (type: ${type})`);

      const values = [];
      for (const msg of messages) {
        if (!msg?.key?.id || !msg?.key?.remoteJid) continue;

        try {
          await this._upsertMessage(msg);
        } catch (err) {
          console.warn(`[${this.sessionId}] Message upsert failed | chat: ${msg.key.remoteJid} | msgId: ${msg.key.id} | ${err.message}`);
        }
      }

      if (values.length > 0) {
        const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",");
        await this.mysqlQuery(
          `INSERT INTO messages (session_id, chat_id, message_id, from_me, sender_jid, timestamp, raw_json)
           VALUES ${placeholders}
           ON DUPLICATE KEY UPDATE timestamp=VALUES(timestamp), raw_json=VALUES(raw_json)`,
          values.flat()
        );
      }
    });

    ev.on("messages.update", async (updates) => {
      for (const upd of updates || []) {
        try {
          await this._updateMessage(upd);
        } catch (err) {
          console.warn(`[${this.sessionId}] Message update failed | chat: ${upd.key?.remoteJid} | msgId: ${upd.key?.id} | ${err.message}`);
        }
      }
    });

    ev.on("message-receipt.update", async (updates) => {
      for (const upd of updates || []) {
        try {
          await this._updateReceipt(upd);
        } catch (err) {
          console.warn(`[${this.sessionId}] Receipt update failed | chat: ${upd.key?.remoteJid} | msgId: ${upd.key?.id} | ${err.message}`);
        }
      }
    });

    ev.on("group-participants.update", async (update) => {
      try {
        await this._updateGroupParticipants(update);
      } catch (err) {
        console.warn(`[${this.sessionId}] Group participants update failed | group: ${update.id} | ${err.message}`);
      }
    });

    ev.on("groups.set", async ({ groups }) => {
      if (!Array.isArray(groups)) return;
      await this._bulkUpsertGroups(groups);
    });

    ev.on("groups.upsert", async (groups) => {
      if (!Array.isArray(groups)) return;
      await this._bulkUpsertGroups(groups);
    });

    ev.on("groups.update", async (updates) => {
      if (!Array.isArray(updates)) return;
      await this._bulkUpsertGroups(updates);
    });

    ev.on("group-join", async (update) => {
      try {
        await this._upsertGroupMetadata(update);
      } catch (err) {
        console.warn(`[${this.sessionId}] Group join metadata upsert failed | group: ${update.id} | ${err.message}`);
      }
    });

    ev.on("group-leave", async ({ id }) => {
      try {
        await this.mysqlQuery("DELETE FROM group_metadata WHERE session_id = ? AND id = ?", [this.sessionId, id]);
        console.log(`[${this.sessionId}] Removed group metadata on leave | group: ${id}`);
      } catch (err) {
        console.error(`[${this.sessionId}] Group leave cleanup failed | group: ${id} | ${err.message}`, err);
      }
    });

    ev.on("call", async (calls) => {
      for (const call of calls) {
        try {
          await this._upsertCall(call);
        } catch (err) {
          console.warn(`[${this.sessionId}] Call upsert failed | callId: ${call?.id} | ${err.message}`);
        }
      }
    });

    ev.on("blocklist.set", async ({ blocklist }) => {
      try {
        await this._upsertBlocklist(blocklist);
      } catch (err) {
        console.error(`[${this.sessionId}] Blocklist set failed: ${err.message}`, err);
      }
    });

    ev.on("blocklist.update", async (update) => {
      try {
        await this._updateBlocklist(update);
      } catch (err) {
        console.error(`[${this.sessionId}] Blocklist update failed: ${err.message}`, err);
      }
    });
  }

  async _upsertChat(chat, conn = null) {
    const q = conn ? conn.execute.bind(conn) : this.mysqlQuery.bind(this);
    try {
      await q(
        `INSERT INTO chats (session_id, username, id, name, is_group, unread_count, last_message_timestamp, archived, pinned, muted_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), is_group=VALUES(is_group), unread_count=VALUES(unread_count),
           last_message_timestamp=VALUES(last_message_timestamp), archived=VALUES(archived), pinned=VALUES(pinned),
           muted_until=VALUES(muted_until)`,
        [
          this.sessionId, this.username, chat.id, chat.name || null, chat.isGroup ? 1 : 0,
          chat.unreadCount || 0, chat.lastMessageTimestamp || null,
          chat.archived ? 1 : 0, chat.pinned ? 1 : 0, chat.mute || 0
        ]
      );
    } catch (err) {
      console.error(`[${this.sessionId}] Chat upsert failed | chatId: ${chat.id} | ${err.message}`, err);
    }
  }

  async _upsertMessage(msg, conn = null) {
    if (!msg?.key?.id || !msg?.key?.remoteJid) return;

    const jsonStr = JSON.stringify(msg);
    if (jsonStr.length > 2000000) {
      console.warn(`[${this.sessionId}] Skipping huge message | msgId: ${msg.key.id} | size: ${jsonStr.length}`);
      return;
    }

    // Parse message type, content, caption, status
    let type = 'other';
    let content = null;
    let caption = null;
    let status = msg.status || 'sent';

    const messageContent = msg.message || {};
    const ct = getContentType(messageContent);
    if (ct) type = ct.replace('Message', '').toLowerCase();

    if (messageContent.conversation) {
      content = messageContent.conversation;
    } else if (messageContent.extendedTextMessage?.text) {
      content = messageContent.extendedTextMessage.text;
    } else if (messageContent.imageMessage || messageContent.videoMessage) {
      caption = messageContent.imageMessage?.caption || messageContent.videoMessage?.caption || null;
    } else if (messageContent.documentMessage) {
      content = messageContent.documentMessage.fileName || null;
    } else if (messageContent.locationMessage) {
      content = `Location: ${messageContent.locationMessage.degreesLatitude}, ${messageContent.locationMessage.degreesLongitude}`;
    }

    const q = conn ? conn.execute.bind(conn) : this.mysqlQuery.bind(this);
    try {
      await q(
        `INSERT INTO messages (session_id, username, chat_id, message_id, sender_jid, from_me, type, content, caption, timestamp, status, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE type=VALUES(type), content=VALUES(content), caption=VALUES(caption),
           timestamp=VALUES(timestamp), status=VALUES(status), raw_json=VALUES(raw_json)`,
        [
          this.sessionId,
          this.username,
          msg.key.remoteJid,
          msg.key.id,
          msg.key.participant || msg.key.remoteJid,
          msg.key.fromMe ? 1 : 0,
          type,
          content,
          caption,
          msg.messageTimestamp || Math.floor(Date.now() / 1000),
          status,
          jsonStr
        ]
      );
    } catch (err) {
      console.error(`[${this.sessionId}] Message upsert failed | chat: ${msg.key.remoteJid} | msgId: ${msg.key.id} | ${err.message}`, err);
    }
  }

  async _updateMessage(update) {
    if (!update.key?.id || !update.key?.remoteJid) return;
    if (update.update?.status) {
      try {
        await this.mysqlQuery(
          "UPDATE messages SET status = ?, raw_json = JSON_SET(raw_json, '$.status', ?) WHERE session_id = ? AND chat_id = ? AND message_id = ?",
          [update.update.status, update.update.status, this.sessionId, update.key.remoteJid, update.key.id]
        );
      } catch (err) {
        console.error(`[${this.sessionId}] Message status update failed | msgId: ${update.key.id} | ${err.message}`, err);
      }
    }
  }

  async _updateReceipt({ key, receipt }) {
    if (!key?.id || !key?.remoteJid) return;
    try {
      await this.mysqlQuery(
        "UPDATE messages SET raw_json = JSON_SET(raw_json, '$.userReceipt', ?) WHERE session_id = ? AND chat_id = ? AND message_id = ?",
        [JSON.stringify(receipt), this.sessionId, key.remoteJid, key.id]
      );
    } catch (err) {
      console.error(`[${this.sessionId}] Receipt update failed | msgId: ${key.id} | ${err.message}`, err);
    }
  }

  async _updateGroupParticipants({ id, participants, action }) {
    if (!id || !Array.isArray(participants)) return;
    try {
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
      console.log(`[${this.sessionId}] Updated group participants | group: ${id} | action: ${action} | new count: ${list.length}`);
    } catch (err) {
      console.error(`[${this.sessionId}] Group participants update failed | group: ${id} | ${err.message}`, err);
    }
  }

  async _upsertGroupMetadata(group, conn = null) {
    if (!group?.id) return;

    const q = conn ? conn.execute.bind(conn) : this.mysqlQuery.bind(this);

    try {
      await q(
        `INSERT INTO group_metadata (
          session_id, username, id, subject, subject_owner, subject_time, description,
          is_restricted, is_announced, participant_count, creation, owner, participants
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          this.username,
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
    } catch (err) {
      console.error(`[${this.sessionId}] Group metadata upsert failed | group: ${group.id} | ${err.message}`, err);
    }
  }

  async _upsertChatOverview(chatId, updates = {}) {
    const fields = [];
    const values = [this.sessionId, this.username, chatId];
    const updateClauses = [];

    if ('last_message_preview' in updates) {
      fields.push("last_message_preview");
      values.push(updates.last_message_preview ? JSON.stringify(updates.last_message_preview) : null);
      updateClauses.push("last_message_preview = VALUES(last_message_preview)");
    }

    if ('unread_count' in updates) {
      fields.push("unread_count");
      values.push(updates.unread_count);
      updateClauses.push("unread_count = VALUES(unread_count)");
    }

    if (fields.length === 0) return;

    const insertFields = fields.length ? `, ${fields.join(', ')}` : '';
    const insertPlaceholders = fields.length ? `, ${fields.map(() => '?').join(', ')}` : '';

    const sql = `
      INSERT INTO chats_overview (session_id, username, chat_id${insertFields})
      VALUES (?, ?, ?${insertPlaceholders})
      ON DUPLICATE KEY UPDATE ${updateClauses.join(', ')}
    `;

    try {
      await this.mysqlQuery(sql, values);
      console.log(`[${this.sessionId}] Upserted chat overview | chatId: ${chatId} | fields: ${fields.join(', ') || 'none'}`);
    } catch (err) {
      console.error(`[${this.sessionId}] Failed to upsert chat overview | chatId: ${chatId} | ${err.message}`, err);
    }
  }

  async _upsertCall(call) {
    if (!call?.id || !call?.from) {
      console.warn(`[${this.sessionId}] Call upsert skipped: missing id or from`);
      return;
    }

    const status = call.status ? String(call.status).trim() || 'unknown' : 'unknown';

    try {
      await this.mysqlQuery(
        `INSERT INTO call_logs (session_id, username, call_id, caller_jid, is_group, is_video, status, timestamp, duration_seconds)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), duration_seconds = VALUES(duration_seconds)`,
        [
          this.sessionId,
          this.username,
          call.id,
          call.from,
          call.isGroup ? 1 : 0,
          call.isVideo ? 1 : 0,
          status,
          call.timestamp || Math.floor(Date.now() / 1000),
          call.duration || null
        ]
      );
      console.log(`[${this.sessionId}] Upserted call | callId: ${call.id} | from: ${call.from} | status: ${status}`);
    } catch (err) {
      console.error(`[${this.sessionId}] Call upsert failed | callId: ${call.id} | ${err.message}`, err);
    }
  }

  async _upsertBlocklist(blocklist) {
    if (!Array.isArray(blocklist)) {
      console.warn(`[${this.sessionId}] Blocklist upsert skipped: invalid format`);
      return;
    }

    const normalized = blocklist
      .filter(jid => typeof jid === "string" && jid.includes("@"))
      .map(jid => jid.trim());

    if (!normalized.length) return;

    try {
      await this.mysqlQuery(
        `INSERT INTO device_blocklist (session_id, username, blocked_jids)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE blocked_jids = VALUES(blocked_jids), last_updated = NOW()`,
        [this.sessionId, this.username, JSON.stringify(normalized)]
      );

      if (this.useRedis) {
        await this.redisSetEx(`blocklist:${this.sessionId}`, 3600, JSON.stringify(normalized));
      }

      console.log(`[${this.sessionId}] Upserted blocklist | count: ${normalized.length}`);
    } catch (err) {
      console.error(`[${this.sessionId}] Blocklist upsert failed | count: ${normalized.length} | ${err.message}`, err);
    }
  }

  async _updateBlocklist({ blocklist, type }) {
    if (!Array.isArray(blocklist) || !["add", "remove"].includes(type)) {
      console.warn(`[${this.sessionId}] Blocklist update skipped: invalid blocklist or type (${type})`);
      return;
    }

    const normalized = blocklist
      .filter(jid => typeof jid === "string" && jid.includes("@"))
      .map(jid => jid.trim());

    if (!normalized.length) return;

    try {
      const rows = await this.mysqlQuery(
        "SELECT blocked_jids FROM device_blocklist WHERE session_id = ? LIMIT 1",
        [this.sessionId]
      );

      let current = [];
      if (rows.length) {
        try { current = JSON.parse(rows[0].blocked_jids || "[]"); } catch {}
      }

      let updated;
      if (type === "add") {
        updated = [...new Set([...current, ...normalized])];
      } else {
        updated = current.filter(jid => !normalized.includes(jid));
      }

      if (updated.length === current.length && type === "add") return;

      await this.mysqlQuery(
        `INSERT INTO device_blocklist (session_id, username, blocked_jids)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE blocked_jids = VALUES(blocked_jids), last_updated = NOW()`,
        [this.sessionId, this.username, JSON.stringify(updated)]
      );

      if (this.useRedis) {
        await this.redisSetEx(`blocklist:${this.sessionId}`, 3600, JSON.stringify(updated));
      }

      console.log(`[${this.sessionId}] Updated blocklist | type: ${type} | new count: ${updated.length}`);
    } catch (err) {
      console.error(`[${this.sessionId}] Blocklist update failed | type: ${type} | ${err.message}`, err);
    }
  }

  async getBlocklist() {
    if (this.useRedis) {
      const cached = await this.redisGet(`blocklist:${this.sessionId}`);
      if (cached) {
        console.log(`[${this.sessionId}] Blocklist retrieved from Redis cache`);
        return JSON.parse(cached);
      }
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
    const tables = ["chats", "chats_overview", "contacts", "messages", "group_metadata", "users", "message_reactions", "polls"];
    const counts = await Promise.all(tables.map(async t => {
      const rows = await this.mysqlQuery(
        `SELECT COUNT(*) as cnt FROM ${t} ${t !== "users" ? "WHERE session_id = ?" : ""}`,
        t !== "users" ? [sessionId] : []
      );
      return [t, rows[0]?.cnt ?? 0];
    }));
    return Object.fromEntries(counts);
  }

  async delete(sessionId) {
    const session_id = (sessionId || '').trim();
    
    if (!session_id) {
      throw new Error("Session ID is required for deletion");
    }

    console.log(`[${this.sessionId}] Starting deletion of session: ${session_id}`);

    return this.mysqlTransaction(async (conn) => {
      try {
        // ────────────────────────────────────────────────
        // List of ALL tables that store session-specific data
        // Update this list if you add new session-related tables later
        // ────────────────────────────────────────────────
        const sessionSpecificTables = [
          'call_logs',
          'chats_overview',
          'chats',
          'contacts',
          'contact_changes',
          'message_reactions',
          'polls',
          'device_blocklist',
          'group_metadata',
          'messages',
          // ── Add future session-scoped tables here ──
          // 'chat_labels',
          // 'status_updates',
          // 'broadcast_lists',
          // etc.
        ];

        // Prepare and execute DELETE statements
        let totalDeletedRows = 0;

        for (const table of sessionSpecificTables) {
          const [result] = await conn.execute(
            `DELETE FROM ${table} WHERE session_id = ?`,
            [session_id]
          );
          
          const affected = result?.affectedRows || 0;
          totalDeletedRows += affected;
          
          if (affected > 0) {
            console.log(`[${this.sessionId}] Deleted ${affected} rows from ${table}`);
          }
        }

        // ────────────────────────────────────────────────
        // Redis cleanup – more robust with pattern matching
        // ────────────────────────────────────────────────
        if (this.useRedis && this.redisReady) {
          try {
            const patternsToClean = [
              `blocklist:${session_id}`,
              `chat:overview:${session_id}:*`,
              `chat:messages:recent:${session_id}:*`,
              `session:${session_id}:*`,           // general session prefix if used
              `presence:${session_id}:*`,
              `typing:${session_id}:*`,
              // Add any other prefixes you use in Redis
            ];

            let totalRedisDeleted = 0;

            for (const pattern of patternsToClean) {
              const keys = await this.redis.keys(pattern);
              
              if (keys.length > 0) {
                await this.redis.del(keys);
                totalRedisDeleted += keys.length;
                console.log(`[${this.sessionId}] Deleted ${keys.length} Redis keys matching: ${pattern}`);
              }
            }

            if (totalRedisDeleted > 0) {
              console.log(`[${this.sessionId}] Total Redis keys deleted: ${totalRedisDeleted}`);
            }
          } catch (redisErr) {
            console.warn(`[${this.sessionId}] Redis cleanup failed (non-fatal): ${redisErr.message}`);
            // Continue – Redis failure should not prevent DB deletion
          }
        }

        return {
          success: true,
          deletedSessionId: session_id,
          username: this.username || 'global',
          tablesCleared: sessionSpecificTables.length,
          totalRowsDeleted: totalDeletedRows,
          message: `Session ${session_id} fully deleted (${totalDeletedRows} rows across ${sessionSpecificTables.length} tables)`
        };

      } catch (err) {
        console.error(`[${this.sessionId}] Session deletion failed for ${session_id}:`, err);
        throw err; // transaction will rollback automatically
      }
    });
  }
}

module.exports = DatabaseStore;