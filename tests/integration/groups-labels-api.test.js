const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { startTestServer, apiRequest, createMockSession, whatsappManager } = require('./test-helper');

describe('Groups & Labels API Integration Tests', () => {
    let testServer;
    let baseUrl;
    const SESSION_ID = 'test_groups_session';
    const GROUP_ID = '123456789-987654@g.us';

    before(async () => {
        testServer = await startTestServer();
        baseUrl = testServer.baseUrl;
    });

    after(async () => {
        await testServer.stop();
    });

    beforeEach(() => {
        whatsappManager.sessions.clear();
        const session = createMockSession(SESSION_ID, {
            connectionStatus: 'connected'
        });
        whatsappManager.sessions.set(SESSION_ID, session);
    });

    describe('Group Management Endpoints', () => {
        it('POST /groups/create: should validate name and participants', async () => {
            // Missing participants
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/create', {
                method: 'POST',
                body: { sessionId: SESSION_ID, name: 'Dev Team' }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);
            assert.ok(res1.data.message.includes('Missing required fields'));

            // Missing name
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/create', {
                method: 'POST',
                body: { sessionId: SESSION_ID, participants: ['628111'] }
            });
            assert.strictEqual(res2.status, 400);

            // Valid request
            const res3 = await apiRequest(baseUrl, '/api/whatsapp/groups/create', {
                method: 'POST',
                body: { sessionId: SESSION_ID, name: 'Dev Team', participants: ['628111', '628222'] }
            });
            assert.strictEqual(res3.status, 200);
            assert.strictEqual(res3.data.success, true);
            assert.ok(res3.data.data.id);
        });

        it('POST /groups: should retrieve all groups', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/groups', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.ok(Array.isArray(res.data.data));
        });

        it('POST /groups/metadata: should validate groupId', async () => {
            // Missing groupId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/metadata', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);
            assert.ok(res1.data.message.includes('groupId'));

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/metadata', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
            assert.strictEqual(res2.data.data.id, GROUP_ID);
        });

        it('POST /groups/participants/add: should validate groupId and participants', async () => {
            // Missing participants
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/participants/add', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/participants/add', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID, participants: ['628333444'] }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /groups/participants/remove: should validate groupId and participants', async () => {
            // Missing groupId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/participants/remove', {
                method: 'POST',
                body: { sessionId: SESSION_ID, participants: ['628333444'] }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/participants/remove', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID, participants: ['628333444'] }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /groups/participants/promote: should validate groupId and participants', async () => {
            // Missing participants
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/participants/promote', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/participants/promote', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID, participants: ['628333444'] }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /groups/participants/demote: should validate groupId and participants', async () => {
            // Missing participants
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/participants/demote', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/participants/demote', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID, participants: ['628333444'] }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /groups/subject: should validate groupId and subject', async () => {
            // Missing subject
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/subject', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/subject', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID, subject: 'New Group Name' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /groups/description: should validate groupId', async () => {
            // Missing groupId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/description', {
                method: 'POST',
                body: { sessionId: SESSION_ID, description: 'Cool Group' }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/description', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID, description: 'Cool Group' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /groups/settings: should validate groupId and setting', async () => {
            // Missing setting
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/settings', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/settings', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID, setting: 'announcement' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /groups/picture: should validate groupId and imageUrl', async () => {
            // Missing imageUrl
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/picture', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/picture', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID, imageUrl: 'https://example.com/grouppic.jpg' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /groups/leave: should validate groupId', async () => {
            // Missing groupId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/leave', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/leave', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /groups/join: should validate inviteCode', async () => {
            // Missing inviteCode
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/join', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/join', {
                method: 'POST',
                body: { sessionId: SESSION_ID, inviteCode: 'https://chat.whatsapp.com/ABC123xyz' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /groups/invite-code: should validate groupId', async () => {
            // Missing groupId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/invite-code', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/invite-code', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
            assert.ok(res2.data.data.inviteCode);
        });

        it('POST /groups/revoke-invite: should validate groupId', async () => {
            // Missing groupId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/revoke-invite', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/revoke-invite', {
                method: 'POST',
                body: { sessionId: SESSION_ID, groupId: GROUP_ID }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
            assert.ok(res2.data.data.inviteCode);
        });

        it('POST /groups/invite-info: should validate inviteCode', async () => {
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/groups/invite-info', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);

            const res2 = await apiRequest(baseUrl, '/api/whatsapp/groups/invite-info', {
                method: 'POST',
                body: { sessionId: SESSION_ID, inviteCode: 'https://chat.whatsapp.com/ABC123xyz' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });
    });

    describe('Labels Endpoints', () => {
        it('POST /labels: should retrieve all labels', async () => {
            const res = await apiRequest(baseUrl, '/api/whatsapp/labels', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.data.success, true);
            assert.ok(Array.isArray(res.data.data));
        });

        it('POST /labels/create: should validate label name or labelId', async () => {
            // Missing name and labelId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/labels/create', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);
            assert.ok(res1.data.message.includes('Label name is required'));

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/labels/create', {
                method: 'POST',
                body: { sessionId: SESSION_ID, name: 'VIP Customer', colorId: 2 }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
            assert.strictEqual(res2.data.data.name, 'VIP Customer');
        });

        it('POST /labels/delete: should validate labelId', async () => {
            // Missing labelId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/labels/delete', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);
            assert.ok(res1.data.message.includes('Label ID is required'));

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/labels/delete', {
                method: 'POST',
                body: { sessionId: SESSION_ID, labelId: 'label_vip' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /labels/chat/add: should validate chatId and labelId', async () => {
            // Missing labelId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/labels/chat/add', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123456789@c.us' }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);
            assert.ok(res1.data.message.includes('Chat ID and label ID are required'));

            // Missing chatId
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/labels/chat/add', {
                method: 'POST',
                body: { sessionId: SESSION_ID, labelId: '1' }
            });
            assert.strictEqual(res2.status, 400);

            // Valid request with personal chat
            const res3 = await apiRequest(baseUrl, '/api/whatsapp/labels/chat/add', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123456789@c.us', labelId: '1' }
            });
            assert.strictEqual(res3.status, 200);
            assert.strictEqual(res3.data.success, true);

            // Valid request with group chat
            const res4 = await apiRequest(baseUrl, '/api/whatsapp/labels/chat/add', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '12345-67890@g.us', labelId: '1' }
            });
            assert.strictEqual(res4.status, 200);
            assert.strictEqual(res4.data.success, true);
        });

        it('POST /labels/chat/remove: should validate chatId and labelId', async () => {
            // Missing labelId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/labels/chat/remove', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123456789@c.us' }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/labels/chat/remove', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123456789@c.us', labelId: '1' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
        });

        it('POST /labels/chat: should validate chatId', async () => {
            // Missing chatId
            const res1 = await apiRequest(baseUrl, '/api/whatsapp/labels/chat', {
                method: 'POST',
                body: { sessionId: SESSION_ID }
            });
            assert.strictEqual(res1.status, 400);
            assert.strictEqual(res1.data.success, false);
            assert.ok(res1.data.message.includes('Chat ID is required'));

            // Valid request
            const res2 = await apiRequest(baseUrl, '/api/whatsapp/labels/chat', {
                method: 'POST',
                body: { sessionId: SESSION_ID, chatId: '628123456789@c.us' }
            });
            assert.strictEqual(res2.status, 200);
            assert.strictEqual(res2.data.success, true);
            assert.ok(res2.data.data.labels);
        });
    });
});
