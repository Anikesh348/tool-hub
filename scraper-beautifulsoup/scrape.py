# scrape.py
from __future__ import annotations

import logging
import os
import random
import sys
import time
from typing import Optional

import requests
from fastapi import FastAPI, Query
from pydantic import BaseModel

from platforms import HANDLERS, get_handler_for_url

# =========================================================
# LOGGING CONFIG
# =========================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

logger = logging.getLogger("product-scraper")

# =========================================================
# FASTAPI APP
# =========================================================
app = FastAPI()


# =========================================================
# INPUT MODEL
# =========================================================
DEFAULT_AMAZON_PINCODE = os.getenv("AMAZON_PINCODE", "560048")


class ScrapeProductRequest(BaseModel):
    url: str
    pincode: Optional[str] = DEFAULT_AMAZON_PINCODE


# =========================================================
# HTTP SESSION + HEADERS
# =========================================================
session = requests.Session()

BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml",
}


# =========================================================
# HELPERS
# =========================================================
def log_timing(label: str, start: float) -> float:
    elapsed = round(time.time() - start, 3)
    logger.debug("%s took %ss", label, elapsed)
    return elapsed


def is_blocked_page(html: str) -> bool:
    if len(html) > 10000:
        return False

    blocked_markers = [
        "Enter the characters you see below",
        "Robot Check",
        "Sorry, we just need to make sure",
        "Access denied",
        "request could not be satisfied",
    ]

    html_lower = html.lower()
    for marker in blocked_markers:
        if marker.lower() in html_lower:
            logger.warning("Blocked page detected (captcha / bot check)")
            return True
    return False


def supported_platform_names() -> list[str]:
    return sorted({handler.name for handler in HANDLERS})


def get_handler_for_platform(platform: str):
    normalized = (platform or "").strip().lower()
    for handler in HANDLERS:
        if handler.name == normalized:
            return handler
    return None


# =========================================================
# FASTAPI ROUTE
# =========================================================
@app.post("/scrape/product")
def scrape_product(request: ScrapeProductRequest):
    url = request.url
    pincode = request.pincode
    logger.info("Incoming scrape request: %s", url)

    handler, domain = get_handler_for_url(url)
    if not handler:
        logger.warning("Rejected unsupported domain: %s", domain)
        return {
            "status": "failure",
            "error": (
                f"Unsupported domain: {domain}. "
                f"Supported platforms: {', '.join(supported_platform_names())}"
            ),
        }

    valid, validation_error = handler.validate_request(url, pincode)
    if not valid:
        logger.warning("Rejected invalid request for %s: %s", handler.name, validation_error)
        return {"status": "failure", "error": validation_error}

    total_start = time.time()
    pincode_timing = 0.0
    pincode_applied = False
    request_headers = handler.request_headers(BASE_HEADERS, url, pincode)

    try:
        pre_fetch = handler.before_fetch(session, request_headers, url, pincode)
        pincode_timing = float(pre_fetch.get("pincode_timing", 0.0))
        pincode_applied = bool(pre_fetch.get("pincode_applied", False))
    except Exception:
        logger.exception("Pre-fetch setup failed for platform: %s", handler.name)

    last_error = "Blocked or unable to scrape after retries"
    fetch_urls = handler.fetch_urls(url)

    for fetch_url in fetch_urls:
        for attempt in range(2):  # retry once per URL variant
            logger.info(
                "Fetch attempt %s for platform=%s url=%s",
                attempt + 1,
                handler.name,
                fetch_url,
            )

            try:
                if handler.name == "flipkart":
                    session.cookies.clear()

                start = time.time()
                response = session.get(fetch_url, headers=request_headers, timeout=10)
                fetch_time = log_timing("HTTP fetch", start)

                logger.info("HTTP status: %s", response.status_code)
                if response.status_code != 200:
                    last_error = f"Non-200 response from scraper target: {response.status_code}"
                    if response.status_code in (403, 429, 503):
                        time.sleep(0.75 + random.random())
                    logger.warning("Non-200 response, retrying")
                    continue

                if is_blocked_page(response.text):
                    last_error = "Blocked page detected by target site"
                    logger.warning("Blocked page detected, backing off")
                    time.sleep(0.75 + random.random())
                    continue

                parsed = handler.extract_product_data(response.text)
                if parsed.get("status") == "failure":
                    last_error = parsed.get("error") or "Unable to parse product data"
                    logger.warning("Parse failed for url=%s: %s", fetch_url, last_error)
                    continue

                parsed.setdefault("timings", {})
                parsed["timings"]["fetch"] = fetch_time
                parsed["timings"]["pincode"] = pincode_timing
                parsed["timings"]["total"] = round(time.time() - total_start, 3)
                parsed["attempt"] = attempt + 1
                parsed["platform"] = handler.name
                parsed["domain"] = domain
                parsed["requested_url"] = url
                parsed["fetched_url"] = response.url or fetch_url
                parsed["pincode"] = pincode
                parsed["pincode_applied"] = pincode_applied

                logger.info(
                    "Scrape completed: platform=%s status=%s price=%s",
                    handler.name,
                    parsed.get("status"),
                    parsed.get("price"),
                )
                return parsed
            except Exception:
                logger.exception("Unexpected error on attempt %s", attempt + 1)

    logger.error("Scraping failed after all retries for platform=%s", handler.name)
    return {
        "status": "failure",
        "error": last_error,
        "timings": {
            "pincode": pincode_timing,
            "total": round(time.time() - total_start, 3),
        },
        "platform": handler.name,
        "domain": domain,
        "pincode": pincode,
        "pincode_applied": pincode_applied,
    }


@app.get("/search")
@app.get("/v2/search")
def search_products(query: str = Query(..., min_length=1), platform: str = Query(...)):
    handler = get_handler_for_platform(platform)
    if not handler:
        return {
            "error": (
                f"Unsupported platform: {platform}. "
                f"Supported platforms: {', '.join(supported_platform_names())}"
            ),
            "results": [],
        }

    normalized_query = query.strip()
    search_start = time.time()
    logger.info("Incoming search request: platform=%s query=%s", handler.name, normalized_query)

    try:
        request_headers = handler.request_headers(BASE_HEADERS, f"https://www.{handler.name}.com/", None)
        results = handler.search_products(session, request_headers, normalized_query)
        return {
            "platform": handler.name,
            "query": normalized_query,
            "results": results,
            "time_taken": round(time.time() - search_start, 2),
        }
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        logger.warning("Search upstream request failed: platform=%s status=%s", handler.name, status_code)
        return {
            "platform": handler.name,
            "query": normalized_query,
            "results": [],
            "error": f"Search upstream returned {status_code or 'an error'}",
            "time_taken": round(time.time() - search_start, 2),
        }
    except Exception as exc:
        logger.exception("Search failed: platform=%s", handler.name)
        return {
            "platform": handler.name,
            "query": normalized_query,
            "results": [],
            "error": str(exc),
            "time_taken": round(time.time() - search_start, 2),
        }


# =========================================================
# LOCAL RUN
# =========================================================
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "scrape:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
