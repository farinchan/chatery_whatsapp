const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./src/config/swagger');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Import Routes
const whatsappRoutes = require('./src/routes/whatsapp');

// Import Middleware
const userAuth = require('./src/middleware/UserAuth');

// Import WebSocket Manager
const wsManager = require('./src/services/websocket/WebSocketManager');

// Initialize WebSocket
wsManager.initialize(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || '*'
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public folder (for media access)
app.use('/media', express.static(path.join(__dirname, 'public', 'media')));
app.use(express.static(path.join(__dirname, 'public')));

// Serve Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/ui', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ui.html'));
});

// Serve WebSocket test page
app.get('/ws-test', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'websocket-test.html'));
});

// Swagger UI Options
const swaggerUiOptions = {
    customCss: `
        .swagger-ui .topbar { display: none }
        .swagger-ui .info { margin: 20px 0 }
        .swagger-ui .info .title { color: #25D366 }
    `,
    customSiteTitle: 'Chatery WhatsApp API - Documentation',
    customfavIcon: '/media/favicon.ico'
};

// API Documentation (Swagger UI) at root
app.use('/', swaggerUi.serve);
app.get('/', swaggerUi.setup(swaggerSpec, swaggerUiOptions));

// Swagger JSON endpoint
app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
});

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// Dashboard Login
app.post('/api/dashboard/login', (req, res) => {
    const { username, password } = req.body;
    
    const validUsername = process.env.DASHBOARD_USERNAME || 'admin';
    const validPassword = process.env.DASHBOARD_PASSWORD || 'admin123';
    
    if (username === validUsername && password === validPassword) {
        res.json({
            success: true,
            message: 'Login successful'
        });
    } else {
        res.status(401).json({
            success: false,
            message: 'Invalid username or password'
        });
    }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  const result = await userAuth.authenticate({ username, password });  // ← add await

  if (!result.success) {
    return res.status(401).json(result);
  }

  res.json({
    success: true,
    key: result.user.apiKey,
    username: result.user.username,
    role: result.user.role
  });
});

app.post('/api/admin/users', userAuth.validate, (req, res) => {
    const result = userAuth.createUser(req.body);
    res.status(result.success ? 201 : 400).json(result);
});

app.patch('/api/admin/users/:username', userAuth.validate, (req, res) => {
    const result = userAuth.updateUser(req.params.username, req.body);
    res.json(result);
});

app.get('/api/admin/users', userAuth.validate, (req, res) => {
    const usersList = userAuth.getUsers();
    res.json({
        success: true,
        data: usersList
    });
});

app.get('/api/admin/users/:username', userAuth.validate, (req, res) => {
    const user = userAuth.getUser({ username: req.params.username });
    if (!user) {
        return res.status(404).json({
            success: false,
            message: 'User not found'
        });
    }
    res.json({
        success: true,
        data: user
    });
});

app.get('/api/admin/users/me', userAuth.validate, (req, res) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Not authenticated'
        });
    }

    res.json({
        success: true,
        data: {
            username: req.user.username,
            role: req.user.role,
            apiKey: req.user.apiKey
        }
    });
});

// WhatsApp Routes (with API Key Authentication)
app.use('/api/whatsapp', userAuth.validate, whatsappRoutes);

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

app.get('/api/websocket/stats', (req, res) => {
    res.json({
        success: true,
        data: wsManager.getStats()
    });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Internal Server Error'
    });
});

// Start Server
server.listen(PORT, () => {
    console.log(`Chatery WhatsApp API running on http://localhost:${PORT}`);
    console.log(`API Documentation: http://localhost:${PORT}`);
});
