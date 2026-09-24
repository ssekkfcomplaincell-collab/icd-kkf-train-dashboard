import Papa from "papaparse";
import { StationRow, Train, Weekday } from "./types";

const DEFAULT_SCHEDULE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXHb-McVF62fJFt1CDecykHzBwhmXnG9NrUTOyn1-iZIg2NFBZ6YySnxgwihcdvFLvMPXDk3WZ0g7z/pub?gid=1463153132&single=true&output=csv";

const SPREADSHEET_ID = "1HBFYHFkf7Pq5YdZ2zC76FkZF5Pfe-QVtilDDFW6nTdE";
const COORDINATE_SHEET_GID = "1506639435";
const DEFAULT_COORDINATES_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${COORDINATE_SHEET_GID}`;

const WEEKDAYS: Weekday[] = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
];

function clean(value: unknown): string { return String(value ?? "").trim(); }

function pick(row: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const key = Object.keys(row).find((k) => k.trim().toLowerCase() === name.trim().toLowerCase());
    if (key) return clean(row[key]);
  }
  return "";
}

function numberValue(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

async function fetchCsv(url: string): Promise<Record<string, unknown>[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  try {
    response = await fetch(url, {
    next: { revalidate: 60 },
    headers: { "User-Agent": "ICD-KKF-Train-Dashboard/1.0" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Google Sheet fetch failed: ${response.status}`);
  const csv = await response.text();
  const parsed = Papa.parse<Record<string, unknown>>(csv, { header: true, skipEmptyLines: true });
  return parsed.data;
}

function isExcludedRow(row: Record<string, unknown>) {
  const text = Object.values(row).map(clean).join(" ").toLowerCase();
  return text.includes("deleted") || text.includes("via station");
}

export async function getTrainData(): Promise<Train[]> {
  const scheduleUrl = process.env.GOOGLE_SHEET_CSV_URL || DEFAULT_SCHEDULE_CSV_URL;
  const coordinateUrl = process.env.GOOGLE_COORDINATES_CSV_URL || DEFAULT_COORDINATES_CSV_URL;

  const [scheduleRows, coordinateRows] = await Promise.all([
    fetchCsv(scheduleUrl),
    fetchCsv(coordinateUrl).catch(() => [] as Record<string, unknown>[])
  ]);

  const coordinates = new Map<string, { latitude: number; longitude: number }>();
  for (const row of coordinateRows) {
    const code = pick(row, ["Station Code", "Station code", "Code"]).toUpperCase();
    const longitude = numberValue(pick(row, ["Longitude", "LONGITUDE", "Long"]));
    const latitude = numberValue(pick(row, ["Latitude", "LATITUDE", "Lat"]));
    if (code && latitude !== undefined && longitude !== undefined) {
      coordinates.set(code, { latitude, longitude });
    }
  }

  const rows: StationRow[] = scheduleRows
    .filter((row) => !isExcludedRow(row))
    .map((row) => {
      const stationCode = pick(row, ["Station Code"]);
      const coordinate = coordinates.get(stationCode.toUpperCase());
      return {
        trainNo: pick(row, ["Train No", "Train No."]),
        stationCode,
        stationName: pick(row, ["Station Name"]),
        arrival: pick(row, ["Arrival Time"]),
        departure: pick(row, ["Departure Time"]),
        distance: pick(row, ["Distance"]),
        day: pick(row, ["Day"]),
        section: pick(row, ["Section"]),
        watering: pick(row, ["Watering Station (S/W, O/D)", "Watering Station"]),
        latitude: coordinate?.latitude,
        longitude: coordinate?.longitude
      };
    })
    .filter((r) => r.trainNo && (r.stationCode || r.stationName));

  const groups = new Map<string, Train>();
  for (const row of rows) {
    if (!groups.has(row.trainNo)) {
      const runningDays = Object.fromEntries(
        WEEKDAYS.map((day) => [day, pick(row, [day]).toUpperCase() === "Y"])
      ) as Record<Weekday, boolean>;
      groups.set(row.trainNo, { trainNo: row.trainNo, no: "", stations: [], runningDays });
    }
    groups.get(row.trainNo)!.stations.push(row);
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.trainNo.localeCompare(b.trainNo, undefined, { numeric: true })
  );
}
