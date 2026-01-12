/**
 * @swagger
 * /api/health:
 *   get:
 *     tags: [Health]
 *     summary: Health check
 *     description: Check if server is running
 *     security: []
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Server is running
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */

/**
 * @swagger
 * /api/websocket/stats:
 *   get:
 *     tags: [WebSocket]
 *     summary: Get WebSocket stats
 *     description: Get current WebSocket connection statistics
 *     security: []
 *     responses:
 *       200:
 *         description: WebSocket statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalConnections:
 *                       type: integer
 *                     rooms:
 *                       type: object
 */

/**
 * @swagger
 * /api/dashboard/login:
 *   post:
 *     tags: [Dashboard]
 *     summary: Dashboard login
 *     description: Authenticate to access the dashboard
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *                 example: admin
 *               password:
 *                 type: string
 *                 example: admin123
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */

// ==================== SESSIONS ====================

/**
 * @swagger
 * /api/whatsapp/sessions:
 *   get:
 *     tags: [Sessions]
 *     summary: List all sessions
 *     description: Get list of all WhatsApp sessions
 *     responses:
 *       200:
 *         description: Sessions list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Session'
 */

/**
 * @swagger
 * /api/whatsapp/sessions/{sessionId}/connect:
 *   post:
 *     tags: [Sessions]
 *     summary: Create/Connect session
 *     description: Create a new session or reconnect existing session
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         example: mysession
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               metadata:
 *                 type: object
 *                 description: Custom metadata
 *                 example: { "userId": "123", "plan": "premium" }
 *               webhooks:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/Webhook'
 *     responses:
 *       200:
 *         description: Session created/connected
 *       400:
 *         description: Session already exists
 */

/**
 * @swagger
 * /api/whatsapp/sessions/{sessionId}/status:
 *   get:
 *     tags: [Sessions]
 *     summary: Get session status
 *     description: Get detailed status of a session
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session status
 *       404:
 *         description: Session not found
 */

/**
 * @swagger
 * /api/whatsapp/sessions/{sessionId}/qr:
 *   get:
 *     tags: [Sessions]
 *     summary: Get QR code
 *     description: Get QR code for session authentication (base64)
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: QR code data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     qrCode:
 *                       type: string
 *                       description: Base64 QR code image
 */

/**
 * @swagger
 * /api/whatsapp/sessions/{sessionId}/qr/image:
 *   get:
 *     tags: [Sessions]
 *     summary: Get QR code image
 *     description: Get QR code as PNG image
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: QR code PNG image
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 */

/**
 * @swagger
 * /api/whatsapp/sessions/{sessionId}/config:
 *   patch:
 *     tags: [Sessions]
 *     summary: Update session config
 *     description: Update metadata and webhooks for a session
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               metadata:
 *                 type: object
 *               webhooks:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/Webhook'
 *     responses:
 *       200:
 *         description: Config updated
 */

/**
 * @swagger
 * /api/whatsapp/sessions/{sessionId}/webhooks:
 *   post:
 *     tags: [Sessions]
 *     summary: Add webhook
 *     description: Add a new webhook to session
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Webhook'
 *     responses:
 *       200:
 *         description: Webhook added
 *   delete:
 *     tags: [Sessions]
 *     summary: Remove webhook
 *     description: Remove a webhook from session
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url]
 *             properties:
 *               url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Webhook removed
 */

/**
 * @swagger
 * /api/whatsapp/sessions/{sessionId}:
 *   delete:
 *     tags: [Sessions]
 *     summary: Delete session
 *     description: Logout and delete a session
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session deleted
 */

// ==================== MESSAGING ====================

/**
 * @swagger
 * /api/whatsapp/chats/send-text:
 *   post:
 *     tags: [Messaging]
 *     summary: Send text message
 *     description: Send a text message to a chat. Optionally reply to a specific message.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId, message]
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: mysession
 *               chatId:
 *                 type: string
 *                 example: "628123456789"
 *                 description: Phone number or group JID
 *               message:
 *                 type: string
 *                 example: Hello World!
 *               typingTime:
 *                 type: integer
 *                 example: 2000
 *                 description: Typing indicator duration (ms)
 *               replyTo:
 *                 type: string
 *                 example: "3EB0B430A2B52B67D0"
 *                 description: Message ID to reply to (optional)
 *     responses:
 *       200:
 *         description: Message sent
 */

