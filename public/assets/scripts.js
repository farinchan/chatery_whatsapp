
const API_BASE = '/api/whatsapp';
let socket = null;
let sessions = [];
let isAuthenticated = false;
let apiKey = '';

// Get API headers with API key
function getApiHeaders(includeContentType = true) {
    const headers = {};
    if (includeContentType) {
        headers['Content-Type'] = 'application/json';
    }
    if (apiKey) {
        headers['X-Api-Key'] = apiKey;
    }
    return headers;
}

// Wrapper for fetch with API key
async function apiFetch(url, options = {}) {
    const headers = getApiHeaders(options.method && options.method !== 'GET');
    options.headers = { ...headers, ...options.headers };
    return fetch(url, options);
}

// Check authentication on page load
function checkAuth() {
    const authToken = sessionStorage.getItem('dashboard_auth');
    const storedApiKey = sessionStorage.getItem('api_key');
    if (authToken === 'authenticated') {
        isAuthenticated = true;
        if (storedApiKey) {
            apiKey = storedApiKey;
        }
        return true;
    }
    return false;
}

// Login with prompt
async function promptLogin() {
    const username = prompt('🔐 Dashboard Login\n\nUsername:');
    if (username === null) {
        alert('❌ Login required to access dashboard');
        window.location.href = '/';
        return false;
    }

    const password = prompt('🔑 Password:');
    if (password === null) {
        alert('❌ Login required to access dashboard');
        window.location.href = '/';
        return false;
    }

    try {
        const response = await fetch('/api/dashboard/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            sessionStorage.setItem('dashboard_auth', 'authenticated');
            isAuthenticated = true;

            // Ask for API key (optional)
            const inputApiKey = prompt('🔑 API Key (optional - leave blank if not configured):');
            if (inputApiKey && inputApiKey.trim()) {
                apiKey = inputApiKey.trim();
                sessionStorage.setItem('api_key', apiKey);
            }

            alert('✅ Login successful! Welcome to Chatery Dashboard.');
            return true;
        } else {
            alert('❌ ' + data.message);
            return promptLogin(); // Retry
        }
    } catch (error) {
        alert('❌ Login failed: ' + error.message);
        return promptLogin(); // Retry
    }
}

// Logout
function logout() {
    sessionStorage.removeItem('dashboard_auth');
    sessionStorage.removeItem('api_key');
    apiKey = '';
    isAuthenticated = false;
    alert('👋 Logged out successfully');
    window.location.reload();
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Check if already authenticated
    if (!checkAuth()) {
        const loggedIn = await promptLogin();
        if (!loggedIn) return;
    }

    connectWebSocket();
    loadSessions();
    loadWsStats();
    updateRequestBody();

    // Refresh stats every 30 seconds
    setInterval(() => {
        loadSessions();
        loadWsStats();
    }, 30000);
});

// WebSocket Connection
function connectWebSocket() {
    socket = io(window.location.origin);

    socket.on('connect', () => {
        updateWsStatus(true);
        addEvent('connection', 'WebSocket connected');

        // Subscribe to all sessions
        sessions.forEach(s => socket.emit('subscribe', s.sessionId));
    });

    socket.on('disconnect', () => {
        updateWsStatus(false);
        addEvent('error', 'WebSocket disconnected');
    });

    // WhatsApp Events
    socket.on('qr', (data) => {
        addEvent('qr', `QR Code generated for ${data.sessionId}`);
        showQrCode(data.sessionId, data.qrCode);
    });

    socket.on('connection.update', (data) => {
        addEvent('connection', `${data.sessionId}: ${data.status}`);
        if (data.status === 'connected') {
            closeQrModal();
            showToast('success', `Session ${data.sessionId} connected!`);
        }
        loadSessions();
    });

    socket.on('message', (data) => {
        const from = data.message?.from || 'unknown';
        const text = data.message?.text || data.message?.caption || '[media]';
        addEvent('message', `From ${from}: ${text.substring(0, 50)}...`);
    });

    socket.on('message.sent', (data) => {
        addEvent('message', `Message sent to ${data.message?.to || 'unknown'}`);
    });

    socket.on('logged.out', (data) => {
        addEvent('error', `Session ${data.sessionId} logged out`);
        loadSessions();
    });
}

