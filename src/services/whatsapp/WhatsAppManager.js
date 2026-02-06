const path = require('path');
const fs = require('fs');
const WhatsAppSession = require('./WhatsAppSession');

/**
 * WhatsApp Manager Class
 * Mengelola semua sesi WhatsApp (Singleton)
 */
class WhatsAppManager {
    constructor() {
        this.sessions = new Map();
        this.sessionsFolder = path.join(process.cwd(), 'sessions');
        this.initExistingSessions();
    }

    /**
     * Load existing sessions on startup
     */
    async initExistingSessions() {
        try {
            if (!fs.existsSync(this.sessionsFolder)) {
                fs.mkdirSync(this.sessionsFolder, { recursive: true });
                return;
            }

            const sessionDirs = fs.readdirSync(this.sessionsFolder);
            for (const sessionId of sessionDirs) {
                const sessionPath = path.join(this.sessionsFolder, sessionId);
                if (fs.statSync(sessionPath).isDirectory()) {
                    console.log(`🔄 Restoring session: ${sessionId}`);
                    // Session will load its own config from file
                    const session = new WhatsAppSession(sessionId, {});
                    this.sessions.set(sessionId, session);
                    await session.connect();
                }
            }
        } catch (error) {
            console.error('Error initializing sessions:', error);
        }
    }

    /**
     * Create a new session or reconnect existing
     * @param {string} sessionId - Session identifier
     * @param {Object} options - Session options
     * @param {Object} options.metadata - Custom metadata to store with session
     * @param {Array} options.webhooks - Array of webhook configs [{ url, events }]
     * @param {string} options.owner - user name of user
     * @returns {Object}
     */
    async createSession(sessionId, options = {}) {
        // Validate session ID
        if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
            return { 
                success: false, 
                message: 'Invalid session ID. Use only letters, numbers, underscore, and dash.' 
            };
        }

        // Check if session already exists
        if (this.sessions.has(sessionId)) {
            const existingSession = this.sessions.get(sessionId);
            
            // Update config if provided
            if (options.metadata || options.webhooks || options.owner) {
                existingSession.updateConfig(options);
            }
            
            if (existingSession.connectionStatus === 'connected') {
                return { 
                    success: false, 
                    message: 'Session already connected', 
                    data: existingSession.getInfo() 
                };
            }
            // Reconnect existing session
            await existingSession.connect();
            return { 
                success: true, 
                message: 'Reconnecting existing session', 
                data: existingSession.getInfo() 
            };
        }

        // Create new session with options
        const session = new WhatsAppSession(sessionId, options);
        session._saveConfig(); // Save initial config
        this.sessions.set(sessionId, session);
        await session.connect();

        return { 
            success: true, 
            message: 'Session created', 
            data: session.getInfo() 
        };
    }

    /**
     * Get session by ID
     * @param {string} sessionId 
     * @returns {WhatsAppSession|undefined}
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    /**
     * Get all sessions info
     * @returns {Array}
     */
    getAllSessions() {
        const sessionsInfo = [];
        for (const [sessionId, session] of this.sessions) {
            sessionsInfo.push(session.getInfo());
        }
        return sessionsInfo;
    }

    /**
     * Delete a session
     * @param {string} sessionId 
     * @returns {Object}
     */
    async deleteSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { success: false, message: 'Session not found' };
        }

        await session.logout();
        this.sessions.delete(sessionId);
        return { success: true, message: 'Session deleted successfully' };
    }

    /**
     * Get session QR code info
     * @param {string} sessionId 
     * @returns {Object|null}
     */
    getSessionQR(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }
        return session.getInfo();
    }
}

module.exports = WhatsAppManager;
