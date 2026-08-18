import asyncio
from typing import Dict

from fastapi import APIRouter, Depends, Query, Request

from app.middlewares.auth import current_user
from app.services.products import (
    delete_product_target,
    get_price_history,
    get_price_summaries,
    get_products,
    save_product,
    search_products,
)

router = APIRouter()


@router.post("/v2/save-product")
async def save_product_route(request: Request, user: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    return await asyncio.to_thread(save_product, body, user)


@router.get("/v2/products")
def products_route(user: Dict[str, str] = Depends(current_user)):
    return get_products(user)


@router.get("/search")
@router.get("/v2/search")
def search_products_route(
    query: str = Query(..., min_length=1),
    platform: str = Query(
        ...,
        pattern="^(amazon|flipkart|myntra|nykaa|ajio|tatacliq|croma|meesho|shopsy|snapdeal|firstcry|bigbasket|reliancedigital|vijaysales|jiomart)$",
    ),
):
    return search_products(query, platform)


@router.post("/v2/pricehistory")
async def price_history_route(request: Request, _: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    return await asyncio.to_thread(get_price_history, body.get("productId"))


@router.post("/v2/price-summary")
async def price_summary_route(request: Request, _: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    product_ids = body.get("productIds") or []
    return await asyncio.to_thread(get_price_summaries, product_ids)


@router.post("/v2/delete")
async def delete_product_route(request: Request, user: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    return await asyncio.to_thread(
        delete_product_target, body.get("productId"), body.get("targetPrice"), user
    )
