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
import { NotificationProvider } from "../context/NotificationContext";
import { useAuth } from "../context/AuthContext";
import { getAdminTool } from "../adminTools";
import { ToastContainer } from "./Toast";
import AdminSettings from "./AdminSettings";
import SpeedTest from "./SpeedTest";
import AdminRemote from "./AdminRemote";

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
      <Navigate to="/login" replace state={{ from: location.pathname }} />
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
      <Navigate to="/login" replace state={{ from: location.pathname }} />
    );
  }

  return <>{children}</>;
}

function App() {
  const { pathname } = useLocation();
  const isLanding = pathname === "/";
  const hasSidebar = isLanding || pathname.startsWith("/admin/tools/") || pathname === "/settings" || pathname === "/remote";

  return (
    <NotificationProvider>
      <div className="app-shell min-h-screen bg-[#030711] text-slate-100">
        <PageTitle />
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
