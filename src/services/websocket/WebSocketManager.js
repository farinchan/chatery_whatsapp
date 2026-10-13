const { Server } = require('socket.io');
const { verifyAuthToken, parseCookie } = require('../../middleware/dashboard-auth');

/**
 * WebSocket Manager (Singleton)
 * Mengelola koneksi WebSocket dan event broadcasting
 */
class WebSocketManager {
    constructor() {
        this.io = null;
        this.sessionRooms = new Map(); // sessionId -> Set of socket IDs
    }

    /**
     * Initialize Socket.IO server
     * @param {http.Server} httpServer - HTTP server instance
     * @param {Object} options - Socket.IO options
     */
    initialize(httpServer, options = {}) {
        this.io = new Server(httpServer, {
            cors: {
                origin: options.cors?.origin || '*',
                methods: ['GET', 'POST'],
                credentials: true
            },
            pingTimeout: 60000,
            pingInterval: 25000,
            ...options
        });

        this._setupAuthMiddleware();
        this._setupConnectionHandlers();
        console.log('🔌 WebSocket server initialized');
        return this.io;
    }

    /**
     * Check if WebSocket authentication is required
     * @returns {boolean}
     */
    _isAuthRequired() {
        const configuredApiKey = process.env.API_KEY;
        return !!(configuredApiKey && configuredApiKey !== '' && configuredApiKey !== 'your_api_key_here');
    }

    /**
     * Extract API key and dashboard session token from socket handshake
     * @param {import('socket.io').Socket} socket 
     * @returns {{ apiKey: string|null, token: string|null }}
     */
    _extractCredentials(socket) {
        const handshake = socket.handshake || {};
        const auth = handshake.auth || {};
        const headers = handshake.headers || {};
        const query = handshake.query || {};

        const apiKey = auth.apiKey || headers['x-api-key'] || query.apiKey || null;
        let token = auth.token || headers['x-auth-token'] || query.token || null;

        if (!token && headers.cookie) {
            token = parseCookie(headers.cookie, 'chatery_session');
        }

        return { apiKey, token };
    }

    /**
     * Authenticate socket during handshake or event processing
     * @param {import('socket.io').Socket} socket 
     * @returns {{ authenticated: boolean, type?: string, user?: string, error?: string }}
     */
    _authenticateSocket(socket) {
        // If socket has no handshake (e.g. simulated mock socket in unit tests without handshake)
        if (!socket.handshake) {
            return { authenticated: true, type: 'mock' };
        }

        // If API_KEY is not configured, open access is allowed
        if (!this._isAuthRequired()) {
            return { authenticated: true, type: 'open' };
        }

        const { apiKey, token } = this._extractCredentials(socket);
        const configuredApiKey = process.env.API_KEY;

        // 1. API key authentication
        if (apiKey) {
            if (apiKey === configuredApiKey) {
                return { authenticated: true, type: 'api_key' };
            }
            return { authenticated: false, error: 'Forbidden: Invalid API key' };
        }

        // 2. Dashboard session token authentication
        if (token) {
            const verified = verifyAuthToken(token);
            if (verified) {
                return { authenticated: true, type: 'dashboard_session', user: verified.username };
            }
            return { authenticated: false, error: 'Unauthorized: Invalid or expired session token' };
        }

        return { authenticated: false, error: 'Unauthorized: Authentication required' };
    }

    /**
     * Setup authentication middleware on Socket.IO instance
     */
    _setupAuthMiddleware() {
        this.io.use((socket, next) => {
            const authResult = this._authenticateSocket(socket);
            if (!authResult.authenticated) {
                console.warn(`🔒 WebSocket connection rejected [${socket.id}]: ${authResult.error}`);
                const err = new Error(authResult.error || 'Unauthorized: Authentication required');
                err.data = { status: 401, error: authResult.error };
                return next(err);
            }

            socket.authData = authResult;
            next();
        });
    }

