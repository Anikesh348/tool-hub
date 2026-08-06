import os
from typing import Any, Dict, Optional

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

DB_NAME = os.getenv("DB_NAME", "pricedrop")
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ISSUER = os.getenv("JWT_ISSUER", "toolhub")
ACCESS_TOKEN_TTL_MINUTES = int(os.getenv("ACCESS_TOKEN_TTL_MINUTES", "15"))
REFRESH_TOKEN_TTL_DAYS = int(os.getenv("REFRESH_TOKEN_TTL_DAYS", "3"))
DEFAULT_PROFILE_PICTURE = "https://ui-avatars.com/api/?name=U&background=FF5733&color=fff&size=64"

MEDIA_REQUESTS_COLLECTION = "mediarequests"
MOVIEHUB_ACCESS_REQUESTS_COLLECTION = "moviehubaccessrequest"
MOVIEHUB_ACCESS_USERS_COLLECTION = "moviehubusers"
YT_DOWNLOADS_COLLECTION = "ytdownloads"
BUZZWATCH_ITEMS_COLLECTION = "buzzwatchitems"
BUZZWATCH_META_COLLECTION = "buzzwatchmeta"
BUZZWATCH_PREFERENCES_COLLECTION = "buzzwatchpreferences"

moviehub_conversations: Dict[str, Dict[str, Any]] = {}
mongo_client: Optional[MongoClient] = None
