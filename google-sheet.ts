import Papa from "papaparse";
import { StationRow, Train } from "./types";

const DEFAULT_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXHb-McVF62fJFt1CDecykHzBwhmXnG9NrUTOyn1-iZIg2NFBZ6YySnxgwihcdvFLvMPXDk3WZ0g7z/pub?gid=1463153132&single=true&output=csv";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function pick(row: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const key = Object.keys(row).find(
      (k) => k.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (key) return clean(row[key]);
  }
  return "";
}

export async function getTrainData(): Promise<Train[]> {
  const url = process.env.GOOGLE_SHEET_CSV_URL || DEFAULT_CSV_URL;

  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "ICD-KKF-Train-Dashboard/1.0" }
  });

  if (!response.ok) {
    throw new Error(`Google Sheet fetch failed: ${response.status}`);
  }

  const csv = await response.text();
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: true
  });

  const rows: StationRow[] = parsed.data
    .map((row) => ({
      no: pick(row, ["NO"]),
      trainNo: pick(row, ["Train No", "Train No."]),
      sno: pick(row, ["S. No.", "S. No"]),
      stationCode: pick(row, ["Station Code"]),
      stationName: pick(row, ["Station Name"]),
      routeNo: pick(row, ["Route No.", "Route No"]),
      arrival: pick(row, ["Arrival Time"]),
      departure: pick(row, ["Departure Time"]),
      halt: pick(row, ["Halt Time (In Minutes)", "Halt Time"]),
      distance: pick(row, ["Distance"]),
      day: pick(row, ["Day"]),
      section: pick(row, ["Section"]),
      sectionKm: pick(row, ["Section KM"]),
      watering: pick(row, ["Watering Station (S/W, O/D)", "Watering Station"]),
      raw: Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k.trim(), clean(v)])
      )
    }))
    .filter((r) => r.trainNo && (r.stationCode || r.stationName));

  const groups = new Map<string, Train>();

  for (const row of rows) {
    if (!groups.has(row.trainNo)) {
      groups.set(row.trainNo, {
        trainNo: row.trainNo,
        no: row.no,
        stations: []
      });
    }
    groups.get(row.trainNo)!.stations.push(row);
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.trainNo.localeCompare(b.trainNo, undefined, { numeric: true })
  );
}