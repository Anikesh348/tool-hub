import { refreshAccessToken } from "../auth/authSession";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export type BlogStatus = "DRAFT" | "PUBLISHED";

export interface BlogPost {
  slug: string;
  title: string;
  series?: string;
  seriesPart?: number;
  excerpt: string;
  content?: string;
  coverImage?: string;
  tags: string[];
  author: string;
  status: BlogStatus;
  viewCount: number;
  likeCount: number;
  shareCount: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  readingMinutes?: number;
}

export interface BlogVersion {
  versionId: string;
  slug: string;
  name: string;
  versionNumber: number;
  status: BlogStatus;
  isCurrent: boolean;
  title: string;
  excerpt: string;
  content: string;
  coverImage?: string;
  tags: string[];
  author: string;
  series?: string;
  seriesPart?: number;
  readingMinutes?: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface BlogVersionList {
  currentVersionId?: string;
  items: BlogVersion[];
}

export interface BlogComment {
  commentId: string;
  slug: string;
  content: string;
  authorName: string;
  authorProfilePicture?: string;
  createdAt: string;
  canDelete?: boolean;
}

export interface BlogTermSummary {
  termId: string;
  term: string;
  summary: string;
  cached: boolean;
}

export interface BlogMetrics {
  rangeDays: number;
  totalViews: number;
  uniqueVisitors: number;
  viewsToday: number;
  totalLikes: number;
  likesInRange: number;
  totalShares: number;
  totalComments: number;
  averageEngagedSeconds: number;
  completionRate: number;
  daily: Array<{ date: string; views: number; likes: number; shares: number; comments: number }>;
  topPosts: Array<{ slug: string; title: string; views: number; uniqueVisitors: number; likes: number; shares: number; comments: number }>;
  referrers: Array<{ label: string; views: number }>;
  devices: Array<{ label: string; views: number }>;
  shareChannels: Array<{ label: string; shares: number }>;
}

const requestJson = async <T>(url: string, options?: RequestInit, admin = false): Promise<T> => {
  const send = () => fetch(url, { ...options, credentials: "include" });
  let response = await send();
  if (admin && response.status === 401 && (await refreshAccessToken())) response = await send();
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || body?.detail || "Blog request failed");
  return body?.response as T;
};

const jsonOptions = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const blogEventUrl = (slug: string) =>
  `${BASE_URL}/v2/blogs/${encodeURIComponent(slug)}/events`;

export const BlogService = {
  list: () => requestJson<{ items: BlogPost[] }>(`${BASE_URL}/v2/blogs`),
  get: (slug: string) => requestJson<BlogPost>(`${BASE_URL}/v2/blogs/${encodeURIComponent(slug)}`),
  termSummary: (slug: string, termId: string) =>
    requestJson<BlogTermSummary>(
      `${BASE_URL}/v2/blogs/${encodeURIComponent(slug)}/term-summary`,
      jsonOptions("POST", { termId }),
    ),
  track: (slug: string, event: Record<string, unknown>) =>
    requestJson<{ recorded: boolean; viewCount?: number; shareCount?: number }>(blogEventUrl(slug), jsonOptions("POST", event)),
  reaction: (slug: string, visitorId: string, action: "status" | "like" | "unlike") =>
    requestJson<{ liked: boolean; changed: boolean; likeCount: number; shareCount: number }>(
      `${BASE_URL}/v2/blogs/${encodeURIComponent(slug)}/reaction`,
      jsonOptions("POST", { visitorId, action }),
    ),
  comments: (slug: string) =>
    requestJson<{ items: BlogComment[] }>(`${BASE_URL}/v2/blogs/${encodeURIComponent(slug)}/comments`, undefined, true),
  createComment: (slug: string, content: string) =>
    requestJson<BlogComment>(
      `${BASE_URL}/v2/blogs/${encodeURIComponent(slug)}/comments`,
      jsonOptions("POST", { content }),
      true,
    ),
  deleteComment: (slug: string, commentId: string) =>
    requestJson<{ deleted: boolean; commentId: string }>(
      `${BASE_URL}/v2/blogs/${encodeURIComponent(slug)}/comments/${encodeURIComponent(commentId)}`,
      jsonOptions("DELETE"),
      true,
    ),
  adminList: () => requestJson<{ items: BlogPost[] }>(`${BASE_URL}/v2/admin/blogs`, undefined, true),
  create: (post: Partial<BlogPost>) =>
    requestJson<BlogPost>(`${BASE_URL}/v2/admin/blogs`, jsonOptions("POST", post), true),
  update: (slug: string, post: Partial<BlogPost>) =>
    requestJson<BlogPost>(`${BASE_URL}/v2/admin/blogs/${encodeURIComponent(slug)}`, jsonOptions("PUT", post), true),
  versions: (slug: string) =>
    requestJson<BlogVersionList>(`${BASE_URL}/v2/admin/blogs/${encodeURIComponent(slug)}/versions`, undefined, true),
  createVersion: (slug: string, name: string, sourceVersionId?: string) =>
    requestJson<BlogVersion>(
      `${BASE_URL}/v2/admin/blogs/${encodeURIComponent(slug)}/versions`,
      jsonOptions("POST", { name, sourceVersionId }),
      true,
    ),
  updateVersion: (slug: string, versionId: string, version: Partial<BlogVersion>) =>
    requestJson<BlogVersion>(
      `${BASE_URL}/v2/admin/blogs/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionId)}`,
      jsonOptions("PUT", version),
      true,
    ),
  publishVersion: (slug: string, versionId: string) =>
    requestJson<{ post: BlogPost; version: BlogVersion }>(
      `${BASE_URL}/v2/admin/blogs/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionId)}/publish`,
      jsonOptions("POST"),
      true,
    ),
  metrics: (days = 30, slug?: string) => {
    const params = new URLSearchParams({ days: String(days) });
    if (slug) params.set("slug", slug);
    return requestJson<BlogMetrics>(`${BASE_URL}/v2/admin/blog-metrics?${params}`, undefined, true);
  },
  upload: async (file: File) => {
    const send = () => fetch(`${BASE_URL}/v2/admin/blog-assets`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": file.type, "X-Filename": file.name },
      body: file,
    });
    let response = await send();
    if (response.status === 401 && (await refreshAccessToken())) response = await send();
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || body?.detail || "Image upload failed");
    return body?.response as { assetId: string; url: string; markdown: string };
  },
};
