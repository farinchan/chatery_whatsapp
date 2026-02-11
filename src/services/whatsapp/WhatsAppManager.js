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
                    const session = new WhatsAppSession(sessionId, {});
                    this.sessions.set(sessionId, session);
                    await session.connect();
                    
                    // Safeguard: Log if username is missing after load
                    if (!session.username) {
                        console.warn(`⚠️ [${sessionId}] Restored session has no username. Consider updating config.`);
                    }
                }
            }
        } catch (error) {
            console.error('Error initializing sessions:', error);
        }
    }

    async createSession(username, sessionId = false, options = {}) {
        if (!username) {
            throw new Error('Username is required for session creation');
        }
        
        sessionId = sessionId || this.createSessionId(username);
        
        // Merge username into options
        options = { ...options, username };
        
        if (this.sessions.has(sessionId)) {
            const existingSession = this.sessions.get(sessionId);
            
            // Update config if provided, including username
            existingSession.updateConfig(options);
            
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
        
        const session = new WhatsAppSession(sessionId, options);
        session._saveConfig();
        this.sessions.set(sessionId, session);
        await session.connect();

        return { 
            success: true, 
            message: 'Session created', 
            data: session.getInfo() 
        };
    }

    createSessionId(username) {
        const now = new Date();

        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
        const timeStr = now.toTimeString().slice(0, 5).replace(':', 'H'); // HHhMM -> HHHMM

        const randomPart = Math.random()
            .toString(36)
            .substring(2, 10)
            .replace(/[^a-z0-9]/gi, '')
            .toUpperCase();

        return `${username.toUpperCase()}-${dateStr}-${timeStr}-${randomPart}`;
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
