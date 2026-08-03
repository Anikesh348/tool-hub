import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Clapperboard,
  Code2,
  Download,
  Flame,
  Gauge,
  Home,
  LibraryBig,
  LogOut,
  Menu,
  MessageCircle,
  MonitorOff,
  Plane,
  Play,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SquarePen,
  TerminalSquare,
  type LucideIcon,
  X,
} from "lucide-react";
import { adminTools } from "../adminTools";
import { useAuth } from "../context/AuthContext";
import { useNotification } from "../context/NotificationContext";
import ThemeToggle from "./ThemeToggle";
import GlobalNotifications from "./GlobalNotifications";
import { locationPath } from "../utils/authRedirect";

const toolLinks = [
  {
    to: "/blogs",
    label: "Blogs",
    icon: BookOpen,
    adminOnly: false,
  },
  {
    to: "/speedtest",
    label: "Speed Test",
    icon: Gauge,
    adminOnly: false,
  },
  {
    to: "/buzzwatch",
    label: "BuzzWatch",
    icon: Flame,
    adminOnly: false,
  },
  {
    to: "/moviehub",
    label: "MovieHub",
    icon: Clapperboard,
    adminOnly: false,
  },
  {
    to: "/pricetracker",
    label: "Price Tracker",
    icon: ChartNoAxesCombined,
    adminOnly: false,
  },
  {
    to: "/flighttracker",
    label: "Flight Tracker",
    icon: Plane,
    adminOnly: false,
  },
  {
    to: "/leetcode",
    label: "LeetCode Manager",
    icon: Code2,
    adminOnly: true,
  },
];

const publishingLinks = [
  {
    to: "/admin/blogs",
    label: "Blog Studio",
    icon: SquarePen,
  },
  {
    to: "/admin/blogs/analytics",
    label: "Blog Analytics",
    icon: BarChart3,
  },
];

const workspaceLinks = [
  {
    to: "/settings",
    label: "Settings",
    icon: Settings,
  },
  {
    to: "/remote",
    label: "Remote",
    icon: MonitorOff,
  },
];

type SearchEntry = {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  adminOnly: boolean;
  keywords: string[];
  parent?: string;
  kind: "tool" | "feature";
};

