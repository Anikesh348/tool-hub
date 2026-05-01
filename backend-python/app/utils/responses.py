from datetime import datetime, timezone
from typing import Any, Dict

from bson import ObjectId


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def jsonable(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, list):
        return [jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    return value


def success(message: Any) -> Dict[str, Any]:
    return {"response": jsonable(message)}


def error(message: Any) -> Dict[str, Any]:
    return {"error": message}
