const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { EventEmitter } = require('events');
const wsManager = require('../../src/services/websocket/WebSocketManager');

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

    describe('Singleton Export Verification', () => {
        it('should verify default singleton wsManager instance', () => {
            assert.ok(wsManager);
            assert.ok(wsManager instanceof WebSocketManagerClass);
            assert.ok(typeof wsManager.initialize === 'function');
            assert.ok(typeof wsManager.getStats === 'function');
        });
    });
});
