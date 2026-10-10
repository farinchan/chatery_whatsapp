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
 * Parses a specific cookie value from the request Cookie header
 * @param {import('express').Request} req 
 * @param {string} name 
 * @returns {string|null}
 */
function parseCookie(req, name) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    const match = cookieHeader.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Middleware to protect Dashboard & WA-Web HTML pages.
 * Redirects unauthenticated browser requests to /login.
 */
function dashboardAuthGuard(req, res, next) {
    const token = parseCookie(req, 'chatery_session') || req.headers['x-auth-token'];

    // Also allow direct API key authentication
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const configuredApiKey = process.env.API_KEY;
    if (configuredApiKey && apiKey === configuredApiKey) {
        return next();
    }

    const verified = verifyAuthToken(token);
    if (verified) {
        req.auth = verified;
        return next();
    }

    // Check if JSON request or API route
    if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({
            success: false,
            message: 'Unauthorized: Session login required'
        });
    }

    // Browser navigation: redirect to /login
    const redirectUrl = req.originalUrl || '/dashboard';
    return res.redirect(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
}

module.exports = {
    createAuthToken,
    verifyAuthToken,
    parseCookie,
    dashboardAuthGuard
};
