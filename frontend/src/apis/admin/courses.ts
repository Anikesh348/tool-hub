import { refreshAccessToken } from "../auth/authSession";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export interface CourseModuleSummary {
  id: string;
  courseId: string;
  slug: string;
  position: number;
  title: string;
  duration: string;
  excerpt: string;
  readingMinutes: number;
  completed: boolean;
  readingProgress: number;
}

export interface CourseSummary {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  level: string;
  estimatedHours: string;
  moduleCount: number;
  completedModuleCount: number;
}

export interface Course extends CourseSummary {
  modules: CourseModuleSummary[];
}

export interface CourseQuestion {
  id: string;
  courseId: string;
  moduleId: string;
  moduleSlug: string;
  selectedText: string;
  question: string;
  answer: string;
  status: "pending" | "completed" | "failed";
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface CourseModule extends CourseModuleSummary {
  content: string;
  questions: CourseQuestion[];
}

const requestJson = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const send = () => fetch(url, {
    ...(options || {}),
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  let response = await send();
  if (response.status === 401 && (await refreshAccessToken())) response = await send();
  const text = await response.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!response.ok) {
    const message = body?.error?.message || body?.error || body?.detail || `Course request failed (${response.status})`;
    throw new Error(message);
  }
  return body?.response as T;
};

export const CourseService = {
  list: () => requestJson<{ items: CourseSummary[] }>(`${BASE_URL}/v2/admin/courses`),
  get: (courseId: string) => requestJson<{ course: Course }>(
    `${BASE_URL}/v2/admin/courses/${encodeURIComponent(courseId)}`,
  ),
  getModule: (courseId: string, moduleSlug: string) => requestJson<{ module: CourseModule }>(
    `${BASE_URL}/v2/admin/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(moduleSlug)}`,
  ),
  saveProgress: (courseId: string, moduleSlug: string, readingProgress: number, completed: boolean) =>
    requestJson<{ moduleId: string; readingProgress: number; completed: boolean }>(
      `${BASE_URL}/v2/admin/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(moduleSlug)}/progress`,
      { method: "PATCH", body: JSON.stringify({ readingProgress, completed }) },
    ),
  ask: (courseId: string, moduleSlug: string, body: {
    selectedText: string;
    question: string;
    contextBefore: string;
    contextAfter: string;
  }) => requestJson<{ accepted: boolean; question: CourseQuestion }>(
    `${BASE_URL}/v2/admin/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(moduleSlug)}/questions`,
    { method: "POST", body: JSON.stringify(body) },
  ),
  getQuestion: (questionId: string) => requestJson<{ question: CourseQuestion }>(
    `${BASE_URL}/v2/admin/courses/questions/${encodeURIComponent(questionId)}`,
  ),
};
