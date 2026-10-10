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
const apiKeyAuth = require('./src/middleware/apiKeyAuth');

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

// Serve Dashboard (Overview & Session Management)
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Serve WhatsApp Web Client
app.get('/wa-web', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'wa-web.html'));
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
            message: 'Login successful',
            apiKey: process.env.API_KEY || ''
        });
    } else {
        res.status(401).json({
            success: false,
            message: 'Invalid username or password'
        });
    }
});

// WebSocket Stats
app.get('/api/websocket/stats', (req, res) => {
    res.json({
        success: true,
        data: wsManager.getStats()
    });
});

// WhatsApp Routes (with API Key Authentication)
app.use('/api/whatsapp', apiKeyAuth, whatsappRoutes);

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// Start Server
if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`Chatery WhatsApp API running on http://localhost:${PORT}`);
        console.log(`WebSocket server running on ws://localhost:${PORT}`);
        console.log(`API Documentation: http://localhost:${PORT}`);
    });
}

module.exports = { app, server };

