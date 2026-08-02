#!/usr/bin/env python3

import json
import logging
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, Response, jsonify, render_template_string, request

app = Flask(__name__)

# ================= CONFIG =================

MASTER_SCRIPT = "/srv/jellyfin-control/scripts/jellyfin-master.sh"
SUBTITLE_SCRIPT = "/srv/jellyfin-control/scripts/jellyfin-generate-subtitles.py"
LOCK_FILE = "/tmp/jellyfin-media-optimize.lock"
PID_FILE = "/tmp/jellyfin-control.pid"
CONTROL_ROOT = Path("/srv/jellyfin-control")
COMPOSE_FILE = CONTROL_ROOT / "docker-compose.yml"
COMPOSE_SERVICE = os.environ.get("CONTROL_SERVICE_NAME", "jellyfin-control")
CONTROL_PORT = os.environ.get("CONTROL_PORT", "5050")

LOG_DIR = Path("/srv/jellyfin-control/scripts/logs")
PROGRESS_DIR = LOG_DIR / "progress"
MASTER_PROGRESS_FILE = PROGRESS_DIR / "master.json"
LOG_DIR.mkdir(parents=True, exist_ok=True)
PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "jellyfin-control.log"
SCHEDULE_FILE = LOG_DIR / "schedule.json"
SCHEDULE_TZ = timezone(timedelta(hours=5, minutes=30), "IST")
DEFAULT_SCHEDULE = {
    "enabled": False,
    "start": "00:00",
    "end": "23:59",
    "timezone": "Asia/Kolkata",
}
WATCHED_LOGS = {
    "master": LOG_DIR / "jellyfin-master.log",
    "shows": LOG_DIR / "jellyfin-shows.log",
    "movies": LOG_DIR / "jellyfin-movies.log",
    "uhdmovies": LOG_DIR / "jellyfin-uhdmovies.log",
    "songs": LOG_DIR / "jellyfin-songs.log",
    "subtitles": LOG_DIR / "jellyfin-subtitles.log",
    "refresh": LOG_DIR / "jellyfin-refresh.log",
    "control": LOG_FILE,
}
LOG_SOURCE_GROUPS = {
    "conversion": ("shows", "movies", "uhdmovies", "songs"),
}
CONVERSION_LOG_EVENTS = (
    "SCAN_CANDIDATE",
    "CONVERT_START",
    "CONVERT_PROFILE",
    "FFMPEG_CMD",
    "FFMPEG_PID",
    "FFMPEG_MSG",
    "CONVERT_PROGRESS",
    "FFMPEG_EXIT",
    "CONVERT_DONE",
    "ERROR",
)

MEDIA_ROOTS = [
    Path("/srv/data/media/movies"),
    Path("/srv/data/media/uhdmovies"),
    Path("/srv/data/media/shows"),
    Path("/srv/data/media/songs"),
]

SUB_EXTS = {".srt", ".ass", ".ssa", ".sub"}

# =========================================


logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [CONTROL] %(levelname)s -> %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)

log = logging.getLogger()


def forward_log_files_to_stdout():
    positions = {}
    inodes = {}

    while True:
        for name, path in WATCHED_LOGS.items():
            if name == "control":
                continue

            try:
                if not path.exists():
                    positions.pop(name, None)
                    inodes.pop(name, None)
                    continue

                stat = path.stat()
                previous_inode = inodes.get(name)
                if previous_inode is None:
                    inodes[name] = stat.st_ino
                    positions[name] = stat.st_size
                    continue

                previous_position = positions.get(name, stat.st_size)

                if previous_inode != stat.st_ino or stat.st_size < previous_position:
                    previous_position = 0
                    inodes[name] = stat.st_ino

                if stat.st_size == previous_position:
                    positions[name] = previous_position
                    continue

                with path.open("r", encoding="utf-8", errors="replace") as fh:
                    fh.seek(previous_position)
                    for line in fh:
                        line = line.rstrip()
                        if line:
                            print(f"[JELLYFIN_CONTROL_LOG][{name}] {line}", flush=True)
                    positions[name] = fh.tell()
            except OSError as exc:
                print(f"[JELLYFIN_CONTROL_LOG][{name}] failed to read {path.name}: {exc}", file=sys.stderr, flush=True)

        time.sleep(1)


threading.Thread(target=forward_log_files_to_stdout, daemon=True).start()


