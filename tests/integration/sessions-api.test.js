const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { startTestServer, apiRequest, createMockSession, whatsappManager, TEST_API_KEY } = require('./test-helper');

describe('Sessions API Integration Tests', () => {
    let testServer;
    let baseUrl;

    before(async () => {
        testServer = await startTestServer();
        baseUrl = testServer.baseUrl;
    });

    after(async () => {
        await testServer.stop();
    });

    beforeEach(() => {
        whatsappManager.sessions.clear();
    });

    describe('API Key Authentication on /api/whatsapp/*', () => {
        it('should return 401 when X-Api-Key header is missing', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions', {
                skipApiKey: true
            });

            assert.strictEqual(res.status, 401);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Missing X-Api-Key header');
        });

        it('should return 403 when X-Api-Key is invalid', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions', {
                apiKey: 'invalid-wrong-api-key'
            });

            assert.strictEqual(res.status, 403);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Invalid API key');
        });
    });

    describe('GET /api/whatsapp/sessions', () => {
        it('should return empty list when no sessions exist', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions');

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.message, 'Sessions retrieved');
            assert.ok(Array.isArray(res.data.data));
            assert.strictEqual(res.data.data.length, 0);
        });

        it('should return list of sessions with correct structure', async () => {
            const session = createMockSession('session_1', {
                connectionStatus: 'connected',
                phoneNumber: '628123456789',
                name: 'Main Session',
                metadata: { env: 'testing' },
                webhooks: [{ url: 'https://example.com/webhook', events: ['message'] }]
            });
            whatsappManager.sessions.set('session_1', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions');

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.data.length, 1);

            const s = res.data.data[0];
            assert.strictEqual(s.sessionId, 'session_1');
            assert.strictEqual(s.status, 'connected');
            assert.strictEqual(s.isConnected, true);
            assert.strictEqual(s.phoneNumber, '628123456789');
            assert.strictEqual(s.name, 'Main Session');
            assert.deepStrictEqual(s.metadata, { env: 'testing' });
            assert.strictEqual(s.webhooks.length, 1);
        });
    });

    describe('POST /api/whatsapp/sessions/:sessionId/connect', () => {
        it('should create and connect a new session', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/new_session/connect', {
                method: 'POST',
                body: {
                    metadata: { tenantId: 'tenant-123' },
                    webhooks: [{ url: 'https://test.com/hook', events: ['all'] }]
                }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.message, 'Session created');
            assert.strictEqual(res.data.data.sessionId, 'new_session');
            assert.deepStrictEqual(res.data.data.metadata, { tenantId: 'tenant-123' });
            assert.strictEqual(res.data.data.webhooks.length, 1);
        });

        it('should return failure when session is already connected', async () => {
            const session = createMockSession('connected_session', {
                connectionStatus: 'connected'
            });
            whatsappManager.sessions.set('connected_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/connected_session/connect', {
                method: 'POST',
                body: {}
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Session already connected');
        });

        it('should return failure for invalid session ID', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/invalid!session/connect', {
                method: 'POST',
                body: {}
            });

            assert.strictEqual(res.data.success, false);
            assert.ok(res.data.message.includes('Invalid session ID'));
        });
    });

    describe('GET /api/whatsapp/sessions/:sessionId/status', () => {
        it('should return 404 if session not found', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/non_existent/status');

            assert.strictEqual(res.status, 404);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Session not found');
        });

        it('should return session status when session exists', async () => {
            const session = createMockSession('status_session', {
                connectionStatus: 'connected',
                phoneNumber: '628999888777',
                name: 'Status Test'
            });
            whatsappManager.sessions.set('status_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/status_session/status');

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.message, 'Status retrieved');
            assert.strictEqual(res.data.data.sessionId, 'status_session');
            assert.strictEqual(res.data.data.status, 'connected');
            assert.strictEqual(res.data.data.isConnected, true);
            assert.strictEqual(res.data.data.phoneNumber, '628999888777');
        });
    });

    describe('PATCH /api/whatsapp/sessions/:sessionId/config', () => {
        it('should return 404 if session not found', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/missing_session/config', {
                method: 'PATCH',
                body: { metadata: { key: 'val' } }
            });

            assert.strictEqual(res.status, 404);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Session not found');
        });

        it('should update metadata and webhooks configuration', async () => {
            const session = createMockSession('cfg_session', {
                metadata: { old: 'value' },
                webhooks: []
            });
            whatsappManager.sessions.set('cfg_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/cfg_session/config', {
                method: 'PATCH',
                body: {
                    metadata: { newKey: 'newValue' },
                    webhooks: [{ url: 'https://newhook.com/wh', events: ['messages.upsert'] }]
                }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.message, 'Session config updated');
            assert.strictEqual(res.data.data.metadata.newKey, 'newValue');
            assert.strictEqual(res.data.data.webhooks.length, 1);
        });
    });

    describe('POST & DELETE /api/whatsapp/sessions/:sessionId/webhooks', () => {
        it('POST should return 400 when url is missing', async () => {
            const session = createMockSession('wh_session');
            whatsappManager.sessions.set('wh_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/wh_session/webhooks', {
                method: 'POST',
                body: {}
            });

            assert.strictEqual(res.status, 400);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Missing required field: url');
        });

        it('POST should return 404 if session does not exist', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/nonexistent/webhooks', {
                method: 'POST',
                body: { url: 'https://wh.com' }
            });

            assert.strictEqual(res.status, 404);
            assert.strictEqual(res.data.success, false);
        });

        it('POST should successfully add a webhook', async () => {
            const session = createMockSession('wh_session', { webhooks: [] });
            whatsappManager.sessions.set('wh_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/wh_session/webhooks', {
                method: 'POST',
                body: { url: 'https://hook.org/callback', events: ['message', 'presence'] }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.message, 'Webhook added');
            assert.strictEqual(res.data.data.webhooks.length, 1);
            assert.strictEqual(res.data.data.webhooks[0].url, 'https://hook.org/callback');
        });

        it('DELETE should return 400 when url is missing', async () => {
            const session = createMockSession('wh_session');
            whatsappManager.sessions.set('wh_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/wh_session/webhooks', {
                method: 'DELETE',
                body: {}
            });

            assert.strictEqual(res.status, 400);
            assert.strictEqual(res.data.success, false);
            assert.ok(res.data.message.includes('Missing required field: url'));
        });

        it('DELETE should return 404 if session does not exist', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/unknown_wh/webhooks', {
                method: 'DELETE',
                body: { url: 'https://wh.com' }
            });

            assert.strictEqual(res.status, 404);
            assert.strictEqual(res.data.success, false);
        });

        it('DELETE should remove webhook from session', async () => {
            const session = createMockSession('wh_session', {
                webhooks: [
                    { url: 'https://hook.org/1', events: ['all'] },
                    { url: 'https://hook.org/2', events: ['all'] }
                ]
            });
            whatsappManager.sessions.set('wh_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/wh_session/webhooks', {
                method: 'DELETE',
                body: { url: 'https://hook.org/1' }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.message, 'Webhook removed');
            assert.strictEqual(res.data.data.webhooks.length, 1);
            assert.strictEqual(res.data.data.webhooks[0].url, 'https://hook.org/2');
        });
    });

    describe('GET /api/whatsapp/sessions/:sessionId/qr and /qr/image', () => {
        it('GET /qr should return 404 when session not found', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/no_session/qr');

            assert.strictEqual(res.status, 404);
            assert.strictEqual(res.data.success, false);
            assert.ok(res.data.message.includes('Session not found'));
        });

        it('GET /qr should return already connected message when connected', async () => {
            const session = createMockSession('conn_session', {
                connectionStatus: 'connected'
            });
            whatsappManager.sessions.set('conn_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/conn_session/qr');

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.message, 'Already connected to WhatsApp');
            assert.strictEqual(res.data.data.status, 'connected');
            assert.strictEqual(res.data.data.qrCode, null);
        });

        it('GET /qr should return 404 when QR code is not available yet', async () => {
            const session = createMockSession('wait_qr_session', {
                connectionStatus: 'connecting',
                qrCode: null
            });
            whatsappManager.sessions.set('wait_qr_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/wait_qr_session/qr');

            assert.strictEqual(res.status, 404);
            assert.strictEqual(res.data.success, false);
            assert.ok(res.data.message.includes('QR Code not available yet'));
        });

        it('GET /qr should return QR code string when available', async () => {
            const mockQr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const session = createMockSession('qr_ready_session', {
                connectionStatus: 'qr_ready',
                qrCode: mockQr
            });
            whatsappManager.sessions.set('qr_ready_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/qr_ready_session/qr');

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.message, 'QR Code ready');
            assert.strictEqual(res.data.data.qrCode, mockQr);
            assert.strictEqual(res.data.data.status, 'qr_ready');
        });

        it('GET /qr/image should return 404 when QR is not available', async () => {
            const session = createMockSession('no_qr_img_session', {
                connectionStatus: 'connecting',
                qrCode: null
            });
            whatsappManager.sessions.set('no_qr_img_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/no_qr_img_session/qr/image');

            assert.strictEqual(res.status, 404);
            assert.strictEqual(res.text, 'QR Code not available');
        });

        it('GET /qr/image should return image/png binary when QR code is available', async () => {
            const mockQr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            const session = createMockSession('img_qr_session', {
                connectionStatus: 'qr_ready',
                qrCode: mockQr
            });
            whatsappManager.sessions.set('img_qr_session', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/img_qr_session/qr/image');

            assert.strictEqual(res.status, 200);
            const contentType = res.headers.get('content-type');
            assert.strictEqual(contentType, 'image/png');
        });
    });

    describe('DELETE /api/whatsapp/sessions/:sessionId', () => {
        it('should return failure when session does not exist', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/nonexistent/delete', {
                method: 'DELETE'
            });

            // Endpoint is DELETE /sessions/:sessionId
            const resDirect = await apiRequest(baseUrl, '/api/whatsapp/sessions/nonexistent', {
                method: 'DELETE'
            });

            assert.strictEqual(resDirect.status, 200);
            assert.strictEqual(resDirect.data.success, false);
            assert.strictEqual(resDirect.data.message, 'Session not found');
        });

        it('should delete existing session successfully', async () => {
            const session = createMockSession('delete_me');
            whatsappManager.sessions.set('delete_me', session);

            const res = await apiRequest(baseUrl, '/api/whatsapp/sessions/delete_me', {
                method: 'DELETE'
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.message, 'Session deleted successfully');
            assert.strictEqual(whatsappManager.sessions.has('delete_me'), false);
        });
    });
});
