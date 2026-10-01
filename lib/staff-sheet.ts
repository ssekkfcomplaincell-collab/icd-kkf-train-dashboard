import Papa from "papaparse";

export type StaffMember = {
  id: string;
  coach: string;
  name: string;
  mobile: string;
  firm: string;
};

export type TrainStaff = {
  trainNo: string;
  departureDate: string;
  obhs: StaffMember[];
  acca: StaffMember[];
};

// Use the actual Google Spreadsheet file ID with the Visualization (gviz)
// endpoint. The /pub URL contains a published-token, not the real spreadsheet
// file ID, and the published CSV endpoint is unreliable for selecting one of
// many date tabs. gviz supports selecting a tab by its exact sheet name.
const STAFF_SPREADSHEET_ID =
  "1Ol32Qlh9n_fGe3SFop5iDPE4-MASmgIRt4WqaDUx3hY";
const STAFF_GVIZ_BASE_URL =
  `https://docs.google.com/spreadsheets/d/${STAFF_SPREADSHEET_ID}/gviz/tq`;

const STAFF_CACHE_TTL_MS = 60_000;
const staffCache = new Map<string, { savedAt: number; data: TrainStaff | null }>();

function clean(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function normalizeTrainNo(value: string) {
  const m = clean(value).match(/\d{4,6}/);
  return m ? m[0] : clean(value).replace(/\D/g, "");
}

function normalizeDate(value: string) {
  const s = clean(value).replace(/\//g, ".");
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return "";
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yy = m[3].length === 4 ? m[3].slice(-2) : m[3];
  return `${dd}.${mm}.${yy}`;
}

function dateFromIso(iso: string) {
  const m = clean(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[3]}.${m[2]}.${m[1].slice(-2)}`;
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
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

function nonEmpty(value: unknown) {
  const v = clean(value);
  return v && v !== "-" && v !== "—" ? v : "";
}

function uniqueMembers(items: StaffMember[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.id, item.name, item.mobile, item.coach].join("|").toLowerCase();
    if (!key.replace(/\|/g, "")) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shiftDate(date: string, days: number) {
  const m = normalizeDate(date).match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return "";
  const d = new Date(Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  d.setUTCDate(d.getUTCDate() + days);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCFullYear() % 100).padStart(2, "0")}`;
}

function todayIndiaDate() {
  const now = new Date();
  const india = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return `${String(india.getDate()).padStart(2, "0")}.${String(india.getMonth() + 1).padStart(2, "0")}.${String(india.getFullYear() % 100).padStart(2, "0")}`;
}

function trainNumbers(value: string) {
  const text = clean(value).toUpperCase();
  const matches = text.match(/\d{4,6}/g) || [];
  const result = new Set<string>(matches);
  const pair = text.match(/(\d{4,6})\/(\d{1,4})/);
  if (pair) {
    result.add(pair[1]);
    const suffix = pair[2];
    result.add(suffix.length < pair[1].length
      ? pair[1].slice(0, pair[1].length - suffix.length) + suffix
      : suffix);
  }
  return [...result];
}

function trainMatches(sheetTrain: string, requestedTrain: string) {
  const requested = normalizeTrainNo(requestedTrain);
  if (!requested) return false;

  // Match only the exact train number(s) written in the sheet block.
  // Example: 12934/33 must match 12934 or 12933, but it must NOT match
  // the separate 12932/31 block. This prevents staff from two different
  // train blocks being merged into each other.
  return trainNumbers(sheetTrain).includes(requested);
}

function dateTabName(date: string) {
  const normalized = normalizeDate(date);
  const m = normalized.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return normalized;
  const names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const weekday = names[new Date(Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]))).getUTCDay()];
  return `${normalized} (${weekday})`;
}

