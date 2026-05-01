from app.services.products import check_all_products
from app.utils.responses import success


def schedule_price_check():
    summary = check_all_products()
    return success({"message": "Price check scheduled successfully", **summary})
