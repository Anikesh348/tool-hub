import React from "react";
import {
  ExternalLink,
  Clapperboard,
  Clock3,
  LibraryBig,
  Download,
  Video,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { MovieHubSection, SectionConfig } from "./types";

type MovieHubNavProps = {
  sectionConfig: SectionConfig[];
  activeSection: MovieHubSection;
  isSidebarCollapsed: boolean;
  isMobileNavOpen: boolean;
  onToggleSidebar: () => void;
  onCloseMobileNav: () => void;
  onSelectSection: (section: MovieHubSection) => void;
};

const iconBySection: Record<MovieHubSection, React.ComponentType<{ className?: string }>> = {
  open: ExternalLink,
  request: Clapperboard,
  status: Clock3,
  admin_approve: ShieldCheck,
  admin_yt_download: Video,
  admin_access: UserCheck,
  admin_users: Users,
  available: LibraryBig,
  downloading: Download,
};

const NavItem: React.FC<{
  section: SectionConfig;
  activeSection: MovieHubSection;
  isSidebarCollapsed: boolean;
  onSelectSection: (section: MovieHubSection) => void;
  mobile?: boolean;
}> = ({ section, activeSection, isSidebarCollapsed, onSelectSection, mobile = false }) => {
  const Icon = iconBySection[section.id];
  const isAdminOnly = Boolean(section.adminOnly);
  const isYtSection = section.id === "admin_yt_download";
  const badgeCount = section.badgeCount || 0;
  return (
    <button
      onClick={() => !section.disabled && onSelectSection(section.id)}
      disabled={section.disabled}
      title={section.label}
      className={`group relative w-full rounded-xl text-sm font-semibold transition-all duration-200 ${
        activeSection === section.id
          ? isYtSection
            ? "bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg shadow-red-500/20"
            : "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/20"
          : isYtSection
            ? "text-red-800 dark:text-red-200 hover:bg-red-100/70 dark:hover:bg-red-900/25"
          : isAdminOnly
            ? "text-amber-800 dark:text-amber-200 hover:bg-amber-100/70 dark:hover:bg-amber-900/25"
            : "text-gray-700 dark:text-gray-300 hover:bg-white/60 dark:hover:bg-slate-800/70"
      } ${
        mobile
          ? "px-4 py-3 flex items-center gap-3 text-left"
          : isSidebarCollapsed
            ? "px-1.5 py-2.5 flex items-center justify-center"
            : "px-3 py-3 flex items-center gap-3 text-left"
      } ${section.disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <span
        className={`inline-flex items-center justify-center rounded-md border border-current/25 ${
          mobile ? "w-8 h-8" : isSidebarCollapsed ? "w-8 h-8" : "w-8 h-8"
        }`}
      >
        <Icon className="w-4 h-4" />
      </span>
      {(mobile || !isSidebarCollapsed) && (
        <span className="truncate">{section.label}</span>
      )}
      {badgeCount > 0 && (
        <span className={`absolute inline-flex items-center justify-center rounded-full text-[10px] font-extrabold min-w-[20px] h-5 px-1.5 ${
          activeSection === section.id
            ? isYtSection
              ? "bg-white text-red-700"
              : "bg-white text-blue-700"
            : "bg-rose-500 text-white"
        } ${mobile || !isSidebarCollapsed ? "right-2 top-2" : "right-1 top-1"}`}>
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
      {!mobile && activeSection === section.id && !isSidebarCollapsed && (
        <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-white/80" />
      )}
    </button>
  );
};

export const MovieHubNav: React.FC<MovieHubNavProps> = React.memo(
  ({
    sectionConfig,
    activeSection,
    isSidebarCollapsed,
    isMobileNavOpen,
    onToggleSidebar,
    onCloseMobileNav,
    onSelectSection,
  }) => {
    const standardSections = sectionConfig.filter((section) => !section.adminOnly);
    const adminSections = sectionConfig.filter(
      (section) => section.adminOnly && section.id !== "admin_yt_download",
    );
    const ytAdminSection = sectionConfig.find(
      (section) => section.id === "admin_yt_download",
    );

    return (
      <>
        {isMobileNavOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              onClick={onCloseMobileNav}
              className="absolute inset-0 bg-black/40"
              aria-label="Close navigation"
            />
            <aside className="absolute left-0 top-0 h-full w-[82vw] max-w-[320px] moviehub-panel border-r border-gray-200 dark:border-gray-700 p-4 overflow-y-auto moviehub-nav-scroll">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-gray-900 dark:text-white">MovieHub</h2>
                <button
                  onClick={onCloseMobileNav}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                >
                  Close
                </button>
              </div>
              <nav className="flex flex-col gap-2">
                {standardSections.map((section) => (
                  <NavItem
                    key={`mobile-${section.id}`}
                    section={section}
                    activeSection={activeSection}
                    isSidebarCollapsed={false}
                    onSelectSection={onSelectSection}
                    mobile
                  />
                ))}
                {adminSections.length > 0 && (
                  <div className="mt-2 rounded-xl border border-amber-300/50 dark:border-amber-700/60 bg-gradient-to-br from-amber-50/60 to-orange-50/40 dark:from-amber-900/20 dark:to-orange-900/10 p-2 shadow-inner">
                    <p className="px-2 pt-1 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                      Admin Tools
                    </p>
                    <p className="px-2 pb-1 text-[11px] text-amber-700/90 dark:text-amber-300/80">
                      Access, requests, and member controls.
                    </p>
                    <div className="flex flex-col gap-2">
                      {adminSections.map((section) => (
                        <NavItem
                          key={`mobile-admin-${section.id}`}
                          section={section}
                          activeSection={activeSection}
                          isSidebarCollapsed={false}
                          onSelectSection={onSelectSection}
                          mobile
                        />
                      ))}
                    </div>
                  </div>
                )}
                {ytAdminSection && (
                  <div className="mt-2 rounded-xl border border-red-300/60 dark:border-red-700/70 bg-gradient-to-br from-red-50/70 to-rose-50/50 dark:from-red-900/20 dark:to-rose-900/15 p-2 shadow-inner">
                    <p className="px-2 pt-1 text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">
                      Admin YT
                    </p>
                    <div className="mt-1">
                      <NavItem
                        key={`mobile-admin-${ytAdminSection.id}`}
                        section={ytAdminSection}
                        activeSection={activeSection}
                        isSidebarCollapsed={false}
                        onSelectSection={onSelectSection}
                        mobile
                      />
                    </div>
                  </div>
                )}
              </nav>
            </aside>
          </div>
        )}

        <aside className="hidden md:flex md:flex-col self-start moviehub-panel rounded-2xl p-3 h-fit max-h-[calc(100vh-7rem)] overflow-y-auto moviehub-nav-scroll transition-all duration-300">
          <div
            className={`mb-4 flex items-center ${
              isSidebarCollapsed ? "justify-center" : "justify-between"
            }`}
          >
            {!isSidebarCollapsed && (
              <div>
                <p className="text-lg font-extrabold text-gray-900 dark:text-white">MovieHub</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Requests, downloads, and library</p>
              </div>
            )}
            <button
              onClick={onToggleSidebar}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 dark:bg-slate-800 text-blue-700 dark:text-blue-300"
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isSidebarCollapsed ? ">>" : "<<"}
            </button>
          </div>
          <nav className={`flex flex-col gap-2 ${isSidebarCollapsed ? "" : "pr-1"}`}>
            {standardSections.map((section) => (
              <NavItem
                key={section.id}
                section={section}
                activeSection={activeSection}
                isSidebarCollapsed={isSidebarCollapsed}
                onSelectSection={onSelectSection}
              />
            ))}
            {adminSections.length > 0 && !isSidebarCollapsed && (
              <div
                className={`mt-2 rounded-xl border border-amber-300/50 dark:border-amber-700/60 bg-gradient-to-br from-amber-50/60 to-orange-50/40 dark:from-amber-900/20 dark:to-orange-900/10 shadow-inner ${
                  isSidebarCollapsed ? "px-1 py-2" : "px-2 py-2"
                }`}
              >
                {!isSidebarCollapsed && (
                  <>
                    <p className="px-2 pt-1 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                      Admin Tools
                    </p>
                    <p className="px-2 pb-1 text-[11px] text-amber-700/90 dark:text-amber-300/80">
                      Access, requests, and member controls.
                    </p>
                  </>
                )}
                <div className="flex flex-col gap-2">
                  {adminSections.map((section) => (
                    <NavItem
                      key={`admin-${section.id}`}
                      section={section}
                      activeSection={activeSection}
                      isSidebarCollapsed={isSidebarCollapsed}
                      onSelectSection={onSelectSection}
                    />
                  ))}
                </div>
              </div>
            )}
            {ytAdminSection && !isSidebarCollapsed && (
              <div className="mt-2 rounded-xl border border-red-300/60 dark:border-red-700/70 bg-gradient-to-br from-red-50/70 to-rose-50/50 dark:from-red-900/20 dark:to-rose-900/15 shadow-inner px-2 py-2">
                <p className="px-2 pt-1 text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-300">
                  Admin YT
                </p>
                <div className="mt-1">
                  <NavItem
                    key={`admin-${ytAdminSection.id}`}
                    section={ytAdminSection}
                    activeSection={activeSection}
                    isSidebarCollapsed={isSidebarCollapsed}
                    onSelectSection={onSelectSection}
                  />
                </div>
              </div>
            )}
            {adminSections.length > 0 && isSidebarCollapsed && (
              <div className="mt-1 pt-2 border-t border-slate-300/40 dark:border-slate-700/60 flex flex-col gap-1.5">
                {adminSections.map((section) => (
                  <NavItem
                    key={`admin-collapsed-${section.id}`}
                    section={section}
                    activeSection={activeSection}
                    isSidebarCollapsed={isSidebarCollapsed}
                    onSelectSection={onSelectSection}
                  />
                ))}
              </div>
            )}
            {ytAdminSection && isSidebarCollapsed && (
              <div className="mt-1 pt-2 border-t border-red-300/50 dark:border-red-700/60 flex flex-col gap-1.5">
                <NavItem
                  key={`admin-collapsed-${ytAdminSection.id}`}
                  section={ytAdminSection}
                  activeSection={activeSection}
                  isSidebarCollapsed={isSidebarCollapsed}
                  onSelectSection={onSelectSection}
                />
              </div>
            )}
          </nav>
        </aside>
      </>
    );
  }
);

MovieHubNav.displayName = "MovieHubNav";
