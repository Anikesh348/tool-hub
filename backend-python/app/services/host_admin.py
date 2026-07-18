import http.client
import json
import os
import socket
from typing import Any, Dict


class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path: str, timeout: int = 5):
        super().__init__("localhost", timeout=timeout)
        self.socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


def host_admin_request(method: str, path: str, timeout: int = 5) -> Dict[str, Any]:
    secret = os.getenv("TOOLHUB_ADMIN_AGENT_SECRET", "").strip()
    if not secret:
        raise RuntimeError("Host administration agent is not configured")
    connection = UnixHTTPConnection(os.getenv("TOOLHUB_ADMIN_SOCKET", "/run/toolhub-admin/agent.sock"), timeout=timeout)
    try:
        connection.request(method, path, headers={"X-ToolHub-Admin-Secret": secret})
        response = connection.getresponse()
        payload = json.loads(response.read().decode("utf-8") or "{}")
        if response.status >= 400:
            raise RuntimeError(payload.get("error") or "Host administration action failed")
        return payload
    except (OSError, ValueError, http.client.HTTPException) as exc:
        raise RuntimeError("Host administration agent is unavailable") from exc
    finally:
        connection.close()