function updateWsStatus(connected) {
    const dot = document.getElementById('wsStatus');
    const text = document.getElementById('wsStatusText');
    if (connected) {
        dot.classList.add('connected');
        text.textContent = 'WebSocket Connected';
    } else {
        dot.classList.remove('connected');
        text.textContent = 'WebSocket Disconnected';
    }
}

// Sessions
async function loadSessions() {
    try {
        const response = await apiFetch(`${API_BASE}/sessions`);
        const result = await response.json();

        if (result.success) {
            sessions = result.data;
            renderSessions();
            updateStats();
            updateQuickSendDropdown();

            // Subscribe to all sessions
            if (socket && socket.connected) {
                sessions.forEach(s => socket.emit('subscribe', s.sessionId));
            }
        }
    } catch (error) {
        console.error('Error loading sessions:', error);
    }
}

function renderSessions() {
    const container = document.getElementById('sessionsList');

    if (sessions.length === 0) {
        container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📱</div>
                        <p>No sessions yet</p>
                        <p style="font-size: 13px; margin-top: 8px;">Create a new session to get started</p>
                    </div>
                `;
        return;
    }

    container.innerHTML = sessions.map(session => {
        const webhookCount = session.webhooks ? session.webhooks.length : 0;
        return `
                <div class="session-item">
                    <div class="session-avatar">${session.name ? session.name[0].toUpperCase() : session.sessionId[0].toUpperCase()}</div>
                    <div class="session-info">
                        <div class="session-name">${session.name || session.sessionId}</div>
                        <div class="session-phone">${session.phoneNumber || session.sessionId}</div>
                        ${webhookCount > 0 ? `<div class="session-webhooks" style="font-size: 11px; color: #10b981;">🔗 ${webhookCount} webhook${webhookCount > 1 ? 's' : ''}</div>` : ''}
                    </div>
                    <div class="session-status ${session.status}">
                        <div class="status-dot ${session.status === 'connected' ? 'connected' : ''}"></div>
                        ${session.status}
                    </div>
                    <div class="session-actions">
                        ${session.status === 'qr_ready' ? `
                            <button class="btn btn-outline btn-icon" onclick="showQrForSession('${session.sessionId}')" title="Show QR">
                                📷
                            </button>
                        ` : ''}
                        ${session.status !== 'connected' ? `
                            <button class="btn btn-outline btn-icon" onclick="reconnectSession('${session.sessionId}')" title="Reconnect">
                                🔄
                            </button>
                        ` : ''}
                        <button class="btn btn-outline btn-icon" onclick="showWebhooksModal('${session.sessionId}')" title="Manage Webhooks">
                            🔗
                        </button>
                        <button class="btn btn-danger btn-icon" onclick="deleteSession('${session.sessionId}')" title="Delete">
                            🗑️
                        </button>
                    </div>
                </div>
            `}).join('');
}

function updateStats() {
    const connected = sessions.filter(s => s.status === 'connected').length;
    const disconnected = sessions.filter(s => s.status !== 'connected').length;

    document.getElementById('statSessions').textContent = sessions.length;
    document.getElementById('statConnected').textContent = connected;
    document.getElementById('statDisconnected').textContent = disconnected;
}

async function loadWsStats() {
    try {
        const response = await fetch('/api/websocket/stats');
        const result = await response.json();
        if (result.success && result.data) {
            document.getElementById('statWsClients').textContent = result.data.totalConnections || 0;
        }
    } catch (error) {
        console.error('Error loading WS stats:', error);
    }
}

function updateQuickSendDropdown() {
    const select = document.getElementById('quickSession');
    const connectedSessions = sessions.filter(s => s.status === 'connected');

    select.innerHTML = '<option value="">Select session...</option>' +
        connectedSessions.map(s => `<option value="${s.sessionId}">${s.name || s.sessionId}</option>`).join('');
}

async function createSession() {
    try {
        showToast('info', 'Creating new session...');

        const response = await apiFetch(`${API_BASE}/sessions/connect`, {
            method: 'POST',
            body: JSON.stringify({})   // ← empty body → backend auto-generates sessionId
        });

        const result = await response.json();

        if (!result.success) {
            showToast('error', result.message || 'Failed to create session');
            return;
        }

        const newSessionId = result.data?.sessionId;

        showToast('success', `Session created! ID: ${newSessionId}`);

        // Subscribe to WebSocket events for this new session
        if (socket?.connected) {
            socket.emit('subscribe', newSessionId);
        }

        // Refresh session list
        await loadSessions();

        // Auto-show QR code modal after short delay (most common next step)
        setTimeout(() => {
            if (result.data?.status === 'qr_ready' || result.data?.qrCode) {
                showQrForSession(newSessionId);
            }
        }, 800);

    } catch (err) {
        showToast('error', 'Failed to create session: ' + err.message);
        console.error('Create session error:', err);
    }
}

async function showQrForSession(sessionId) {
    document.getElementById('qrSessionName').textContent = `Session: ${sessionId}`;
    document.getElementById('qrContainer').innerHTML = '<div class="qr-loading"><div class="spinner"></div></div>';
    document.getElementById('qrModal').classList.add('active');

    try {
        const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/qr`);
        const result = await response.json();

        if (result.success && result.data?.qrCode) {
            showQrCode(sessionId, result.data.qrCode);
        } else {
            document.getElementById('qrContainer').innerHTML = '<div class="qr-loading">QR not available</div>';
        }
    } catch (error) {
        document.getElementById('qrContainer').innerHTML = '<div class="qr-loading">Failed to load QR</div>';
    }
}

