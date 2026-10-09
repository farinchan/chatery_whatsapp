process.env.NODE_ENV = 'test';
const http = require('http');
const whatsappManager = require('../../src/services/whatsapp');
const wsManager = require('../../src/services/websocket/WebSocketManager');
const { app, server } = require('../../index');

const TEST_API_KEY = process.env.API_KEY || '123456';

/**
 * Creates a mock WhatsAppSession object with all required controller methods
 */
function createMockSession(sessionId, overrides = {}) {
    const connectionStatus = overrides.connectionStatus || 'connected';
    
    const mockSession = {
        sessionId,
        connectionStatus,
        phoneNumber: overrides.phoneNumber || '628123456789',
        name: overrides.name || 'Test User',
        qrCode: overrides.qrCode !== undefined ? overrides.qrCode : (connectionStatus === 'qr_ready' ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' : null),
        metadata: overrides.metadata || {},
        webhooks: overrides.webhooks || [],
        
        getInfo() {
            return {
                sessionId: this.sessionId,
                status: this.connectionStatus,
                isConnected: this.connectionStatus === 'connected',
                phoneNumber: this.phoneNumber,
                name: this.name,
                qrCode: this.qrCode,
                storeStats: { chats: 5, messages: 20, contacts: 10 },
                metadata: this.metadata,
                webhooks: this.webhooks
            };
        },
        
        updateConfig(options = {}) {
            if (options.metadata !== undefined) {
                this.metadata = { ...this.metadata, ...options.metadata };
            }
            if (options.webhooks !== undefined) {
                this.webhooks = options.webhooks;
            }
            return this.getInfo();
        },
        
        addWebhook(url, events = ['all']) {
            const exists = this.webhooks.find(w => w.url === url);
            if (exists) {
                exists.events = events;
            } else {
                this.webhooks.push({ url, events });
            }
            return this.getInfo();
        },
        
        removeWebhook(url) {
            this.webhooks = this.webhooks.filter(w => w.url !== url);
            return this.getInfo();
        },
        
        async logout() {
            this.connectionStatus = 'disconnected';
            this.qrCode = null;
            return { success: true, message: 'Logged out successfully' };
        },
        
        // Chat APIs
        async sendTextMessage(chatId, message, typingTime = 0, replyTo = null) {
            return { success: true, message: 'Message sent', data: { messageId: 'msg_test_text_1' } };
        },
        async sendImage(chatId, imageUrl, caption = '', typingTime = 0, replyTo = null) {
            return { success: true, message: 'Image sent', data: { messageId: 'msg_test_img_1' } };
        },
        async sendDocument(chatId, documentUrl, filename, mimetype, caption = '', typingTime = 0, replyTo = null) {
            return { success: true, message: 'Document sent', data: { messageId: 'msg_test_doc_1' } };
        },
        async sendAudio(chatId, audioUrl, ptt = false, typingTime = 0, replyTo = null) {
            return { success: true, message: 'Audio sent', data: { messageId: 'msg_test_aud_1' } };
        },
        async sendLocation(chatId, latitude, longitude, name = '', typingTime = 0, replyTo = null) {
            return { success: true, message: 'Location sent', data: { messageId: 'msg_test_loc_1' } };
        },
        async sendContact(chatId, contactName, contactPhone, typingTime = 0, replyTo = null) {
            return { success: true, message: 'Contact sent', data: { messageId: 'msg_test_cnt_1' } };
        },
        async sendButton(chatId, text, footer = '', buttons = [], typingTime = 0, replyTo = null) {
            return { success: true, message: 'Button sent', data: { messageId: 'msg_test_btn_1' } };
        },
        async sendPoll(chatId, question, options = [], selectableCount = 1, typingTime = 0, replyTo = null) {
            return { success: true, message: 'Poll sent', data: { messageId: 'msg_test_poll_1' } };
        },
        async sendReaction(chatId, messageId, emoji = '', fromMe = false) {
            return { success: true, message: emoji ? 'Reaction sent' : 'Reaction removed', data: { chatId, messageId, emoji } };
        },
        async deleteMessage(chatId, messageId) {
            return { success: true, message: 'Message deleted', data: { chatId, messageId } };
        },
        async sendPresenceUpdate(chatId, presence = 'composing') {
            return { success: true, message: `Presence '${presence}' sent` };
        },
        async isRegistered(phone) {
            return { success: true, isRegistered: true, jid: `${phone}@s.whatsapp.net` };
        },
        async getProfilePicture(phone) {
            return { success: true, profilePictureUrl: 'https://example.com/pic.jpg' };
        },
        async getChatsOverview(limit = 50, offset = 0, type = 'all') {
            return { success: true, data: [{ chatId: '628123456789@c.us', unreadCount: 0 }] };
        },
        async getContacts(limit = 100, offset = 0, search = '') {
            return { success: true, data: [{ id: '628123456789@c.us', name: 'John Doe' }] };
        },
        async getChatMessages(chatId, limit = 50, cursor = null) {
            return { success: true, data: [{ messageId: 'm1', text: 'Hello' }] };
        },
        async getChatInfo(chatId) {
            return { success: true, data: { id: chatId, name: 'Chat Info' } };
        },
        async markChatRead(chatId, messageId = null) {
            return { success: true, message: 'Chat marked as read' };
        },
        
        // Groups
        async createGroup(name, participants) {
            return { success: true, data: { id: 'group_test_1@g.us', name, participants } };
        },
        async getAllGroups() {
            return { success: true, data: [{ id: 'group_test_1@g.us', subject: 'Test Group' }] };
        },
        async groupGetMetadata(groupId) {
            return { success: true, data: { id: groupId, subject: 'Test Group' } };
        },
        async groupAddParticipants(groupId, participants) {
            return { success: true, data: { added: participants } };
        },
        async groupRemoveParticipants(groupId, participants) {
            return { success: true, data: { removed: participants } };
        },
        async groupPromoteParticipants(groupId, participants) {
            return { success: true, data: { promoted: participants } };
        },
        async groupDemoteParticipants(groupId, participants) {
            return { success: true, data: { demoted: participants } };
        },
        async groupUpdateSubject(groupId, subject) {
            return { success: true, message: 'Group subject updated' };
        },
        async groupUpdateDescription(groupId, description) {
            return { success: true, message: 'Group description updated' };
        },
        async groupUpdateSettings(groupId, setting) {
            return { success: true, message: 'Group settings updated' };
        },
        async groupUpdateProfilePicture(groupId, imageUrl) {
            return { success: true, message: 'Group picture updated' };
        },
        async groupLeave(groupId) {
            return { success: true, message: 'Left group' };
        },
        async groupJoinByInvite(inviteCode) {
            return { success: true, message: 'Joined group' };
        },
        async groupGetInviteCode(groupId) {
            return { success: true, data: { inviteCode: 'code123' } };
        },
        async groupRevokeInvite(groupId) {
            return { success: true, data: { inviteCode: 'newcode123' } };
        },
        
        // Labels
        async getLabels() {
            return { success: true, data: [{ id: '1', name: 'New Customer', color: 1 }] };
        },
        async createLabel(name, colorId = 0, labelId = null) {
            return { success: true, data: { id: labelId || 'label_test_1', name, colorId } };
        },
        async deleteLabel(labelId) {
            return { success: true, message: 'Label deleted' };
        },
        async addChatLabel(chatId, labelId) {
            return { success: true, message: 'Label added to chat', data: { chatId, labelId } };
        },
        async removeChatLabel(chatId, labelId) {
            return { success: true, message: 'Label removed from chat', data: { chatId, labelId } };
        },
        async getChatLabels(chatId) {
            return { success: true, data: { chatId, labels: [{ id: '1', name: 'New Customer' }] } };
        },
        
        ...overrides
    };

    return mockSession;
}

let originalCreateSession = null;

/**
 * Setup mock createSession on whatsappManager to avoid real Baileys connections
 */
function mockWhatsAppManager() {
    if (!originalCreateSession) {
        originalCreateSession = whatsappManager.createSession.bind(whatsappManager);
    }
    
    whatsappManager.createSession = async function(sessionId, options = {}) {
        if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
            return {
                success: false,
                message: 'Invalid session ID. Use only letters, numbers, underscore, and dash.'
            };
        }

        if (this.sessions.has(sessionId)) {
            const existingSession = this.sessions.get(sessionId);
            if (options.metadata || options.webhooks) {
                existingSession.updateConfig(options);
            }
            if (existingSession.connectionStatus === 'connected') {
                return {
                    success: false,
                    message: 'Session already connected',
                    data: existingSession.getInfo()
                };
            }
            return {
                success: true,
                message: 'Reconnecting existing session',
                data: existingSession.getInfo()
            };
        }

        const session = createMockSession(sessionId, {
            connectionStatus: 'qr_ready',
            metadata: options.metadata || {},
            webhooks: options.webhooks || []
        });
        this.sessions.set(sessionId, session);

        return {
            success: true,
            message: 'Session created',
            data: session.getInfo()
        };
    };
}

