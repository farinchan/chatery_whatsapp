#!/bin/sh
set -e

# Ensure sessions and media directories exist
mkdir -p /app/sessions /app/public/media

# If running as root, ensure non-root 'chatery' user has full write permissions
# then drop privileges safely using su-exec
if [ "$(id -u)" = "0" ]; then
    chown -R chatery:chatery /app/sessions /app/public/media 2>/dev/null || true
    chmod -R 775 /app/sessions /app/public/media 2>/dev/null || true
    exec su-exec chatery "$@"
fi

# If already running as non-root user
exec "$@"
