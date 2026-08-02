#!/usr/bin/env python3

import subprocess, json, os, time, shlex, errno, shutil
from pathlib import Path
from datetime import datetime
from transcode_backend import hardware_video_args, media_is_baselined, pre_input_args, select_backend

# ================= CONFIG =================

ROOT = Path("/srv/data/media/movies")
LOG_PREFIX = "[MOVIES]"
INDEX_FILE = Path("/srv/jellyfin-control/scripts/logs/converted-movies.jsonl")
PROGRESS_DIR = Path("/srv/jellyfin-control/scripts/logs/progress")
PROGRESS_FILE = PROGRESS_DIR / "movies.json"

VIDEO_EXTS = {".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv"}

TARGET_VIDEO = "h264"
TARGET_AUDIO = "aac"
TARGET_VIDEO_4K = "hevc"
TARGET_AUDIO_4K_MULTICH = "eac3"
SUPPORTED_VIDEO_CODECS = {
    "standard": {"h264", "hevc"},
    "4k": {TARGET_VIDEO_4K},
}
SUPPORTED_AUDIO_CODECS = {
    "standard": {TARGET_AUDIO},
    "4k": {"aac", "ac3", "eac3"},
}
SUPPORTED_VIDEO_PIX_FMTS = {
    "h264": {"yuv420p"},
    "hevc": {"yuv420p", "yuv420p10le"},
}
SUPPORTED_SUBTITLE_CODECS = {"subrip", "ass", "ssa", "webvtt", "mov_text"}

THREADS = os.environ.get("JELLYFIN_THREADS", str(os.cpu_count() or 1))
NICE = "5"
X265_PRESET = os.environ.get("JELLYFIN_X265_PRESET", "superfast")
X265_PARAMS = os.environ.get(
    "JELLYFIN_X265_PARAMS",
    f"pools={THREADS}:frame-threads=2:wpp=1:lookahead-slices=1:ref=2:bframes=2:rc-lookahead=10",
)

MAX_OK_BITRATE = 12_000_000
MAX_OK_AUDIO_CHANNELS = 2
MAX_OK_4K_BITRATE = 35_000_000
MAX_OK_4K_AUDIO_CHANNELS = 8
TEMP_SPACE_RESERVE = 2 * 1024**3

# =========================================


# ---------- helpers ----------

def ts():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(event, title="", extra=""):
    msg = f"{LOG_PREFIX}[{ts()}] {event}"
    if title:
        msg += f" | {title}"
    if extra:
        msg += f" | {extra}"
    print(msg, flush=True)


def iso_now():
    return datetime.now().isoformat(timespec="seconds")


def safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def format_seconds(value):
    if value is None:
        return ""
    seconds = max(0, int(value))
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def ensure_temp_space(p: Path):
    source_size = p.stat().st_size
    required = int(source_size * 1.2) + TEMP_SPACE_RESERVE
    free = shutil.disk_usage(p.parent).free
    if free < required:
        raise RuntimeError(
            f"insufficient free space for temporary output: "
            f"need={required} free={free}"
        )


def write_progress(payload):
    PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = PROGRESS_FILE.with_suffix(".tmp")
    with tmp.open("w") as f:
        json.dump(payload, f, separators=(",", ":"))
    tmp.replace(PROGRESS_FILE)


def clear_progress():
    try:
        PROGRESS_FILE.unlink()
    except FileNotFoundError:
        pass


def build_progress_payload(title, movie, filename, source_path, output_path, total_duration, started_at, state, **extra):
    payload = {
        "job_type": "movies",
        "state": state,
        "title": title,
        "movie": movie,
        "file": filename,
        "source_path": str(source_path),
        "output_path": str(output_path),
        "duration_seconds": total_duration,
        "started_at": started_at,
        "updated_at": iso_now(),
    }
    payload.update(extra)
    return payload


def is_apple_metadata(p: Path):
    return p.name.startswith("._")


def is_partial_output(p: Path):
    return ".converting." in p.name


def get_final_output_path(p: Path):
    if is_partial_output(p):
        return p.with_name(p.name.replace(".converting.", ".", 1))
    if p.suffix.lower() == ".mkv":
        return p
    return p.with_suffix(".mkv")


def get_partial_output_path(p: Path):
    if is_partial_output(p):
        return p
    return get_final_output_path(p).with_suffix(".converting.mkv")


def get_lock_path(p: Path):
    return p.with_suffix(p.suffix + ".lock")