async function fetchStaffForDateTab(sheetName: string, trainNo: string, departureDate: string): Promise<TrainStaff | null> {
  const url = `${STAFF_GVIZ_BASE_URL}?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const csv = await fetchText(url);
  if (!csv.trim()) return null;

  const parsed = Papa.parse<string[]>(csv, { header: false, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors[0]?.message || "Invalid staff CSV");

  const obhs: StaffMember[] = [];
  const acca: StaffMember[] = [];
  let currentTrain = "";
  let currentJco = "";
  const targetDate = normalizeDate(departureDate);

  for (const row of parsed.data) {
    if (!row?.length) continue;

    const rawTrain = clean(row[0]);
    const explicitTrain = rawTrain.match(/\d{4,6}(?:\s*\/\s*\d{1,6})?/);
    const explicitJco = normalizeDate(row[2]);

    // Google Sheets uses merged cells. Only the first physical row contains
    // TRAIN/JCO, so carry those values down until a new block starts.
    if (explicitTrain) currentTrain = rawTrain;
    if (explicitJco) currentJco = explicitJco;

    if (!trainMatches(currentTrain, trainNo)) continue;

    // The date tab itself is already the service-date search key. If JCO is
    // present, prefer the original departure-date match. If JCO is blank on
    // a continuation row, keep using the block's inherited JCO.
    if (currentJco && currentJco !== targetDate) continue;

    // OBHS: F=ID/No, G=Name, H=Contact No.
    const obhsId = nonEmpty(row[5]);
    const obhsName = nonEmpty(row[6]);
    const obhsMobile = nonEmpty(row[7]);
    if (obhsId || obhsName || obhsMobile) {
      obhs.push({ id: obhsId, coach: "", name: obhsName, mobile: obhsMobile, firm: "" });
    }

    // ACCA: N=ID/No, O=Coach, P=Name, Q=Mobile No, R=Firm.
    const accaId = nonEmpty(row[13]);
    const accaCoach = nonEmpty(row[14]);
    const accaName = nonEmpty(row[15]);
    const accaMobile = nonEmpty(row[16]);
    const accaFirm = nonEmpty(row[17]);
    if (accaId || accaCoach || accaName || accaMobile || accaFirm) {
      acca.push({ id: accaId, coach: accaCoach, name: accaName, mobile: accaMobile, firm: accaFirm });
    }
  }

  if (!obhs.length && !acca.length) return null;
  return {
    trainNo: normalizeTrainNo(trainNo),
    departureDate: targetDate,
    obhs: uniqueMembers(obhs),
    acca: uniqueMembers(acca),
  };
}

async function findStaffFromDepartureToToday(trainNo: string, departureDate: string): Promise<TrainStaff | null> {
  const start = normalizeDate(departureDate);
  const today = todayIndiaDate();
  if (!start || !today) return null;

  // Build every date from ORIGINAL departure through today. Requests are made
  // in parallel so a few missing/non-existent tabs cannot make the Vercel API
  // time out while waiting for each sheet one-by-one.
  const dates: string[] = [];
  let cursor = start;
  for (let guard = 0; guard <= 370; guard++) {
    dates.push(cursor);
    if (cursor === today) break;
    const next = shiftDate(cursor, 1);
    if (!next || next === cursor) break;
    cursor = next;
  }

  const results = await Promise.allSettled(
    dates.map((date) => fetchStaffForDateTab(dateTabName(date), trainNo, start))
  );

  const matches = results
    .filter((r): r is PromiseFulfilledResult<TrainStaff | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((r): r is TrainStaff => Boolean(r));

  if (!matches.length) return null;

  return {
    trainNo: normalizeTrainNo(trainNo),
    departureDate: start,
    obhs: uniqueMembers(matches.flatMap((item) => item.obhs)),
    acca: uniqueMembers(matches.flatMap((item) => item.acca)),
  };
}

export async function getTrainStaff(trainNo: string, departureDateIso: string): Promise<TrainStaff | null> {
  const targetDate = dateFromIso(departureDateIso);
  const key = `${normalizeTrainNo(trainNo)}-${targetDate}`;
  const cached = staffCache.get(key);
  if (cached && Date.now() - cached.savedAt < STAFF_CACHE_TTL_MS) return cached.data;

  if (!targetDate) {
    staffCache.set(key, { savedAt: Date.now(), data: null });
    return null;
  }

  const data = await findStaffFromDepartureToToday(trainNo, targetDate);
  staffCache.set(key, { savedAt: Date.now(), data });
  return data;
}
