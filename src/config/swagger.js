const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Chatery WhatsApp API',
            version: '1.0.0',
            description: `
A powerful WhatsApp API backend built with Express.js and Baileys library.

## Quick Links
- [🎛️ Dashboard](/dashboard) - Admin Dashboard with API Tester
- [🔌 WebSocket Test](/ws-test) - Test real-time WebSocket events
- [📄 OpenAPI JSON](/api-docs.json) - Download API specification


## Features
- Multi-Session Support
- Real-time WebSocket Events
- Group Management
- Send Messages (Text, Image, Document, Location, Contact)
- Auto-Save Media
- Persistent Store
- API Key Authentication

## Authentication
All API endpoints require \`X-Api-Key\` header (if API_KEY is configured in .env).

## Full Documentation
- [https://docs.chatery.app](https://docs.chatery.app)
- [https://chatery-whatsapp-documentation.appwrite.network](https://chatery-whatsapp-documentation.appwrite.network)

## ⭐ Support This Project
- [⭐ Star on GitHub](https://github.com/farinchan/chatery_backend) - Give us a star!
- [☕ Buy Me a Coffee (saweria)](https://saweria.co/fajrichan) - Support the developer

            `,
            contact: {
                name: 'Fajri Rinaldi Chan',
                email: 'fajri@gariskode.com',
                url: 'https://github.com/farinchan'
            },
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT'
            }
        },
        servers: [
            {
                url: '/',
                description: 'Current Server'
            },
            {
                url: 'http://localhost:3000',
                description: 'Local Development'
            }
        ],
        tags: [
            { name: 'Health', description: 'Health check endpoints' },
            { name: 'Sessions', description: 'WhatsApp session management' },
            { name: 'Messaging', description: 'Send messages (text, image, document, etc.)' },
            { name: 'Bulk Messaging', description: 'Send bulk messages to multiple recipients (max 100 per request)' },
            { name: 'Chat History', description: 'Get chats, messages, contacts' },
            { name: 'Groups', description: 'Group management operations' },
            { name: 'WebSocket', description: 'WebSocket connection info' },
            { name: 'Labels', description: 'Label management for WhatsApp Business accounts' }
        ],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-Api-Key',
                    description: 'API Key for authentication (configured in .env)'
                }
            },
            schemas: {
                SuccessResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: true },
                        message: { type: 'string', example: 'Operation successful' },
                        data: { type: 'object' }
                    }
                },
                ErrorResponse: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean', example: false },
                        message: { type: 'string', example: 'Error message' }
                    }
                },
                Session: {
                    type: 'object',
                    properties: {
                        sessionId: { type: 'string', example: 'mysession' },
                        status: { type: 'string', enum: ['connecting', 'connected', 'disconnected'], example: 'connected' },
                        isConnected: { type: 'boolean', example: true },
                        phoneNumber: { type: 'string', example: '628123456789' },
                        name: { type: 'string', example: 'John Doe' }
                    }
                },
                Message: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        chatId: { type: 'string' },
                        fromMe: { type: 'boolean' },
                        timestamp: { type: 'integer' },
                        type: { type: 'string' },
                        content: { type: 'object' }
                    }
                },
                Chat: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        isGroup: { type: 'boolean' },
                        unreadCount: { type: 'integer' },
                        lastMessage: { type: 'object' }
                    }
                },
                Group: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        subject: { type: 'string' },
                        owner: { type: 'string' },
                        creation: { type: 'integer' },
                        participants: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    admin: { type: 'string', nullable: true }
                                }
                            }
                        }
                    }
                },
                Webhook: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', format: 'uri', example: 'https://your-server.com/webhook' },
                        events: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['message', 'connection.update']
                        }
                    }
                }
            }
        },
        security: [{ ApiKeyAuth: [] }]
    },
    apis: ['./src/config/swagger-paths.js']
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
