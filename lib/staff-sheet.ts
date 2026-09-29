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

const STAFF_PUBLISHED_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRDL5IskL--QSgu2NgWY_F_qe4cZ7tlUYkpVlFdwIuZha-_PYcamTyZblLXtqjhzOIIdCfrslO3rKCg/pubhtml";

const STAFF_CACHE_TTL_MS = 60_000;
const staffCache = new Map<string, { savedAt: number; data: TrainStaff | null }>();
let tabMapCache: { savedAt: number; tabs: { gid: string; name: string }[] } | null = null;
let tabMapInFlight: Promise<{ gid: string; name: string }[]> | null = null;

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

async function discoverTabs() {
  if (tabMapCache && Date.now() - tabMapCache.savedAt < 10 * 60_000) return tabMapCache.tabs;
  if (tabMapInFlight) return tabMapInFlight;

  tabMapInFlight = fetchText(STAFF_PUBLISHED_URL)
    .then((html) => {
      const tabs: { gid: string; name: string }[] = [];
      const seen = new Set<string>();

      // Published Google Sheets exposes tab buttons as sheet-button-<gid>.
      const patterns = [
        /id=["']sheet-button-(\d+)["'][^>]*>([\s\S]*?)<\/li>/gi,
        /id=["']sheet-button-(\d+)["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
      ];
      for (const re of patterns) {
        let match: RegExpExecArray | null;
        while ((match = re.exec(html))) {
          const gid = match[1];
          const name = clean(match[2].replace(/<[^>]+>/g, " "));
          if (!seen.has(gid) && name) {
            seen.add(gid);
            tabs.push({ gid, name });
          }
        }
      }

      // Fallback: collect gid links and use nearby visible text where possible.
      if (!tabs.length) {
        const linkRe = /(?:href|data-gid)=["'][^"']*(?:#gid=|gid=)(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match: RegExpExecArray | null;
        while ((match = linkRe.exec(html))) {
          const gid = match[1];
          const name = clean(match[2].replace(/<[^>]+>/g, " "));
          if (!seen.has(gid) && name) {
            seen.add(gid);
            tabs.push({ gid, name });
          }
        }
      }

      if (!tabs.length) throw new Error("No published staff sheet tabs found");
      tabMapCache = { savedAt: Date.now(), tabs };
      return tabs;
    })
    .finally(() => {
      tabMapInFlight = null;
    });

  return tabMapInFlight;
}

function findDateTab(tabs: { gid: string; name: string }[], targetDate: string) {
  const target = normalizeDate(targetDate);
  if (!target) return null;
  return tabs.find((tab) => normalizeDate(tab.name) === target) || null;
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

async function fetchStaffForTab(gid: string, trainNo: string, departureDate: string): Promise<TrainStaff | null> {
  const url = `${STAFF_PUBLISHED_URL.replace(/\/pubhtml.*$/, "/pub?gid=")}${encodeURIComponent(gid)}&single=true&output=csv`;
  const csv = await fetchText(url);
  if (!csv.trim()) return null;

  const parsed = Papa.parse<string[]>(csv, { header: false, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors[0]?.message || "Invalid staff CSV");

  const targetTrain = normalizeTrainNo(trainNo);
  const targetDate = normalizeDate(departureDate);
  const obhs: StaffMember[] = [];
  const acca: StaffMember[] = [];

  for (const row of parsed.data) {
    if (!row?.length) continue;
    const rowTrain = normalizeTrainNo(row[0]);
    const rowJco = normalizeDate(row[2]);
    if (!rowTrain || rowTrain !== targetTrain || !rowJco || rowJco !== targetDate) continue;

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
  return { trainNo: targetTrain, departureDate: targetDate, obhs: uniqueMembers(obhs), acca: uniqueMembers(acca) };
}

export async function getTrainStaff(trainNo: string, departureDateIso: string): Promise<TrainStaff | null> {
  const targetDate = dateFromIso(departureDateIso);
  const key = `${normalizeTrainNo(trainNo)}-${targetDate}`;
  const cached = staffCache.get(key);
  if (cached && Date.now() - cached.savedAt < STAFF_CACHE_TTL_MS) return cached.data;

  const tabs = await discoverTabs();
  const tab = findDateTab(tabs, targetDate);
  if (!tab) {
    staffCache.set(key, { savedAt: Date.now(), data: null });
    return null;
  }

  const data = await fetchStaffForTab(tab.gid, trainNo, targetDate);
  staffCache.set(key, { savedAt: Date.now(), data });
  return data;
}
