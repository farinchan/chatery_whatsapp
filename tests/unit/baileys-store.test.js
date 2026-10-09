const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const BaileysStore = require('../../src/services/whatsapp/BaileysStore');

describe('BaileysStore', () => {
    let store;
    let tempDir;

    beforeEach(() => {
        store = new BaileysStore('test-session');
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatery-store-test-'));
    });

    afterEach(() => {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('Initialization & Core Data Structures', () => {
        it('should correctly initialize internal Maps and default properties', () => {
            assert.equal(store.sessionId, 'test-session');
            assert.ok(store.chats instanceof Map);
            assert.ok(store.contacts instanceof Map);
            assert.ok(store.messages instanceof Map);
            assert.ok(store.groupMetadata instanceof Map);
            assert.ok(store.lidMap instanceof Map);
            assert.ok(store.chatsOverview instanceof Map);
            assert.ok(store.profilePictures instanceof Map);
            assert.ok(store.contactsCache instanceof Map);
            assert.ok(store.labels instanceof Map);
            assert.ok(store.labelAssociations instanceof Map);
            assert.ok(store.mediaFiles instanceof Map);
            assert.equal(store._sortedOverviewCache, null);
            assert.equal(store._sortedContactsCache, null);
        });

        it('should get correct initial stats and clear all data', () => {
            const stats = store.getStats();
            assert.deepEqual(stats, {
                chats: 0,
                contacts: 0,
                messages: 0,
                groups: 0,
                mediaFiles: 0,
                labels: 0
            });

            store.chats.set('c1', { id: 'c1' });
            store.contacts.set('u1', { id: 'u1' });
            const msgMap = new Map();
            msgMap.set('m1', { key: { id: 'm1' } });
            store.messages.set('c1', msgMap);
            store.groupMetadata.set('g1', { id: 'g1' });
            store.mediaFiles.set('m1', '/fake/path');
            store.labels.set('l1', { id: 'l1' });

            const updatedStats = store.getStats();
            assert.equal(updatedStats.chats, 1);
            assert.equal(updatedStats.contacts, 1);
            assert.equal(updatedStats.messages, 1);
            assert.equal(updatedStats.groups, 1);
            assert.equal(updatedStats.mediaFiles, 1);
            assert.equal(updatedStats.labels, 1);

            store.clear();
            assert.equal(store.chats.size, 0);
            assert.equal(store.contacts.size, 0);
            assert.equal(store.messages.size, 0);
            assert.equal(store.groupMetadata.size, 0);
            assert.equal(store.mediaFiles.size, 0);
            assert.equal(store.labels.size, 0);
        });

        it('should get chats, contacts, messages, and group metadata via getter methods', () => {
            store.chats.set('chat1@s.whatsapp.net', { id: 'chat1@s.whatsapp.net', name: 'Chat 1' });
            store.contacts.set('contact1@s.whatsapp.net', { id: 'contact1@s.whatsapp.net', name: 'Alice' });
            store.groupMetadata.set('group1@g.us', { id: 'group1@g.us', subject: 'Developers' });

            const msgMap = new Map();
            const msg1 = {
                key: { id: 'msg1', remoteJid: 'chat1@s.whatsapp.net' },
                messageTimestamp: 1000,
                message: { conversation: 'First' }
            };
            const msg2 = {
                key: { id: 'msg2', remoteJid: 'chat1@s.whatsapp.net' },
                messageTimestamp: 2000,
                message: { conversation: 'Second' }
            };
            msgMap.set('msg1', msg1);
            msgMap.set('msg2', msg2);
            store.messages.set('chat1@s.whatsapp.net', msgMap);

            assert.equal(store.getAllChats().length, 1);
            assert.equal(store.getChat('chat1@s.whatsapp.net').name, 'Chat 1');
            assert.equal(store.getContact('contact1@s.whatsapp.net').name, 'Alice');
            assert.equal(store.getGroupMetadata('group1@g.us').subject, 'Developers');
            assert.equal(store.getMessage('chat1@s.whatsapp.net', 'msg1').message.conversation, 'First');

            // getMessages returns sorted descending
            const messages = store.getMessages('chat1@s.whatsapp.net');
            assert.equal(messages.length, 2);
            assert.equal(messages[0].key.id, 'msg2'); // newest first
            assert.equal(messages[1].key.id, 'msg1');

            // getMessages pagination with `before`
            const paginated = store.getMessages('chat1@s.whatsapp.net', { before: 'msg2' });
            assert.equal(paginated.length, 1);
            assert.equal(paginated[0].key.id, 'msg1');
        });
    });

    describe('Baileys Event Binding (bind)', () => {
        let ev;

        beforeEach(() => {
            ev = new EventEmitter();
            store.bind(ev);
        });

        it('should handle chats.set, chats.upsert, chats.update, and chats.delete', () => {
            // chats.set
            ev.emit('chats.set', {
                chats: [{ id: '628111@s.whatsapp.net', name: 'User 1' }]
            });
            assert.equal(store.chats.has('628111@s.whatsapp.net'), true);

            // chats.upsert
            ev.emit('chats.upsert', [
                { id: '628111@s.whatsapp.net', unreadCount: 3 },
                { id: '628222@s.whatsapp.net', name: 'User 2' }
            ]);
            assert.equal(store.chats.get('628111@s.whatsapp.net').unreadCount, 3);
            assert.equal(store.chats.get('628222@s.whatsapp.net').name, 'User 2');

            // chats.update
            ev.emit('chats.update', [
                { id: '628111@s.whatsapp.net', name: 'User 1 Updated' }
            ]);
            assert.equal(store.chats.get('628111@s.whatsapp.net').name, 'User 1 Updated');

            // chats.delete
            ev.emit('chats.delete', ['628222@s.whatsapp.net']);
            assert.equal(store.chats.has('628222@s.whatsapp.net'), false);
        });

        it('should handle contacts.set, contacts.upsert, and contacts.update with identity registration', () => {
            // contacts.set with both PN JID and LID
            ev.emit('contacts.set', {
                contacts: [
                    { id: '6281234567@s.whatsapp.net', lid: '11111@lid', name: 'Budi Santoso' }
                ]
            });
            assert.equal(store.contacts.has('6281234567@s.whatsapp.net'), true);
            assert.ok(store.resolveIdentity('11111@lid'));
            assert.equal(store.resolveIdentity('11111@lid').jid, '6281234567@s.whatsapp.net');

            // contacts.upsert
            ev.emit('contacts.upsert', [
                { id: '6289876543@s.whatsapp.net', lid: '22222@lid', notify: 'Dewi' }
            ]);
            assert.equal(store.contacts.get('6289876543@s.whatsapp.net').notify, 'Dewi');
            assert.equal(store.resolveIdentity('22222@lid').jid, '6289876543@s.whatsapp.net');

            // contacts.update
            ev.emit('contacts.update', [
                { id: '6289876543@s.whatsapp.net', name: 'Dewi Lestari' }
            ]);
            assert.equal(store.contacts.get('6289876543@s.whatsapp.net').name, 'Dewi Lestari');
        });

        it('should handle messages.set, messages.upsert, messages.update, and messages.delete', () => {
            const rawMsg = {
                key: { id: 'M_001', remoteJid: '628111@s.whatsapp.net' },
                pushName: 'Budi',
                messageTimestamp: 1600000000,
                message: { conversation: 'Halo dari set' }
            };

            // messages.set
            ev.emit('messages.set', { messages: [rawMsg], isLatest: true });
            assert.equal(store.getMessage('628111@s.whatsapp.net', 'M_001').message.conversation, 'Halo dari set');

            // messages.upsert
            const rawMsg2 = {
                key: { id: 'M_002', remoteJid: '628111@s.whatsapp.net' },
                pushName: 'Budi',
                messageTimestamp: 1600000100,
                message: { conversation: 'Halo dari upsert' }
            };
            ev.emit('messages.upsert', { messages: [rawMsg2], type: 'notify' });
            assert.equal(store.getMessage('628111@s.whatsapp.net', 'M_002').message.conversation, 'Halo dari upsert');

            // messages.update
            ev.emit('messages.update', [{
                key: { id: 'M_002', remoteJid: '628111@s.whatsapp.net' },
                update: { status: 3 }
            }]);
            assert.equal(store.getMessage('628111@s.whatsapp.net', 'M_002').status, 3);

            // messages.delete
            ev.emit('messages.delete', {
                keys: [{ id: 'M_001', remoteJid: '628111@s.whatsapp.net' }]
            });
            assert.equal(store.getMessage('628111@s.whatsapp.net', 'M_001'), null);
        });

        it('should handle groups and labels events', () => {
            // groups
            ev.emit('groups.upsert', [{ id: '123@g.us', subject: 'Grup Keren' }]);
            assert.equal(store.getGroupMetadata('123@g.us').subject, 'Grup Keren');

            ev.emit('groups.update', [{ id: '123@g.us', subject: 'Grup Sangat Keren' }]);
            assert.equal(store.getGroupMetadata('123@g.us').subject, 'Grup Sangat Keren');

            // labels.edit
            ev.emit('labels.edit', { id: 'label_1', name: 'VIP', color: 1 });
            assert.equal(store.getLabelById('label_1').name, 'VIP');

            // labels.association
            ev.emit('labels.association', {
                association: { chatId: 'user1@s.whatsapp.net', labelId: 'label_1' },
                type: 'add'
            });
            assert.equal(store.getLabelsByChat('user1@s.whatsapp.net').length, 1);
            assert.equal(store.getChatsByLabel('label_1').length, 1);

            ev.emit('labels.association', {
                association: { chatId: 'user1@s.whatsapp.net', labelId: 'label_1' },
                type: 'remove'
            });
            assert.equal(store.getLabelsByChat('user1@s.whatsapp.net').length, 0);

            // labels.edit deletion
            ev.emit('labels.edit', { id: 'label_1', deleted: true });
            assert.equal(store.getLabelById('label_1'), null);
        });
    });

    describe('LID Mapping System (registerIdentity, resolveIdentity, resolvePhoneNumber, _migrateLidData)', () => {
        it('should register identity and allow bi-directional lookup', () => {
            store.registerIdentity('123456789@lid', '6281234567890@s.whatsapp.net', '6281234567890');

            const byLid = store.resolveIdentity('123456789@lid');
            assert.deepEqual(byLid, {
                lid: '123456789@lid',
                pn: '6281234567890',
                jid: '6281234567890@s.whatsapp.net'
            });

            const byJid = store.resolveIdentity('6281234567890@s.whatsapp.net');
            assert.deepEqual(byJid, byLid);

            const byPn = store.resolveIdentity('6281234567890');
            assert.deepEqual(byPn, byLid);
        });

        it('should fallback to searching in contacts if not found in primary lidMap', () => {
            store.contacts.set('6287777777@s.whatsapp.net', {
                id: '6287777777@s.whatsapp.net',
                lid: '987654321@lid',
                name: 'Fallback Contact'
            });

            const resolved = store.resolveIdentity('987654321@lid');
            assert.notEqual(resolved, null);
            assert.equal(resolved.jid, '6287777777@s.whatsapp.net');
            assert.equal(resolved.pn, '6287777777');
        });

        it('should resolve phone numbers correctly with fallback options', () => {
            store.registerIdentity('55555@lid', '6285555555@s.whatsapp.net', '6285555555');

            // Resolving from mapped LID
            assert.equal(store.resolvePhoneNumber('55555@lid'), '6285555555');

            // Resolving from mapped JID
            assert.equal(store.resolvePhoneNumber('6285555555@s.whatsapp.net'), '6285555555');

            // Unmapped standard whatsapp JID splits @
            assert.equal(store.resolvePhoneNumber('6289999999@s.whatsapp.net'), '6289999999');

            // Unmapped non-standard / group / unknown string returns raw
            assert.equal(store.resolvePhoneNumber('1203630000@g.us'), '1203630000@g.us');
            assert.equal(store.resolvePhoneNumber(null), null);
        });

        it('should dynamically migrate existing chats, contacts, messages, and overview data on registerIdentity', () => {
            const lid = '44444@lid';
            const jid = '6284444444@s.whatsapp.net';

            // Seed store with LID keys
            store.chats.set(lid, { id: lid, unreadCount: 5 });
            store.contacts.set(lid, { id: lid, name: 'LID Contact' });

            const msgMap = new Map();
            msgMap.set('msg_lid_1', {
                key: { id: 'msg_lid_1', remoteJid: lid, participant: lid },
                message: { conversation: 'Hello LID' },
                messageTimestamp: 1000
            });
            store.messages.set(lid, msgMap);

            store.chatsOverview.set(lid, {
                id: lid,
                name: 'LID Overview',
                lastMessage: { id: 'msg_lid_1' }
            });

            // Register identity - triggers _migrateLidData
            store.registerIdentity(lid, jid);

            // Chats migrated
            assert.equal(store.chats.has(lid), false);
            assert.equal(store.chats.has(jid), true);
            assert.equal(store.chats.get(jid).unreadCount, 5);

            // Contacts migrated
            assert.equal(store.contacts.has(lid), false);
            assert.equal(store.contacts.has(jid), true);
            assert.equal(store.contacts.get(jid).name, 'LID Contact');

            // Messages migrated and keys updated
            assert.equal(store.messages.has(lid), false);
            assert.equal(store.messages.has(jid), true);
            const migratedMsg = store.messages.get(jid).get('msg_lid_1');
            assert.equal(migratedMsg.key.remoteJid, jid);
            assert.equal(migratedMsg.key.participant, jid);

            // ChatsOverview migrated
            assert.equal(store.chatsOverview.has(lid), false);
            assert.equal(store.chatsOverview.has(jid), true);
        });
    });

    describe('Chats Overview Cache (getChatsOverviewFast)', () => {
        beforeEach(() => {
            const msgMap1 = new Map();
            msgMap1.set('m1', {
                key: { id: 'm1', remoteJid: 'user1@s.whatsapp.net' },
                messageTimestamp: 1000,
                message: { conversation: 'First chat message' }
            });
            store.messages.set('user1@s.whatsapp.net', msgMap1);
            store.chats.set('user1@s.whatsapp.net', { id: 'user1@s.whatsapp.net', unreadCount: 2 });
            store.contacts.set('user1@s.whatsapp.net', { id: 'user1@s.whatsapp.net', name: 'User Satu' });

            const msgMap2 = new Map();
            msgMap2.set('m2', {
                key: { id: 'm2', remoteJid: 'user2@s.whatsapp.net' },
                messageTimestamp: 5000,
                message: { conversation: 'Second chat message (newer)' }
            });
            store.messages.set('user2@s.whatsapp.net', msgMap2);
            store.chats.set('user2@s.whatsapp.net', { id: 'user2@s.whatsapp.net', unreadCount: 0 });
            store.contacts.set('user2@s.whatsapp.net', { id: 'user2@s.whatsapp.net', name: 'User Dua' });
        });

        it('should build and sort overview by timestamp descending', () => {
            const result = store.getChatsOverviewFast();

            assert.equal(result.total, 2);
            assert.equal(result.data.length, 2);
            // user2 has timestamp 5000, user1 has 1000
            assert.equal(result.data[0].id, 'user2@s.whatsapp.net');
            assert.equal(result.data[1].id, 'user1@s.whatsapp.net');
        });

        it('should support pagination (limit and offset)', () => {
            const page1 = store.getChatsOverviewFast({ limit: 1, offset: 0 });
            assert.equal(page1.total, 2);
            assert.equal(page1.data.length, 1);
            assert.equal(page1.data[0].id, 'user2@s.whatsapp.net');

            const page2 = store.getChatsOverviewFast({ limit: 1, offset: 1 });
            assert.equal(page2.total, 2);
            assert.equal(page2.data.length, 1);
            assert.equal(page2.data[0].id, 'user1@s.whatsapp.net');
        });

        it('should invalidate sorted overview cache and recalculate on update', () => {
            store.getChatsOverviewFast();
            assert.notEqual(store._sortedOverviewCache, null);

            store._invalidateOverviewCache();
            assert.equal(store._sortedOverviewCache, null);

            // Push a newer message to user1
            const msgMap1 = store.messages.get('user1@s.whatsapp.net');
            const newMsg = {
                key: { id: 'm3', remoteJid: 'user1@s.whatsapp.net' },
                messageTimestamp: 9000,
                message: { conversation: 'User satu now newest' }
            };
            msgMap1.set('m3', newMsg);
            store._updateSingleChatOverview('user1@s.whatsapp.net', newMsg);

            const updatedResult = store.getChatsOverviewFast();
            assert.equal(updatedResult.data[0].id, 'user1@s.whatsapp.net');
            assert.equal(updatedResult.data[0].lastMessage.preview, 'User satu now newest');
        });
    });

    describe('Contacts Cache (getContactsFast) & Filtering', () => {
        beforeEach(() => {
            store.contacts.set('628111@c.us', { id: '628111@c.us', name: 'Budi Santoso', notify: 'Budi' });
            store.contacts.set('628222@c.us', { id: '628222@c.us', name: 'Andi Pratama', notify: 'Andi' });
            store.contacts.set('628333@c.us', { id: '628333@c.us', name: 'Citra Kirana', notify: 'Citra' });
            store.contacts.set('12345@g.us', { id: '12345@g.us', name: 'Ignored Group' }); // Not @c.us

            store.setProfilePicture('628222@c.us', 'https://example.com/andi.jpg');
        });

        it('should get contacts ending with @c.us, attach profile pictures, and sort alphabetically by name', () => {
            const result = store.getContactsFast();

            assert.equal(result.total, 3);
            assert.equal(result.data[0].name, 'Andi Pratama');
            assert.equal(result.data[0].profilePicture, 'https://example.com/andi.jpg');
            assert.equal(result.data[1].name, 'Budi Santoso');
            assert.equal(result.data[2].name, 'Citra Kirana');
        });

        it('should filter contacts by search query (name, notify, id)', () => {
            const searchResult = store.getContactsFast({ search: 'citra' });
            assert.equal(searchResult.total, 1);
            assert.equal(searchResult.data[0].name, 'Citra Kirana');

            const phoneSearchResult = store.getContactsFast({ search: '628111' });
            assert.equal(phoneSearchResult.total, 1);
            assert.equal(phoneSearchResult.data[0].name, 'Budi Santoso');
        });

        it('should support pagination in contacts query', () => {
            const paginated = store.getContactsFast({ limit: 2, offset: 1 });
            assert.equal(paginated.total, 3);
            assert.equal(paginated.data.length, 2);
            assert.equal(paginated.data[0].name, 'Budi Santoso');
            assert.equal(paginated.data[1].name, 'Citra Kirana');
        });
    });

    describe('Media File Tracking & Cleanup (registerMediaFile, cleanupOldMedia, _deleteMediaFile)', () => {
        it('should register media file and delete file via _deleteMediaFile', () => {
            const filePath = path.join(tempDir, 'test-image.jpg');
            fs.writeFileSync(filePath, 'fake image data');

            store.registerMediaFile('MSG_MEDIA_1', filePath);
            assert.equal(store.mediaFiles.get('MSG_MEDIA_1'), filePath);
            assert.equal(fs.existsSync(filePath), true);

            store._deleteMediaFile('MSG_MEDIA_1');
            assert.equal(store.mediaFiles.has('MSG_MEDIA_1'), false);
            assert.equal(fs.existsSync(filePath), false);
        });

        it('should cleanup old media files keeping only last maxMessagesPerChat', () => {
            const chatId = 'chat_media@s.whatsapp.net';
            const msgMap = new Map();

            // Create 3 messages with timestamps 100, 200, 300
            for (let i = 1; i <= 3; i++) {
                const msgId = `media_msg_${i}`;
                const filePath = path.join(tempDir, `media_${i}.jpg`);
                fs.writeFileSync(filePath, `data for ${i}`);

                msgMap.set(msgId, {
                    key: { id: msgId, remoteJid: chatId },
                    messageTimestamp: i * 100
                });
                store.registerMediaFile(msgId, filePath);
            }
            store.messages.set(chatId, msgMap);

            // Keep only latest 2 messages (should keep media_msg_3 and media_msg_2, delete media_msg_1)
            store.cleanupOldMedia(2);

            const file1 = path.join(tempDir, 'media_1.jpg');
            const file2 = path.join(tempDir, 'media_2.jpg');
            const file3 = path.join(tempDir, 'media_3.jpg');

            assert.equal(fs.existsSync(file1), false);
            assert.equal(store.mediaFiles.has('media_msg_1'), false);

            assert.equal(fs.existsSync(file2), true);
            assert.equal(store.mediaFiles.has('media_msg_2'), true);

            assert.equal(fs.existsSync(file3), true);
            assert.equal(store.mediaFiles.has('media_msg_3'), true);
        });
    });

    describe('Serialization & Persistence (_safeSerialize, writeToFile, readFromFile)', () => {
        it('should safely serialize data with circular references, functions, and buffers without error', () => {
            const circularObj = { name: 'Store Data' };
            circularObj.self = circularObj;
            circularObj.bufferData = Buffer.from('binary-buffer');
            circularObj.uint8Data = new Uint8Array([1, 2, 3]);
            circularObj.func = () => 'function';

            const serialized = store._safeSerialize(circularObj);
            assert.ok(typeof serialized === 'string');

            const parsed = JSON.parse(serialized);
            assert.equal(parsed.name, 'Store Data');
            assert.equal(parsed.self, undefined);
            assert.equal(parsed.bufferData, undefined);
            assert.equal(parsed.uint8Data, undefined);
            assert.equal(parsed.func, undefined);
        });

        it('should write store to file atomically and restore data accurately with readFromFile', () => {
            const filePath = path.join(tempDir, 'subfolder', 'baileys_store.json');

            // Setup sample data
            store.chats.set('c1@s.whatsapp.net', { id: 'c1@s.whatsapp.net', name: 'Chat Persist' });
            store.contacts.set('c1@s.whatsapp.net', { id: 'c1@s.whatsapp.net', name: 'Persist Contact', lid: 'persist@lid' });

            const msgMap = new Map();
            msgMap.set('m_p1', {
                key: { id: 'm_p1', remoteJid: 'c1@s.whatsapp.net' },
                message: { conversation: 'Saved message' },
                messageTimestamp: 1650000000
            });
            store.messages.set('c1@s.whatsapp.net', msgMap);
            store.groupMetadata.set('g1@g.us', { id: 'g1@g.us', subject: 'Saved Group' });
            store.labels.set('lbl1', { id: 'lbl1', name: 'Saved Label', color: 2 });
            store.addLabelAssociation('c1@s.whatsapp.net', 'lbl1');
            store.registerIdentity('persist@lid', 'c1@s.whatsapp.net');

            // Write to file
            const writeResult = store.writeToFile(filePath);
            assert.equal(writeResult, true);
            assert.equal(fs.existsSync(filePath), true);

            // Create fresh store and restore
            const newStore = new BaileysStore('test-session-restored');
            const readResult = newStore.readFromFile(filePath);
            assert.equal(readResult, true);

            assert.equal(newStore.chats.has('c1@s.whatsapp.net'), true);
            assert.equal(newStore.contacts.get('c1@s.whatsapp.net').name, 'Persist Contact');
            assert.equal(newStore.getMessage('c1@s.whatsapp.net', 'm_p1').message.conversation, 'Saved message');
            assert.equal(newStore.getGroupMetadata('g1@g.us').subject, 'Saved Group');
            assert.equal(newStore.getLabelById('lbl1').name, 'Saved Label');
            assert.equal(newStore.getLabelsByChat('c1@s.whatsapp.net').length, 1);
            assert.equal(newStore.resolveIdentity('persist@lid').jid, 'c1@s.whatsapp.net');
        });

        it('should handle missing, empty, or corrupted file in readFromFile safely', () => {
            const nonExistentPath = path.join(tempDir, 'does_not_exist.json');
            assert.equal(store.readFromFile(nonExistentPath), false);

            const emptyPath = path.join(tempDir, 'empty.json');
            fs.writeFileSync(emptyPath, '   ');
            assert.equal(store.readFromFile(emptyPath), false);

            const corruptedPath = path.join(tempDir, 'corrupt.enc');
            fs.writeFileSync(corruptedPath, 'ENC_ENCRYPTED_HEADER_INVALID');
            assert.equal(store.readFromFile(corruptedPath), false);
            // Verify corrupted file was removed
            assert.equal(fs.existsSync(corruptedPath), false);
        });
    });
});