const searchableTools: SearchEntry[] = [
  {
    to: "/admin/courses",
    label: "My Courses",
    description: "Read courses and ask contextual AI questions",
    icon: BookOpen,
    adminOnly: true,
    keywords: ["courses", "learning", "linux", "lessons", "ai"],
    kind: "tool",
  },
  {
    to: "/blogs",
    label: "Blogs",
    description: "Read notes from the homelab",
    icon: BookOpen,
    adminOnly: false,
    keywords: ["blog", "blogs", "articles", "homelab", "writing", "self-hosting"],
    kind: "tool",
  },
  {
    to: "/",
    label: "ToolHub Home",
    description: "Return to your ToolHub workspace",
    icon: Home,
    adminOnly: false,
    keywords: ["home", "toolhub", "workspace", "dashboard", "start"],
    kind: "tool",
  },
  {
    to: "/speedtest",
    label: "Speed Test",
    description: "Measure connection latency, download and upload speed",
    icon: Gauge,
    adminOnly: false,
    keywords: ["speed", "internet", "network", "ping", "download", "upload", "bandwidth"],
    kind: "tool",
  },
  {
    to: "/buzzwatch",
    label: "BuzzWatch",
    description: "Track global movie and series buzz",
    icon: Flame,
    adminOnly: false,
    keywords: ["buzz", "trending", "rotten", "tomatoes", "movie", "series", "shows", "discover"],
    kind: "tool",
  },
  {
    to: "/moviehub",
    label: "MovieHub",
    description: "Stream and manage movies and series",
    icon: Clapperboard,
    adminOnly: false,
    keywords: ["movie", "movies", "show", "shows", "series", "media", "stream"],
    kind: "tool",
  },
  {
    to: "/moviehub/watch",
    label: "Watch",
    parent: "MovieHub",
    description: "Open the embedded Jellyfin player",
    icon: Play,
    adminOnly: false,
    keywords: ["watch", "play", "player", "jellyfin", "stream", "moviehub"],
    kind: "feature",
  },
  {
    to: "/moviehub/browse",
    label: "Browse",
    parent: "MovieHub",
    description: "Find movies and series to request",
    icon: Search,
    adminOnly: false,
    keywords: ["browse", "discover", "request", "movies", "shows", "moviehub"],
    kind: "feature",
  },
  {
    to: "/moviehub/my-list",
    label: "My List",
    parent: "MovieHub",
    description: "Review your media requests and status",
    icon: LibraryBig,
    adminOnly: false,
    keywords: ["list", "requests", "status", "library", "moviehub"],
    kind: "feature",
  },
  {
    to: "/moviehub/downloads",
    label: "Downloads",
    parent: "MovieHub",
    description: "View active and completed downloads",
    icon: Download,
    adminOnly: false,
    keywords: ["download", "downloads", "queue", "completed", "moviehub"],
    kind: "feature",
  },
  {
    to: "/moviehub/chat",
    label: "CinePilot AI",
    parent: "MovieHub",
    description: "Chat with the MovieHub media assistant",
    icon: MessageCircle,
    adminOnly: false,
    keywords: ["ai", "chat", "cinepilot", "assistant", "recommend", "moviehub"],
    kind: "feature",
  },
  {
    to: "/pricetracker",
    label: "Amazon Price Tracker",
    description: "Track products and price changes",
    icon: ChartNoAxesCombined,
    adminOnly: false,
    keywords: ["amazon", "price", "tracker", "product", "shopping"],
    kind: "tool",
  },
  {
    to: "/pricetracker/add",
    label: "Add Product",
    parent: "Price Tracker",
    description: "Track a product URL and target price",
    icon: Plus,
    adminOnly: false,
    keywords: ["add", "paste", "url", "target", "product", "price"],
    kind: "feature",
  },
  {
    to: "/pricetracker/search",
    label: "Search Stores",
    parent: "Price Tracker",
    description: "Search supported stores for products",
    icon: Search,
    adminOnly: false,
    keywords: ["search", "stores", "amazon", "flipkart", "shopping", "price"],
    kind: "feature",
  },
  {
    to: "/pricetracker/dashboard",
    label: "Tracked Products",
    parent: "Price Tracker",
    description: "View tracked products and price history",
    icon: BarChart3,
    adminOnly: false,
    keywords: ["dashboard", "tracked", "products", "history", "alerts", "price"],
    kind: "feature",
  },
  {
    to: "/flighttracker",
    label: "Flight Tracker",
    description: "Track flight fares between airports and receive threshold alerts",
    icon: Plane,
    adminOnly: false,
    keywords: ["flight", "flights", "fare", "travel", "airport", "iata", "price", "alert"],
    kind: "tool",
  },
  {
    to: "/leetcode",
    label: "LeetCode Manager",
    description: "Organize coding practice and questions",
    icon: Code2,
    adminOnly: true,
    keywords: ["leetcode", "code", "coding", "question", "practice", "interview"],
    kind: "tool",
  },
  {
    to: "/leetcode#add-questions",
    label: "Add Questions",
    parent: "LeetCode Manager",
    description: "Import LeetCode question URLs",
    icon: Plus,
    adminOnly: true,
    keywords: ["add", "import", "url", "questions", "leetcode"],
    kind: "feature",
  },
  {
    to: "/leetcode#question-library",
    label: "Question Library",
    parent: "LeetCode Manager",
    description: "Search, filter, and manage coding questions",
    icon: LibraryBig,
    adminOnly: true,
    keywords: ["questions", "library", "filter", "solved", "notes", "leetcode"],
    kind: "feature",
  },
  {
    to: "/remote",
    label: "Remote",
    description: "Pause the Pi5 render and darken the monitor",
    icon: MonitorOff,
    adminOnly: true,
    keywords: ["remote", "monitor", "display", "pause", "render", "dark", "blackout", "pi5"],
    kind: "tool",
  },
];

