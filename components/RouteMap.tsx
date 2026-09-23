"use client";

import { Fragment, useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { DivIcon } from "leaflet";
import { StationRow } from "@/lib/types";

export type MapTrainInstance = {
  key: string;
  trainNo: string;
  stations: StationRow[];
  departureDate: Date;
  percent: number;
  currentStationName: string;
};

function isExcludedStation(station: StationRow) {
  const text = Object.values(station.raw || {}).join(" ").toLowerCase() + ` ${station.arrival} ${station.stationName}`.toLowerCase();
  return text.includes("deleted") || text.includes("via station");
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    map.fitBounds(points, { padding: [55, 55], maxZoom: 7 });
  }, [map, points]);
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
    const points = instance.stations
      .filter((s) => !isExcludedStation(s))
      .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
      .map((station) => [station.latitude as number, station.longitude as number] as [number, number]);

    let current: [number, number] | null = null;
    const solid: [number, number][][] = [];
    const dotted: [number, number][][] = [];

    for (let i = 0; i < points.length - 1; i++) {
      const stations = instance.stations.filter((s) => !isExcludedStation(s)).filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
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
      const stations = instance.stations.filter((s) => !isExcludedStation(s)).filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
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
  const mapFitPoints = selectedRoute?.points.length ? selectedRoute.points : routes.flatMap((r) => {
    const station = r.instance.stations.find((s) => s.stationName === r.instance.currentStationName && Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
    return station ? [[station.latitude as number, station.longitude as number] as [number, number]] : r.points.slice(0, 1);
  });
  const center: [number, number] = mapFitPoints.length ? mapFitPoints[Math.floor(mapFitPoints.length / 2)] : [22.5, 79];

  return <div className="real-map taptrack-map">
    <MapContainer center={center} zoom={5} scrollWheelZoom className="leaflet-map">
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitBounds points={mapFitPoints} />
      {routes.map((route) => <Fragment key={route.instance.key}>
        {route.instance.key === selectedKey && route.solid.map((line, i) => <Polyline key={`s-${route.instance.key}-${i}`} positions={line} pathOptions={{ color: route.color, weight: 6, opacity: 0.95 }} />)}
        {route.instance.key === selectedKey && route.dotted.map((line, i) => <Polyline key={`d-${route.instance.key}-${i}`} positions={line} pathOptions={{ color: route.color, weight: 5, opacity: 0.8, dashArray: "7 9" }} />)}
        {route.points.length > 0 && (() => {
          const routeStations = route.instance.stations
            .filter((s) => !isExcludedStation(s))
            .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
          const currentStation = routeStations.find((s) => s.stationName === route.instance.currentStationName);
          const markerPosition = currentStation
            ? [currentStation.latitude as number, currentStation.longitude as number] as [number, number]
            : route.current || route.points[Math.max(0, Math.min(route.points.length - 1, Math.round((route.instance.percent / 100) * (route.points.length - 1))))];
          const nextWatering = nextWateringStation(route.instance.stations, route.instance.currentStationName);
          const isSelected = route.instance.key === selectedKey;
          const isVisible = !selectedKey || isSelected;
          if (!isVisible) return null;
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
