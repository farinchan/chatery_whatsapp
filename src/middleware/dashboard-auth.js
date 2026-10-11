const crypto = require('crypto');

const AUTH_SECRET = process.env.SESSION_SECRET || process.env.API_KEY || 'chatery_secure_dashboard_secret_2026';

/**
 * Creates an HMAC-signed auth token with a 24-hour expiration
 * @param {string} username 
 * @returns {string} base64url-encoded signed token
 */
function createAuthToken(username) {
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    const payload = `${username}:${expiresAt}`;
    const hmac = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

/**
 * Verifies the HMAC signature, username, and expiration of the token
 * @param {string} token 
 * @returns {{username: string, expiresAt: number}|false}
 */
function verifyAuthToken(token) {
    if (!token) return false;
    try {
        const decoded = Buffer.from(token, 'base64url').toString('utf-8');
        const parts = decoded.split(':');
        if (parts.length !== 3) return false;

        const [username, expiresAt, hmac] = parts;
        if (Date.now() > Number(expiresAt)) return false;

        const validUsername = process.env.DASHBOARD_USERNAME || 'admin';
        if (username !== validUsername) return false;

        const payload = `${username}:${expiresAt}`;
        const expectedHmac = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');

        const hmacBuf = Buffer.from(hmac);
        const expectedBuf = Buffer.from(expectedHmac);
        if (hmacBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(hmacBuf, expectedBuf)) {
            return false;
        }

        return { username, expiresAt: Number(expiresAt) };
    } catch {
        return false;
    }
}

/**
 * Parses a specific cookie value from a request object or Cookie header string
 * @param {import('express').Request|string} reqOrString 
 * @param {string} name 
 * @returns {string|null}
 */
function parseCookie(reqOrString, name) {
    const cookieHeader = typeof reqOrString === 'string' 
        ? reqOrString 
        : reqOrString?.headers?.cookie;
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Middleware to protect Dashboard & WA-Web HTML pages and stats endpoints.
 * Accepts either valid dashboard session cookie/token or valid X-Api-Key.
 * Redirects unauthenticated browser requests to /login, returns 401/403 for API routes.
 */
function dashboardAuthGuard(req, res, next) {
    const token = parseCookie(req, 'chatery_session') || req.headers['x-auth-token'];

    // Also allow direct API key authentication
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const configuredApiKey = process.env.API_KEY;
    const hasConfiguredApiKey = !!(configuredApiKey && configuredApiKey !== '' && configuredApiKey !== 'your_api_key_here');

    // 1. If valid API key provided, allow
    if (hasConfiguredApiKey && apiKey && apiKey === configuredApiKey) {
        return next();
    }

    // 2. If valid dashboard session token provided, allow
    const verified = verifyAuthToken(token);
    if (verified) {
        req.auth = verified;
        return next();
    }

    // 3. If invalid API key was provided on API route, return 403
    if (hasConfiguredApiKey && apiKey && apiKey !== configuredApiKey) {
        if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
            return res.status(403).json({
                success: false,
                message: 'Invalid API key'
            });
        }
    }

    // 4. Check if JSON request or API route
    if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized: Authentication required'
        });
    }

    // 5. Browser navigation: redirect to /login
    const redirectUrl = req.originalUrl || '/dashboard';
    return res.redirect(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
}

module.exports = {
    createAuthToken,
    verifyAuthToken,
    parseCookie,
    dashboardAuthGuard
};
