#!/usr/bin/env python3

import importlib.util
import json
import sys
from pathlib import Path

SCRIPTS_DIR = Path("/srv/jellyfin-control/scripts")
STATE_FILE = SCRIPTS_DIR / "logs" / "transcode-preflight-state.json"

OPTIMIZERS = [
    ("shows", SCRIPTS_DIR / "jellyfin-optimize-shows.py"),
    ("movies", SCRIPTS_DIR / "jellyfin-optimize-movies.py"),
    ("uhdmovies", SCRIPTS_DIR / "jellyfin-optimize-uhdmovies.py"),
]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(f"jellyfin_preflight_{name}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import optimizer module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_state():
    try:
        with STATE_FILE.open() as fh:
            payload = json.load(fh)
    except FileNotFoundError:
        return {"version": 1, "files": {}, "bootstrapped": False}
    except Exception as exc:
        print(f"PRECHECK_STATE_RESET | failed to read cache: {exc}")
        return {"version": 1, "files": {}, "bootstrapped": False}

    if not isinstance(payload, dict):
        return {"version": 1, "files": {}, "bootstrapped": False}
    if not isinstance(payload.get("files"), dict):
        payload["files"] = {}
    payload["version"] = 1
    payload["bootstrapped"] = bool(payload.get("bootstrapped"))
    return payload


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    with tmp.open("w") as fh:
        json.dump(state, fh, separators=(",", ":"))
    tmp.replace(STATE_FILE)


def fingerprint(path):
    stat = path.stat()
    return {
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }


def same_fingerprint(entry, current):
    return (
        isinstance(entry, dict)
        and entry.get("size") == current["size"]
        and entry.get("mtime_ns") == current["mtime_ns"]
        and entry.get("status") == "ok"
    )


def is_cutover_baseline(entry):
    return (
        isinstance(entry, dict)
        and entry.get("status") == "ok"
        and entry.get("cutover") is True
    )


def mark_ok(state, path, current, cutover=False):
    entry = {
        "size": current["size"],
        "mtime_ns": current["mtime_ns"],
        "status": "ok",
    }
    if cutover:
        entry["cutover"] = True
    state["files"][str(path)] = entry


def path_is_indexed(module, path, index_cache):
    if hasattr(module, "is_indexed_media"):
        return module.is_indexed_media(path, index_cache)

    final_output = module.get_final_output_path(path)
    return str(path) in index_cache or str(final_output) in index_cache


def is_active_partial(module, path):
    partial_output = module.get_partial_output_path(path)
    return partial_output != path and partial_output.exists() and module.lock_is_active(path)


def existing_output_is_ok(module, path):
    final_output = module.get_final_output_path(path)
    if final_output == path or not final_output.exists():
        return False
    return module.is_low_cpu_cost(final_output)


def media_needs_work(module, path, index_cache, state):
    current = fingerprint(path)
    cached = state["files"].get(str(path))
    if is_cutover_baseline(cached):
        return False
    if same_fingerprint(cached, current):
        return False

    if is_active_partial(module, path):
        mark_ok(state, path, current)
        return False

    if path_is_indexed(module, path, index_cache):
        try:
            if module.is_low_cpu_cost(path):
                mark_ok(state, path, current)
                return False
        except Exception as exc:
            print(f"PRECHECK_RECHECK_INDEX_FAILED | {path} | {exc}")
        return True

    try:
        if existing_output_is_ok(module, path):
            mark_ok(state, path, current)
            return False
    except Exception as exc:
        print(f"PRECHECK_RECHECK_OUTPUT_FAILED | {path} | {exc}")
        return True

    try:
        if module.is_low_cpu_cost(path):
            mark_ok(state, path, current)
            return False
    except Exception as exc:
        print(f"PRECHECK_PROFILE_ERROR | {path} | {exc}")

    return True


def iter_media_files(module):
    for path in module.ROOT.rglob("*"):
        if path.suffix.lower() not in module.VIDEO_EXTS:
            continue
        if module.is_apple_metadata(path):
            continue
        if module.is_partial_output(path):
            continue
        yield path


def iter_partial_files(module):
    for path in module.ROOT.rglob("*"):
        if path.suffix.lower() not in module.VIDEO_EXTS:
            continue
        if module.is_apple_metadata(path):
            continue
        if module.is_partial_output(path):
            yield path


def main():
    force_bootstrap = "--bootstrap-current" in sys.argv[1:]
    state = (
        {"version": 1, "files": {}, "bootstrapped": False}
        if force_bootstrap
        else load_state()
    )
    seen = set()
    bootstrap = not state.get("bootstrapped")

    if force_bootstrap:
        print("PRECHECK_FORCED_BOOTSTRAP | recording current library without conversion")

    for name, optimizer_path in OPTIMIZERS:
        module = load_module(name, optimizer_path)
        index_cache = module.load_index()
        checked = 0
        cached = 0

        # Preserve partial files that already existed at cutover. They are data,
        # not work candidates, and must never be auto-deleted by a later scan.
        for path in iter_partial_files(module):
            key = str(path)
            if bootstrap:
                seen.add(key)
                mark_ok(state, path, fingerprint(path), cutover=True)
                cached += 1
            elif key in state["files"]:
                seen.add(key)

        for path in iter_media_files(module):
            key = str(path)
            seen.add(key)
            current = fingerprint(path)

            if bootstrap:
                mark_ok(state, path, current, cutover=True)
                cached += 1
                continue

            if is_cutover_baseline(state["files"].get(key)):
                cached += 1
                continue

            if same_fingerprint(state["files"].get(key), current):
                cached += 1
                continue

            checked += 1
            if media_needs_work(module, path, index_cache, state):
                print(f"PRECHECK_WORK_FOUND | {name} | {path}")
                save_state(state)
                return 0

        print(f"PRECHECK_LIBRARY_OK | {name} | checked={checked} cached={cached}")

    stale_keys = [key for key in state["files"] if key not in seen]
    for key in stale_keys:
        state["files"].pop(key, None)

    if bootstrap:
        state["bootstrapped"] = True
        print("PRECHECK_BOOTSTRAP_CLEAN | current library recorded as baseline")

    save_state(state)
    print("PRECHECK_NO_WORK")
    return 1


if __name__ == "__main__":
    sys.exit(main())
