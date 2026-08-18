import {
  Activity,
  BarChart3,
  CalendarClock,
  MapPin,
  MonitorOff,
  Settings,
  SquarePen,
  type LucideIcon,
} from "lucide-react";

export interface ServerAppLink {
  key: string;
  path: string;
  title: string;
  icon: LucideIcon;
  tone: "violet" | "blue" | "amber";
}

// The plain-route half of "Server Applications" — same shape as adminTools.ts
// entries (key/path/title/icon/tone) so Header.tsx and Landing.tsx can render
// [...adminTools, ...serverAppLinks] as one merged, admin-only list instead
// of three separately-tracked groups.
export const serverAppLinks: ServerAppLink[] = [
  {
    key: "blog-studio",
    path: "/admin/blogs",
    title: "Blog Studio",
    icon: SquarePen,
    tone: "violet",
  },
  {
    key: "blog-analytics",
    path: "/admin/blogs/analytics",
    title: "Blog Analytics",
    icon: BarChart3,
    tone: "blue",
  },
  {
    key: "scheduled-jobs",
    path: "/admin/scheduler",
    title: "Scheduled Jobs",
    icon: CalendarClock,
    tone: "amber",
  },
  {
    key: "activity",
    path: "/admin/activity",
    title: "Activity",
    icon: Activity,
    tone: "violet",
  },
  {
    key: "location",
    path: "/admin/location",
    title: "Location",
    icon: MapPin,
    tone: "blue",
  },
  {
    key: "settings",
    path: "/settings",
    title: "Settings",
    icon: Settings,
    tone: "blue",
  },
  {
    key: "remote",
    path: "/remote",
    title: "Remote",
    icon: MonitorOff,
    tone: "amber",
  },
];
