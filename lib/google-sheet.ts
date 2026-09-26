import Papa from "papaparse";
import { StationRow, Train, Weekday } from "./types";

const SCHEDULE_SPREADSHEET_ID = "1HBFYHFkf7P5yZ2dC76FkZF5Pfe-QVtilDDFW6nTdE";
const SCHEDULE_GID = "1463153132";
const DEFAULT_SCHEDULE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXHb-McVF62fJFt1CDecykHzBwhmXnG9NrUTOyn1-iZIg2NFBZ6YySnxgwihcdvFLvMPXDk3WZ0g7z/pub?gid=1463153132&single=true&output=csv";
const PUBLISHED_SCHEDULE_CSV_URL_ALT =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXHb-McVF62fJFt1CDecykHzBwhmXnG9NrUTOyn1-iZIg2NFBZ6YySnxgwihcdvFLvMPXDk3WZ0g7z/pub?gid=1463153132&output=csv";
const DIRECT_SCHEDULE_EXPORT_URL =
  `https://docs.google.com/spreadsheets/d/${SCHEDULE_SPREADSHEET_ID}/export?format=csv&gid=${SCHEDULE_GID}`;
const GVIZ_SCHEDULE_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SCHEDULE_SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${SCHEDULE_GID}`;

// Server-side cache: reuse the parsed sheets briefly to avoid duplicate requests
// while still picking up schedule changes quickly.
const CACHE_TTL_MS = 15_000;
const STALE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
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
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 ICD-KKF-Train-Dashboard/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csv = await response.text();
    const trimmed = csv.trim();
    if (!trimmed) throw new Error("Empty response");
    if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
      throw new Error("Received HTML instead of CSV");
    }
    const parsed = Papa.parse<Record<string, unknown>>(csv, { header: true, skipEmptyLines: true });
    if (parsed.errors.length) {
      throw new Error(parsed.errors[0]?.message || "Invalid CSV");
    }
    if (!parsed.data.length) throw new Error("CSV contains no data rows");
    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCsvWithFallback(urls: string[]): Promise<Record<string, unknown>[]> {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  const errors: string[] = [];

  const attempts = uniqueUrls.map(async (url) => {
    try {
      return await fetchCsv(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${url} -> ${message}`);
      throw error;
    }
  });

  try {
    return await Promise.any(attempts);
  } catch {
    throw new Error(`Google Sheet fetch failed. Tried ${uniqueUrls.length} source(s). ${errors.join(" | ")}`);
  }
}
function isExcludedRow(row: Record<string, unknown>) {
  const text = Object.values(row).map(clean).join(" ").toLowerCase();
  return text.includes("deleted") || text.includes("via station");
}

async function fetchAndBuildTrainData(): Promise<Train[]> {
  const configuredScheduleUrl = (process.env.GOOGLE_SHEET_CSV_URL || "").trim();

  // The published CSV is the primary source. If Vercel has an old/broken
  // GOOGLE_SHEET_CSV_URL environment variable, automatically fall back instead
  // of failing the entire dashboard with HTTP 404.
  const scheduleRowsPromise = fetchCsvWithFallback([
    configuredScheduleUrl,
    DEFAULT_SCHEDULE_CSV_URL,
    PUBLISHED_SCHEDULE_CSV_URL_ALT,
    DIRECT_SCHEDULE_EXPORT_URL,
    GVIZ_SCHEDULE_CSV_URL,
  ]);
  // Coordinates are now read directly from Column X (Longitude) and
  // Column Y (Latitude) of the same Section Wise Details / schedule sheet.
  // No separate coordinate sheet or local JSON file is required.
  const scheduleRows = await scheduleRowsPromise;

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

    // Column X = Longitude, Column Y = Latitude in the same sheet.
    // Header names are preferred, with X/Y fallbacks for sheets whose
    // coordinate columns do not have standard headers.
    const rowKeys = Object.keys(rawRow);
    const longitude = numberValue(
      pick(rawRow, ["Longitude", "LONGITUDE", "Long", "X", "Longitude (X)"]) ||
        clean(rawRow[rowKeys[23]])
    );
    const latitude = numberValue(
      pick(rawRow, ["Latitude", "LATITUDE", "Lat", "Y", "Latitude (Y)"]) ||
        clean(rawRow[rowKeys[24]])
    );
    const coordinate =
      latitude !== undefined && longitude !== undefined
        ? { latitude, longitude }
        : undefined;
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
      if (!data.length) throw new Error("Google Sheet returned no train data");
      trainCache = { data, savedAt: Date.now() };
      return data;
    })
    .catch((error) => {
      if (trainCache && Date.now() - trainCache.savedAt < STALE_CACHE_TTL_MS) {
        return trainCache.data;
      }
      throw error;
    })
    .finally(() => {
      trainFetchInFlight = null;
    });

  return trainFetchInFlight;
}