def process_alive(pid: int):
    try:
        os.kill(pid, 0)
        return True
    except OSError as e:
        return e.errno == errno.EPERM


def acquire_file_lock(p: Path):
    lock = get_lock_path(p)
    current_pid = os.getpid()

    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            try:
                existing_pid = int(lock.read_text().strip())
                stale = not process_alive(existing_pid)
            except Exception:
                stale = True

            if not stale:
                return None

            movie, filename = parse_movie(p)
            log("DELETE_STALE_LOCK", f"{movie} / {filename}")
            try:
                lock.unlink()
            except Exception as e:
                log("DELETE_STALE_LOCK_FAILED", f"{movie} / {filename}", str(e))
                return None
            continue

        with os.fdopen(fd, "w") as lock_file:
            lock_file.write(str(current_pid))
        return lock


def lock_is_active(p: Path):
    lock = get_lock_path(p)
    if not lock.exists():
        return False
    try:
        return process_alive(int(lock.read_text().strip()))
    except Exception:
        return False


def parse_movie(path: Path):
    return path.parent.name, path.name


def add_index_path_variants(index_cache: set, raw_path):
    if not raw_path:
        return

    raw = str(raw_path)
    index_cache.add(raw)

    try:
        final_output = str(get_final_output_path(Path(raw)))
    except Exception:
        return

    index_cache.add(final_output)


# ---------- index handling ----------

def load_index():
    if not INDEX_FILE.exists():
        return set()
    with INDEX_FILE.open() as f:
        paths = set()
        for line in f:
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                log("INDEX_ENTRY_INVALID", extra=line.strip()[:200])
                continue
            for key in ("path", "source_path", "output_path"):
                value = entry.get(key)
                add_index_path_variants(paths, value)
        return paths


def record_conversion(entry: dict, index_cache: set):
    output_path = entry["path"]
    source_path = entry.get("source_path")
    if output_path in index_cache or (source_path and source_path in index_cache):
        return
    with INDEX_FILE.open("a") as f:
        f.write(json.dumps(entry, separators=(",", ":")) + "\n")
    add_index_path_variants(index_cache, output_path)
    add_index_path_variants(index_cache, source_path)


def is_indexed_media(p: Path, index_cache: set):
    return str(p) in index_cache or str(get_final_output_path(p)) in index_cache


def should_skip_existing_output(p: Path, index_cache: set):
    partial_output = get_partial_output_path(p)
    if partial_output != p and partial_output.exists():
        movie, filename = parse_movie(p)
        if lock_is_active(p):
            log("SKIP_ACTIVE_TEMP", f"{movie} / {filename}", str(partial_output))
            return True
        log("DELETE_STALE_TEMP", f"{movie} / {filename}", str(partial_output))
        partial_output.unlink()

    final_output = get_final_output_path(p)
    if final_output == p and is_indexed_media(p, index_cache):
        movie, filename = parse_movie(p)
        try:
            if is_low_cpu_cost(p):
                log("SKIP_INDEXED_OUTPUT", f"{movie} / {filename}", "already converted")
                return True
            log("RECHECK_INDEX", f"{movie} / {filename}", "file no longer compliant")
        except Exception as e:
            log("RECHECK_INDEX_FAILED", f"{movie} / {filename}", str(e))
        index_cache.discard(str(p))
        index_cache.discard(str(final_output))
        return False

    if final_output.exists():
        movie, filename = parse_movie(p)
        try:
            if is_low_cpu_cost(final_output):
                log("SKIP_EXISTING_OUTPUT", f"{movie} / {filename}", str(final_output))
                add_index_path_variants(index_cache, final_output)
                add_index_path_variants(index_cache, p)
                return True
            log("RECONVERT_EXISTING_OUTPUT", f"{movie} / {filename}", "existing output is not compliant")
            index_cache.discard(str(p))
            index_cache.discard(str(final_output))
            return False
        except Exception as e:
            log("RECHECK_EXISTING_OUTPUT_FAILED", f"{movie} / {filename}", str(e))
            index_cache.discard(str(p))
            index_cache.discard(str(final_output))
            return False

    return False


# ---------- media helpers ----------

def ffprobe(p):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(p)],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {p}: {r.stderr.strip()}")
    return json.loads(r.stdout)


def get_primary_streams(data):
    video = None
    audio = None

    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video" and video is None:
            video = stream
        elif stream.get("codec_type") == "audio" and audio is None:
            audio = stream

    return video, audio


