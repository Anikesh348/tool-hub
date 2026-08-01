import { useCallback, useState } from "react";
import { refreshAccessToken } from "../apis/auth/authSession";

interface ApiFetcherState {
  loading: boolean;
  data: any;
  error: string | null;
}

const readResponseBody = async (response: Response): Promise<any | null> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const isSessionEndpoint = (url: string): boolean =>
  ["/v2/login", "/v2/register", "/v2/token/refresh", "/v2/logout"].some(
    (path) => url.includes(path)
  );

const withCredentials = (options?: RequestInit): RequestInit => ({
  ...(options || {}),
  credentials: "include",
});

export const useApiFetcher = () => {
  const [state, setState] = useState<ApiFetcherState>({
    loading: false,
    data: null,
    error: null,
  });

  const fetchData = useCallback(async (url: string, options?: RequestInit) => {
    setState((prev) => ({ ...prev, loading: true }));

    try {
      const preparedOptions = withCredentials(options);
      let response = await fetch(url, preparedOptions);

      if (
        response.status === 401 &&
        !isSessionEndpoint(url) &&
        (await refreshAccessToken())
      ) {
        response = await fetch(url, preparedOptions);
      }

      const body = await readResponseBody(response);
      if (!response.ok) {
        setState({
          loading: false,
          data: { body, status: response.status },
          error: body?.error || body?.message || response.statusText,
        });
        return;
      }

      setState({
        loading: false,
        data: { body, status: response.status },
        error: null,
      });
    } catch (err: any) {
      setState({
        loading: false,
        data: { body: null, status: 500 },
        error: err?.message || "error",
      });
    }
  }, []);

  return { ...state, fetchData };
};
