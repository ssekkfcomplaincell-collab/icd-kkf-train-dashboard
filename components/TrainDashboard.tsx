/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { StationRow, Train, Weekday } from "@/lib/types";

const RouteMap = dynamic(() => import("./RouteMap"), { ssr: false, loading: () => <div className="real-map map-loading">Loading India route map…</div> });

const WEEKDAYS: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type ServiceInstance = {
  key: string;
  train: Train;
  departureDate: Date;
  status: "DEPARTS TODAY" | "RUNNING NOW" | "COMPLETED";
  currentStation: string;
  nextStation: string;
  percent: number;
};

function todayInfo() {
  const now = new Date();
  return { date: now.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }), day: WEEKDAYS[(now.getDay() + 6) % 7] };
}
function wateringClass(value: string) { const v = value.toUpperCase(); if (v.includes("S/W")) return "sw"; if (v.includes("O/D")) return "od"; return ""; }
function firstTime(stations: StationRow[], field: "arrival" | "departure") { return stations.find((s) => /^\d{1,2}:\d{2}$/.test(s[field]))?.[field] || "—"; }
function isExcludedStation(s: StationRow) {
  const text = Object.values(s.raw || {}).join(" ").toLowerCase() + ` ${s.arrival} ${s.stationName}`.toLowerCase();
  return text.includes("deleted") || text.includes("via station");
}
function validStations(stations: StationRow[]) { return stations.filter((s) => !isExcludedStation(s)); }
function timeToMinutes(value: string) { const m = value.match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function rowDateTime(station: StationRow, departureDate: Date, field: "arrival" | "departure") {
  const day = Number.parseInt(station.day, 10);
  const tm = station[field].match(/^(\d{1,2}):(\d{2})$/);
  if (!Number.isFinite(day) || !tm) return null;
  const d = new Date(departureDate);
  d.setDate(d.getDate() + Math.max(0, day - 1));
  d.setHours(Number(tm[1]), Number(tm[2]), 0, 0);
  return d;
}
function dateKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function weekdayForDate(d: Date): Weekday { return WEEKDAYS[(d.getDay() + 6) % 7]; }
function atMidnight(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function serviceInstance(train: Train, departureDate: Date, now: Date): ServiceInstance | null {
  const stations = validStations(train.stations);
  if (stations.length < 2) return null;
  const start = rowDateTime(stations[0], departureDate, "departure") || rowDateTime(stations[0], departureDate, "arrival");
  const endStation = [...stations].reverse().find((s) => rowDateTime(s, departureDate, "arrival") || rowDateTime(s, departureDate, "departure"));
  const end = endStation ? (rowDateTime(endStation, departureDate, "arrival") || rowDateTime(endStation, departureDate, "departure")) : null;
  if (!start || !end) return null;

  if (now < start) {
    if (dateKey(departureDate) !== dateKey(now)) return null;
    return { key: `${train.trainNo}-${dateKey(departureDate)}`, train, departureDate, status: "DEPARTS TODAY", currentStation: stations[0].stationName, nextStation: stations[1].stationName, percent: 0 };
  }
  if (now > end) return null;

  let currentIndex = 0;
  for (let i = 0; i < stations.length; i++) {
    const t = rowDateTime(stations[i], departureDate, "departure") || rowDateTime(stations[i], departureDate, "arrival");
    if (t && t <= now) currentIndex = i;
  }
  const firstMs = start.getTime(), lastMs = end.getTime();
  const percent = Math.round(Math.max(0, Math.min(100, ((now.getTime() - firstMs) / Math.max(1, lastMs - firstMs)) * 100)));
  return { key: `${train.trainNo}-${dateKey(departureDate)}`, train, departureDate, status: "RUNNING NOW", currentStation: stations[Math.min(currentIndex, stations.length - 1)].stationName, nextStation: stations[Math.min(currentIndex + 1, stations.length - 1)].stationName, percent };
}

function activeInstances(train: Train, now: Date): ServiceInstance[] {
  const stations = validStations(train.stations);
  const maxDay = Math.max(1, ...stations.map((s) => Number.parseInt(s.day, 10)).filter(Number.isFinite));
  const out: ServiceInstance[] = [];
  for (let back = 0; back < maxDay; back++) {
    const depDate = atMidnight(new Date(now));
    depDate.setDate(depDate.getDate() - back);
    if (!train.runningDays?.[weekdayForDate(depDate)]) continue;
    const inst = serviceInstance(train, depDate, now);
    if (inst) out.push(inst);
  }
  return out.sort((a, b) => b.departureDate.getTime() - a.departureDate.getTime());
}

function trainDayLabel(train: Train) { const days = WEEKDAYS.filter((d) => train.runningDays?.[d]); return days.length ? days.map((d) => d.slice(0, 3)).join(" ") : "Not marked"; }

export default function TrainDashboard() {
  const [trains, setTrains] = useState<Train[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [search, setSearch] = useState("");
  const [stationSearch, setStationSearch] = useState("");
  const [wateringFilter, setWateringFilter] = useState("ALL");
  const [todayOnly, setTodayOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [lastRefresh, setLastRefresh] = useState("");
  const [now, setNow] = useState(new Date());

  async function load() {
    try {
      setLoading(true); setError("");
      const res = await fetch(`/api/trains?refresh=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Unable to load data");
      setTrains(data.trains); setUpdatedAt(data.updatedAt); setLastRefresh(new Date().toLocaleTimeString());
    } catch (e: any) { setError(e.message || "Unable to load Google Sheet"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(id); }, []);

  const { date: todayDate, day: todayDay } = todayInfo();
  const allInstances = useMemo(() => trains.flatMap((t) => activeInstances(t, now)), [trains, now]);
  const todaysInstances = useMemo(() => allInstances.filter((i) => i.status === "RUNNING NOW" || i.status === "DEPARTS TODAY"), [allInstances]);
  const mapInstances = useMemo(() => todaysInstances.map((inst) => ({ key: inst.key, trainNo: inst.train.trainNo, stations: validStations(inst.train.stations), departureDate: inst.departureDate, percent: inst.percent })), [todaysInstances]);
  const baseTrains = todayOnly ? trains.filter((t) => t.runningDays?.[todayDay] || activeInstances(t, now).length > 0) : trains;

  const filteredTrains = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return baseTrains;
    return baseTrains.filter((t) => {
      const routeStations = validStations(t.stations);
      const first = routeStations[0], last = routeStations[routeStations.length - 1];
      return t.trainNo.toLowerCase().includes(q) || first?.stationName.toLowerCase().includes(q) || last?.stationName.toLowerCase().includes(q) || first?.stationCode.toLowerCase().includes(q) || last?.stationCode.toLowerCase().includes(q);
    });
  }, [baseTrains, search]);

  useEffect(() => {
    if (!selectedKey && todaysInstances.length) setSelectedKey(todaysInstances[0].key);
    else if (selectedKey && !allInstances.some((x) => x.key === selectedKey)) setSelectedKey(todaysInstances[0]?.key || "");
  }, [selectedKey, allInstances, todaysInstances]);

  const selectedInstance = allInstances.find((x) => x.key === selectedKey) || todaysInstances[0] || null;
  const selected = selectedInstance?.train || filteredTrains[0] || trains[0] || null;
  const departureDate = selectedInstance?.departureDate || null;
  const stations = selected?.stations || [];
  const valid = validStations(stations);
  const filteredStations = useMemo(() => { const q = stationSearch.trim().toLowerCase(); return validStations(stations).filter((s) => { const textMatch = !q || s.stationCode.toLowerCase().includes(q) || s.stationName.toLowerCase().includes(q) || s.section.toLowerCase().includes(q) || s.watering.toLowerCase().includes(q); const waterMatch = wateringFilter === "ALL" || s.watering.toUpperCase().includes(wateringFilter); return textMatch && waterMatch; }); }, [stations, stationSearch, wateringFilter]);
  const watering = stations.filter((s) => s.watering);
  const source = valid[0], destination = valid[valid.length - 1];
  const totalDistance = destination?.distance || "—";
  const swCount = watering.filter((s) => s.watering.toUpperCase().includes("S/W")).length;
  const odCount = watering.filter((s) => s.watering.toUpperCase().includes("O/D")).length;
  const mappedCount = valid.filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude)).length;
  const routeDay = selectedInstance ? Math.max(1, Math.min(99, Math.floor((atMidnight(now).getTime() - atMidnight(departureDate!).getTime()) / 86400000) + 1)) : null;

  return <main className="page">
    <header className="topbar"><div><div className="eyebrow">ICD / KKF • OPERATIONS CONTROL</div><h1>Train Operations Dashboard</h1><p className="sub">Live schedule • departure date • Day 1/2/3 • geographic route progress</p></div><div className="top-actions"><span className={`live-dot ${loading ? "pulse" : ""}`} /><span>{loading ? "Refreshing…" : "Sheet Connected"}</span><button className="refresh" onClick={load} disabled={loading}>↻ {loading ? "Loading" : "Refresh"}</button></div></header>
    {error && <div className="error"><strong>Data loading error:</strong> {error}<div>Schedule is loaded from the published Google Sheet. Coordinate sheet is optional; stations without valid coordinates are skipped on the map.</div></div>}

    <section className="today-banner"><div><span>TODAY</span><strong>{todayDate}</strong><b>{todayDay}</b></div><div><span>ACTIVE / TODAY INSTANCES</span><strong>{todaysInstances.length}</strong><small>Includes previous-day departures still within Day 2/3</small></div><div><span>SELECTED DEPARTURE</span><strong>{departureDate ? departureDate.toLocaleDateString("en-IN") : "—"}</strong><small>{selectedInstance ? `${selectedInstance.status} • Day ${routeDay}` : "Select a train"}</small></div><button className={todayOnly ? "mode active" : "mode"} onClick={() => setTodayOnly((v) => !v)}>{todayOnly ? "✓ Today / Active" : "Show All Trains"}</button></section>

    <section className="stats"><div className="stat"><span>ACTIVE / TODAY</span><strong>{todaysInstances.length}</strong><small>Current date-aware instances</small></div><div className="stat"><span>TOTAL SCHEDULES</span><strong>{trains.length}</strong><small>Unique train numbers</small></div><div className="stat"><span>SELECTED</span><strong>{selected?.trainNo || "—"}</strong><small>{departureDate ? `Dep. ${departureDate.toLocaleDateString("en-IN")} • Day ${routeDay}` : trainDayLabel(selected || ({} as Train))}</small></div><div className="stat"><span>MAP COVERAGE</span><strong>{mappedCount}/{valid.length}</strong><small>stations with coordinates</small></div><div className="stat"><span>WATERING</span><strong>{watering.length}</strong><small>{swCount} S/W • {odCount} O/D</small></div></section>

    <section className="panel today-map-panel"><div className="panel-head"><div><div className="panel-kicker">TODAY / ACTIVE TRAIN INSTANCES</div><h2>{todayDay} • {todayDate}</h2></div><span className="count">{todaysInstances.length} instances</span></div>
      <div className="today-route-grid">{todaysInstances.map((inst) => { const first = validStations(inst.train.stations)[0], last = [...validStations(inst.train.stations)].reverse()[0]; return <button key={inst.key} className={`today-train-card ${inst.key === selectedInstance?.key ? "active" : ""}`} onClick={() => setSelectedKey(inst.key)}><div className="today-card-top"><b>{inst.train.trainNo}</b><span>{inst.status}</span></div><div className="today-route-line"><strong>{first?.stationCode || "—"}</strong><i>→</i><strong>{last?.stationCode || "—"}</strong></div><div className="today-route-name">Dep. {inst.departureDate.toLocaleDateString("en-IN")} • Day {Math.max(1, Math.floor((atMidnight(now).getTime() - atMidnight(inst.departureDate).getTime()) / 86400000) + 1)} • {inst.percent}% scheduled</div><div className="today-card-meta"><span>Current: {inst.currentStation}</span><span>Next: {inst.nextStation}</span></div></button>; })}{!todaysInstances.length && <div className="empty">No active or today-departing train instance found for the current date.</div>}</div>
      <div className="map-note">Previous-day departures are included when their Day 2/3 schedule is still active. The selected train&apos;s Departure Date remains the actual source/departure date.</div>
    </section>

    <section className="panel map-panel taptrack-shell"><div className="map-topbar"><div><div className="panel-kicker">ICD / KKF • LIVE OPERATIONS MAP</div><h2>Running trains • {todayDay}, {todayDate}</h2></div><div className="map-status"><b><span className="map-live-dot" /> {todaysInstances.length} trains running</b><span>{todaysInstances.length} service instances • schedule based</span></div></div>
      <div className="taptrack-map-stage">
        {todaysInstances.length ? <RouteMap instances={mapInstances} selectedKey={selectedInstance?.key || ""} onTrainClick={(key) => setSelectedKey(key)} /> : <div className="real-map map-loading">No active train instances for today.</div>}
        <aside className="map-left-drawer">
          <div className="map-brand"><div className="brand-mark">🚆</div><div><b>TapTrack Style</b><span>ICD / KKF</span></div><button onClick={() => setTodayOnly(true)}>Today</button></div>
          <div className="map-search-wrap"><input className="map-search" placeholder="Search train / station…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="map-train-list">{todaysInstances.filter((inst) => !search.trim() || inst.train.trainNo.toLowerCase().includes(search.toLowerCase()) || inst.currentStation.toLowerCase().includes(search.toLowerCase()) || inst.nextStation.toLowerCase().includes(search.toLowerCase())).map((inst) => { const colorIndex = todaysInstances.findIndex((x) => x.key === inst.key); return <button key={inst.key} className={`map-train-card ${selectedInstance?.key === inst.key ? "active" : ""}`} onClick={() => setSelectedKey(inst.key)}><div className="map-train-head"><span className="map-train-dot" style={{ background: ["#1769aa", "#8b1fc8", "#0f8a67", "#e07a00", "#3155d8", "#c43d76", "#1487a8", "#7356c8"][colorIndex % 8] }} /><b>{inst.train.trainNo}</b><small>Dep {inst.departureDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</small></div><div className="map-train-route">{validStations(inst.train.stations)[0]?.stationCode || "—"} <span>→</span> {validStations(inst.train.stations)[validStations(inst.train.stations).length - 1]?.stationCode || "—"}</div><div className="map-train-progress"><span><i style={{ width: `${inst.percent}%` }} /></span><b>{inst.percent}%</b></div><div className="map-train-meta">{inst.currentStation} <span>→ {inst.nextStation}</span></div></button>})}</div>
          <div className="map-list-footer"><span>● {todaysInstances.length} trains running</span><span>{todaysInstances.length} instances</span></div>
        </aside>
        {selectedInstance && <aside className="map-right-drawer">
          <div className="drawer-head"><div><div className="drawer-title"><span className="drawer-dot" /> {selectedInstance.train.trainNo}</div><div className="drawer-route">{source?.stationName || "—"} → {destination?.stationName || "—"}</div><small>Dep {departureDate?.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</small></div><button className="drawer-close" onClick={() => setSelectedKey("")}>×</button></div>
          <div className="drawer-progress"><div><span>{selectedInstance.currentStation} → {selectedInstance.nextStation}</span><b>{selectedInstance.percent}%</b></div><div className="drawer-track"><i style={{ width: `${selectedInstance.percent}%` }} /></div><small>Scheduled position • Day {routeDay}</small></div>
          <div className="drawer-tabs"><b>Route</b><span>Contacts</span><span>Staff</span><span>RM</span></div>
          <div className="drawer-note">Watering points: <b>{watering.length}</b> • S/W {swCount} • O/D {odCount}</div>
          <div className="drawer-stops">{valid.map((s, i) => { const st = rowDateTime(s, departureDate || now, "arrival") || rowDateTime(s, departureDate || now, "departure"); const passed = st ? now >= st : false; const isCurrent = selectedInstance.currentStation === s.stationName; return <div className={`drawer-stop ${passed ? "passed" : ""} ${isCurrent ? "current" : ""}`} key={`${s.stationCode}-${i}`}><span className="drawer-stop-dot" /> <div><b>{s.stationName} <em>{s.stationCode}</em></b><small>{s.arrival || s.departure || "—"} • Day {s.day} {s.watering ? <strong className={wateringClass(s.watering)}>{s.watering}</strong> : null}</small></div></div>; })}</div>
        </aside>}
      </div>
    </section>

    <section className="dashboard-grid"><aside className="panel train-panel"><div className="panel-head"><div><div className="panel-kicker">TRAIN DIRECTORY</div><h2>{todayOnly ? "Today / Active" : "All Trains"}</h2></div><span className="count">{filteredTrains.length}/{baseTrains.length}</span></div><input className="search" placeholder="🔎 Train no / station / code…" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="train-list">{filteredTrains.map((train) => { const activeInstancesForTrain = allInstances.filter((x) => x.train.trainNo === train.trainNo); const active = selected?.trainNo === train.trainNo; const routeStations = validStations(train.stations); const first = routeStations[0], last = routeStations[routeStations.length - 1]; return <button key={train.trainNo} className={`train-item ${active ? "active" : ""}`} onClick={() => { const inst = activeInstancesForTrain[0]; setSelectedKey(inst?.key || ""); }}><div className="train-no">{train.trainNo}</div><div className="train-route">{first?.stationCode || "—"} <span>→</span> {last?.stationCode || "—"}</div><div className="train-name">{first?.stationName || "—"} → {last?.stationName || "—"}</div><div className="train-days">{activeInstancesForTrain.length ? `${activeInstancesForTrain.length} active instance${activeInstancesForTrain.length > 1 ? "s" : ""}` : trainDayLabel(train)}</div></button>; })}{!filteredTrains.length && <div className="empty">No trains found.</div>}</div></aside>

      <section className="panel route-panel"><div className="panel-head"><div><div className="panel-kicker">SELECTED ROUTE</div><h2>{selected?.trainNo || "—"} Route</h2></div><div className="schedule-note">{selectedInstance ? `${selectedInstance.status} • DAY ${routeDay}` : "NO ACTIVE INSTANCE"}</div></div><div className="route-summary"><div><span>ORIGIN</span><strong>{source?.stationName || "—"}</strong><small>{source?.stationCode || "—"} • {firstTime(stations, "departure")}</small></div><div className="route-arrow">→</div><div><span>DESTINATION</span><strong>{destination?.stationName || "—"}</strong><small>{destination?.stationCode || "—"} • {destination?.arrival || "—"}</small></div></div><div className="progress-card"><div className="progress-head"><div><span>SCHEDULED STATUS</span><b>{selectedInstance?.status || "Schedule"}</b></div><strong>{selectedInstance?.percent || 0}%</strong></div><div className="progress-track"><div style={{ width: `${selectedInstance?.percent || 0}%` }} /></div><div className="progress-stations"><span>Current: <b>{selectedInstance?.currentStation || "—"}</b></span><span>Next: <b>{selectedInstance?.nextStation || "—"}</b></span></div></div><div className="route-visual" aria-label="Schematic route map"><div className="route-line" />{valid.map((s, i) => <div className="route-stop" key={`${s.stationCode}-${i}`}><div className={`stop-dot ${s.watering ? "watering-dot" : ""}`} /><div className="stop-label"><b>{s.stationCode}</b><span>{s.stationName}</span><small>Day {s.day} • {s.arrival || s.departure || ""}</small></div></div>)}</div><div className="legend"><span><i className="legend-dot" /> Station</span><span><i className="legend-dot water-legend" /> Watering point</span><span><i className="legend-solid" /> Completed map route</span><span><i className="legend-dashed" /> Pending map route</span></div></section>

      <aside className="panel detail-panel"><div className="panel-kicker">SELECTED TRAIN INSTANCE</div><div className="big-train">{selected?.trainNo || "—"}</div><div className="detail-route">{source?.stationCode || "—"} → {destination?.stationCode || "—"}</div><div className="detail-cards"><div><span>DEP. DATE</span><b>{departureDate ? departureDate.toLocaleDateString("en-IN") : "—"}</b></div><div><span>TRAIN DAY</span><b>{routeDay ? `DAY ${routeDay}` : "—"}</b></div><div><span>STATUS</span><b>{selectedInstance?.status || "—"}</b></div><div><span>MAP</span><b>{mappedCount}/{valid.length}</b></div></div><div className="mini-alert"><span>Weekday service check</span><b>{selected ? (selected.runningDays?.[weekdayForDate(departureDate || now)] ? `YES • ${weekdayForDate(departureDate || now)}` : `NO • ${weekdayForDate(departureDate || now)}`) : "—"}</b><small>Departure date is derived from the train&apos;s Monday–Sunday Y/N schedule.</small></div><div className="watering-box"><div className="panel-kicker">WATERING POINTS</div>{watering.length === 0 ? <div className="muted">No watering points in source data.</div> : watering.map((s, i) => <div className="watering-row" key={`${s.stationCode}-${i}`}><div><b>{s.stationCode}</b><span>{s.stationName}</span></div><em className={wateringClass(s.watering)}>{s.watering}</em></div>)}</div><div className="source-note"><b>Data source</b><span>Schedule + coordinate Google Sheets</span><small>{updatedAt ? `Sheet fetched ${new Date(updatedAt).toLocaleString()}` : "—"}</small><small>{lastRefresh ? `Dashboard refreshed ${lastRefresh}` : ""}</small></div></aside></section>

    <section className="panel table-panel"><div className="panel-head table-head"><div><div className="panel-kicker">STATION SCHEDULE</div><h2>{selected?.trainNo || "—"} • Route Stations</h2></div><div className="table-tools"><select value={wateringFilter} onChange={(e) => setWateringFilter(e.target.value)}><option value="ALL">All stations</option><option value="S/W">S/W only</option><option value="O/D">O/D only</option></select><input className="table-search" placeholder="Filter station / section…" value={stationSearch} onChange={(e) => setStationSearch(e.target.value)} /></div></div><div className="table-wrap"><table><thead><tr><th>S.No.</th><th>Station</th><th>Arrival</th><th>Departure</th><th>Halt</th><th>Distance</th><th>Day</th><th>Section</th><th>Section KM</th><th>Watering</th></tr></thead><tbody>{filteredStations.map((s, i) => <tr key={`${s.stationCode}-${i}`} className=""><td>{s.sno || i + 1}</td><td><strong>{s.stationCode}</strong><span className="station-name">{s.stationName}</span></td><td>{s.arrival || "—"}</td><td>{s.departure || "—"}</td><td>{s.halt || "—"}</td><td>{s.distance || "—"}</td><td>{s.day || "—"}</td><td>{s.section || "—"}</td><td>{s.sectionKm || "—"}</td><td>{s.watering ? <span className={`water ${wateringClass(s.watering)}`}>{s.watering}</span> : "—"}</td></tr>)}</tbody></table></div></section>
    <footer><span>ICD / KKF Train Operations</span><span>Departure-date aware • Day 1/2/3 • Solid completed route • Dotted pending route</span></footer>
  </main>;
}
