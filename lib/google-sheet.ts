import Papa from "papaparse";
import { StationRow, Train, Weekday } from "./types";

const SCHEDULE_SPREADSHEET_ID = "1HBFYHFkf7P5yZ2dC76FkZF5Pfe-QVtilDDFW6nTdE";
const SCHEDULE_GID = "1463153132";
const DEFAULT_SCHEDULE_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SCHEDULE_SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${SCHEDULE_GID}`;

const SPREADSHEET_ID = "1HBFYHFkf7Pq5YdZ2zC76FkZF5Pfe-QVtilDDFW6nTdE";
const COORDINATE_SHEET_GID = "1506639435";
const DEFAULT_COORDINATES_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${COORDINATE_SHEET_GID}`;

// Server-side cache: reuse the parsed sheets briefly to avoid duplicate requests
// while still picking up schedule changes quickly.
const CACHE_TTL_MS = 15_000;
let trainCache: { data: Train[]; savedAt: number } | null = null;
let trainFetchInFlight: Promise<Train[]> | null = null;

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
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

function isYes(value: unknown): boolean {
  return ["Y", "YES", "TRUE", "1"].includes(clean(value).toUpperCase());
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

async function fetchAndBuildTrainData(): Promise<Train[]> {
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

  // IMPORTANT: weekday flags live in the original Google Sheet rows and are
  // often present only on the first/source row of a train. Do NOT map them
  // away before grouping, otherwise every train can incorrectly become
  // "not running". Build the train groups directly from the raw rows and
  // OR the weekday flags across every row belonging to the train.
  const groups = new Map<string, Train>();

  for (const rawRow of scheduleRows) {
    if (isExcludedRow(rawRow)) continue;

    const trainNo = pick(rawRow, ["Train No", "Train No."]);
    const stationCode = pick(rawRow, ["Station Code"]);
    const stationName = pick(rawRow, ["Station Name"]);
    if (!trainNo || (!stationCode && !stationName)) continue;

    let train = groups.get(trainNo);
    if (!train) {
      const runningDays = Object.fromEntries(
        WEEKDAYS.map((day) => [day, false])
      ) as Record<Weekday, boolean>;
      train = { trainNo, no: "", stations: [], runningDays };
      groups.set(trainNo, train);
    }

    // A weekday can be marked on only one source row, so retain it at train
    // level instead of relying on repeated values in every station row.
    for (const day of WEEKDAYS) {
      if (isYes(pick(rawRow, [day]))) train.runningDays[day] = true;
    }

    const coordinate = coordinates.get(stationCode.toUpperCase());
    train.stations.push({
      trainNo,
      stationCode,
      stationName,
      arrival: pick(rawRow, ["Arrival Time"]),
      departure: pick(rawRow, ["Departure Time"]),
      distance: pick(rawRow, ["Distance"]),
      day: pick(rawRow, ["Day"]),
      section: pick(rawRow, ["Section"]),
      watering: pick(rawRow, ["Watering Station (S/W, O/D)", "Watering Station"]),
      latitude: coordinate?.latitude,
      longitude: coordinate?.longitude
    });
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.trainNo.localeCompare(b.trainNo, undefined, { numeric: true })
  );
}

export async function getTrainData(options: { force?: boolean } = {}): Promise<Train[]> {
  const now = Date.now();
  const force = options.force === true;

  if (!force && trainCache && now - trainCache.savedAt < CACHE_TTL_MS) {
    return trainCache.data;
  }

  // Collapse simultaneous refreshes into one Google Sheet fetch.
  if (trainFetchInFlight) return trainFetchInFlight;

  trainFetchInFlight = fetchAndBuildTrainData()
    .then((data) => {
      trainCache = { data, savedAt: Date.now() };
      return data;
    })
    .finally(() => {
      trainFetchInFlight = null;
    });

  return trainFetchInFlight;
}
