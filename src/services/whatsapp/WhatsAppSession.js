const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  getContentType
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');

const MessageFormatter = require('./MessageFormatter');
const wsManager = require('../websocket/WebSocketManager');
const DatabaseStore = require('../../stores/DatabaseStore');

class WhatsAppSession {
  constructor(sessionId, options = {}) {
    this.sessionId = sessionId;
    this.socket = null;
    this.qrCode = null;
    this.connectionStatus = 'disconnected';
    this.authFolder = path.join(process.cwd(), 'sessions', sessionId);
    this.configFile = path.join(this.authFolder, 'config.json');
    this.mediaFolder = path.join(process.cwd(), 'public', 'media', sessionId);
    this.phoneNumber = null;
    this.name = null;

    this.metadata = options.metadata || {};
    this.webhooks = options.webhooks || [];
    this.owner = options.owner || '';

    this.db = new DatabaseStore(this.sessionId);

    this._loadConfig();
  }

  _loadConfig() {
    try {
      if (fs.existsSync(this.configFile)) {
        const config = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
        this.metadata = config.metadata || this.metadata;
        this.webhooks = config.webhooks || this.webhooks;
        this.owner = config.owner || this.owner;
      }
    } catch (e) {
      console.log(`⚠️ [${this.sessionId}] Could not load config:`, e.message);
    }
  }

  _saveConfig() {
    try {
      if (!fs.existsSync(this.authFolder)) {
        fs.mkdirSync(this.authFolder, { recursive: true });
      }
      fs.writeFileSync(this.configFile, JSON.stringify({
        metadata: this.metadata,
        webhooks: this.webhooks,
        owner: this.owner
      }, null, 2));
    } catch (e) {
      console.log(`⚠️ [${this.sessionId}] Could not save config:`, e.message);
    }
  }

  updateConfig(options = {}) {
    if (options.metadata !== undefined) {
      this.metadata = { ...this.metadata, ...options.metadata };
    }
    if (options.webhooks !== undefined) {
      this.webhooks = options.webhooks;
    }
    if (options.owner !== undefined) {
      this.owner = options.owner;
    }
    this._saveConfig();
    return this.getInfo();
  }

  addWebhook(url, events = ['all']) {
    const exists = this.webhooks.find(w => w.url === url);
    if (exists) {
      exists.events = events;
    } else {
      this.webhooks.push({ url, events });
    }
    this._saveConfig();
    return this.getInfo();
  }

  removeWebhook(url) {
    this.webhooks = this.webhooks.filter(w => w.url !== url);
    this._saveConfig();
    return this.getInfo();
  }

