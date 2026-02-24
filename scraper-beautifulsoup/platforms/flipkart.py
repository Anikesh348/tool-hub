from __future__ import annotations

import json
import time
from typing import Any

from bs4 import BeautifulSoup
from requests import Session

from .base import PlatformHandler
from .common import base_result, clean_price, log_timing


class FlipkartHandler(PlatformHandler):
    name = "flipkart"
    domains = (
        "flipkart.com",
        "www.flipkart.com",
        "m.flipkart.com",
        "dl.flipkart.com",
    )

    def request_headers(
        self,
        base_headers: dict[str, str],
        url: str,
        pincode: str | None,
    ) -> dict[str, str]:
        headers = dict(base_headers)
        headers.update(
            {
                "Referer": "https://www.flipkart.com/",
                "Origin": "https://www.flipkart.com",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "DNT": "1",
            }
        )
        return headers

    def before_fetch(
        self,
        session: Session,
        headers: dict[str, str],
        url: str,
        pincode: str | None,
    ) -> dict:
        try:
            # Warm up cookies before fetching the product page.
            session.get("https://www.flipkart.com/", headers=headers, timeout=10)
        except Exception:
            pass
        return {"pincode_applied": False, "pincode_timing": 0.0}

    def _extract_first_srcset_url(self, srcset: str | None) -> str | None:
        if not srcset:
            return None
        first_entry = srcset.split(",")[0].strip()
        if not first_entry:
            return None
        return first_entry.split(" ")[0].strip()

    def _json_ld_nodes(self, data: Any) -> list[dict]:
        nodes: list[dict] = []
        if isinstance(data, dict):
            nodes.append(data)
            graph = data.get("@graph")
            if isinstance(graph, list):
                for item in graph:
                    nodes.extend(self._json_ld_nodes(item))
            elif isinstance(graph, dict):
                nodes.extend(self._json_ld_nodes(graph))
        elif isinstance(data, list):
            for item in data:
                nodes.extend(self._json_ld_nodes(item))
        return nodes

    def _extract_structured_data(self, soup: BeautifulSoup) -> tuple[str | None, str | None, str | None]:
        title = None
        price = None
        image = None

        for script in soup.find_all("script", type="application/ld+json"):
            raw = script.string or script.get_text(strip=True)
            if not raw:
                continue

            try:
                payload = json.loads(raw)
            except Exception:
                continue

            for node in self._json_ld_nodes(payload):
                node_type = node.get("@type")
                is_product = False
                if isinstance(node_type, str):
                    is_product = node_type.lower() == "product"
                elif isinstance(node_type, list):
                    is_product = any(str(item).lower() == "product" for item in node_type)

                if not is_product:
                    continue

                if not title and isinstance(node.get("name"), str):
                    title = node.get("name").strip()

                if not image:
                    image_value = node.get("image")
                    if isinstance(image_value, str):
                        image = image_value.strip()
                    elif isinstance(image_value, list) and image_value:
                        first_image = image_value[0]
                        if isinstance(first_image, str):
                            image = first_image.strip()
                        elif isinstance(first_image, dict) and isinstance(first_image.get("url"), str):
                            image = first_image.get("url").strip()
                    elif isinstance(image_value, dict) and isinstance(image_value.get("url"), str):
                        image = image_value.get("url").strip()

                if not price:
                    offers = node.get("offers")
                    if isinstance(offers, list) and offers:
                        offers = offers[0]
                    if isinstance(offers, dict):
                        raw_price = offers.get("price") or offers.get("lowPrice")
                        if raw_price is not None:
                            candidate = clean_price(str(raw_price))
                            if candidate:
                                price = candidate

        return title, price, image

    def _extract_meta_content(self, soup: BeautifulSoup, key: str) -> str | None:
        tag = soup.find("meta", attrs={"property": key}) or soup.find("meta", attrs={"name": key})
        if not tag:
            return None
        content = tag.get("content")
        return content.strip() if isinstance(content, str) else None

    def extract_product_data(self, html: str) -> dict:
        soup = BeautifulSoup(html, "lxml")
        result = base_result()
        structured_title, structured_price, structured_image = self._extract_structured_data(soup)

        start = time.time()
        title = structured_title
        if not title:
            title_selectors = [
                "h1._6EBuvT",
                "span.B_NuCI",
                "span.VU-ZEz",
                "h1",
            ]
            for selector in title_selectors:
                title_tag = soup.select_one(selector)
                if not title_tag:
                    continue
                text = title_tag.get_text(strip=True)
                if text:
                    title = text
                    break

        if not title:
            og_title = self._extract_meta_content(soup, "og:title")
            if og_title:
                title = og_title.split("|")[0].strip()

        result["title"] = title
        result["timings"]["title"] = log_timing(start)

        start = time.time()
        price = structured_price
        if not price:
            meta_price = self._extract_meta_content(soup, "product:price:amount")
            if meta_price:
                price = clean_price(meta_price)

        if not price:
            price_selectors = [
                "div.CxhGGd",
                "div._30jeq3",
                "div.Nx9bqj",
                "[data-testid='price-current']",
                "div[class*='Nx9bqj']",
                "div[class*='_30jeq3']",
            ]
            for selector in price_selectors:
                price_tag = soup.select_one(selector)
                if not price_tag:
                    continue
                candidate = clean_price(price_tag.get_text(strip=True).replace("₹", ""))
                if candidate:
                    price = candidate
                    break

        if not price:
            itemprop_price = soup.select_one("[itemprop='price']")
            raw = itemprop_price.get("content") if itemprop_price else None
            candidate = clean_price(str(raw)) if raw else None
            if candidate:
                price = candidate

        if not price:
            result["status"] = "failure"
            result["error"] = "Price not found"
        else:
            result["price"] = price
        result["timings"]["price"] = log_timing(start)

        start = time.time()
        image = structured_image
        if not image:
            og_image = self._extract_meta_content(soup, "og:image")
            if og_image:
                image = og_image

        if not image:
            image_selectors = [
                "img.jLEJ7H",
                "img._53J4C-",
                "img.DByuf4",
                "img[loading='eager']",
            ]
            for selector in image_selectors:
                image_tag = soup.select_one(selector)
                if not image_tag:
                    continue
                src = image_tag.get("src")
                srcset = image_tag.get("srcset")
                image = src if isinstance(src, str) and src.strip() else self._extract_first_srcset_url(srcset)
                if image:
                    image = image.strip()
                    break

        result["image"] = image
        result["timings"]["image"] = log_timing(start)

        return result
