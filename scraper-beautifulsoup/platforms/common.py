from __future__ import annotations

import re
import time


def clean_price(text: str) -> str | None:
    if not text:
        return None
    cleaned = text.replace(",", "").strip()
    match = re.search(r"\d+(\.\d{1,2})?", cleaned)
    return match.group(0) if match else None


def log_timing(start: float) -> float:
    return round(time.time() - start, 3)


def base_result() -> dict:
    return {
        "title": None,
        "price": None,
        "image": None,
        "status": "success",
        "error": None,
        "timings": {},
    }
