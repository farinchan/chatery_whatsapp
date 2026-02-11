const express = require('express');
const router = express.Router();
const whatsappManager = require('../services/whatsapp');
const bulkJobs = new Map();

const generateJobId = () => {
    return `bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const checkSession = (req, res, next) => {
    if (!req.body) {
        return res.status(400).json({
            success: false,
            message: 'Request body is required'
        });
    }
    
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({
            success: false,
            message: 'Missing required field: sessionId'
        });
    }
    
    const session = whatsappManager.getSession(sessionId);
    
    if (!session) {
        return res.status(404).json({
            success: false,
            message: 'Session not found'
        });
    }
    
    if (session.connectionStatus !== 'connected') {
        return res.status(400).json({
            success: false,
            message: 'Session not connected. Please scan QR code first.'
        });
    }
    
    req.session = session;
    next();
};

router.get('/sessions', (req, res) => {
    try {
        const sessions = whatsappManager.getAllSessions();
        res.json({
            success: true,
            message: 'Sessions retrieved',
            data: sessions.map(s => ({
                sessionId: s.sessionId,
                status: s.status,
                isConnected: s.isConnected,
                phoneNumber: s.phoneNumber,
                name: s.name,
                webhooks: s.webhooks || [],
                metadata: s.metadata || {},
                username: s.username || ''
            }))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/sessions/connect', async (req, res) => {
    try {
        const username = req?.user?.username || '';
        const result = await whatsappManager.createSession(username);
        
        res.json({
            success: result.success,
            message: result.message,
            data: result.data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/sessions/:sessionId/connect', async (req, res) => {
    try {       
        const username = req?.user?.username || '';
        const { sessionId } = req.params;
        const result = await whatsappManager.createSession(username, sessionId);
        
        res.json({
            success: result.success,
            message: result.message,
            data: result.data
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.get('/sessions/:sessionId/status', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = whatsappManager.getSession(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        const info = session.getInfo();
        res.json({
            success: true,
            message: 'Status retrieved',
            data: {
                sessionId: info.sessionId,
                status: info.status,
                isConnected: info.isConnected,
                phoneNumber: info.phoneNumber,
                name: info.name,
                metadata: info.metadata,
                webhooks: info.webhooks
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.patch('/sessions/:sessionId/config', (req, res) => {
    try {
        const { sessionId } = req.params;
        const { metadata, webhooks } = req.body;
        
        const session = whatsappManager.getSession(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }
        
        const options = {};
        if (metadata !== undefined) options.metadata = metadata;
        if (webhooks !== undefined) options.webhooks = webhooks;
        
        const updatedInfo = session.updateConfig(options);
        
        res.json({
            success: true,
            message: 'Session config updated',
            data: {
                sessionId: updatedInfo.sessionId,
                metadata: updatedInfo.metadata,
                webhooks: updatedInfo.webhooks
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/sessions/:sessionId/webhooks', (req, res) => {
    try {
        const { sessionId } = req.params;
        const { url, events } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: url'
            });
        }
        
        const session = whatsappManager.getSession(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }
        
        const updatedInfo = session.addWebhook(url, events || ['all']);
        
        res.json({
            success: true,
            message: 'Webhook added',
            data: {
                sessionId: updatedInfo.sessionId,
                webhooks: updatedInfo.webhooks
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.delete('/sessions/:sessionId/webhooks', (req, res) => {
    try {
        const { sessionId } = req.params;
        const url = req.body?.url || req.query?.url;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: url (provide in body or query parameter)'
            });
        }
        
        const session = whatsappManager.getSession(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }
        
        const updatedInfo = session.removeWebhook(url);
        
        res.json({
            success: true,
            message: 'Webhook removed',
            data: {
                sessionId: updatedInfo.sessionId,
                webhooks: updatedInfo.webhooks
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.get('/sessions/:sessionId/qr', (req, res) => {
    try {
        const { sessionId } = req.params;
        const sessionInfo = whatsappManager.getSessionQR(sessionId);
        
        if (!sessionInfo) {
            return res.status(404).json({
                success: false,
                message: 'Session not found. Please create session first.'
            });
        }

        if (sessionInfo.isConnected) {
            return res.json({
                success: true,
                message: 'Already connected to WhatsApp',
                data: { 
                    sessionId: sessionInfo.sessionId,
                    status: 'connected', 
                    qrCode: null 
                }
            });
        }

        if (!sessionInfo.qrCode) {
            return res.status(404).json({
                success: false,
                message: 'QR Code not available yet. Please wait...',
                data: { status: sessionInfo.status }
            });
        }

        res.json({
            success: true,
            message: 'QR Code ready',
            data: {
                sessionId: sessionInfo.sessionId,
                qrCode: sessionInfo.qrCode,
                status: sessionInfo.status
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.get('/sessions/:sessionId/qr/image', (req, res) => {
    try {
        const { sessionId } = req.params;
        const sessionInfo = whatsappManager.getSessionQR(sessionId);
        
        if (!sessionInfo || !sessionInfo.qrCode) {
            return res.status(404).send('QR Code not available');
        }

        // Konversi base64 ke buffer dan kirim sebagai image
        const base64Data = sessionInfo.qrCode.replace(/^data:image\/png;base64,/, '');
        const imgBuffer = Buffer.from(base64Data, 'base64');
        
        res.set('Content-Type', 'image/png');
        res.send(imgBuffer);
    } catch (error) {
        res.status(500).send('Error generating QR image');
    }
});

router.delete('/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const result = await whatsappManager.deleteSession(sessionId);
        
        res.json({
            success: result.success,
            message: result.message
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/chats/send', checkSession, async (req, res) => {
    try {
        const { chatId, message, typingTime = 0, replyTo = null } = req.body;
        
        if (!chatId || !message) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: chatId, message'
            });
        }

        const result = await req.session.send(chatId, message, typingTime, replyTo);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.get('/chats/bulk-status/:jobId', (req, res) => {
    try {
        const { jobId } = req.params;
        const job = bulkJobs.get(jobId);
        
        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Job not found'
            });
        }
        
        res.json({
            success: true,
            data: job
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/chats/bulk-jobs', checkSession, (req, res) => {
    try {
        const { sessionId } = req.body;
        const jobs = [];
        
        bulkJobs.forEach((job, jobId) => {
            if (job.sessionId === sessionId) {
                jobs.push({ jobId, ...job });
            }
        });
        
        // Sort by createdAt descending
        jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.json({
            success: true,
            data: jobs.slice(0, 50) // Return last 50 jobs
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/chats/send-bulk', checkSession, async (req, res) => {
    try {
        const { recipients, message, delayBetweenMessages = 1000, typingTime = 0 } = req.body;
        
        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: recipients (array of phone numbers)'
            });
        }
        
        if (!message) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: message'
            });
        }
        
        if (recipients.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Maximum 100 recipients per request'
            });
        }
        
        // Generate job ID and store job info
        const jobId = generateJobId();
        const session = req.session;
        const sessionId = req.body.sessionId;
        
        bulkJobs.set(jobId, {
            sessionId,
            type: 'text',
            status: 'processing',
            total: recipients.length,
            sent: 0,
            failed: 0,
            progress: 0,
            details: [],
            createdAt: new Date().toISOString(),
            completedAt: null
        });
        
        // Respond immediately
        res.json({
            success: true,
            message: 'Bulk message job started. Check status with jobId.',
            data: {
                jobId,
                total: recipients.length,
                statusUrl: `/api/whatsapp/chats/bulk-status/${jobId}`
            }
        });
        
        // Process in background (don't await)
        (async () => {
            const job = bulkJobs.get(jobId);
            
            for (let i = 0; i < recipients.length; i++) {
                const recipient = recipients[i];
                try {
                    const result = await session.send(recipient, message, typingTime);
                    if (result.success) {
                        job.sent++;
                        job.details.push({
                            recipient,
                            status: 'sent',
                            messageId: result.data?.messageId,
                            timestamp: new Date().toISOString()
                        });
                    } else {
                        job.failed++;
                        job.details.push({
                            recipient,
                            status: 'failed',
                            error: result.message,
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (error) {
                    job.failed++;
                    job.details.push({
                        recipient,
                        status: 'failed',
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });
                }
                
                job.progress = Math.round(((i + 1) / recipients.length) * 100);
                
                // Delay between messages to avoid rate limiting
                if (i < recipients.length - 1 && delayBetweenMessages > 0) {
                    await new Promise(resolve => setTimeout(resolve, delayBetweenMessages));
                }
            }
            
            job.status = 'completed';
            job.completedAt = new Date().toISOString();
            
            // Clean up old jobs (keep last 100)
            if (bulkJobs.size > 100) {
                const sortedJobs = [...bulkJobs.entries()]
                    .sort((a, b) => new Date(b[1].createdAt) - new Date(a[1].createdAt));
                sortedJobs.slice(100).forEach(([id]) => bulkJobs.delete(id));
            }
            
            console.log(`📤 Bulk job ${jobId} completed. Sent: ${job.sent}, Failed: ${job.failed}`);
        })();
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/chats/presence', checkSession, async (req, res) => {
    try {
        const { chatId, presence = 'composing' } = req.body;
        
        if (!chatId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: chatId'
            });
        }
        
        const validPresences = ['composing', 'recording', 'paused', 'available', 'unavailable'];
        if (!validPresences.includes(presence)) {
            return res.status(400).json({
                success: false,
                message: `Invalid presence. Must be one of: ${validPresences.join(', ')}`
            });
        }
        
        const result = await req.session.sendPresenceUpdate(chatId, presence);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/chats/check-number', checkSession, async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: phone'
            });
        }
        
        const result = await req.session.isRegistered(phone);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/chats/profile-picture', checkSession, async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: phone'
            });
        }
        
        const result = await req.session.getProfilePicture(phone);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/chats/overview', checkSession, async (req, res) => {
    try {
        const { limit = 50, offset = 0, type = 'all' } = req.body;
        const result = await req.session.getChatsOverview(limit, offset, type);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/contacts', checkSession, async (req, res) => {
    try {
        const { limit = 100, offset = 0, search = '' } = req.body;
        const result = await req.session.getContacts(limit, offset, search);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/chats/messages', checkSession, async (req, res) => {
    try {
        const { chatId, limit = 50, cursor = null } = req.body;
        
        if (!chatId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: chatId'
            });
        }
        
        const result = await req.session.getChatMessages(chatId, limit, cursor);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/chats/info', checkSession, async (req, res) => {
    try {
        const { chatId } = req.body;
        
        if (!chatId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: chatId'
            });
        }
        
        const result = await req.session.getChatInfo(chatId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/chats/mark-read', checkSession, async (req, res) => {
    try {
        const { chatId, messageId } = req.body;
        
        if (!chatId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: chatId'
            });
        }
        
        console.log(`[mark-read] chatId: ${chatId}, messageId: ${messageId || 'all'}`);
        
        const result = await req.session.markChatRead(chatId, messageId || null);
        res.json(result);
    } catch (error) {
        console.error('[mark-read] Error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Internal Server Error'
        });
    }
});

router.post('/groups/create', checkSession, async (req, res) => {
    try {
        const { name, participants } = req.body;
        
        if (!name || !participants) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: name, participants'
            });
        }
        
        const result = await req.session.createGroup(name, participants);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups', checkSession, async (req, res) => {
    try {
        const result = await req.session.getAllGroups();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/metadata', checkSession, async (req, res) => {
    try {
        const { groupId } = req.body;
        
        if (!groupId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: groupId'
            });
        }
        
        const result = await req.session.groupGetMetadata(groupId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/participants/add', checkSession, async (req, res) => {
    try {
        const { groupId, participants } = req.body;
        
        if (!groupId || !participants) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: groupId, participants'
            });
        }
        
        const result = await req.session.groupAddParticipants(groupId, participants);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/participants/remove', checkSession, async (req, res) => {
    try {
        const { groupId, participants } = req.body;
        
        if (!groupId || !participants) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: groupId, participants'
            });
        }
        
        const result = await req.session.groupRemoveParticipants(groupId, participants);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/participants/promote', checkSession, async (req, res) => {
    try {
        const { groupId, participants } = req.body;
        
        if (!groupId || !participants) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: groupId, participants'
            });
        }
        
        const result = await req.session.groupPromoteParticipants(groupId, participants);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/participants/demote', checkSession, async (req, res) => {
    try {
        const { groupId, participants } = req.body;
        
        if (!groupId || !participants) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: groupId, participants'
            });
        }
        
        const result = await req.session.groupDemoteParticipants(groupId, participants);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/subject', checkSession, async (req, res) => {
    try {
        const { groupId, subject } = req.body;
        
        if (!groupId || !subject) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: groupId, subject'
            });
        }
        
        const result = await req.session.groupUpdateSubject(groupId, subject);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/description', checkSession, async (req, res) => {
    try {
        const { groupId, description } = req.body;
        
        if (!groupId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: groupId'
            });
        }
        
        const result = await req.session.groupUpdateDescription(groupId, description);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/settings', checkSession, async (req, res) => {
    try {
        const { groupId, setting } = req.body;
        
        if (!groupId || !setting) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: groupId, setting'
            });
        }
        
        const result = await req.session.groupUpdateSettings(groupId, setting);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/picture', checkSession, async (req, res) => {
    try {
        const { groupId, imageUrl } = req.body;
        
        if (!groupId || !imageUrl) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: groupId, imageUrl'
            });
        }
        
        const result = await req.session.groupUpdateProfilePicture(groupId, imageUrl);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/leave', checkSession, async (req, res) => {
    try {
        const { groupId } = req.body;
        
        if (!groupId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: groupId'
            });
        }
        
        const result = await req.session.groupLeave(groupId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/join', checkSession, async (req, res) => {
    try {
        const { inviteCode } = req.body;
        
        if (!inviteCode) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: inviteCode'
            });
        }
        
        const result = await req.session.groupJoinByInvite(inviteCode);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/invite-code', checkSession, async (req, res) => {
    try {
        const { groupId } = req.body;
        
        if (!groupId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: groupId'
            });
        }
        
        const result = await req.session.groupGetInviteCode(groupId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.post('/groups/revoke-invite', checkSession, async (req, res) => {
    try {
        const { groupId } = req.body;
        
        if (!groupId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: groupId'
            });
        }
        
        const result = await req.session.groupRevokeInvite(groupId);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;