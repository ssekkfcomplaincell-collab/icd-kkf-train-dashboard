/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useMemo, useState } from "react";
import { StationRow, Train } from "@/lib/types";

function wateringClass(value: string) {
  const v = value.toUpperCase();
  if (v.includes("S/W")) return "water sw";
  if (v.includes("O/D")) return "water od";
  return "";
}

function firstTime(stations: StationRow[], field: "arrival" | "departure") {
  return stations.find((s) => /^\d{1,2}:\d{2}$/.test(s[field]))?.[field] || "—";
}

function lastStation(stations: StationRow[]) {
  return stations[stations.length - 1];
}

export default function TrainDashboard() {
  const [trains, setTrains] = useState<Train[]>([]);
  const [selectedTrainNo, setSelectedTrainNo] = useState("");
  const [search, setSearch] = useState("");
  const [stationSearch, setStationSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/trains", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Unable to load data");
      setTrains(data.trains);
      setUpdatedAt(data.updatedAt);
      setSelectedTrainNo((old: string) => old || data.trains[0]?.trainNo || "");
    } catch (e: any) {
      setError(e.message || "Unable to load Google Sheet");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredTrains = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return trains;
    return trains.filter((t) => {
      const first = t.stations[0];
      const last = t.stations[t.stations.length - 1];
      return (
        t.trainNo.toLowerCase().includes(q) ||
        first?.stationName.toLowerCase().includes(q) ||
        last?.stationName.toLowerCase().includes(q)
      );
    });
  }, [trains, search]);

  const selected = trains.find((t) => t.trainNo === selectedTrainNo) || trains[0];
  const stations = selected?.stations || [];

  const filteredStations = useMemo(() => {
    const q = stationSearch.trim().toLowerCase();
    if (!q) return stations;
    return stations.filter(
      (s) =>
        s.stationCode.toLowerCase().includes(q) ||
        s.stationName.toLowerCase().includes(q) ||
        s.section.toLowerCase().includes(q) ||
        s.watering.toLowerCase().includes(q)
    );
  }, [stations, stationSearch]);

  const watering = stations.filter((s) => s.watering);
  const source = stations[0];
  const destination = lastStation(stations);
  const totalDistance = destination?.distance || "—";

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <div className="eyebrow">ICD / KKF • OPERATIONS</div>
          <h1>Train Operations Dashboard</h1>
          <p className="sub">
            Live schedule view from the published Google Sheet
          </p>
        </div>
        <div className="top-actions">
          <span className="live-dot" />
          <span>{loading ? "Loading…" : "Sheet Connected"}</span>
          <button className="refresh" onClick={load}>↻ Refresh</button>
        </div>
      </header>

      {error && (
        <div className="error">
          <strong>Data loading error:</strong> {error}
          <div>Check that the Google Sheet is published to the web.</div>
        </div>
      )}

      <section className="stats">
        <div className="stat"><span>TRAINS</span><strong>{trains.length}</strong></div>
        <div className="stat"><span>SELECTED</span><strong>{selected?.trainNo || "—"}</strong></div>
        <div className="stat"><span>STATIONS</span><strong>{stations.length}</strong></div>
        <div className="stat"><span>WATERING</span><strong>{watering.length}</strong></div>
        <div className="stat"><span>DISTANCE</span><strong>{totalDistance} km</strong></div>
      </section>

      <section className="dashboard-grid">
        <aside className="panel train-panel">
          <div className="panel-head">
            <div>
              <div className="panel-kicker">TRAIN DIRECTORY</div>
              <h2>Trains</h2>
            </div>
            <span className="count">{filteredTrains.length}</span>
          </div>

          <input
            className="search"
            placeholder="Search train / station…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="train-list">
            {filteredTrains.map((train) => {
              const active = train.trainNo === selected?.trainNo;
              const first = train.stations[0];
              const last = train.stations[train.stations.length - 1];
              return (
                <button
                  key={train.trainNo}
                  className={`train-item ${active ? "active" : ""}`}
                  onClick={() => setSelectedTrainNo(train.trainNo)}
                >
                  <div className="train-no">{train.trainNo}</div>
                  <div className="train-route">
                    {first?.stationCode || "—"} <span>→</span> {last?.stationCode || "—"}
                  </div>
                  <div className="train-name">
                    {first?.stationName || "—"} → {last?.stationName || "—"}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="panel route-panel">
          <div className="panel-head">
            <div>
              <div className="panel-kicker">ROUTE OVERVIEW</div>
              <h2>{selected?.trainNo || "—"} Route</h2>
            </div>
            <div className="schedule-note">Scheduled data</div>
          </div>

          <div className="route-summary">
            <div>
              <span>ORIGIN</span>
              <strong>{source?.stationName || "—"}</strong>
              <small>{source?.stationCode || "—"} • {firstTime(stations, "departure")}</small>
            </div>
            <div className="route-arrow">→</div>
            <div>
              <span>DESTINATION</span>
              <strong>{destination?.stationName || "—"}</strong>
              <small>{destination?.stationCode || "—"} • {lastStation(stations)?.arrival || "—"}</small>
            </div>
          </div>

          <div className="route-visual">
            <div className="route-line" />
            {stations.map((s, i) => (
              <div className="route-stop" key={`${s.stationCode}-${i}`}>
                <div className={`stop-dot ${s.watering ? "watering-dot" : ""}`} />
                <div className="stop-label">
                  <b>{s.stationCode}</b>
                  <span>{s.stationName}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="legend">
            <span><i className="legend-dot" /> Station</span>
            <span><i className="legend-dot water-legend" /> Watering point</span>
            <span><i className="legend-pill">S/W</i> Scheduled watering</span>
            <span><i className="legend-pill od">O/D</i> On/Off watering</span>
          </div>
        </section>

        <aside className="panel detail-panel">
          <div className="panel-kicker">SELECTED TRAIN</div>
          <div className="big-train">{selected?.trainNo || "—"}</div>
          <div className="detail-route">
            {source?.stationCode || "—"} → {destination?.stationCode || "—"}
          </div>

          <div className="detail-cards">
            <div><span>START</span><b>{firstTime(stations, "departure")}</b></div>
            <div><span>END</span><b>{destination?.arrival || "—"}</b></div>
            <div><span>DAY(S)</span><b>{Array.from(new Set(stations.map(s => s.day).filter(Boolean))).join(", ") || "—"}</b></div>
            <div><span>WATERING</span><b>{watering.length}</b></div>
          </div>

          <div className="watering-box">
            <div className="panel-kicker">WATERING POINTS</div>
            {watering.length === 0 ? (
              <div className="muted">No watering points in source data.</div>
            ) : (
              watering.map((s, i) => (
                <div className="watering-row" key={`${s.stationCode}-${i}`}>
                  <div>
                    <b>{s.stationCode}</b>
                    <span>{s.stationName}</span>
                  </div>
                  <em className={wateringClass(s.watering)}>{s.watering}</em>
                </div>
              ))
            )}
          </div>

          <div className="source-note">
            <b>Data source</b>
            <span>Published Google Sheet</span>
            <small>{updatedAt ? `Last fetched ${new Date(updatedAt).toLocaleString()}` : "—"}</small>
          </div>
        </aside>
      </section>

      <section className="panel table-panel">
        <div className="panel-head table-head">
          <div>
            <div className="panel-kicker">STATION SCHEDULE</div>
            <h2>{selected?.trainNo || "—"} • Complete Route</h2>
          </div>
          <input
            className="table-search"
            placeholder="Filter station / section / watering…"
            value={stationSearch}
            onChange={(e) => setStationSearch(e.target.value)}
          />
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>S.No.</th>
                <th>Station</th>
                <th>Arrival</th>
                <th>Departure</th>
                <th>Halt</th>
                <th>Distance</th>
                <th>Day</th>
                <th>Section</th>
                <th>Section KM</th>
                <th>Watering</th>
              </tr>
            </thead>
            <tbody>
              {filteredStations.map((s, i) => (
                <tr key={`${s.stationCode}-${i}`}>
                  <td>{s.sno || i + 1}</td>
                  <td>
                    <strong>{s.stationCode}</strong>
                    <span className="station-name">{s.stationName}</span>
                  </td>
                  <td>{s.arrival || "—"}</td>
                  <td>{s.departure || "—"}</td>
                  <td>{s.halt || "—"}</td>
                  <td>{s.distance || "—"}</td>
                  <td>{s.day || "—"}</td>
                  <td>{s.section || "—"}</td>
                  <td>{s.sectionKm || "—"}</td>
                  <td>
                    {s.watering ? (
                      <span className={`water ${wateringClass(s.watering)}`}>
                        {s.watering}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        <span>ICD / KKF Train Operations</span>
        <span>Schedule source: Google Sheets • No static train data</span>
      </footer>
    </main>
  );
}