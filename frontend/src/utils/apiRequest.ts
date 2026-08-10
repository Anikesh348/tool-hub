import { refreshAccessToken } from "../apis/auth/authSession";

export interface JsonResponse<T = any> {
  status: number;
  body: T | null;
}

const isSessionEndpoint = (url: string): boolean =>
  ["/v2/login", "/v2/register", "/v2/token/refresh", "/v2/logout"].some((path) => url.includes(path));

// Same fetch semantics as useApiFetcher (credentials + one 401-retry), but
// callable directly so several requests can run concurrently (Promise.all)
// without racing against a single hook's shared state.
export async function requestJson<T = any>(url: string, options?: RequestInit): Promise<JsonResponse<T>> {
  const send = () => fetch(url, { ...(options || {}), credentials: "include" });
  let response = await send();
  if (response.status === 401 && !isSessionEndpoint(url) && (await refreshAccessToken())) {
    response = await send();
  }
  const text = await response.text();
  const body = text
    ? ((): T | null => {
        try {
          return JSON.parse(text) as T;
        } catch {
          return null;
        }
      })()
    : null;
  return { status: response.status, body };
}
