import hmac
import os
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from app.routes.admin_home_routes import big_lights_guard, small_lights_guard
from app.routes.admin_settings_routes import audit
from app.services.mongo import col
from app.utils.responses import error, success

router = APIRouter(prefix="/v2/alexa", tags=["alexa"])

ACTIONS: Dict[str, Dict[str, Any]] = {
    "big_lights_guard": {
        "description": "Arm or disarm the Big Lights safeguard",
        "mongo_key": "big_lights_guard",
        "apply": big_lights_guard,
        "voice_name": "Big Lights safeguard",
    },
    "small_lights_guard": {
        "description": "Arm or disarm the Small Lights safeguard",
        "mongo_key": "small_lights_guard",
        "apply": small_lights_guard,
        "voice_name": "Small Lights safeguard",
    },
}


def _require_ingest_key(supplied: Optional[str]) -> None:
    expected = os.getenv("TOOLHUB_ALERT_INGEST_KEY", "").strip()
    value = (supplied or "").strip()
    if not expected or not value or not hmac.compare_digest(expected, value):
        raise HTTPException(status_code=401, detail="Invalid Alexa ingest key")


def _apply_guard(apply: Callable[[str], Dict[str, bool]], state: str, apply_to_ha: bool) -> Dict[str, bool]:
    if apply_to_ha:
        return apply(state)
    return {"enabled": state == "on"}


@router.get("/actions")
def list_alexa_actions(
    x_toolhub_alert_key: Optional[str] = Header(None, alias="X-ToolHub-Alert-Key"),
):
    _require_ingest_key(x_toolhub_alert_key)
    return success(
        {
            "actions": [
                {
                    "action": name,
                    "description": spec["description"],
                    "voiceName": spec["voice_name"],
                    "states": ["on", "off"],
                }
                for name, spec in ACTIONS.items()
            ]
        }
    )


@router.post("/actions")
async def ingest_alexa_action(
    request: Request,
    x_toolhub_alert_key: Optional[str] = Header(None, alias="X-ToolHub-Alert-Key"),
):
    _require_ingest_key(x_toolhub_alert_key)
    body = await request.json()
    action = str(body.get("action") or "").strip()
    state = str(body.get("state") or "").strip().lower()
    source = str(body.get("source") or "unknown").strip()[:80] or "unknown"
    apply_to_ha = bool(body.get("applyToHa", True))
    spec = ACTIONS.get(action)
    if spec is None:
        return JSONResponse(status_code=400, content=error("Unknown Alexa action"))
    if state not in {"on", "off"}:
        return JSONResponse(status_code=400, content=error("state must be on or off"))
    try:
        result = _apply_guard(spec["apply"], state, apply_to_ha)
        col("homeguardstate").update_one(
            {"key": spec["mongo_key"]},
            {
                "$set": {
                    "enabled": result["enabled"],
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "updatedBy": source,
                }
            },
            upsert=True,
        )
        audit(
            {"userId": "alexa-layer", "email": source},
            "ALEXA_ACTION",
            "COMPLETED",
            {"action": action, "state": state, "applyToHa": apply_to_ha, **result},
        )
        return success({"action": action, "state": state, **result})
    except (RuntimeError, ValueError) as exc:
        audit(
            {"userId": "alexa-layer", "email": source},
            "ALEXA_ACTION",
            "FAILED",
            {"action": action, "state": state, "applyToHa": apply_to_ha, "error": str(exc)},
        )
        return JSONResponse(status_code=503, content=error(str(exc)))