function showQrCode(sessionId, qrCode) {
    document.getElementById('qrSessionName').textContent = `Session: ${sessionId}`;
    document.getElementById('qrContainer').innerHTML = `<img src="${qrCode}" alt="QR Code">`;
    document.getElementById('qrModal').classList.add('active');
}

function closeQrModal() {
    document.getElementById('qrModal').classList.remove('active');
}

async function reconnectSession(sessionId) {
    try {
        const response = await apiFetch(`${API_BASE}/sessions/${sessionId}/connect`, {
            method: 'POST',
            body: JSON.stringify({})
        });
        const result = await response.json();

        if (result.success) {
            showToast('success', 'Reconnecting...');
            loadSessions();
        } else {
            showToast('error', result.message);
        }
    } catch (error) {
        showToast('error', 'Failed to reconnect');
    }
}

async function deleteSession(sessionId) {
    if (!confirm(`Are you sure you want to delete session "${sessionId}"?`)) {
        return;
    }

    try {
        const response = await apiFetch(`${API_BASE}/sessions/${sessionId}`, {
            method: 'DELETE'
        });
        const result = await response.json();

        if (result.success) {
            showToast('success', 'Session deleted');
            loadSessions();
        } else {
            showToast('error', result.message);
        }
    } catch (error) {
        showToast('error', 'Failed to delete session');
    }
}

// Quick Send
async function quickSend() {
    const sessionId = document.getElementById('quickSession').value;
    const phone = document.getElementById('quickPhone').value.trim();
    const message = document.getElementById('quickMessage').value.trim();

    if (!sessionId || !phone || !message) {
        showToast('error', 'Please fill all fields');
        return;
    }

    try {
        const response = await apiFetch(`${API_BASE}/chats/send-text`, {
            method: 'POST',
            body: JSON.stringify({ sessionId, chatId: phone, message })
        });
        const result = await response.json();

        if (result.success) {
            showToast('success', 'Message sent!');
            document.getElementById('quickMessage').value = '';
        } else {
            showToast('error', result.message);
        }
    } catch (error) {
        showToast('error', 'Failed to send message');
    }
}

