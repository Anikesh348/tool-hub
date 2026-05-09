from __future__ import annotations

import json
import re
import time
from typing import Any
from urllib.parse import quote_plus, urljoin

from bs4 import BeautifulSoup
from requests import Session

from .base import PlatformHandler
from .common import base_result, clean_price, log_timing


def _text(value: Any) -> str:
    return str(value or "").strip()


class GenericEcommerceHandler(PlatformHandler):
    search_path = "/search?q={query}"
    search_link_contains: tuple[str, ...] = ("/p/",)
    title_selectors: tuple[str, ...] = (
        "h1",
        "[data-testid*='title' i]",
        "[class*='title' i]",
        "[class*='name' i]",
    )
    price_selectors: tuple[str, ...] = (
        "[data-testid*='price' i]",
        "[class*='price' i]",
        "[id*='price' i]",
        "meta[property='product:price:amount']",
    )
    image_selectors: tuple[str, ...] = (
        "meta[property='og:image']",
        "img[src*='product']",
        "img[src*='image']",
        "img",
    )

    def __init__(
        self,
        name: str,
        domains: tuple[str, ...],
        *,
        search_path: str | None = None,
        search_link_contains: tuple[str, ...] | None = None,
        title_selectors: tuple[str, ...] | None = None,
        price_selectors: tuple[str, ...] | None = None,
        image_selectors: tuple[str, ...] | None = None,
    ) -> None:
        self.name = name
        self.domains = domains
        self.primary_domain = next((domain for domain in domains if not domain.startswith("www.")), domains[0])
        if search_path:
            self.search_path = search_path
        if search_link_contains:
            self.search_link_contains = search_link_contains
        if title_selectors:
            self.title_selectors = title_selectors + self.title_selectors
        if price_selectors:
            self.price_selectors = price_selectors + self.price_selectors
        if image_selectors:
            self.image_selectors = image_selectors + self.image_selectors

    def request_headers(
        self,
        base_headers: dict[str, str],
        url: str,
        pincode: str | None,
    ) -> dict[str, str]:
        headers = dict(base_headers)
        headers.update(
            {
                "Referer": f"https://www.{self.primary_domain}/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "DNT": "1",
                "Upgrade-Insecure-Requests": "1",
            }
        )
        return headers

    def _json_ld_nodes(self, data: Any) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        if isinstance(data, dict):
            nodes.append(data)
            graph = data.get("@graph")
            if isinstance(graph, (list, dict)):
                nodes.extend(self._json_ld_nodes(graph))
        elif isinstance(data, list):
            for item in data:
                nodes.extend(self._json_ld_nodes(item))
        return nodes

    def _extract_price_from_offer(self, offers: Any) -> str | None:
        if isinstance(offers, list) and offers:
            offers = offers[0]
        if not isinstance(offers, dict):
            return None
        for key in ("price", "lowPrice", "highPrice", "salePrice", "offerPrice"):
            value = offers.get(key)
            if value is not None:
                price = clean_price(str(value))
                if price:
                    return price
        return None

    def _extract_image_value(self, value: Any) -> str | None:
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, list) and value:
            return self._extract_image_value(value[0])
        if isinstance(value, dict):
            return self._extract_image_value(value.get("url") or value.get("src"))
        return None

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
                type_values = node_type if isinstance(node_type, list) else [node_type]
                is_product = any(str(value).lower() == "product" for value in type_values)
                if not is_product and not any(key in node for key in ("offers", "price", "image", "name")):
                    continue

                if not title and isinstance(node.get("name"), str):
                    title = node["name"].strip()
                if not image:
                    image = self._extract_image_value(node.get("image"))
                if not price:
                    price = self._extract_price_from_offer(node.get("offers"))
                    if not price and node.get("price") is not None:
                        price = clean_price(str(node.get("price")))

        return title, price, image

    def _extract_meta_content(self, soup: BeautifulSoup, key: str) -> str | None:
        tag = soup.find("meta", attrs={"property": key}) or soup.find("meta", attrs={"name": key})
        content = tag.get("content") if tag else None
        return content.strip() if isinstance(content, str) else None

    def _extract_embedded_json_fallbacks(self, soup: BeautifulSoup) -> tuple[str | None, str | None, str | None]:
        title = None
        price = None
        image = None

        def visit(node: Any, key: str = "") -> None:
            nonlocal title, price, image
            lowered_key = key.lower()
            if isinstance(node, dict):
                for child_key, child_value in node.items():
                    visit(child_value, str(child_key))
                return
            if isinstance(node, list):
                for child in node:
                    visit(child, key)
                return
            value = _text(node)
            if not value:
                return
            if not title and lowered_key in {"name", "title", "productname", "product_name"}:
                if 5 <= len(value) <= 300 and not value.startswith(("http://", "https://")):
                    title = value
            if not price and (
                "price" in lowered_key
                or lowered_key in {"mrp", "amount", "sellingprice", "discountedprice", "finalprice", "offerprice"}
            ):
                candidate = clean_price(value)
                if candidate and float(candidate) > 0:
                    price = candidate
            if not image and ("image" in lowered_key or lowered_key in {"src", "url"}):
                if value.startswith(("http://", "https://")) and any(ext in value.lower() for ext in (".jpg", ".jpeg", ".png", ".webp", "/image")):
                    image = value

        for script in soup.find_all("script"):
            raw = script.string or script.get_text(strip=True)
            if not raw or "price" not in raw.lower():
                continue
            stripped = raw.strip()
            if stripped.startswith(("{", "[")):
                try:
                    visit(json.loads(stripped))
                    if title and price and image:
                        return title, price, image
                except Exception:
                    pass

            for pattern in (
                r"window\.__INITIAL_STATE__\s*=",
                r"window\.__NEXT_DATA__\s*=",
                r"window\.__PRELOADED_STATE__\s*=",
                r"window\.__APOLLO_STATE__\s*=",
                r"window\.__INITIAL__DATA__\s*=",
                r"window\.__myx\s*=",
                r"__PRELOADED_STATE__\s*=",
            ):
                for match in re.finditer(pattern, raw):
                    start = raw.find("{", match.end())
                    if start == -1:
                        continue
                    try:
                        payload, _ = json.JSONDecoder().raw_decode(raw[start:])
                    except Exception:
                        continue
                    visit(payload)
                    if title and price and image:
                        return title, price, image
        return title, price, image

    def _first_selector_text(self, soup: BeautifulSoup, selectors: tuple[str, ...]) -> str | None:
        for selector in selectors:
            tag = soup.select_one(selector)
            if not tag:
                continue
            if tag.name == "meta":
                value = tag.get("content")
            else:
                value = tag.get("title") or tag.get_text(" ", strip=True)
            value = _text(value)
            if value:
                return value
        return None

    def _first_selector_image(self, soup: BeautifulSoup) -> str | None:
        for selector in self.image_selectors:
            tag = soup.select_one(selector)
            if not tag:
                continue
            value = (
                tag.get("content")
                or tag.get("src")
                or tag.get("data-src")
                or tag.get("data-image")
                or tag.get("data-original")
            )
            if not value:
                style = tag.get("style") or ""
                match = re.search(r"url\(['\"]?([^'\")]+)", style)
                value = match.group(1) if match else None
            if not value and tag.get("srcset"):
                value = tag.get("srcset").split(",")[0].strip().split(" ")[0]
            value = _text(value)
            if value and not value.startswith("data:"):
                return value
        return None

    def search_products(self, session: Session, headers: dict[str, str], query: str) -> list[dict[str, Any]]:
        search_headers = self.request_headers(headers, f"https://www.{self.primary_domain}/", None)
        url = f"https://www.{self.primary_domain}{self.search_path.format(query=quote_plus(query))}"
        response = session.get(url, headers=search_headers, timeout=12)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "lxml")
        results: list[dict[str, Any]] = []
        seen_urls = set()

        for link in soup.select("a[href]"):
            href = link.get("href") or ""
            if not any(token in href for token in self.search_link_contains):
                continue
            product_url = urljoin(f"https://www.{self.primary_domain}", href.split("?utm_")[0])
            if product_url in seen_urls:
                continue

            card = link.find_parent(["div", "li", "article"]) or link
            title = (link.get("title") or link.get_text(" ", strip=True) or self._first_selector_text(card, self.title_selectors) or "").strip()
            price_text = self._first_selector_text(card, self.price_selectors)
            price = clean_price(price_text or "")
            if len(title) < 5 or not price:
                continue

            image = self._first_selector_image(card) or "N/A"
            seen_urls.add(product_url)
            results.append(
                {
                    "title": title,
                    "product_url": product_url,
                    "image_url": image,
                    "price": price,
                    "price_value": float(price),
                }
            )
            if len(results) >= 10:
                break

        return results

    def extract_product_data(self, html: str) -> dict[str, Any]:
        soup = BeautifulSoup(html, "lxml")
        result = base_result()
        structured_title, structured_price, structured_image = self._extract_structured_data(soup)
        script_title, script_price, script_image = self._extract_embedded_json_fallbacks(soup)

        start = time.time()
        title = (
            structured_title
            or script_title
            or self._extract_meta_content(soup, "og:title")
            or self._first_selector_text(soup, self.title_selectors)
        )
        result["title"] = title.split("|")[0].strip() if title else None
        result["timings"]["title"] = log_timing(start)

        start = time.time()
        price = (
            structured_price
            or script_price
            or clean_price(self._extract_meta_content(soup, "product:price:amount") or "")
            or clean_price(self._first_selector_text(soup, self.price_selectors) or "")
        )
        result["price"] = price
        result["timings"]["price"] = log_timing(start)

        start = time.time()
        result["image"] = (
            structured_image
            or script_image
            or self._extract_meta_content(soup, "og:image")
            or self._first_selector_image(soup)
        )
        result["timings"]["image"] = log_timing(start)

        if not result["title"]:
            result["status"] = "failure"
            result["error"] = "Title not found"
        elif not result["price"]:
            result["status"] = "failure"
            result["error"] = "Price not found"

        return result
