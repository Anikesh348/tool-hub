const BASE_URL = import.meta.env.VITE_BASE_BACKEND_URL;

export const CinePilotService = {
  chat: (userInput: string, conversationId: string) => {
    return {
      url: `${BASE_URL}/v2/admin/moviehub/chat/completions`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({
          userInput,
          conversationId,
        }),
      },
    };
  },
};
