const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { startTestServer, apiRequest } = require('./test-helper');

describe('Dashboard Authentication & Route Protection Tests', () => {
    let testServer;
    let baseUrl;

    before(async () => {
        testServer = await startTestServer();
        baseUrl = testServer.baseUrl;
    });

    after(async () => {
        await testServer.stop();
    });

    describe('Unauthenticated Route Access', () => {
        it('should redirect GET /dashboard to /login when unauthenticated', async () => {
            const res = await fetch(`${baseUrl}/dashboard`, { redirect: 'manual' });
            assert.strictEqual(res.status, 302);
            assert.ok(res.headers.get('location').includes('/login'));
        });

        it('should redirect GET /wa-web to /login when unauthenticated', async () => {
            const res = await fetch(`${baseUrl}/wa-web`, { redirect: 'manual' });
            assert.strictEqual(res.status, 302);
            assert.ok(res.headers.get('location').includes('/login'));
        });

        it('should return 401 for GET /api/dashboard/session when unauthenticated', async () => {
            const res = await fetch(`${baseUrl}/api/dashboard/session`);
            assert.strictEqual(res.status, 401);
            const data = await res.json();
            assert.strictEqual(data.authenticated, false);
        });

        it('should serve login page at GET /login', async () => {
            const res = await fetch(`${baseUrl}/login`);
            assert.strictEqual(res.status, 200);
            const text = await res.text();
            assert.ok(text.includes('Sign In'));
        });
    });

    describe('Login & Protected Route Access Flow', () => {
        let authCookie = null;
        let apiKey = null;

        it('should login successfully and return session cookie and apiKey', async () => {
            const validUsername = process.env.DASHBOARD_USERNAME || 'admin';
            const validPassword = process.env.DASHBOARD_PASSWORD || 'admin';

            const res = await fetch(`${baseUrl}/api/dashboard/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: validUsername, password: validPassword })
            });

            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.strictEqual(data.success, true);
            assert.ok(data.apiKey !== undefined);
            apiKey = data.apiKey;

            const setCookie = res.headers.get('set-cookie');
            assert.ok(setCookie && setCookie.includes('chatery_session'));
            authCookie = setCookie.split(';')[0];
        });

        it('should return authenticated status from GET /api/dashboard/session with cookie', async () => {
            const res = await fetch(`${baseUrl}/api/dashboard/session`, {
                headers: { Cookie: authCookie }
            });

            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.strictEqual(data.authenticated, true);
            assert.strictEqual(data.apiKey, apiKey);
        });

        it('should allow access to GET /dashboard with valid session cookie', async () => {
            const res = await fetch(`${baseUrl}/dashboard`, {
                headers: { Cookie: authCookie },
                redirect: 'manual'
            });

            assert.strictEqual(res.status, 200);
            const text = await res.text();
            assert.ok(text.includes('Dashboard & Session Manager'));
        });

        it('should allow access to GET /wa-web with valid session cookie', async () => {
            const res = await fetch(`${baseUrl}/wa-web`, {
                headers: { Cookie: authCookie },
                redirect: 'manual'
            });

            assert.strictEqual(res.status, 200);
            const text = await res.text();
            assert.ok(text.includes('Chatery Web'));
        });

        it('should redirect GET /login to /dashboard when already authenticated', async () => {
            const res = await fetch(`${baseUrl}/login`, {
                headers: { Cookie: authCookie },
                redirect: 'manual'
            });

            assert.strictEqual(res.status, 302);
            assert.strictEqual(res.headers.get('location'), '/dashboard');
        });

        it('should logout and clear session cookie', async () => {
            const res = await fetch(`${baseUrl}/api/dashboard/logout`, {
                method: 'POST',
                headers: { Cookie: authCookie }
            });

            assert.strictEqual(res.status, 200);
            const data = await res.json();
            assert.strictEqual(data.success, true);

            // Verify session is now invalid
            const sessionRes = await fetch(`${baseUrl}/api/dashboard/session`);
            assert.strictEqual(sessionRes.status, 401);
        });
    });
});
