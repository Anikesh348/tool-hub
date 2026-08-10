import os
import re
import hashlib
from datetime import datetime, timezone
from html import escape
from typing import Any, Dict, List
from urllib.parse import urljoin, urlparse, urlunparse

import requests
from fastapi.responses import JSONResponse

from app.services.mail import send_brevo_email
from app.services.mongo import col, find, find_one, insert
from app.services.notifications import emit_notification
from app.services.redis_cache import cache_get, cache_set, cache_token
from app.utils.responses import error, success


PRICE_ALERT_MARGIN_PERCENT = 5
PRICE_ALERT_STATE_COLLECTION = "price-alert-state"
PRODUCT_SEARCH_CACHE_SECONDS = int(os.getenv("PRODUCT_SEARCH_CACHE_SECONDS", "600"))
SUPPORTED_SEARCH_PLATFORMS = {
    "amazon",
    "flipkart",
    "myntra",
    "nykaa",
    "ajio",
    "tatacliq",
    "croma",
    "meesho",
    "shopsy",
    "snapdeal",
    "firstcry",
    "bigbasket",
    "reliancedigital",
    "vijaysales",
    "jiomart",
}
DOMAIN_PLATFORM_MAP = {
    "amazon.in": "amazon",
    "www.amazon.in": "amazon",
    "amazon.com": "amazon",
    "www.amazon.com": "amazon",
    "flipkart.com": "flipkart",
    "www.flipkart.com": "flipkart",
    "m.flipkart.com": "flipkart",
    "dl.flipkart.com": "flipkart",
    "myntra.com": "myntra",
    "www.myntra.com": "myntra",
    "myntraapp.com": "myntra",
    "www.myntraapp.com": "myntra",
    "nykaa.com": "nykaa",
    "www.nykaa.com": "nykaa",
    "nykaa.in": "nykaa",
    "www.nykaa.in": "nykaa",
    "ajio.com": "ajio",
    "www.ajio.com": "ajio",
    "ajioluxe.com": "ajio",
    "www.ajioluxe.com": "ajio",
    "tatacliq.com": "tatacliq",
    "www.tatacliq.com": "tatacliq",
    "croma.com": "croma",
    "www.croma.com": "croma",
    "meesho.com": "meesho",
    "www.meesho.com": "meesho",
    "shopsy.in": "shopsy",
    "www.shopsy.in": "shopsy",
    "snapdeal.com": "snapdeal",
    "www.snapdeal.com": "snapdeal",
    "firstcry.com": "firstcry",
    "www.firstcry.com": "firstcry",
    "bigbasket.com": "bigbasket",
    "www.bigbasket.com": "bigbasket",
    "reliancedigital.in": "reliancedigital",
    "www.reliancedigital.in": "reliancedigital",
    "vijaysales.com": "vijaysales",
    "www.vijaysales.com": "vijaysales",
    "jiomart.com": "jiomart",
    "www.jiomart.com": "jiomart",
}


def extract_price(value: Any) -> int:
    digits = re.sub(r"[^0-9]", "", str(value or ""))
    return int(digits) if digits else 0


def extract_product_id(url: str) -> str:
    if "amazon." in url:
        match = re.search(r"/dp/([A-Z0-9]{10})|/gp/product/([A-Z0-9]{10})", url, re.I)
        if not match:
            raise ValueError(f"Invalid Amazon URL: {url}")
        return "amazon_" + (match.group(1) or match.group(2)).lower()
    if "flipkart." in url:
        match = re.search(r"/p/(itm[0-9a-zA-Z]+)", url)
        if not match:
            raise ValueError(f"Invalid Flipkart URL: {url}")
        return "flipkart_" + match.group(1).lower()

    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    normalized_domain = domain[4:] if domain.startswith("www.") else domain
    platform = DOMAIN_PLATFORM_MAP.get(domain) or DOMAIN_PLATFORM_MAP.get(normalized_domain)
    if platform:
        normalized_url = urlunparse(
            (
                parsed.scheme.lower() or "https",
                normalized_domain,
                parsed.path.rstrip("/"),
                "",
                parsed.query,
                "",
            )
        )
        digest = hashlib.sha1(normalized_url.encode("utf-8")).hexdigest()[:16]
        return f"{platform}_{digest}"

    raise ValueError(f"Unsupported platform in URL: {url}")


def final_url(url: str) -> str:
    response = requests.get(url, allow_redirects=True, timeout=30)
    return response.url or url