  async _sendWebhook(event, data) {
    if (!this.webhooks || this.webhooks.length === 0) return;

    const payload = {
      event,
      sessionId: this.sessionId,
      metadata: this.metadata,
      data,
      timestamp: new Date().toISOString()
    };

    const promises = this.webhooks.map(async (webhook) => {
      const events = webhook.events || ['all'];
      if (!events.includes('all') && !events.includes(event)) {
        return;
      }

      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Source': 'chatery-whatsapp-api',
            'X-Session-Id': this.sessionId,
            'X-Webhook-Event': event
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          console.log(`⚠️ [${this.sessionId}] Webhook to ${webhook.url} failed: ${response.status}`);
        }
      } catch (error) {
        console.log(`⚠️ [${this.sessionId}] Webhook to ${webhook.url} error:`, error.message);
      }
    });

    Promise.all(promises).catch(() => {});
  }

  async connect() {
    try {
      if (!fs.existsSync(this.authFolder)) {
        fs.mkdirSync(this.authFolder, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      const { version } = await fetchLatestBaileysVersion();

      this.socket = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Chatery API', 'Chrome', '1.0.0'],
        syncFullHistory: true
      });
      this.db.bind(this.socket.ev);
      this._setupEventListeners(saveCreds);
      return { success: true, message: 'Initializing connection...' };
    } catch (error) {
      console.error(`[${this.sessionId}] Error connecting:`, error);
      this.connectionStatus = 'error';
      return { success: false, message: error.message };
    }
  }

  _setupEventListeners(saveCreds) {
    
    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrCode = await qrcode.toDataURL(qr);
        this.connectionStatus = 'qr_ready';
        console.log(`📱 [${this.sessionId}] QR Code generated! Scan and Connect`);

        wsManager.emitQRCode(this.sessionId, this.qrCode);
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        console.log(`❌ [${this.sessionId}] Connection closed:`, lastDisconnect?.error?.message);
        this.connectionStatus = 'disconnected';
        this.qrCode = null;

        wsManager.emitConnectionStatus(this.sessionId, 'disconnected', {
          reason: lastDisconnect?.error?.message,
          shouldReconnect
        });

        this._sendWebhook('connection.update', {
          status: 'disconnected',
          reason: lastDisconnect?.error?.message,
          shouldReconnect
        });

        if (shouldReconnect) {
          console.log(`🔄 [${this.sessionId}] Reconnecting...`);
          setTimeout(() => this.connect(), 5000);
        } else {
          console.log(`🚪 [${this.sessionId}] Logged out.`);
          wsManager.emitLoggedOut(this.sessionId);
          this.deleteAuthFolder();
        }
      } else if (connection === 'open') {
        console.log(`✅ [${this.sessionId}] WhatsApp Connected Successfully!`);
        this.connectionStatus = 'connected';
        this.qrCode = null;

        if (this.socket.user) {
          this.phoneNumber = this.socket.user.id.split(':')[0];
          this.name = this.socket.user.name || 'Unknown';
          console.log(`👤 [${this.sessionId}] Connected as: ${this.name} (${this.phoneNumber})`);
        }
        
        wsManager.emitConnectionStatus(this.sessionId, 'connected', {
          phoneNumber: this.phoneNumber,
          name: this.name
        });

        this._sendWebhook('connection.update', {
          status: 'connected',
          phoneNumber: this.phoneNumber,
          name: this.name
        });
      } else if (connection === 'connecting') {
        console.log(`🔄 [${this.sessionId}] Connecting to WhatsApp...`);
        this.connectionStatus = 'connecting';

        wsManager.emitConnectionStatus(this.sessionId, 'connecting');
      }
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return; // only user messages

      for (const msg of messages) {
          if (!msg.message) continue;

          const formatted = MessageFormatter.formatMessage(msg);
          if (!formatted) continue;

          // 1. Immediate real-time push
          wsManager.emitMessage(this.sessionId, formatted);

          // 2. Webhook (if configured for message events)
          this._sendWebhook('message', formatted);
      }
    });

    this.socket.ev.on('messages.update', (updates) => {
      try {
        if (!updates || !Array.isArray(updates)) return;
        wsManager.emitMessageStatus(this.sessionId, updates);
      } catch (error) {
        console.error(`[${this.sessionId}] messages.update error:`, error.message);
      }
    });

    this.socket.ev.on('chats.upsert', (chats) => {
      try {
        if (!chats || !Array.isArray(chats)) return;
        console.log(`💬 [${this.sessionId}] Chats upsert: ${chats.length} chats`);
        wsManager.emitChatsUpsert(this.sessionId, chats);
      } catch (error) {
        console.error(`[${this.sessionId}] chats.upsert error:`, error.message);
      }
    });

    this.socket.ev.on('chats.update', (chats) => {
      try {
        if (!chats || !Array.isArray(chats)) return;
        wsManager.emitChatUpdate(this.sessionId, chats);
      } catch (error) {
        console.error(`[${this.sessionId}] chats.update error:`, error.message);
      }
    });

    this.socket.ev.on('chats.delete', (chatIds) => {
      try {
        if (!chatIds) return;
        wsManager.emitChatDelete(this.sessionId, chatIds);
      } catch (error) {
        console.error(`[${this.sessionId}] chats.delete error:`, error.message);
      }
    });

    this.socket.ev.on('contacts.upsert', (contacts) => {
      try {
        if (!contacts || !Array.isArray(contacts)) return;
        console.log(`👥 [${this.sessionId}] Contacts upsert: ${contacts.length} contacts`);
        wsManager.emitContactUpdate(this.sessionId, contacts);
      } catch (error) {
        console.error(`[${this.sessionId}] contacts.upsert error:`, error.message);
      }
    });

    this.socket.ev.on('contacts.update', (contacts) => {
      try {
        if (!contacts || !Array.isArray(contacts)) return;
        wsManager.emitContactUpdate(this.sessionId, contacts);
      } catch (error) {
        console.error(`[${this.sessionId}] contacts.update error:`, error.message);
      }
    });

    this.socket.ev.on('presence.update', (presence) => {
      try {
        if (!presence) return;
        wsManager.emitPresence(this.sessionId, presence);
      } catch (error) {
        console.error(`[${this.sessionId}] presence.update error:`, error.message);
      }
    });

    this.socket.ev.on('group-participants.update', (update) => {
      try {
        if (!update) return;
        wsManager.emitGroupParticipants(this.sessionId, update);
      } catch (error) {
        console.error(`[${this.sessionId}] group-participants.update error:`, error.message);
      }
    });

    this.socket.ev.on('groups.update', (updates) => {
      try {
        if (!updates) return;
        wsManager.emitGroupUpdate(this.sessionId, updates);
      } catch (error) {
        console.error(`[${this.sessionId}] groups.update error:`, error.message);
      }
    });

    this.socket.ev.on('call', (calls) => {
      try {
        if (!calls) return;
        wsManager.emitCall(this.sessionId, calls);
      } catch (error) {
        console.error(`[${this.sessionId}] call error:`, error.message);
      }
    });
  }

  getInfo() {
    return {
      sessionId: this.sessionId,
      status: this.connectionStatus,
      isConnected: this.connectionStatus === 'connected',
      phoneNumber: this.phoneNumber,
      name: this.name,
      qrCode: this.qrCode,
      metadata: this.metadata,
      webhooks: this.webhooks,
      owner: this.owner
    };
  }

  async logout() {
    try {
      if (this.socket) {
        await this.socket.logout();
        this.socket = null;
      }

      this.deleteMediaFolder();
      this.deleteAuthFolder();

      this.connectionStatus = 'disconnected';
      this.qrCode = null;
      this.phoneNumber = null;
      this.name = null;

      return { success: true, message: 'Logged out successfully' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  deleteAuthFolder() {
    try {
      if (fs.existsSync(this.authFolder)) {
        fs.rmSync(this.authFolder, { recursive: true, force: true });
        console.log(`🗑️ [${this.sessionId}] Auth folder deleted`);
      }
    } catch (error) {
      console.error(`[${this.sessionId}] Error deleting auth folder:`, error);
    }
  }

  deleteMediaFolder() {
    try {
      if (fs.existsSync(this.mediaFolder)) {
        fs.rmSync(this.mediaFolder, { recursive: true, force: true });
        console.log(`🗑️ [${this.sessionId}] Media folder deleted`);
      }
    } catch (error) {
      console.error(`[${this.sessionId}] Error deleting media folder:`, error);
    }
  }

  getSocket() {
    return this.socket;
  }

  formatPhoneNumber(phone) {
    let formatted = phone.replace(/\D/g, '');
    if (formatted.startsWith('0')) {
      formatted = '62' + formatted.slice(1);
    }
    if (!formatted.includes('@')) {
      formatted = formatted + '@s.whatsapp.net';
    }
    return formatted;
  }

  formatJid(id, isGroup = false) {
    if (id.includes('@')) return id;

    let formatted = id.replace(/\D/g, '');
    if (formatted.startsWith('0')) {
      formatted = '62' + formatted.slice(1);
    }

    return isGroup ? `${formatted}@g.us` : `${formatted}@s.whatsapp.net`;
  }

  formatChatId(chatId) {
    if (chatId.includes('@')) return chatId;

    let formatted = chatId.replace(/\D/g, '');
    if (formatted.startsWith('0')) {
      formatted = '62' + formatted.slice(1);
    }
    return `${formatted}@s.whatsapp.net`;
  }

  isGroupId(chatId) {
    return chatId.includes('@g.us');
  }

  async sendPresenceUpdate(chatId, presence = 'composing') {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      const jid = this.formatChatId(chatId);
      await this.socket.sendPresenceUpdate(presence, jid);

      return { success: true, message: `Presence '${presence}' sent` };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async _simulateTyping(jid, typingTime = 0) {
    if (typingTime > 0) {
      await this.socket.sendPresenceUpdate('composing', jid);
      await new Promise(resolve => setTimeout(resolve, typingTime));
      await this.socket.sendPresenceUpdate('paused', jid);
    }
  }

  async sendMessage(chatId, text = '', options = {}) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }

      const jid = this.formatChatId(chatId);

      const {
        attachment = null,      // can be any file, if vcf set contact, if object and have options and selectable, it is poll, if name, phone, it is vcf
        latitude,
        longitude,
        typingTime = 0,
        replyTo = null,
        ptt = false
      } = options;

      if (typingTime > 0) {
        let presence = 'composing';
        if (attachment && ptt && attachment.toLowerCase().match(/\.(ogg|opus)$/)) {
          presence = 'recording';
        }
        await this.socket.sendPresenceUpdate(presence, jid);
        await new Promise(r => setTimeout(r, typingTime));
        await this.socket.sendPresenceUpdate('paused', jid);
      }

      let quoted;
      if (replyTo) {
        quoted = {
          key: { remoteJid: jid, id: replyTo, fromMe: false },
          message: { conversation: '' }
        };
      }
      const messageOptions = quoted ? { quoted } : {};

      // Build content + detect type
      let content = {};
      let type = 'text';

      if (attachment && typeof attachment === 'string') {
        const url = attachment.toLowerCase();
        const ext = (url.split('.').pop() || '').split('?')[0].toLowerCase();

        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
          type = 'image';
          content = { image: { url: attachment }, caption: text || undefined };
        }
        else if (['mp4', '3gp'].includes(ext)) {
          type = 'video';
          content = { video: { url: attachment }, caption: text || undefined };
        }
        else if (['ogg', 'opus'].includes(ext)) {
          type = 'audio';
          content = {
            audio: { url: attachment },
            ptt,
            mimetype: mimetype || 'audio/ogg; codecs=opus'
          };
        }
        else if (ext === 'vcf' || ext === 'vcard') {
          type = 'contact';
          content = {
            contacts: {
              displayName: text || 'Contact',
              contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${text || 'Contact'}\nTEL;waid=${text}:${text}\nEND:VCARD` }]
            }
          };
        }
        else {
          type = 'document';
          content = {
            document: { url: attachment },
            fileName: filename || `file.${ext || 'bin'}`,
            mimetype: mimetype || 'application/octet-stream',
            caption: text || undefined
          };
        }
      }
      else if (latitude && longitude) {
        type = 'location';
        content = { location: { degreesLatitude: latitude, degreesLongitude: longitude, text } };
      }
      else if (contact) {
        type = 'contact';
        let vcard;
        if (contact.vcard) {
          vcard = contact.vcard;
        } else {
          vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.name || text || 'Contact'}\nTEL;waid=${contact.phone}:${contact.phone}\nEND:VCARD`;
        }
        content = {
          contacts: {
            displayName: text || contact.name || 'Contact',
            contacts: [{ vcard }]
          }
        };
      }
      else if (poll && (poll.options || poll.values)) {
        type = 'poll';
        content = {
          poll: {
            name: text || 'Poll Question',
            values: poll.options || poll.values,
            selectableCount: poll.selectableCount || 1
          }
        };
      }
      else {
        // Plain text
        if (!text) {
          return { success: false, message: 'Provide text, attachment, location, contact or poll' };
        }
        content = { text };
      }

      // Send
      const result = await this.socket.sendMessage(jid, content, messageOptions);

      const sent = {
        messageId: result.key.id,
        chatId: jid,
        timestamp: new Date().toISOString(),
        fromMe: true,
        type,
        text: text || undefined,
        attachment: attachment || undefined
      };

      wsManager.emitMessageSent(this.sessionId, sent);
      this._sendWebhook('message.sent', sent);

      return {
        success: true,
        message: `${type.charAt(0).toUpperCase() + type.slice(1)} sent`,
        data: sent
      };
    } catch (error) {
      console.error(`[${this.sessionId}] sendMessage error:`, error.message);
      return { success: false, message: error.message || 'Failed to send' };
    }
  }  

  async isRegistered(phone) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      const jid = this.formatPhoneNumber(phone);
      const [result] = await this.socket.onWhatsApp(jid.replace('@s.whatsapp.net', ''));

      return {
        success: true,
        data: {
          phone: phone,
          isRegistered: !!result?.exists,
          jid: result?.jid || null
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getProfilePicture(phone) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      const jid = this.formatPhoneNumber(phone);
      const ppUrl = await this.socket.profilePictureUrl(jid, 'image');

      return {
        success: true,
        data: {
          phone: phone,
          profilePicture: ppUrl
        }
      };
    } catch (error) {
      return {
        success: true,
        data: {
          phone: phone,
          profilePicture: null
        }
      };
    }
  }

async getChatsOverview(limit = 50, offset = 0, type = 'all') {
  try {
    if (!this.db) return { success: false, message: 'Database not initialized' };

    let query = `SELECT co.chat_id, c.name, c.is_group, co.last_message_preview, co.unread_count, c.last_message_timestamp, c.archived, c.pinned, c.muted_until FROM chats_overview co LEFT JOIN chats c ON c.session_id = co.session_id AND c.id = co.chat_id WHERE co.session_id = ?`;

    const params = [this.sessionId];

    if (type === 'unread') query += ` AND co.unread_count > 0`;
    else if (type === 'archived') query += ` AND c.archived = 1`;
    else if (type === 'pinned') query += ` AND c.pinned = 1`;

    query += ` ORDER BY c.pinned DESC, c.last_message_timestamp DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    

    const rows = await this.db.mysqlQuery(query, params);
    console.log(query, params,rows);
    return {
      success: true,
      message: 'Chats overview retrieved',
      data: {
        total: rows.length,
        limit,
        offset,
        chats: rows.map(row => ({
          chatId: row.chat_id,
          name: row.name || null,
          isGroup: !!row.is_group,
          lastMessagePreview: row.last_message_preview ? JSON.parse(row.last_message_preview) : null,
          unreadCount: row.unread_count || 0,
          lastMessageTimestamp: row.last_message_timestamp,
          archived: !!row.archived,
          pinned: !!row.pinned,
          mutedUntil: row.muted_until || 0
        }))
      }
    };
  } catch (error) {
    this.logger.error({ error: error.message }, 'Failed to get chats overview');
    return { success: false, message: error.message };
  }
}

  async getContact(identifier) {
    if (!this.socket || this.connectionStatus !== 'connected') {
      console.warn(`[${this.sessionId}] getContact: session not connected`);
      return null;
    }

    if (!identifier || typeof identifier !== 'string') {
      console.warn(`[${this.sessionId}] getContact: invalid identifier`);
      return null;
    }

    let jid = identifier.trim();

    // 1. Normalize to proper JID
    if (/^\+?\d{8,15}$/.test(jid)) {
      jid = jid.replace(/^\+/, '') + '@s.whatsapp.net';
    } else if (jid.endsWith('@c.us')) {
      jid = jid.replace('@c.us', '@s.whatsapp.net');
    } else if (!jid.includes('@') && (jid.includes('-') || jid.length > 15)) {
      jid += '@s.whatsapp.net';
    }

    if (!jid.endsWith('@s.whatsapp.net')) {
      console.warn(`[${this.sessionId}] getContact: invalid JID after normalization: ${jid}`);
      return null;
    }

    // Base result structure
    const result = {
      jid,
      phone: jid.split('@')[0],
      foundInStore: false,
      isGroup: false,
      isBusiness: false,
      isMe: jid === this.socket?.user?.id,
      timestamp: new Date().toISOString(),
      timestampFetched: new Date().toISOString(),
      error: null,
      partial: false
    };

    try {
      // ────────────────────────────────────────────────
      // A. From store.contacts (primary source)
      // ────────────────────────────────────────────────
      const storeContact = this.socket.store?.contacts?.[jid];
      if (storeContact) {
        result.foundInStore = true;
        result.name         = storeContact.name || storeContact.verifiedName || storeContact.notify || null;
        result.pushName     = storeContact.notify || null;
        result.shortName    = storeContact.short || null;
        result.verifiedName = storeContact.verifiedName || null;
        result.isBusiness   = !!storeContact.business;

        if (storeContact.business) {
          result.business = {
            businessId: storeContact.business.businessId || null,
            website: storeContact.business.website || null,
            address: storeContact.business.businessAddress || null,
            category: storeContact.business.businessCategory || null,
            about: storeContact.business.businessDescription || null
          };
        }
      }

      // ────────────────────────────────────────────────
      // B. Profile pictures (high + preview)
      // ────────────────────────────────────────────────
      try {
        result.profilePictureUrl = await this.socket.profilePictureUrl(jid, 'image').catch(() => null);
        result.profileThumbnailUrl = await this.socket.profilePictureUrl(jid, 'preview').catch(() => null);
      } catch {}

      // ────────────────────────────────────────────────
      // C. About / status
      // ────────────────────────────────────────────────
      try {
        const status = await this.socket.fetchStatus(jid).catch(() => null);
        if (status) {
          result.about = status.status || null;
          result.aboutSetAt = status.setAt ? new Date(status.setAt * 1000).toISOString() : null;
        }
      } catch {}

      // ────────────────────────────────────────────────
      // D. Presence / last seen / online
      // ────────────────────────────────────────────────
      const presence = this.socket.presences?.[jid];
      if (presence) {
        result.presence = {
          lastSeen: presence.lastSeen ? new Date(presence.lastSeen * 1000).toISOString() : null,
          online: !!presence.online,
          lastKnownPresence: presence.lastKnownPresence || null
        };
      }

      // ────────────────────────────────────────────────
      // E. Business profile (extra info if business account)
      // ────────────────────────────────────────────────
      if (result.isBusiness) {
        try {
          const profile = await this.socket.getBusinessProfile(jid).catch(() => null);
          if (profile) {
            result.business = result.business || {};
            result.business.catalogId = profile.catalogId || null;
            result.business.website = profile.website || result.business.website;
            result.business.email = profile.email || null;
            result.business.address = profile.businessAddress || result.business.address;
            result.business.category = profile.businessCategory || result.business.category;
            result.business.productsCount = profile.productCount || 0;
          }
        } catch {}
      }

      // ────────────────────────────────────────────────
      // F. Groups this contact participates in
      // ────────────────────────────────────────────────
      try {
        const groups = await this.socket.groupFetchAllParticipating().catch(() => ({}));
        const participating = [];

        for (const group of Object.values(groups)) {
          const participant = group.participants?.find(p => p.id === jid);
          if (participant) {
            participating.push({
              groupId: group.id,
              subject: group.subject || null,
              role: participant.admin
                ? (participant.admin === 'superadmin' ? 'superadmin' : 'admin')
                : 'member',
              addedAt: participant.addedAt ? new Date(participant.addedAt * 1000).toISOString() : null
            });
          }
        }

        if (participating.length > 0) {
          result.groups = participating;
        }
      } catch {}

      // ────────────────────────────────────────────────
      // Done — return full object
      // ────────────────────────────────────────────────
      return result;

    } catch (err) {
      console.error(`[${this.sessionId}] getContact failed for ${jid}:`, err.message);
      result.error = err.message;
      result.partial = true;
      return result;
    }
  }
  
  async getContactInfo(phone) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      const jid = this.formatPhoneNumber(phone);

      let profilePicture = null;
      try {
        profilePicture = await this.socket.profilePictureUrl(jid, 'image');
      } catch (e) {}

      let status = null;
      try {
        const statusResult = await this.socket.fetchStatus(jid);
        status = statusResult?.status || null;
      } catch (e) {}

      let isRegistered = false;
      try {
        const [result] = await this.socket.onWhatsApp(jid.replace('@s.whatsapp.net', ''));
        isRegistered = !!result?.exists;
      } catch (e) {}

      return {
        success: true,
        data: {
          phone: phone,
          jid: jid,
          isRegistered: isRegistered,
          profilePicture: profilePicture,
          status: status
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getChats() {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      const chats = await this.socket.groupFetchAllParticipating();
      const groups = Object.values(chats).map(group => ({
        id: group.id,
        name: group.subject,
        isGroup: true,
        owner: group.owner,
        creation: group.creation,
        participantsCount: group.participants?.length || 0,
        desc: group.desc || null
      }));
      return {
        success: true,
        data: {
          groups: groups,
          totalGroups: groups.length
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getGroupMetadata(groupId) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      const jid = this.formatJid(groupId, true);
      const metadata = await this.socket.groupMetadata(jid);
      return {
        success: true,
        data: {
          id: metadata.id,
          name: metadata.subject,
          owner: metadata.owner,
          creation: metadata.creation,
          desc: metadata.desc || null,
          descId: metadata.descId || null,
          participants: metadata.participants.map(p => ({
            id: p.id,
            phone: p.id.split('@')[0],
            admin: p.admin || null
          })),
          participantsCount: metadata.participants.length
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getChatMessages(chatId, limit = 50, cursor = null) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      const jid = this.formatChatId(chatId);
      const isGroup = this.isGroupId(jid);

      const messages = await this.db.getMessages?.(jid, limit, cursor) || [];

      const formattedMessages = messages
        .filter(msg => msg && msg.key)
        .map(msg => MessageFormatter.formatMessage(msg))
        .filter(msg => msg !== null);

      return {
        success: true,
        data: {
          chatId: jid,
          isGroup: isGroup,
          total: formattedMessages.length,
          limit: limit,
          cursor: formattedMessages.length > 0
            ? formattedMessages[formattedMessages.length - 1].id
            : null,
          hasMore: formattedMessages.length === limit,
          messages: formattedMessages
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getChatInfo(chatId) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      const jid = this.formatChatId(chatId);
      const isGroup = this.isGroupId(jid);

      let profilePicture = null;
      try {
        profilePicture = await this.socket.profilePictureUrl(jid, 'image');
      } catch (e) {}

      if (isGroup) {
        try {
          const metadata = await this.socket.groupMetadata(jid);
          return {
            success: true,
            data: {
              id: jid,
              name: metadata.subject,
              isGroup: true,
              profilePicture: profilePicture,
              owner: metadata.owner,
              ownerPhone: metadata.owner?.split('@')[0],
              creation: metadata.creation,
              description: metadata.desc || null,
              participants: metadata.participants.map(p => ({
                id: p.id,
                phone: p.id.split('@')[0],
                isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
                isSuperAdmin: p.admin === 'superadmin'
              })),
              participantsCount: metadata.participants.length
            }
          };
        } catch (e) {
          return { success: false, message: 'Failed to get group info' };
        }
      } else {
        const phone = jid.split('@')[0];

        let status = null;
        try {
          const statusResult = await this.socket.fetchStatus(jid);
          status = statusResult?.status || null;
        } catch (e) {}

        let isRegistered = false;
        try {
          const [result] = await this.socket.onWhatsApp(phone);
          isRegistered = !!result?.exists;
        } catch (e) {}

        return {
          success: true,
          data: {
            id: jid,
            phone: phone,
            isGroup: false,
            profilePicture: profilePicture,
            status: status,
            isRegistered: isRegistered
          }
        };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async markChatRead(chatId, messageId = null) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      const jid = this.formatChatId(chatId);
      const isGroup = this.isGroupId(jid);
      console.log(`[${this.sessionId}] markChatRead: jid=${jid}, isGroup=${isGroup}`);

      const messages = await this.db.getMessages?.(jid, 50) || [];

      console.log(`[${this.sessionId}] Found ${messages.length} messages in DB for ${jid}`);

      const keysToRead = [];
      for (const msg of messages) {
        if (msg?.key && !msg.key.fromMe && msg.key.id) {
          const readKey = {
            remoteJid: jid,
            id: msg.key.id
          };
          if (isGroup && msg.key.participant) {
            readKey.participant = msg.key.participant;
          }
          keysToRead.push(readKey);
        }
      }

      if (keysToRead.length > 0) {
        console.log(`[${this.sessionId}] Marking ${keysToRead.length} messages as read`);
        await this.socket.readMessages(keysToRead);
        console.log(`✅ [${this.sessionId}] Messages marked as read: ${jid}`);
      } else {
        console.log(`[${this.sessionId}] No unread messages found in DB for ${jid}`);
      }

      return {
        success: true,
        message: 'Chat marked as read',
        data: {
          chatId: jid,
          isGroup: isGroup,
          markedCount: keysToRead.length
        }
      };
    } catch (error) {
      console.error(`[${this.sessionId}] Mark read error:`, error);
      return { success: false, message: error.message || 'Failed to mark as read' };
    }
  }

  async _autoSaveMedia(message) {
    try {
      if (!message.message) return null;
      const contentType = getContentType(message.message);
      const mediaTypes = ['imageMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'videoMessage'];

      if (!contentType || !mediaTypes.includes(contentType)) return null;
      const mediaContent = message.message[contentType];
      if (!mediaContent) return null;

      const buffer = await downloadMediaMessage(
        message,
        'buffer',
        {},
        { logger: console, reuploadRequest: this.socket?.updateMediaMessage }
      );

      const chatId = message.key.remoteJid.replace(/[@s.whatsapp.net|g.us]/g, '');
      const mediaDir = path.join(this.mediaFolder, chatId);

      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }

      const mimetype = mediaContent.mimetype || this._getMimetype(contentType);
      const ext = this._getExtFromMimetype(mimetype);
      const filename = mediaContent.fileName || `${message.key.id}.${ext}`;
      const filePath = path.join(mediaDir, filename);

      fs.writeFileSync(filePath, buffer);

      const relativePath = `/media/${this.sessionId}/${chatId}/${filename}`;

      console.log(`💾 [${this.sessionId}] Media saved: ${relativePath}`);

      await this.db._upsertMediaFile?.({
        messageId: message.key.id,
        chatId: message.key.remoteJid,
        filePath: relativePath,
        mimetype: mimetype,
        fileLength: mediaContent.fileLength,
        timestamp: message.messageTimestamp
      });

      return relativePath;
    } catch (error) {
      console.error(`[${this.sessionId}] Auto-save media error:`, error.message);
      return null;
    }
  }

  _getMimetype(contentType) {
    const map = {
      imageMessage: 'image/jpeg',
      videoMessage: 'video/mp4',
      audioMessage: 'audio/ogg; codecs=opus',
      documentMessage: 'application/octet-stream',
      stickerMessage: 'image/webp'
    };
    return map[contentType] || 'application/octet-stream';
  }

  _getExtFromMimetype(mimetype) {
    const map = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
      'video/mp4': 'mp4', 'video/3gpp': '3gp',
      'audio/ogg': 'ogg', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
      'application/pdf': 'pdf'
    };
    return map[mimetype] || mimetype.split('/')[1]?.split(';')[0] || 'bin';
  }

  async getMessages(chatId, isGroup = false, limit = 50) {
    return this.getChatMessages(chatId, limit, null);
  }

  async fetchMessages(chatId, isGroup = false, limit = 50, cursor = null) {
    return this.getChatMessages(chatId, limit, cursor);
  }

  async createGroup(name, participants) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!name || !participants || !Array.isArray(participants) || participants.length === 0) {
        return { success: false, message: 'Group name and at least one participant are required' };
      }

      const participantJids = participants.map(p => this.formatPhoneNumber(p));
      const group = await this.socket.groupCreate(name, participantJids);
      return {
        success: true,
        message: 'Group created successfully',
        data: {
          groupId: group.id,
          groupJid: group.id,
          subject: name,
          participants: participantJids,
          createdAt: new Date().toISOString()
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupAddParticipants(groupId, participants) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId || !participants || !Array.isArray(participants) || participants.length === 0) {
        return { success: false, message: 'Group ID and participants are required' };
      }
      const gid = this.formatJid(groupId, true);
      const participantJids = participants.map(p => this.formatPhoneNumber(p));
      const result = await this.socket.groupParticipantsUpdate(gid, participantJids, 'add');
      return {
        success: true,
        message: 'Participants added successfully',
        data: {
          groupId: gid,
          participants: result
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupRemoveParticipants(groupId, participants) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId || !participants || !Array.isArray(participants) || participants.length === 0) {
        return { success: false, message: 'Group ID and participants are required' };
      }
      const gid = this.formatJid(groupId, true);
      const participantJids = participants.map(p => this.formatPhoneNumber(p));
      const result = await this.socket.groupParticipantsUpdate(gid, participantJids, 'remove');
      return {
        success: true,
        message: 'Participants removed successfully',
        data: {
          groupId: gid,
          participants: result
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupPromoteParticipants(groupId, participants) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId || !participants || !Array.isArray(participants) || participants.length === 0) {
        return { success: false, message: 'Group ID and participants are required' };
      }
      const gid = this.formatJid(groupId, true);
      const participantJids = participants.map(p => this.formatPhoneNumber(p));
      const result = await this.socket.groupParticipantsUpdate(gid, participantJids, 'promote');
      return {
        success: true,
        message: 'Participants promoted to admin successfully',
        data: {
          groupId: gid,
          participants: result
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupDemoteParticipants(groupId, participants) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId || !participants || !Array.isArray(participants) || participants.length === 0) {
        return { success: false, message: 'Group ID and participants are required' };
      }
      const gid = this.formatJid(groupId, true);
      const participantJids = participants.map(p => this.formatPhoneNumber(p));
      const result = await this.socket.groupParticipantsUpdate(gid, participantJids, 'demote');
      return {
        success: true,
        message: 'Participants demoted from admin successfully',
        data: {
          groupId: gid,
          participants: result
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupUpdateSubject(groupId, subject) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId || !subject) {
        return { success: false, message: 'Group ID and subject are required' };
      }
      const gid = this.formatJid(groupId, true);
      await this.socket.groupUpdateSubject(gid, subject);
      return {
        success: true,
        message: 'Group subject updated successfully',
        data: {
          groupId: gid,
          subject: subject
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupUpdateDescription(groupId, description) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId) {
        return { success: false, message: 'Group ID is required' };
      }
      const gid = this.formatJid(groupId, true);
      await this.socket.groupUpdateDescription(gid, description || '');
      return {
        success: true,
        message: 'Group description updated successfully',
        data: {
          groupId: gid,
          description: description || ''
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupLeave(groupId) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId) {
        return { success: false, message: 'Group ID is required' };
      }
      const gid = this.formatJid(groupId, true);
      await this.socket.groupLeave(gid);
      return {
        success: true,
        message: 'Left group successfully',
        data: {
          groupId: gid
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupJoinByInvite(inviteCode) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!inviteCode) {
        return { success: false, message: 'Invitation code is required' };
      }
      const code = inviteCode.replace(/^https?:\/\/chat\.whatsapp\.com\//, '');
      const groupId = await this.socket.groupAcceptInvite(code);
      return {
        success: true,
        message: 'Joined group successfully',
        data: {
          groupId: groupId,
          inviteCode: code
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupGetInviteCode(groupId) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId) {
        return { success: false, message: 'Group ID is required' };
      }
      const gid = this.formatJid(groupId, true);
      const code = await this.socket.groupInviteCode(gid);
      return {
        success: true,
        message: 'Invite code retrieved successfully',
        data: {
          groupId: gid,
          inviteCode: code,
          inviteLink: `https://chat.whatsapp.com/${code}`
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupRevokeInvite(groupId) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId) {
        return { success: false, message: 'Group ID is required' };
      }
      const gid = this.formatJid(groupId, true);
      const newCode = await this.socket.groupRevokeInvite(gid);
      return {
        success: true,
        message: 'Invite code revoked successfully',
        data: {
          groupId: gid,
          newInviteCode: newCode,
          newInviteLink: `https://chat.whatsapp.com/${newCode}`
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupGetMetadata(groupId) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId) {
        return { success: false, message: 'Group ID is required' };
      }
      const gid = this.formatJid(groupId, true);
      const metadata = await this.socket.groupMetadata(gid);
      return {
        success: true,
        message: 'Group metadata retrieved successfully',
        data: {
          id: metadata.id,
          subject: metadata.subject,
          subjectOwner: metadata.subjectOwner,
          subjectTime: metadata.subjectTime,
          description: metadata.desc,
          descriptionId: metadata.descId,
          restrict: metadata.restrict,
          announce: metadata.announce,
          size: metadata.size,
          participants: metadata.participants?.map(p => ({
            id: p.id,
            admin: p.admin || null,
            isSuperAdmin: p.admin === 'superadmin'
          })),
          creation: metadata.creation,
          owner: metadata.owner
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getAllGroups() {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      const groups = await this.socket.groupFetchAllParticipating();

      const groupList = Object.values(groups).map(g => ({
        id: g.id,
        subject: g.subject,
        subjectOwner: g.subjectOwner,
        subjectTime: g.subjectTime,
        description: g.desc,
        restrict: g.restrict,
        announce: g.announce,
        size: g.size,
        participantsCount: g.participants?.length || 0,
        creation: g.creation,
        owner: g.owner
      }));
      return {
        success: true,
        message: 'Groups retrieved successfully',
        data: {
          count: groupList.length,
          groups: groupList
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupUpdateSettings(groupId, setting) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId || !setting) {
        return { success: false, message: 'Group ID and setting are required' };
      }

      const validSettings = ['announcement', 'not_announcement', 'locked', 'unlocked'];
      if (!validSettings.includes(setting)) {
        return {
          success: false,
          message: `Invalid setting. Use: ${validSettings.join(', ')}`
        };
      }

      const gid = this.formatJid(groupId, true);
      await this.socket.groupSettingUpdate(gid, setting);

      return {
        success: true,
        message: 'Group settings updated successfully',
        data: {
          groupId: gid,
          setting: setting
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async groupUpdateProfilePicture(groupId, imageUrl) {
    try {
      if (!this.socket || this.connectionStatus !== 'connected') {
        return { success: false, message: 'Session not connected' };
      }
      if (!groupId || !imageUrl) {
        return { success: false, message: 'Group ID and image URL are required' };
      }

      const gid = this.formatJid(groupId, true);
      await this.socket.updateProfilePicture(gid, { url: imageUrl });

      return {
        success: true,
        message: 'Group profile picture updated successfully',
        data: {
          groupId: gid
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = WhatsAppSession;