const movieHubAdminFeatures: SearchEntry[] = [
  {
    to: "/moviehub/admin/approvals",
    label: "Request Approvals",
    parent: "MovieHub",
    description: "Approve or reject media requests",
    icon: ShieldCheck,
    adminOnly: true,
    keywords: ["admin", "approve", "approvals", "requests", "moviehub"],
    kind: "feature",
  },
  {
    to: "/moviehub/admin/youtube",
    label: "YouTube Downloads",
    parent: "MovieHub",
    description: "Manage YouTube download requests",
    icon: Download,
    adminOnly: true,
    keywords: ["youtube", "yt", "download", "admin", "moviehub"],
    kind: "feature",
  },
  {
    to: "/moviehub/admin/access",
    label: "Access Requests",
    parent: "MovieHub",
    description: "Manage MovieHub access requests",
    icon: ShieldCheck,
    adminOnly: true,
    keywords: ["access", "permissions", "requests", "admin", "moviehub"],
    kind: "feature",
  },
  {
    to: "/moviehub/admin/members",
    label: "Members",
    parent: "MovieHub",
    description: "Manage MovieHub members",
    icon: ShieldCheck,
    adminOnly: true,
    keywords: ["members", "users", "access", "admin", "moviehub"],
    kind: "feature",
  },
];

const jellyfinFeatures: SearchEntry[] = [
  {
    to: "/admin/tools/jellyfin-control?panel=queue",
    label: "Active Queue",
    parent: "Jellyfin Control",
    description: "View live optimizer and transcode jobs",
    icon: Play,
    adminOnly: true,
    keywords: ["queue", "jobs", "transcode", "optimizer", "jellyfin"],
    kind: "feature",
  },
  {
    to: "/admin/tools/jellyfin-control?panel=logs",
    label: "Optimizer Logs",
    parent: "Jellyfin Control",
    description: "Open Jellyfin optimizer logs",
    icon: TerminalSquare,
    adminOnly: true,
    keywords: ["logs", "optimizer", "ffmpeg", "errors", "jellyfin"],
    kind: "feature",
  },
];

