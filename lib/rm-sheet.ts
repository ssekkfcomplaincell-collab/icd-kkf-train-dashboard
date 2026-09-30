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

// The normal Google Sheet URL supplied for the RailMadad workbook.
// gviz is used as an additional fallback when the published workbook does
// not expose a tab through its /pub HTML navigation.
const RM_SHEET_ID = "14jrzX7yaNnZ1worcs0VVFB137IajuntRHiBm6hsdTIU";
const RM_GVIZ_BASE_URL =
  `https://docs.google.com/spreadsheets/d/${RM_SHEET_ID}/gviz/tq`;

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { savedAt: number; data: RMComplaint[] }>();
const publishedGidCache = new Map<string, string>();

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

async function fetchCsvByGid(gid: string) {
  const url = `${RM_PUBLISHED_BASE_URL}?gid=${encodeURIComponent(gid)}&single=true&output=csv&_ts=${Date.now()}`;
  return fetchText(url);
}

async function discoverPublishedGid(sheetName: string) {
  const normalizedName = clean(sheetName).toLowerCase();
  const cached = publishedGidCache.get(normalizedName);
  if (cached !== undefined) return cached;

  const htmlUrl = `${RM_PUBLISHED_BASE_URL}html?_ts=${Date.now()}`;
  const html = await fetchText(htmlUrl);
  const escaped = sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Google has changed the published HTML markup over time. Look for the
  // requested tab name near a numeric gid in either direction.
  const patterns = [
    new RegExp("gid(?:=|%3D)(\\d{1,20})[\\s\\S]{0,1500}" + escaped, "i"),
    new RegExp(escaped + "[\\s\\S]{0,1500}gid(?:=|%3D)(\\d{1,20})", "i"),
    new RegExp("gid=(\\d{1,20})[^>]{0,500}>[^<]*" + escaped, "i"),
    new RegExp(escaped + "[^<]{0,500}<[^>]*gid=(\\d{1,20})", "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      publishedGidCache.set(normalizedName, match[1]);
      return match[1];
    }
  }

  publishedGidCache.set(normalizedName, "");
  return "";
}

async function fetchDateTab(sheetName: string, targetTrain: string, targetDepDate: string): Promise<RMComplaint[]> {
  let csv = "";

  // Same approach as the Staff sheet: use the real Google Spreadsheet ID
  // and gviz with the exact date-tab name. This means newly created tabs such
  // as 01.10.26 are picked up automatically without adding a new GID to code.
  try {
    const url = `${RM_GVIZ_BASE_URL}?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_ts=${Date.now()}`;
    csv = await fetchText(url);
  } catch {
    // Fall back to the published workbook endpoints for older/public tabs.
  }

  if (!csv.trim()) {
    try {
      const gid = await discoverPublishedGid(sheetName);
      if (gid) csv = await fetchCsvByGid(gid);
    } catch {
      // Continue to the legacy published sheet-name endpoint.
    }
  }

  if (!csv.trim()) {
    const url = `${RM_PUBLISHED_BASE_URL}?output=csv&sheet=${encodeURIComponent(sheetName)}&single=true&_ts=${Date.now()}`;
    try {
      csv = await fetchText(url);
    } catch {
      return [];
    }
  }
  if (!csv.trim()) return [];

  const parsed = Papa.parse<string[]>(csv, { header: false, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(parsed.errors[0]?.message || "Invalid RailMadad CSV");

  const results: RMComplaint[] = [];
  for (const row of parsed.data) {
    if (!row?.length) continue;

    // IMPORTANT: RM matching uses the actual values in each complaint row.
    // D = DEP. DATE and H = TRAIN NO. Do not carry either value down from
    // another row, because blank H rows must never be assigned to a train.
    const explicitDepDate = normalizeDate(row[3]); // Column D = DEP. DATE
    const explicitTrain = clean(row[7]); // Column H = TRAIN NO.
    if (!explicitDepDate || normalizeDate(explicitDepDate) !== normalizeDate(targetDepDate)) continue;
    if (!explicitTrain || !trainCellMatches(explicitTrain, targetTrain)) continue;

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
  // Count each RailMadad complaint once. REF NO. is the complaint's unique
  // identifier; this also prevents the same row being counted twice when the
  // same date tab is reached through gviz and the published fallback.
  const seen = new Set<string>();
  const data = merged.filter((item) => {
    const ref = clean(item.refNo);
    const fallbackKey = [item.compDateTime, item.trainNo, item.coachNo, item.complaintDescription].join("|").toLowerCase();
    const key = ref ? `ref:${ref.toLowerCase()}` : `row:${fallbackKey}`;
    if (!key.replace(/[:|]/g, "")) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  data.sort((a, b) => (a.compDateTime || "").localeCompare(b.compDateTime || ""));
  cache.set(key, { savedAt: Date.now(), data });
  return data;
}