def run(cmd):
    log.info(f"Executing: {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.stdout:
        log.info(f"STDOUT: {result.stdout.strip()}")
    if result.stderr:
        log.warning(f"STDERR: {result.stderr.strip()}")
    return result


def run_cmd(cmd, cwd=None):
    rendered = " ".join(cmd)
    log.info(f"Executing command: {rendered}")
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.stdout:
        log.info(f"STDOUT: {result.stdout.strip()}")
    if result.stderr:
        log.warning(f"STDERR: {result.stderr.strip()}")
    return result


def parse_hhmm(value):
    if not isinstance(value, str):
        return None

    parts = value.strip().split(":")
    if len(parts) != 2:
        return None

    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except ValueError:
        return None

    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return hour * 60 + minute


def load_schedule():
    settings = dict(DEFAULT_SCHEDULE)
    try:
        if SCHEDULE_FILE.exists():
            with SCHEDULE_FILE.open() as fh:
                payload = json.load(fh)
            if isinstance(payload, dict):
                settings.update(payload)
    except Exception as exc:
        log.warning(f"Failed reading schedule settings: {exc}")

    if parse_hhmm(settings.get("start")) is None:
        settings["start"] = DEFAULT_SCHEDULE["start"]
    if parse_hhmm(settings.get("end")) is None:
        settings["end"] = DEFAULT_SCHEDULE["end"]
    settings["enabled"] = bool(settings.get("enabled"))
    settings["timezone"] = "Asia/Kolkata"
    settings.update(get_schedule_state(settings))
    return settings


def save_schedule(payload):
    settings = load_schedule()
    if "enabled" in payload:
        settings["enabled"] = bool(payload.get("enabled"))

    start = payload.get("start", settings["start"])
    end = payload.get("end", settings["end"])
    if parse_hhmm(start) is None or parse_hhmm(end) is None:
        raise ValueError("Start and end times must use HH:MM format")

    settings["start"] = start
    settings["end"] = end
    settings["timezone"] = "Asia/Kolkata"

    persisted = {
        "enabled": settings["enabled"],
        "start": settings["start"],
        "end": settings["end"],
        "timezone": settings["timezone"],
    }
    tmp = SCHEDULE_FILE.with_suffix(".json.tmp")
    with tmp.open("w") as fh:
        json.dump(persisted, fh, indent=2)
    tmp.replace(SCHEDULE_FILE)
    log.info(f"Saved active interval: enabled={settings['enabled']} start={settings['start']} end={settings['end']}")
    return load_schedule()


def get_schedule_state(settings):
    now = datetime.now(SCHEDULE_TZ)
    current = now.hour * 60 + now.minute
    start = parse_hhmm(settings.get("start"))
    end = parse_hhmm(settings.get("end"))
    enabled = bool(settings.get("enabled"))

    if start is None or end is None:
        active = True
        crosses_midnight = False
        duration_minutes = 24 * 60
    elif start == end:
        active = True
        crosses_midnight = False
        duration_minutes = 24 * 60
    elif start < end:
        active = start <= current < end
        crosses_midnight = False
        duration_minutes = end - start
    else:
        active = current >= start or current < end
        crosses_midnight = True
        duration_minutes = (24 * 60 - start) + end

    if not enabled:
        next_change_minutes = None
        next_change_time = None
        status = "always"
        status_label = "Always active"
        duration_minutes = 24 * 60
    elif start is None or end is None or start == end:
        next_change_minutes = None
        next_change_time = None
        status = "active"
        status_label = "Active all day"
    elif active:
        next_change_minutes = (end - current) % (24 * 60)
        next_change_time = settings.get("end")
        status = "active"
        status_label = "Active now"
    else:
        next_change_minutes = (start - current) % (24 * 60)
        next_change_time = settings.get("start")
        status = "paused"
        status_label = "Paused now"

    if next_change_minutes == 0 and next_change_time is not None:
        next_change_minutes = 24 * 60

    hours, minutes = divmod(duration_minutes, 60)
    duration_label = f"{hours}h" if minutes == 0 else f"{hours}h {minutes}m"

    return {
        "active_now": (not enabled) or active,
        "window_active_now": active,
        "current_time": now.strftime("%H:%M"),
        "status": status,
        "status_label": status_label,
        "crosses_midnight": crosses_midnight,
        "duration_minutes": duration_minutes,
        "duration_label": duration_label,
        "next_change_time": next_change_time,
        "minutes_until_next_change": next_change_minutes,
        "display": "Always active" if not enabled else f"{settings.get('start')} - {settings.get('end')} IST",
    }


def tail_file(path, limit):
    if not path.exists():
        return []

    try:
        with path.open("rb") as fh:
            fh.seek(0, os.SEEK_END)
            file_size = fh.tell()
            block_size = 8192
            blocks = []
            lines_found = 0
            position = file_size

            while position > 0 and lines_found <= limit:
                read_size = min(block_size, position)
                position -= read_size
                fh.seek(position)
                block = fh.read(read_size)
                blocks.append(block)
                lines_found += block.count(b"\n")

            data = b"".join(reversed(blocks)).decode("utf-8", "replace")
    except OSError as exc:
        return [f"[LOGS] Failed reading {path.name}: {exc}"]

    return [line for line in data.splitlines()[-limit:] if line]


def log_sort_key(entry):
    line = entry.get("line", "")
    first = line.find("][")
    second = line.find("]", first + 2)
    if first != -1 and second != -1:
        return line[first + 2:second]
    return ""


def is_conversion_log_line(line):
    return any(event in line for event in CONVERSION_LOG_EVENTS)


def get_log_snapshot(selected="all", limit=250):
    try:
        limit = max(25, min(1000, int(limit)))
    except (TypeError, ValueError):
        limit = 250

    if selected == "all":
        names = list(WATCHED_LOGS.keys())
        line_filter = None
    elif selected in LOG_SOURCE_GROUPS:
        names = list(LOG_SOURCE_GROUPS[selected])
        line_filter = is_conversion_log_line
    else:
        names = [selected]
        line_filter = None

    entries = []
    files = []

    for name in names:
        path = WATCHED_LOGS.get(name)
        if not path:
            continue

        exists = path.exists()
        size = path.stat().st_size if exists else 0
        files.append({
            "name": name,
            "file": path.name,
            "exists": exists,
            "size": size,
        })

        if selected in LOG_SOURCE_GROUPS:
            per_file_limit = min(10000, max(limit * 20, 1000))
        else:
            per_file_limit = limit
        for line in tail_file(path, per_file_limit):
            if line_filter and not line_filter(line):
                continue
            entries.append({
                "source": selected if selected in LOG_SOURCE_GROUPS else name,
                "file": path.name,
                "line": line,
            })

    if selected == "all" or selected in LOG_SOURCE_GROUPS:
        entries.sort(key=log_sort_key)
    entries = entries[-limit:]
    return {
        "selected": selected,
        "limit": limit,
        "files": files,
        "entries": entries,
        "updated_at": int(time.time()),
    }


def get_compose_base_command():
    candidates = [
        ["docker", "compose"],
        ["docker-compose"],
    ]
    for candidate in candidates:
        probe = run_cmd(candidate + ["version"])
        if probe.returncode == 0:
            return candidate
    return None


def run_compose(args):
    if not COMPOSE_FILE.exists():
        raise FileNotFoundError(f"Compose file not found at {COMPOSE_FILE}")

    compose_base = get_compose_base_command()
    if not compose_base:
        raise RuntimeError("Docker Compose is not available in this container")

    cmd = compose_base + ["-f", str(COMPOSE_FILE)] + args
    return run_cmd(cmd, cwd=str(CONTROL_ROOT))


def get_published_port(container_name, container_port):
    result = run_cmd(["docker", "port", container_name, f"{container_port}/tcp"])
    if result.returncode != 0:
        return None

    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        return None

    return lines[0]


def process_alive(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False

    stat_path = Path(f"/proc/{pid}/stat")
    try:
        stat = stat_path.read_text()
        fields = stat.split()
        if len(fields) > 2 and fields[2] == "Z":
            return False
    except OSError:
        pass

    return True


def job_running():
    if not os.path.exists(PID_FILE):
        log.info("No PID file found -> job not running")
        return False

    try:
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
    except Exception:
        try:
            os.remove(PID_FILE)
        except FileNotFoundError:
            pass
        return False

    alive = process_alive(pid)
    log.info(f"PID {pid} alive: {alive}")
    if not alive:
        try:
            os.remove(PID_FILE)
        except FileNotFoundError:
            pass
    return alive


def load_progress_jobs():
    jobs = []

    for file in sorted(PROGRESS_DIR.glob("*.json")):
        try:
            with file.open() as f:
                payload = json.load(f)
        except Exception as exc:
            log.warning(f"Failed reading progress file {file}: {exc}")
            continue

        payload["progress_file"] = file.name
        jobs.append(payload)

    jobs.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
    return jobs


def delete_terminal_progress_files():
    terminal_states = {"complete", "completed", "failed", "blocked", "stopped"}
    deleted = 0

    for file in PROGRESS_DIR.glob("*.json"):
        try:
            with file.open() as fh:
                payload = json.load(fh)
        except Exception:
            continue

        if str(payload.get("state", "")).lower() not in terminal_states:
            continue

        try:
            file.unlink()
            deleted += 1
        except FileNotFoundError:
            continue
        except OSError as exc:
            log.warning(f"Failed deleting terminal progress file {file}: {exc}")

    return deleted


def build_master_fallback_job():
    pid = None
    try:
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
    except Exception:
        pass

    updated_at = int(time.time())
    return {
        "job_type": "master",
        "state": "running",
        "title": "Jellyfin optimizer pipeline",
        "movie": "Optimizer pipeline",
        "file": "Scheduler is running but no worker progress has been published yet.",
        "percent": 0.0,
        "eta_seconds": None,
        "eta_display": "--:--",
        "elapsed_seconds": 0,
        "processed_seconds": 0,
        "processed_display": "00:00",
        "duration_display": "--:--",
        "speed": "--",
        "fps": 0.0,
        "phase": "starting",
        "pid": pid,
        "updated_at": updated_at,
        "progress_file": MASTER_PROGRESS_FILE.name,
    }


def progress_recent(job, max_age_seconds=180):
    updated_at = job.get("updated_at")
    if not updated_at:
        return False

    try:
        if isinstance(updated_at, (int, float)):
            updated_ts = float(updated_at)
        else:
            parsed = datetime.fromisoformat(str(updated_at))
            # Older worker progress files used local IST timestamps without an
            # explicit UTC offset.  The control container itself runs in UTC,
            # so interpreting those values as container-local time can make a
            # dead job appear to be several hours in the future.
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=SCHEDULE_TZ)
            updated_ts = parsed.timestamp()
    except Exception:
        return False

    age_seconds = time.time() - updated_ts
    return 0 <= age_seconds <= max_age_seconds


def get_dashboard_state():
    jobs = load_progress_jobs()
    pid_running = job_running()
    if pid_running and not jobs:
        jobs = [build_master_fallback_job()]
    active_states = {"running", "starting", "finalizing"}
    active_jobs = [
        job
        for job in jobs
        if str(job.get("state", "")).lower() in active_states and progress_recent(job)
    ]
    running = pid_running or bool(active_jobs)
    if not running:
        delete_terminal_progress_files()

    schedule = load_schedule()
    return {
        "status": "RUNNING" if running else "IDLE",
        "job_running": running,
        "active_jobs": active_jobs,
        "schedule": schedule,
        "updated_at": int(time.time()),
    }


def media_job_active():
    return get_dashboard_state().get("job_running", False)


def kill_job():
    if not os.path.exists(PID_FILE):
        log.info("No PID file to kill")
        return False

    with open(PID_FILE) as f:
        pid = int(f.read().strip())

    if not process_alive(pid):
        log.info("PID not alive anymore")
        try:
            os.remove(PID_FILE)
        except FileNotFoundError:
            pass
        return False

    terminate_job_process_group(pid, reason="manual stop")

    try:
        os.remove(PID_FILE)
    except FileNotFoundError:
        pass
    return True


def terminate_job_process_group(pid, reason="scheduled window ended"):
    """Stop only the optimizer process group, including its own FFmpeg child."""
    if not process_alive(pid):
        return False

    try:
        pgid = os.getpgid(pid)
    except OSError:
        return False

    use_group = pgid == pid
    target = -pgid if use_group else pid
    label = f"process group {pgid}" if use_group else f"PID {pid}"
    log.info(f"Sending SIGTERM to optimizer {label}: {reason}")
    try:
        os.kill(target, signal.SIGTERM)
    except ProcessLookupError:
        return False

    deadline = time.time() + 5
    while process_alive(pid) and time.time() < deadline:
        time.sleep(0.2)
    if process_alive(pid):
        log.warning(f"Optimizer {label} still alive -> sending SIGKILL")
        try:
            os.kill(target, signal.SIGKILL)
        except ProcessLookupError:
            pass
    return True


def enforce_scheduled_window(pid):
    """Keep a scheduled optimizer run strictly inside its saved active interval."""
    while process_alive(pid):
        time.sleep(5)
        if not load_schedule().get("active_now", True):
            terminate_job_process_group(pid)
            log.info(f"Scheduled optimizer PID {pid} stopped at end of active interval")
            return


def kill_pid(pid, label="process", sigterm_wait=3):
    if not pid:
        return False

    try:
        pid = int(pid)
    except (TypeError, ValueError):
        log.warning(f"Invalid PID for {label}: {pid}")
        return False

    if not process_alive(pid):
        log.info(f"{label} PID {pid} not alive")
        return False

    log.info(f"Sending SIGTERM to {label} PID {pid}")
    os.kill(pid, signal.SIGTERM)
    time.sleep(sigterm_wait)

    if process_alive(pid):
        log.warning(f"{label} PID {pid} still alive -> sending SIGKILL")
        os.kill(pid, signal.SIGKILL)

    return True


def get_partial_output_path(path_value):
    if not path_value:
        return None

    path = Path(path_value)
    if path.name.endswith(".jellyfin-control-part"):
        return path
    if ".converting." in path.name:
        return path
    return path.with_name(path.name + ".jellyfin-control-part")


def delete_path_if_exists(path):
    if not path:
        return False

    try:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
        log.info(f"Deleted path during skip cleanup: {path}")
        return True
    except FileNotFoundError:
        return False
    except OSError as exc:
        log.error(f"Failed deleting path {path}: {exc}")
        return False


def get_current_worker_job():
    jobs = load_progress_jobs()
    worker_jobs = [job for job in jobs if job.get("job_type") != "master"]
    return worker_jobs[0] if worker_jobs else None


def cleanup_skipped_job(job):
    deleted_partial = False
    deleted_lock = False

    output_path = job.get("output_path")
    source_path = job.get("source_path")
    progress_file = job.get("progress_file")

    partial_output = get_partial_output_path(output_path)
    if partial_output is not None:
        deleted_partial = delete_path_if_exists(partial_output)

    if source_path:
        source = Path(source_path)
        lock_path = source.with_suffix(source.suffix + ".lock")
        deleted_lock = delete_path_if_exists(lock_path)

    if progress_file:
        deleted_path = delete_path_if_exists(PROGRESS_DIR / progress_file)
        deleted_partial = deleted_partial or deleted_path

    return deleted_partial, deleted_lock


def kill_leftovers():
    log.info("Killing leftover optimizer scripts")
    run("pkill -f jellyfin-optimize-movies.py")
    run("pkill -f jellyfin-optimize-uhdmovies.py")
    run("pkill -f jellyfin-optimize-shows.py")
    run("pkill -f jellyfin-generate-subtitles.py")


def delete_partial_files():
    deleted = 0
    log.info("Searching for Jellyfin Control partial files and directories")

    for root in MEDIA_ROOTS:
        candidates = []
        for path in root.rglob("*"):
            if ".converting." not in path.name and not path.name.endswith(".jellyfin-control-part"):
                continue
            candidates.append(path)

        # Delete deepest paths first so nested trickplay assets do not block directory removal.
        for path in sorted(candidates, key=lambda item: len(item.parts), reverse=True):
            try:
                if path.is_dir():
                    log.info(f"Deleting partial directory: {path}")
                    shutil.rmtree(path)
                else:
                    log.info(f"Deleting partial file: {path}")
                    path.unlink()
                deleted += 1
            except FileNotFoundError:
                continue
            except OSError as exc:
                log.error(f"Failed deleting partial path {path}: {exc}")

    log.info(f"Total partial paths deleted: {deleted}")
    return deleted


def delete_stale_locks():
    deleted = 0
    log.info("Searching for stale media lock files")

    for root in MEDIA_ROOTS:
        for file in root.rglob("*.lock"):
            try:
                log.info(f"Deleting stale lock file: {file}")
                file.unlink()
                deleted += 1
            except Exception as exc:
                log.error(f"Failed deleting {file}: {exc}")

    log.info(f"Total stale lock files deleted: {deleted}")
    return deleted


def delete_progress_files():
    deleted = 0
    log.info("Searching for stale progress files")

    for file in PROGRESS_DIR.glob("*.json"):
        try:
            log.info(f"Deleting progress file: {file}")
            file.unlink()
            deleted += 1
        except Exception as exc:
            log.error(f"Failed deleting progress file {file}: {exc}")

    log.info(f"Total progress files deleted: {deleted}")
    return deleted


def remove_lock():
    if os.path.exists(LOCK_FILE):
        os.remove(LOCK_FILE)
        log.info("Removed global lock file")
        return True

    log.info("No lock file found")
    return False


def fix_subtitles():
    renamed = 0
    log.info("Starting subtitle rename job")

    for root in MEDIA_ROOTS:
        for video in root.rglob("*.mp4"):
            base = video.stem
            folder = video.parent

            for sub in folder.iterdir():
                if sub.suffix.lower() not in SUB_EXTS:
                    continue

                parts = sub.stem.split(".")
                lang = ""
                if len(parts) > 1:
                    possible_lang = parts[-1]
                    if len(possible_lang) <= 4:
                        lang = possible_lang

                new_name = f"{base}.{lang}{sub.suffix}" if lang else f"{base}{sub.suffix}"
                new_path = folder / new_name

                if sub == new_path:
                    continue

                try:
                    log.info(f"Renaming: {sub} -> {new_path}")
                    sub.rename(new_path)
                    renamed += 1
                except Exception as exc:
                    log.error(f"Failed renaming {sub}: {exc}")

    log.info(f"Total subtitles renamed: {renamed}")
    return renamed


@app.route("/")
def home():
    return render_template_string(PAGE)


@app.route("/favicon.ico")
def favicon():
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#07111f"/><path d="M15 44V20l18 12-18 12Z" fill="#40d39c"/><path d="M34 18h8a9 9 0 0 1 0 18h-8V18Zm0 28h14" fill="none" stroke="#78e2ff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>"""
    return Response(svg, mimetype="image/svg+xml")


@app.route("/api/status")
def api_status():
    return jsonify(get_dashboard_state())


@app.route("/api/schedule", methods=["GET", "POST"])
def api_schedule():
    if request.method == "GET":
        return jsonify(load_schedule())

    try:
        settings = save_schedule(request.get_json(silent=True) or {})
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400
    return jsonify({"message": "Active interval saved", "schedule": settings})


@app.route("/api/logs")
def api_logs():
    selected = request.args.get("source", "all")
    if selected != "all" and selected not in WATCHED_LOGS and selected not in LOG_SOURCE_GROUPS:
        selected = "all"

    return jsonify(get_log_snapshot(
        selected=selected,
        limit=request.args.get("limit", 300),
    ))


@app.route("/start", methods=["POST"])
def start_job():
    scheduled = request.args.get("scheduled") == "1"
    log.info("START button clicked" if not scheduled else "Scheduled start requested")

    if scheduled and not load_schedule().get("active_now", True):
        response = get_dashboard_state()
        response["message"] = "Outside active interval; scheduled run not started"
        log.info(response["message"])
        return jsonify(response)

    if media_job_active():
        log.warning("Start requested but job already running")
        response = get_dashboard_state()
        response["message"] = "Job already running"
        return jsonify(response)

    delete_progress_files()
    env = os.environ.copy()
    if scheduled:
        env.pop("JELLYFIN_FORCE_RUN", None)
    else:
        env["JELLYFIN_FORCE_RUN"] = "1"
    proc = subprocess.Popen(
        ["bash", MASTER_SCRIPT],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

    with open(PID_FILE, "w") as f:
        f.write(str(proc.pid))

    if scheduled:
        threading.Thread(
            target=enforce_scheduled_window,
            args=(proc.pid,),
            daemon=True,
        ).start()

    log.info(f"Master script started with PID {proc.pid}")
    response = get_dashboard_state()
    response["message"] = "Scheduled job started" if scheduled else "Job started"
    return jsonify(response)


@app.route("/stop", methods=["POST"])
def stop_job():
    log.info("STOP button clicked")

    killed = kill_job()
    kill_leftovers()
    deleted = delete_partial_files()
    deleted_locks = delete_stale_locks()
    deleted_progress = delete_progress_files()
    lock_removed = remove_lock()

    log.info("Stop procedure completed")

    response = get_dashboard_state()
    response.update({
        "message": "Job stopped",
        "pid_killed": killed,
        "partial_deleted": deleted,
        "stale_locks_deleted": deleted_locks,
        "progress_deleted": deleted_progress,
        "lock_removed": lock_removed,
    })
    return jsonify(response)


@app.route("/skip", methods=["POST"])
def skip_job():
    log.info("SKIP button clicked")

    job = get_current_worker_job()
    if not job:
        response = get_dashboard_state()
        response["message"] = "No active worker job to skip"
        return jsonify(response)

    ffmpeg_pid = job.get("ffmpeg_pid")
    if not ffmpeg_pid:
        response = get_dashboard_state()
        response["message"] = "Current job has no active ffmpeg process to skip"
        return jsonify(response)

    killed = kill_pid(ffmpeg_pid, label="ffmpeg", sigterm_wait=2)
    deleted_partial, deleted_lock = cleanup_skipped_job(job)

    movie = job.get("movie") or job.get("title") or "Current job"
    file_name = job.get("file") or ""
    log.info(f"Skip procedure completed for {movie} / {file_name}")

    response = get_dashboard_state()
    response.update({
        "message": f"Skipped {movie} / {file_name}".strip(" /"),
        "ffmpeg_killed": killed,
        "partial_deleted": deleted_partial,
        "lock_deleted": deleted_lock,
    })
    return jsonify(response)


@app.route("/fix-subs", methods=["POST"])
def fix_subs():
    log.info("FIX SUBTITLES button clicked")
    renamed = fix_subtitles()
    response = get_dashboard_state()
    response["message"] = f"Renamed {renamed} subtitle files"
    return jsonify(response)


@app.route("/generate-subs", methods=["POST"])
def generate_subs():
    log.info("GENERATE SUBTITLES button clicked")

    if media_job_active():
        log.warning("Generate subtitles requested but another job is already running")
        response = get_dashboard_state()
        response["message"] = "Another media job is already running"
        return jsonify(response)

    delete_progress_files()
    env = os.environ.copy()
    proc = subprocess.Popen(
        ["python3", SUBTITLE_SCRIPT],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    with open(PID_FILE, "w") as f:
        f.write(str(proc.pid))

    log.info(f"Subtitle generator started with PID {proc.pid}")
    response = get_dashboard_state()
    response["message"] = "Subtitle generation started"
    return jsonify(response)


@app.route("/docker/pull", methods=["POST"])
def docker_pull():
    log.info("DOCKER PULL button clicked")
    before_binding = get_published_port(COMPOSE_SERVICE, CONTROL_PORT)

    try:
        result = run_compose(["pull"])
    except Exception as exc:
        response = get_dashboard_state()
        response["message"] = f"Docker pull failed: {exc}"
        return jsonify(response), 500

    after_binding = get_published_port(COMPOSE_SERVICE, CONTROL_PORT)
    if result.returncode != 0:
        response = get_dashboard_state()
        response["message"] = "Docker pull failed. Check server logs for details."
        response["docker_stdout"] = (result.stdout or "").strip()
        response["docker_stderr"] = (result.stderr or "").strip()
        response["port_binding_before"] = before_binding
        response["port_binding_after"] = after_binding
        return jsonify(response), 500

    response = get_dashboard_state()
    response["message"] = "Pulled latest Docker images successfully."
    response["port_binding_before"] = before_binding
    response["port_binding_after"] = after_binding
    return jsonify(response)


@app.route("/docker/rebuild-restart", methods=["POST"])
def docker_rebuild_restart():
    log.info("DOCKER REBUILD + RESTART button clicked")
    before_binding = get_published_port(COMPOSE_SERVICE, CONTROL_PORT)

    try:
        pull_result = run_compose(["pull"])
        if pull_result.returncode != 0:
            response = get_dashboard_state()
            response["message"] = "Docker pull failed before rebuild/restart. Check server logs for details."
            response["docker_stdout"] = (pull_result.stdout or "").strip()
            response["docker_stderr"] = (pull_result.stderr or "").strip()
            response["port_binding_before"] = before_binding
            response["port_binding_after"] = get_published_port(COMPOSE_SERVICE, CONTROL_PORT)
            return jsonify(response), 500

        result = run_compose(["up", "-d", "--build", "--force-recreate"])
    except Exception as exc:
        response = get_dashboard_state()
        response["message"] = f"Docker rebuild/restart failed: {exc}"
        return jsonify(response), 500

    time.sleep(2)
    after_binding = get_published_port(COMPOSE_SERVICE, CONTROL_PORT)
    if result.returncode != 0:
        response = get_dashboard_state()
        response["message"] = "Docker rebuild/restart failed. Check server logs for details."
        response["docker_stdout"] = (result.stdout or "").strip()
        response["docker_stderr"] = (result.stderr or "").strip()
        response["port_binding_before"] = before_binding
        response["port_binding_after"] = after_binding
        return jsonify(response), 500

    response = get_dashboard_state()
    response["message"] = "Container rebuilt and restarted on existing compose port mapping."
    response["port_binding_before"] = before_binding
    response["port_binding_after"] = after_binding
    return jsonify(response)


PAGE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Jellyfin Optimizer Control</title>
    <link rel="icon" href="/favicon.ico">
    <style>
        :root {
            --bg: #080d16;
            --bg-alt: #111827;
            --panel: rgba(12, 18, 29, 0.82);
            --panel-strong: rgba(16, 24, 38, 0.94);
            --panel-soft: rgba(24, 34, 50, 0.92);
            --border: rgba(154, 180, 213, 0.16);
            --text: #f5f7fb;
            --muted: #a7b3c5;
            --accent: #6ee7b7;
            --accent-strong: #38bdf8;
            --hot: #f97316;
            --good: #40d39c;
            --warn: #ffbb55;
            --bad: #ff6a6f;
            --track: rgba(112, 145, 191, 0.18);
            --shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
            --radius-xl: 28px;
            --radius-lg: 22px;
            --radius-md: 16px;
            --radius-sm: 12px;
        }
        * {
            box-sizing: border-box;
        }
        html, body {
            margin: 0;
            min-height: 100%;
            font-family: "Trebuchet MS", "Segoe UI Variable", "Segoe UI", sans-serif;
            color: var(--text);
            background:
                linear-gradient(135deg, rgba(56, 189, 248, 0.18), transparent 26%),
                linear-gradient(225deg, rgba(249, 115, 22, 0.13), transparent 30%),
                linear-gradient(180deg, #080d16 0%, #101726 44%, #090d14 100%);
        }
        body::before {
            content: "";
            position: fixed;
            inset: 0;
            background-image:
                linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
            background-size: 26px 26px;
            mask-image: radial-gradient(circle at center, black 45%, transparent 100%);
            pointer-events: none;
        }
        .shell {
            position: relative;
            max-width: 1280px;
            margin: 0 auto;
            padding: 28px 18px 40px;
        }
        .hero {
            display: grid;
            grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr);
            gap: 18px;
            margin-bottom: 18px;
        }
        .card {
            position: relative;
            overflow: hidden;
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow);
            backdrop-filter: blur(18px);
        }
        .hero-main {
            padding: 28px;
            min-height: 280px;
        }
        .hero-main::after {
            content: "";
            position: absolute;
            inset: auto -60px -90px auto;
            width: 240px;
            height: 240px;
            border-radius: 999px;
            background: radial-gradient(circle, rgba(249, 115, 22, 0.18), transparent 68%);
        }
        .eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 7px 12px;
            border-radius: 999px;
            background: rgba(120, 226, 255, 0.08);
            border: 1px solid rgba(120, 226, 255, 0.16);
            color: var(--accent);
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.12em;
            text-transform: uppercase;
        }
        .eyebrow-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: currentColor;
            box-shadow: 0 0 18px currentColor;
        }
        h1 {
            margin: 18px 0 10px;
            max-width: 12ch;
            font-size: clamp(2.4rem, 4vw, 4.5rem);
            line-height: 0.94;
            letter-spacing: 0;
        }
        .hero-copy {
            max-width: 60ch;
            color: var(--muted);
            font-size: 1rem;
            line-height: 1.6;
            margin-bottom: 22px;
        }
        .toolbar {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
        }
        button {
            appearance: none;
            border: 0;
            border-radius: 999px;
            padding: 13px 18px;
            font: inherit;
            font-weight: 800;
            letter-spacing: 0.01em;
            cursor: pointer;
            transition: transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
        }
        button:hover:not(:disabled) {
            transform: translateY(-1px);
        }
        button:disabled {
            cursor: wait;
            opacity: 0.72;
        }
        .btn-primary {
            background: linear-gradient(135deg, #6ee7b7, #38bdf8);
            color: #061017;
            box-shadow: 0 16px 32px rgba(34, 145, 106, 0.28);
        }
        .btn-danger {
            background: linear-gradient(135deg, #ff797d, #d53f54);
            color: white;
            box-shadow: 0 16px 32px rgba(213, 63, 84, 0.26);
        }
        .btn-secondary {
            background: rgba(255, 255, 255, 0.08);
            color: var(--text);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .btn-compact {
            padding: 10px 14px;
            font-size: 0.9rem;
        }
        .hero-side {
            display: grid;
            gap: 14px;
            padding: 18px;
        }
        .spotlight {
            background: var(--panel-strong);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            padding: 18px;
        }
        .spotlight-label {
            color: var(--muted);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            margin-bottom: 10px;
        }
        .spotlight-value {
            font-size: 1.9rem;
            font-weight: 900;
            letter-spacing: 0;
        }
        .spotlight-subtext {
            margin-top: 8px;
            color: var(--muted);
            line-height: 1.5;
        }
        .message {
            min-height: 56px;
            padding: 16px 18px;
            border-radius: var(--radius-lg);
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.06);
            color: var(--muted);
            line-height: 1.5;
        }
        .message.has-value {
            color: var(--text);
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 14px;
            margin-bottom: 18px;
        }
        .stat {
            padding: 18px;
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            backdrop-filter: blur(18px);
        }
        .stat-label {
            color: var(--muted);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            margin-bottom: 10px;
        }
        .stat-value {
            font-size: clamp(1.6rem, 2vw, 2.4rem);
            font-weight: 900;
            letter-spacing: 0;
        }
        .layout {
            display: grid;
            grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
            gap: 18px;
        }
        .section {
            padding: 20px;
        }
        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 18px;
        }
        .section-title {
            font-size: 1.2rem;
            font-weight: 900;
            letter-spacing: 0;
        }
        .section-meta {
            color: var(--muted);
            font-size: 0.94rem;
        }
        .jobs {
            display: grid;
            gap: 14px;
        }
        .job {
            padding: 18px;
            background: linear-gradient(180deg, rgba(16, 30, 51, 0.92), rgba(10, 20, 35, 0.92));
            border: 1px solid rgba(153, 184, 224, 0.12);
            border-radius: var(--radius-lg);
        }
        .job-head {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: flex-start;
            margin-bottom: 14px;
        }
        .job-title {
            font-size: 1.15rem;
            font-weight: 900;
            margin-bottom: 6px;
        }
        .job-subtitle {
            color: var(--muted);
            word-break: break-word;
            line-height: 1.45;
        }
        .pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 88px;
            padding: 8px 12px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            border: 1px solid transparent;
        }
        .pill.running {
            color: #9cf3d0;
            background: rgba(64, 211, 156, 0.12);
            border-color: rgba(64, 211, 156, 0.18);
        }
        .pill.idle {
            color: #b4c8e6;
            background: rgba(255, 255, 255, 0.06);
            border-color: rgba(255, 255, 255, 0.08);
        }
        .pill.alert {
            color: #ffd39f;
            background: rgba(255, 187, 85, 0.12);
            border-color: rgba(255, 187, 85, 0.18);
        }
        .progress-shell {
            margin-bottom: 14px;
        }
        .progress-top {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 8px;
            font-size: 0.95rem;
        }
        .progress-label {
            color: var(--muted);
        }
        .progress-value {
            font-weight: 800;
        }
        .progress {
            position: relative;
            height: 14px;
            border-radius: 999px;
            overflow: hidden;
            background: var(--track);
        }
        .progress-bar {
            height: 100%;
            border-radius: inherit;
            background: linear-gradient(90deg, #78e2ff 0%, #4db6ff 42%, #40d39c 100%);
            box-shadow: 0 0 24px rgba(77, 182, 255, 0.35);
        }
        .metrics {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
        }
        .metric {
            padding: 12px;
            border-radius: var(--radius-sm);
            background: var(--panel-soft);
            border: 1px solid rgba(154, 180, 213, 0.08);
        }
        .metric-name {
            color: var(--muted);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            margin-bottom: 8px;
        }
        .metric-value {
            font-size: 1.05rem;
            font-weight: 900;
            letter-spacing: 0;
        }
        .schedule-panel {
            display: grid;
            gap: 12px;
        }
        .switch-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }
        .switch {
            position: relative;
            width: 54px;
            height: 30px;
            flex: 0 0 auto;
        }
        .switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .slider {
            position: absolute;
            cursor: pointer;
            inset: 0;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.13);
            border: 1px solid rgba(255, 255, 255, 0.12);
            transition: 160ms ease;
        }
        .slider::before {
            content: "";
            position: absolute;
            width: 22px;
            height: 22px;
            left: 3px;
            top: 3px;
            border-radius: 50%;
            background: #ffffff;
            transition: 160ms ease;
        }
        .switch input:checked + .slider {
            background: linear-gradient(135deg, #6ee7b7, #38bdf8);
        }
        .switch input:checked + .slider::before {
            transform: translateX(24px);
        }
        .time-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        .preset-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
        }
        .preset-btn {
            min-height: 38px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: var(--radius-sm);
            background: rgba(255, 255, 255, 0.06);
            color: var(--text);
            font: inherit;
            font-size: 0.82rem;
            font-weight: 900;
            cursor: pointer;
            transition: 160ms ease;
        }
        .preset-btn:hover {
            transform: translateY(-1px);
            border-color: rgba(56, 189, 248, 0.35);
            background: rgba(56, 189, 248, 0.13);
        }
        .schedule-facts {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
        }
        .schedule-fact {
            padding: 10px;
            border-radius: var(--radius-sm);
            background: rgba(255, 255, 255, 0.055);
            border: 1px solid rgba(255, 255, 255, 0.07);
        }
        .schedule-fact span {
            display: block;
            color: var(--muted);
            font-size: 10px;
            font-weight: 900;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        .schedule-fact strong {
            display: block;
            font-size: 0.9rem;
            letter-spacing: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .field {
            display: grid;
            gap: 7px;
        }
        .field label {
            color: var(--muted);
            font-size: 12px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.1em;
        }
        .field input {
            width: 100%;
            border: 1px solid rgba(255, 255, 255, 0.11);
            border-radius: var(--radius-sm);
            background: rgba(255, 255, 255, 0.08);
            color: var(--text);
            padding: 11px 12px;
            font: inherit;
            font-weight: 800;
        }
        .schedule-status {
            padding: 12px;
            border-radius: var(--radius-sm);
            background: rgba(110, 231, 183, 0.08);
            border: 1px solid rgba(110, 231, 183, 0.13);
            color: #c8ffe9;
            line-height: 1.45;
        }
        .stack {
            display: grid;
            gap: 14px;
        }
        .mini-list {
            display: grid;
            gap: 10px;
        }
        .mini-item {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: center;
            padding: 14px 16px;
            border-radius: var(--radius-md);
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .mini-label {
            color: var(--muted);
            font-size: 0.94rem;
        }
        .mini-value {
            font-weight: 900;
            text-align: right;
        }
        .empty {
            display: grid;
            place-items: center;
            min-height: 260px;
            text-align: center;
            border-radius: var(--radius-lg);
            border: 1px dashed rgba(157, 178, 207, 0.22);
            background: rgba(255, 255, 255, 0.02);
            color: var(--muted);
            padding: 24px;
        }
        .muted {
            color: var(--muted);
        }
        .logs-section {
            margin-top: 18px;
        }
        .log-toolbar {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        .log-select {
            min-width: 150px;
            border-radius: 999px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.08);
            color: var(--text);
            padding: 11px 14px;
            font: inherit;
            font-weight: 800;
        }
        .log-select option {
            background: #0c1b2f;
            color: var(--text);
        }
        .log-viewer {
            height: 420px;
            overflow: auto;
            padding: 14px;
            border-radius: var(--radius-lg);
            background: rgba(0, 0, 0, 0.26);
            border: 1px solid rgba(154, 180, 213, 0.12);
            font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
            font-size: 12px;
            line-height: 1.55;
        }
        .log-row {
            display: grid;
            grid-template-columns: 92px minmax(0, 1fr);
            gap: 10px;
            padding: 3px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        }
        .log-source {
            color: var(--accent);
            font-weight: 900;
            text-transform: uppercase;
        }
        .log-line {
            color: #d8e6f8;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .spin {
            display: inline-block;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        @media (max-width: 1080px) {
            .hero,
            .layout {
                grid-template-columns: 1fr;
            }
            .stats {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }
        @media (max-width: 700px) {
            .shell {
                padding-inline: 14px;
            }
            .hero-main,
            .hero-side,
            .section,
            .stat {
                padding: 16px;
            }
            .stats,
            .metrics,
            .log-row {
                grid-template-columns: 1fr;
            }
            .job-head,
            .section-header,
            .progress-top,
            .mini-item {
                flex-direction: column;
                align-items: flex-start;
            }
            h1 {
                max-width: none;
            }
        }
        html, body {
            height: 100%;
            overflow: hidden;
        }
        body {
            background:
                linear-gradient(135deg, rgba(64, 211, 156, 0.14), transparent 28%),
                linear-gradient(225deg, rgba(56, 189, 248, 0.12), transparent 30%),
                linear-gradient(180deg, #080d16 0%, #0d1420 100%);
        }
        .shell {
            width: 100%;
            max-width: none;
            height: 100vh;
            margin: 0;
            padding: 0;
            display: grid;
            grid-template-columns: 286px minmax(0, 1fr);
            overflow: hidden;
        }
        .sidebar {
            position: relative;
            z-index: 1;
            display: grid;
            grid-template-rows: auto auto auto minmax(0, 1fr) auto;
            gap: 14px;
            min-height: 0;
            padding: 18px;
            background: rgba(7, 13, 23, 0.92);
            border-right: 1px solid var(--border);
            box-shadow: 18px 0 60px rgba(0, 0, 0, 0.24);
            overflow: hidden;
        }
        .brand {
            display: grid;
            gap: 6px;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .brand-title {
            font-size: 1.15rem;
            font-weight: 900;
            letter-spacing: 0;
        }
        .brand-subtitle {
            color: var(--muted);
            font-size: 0.84rem;
        }
        .nav-list {
            display: grid;
            gap: 8px;
        }
        .nav-link {
            display: flex;
            align-items: center;
            gap: 10px;
            min-height: 42px;
            padding: 10px 12px;
            border-radius: var(--radius-sm);
            color: var(--text);
            text-decoration: none;
            font-weight: 900;
            background: rgba(255, 255, 255, 0.045);
            border: 1px solid rgba(255, 255, 255, 0.06);
        }
        .nav-link span {
            width: 9px;
            height: 9px;
            border-radius: 999px;
            background: var(--accent);
            box-shadow: 0 0 14px rgba(110, 231, 183, 0.5);
        }
        .sidebar-actions {
            display: grid;
            gap: 9px;
        }
        .sidebar-actions .toolbar {
            display: grid;
            gap: 9px;
        }
        .sidebar-actions button,
        .schedule-panel button {
            width: 100%;
        }
        .sidebar-scroll {
            min-height: 0;
            overflow: auto;
            padding-right: 2px;
        }
        .content {
            min-width: 0;
            height: 100vh;
            padding: 16px;
            display: grid;
            grid-template-rows: auto auto minmax(0, 1fr);
            gap: 14px;
            overflow: hidden;
        }
        .hero {
            display: block;
            margin: 0;
        }
        .hero-main {
            min-height: 0;
            padding: 16px 18px;
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 16px;
            align-items: center;
        }
        .hero-main::after {
            display: none;
        }
        h1 {
            max-width: none;
            margin: 6px 0 6px;
            font-size: 1.7rem;
            line-height: 1.1;
        }
        .hero-copy {
            max-width: none;
            margin: 0;
            font-size: 0.92rem;
            line-height: 1.35;
        }
        .hero-status {
            min-width: 220px;
            padding: 12px 14px;
            border-radius: var(--radius-md);
            background: rgba(255, 255, 255, 0.055);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .hero-status .spotlight-value {
            font-size: 1.35rem;
        }
        .stats {
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 10px;
            margin: 0;
        }
        .stat {
            padding: 12px 14px;
            border-radius: var(--radius-md);
        }
        .stat-label {
            margin-bottom: 6px;
            font-size: 10px;
        }
        .stat-value {
            font-size: 1.35rem;
        }
        .workspace {
            min-height: 0;
            display: grid;
            grid-template-columns: minmax(430px, 1.05fr) minmax(360px, 0.95fr);
            grid-template-rows: minmax(0, 0.95fr) minmax(0, 1.05fr);
            gap: 14px;
            grid-template-areas:
                "queue summary"
                "queue logs";
        }
        .queue-panel {
            grid-area: queue;
        }
        .summary-panel {
            grid-area: summary;
        }
        .logs-section {
            grid-area: logs;
            margin-top: 0;
        }
        .section {
            min-height: 0;
            padding: 16px;
            display: flex;
            flex-direction: column;
        }
        .section-header {
            flex: 0 0 auto;
            margin-bottom: 12px;
        }
        .section-meta {
            font-size: 0.82rem;
        }
        .jobs {
            min-height: 0;
            overflow: auto;
        }
        .job {
            padding: 14px;
            border-radius: var(--radius-md);
        }
        .metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }
        .metric {
            padding: 10px;
        }
        .metric-name {
            margin-bottom: 5px;
            font-size: 10px;
        }
        .empty {
            min-height: 100%;
        }
        .stack {
            min-height: 0;
            overflow: auto;
        }
        .mini-list {
            gap: 8px;
        }
        .mini-item {
            padding: 10px 12px;
            border-radius: var(--radius-sm);
        }
        .message {
            min-height: 44px;
            max-height: 96px;
            overflow: auto;
            padding: 12px;
            border-radius: var(--radius-md);
            font-size: 0.9rem;
        }
        .spotlight {
            padding: 14px;
            border-radius: var(--radius-md);
        }
        .spotlight-label {
            margin-bottom: 6px;
            font-size: 10px;
        }
        .spotlight-subtext {
            margin-top: 5px;
            font-size: 0.86rem;
            line-height: 1.35;
        }
        .schedule-panel {
            gap: 10px;
        }
        .schedule-facts {
            grid-template-columns: 1fr;
        }
        .log-toolbar {
            flex-wrap: nowrap;
        }
        .log-select {
            min-width: 136px;
            padding: 9px 12px;
        }
        .log-viewer {
            flex: 1 1 auto;
            min-height: 0;
            height: auto;
            border-radius: var(--radius-md);
        }
        @media (max-width: 1180px) {
            .shell {
                grid-template-columns: 260px minmax(0, 1fr);
            }
            .workspace {
                grid-template-columns: minmax(0, 1fr);
                grid-template-rows: minmax(0, 1fr) auto minmax(220px, 0.8fr);
                grid-template-areas:
                    "queue"
                    "summary"
                    "logs";
            }
            .summary-panel {
                max-height: 210px;
            }
        }
        @media (max-width: 820px) {
            html, body {
                overflow: auto;
            }
            .shell {
                height: auto;
                min-height: 100vh;
                grid-template-columns: 1fr;
                overflow: visible;
            }
            .sidebar,
            .content {
                height: auto;
                overflow: visible;
            }
            .sidebar {
                grid-template-rows: none;
            }
            .content {
                grid-template-rows: none;
            }
            .hero-main,
            .workspace,
            .stats {
                grid-template-columns: 1fr;
            }
            .workspace {
                grid-template-areas: none;
                grid-template-rows: none;
            }
            .queue-panel,
            .summary-panel,
            .logs-section {
                grid-area: auto;
            }
            .log-viewer {
                height: 320px;
            }
        }

        /* ToolHub embedded layout */
        :root {
            --bg: #060910;
            --bg-alt: #0a0f19;
            --panel: #0b111c;
            --panel-strong: #0e1522;
            --panel-soft: #111a2a;
            --border: rgba(148, 163, 184, 0.14);
            --text: #f8fafc;
            --muted: #8390a5;
            --accent: #8b7cff;
            --accent-strong: #6d5dfc;
            --hot: #f59e0b;
            --good: #44d19d;
            --warn: #f4bc5e;
            --bad: #fb7185;
            --track: #182235;
            --shadow: 0 18px 40px rgba(0, 0, 0, 0.2);
            --radius-xl: 14px;
            --radius-lg: 12px;
            --radius-md: 10px;
            --radius-sm: 8px;
        }
        html,
        body {
            height: 100%;
            overflow: hidden;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: var(--bg);
        }
        body {
            color: var(--text);
            background:
                radial-gradient(700px 320px at 12% -10%, rgba(109, 93, 252, 0.12), transparent 55%),
                linear-gradient(180deg, #070b13 0%, #060910 100%);
        }
        body::before {
            display: none;
        }
        * {
            scrollbar-width: thin;
            scrollbar-color: #334155 transparent;
        }
        *::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        *::-webkit-scrollbar-track {
            background: transparent;
        }
        *::-webkit-scrollbar-thumb {
            background: #334155;
            border-radius: 999px;
        }
        .shell {
            width: 100%;
            max-width: none;
            height: 100vh;
            margin: 0;
            padding: 0;
            display: grid;
            grid-template-columns: 1fr;
            grid-template-rows: auto minmax(0, 1fr);
            overflow: hidden;
        }
        .sidebar {
            position: relative;
            z-index: 1;
            min-height: 0;
            padding: 14px 18px;
            display: grid;
            grid-template-columns: minmax(560px, 1.2fr) minmax(390px, 0.8fr);
            grid-template-rows: auto auto;
            grid-template-areas:
                "actions schedule"
                "result result";
            gap: 12px;
            overflow: visible;
            background: rgba(7, 11, 19, 0.96);
            border: 0;
            border-bottom: 1px solid var(--border);
            box-shadow: none;
        }
        .brand,
        .nav-list {
            display: none;
        }
        .sidebar-actions {
            grid-area: actions;
            min-width: 0;
            display: grid;
            grid-template-columns: 210px minmax(0, 1fr);
            gap: 12px;
        }
        .sidebar-actions > .spotlight {
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        .sidebar-actions .toolbar {
            min-width: 0;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            align-content: center;
        }
        .sidebar-scroll {
            grid-area: schedule;
            min-height: 0;
            overflow: visible;
            padding: 0;
        }
        .sidebar-scroll > .spotlight {
            height: 100%;
        }
        .message {
            grid-area: result;
            min-height: 36px;
            max-height: 58px;
            padding: 9px 12px;
            overflow: auto;
            display: flex;
            align-items: center;
            border-radius: var(--radius-sm);
            color: var(--muted);
            background: rgba(15, 23, 42, 0.62);
            border: 1px solid rgba(148, 163, 184, 0.1);
            font-size: 0.82rem;
            line-height: 1.35;
        }
        .message::before {
            content: "";
            width: 7px;
            height: 7px;
            margin-right: 9px;
            flex: 0 0 auto;
            border-radius: 50%;
            background: #475569;
        }
        .message.has-value::before {
            background: var(--accent);
            box-shadow: 0 0 12px rgba(139, 124, 255, 0.6);
        }
        .content {
            min-width: 0;
            min-height: 0;
            height: auto;
            padding: 14px 18px 18px;
            display: grid;
            grid-template-rows: auto minmax(0, 1fr);
            gap: 12px;
            overflow: hidden;
        }
        .hero {
            display: none;
        }
        .card,
        .stat,
        .spotlight {
            background: linear-gradient(145deg, rgba(14, 21, 34, 0.98), rgba(9, 14, 24, 0.98));
            border: 1px solid var(--border);
            box-shadow: none;
            backdrop-filter: none;
        }
        .spotlight {
            padding: 12px 14px;
            border-radius: var(--radius-md);
        }
        .spotlight-label,
        .stat-label,
        .metric-name,
        .field label {
            margin-bottom: 5px;
            color: #718096;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.09em;
            text-transform: uppercase;
        }
        .spotlight-value {
            position: relative;
            padding-left: 15px;
            font-size: 1.22rem;
            font-weight: 750;
            letter-spacing: -0.02em;
        }
        .spotlight-value::before {
            content: "";
            position: absolute;
            left: 0;
            top: 50%;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--good);
            box-shadow: 0 0 12px rgba(68, 209, 157, 0.55);
            transform: translateY(-50%);
        }
        .spotlight-subtext {
            margin-top: 4px;
            color: var(--muted);
            font-size: 0.76rem;
            line-height: 1.35;
        }
        button {
            min-height: 38px;
            padding: 9px 12px;
            border-radius: var(--radius-sm);
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0;
            transition: border-color 140ms ease, background 140ms ease, color 140ms ease, transform 140ms ease;
        }
        button:hover:not(:disabled) {
            transform: translateY(-1px);
        }
        button:focus-visible,
        input:focus-visible,
        select:focus-visible {
            outline: 2px solid rgba(139, 124, 255, 0.8);
            outline-offset: 2px;
        }
        .btn-primary {
            color: white;
            background: linear-gradient(135deg, #765cf5, #5d4ad8);
            box-shadow: 0 8px 20px rgba(109, 93, 252, 0.2);
        }
        .btn-danger {
            color: #fecdd3;
            background: rgba(244, 63, 94, 0.1);
            border: 1px solid rgba(244, 63, 94, 0.25);
            box-shadow: none;
        }
        .btn-danger:hover:not(:disabled) {
            background: rgba(244, 63, 94, 0.18);
        }
        .btn-secondary {
            color: #cbd5e1;
            background: rgba(30, 41, 59, 0.68);
            border: 1px solid rgba(148, 163, 184, 0.14);
        }
        .btn-secondary:hover:not(:disabled) {
            color: white;
            border-color: rgba(139, 124, 255, 0.5);
            background: rgba(51, 65, 85, 0.72);
        }
        .btn-compact {
            min-height: 34px;
            padding: 7px 11px;
            font-size: 0.75rem;
        }
        .schedule-panel {
            display: grid;
            grid-template-columns: minmax(125px, 0.75fr) minmax(150px, 0.8fr) minmax(150px, 0.9fr);
            grid-template-areas:
                "switch time presets"
                "facts facts save"
                "status status status";
            gap: 8px 10px;
            align-items: center;
        }
        .schedule-panel .switch-row {
            grid-area: switch;
        }
        .schedule-panel .time-grid {
            grid-area: time;
        }
        .schedule-panel .preset-grid {
            grid-area: presets;
        }
        .schedule-panel .schedule-facts {
            grid-area: facts;
        }
        .schedule-panel .schedule-status {
            grid-area: status;
        }
        .schedule-panel > button {
            grid-area: save;
            width: 100%;
        }
        .switch {
            width: 42px;
            height: 24px;
        }
        .slider::before {
            width: 16px;
            height: 16px;
        }
        .switch input:checked + .slider {
            background: var(--accent-strong);
        }
        .switch input:checked + .slider::before {
            transform: translateX(18px);
        }
        .time-grid,
        .preset-grid,
        .schedule-facts {
            gap: 6px;
        }
        .field {
            gap: 4px;
        }
        .field input {
            min-width: 0;
            padding: 7px 8px;
            border-radius: 7px;
            color: var(--text);
            background: #080d16;
            border: 1px solid rgba(148, 163, 184, 0.16);
            font-size: 0.75rem;
            font-weight: 650;
            color-scheme: dark;
        }
        .preset-btn {
            min-height: 30px;
            padding: 6px;
            border-radius: 7px;
            color: #aab5c5;
            background: rgba(30, 41, 59, 0.6);
            border: 1px solid rgba(148, 163, 184, 0.12);
            font-size: 0.68rem;
            font-weight: 700;
        }
        .preset-btn:hover {
            background: rgba(109, 93, 252, 0.12);
            border-color: rgba(139, 124, 255, 0.45);
        }
        .schedule-facts {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .schedule-fact {
            min-width: 0;
            padding: 6px 8px;
            border-radius: 7px;
            background: rgba(15, 23, 42, 0.74);
            border: 1px solid rgba(148, 163, 184, 0.09);
        }
        .schedule-fact span {
            margin-bottom: 2px;
            color: #64748b;
            font-size: 8px;
            font-weight: 700;
        }
        .schedule-fact strong {
            font-size: 0.69rem;
            font-weight: 700;
        }
        .schedule-status {
            padding: 7px 9px;
            border-radius: 7px;
            color: #a7f3d0;
            background: rgba(16, 185, 129, 0.07);
            border: 1px solid rgba(16, 185, 129, 0.13);
            font-size: 0.7rem;
            line-height: 1.3;
        }
        .schedule-panel .schedule-status {
            display: none;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 10px;
            margin: 0;
        }
        .stat {
            min-width: 0;
            padding: 12px 14px;
            border-radius: var(--radius-md);
        }
        .stat-value {
            overflow: hidden;
            color: #f1f5f9;
            font-size: 1.3rem;
            font-weight: 750;
            letter-spacing: -0.025em;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .workspace {
            min-height: 0;
            display: grid;
            grid-template-columns: minmax(430px, 1.08fr) minmax(360px, 0.92fr);
            grid-template-rows: minmax(0, 0.44fr) minmax(0, 0.56fr);
            grid-template-areas:
                "queue summary"
                "queue logs";
            gap: 12px;
        }
        .queue-panel {
            grid-area: queue;
        }
        .summary-panel {
            grid-area: summary;
        }
        .logs-section {
            grid-area: logs;
            margin: 0;
        }
        .section {
            min-height: 0;
            padding: 15px;
            display: flex;
            flex-direction: column;
            border-radius: var(--radius-xl);
        }
        .section-header {
            flex: 0 0 auto;
            margin-bottom: 12px;
        }
        .section-title {
            color: #f8fafc;
            font-size: 0.98rem;
            font-weight: 750;
            letter-spacing: -0.01em;
        }
        .section-meta {
            margin-top: 3px;
            color: #718096;
            font-size: 0.72rem;
        }
        .pill {
            min-width: auto;
            padding: 5px 9px;
            border-radius: 999px;
            font-size: 9px;
            font-weight: 750;
            letter-spacing: 0.07em;
        }
        .pill.running {
            color: #86efac;
            background: rgba(34, 197, 94, 0.1);
            border-color: rgba(34, 197, 94, 0.2);
        }
        .pill.idle {
            color: #a5b4fc;
            background: rgba(99, 102, 241, 0.1);
            border-color: rgba(99, 102, 241, 0.2);
        }
        .pill.alert {
            color: #fcd34d;
            background: rgba(245, 158, 11, 0.1);
            border-color: rgba(245, 158, 11, 0.2);
        }
        .jobs {
            min-height: 0;
            overflow: auto;
            display: grid;
            align-content: start;
            gap: 10px;
            padding-right: 3px;
        }
        .job {
            padding: 14px;
            border-radius: var(--radius-md);
            background: #0c1421;
            border: 1px solid rgba(148, 163, 184, 0.12);
        }
        .job-title {
            font-size: 0.98rem;
            font-weight: 750;
        }
        .job-subtitle {
            margin-top: 3px;
            color: #7f8ca1;
            font-size: 0.76rem;
        }
        .progress {
            height: 7px;
            background: var(--track);
        }
        .progress-bar {
            background: linear-gradient(90deg, #6d5dfc, #9b8cff);
            box-shadow: 0 0 18px rgba(109, 93, 252, 0.35);
        }
        .progress-top {
            font-size: 0.76rem;
        }
        .metrics {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 7px;
        }
        .metric {
            min-width: 0;
            padding: 9px;
            border-radius: 8px;
            background: rgba(15, 23, 42, 0.72);
            border: 1px solid rgba(148, 163, 184, 0.08);
        }
        .metric-value {
            overflow: hidden;
            font-size: 0.82rem;
            font-weight: 700;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .empty {
            min-height: 100%;
            border-radius: var(--radius-md);
            border: 1px dashed rgba(148, 163, 184, 0.17);
            background:
                radial-gradient(300px 130px at 50% 50%, rgba(109, 93, 252, 0.07), transparent 70%),
                rgba(15, 23, 42, 0.22);
            color: #718096;
        }
        .empty > div > div:first-child {
            color: #dbe4f0;
            font-size: 1rem !important;
            font-weight: 700;
        }
        .stack {
            min-height: 0;
            overflow: auto;
            gap: 10px;
        }
        .mini-list {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }
        .mini-item {
            min-width: 0;
            padding: 10px 11px;
            border-radius: 8px;
            background: rgba(15, 23, 42, 0.62);
            border: 1px solid rgba(148, 163, 184, 0.09);
        }
        .mini-label {
            color: #718096;
            font-size: 0.72rem;
        }
        .mini-value {
            color: #e2e8f0;
            font-size: 0.82rem;
            font-weight: 750;
        }
        #summary-note {
            padding: 9px 10px;
            border-radius: 8px;
            background: rgba(109, 93, 252, 0.06);
            border: 1px solid rgba(109, 93, 252, 0.1);
            font-size: 0.7rem;
            line-height: 1.4;
        }
        .log-toolbar {
            flex-wrap: nowrap;
        }
        .log-select {
            min-width: 126px;
            padding: 8px 10px;
            border-radius: 8px;
            color: #cbd5e1;
            background: #090f19;
            border: 1px solid rgba(148, 163, 184, 0.14);
            font-size: 0.72rem;
            font-weight: 650;
            color-scheme: dark;
        }
        .log-select option {
            background: #090f19;
        }
        .log-viewer {
            flex: 1 1 auto;
            min-height: 0;
            height: auto;
            padding: 10px;
            border-radius: var(--radius-md);
            background: #060a11;
            border: 1px solid rgba(148, 163, 184, 0.1);
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
            font-size: 10px;
            line-height: 1.45;
        }
        .log-row {
            grid-template-columns: 76px minmax(0, 1fr);
            gap: 8px;
            padding: 3px 2px;
            border-bottom-color: rgba(148, 163, 184, 0.045);
        }
        .log-source {
            color: #9b8cff;
            font-size: 9px;
            font-weight: 750;
        }
        .log-line {
            color: #9ba8ba;
        }
        @media (max-width: 1050px) {
            html,
            body {
                overflow: auto;
            }
            .shell {
                height: auto;
                min-height: 100vh;
                overflow: visible;
            }
            .sidebar {
                grid-template-columns: 1fr;
                grid-template-areas:
                    "actions"
                    "schedule"
                    "result";
            }
            .schedule-panel {
                grid-template-columns: minmax(140px, 0.65fr) minmax(180px, 0.7fr) minmax(180px, 0.7fr) minmax(300px, 1.2fr);
                grid-template-areas:
                    "switch time presets facts"
                    "status status status save";
            }
            .content {
                overflow: visible;
            }
            .workspace {
                grid-template-columns: minmax(0, 1fr);
                grid-template-rows: minmax(330px, auto) auto minmax(300px, auto);
                grid-template-areas:
                    "queue"
                    "summary"
                    "logs";
            }
            .summary-panel {
                max-height: none;
            }
            .log-viewer {
                min-height: 300px;
            }
        }
        @media (max-width: 760px) {
            .sidebar,
            .content {
                padding: 12px;
            }
            .sidebar-actions {
                grid-template-columns: 1fr;
            }
            .sidebar-actions .toolbar {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .schedule-panel {
                grid-template-columns: 1fr;
                grid-template-areas:
                    "switch"
                    "time"
                    "presets"
                    "facts"
                    "status"
                    "save";
            }
            .stats {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .stats .stat:last-child {
                grid-column: span 2;
            }
            .metrics,
            .mini-list {
                grid-template-columns: 1fr;
            }
            .section-header,
            .job-head,
            .mini-item {
                align-items: flex-start;
            }
        }
    </style>
</head>
<body>
    <main class="shell">
        <aside class="sidebar">
            <div class="brand">
                <div class="brand-title">Jellyfin Control</div>
                <div class="brand-subtitle">Port 5050 optimizer surface</div>
            </div>

            <nav class="nav-list" aria-label="Dashboard sections">
                <a class="nav-link" href="#overview"><span></span>Overview</a>
                <a class="nav-link" href="#queue"><span></span>Active Queue</a>
                <a class="nav-link" href="#logs"><span></span>Logs</a>
            </nav>

            <div class="sidebar-actions">
                <div class="spotlight">
                    <div class="spotlight-label">Service State</div>
                    <div class="spotlight-value" id="status">Loading</div>
                    <div class="spotlight-subtext" id="status-copy">Checking optimizer activity and current progress files.</div>
                </div>
                <div class="toolbar">
                    <button class="btn-primary" id="start-btn" onclick="postAction('/start', this)">Start Pipeline</button>
                    <button class="btn-danger" id="stop-btn" onclick="postAction('/stop', this)">Stop Pipeline</button>
                    <button class="btn-secondary" id="skip-btn" onclick="postAction('/skip', this)">Skip Current Job</button>
                    <button class="btn-secondary" onclick="postAction('/fix-subs', this)">Fix Subtitles</button>
                    <button class="btn-secondary" onclick="postAction('/generate-subs', this)">Generate Subtitles</button>
                </div>
            </div>

            <div class="sidebar-scroll">
                <div class="spotlight schedule-panel">
                    <div class="switch-row">
                        <div>
                            <div class="spotlight-label">Active Interval</div>
                            <div class="spotlight-subtext" id="schedule-copy">Always active</div>
                        </div>
                        <label class="switch" title="Limit scheduled optimizer runs">
                            <input type="checkbox" id="schedule-enabled">
                            <span class="slider"></span>
                        </label>
                    </div>
                    <div class="time-grid">
                        <div class="field">
                            <label for="schedule-start">Start</label>
                            <input type="time" id="schedule-start" value="00:00">
                        </div>
                        <div class="field">
                            <label for="schedule-end">End</label>
                            <input type="time" id="schedule-end" value="23:59">
                        </div>
                    </div>
                    <div class="preset-grid">
                        <button class="preset-btn" type="button" onclick="applySchedulePreset(false, '00:00', '23:59')">Always</button>
                        <button class="preset-btn" type="button" onclick="applySchedulePreset(true, '22:00', '08:00')">Night</button>
                        <button class="preset-btn" type="button" onclick="applySchedulePreset(true, '05:00', '17:00')">Day</button>
                    </div>
                    <div class="schedule-facts">
                        <div class="schedule-fact">
                            <span>Now IST</span>
                            <strong id="schedule-now">--:--</strong>
                        </div>
                        <div class="schedule-fact">
                            <span>Next</span>
                            <strong id="schedule-next">None</strong>
                        </div>
                        <div class="schedule-fact">
                            <span>Length</span>
                            <strong id="schedule-duration">24h</strong>
                        </div>
                    </div>
                    <div class="schedule-status" id="schedule-status">Scheduled runs are not limited.</div>
                    <button class="btn-secondary btn-compact" onclick="saveSchedule(this)">Save Interval</button>
                </div>
            </div>

            <div class="message" id="result">No recent actions.</div>
        </aside>

        <div class="content">
            <section class="hero" id="overview">
                <article class="card hero-main">
                    <div>
                        <div class="eyebrow">
                            <span class="eyebrow-dot"></span>
                            Live Dashboard
                        </div>
                        <h1>Jellyfin Optimizer Dashboard</h1>
                        <div class="hero-copy">
                            Monitor active transcodes, ETA, scheduler state, and logs from one viewport.
                        </div>
                    </div>
                    <div class="hero-status">
                        <div class="spotlight-label">Current Window</div>
                        <div class="spotlight-value" id="active-window">Always</div>
                        <div class="spotlight-subtext">Schedule is evaluated in IST.</div>
                    </div>
                </article>
            </section>

            <section class="stats">
                <article class="stat">
                    <div class="stat-label">Active Jobs</div>
                    <div class="stat-value" id="job-count">0</div>
                </article>
                <article class="stat">
                    <div class="stat-label">Average Progress</div>
                    <div class="stat-value" id="avg-progress">0.0%</div>
                </article>
                <article class="stat">
                    <div class="stat-label">Closest ETA</div>
                    <div class="stat-value" id="closest-eta">--:--</div>
                </article>
                <article class="stat">
                    <div class="stat-label">Last Refresh</div>
                    <div class="stat-value" id="updated-at">--:--</div>
                </article>
                <article class="stat">
                    <div class="stat-label">Active Window</div>
                    <div class="stat-value" id="active-window-stat">Always</div>
                </article>
            </section>

            <section class="workspace">
                <article class="card section queue-panel" id="queue">
                    <div class="section-header">
                        <div>
                            <div class="section-title">Active Queue</div>
                            <div class="section-meta">Live ffmpeg progress, elapsed time, ETA, speed, and FPS.</div>
                        </div>
                        <div class="pill idle" id="queue-pill">Waiting</div>
                    </div>
                    <div class="jobs" id="jobs"></div>
                </article>

                <aside class="card section summary-panel">
                    <div class="section-header">
                        <div>
                            <div class="section-title">Live Summary</div>
                            <div class="section-meta">Quick view of current optimizer activity.</div>
                        </div>
                    </div>
                    <div class="stack">
                        <div class="mini-list">
                            <div class="mini-item">
                                <div class="mini-label">Pipeline status</div>
                                <div class="mini-value" id="summary-status">Loading</div>
                            </div>
                            <div class="mini-item">
                                <div class="mini-label">Running jobs</div>
                                <div class="mini-value" id="summary-jobs">0</div>
                            </div>
                            <div class="mini-item">
                                <div class="mini-label">Fastest speed</div>
                                <div class="mini-value" id="summary-speed">0x</div>
                            </div>
                            <div class="mini-item">
                                <div class="mini-label">Longest elapsed</div>
                                <div class="mini-value" id="summary-elapsed">--:--</div>
                            </div>
                        </div>
                        <div class="muted" id="summary-note">
                            Polls `/api/status` every 5 seconds. Actions are handled by the same Flask control surface.
                        </div>
                    </div>
                </aside>

                <section class="card section logs-section" id="logs">
                    <div class="section-header">
                        <div>
                            <div class="section-title">Jellyfin Logs</div>
                            <div class="section-meta">Optimizer, subtitle, refresh, and control logs.</div>
                        </div>
                        <div class="log-toolbar">
                            <select class="log-select" id="log-source" onchange="refreshLogs(true)">
                                <option value="all">All logs</option>
                                <option value="conversion">Conversion</option>
                                <option value="master">Master</option>
                                <option value="shows">Shows</option>
                                <option value="movies">Movies</option>
                                <option value="uhdmovies">UHD Movies</option>
                                <option value="songs">Songs</option>
                                <option value="subtitles">Subtitles</option>
                                <option value="refresh">Refresh</option>
                                <option value="control">Control</option>
                            </select>
                            <button class="btn-secondary btn-compact" onclick="refreshLogs(true)">Refresh</button>
                        </div>
                    </div>
                    <div class="log-viewer" id="log-viewer">
                        <div class="muted">Loading logs...</div>
                    </div>
                </section>
            </section>
        </div>
    </main>

<script>
function formatSeconds(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return '--:--';
    }
    const seconds = Math.max(0, Math.round(Number(value)));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatTimeStamp(epochSeconds) {
    if (!epochSeconds) {
        return '--:--';
    }
    return new Date(epochSeconds * 1000).toLocaleTimeString();
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function getStateClass(value) {
    const state = String(value || '').toLowerCase();
    if (state.includes('run')) {
        return 'running';
    }
    if (state.includes('stop') || state.includes('wait')) {
        return 'alert';
    }
    return 'idle';
}

function setMessage(text, hasValue) {
    const el = document.getElementById('result');
    el.textContent = text;
    el.classList.toggle('has-value', Boolean(hasValue));
}

let scheduleSaveTimer = null;
let scheduleEditing = false;

function formatMinutesUntil(minutes) {
    if (minutes === null || minutes === undefined) {
        return 'None';
    }
    const value = Number(minutes);
    if (!Number.isFinite(value)) {
        return 'None';
    }
    if (value < 60) {
        return `${value}m`;
    }
    const hours = Math.floor(value / 60);
    const mins = value % 60;
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function renderSchedule(schedule) {
    if (!schedule) {
        return;
    }
    const enabled = Boolean(schedule.enabled);
    if (!scheduleEditing) {
        document.getElementById('schedule-enabled').checked = enabled;
        document.getElementById('schedule-start').value = schedule.start || '00:00';
        document.getElementById('schedule-end').value = schedule.end || '23:59';
    }
    document.getElementById('schedule-copy').textContent = schedule.status_label || schedule.display || 'Always active';
    const windowLabel = enabled ? `${schedule.status_label || 'Window'}` : 'Always';
    document.getElementById('active-window').textContent = windowLabel;
    document.getElementById('active-window-stat').textContent = windowLabel;
    document.getElementById('schedule-now').textContent = schedule.current_time || '--:--';
    document.getElementById('schedule-duration').textContent = schedule.duration_label || '24h';

    const status = document.getElementById('schedule-status');
    if (!enabled) {
        status.textContent = 'Scheduled runs are not limited.';
        document.getElementById('schedule-next').textContent = 'None';
        return;
    }

    const nextLabel = schedule.next_change_time
        ? `${schedule.next_change_time} (${formatMinutesUntil(schedule.minutes_until_next_change)})`
        : 'None';
    document.getElementById('schedule-next').textContent = nextLabel;

    if (schedule.active_now) {
        status.textContent = schedule.next_change_time
            ? `Active now in IST. Scheduled runs may start until ${schedule.next_change_time}; ${formatMinutesUntil(schedule.minutes_until_next_change)} remaining.`
            : 'Active all day in IST. Scheduled runs may start at any time.';
    } else {
        status.textContent = `Paused now in IST. Scheduled runs resume at ${schedule.next_change_time}; ${formatMinutesUntil(schedule.minutes_until_next_change)} from now.`;
    }
}

function applySchedulePreset(enabled, start, end) {
    scheduleEditing = false;
    document.getElementById('schedule-enabled').checked = enabled;
    document.getElementById('schedule-start').value = start;
    document.getElementById('schedule-end').value = end;
    saveSchedule();
}

function scheduleChanged() {
    scheduleEditing = true;
    clearTimeout(scheduleSaveTimer);
    scheduleSaveTimer = setTimeout(() => saveSchedule(), 500);
}

async function saveSchedule(button) {
    const original = button ? button.innerHTML : '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<span class="spin">.</span> Saving';
    }

    try {
        const payload = {
            enabled: document.getElementById('schedule-enabled').checked,
            start: document.getElementById('schedule-start').value,
            end: document.getElementById('schedule-end').value
        };
        const response = await fetch('/api/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Schedule save failed');
        }
        scheduleEditing = false;
        renderSchedule(data.schedule);
        setMessage(data.message || 'Active interval saved', true);
    } catch (error) {
        setMessage(`Schedule save failed: ${error.message}`, true);
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = original;
        }
    }
}

function renderJobs(jobs) {
    const root = document.getElementById('jobs');
    const queuePill = document.getElementById('queue-pill');

    if (!jobs.length) {
        queuePill.className = 'pill idle';
        queuePill.textContent = 'Idle';
        root.innerHTML = `
            <div class="empty">
                <div>
                    <div style="font-size:2rem; margin-bottom:10px;">No Active Jobs</div>
                    <div>The optimizer is currently idle or has no live progress files.</div>
                </div>
            </div>
        `;
        return;
    }

    queuePill.className = 'pill running';
    queuePill.textContent = `${jobs.length} Running`;

    root.innerHTML = jobs.map((job) => {
        const percentRaw = Math.max(0, Math.min(100, Number(job.percent || 0)));
        const percent = percentRaw.toFixed(1);
        const speed = job.speed || '0x';
        const fps = Number(job.fps || 0).toFixed(2);
        const processed = job.processed_display || formatSeconds(job.processed_seconds);
        const duration = job.duration_display || formatSeconds(job.duration_seconds);
        const eta = job.eta_display || formatSeconds(job.eta_seconds);
        const elapsed = formatSeconds(job.elapsed_seconds);
        const state = job.state || 'running';
        return `
            <article class="job">
                <div class="job-head">
                    <div>
                        <div class="job-title">${escapeHtml(job.movie || job.job_type || 'Job')}</div>
                        <div class="job-subtitle">${escapeHtml(job.file || job.title || 'Active optimizer task')}</div>
                    </div>
                    <div class="pill ${getStateClass(state)}">${escapeHtml(state)}</div>
                </div>
                <div class="progress-shell">
                    <div class="progress-top">
                        <div class="progress-label">${processed} / ${duration}</div>
                        <div class="progress-value">${percent}%</div>
                    </div>
                    <div class="progress">
                        <div class="progress-bar" style="width:${percentRaw}%"></div>
                    </div>
                </div>
                <div class="metrics">
                    <div class="metric">
                        <div class="metric-name">ETA</div>
                        <div class="metric-value">${eta}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-name">Elapsed</div>
                        <div class="metric-value">${elapsed}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-name">Speed</div>
                        <div class="metric-value">${escapeHtml(speed)}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-name">FPS</div>
                        <div class="metric-value">${fps}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-name">State</div>
                        <div class="metric-value">${escapeHtml(state)}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-name">Source</div>
                        <div class="metric-value">${escapeHtml(job.job_type || 'optimizer')}</div>
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

function updateSummary(data) {
    const jobs = data.active_jobs || [];
    const avgProgress = jobs.length
        ? (jobs.reduce((sum, job) => sum + Number(job.percent || 0), 0) / jobs.length).toFixed(1) + '%'
        : '0.0%';
    const closestEtaValue = jobs
        .map((job) => Number(job.eta_seconds))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((a, b) => a - b)[0];
    const fastestSpeed = jobs
        .map((job) => job.speed || '0x')
        .sort((a, b) => parseFloat(b) - parseFloat(a))[0] || '0x';
    const longestElapsed = jobs
        .map((job) => Number(job.elapsed_seconds))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((a, b) => b - a)[0];

    document.getElementById('status').textContent = data.status || 'UNKNOWN';
    document.getElementById('summary-status').textContent = data.status || 'UNKNOWN';
    document.getElementById('job-count').textContent = String(jobs.length);
    document.getElementById('summary-jobs').textContent = String(jobs.length);
    document.getElementById('avg-progress').textContent = avgProgress;
    document.getElementById('closest-eta').textContent = formatSeconds(closestEtaValue);
    document.getElementById('updated-at').textContent = formatTimeStamp(data.updated_at);
    document.getElementById('summary-speed').textContent = fastestSpeed;
    document.getElementById('summary-elapsed').textContent = formatSeconds(longestElapsed);
    document.getElementById('status-copy').textContent = jobs.length
        ? 'Live progress data is flowing from the optimizer scripts.'
        : 'No active progress files detected right now.';
    renderSchedule(data.schedule);
}

function renderLogs(data) {
    const root = document.getElementById('log-viewer');
    const entries = data.entries || [];

    if (!entries.length) {
        root.innerHTML = '<div class="muted">No log lines found for this source.</div>';
        return;
    }

    const wasNearBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 48;
    root.innerHTML = entries.map((entry) => `
        <div class="log-row">
            <div class="log-source">${escapeHtml(entry.source || 'log')}</div>
            <div class="log-line">${escapeHtml(entry.line || '')}</div>
        </div>
    `).join('');

    if (wasNearBottom) {
        root.scrollTop = root.scrollHeight;
    }
}

let logsInFlight = false;

async function refreshLogs(manual = false) {
    if (logsInFlight) {
        return;
    }

    logsInFlight = true;
    try {
        const source = document.getElementById('log-source').value || 'all';
        const response = await fetch(`/api/logs?source=${encodeURIComponent(source)}&limit=400`, { cache: 'no-store' });
        const data = await response.json();
        renderLogs(data);
        if (manual) {
            setMessage(`Logs refreshed at ${formatTimeStamp(data.updated_at)}.`, true);
        }
    } catch (error) {
        const root = document.getElementById('log-viewer');
        root.innerHTML = `<div class="muted">Log refresh failed: ${escapeHtml(error.message)}</div>`;
    } finally {
        logsInFlight = false;
    }
}

let refreshInFlight = false;

async function refreshStatus(manual = false) {
    if (refreshInFlight) {
        return;
    }

    refreshInFlight = true;
    try {
        if (manual) {
            setMessage('Refreshing dashboard data...', true);
        }
        const response = await fetch('/api/status', { cache: 'no-store' });
        const data = await response.json();
        updateSummary(data);
        renderJobs(data.active_jobs || []);
        if (manual) {
            setMessage(`Dashboard refreshed at ${formatTimeStamp(data.updated_at)}.`, true);
        }
        return data;
    } catch (error) {
        setMessage(`Status refresh failed: ${error.message}`, true);
    } finally {
        refreshInFlight = false;
    }
}

async function postAction(path, button) {
    const original = button ? button.innerHTML : '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<span class="spin">⟳</span> Working';
    }

    try {
        const response = await fetch(path, { method: 'POST' });
        const data = await response.json();
        setMessage(data.message || data.status || JSON.stringify(data), true);
        updateSummary(data);
        renderJobs(data.active_jobs || []);
        await refreshStatus(false);
    } catch (error) {
        setMessage(`Action failed: ${error.message}`, true);
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = original;
        }
    }
}

refreshStatus();
refreshLogs();
setInterval(() => refreshStatus(false), 5000);
setInterval(() => refreshLogs(false), 5000);
['schedule-enabled', 'schedule-start', 'schedule-end'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('change', scheduleChanged);
        el.addEventListener('focus', () => { scheduleEditing = true; });
        el.addEventListener('blur', () => {
            clearTimeout(scheduleSaveTimer);
            scheduleSaveTimer = setTimeout(() => saveSchedule(), 250);
        });
    }
});
</script>
</body>
</html>
"""


if __name__ == "__main__":
    log.info("Jellyfin Control Server Started")
    app.run(host="0.0.0.0", port=5050)
