import React, { type ReactNode, useEffect } from "react";
import { Navigate, Routes, Route, useLocation } from "react-router-dom";
import { LogIn } from "./auth/LogIn";
import Register from "./auth/Register";
import Header from "./Header";
import { Landing } from "./Landing";
import Dashboard from "./Dashboard";
import { Leetcode } from "./Leetcode";
import PriceTracker from "./PriceTracker";
import FlightTracker from "./FlightTracker";
import FlightHistoryPage from "./FlightHistoryPage";
import MovieHub from "./MovieHub";
import BuzzWatch from "./BuzzWatch";
import AdminToolFrame from "./AdminToolFrame";
import ActivityTracker from "./ActivityTracker";
import ActivityDashboard from "./ActivityDashboard";
import { NotificationProvider } from "../context/NotificationContext";
import { useAuth } from "../context/AuthContext";
import { getAdminTool } from "../adminTools";
import { ToastContainer } from "./Toast";
import AdminSettings from "./AdminSettings";
import ScheduledJobs from "./ScheduledJobs";
import SpeedTest from "./SpeedTest";
import AdminRemote from "./AdminRemote";
import BlogIndex from "./blogs/BlogIndex";
import BlogArticle from "./blogs/BlogArticle";
import AdminBlogEditor from "./blogs/AdminBlogEditor";
import AdminBlogAnalytics from "./blogs/AdminBlogAnalytics";
import AIChat from "./AIChat";
import CourseIndex from "./courses/CourseIndex";
import CourseDetail from "./courses/CourseDetail";
import CourseReader from "./courses/CourseReader";
import { locationPath, rememberAuthReturnPath } from "../utils/authRedirect";

const DEFAULT_TITLE = "ToolHub";

const getPageTitle = (pathname: string) => {
  if (pathname === "/") return "ToolHub";
  if (pathname === "/login") return "Log In | ToolHub";
  if (pathname === "/register") return "Register | ToolHub";
  if (pathname === "/pricetracker/dashboard") {
    return "Price Tracker Dashboard | ToolHub";
  }
  if (pathname.startsWith("/pricetracker")) return "Price Tracker | ToolHub";
  if (pathname.startsWith("/flighttracker")) return "Flight Tracker | ToolHub";
  if (pathname === "/leetcode") return "LeetCode Manager | ToolHub";
  if (pathname.startsWith("/buzzwatch")) return "BuzzWatch | ToolHub";
  if (pathname === "/speedtest") return "Speed Test | ToolHub";
  if (pathname === "/remote") return "Remote | ToolHub";
  if (pathname === "/settings") return "Admin Settings | ToolHub";
  if (pathname === "/blogs") return "Blogs | ToolHub";
  if (pathname.startsWith("/blogs/")) return "Homelab Blog | ToolHub";
  if (pathname === "/admin/blogs") return "Blog Studio | ToolHub";
  if (pathname === "/admin/blogs/analytics") return "Blog Analytics | ToolHub";
  if (pathname === "/admin/ai") return "AI Assistant | ToolHub";
  if (pathname === "/admin/scheduler") return "Scheduled Jobs | ToolHub";
  if (pathname === "/admin/activity") return "Activity | ToolHub";
  if (pathname.startsWith("/admin/courses")) return "My Courses | ToolHub";
  if (pathname.startsWith("/admin/tools/")) {
    const tool = getAdminTool(pathname.split("/").pop());
    return tool ? `${tool.title} | ToolHub` : DEFAULT_TITLE;
  }
  if (pathname.startsWith("/moviehub/chat")) return "MovieHub AI Chat | ToolHub";
  if (pathname.startsWith("/moviehub")) return "MovieHub | ToolHub";
  return DEFAULT_TITLE;
};

function PageTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = getPageTitle(pathname);
  }, [pathname]);

  return null;
}

