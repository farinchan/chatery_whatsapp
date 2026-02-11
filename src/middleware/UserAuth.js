// src/middleware/userAuth.js
const DatabaseStore = require('../stores/DatabaseStore');

const db = new DatabaseStore(); // "global"

const userAuth = {

  async authenticate({ username, password }) {

    if (!username?.trim() || !password?.trim()) {
      return { success: false, message: 'Username and password are required' };
    }

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    const user = await db.authenticateUser(trimmedUsername, trimmedPassword);

    if (!user) {
      return { success: false, message: 'Invalid credentials' };
    }

    return {
      success: true,
      user
    };
  },

  async validate(req, res, next) {
    const apiKey = req.headers['x-api-key']?.trim();

    if (!apiKey) {
        return res.status(401).json({
            success: false,
            message: 'Missing X-Api-Key header'
        });
    }

    const dashboardApiKey = process.env.API_KEY;
    if (dashboardApiKey && dashboardApiKey === apiKey) {
        const username = process.env.DASHBOARD_USERNAME || 'dashboard';
        req.user = {
            username,
            apiKey,
            role: 'admin'
        };
        return next();
    }

    try {
        const rows = await db.mysqlQuery(
            "SELECT username, role FROM users WHERE api_key = ? LIMIT 1",
            [apiKey]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired API key'
            });
        }
        
        req.user = {
            username: rows[0].username,
            apiKey,
            role: rows[0].role
        };

        next();
    } catch (err) {
        console.error('API key validation database error:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error during authentication'
        });
    }
  },

  async getUsername(apiKey) {

    const dashboardApiKey = process.env.API_KEY;

    if (dashboardApiKey == apiKey) {
      return process.env.DASHBOARD_USERNAME;
    }

    if (!apiKey?.trim()) return false;
    const rows = await db.mysqlQuery(
      "SELECT username FROM users WHERE api_key = ? LIMIT 1",
      [apiKey.trim()]
    );
    return rows.length ? rows[0].username : false;
  },

  isAdmin(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
  },

  isModOrAdmin(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (!['admin', 'moderator'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Moderator or Admin access required' });
    }
    next();
  },

  async getCurrentUser(req) {
    if (!req.user?.username) return null;
    return await db.getUser(req.user.username);
  }
};

module.exports = userAuth;