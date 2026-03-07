export type MovieHubSection =
  | "open"
  | "request"
  | "status"
  | "admin_approve"
  | "admin_yt_download"
  | "admin_access"
  | "admin_users"
  | "available"
  | "downloading";

export type SectionConfig = {
  id: MovieHubSection;
  label: string;
  compactLabel: string;
  disabled?: boolean;
  adminOnly?: boolean;
  badgeCount?: number;
};
