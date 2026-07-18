import asyncio
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict

import requests
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.middlewares.auth import admin_user
from app.utils.responses import success

router = APIRouter()
NETDATA_URL = os.getenv("NETDATA_URL", "http://host.docker.internal:19999").rstrip("/")
GATUS_URL = os.getenv("GATUS_URL", "http://gatus:8082").rstrip("/")


def netdata_get(path: str, params: Dict[str, Any] | None = None) -> Any:
    try:
        response = requests.get(f"{NETDATA_URL}{path}", params=params, timeout=5)
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError) as exc:
        raise HTTPException(status_code=502, detail="System metrics are temporarily unavailable") from exc


def chart_data(chart: str, *, seconds: int = 120, points: int = 60) -> Dict[str, Any]:
    return netdata_get(
        "/api/v1/data",
        {
            "chart": chart,
            "after": -seconds,
            "points": points,
            "group": "average",
            "format": "json",
        },
    )


def all_metrics() -> Dict[str, Any]:
    return netdata_get(
        "/api/v1/allmetrics",
        {
            "format": "json",
            "filter": (
                "system.cpu system.ram system.load system.io system.net system.uptime "
                "app.*_cpu_utilization app.*_mem_usage app.*_processes "
                "disk_space./ sensors.temperature_cpu_thermal-virtual-0_temp1_input"
            ),
        },
    )


def dimension_values(snapshot: Dict[str, Any], chart: str) -> tuple[int, Dict[str, float]]:
    metric = snapshot.get(chart) or {}
    values = {}
    for key, dimension in (metric.get("dimensions") or {}).items():
        name = dimension.get("name") or key
        try:
            values[name] = float(dimension.get("value") or 0)
        except (TypeError, ValueError):
            values[name] = 0.0
    return int(metric.get("last_updated") or 0), values


def process_breakdown(snapshot: Dict[str, Any], memory_total_mib: float) -> list[Dict[str, Any]]:
    processes: Dict[str, Dict[str, Any]] = {}
    suffixes = {
        "_cpu_utilization": "cpuPercent",
        "_mem_usage": "memoryMiB",
        "_processes": "processCount",
    }
    for chart, metric in snapshot.items():
        if not chart.startswith("app."):
            continue
        for suffix, field in suffixes.items():
            if not chart.endswith(suffix):
                continue
            name = chart[4:-len(suffix)]
            entry = processes.setdefault(
                name,
                {"name": name, "cpuPercent": 0.0, "memoryMiB": 0.0, "processCount": 0},
            )
            value = sum(
                float(dimension.get("value") or 0)
                for dimension in (metric.get("dimensions") or {}).values()
            )
            entry[field] = int(value) if field == "processCount" else value
            break

    active = [entry for entry in processes.values() if entry["processCount"] > 0]
    for entry in active:
        entry["memoryPercent"] = (
            entry["memoryMiB"] / memory_total_mib * 100 if memory_total_mib else 0
        )

    # Keep the union of both rankings so low-CPU, high-memory applications are not lost.
    top_cpu = sorted(active, key=lambda item: item["cpuPercent"], reverse=True)[:15]
    top_memory = sorted(active, key=lambda item: item["memoryMiB"], reverse=True)[:15]
    selected = {entry["name"]: entry for entry in (*top_cpu, *top_memory)}
    return sorted(selected.values(), key=lambda item: item["cpuPercent"], reverse=True)


def current_metrics() -> Dict[str, Any]:
    snapshot = all_metrics()
    latest = {
        "cpu": dimension_values(snapshot, "system.cpu"),
        "memory": dimension_values(snapshot, "system.ram"),
        "load": dimension_values(snapshot, "system.load"),
        "diskIo": dimension_values(snapshot, "system.io"),
        "network": dimension_values(snapshot, "system.net"),
        "temperature": dimension_values(
            snapshot, "sensors.temperature_cpu_thermal-virtual-0_temp1_input"
        ),
        "disk": dimension_values(snapshot, "disk_space./"),
        "uptime": dimension_values(snapshot, "system.uptime"),
    }
    updated_times = [timestamp for timestamp, _ in latest.values()]
    cpu = latest["cpu"][1]
    memory = latest["memory"][1]
    load = latest["load"][1]
    disk_io = latest["diskIo"][1]
    network = latest["network"][1]
    temperature = latest["temperature"][1]
    disk = latest["disk"][1]
    uptime = latest["uptime"][1]
    sampled_at = max(updated_times, default=int(time.time()))
    oldest_sample_at = min(
        (updated_at for updated_at in updated_times if updated_at),
        default=int(time.time()),
    )
    memory_total = sum(memory.get(key, 0) for key in ("free", "used", "cached", "buffers"))
    disk_usable = disk.get("used", 0) + disk.get("avail", 0)
    cpu_active = sum(value for key, value in cpu.items() if key != "idle")

    return {
        "sampledAt": sampled_at,
        "sampleAgeSeconds": max(0, int(time.time()) - oldest_sample_at),
        "cpu": {
            "percent": max(0, min(100, cpu_active)),
            "user": cpu.get("user", 0),
            "system": cpu.get("system", 0),
            "nice": cpu.get("nice", 0),
            "iowait": cpu.get("iowait", 0),
            "softirq": cpu.get("softirq", 0),
            "irq": cpu.get("irq", 0),
            "steal": cpu.get("steal", 0),
        },
        "memory": {
            "percent": (memory.get("used", 0) / memory_total * 100) if memory_total else 0,
            "usedMiB": memory.get("used", 0),
            "cachedMiB": memory.get("cached", 0),
            "freeMiB": memory.get("free", 0),
            "availableMiB": sum(memory.get(key, 0) for key in ("free", "cached", "buffers")),
            "totalMiB": memory_total,
        },
        "load": {
            "load1": load.get("load1", 0),
            "load5": load.get("load5", 0),
            "load15": load.get("load15", 0),
        },
        "disk": {
            "percent": (disk.get("used", 0) / disk_usable * 100) if disk_usable else 0,
            "usedGiB": disk.get("used", 0),
            "availableGiB": disk.get("avail", 0),
            "usableGiB": disk_usable,
            "reservedGiB": disk.get("reserved for root", 0),
        },
        "diskIo": {
            "readKiBps": abs(disk_io.get("reads", 0)),
            "writeKiBps": abs(disk_io.get("writes", 0)),
        },
        "network": {
            "receivedKbps": abs(network.get("received", 0)),
            "sentKbps": abs(network.get("sent", 0)),
        },
        "temperatureCelsius": temperature.get("input", 0),
        "uptimeSeconds": uptime.get("uptime", 0),
        "processes": process_breakdown(snapshot, memory_total),
    }


