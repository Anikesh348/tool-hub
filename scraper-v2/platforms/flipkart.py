from .base import ECommercePlatform
from playwright.async_api import Page
from urllib.parse import quote_plus
import time
import traceback
import re


def clean_price(text) -> str | None:
    if text is None:
        return None
    match = re.search(r"\d+(\.\d{1,2})?", str(text).replace(",", ""))
    return match.group(0) if match else None


def extract_recursive_fallbacks(data):
    title = None
    price = None
    image = None

    def visit(node, key=""):
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


async def first_text(page: Page, selectors: list[str]) -> str | None:
    for selector in selectors:
        element = await page.query_selector(selector)
        text = await element.text_content() if element else None
        if text and text.strip():
            return text.strip()
    return None


async def first_attr(page: Page, selectors: list[str], attrs: list[str]) -> str | None:
    for selector in selectors:
        element = await page.query_selector(selector)
        if not element:
            continue
        for attr in attrs:
            value = await element.get_attribute(attr)
            if value and value.strip():
                return value.strip()
    return None

class FlipkartPlatform(ECommercePlatform):
    async def scrape_product(self, page: Page, url: str) -> dict:
        result = {
            "title": None,
            "price": None,
            "image": None,
            "error": None,
            "status": "success",
            "timings": {}
        }

        try:
            start = time.time()
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            result["timings"]["goto"] = round(time.time() - start, 2)

            print("[DEBUG] Final URL after redirect:", page.url)

            state_title, state_price, state_image = None, None, None
            try:
                state = await page.evaluate("""() => window.__INITIAL_STATE__ || window.__NEXT_DATA__ || null""")
                state_title, state_price, state_image = extract_recursive_fallbacks(state)
            except Exception:
                pass

            # Title
            start = time.time()
            title = state_title or await first_text(page, [
                "h1._6EBuvT",
                "span.B_NuCI",
                "span.VU-ZEz",
                "h1",
            ])
            if not title:
                title = await first_attr(page, ["meta[property='og:title']"], ["content"])
            result["title"] = title.strip() if title else None
            result["timings"]["title"] = round(time.time() - start, 2)

            # Price
            start = time.time()
            price_text = state_price or await first_text(page, [
                "div.CxhGGd",
                "div._30jeq3",
                "div.Nx9bqj",
                "[data-testid='price-current']",
                "div[class*='Nx9bqj']",
                "div[class*='_30jeq3']",
                "[itemprop='price']",
            ])
            price_clean = clean_price(price_text)
            if price_clean:
                result["price"] = price_clean
            else:
                result["price"] = ""
                result["error"] = "Price not found on Flipkart product page"
                result["status"] = "failure"
            result["timings"]["price"] = round(time.time() - start, 2)

            # Image
            start = time.time()
            image_url = state_image or await first_attr(page, [
                "img.jLEJ7H",
                "img._53J4C-",
                "img.DByuf4",
                "img[loading='eager']",
                "meta[property='og:image']",
            ], ["src", "content"])
            result["image"] = image_url
            result["timings"]["image"] = round(time.time() - start, 2)

        except Exception as e:
            result["error"] = str(e)
            result["status"] = "failure"
            traceback.print_exc()

        return result

    async def search(self, page: Page, query: str) -> list:
        results = []
        encoded_query = quote_plus(query)
        url = f"https://www.flipkart.com/search?q={encoded_query}"

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            products = await page.query_selector_all("div.cPHDOP.col-12-12")

            for product in products:
                try:
                    link_tag = await product.query_selector("a.CGtC98")
                    href = await link_tag.get_attribute("href") if link_tag else None
                    if not href or not href.startswith("/"):
                        continue
                    product_url = f"https://www.flipkart.com{href.strip()}"

                    title_tag = await product.query_selector("div.KzDlHZ")
                    title = await title_tag.text_content() if title_tag else None
                    if not title:
                        continue

                    img_tag = await product.query_selector("img.DByuf4")
                    image_url = await img_tag.get_attribute("src") if img_tag else "N/A"

                    price_tag = await product.query_selector("div.Nx9bqj")
                    price_text = await price_tag.text_content() if price_tag else None
                    if not price_text:
                        continue  # ❗ Skip if price not found
                    price_value = float(price_text.replace("₹", "").replace(",", "").strip())

                    results.append({
                        "title": title.strip(),
                        "product_url": product_url,
                        "image_url": image_url.strip() if image_url else "N/A",
                        "price": f"{price_value:.2f}",
                        "price_value": price_value
                    })

                    print("[OK]", results[-1])
                    if len(results) >= 5:
                        break

                except Exception as inner_e:
                    print(f"[WARN] Skipping product due to: {inner_e}")
                    traceback.print_exc()
                    continue

        except Exception as outer_e:
            print(f"[ERROR] Flipkart search failed: {outer_e}")
            traceback.print_exc()

        return results