function Header() {
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const { isAuthenticated, logout, user } = useAuth();
  const { addNotification } = useNotification();
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [quickSearch, setQuickSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchResultRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const isLanding = pathname === "/";
  const isAdminToolPage = pathname.startsWith("/admin/tools/") || pathname.startsWith("/admin/blogs") || pathname.startsWith("/admin/courses") || pathname === "/settings" || pathname === "/remote";
  const showSidebar = isLanding || isAdminToolPage;
  const isAuthPage = pathname === "/login" || pathname === "/register";
  const showSignIn = !isAuthenticated && !isAuthPage;
  const isAdmin = user?.role === "ADMIN";
  const visibleToolLinks = toolLinks.filter(
    ({ adminOnly }) => !adminOnly || isAdmin
  );
  const availableSearchTools: SearchEntry[] = [
    ...searchableTools.filter(({ adminOnly }) => !adminOnly || isAdmin),
    ...(isAdmin ? movieHubAdminFeatures : []),
    ...(isAdmin
      ? adminTools.map(({ path, title, description, icon }) => ({
          to: path,
          label: title,
          description,
          icon,
          adminOnly: true as const,
          keywords: [
            title.toLowerCase(),
            description.toLowerCase(),
            "admin",
            "server",
          ],
          kind: "tool" as const,
        }))
      : []),
    ...(isAdmin ? jellyfinFeatures : []),
  ];
  const normalizedQuery = quickSearch.trim().toLowerCase();
  const searchResults = availableSearchTools.filter((tool) => {
    if (!normalizedQuery) return true;
    const searchableText = [
      tool.label,
      tool.description,
      ...tool.keywords,
    ]
      .join(" ")
      .toLowerCase();
    return normalizedQuery
      .split(/\s+/)
      .every((term) => searchableText.includes(term));
  });

  useEffect(() => {
    setMobileMenuOpen(false);
    setSearchOpen(false);
    setQuickSearch("");
  }, [pathname]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        profileRef.current &&
        !profileRef.current.contains(event.target as Node)
      ) {
        setProfileOpen(false);
      }
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target as Node)
      ) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [quickSearch, isAdmin]);

  useEffect(() => {
    if (!searchOpen) return;
    searchResultRefs.current[activeSearchIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeSearchIndex, searchOpen, searchResults.length]);

  const signOut = async () => {
    await logout();
    setProfileOpen(false);
    setMobileMenuOpen(false);
    addNotification("Logged out successfully.", "success", 3000);
  };

  const openSearchResult = (path: string) => {
    setSearchOpen(false);
    setQuickSearch("");
    navigate(path);
  };

  const runQuickSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const result = searchResults[activeSearchIndex] || searchResults[0];
    if (result) openSearchResult(result.to);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSearchOpen(false);
      searchInputRef.current?.blur();
      return;
    }
    if (!searchResults.length) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const result = searchResults[activeSearchIndex] || searchResults[0];
      if (result) openSearchResult(result.to);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchOpen(true);
      setActiveSearchIndex((index) => (index + 1) % searchResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchOpen(true);
      setActiveSearchIndex(
        (index) => (index - 1 + searchResults.length) % searchResults.length
      );
    }
  };

  const profile = (
    <div className="relative" ref={profileRef}>
      {isAuthenticated ? (
        <>
          <button
            onClick={() => setProfileOpen((value) => !value)}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] p-1 pr-2 text-slate-200 transition hover:bg-white/[0.08]"
            aria-label="Open profile menu"
          >
            {user?.profilePicture ? (
              <img
                src={user.profilePicture}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white">
                {(user?.name || "U").slice(0, 1).toUpperCase()}
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {profileOpen && (
            <div className="toolhub-profile-menu absolute right-0 mt-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#0b111d]/95 shadow-2xl backdrop-blur-xl">
              <div className="border-b border-white/10 px-4 py-3">
                <p className="truncate text-sm font-semibold text-white">
                  {user?.name || "ToolHub user"}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">Signed in</p>
              </div>
              <button
                onClick={signOut}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-rose-300 transition hover:bg-rose-500/10"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          )}
        </>
      ) : showSignIn ? (
        <Link
          to="/login"
          state={{ from: locationPath(location) }}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-violet-400/50 hover:text-white"
        >
          Log in
        </Link>
      ) : null}
    </div>
  );

  return (
    <>
      {showSidebar && (
        <aside className="toolhub-sidebar fixed inset-y-0 left-0 z-40 hidden w-60 flex-col overflow-y-auto border-r border-white/[0.07] lg:flex">
          <Link to="/" className="flex h-16 shrink-0 items-center px-5">
            <span className="text-xl font-extrabold leading-none tracking-tight text-white">
              Tool<span className="text-violet-500">Hub</span>
            </span>
          </Link>

          <nav className="px-3 pt-2">
            <Link
              to="/"
              className="toolhub-side-link toolhub-side-link-active"
            >
              <Home className="h-4 w-4" />
              Home
            </Link>
            {visibleToolLinks.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} className="toolhub-side-link">
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
            <div className="my-4 border-t border-white/[0.07]" />
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
              Tools
            </p>
            <Link to="/pricetracker" className="toolhub-side-link text-amber-300">
              <ChartNoAxesCombined className="h-4 w-4" />
              Amazon Price Tracker
            </Link>
            <Link to="/buzzwatch" className="toolhub-side-link text-cyan-300">
              <Flame className="h-4 w-4" />
              BuzzWatch
            </Link>
            <Link to="/flighttracker" className="toolhub-side-link text-sky-300">
              <Plane className="h-4 w-4" />
              Flight Tracker
            </Link>
            {isAdmin && (
              <Link to="/leetcode" className="toolhub-side-link text-yellow-200">
                <Code2 className="h-4 w-4" />
                LeetCode Manager
              </Link>
            )}
            {isAdmin && (
              <Link to="/admin/courses" className={`toolhub-side-link text-blue-200 ${pathname.startsWith("/admin/courses") ? "toolhub-side-link-active" : ""}`}>
                <BookOpen className="h-4 w-4" />
                My Courses
              </Link>
            )}
            <Link to="/moviehub" className="toolhub-side-link text-violet-300">
              <Clapperboard className="h-4 w-4" />
              MovieHub
            </Link>
            {isAdmin && (
              <>
                <div className="my-4 border-t border-white/[0.07]" />
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/70">
                  Server applications
                </p>
                {adminTools.map(({ key, path, title, icon: Icon }) => (
                  <Link
                    key={key}
                    to={path}
                    className={`toolhub-side-link ${
                      pathname === path ? "toolhub-side-link-active" : ""
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {title}
                  </Link>
                ))}
                {publishingLinks.map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    className={`toolhub-side-link ${pathname === to ? "toolhub-side-link-active" : ""}`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                ))}
              </>
            )}
          </nav>

          <div className="mt-auto px-3 pb-4 pt-4">
            {isAdmin && (
              <div className="space-y-1">
                {workspaceLinks.map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    className={`toolhub-side-link w-full ${pathname === to ? "toolhub-side-link-active" : ""}`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white">
                {(user?.name || "A").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white">
                  {user?.name || "Guest"}
                </p>
                <p className="mt-0.5 text-[10px] text-violet-300">
                  {isAuthenticated ? "Workspace" : "Sign in to continue"}
                </p>
              </div>
            </div>
          </div>
        </aside>
      )}

      <header
        className={`toolhub-topbar fixed top-0 z-30 h-16 border-b border-white/[0.07] ${
          showSidebar ? "left-0 right-0 lg:left-60" : "inset-x-0"
        }`}
      >
        <div className="flex h-full items-center gap-4 px-5">
          <Link
            to="/"
            className={`${showSidebar ? "lg:hidden" : ""} flex h-16 shrink-0 items-center`}
          >
            <span className="text-xl font-extrabold leading-none tracking-tight text-white">
              {pathname.startsWith("/moviehub") ? (
                <>
                  Movie<span className="text-violet-500">Hub</span>
                </>
              ) : (
                <>
                  Tool<span className="text-violet-500">Hub</span>
                </>
              )}
            </span>
          </Link>

          {!showSidebar && !isAuthPage && (
            <Link
              to="/blogs"
              className={`toolhub-blog-link hidden rounded-lg px-3 py-2 text-xs font-semibold transition sm:inline-flex ${pathname.startsWith("/blogs") ? "toolhub-blog-link-active bg-violet-500/15 text-violet-200" : "text-slate-400 hover:text-white"}`}
            >
              Blogs
            </Link>
          )}

          {!isAuthPage && (
            <div
              ref={searchRef}
              className="relative mx-auto hidden w-full max-w-xl sm:block"
            >
              <form
                onSubmit={runQuickSearch}
                className={`flex items-center rounded-lg border bg-white/[0.035] px-3 transition ${
                  searchOpen
                    ? "border-violet-400/50 ring-2 ring-violet-500/10"
                    : "border-white/[0.09]"
                }`}
              >
                <Search className="h-4 w-4 shrink-0 text-slate-500" />
                <input
                  ref={searchInputRef}
                  value={quickSearch}
                  onChange={(event) => {
                    setQuickSearch(event.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search all tools..."
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="global-tool-search-results"
                  aria-expanded={searchOpen}
                  aria-activedescendant={
                    searchOpen && searchResults[activeSearchIndex]
                      ? `global-search-result-${activeSearchIndex}`
                      : undefined
                  }
                  className="h-10 flex-1 bg-transparent px-3 text-xs text-slate-200 outline-none placeholder:text-slate-600"
                />
                <span className="hidden items-center gap-0.5 rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-slate-500 md:flex">
                  <span className="text-[10px]">⌘</span>K
                </span>
              </form>

              {searchOpen && (
                <div
                  id="global-tool-search-results"
                  role="listbox"
                  className="toolhub-search-panel absolute inset-x-0 top-[calc(100%+8px)] overflow-hidden rounded-xl border border-white/10 bg-[#090e18]/[0.98] p-2 shadow-2xl backdrop-blur-xl"
                >
                  <div className="flex items-center justify-between px-2 pb-2 pt-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                      {normalizedQuery ? "Search results" : "All tools"}
                    </span>
                    <span className="text-[10px] text-slate-600">
                      {searchResults.length} available
                    </span>
                  </div>
                  <div className="max-h-[360px] overflow-y-auto">
                    {searchResults.length ? (
                      searchResults.map(
                        (
                          {
                            to,
                            label,
                            description,
                            icon: Icon,
                            adminOnly,
                            parent,
                            kind,
                          },
                          index
                        ) => {
                          const active = index === activeSearchIndex;
                          return (
                            <button
                              id={`global-search-result-${index}`}
                              key={to}
                              ref={(element) => {
                                searchResultRefs.current[index] = element;
                              }}
                              type="button"
                              role="option"
                              aria-selected={active}
                              onMouseEnter={() => setActiveSearchIndex(index)}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => openSearchResult(to)}
                              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                                active
                                  ? "bg-violet-500/15 text-white"
                                  : "text-slate-300 hover:bg-white/[0.05]"
                              }`}
                            >
                              <span
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                                  active
                                    ? "border-violet-400/30 bg-violet-500/15 text-violet-300"
                                    : "border-white/[0.07] bg-white/[0.035] text-slate-400"
                                }`}
                              >
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="truncate text-xs font-semibold">
                                    {parent ? `${parent} / ${label}` : label}
                                  </span>
                                  {kind === "feature" && (
                                    <span className="rounded bg-violet-400/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-violet-300">
                                      Feature
                                    </span>
                                  )}
                                  {adminOnly && (
                                    <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-300">
                                      Admin
                                    </span>
                                  )}
                                </span>
                                <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                                  {description}
                                </span>
                              </span>
                              {active && (
                                <Check className="h-3.5 w-3.5 shrink-0 text-violet-300" />
                              )}
                            </button>
                          );
                        }
                      )
                    ) : (
                      <div className="px-3 py-8 text-center">
                        <Search className="mx-auto h-5 w-5 text-slate-700" />
                        <p className="mt-2 text-xs font-semibold text-slate-400">
                          No tools found
                        </p>
                        <p className="mt-1 text-[10px] text-slate-600">
                          Try a name such as File Manager or MovieHub.
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-3 border-t border-white/[0.07] px-2 pt-2 text-[9px] text-slate-600">
                    <span>↑↓ Navigate</span>
                    <span>Enter Open</span>
                    <span>Esc Close</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <GlobalNotifications />
            <ThemeToggle />
            {profile}
            <button
              onClick={() => setMobileMenuOpen((value) => !value)}
              className="rounded-lg border border-white/10 p-2 text-slate-300 lg:hidden"
              aria-label="Open menu"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

      </header>

      {mobileMenuOpen && (
        <nav className="toolhub-mobile-menu fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto border-t border-white/[0.07] bg-[#070b13]/[0.98] p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl lg:hidden">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
            Workspace
          </p>
          <div className="grid grid-cols-2 gap-1">
            <Link to="/" className="toolhub-mobile-link">
              <Home className="h-4 w-4 shrink-0" />
              Home
            </Link>
            {visibleToolLinks.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} className="toolhub-mobile-link min-w-0">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
              </Link>
            ))}
            {isAdmin && (
              <Link to="/admin/courses" className="toolhub-mobile-link min-w-0">
                <BookOpen className="h-4 w-4 shrink-0" />
                <span className="truncate">My Courses</span>
              </Link>
            )}
          </div>
          {isAdmin && (
            <>
              <div className="my-3 border-t border-white/[0.07]" />
              <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300/70">
                Admin workspace
              </p>
              <div className="grid grid-cols-2 gap-1">
                {[...publishingLinks, ...workspaceLinks].map(
                  ({ to, label, icon: Icon }) => (
                    <Link key={to} to={to} className="toolhub-mobile-link min-w-0">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </Link>
                  ),
                )}
              </div>
              <p className="mt-3 px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                Server applications
              </p>
              <div className="grid grid-cols-2 gap-1">
                {adminTools.map(({ key, path, title, icon: Icon }) => (
                  <Link key={key} to={path} className="toolhub-mobile-link min-w-0">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{title}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </nav>
      )}
    </>
  );
}

export default Header;
