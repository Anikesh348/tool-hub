#!/usr/bin/env bash
set -euo pipefail

CONTROL_URL="${JELLYFIN_CONTROL_URL:-http://127.0.0.1:5050}"
LOG_FILE="/srv/jellyfin-control/scripts/logs/jellyfin-cron.log"

schedule="$(curl -fsS "$CONTROL_URL/api/schedule")" || {
  printf '[%s] schedule check failed\n' "$(date --iso-8601=seconds)" >> "$LOG_FILE"
  exit 1
}

if ! python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("schedule", d); raise SystemExit(0 if s.get("active_now", True) else 1)' <<< "$schedule"; then
  printf '[%s] outside active interval; no optimizer started\n' "$(date --iso-8601=seconds)" >> "$LOG_FILE"
  exit 0
fi

response="$(curl -fsS -X POST "$CONTROL_URL/start?scheduled=1")"
message="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("message", "scheduled request completed"))' <<< "$response")"
printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$message" >> "$LOG_FILE"