def scrape_product(product: Dict[str, Any]) -> Dict[str, Any]:
    scrapper_url = os.getenv("SCRAPPER_URL", "").strip()
    if not scrapper_url:
        raise RuntimeError("SCRAPPER_URL is not configured")
    response = requests.post(scrapper_url, json={"url": product.get("productUrl")}, timeout=60)
    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(f"scrapper failed with status {response.status_code}")
    product_info = response.json()
    if not product_info.get("price") or not product_info.get("title"):
        raise RuntimeError("Invalid response from scrapper")
    return {"product": product, "productInfo": product_info}


def scraper_search_url() -> str:
    configured_url = os.getenv("SCRAPPER_SEARCH_URL", "").strip()
    if configured_url:
        return configured_url

    scraper_url = os.getenv("SCRAPPER_URL", "").strip()
    if scraper_url:
        if scraper_url.endswith("/scrape/product"):
            return scraper_url[: -len("/scrape/product")] + "/v2/search"
        return urljoin(scraper_url.rstrip("/") + "/", "v2/search")

    return "http://scraper-beautifulsoup:8001/v2/search"


def search_products(query: str, platform: str):
    normalized_query = (query or "").strip()
    normalized_platform = (platform or "").strip().lower()
    if not normalized_query:
        return JSONResponse(status_code=400, content=error("query is required"))
    if normalized_platform not in SUPPORTED_SEARCH_PLATFORMS:
        supported = ", ".join(sorted(SUPPORTED_SEARCH_PLATFORMS))
        return JSONResponse(status_code=400, content=error(f"platform must be one of: {supported}"))

    cache_key = f"toolhub:v1:product-search:{normalized_platform}:{cache_token(normalized_query.lower())}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        response = requests.get(
            scraper_search_url(),
            params={"query": normalized_query, "platform": normalized_platform},
            timeout=45,
        )
        payload = response.json()
    except requests.Timeout:
        return JSONResponse(status_code=504, content=error("search request timed out"))
    except Exception as exc:
        return JSONResponse(status_code=502, content=error(f"search service failed: {exc}"))

    if response.status_code < 200 or response.status_code >= 300:
        return JSONResponse(status_code=response.status_code, content=payload)

    cache_set(cache_key, payload, PRODUCT_SEARCH_CACHE_SECONDS)
    return payload


def update_product_info(product: Dict[str, Any], product_info: Dict[str, Any]) -> None:
    product_id = product.get("productId")
    if not product_id or find_one("product-information", {"productId": product_id}):
        return
    insert(
        "product-information",
        {
            "productId": product_id,
            "productTitle": product_info.get("title", ""),
            "productImageUrl": product_info.get("image", ""),
        },
    )


def save_product(body: Dict[str, Any], user: Dict[str, str]):
    product_url = body.get("productUrl", "")
    target_price = body.get("targetPrice", "")
    try:
        try:
            resolved_url = product_url
            product_id = extract_product_id(product_url)
        except ValueError:
            resolved_url = final_url(product_url)
            product_id = extract_product_id(resolved_url)
    except Exception as exc:
        return JSONResponse(status_code=500, content=error(str(exc)))

    product = find_one("products", {"productId": product_id})
    if not product:
        product = {
            "productId": product_id,
            "productUrl": resolved_url,
            "userTargetPrices": [{"userId": user["userId"], "targetPrices": [target_price]}],
        }
        try:
            scraped = scrape_product(product)
            update_product_info(product, scraped["productInfo"])
        except Exception:
            pass
        insert("products", product)
        return success("product inserted")

    entries = product.get("userTargetPrices", [])
    for entry in entries:
        if entry.get("userId") == user["userId"]:
            if target_price in entry.get("targetPrices", []):
                return JSONResponse(status_code=400, content=error("target price already added for this user"))
            col("products").update_one(
                {"productId": product_id, "userTargetPrices.userId": user["userId"]},
                {"$addToSet": {"userTargetPrices.$.targetPrices": target_price}},
            )
            return success("product inserted")

    col("products").update_one(
        {"productId": product_id},
        {"$push": {"userTargetPrices": {"userId": user["userId"], "targetPrices": [target_price]}}},
    )
    return success("product inserted")


