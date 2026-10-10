# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install build dependencies for native modules and dependencies
# libc6-compat helps with compatibility for OpenSSL/Network libs on Alpine
RUN apk add --no-cache libc6-compat
RUN npm ci --only=production

# Production stage
FROM node:20-alpine

# Add labels
LABEL maintainer="Fajri Rinaldi Chan <fajri@gariskode.com>"
LABEL description="Chatery WhatsApp API - Multi-session WhatsApp API"
LABEL version="1.0.0"

# Install runtime compatibility library
RUN apk add --no-cache libc6-compat

# Create non-root user for security
RUN addgroup -g 1001 -S chatery && \
    adduser -S -D -H -u 1001 -G chatery chatery

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY . .

# Create directories for sessions and media with proper permissions
RUN mkdir -p /app/sessions /app/public/media /app/store && \
    chown -R chatery:chatery /app

# Switch to non-root user
USER chatery

# Expose port
EXPOSE 3000

# Health check using lightweight /api/health endpoint instead of Swagger UI HTML
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Configure default Node.js memory and OpenSSL provider
ENV NODE_OPTIONS="--openssl-legacy-provider --max-old-space-size=2048"

# Start the application
CMD ["node", "index.js"]