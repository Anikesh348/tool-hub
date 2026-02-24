from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from requests import Session


class PlatformHandler(ABC):
    name: str = "unknown"
    domains: tuple[str, ...] = ()

    def request_headers(
        self,
        base_headers: dict[str, str],
        url: str,
        pincode: str | None,
    ) -> dict[str, str]:
        return dict(base_headers)

    def validate_request(self, url: str, pincode: str | None) -> tuple[bool, str | None]:
        return True, None

    def before_fetch(
        self,
        session: Session,
        headers: dict[str, str],
        url: str,
        pincode: str | None,
    ) -> dict[str, Any]:
        return {"pincode_applied": False, "pincode_timing": 0.0}

    @abstractmethod
    def extract_product_data(self, html: str) -> dict[str, Any]:
        pass
