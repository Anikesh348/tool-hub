import json
import os
import re
import uuid
from html import escape
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import bcrypt
import jwt
import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app.utils.responses import error, jsonable


def base_url(name: str) -> str:
    return (os.getenv(name) or "").rstrip("/")


def api_headers(api_key: str) -> Dict[str, str]:
    return {"x-api-key": api_key, "Authorization": f"Bearer {api_key}", "Accept": "application/json"}


def proxy_json(method: str, url: str, **kwargs):
    try:
        res = requests.request(method, url, timeout=60, **kwargs)
        content_type = res.headers.get("Content-Type", "application/json")
        try:
            data = res.json()
        except Exception:
            data = {"raw": res.text}
        return JSONResponse(status_code=res.status_code, content=jsonable(data), media_type=content_type.split(";")[0])
    except requests.RequestException as exc:
        return JSONResponse(status_code=502, content=error(str(exc)))
