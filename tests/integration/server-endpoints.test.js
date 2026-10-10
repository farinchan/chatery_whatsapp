const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { startTestServer, apiRequest } = require('./test-helper');

describe('Server Endpoints Integration Tests', () => {
    let testServer;
    let baseUrl;

    before(async () => {
        testServer = await startTestServer();
        baseUrl = testServer.baseUrl;
    });

    after(async () => {
        await testServer.stop();
    });

    describe('GET /api/health', () => {
        it('should return server health status with success, message, and timestamp', async () => {
            const res = await apiRequest(baseUrl, '/api/health');

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.message, 'Server is running');
            assert.ok(res.data.timestamp);
            assert.ok(!isNaN(Date.parse(res.data.timestamp)));
        });
    });

    describe('GET /api-docs.json', () => {
        it('should return valid OpenAPI 3.0 specification JSON', async () => {
            const res = await apiRequest(baseUrl, '/api-docs.json');

            assert.strictEqual(res.status, 200);
            assert.ok(res.data);
            assert.strictEqual(res.data.openapi, '3.0.0');
            assert.ok(res.data.info);
            assert.strictEqual(res.data.info.title, 'Chatery WhatsApp API');
            assert.ok(res.data.paths);
            assert.ok(Object.keys(res.data.paths).length > 0);
            assert.ok(res.data.components);
        });
    });

    describe('GET / (Swagger UI Documentation)', () => {
        it('should serve Swagger UI HTML page with status 200', async () => {
            const res = await apiRequest(baseUrl, '/', { skipApiKey: true });

            assert.strictEqual(res.status, 200);
            const contentType = res.headers.get('content-type');
            assert.ok(contentType.includes('text/html'));
            assert.ok(res.text.includes('swagger-ui') || res.text.includes('html'));
        });
    });

    describe('POST /api/dashboard/login', () => {
        it('should login successfully with valid credentials', async () => {
            const validUsername = process.env.DASHBOARD_USERNAME || 'admin';
            const validPassword = process.env.DASHBOARD_PASSWORD || 'admin';

            const res = await apiRequest(baseUrl, '/api/dashboard/login', {
                method: 'POST',
                body: { username: validUsername, password: validPassword },
                skipApiKey: true
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.strictEqual(res.data.message, 'Login successful');
        });

        it('should fail with 401 when invalid credentials are provided', async () => {
            const res = await apiRequest(baseUrl, '/api/dashboard/login', {
                method: 'POST',
                body: { username: 'invalid_user', password: 'wrong_password' },
                skipApiKey: true
            });

            assert.strictEqual(res.status, 401);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Invalid username or password');
        });

        it('should fail with 401 when missing username or password', async () => {
            const res = await apiRequest(baseUrl, '/api/dashboard/login', {
                method: 'POST',
                body: {},
                skipApiKey: true
            });

            assert.strictEqual(res.status, 401);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Invalid username or password');
        });
    });

    describe('GET /api/websocket/stats', () => {
        it('should return WebSocket statistics data structure', async () => {
            const res = await apiRequest(baseUrl, '/api/websocket/stats');

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.ok(res.data.data !== undefined);
            assert.strictEqual(typeof res.data.data.totalConnections, 'number');
            assert.strictEqual(typeof res.data.data.sessionRooms, 'object');
        });
    });

    describe('404 Not Found Handler', () => {
        it('should return 404 JSON response for nonexistent routes', async () => {
            const res = await apiRequest(baseUrl, '/api/non-existent-endpoint');

            assert.strictEqual(res.status, 404);
            assert.strictEqual(res.data.success, false);
            assert.strictEqual(res.data.message, 'Route not found');
        });
    });
});