/**
 * @swagger
 * /api/whatsapp/chats/send-image:
 *   post:
 *     tags: [Messaging]
 *     summary: Send image message
 *     description: Send an image with optional caption. Optionally reply to a specific message.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId, imageUrl]
 *             properties:
 *               sessionId:
 *                 type: string
 *               chatId:
 *                 type: string
 *               imageUrl:
 *                 type: string
 *                 example: https://example.com/image.jpg
 *               caption:
 *                 type: string
 *               typingTime:
 *                 type: integer
 *               replyTo:
 *                 type: string
 *                 example: "3EB0B430A2B52B67D0"
 *                 description: Message ID to reply to (optional)
 *     responses:
 *       200:
 *         description: Image sent
 */

/**
 * @swagger
 * /api/whatsapp/chats/send-document:
 *   post:
 *     tags: [Messaging]
 *     summary: Send document with caption
 *     description: Send a document/file with optional caption. Optionally reply to a specific message.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId, documentUrl, filename]
 *             properties:
 *               sessionId:
 *                 type: string
 *               chatId:
 *                 type: string
 *               documentUrl:
 *                 type: string
 *                 example: https://example.com/document.pdf
 *               filename:
 *                 type: string
 *                 example: document.pdf
 *               mimetype:
 *                 type: string
 *                 example: application/pdf
 *               caption:
 *                 type: string
 *                 example: Here is the document you requested
 *                 description: Optional caption for the document
 *               typingTime:
 *                 type: integer
 *               replyTo:
 *                 type: string
 *                 example: "3EB0B430A2B52B67D0"
 *                 description: Message ID to reply to (optional)
 *     responses:
 *       200:
 *         description: Document sent
 */

/**
 * @swagger
 * /api/whatsapp/chats/send-audio:
 *   post:
 *     tags: [Messaging]
 *     summary: Send audio message (OGG only)
 *     description: |
 *       Send an audio file or voice note. Set ptt=true for voice note mode.
 *       
 *       **Important:** Audio must be in OGG format (.ogg). WhatsApp only supports OGG audio files with Opus codec.
 *       
 *       You can convert audio to OGG using FFmpeg:
 *       ```
 *       ffmpeg -i input.mp3 -c:a libopus output.ogg
 *       ```
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId, audioUrl]
 *             properties:
 *               sessionId:
 *                 type: string
 *               chatId:
 *                 type: string
 *               audioUrl:
 *                 type: string
 *                 example: https://example.com/audio.ogg
 *                 description: URL to OGG audio file (required format)
 *               ptt:
 *                 type: boolean
 *                 default: false
 *                 description: Push to talk mode (true = voice note, false = audio file)
 *               typingTime:
 *                 type: integer
 *                 description: Recording simulation time in ms
 *               replyTo:
 *                 type: string
 *                 example: "3EB0B430A2B52B67D0"
 *                 description: Message ID to reply to (optional)
 *     responses:
 *       200:
 *         description: Audio sent
 *       400:
 *         description: Invalid format - must be OGG
 */

/**
 * @swagger
 * /api/whatsapp/chats/send-location:
 *   post:
 *     tags: [Messaging]
 *     summary: Send location
 *     description: Send a location message. Optionally reply to a specific message.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId, latitude, longitude]
 *             properties:
 *               sessionId:
 *                 type: string
 *               chatId:
 *                 type: string
 *               latitude:
 *                 type: number
 *                 example: -6.2088
 *               longitude:
 *                 type: number
 *                 example: 106.8456
 *               name:
 *                 type: string
 *                 example: Jakarta
 *               typingTime:
 *                 type: integer
 *               replyTo:
 *                 type: string
 *                 example: "3EB0B430A2B52B67D0"
 *                 description: Message ID to reply to (optional)
 *     responses:
 *       200:
 *         description: Location sent
 */

