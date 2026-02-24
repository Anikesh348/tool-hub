from __future__ import annotations

import json
import re
import time
from urllib.parse import urlparse

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
