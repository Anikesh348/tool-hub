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


def send_brevo_email(subject: str, to: str, html_body: str) -> None:
    recipient = (to or "").strip()
    sender = (os.getenv("SENDER_EMAIL") or "").strip()
    api_key = (os.getenv("MAIL_API_KEY") or "").strip()
    if not recipient:
        raise RuntimeError("recipient email is required")
    if not sender:
        raise RuntimeError("sender email is not configured")
    if not api_key:
        raise RuntimeError("mail api key is not configured")
    res = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={"accept": "application/json", "Content-Type": "application/json", "api-key": api_key},
        json={
            "sender": {"email": sender},
            "to": [{"email": recipient}],
            "subject": subject,
            "htmlContent": html_body,
        },
        timeout=30,
    )
    if res.status_code < 200 or res.status_code >= 300:
        raise RuntimeError(f"mail api failure status {res.status_code}: {res.text[:300]}")