def has_unsupported_subtitles(data):
    for stream in data.get("streams", []):
        if stream.get("codec_type") != "subtitle":
            continue
        if stream.get("codec_name") not in SUPPORTED_SUBTITLE_CODECS:
            return True
    return False


def get_audio_streams(data):
    return [s for s in data.get("streams", []) if s.get("codec_type") == "audio"]


def get_media_bitrate(data, video_stream=None):
    if video_stream:
        stream_bitrate = int(safe_float(video_stream.get("bit_rate")))
        if stream_bitrate > 0:
            return stream_bitrate
    format_bitrate = int(safe_float(data.get("format", {}).get("bit_rate")))
    if format_bitrate > 0:
        return format_bitrate
    return 0


def video_stream_is_supported(stream, profile, data=None):
    if not stream:
        return False
    codec = stream.get("codec_name")
    pix_fmt = stream.get("pix_fmt")
    if codec not in SUPPORTED_VIDEO_CODECS[profile]:
        return False
    if pix_fmt not in SUPPORTED_VIDEO_PIX_FMTS.get(codec, set()):
        return False
    bitrate = get_media_bitrate(data or {}, stream)
    max_bitrate = MAX_OK_4K_BITRATE if profile == "4k" else MAX_OK_BITRATE
    return bitrate <= 0 or bitrate <= max_bitrate


def audio_stream_is_supported(stream, profile):
    codec = stream.get("codec_name")
    channels = int(stream.get("channels") or 0)

    if profile == "4k":
        return codec in SUPPORTED_AUDIO_CODECS[profile] and channels <= MAX_OK_4K_AUDIO_CHANNELS

    return codec in SUPPORTED_AUDIO_CODECS[profile] and channels <= MAX_OK_AUDIO_CHANNELS


def all_audio_streams_supported(data, profile):
    audio_streams = get_audio_streams(data)
    return all(audio_stream_is_supported(stream, profile) for stream in audio_streams)


def add_audio_codec_args(cmd, audio_streams, profile):
    for output_index, stream in enumerate(audio_streams):
        specifier = f"a:{output_index}"
        channels = int(stream.get("channels") or 0)
        if audio_stream_is_supported(stream, profile):
            cmd.extend([f"-c:{specifier}", "copy"])
        elif profile == "4k" and channels > 2:
            cmd.extend([
                f"-c:{specifier}", TARGET_AUDIO_4K_MULTICH,
                f"-ac:{specifier}", str(min(channels, 6)),
                f"-b:{specifier}", "640k",
            ])
        else:
            bitrate = "192k" if profile == "4k" else "160k"
            cmd.extend([
                f"-c:{specifier}", TARGET_AUDIO,
                f"-ac:{specifier}", "2",
                f"-b:{specifier}", bitrate,
            ])


def publish_preconvert_progress(video_path: Path, phase: str, percent: float, total_duration=0.0, started_at=None):
    movie, filename = parse_movie(video_path)
    title = f"{movie} / {filename}"
    write_progress(build_progress_payload(
        title,
        movie,
        filename,
        video_path,
        get_final_output_path(video_path),
        total_duration,
        started_at or iso_now(),
        "running",
        percent=round(percent, 2),
        eta_seconds=None,
        elapsed_seconds=0,
        processed_seconds=0.0,
        processed_display=phase,
        duration_display=format_seconds(total_duration) if total_duration else "--:--",
        eta_display="--:--",
        speed="preflight",
        fps=0.0,
        phase=phase,
    ))


def is_hdr_stream(video_stream):
    if not video_stream:
        return False

    color_primaries = video_stream.get("color_primaries")
    color_transfer = video_stream.get("color_transfer")

    return (
        color_primaries in {"bt2020", "smpte432"}
        or color_transfer in {"smpte2084", "arib-std-b67"}
    )


def is_4k_stream(video_stream):
    if not video_stream:
        return False

    width = int(video_stream.get("width") or 0)
    height = int(video_stream.get("height") or 0)
    return width >= 3800 or height >= 2100


def get_transcode_profile(data):
    video_stream, audio_stream = get_primary_streams(data)

    if not video_stream:
        return "standard"

    if is_4k_stream(video_stream) or is_hdr_stream(video_stream):
        return "4k"

    return "standard"


def get_duration_seconds(data):
    format_duration = safe_float(data.get("format", {}).get("duration"))
    if format_duration > 0:
        return format_duration

    for stream in data.get("streams", []):
        duration = safe_float(stream.get("duration"))
        if duration > 0:
            return duration

    return 0.0


