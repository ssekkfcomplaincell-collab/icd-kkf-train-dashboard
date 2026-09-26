"use client";

import { Fragment, useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { DivIcon } from "leaflet";
import { StationRow } from "@/lib/types";
import fallbackStations from "@/data/stations.json";

export type MapTrainInstance = {
  key: string;
  trainNo: string;
  stations: StationRow[];
  departureDate: Date;
  percent: number;
  currentStationName: string;
};

function isExcludedStation(station: StationRow) {
  const text = `${station.stationCode} ${station.stationName} ${station.trainNo} ${station.section} ${station.watering} ${station.arrival} ${station.departure}`.toLowerCase();
  return text.includes("deleted") || text.includes("via station");
}


function stationCoord(station: StationRow): [number, number] | null {
  if (Number.isFinite(station.latitude) && Number.isFinite(station.longitude)) {
    return [station.latitude as number, station.longitude as number];
  }
  const code = String(station.stationCode || "").trim().toUpperCase();
  const list = fallbackStations as Array<any>;
  const item = list.find((x) => String(x?.code || "").trim().toUpperCase() === code);
  const lat = Number(item?.coordinates?.latitude);
  const lon = Number(item?.coordinates?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

function spreadPosition(base: [number, number], sameCount: number, index: number): [number, number] {
  if (sameCount <= 1) return base;
  const radius = 0.13;
  const angle = (2 * Math.PI * index) / sameCount;
  return [base[0] + Math.sin(angle) * radius, base[1] + Math.cos(angle) * radius];
}

const INDIA_BOUNDS: [[number, number], [number, number]] = [[7.8, 68.0], [37.2, 97.5]];

function FitBounds({ points, selected }: { points: [number, number][], selected: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) {
      // When no train is selected, frame only the stations/current positions
      // of trains that are running now. This keeps the map close to the
      // operational area instead of showing the whole country.
      map.fitBounds(points, { padding: selected ? [45, 45] : [70, 70], maxZoom: selected ? 8 : 7.5 });
      return;
    }
    map.fitBounds(INDIA_BOUNDS, { padding: [12, 12], maxZoom: 5.6 });
  }, [map, points, selected]);
  return null;
}

function segmentTime(station: StationRow, departureDate: Date, field: "arrival" | "departure") {
  const day = Number.parseInt(station.day, 10);
  const time = station[field].match(/^(\d{1,2}):(\d{2})$/);
  if (!Number.isFinite(day) || !time) return null;
  const d = new Date(departureDate);
  d.setDate(d.getDate() + Math.max(0, day - 1));
  d.setHours(Number(time[1]), Number(time[2]), 0, 0);
  return d;
}

function interpolate(a: [number, number], b: [number, number], ratio: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
}

function trainColor(index: number) {
  const colors = ["#1769aa", "#8b1fc8", "#0f8a67", "#e07a00", "#3155d8", "#c43d76", "#1487a8", "#7356c8"];
  return colors[index % colors.length];
}

function labelIcon(trainNo: string, color: string, selected: boolean) {
  return new DivIcon({
    className: "train-map-label-wrap",
    html: `<div class="train-map-label ${selected ? "selected" : ""}" style="--train-color:${color}"><span class="train-map-pulse"></span><b>${trainNo}</b></div>`,
    iconSize: [82, 30],
    iconAnchor: [41, 15],
  });
}

function nextWateringStation(stations: StationRow[], currentStationName: string) {
  const routeStations = stations.filter((s) => !isExcludedStation(s));
  const currentIndex = routeStations.findIndex((s) =>
    s.stationName.trim().toLowerCase() === currentStationName.trim().toLowerCase()
  );
  const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  return routeStations.slice(startIndex).find((s) => s.watering?.trim()) || null;
}

function formatDepartureDate(date: Date) {
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function RouteMap({
  instances,
  selectedKey,
  onTrainClick,
}: {
  instances: MapTrainInstance[];
  selectedKey: string;
  onTrainClick: (key: string) => void;
}) {
  const routes = useMemo(() => instances.map((instance, index) => {
    const mapStations = instance.stations
      .filter((s) => !isExcludedStation(s))
      .map((station) => ({ station, coord: stationCoord(station) }))
      .filter((x): x is { station: StationRow; coord: [number, number] } => Boolean(x.coord));
    const points = mapStations.map((x) => x.coord);

    let current: [number, number] | null = null;
    const solid: [number, number][][] = [];
    const dotted: [number, number][][] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const stations = mapStations.map((x) => x.station);
      const a = stations[i];
      const b = stations[i + 1];
      const dep = segmentTime(a, instance.departureDate, "departure");
      const arr = segmentTime(b, instance.departureDate, "arrival");
      if (!dep || !arr) { dotted.push([points[i], points[i + 1]]); continue; }
      const now = new Date();
      if (now >= arr) solid.push([points[i], points[i + 1]]);
      else if (now <= dep) dotted.push([points[i], points[i + 1]]);
      else {
        const ratio = Math.max(0, Math.min(1, (now.getTime() - dep.getTime()) / Math.max(1, arr.getTime() - dep.getTime())));
        current = interpolate(points[i], points[i + 1], ratio);
        solid.push([points[i], current]);
        dotted.push([current, points[i + 1]]);
      }
    }

    if (!current && points.length) {
      const stations = mapStations.map((x) => x.station);
      const now = new Date();
      for (let i = 0; i < stations.length - 1; i++) {
        const dep = segmentTime(stations[i], instance.departureDate, "departure");
        const arr = segmentTime(stations[i + 1], instance.departureDate, "arrival");
        if (dep && arr && now >= dep && now < arr) {
          const ratio = Math.max(0, Math.min(1, (now.getTime() - dep.getTime()) / Math.max(1, arr.getTime() - dep.getTime())));
          current = interpolate(points[i], points[i + 1], ratio);
          break;
        }
      }
    }

    return { instance, index, points, solid, dotted, current, color: trainColor(index) };
  }), [instances]);

  const selectedRoute = routes.find((r) => r.instance.key === selectedKey);
  const visibleRoutes = selectedKey ? routes.filter((r) => r.instance.key === selectedKey) : routes;
  const runningPoints = visibleRoutes
    .map((r) => {
      const routeStations = r.instance.stations.filter((s) => !isExcludedStation(s));
      const currentStation = routeStations.find((s) => s.stationName === r.instance.currentStationName);
      const currentCoord = currentStation ? stationCoord(currentStation) : null;
      return currentCoord || r.current || r.points[Math.max(0, Math.min(r.points.length - 1, Math.round((r.instance.percent / 100) * (r.points.length - 1))))];
    })
    .filter(Boolean) as [number, number][];
  const mapFitPoints = selectedRoute?.points.length ? selectedRoute.points : runningPoints;
  const center: [number, number] = [22.5, 79.0];

  return <div className="real-map taptrack-map">
    <MapContainer
      center={center}
      zoom={6.2}
      minZoom={4.8}
      maxZoom={12}
      maxBounds={[[5.5, 66.5], [38.5, 99.5]]}
      maxBoundsViscosity={1.0}
      scrollWheelZoom
      className="leaflet-map"
    >
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitBounds points={mapFitPoints} selected={Boolean(selectedRoute)} />
      {routes.map((route) => <Fragment key={route.instance.key}>
        {route.instance.key === selectedKey && route.solid.map((line, i) => <Polyline key={`s-${route.instance.key}-${i}`} positions={line} pathOptions={{ color: route.color, weight: 6, opacity: 0.95 }} />)}
        {route.instance.key === selectedKey && route.dotted.map((line, i) => <Polyline key={`d-${route.instance.key}-${i}`} positions={line} pathOptions={{ color: route.color, weight: 5, opacity: 0.8, dashArray: "7 9" }} />)}
        {route.points.length > 0 && (() => {
          const routeStations = route.instance.stations.filter((s) => !isExcludedStation(s));
          const currentStation = routeStations.find((s) => s.stationName === route.instance.currentStationName);
          const markerPositionBase = (currentStation ? stationCoord(currentStation) : null)
            || route.current
            || route.points[Math.max(0, Math.min(route.points.length - 1, Math.round((route.instance.percent / 100) * (route.points.length - 1))))];
          const sameStationRoutes = routes.filter((x) => x.instance.currentStationName.trim().toLowerCase() === route.instance.currentStationName.trim().toLowerCase() && x.points.length);
          const sameIndex = sameStationRoutes.findIndex((x) => x.instance.key === route.instance.key);
          const markerPosition = markerPositionBase ? spreadPosition(markerPositionBase, sameStationRoutes.length, Math.max(0, sameIndex)) : null;
          const nextWatering = nextWateringStation(route.instance.stations, route.instance.currentStationName);
          const isSelected = route.instance.key === selectedKey;
          const isVisible = !selectedKey || isSelected;
          if (!isVisible) return null;
          if (!markerPosition) return null;
          return <Marker
            position={markerPosition}
            icon={labelIcon(route.instance.trainNo, route.color, isSelected)}
            eventHandlers={{ click: () => onTrainClick(route.instance.key) }}
            zIndexOffset={isSelected ? 1000 : 200}
          >
            <Tooltip direction="top" offset={[0, -16]} opacity={1} className="train-hover-tooltip">
              <div className="train-hover-tooltip-content">
                <b>Train {route.instance.trainNo}</b>
                <span>Departure: {formatDepartureDate(route.instance.departureDate)}</span>
                <span>Current: {route.instance.currentStationName}</span>
                <span>Next Watering: {nextWatering ? `${nextWatering.stationName} • ${nextWatering.watering}` : "None"}</span>
              </div>
            </Tooltip>
          </Marker>;
        })()}
        {route.instance.key === selectedKey && route.points.map((point, i) => <CircleMarker key={`p-${route.instance.key}-${i}`} center={point} radius={4} pathOptions={{ color: route.color, weight: 1, fillOpacity: .85 }} eventHandlers={{ click: () => onTrainClick(route.instance.key) }} />)}
      </Fragment>)}
    </MapContainer>
    <div className="map-overlay-legend taptrack-legend"><span><i className="solid-swatch" /> Completed</span><span><i className="dotted-swatch" /> Pending</span><span>● Click train number for route</span></div>
  </div>;
}
