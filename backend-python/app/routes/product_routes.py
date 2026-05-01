from typing import Dict

from fastapi import APIRouter, Depends, Request

from app.middlewares.auth import current_user
from app.services.products import delete_product_target, get_price_history, get_products, save_product

router = APIRouter()


@router.post("/v2/save-product")
async def save_product_route(request: Request, user: Dict[str, str] = Depends(current_user)):
    return save_product(await request.json(), user)


@router.get("/v2/products")
def products_route(user: Dict[str, str] = Depends(current_user)):
    return get_products(user)


@router.post("/v2/pricehistory")
async def price_history_route(request: Request, _: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    return get_price_history(body.get("productId"))


@router.post("/v2/delete")
async def delete_product_route(request: Request, user: Dict[str, str] = Depends(current_user)):
    body = await request.json()
    return delete_product_target(body.get("productId"), body.get("targetPrice"), user)
