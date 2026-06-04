const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, getContentType, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');

const BaileysStore = require('./BaileysStore');
const MessageFormatter = require('./MessageFormatter');
const wsManager = require('../websocket/WebSocketManager');

/**
 * WhatsApp Session Class
 * Mengelola satu sesi WhatsApp
 */
class WhatsAppSession {
    constructor(sessionId, options = {}) {
        this.sessionId = sessionId;
        this.socket = null;
        this.qrCode = null;
        this.connectionStatus = 'disconnected';
        this.authFolder = path.join(process.cwd(), 'sessions', sessionId);
        this.storeFile = path.join(this.authFolder, 'store.json');
        this.configFile = path.join(this.authFolder, 'config.json');
        this.mediaFolder = path.join(process.cwd(), 'public', 'media', sessionId);
        this.phoneNumber = null;
        this.name = null;
        this.store = null;
        this.storeInterval = null;
        
        // Custom metadata and webhook
        this.metadata = options.metadata || {};
        this.webhooks = options.webhooks || []; // Array of { url, events? }
        
        // Load config if exists
        this._loadConfig();
    }
    
    /**
     * Load session config from file
     */
    _loadConfig() {
        try {
            if (fs.existsSync(this.configFile)) {
                const config = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
                this.metadata = config.metadata || this.metadata;
                this.webhooks = config.webhooks || this.webhooks;
            }
        } catch (e) {
            console.log(`⚠️ [${this.sessionId}] Could not load config:`, e.message);
        }
    }
    
    /**
     * Save session config to file
     */
    _saveConfig() {
        try {
            if (!fs.existsSync(this.authFolder)) {
                fs.mkdirSync(this.authFolder, { recursive: true });
            }
            fs.writeFileSync(this.configFile, JSON.stringify({
                metadata: this.metadata,
                webhooks: this.webhooks
            }, null, 2));
        } catch (e) {
            console.log(`⚠️ [${this.sessionId}] Could not save config:`, e.message);
        }
    }
    
    /**
     * Update session config
     */
    updateConfig(options = {}) {
        if (options.metadata !== undefined) {
            this.metadata = { ...this.metadata, ...options.metadata };
        }
        if (options.webhooks !== undefined) {
            this.webhooks = options.webhooks;
        }
        this._saveConfig();
        return this.getInfo();
    }
    
    /**
     * Add a webhook URL
     */
    addWebhook(url, events = ['all']) {
        // Check if already exists
        const exists = this.webhooks.find(w => w.url === url);
        if (exists) {
            exists.events = events;
        } else {
            this.webhooks.push({ url, events });
        }
        this._saveConfig();
        return this.getInfo();
    }
    
    /**
     * Remove a webhook URL
     */
    removeWebhook(url) {
        this.webhooks = this.webhooks.filter(w => w.url !== url);
        this._saveConfig();
        return this.getInfo();
    }
    
