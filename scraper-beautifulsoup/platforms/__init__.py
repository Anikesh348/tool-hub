from __future__ import annotations

from urllib.parse import urlparse

from .amazon import AmazonHandler
from .base import PlatformHandler
from .flipkart import FlipkartHandler
from .generic_ecommerce import GenericEcommerceHandler


HANDLERS: tuple[PlatformHandler, ...] = (
    AmazonHandler(),
    FlipkartHandler(),
    GenericEcommerceHandler(
        "myntra",
        ("myntra.com", "www.myntra.com", "myntraapp.com", "www.myntraapp.com"),
        search_path="/{query}",
        search_link_contains=("/",),
        title_selectors=("h1.pdp-title", ".pdp-name", ".pdp-title", ".pdp-name h1"),
        price_selectors=(".pdp-price strong", ".pdp-price", ".pdp-selling-price", ".pdp-discount-container"),
        image_selectors=(".image-grid-image", "img[src*='assets.myntassets.com']", "meta[property='og:image']"),
    ),
    GenericEcommerceHandler(
        "nykaa",
        ("nykaa.com", "www.nykaa.com", "nykaa.in", "www.nykaa.in"),
        search_path="/search/result/?q={query}",
        search_link_contains=("/p/", "/product/"),
        title_selectors=("h1.css-1gc4x7i", "h1", "[class*='ProductTitle']"),
        price_selectors=(".css-1jczs19", ".css-1d0jf8e", "[class*='final-price']", "[class*='price']"),
        image_selectors=("img[src*='nykaa.com']",),
    ),
    GenericEcommerceHandler(
        "ajio",
        ("ajio.com", "www.ajio.com", "ajioluxe.com", "www.ajioluxe.com"),
        search_path="/search/?text={query}",
        search_link_contains=("/p/",),
        title_selectors=(".prod-name", ".brand-name", ".product-name", "h1"),
        price_selectors=(".prod-sp", ".prod-price-section", ".price", "[class*='price']"),
        image_selectors=("img[src*='ajio.com']", "img[src*='ril.com']",),
    ),
    GenericEcommerceHandler(
        "tatacliq",
        ("tatacliq.com", "www.tatacliq.com"),
        search_path="/search/?searchCategory=all&text={query}",
        search_link_contains=("/p-", "/product/"),
        title_selectors=("h1", "[class*='ProductName']",),
        price_selectors=("[class*='ProductPrice']", "[class*='price']",),
    ),
    GenericEcommerceHandler(
        "croma",
        ("croma.com", "www.croma.com"),
        search_path="/search/?text={query}",
        search_link_contains=("/p/"),
        title_selectors=("h1", ".pd-title",),
        price_selectors=(".amount", ".pdpPrice", "[class*='price']",),
    ),
    GenericEcommerceHandler(
        "meesho",
        ("meesho.com", "www.meesho.com"),
        search_path="/search?q={query}",
        search_link_contains=("/p/",),
        title_selectors=("h1", "[class*='Product']",),
        price_selectors=("[class*='Price']", "[class*='price']",),
    ),
    GenericEcommerceHandler(
        "shopsy",
        ("shopsy.in", "www.shopsy.in"),
        search_path="/search?q={query}",
        search_link_contains=("/p/",),
        title_selectors=("h1", "[class*='title']", "[class*='name']"),
        price_selectors=("[class*='price']", "[class*='Price']"),
    ),
    GenericEcommerceHandler(
        "snapdeal",
        ("snapdeal.com", "www.snapdeal.com"),
        search_path="/search?keyword={query}",
        search_link_contains=("/product/",),
        title_selectors=("h1[itemprop='name']", "h1", ".pdp-e-i-head"),
        price_selectors=("[itemprop='price']", ".payBlkBig", "[class*='price']"),
        image_selectors=("img#bx-slider-left-image-panel", "meta[property='og:image']", "img[src*='snapdeal']"),
    ),
    GenericEcommerceHandler(
        "firstcry",
        ("firstcry.com", "www.firstcry.com"),
        search_path="/search?q={query}",
        search_link_contains=("/product/",),
        title_selectors=(".prod-name", "h1", "[class*='prod']"),
        price_selectors=(".B14_42", ".price", "[class*='price']"),
        image_selectors=("meta[property='og:image']", "img[src*='firstcry']"),
    ),
    GenericEcommerceHandler(
        "bigbasket",
        ("bigbasket.com", "www.bigbasket.com"),
        search_path="/ps/?q={query}",
        search_link_contains=("/pd/",),
        title_selectors=("h1", "[class*='Description']", "[class*='ProductName']"),
        price_selectors=("[class*='Pricing']", "[class*='price']", "[class*='Price']"),
        image_selectors=("meta[property='og:image']", "img[src*='bigbasket']"),
    ),
    GenericEcommerceHandler(
        "reliancedigital",
        ("reliancedigital.in", "www.reliancedigital.in"),
        search_path="/search?q={query}",
        search_link_contains=("/product/", "/p/"),
        title_selectors=("h1", "[class*='pdp__title']", "[class*='product-title']"),
        price_selectors=("[class*='price']", "[class*='Price']", "[class*='amount']"),
        image_selectors=("meta[property='og:image']", "img[src*='ril']"),
    ),
    GenericEcommerceHandler(
        "vijaysales",
        ("vijaysales.com", "www.vijaysales.com"),
        search_path="/search/{query}",
        search_link_contains=("/p/", "/product/"),
        title_selectors=("h1", ".product-name", "[class*='ProductName']"),
        price_selectors=(".price", "[class*='Price']", "[class*='price']"),
        image_selectors=("meta[property='og:image']", "img[src*='vijaysales']"),
    ),
    GenericEcommerceHandler(
        "jiomart",
        ("jiomart.com", "www.jiomart.com"),
        search_path="/search/{query}",
        search_link_contains=("/p/",),
        title_selectors=("h1", "[class*='product-name']", "[class*='ProductName']"),
        price_selectors=("[class*='price']", "[class*='Price']"),
        image_selectors=("meta[property='og:image']", "img[src*='jiomart']"),
    ),
)

DOMAIN_HANDLER_MAP: dict[str, PlatformHandler] = {}
for handler in HANDLERS:
    for domain in handler.domains:
        DOMAIN_HANDLER_MAP[domain] = handler


def get_handler_for_url(url: str) -> tuple[PlatformHandler | None, str]:
    domain = urlparse(url).netloc.lower()
    handler = DOMAIN_HANDLER_MAP.get(domain)
    if handler:
        return handler, domain

    normalized = domain[4:] if domain.startswith("www.") else domain
    return DOMAIN_HANDLER_MAP.get(normalized), domain