function AuthReturnTracker() {
  const location = useLocation();

  useEffect(() => {
    rememberAuthReturnPath(location);
  }, [location]);

  return null;
}

function FlightTrackerAlias() {
  const location = useLocation();
  const correctedPath = location.pathname.replace(
    /^\/flightracker/,
    "/flighttracker",
  );

  return (
    <Navigate
      replace
      to={{
        pathname: correctedPath,
        search: location.search,
        hash: location.hash,
      }}
    />
  );
}

function AdminRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { isAuthenticated, isAuthLoading, user } = useAuth();

  if (isAuthLoading) return null;

  if (!isAuthenticated) {
    return (
      <Navigate to="/login" replace state={{ from: locationPath(location) }} />
    );
  }

  if (user?.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { isAuthenticated, isAuthLoading } = useAuth();

  if (isAuthLoading) return null;

  if (!isAuthenticated) {
    return (
      <Navigate to="/login" replace state={{ from: locationPath(location) }} />
    );
  }

  return <>{children}</>;
}

function App() {
  const { pathname } = useLocation();
  const isLanding = pathname === "/";
  const hasSidebar = isLanding || pathname.startsWith("/admin/tools/") || pathname.startsWith("/admin/blogs") || pathname === "/admin/scheduler" || pathname === "/admin/activity" || pathname === "/settings" || pathname === "/remote";

  return (
    <NotificationProvider>
      <div className="app-shell min-h-screen">
        <PageTitle />
        <AuthReturnTracker />
        <ActivityTracker />
        <Header />
        <main
          className={`portal-main min-h-screen w-full ${hasSidebar ? "lg:pl-60" : ""}`}
        >
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/pricetracker/*" element={<PriceTracker />} />
            <Route path="/flighttracker/history/:watchId" element={<FlightHistoryPage />} />
            <Route path="/flighttracker/*" element={<FlightTracker />} />
            <Route path="/flightracker/*" element={<FlightTrackerAlias />} />
            <Route
              path="/moviehub/yt"
              element={<Navigate to="/moviehub" replace />}
            />
            <Route path="/moviehub/*" element={<MovieHub />} />
            <Route
              path="/speedtest"
              element={<SpeedTest />}
            />
            <Route
              path="/buzzwatch"
              element={
                <ProtectedRoute>
                  <BuzzWatch />
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<LogIn />} />
            <Route path="/register" element={<Register />} />
            <Route path="/blogs" element={<BlogIndex />} />
            <Route path="/blogs/:slug" element={<BlogArticle />} />
            <Route path="/pricetracker/dashboard" element={<Dashboard />} />
            <Route
              path="/leetcode"
              element={
                <AdminRoute>
                  <Leetcode />
                </AdminRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <AdminRoute>
                  <AdminSettings />
                </AdminRoute>
              }
            />
            <Route
              path="/remote"
              element={
                <AdminRoute>
                  <AdminRemote />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/blogs"
              element={
                <AdminRoute>
                  <AdminBlogEditor />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/blogs/analytics"
              element={
                <AdminRoute>
                  <AdminBlogAnalytics />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/ai"
              element={
                <AdminRoute>
                  <AIChat />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/scheduler"
              element={
                <AdminRoute>
                  <ScheduledJobs />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/activity"
              element={
                <AdminRoute>
                  <ActivityDashboard />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/courses"
              element={<AdminRoute><CourseIndex /></AdminRoute>}
            />
            <Route
              path="/admin/courses/:courseId"
              element={<AdminRoute><CourseDetail /></AdminRoute>}
            />
            <Route
              path="/admin/courses/:courseId/modules/:moduleSlug"
              element={<AdminRoute><CourseReader /></AdminRoute>}
            />
            <Route
              path="/admin/tools/:toolKey"
              element={
                <AdminRoute>
                  <AdminToolFrame />
                </AdminRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <ToastContainer />
      </div>
    </NotificationProvider>
  );
}

export default App;
