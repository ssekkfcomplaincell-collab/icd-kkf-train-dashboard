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
  const text = `${s.stationCode} ${s.stationName} ${s.trainNo} ${s.section} ${s.watering} ${s.arrival} ${s.departure}`.toLowerCase();
  return text.includes("deleted") || text.includes("via station");
}
function validStations(stations: StationRow[]) { return stations.filter((s) => !isExcludedStation(s)); }
function timeToMinutes(value: string) { const m = value.match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function scheduleDayNumber(value: string) {
  const m = String(value ?? "").match(/\d+/);
  return m ? Number(m[0]) : NaN;
}
function rowDateTime(station: StationRow, departureDate: Date, field: "arrival" | "departure") {
  const day = scheduleDayNumber(station.day);
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
  const maxDay = Math.max(1, ...stations.map((s) => scheduleDayNumber(s.day)).filter(Number.isFinite));
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
  const [wateringDismissed, setWateringDismissed] = useState<Record<string, boolean>>({});
  const [wateringInputs, setWateringInputs] = useState<Record<string, string>>({});
  const [showRunningList, setShowRunningList] = useState(false);
  const [showTodayList, setShowTodayList] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [hideAll, setHideAll] = useState(false);
  const [fitAllToken, setFitAllToken] = useState(0);

  async function load(options: { silent?: boolean; force?: boolean } = {}) {
    const { silent = false, force = false } = options;
    try {
      if (!silent) setLoading(true);
      setError("");
      // Always render cached/local data first. Network refresh is background-only.
      // The API itself deduplicates the full Google Sheet fetch for 60 seconds.
      const res = await fetch("/api/trains", { cache: "default" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Unable to load data");
      setTrains(data.trains);
      setUpdatedAt(data.updatedAt);
      setLastRefresh(new Date().toLocaleTimeString());
      try {
        window.localStorage.setItem("icd-kkf-train-cache-v1", JSON.stringify({
          savedAt: Date.now(),
          updatedAt: data.updatedAt,
          trains: data.trains
        }));
      } catch { /* localStorage is optional */ }
    } catch (e: any) {
      setError(e.message || "Unable to load Google Sheet");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    try {
      const savedInputs = window.localStorage.getItem("icd-kkf-watering-inputs-v1");
      if (savedInputs) setWateringInputs(JSON.parse(savedInputs));
      const savedTheme = window.localStorage.getItem("icd-kkf-theme-v1");
      if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
    } catch { /* ignore invalid local state */ }

    let hasCache = false;
    try {
      const cached = window.localStorage.getItem("icd-kkf-train-cache-v1");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed?.trains) && parsed.trains.length) {
          setTrains(parsed.trains);
          setUpdatedAt(parsed.updatedAt || "");
          hasCache = true;
          setLoading(false);
        }
      }
    } catch { /* ignore invalid cache */ }

    // Show cached data immediately, then refresh quietly in the background.
    void load({ silent: hasCache });

    // Quietly revalidate in the background. The page never blanks while the
    // sheet is being fetched, and the API reuses its server-side cache.
    const refreshId = window.setInterval(() => {
      void load({ silent: true });
    }, 60_000);
    return () => window.clearInterval(refreshId);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage.setItem("icd-kkf-theme-v1", theme); } catch {}
  }, [theme]);

  useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 30000); return () => window.clearInterval(id); }, []);

  const { date: todayDate, day: todayDay } = todayInfo();
  const allInstances = useMemo(() => trains.flatMap((t) => activeInstances(t, now)), [trains, now]);
  const runningNowInstances = useMemo(() => allInstances.filter((i) => i.status === "RUNNING NOW"), [allInstances]);
  const todaysScheduledInstances = useMemo(() => {
    const todayStart = atMidnight(now);
    const byKey = new Map<string, ServiceInstance>();
    for (const train of trains) {
      if (!train.runningDays?.[todayDay]) continue;
      const inst = serviceInstance(train, todayStart, now);
      if (inst) byKey.set(inst.key, inst);
    }
    // Include services that departed before today but are still running today.
    for (const inst of runningNowInstances) byKey.set(inst.key, inst);
    return Array.from(byKey.values()).sort((a, b) => {
      const rank = (status: ServiceInstance["status"]) => status === "RUNNING NOW" ? 0 : status === "DEPARTS TODAY" ? 1 : 2;
      const rr = rank(a.status) - rank(b.status);
      return rr || a.departureDate.getTime() - b.departureDate.getTime();
    });
  }, [trains, now, todayDay, runningNowInstances]);
  const todaysInstances = runningNowInstances;
  const mapInstances = useMemo(() => runningNowInstances.map((inst) => ({ key: inst.key, trainNo: inst.train.trainNo, stations: validStations(inst.train.stations), departureDate: inst.departureDate, percent: inst.percent, currentStationName: inst.currentStation })), [todaysInstances]);
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
    if (selectedKey && !runningNowInstances.some((x) => x.key === selectedKey)) setSelectedKey("");
  }, [selectedKey, runningNowInstances]);

  const selectedInstance = runningNowInstances.find((x) => x.key === selectedKey) || null;
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

  const wateringAlerts = useMemo(() => {
    const alerts: { key: string; trainNo: string; station: StationRow; minutes: number; departureDate: Date }[] = [];
    for (const inst of runningNowInstances) {
      const routeStations = validStations(inst.train.stations);
      for (let i = 0; i < routeStations.length; i++) {
        const station = routeStations[i];
        // Do not generate a watering popup for the final destination station.
        // Watering alerts are intended only for intermediate watering points.
        if (i === routeStations.length - 1) continue;
        if (!station.watering) continue;
        const eventTime = rowDateTime(station, inst.departureDate, "arrival") || rowDateTime(station, inst.departureDate, "departure");
        if (!eventTime) continue;
        const diff = Math.round((eventTime.getTime() - now.getTime()) / 60000);
        const key = `${inst.key}-${station.stationCode}-${i}`;
        if (diff >= 0 && diff <= 20 && !wateringDismissed[key]) {
          alerts.push({ key, trainNo: inst.train.trainNo, station, minutes: diff, departureDate: inst.departureDate });
        }
      }
    }
    const visibleAlerts = selectedKey
      ? alerts.filter((alert) => alert.key.startsWith(`${selectedKey}-`))
      : alerts;
    return visibleAlerts.sort((a, b) => a.minutes - b.minutes);
  }, [runningNowInstances, now, wateringDismissed, selectedKey]);

  // Deterministic code: the exact watering event always produces the same code
  // on desktop, mobile, refresh, new tab, and different browsers/devices.
  function wateringCodeForKey(key: string) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }
    return String(100 + (Math.abs(hash) % 900));
  }

  return <main className="page map-only-page">
    {error && <div className="error map-error"><strong>Data loading error:</strong> {error}</div>}

    <section className="panel map-panel taptrack-shell map-only-panel">
      <div className="taptrack-map-stage map-only-stage">
        <div className="map-floating-brand">
          <div className="map-brand-logo">🚆</div>
          <div><b>ICD / KKF</b><small>{todayDate} • {todayDay.slice(0,3)}</small></div>
          <button className="theme-toggle-map" onClick={() => setTheme((v) => v === "light" ? "dark" : "light")} title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}>{theme === "light" ? "☾" : "☀"}</button>
        </div>

        <div className="map-floating-controls">
          <div className="map-running-pill"><span className="map-live-dot" /> <b>{todaysInstances.length}</b><small>trains running</small></div>
          <button className="map-control-btn" onClick={() => void load({ silent: true, force: true })} title="Refresh">↻</button>
        </div>
        {wateringAlerts.length > 0 && <div className="watering-alert-stack" aria-live="polite">
          {wateringAlerts.map((alert) => {
            const code = wateringCodeForKey(alert.key);
            const input = wateringInputs[alert.key] || "";
            const solved = input === code;
            return <div key={alert.key} className="watering-alert">
              <span className="watering-alert-icon">💧</span>
              <div className="watering-alert-body">
                <b>WATERING POINT IN {alert.minutes} MIN</b>
                <strong>{alert.trainNo} • {alert.station.stationCode}</strong>
                <small>{alert.station.stationName} • {alert.station.watering}</small>
                <div className="watering-code-row">
                  <span>CODE <b>{code}</b></span>
                  <input value={input} maxLength={3} inputMode="numeric" placeholder="Enter" onChange={(e) => { const value = e.target.value.replace(/\D/g, "").slice(0, 3); setWateringInputs((v) => { const next = { ...v, [alert.key]: value }; try { window.localStorage.setItem("icd-kkf-watering-inputs-v1", JSON.stringify(next)); } catch {} return next; }); }} />
                  <button disabled={!solved} onClick={() => setWateringDismissed((v) => ({ ...v, [alert.key]: true }))}>✓</button>
                </div>
              </div>
              <button className="watering-alert-arrow" title="Open train route" onClick={() => { setFitAllToken(0); setSelectedKey(`${alert.trainNo}-${dateKey(alert.departureDate)}`); }}>›</button>
            </div>;
          })}
        </div>}

        {runningNowInstances.length ? <RouteMap instances={mapInstances} selectedKey={selectedInstance?.key || ""} onTrainClick={(key) => { setFitAllToken(0); setSelectedKey(key); }} hideAll={false} fitAllToken={fitAllToken} theme={theme} /> : <div className="real-map map-loading">No train is running at the current scheduled time.</div>}

        <aside className={`map-left-drawer ${showRunningList ? "open" : "collapsed"}`}>
          {!showRunningList ? (
            <button className="running-dropdown-button" onClick={() => setShowRunningList(true)} aria-expanded="false">
              <span className="running-dropdown-icon">🚆</span>
              <span><b>RUNNING</b><small>{todaysInstances.length} trains</small></span>
              <span className="running-chevron">▾</span>
            </button>
          ) : (
            <>
              <div className="map-brand">
                <div className="brand-mark">🚆</div>
                <div><b>RUNNING TRAINS</b><span>{todaysInstances.length} active</span></div>
                <button className="running-close" onClick={() => setShowRunningList(false)} title="Close train list">×</button>
              </div>
              <div className="map-search-wrap">
                <input className="map-search" placeholder="Search train / station…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="map-train-list">
                {todaysInstances
                  .filter((inst) => !search.trim() || inst.train.trainNo.toLowerCase().includes(search.toLowerCase()) || inst.currentStation.toLowerCase().includes(search.toLowerCase()) || inst.nextStation.toLowerCase().includes(search.toLowerCase()))
                  .map((inst) => {
                    const colorIndex = todaysInstances.findIndex((x) => x.key === inst.key);
                    const routeStations = validStations(inst.train.stations);
                    const first = routeStations[0];
                    const last = routeStations[routeStations.length - 1];
                    return <button key={inst.key} className={`map-train-card ${selectedInstance?.key === inst.key ? "active" : ""}`} onClick={() => { setFitAllToken(0); setSelectedKey(inst.key); }}>
                      <div className="map-train-head">
                        <span className="map-train-dot" style={{ background: ["#1769aa", "#8b1fc8", "#0f8a67", "#e07a00", "#3155d8", "#c43d76", "#1487a8", "#7356c8"][colorIndex % 8] }} />
                        <b>{inst.train.trainNo}</b>
                        <small>Dep {inst.departureDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</small>
                      </div>
                      <div className="map-train-route">{first?.stationCode || "—"} <span>→</span> {last?.stationCode || "—"}</div>
                      <div className="map-train-progress"><span><i style={{ width: `${inst.percent}%` }} /></span><b>{inst.percent}%</b></div>
                      <div className="map-train-meta">{inst.currentStation} <span>→ {inst.nextStation}</span></div>
                    </button>;
                  })}
                {!todaysInstances.length && <div className="empty">No trains running.</div>}
              </div>
              <div className="map-list-footer"><span>● {todaysInstances.length} trains running</span><span>Close ×</span></div>
            </>
          )}
        </aside>

        <aside className={`map-today-drawer ${showTodayList ? "open" : "collapsed"}`}>
          {!showTodayList ? (
            <button className="today-dropdown-button" onClick={() => setShowTodayList(true)} aria-expanded="false">
              <span className="today-dropdown-icon">📅</span>
              <span><b>TODAY'S TRAIN</b><small>{todaysScheduledInstances.length} trains</small></span>
              <span className="running-chevron">▾</span>
            </button>
          ) : (
            <>
              <div className="map-brand today-brand">
                <div className="brand-mark">📅</div>
                <div><b>TODAY'S TRAIN</b><span>{todaysScheduledInstances.length} scheduled today</span></div>
                <button className="running-close" onClick={() => setShowTodayList(false)} title="Close today's train list">×</button>
              </div>
              <div className="map-train-list today-status-list">
                {todaysScheduledInstances.map((inst) => {
                  const routeStations = validStations(inst.train.stations);
                  const first = routeStations[0];
                  const last = routeStations[routeStations.length - 1];
                  const statusText = inst.status === "RUNNING NOW" ? "RUNNING" : inst.status === "COMPLETED" ? "JOURNEY COMPLETED" : "DEPT. TODAY";
                  const statusClass = inst.status === "RUNNING NOW" ? "running" : inst.status === "COMPLETED" ? "completed" : "depart";
                  return <button key={inst.key} className="today-status-card" onClick={() => {
                    if (inst.status === "RUNNING NOW") setSelectedKey(inst.key);
                  }}>
                    <div className="today-status-head"><b>{inst.train.trainNo}</b><span className={`today-status ${statusClass}`}>{statusText}</span></div>
                    <div className="today-status-route">{first?.stationCode || "—"} <span>→</span> {last?.stationCode || "—"}</div>
                    <div className="today-status-meta">{inst.currentStation} {inst.nextStation ? <span>→ {inst.nextStation}</span> : null}</div>
                  </button>;
                })}
                {!todaysScheduledInstances.length && <div className="empty">No trains scheduled today.</div>}
              </div>
              <div className="map-list-footer"><span>● {todaysScheduledInstances.length} trains today</span><button className="today-footer-close" onClick={() => setShowTodayList(false)}>Close ×</button></div>
            </>
          )}
        </aside>

        {selectedInstance && <aside className="map-right-drawer">
          <div className="drawer-head"><div><div className="drawer-title"><span className="drawer-dot" /> {selectedInstance.train.trainNo}</div><div className="drawer-route">{source?.stationName || "—"} → {destination?.stationName || "—"}</div><small>Dep {departureDate?.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</small></div><button className="drawer-close" onClick={() => { setFitAllToken(0); setSelectedKey(""); }}>×</button></div>
          <div className="drawer-progress"><div><span>{selectedInstance.currentStation} → {selectedInstance.nextStation}</span><b>{selectedInstance.percent}%</b></div><div className="drawer-track"><i style={{ width: `${selectedInstance.percent}%` }} /></div><small>Scheduled position • Day {routeDay}</small></div>
          <div className="drawer-tabs"><b>Route</b><span>Contacts</span><span>Staff</span><span>RM</span></div>
          <div className="drawer-note">Watering points: <b>{watering.length}</b> • S/W {swCount} • O/D {odCount}</div>
          <div className="drawer-stops">{valid.map((s, i) => { const st = rowDateTime(s, departureDate || now, "arrival") || rowDateTime(s, departureDate || now, "departure"); const passed = st ? now >= st : false; const isCurrent = selectedInstance.currentStation === s.stationName; return <div className={`drawer-stop ${passed ? "passed" : ""} ${isCurrent ? "current" : ""}`} key={`${s.stationCode}-${i}`}><span className="drawer-stop-dot" /> <div><b>{s.stationName} <em>{s.stationCode}</em></b><small>{s.arrival || s.departure || "—"} • Day {s.day} {s.watering ? <strong className={wateringClass(s.watering)}>{s.watering}</strong> : null}</small></div></div>; })}</div>
        </aside>}
      </div>
    </section>
  </main>;
}
