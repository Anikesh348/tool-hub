import http.client
import json
import os
import socket
from typing import Any, Dict
from urllib.parse import urlparse


class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path: str, timeout: int = 5):
        super().__init__("localhost", timeout=timeout)
        self.socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


def _admin_request(
    method: str,
    path: str,
    secret: str,
    timeout: int,
    *,
    socket_path: str | None = None,
    base_url: str | None = None,
) -> Dict[str, Any]:
    if not secret:
        raise RuntimeError("Host administration agent is not configured")

    request_path = path
    if base_url:
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise RuntimeError("Remote host administration URL is invalid")
        connection_class = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_class(parsed.hostname, parsed.port, timeout=timeout)
        request_path = f"{parsed.path.rstrip('/')}{path}"
    else:
        connection = UnixHTTPConnection(socket_path or "/run/toolhub-admin/agent.sock", timeout=timeout)

    try:
        connection.request(method, request_path, headers={"X-ToolHub-Admin-Secret": secret})
        response = connection.getresponse()
        payload = json.loads(response.read().decode("utf-8") or "{}")
        if response.status >= 400:
            raise RuntimeError(payload.get("error") or "Host administration action failed")
        return payload
    except (OSError, ValueError, http.client.HTTPException) as exc:
        raise RuntimeError("Host administration agent is unavailable") from exc
    finally:
        connection.close()


def host_admin_request(method: str, path: str, timeout: int = 5) -> Dict[str, Any]:
    return _admin_request(
        method,
        path,
        os.getenv("TOOLHUB_ADMIN_AGENT_SECRET", "").strip(),
        timeout,
        socket_path=os.getenv("TOOLHUB_ADMIN_SOCKET", "/run/toolhub-admin/agent.sock"),
    )


def pi_host_admin_request(method: str, path: str, timeout: int = 5) -> Dict[str, Any]:
    base_url = os.getenv("TOOLHUB_PI_ADMIN_URL", "").strip()
    if not base_url:
        return host_admin_request(method, path, timeout)
    return _admin_request(
        method,
        path,
        os.getenv("TOOLHUB_PI_ADMIN_AGENT_SECRET", os.getenv("TOOLHUB_ADMIN_AGENT_SECRET", "")).strip(),
        timeout,
        base_url=base_url,
    )


def codex_host_admin_request(method: str, path: str, timeout: int = 5) -> Dict[str, Any]:
    base_url = os.getenv("TOOLHUB_CODEX_ADMIN_URL", "").strip()
    if not base_url:
        raise RuntimeError("Codex fleet speed-test agent is not configured")
    return _admin_request(
        method,
        path,
        os.getenv(
            "TOOLHUB_CODEX_ADMIN_AGENT_SECRET",
            os.getenv("TOOLHUB_ADMIN_AGENT_SECRET", ""),
        ).strip(),
        timeout,
        base_url=base_url,
    )