// API Tester
function updateRequestBody() {
    const endpoint = document.getElementById('apiEndpoint').value;
    const [method, path] = endpoint.split('|');
    const sessionIdGroup = document.getElementById('sessionIdGroup');
    const jobIdGroup = document.getElementById('jobIdGroup');
    const bodyTextarea = document.getElementById('apiBody');
    const apiHelp = document.getElementById('apiHelp');

    // Show/hide session ID input for URL params
    if (path.includes('{sessionId}')) {
        sessionIdGroup.style.display = 'block';
    } else {
        sessionIdGroup.style.display = 'none';
    }

    // Show/hide job ID input for URL params
    if (path.includes('{jobId}')) {
        jobIdGroup.style.display = 'block';
    } else {
        jobIdGroup.style.display = 'none';
    }

    let body = {};
    let showBody = true;
    let helpText = '';

    // Sessions
    if (path.includes('/sessions') && method === 'GET' && !path.includes('/qr/image')) {
        showBody = false;
        if (path.includes('/qr')) {
            helpText = '📱 Get QR code as base64 string in JSON format.';
        } else if (path.includes('/status')) {
            helpText = '📊 Get current session connection status.';
        }
    } else if (path.includes('/sessions') && path.includes('/qr/image') && method === 'GET') {
        showBody = false;
        helpText = '🖼️ Get QR code as PNG image. Opens in new tab for easy scanning.';
    } else if (path.includes('/sessions') && path.includes('/webhooks') && method === 'POST') {
        body = {
            url: 'https://your-server.com/webhook',
            events: ['message', 'message_ack', 'presence']
        };
        helpText = `🔗 Add a webhook URL to receive events.<br>
                    <code>url</code>: Your webhook endpoint<br>
                    <code>events</code>: (optional) Array of events to receive. Available events:<br>
                    <code>qr</code>, <code>ready</code>, <code>authenticated</code>, <code>disconnected</code>, <code>message</code>, <code>message_ack</code>, <code>message_revoke</code>, <code>presence</code>, <code>group_update</code>, <code>group_participants</code>`;
    } else if (path.includes('/sessions') && path.includes('/webhooks') && method === 'DELETE') {
        body = {
            url: 'https://your-server.com/webhook'
        };
        helpText = '🗑️ Remove a webhook by its URL.';
    } else if (path.includes('/sessions') && path.includes('/config') && method === 'PATCH') {
        body = {
            metadata: {
                appName: 'My App',
                userId: 'user123'
            },
            webhooks: [
                { url: 'https://your-server.com/webhook', events: ['message', 'message_ack'] }
            ]
        };
        helpText = `⚙️ Update session configuration.<br>
                    <code>metadata</code>: Custom data to associate with session<br>
                    <code>webhooks</code>: Array of webhook configurations`;
    } else if (path.includes('/sessions') && method === 'DELETE') {
        showBody = false;
        helpText = '⚠️ This will delete the session and all associated data including media files.';
    } else if (path.includes('/sessions') && path.includes('/connect')) {
        showBody = false;
        helpText = '📱 After connecting, scan the QR code to link your WhatsApp.';
    }
    // Messaging
    else if (path.includes('/chats/send-text')) {
        body = {
            sessionId: '',
            chatId: '628123456789',
            message: 'Hello from Chatery API!',
            typingTime: 0,
            replyTo: null
        };
        helpText = '📝 <code>chatId</code>: Phone number or group ID. <code>typingTime</code>: Typing duration in ms. <code>replyTo</code>: Message ID to reply to (optional, set null to disable).';
    } else if (path.includes('/chats/send-image')) {
        body = {
            sessionId: '',
            chatId: '628123456789',
            imageUrl: 'https://example.com/image.jpg',
            caption: 'Image caption',
            typingTime: 0,
            replyTo: null
        };
        helpText = '🖼️ <code>imageUrl</code>: Direct URL to image. <code>typingTime</code>: Typing duration in ms. <code>replyTo</code>: Message ID to reply to (optional).';
    } else if (path.includes('/chats/send-document')) {
        body = {
            sessionId: '',
            chatId: '628123456789',
            documentUrl: 'https://example.com/document.pdf',
            filename: 'document.pdf',
            mimetype: 'application/pdf',
            caption: 'Document caption here',
            typingTime: 0,
            replyTo: null
        };
        helpText = '📄 <code>caption</code>: Optional text caption. <code>mimetype</code>: MIME type. <code>replyTo</code>: Message ID to reply to (optional).';
    } else if (path.includes('/chats/send-audio')) {
        body = {
            sessionId: '',
            chatId: '628123456789',
            audioUrl: 'https://example.com/audio.ogg',
            ptt: true,
            typingTime: 0,
            replyTo: null
        };
        helpText = '🎵 <b>OGG format required!</b> <code>audioUrl</code>: Direct URL to .ogg audio file. <code>ptt</code>: true = voice note, false = audio file. Convert: <code>ffmpeg -i input.mp3 -c:a libopus output.ogg</code>';
    } else if (path.includes('/chats/send-location')) {
        body = {
            sessionId: '',
            chatId: '628123456789',
            latitude: -6.2088,
            longitude: 106.8456,
            name: 'Jakarta, Indonesia',
            typingTime: 0,
            replyTo: null
        };
        helpText = '📍 GPS coordinates. <code>replyTo</code>: Message ID to reply to (optional).';
    } else if (path.includes('/chats/send-contact')) {
        body = {
            sessionId: '',
            chatId: '628123456789',
            contactName: 'John Doe',
            contactPhone: '628987654321',
            typingTime: 0,
            replyTo: null
        };
        helpText = '👤 <code>contactPhone</code>: Contact phone number. <code>replyTo</code>: Message ID to reply to (optional).';
    } else if (path.includes('/chats/send-poll')) {
        body = {
            sessionId: '',
            chatId: '628123456789',
            question: 'What is your favorite color?',
            options: ['Red', 'Blue', 'Green', 'Yellow'],
            selectableCount: 1,
            typingTime: 0,
            replyTo: null
        };
        helpText = '📊 <code>options</code>: 2-12 choices. <code>selectableCount</code>: 1 for single choice, more for multiple. <code>replyTo</code>: Message ID to reply to (optional).';
    } else if (path.includes('/chats/send-button')) {
        body = {
            sessionId: '',
            chatId: '628123456789',
            text: 'Please choose an option:',
            footer: 'Powered by Chatery',
            buttons: ['Option 1', 'Option 2', 'Option 3'],
            typingTime: 0,
            replyTo: null
        };
        helpText = '⚠️ <b>DEPRECATED:</b> Buttons deprecated by WhatsApp. This now sends a Poll instead. Use <code>/send-poll</code> for better control.';
    } else if (path.includes('/chats/presence')) {
        body = {
            sessionId: '',
            chatId: '628123456789',
            presence: 'composing'
        };
        helpText = '✍️ <code>presence</code>: <code>composing</code> (typing), <code>recording</code> (recording audio), <code>paused</code>, <code>available</code>, <code>unavailable</code>';
    } else if (path.includes('/chats/check-number')) {
        body = {
            sessionId: '',
            phone: '628123456789'
        };
        helpText = '✅ Check if a phone number is registered on WhatsApp.';
    } else if (path.includes('/chats/profile-picture')) {
        body = {
            sessionId: '',
            phone: '628123456789'
        };
        helpText = '🖼️ Get the profile picture URL of a WhatsApp user.';
    }
    // Bulk Messaging
    else if (path.includes('/chats/send-bulk') && !path.includes('image') && !path.includes('document')) {
        body = {
            sessionId: '',
            recipients: ['628123456789', '628987654321', '628111222333'],
            message: 'Hello from Chatery Bulk API!',
            delay: 1000
        };
        helpText = `📤 Send bulk text messages (runs in background).<br>
                    <code>recipients</code>: Array of phone numbers (max 100)<br>
                    <code>message</code>: Text message to send<br>
                    <code>delay</code>: Delay between messages in ms (default: 1000)<br>
                    ⚡ Returns jobId immediately, use bulk-status to track progress.`;
    } else if (path.includes('/chats/send-bulk-image')) {
        body = {
            sessionId: '',
            recipients: ['628123456789', '628987654321', '628111222333'],
            imageUrl: 'https://example.com/image.jpg',
            caption: 'Bulk image caption',
            delay: 1500
        };
        helpText = `🖼️ Send bulk images (runs in background).<br>
                    <code>recipients</code>: Array of phone numbers (max 100)<br>
                    <code>imageUrl</code>: Direct URL to image<br>
                    <code>caption</code>: Optional image caption<br>
                    <code>delay</code>: Delay between messages in ms (default: 1000)<br>
                    ⚡ Returns jobId immediately, use bulk-status to track progress.`;
    } else if (path.includes('/chats/send-bulk-document')) {
        body = {
            sessionId: '',
            recipients: ['628123456789', '628987654321', '628111222333'],
            documentUrl: 'https://example.com/document.pdf',
            filename: 'document.pdf',
            mimetype: 'application/pdf',
            delay: 1500
        };
        helpText = `📄 Send bulk documents (runs in background).<br>
                    <code>recipients</code>: Array of phone numbers (max 100)<br>
                    <code>documentUrl</code>: Direct URL to document<br>
                    <code>filename</code>: Document filename<br>
                    <code>mimetype</code>: MIME type (optional)<br>
                    <code>delay</code>: Delay between messages in ms (default: 1000)<br>
                    ⚡ Returns jobId immediately, use bulk-status to track progress.`;
    } else if (path.includes('/chats/bulk-status')) {
        showBody = false;
        helpText = `📊 Get status of a bulk messaging job.<br>
                    Replace <code>{jobId}</code> in the URL with your job ID.<br>
                    Returns: status, progress, sent count, failed count, and results.`;
    } else if (path.includes('/chats/bulk-jobs')) {
        body = {
            sessionId: ''
        };
        helpText = `📋 Get all bulk messaging jobs for a session.<br>
                    Returns: Array of all jobs with their status and progress.`;
    }
    // Chat History
    else if (path.includes('/chats/overview')) {
        body = {
            sessionId: '',
            limit: 50,
            offset: 0,
            type: 'all'
        };
        helpText = '💬 <code>type</code>: Filter by <code>all</code>, <code>personal</code>, or <code>group</code>';
    } else if (path.includes('/contacts')) {
        body = {
            sessionId: '',
            limit: 100,
            offset: 0,
            search: ''
        };
        helpText = '👥 <code>search</code>: Filter contacts by name or number';
    } else if (path.includes('/chats/messages')) {
        body = {
            sessionId: '',
            chatId: '628123456789@s.whatsapp.net',
            limit: 50,
            cursor: null
        };
        helpText = '📜 <code>chatId</code>: Use @s.whatsapp.net for personal chats, @g.us for groups. <code>cursor</code>: Message ID for pagination.';
    } else if (path.includes('/chats/info')) {
        body = {
            sessionId: '',
            chatId: '628123456789@s.whatsapp.net'
        };
        helpText = 'ℹ️ Get detailed information about a chat or group.';
    } else if (path.includes('/chats/mark-read')) {
        body = {
            sessionId: '',
            chatId: '628123456789'
        };
        helpText = '✅ Mark all unread messages in a chat as read. Works for both personal and group chats.<br><code>chatId</code>: Phone number or group ID.<br>⚠️ Note: Only messages received after server start can be marked as read.';
    }
    // Groups - Basic
    else if (path === 'POST|/api/whatsapp/groups' || path.endsWith('/groups')) {
        body = {
            sessionId: ''
        };
        helpText = '👥 Get all groups you are participating in.';
    } else if (path.includes('/groups/create')) {
        body = {
            sessionId: '',
            name: 'My New Group',
            participants: ['628123456789', '628987654321']
        };
        helpText = '➕ <code>participants</code>: Array of phone numbers to add to the new group.';
    } else if (path.includes('/groups/metadata')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us'
        };
        helpText = 'ℹ️ Get detailed group info including participants, admins, and settings.';
    } else if (path.includes('/groups/leave')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us'
        };
        helpText = '🚪 Leave a group. You will need to be re-added by an admin to rejoin.';
    } else if (path.includes('/groups/join')) {
        body = {
            sessionId: '',
            inviteCode: 'https://chat.whatsapp.com/AbCdEfGhIjK'
        };
        helpText = '🔗 <code>inviteCode</code>: Can be full URL or just the code part.';
    }
    // Groups - Participants
    else if (path.includes('/groups/participants/add')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us',
            participants: ['628123456789', '628987654321']
        };
        helpText = '➕ Add new members to the group. You must be an admin.';
    } else if (path.includes('/groups/participants/remove')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us',
            participants: ['628123456789']
        };
        helpText = '➖ Remove members from the group. You must be an admin.';
    } else if (path.includes('/groups/participants/promote')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us',
            participants: ['628123456789']
        };
        helpText = '⬆️ Promote members to admin. You must be an admin.';
    } else if (path.includes('/groups/participants/demote')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us',
            participants: ['628123456789']
        };
        helpText = '⬇️ Demote admins to regular members. You must be an admin.';
    }
    // Groups - Settings
    else if (path.includes('/groups/subject')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us',
            subject: 'New Group Name'
        };
        helpText = '✏️ Update the group name/subject. Max 25 characters.';
    } else if (path.includes('/groups/description')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us',
            description: 'This is the group description'
        };
        helpText = '📝 Update group description. Can be empty to remove.';
    } else if (path.includes('/groups/settings')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us',
            setting: 'announcement'
        };
        helpText = `⚙️ <code>setting</code> options:<br>
                    • <code>announcement</code> - Only admins can send messages<br>
                    • <code>not_announcement</code> - All members can send<br>
                    • <code>locked</code> - Only admins can edit group info<br>
                    • <code>unlocked</code> - All members can edit group info`;
    } else if (path.includes('/groups/picture')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us',
            imageUrl: 'https://example.com/group-pic.jpg'
        };
        helpText = '🖼️ Update group profile picture. Image should be square.';
    } else if (path.includes('/groups/invite-code')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us'
        };
        helpText = '🔗 Get the current invite link for the group.';
    } else if (path.includes('/groups/revoke-invite')) {
        body = {
            sessionId: '',
            groupId: '123456789@g.us'
        };
        helpText = '🔄 Revoke current invite link and generate a new one.';
    }
    // System
    else if (path.includes('/health') || path.includes('/websocket/stats')) {
        showBody = false;
    }

    if (showBody) {
        bodyTextarea.value = JSON.stringify(body, null, 2);
        bodyTextarea.parentElement.style.display = 'block';
    } else {
        bodyTextarea.value = '';
        bodyTextarea.parentElement.style.display = 'none';
    }

    // Show/hide help text
    if (helpText) {
        apiHelp.innerHTML = helpText;
        apiHelp.style.display = 'block';
    } else {
        apiHelp.style.display = 'none';
    }
}

