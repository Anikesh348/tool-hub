import { getBearerAuthHeader } from "../auth/tokenStorage";

const BASE_URL = import.meta.env.VITE_BASE_BACKEND_URL;

export const CinePilotService = {
  chat: (userInput: string, conversationId: string) => {
    return {
      url: `${BASE_URL}/v2/moviehub/chat/completions`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getBearerAuthHeader(),
        },
        body: JSON.stringify({
          userInput,
          conversationId,
        }),
      },
    };
  },
};
