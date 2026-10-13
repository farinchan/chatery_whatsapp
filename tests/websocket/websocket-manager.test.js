const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { EventEmitter } = require('events');
const wsManager = require('../../src/services/websocket/WebSocketManager');
const { createAuthToken } = require('../../src/middleware/dashboard-auth');

describe('WebSocketManager', () => {
    const WebSocketManagerClass = wsManager.constructor;
    let manager;
    let httpServer;

    beforeEach(() => {
        manager = new WebSocketManagerClass();
        httpServer = http.createServer();
    });

    afterEach(() => {
        if (manager && manager.io) {
            try {
                manager.io.close();
            } catch (e) {
                // Ignore cleanup error
            }
        }
        if (httpServer && httpServer.listening) {
            httpServer.close();
        }
    });

    describe('Initialization & Stats', () => {
        it('should return null stats and handle emitters gracefully when uninitialized', () => {
            assert.equal(manager.getStats(), null);

            // Calling emitters before initialization should not throw error
            assert.doesNotThrow(() => {
                manager.emitToSession('sess_1', 'test_event', { data: 123 });
                manager.broadcast('test_event', { data: 123 });
                manager.emitQRCode('sess_1', 'qr_code_sample');
            });
        });

        it('should initialize Socket.IO server with custom options', () => {
            const io = manager.initialize(httpServer, {
                cors: { origin: 'http://localhost:4000' }
            });

            assert.ok(io);
            assert.equal(manager.io, io);
            assert.ok(manager.sessionRooms instanceof Map);

            const stats = manager.getStats();
            assert.equal(stats.totalConnections, 0);
            assert.deepEqual(stats.sessionRooms, {});
        });
    });

    describe('Socket Connection & Room Tracking', () => {
        class MockSocket extends EventEmitter {
            constructor(id) {
                super();
                this.id = id;
                this.joinedRooms = new Set();
                this.emittedEvents = [];
                this.on('error', () => {}); // Handle 'error' event to prevent ERR_UNHANDLED_ERROR
            }

            join(room) {
                this.joinedRooms.add(room);
            }

            leave(room) {
                this.joinedRooms.delete(room);
            }

            emit(event, ...args) {
                this.emittedEvents.push({ event, args });
                return super.emit(event, ...args);
            }

            getEmittedEvent(eventName) {
                return this.emittedEvents.find(e => e.event === eventName);
            }
        }

        const simulateConnection = (sock) => {
            EventEmitter.prototype.emit.call(manager.io.of('/'), 'connection', sock);
        };

        beforeEach(() => {
            manager.initialize(httpServer);
        });

        it('should handle client subscribe with valid sessionId', () => {
            const socket = new MockSocket('socket_1');
            simulateConnection(socket);

            socket.emit('subscribe', 'session_abc');

            assert.ok(socket.joinedRooms.has('session:session_abc'));
            assert.ok(manager.sessionRooms.has('session_abc'));
            assert.ok(manager.sessionRooms.get('session_abc').has('socket_1'));

            const subscribedEvent = socket.getEmittedEvent('subscribed');
            assert.ok(subscribedEvent);
            assert.equal(subscribedEvent.args[0].sessionId, 'session_abc');

            const stats = manager.getStats();
            assert.equal(stats.sessionRooms['session_abc'], 1);
        });

        it('should emit error when subscribe is called without sessionId', () => {
            const socket = new MockSocket('socket_err');
            simulateConnection(socket);

            socket.emit('subscribe', '');

            const errEvent = socket.getEmittedEvent('error');
            assert.ok(errEvent);
            assert.equal(errEvent.args[0].message, 'Session ID is required');
            assert.equal(manager.sessionRooms.size, 0);
        });

        it('should handle client unsubscribe and clean up empty rooms', () => {
            const socket = new MockSocket('socket_unsub');
            simulateConnection(socket);

            // Subscribe then unsubscribe
            socket.emit('subscribe', 'session_unsub');
            assert.equal(manager.sessionRooms.has('session_unsub'), true);

            socket.emit('unsubscribe', 'session_unsub');
            assert.ok(!socket.joinedRooms.has('session:session_unsub'));
            assert.equal(manager.sessionRooms.has('session_unsub'), false);

            const unsubEvent = socket.getEmittedEvent('unsubscribed');
            assert.ok(unsubEvent);
            assert.equal(unsubEvent.args[0].sessionId, 'session_unsub');
        });

        it('should clean up socket from all session rooms upon disconnect', () => {
            const socket = new MockSocket('socket_disc');
            simulateConnection(socket);

            socket.emit('subscribe', 'session_1');
            socket.emit('subscribe', 'session_2');
            assert.equal(manager.sessionRooms.get('session_1').size, 1);
            assert.equal(manager.sessionRooms.get('session_2').size, 1);

            socket.emit('disconnect', 'transport close');
            assert.equal(manager.sessionRooms.has('session_1'), false);
            assert.equal(manager.sessionRooms.has('session_2'), false);
        });

        it('should reply with pong on ping event', () => {
            const socket = new MockSocket('socket_ping');
            simulateConnection(socket);

            socket.emit('ping');

            const pongEvent = socket.getEmittedEvent('pong');
            assert.ok(pongEvent);
            assert.ok(pongEvent.args[0].timestamp);
        });
    });

    describe('WhatsApp Event Emitters', () => {
        let emittedToRooms;
        let broadcastedEvents;

        beforeEach(() => {
            manager.initialize(httpServer);
            emittedToRooms = [];
            broadcastedEvents = [];

            // Intercept io.to and io.emit to capture events
            manager.io.to = (room) => {
                return {
                    emit: (event, payload) => {
                        emittedToRooms.push({ room, event, payload });
                    }
                };
            };

            const originalIoEmit = manager.io.emit.bind(manager.io);
            manager.io.emit = (event, payload) => {
                broadcastedEvents.push({ event, payload });
                return originalIoEmit(event, payload);
            };
        });

        it('should emit QRCode to session room', () => {
            manager.emitQRCode('session_test', 'data:image/png;base64,sample');

            assert.equal(emittedToRooms.length, 1);
            assert.equal(emittedToRooms[0].room, 'session:session_test');
            assert.equal(emittedToRooms[0].event, 'qr');
            assert.equal(emittedToRooms[0].payload.sessionId, 'session_test');
            assert.equal(emittedToRooms[0].payload.qrCode, 'data:image/png;base64,sample');
            assert.ok(emittedToRooms[0].payload.timestamp);
        });

        it('should emit connection status change', () => {
            manager.emitConnectionStatus('session_test', 'connected', { phone: '628123456789' });

            assert.equal(emittedToRooms.length, 1);
            assert.equal(emittedToRooms[0].event, 'connection.update');
            assert.equal(emittedToRooms[0].payload.status, 'connected');
            assert.equal(emittedToRooms[0].payload.phone, '628123456789');
        });

        it('should emit message received and message sent', () => {
            const sampleMsg = { id: 'msg_1', text: 'Hello' };

            manager.emitMessage('session_test', sampleMsg);
            assert.equal(emittedToRooms[0].event, 'message');
            assert.deepEqual(emittedToRooms[0].payload.message, sampleMsg);

            manager.emitMessageSent('session_test', sampleMsg);
            assert.equal(emittedToRooms[1].event, 'message.sent');
            assert.deepEqual(emittedToRooms[1].payload.message, sampleMsg);
        });

        it('should emit message status and revoke updates', () => {
            manager.emitMessageStatus('session_test', { id: 'msg_1', status: 3 });
            assert.equal(emittedToRooms[0].event, 'message.update');
            assert.deepEqual(emittedToRooms[0].payload.update, { id: 'msg_1', status: 3 });

            manager.emitMessageRevoke('session_test', { id: 'msg_1' }, 'user@s.whatsapp.net');
            assert.equal(emittedToRooms[1].event, 'message.revoke');
            assert.deepEqual(emittedToRooms[1].payload.key, { id: 'msg_1' });
            assert.equal(emittedToRooms[1].payload.participant, 'user@s.whatsapp.net');
        });

        it('should emit chat updates (update, upsert, delete)', () => {
            manager.emitChatUpdate('session_test', [{ id: 'chat_1', unread: 0 }]);
            assert.equal(emittedToRooms[0].event, 'chat.update');

            manager.emitChatsUpsert('session_test', [{ id: 'chat_2' }]);
            assert.equal(emittedToRooms[1].event, 'chat.upsert');

            manager.emitChatDelete('session_test', ['chat_1']);
            assert.equal(emittedToRooms[2].event, 'chat.delete');
            assert.deepEqual(emittedToRooms[2].payload.chatIds, ['chat_1']);
        });

        it('should emit contact updates', () => {
            manager.emitContactUpdate('session_test', [{ id: 'contact_1', name: 'John' }]);
            assert.equal(emittedToRooms[0].event, 'contact.update');
            assert.equal(emittedToRooms[0].payload.contacts[0].name, 'John');
        });

        it('should emit presence, group, call, labels, and loggedOut events', () => {
            manager.emitPresence('session_test', { id: 'c1', presence: 'composing' });
            assert.equal(emittedToRooms[0].event, 'presence.update');

            manager.emitGroupParticipants('session_test', { groupId: 'g1', action: 'add' });
            assert.equal(emittedToRooms[1].event, 'group.participants');

            manager.emitGroupUpdate('session_test', { groupId: 'g1', subject: 'New Subject' });
            assert.equal(emittedToRooms[2].event, 'group.update');

            manager.emitCall('session_test', { callId: 'call_1', status: 'offer' });
            assert.equal(emittedToRooms[3].event, 'call');

            manager.emitLabels('session_test', [{ id: 'lbl_1', name: 'Important' }]);
            assert.equal(emittedToRooms[4].event, 'labels');

            manager.emitLoggedOut('session_test');
            assert.equal(emittedToRooms[5].event, 'logged.out');
            assert.equal(emittedToRooms[5].payload.message, 'Session has been logged out');
        });

        it('should broadcast event to all clients', () => {
            manager.broadcast('system.announcement', { text: 'Server maintenance' });

            assert.equal(broadcastedEvents.length, 1);
            assert.equal(broadcastedEvents[0].event, 'system.announcement');
            assert.equal(broadcastedEvents[0].payload.text, 'Server maintenance');
            assert.ok(broadcastedEvents[0].payload.timestamp);
        });
    });

    describe('WebSocket Authentication & Security', () => {
        let originalApiKey;

        beforeEach(() => {
            originalApiKey = process.env.API_KEY;
        });

        afterEach(() => {
            if (originalApiKey !== undefined) {
                process.env.API_KEY = originalApiKey;
            } else {
                delete process.env.API_KEY;
            }
        });

        it('should allow open access when process.env.API_KEY is unset or empty', () => {
            delete process.env.API_KEY;
            const res1 = manager._authenticateSocket({ handshake: { auth: {} } });
            assert.equal(res1.authenticated, true);
            assert.equal(res1.type, 'open');

            process.env.API_KEY = '';
            const res2 = manager._authenticateSocket({ handshake: { auth: {} } });
            assert.equal(res2.authenticated, true);
            assert.equal(res2.type, 'open');

            process.env.API_KEY = 'your_api_key_here';
            const res3 = manager._authenticateSocket({ handshake: { auth: {} } });
            assert.equal(res3.authenticated, true);
            assert.equal(res3.type, 'open');
        });

        it('should allow mock socket without handshake in testing environment', () => {
            process.env.API_KEY = 'secret-key-123';
            const res = manager._authenticateSocket({});
            assert.equal(res.authenticated, true);
            assert.equal(res.type, 'mock');
        });

        it('should reject connection when API_KEY is set and no credentials are provided', () => {
            process.env.API_KEY = 'secret-key-123';
            const res = manager._authenticateSocket({ handshake: { auth: {}, headers: {}, query: {} } });
            assert.equal(res.authenticated, false);
            assert.equal(res.error, 'Unauthorized: Authentication required');
        });

        it('should reject connection when invalid API key is provided', () => {
            process.env.API_KEY = 'secret-key-123';
            const res = manager._authenticateSocket({ handshake: { auth: { apiKey: 'wrong-key' } } });
            assert.equal(res.authenticated, false);
            assert.equal(res.error, 'Forbidden: Invalid API key');
        });

        it('should authenticate successfully with valid API key via auth, header, or query', () => {
            process.env.API_KEY = 'secret-key-123';

            // Via auth.apiKey
            const resAuth = manager._authenticateSocket({ handshake: { auth: { apiKey: 'secret-key-123' } } });
            assert.equal(resAuth.authenticated, true);
            assert.equal(resAuth.type, 'api_key');

            // Via headers['x-api-key']
            const resHeader = manager._authenticateSocket({ handshake: { headers: { 'x-api-key': 'secret-key-123' } } });
            assert.equal(resHeader.authenticated, true);
            assert.equal(resHeader.type, 'api_key');

            // Via query.apiKey
            const resQuery = manager._authenticateSocket({ handshake: { query: { apiKey: 'secret-key-123' } } });
            assert.equal(resQuery.authenticated, true);
            assert.equal(resQuery.type, 'api_key');
        });

        it('should authenticate successfully with valid dashboard session token via auth, header, or cookie', () => {
            process.env.API_KEY = 'secret-key-123';
            const validToken = createAuthToken('admin');

            // Via auth.token
            const resAuth = manager._authenticateSocket({ handshake: { auth: { token: validToken } } });
            assert.equal(resAuth.authenticated, true);
            assert.equal(resAuth.type, 'dashboard_session');
            assert.equal(resAuth.user, 'admin');

            // Via headers['x-auth-token']
            const resHeader = manager._authenticateSocket({ handshake: { headers: { 'x-auth-token': validToken } } });
            assert.equal(resHeader.authenticated, true);
            assert.equal(resHeader.type, 'dashboard_session');

            // Via cookie header
            const resCookie = manager._authenticateSocket({
                handshake: { headers: { cookie: `other_cookie=123; chatery_session=${validToken}; foo=bar` } }
            });
            assert.equal(resCookie.authenticated, true);
            assert.equal(resCookie.type, 'dashboard_session');
        });

        it('should reject connection when dashboard token is expired or forged', () => {
            process.env.API_KEY = 'secret-key-123';
            const forgedToken = Buffer.from('admin:9999999999999:fake_hmac_hash').toString('base64url');

            const res = manager._authenticateSocket({ handshake: { auth: { token: forgedToken } } });
            assert.equal(res.authenticated, false);
            assert.equal(res.error, 'Unauthorized: Invalid or expired session token');
        });

        it('should reject unauthenticated socket during Socket.IO handshake middleware', () => {
            process.env.API_KEY = 'secret-key-123';
            manager.initialize(httpServer);

            const middleware = manager.io.of('/')._fns[0];
            assert.ok(typeof middleware === 'function');

            const unauthSocket = {
                id: 'unauth_sock',
                handshake: { auth: {}, headers: {}, query: {} }
            };

            let capturedErr;
            middleware(unauthSocket, (err) => {
                capturedErr = err;
            });

            assert.ok(capturedErr instanceof Error);
            assert.equal(capturedErr.message, 'Unauthorized: Authentication required');
            assert.equal(unauthSocket.authData, undefined);
        });

        it('should accept authenticated socket during Socket.IO handshake middleware and attach authData', () => {
            process.env.API_KEY = 'secret-key-123';
            manager.initialize(httpServer);

            const middleware = manager.io.of('/')._fns[0];
            const authSocket = {
                id: 'auth_sock',
                handshake: { auth: { apiKey: 'secret-key-123' } }
            };

            let nextCalled = false;
            middleware(authSocket, (err) => {
                assert.equal(err, undefined);
                nextCalled = true;
            });

            assert.equal(nextCalled, true);
            assert.ok(authSocket.authData);
            assert.equal(authSocket.authData.authenticated, true);
            assert.equal(authSocket.authData.type, 'api_key');
        });

        it('should reject subscribe and unsubscribe events when socket is unauthenticated', () => {
            process.env.API_KEY = 'secret-key-123';
            manager.initialize(httpServer);

            class MockTestSocket extends EventEmitter {
                constructor() {
                    super();
                    this.id = 'unauth_sub_sock';
                    this.handshake = { auth: {} };
                    this.authData = { authenticated: false };
                    this.joinedRooms = new Set();
                    this.emittedEvents = [];
                    this.on('error', () => {});
                }
                join(room) { this.joinedRooms.add(room); }
                leave(room) { this.joinedRooms.delete(room); }
                emit(event, ...args) {
                    this.emittedEvents.push({ event, args });
                    return super.emit(event, ...args);
                }
            }

            const socket = new MockTestSocket();
            EventEmitter.prototype.emit.call(manager.io.of('/'), 'connection', socket);

            // Attempt unauthenticated subscribe
            socket.emit('subscribe', 'target_session_id');

            const subErr = socket.emittedEvents.find(e => e.event === 'error');
            assert.ok(subErr);
            assert.equal(subErr.args[0].message, 'Unauthorized: Authentication required to subscribe to sessions');
            assert.equal(socket.joinedRooms.has('session:target_session_id'), false);
            assert.equal(manager.sessionRooms.has('target_session_id'), false);

            // Attempt unauthenticated unsubscribe
            socket.emittedEvents = [];
            socket.emit('unsubscribe', 'target_session_id');

            const unsubErr = socket.emittedEvents.find(e => e.event === 'error');
            assert.ok(unsubErr);
            assert.equal(unsubErr.args[0].message, 'Unauthorized: Authentication required');
        });
    });

    describe('Singleton Export Verification', () => {
        it('should verify default singleton wsManager instance', () => {
            assert.ok(wsManager);
            assert.ok(wsManager instanceof WebSocketManagerClass);
            assert.ok(typeof wsManager.initialize === 'function');
            assert.ok(typeof wsManager.getStats === 'function');
        });
    });
});