# ---------- low CPU skip logic ----------

def is_low_cpu_cost(p):
    data = ffprobe(p)

    video_stream, audio_stream = get_primary_streams(data)
    profile = get_transcode_profile(data)

    if not video_stream:
        return False

    if has_unsupported_subtitles(data):
        return False

    if not video_stream_is_supported(video_stream, profile, data):
        return False

    if not all_audio_streams_supported(data, profile):
        return False

    return True


def record_existing_optimal(p: Path, index_cache: set):
    movie, filename = parse_movie(p)
    record_conversion({
        "movie": movie,
        "file": filename,
        "source_path": str(p),
        "path": str(get_final_output_path(p)),
        "output_path": str(get_final_output_path(p)),
        "converted_at": ts()
    }, index_cache)


# ---------- extract subtitles ----------

def extract_subtitles(video_path: Path):
    data = ffprobe(video_path)
    base_name = video_path.stem
    movie_name = video_path.parent.name
    total_duration = get_duration_seconds(data)

    extracted_count = 0
    subtitle_streams = [
        stream for stream in data.get("streams", [])
        if stream.get("codec_type") == "subtitle" and stream.get("codec_name") in SUPPORTED_SUBTITLE_CODECS
    ]
    subtitle_total = len(subtitle_streams)
    publish_preconvert_progress(video_path, "Extracting subtitles", 0.0, total_duration)

    for subtitle_index, stream in enumerate(subtitle_streams, start=1):
        index = stream.get("index")
        lang = stream.get("tags", {}).get("language", "und")

        out = video_path.parent / f"{base_name}.{lang}.srt"

        if out.exists():
            if subtitle_total:
                publish_preconvert_progress(video_path, "Extracting subtitles", (subtitle_index / subtitle_total) * 100, total_duration)
            continue

        try:
            if subtitle_total:
                publish_preconvert_progress(video_path, "Extracting subtitles", ((subtitle_index - 1) / subtitle_total) * 100, total_duration)
            subprocess.run([
                "ffmpeg",
                "-loglevel", "error",
                "-nostats",
                "-y",
                "-i", str(video_path),
                "-map", f"0:{index}",
                str(out)
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True)

            extracted_count += 1

        except Exception as e:
            log("SUB_EXTRACT_ERROR", movie_name, f"{lang}: {e}")

        if subtitle_total:
            publish_preconvert_progress(video_path, "Extracting subtitles", (subtitle_index / subtitle_total) * 100, total_duration)

    if extracted_count > 0:
        log("SUB_EXTRACT_DONE", movie_name, f"{extracted_count} subtitle(s)")



# ---------- conversion ----------

def convert(p, index_cache):
    tmp = get_partial_output_path(p)
    out = get_final_output_path(p)

    movie, filename = parse_movie(p)
    title = f"{movie} / {filename}"

    start = time.time()
    started_at = iso_now()
    log("CONVERT_START", title)
    ensure_temp_space(p)
    data = ffprobe(p)
    video_stream, audio_stream = get_primary_streams(data)
    audio_streams = get_audio_streams(data)
    profile = get_transcode_profile(data)
    hdr_source = is_hdr_stream(video_stream)
    audio_channels = int(audio_stream.get("channels") or 0) if audio_stream else 0
    total_duration = get_duration_seconds(data)
    width = int(video_stream.get("width") or 0) if video_stream else 0
    height = int(video_stream.get("height") or 0) if video_stream else 0
    video_codec = video_stream.get("codec_name") if video_stream else "unknown"
    pix_fmt = video_stream.get("pix_fmt") if video_stream else None
    bitrate = get_media_bitrate(data, video_stream)
    audio_codec = audio_stream.get("codec_name") if audio_stream else "none"
    log(
        "SOURCE_INFO",
        title,
        f"video={video_codec} {width}x{height} bitrate={bitrate} hdr={hdr_source} audio={audio_codec} ch={audio_channels} duration={format_seconds(total_duration)}"
    )

    video_ok = video_stream_is_supported(video_stream, profile, data)
    target_codec = "hevc" if profile == "4k" else "h264"
    backend = None
    if not video_ok:
        backend, diagnostics = select_backend(target_codec, video_codec, pix_fmt)
        log(
            "VIDEO_BACKEND",
            title,
            f"selected={backend.name} hwdecode={backend.hardware_decode} " + "; ".join(diagnostics),
        )

    cmd = [
        "nice", "-n", NICE,
        "ffmpeg",
        "-loglevel", "error",
        "-nostats",
        "-y",
        *(pre_input_args(backend) if backend else []),
        "-i", str(p),

        "-map", "0:v:0",
        "-map", "0:a?",
        "-map_chapters", "0",
    ]

    if profile == "4k":
        audio_ok = all_audio_streams_supported(data, profile)

        if video_ok:
            cmd.extend([
                "-c:v", "copy",
            ])
        elif backend and backend.hardware:
            cmd.extend(hardware_video_args(backend, quality=22 if hdr_source else 23, hdr_output=hdr_source))
        else:
            crf = "22" if hdr_source else "23"
            color_args = [
                "-color_range", "tv",
            ]
            if hdr_source:
                color_args.extend([
                    "-color_primaries", "bt2020",
                    "-color_trc", "smpte2084",
                    "-colorspace", "bt2020nc",
                ])
            else:
                color_args.extend([
                    "-color_primaries", "bt709",
                    "-color_trc", "bt709",
                    "-colorspace", "bt709",
                ])
            cmd.extend([
                "-c:v", "libx265",
                "-preset", X265_PRESET,
                "-crf", crf,
                "-pix_fmt", "yuv420p10le",
                "-tag:v", "hvc1",
                "-x265-params", X265_PARAMS,
                *color_args,
            ])

        add_audio_codec_args(cmd, audio_streams, profile)
        profile_name = "4K_VIDEO_COPY" if video_ok else "4K_HEVC"
        if not video_ok and backend:
            profile_name += f"_{backend.name.upper()}"
        profile_name += "_HDR" if hdr_source else "_SDR"
        profile_name += "_AUDIO_COPY" if audio_ok else f"_AUDIO_TRANSCODE_{len(audio_streams) or 0}_TRACKS"
        if has_unsupported_subtitles(data):
            profile_name += "_DROP_UNSUPPORTED_SUBS"
        log("CONVERT_PROFILE", title, profile_name)
    else:
        audio_ok = all_audio_streams_supported(data, profile)

        if video_ok:
            cmd.extend(["-c:v", "copy"])
        elif backend and backend.hardware:
            cmd.extend(hardware_video_args(backend, quality=20, hdr_output=False))
        else:
            cmd.extend([
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "20",
                "-profile:v", "high",
                "-level", "4.1",
                "-pix_fmt", "yuv420p",

                "-color_range", "tv",
                "-color_primaries", "bt709",
                "-color_trc", "bt709",
                "-colorspace", "bt709",
            ])

        add_audio_codec_args(cmd, audio_streams, profile)

        profile_name = "STANDARD_VIDEO_COPY" if video_ok else "STANDARD_H264"
        if not video_ok and backend:
            profile_name += f"_{backend.name.upper()}"
        profile_name += "_AUDIO_COPY" if audio_ok else f"_AAC_{len(audio_streams) or 0}_TRACKS"
        if has_unsupported_subtitles(data):
            profile_name += "_DROP_UNSUPPORTED_SUBS"
        log("CONVERT_PROFILE", title, profile_name)

    cmd.extend([
        "-sn",
        "-threads", THREADS,
        "-progress", "pipe:1",
        "-nostats",
        str(tmp)
    ])
    log("FFMPEG_CMD", title, " ".join(shlex.quote(part) for part in cmd))

    write_progress(build_progress_payload(
        title,
        movie,
        filename,
        p,
        out,
        total_duration,
        started_at,
        "starting",
        percent=0.0,
        eta_seconds=None,
        elapsed_seconds=0,
        processed_seconds=0.0,
        processed_display="00:00",
        duration_display=format_seconds(total_duration),
        eta_display="--:--",
        speed="0x",
        fps=0.0,
    ))

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    log("FFMPEG_PID", title, str(proc.pid))

    progress_state = {}
    last_logged_percent = -5
    last_logged_ts = 0.0

    for raw_line in proc.stdout or []:
        line = raw_line.strip()
        if not line:
            continue

        if "=" not in line:
            log("FFMPEG_MSG", title, line)
            continue

        key, value = line.split("=", 1)
        progress_state[key] = value

        if key != "progress":
            continue

        processed_seconds = safe_float(progress_state.get("out_time_ms")) / 1_000_000
        speed = progress_state.get("speed", "0x")
        fps = safe_float(progress_state.get("fps"))
        elapsed_seconds = max(0, int(time.time() - start))

        if total_duration > 0:
            percent = min(100.0, max(0.0, (processed_seconds / total_duration) * 100))
        else:
            percent = 0.0

        numeric_speed = safe_float(speed.rstrip("x"))
        remaining_seconds = max(0.0, total_duration - processed_seconds) if total_duration > 0 else 0.0
        eta_seconds = None
        if numeric_speed > 0 and total_duration > 0:
            eta_seconds = remaining_seconds / numeric_speed

        write_progress(build_progress_payload(
            title,
            movie,
            filename,
            p,
            out,
            total_duration,
            started_at,
            "running" if value == "continue" else "finalizing",
            percent=round(percent, 2),
            eta_seconds=None if eta_seconds is None else int(eta_seconds),
            elapsed_seconds=elapsed_seconds,
            processed_seconds=round(processed_seconds, 2),
            processed_display=format_seconds(processed_seconds),
            duration_display=format_seconds(total_duration),
            eta_display=format_seconds(eta_seconds) if eta_seconds is not None else "--:--",
            speed=speed,
            fps=round(fps, 2),
            ffmpeg_pid=proc.pid,
        ))

        now = time.time()
        if percent >= last_logged_percent + 5 or (now - last_logged_ts) >= 60 or value == "end":
            log(
                "CONVERT_PROGRESS",
                title,
                f"{percent:.1f}% processed={format_seconds(processed_seconds)}/{format_seconds(total_duration)} eta={format_seconds(eta_seconds) if eta_seconds is not None else '--:--'} speed={speed} fps={fps:.2f}"
            )
            last_logged_percent = int(percent // 5) * 5
            last_logged_ts = now

    return_code = proc.wait()
    if return_code != 0:
        log("FFMPEG_EXIT", title, f"returncode={return_code}")
        raise subprocess.CalledProcessError(return_code, cmd)

    if not is_low_cpu_cost(tmp):
        raise RuntimeError(f"converted output failed target profile validation: {tmp}")

    tmp.replace(out)

    if p != out:
        p.unlink()

    duration = int(time.time() - start)
    log("CONVERT_DONE", title, f"{duration}s")

    record_conversion({
        "movie": movie,
        "file": filename,
        "source_path": str(p),
        "path": str(out),
        "output_path": str(out),
        "converted_at": ts()
    }, index_cache)
    clear_progress()



# ---------- main ----------

def main():
    INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
    index_cache = load_index()
    log("SCAN_START", str(ROOT), f"indexed={len(index_cache)} threads={THREADS} nice={NICE}")

    for p in ROOT.rglob("*"):

        if p.suffix.lower() not in VIDEO_EXTS:
            continue

        if is_apple_metadata(p):
            continue

        if media_is_baselined(p):
            log("SKIP_BASELINE", str(p))
            continue

        if is_partial_output(p):
            final_path = get_final_output_path(p)
            if final_path.exists() and not lock_is_active(final_path):
                movie, filename = parse_movie(p)
                log("DELETE_STALE_TEMP", f"{movie} / {filename}", str(p))
                try:
                    p.unlink()
                except Exception as e:
                    log("DELETE_STALE_TEMP_FAILED", f"{movie} / {filename}", str(e))
            else:
                movie, filename = parse_movie(p)
                log("SKIP_TEMP_FILE", f"{movie} / {filename}")
            continue

        if should_skip_existing_output(p, index_cache):
            continue

        try:
            if is_low_cpu_cost(p):
                movie, filename = parse_movie(p)
                if not is_indexed_media(p, index_cache):
                    record_existing_optimal(p, index_cache)
                    log("INDEX_EXISTING_OPTIMAL", f"{movie} / {filename}")
                else:
                    log("SKIP_LOW_CPU_INDEXED", f"{movie} / {filename}")
                continue
        except Exception as e:
            movie, filename = parse_movie(p)
            log("PROFILE_CHECK_ERROR", f"{movie} / {filename}", str(e))

        movie, filename = parse_movie(p)
        title = f"{movie} / {filename}"
        log("SCAN_CANDIDATE", title)
        lock = acquire_file_lock(p)
        if lock is None:
            log("SKIP_LOCKED", title)
            continue

        try:
            log("LOCK_ACQUIRED", title, str(lock))
            extract_subtitles(p)
            convert(p, index_cache)

        except Exception as e:
            clear_progress()
            log("ERROR", f"{movie} / {filename}", str(e))

        finally:
            if lock.exists():
                lock.unlink()
                log("LOCK_RELEASED", title, str(lock))

    clear_progress()
    log("SCAN_DONE", str(ROOT))


if __name__ == "__main__":
    main()
