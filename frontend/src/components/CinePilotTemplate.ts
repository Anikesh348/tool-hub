export interface CinePilotTemplate {
  id: string;
  label: string;
  value: string;
}

export const CINE_PILOT_TEMPLATES: CinePilotTemplate[] = [
  {
    id: "movie-hd",
    label: "🎬 Download Om Shanti Om in HD quality",
    value: "Download Om Shanti Om in HD quality",
  },
  {
    id: "series-seasons",
    label: "📺 Download Season 1 and 2 of The Big Bang Theory",
    value: "Download Season 1 and 2 of The Big Bang Theory",
  },
];
