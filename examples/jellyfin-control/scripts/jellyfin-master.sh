#!/usr/bin/env bash
set -euo pipefail

# ================= CONFIG =================
SCRIPTS_DIR="/srv/jellyfin-control/scripts"
LOG_DIR="$SCRIPTS_DIR/logs"
PROGRESS_DIR="$LOG_DIR/progress"
MASTER_PROGRESS_FILE="$PROGRESS_DIR/master.json"
SCHEDULE_FILE="$LOG_DIR/schedule.json"
PRECHECK_SCRIPT="$SCRIPTS_DIR/jellyfin-has-transcode-work.py"
LOCKFILE="/tmp/jellyfin-media-optimize.lock"
PIDFILE="/tmp/jellyfin-control.pid"
TZ="Asia/Kolkata"
export TZ
# =========================================

mkdir -p "$LOG_DIR"
mkdir -p "$PROGRESS_DIR"

MASTER_LOG="$LOG_DIR/jellyfin-master.log"
MASTER_STARTED_AT="$(date --iso-8601=seconds)"

log() {
  echo "[MASTER][$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$MASTER_LOG"
}

active_window_allows_run() {
  if [[ "${JELLYFIN_FORCE_RUN:-0}" == "1" ]]; then
    log "ACTIVE WINDOW BYPASS → manual start"
    return 0
  fi

  python3 - "$SCHEDULE_FILE" <<'PY'
import json
import sys
from datetime import datetime, timedelta, timezone

path = sys.argv[1]
try:
    with open(path) as fh:
        settings = json.load(fh)
except Exception:
    sys.exit(0)

if not settings.get("enabled"):
    sys.exit(0)

def parse_hhmm(value):
    try:
        hour, minute = str(value).split(":", 1)
        hour = int(hour)
        minute = int(minute)
    except Exception:
        return None
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return hour * 60 + minute

start = parse_hhmm(settings.get("start"))
end = parse_hhmm(settings.get("end"))
if start is None or end is None or start == end:
    sys.exit(0)

now = datetime.now(timezone(timedelta(hours=5, minutes=30)))
current = now.hour * 60 + now.minute
if start < end:
    active = start <= current < end
else:
    active = current >= start or current < end

sys.exit(0 if active else 1)
PY
}

write_progress() {
  local phase="$1"
  local state="$2"
  local percent="$3"

  python3 - "$MASTER_PROGRESS_FILE" "$MASTER_STARTED_AT" "$phase" "$state" "$percent" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

path, started_at, phase, state, percent = sys.argv[1:]
started = datetime.fromisoformat(started_at)
now = datetime.now(started.tzinfo or timezone.utc)

payload = {
    "job_type": "master",
    "state": state,
    "title": "Jellyfin optimizer pipeline",
    "movie": "Optimizer pipeline",
    "file": phase,
    "phase": phase,
    "percent": float(percent),
    "eta_seconds": None,
    "eta_display": "--:--",
    "duration_display": "--:--",
    "processed_display": phase,
    "speed": "--",
    "fps": 0.0,
    "started_at": started_at,
    "elapsed_seconds": max(0, int((now - started).total_seconds())),
    "updated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
}

tmp = f"{path}.tmp"
with open(tmp, "w") as fh:
    json.dump(payload, fh, separators=(",", ":"))
os.replace(tmp, path)
PY
}

clear_progress() {
  rm -f "$MASTER_PROGRESS_FILE"
}

# -------- GLOBAL LOCK --------
exec 9>"$LOCKFILE"
if ! flock -n 9; then
  log "Another optimize job already running → EXIT"
  exit 0
fi

cleanup_and_stop() {
  clear_progress
  rm -f "$PIDFILE"
}

# -------- ENSURE STOP ALWAYS RUNS --------
trap cleanup_and_stop EXIT

log "JOB STARTED"
write_progress "Starting scheduler" "running" "2"

if ! active_window_allows_run; then
  log "OUTSIDE ACTIVE WINDOW → EXIT"
  write_progress "Outside active interval" "blocked" "0"
  exit 0
fi

if [[ "${JELLYFIN_FORCE_RUN:-0}" == "1" ]]; then
  log "TRANSCODE PRECHECK BYPASS → forced start"
elif [[ -x "$PRECHECK_SCRIPT" ]]; then
  log "TRANSCODE PRECHECK → START"
  write_progress "Checking for transcode work" "running" "10"

  set +e
  PRECHECK_OUTPUT="$(python3 "$PRECHECK_SCRIPT" 2>&1)"
  PRECHECK_STATUS=$?
  set -e

  while IFS= read -r line; do
    [[ -n "$line" ]] && log "$line"
  done <<< "$PRECHECK_OUTPUT"

  case "$PRECHECK_STATUS" in
    0)
      log "TRANSCODE PRECHECK → WORK FOUND"
      ;;
    1)
      log "NO TRANSCODE WORK → EXIT"
      write_progress "No transcode work found" "idle" "0"
      exit 0
      ;;
    *)
      log "TRANSCODE PRECHECK ERROR status=$PRECHECK_STATUS → continuing with full scan"
      ;;
  esac
else
  log "TRANSCODE PRECHECK MISSING → continuing with full scan"
fi

# -------- PHASE: SONGS --------

# python3 "$SCRIPTS_DIR/jellyfin-optimize-songs.py" \
#   >> "$LOG_DIR/jellyfin-songs.log" 2>&1

# log "PHASE COMPLETE → SONGS"

# -------- PHASE: SHOWS --------
log "PHASE → SHOWS"
write_progress "Optimizing shows" "running" "25"

python3 "$SCRIPTS_DIR/jellyfin-optimize-shows.py" \
  >> "$LOG_DIR/jellyfin-shows.log" 2>&1

log "PHASE COMPLETE → SHOWS"

# -------- PHASE: MOVIES --------
log "PHASE → MOVIES"
write_progress "Optimizing movies" "running" "55"

python3 "$SCRIPTS_DIR/jellyfin-optimize-movies.py" \
  >> "$LOG_DIR/jellyfin-movies.log" 2>&1

log "PHASE COMPLETE → MOVIES"

# -------- PHASE: UHD MOVIES --------
log "PHASE → UHD MOVIES"
write_progress "Optimizing UHD movies" "running" "80"

python3 "$SCRIPTS_DIR/jellyfin-optimize-uhdmovies.py" \
  >> "$LOG_DIR/jellyfin-uhdmovies.log" 2>&1

log "PHASE COMPLETE → UHD MOVIES"

write_progress "Finalizing optimizer run" "finalizing" "100"
log "JOB FINISHED"