function restoreWhatsAppManager() {
    if (originalCreateSession) {
        whatsappManager.createSession = originalCreateSession;
    }
}

/**
 * Start test server on random ephemeral port (port 0)
 */
async function startTestServer() {
    mockWhatsAppManager();
    
    return new Promise((resolve) => {
        server.listen(0, () => {
            const port = server.address().port;
            const baseUrl = `http://127.0.0.1:${port}`;
            
            const stop = async () => {
                restoreWhatsAppManager();
                whatsappManager.sessions.clear();
                if (wsManager.io) {
                    try { wsManager.io.close(); } catch (e) {}
                }
                await new Promise((res) => server.close(res));
            };
            
            resolve({ baseUrl, server, stop });
        });
    });
}

/**
 * Helper to make HTTP request to test server
 */
async function apiRequest(baseUrl, path, options = {}) {
    const url = `${baseUrl}${path}`;
    const headers = {
        'Content-Type': 'application/json',
        ...(options.skipApiKey ? {} : { 'X-Api-Key': options.apiKey || TEST_API_KEY }),
        ...(options.headers || {})
    };
    
    const fetchOptions = {
        method: options.method || 'GET',
        headers
    };
    
    if (options.body !== undefined) {
        fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    
    const response = await fetch(url, fetchOptions);
    let json = null;
    let text = null;
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
        json = await response.json();
    } else {
        text = await response.text();
    }
    
    return {
        status: response.status,
        headers: response.headers,
        data: json,
        text
    };
}

module.exports = {
    TEST_API_KEY,
    createMockSession,
    whatsappManager,
    startTestServer,
    apiRequest
};