    /**
     * Send webhook notification to all configured webhook URLs
     */
    async _sendWebhook(event, data) {
        if (!this.webhooks || this.webhooks.length === 0) return;
        
        const payload = {
            event,
            sessionId: this.sessionId,
            metadata: this.metadata,
            data,
            timestamp: new Date().toISOString()
        };
        
        // Send to all webhooks in parallel
        const promises = this.webhooks.map(async (webhook) => {
            // Check if event should be sent to this webhook
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
        
        // Wait for all webhooks to complete (non-blocking)
        Promise.all(promises).catch(() => {});
    }

    // ==================== CONNECTION ====================

    async connect() {
        try {
            // Pastikan folder auth ada
            if (!fs.existsSync(this.authFolder)) {
                fs.mkdirSync(this.authFolder, { recursive: true });
            }

            // Initialize custom in-memory store with sessionId
            this.store = new BaileysStore(this.sessionId);

            // Load existing store data if available
            if (fs.existsSync(this.storeFile)) {
                try {
                    this.store.readFromFile(this.storeFile);
                    console.log(`📂 [${this.sessionId}] Store data loaded from file`);
                } catch (e) {
                    console.log(`⚠️ [${this.sessionId}] Could not load store file:`, e.message);
                }
            }

            // Save store periodically (every 30 seconds) and cleanup old media
            this.storeInterval = setInterval(() => {
                try {
                    // Cleanup old media files before saving (keep only last 100 per chat)
                    this.store.cleanupOldMedia(100);
                    this.store.writeToFile(this.storeFile);
                } catch (e) {
                    // Silent fail
                }
            }, 30_000);

            const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
            const { version } = await fetchLatestBaileysVersion();

            this.socket = makeWASocket({
                version,
                auth: state,
                logger: pino({ level: 'silent' }),
                browser: ['Chatery API', 'Chrome', '1.0.0'],
                syncFullHistory: true
            });

            // Bind store to socket events
            this.store.bind(this.socket.ev);

            // Setup event listeners
            this._setupEventListeners(saveCreds);

            return { success: true, message: 'Initializing connection...' };
        } catch (error) {
            console.error(`[${this.sessionId}] Error connecting:`, error);
            this.connectionStatus = 'error';
            return { success: false, message: error.message };
        }
    }

    _setupEventListeners(saveCreds) {
        // Connection update
        this.socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this.qrCode = await qrcode.toDataURL(qr);
                this.connectionStatus = 'qr_ready';
                console.log(`📱 [${this.sessionId}] QR Code generated! Scan dengan WhatsApp Anda.`);
                
                // Emit QR code to WebSocket
                wsManager.emitQRCode(this.sessionId, this.qrCode);
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                console.log(`❌ [${this.sessionId}] Connection closed:`, lastDisconnect?.error?.message);
                this.connectionStatus = 'disconnected';
                this.qrCode = null;
                
                // Emit connection status to WebSocket
                wsManager.emitConnectionStatus(this.sessionId, 'disconnected', {
                    reason: lastDisconnect?.error?.message,
                    shouldReconnect
                });
                
                // Send webhook
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
                    
                    // Register me JID, LID, and Phone Number
                    if (this.store) {
                        const normalizedMe = jidNormalizedUser(this.socket.user.id);
                        const meLid = this.socket.user.lid;
                        if (meLid) {
                            this.store.registerIdentity(meLid, normalizedMe, this.phoneNumber);
                        }
                    }
                }
                
                // Emit connection status to WebSocket
                wsManager.emitConnectionStatus(this.sessionId, 'connected', {
                    phoneNumber: this.phoneNumber,
                    name: this.name
                });
                
                // Send webhook
                this._sendWebhook('connection.update', {
                    status: 'connected',
                    phoneNumber: this.phoneNumber,
                    name: this.name
                });
            } else if (connection === 'connecting') {
                console.log(`🔄 [${this.sessionId}] Connecting to WhatsApp...`);
                this.connectionStatus = 'connecting';
                
                // Emit connection status to WebSocket
                wsManager.emitConnectionStatus(this.sessionId, 'connecting');
            }
        });

        // Save credentials
        this.socket.ev.on('creds.update', saveCreds);

        // Messages upsert (new messages)
        this.socket.ev.on('messages.upsert', async (m) => {
            try {
                // Validate messages array
                if (!m?.messages || !Array.isArray(m.messages) || m.messages.length === 0) {
                    return;
                }
                
                const message = m.messages[0];
                
                // Validate message structure
                if (!message || !message.key || !message.key.remoteJid) {
                    console.log(`⚠️ [${this.sessionId}] Received invalid message structure, skipping`);
                    return;
                }
                
                if (!message.key.fromMe && m.type === 'notify') {
                    console.log(`📩 [${this.sessionId}] New message from:`, message.key.remoteJid);
                    
                    // Auto-save media if present
                    await this._autoSaveMedia(message);
                    
                    // Emit message to WebSocket
                    const formattedMessage = MessageFormatter.formatMessage(message, this.store);
                    wsManager.emitMessage(this.sessionId, formattedMessage);
                    
                    // Send webhook
                    this._sendWebhook('message', formattedMessage);
                } else if (message.key.fromMe && m.type === 'notify') {
                    // Message sent confirmation
                    const formattedMessage = MessageFormatter.formatMessage(message, this.store);
                    wsManager.emitMessageSent(this.sessionId, formattedMessage);
                    
                    // Send webhook
                    this._sendWebhook('message.sent', formattedMessage);
                }
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing message upsert:`, error.message);
            }
        });

        // Messages update (status: read, delivered, etc)
        this.socket.ev.on('messages.update', (updates) => {
            try {
                if (!updates || !Array.isArray(updates)) return;
                wsManager.emitMessageStatus(this.sessionId, updates);
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing messages.update:`, error.message);
            }
        });

        // Message reaction
        this.socket.ev.on('messages.reaction', (reactions) => {
            try {
                if (!reactions) return;
                wsManager.emitToSession(this.sessionId, 'message.reaction', { reactions });
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing messages.reaction:`, error.message);
            }
        });

        // Chats upsert
        this.socket.ev.on('chats.upsert', (chats) => {
            try {
                if (!chats || !Array.isArray(chats)) return;
                console.log(`💬 [${this.sessionId}] Chats updated: ${chats.length} chats`);
                wsManager.emitChatsUpsert(this.sessionId, chats);
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing chats.upsert:`, error.message);
            }
        });

        // Chats update
        this.socket.ev.on('chats.update', (chats) => {
            try {
                if (!chats || !Array.isArray(chats)) return;
                wsManager.emitChatUpdate(this.sessionId, chats);
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing chats.update:`, error.message);
            }
        });

        // Chats delete
        this.socket.ev.on('chats.delete', (chatIds) => {
            try {
                if (!chatIds) return;
                wsManager.emitChatDelete(this.sessionId, chatIds);
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing chats.delete:`, error.message);
            }
        });

        // Contacts upsert
        this.socket.ev.on('contacts.upsert', (contacts) => {
            try {
                if (!contacts || !Array.isArray(contacts)) return;
                console.log(`👥 [${this.sessionId}] Contacts updated: ${contacts.length} contacts`);
                wsManager.emitContactUpdate(this.sessionId, contacts);
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing contacts.upsert:`, error.message);
            }
        });

        // Contacts update
        this.socket.ev.on('contacts.update', (contacts) => {
            try {
                if (!contacts || !Array.isArray(contacts)) return;
                wsManager.emitContactUpdate(this.sessionId, contacts);
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing contacts.update:`, error.message);
            }
        });

        // Presence update (typing, online, etc)
        this.socket.ev.on('presence.update', (presence) => {
            try {
                if (!presence) return;
                wsManager.emitPresence(this.sessionId, presence);
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing presence.update:`, error.message);
            }
        });

        // Group participants update
        this.socket.ev.on('group-participants.update', (update) => {
            try {
                if (!update) return;
                wsManager.emitGroupParticipants(this.sessionId, update);
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing group-participants.update:`, error.message);
            }
        });

        // Groups update
        this.socket.ev.on('groups.update', (updates) => {
            try {
                if (!updates) return;
                wsManager.emitGroupUpdate(this.sessionId, updates);
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing groups.update:`, error.message);
            }
        });

        // Call events
        this.socket.ev.on('call', (calls) => {
            try {
                if (!calls) return;
                wsManager.emitCall(this.sessionId, calls);
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing call:`, error.message);
            }
        });

        // Labels (for business accounts)
        this.socket.ev.on('labels.edit', (label) => {
            try {
                if (!label) return;
                wsManager.emitLabels(this.sessionId, { type: 'edit', label });
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing labels.edit:`, error.message);
            }
        });

        this.socket.ev.on('labels.association', (association) => {
            try {
                if (!association) return;
                wsManager.emitLabels(this.sessionId, { type: 'association', association });
            } catch (error) {
                console.error(`❌ [${this.sessionId}] Error processing labels.association:`, error.message);
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
            storeStats: this.store ? this.store.getStats() : null,
            metadata: this.metadata,
            webhooks: this.webhooks
        };
    }

    async logout() {
        try {
            if (this.storeInterval) {
                clearInterval(this.storeInterval);
            }
            
            // Clear store and delete all media files
            if (this.store) {
                this.store.clear();
            }
            
            // Delete media folder for this session
            this.deleteMediaFolder();
            
            if (this.socket) {
                await this.socket.logout();
                this.socket = null;
            }
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

    // ==================== HELPERS ====================

    formatPhoneNumber(phone, isGroup = null) {
        if (!phone || phone.trim() === '') {
            throw new Error('Phone number cannot be empty');
        }
        if (phone.includes('@')) {
            if (phone.includes('@g.us')) {
                return phone.replace('@c.us', '@g.us');
            }
            return phone;
        }
        let formatted = phone.replace(/\D/g, '');
        if (formatted.startsWith('0')) {
            formatted = '62' + formatted.slice(1);
        }
        if (!formatted) {
            throw new Error('Invalid phone number: no digits found');
        }
        if (isGroup === null) {
            isGroup = this.isGroupId(phone);
        }
        return isGroup ? `${formatted}@g.us` : `${formatted}@c.us`;
    }

    formatJid(id, isGroup = false) {
        if (id.includes('@')) return id;
        
        let formatted = id.replace(/\D/g, '');
        if (formatted.startsWith('0')) {
            formatted = '62' + formatted.slice(1);
        }
        
        return isGroup ? `${formatted}@g.us` : `${formatted}@c.us`;
    }

    formatChatId(chatId, isGroup = null) {
        if (!chatId || chatId.trim() === '') {
            throw new Error('Chat ID cannot be empty');
        }
        if (chatId.includes('@')) {
            if (chatId.includes('@g.us')) {
                return chatId.replace('@c.us', '@g.us');
            }
            return chatId;
        }

        let formatted = chatId.replace(/\D/g, '');
        if (formatted.startsWith('0')) {
            formatted = '62' + formatted.slice(1);
        }
        if (!formatted) {
            throw new Error('Invalid Chat ID: no digits found');
        }
        if (isGroup === null) {
            isGroup = this.isGroupId(chatId);
        }
        return isGroup ? `${formatted}@g.us` : `${formatted}@c.us`;
    }

    normalizeChatId(chatId) {
        if (!chatId || chatId.trim() === '') {
            return null;
        }
        if (chatId.includes('@g.us')) {
            return this.formatChatId(chatId, true);
        }
        if (chatId.includes('@c.us')) {
            return this.formatChatId(chatId, false);
        }
        const jid = this.formatJid(chatId, false);
        if (this.isGroupJid(jid)) {
            return this.formatChatId(chatId, true);
        }
        return jid;
    }

    isGroupJid(jid) {
        return jid?.endsWith('@g.us');
    }

    isGroupId(chatId) {
        return chatId.includes('@g.us');
    }

    async resolveLidFromServer(lid) {
        if (!lid || !lid.endsWith('@lid') || !this.socket) return null;
        
        try {
            const { USyncQuery, USyncUser } = require('@whiskeysockets/baileys');
            const query = new USyncQuery()
                .withContext('message')
                .withDeviceProtocol()
                .withLIDProtocol();
                
            query.withUser(new USyncUser().withId(lid));
            
            const result = await this.socket.executeUSyncQuery(query);
            if (result && result.list) {
                for (const item of result.list) {
                    if (item.lid && item.id) {
                        const lidJid = item.lid.toLowerCase();
                        const pnJid = item.id.toLowerCase();
                        if (this.store) {
                            this.store.registerIdentity(lidJid, pnJid);
                        }
                        if (lidJid === lid.toLowerCase()) {
                            return {
                                lid: lidJid,
                                jid: pnJid,
                                pn: pnJid.split('@')[0]
                            };
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`[${this.sessionId}] Error resolving LID from server:`, error.message);
        }
        return null;
    }

    // ==================== SEND MESSAGES ====================

    /**
     * Send presence update (typing indicator)
     * @param {string} chatId - Chat ID
     * @param {string} presence - 'composing' | 'recording' | 'paused'
     */
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

    /**
     * Helper: Send typing indicator and wait
     * @param {string} jid - Formatted JID
     * @param {number} typingTime - Time in milliseconds to show typing
     */
    async _simulateTyping(jid, typingTime = 0) {
        if (typingTime > 0) {
            await this.socket.sendPresenceUpdate('composing', jid);
            await new Promise(resolve => setTimeout(resolve, typingTime));
            await this.socket.sendPresenceUpdate('paused', jid);
        }
    }

    async sendTextMessage(chatId, message, typingTime = 0, replyTo = null) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);
            
            // Simulate typing if typingTime > 0
            await this._simulateTyping(jid, typingTime);
            
            const messageContent = { text: message };
            const messageOptions = {};
            
            // Add quoted message for reply
            if (replyTo) {
                // Try to get the message from store first
                const quotedMsg = this.store?.getMessage(jid, replyTo);
                if (quotedMsg) {
                    messageOptions.quoted = quotedMsg;
                } else {
                    // Fallback: create minimal quoted structure
                    messageOptions.quoted = {
                        key: {
                            remoteJid: jid,
                            id: replyTo,
                            fromMe: false
                        },
                        message: { conversation: '' }
                    };
                }
            }
            
            const result = await this.socket.sendMessage(jid, messageContent, messageOptions);
            
            return { 
                success: true, 
                message: 'Message sent successfully',
                data: {
                    messageId: result.key.id,
                    chatId: jid,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async sendImage(chatId, imageUrl, caption = '', typingTime = 0, replyTo = null) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);
            
            // Simulate typing if typingTime > 0
            await this._simulateTyping(jid, typingTime);
            
            const messageContent = {
                image: { url: imageUrl },
                caption: caption
            };
            const messageOptions = {};
            
            // Add quoted message for reply
            if (replyTo) {
                const quotedMsg = this.store?.getMessage(jid, replyTo);
                if (quotedMsg) {
                    messageOptions.quoted = quotedMsg;
                } else {
                    messageOptions.quoted = {
                        key: {
                            remoteJid: jid,
                            id: replyTo,
                            fromMe: false
                        },
                        message: { conversation: '' }
                    };
                }
            }
            
            const result = await this.socket.sendMessage(jid, messageContent, messageOptions);

            return {
                success: true,
                message: 'Image sent successfully',
                data: {
                    messageId: result.key.id,
                    chatId: jid,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async sendDocument(chatId, documentUrl, filename, mimetype = 'application/pdf', caption = '', typingTime = 0, replyTo = null) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);
            
            // Simulate typing if typingTime > 0
            await this._simulateTyping(jid, typingTime);
            
            const messageContent = {
                document: { url: documentUrl },
                fileName: filename,
                mimetype: mimetype,
                caption: caption || undefined
            };
            const messageOptions = {};
            
            // Add quoted message for reply
            if (replyTo) {
                const quotedMsg = this.store?.getMessage(jid, replyTo);
                if (quotedMsg) {
                    messageOptions.quoted = quotedMsg;
                } else {
                    messageOptions.quoted = {
                        key: {
                            remoteJid: jid,
                            id: replyTo,
                            fromMe: false
                        },
                        message: { conversation: '' }
                    };
                }
            }
            
            const result = await this.socket.sendMessage(jid, messageContent, messageOptions);

            return {
                success: true,
                message: 'Document sent successfully',
                data: {
                    messageId: result.key.id,
                    chatId: jid,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Send Audio Message
     * @param {string} chatId - Chat ID or phone number
     * @param {string} audioUrl - URL to audio file (must be OGG format)
     * @param {boolean} ptt - Push to talk (voice note) mode
     * @param {number} typingTime - Typing simulation time in ms
     * @param {string} replyTo - Message ID to reply to
     */
    async sendAudio(chatId, audioUrl, ptt = false, typingTime = 0, replyTo = null) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            // Validate OGG format
            const urlLower = audioUrl.toLowerCase();
            if (!urlLower.endsWith('.ogg') && !urlLower.includes('.ogg?')) {
                return { 
                    success: false, 
                    message: 'Audio must be in OGG format (.ogg). WhatsApp only supports OGG audio files.' 
                };
            }

            const jid = this.formatChatId(chatId);
            
            // Simulate recording if typingTime > 0
            if (typingTime > 0) {
                await this.socket.sendPresenceUpdate('recording', jid);
                await new Promise(resolve => setTimeout(resolve, typingTime));
                await this.socket.sendPresenceUpdate('paused', jid);
            }
            
            const messageContent = {
                audio: { url: audioUrl },
                ptt: ptt, // true = voice note, false = audio file
                mimetype: 'audio/ogg; codecs=opus'
            };
            const messageOptions = {};
            
            // Add quoted message for reply
            if (replyTo) {
                const quotedMsg = this.store?.getMessage(jid, replyTo);
                if (quotedMsg) {
                    messageOptions.quoted = quotedMsg;
                } else {
                    messageOptions.quoted = {
                        key: {
                            remoteJid: jid,
                            id: replyTo,
                            fromMe: false
                        },
                        message: { conversation: '' }
                    };
                }
            }
            
            const result = await this.socket.sendMessage(jid, messageContent, messageOptions);

            return {
                success: true,
                message: ptt ? 'Voice note sent successfully' : 'Audio sent successfully',
                data: {
                    messageId: result.key.id,
                    chatId: jid,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async sendLocation(chatId, latitude, longitude, name = '', typingTime = 0, replyTo = null) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);
            
            // Simulate typing if typingTime > 0
            await this._simulateTyping(jid, typingTime);
            
            const messageContent = {
                location: {
                    degreesLatitude: latitude,
                    degreesLongitude: longitude,
                    name: name
                }
            };
            const messageOptions = {};
            
            // Add quoted message for reply
            if (replyTo) {
                const quotedMsg = this.store?.getMessage(jid, replyTo);
                if (quotedMsg) {
                    messageOptions.quoted = quotedMsg;
                } else {
                    messageOptions.quoted = {
                        key: {
                            remoteJid: jid,
                            id: replyTo,
                            fromMe: false
                        },
                        message: { conversation: '' }
                    };
                }
            }
            
            const result = await this.socket.sendMessage(jid, messageContent, messageOptions);

            return {
                success: true,
                message: 'Location sent successfully',
                data: {
                    messageId: result.key.id,
                    chatId: jid,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async sendContact(chatId, contactName, contactPhone, typingTime = 0, replyTo = null) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);
            
            // Simulate typing if typingTime > 0
            await this._simulateTyping(jid, typingTime);
            
            const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName}\nTEL;type=CELL;type=VOICE;waid=${contactPhone}:+${contactPhone}\nEND:VCARD`;
            
            const messageContent = {
                contacts: {
                    displayName: contactName,
                    contacts: [{ vcard }]
                }
            };
            const messageOptions = {};
            
            // Add quoted message for reply
            if (replyTo) {
                const quotedMsg = this.store?.getMessage(jid, replyTo);
                if (quotedMsg) {
                    messageOptions.quoted = quotedMsg;
                } else {
                    messageOptions.quoted = {
                        key: {
                            remoteJid: jid,
                            id: replyTo,
                            fromMe: false
                        },
                        message: { conversation: '' }
                    };
                }
            }
            
            const result = await this.socket.sendMessage(jid, messageContent, messageOptions);

            return {
                success: true,
                message: 'Contact sent successfully',
                data: {
                    messageId: result.key.id,
                    chatId: jid,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Send Button Message
     * NOTE: Regular button messages are DEPRECATED by WhatsApp since 2022.
     * This method now uses Poll as an alternative for interactive choices.
     * If you need actual buttons, you must use WhatsApp Business API (Cloud API).
     */
    async sendButton(chatId, text, footer, buttons, typingTime = 0, replyTo = null) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);
            
            // Simulate typing if typingTime > 0
            await this._simulateTyping(jid, typingTime);
            
            // WhatsApp deprecated regular buttons in 2022
            // Using Poll as an alternative for interactive choices
            const pollName = footer ? `${text}\n\n${footer}` : text;
            
            const messageContent = {
                poll: {
                    name: pollName,
                    values: buttons, // Poll options as choices
                    selectableCount: 1 // Single selection like a button
                }
            };
            const messageOptions = {};
            
            // Add quoted message for reply
            if (replyTo) {
                const quotedMsg = this.store?.getMessage(jid, replyTo);
                if (quotedMsg) {
                    messageOptions.quoted = quotedMsg;
                } else {
                    messageOptions.quoted = {
                        key: {
                            remoteJid: jid,
                            id: replyTo,
                            fromMe: false
                        },
                        message: { conversation: '' }
                    };
                }
            }
            
            const result = await this.socket.sendMessage(jid, messageContent, messageOptions);

            return {
                success: true,
                message: 'Interactive poll sent (buttons are deprecated by WhatsApp)',
                data: {
                    messageId: result.key.id,
                    chatId: jid,
                    timestamp: new Date().toISOString(),
                    note: 'WhatsApp deprecated button messages in 2022. Poll is used as alternative.'
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Send Poll Message
     * A working alternative for interactive choices
     */
    async sendPoll(chatId, question, options, selectableCount = 1, typingTime = 0, replyTo = null) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);
            
            // Simulate typing if typingTime > 0
            await this._simulateTyping(jid, typingTime);
            
            const messageContent = {
                poll: {
                    name: question,
                    values: options,
                    selectableCount: selectableCount
                }
            };
            const messageOptions = {};
            
            // Add quoted message for reply
            if (replyTo) {
                const quotedMsg = this.store?.getMessage(jid, replyTo);
                if (quotedMsg) {
                    messageOptions.quoted = quotedMsg;
                } else {
                    messageOptions.quoted = {
                        key: {
                            remoteJid: jid,
                            id: replyTo,
                            fromMe: false
                        },
                        message: { conversation: '' }
                    };
                }
            }
            
            const result = await this.socket.sendMessage(jid, messageContent, messageOptions);

            return {
                success: true,
                message: 'Poll sent successfully',
                data: {
                    messageId: result.key.id,
                    chatId: jid,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    // ==================== CONTACT & PROFILE ====================

    async isRegistered(phone) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatPhoneNumber(phone);
            const [result] = await this.socket.onWhatsApp(jid.replace('@c.us', ''));
            
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
                const [result] = await this.socket.onWhatsApp(jid.replace('@c.us', ''));
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

    // ==================== GROUPS ====================

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
                        admin: p.admin || null,
                        phone: p.id.split('@')[0]
                    })),
                    participantsCount: metadata.participants.length
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    // ==================== LABELS ====================

    /**
     * Get all labels
     */
    async getLabels() {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }
            if (!this.store) {
                return { success: false, message: 'Store not initialized' };
            }

            const labels = this.store.getLabels();
            return {
                success: true,
                data: { labels, total: labels.length }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Get label by ID
     */
    async getLabelById(labelId) {
        try {
            if (!this.store) {
                return { success: false, message: 'Store not initialized' };
            }

            const label = this.store.getLabelById(labelId);
            if (!label) {
                return { success: false, message: 'Label not found' };
            }
            return { success: true, data: label };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Add label to chat
     */
    async addChatLabel(chatId, labelId) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);
            await this.socket.addChatLabel(jid, labelId);

            // Update store immediately
            if (this.store) {
                this.store.addLabelAssociation(jid, labelId);
            }

            return { success: true, message: 'Label added to chat', data: { chatId: jid, labelId } };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Remove label from chat
     */
    async removeChatLabel(chatId, labelId) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);
            await this.socket.removeChatLabel(jid, labelId);

            // Update store immediately
            if (this.store) {
                this.store.removeLabelAssociation(jid, labelId);
            }

            return { success: true, message: 'Label removed from chat', data: { chatId: jid, labelId } };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Add label to a specific message
     */
    async addMessageLabel(chatId, messageId, labelId) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);

            if (typeof this.socket.addMessageLabel !== 'function') {
                return { success: false, message: 'Message labeling not supported in this Baileys version' };
            }

            await this.socket.addMessageLabel(jid, messageId, labelId);
            return { success: true, message: 'Label added to message', data: { chatId: jid, messageId, labelId } };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Remove label from a specific message
     */
    async removeMessageLabel(chatId, messageId, labelId) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);

            if (typeof this.socket.removeMessageLabel !== 'function') {
                return { success: false, message: 'Message labeling not supported in this Baileys version' };
            }

            await this.socket.removeMessageLabel(jid, messageId, labelId);
            return { success: true, message: 'Label removed from message', data: { chatId: jid, messageId, labelId } };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Get all chats with a specific label
     */
    async getChatsByLabel(labelId) {
        try {
            if (!this.store) {
                return { success: false, message: 'Store not initialized' };
            }

            const label = this.store.getLabelById(labelId);
            if (!label) {
                return { success: false, message: 'Label not found' };
            }

            const chats = this.store.getChatsByLabel(labelId);
            return {
                success: true,
                data: { label, chats, total: chats.length }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Get all labels for a specific chat
     */
    async getLabelsByChat(chatId) {
        try {
            if (!this.store) {
                return { success: false, message: 'Store not initialized' };
            }

            const jid = this.formatChatId(chatId);
            const labels = this.store.getLabelsByChat(jid);
            return {
                success: true,
                data: { chatId: jid, labels, total: labels.length }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    // ==================== CHAT HISTORY ====================

    /**
     * Get chats overview - OPTIMIZED VERSION using pre-computed cache
     */
    async getChatsOverview(limit = 50, offset = 0, type = 'all') {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            if (!this.store) {
                return { success: false, message: 'Store not initialized' };
            }

            // Get pre-sorted overview from cache (fast O(1) lookup + slice)
            const result = this.store.getChatsOverviewFast({ limit: 1000, offset: 0 });
            let chats = result.data;

            // Filter by type if needed
            if (type === 'group') {
                chats = chats.filter(c => c.isGroup);
            } else if (type === 'personal') {
                chats = chats.filter(c => !c.isGroup);
            }

            // Apply pagination
            const total = chats.length;
            const paginatedChats = chats.slice(offset, offset + limit);

            // Transform to expected format (pure in-memory, no network calls)
            const formattedChats = paginatedChats.map(chat => {
                let resolvedId = chat.id;
                let resolvedPhone = chat.isGroup ? null : chat.id.split('@')[0];
                let resolvedName = chat.name;

                if (!chat.isGroup && this.store) {
                    const resolved = this.store.resolveIdentity(chat.id);
                    if (resolved) {
                        resolvedId = resolved.jid || resolvedId;
                        resolvedPhone = resolved.pn || resolvedPhone;
                    }

                    // Fix name if it's still LID-based
                    const lidNumber = chat.id.endsWith('@lid') ? chat.id.split('@')[0] : null;
                    if (resolvedName && (resolvedName.endsWith('@lid') || resolvedName === lidNumber)) {
                        const contact = this.store.getContact(resolvedId);
                        resolvedName = contact?.name || contact?.notify || resolvedPhone || resolvedId.split('@')[0];
                    }
                }

                return {
                    id: resolvedId,
                    name: resolvedName,
                    phone: resolvedPhone,
                    isGroup: chat.isGroup,
                    profilePicture: chat.profilePicture,
                    participantsCount: null,
                    lastMessage: chat.lastMessage?.preview || null,
                    lastMessageTimestamp: chat.lastMessage?.timestamp || chat.conversationTimestamp || 0,
                    unreadCount: chat.unreadCount || 0
                };
            });

            // Fetch missing profile pictures in background (non-blocking)
            this._fetchMissingProfilePictures(paginatedChats);

            return {
                success: true,
                data: {
                    total: total,
                    limit: limit,
                    offset: offset,
                    hasMore: offset + limit < total,
                    chats: formattedChats
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Fetch missing profile pictures in background (fire-and-forget, non-blocking)
     */
    _fetchMissingProfilePictures(items) {
        if (!this.socket || !this.store) return;
        const needPics = items.filter(c => !c.profilePicture).slice(0, 10);
        if (needPics.length === 0) return;

        // Fire and forget — don't await
        Promise.all(needPics.map(async (item) => {
            try {
                const url = await this.socket.profilePictureUrl(item.id, 'image');
                this.store.setProfilePicture(item.id, url);
            } catch (e) {
                // No profile picture available
            }
        })).catch(() => {});
    }

    /**
     * Get contacts list - OPTIMIZED VERSION using cache
     */
    async getContacts(limit = 50, offset = 0, search = '') {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            if (!this.store) {
                return { success: false, message: 'Store not initialized' };
            }

            // Use fast method from BaileysStore
            const result = this.store.getContactsFast({ limit: 1000, offset: 0, search });
            let contacts = result.data;

            // Apply pagination
            const total = contacts.length;
            const paginatedContacts = contacts.slice(offset, offset + limit);

            // Transform to expected format
            const formattedContacts = paginatedContacts.map(c => ({
                id: c.id,
                phone: c.id.split('@')[0],
                name: c.name,
                shortName: c.notify || null,
                pushName: c.notify || null,
                profilePicture: c.profilePicture
            }));

            // Fetch missing profile pictures in background (non-blocking)
            this._fetchMissingProfilePictures(paginatedContacts);

            return {
                success: true,
                data: {
                    total: total,
                    limit: limit,
                    offset: offset,
                    hasMore: offset + limit < total,
                    contacts: formattedContacts
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
            
            // Resolve unmapped LID from server
            if (jid && jid.endsWith('@lid') && this.store && !this.store.resolveIdentity(jid)) {
                await this.resolveLidFromServer(jid);
            }

            const isGroup = this.isGroupId(jid);
            
            let messages = [];
            
            // Try to fetch from server first (if fetchMessageHistory is available)
            if (typeof this.socket.fetchMessageHistory === 'function') {
                try {
                    const cursorMsg = cursor ? { 
                        before: { 
                            id: cursor, 
                            fromMe: false,
                            remoteJid: jid 
                        } 
                    } : undefined;

                    const result = await this.socket.fetchMessageHistory(limit, cursorMsg, jid);
                    if (Array.isArray(result)) {
                        messages = result;
                    }
                } catch (fetchError) {
                    // Silent fail, will use store as fallback
                }
            }

            // Fallback: Try to get messages from store
            if (messages.length === 0 && this.store) {
                try {
                    const storeMessages = this.store.getMessages(jid, { limit, before: cursor });
                    if (storeMessages && storeMessages.length > 0) {
                        messages = storeMessages;
                    }
                } catch (storeError) {
                    console.log(`[${this.sessionId}] Store messages error:`, storeError.message);
                }
            }

            const formattedMessages = messages
                .filter(msg => msg && msg.key) // Filter invalid messages
                .map(msg => MessageFormatter.formatMessage(msg, this.store))
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
            
            // Resolve unmapped LID from server
            if (jid && jid.endsWith('@lid') && this.store && !this.store.resolveIdentity(jid)) {
                await this.resolveLidFromServer(jid);
            }

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
                            participants: metadata.participants.map(p => {
                                let resolvedId = p.id;
                                let resolvedPhone = p.id.split('@')[0];
                                if (this.store) {
                                    const resolved = this.store.resolveIdentity(p.id);
                                    if (resolved) {
                                        resolvedId = resolved.jid || resolvedId;
                                        resolvedPhone = resolved.pn || resolvedPhone;
                                    }
                                }
                                return {
                                    id: resolvedId,
                                    phone: resolvedPhone,
                                    isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
                                    isSuperAdmin: p.admin === 'superadmin'
                                };
                            }),
                            participantsCount: metadata.participants.length
                        }
                    };
                } catch (e) {
                    return { success: false, message: 'Failed to get group info' };
                }
            } else {
                let resolvedJid = jid;
                let phone = jid.split('@')[0];
                if (this.store) {
                    const resolved = this.store.resolveIdentity(jid);
                    if (resolved) {
                        resolvedJid = resolved.jid || resolvedJid;
                        phone = resolved.pn || phone;
                    }
                }
                
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
                        id: resolvedJid,
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

    // ==================== CHAT READ STATUS ====================

    /**
     * Mark a chat as read
     * @param {string} chatId - Chat ID (phone number or group ID)
     * @param {string|null} messageId - Optional specific message ID to mark as read
     */
    async markChatRead(chatId, messageId = null) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const jid = this.formatChatId(chatId);
            const isGroup = this.isGroupId(jid);

            console.log(`[${this.sessionId}] markChatRead: jid=${jid}, isGroup=${isGroup}`);

            // Get messages from store
            const storeMessages = this.store?.getMessages(jid, { limit: 50 }) || [];
            console.log(`[${this.sessionId}] Found ${storeMessages.length} messages in store for ${jid}`);
            
            // Collect message keys to mark as read
            const keysToRead = [];
            for (const msg of storeMessages) {
                // Only mark incoming messages (not from me)
                if (msg?.key && !msg.key.fromMe && msg.key.id) {
                    const readKey = {
                        remoteJid: jid,
                        id: msg.key.id
                    };
                    // Add participant for group messages
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
                console.log(`[${this.sessionId}] No unread messages found in store for ${jid}`);
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

    // ==================== MEDIA DOWNLOAD ====================

    /**
     * Auto-save media when message received
     */
    async _autoSaveMedia(message) {
        try {
            if (!message.message) return null;

            const contentType = getContentType(message.message);
            const mediaTypes = ['imageMessage', 'audioMessage', 'documentMessage', 'stickerMessage']; // 'videoMessage' can be added if needed
            
            if (!contentType || !mediaTypes.includes(contentType)) return null;

            const mediaContent = message.message[contentType];
            if (!mediaContent) return null;

            // Download media
            const buffer = await downloadMediaMessage(
                message,
                'buffer',
                {},
                { logger: console, reuploadRequest: this.socket?.updateMediaMessage }
            );

            // Create media folder structure: public/media/{sessionId}/{chatId}/
            const chatId = message.key.remoteJid.replace('@c.us', '').replace('@g.us', '');
            const mediaDir = path.join(this.mediaFolder, chatId);
            
            if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
            }

            // Generate filename
            const mimetype = mediaContent.mimetype || this._getMimetype(contentType);
            const ext = this._getExtFromMimetype(mimetype);
            const filename = mediaContent.fileName || `${message.key.id}.${ext}`;
            const filePath = path.join(mediaDir, filename);

            // Save file
            fs.writeFileSync(filePath, buffer);

            // Register media file in store for cleanup tracking
            if (this.store) {
                this.store.registerMediaFile(message.key.id, filePath);
            }

            // Store media path in message for later reference
            const relativePath = `/media/${this.sessionId}/${chatId}/${filename}`;
            
            console.log(`💾 [${this.sessionId}] Media saved: ${relativePath}`);

            // Update message in store with media path
            if (this.store) {
                const chatMessages = this.store.messages.get(message.key.remoteJid);
                if (chatMessages && chatMessages.has(message.key.id)) {
                    const msg = chatMessages.get(message.key.id);
                    if (msg) {
                        msg._mediaPath = relativePath;
                        msg._mediaLocalPath = filePath;
                    }
                }
            }

            return relativePath;
        } catch (error) {
            console.error(`[${this.sessionId}] Auto-save media error:`, error.message);
            return null;
        }
    }

    _getMimetype(contentType) {
        const map = {
            'imageMessage': 'image/jpeg',
            'videoMessage': 'video/mp4',
            'audioMessage': 'audio/ogg; codecs=opus',
            'documentMessage': 'application/octet-stream',
            'stickerMessage': 'image/webp'
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

    // Legacy methods for backward compatibility
    async getMessages(chatId, isGroup = false, limit = 50) {
        return this.getChatMessages(chatId, limit, null);
    }

    async fetchMessages(chatId, isGroup = false, limit = 50, cursor = null) {
        return this.getChatMessages(chatId, limit, cursor);
    }

    // ==================== GROUP MANAGEMENT ====================

    /**
     * Create a new group
     * @param {string} name - Group name/subject
     * @param {Array<string>} participants - Array of phone numbers to add
     * @returns {Object}
     */
    async createGroup(name, participants) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            if (!name || !participants || !Array.isArray(participants) || participants.length === 0) {
                return { success: false, message: 'Group name and at least one participant are required' };
            }

            // Format participant JIDs
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

    /**
     * Add participants to a group
     * @param {string} groupId - Group JID
     * @param {Array<string>} participants - Array of phone numbers to add
     * @returns {Object}
     */
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

    /**
     * Remove participants from a group
     * @param {string} groupId - Group JID
     * @param {Array<string>} participants - Array of phone numbers to remove
     * @returns {Object}
     */
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

    /**
     * Promote participants to admin
     * @param {string} groupId - Group JID
     * @param {Array<string>} participants - Array of phone numbers to promote
     * @returns {Object}
     */
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

    /**
     * Demote participants from admin
     * @param {string} groupId - Group JID
     * @param {Array<string>} participants - Array of phone numbers to demote
     * @returns {Object}
     */
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

    /**
     * Update group subject (name)
     * @param {string} groupId - Group JID
     * @param {string} subject - New group name
     * @returns {Object}
     */
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

    /**
     * Update group description
     * @param {string} groupId - Group JID
     * @param {string} description - New group description
     * @returns {Object}
     */
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

    /**
     * Leave a group
     * @param {string} groupId - Group JID
     * @returns {Object}
     */
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

    /**
     * Join a group using invitation code
     * @param {string} inviteCode - Group invitation code (from invite link)
     * @returns {Object}
     */
    async groupJoinByInvite(inviteCode) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            if (!inviteCode) {
                return { success: false, message: 'Invitation code is required' };
            }

            // Remove URL prefix if present (https://chat.whatsapp.com/...)
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

    /**
     * Get group invitation code
     * @param {string} groupId - Group JID
     * @returns {Object}
     */
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

    /**
     * Revoke group invitation code
     * @param {string} groupId - Group JID
     * @returns {Object}
     */
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

    /**
     * Get group metadata
     * @param {string} groupId - Group JID
     * @returns {Object}
     */
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

    /**
     * Get all participating groups metadata
     * @returns {Object}
     */
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

    /**
     * Update group settings (who can send messages, who can edit group info)
     * @param {string} groupId - Group JID
     * @param {string} setting - 'announcement' (only admins send) or 'not_announcement' (all can send)
     *                          or 'locked' (only admins edit) or 'unlocked' (all can edit)
     * @returns {Object}
     */
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

    /**
     * Update group profile picture
     * @param {string} groupId - Group JID
     * @param {string} imageUrl - Image URL
     * @returns {Object}
     */
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

    // ==================== LABELS ====================

    /**
     * Get all labels
     * @returns {Object}
     */
    async getLabels() {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            const labels = this.socket.store?.labels;
            if (!labels) {
                return { success: false, message: 'Label store not available' };
            }

            const allLabels = labels.get()?.map?.(label => ({
                id: label.id,
                name: label.name,
                color: label.color,
                predefinedId: label.predefinedId || null
            })) || [];

            return {
                success: true,
                data: {
                    labels: allLabels,
                    count: allLabels.length
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Create or update a label
     * @param {string} name - Label name
     * @param {number} colorId - Color ID (0-19)
     * @param {string|null} labelId - Existing label ID to update (optional)
     * @returns {Object}
     */
    async createLabel(name, colorId = 0, labelId = null) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            if (!name) {
                return { success: false, message: 'Label name is required' };
            }

            if (colorId < 0 || colorId > 19) {
                return { success: false, message: 'Color ID must be between 0 and 19' };
            }

            const result = await this.socket.addLabel({
                name,
                color: colorId,
                id: labelId || undefined
            });

            return {
                success: true,
                message: labelId ? 'Label updated successfully' : 'Label created successfully',
                data: {
                    labelId: result.id || labelId,
                    name: name,
                    color: colorId
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Delete a label
     * @param {string} labelId - Label ID to delete
     * @returns {Object}
     */
    async deleteLabel(labelId) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            if (!labelId) {
                return { success: false, message: 'Label ID is required' };
            }

            const result = await this.socket.addLabel({
                name: '',
                color: 0,
                id: labelId,
                deleted: true
            });

            return {
                success: true,
                message: 'Label deleted successfully',
                data: {
                    labelId: labelId
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Add label to a chat
     * @param {string} chatId - Chat JID
     * @param {string} labelId - Label ID
     * @returns {Object}
     */
    async addChatLabel(chatId, labelId) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            if (!chatId || !labelId) {
                return { success: false, message: 'Chat ID and label ID are required' };
            }

            const isGroup = this.isGroupId(chatId);
            const jid = this.formatChatId(chatId, isGroup);
            await this.socket.chatModify({ addChatLabel: { type: 'label_jid', chatId: jid, labelId } }, jid);

            return {
                success: true,
                message: 'Label added to chat',
                data: {
                    chatId: jid,
                    labelId: labelId
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Remove label from a chat
     * @param {string} chatId - Chat JID
     * @param {string} labelId - Label ID
     * @returns {Object}
     */
    async removeChatLabel(chatId, labelId) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            if (!chatId || !labelId) {
                return { success: false, message: 'Chat ID and label ID are required' };
            }

            const isGroup = this.isGroupId(chatId);
            const jid = this.formatChatId(chatId, isGroup);
            await this.socket.chatModify({ removeChatLabel: { type: 'label_jid', chatId: jid, labelId } }, jid);

            return {
                success: true,
                message: 'Label removed from chat',
                data: {
                    chatId: jid,
                    labelId: labelId
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Get labels for a specific chat
     * @param {string} chatId - Chat JID
     * @returns {Object}
     */
    async getChatLabels(chatId) {
        try {
            if (!this.socket || this.connectionStatus !== 'connected') {
                return { success: false, message: 'Session not connected' };
            }

            if (!chatId) {
                return { success: false, message: 'Chat ID is required' };
            }

            const isGroup = this.isGroupId(chatId);
            const jid = this.formatChatId(chatId, isGroup);
            const chatLabelsRaw = this.socket.store?.getChatLabels?.(jid);
            const chatLabels = Array.isArray(chatLabelsRaw) ? chatLabelsRaw : [];

            const labels = this.socket.store?.labels;
            const allLabels = Array.isArray(labels?.get?.()) ? labels.get() : [];

            const chatLabelIds = chatLabels.map(cl => cl.labelId);
            const detailedLabels = allLabels.filter(l => chatLabelIds.includes(l.id)).map(l => ({
                id: l.id,
                name: l.name,
                color: l.color
            }));

            return {
                success: true,
                data: {
                    chatId: jid,
                    labels: detailedLabels
                }
            };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
}

module.exports = WhatsAppSession;
