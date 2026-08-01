const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export interface User {
  name: string;
  email: string;
  password: string;
  userId: string;
  profilePicture: string | undefined;
  role: string;
}

const jsonRequest = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const AuthService = {
  baseLogin: (email: string, password: string) => ({
    url: BASE_URL + "/v2/login",
    options: jsonRequest("POST", {
      email,
      password,
      type: "base",
    }),
  }),
  googleLogin: (credential: string) => ({
    url: BASE_URL + "/v2/login",
    options: jsonRequest("POST", {
      credential,
      provider: "google",
    }),
  }),
  refreshSession: () => ({
    url: BASE_URL + "/v2/token/refresh",
    options: jsonRequest("POST"),
  }),
  currentSession: () => ({
    url: BASE_URL + "/v2/session",
    options: {
      method: "GET",
      credentials: "include" as const,
    },
  }),
  logout: () => ({
    url: BASE_URL + "/v2/logout",
    options: jsonRequest("POST"),
  }),
  baseRegister: (user: User) => ({
    url: BASE_URL + "/v2/register",
    options: jsonRequest("POST", user),
  }),
};
