from typing import Any, Dict

from app.services.host_admin import host_admin_request

VALID_SLUGS = {"connectivity-alert", "log-digest", "docker-update"}


def _check_slug(slug: str) -> None:
    if slug not in VALID_SLUGS:
        raise ValueError("Unknown scheduled job")


def list_jobs() -> Dict[str, Any]:
    """Job metadata uses hyphenated slugs (matching the systemd timer unit
    names); recorded run history uses underscored job names (matching the
    systemd service instance / opsched module names, e.g. connectivity_alert).
    Add historyKey to each job so the frontend doesn't need to know this.
    """
    result = host_admin_request("GET", "/v1/scheduler/jobs")
    for job in result.get("jobs", []):
        job["historyKey"] = job["slug"].replace("-", "_")
    return result


def set_schedule(slug: str, schedule: str) -> Dict[str, Any]:
    _check_slug(slug)
    schedule = str(schedule or "").strip()
    if not schedule:
        raise ValueError("schedule is required")
    return host_admin_request(
        "POST", f"/v1/scheduler/jobs/{slug}/schedule", body={"schedule": schedule}
    )


def set_enabled(slug: str, enabled: bool) -> Dict[str, Any]:
    _check_slug(slug)
    action = "enable" if enabled else "disable"
    return host_admin_request("POST", f"/v1/scheduler/jobs/{slug}/{action}")
