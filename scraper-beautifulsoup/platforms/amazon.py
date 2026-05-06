from __future__ import annotations

import json
import re
import time
from urllib.parse import quote_plus, urljoin, urlparse

from bs4 import BeautifulSoup
from requests import Session

from .base import PlatformHandler
from .common import base_result, clean_price, log_timing


PINCODE_REGEX = re.compile(r"^\d{6}$")


def is_valid_indian_pincode(pincode: str) -> bool:
    return bool(PINCODE_REGEX.fullmatch(pincode))


class AmazonHandler(PlatformHandler):
    name = "amazon"
    domains = (
        "amazon.in",
        "www.amazon.in",
        "amazon.com",
        "www.amazon.com",
    )

    def validate_request(self, url: str, pincode: str | None) -> tuple[bool, str | None]:
        if pincode and not is_valid_indian_pincode(pincode):
            return False, "Pincode must be a 6-digit number"
        return True, None

    def request_headers(
        self,
        base_headers: dict[str, str],
        url: str,
        pincode: str | None,
    ) -> dict[str, str]:
        headers = dict(base_headers)
        headers["Referer"] = "https://www.amazon.in/"
        return headers

    def before_fetch(
        self,
        session: Session,
        headers: dict[str, str],
        url: str,
        pincode: str | None,
    ) -> dict:
        if not pincode:
            return {"pincode_applied": False, "pincode_timing": 0.0}

        domain = urlparse(url).netloc.lower()
        if domain not in ("amazon.in", "www.amazon.in"):
            return {"pincode_applied": False, "pincode_timing": 0.0}

        start = time.time()
        applied = self._set_amazon_india_pincode(session, headers, pincode)
        return {"pincode_applied": applied, "pincode_timing": log_timing(start)}

    def _set_amazon_india_pincode(
        self,
        session: Session,
        headers: dict[str, str],
        pincode: str,
    ) -> bool:
        if not is_valid_indian_pincode(pincode):
            return False

        try:
            session.get("https://www.amazon.in/", headers=headers, timeout=10)

            payload = {
                "locationType": "LOCATION_INPUT",
                "zipCode": pincode,
                "storeContext": "generic",
                "deviceType": "web",
                "pageType": "Gateway",
                "actionSource": "glow",
                "almBrandId": "undefined",
            }
            request_headers = {
                **headers,
                "Accept": "application/json,text/javascript,*/*;q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Origin": "https://www.amazon.in",
                "Referer": "https://www.amazon.in/",
                "X-Requested-With": "XMLHttpRequest",
            }

            response = session.post(
                "https://www.amazon.in/gp/delivery/ajax/address-change.html",
                data=payload,
                headers=request_headers,
                timeout=10,
            )
            return response.status_code == 200
        except Exception:
            return False

    def search_products(self, session: Session, headers: dict[str, str], query: str) -> list[dict]:
        search_headers = self.request_headers(headers, "https://www.amazon.in/", None)
        url = f"https://www.amazon.in/s?k={quote_plus(query)}"
        response = session.get(url, headers=search_headers, timeout=12)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "lxml")
        results = []

        for item in soup.select("div.s-main-slot div.s-result-item[data-asin]"):
            asin = (item.get("data-asin") or "").strip()
            if not asin:
                continue

            title_candidates = [
                tag.get_text(" ", strip=True)
                for tag in item.select("a.a-link-normal span, h2 span, [data-cy='title-recipe-title'] span")
            ]
            title_candidates = [
                candidate
                for candidate in title_candidates
                if len(candidate) >= 10 and not candidate.startswith(("₹", "$"))
            ]
            title = max(title_candidates, key=len) if title_candidates else ""
            if not title:
                continue

            link_tag = item.select_one("h2 a[href]") or item.select_one("a.a-link-normal[href]")
            href = link_tag.get("href") if link_tag else ""
            if not href or ("/dp/" not in href and "/gp/product/" not in href):
                continue
            product_url = urljoin("https://www.amazon.in", href.split("?")[0])

            image_tag = item.select_one("img.s-image") or item.select_one("img")
            image_url = ""
            if image_tag:
                image_url = image_tag.get("src") or image_tag.get("data-src") or ""
                if not image_url or image_url.startswith("data:"):
                    srcset = image_tag.get("srcset")
                    if srcset:
                        image_url = srcset.split(",")[0].strip().split(" ")[0]

            price_tag = item.select_one("span.a-price > span.a-offscreen")
            price = clean_price(price_tag.get_text(strip=True)) if price_tag else None
            if not price:
                continue

            results.append(
                {
                    "title": title,
                    "product_url": product_url,
                    "image_url": image_url or "N/A",
                    "price": price,
                    "price_value": float(price),
                }
            )

            if len(results) >= 10:
                break

        return results

    def extract_product_data(self, html: str) -> dict:
        soup = BeautifulSoup(html, "lxml")
        result = base_result()

        start = time.time()
        title_tag = soup.select_one("#productTitle")
        result["title"] = title_tag.get_text(strip=True) if title_tag else None
        result["timings"]["title"] = log_timing(start)

        start = time.time()
        price = None
        price_strategies = [
            "span.a-offscreen",
            "span#priceblock_ourprice",
            "span#priceblock_dealprice",
            "span.a-price > span.a-offscreen",
        ]
        for selector in price_strategies:
            element = soup.select_one(selector)
            if not element:
                continue
            candidate = clean_price(element.get_text(strip=True))
            if candidate:
                price = candidate
                break

        if not price:
            for script in soup.find_all("script", type="application/ld+json"):
                try:
                    data = json.loads(script.string)
                    if isinstance(data, dict):
                        offers = data.get("offers", {})
                        price = offers.get("price")
                        if price:
                            break
                except Exception:
                    continue

        if not price:
            result["status"] = "failure"
            result["error"] = "Price not found"
        else:
            result["price"] = price
        result["timings"]["price"] = log_timing(start)

        start = time.time()
        image = None
        image_tag = soup.select_one("#landingImage")
        if image_tag and image_tag.get("src"):
            image = image_tag.get("src")
        if not image:
            og_image = soup.find("meta", property="og:image")
            if og_image:
                image = og_image.get("content")
        result["image"] = image
        result["timings"]["image"] = log_timing(start)

        return result
