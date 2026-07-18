import React from "react";
import {
  Clapperboard,
  Clock3,
  Download,
  Home,
  LibraryBig,
  Play,
  ShieldCheck,
  UserCheck,
  Users,
  Video,
  LockKeyhole,
} from "lucide-react";
import { MovieHubSection, SectionConfig } from "./types";

type MovieHubNavProps = {
  sectionConfig: SectionConfig[];
  activeSection: MovieHubSection;
  onSelectSection: (section: MovieHubSection) => void;
};

const iconBySection: Record<
  MovieHubSection,
  React.ComponentType<{ className?: string }>
> = {
  available: Home,
  open: Play,
  request: Clapperboard,
  status: LibraryBig,
  downloading: Download,
  admin_approve: ShieldCheck,
  admin_yt_download: Video,
  admin_access: UserCheck,
  admin_users: Users,
};

const primarySections: MovieHubSection[] = [
  "available",
  "open",
  "request",
  "status",
  "downloading",
];

const NavButton: React.FC<{
  section: SectionConfig;
  active: boolean;
  onSelect: (section: MovieHubSection) => void;
}> = ({ section, active, onSelect }) => {
  const Icon = iconBySection[section.id] || Clock3;
  const badgeCount = section.badgeCount || 0;

  return (
    <button
      onClick={() => !section.disabled && onSelect(section.id)}
      disabled={section.disabled}
      className={`moviehub-stream-nav-link ${active ? "moviehub-stream-nav-link-active" : ""} ${
        section.adminOnly ? "moviehub-stream-nav-link-admin" : ""
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{section.label}</span>
      {badgeCount > 0 && (
        <span className="moviehub-nav-badge">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </button>
  );
};

export const MovieHubNav: React.FC<MovieHubNavProps> = React.memo(
  ({ sectionConfig, activeSection, onSelectSection }) => {
    const viewerSections = primarySections
      .map((id) => sectionConfig.find((section) => section.id === id))
      .filter((section): section is SectionConfig => Boolean(section));
    const adminSections = sectionConfig.filter((section) => section.adminOnly);

    return (
      <div className="moviehub-stream-nav">
        <div className="moviehub-stream-nav-main">
          <div className="moviehub-stream-nav-links moviehub-nav-scroll">
            {viewerSections.map((section) => (
              <NavButton
                key={section.id}
                section={section}
                active={activeSection === section.id}
                onSelect={onSelectSection}
              />
            ))}
          </div>

          <div className="hidden items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 xl:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.75)]" />
            Streaming online
          </div>
        </div>

        {adminSections.length > 0 && (
          <div className="moviehub-studio-strip moviehub-nav-scroll">
            <span className="moviehub-studio-label">
              <LockKeyhole className="h-3 w-3" />
              Admin Studio
            </span>
            {adminSections.map((section) => (
              <NavButton
                key={section.id}
                section={section}
                active={activeSection === section.id}
                onSelect={onSelectSection}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);

MovieHubNav.displayName = "MovieHubNav";
