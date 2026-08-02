#!/bin/bash
set -e

LOG_FILE="/srv/jellyfin-control/scripts/logs/jellyfin-refresh.log"

echo "$(date) - Triggering Jellyfin library refresh" >> "$LOG_FILE"

JELLYFIN_URL="${JELLYFIN_URL:-http://jellyfin:8096}"
API_KEY="c3c8e7aadde145489ca343378d0b7744"

# Trigger full library refresh
curl -s -X POST "$JELLYFIN_URL/Library/Refresh" \
  -H "X-Emby-Token: $API_KEY" \
  -H "Content-Type: application/json"

echo "$(date) - Refresh request sent" >> "$LOG_FILE"