/**
 * @swagger
 * /api/whatsapp/chats/send-contact:
 *   post:
 *     tags: [Messaging]
 *     summary: Send contact
 *     description: Send a contact card. Optionally reply to a specific message.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId, contactName, contactPhone]
 *             properties:
 *               sessionId:
 *                 type: string
 *               chatId:
 *                 type: string
 *               contactName:
 *                 type: string
 *                 example: John Doe
 *               contactPhone:
 *                 type: string
 *                 example: "628987654321"
 *               typingTime:
 *                 type: integer
 *               replyTo:
 *                 type: string
 *                 example: "3EB0B430A2B52B67D0"
 *                 description: Message ID to reply to (optional)
 *     responses:
 *       200:
 *         description: Contact sent
 */

/**
 * @swagger
 * /api/whatsapp/chats/send-button:
 *   post:
 *     tags: [Messaging]
 *     summary: Send button message (DEPRECATED - uses Poll)
 *     description: |
 *       **Note:** WhatsApp deprecated button messages in 2022.
 *       This endpoint now uses Poll as an alternative for interactive choices.
 *       The buttons will be displayed as poll options.
 *       
 *       For actual button messages, you need WhatsApp Business API (Cloud API).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId, text, buttons]
 *             properties:
 *               sessionId:
 *                 type: string
 *               chatId:
 *                 type: string
 *               text:
 *                 type: string
 *                 example: Choose an option
 *               footer:
 *                 type: string
 *               buttons:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Option 1", "Option 2", "Option 3"]
 *               typingTime:
 *                 type: integer
 *               replyTo:
 *                 type: string
 *                 example: "3EB0B430A2B52B67D0"
 *                 description: Message ID to reply to (optional)
 *     responses:
 *       200:
 *         description: Poll sent (as button alternative)
 */

/**
 * @swagger
 * /api/whatsapp/chats/send-poll:
 *   post:
 *     tags: [Messaging]
 *     summary: Send poll message
 *     description: |
 *       Send a poll message with multiple options.
 *       This is the recommended alternative to deprecated button messages.
 *       
 *       - Supports 2-12 options
 *       - selectableCount controls single (1) or multiple choice
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId, question, options]
 *             properties:
 *               sessionId:
 *                 type: string
 *               chatId:
 *                 type: string
 *               question:
 *                 type: string
 *                 example: What is your favorite color?
 *               options:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 2
 *                 maxItems: 12
 *                 example: ["Red", "Blue", "Green", "Yellow"]
 *               selectableCount:
 *                 type: integer
 *                 default: 1
 *                 description: Number of options that can be selected (1 for single choice)
 *               typingTime:
 *                 type: integer
 *               replyTo:
 *                 type: string
 *                 example: "3EB0B430A2B52B67D0"
 *                 description: Message ID to reply to (optional)
 *     responses:
 *       200:
 *         description: Poll sent successfully
 */

/**
 * @swagger
 * /api/whatsapp/chats/bulk-status/{jobId}:
 *   get:
 *     tags: [Bulk Messaging]
 *     summary: Get bulk job status
 *     description: Check the status and progress of a bulk messaging job
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: The bulk job ID returned from send-bulk endpoints
 *         example: bulk_1704326400000_abc123def
 *     responses:
 *       200:
 *         description: Job status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     sessionId:
 *                       type: string
 *                     type:
 *                       type: string
 *                       enum: [text, image, document]
 *                     status:
 *                       type: string
 *                       enum: [processing, completed]
 *                     total:
 *                       type: integer
 *                     sent:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *                     progress:
 *                       type: integer
 *                       description: Progress percentage (0-100)
 *                     details:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           recipient:
 *                             type: string
 *                           status:
 *                             type: string
 *                           messageId:
 *                             type: string
 *                           error:
 *                             type: string
 *                           timestamp:
 *                             type: string
 *                     createdAt:
 *                       type: string
 *                     completedAt:
 *                       type: string
 *       404:
 *         description: Job not found
 */

