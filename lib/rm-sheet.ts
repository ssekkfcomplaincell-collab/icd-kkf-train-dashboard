import Papa from "papaparse";

export type RMComplaint = {
  refNo: string;
  depDate: string;
  compHead: string;
  compDateTime: string;
  trainNo: string;
  disposalTime: string;
  coachNo: string;
  physicalCoachNo: string;
  complaintDescription: string;
  actionTaken: string;
};

const RM_PUBLISHED_BASE_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxQjrt-CPq_P05ax0TySmKynwENx-T_hOVGgrMGm-TnpT1Bff1a66ezMLF21r1_b59Xn6xMhtPlFUQ/pub";

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { savedAt: number; data: RMComplaint[] }>();

function clean(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function trainNumbers(value: string) {
  return Array.from(new Set(clean(value).toUpperCase().match(/\d{4,6}/g) || []));
}

function normalizeTrainNo(value: string) {
  return trainNumbers(value)[0] || clean(value).replace(/\D/g, "");
}

function trainCellMatches(cell: string, target: string) {
  const wanted = trainNumbers(target);
  const actual = trainNumbers(cell);
  if (!wanted.length || !actual.length) return false;
  return actual.some((number) => wanted.includes(number));
}

function normalizeDate(value: string) {
  const s = clean(value).replace(/[/-]/g, ".");
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return "";
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yy = m[3].length === 4 ? m[3].slice(-2) : m[3].padStart(2, "0");
  return `${dd}.${mm}.${yy}`;
}

function dateFromIso(iso: string) {
  const m = clean(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(-2)}` : "";
}

function isoFromDateKey(value: string) {
  const m = normalizeDate(value).match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : "";
}

function weekdayForDate(date: string) {
  const iso = isoFromDateKey(date);
  if (!iso) return "";
  const names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return names[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

function dateTabNames(date: string) {
  const normalized = normalizeDate(date);
  const weekday = weekdayForDate(normalized);
  // Published Google Sheets can expose date tabs either with or without the
  // weekday suffix. Check both forms so a newly added today's sheet is not
  // missed because its tab naming differs.
  return Array.from(new Set([
    weekday ? `${normalized} (${weekday})` : normalized,
    normalized,
  ].filter(Boolean)));
}

function indiaTodayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dateKeysInclusive(startIso: string, endIso = indiaTodayIso()) {
  const start = new Date(`${startIso}T00:00:00Z`);
  const last = new Date(`${endIso}T00:00:00Z`);
  start.setUTCHours(0, 0, 0, 0);
  last.setUTCHours(0, 0, 0, 0);
  const out: string[] = [];
  for (const d = new Date(start); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(`${d.getUTCDate().toString().padStart(2, "0")}.${(d.getUTCMonth() + 1).toString().padStart(2, "0")}.${d.getUTCFullYear().toString().slice(-2)}`);
  }
  return out;
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 ICD-KKF-Train-Dashboard/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function value(row: string[], index: number) {
  return clean(row[index]);
}

async function fetchDateTab(sheetName: string, targetTrain: string, targetDepDate: string): Promise<RMComplaint[]> {
  const url = `${RM_PUBLISHED_BASE_URL}?output=csv&sheet=${encodeURIComponent(sheetName)}&_ts=${Date.now()}`;
  const csv = await fetchText(url);
  if (!csv.trim()) return [];

  const parsed = Papa.parse<string[]>(csv, { header: false, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors[0]?.message || "Invalid RailMadad CSV");

  const results: RMComplaint[] = [];
  let currentDepDate = "";
  let currentTrain = "";

  for (const row of parsed.data) {
    if (!row?.length) continue;

    const explicitDepDate = normalizeDate(row[3]); // Column D
    const explicitTrain = clean(row[7]); // Column H
    if (explicitDepDate) currentDepDate = explicitDepDate;
    if (explicitTrain) currentTrain = explicitTrain;

    if (normalizeDate(currentDepDate) !== normalizeDate(targetDepDate)) continue;

    // IMPORTANT: Do not inherit a train number from a previous row.
    // A RailMadad row is associated with a train only when Column H
    // explicitly contains that train number. Blank H cells must not be
    // counted/displayed for any train.
    if (!explicitTrain || !trainCellMatches(explicitTrain, targetTrain)) continue;

    // B,D,F,G,H,J,K,L,M,N => indexes 1,3,5,6,7,9,10,11,12,13
    const item: RMComplaint = {
      refNo: value(row, 1),
      depDate: value(row, 3),
      compHead: value(row, 5),
      compDateTime: value(row, 6),
      trainNo: value(row, 7),
      disposalTime: value(row, 9),
      coachNo: value(row, 10),
      physicalCoachNo: value(row, 11),
      complaintDescription: value(row, 12),
      actionTaken: value(row, 13),
    };

    if (Object.values(item).some(Boolean)) results.push(item);
  }

  return results;
}

export async function getRMComplaints(trainNo: string, departureDateIso: string): Promise<RMComplaint[]> {
  const targetDepDate = dateFromIso(departureDateIso);
  const key = `${normalizeTrainNo(trainNo)}-${targetDepDate}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.data;
  if (!targetDepDate) return [];

  const startIso = isoFromDateKey(targetDepDate);
  const sheetDates = dateKeysInclusive(startIso);
  const targetTrain = normalizeTrainNo(trainNo);

  // Check every date sheet from the train's original departure date through
  // today. For each date, check both possible published tab names. This is
  // important for same-day complaints added to today's sheet.
  const sheetJobs = sheetDates.flatMap((date) =>
    dateTabNames(date).map((sheetName) => fetchDateTab(sheetName, targetTrain, targetDepDate))
  );
  const settled = await Promise.allSettled(sheetJobs);

  const merged = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const seen = new Set<string>();
  const data = merged.filter((item) => {
    const key = [item.refNo, item.compDateTime, item.trainNo, item.coachNo, item.complaintDescription].join("|").toLowerCase();
    if (!key.replace(/\|/g, "")) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  data.sort((a, b) => (a.compDateTime || "").localeCompare(b.compDateTime || ""));
  cache.set(key, { savedAt: Date.now(), data });
  return data;
}
