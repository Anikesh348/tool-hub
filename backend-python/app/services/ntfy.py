import logging
import os
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

NTFY_SERVER = "https://ntfy.sh"


def send_ntfy_alert(message: str, actions: Optional[List[Dict[str, str]]] = None) -> None:
    topic = (os.getenv("NTFY_TOPIC") or "").strip()
    if not topic:
        raise RuntimeError("ntfy topic is not configured")
    payload: Dict[str, Any] = {"topic": topic, "message": message[:4000]}
    if actions:
        payload["actions"] = [
            {
                "action": "http",
                "label": action["label"][:20],
                "url": action["url"],
                "method": "POST",
                "clear": True,
            }
            for action in actions
        ]
    res = requests.post(NTFY_SERVER, json=payload, timeout=15)
    if res.status_code < 200 or res.status_code >= 300:
        raise RuntimeError(f"ntfy api failure status {res.status_code}: {res.text[:300]}")
