from __future__ import annotations

import json
import re
import time
from typing import Any
from urllib.parse import parse_qsl, quote_plus, urlencode, urljoin, urlparse, urlunparse

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
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "DNT": "1",
                "Upgrade-Insecure-Requests": "1",
            }
        )
        return headers

    def fetch_urls(self, url: str) -> list[str]:
        parsed = urlparse(url)
        if not parsed.netloc:
            return [url]

        candidates = [url]
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        compact_query = urlencode(
            {
                key: value
                for key, value in query.items()
                if key.lower() in {"pid", "lid", "marketplace"}
            }
        )

        compact = urlunparse(
            (
                parsed.scheme or "https",
                "www.flipkart.com",
                parsed.path,
                "",
                compact_query,
                "",
            )
        )
        candidates.append(compact)

        mobile = urlunparse(
            (
                parsed.scheme or "https",
                "m.flipkart.com",
                parsed.path,
                "",
                compact_query,
                "",
            )
        )
        candidates.append(mobile)

        seen = set()
        unique_candidates = []
        for candidate in candidates:
            if candidate in seen:
                continue
            seen.add(candidate)
            unique_candidates.append(candidate)
        return unique_candidates

    def before_fetch(
        self,
        session: Session,
        headers: dict[str, str],
        url: str,
        pincode: str | None,
    ) -> dict:
        # Flipkart can issue homepage cookies that cause direct product requests
        # from this service to receive 403 responses. Product pages are
        # fetchable without that warm-up, so keep each Flipkart request clean.
        session.cookies.clear()
        return {"pincode_applied": False, "pincode_timing": 0.0}

    def _extract_embedded_json(self, text: str) -> list[Any]:
        payloads: list[Any] = []
        stripped = text.strip()
        if not stripped:
            return payloads

        if stripped[0] in "[{":
            try:
                payloads.append(json.loads(stripped))
            except Exception:
                pass

        patterns = [
            r"window\.__INITIAL_STATE__\s*=",
            r"window\.__NEXT_DATA__\s*=",
            r"__INITIAL_STATE__\s*=",
        ]
        for pattern in patterns:
            for match in re.finditer(pattern, text, re.DOTALL):
                start = match.end()
                json_start = text.find("{", start)
                if json_start == -1:
                    continue
                try:
                    payload, _ = json.JSONDecoder().raw_decode(text[json_start:])
                    payloads.append(payload)
                except Exception:
                    continue
        return payloads

    def _extract_recursive_fallbacks(self, data: Any) -> tuple[str | None, str | None, str | None]:
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

            if node is None:
                return

            value = str(node).strip()
            if not value:
                return

            if not title and lowered_key in {"title", "name", "producttitle"}:
                if 5 <= len(value) <= 300 and "flipkart" not in value.lower() and not value.startswith("http"):
                    title = value

            if not price and ("price" in lowered_key or lowered_key in {"amount", "fsp"}):
                candidate = clean_price(value)
                if candidate:
                    price = candidate

            if not image and ("image" in lowered_key or lowered_key in {"src", "url"}):
                if value.startswith(("http://", "https://")) and any(
                    token in value.lower() for token in ("/image/", "rukminim", ".jpg", ".jpeg", ".png", ".webp")
                ):
                    image = value

        visit(data)
        return title, price, image

    def _extract_script_fallbacks(self, soup: BeautifulSoup) -> tuple[str | None, str | None, str | None]:
        title = None
        price = None
        image = None

        for script in soup.find_all("script"):
            raw = script.string or script.get_text(strip=True)
            if not raw:
                continue
            for payload in self._extract_embedded_json(raw):
                candidate_title, candidate_price, candidate_image = self._extract_recursive_fallbacks(payload)
                title = title or candidate_title
                price = price or candidate_price
                image = image or candidate_image
                if title and price and image:
                    return title, price, image

        return title, price, image

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

    def search_products(self, session: Session, headers: dict[str, str], query: str) -> list[dict]:
        session.cookies.clear()
        search_headers = self.request_headers(headers, "https://www.flipkart.com/", None)
        url = f"https://www.flipkart.com/search?q={quote_plus(query)}"
        response = session.get(url, headers=search_headers, timeout=12)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "lxml")
        results = []
        seen_urls = set()

        card_selectors = [
            "div.cPHDOP.col-12-12",
            "div[data-id]",
            "div._1AtVbE",
        ]

        cards = []
        for selector in card_selectors:
            cards.extend(soup.select(selector))

        for card in cards:
            link_tag = (
                card.select_one("a.CGtC98[href]")
                or card.select_one("a.k7wcnx[href]")
                or card.select_one("a._1fQZEK[href]")
                or card.select_one("a[href*='/p/']")
            )
            href = link_tag.get("href") if link_tag else ""
            if not href:
                continue

            product_url = urljoin("https://www.flipkart.com", href.split("&otracker=")[0])
            if product_url in seen_urls:
                continue

            title_tag = (
                card.select_one("div.KzDlHZ")
                or card.select_one("div.RG5Slk")
                or card.select_one("a.WKTcLC")
                or card.select_one("a.IRpwTa")
                or card.select_one("div._4rR01T")
                or card.select_one("a[title]")
            )
            title = ""
            if title_tag:
                title = title_tag.get("title") or title_tag.get_text(" ", strip=True)
            if not title:
                continue

            price_tag = (
                card.select_one("div.Nx9bqj")
                or card.select_one("div.hZ3P6w")
                or card.select_one("div._30jeq3")
                or card.select_one("div[class*='Nx9bqj']")
            )
            price = clean_price(price_tag.get_text(strip=True)) if price_tag else None
            if not price:
                continue

            image_tag = card.select_one("img.DByuf4") or card.select_one("img.UCc1lI") or card.select_one("img._396cs4") or card.select_one("img")
            image_url = ""
            if image_tag:
                image_url = image_tag.get("src") or image_tag.get("data-src") or ""
                if not image_url:
                    image_url = self._extract_first_srcset_url(image_tag.get("srcset")) or ""

            seen_urls.add(product_url)
            results.append(
                {
                    "title": title.strip(),
                    "product_url": product_url,
                    "image_url": image_url.strip() if image_url else "N/A",
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
        structured_title, structured_price, structured_image = self._extract_structured_data(soup)
        script_title, script_price, script_image = self._extract_script_fallbacks(soup)

        start = time.time()
        title = structured_title or script_title
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
        price = structured_price or script_price
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
        image = structured_image or script_image
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
