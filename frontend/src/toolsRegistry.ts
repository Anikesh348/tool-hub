import {
  BookOpen,
  ChartNoAxesCombined,
  Clapperboard,
  Code2,
  Flame,
  Gauge,
  Plane,
  type LucideIcon,
} from "lucide-react";

export interface ToolEntry {
  key: string;
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: "violet" | "blue" | "amber" | "cyan";
  adminOnly: boolean;
}

// Single source of truth for the public-facing "Tools" section — used by
// Header.tsx (sidebar, mobile menu) and Landing.tsx (home page grid). Every
// route here is public except where adminOnly is set (LeetCode Manager, My
// Courses); BuzzWatch's route itself still requires login (every one of its
// backend endpoints does), but it's listed here since it's a "Tool", not a
// server application — clicking it while logged out just redirects to login.
export const TOOLS: ToolEntry[] = [
  {
    key: "blogs",
    path: "/blogs",
    label: "Blogs",
    description: "Read the latest posts and project write-ups",
    icon: BookOpen,
    tone: "blue",
    adminOnly: false,
  },
  {
    key: "speedtest",
    path: "/speedtest",
    label: "Speed Test",
    description: "Measure ping, download and upload",
    icon: Gauge,
    tone: "cyan",
    adminOnly: false,
  },
  {
    key: "buzzwatch",
    path: "/buzzwatch",
    label: "BuzzWatch",
    description: "Global movie and series buzz",
    icon: Flame,
    tone: "cyan",
    adminOnly: false,
  },
  {
    key: "moviehub",
    path: "/moviehub",
    label: "MovieHub",
    description: "Stream movies and series",
    icon: Clapperboard,
    tone: "violet",
    adminOnly: false,
  },
  {
    key: "pricetracker",
    path: "/pricetracker",
    label: "Price Tracker",
    description: "Track prices in real-time",
    icon: ChartNoAxesCombined,
    tone: "blue",
    adminOnly: false,
  },
  {
    key: "flighttracker",
    path: "/flighttracker",
    label: "Flight Tracker",
    description: "Watch fares and get alerts",
    icon: Plane,
    tone: "cyan",
    adminOnly: false,
  },
  {
    key: "leetcode",
    path: "/leetcode",
    label: "LeetCode Manager",
    description: "Organize and practice",
    icon: Code2,
    tone: "amber",
    adminOnly: true,
  },
  {
    key: "my-courses",
    path: "/admin/courses",
    label: "My Courses",
    description: "Learn with contextual AI explanations",
    icon: BookOpen,
    tone: "blue",
    adminOnly: true,
  },
];
