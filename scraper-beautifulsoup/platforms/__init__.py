from __future__ import annotations

from urllib.parse import urlparse

from .amazon import AmazonHandler
from .base import PlatformHandler
from .flipkart import FlipkartHandler


HANDLERS: tuple[PlatformHandler, ...] = (
    AmazonHandler(),
    FlipkartHandler(),
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
