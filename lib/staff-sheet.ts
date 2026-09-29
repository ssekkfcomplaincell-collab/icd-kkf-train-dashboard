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

function weekdayForDate(date: string) {
  const m = normalizeDate(date).match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return "";
  const year = 2000 + Number(m[3]);
  const month = Number(m[2]);
  const day = Number(m[1]);
  const names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return names[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function dateTabName(date: string) {
  const normalized = normalizeDate(date);
  const weekday = weekdayForDate(normalized);
  return weekday ? `${normalized} (${weekday})` : normalized;
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
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

async function fetchStaffForDateTab(sheetName: string, trainNo: string, departureDate: string): Promise<TrainStaff | null> {
  // Google Visualization can address a specific worksheet by its exact name.
  // This is important because the staff workbook contains one tab per date.
  const url = `${STAFF_GVIZ_BASE_URL}?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const csv = await fetchText(url);
  if (!csv.trim()) return null;

  const parsed = Papa.parse<string[]>(csv, { header: false, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors[0]?.message || "Invalid staff CSV");

  const targetTrain = normalizeTrainNo(trainNo);
  const targetDate = normalizeDate(departureDate);
  const obhs: StaffMember[] = [];
  const acca: StaffMember[] = [];

  // TRAIN and JCO are vertically merged in the source sheet. CSV export puts
  // their value only on the first row of the merged block, so carry the values
  // forward until the next explicit train/JCO block.
  let currentTrain = "";
  let currentJco = "";

  for (const row of parsed.data) {
    if (!row?.length) continue;

    const explicitTrain = normalizeTrainNo(row[0]);
    const explicitJco = normalizeDate(row[2]);
    if (explicitTrain) currentTrain = explicitTrain;
    if (explicitJco) currentJco = explicitJco;

    if (currentTrain !== targetTrain || currentJco !== targetDate) continue;

    const obhsId = nonEmpty(row[5]);
    const obhsName = nonEmpty(row[6]);
    const obhsMobile = nonEmpty(row[7]);
    if (obhsId || obhsName || obhsMobile) {
      obhs.push({ id: obhsId, coach: "", name: obhsName, mobile: obhsMobile, firm: "" });
    }

    const accaId = nonEmpty(row[13]);
    const accaCoach = nonEmpty(row[14]);
    const accaName = nonEmpty(row[15]);
    const accaMobile = nonEmpty(row[16]);
    const accaFirm = nonEmpty(row[17]);
    if (accaId || accaCoach || accaName || accaMobile) {
      acca.push({ id: accaId, coach: accaCoach, name: accaName, mobile: accaMobile, firm: accaFirm });
    }
  }

  if (!obhs.length && !acca.length) return null;
  return {
    trainNo: targetTrain,
    departureDate: targetDate,
    obhs: uniqueMembers(obhs),
    acca: uniqueMembers(acca),
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

  const sheetName = dateTabName(targetDate);
  const data = await fetchStaffForDateTab(sheetName, trainNo, targetDate);
  staffCache.set(key, { savedAt: Date.now(), data });
  return data;
}
