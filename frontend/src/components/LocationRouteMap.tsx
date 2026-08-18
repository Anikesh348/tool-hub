import "leaflet/dist/leaflet.css";
import { LatLngBoundsExpression, LatLngTuple, divIcon } from "leaflet";
import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { useTheme } from "../context/ThemeContext";
import { LocationRoutePoint, LocationStay, stayKind } from "../apis/location/location";
import { formatIstTime } from "../utils/formatIst";
import { formatMinutes } from "./LocationShared";

const MARKER_COLOR: Record<string, string> = {
  home: "#8b5cf6",
  office: "#3b82f6",
  place: "#14b8a6",
  traveling: "#f59e0b",
  zone: "#64748b",
  unknown: "#64748b",
};

const stayMarkerIcon = (zone: string | null) =>
  divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:9999px;background:${MARKER_COLOR[stayKind(zone)]};border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.35)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
  }, [bounds, map]);
  return null;
}

export default function LocationRouteMap({
  points,
  path: snappedPath,
  stays,
}: {
  points: LocationRoutePoint[];
  path: [number, number][];
  stays: LocationStay[];
}) {
  const { theme } = useTheme();

  const path = useMemo<LatLngTuple[]>(
    () => (snappedPath.length ? snappedPath : points.map((point) => [point.latitude, point.longitude])),
    [snappedPath, points],
  );
  const markers = useMemo(
    () => stays.filter((stay) => stay.latitude != null && stay.longitude != null),
    [stays],
  );

  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    const all: LatLngTuple[] = [...path, ...markers.map((stay) => [stay.latitude!, stay.longitude!] as LatLngTuple)];
    return all.length ? all : null;
  }, [path, markers]);

  if (!points.length) {
    return (
      <div className="flex h-80 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] sm:h-96">
        <p className="text-sm text-slate-500">No GPS breadcrumbs recorded in this range yet.</p>
      </div>
    );
  }

  const tileUrl =
    theme === "dark"
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  return (
    <div className="h-80 overflow-hidden rounded-2xl border border-white/10 sm:h-96">
      <MapContainer center={path[0]} zoom={14} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url={tileUrl}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <Polyline positions={path} pathOptions={{ color: "#8b5cf6", weight: 3, opacity: 0.85 }} />
        {markers.map((stay, index) => (
          <Marker key={`${stay.arrivedAt}-${index}`} position={[stay.latitude!, stay.longitude!]} icon={stayMarkerIcon(stay.zone)}>
            <Popup>
              <div className="text-xs">
                <p className="font-semibold">{stay.label}</p>
                <p>
                  {formatIstTime(stay.arrivedAt)}
                  {stay.departedAt ? ` – ${formatIstTime(stay.departedAt)}` : " – ongoing"}
                </p>
                <p>{formatMinutes(stay.durationMinutes)}</p>
              </div>
            </Popup>
          </Marker>
        ))}
        <FitBounds bounds={bounds} />
      </MapContainer>
    </div>
  );
}