def get_products(user: Dict[str, str]) -> List[Dict[str, Any]]:
    records = find("products", {"userTargetPrices": {"$elemMatch": {"userId": user["userId"]}}})
    product_ids = list({p.get("productId") for p in records if p.get("productId")})
    infos = {p["productId"]: p for p in find("product-information", {"productId": {"$in": product_ids}})}
    response = []
    for product in records:
        info = infos.get(product.get("productId"), {})
        for targets in product.get("userTargetPrices", []):
            if targets.get("userId") == user["userId"]:
                for target in targets.get("targetPrices", []):
                    response.append({
                        "productId": product.get("productId"),
                        "productTitle": info.get("productTitle"),
                        "productImageUrl": info.get("productImageUrl"),
                        "productUrl": product.get("productUrl"),
                        "targetPrice": target,
                    })
    return response


def normalize_price_history_record(record: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(record)
    if not normalized.get("productName") and normalized.get("productTitle"):
        normalized["productName"] = normalized.get("productTitle")
    if not normalized.get("captureTime") and normalized.get("createdAt"):
        normalized["captureTime"] = normalized.get("createdAt")
    return normalized


def get_price_history(product_id: str) -> List[Dict[str, Any]]:
    return [
        normalize_price_history_record(record)
        for record in find("pricehistory", {"productId": product_id})
    ]


def delete_product_target(product_id: str, target_price: str, user: Dict[str, str]):
    col("products").update_one(
        {"productId": product_id, "userTargetPrices.userId": user["userId"]},
        {"$pull": {"userTargetPrices.$.targetPrices": target_price}},
    )
    col("products").update_one(
        {"productId": product_id},
        {"$pull": {"userTargetPrices": {"userId": user["userId"], "targetPrices": {"$size": 0}}}},
    )
    col("products").delete_one({"productId": product_id, "userTargetPrices": {"$size": 0}})
    return success("Target price removed")


def save_price_history(product: Dict[str, Any], product_info: Dict[str, Any]) -> None:
    insert(
        "pricehistory",
        {
            "productId": product.get("productId"),
            "productName": product_info.get("title"),
            "productUrl": product.get("productUrl"),
            "productPrice": product_info.get("price"),
            "captureTime": datetime.now(timezone.utc).isoformat(),
        },
    )


def _display_value(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return text if text else fallback


def _first_display_value(*values: Any, fallback: str) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return fallback


def product_info_for_alert(product: Dict[str, Any], product_info: Dict[str, Any]) -> Dict[str, Any]:
    alert_info = dict(product_info or {})
    stored_info = {}
    product_id = product.get("productId")
    if product_id:
        stored_info = find_one("product-information", {"productId": product_id}) or {}

    alert_info["title"] = _first_display_value(
        stored_info.get("productTitle"),
        stored_info.get("title"),
        product_info.get("productTitle") if product_info else None,
        product_info.get("title") if product_info else None,
        fallback="tracked product",
    )
    alert_info["image"] = _first_display_value(
        stored_info.get("productImageUrl"),
        stored_info.get("image"),
        product_info.get("productImageUrl") if product_info else None,
        product_info.get("image") if product_info else None,
        fallback="",
    )
    return alert_info


def build_price_alert_subject(product_info: Dict[str, Any]) -> str:
    title = _display_value(product_info.get("title"), "tracked product")
    price = _display_value(product_info.get("price"), "a lower price")
    return f"Price drop: {title} is now {price}"


def build_price_alert_email(
    product: Dict[str, Any],
    product_info: Dict[str, Any],
    matching_targets: List[Dict[str, Any]],
) -> str:
    product_title = escape(_display_value(product_info.get("title"), "Your tracked product"))
    product_price = escape(_display_value(product_info.get("price"), "the latest tracked price"))
    product_url = escape(_display_value(product.get("productUrl"), "#"))
    product_id = escape(_display_value(product.get("productId"), ""))
    image_url = escape(str(product_info.get("image") or "").strip())

    target_rows = "".join(
        f"""
        <tr>
          <td style="padding:6px 10px; border:1px solid #e5e7eb;">{escape(str(target.get("targetPrice", "")))}</td>
          <td style="padding:6px 10px; border:1px solid #e5e7eb;">{escape(str(target.get("thresholdPrice", "")))}</td>
        </tr>
        """
        for target in matching_targets
    )
    targets_table = ""
    if target_rows:
        targets_table = f"""
        <table style="border-collapse:collapse; margin:12px 0;">
          <thead>
            <tr>
              <th align="left" style="padding:6px 10px; border:1px solid #e5e7eb;">Your target</th>
              <th align="left" style="padding:6px 10px; border:1px solid #e5e7eb;">Alert threshold</th>
            </tr>
          </thead>
          <tbody>{target_rows}</tbody>
        </table>
        """

    image_block = ""
    if image_url:
        image_block = f'<p><img src="{image_url}" alt="{product_title}" style="max-width:220px; height:auto; border:1px solid #e5e7eb;" /></p>'

    return f"""
<html>
  <body style="font-family: Arial, sans-serif; line-height:1.6; color:#1f2937;">
    <h3 style="margin-bottom: 8px;">Price drop alert</h3>
    <p><strong>{product_title}</strong> is now listed at <strong style="color:#047857;">{product_price}</strong>.</p>
    {image_block}
    {targets_table}
    <p>Product ID: {product_id}</p>
    <p><a href="{product_url}" target="_blank" rel="noopener noreferrer">View product</a></p>
  </body>
</html>
"""


def send_price_alerts(product: Dict[str, Any], product_info: Dict[str, Any]) -> int:
    product_price = extract_price(product_info.get("price"))
    if product_price <= 0:
        return 0

    product_id = product.get("productId")
    if not product_id:
        return 0

    eligible_targets_by_user: Dict[str, List[Dict[str, Any]]] = {}
    checked_at = datetime.now(timezone.utc).isoformat()

    for user_targets in product.get("userTargetPrices", []):
        user_id = user_targets.get("userId")
        for target in user_targets.get("targetPrices", []):
            target_price = extract_price(target)
            if not user_id or target_price <= 0:
                continue

            state_query = {
                "productId": product_id,
                "userId": user_id,
                "targetPrice": str(target),
            }
            threshold = target_price + (PRICE_ALERT_MARGIN_PERCENT * target_price // 100)
            if product_price <= threshold:
                eligible_targets_by_user.setdefault(user_id, []).append(
                    {
                        "query": state_query,
                        "targetPrice": target,
                        "targetPriceValue": target_price,
                        "thresholdPrice": threshold,
                    }
                )
            else:
                col(PRICE_ALERT_STATE_COLLECTION).update_one(
                    state_query,
                    {
                        "$set": {
                            "active": False,
                            "lastSeenPrice": product_price,
                            "lastCheckedAt": checked_at,
                            "updatedAt": checked_at,
                        },
                        "$setOnInsert": {"createdAt": checked_at},
                    },
                    upsert=True,
                )

    if not eligible_targets_by_user:
        return 0

    alert_product_info = product_info_for_alert(product, product_info)
    users = find("users", {"userId": {"$in": list(eligible_targets_by_user.keys())}})
    sent = 0
    for user in users:
        email = (user.get("email") or "").strip()
        if not email:
            continue
        try:
            matching_targets = eligible_targets_by_user.get(user.get("userId"), [])
            alert_title = build_price_alert_subject(alert_product_info)
            send_brevo_email(alert_title, email, build_price_alert_email(product, alert_product_info, matching_targets))
            emit_notification(
                audience="ADMIN",
                title=alert_title,
                message=f"{len(matching_targets)} saved target(s) reached. Notified {email}.",
                severity="SUCCESS",
                category="price_alert",
                source="products",
                action_url="/products",
                metadata={"productId": product_id},
            )
            for target_state in eligible_targets_by_user.get(user.get("userId"), []):
                col(PRICE_ALERT_STATE_COLLECTION).update_one(
                    target_state["query"],
                    {
                        "$set": {
                            "active": True,
                            "targetPriceValue": target_state["targetPriceValue"],
                            "thresholdPrice": target_state["thresholdPrice"],
                            "lastAlertedPrice": product_price,
                            "lastSeenPrice": product_price,
                            "lastAlertedAt": checked_at,
                            "lastCheckedAt": checked_at,
                            "updatedAt": checked_at,
                        },
                        "$setOnInsert": {"createdAt": checked_at},
                    },
                    upsert=True,
                )
            sent += 1
        except Exception:
            continue
    return sent


def check_all_products() -> Dict[str, Any]:
    products = find("products", {})
    summary = {"total": len(products), "checked": 0, "historySaved": 0, "alertsSent": 0, "failed": 0}
    for product in products:
        try:
            scraped = scrape_product(product)
            product_info = scraped["productInfo"]
            save_price_history(product, product_info)
            update_product_info(product, product_info)
            summary["historySaved"] += 1
            summary["alertsSent"] += send_price_alerts(product, product_info)
        except Exception:
            summary["failed"] += 1
        finally:
            summary["checked"] += 1
    return summary