async function sendApiRequest() {
    const endpoint = document.getElementById('apiEndpoint').value;
    let [method, path] = endpoint.split('|');
    const bodyText = document.getElementById('apiBody').value;
    const responseBox = document.getElementById('apiResponse');
    const btn = document.getElementById('btnSendApi');
    const sessionIdInput = document.getElementById('apiSessionId');
    const jobIdInput = document.getElementById('apiJobId');

    // Replace {sessionId} placeholder if needed
    if (path.includes('{sessionId}')) {
        const sessionId = sessionIdInput.value.trim();
        if (!sessionId) {
            showToast('error', 'Please enter a Session ID');
            return;
        }
        path = path.replace('{sessionId}', sessionId);
    }

    // Replace {jobId} placeholder if needed
    if (path.includes('{jobId}')) {
        const jobId = jobIdInput.value.trim();
        if (!jobId) {
            showToast('error', 'Please enter a Job ID');
            return;
        }
        path = path.replace('{jobId}', jobId);
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Sending...';
    responseBox.textContent = 'Loading...';

    try {
        // Special handling for QR image endpoint - open in new tab
        if (path.includes('/qr/image')) {
            window.open(path, '_blank');
            responseBox.textContent = 'QR Image opened in new tab. Scan the QR code with your WhatsApp app.';
            showToast('success', 'QR Image opened in new tab');
            return;
        }

        const options = {
            method: method,
            headers: getApiHeaders(true)
        };

        // Special handling for DELETE webhooks - use query parameter
        if (method === 'DELETE' && path.includes('/webhooks') && bodyText) {
            try {
                const bodyObj = JSON.parse(bodyText);
                if (bodyObj.url) {
                    path = `${path}?url=${encodeURIComponent(bodyObj.url)}`;
                }
            } catch (e) {
                // Ignore JSON parse error
            }
        } else if (method !== 'GET' && method !== 'DELETE' && bodyText) {
            options.body = bodyText;
        }

        const response = await fetch(path, options);
        const result = await response.json();

        responseBox.textContent = JSON.stringify(result, null, 2);

        if (result.success) {
            showToast('success', 'Request successful');
        } else {
            showToast('error', result.message || 'Request failed');
        }
    } catch (error) {
        responseBox.textContent = `Error: ${error.message}`;
        showToast('error', error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Send Request';
    }
}

// Events Log
function addEvent(type, content) {
    const log = document.getElementById('eventsLog');
    const time = new Date().toLocaleTimeString();

    // Remove empty state if exists
    const emptyState = log.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }

    const eventHtml = `
                <div class="event-item">
                    <span class="event-time">${time}</span>
                    <span class="event-type ${type}">${type}</span>
                    <span class="event-content">${content}</span>
                </div>
            `;

    log.insertAdjacentHTML('afterbegin', eventHtml);

    // Keep only last 100 events
    while (log.children.length > 100) {
        log.removeChild(log.lastChild);
    }
}

function clearEvents() {
    document.getElementById('eventsLog').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📡</div>
                    <p>No events yet</p>
                    <p style="font-size: 13px; margin-top: 8px;">Events will appear here in real-time</p>
                </div>
            `;
}

// Toast
function showToast(type, message) {
    const container = document.getElementById('toastContainer');
    const id = Date.now();

    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.id = `toast-${id}`;
    toast.innerHTML = `
                <span>${icons[type] || 'ℹ️'}</span>
                <span>${message}</span>
            `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}

// Webhook Management
let currentWebhookSessionId = null;

function showWebhooksModal(sessionId) {
    currentWebhookSessionId = sessionId;
    document.getElementById('webhooksSessionName').textContent = `Session: ${sessionId}`;
    document.getElementById('webhooksModal').classList.add('active');
    document.getElementById('newWebhookUrl').value = '';
    document.querySelectorAll('.webhook-event').forEach(cb => cb.checked = false);
    loadWebhooks(sessionId);
}

function closeWebhooksModal() {
    document.getElementById('webhooksModal').classList.remove('active');
    currentWebhookSessionId = null;
}

async function loadWebhooks(sessionId) {
    const container = document.getElementById('webhooksList');
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 16px;"><div class="spinner"></div></div>';

    try {
        const session = sessions.find(s => s.sessionId === sessionId);
        const webhooks = session?.webhooks || [];

        if (webhooks.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 16px;">No webhooks configured</div>';
            return;
        }

        container.innerHTML = webhooks.map((wh, index) => `
                    <div style="background: var(--card-bg); border-radius: 8px; padding: 12px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-start;">
                        <div style="flex: 1; overflow: hidden;">
                            <div style="font-size: 13px; font-weight: 500; word-break: break-all;">${wh.url}</div>
                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                                ${wh.events && wh.events.length > 0 ? `Events: ${wh.events.join(', ')}` : 'All events'}
                            </div>
                        </div>
                        <button class="btn btn-danger btn-icon" data-webhook-url="${encodeURIComponent(wh.url)}" onclick="removeWebhook(decodeURIComponent(this.dataset.webhookUrl))" title="Remove" style="margin-left: 8px;">
                            🗑️
                        </button>
                    </div>
                `).join('');
    } catch (error) {
        container.innerHTML = '<div style="text-align: center; color: #ef4444; padding: 16px;">Error loading webhooks</div>';
        console.error('Error loading webhooks:', error);
    }
}

async function addWebhook() {
    const url = document.getElementById('newWebhookUrl').value.trim();

    if (!url) {
        showToast('error', 'Please enter a webhook URL');
        return;
    }

    try {
        new URL(url);
    } catch {
        showToast('error', 'Please enter a valid URL');
        return;
    }

    const events = [];
    document.querySelectorAll('.webhook-event:checked').forEach(cb => {
        events.push(cb.value);
    });

    try {
        const response = await apiFetch(`${API_BASE}/sessions/${currentWebhookSessionId}/webhooks`, {
            method: 'POST',
            body: JSON.stringify({ url, events: events.length > 0 ? events : undefined })
        });

        const result = await response.json();

        if (result.success) {
            showToast('success', 'Webhook added successfully');
            document.getElementById('newWebhookUrl').value = '';
            document.querySelectorAll('.webhook-event').forEach(cb => cb.checked = false);

            // Update local session data
            const session = sessions.find(s => s.sessionId === currentWebhookSessionId);
            if (session) {
                session.webhooks = result.data?.webhooks || [];
            }

            loadWebhooks(currentWebhookSessionId);
            renderSessions();
        } else {
            showToast('error', result.error || 'Failed to add webhook');
        }
    } catch (error) {
        showToast('error', 'Failed to add webhook');
        console.error('Error adding webhook:', error);
    }
}

async function removeWebhook(url) {
    console.log('removeWebhook called with:', url);

    if (!url) {
        showToast('error', 'Webhook URL is missing');
        console.error('removeWebhook: url is undefined or empty');
        return;
    }

    if (!confirm(`Remove webhook?\n${url}`)) {
        return;
    }

    try {
        // Use query parameter for DELETE (more reliable than body)
        const encodedUrl = encodeURIComponent(url);
        const fullUrl = `${API_BASE}/sessions/${currentWebhookSessionId}/webhooks?url=${encodedUrl}`;
        console.log('DELETE request to:', fullUrl);

        const response = await apiFetch(fullUrl, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            showToast('success', 'Webhook removed successfully');

            // Update local session data
            const session = sessions.find(s => s.sessionId === currentWebhookSessionId);
            if (session) {
                session.webhooks = result.data?.webhooks || [];
            }

            loadWebhooks(currentWebhookSessionId);
            renderSessions();
        } else {
            showToast('error', result.error || 'Failed to remove webhook');
        }
    } catch (error) {
        showToast('error', 'Failed to remove webhook');
        console.error('Error removing webhook:', error);
    }
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeQrModal();
        closeWebhooksModal();
    }
});

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('active');
        }
    });
});
