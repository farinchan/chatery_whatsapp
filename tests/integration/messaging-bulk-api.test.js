const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { startTestServer, apiRequest, createMockSession, whatsappManager } = require('./test-helper');

describe('Messaging & Bulk API Integration Tests', () => {
    let testServer;
    let baseUrl;
    const SESSION_ID = 'test_msg_session';

    before(async () => {
        testServer = await startTestServer();
        baseUrl = testServer.baseUrl;
    });

    after(async () => {
        await testServer.stop();
    });

    beforeEach(() => {
        whatsappManager.sessions.clear();
        // Setup a default connected session
        const session = createMockSession(SESSION_ID, {
            connectionStatus: 'connected'
        });
        whatsappManager.sessions.set(SESSION_ID, session);
    });

    describe('checkSession Middleware Validation', () => {
        it('should return 400 when sessionId is missing from body', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/chats/send-text', {
                method: 'POST',
                body: { chatId: '628123@c.us', message: 'Hello' }
            });

            assert.strictEqual(res.status, 400);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Missing required field: sessionId');
        });

        it('should return 404 when session is not found', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/chats/send-text', {
                method: 'POST',
                body: { sessionId: 'unknown_session', chatId: '628123@c.us', message: 'Hello' }
            });

            assert.strictEqual(res.status, 404);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Session not found');
        });

        it('should return 400 when session is not connected', async () => {
            const discSession = createMockSession('disc_session', {
                connectionStatus: 'disconnected'
            });
            whatsappManager.sessions.set('disc_session', discSession);

            const res = await apiRequest(baseUrl, '/api/whatsapp/chats/send-text', {
                method: 'POST',
                body: { sessionId: 'disc_session', chatId: '628123@c.us', message: 'Hello' }
            });

            assert.strictEqual(res.status, 400);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Session not connected. Please scan QR code first.');
        });
    });

    describe('Parameter Validation on Message Endpoints', () => {
        it('POST /chats/send-text: should validate required chatId and message', async () => {
            // Missing message
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-text', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us' }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);
            assert.ok(res1.data.message.includes('Missing required fields'));

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-text', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', message: 'Test message' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /chats/send-image: should validate required chatId and imageUrl', async () => {
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-image', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us' }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);

            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-image', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', imageUrl: 'https://example.com/img.jpg', caption: 'Hi' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /chats/send-document: should validate required chatId, documentUrl, and filename', async () => {
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-document', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', documentUrl: 'https://example.com/doc.pdf' }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);

            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-document', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', documentUrl: 'https://example.com/doc.pdf', filename: 'report.pdf' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /chats/send-audio: should validate required audioUrl and OGG format', async () => {
            // Missing audioUrl
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-audio', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us' }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);

            // Invalid format (MP3 instead of OGG)
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-audio', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', audioUrl: 'https://example.com/voice.mp3' }
            });
            assert.strictEqual(res2.status, 400);
            assert.ok(res2.data.message.includes('Audio must be in OGG format'));

            // Valid OGG format
            const res3 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-audio', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', audioUrl: 'https://example.com/voice.ogg' }
            });
            assert.strictEqual(res3.status, 200);
            assert.strictEqual(res3.data.success, true);
        });

        it('POST /chats/send-location: should validate chatId, latitude, and longitude', async () => {
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-location', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', latitude: -6.2 }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);

            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-location', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', latitude: -6.2088, longitude: 106.8456, name: 'Jakarta' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /chats/send-contact: should validate chatId, contactName, and contactPhone', async () => {
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-contact', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', contactName: 'Alice' }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);

            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-contact', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', contactName: 'Alice', contactPhone: '628111222333' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /chats/send-button: should validate text and buttons array', async () => {
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-button', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', text: 'Hello' }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);

            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-button', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', text: 'Menu', buttons: ['Opt 1', 'Opt 2'] }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /chats/send-poll: should validate poll question and options range (2-12)', async () => {
            // Missing options
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-poll', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', question: 'Favorite color?' }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);

            // Less than 2 options
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-poll', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', question: 'Favorite color?', options: ['Blue'] }
            });
            assert.strictEqual(res2.status, 400);
            assert.ok(res2.data.message.includes('Poll must have between 2 and 12 options'));

            // Valid options
            const res3 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-poll', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', question: 'Favorite color?', options: ['Blue', 'Red', 'Green'] }
            });
            assert.strictEqual(res3.status, 200);
            assert.strictEqual(res3.data.success, true);
        });

        it('POST /chats/send-reaction: should validate chatId and messageId', async () => {
            // Missing messageId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-reaction', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us' }
            });
            assert.strictEqual(res1.status, 400);

            // Valid reaction
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-reaction', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', messageId: 'msg_123', emoji: '👍' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /chats/delete-message: should validate chatId and messageId', async () => {
            // Missing messageId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/delete-message', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us' }
            });
            assert.strictEqual(res1.status, 400);

            // Valid delete
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/delete-message', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', messageId: 'msg_123' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /chats/presence: should validate chatId and valid presence options', async () => {
            // Missing chatId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/presence', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);

            // Invalid presence
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/presence', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', presence: 'dancing' }
            });
            assert.strictEqual(res2.status, 400);
            assert.ok(res2.data.message.includes('Invalid presence'));

            // Valid presence
            const res3 = await apiRequest(baseUrl, '/api/whatsapp/chats/presence', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123@c.us', presence: 'composing' }
            });
            assert.strictEqual(res3.status, 200);
            assert.strictEqual(res3.data.success, true);
        });

        it('POST /chats/check-number: should validate phone number', async () => {
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/check-number', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);

            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/check-number', {
                method: 'POST',
                body: { sessionId: SESSION_ID, phone: '628123456789' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /chats/profile-picture: should validate phone number', async () => {
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/profile-picture', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);

            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/profile-picture', {
                method: 'POST',
                body: { sessionId: SESSION_ID, phone: '628123456789' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /chats/mark-read: should validate chatId', async () => {
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/mark-read', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);

            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/mark-read', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123456789@c.us' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /chats/overview: should return chat overview data', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/chats/overview', {
                method: 'POST',
                body: { sessionId: SESSION_ID, limit: 10 }
            });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.ok(Array.isArray(res.data.data));
        });

        it('POST /contacts: should return contacts list', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/contacts', {
                method: 'POST',
                body: { sessionId: SESSION_ID, limit: 20 }
            });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.ok(Array.isArray(res.data.data));
        });

        it('POST /chats/messages: should validate chatId and return messages', async () => {
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/messages', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);

            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/messages', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123456789@c.us', limit: 10 }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
            assert.ok(Array.isArray(res2.data.data));
        });

        it('POST /chats/info: should validate chatId and return info', async () => {
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/info', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);

            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/info', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123456789@c.us' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
            assert.ok(res2.data.data);
        });
    });

    describe('Bulk Messaging (Background Jobs)', () => {
        it('POST /chats/send-bulk: should validate recipients and message, enforce max 100 limit', async () => {
            // Missing recipients
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-bulk', {
                method: 'POST',
                body: { sessionId: SESSION_ID, message: 'Broadcast' }
            });
            assert.strictEqual(res1.status, 400);
            assert.ok(res1.data.message.includes('recipients'));

            // Empty recipients
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-bulk', {
                method: 'POST',
                body: { sessionId: SESSION_ID, recipients: [], message: 'Broadcast' }
            });
            assert.strictEqual(res2.status, 400);

            // Missing message
            const res3 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-bulk', {
                method: 'POST',
                body: { sessionId: SESSION_ID, recipients: ['628111'] }
            });
            assert.strictEqual(res3.status, 400);
            assert.ok(res3.data.message.includes('message'));

            // Exceeds max 100 limit
            const overLimit = Array.from({ length: 101 }, (_, i) => `628000${i}`);
            const res4 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-bulk', {
                method: 'POST',
                body: { sessionId: SESSION_ID, recipients: overLimit, message: 'Broadcast' }
            });
            assert.strictEqual(res4.status, 400);
            assert.ok(res4.data.message.includes('Maximum 100 recipients'));

            // Valid bulk text message
            const res5 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-bulk', {
                method: 'POST',
                body: {
                    sessionId: SESSION_ID,
                    recipients: ['628111222', '628333444'],
                    message: 'Hello everyone',
                    delayBetweenMessages: 0
                }
            });
            assert.strictEqual(res5.status, 200);
            assert.strictEqual(res5.data.success, true);
            assert.ok(res5.data.data.jobId);
            assert.strictEqual(res5.data.data.total, 2);
            assert.ok(res5.data.data.statusUrl);
        });

        it('POST /chats/send-bulk-image: should validate recipients and imageUrl', async () => {
            // Missing imageUrl
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-bulk-image', {
                method: 'POST',
                body: { sessionId: SESSION_ID, recipients: ['628111'] }
            });
            assert.strictEqual(res1.status, 400);
            assert.ok(res1.data.message.includes('imageUrl'));

            // Valid bulk image
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-bulk-image', {
                method: 'POST',
                body: {
                    sessionId: SESSION_ID,
                    recipients: ['628111222'],
                    imageUrl: 'https://example.com/promo.jpg',
                    caption: 'Promo!',
                    delayBetweenMessages: 0
                }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
            assert.ok(res2.data.data.jobId);
        });

        it('POST /chats/send-bulk-document: should validate recipients, documentUrl, and filename', async () => {
            // Missing filename
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-bulk-document', {
                method: 'POST',
                body: { sessionId: SESSION_ID, recipients: ['628111'], documentUrl: 'https://example.com/invoice.pdf' }
            });
            assert.strictEqual(res1.status, 400);
            assert.ok(res1.data.message.includes('filename'));

            // Valid bulk document
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/chats/send-bulk-document', {
                method: 'POST',
                body: {
                    sessionId: SESSION_ID,
                    recipients: ['628111222'],
                    documentUrl: 'https://example.com/invoice.pdf',
                    filename: 'invoice.pdf',
                    delayBetweenMessages: 0
                }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
            assert.ok(res2.data.data.jobId);
        });

        it('GET /chats/bulk-status/:jobId: should track job status and return 404 for unknown job', async () => {
            // Unknown job
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/chats/bulk-status/unknown_job_id');
            assert.strictEqual(res1.status, 404);
            assert.strictEqual(res1.data.success, false);
            assert.strictEqual(res1.data.message, 'Job not found');

            // Create a bulk job and check status
            const createRes = await apiRequest(baseUrl, '/api/whatsapp/chats/send-bulk', {
                method: 'POST',
                body: {
                    sessionId: SESSION_ID,
                    recipients: ['628111', '628222'],
                    message: 'Status check job',
                    delayBetweenMessages: 0
                }
            });
            const jobId = createRes.data.data.jobId;

            // Wait brief moment for background processing to complete
            await new Promise((r) => setTimeout(r, 50));

            const statusRes = await apiRequest(baseUrl, `/api/whatsapp/chats/bulk-status/${jobId}`);
            assert.strictEqual(statusRes.status, 200);
            assert.strictEqual(statusRes.data.success, true);
            assert.strictEqual(statusRes.data.data.sessionId, SESSION_ID);
            assert.strictEqual(statusRes.data.data.total, 2);
            assert.ok(['processing', 'completed'].includes(statusRes.data.data.status));
        });

        it('POST /chats/bulk-jobs: should list all jobs for a session', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/chats/bulk-jobs', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.ok(Array.isArray(res.data.data));
            assert.ok(res.data.data.length > 0);
        });
    });
});