/**
 * @swagger
 * /api/whatsapp/chats/bulk-jobs:
 *   post:
 *     tags: [Bulk Messaging]
 *     summary: Get all bulk jobs for a session
 *     description: Retrieve list of all bulk messaging jobs for a specific session (last 50)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId]
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: mysession
 *     responses:
 *       200:
 *         description: List of jobs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       jobId:
 *                         type: string
 *                       type:
 *                         type: string
 *                       status:
 *                         type: string
 *                       total:
 *                         type: integer
 *                       sent:
 *                         type: integer
 *                       failed:
 *                         type: integer
 *                       progress:
 *                         type: integer
 *                       createdAt:
 *                         type: string
 *                       completedAt:
 *                         type: string
 */

/**
 * @swagger
 * /api/whatsapp/chats/send-bulk:
 *   post:
 *     tags: [Bulk Messaging]
 *     summary: Send bulk text message (Background)
 *     description: |
 *       Send the same text message to multiple recipients. **Runs in background** - returns immediately with a jobId to track progress.
 *       
 *       **Features:**
 *       - Maximum 100 recipients per request
 *       - Runs in background, returns immediately
 *       - Track progress using GET /chats/bulk-status/{jobId}
 *       - Automatic delay between messages to avoid rate limiting
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, recipients, message]
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: mysession
 *               recipients:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["628123456789", "628987654321", "628111222333"]
 *                 description: Array of phone numbers (max 100)
 *               message:
 *                 type: string
 *                 example: Hello! This is a bulk message.
 *               delayBetweenMessages:
 *                 type: integer
 *                 example: 1000
 *                 description: Delay between messages in milliseconds (default 1000ms)
 *               typingTime:
 *                 type: integer
 *                 example: 0
 *                 description: Typing indicator duration before each message (ms)
 *     responses:
 *       200:
 *         description: Job started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Bulk message job started. Check status with jobId.
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobId:
 *                       type: string
 *                       example: bulk_1704326400000_abc123def
 *                     total:
 *                       type: integer
 *                       example: 3
 *                     statusUrl:
 *                       type: string
 *                       example: /api/whatsapp/chats/bulk-status/bulk_1704326400000_abc123def
 */

/**
 * @swagger
 * /api/whatsapp/chats/send-bulk-image:
 *   post:
 *     tags: [Bulk Messaging]
 *     summary: Send bulk image message (Background)
 *     description: |
 *       Send the same image to multiple recipients. **Runs in background** - returns immediately with a jobId.
 *       
 *       Track progress using GET /chats/bulk-status/{jobId}
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, recipients, imageUrl]
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: mysession
 *               recipients:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["628123456789", "628987654321"]
 *                 description: Array of phone numbers (max 100)
 *               imageUrl:
 *                 type: string
 *                 example: https://example.com/image.jpg
 *               caption:
 *                 type: string
 *                 example: Check out this image!
 *               delayBetweenMessages:
 *                 type: integer
 *                 example: 1000
 *               typingTime:
 *                 type: integer
 *                 example: 0
 *     responses:
 *       200:
 *         description: Job started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobId:
 *                       type: string
 *                     total:
 *                       type: integer
 *                     statusUrl:
 *                       type: string
 */

/**
 * @swagger
 * /api/whatsapp/chats/send-bulk-document:
 *   post:
 *     tags: [Bulk Messaging]
 *     summary: Send bulk document (Background)
 *     description: |
 *       Send the same document to multiple recipients. **Runs in background** - returns immediately with a jobId.
 *       
 *       Track progress using GET /chats/bulk-status/{jobId}
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, recipients, documentUrl, filename]
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: mysession
 *               recipients:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["628123456789", "628987654321"]
 *               documentUrl:
 *                 type: string
 *                 example: https://example.com/document.pdf
 *               filename:
 *                 type: string
 *                 example: document.pdf
 *               mimetype:
 *                 type: string
 *                 example: application/pdf
 *               delayBetweenMessages:
 *                 type: integer
 *                 example: 1000
 *               typingTime:
 *                 type: integer
 *                 example: 0
 *     responses:
 *       200:
 *         description: Job started successfully
 */

