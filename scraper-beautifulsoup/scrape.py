# scrape.py
from fastapi import FastAPI
from pydantic import BaseModel
from bs4 import BeautifulSoup
import requests
import re
import time

app = FastAPI()


# -------------------------------
# INPUT MODEL
# -------------------------------
class ScrapeProductRequest(BaseModel):
    url: str


# -------------------------------
# CONSTANTS
# -------------------------------
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


# -------------------------------
# AMAZON SCRAPER USING BS4
# -------------------------------
def extract_amazon_data(html: str):
    soup = BeautifulSoup(html, "lxml")

    result = {
        "title": None,
        "price": None,
        "image": None,
        "error": None,
        "status": "success",
        "timings": {},
    }

    # ---- Extract Title ----
    start = time.time()
    title_tag = soup.select_one("#productTitle")
    result["title"] = title_tag.get_text(strip=True) if title_tag else "N/A"
    result["timings"]["title"] = round(time.time() - start, 2)

    # ---- Extract Price ----
    start = time.time()
    price_whole_tag = soup.select_one("span.a-price-whole")
    price_fraction_tag = soup.select_one("span.a-price-fraction")

    if price_whole_tag:
        whole_raw = price_whole_tag.get_text(strip=True)

        # Clean whole part → remove commas, dots, spaces, and any non-digits
        whole = whole_raw.replace(",", "").replace(".", "")
        whole = re.sub(r"\D", "", whole)

        # Fraction
        fraction_raw = price_fraction_tag.get_text(strip=True) if price_fraction_tag else "00"
        fraction = re.sub(r"\D", "", fraction_raw)

        # Final price
        result["price"] = f"{whole}.{fraction}"
    else:
        result["price"] = None
        result["error"] = "Price not found"
        result["status"] = "failure"
    result["timings"]["price"] = round(time.time() - start, 2)

    # ---- Extract Image ----
    start = time.time()
    img = soup.select_one("#landingImage")

    if img and img.get("src"):
        result["image"] = img["src"]
    else:
        # Fallback
        meta_img = soup.find("meta", property="og:image")
        result["image"] = meta_img["content"] if meta_img else None

    result["timings"]["image"] = round(time.time() - start, 2)

    return result


# -------------------------------
# FASTAPI ROUTE
# -------------------------------
@app.post("/scrape/product")
def scrape_product(request: ScrapeProductRequest):
    url = request.url

    if "amazon." not in url:
        return {"error": "Only Amazon URLs are supported"}

    result = {"timings": {}}
    total_start = time.time()

    # ---- Fetch HTML ----
    start = time.time()
    response = requests.get(url, headers=HEADERS)
    result["timings"]["fetch"] = round(time.time() - start, 2)

    if response.status_code != 200:
        return {
            "error": f"Failed to fetch page ({response.status_code})",
            "status": "failure",
        }

    # ---- Parse Product ----
    parsed = extract_amazon_data(response.text)
    result.update(parsed)

    result["timings"]["total"] = round(time.time() - total_start, 2)

    return result


# -------------------------------
# LOCAL RUN
# -------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("scrape:app", host="0.0.0.0", port=8000, reload=True)
