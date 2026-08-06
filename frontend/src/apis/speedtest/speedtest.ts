const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

const publicFetch = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, { ...(options || {}), credentials: "include", cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || body?.detail || "Speed test request failed");
  }
  return response;
};

export const SpeedTestService = {
  createSession: async () => {
    const response = await publicFetch(`${BASE_URL}/v2/speedtest/session`, { method: "POST" });
    return (await response.json()).response as { sessionId: string; expiresInSeconds: number };
  },
  ping: async (sessionId: string, signal: AbortSignal) => {
    const query = new URLSearchParams({ session: sessionId, nonce: String(Date.now()) });
    const start = performance.now();
    await publicFetch(`${BASE_URL}/v2/speedtest/ping?${query}`, { signal });
    return performance.now() - start;
  },
  download: async (
    sessionId: string,
    bytes: number,
    signal: AbortSignal,
    onProgress?: (receivedBytes: number, milliseconds: number) => void,
  ) => {
    const query = new URLSearchParams({ session: sessionId, bytes: String(bytes), nonce: String(Date.now()) });
    const start = performance.now();
    const response = await publicFetch(`${BASE_URL}/v2/speedtest/download?${query}`, { signal });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Streaming downloads are not supported by this browser");
    let receivedBytes = 0;
    while (receivedBytes < bytes) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      onProgress?.(receivedBytes, performance.now() - start);
    }
    if (receivedBytes < bytes) throw new Error("The download sample ended early");
    void reader.cancel().catch(() => undefined);
    return { bytes: receivedBytes, milliseconds: performance.now() - start };
  },
  upload: async (sessionId: string, bytes: number, signal: AbortSignal) => {
    const query = new URLSearchParams({ session: sessionId, nonce: String(Date.now()) });
    const payload = new Uint8Array(bytes);
    const start = performance.now();
    await publicFetch(`${BASE_URL}/v2/speedtest/upload?${query}`, {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/octet-stream" },
      signal,
    });
    return { bytes, milliseconds: performance.now() - start };
  },
};
