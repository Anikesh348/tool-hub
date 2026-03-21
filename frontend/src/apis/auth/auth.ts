const BASE_URL = import.meta.env.VITE_BASE_BACKEND_URL;

export interface User {
  name: string;
  email: string;
  password: string;
  userId: string;
  profilePicture: string | undefined;
  role: string;
}

export interface AuthTokens {
  token: string;
  accessToken: string;
  refreshToken: string;
}

export const AuthService = {
  baseLogin: (email: string, password: string) => ({
    url: BASE_URL + "/v2/login",
    options: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: email,
        password: password,
        type: "base",
      }),
    },
  }),
  googleLogin: (token: string) => {
    return {
      url: BASE_URL + "/v2/login",
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: token,
          type: "google",
        }),
      },
    };
  },
  refreshToken: (refreshToken: string) => {
    return {
      url: BASE_URL + "/v2/token/refresh",
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          refreshToken,
        }),
      },
    };
  },
  baseRegister: (user: User) => {
    return {
      url: BASE_URL + "/v2/register",
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(user),
      },
    };
  },
};