/**
 * @swagger
 * /api/whatsapp/chats/presence:
 *   post:
 *     tags: [Messaging]
 *     summary: Send presence update
 *     description: Send typing/recording indicator
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId, presence]
 *             properties:
 *               sessionId:
 *                 type: string
 *               chatId:
 *                 type: string
 *               presence:
 *                 type: string
 *                 enum: [composing, recording, paused, available, unavailable]
 *     responses:
 *       200:
 *         description: Presence updated
 */

/**
 * @swagger
 * /api/whatsapp/chats/check-number:
 *   post:
 *     tags: [Messaging]
 *     summary: Check WhatsApp number
 *     description: Check if a phone number is registered on WhatsApp
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, phone]
 *             properties:
 *               sessionId:
 *                 type: string
 *               phone:
 *                 type: string
 *                 example: "628123456789"
 *     responses:
 *       200:
 *         description: Number check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     exists:
 *                       type: boolean
 *                     jid:
 *                       type: string
 */

// ==================== CHAT HISTORY ====================

/**
 * @swagger
 * /api/whatsapp/chats/overview:
 *   post:
 *     tags: [Chat History]
 *     summary: Get chat overview
 *     description: Get list of all chats with last message
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId]
 *             properties:
 *               sessionId:
 *                 type: string
 *               limit:
 *                 type: integer
 *                 example: 50
 *               offset:
 *                 type: integer
 *                 example: 0
 *               type:
 *                 type: string
 *                 enum: [all, individual, group]
 *     responses:
 *       200:
 *         description: Chat list
 */

/**
 * @swagger
 * /api/whatsapp/chats/messages:
 *   post:
 *     tags: [Chat History]
 *     summary: Get chat messages
 *     description: Get messages from a specific chat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId]
 *             properties:
 *               sessionId:
 *                 type: string
 *               chatId:
 *                 type: string
 *               limit:
 *                 type: integer
 *                 example: 50
 *               cursor:
 *                 type: string
 *                 description: Pagination cursor
 *     responses:
 *       200:
 *         description: Messages list
 */

/**
 * @swagger
 * /api/whatsapp/chats/info:
 *   post:
 *     tags: [Chat History]
 *     summary: Get chat info
 *     description: Get detailed information about a chat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId]
 *             properties:
 *               sessionId:
 *                 type: string
 *               chatId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Chat information
 */

/**
 * @swagger
 * /api/whatsapp/chats/mark-read:
 *   post:
 *     tags: [Chat History]
 *     summary: Mark chat as read
 *     description: |
 *       Mark all unread messages in a chat as read. Works for both private chats and group chats.
 *       
 *       **Note:** Only messages that were received after the server started can be marked as read
 *       (messages must be in the in-memory store).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, chatId]
 *             properties:
 *               sessionId:
 *                 type: string
 *                 example: mysession
 *               chatId:
 *                 type: string
 *                 description: Chat ID (phone number or group ID)
 *                 example: "628123456789"
 *     responses:
 *       200:
 *         description: Chat marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Chat marked as read
 *                 data:
 *                   type: object
 *                   properties:
 *                     chatId:
 *                       type: string
 *                       example: "628123456789@s.whatsapp.net"
 *                     isGroup:
 *                       type: boolean
 *                       example: false
 *                     markedCount:
 *                       type: integer
 *                       description: Number of messages marked as read
 *                       example: 5
 */

/**
 * @swagger
 * /api/whatsapp/contacts:
 *   post:
 *     tags: [Chat History]
 *     summary: Get contacts
 *     description: Get all contacts
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId]
 *             properties:
 *               sessionId:
 *                 type: string
 *               limit:
 *                 type: integer
 *               offset:
 *                 type: integer
 *               search:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contacts list
 */

/**
 * @swagger
 * /api/whatsapp/chats/profile-picture:
 *   post:
 *     tags: [Chat History]
 *     summary: Get profile picture
 *     description: Get profile picture URL of a contact
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, phone]
 *             properties:
 *               sessionId:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile picture URL
 */

