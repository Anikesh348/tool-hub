import { useCallback, useState } from "react";
import { refreshAccessToken } from "../apis/auth/authSession";
import { getAccessToken } from "../apis/auth/tokenStorage";

interface ApiFetcherState {
  loading: boolean;
  data: any;
  error: string | null;
}

const hasAuthorizationHeader = (headers?: HeadersInit): boolean => {
  if (!headers) return false;
  const normalizedHeaders = new Headers(headers);
  return normalizedHeaders.has("Authorization");
};

const withLatestAccessToken = (options?: RequestInit): RequestInit | undefined => {
  if (!options) return options;

  const headers = new Headers(options.headers || {});
  if (headers.has("Authorization")) {
    const accessToken = getAccessToken();
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  return {
    ...options,
    headers,
  };
};

const readResponseBody = async (response: Response): Promise<any | null> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export const useApiFetcher = () => {
  const [state, setState] = useState<ApiFetcherState>({
    loading: false,
    data: null,
    error: null,
  });

  const fetchData = useCallback(async (url: string, options?: RequestInit) => {
    setState((prev) => ({
      ...prev,
      loading: true,
    }));

    try {
      let preparedOptions = withLatestAccessToken(options);
      let response = await fetch(url, preparedOptions);

      const canAttemptRefresh = response.status === 401 && hasAuthorizationHeader(preparedOptions?.headers);
      if (canAttemptRefresh) {
        const refreshedAccessToken = await refreshAccessToken();
        if (refreshedAccessToken) {
          preparedOptions = withLatestAccessToken(preparedOptions);
          response = await fetch(url, preparedOptions);
        }
      }

      if (!response.ok) {
        const errorBody = await readResponseBody(response);

        setState({
          loading: false,
          data: {
            body: errorBody,
            status: response.status,
          },
          error: errorBody?.error || errorBody?.message || response.statusText,
        });
        return;
      }

      const data = await readResponseBody(response);
      setState({
        loading: false,
        data: {
          body: data,
          status: response.status,
        },
        error: null,
      });
    } catch (err: any) {
      setState({
        loading: false,
        data: {
          body: null,
          status: 500,
        },
        error: err?.message || "error",
      });
    }
  }, []);

  return {
    ...state,
    fetchData,
  };
};