@router.get("/v2/admin/proxy/authorize")
def authorize_admin_proxy(_: Dict[str, str] = Depends(admin_user)):
    return {"authorized": True}


@router.get("/v2/admin/uptime")
def uptime_overview(_: Dict[str, str] = Depends(admin_user)):
    try:
        response = requests.get(f"{GATUS_URL}/api/v1/endpoints/statuses", timeout=10)
        response.raise_for_status()
        statuses = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Uptime data is temporarily unavailable") from exc

    endpoints = []
    for endpoint in statuses:
        results = endpoint.get("results") or []
        latest = results[-1] if results else {}
        successful = sum(1 for result in results if result.get("success"))
        durations = [float(result.get("duration") or 0) / 1_000_000 for result in results]
        endpoints.append(
            {
                "key": endpoint.get("key"),
                "name": endpoint.get("name"),
                "group": endpoint.get("group") or "Other",
                "healthy": bool(latest.get("success")),
                "uptimePercent": (successful / len(results) * 100) if results else 0,
                "averageResponseMs": (sum(durations) / len(durations)) if durations else 0,
                "lastResponseMs": float(latest.get("duration") or 0) / 1_000_000,
                "lastCheckedAt": latest.get("timestamp"),
                "statusCode": latest.get("status"),
                "errors": latest.get("errors") or [],
                "sampleCount": len(results),
            }
        )

    endpoints.sort(key=lambda item: (item["group"], item["name"]))
    return success({"generatedAt": int(time.time()), "endpoints": endpoints})


@router.get("/v2/admin/system-metrics/live")
def system_metrics_live(_: Dict[str, str] = Depends(admin_user)):
    return current_metrics()


@router.get("/v2/admin/system-metrics/stream")
async def system_metrics_stream(
    request: Request,
    _: Dict[str, str] = Depends(admin_user),
):
    async def events():
        yield "retry: 2000\n\n"
        while not await request.is_disconnected():
            started_at = time.monotonic()
            try:
                payload = await asyncio.to_thread(current_metrics)
                yield (
                    f"id: {payload['sampledAt']}\n"
                    "event: metrics\n"
                    f"data: {json.dumps(payload, separators=(',', ':'))}\n\n"
                )
            except HTTPException as exc:
                yield (
                    "event: stream-error\n"
                    f"data: {json.dumps({'message': str(exc.detail)})}\n\n"
                )
            elapsed = time.monotonic() - started_at
            await asyncio.sleep(max(0.1, 1.0 - elapsed))

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/v2/admin/system-metrics")
def system_metrics(_: Dict[str, str] = Depends(admin_user)):
    history_charts = {
        "cpu": "system.cpu",
        "memory": "system.ram",
        "load": "system.load",
        "diskIo": "system.io",
        "network": "system.net",
        "temperature": "sensors.temperature_cpu_thermal-virtual-0_temp1_input",
    }
    with ThreadPoolExecutor(max_workers=8) as executor:
        info_future = executor.submit(netdata_get, "/api/v1/info")
        alarms_future = executor.submit(
            netdata_get,
            "/api/v1/alarms",
            {"all": "true"},
        )
        live_future = executor.submit(current_metrics)
        chart_futures = {
            key: executor.submit(chart_data, chart)
            for key, chart in history_charts.items()
        }
        info = info_future.result()
        alarms_response = alarms_future.result()
        live = live_future.result()
        charts = {
            key: future.result()
            for key, future in chart_futures.items()
        }
    alarms = [
        {
            "name": name,
            "status": alarm.get("status"),
            "value": alarm.get("value"),
            "units": alarm.get("units"),
            "info": alarm.get("info"),
        }
        for name, alarm in alarms_response.get("alarms", {}).items()
        if alarm.get("status") in {"WARNING", "CRITICAL"}
    ]

    return {
        "host": {
            "hostname": (info.get("mirrored_hosts") or ["pi-purva"])[0],
            "version": info.get("version"),
            "osName": info.get("os_name"),
            "osVersion": info.get("os_version"),
            "kernelVersion": info.get("kernel_version"),
            "architecture": info.get("architecture"),
            "cores": info.get("cores_total"),
            "cpuFrequency": info.get("cpu_freq"),
            "ramBytes": info.get("ram_total"),
            "diskBytes": info.get("total_disk_space"),
        },
        "live": live,
        "charts": charts,
        "alarms": alarms,
    }
