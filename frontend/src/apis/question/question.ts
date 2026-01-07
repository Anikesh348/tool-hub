const BASE_URL = import.meta.env.VITE_BASE_BACKEND_URL;

export const LeetCodeService = {
  addQuestions: (questionUrls: string[]) => {
    return {
      url: `${BASE_URL}/v2/leetcode/add`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({ questionUrls }),
      },
    };
  },

  getQuestions: (tags?: string[], operation?: "union" | "intersection") => {
    let url = `${BASE_URL}/v2/leetcode/questions`;
    if (tags && tags.length > 0) {
      const params = new URLSearchParams();
      tags.forEach((tag) => params.append("tags", tag));
      if (operation) params.append("operation", operation);
      url += `?${params.toString()}`;
    }
    return {
      url,
      options: {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
      },
    };
  },

  deleteQuestion: (questionId: string) => {
    return {
      url: `${BASE_URL}/v2/leetcode/delete`,
      options: {
        method: "POST", // use DELETE if backend supports
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({ questionId }),
      },
    };
  },

  updateQuestionStatus: (questionId: string, status: string) => {
    return {
      url: `${BASE_URL}/v2/leetcode/update-status`,
      options: {
        method: "POST", // or PATCH if backend supports
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({
          questionId,
          status,
        }),
      },
    };
  },
  updateQuestionNotes: (questionId: string, notes: string) => {
    return {
      url: `${BASE_URL}/v2/leetcode/update-notes`,
      options: {
        method: "POST", // or PATCH if backend supports
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({
          questionId,
          notes,
        }),
      },
    };
  },

  applyTags: (questionId: string, tags: string[]) => {
    return {
      url: `${BASE_URL}/v2/leetcode/applyTags`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({ questionId, tags }),
      },
    };
  },

  filterWithTags: (tags: string[], operation: "union" | "intersection") => {
    return {
      url: `${BASE_URL}/v2/leetcode/filterWithTags`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("authToken")}`,
        },
        body: JSON.stringify({ tags, operation }),
      },
    };
  },
};