/**
 * @swagger
 * /api/whatsapp/chats/contact-info:
 *   post:
 *     tags: [Chat History]
 *     summary: Get contact info
 *     description: Get detailed contact information
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, phone]
 *             properties:
 *               sessionId:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contact information
 */

// ==================== GROUPS ====================

/**
 * @swagger
 * /api/whatsapp/groups:
 *   post:
 *     tags: [Groups]
 *     summary: List groups
 *     description: Get all groups for a session
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId]
 *             properties:
 *               sessionId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Groups list
 */

/**
 * @swagger
 * /api/whatsapp/groups/create:
 *   post:
 *     tags: [Groups]
 *     summary: Create group
 *     description: Create a new WhatsApp group
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, name, participants]
 *             properties:
 *               sessionId:
 *                 type: string
 *               name:
 *                 type: string
 *                 example: My New Group
 *               participants:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["628123456789", "628987654321"]
 *     responses:
 *       200:
 *         description: Group created
 */

/**
 * @swagger
 * /api/whatsapp/groups/metadata:
 *   post:
 *     tags: [Groups]
 *     summary: Get group metadata
 *     description: Get detailed group information
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *                 example: "120363123456789@g.us"
 *     responses:
 *       200:
 *         description: Group metadata
 */

/**
 * @swagger
 * /api/whatsapp/groups/participants/add:
 *   post:
 *     tags: [Groups]
 *     summary: Add participants
 *     description: Add participants to a group
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId, participants]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *               participants:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Participants added
 */

/**
 * @swagger
 * /api/whatsapp/groups/participants/remove:
 *   post:
 *     tags: [Groups]
 *     summary: Remove participants
 *     description: Remove participants from a group
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId, participants]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *               participants:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Participants removed
 */

/**
 * @swagger
 * /api/whatsapp/groups/participants/promote:
 *   post:
 *     tags: [Groups]
 *     summary: Promote to admin
 *     description: Promote participants to group admin
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId, participants]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *               participants:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Participants promoted
 */

/**
 * @swagger
 * /api/whatsapp/groups/participants/demote:
 *   post:
 *     tags: [Groups]
 *     summary: Demote from admin
 *     description: Demote admins to regular participants
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId, participants]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *               participants:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Participants demoted
 */

/**
 * @swagger
 * /api/whatsapp/groups/subject:
 *   post:
 *     tags: [Groups]
 *     summary: Update group subject
 *     description: Change group name/subject
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId, subject]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *               subject:
 *                 type: string
 *                 example: New Group Name
 *     responses:
 *       200:
 *         description: Subject updated
 */

/**
 * @swagger
 * /api/whatsapp/groups/description:
 *   post:
 *     tags: [Groups]
 *     summary: Update group description
 *     description: Change group description
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId, description]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Description updated
 */

/**
 * @swagger
 * /api/whatsapp/groups/settings:
 *   post:
 *     tags: [Groups]
 *     summary: Update group settings
 *     description: Change group settings (who can send messages, edit info)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId, setting]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *               setting:
 *                 type: string
 *                 enum: [announcement, not_announcement, locked, unlocked]
 *     responses:
 *       200:
 *         description: Settings updated
 */

/**
 * @swagger
 * /api/whatsapp/groups/picture:
 *   post:
 *     tags: [Groups]
 *     summary: Update group picture
 *     description: Change group profile picture
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId, imageUrl]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *               imageUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Picture updated
 */

/**
 * @swagger
 * /api/whatsapp/groups/leave:
 *   post:
 *     tags: [Groups]
 *     summary: Leave group
 *     description: Leave a WhatsApp group
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Left group
 */

/**
 * @swagger
 * /api/whatsapp/groups/join:
 *   post:
 *     tags: [Groups]
 *     summary: Join group
 *     description: Join a group using invite code
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, inviteCode]
 *             properties:
 *               sessionId:
 *                 type: string
 *               inviteCode:
 *                 type: string
 *                 example: AbCdEfGhIjK
 *     responses:
 *       200:
 *         description: Joined group
 */

