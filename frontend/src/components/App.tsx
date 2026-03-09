import React from "react";
import { Routes, Route } from "react-router-dom";
import { LogIn } from "./auth/LogIn";
import Register from "./auth/Register";
import Header from "./Header";
import { Landing } from "./Landing";
import Dashboard from "./Dashboard";
import { Leetcode } from "./Leetcode";
import PriceTracker from "./PriceTracker";
import MovieHub from "./MovieHub";
import MovieHubYtPage from "./MovieHubYtPage";
import { NotificationProvider } from "../context/NotificationContext";
import { ToastContainer } from "./Toast";

function App() {
  return (
    <NotificationProvider>
      <div className="min-h-screen flex flex-col bg-white dark:bg-gray-900 transition-colors duration-300">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/pricetracker" element={<PriceTracker />} />
            <Route path="/moviehub/yt" element={<MovieHubYtPage />} />
            <Route path="/moviehub/*" element={<MovieHub />} />
            <Route path="/login" element={<LogIn />} />
            <Route path="/register" element={<Register />} />
            <Route path="/pricetracker/dashboard" element={<Dashboard />} />
            <Route path="/leetcode" element={<Leetcode />} />
          </Routes>
        </main>
        <ToastContainer />
      </div>
    </NotificationProvider>
  );
}

export default App;
