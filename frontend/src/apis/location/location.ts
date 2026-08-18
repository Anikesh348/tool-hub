import { requestJson } from "../../utils/apiRequest";

const BASE_URL = (import.meta.env.VITE_BASE_BACKEND_URL || "").replace(/\/$/, "");

export type LocationRange = "today" | "week" | "month" | "day";

export interface ZoneBreakdownRow {
  zone: string;
  label: string;
  minutes: number;
}

export interface LocationStay {
  zone: string | null;
  label: string;
  address: string | null;
  arrivedAt: string;
  departedAt: string | null;
  durationMinutes: number;
  current: boolean;
  latitude: number | null;
  longitude: number | null;
  fromLabel: string | null;
  travelMinutes: number | null;
  travelDistanceKm: number | null;
}

export interface LocationSummary {
  range: LocationRange;
  date?: string | null;
  rangeStart: string;
  rangeEnd: string;
  currentZone: string | null;
  currentZoneLabel: string;
  zoneBreakdown: ZoneBreakdownRow[];
  totalTrips: number;
  totalDistanceKm: number;
  stays: LocationStay[];
  previousTotalTrips: number;
  previousTotalDistanceKm: number;
  previousZoneMinutes: Record<string, number>;
  computedAt?: string;
}

/** Zone/place kind, inferred client-side from LocationStay.zone, used to pick an icon. */
export type LocationStayKind = "home" | "office" | "place" | "traveling" | "zone" | "unknown";

export const stayKind = (zone: string | null): LocationStayKind => {
  if (!zone) return "unknown";
  if (zone === "home") return "home";
  if (zone === "office") return "office";
  if (zone === "not_home") return "traveling";
  if (zone.startsWith("place:")) return "place";
  return "zone";
};

/** Percent change vs. the previous equivalent period, or null if there's no baseline. */
export const percentDelta = (current: number, previous: number): number | null => {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
};

export interface LocationCurrentStatus {
  zone: string | null;
  zoneLabel: string;
  since: string | null;
  lastPingAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface LocationPlace {
  _id: string;
  label: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  radiusKm: number;
  source: "auto" | "manual";
  createdAt: string;
  updatedAt: string;
}

export interface LocationTimelineEvent {
  occurredAt: string;
  fromZone: string | null;
  fromZoneLabel: string;
  toZone: string;
  toZoneLabel: string;
  latitude: number | null;
  longitude: number | null;
}

export const fetchLocationSummary = async (range: LocationRange, date?: string): Promise<LocationSummary> => {
  const query = range === "day" && date ? `range=day&date=${date}` : `range=${range}`;
  const { body } = await requestJson<{ response: LocationSummary }>(
    `${BASE_URL}/v2/location/summary?${query}`,
  );
  if (!body?.response) throw new Error("Failed to load location summary");
  return body.response;
};

export const fetchLocationCurrent = async (): Promise<LocationCurrentStatus> => {
  const { body } = await requestJson<{ response: LocationCurrentStatus }>(
    `${BASE_URL}/v2/location/current`,
  );
  if (!body?.response) throw new Error("Failed to load current location");
  return body.response;
};

export const fetchLocationTimeline = async (
  days: number,
): Promise<{ days: number; events: LocationTimelineEvent[] }> => {
  const { body } = await requestJson<{ response: { days: number; events: LocationTimelineEvent[] } }>(
    `${BASE_URL}/v2/location/timeline?days=${days}`,
  );
  if (!body?.response) throw new Error("Failed to load location timeline");
  return body.response;
};

export interface LocationRoutePoint {
  occurredAt: string;
  latitude: number;
  longitude: number;
  zone: string | null;
}

export interface LocationRoute {
  range: LocationRange;
  date?: string | null;
  rangeStart: string;
  rangeEnd: string;
  points: LocationRoutePoint[];
  /** Road-snapped version of `points` (via OSRM map matching), for drawing the route line - falls back to the raw point coordinates wherever snapping wasn't possible. */
  path: [number, number][];
}

export const fetchLocationRoute = async (range: LocationRange, date?: string): Promise<LocationRoute> => {
  const query = range === "day" && date ? `range=day&date=${date}` : `range=${range}`;
  const { body } = await requestJson<{ response: LocationRoute }>(
    `${BASE_URL}/v2/location/route?${query}`,
  );
  if (!body?.response) throw new Error("Failed to load location route");
  return body.response;
};

export const fetchLocationPlaces = async (): Promise<LocationPlace[]> => {
  const { body } = await requestJson<{ response: LocationPlace[] }>(`${BASE_URL}/v2/location/places`);
  return body?.response || [];
};

export const renameLocationPlace = async (placeId: string, label: string): Promise<LocationPlace> => {
  const { body } = await requestJson<{ response: LocationPlace }>(
    `${BASE_URL}/v2/location/places/${placeId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    },
  );
  if (!body?.response) throw new Error("Failed to rename place");
  return body.response;
};

export const createLocationPlace = async (
  label: string,
  latitude: number,
  longitude: number,
): Promise<LocationPlace> => {
  const { body } = await requestJson<{ response: LocationPlace }>(`${BASE_URL}/v2/location/places`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, latitude, longitude }),
  });
  if (!body?.response) throw new Error("Failed to add place");
  return body.response;
};
