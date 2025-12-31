const BASE_URL = import.meta.env.VITE_BASE_BACKEND_URL;
export interface User {
  name: string;
  email: string;
  password: string;
  userId: string;
  profilePicture: string | undefined;
  role: string;
}
export const AuthService = {
  baseLogin: (email: string, password: string) => ({
    url: BASE_URL + "/api/login",
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
      url: BASE_URL + "/api/login",
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
  baseRegister: (user: User) => {
    return {
      url: BASE_URL + "/api/register",
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
