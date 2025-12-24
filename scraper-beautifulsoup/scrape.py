# scrape.py

import time
import re
import json
import random
import logging
import sys
import requests

from fastapi import FastAPI
from pydantic import BaseModel
from bs4 import BeautifulSoup

# =========================================================
# LOGGING CONFIG
# =========================================================
logging.basicConfig(
    level=logging.INFO,  # change to DEBUG for deep tracing
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

logger = logging.getLogger("amazon-scraper")

# =========================================================
# FASTAPI APP
# =========================================================
app = FastAPI()


# =========================================================
# INPUT MODEL
# =========================================================
class ScrapeProductRequest(BaseModel):
    url: str


# =========================================================
# HTTP SESSION + HEADERS
# =========================================================
session = requests.Session()

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml",
    "Referer": "https://www.amazon.in/",
}


# =========================================================
# HELPERS
# =========================================================
def log_timing(label: str, start: float) -> float:
    elapsed = round(time.time() - start, 3)
    logger.debug(f"{label} took {elapsed}s")
    return elapsed


def clean_price(text: str) -> str | None:
    if not text:
        return None
    text = text.replace(",", "").strip()
    match = re.search(r"\d+(\.\d{1,2})?", text)
    return match.group(0) if match else None


def is_blocked_page(html: str) -> bool:
    blocked_markers = [
        "captcha",
        "Enter the characters you see below",
        "Robot Check",
        "Sorry, we just need to make sure",
    ]

    for marker in blocked_markers:
        if marker.lower() in html.lower():
            logger.warning("Blocked page detected (captcha / bot check)")
            return True

    return False


# =========================================================
# AMAZON SCRAPER
# =========================================================
def extract_amazon_data(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")

    result = {
        "title": None,
        "price": None,
        "image": None,
        "status": "success",
        "error": None,
        "timings": {},
    }

    logger.info("Parsing Amazon product page")

    # ---------------- Title ----------------
    start = time.time()
    title_tag = soup.select_one("#productTitle")
    result["title"] = title_tag.get_text(strip=True) if title_tag else None
    result["timings"]["title"] = log_timing("Title extraction", start)

    if not result["title"]:
        logger.warning("Title not found")

    # ---------------- Price ----------------
    start = time.time()
    price = None

    price_strategies = [
        ("a-offscreen", "span.a-offscreen"),
        ("priceblock_ourprice", "span#priceblock_ourprice"),
        ("priceblock_dealprice", "span#priceblock_dealprice"),
        ("nested_offscreen", "span.a-price > span.a-offscreen"),
    ]

    for name, selector in price_strategies:
        el = soup.select_one(selector)
        if el:
            raw = el.get_text(strip=True)
            logger.debug(f"Price strategy '{name}' found raw='{raw}'")
            candidate = clean_price(raw)
            if candidate:
                price = candidate
                logger.info(f"Price extracted using strategy: {name}")
                break
        else:
            logger.debug(f"Price strategy '{name}' not found")

    # JSON-LD fallback
    if not price:
        logger.info("Trying JSON-LD price fallback")
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string)
                if isinstance(data, dict):
                    offers = data.get("offers", {})
                    price = offers.get("price")
                    if price:
                        logger.info("Price extracted from JSON-LD")
                        break
            except Exception:
                continue

    if not price:
        logger.error("Price not found using any strategy")
        result["status"] = "failure"
        result["error"] = "Price not found"
    else:
        result["price"] = price

    result["timings"]["price"] = log_timing("Price extraction", start)

    # ---------------- Image ----------------
    start = time.time()
    img = soup.select_one("#landingImage")

    if img and img.get("src"):
        result["image"] = img["src"]
        logger.debug("Image extracted from #landingImage")
    else:
        og = soup.find("meta", property="og:image")
        if og:
            result["image"] = og["content"]
            logger.debug("Image extracted from og:image")
        else:
            logger.warning("Image not found")

    result["timings"]["image"] = log_timing("Image extraction", start)

    return result


# =========================================================
# FASTAPI ROUTE
# =========================================================
@app.post("/scrape/product")
def scrape_product(request: ScrapeProductRequest):
    url = request.url
    logger.info(f"Incoming scrape request: {url}")

    if "amazon." not in url:
        logger.warning("Rejected non-Amazon URL")
        return {"status": "failure", "error": "Only Amazon URLs supported"}

    total_start = time.time()

    for attempt in range(2):  # retry once
        logger.info(f"Fetch attempt {attempt + 1}")

        try:
            start = time.time()
            response = session.get(url, headers=HEADERS, timeout=10)
            fetch_time = log_timing("HTTP fetch", start)

            logger.info(f"HTTP status: {response.status_code}")

            if response.status_code != 200:
                logger.warning("Non-200 response, retrying")
                continue

            if is_blocked_page(response.text):
                logger.warning("Blocked page detected, backing off")
                time.sleep(1 + random.random())
                continue

            parsed = extract_amazon_data(response.text)
            parsed["timings"]["fetch"] = fetch_time
            parsed["timings"]["total"] = round(time.time() - total_start, 3)
            parsed["attempt"] = attempt + 1

            logger.info(
                f"Scrape completed: status={parsed['status']} "
                f"price={parsed.get('price')}"
            )

            return parsed

        except Exception:
            logger.exception(f"Unexpected error on attempt {attempt + 1}")

    logger.error("Scraping failed after all retries")

    return {
        "status": "failure",
        "error": "Blocked or unable to scrape after retries",
        "timings": {"total": round(time.time() - total_start, 3)},
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
