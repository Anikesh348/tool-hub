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

from app.services.mongo import db

router = APIRouter()

@router.get("/health")
def health():
    try:
        db().command("ping")
        return {"status": "ok", "mongo": "up"}
    except Exception as exc:
        return JSONResponse(status_code=503, content={"status": "degraded", "mongo": "down", "error": str(exc)})
