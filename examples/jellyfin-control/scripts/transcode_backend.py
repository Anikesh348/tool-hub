#!/usr/bin/env python3
"""Hardware-aware FFmpeg command helpers for the Jellyfin optimizer.

The default ``auto`` mode prefers Intel QSV, then VA-API, and finally software.
Selection includes a one-frame encoder smoke test so a visible /dev/dri device or
an FFmpeg encoder name alone can never enable a broken hardware path.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


DRI_DEVICE = os.environ.get("JELLYFIN_DRI_DEVICE", "/dev/dri/renderD128")
BACKEND_REQUEST = os.environ.get("JELLYFIN_VIDEO_BACKEND", "auto").strip().lower()
HW_DECODE = os.environ.get("JELLYFIN_HW_DECODE", "1").strip().lower() not in {
    "0", "false", "no", "off"
}
HW_REQUIRED = os.environ.get("JELLYFIN_HW_REQUIRED", "0").strip().lower() in {
    "1", "true", "yes", "on"
}
HW_PRESET = os.environ.get("JELLYFIN_HW_PRESET", "slow")
QSV_ASYNC_DEPTH = os.environ.get("JELLYFIN_QSV_ASYNC_DEPTH", "4")
HW_VENDOR = os.environ.get("JELLYFIN_HW_VENDOR", "intel").strip().lower()

SUPPORTED_BACKENDS = {"auto", "software", "qsv", "vaapi"}
SUPPORTED_TARGETS = {"h264", "hevc"}
BASELINE_STATE_FILE = Path(
    os.environ.get(
        "JELLYFIN_BASELINE_STATE",
        "/srv/jellyfin-control/scripts/logs/transcode-preflight-state.json",
    )
)


@dataclass(frozen=True)
class Backend:
    name: str
    target_codec: str
    hardware_decode: bool = False

    @property
    def hardware(self) -> bool:
        return self.name in {"qsv", "vaapi"}


@lru_cache(maxsize=1)
def _baseline_files() -> dict:
    """Load the immutable-at-process-start library baseline used by optimizers."""
    try:
        with BASELINE_STATE_FILE.open() as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        return {}

    if not isinstance(payload, dict) or not payload.get("bootstrapped"):
        return {}
    files = payload.get("files")
    return files if isinstance(files, dict) else {}


def media_is_baselined(path: Path) -> bool:
    """Return True for any path preserved in the immutable cutover baseline."""
    entry = _baseline_files().get(str(path))
    if not isinstance(entry, dict) or entry.get("status") != "ok":
        return False
    try:
        stat = path.stat()
    except OSError:
        return False
    if entry.get("cutover") is True:
        return True
    return (
        entry.get("size") == stat.st_size
        and entry.get("mtime_ns") == stat.st_mtime_ns
    )


def _run(command: list[str], timeout: int = 20) -> subprocess.CompletedProcess:
    return subprocess.run(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )


@lru_cache(maxsize=1)
def ffmpeg_encoders() -> str:
    if not shutil.which("ffmpeg"):
        return ""
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-encoders"],
        capture_output=True,
        text=True,
        check=False,
    )
    return f"{result.stdout}\n{result.stderr}"


def _encoder_name(backend: str, target_codec: str) -> str:
    codec = "hevc" if target_codec == "hevc" else "h264"
    return f"{codec}_{backend}"


def _encoder_advertised(backend: str, target_codec: str) -> bool:
    return _encoder_name(backend, target_codec) in ffmpeg_encoders()


def drm_vendor() -> str | None:
    render_node = Path(DRI_DEVICE).name
    vendor_file = Path("/sys/class/drm") / render_node / "device/vendor"
    try:
        return vendor_file.read_text().strip().lower()
    except OSError:
        return None


@lru_cache(maxsize=8)
def _smoke_test(backend: str, target_codec: str) -> tuple[bool, str]:
    if not Path(DRI_DEVICE).exists():
        return False, f"DRI device missing: {DRI_DEVICE}"
    vendor = drm_vendor()
    if HW_VENDOR == "intel" and vendor != "0x8086":
        return False, f"DRI vendor is {vendor or 'unknown'}, not Intel 0x8086"
    if not _encoder_advertised(backend, target_codec):
        return False, f"FFmpeg encoder missing: {_encoder_name(backend, target_codec)}"

    pixel_format = "p010le" if target_codec == "hevc" else "nv12"
    encoder = _encoder_name(backend, target_codec)

    if backend == "qsv":
        init = [
            "-init_hw_device", f"vaapi=va:{DRI_DEVICE}",
            "-init_hw_device", "qsv=qs@va",
            "-filter_hw_device", "qs",
        ]
    else:
        init = [
            "-init_hw_device", f"vaapi=va:{DRI_DEVICE}",
            "-filter_hw_device", "va",
        ]

    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        *init,
        "-f", "lavfi", "-i", "color=size=64x64:rate=1:duration=1",
        "-vf", f"format={pixel_format},hwupload=extra_hw_frames=16",
        "-frames:v", "1", "-an", "-c:v", encoder,
    ]
    if target_codec == "hevc":
        command.extend(["-profile:v", "main10"])
    command.extend(["-f", "null", "-"])

    try:
        result = _run(command)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)
    if result.returncode == 0:
        return True, "one-frame encode succeeded"
    reason = (result.stderr or "hardware smoke test failed").strip().splitlines()
    return False, reason[-1] if reason else "hardware smoke test failed"


def source_supports_hardware_decode(codec: str | None, pixel_format: str | None) -> bool:
    if codec == "h264":
        return pixel_format in {"yuv420p", "nv12"}
    if codec == "hevc":
        return pixel_format in {"yuv420p", "nv12", "yuv420p10le", "p010le"}
    return False


def select_backend(
    target_codec: str,
    source_codec: str | None = None,
    source_pixel_format: str | None = None,
) -> tuple[Backend, list[str]]:
    """Return a usable backend and human-readable selection diagnostics."""
    if target_codec not in SUPPORTED_TARGETS:
        raise ValueError(f"unsupported target codec: {target_codec}")
    if BACKEND_REQUEST not in SUPPORTED_BACKENDS:
        raise ValueError(
            f"JELLYFIN_VIDEO_BACKEND must be one of {sorted(SUPPORTED_BACKENDS)}; "
            f"got {BACKEND_REQUEST!r}"
        )

    diagnostics: list[str] = []
    candidates = (
        ["qsv", "vaapi"] if BACKEND_REQUEST == "auto"
        else [] if BACKEND_REQUEST == "software"
        else [BACKEND_REQUEST]
    )
    for candidate in candidates:
        usable, reason = _smoke_test(candidate, target_codec)
        diagnostics.append(f"{candidate}:{target_codec}: {reason}")
        if usable:
            use_hw_decode = HW_DECODE and source_supports_hardware_decode(
                source_codec, source_pixel_format
            )
            return Backend(candidate, target_codec, use_hw_decode), diagnostics

    if HW_REQUIRED and BACKEND_REQUEST != "software":
        raise RuntimeError("hardware backend required but unavailable: " + "; ".join(diagnostics))
    diagnostics.append(f"software:{target_codec}: selected fallback")
    return Backend("software", target_codec, False), diagnostics


def pre_input_args(backend: Backend) -> list[str]:
    if backend.name == "qsv":
        args = [
            "-init_hw_device", f"vaapi=va:{DRI_DEVICE}",
            "-init_hw_device", "qsv=qs@va",
            "-filter_hw_device", "qs",
        ]
        if backend.hardware_decode:
            args.extend([
                "-hwaccel", "qsv",
                "-hwaccel_device", "qs",
                "-hwaccel_output_format", "qsv",
            ])
        return args
    if backend.name == "vaapi":
        args = [
            "-init_hw_device", f"vaapi=va:{DRI_DEVICE}",
            "-filter_hw_device", "va",
        ]
        if backend.hardware_decode:
            args.extend([
                "-hwaccel", "vaapi",
                "-hwaccel_device", "va",
                "-hwaccel_output_format", "vaapi",
            ])
        return args
    return []


def hardware_video_args(
    backend: Backend,
    quality: int,
    hdr_output: bool = False,
) -> list[str]:
    """Build encoder/filter arguments for an already-selected hardware backend."""
    if not backend.hardware:
        raise ValueError("hardware_video_args requires qsv or vaapi")

    upload_format = "p010le" if backend.target_codec == "hevc" else "nv12"
    hardware_format = "p010" if backend.target_codec == "hevc" else "nv12"
    encoder = _encoder_name(backend.name, backend.target_codec)
    if backend.hardware_decode:
        filter_name = "vpp_qsv" if backend.name == "qsv" else "scale_vaapi"
        video_filter = f"{filter_name}=format={hardware_format}"
    else:
        video_filter = f"format={upload_format},hwupload=extra_hw_frames=64"

    args = ["-vf", video_filter, "-c:v", encoder]
    if backend.name == "qsv":
        args.extend([
            "-preset", HW_PRESET,
            "-global_quality", str(quality),
            "-async_depth", QSV_ASYNC_DEPTH,
        ])
    else:
        args.extend([
            "-rc_mode", "ICQ",
            "-global_quality", str(quality),
            "-compression_level", "2",
        ])

    if backend.target_codec == "h264":
        args.extend(["-profile:v", "high", "-level:v", "4.1"])
    else:
        args.extend(["-profile:v", "main10", "-tag:v", "hvc1"])

    if hdr_output:
        args.extend([
            "-color_range", "tv",
            "-color_primaries", "bt2020",
            "-color_trc", "smpte2084",
            "-colorspace", "bt2020nc",
        ])
    else:
        args.extend([
            "-color_range", "tv",
            "-color_primaries", "bt709",
            "-color_trc", "bt709",
            "-colorspace", "bt709",
        ])
    return args


def diagnostic_payload() -> dict:
    payload = {
        "requested_backend": BACKEND_REQUEST,
        "dri_device": DRI_DEVICE,
        "dri_exists": Path(DRI_DEVICE).exists(),
        "dri_vendor": drm_vendor(),
        "required_vendor": HW_VENDOR,
        "hardware_decode_enabled": HW_DECODE,
        "targets": {},
    }
    for codec in sorted(SUPPORTED_TARGETS):
        backend, messages = select_backend(codec, "h264", "yuv420p")
        payload["targets"][codec] = {
            "selected": backend.name,
            "hardware_decode": backend.hardware_decode,
            "diagnostics": messages,
        }
    return payload


if __name__ == "__main__":
    json.dump(diagnostic_payload(), sys.stdout, indent=2)
    sys.stdout.write("\n")
