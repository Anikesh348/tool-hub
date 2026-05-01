import os
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pymongo import MongoClient
from pymongo.collection import Collection

from app.core import config
from app.utils.responses import jsonable


def db():
    if config.mongo_client is None:
        db_url = os.getenv("DB_URL")
        if not db_url:
            raise RuntimeError("DB_URL is not configured")
        config.mongo_client = MongoClient(db_url, serverSelectionTimeoutMS=30000)
    return config.mongo_client[config.DB_NAME]


def col(name: str) -> Collection:
    return db()[name]


def find(name: str, query: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [jsonable(doc) for doc in col(name).find(query)]


def find_one(name: str, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    doc = col(name).find_one(query)
    return jsonable(doc) if doc else None


def insert(name: str, record: Dict[str, Any]) -> None:
    col(name).insert_one(record)


def update_one_or_404(name: str, query: Dict[str, Any], update: Dict[str, Any]) -> None:
    result = col(name).find_one_and_update(query, update)
    if result is None:
        raise HTTPException(status_code=404, detail="No matching document found")


def delete_one_or_404(name: str, query: Dict[str, Any]) -> None:
    result = col(name).find_one_and_delete(query)
    if result is None:
        raise HTTPException(status_code=404, detail="No matching document found")