/**
 * @swagger
 * /api/whatsapp/groups/invite-code:
 *   post:
 *     tags: [Groups]
 *     summary: Get invite code
 *     description: Get group invite code/link
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invite code
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     inviteCode:
 *                       type: string
 *                     inviteLink:
 *                       type: string
 */

/**
 * @swagger
 * /api/whatsapp/groups/revoke-invite:
 *   post:
 *     tags: [Groups]
 *     summary: Revoke invite code
 *     description: Revoke current invite code and generate new one
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, groupId]
 *             properties:
 *               sessionId:
 *                 type: string
 *               groupId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invite revoked
 */

// ==================== WEBSOCKET DOCUMENTATION ====================

/**
 * @swagger
 * tags:
 *   - name: WebSocket
 *     description: |
 *       ## Real-time WebSocket Events
 *       
 *       Connect to the WebSocket server for real-time updates.
 *       
 *       ### Connection
 *       ```javascript
 *       const socket = io('ws://your-server:3000');
 *       ```
 *       
 *       ### Subscribe to Session Events
 *       ```javascript
 *       // Subscribe to receive events from a specific session
 *       socket.emit('subscribe', 'your-session-id');
 *       
 *       // Unsubscribe from session events
 *       socket.emit('unsubscribe', 'your-session-id');
 *       ```
 *       
 *       ### Available Events
 *       
 *       | Event | Description | Payload |
 *       |-------|-------------|---------|
 *       | `qr` | QR code generated for authentication | `{ sessionId, qr, qrCode }` |
 *       | `connection.update` | Connection status changed | `{ sessionId, status, isConnected }` |
 *       | `message` | New incoming message | `{ sessionId, message, chatId, ... }` |
 *       | `message.sent` | Message sent confirmation | `{ sessionId, messageId, status }` |
 *       | `message.update` | Message status update (delivered/read) | `{ sessionId, messageId, status }` |
 *       | `message.revoke` | Message deleted/revoked | `{ sessionId, messageId, chatId }` |
 *       | `chat.update` | Chat updated | `{ sessionId, chat }` |
 *       | `chat.upsert` | New chat created | `{ sessionId, chat }` |
 *       | `chat.delete` | Chat deleted | `{ sessionId, chatId }` |
 *       | `contact.update` | Contact updated | `{ sessionId, contact }` |
 *       | `presence.update` | Presence status (typing, online) | `{ sessionId, chatId, presence }` |
 *       | `group.participants` | Group members update | `{ sessionId, groupId, action, participants }` |
 *       | `group.update` | Group info update | `{ sessionId, groupId, update }` |
 *       | `call` | Incoming call | `{ sessionId, call }` |
 *       | `logged.out` | Session logged out | `{ sessionId, reason }` |
 *       
 *       ### Example: Listen for Messages
 *       ```javascript
 *       socket.on('message', (data) => {
 *         console.log('New message:', data);
 *         // data.sessionId - Which session received the message
 *         // data.message - Message content and metadata
 *         // data.chatId - Chat/sender ID
 *       });
 *       ```
 *       
 *       ### Example: Listen for Connection Updates
 *       ```javascript
 *       socket.on('connection.update', (data) => {
 *         console.log('Connection status:', data.status);
 *         // data.status: 'connecting', 'connected', 'disconnected'
 *       });
 *       ```
 *       
 *       ### Example: Listen for QR Code
 *       ```javascript
 *       socket.on('qr', (data) => {
 *         console.log('Scan this QR:', data.qrCode);
 *         // data.qrCode - Base64 encoded QR image
 *       });
 *       ```
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Session:
 *       type: object
 *       description: WhatsApp session information
 *       properties:
 *         sessionId:
 *           type: string
 *           description: Unique session identifier
 *           example: mysession
 *         status:
 *           type: string
 *           enum: [disconnected, connecting, qr_ready, connected]
 *           description: Current session status
 *           example: connected
 *         isConnected:
 *           type: boolean
 *           description: Whether session is currently connected
 *           example: true
 *         phoneNumber:
 *           type: string
 *           description: Connected WhatsApp phone number
 *           example: "628123456789"
 *         name:
 *           type: string
 *           description: WhatsApp profile name
 *           example: John Doe
 *         webhooks:
 *           type: array
 *           description: Configured webhooks for this session
 *           items:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *                 description: Webhook URL
 *                 example: https://example.com/webhook
 *               events:
 *                 type: array
 *                 description: Events to receive (empty = all events)
 *                 items:
 *                   type: string
 *                 example: [message, message_ack]
 *         metadata:
 *           type: object
 *           description: Custom metadata associated with this session
 *           example: {"appName": "MyApp", "userId": "123"}
 *
 *     WebSocketEvent:
 *       type: object
 *       description: WebSocket event payload structure
 *       properties:
 *         sessionId:
 *           type: string
 *           description: Session that triggered the event
 *           example: mysession
 *         event:
 *           type: string
 *           description: Event type
 *           example: message
 *         data:
 *           type: object
 *           description: Event-specific data
 *     
 *     QREvent:
 *       type: object
 *       description: QR code event payload
 *       properties:
 *         sessionId:
 *           type: string
 *           example: mysession
 *         qr:
 *           type: string
 *           description: Raw QR string data
 *         qrCode:
 *           type: string
 *           description: Base64 encoded QR code image (data:image/png;base64,...)
 *     
 *     ConnectionUpdateEvent:
 *       type: object
 *       description: Connection status update event
 *       properties:
 *         sessionId:
 *           type: string
 *           example: mysession
 *         status:
 *           type: string
 *           enum: [connecting, connected, disconnected]
 *           example: connected
 *         isConnected:
 *           type: boolean
 *           example: true
 *         phoneNumber:
 *           type: string
 *           example: "628123456789"
 *         name:
 *           type: string
 *           example: John Doe
 *     
 *     MessageEvent:
 *       type: object
 *       description: Incoming message event
 *       properties:
 *         sessionId:
 *           type: string
 *           example: mysession
 *         message:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *               description: Message ID
 *             chatId:
 *               type: string
 *               description: Chat/sender JID
 *             fromMe:
 *               type: boolean
 *               description: Was sent by the session user
 *             timestamp:
 *               type: integer
 *               description: Unix timestamp
 *             type:
 *               type: string
 *               enum: [text, image, video, audio, document, sticker, location, contact]
 *             content:
 *               type: object
 *               description: Message content based on type
 *             pushName:
 *               type: string
 *               description: Sender display name
 *     
 *     MessageUpdateEvent:
 *       type: object
 *       description: Message status update event
 *       properties:
 *         sessionId:
 *           type: string
 *         messageId:
 *           type: string
 *         status:
 *           type: string
 *           enum: [pending, sent, delivered, read, played]
 *         chatId:
 *           type: string
 *     
 *     PresenceUpdateEvent:
 *       type: object
 *       description: Presence/typing indicator event
 *       properties:
 *         sessionId:
 *           type: string
 *         chatId:
 *           type: string
 *         presence:
 *           type: string
 *           enum: [composing, recording, paused, available, unavailable]
 *         lastSeen:
 *           type: integer
 *           description: Last seen timestamp (if available)
 *     
 *     GroupParticipantsEvent:
 *       type: object
 *       description: Group participants update event
 *       properties:
 *         sessionId:
 *           type: string
 *         groupId:
 *           type: string
 *           example: "120363123456789@g.us"
 *         action:
 *           type: string
 *           enum: [add, remove, promote, demote]
 *         participants:
 *           type: array
 *           items:
 *             type: string
 *           example: ["628123456789@s.whatsapp.net"]
 *         actor:
 *           type: string
 *           description: Who performed the action
 *     
 *     CallEvent:
 *       type: object
 *       description: Incoming call event
 *       properties:
 *         sessionId:
 *           type: string
 *         call:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             from:
 *               type: string
 *             isVideo:
 *               type: boolean
 *             isGroup:
 *               type: boolean
 *             status:
 *               type: string
 *               enum: [offer, ringing, timeout, reject, accept]
 */

module.exports = {};