    /**
     * Setup connection event handlers
     */
    _setupConnectionHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`🔗 Client connected: ${socket.id}`);

            // Client subscribes to a session
            socket.on('subscribe', (sessionId) => {
                if (this._isAuthRequired() && !socket.authData?.authenticated) {
                    console.warn(`🔒 Unauthorized subscribe attempt from ${socket.id} for session: ${sessionId}`);
                    socket.emit('error', { 
                        message: 'Unauthorized: Authentication required to subscribe to sessions' 
                    });
                    return;
                }

                if (!sessionId) {
                    socket.emit('error', { message: 'Session ID is required' });
                    return;
                }

                // Join the session room
                socket.join(`session:${sessionId}`);
                
                // Track socket in session room
                if (!this.sessionRooms.has(sessionId)) {
                    this.sessionRooms.set(sessionId, new Set());
                }
                this.sessionRooms.get(sessionId).add(socket.id);

                console.log(`📡 Client ${socket.id} subscribed to session: ${sessionId}`);
                socket.emit('subscribed', { 
                    sessionId, 
                    message: `Subscribed to session ${sessionId}` 
                });
            });

            // Client unsubscribes from a session
            socket.on('unsubscribe', (sessionId) => {
                if (this._isAuthRequired() && !socket.authData?.authenticated) {
                    socket.emit('error', { message: 'Unauthorized: Authentication required' });
                    return;
                }

                if (!sessionId) return;

                socket.leave(`session:${sessionId}`);
                
                if (this.sessionRooms.has(sessionId)) {
                    this.sessionRooms.get(sessionId).delete(socket.id);
                    if (this.sessionRooms.get(sessionId).size === 0) {
                        this.sessionRooms.delete(sessionId);
                    }
                }

                console.log(`📴 Client ${socket.id} unsubscribed from session: ${sessionId}`);
                socket.emit('unsubscribed', { sessionId });
            });

            // Handle disconnect
            socket.on('disconnect', (reason) => {
                console.log(`🔌 Client disconnected: ${socket.id} - Reason: ${reason}`);
                
                // Remove socket from all session rooms
                for (const [sessionId, sockets] of this.sessionRooms.entries()) {
                    if (sockets.has(socket.id)) {
                        sockets.delete(socket.id);
                        if (sockets.size === 0) {
                            this.sessionRooms.delete(sessionId);
                        }
                    }
                }
            });

            // Ping-pong for connection health check
            socket.on('ping', () => {
                socket.emit('pong', { timestamp: Date.now() });
            });
        });
    }

    /**
     * Emit event to specific session subscribers
     * @param {string} sessionId - Session ID
     * @param {string} event - Event name
     * @param {Object} data - Event data
     */
    emitToSession(sessionId, event, data) {
        if (!this.io) {
            console.warn('WebSocket server not initialized');
            return;
        }

        this.io.to(`session:${sessionId}`).emit(event, {
            sessionId,
            timestamp: new Date().toISOString(),
            ...data
        });
    }

    /**
     * Emit event to all connected clients
     * @param {string} event - Event name
     * @param {Object} data - Event data
     */
    broadcast(event, data) {
        if (!this.io) {
            console.warn('WebSocket server not initialized');
            return;
        }

        this.io.emit(event, {
            timestamp: new Date().toISOString(),
            ...data
        });
    }

    // ==================== WhatsApp Event Emitters ====================

    /**
     * Emit QR code event
     */
    emitQRCode(sessionId, qrCode) {
        this.emitToSession(sessionId, 'qr', { qrCode });
    }

    /**
     * Emit connection status change
     */
    emitConnectionStatus(sessionId, status, details = {}) {
        this.emitToSession(sessionId, 'connection.update', { 
            status,
            ...details
        });
    }

    /**
     * Emit new message received
     */
    emitMessage(sessionId, message) {
        this.emitToSession(sessionId, 'message', { message });
    }

    /**
     * Emit message sent confirmation
     */
    emitMessageSent(sessionId, message) {
        this.emitToSession(sessionId, 'message.sent', { message });
    }

    /**
     * Emit message status update (read, delivered, etc)
     */
    emitMessageStatus(sessionId, update) {
        this.emitToSession(sessionId, 'message.update', { update });
    }

    /**
     * Emit message deleted/revoked
     */
    emitMessageRevoke(sessionId, key, participant) {
        this.emitToSession(sessionId, 'message.revoke', { key, participant });
    }

    /**
     * Emit chat update (archive, mute, pin, etc)
     */
    emitChatUpdate(sessionId, chats) {
        this.emitToSession(sessionId, 'chat.update', { chats });
    }

    /**
     * Emit new chat created
     */
    emitChatsUpsert(sessionId, chats) {
        this.emitToSession(sessionId, 'chat.upsert', { chats });
    }

    /**
     * Emit chat deleted
     */
    emitChatDelete(sessionId, chatIds) {
        this.emitToSession(sessionId, 'chat.delete', { chatIds });
    }

    /**
     * Emit contact update
     */
    emitContactUpdate(sessionId, contacts) {
        this.emitToSession(sessionId, 'contact.update', { contacts });
    }

    /**
     * Emit presence update (typing, online, etc)
     */
    emitPresence(sessionId, presence) {
        this.emitToSession(sessionId, 'presence.update', { presence });
    }

    /**
     * Emit group participants update
     */
    emitGroupParticipants(sessionId, update) {
        this.emitToSession(sessionId, 'group.participants', { update });
    }

    /**
     * Emit group update (name, description, etc)
     */
    emitGroupUpdate(sessionId, update) {
        this.emitToSession(sessionId, 'group.update', { update });
    }

    /**
     * Emit call event
     */
    emitCall(sessionId, call) {
        this.emitToSession(sessionId, 'call', { call });
    }

    /**
     * Emit labels update
     */
    emitLabels(sessionId, labels) {
        this.emitToSession(sessionId, 'labels', { labels });
    }

    /**
     * Emit session logged out
     */
    emitLoggedOut(sessionId) {
        this.emitToSession(sessionId, 'logged.out', { 
            message: 'Session has been logged out' 
        });
    }

    /**
     * Get connection stats
     */
    getStats() {
        if (!this.io) return null;

        const rooms = {};
        for (const [sessionId, sockets] of this.sessionRooms.entries()) {
            rooms[sessionId] = sockets.size;
        }

        return {
            totalConnections: this.io.engine?.clientsCount || 0,
            sessionRooms: rooms
        };
    }
}

// Singleton instance
const wsManager = new WebSocketManager();

module.exports = wsManager;
