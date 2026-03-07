const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DAYS = ["MON", "TUE", "WED", "THU", "FRI"];
const HOURS = Array.from({ length: 24 }, (_v, hour) => `${String(hour).padStart(2, "0")}:00`);
const MAX_CALENDAR_FETCH_BYTES = 5 * 1024 * 1024;
const CALENDAR_FETCH_TIMEOUT_MS = 15000;

const DEFAULT_PROFILE = {
  mode: "productive_hours",
  schoolBlocks: [],
  productiveHours: ["09:00-11:00", "20:00-22:00"],
  examDates: [],
  weeklyGoalsHours: 14,
  configured: false
};

function createDatabase() {
  const preferredDir = path.resolve(__dirname, "data");
  const fallbackDir = path.resolve(process.env.SPEEDUP_DATA_DIR || "/tmp/speedup-data");

  let dataDir = preferredDir;
  try {
    fs.mkdirSync(preferredDir, { recursive: true });
  } catch {
    dataDir = fallbackDir;
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "speedup.sqlite");
  return new sqlite3.Database(dbPath);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function safeJsonParse(raw, fallback) {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function createId(prefix = "tm") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateOnly(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getWeekStart(dateInput = new Date()) {
  const date = new Date(dateInput);
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatDateOnly(d);
}

function normalizeWeekStart(value) {
  if (!value) return getWeekStart(new Date());
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return getWeekStart(new Date());
  return getWeekStart(parsed);
}

function normalizeDay(value) {
  const normalized = String(value || "").trim().slice(0, 3).toUpperCase();
  if (!DAYS.includes(normalized)) {
    throw new Error("Invalid day. Expected MON..FRI.");
  }
  return normalized;
}

function normalizeHour(value) {
  const normalized = normalizeClockTime(value);
  if (!HOURS.includes(normalized)) {
    throw new Error(`Hour ${normalized} is outside supported timetable slots.`);
  }
  return normalized;
}

function normalizeClockTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error("Invalid hour format. Use HH:MM.");
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) throw new Error("Invalid hour value.");
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeTopicList(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => String(x || "").trim()).filter(Boolean))];
  }
  return [...new Set(String(raw || "").split(",").map((x) => x.trim()).filter(Boolean))];
}

function parseHourRangesInput(rawList, rawText) {
  const source = Array.isArray(rawList) ? rawList : String(rawText || "").split(",");
  return source
    .map((entry) => {
      const raw = String(entry || "").trim();
      const match = raw.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
      if (!match) return null;
      try {
        const start = normalizeClockTime(match[1]);
        const end = normalizeClockTime(match[2]);
        return `${start}-${end}`;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseSchoolBlocksInput(rawBlocks, rawText) {
  const list = [];

  if (Array.isArray(rawBlocks)) {
    rawBlocks.forEach((block) => {
      try {
        const day = normalizeDay(block.day);
        const start = normalizeClockTime(block.start);
        const end = normalizeClockTime(block.end);
        const subject = normalizeConceptLabel(block.subject || block.title || "");
        list.push(subject ? { day, start, end, subject } : { day, start, end });
      } catch {
        // Ignore invalid block.
      }
    });
  }

  if (!list.length && rawText) {
    const textItems = String(rawText)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    textItems.forEach((item) => {
      const match = item.match(/^([A-Za-z]+)\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})(?:\s+(.+))?$/);
      if (!match) return;
      try {
        const day = normalizeDay(match[1]);
        const start = normalizeClockTime(match[2]);
        const end = normalizeClockTime(match[3]);
        const subject = normalizeConceptLabel(match[4] || "");
        list.push(subject ? { day, start, end, subject } : { day, start, end });
      } catch {
        // Ignore invalid block.
      }
    });
  }

  return list;
}

function parseExamDates(rawList, rawText) {
  const list = Array.isArray(rawList) ? rawList : String(rawText || "").split(",");
  return list
    .map((entry) => String(entry || "").trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
}

function nowIso() {
  return new Date().toISOString();
}

const ICS_DAY_TO_INTERNAL = {
  MO: "MON",
  TU: "TUE",
  WE: "WED",
  TH: "THU",
  FR: "FRI"
};

const DAY_NAME_TO_INTERNAL = {
  mon: "MON",
  monday: "MON",
  tue: "TUE",
  tues: "TUE",
  tuesday: "TUE",
  wed: "WED",
  weds: "WED",
  wednesday: "WED",
  thu: "THU",
  thur: "THU",
  thurs: "THU",
  thursday: "THU",
  fri: "FRI",
  friday: "FRI"
};

function normalizeDayName(value) {
  const key = String(value || "").trim().toLowerCase();
  return DAY_NAME_TO_INTERNAL[key] || "";
}

function dayFromDateParts(year, month, day) {
  const date = new Date(year, month - 1, day);
  const jsDay = date.getDay();
  const map = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const token = map[jsDay] || "";
  return DAYS.includes(token) ? token : "";
}

function formatYmd(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeIanaTimezone(value) {
  const raw = String(value || "").trim().replace(/^\/+/, "");
  if (!raw) return "";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return "";
  }
}

function getDefaultTimeZone() {
  try {
    return normalizeIanaTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
  } catch {
    return "UTC";
  }
}

function getDateTimePartsInZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  const partMap = {};
  formatter.formatToParts(date).forEach((part) => {
    if (part.type === "literal") return;
    partMap[part.type] = part.value;
  });

  return {
    year: Number(partMap.year || 0),
    month: Number(partMap.month || 0),
    day: Number(partMap.day || 0),
    hour: Number(partMap.hour || 0),
    minute: Number(partMap.minute || 0)
  };
}

function parseIcsPropertyLine(line) {
  const idx = String(line || "").indexOf(":");
  if (idx < 0) return null;
  const left = String(line).slice(0, idx).trim();
  const value = String(line).slice(idx + 1).trim();
  if (!left) return null;

  const tokens = left.split(";").map((part) => String(part || "").trim()).filter(Boolean);
  const key = String(tokens[0] || "").toUpperCase();
  const params = {};

  tokens.slice(1).forEach((token) => {
    const sep = token.indexOf("=");
    if (sep < 0) return;
    const paramKey = token.slice(0, sep).trim().toUpperCase();
    const paramVal = token.slice(sep + 1).trim().replace(/^"|"$/g, "");
    if (!paramKey) return;
    params[paramKey] = paramVal;
  });

  if (!key) return null;
  return { key, value, params };
}

function getIcsDateTimeContext(event, key, calendarTimeZone, preferredTimeZone = "") {
  const params = event?.[`${key}__PARAMS`];
  const tzid = normalizeIanaTimezone(params?.TZID || "");
  const fallback = normalizeIanaTimezone(calendarTimeZone)
    || normalizeIanaTimezone(preferredTimeZone)
    || getDefaultTimeZone();
  return {
    timeZone: tzid || fallback
  };
}

function parseIcsDateTime(value, context = {}) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hh = match[4] !== undefined ? Number(match[4]) : null;
  const mm = match[5] !== undefined ? Number(match[5]) : null;
  const ss = match[6] !== undefined ? Number(match[6]) : 0;
  const isUtc = Boolean(match[7]);

  let dayToken = dayFromDateParts(year, month, day);
  if (hh === null || mm === null) {
    return { day: dayToken, time: null, date: formatYmd(year, month, day), timeZone: context.timeZone || "" };
  }

  if (isUtc) {
    const targetZone = normalizeIanaTimezone(context.timeZone) || getDefaultTimeZone();
    const dateUtc = new Date(Date.UTC(year, month - 1, day, hh, mm, ss));
    const parts = getDateTimePartsInZone(dateUtc, targetZone);
    dayToken = dayFromDateParts(parts.year, parts.month, parts.day);
    return {
      day: dayToken,
      time: normalizeClockTime(`${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`),
      date: formatYmd(parts.year, parts.month, parts.day),
      timeZone: targetZone
    };
  }

  return {
    day: dayToken,
    time: normalizeClockTime(`${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`),
    date: formatYmd(year, month, day),
    timeZone: context.timeZone || ""
  };
}

function extractByDayFromRrule(rrule) {
  const raw = String(rrule || "");
  const match = raw.match(/BYDAY=([^;]+)/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((token) => ICS_DAY_TO_INTERNAL[String(token || "").trim().toUpperCase()])
    .filter(Boolean);
}

function addMinutesToClock(clock, deltaMinutes) {
  const base = hourToInt(normalizeClockTime(clock));
  const total = Math.max(0, Math.min((24 * 60) - 1, base + Number(deltaMinutes || 0)));
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function dedupeSchoolBlocks(blocks) {
  const seen = new Set();
  const deduped = [];
  (blocks || []).forEach((block) => {
    try {
      const day = normalizeDay(block.day);
      const start = normalizeClockTime(block.start);
      const end = normalizeClockTime(block.end);
      if (hourToInt(end) <= hourToInt(start)) return;
      const subject = normalizeConceptLabel(block.subject || "School Block") || "School Block";
      const key = `${day}|${start}|${end}|${subject.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push({ day, start, end, subject });
    } catch {
      // ignore malformed block
    }
  });
  return deduped;
}

function schoolBlockTypeRank(subject) {
  const value = String(subject || "").toLowerCase();
  if (value.includes("lecture")) return 100;
  if (value.includes("tutorial")) return 85;
  if (value.includes("laboratory") || value.includes(" lab")) return 75;
  if (value.includes("workshop")) return 65;
  if (value.includes("quiz")) return 40;
  return 50;
}

function collapseSchoolBlocksByTimeslot(blocks) {
  const slotMap = new Map();

  (blocks || []).forEach((block) => {
    try {
      const day = normalizeDay(block.day);
      const start = normalizeClockTime(block.start);
      const end = normalizeClockTime(block.end);
      if (hourToInt(end) <= hourToInt(start)) return;
      const subject = normalizeConceptLabel(block.subject || "School Block") || "School Block";

      const slotKey = `${day}|${start}|${end}`;
      if (!slotMap.has(slotKey)) {
        slotMap.set(slotKey, { day, start, end, subjects: new Map() });
      }

      const slot = slotMap.get(slotKey);
      slot.subjects.set(subject, Number(slot.subjects.get(subject) || 0) + 1);
    } catch {
      // ignore malformed block
    }
  });

  const collapsed = [];
  slotMap.forEach((slot) => {
    const candidates = [...slot.subjects.entries()].map(([subject, count]) => ({
      subject,
      count,
      rank: schoolBlockTypeRank(subject)
    }));

    candidates.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (b.rank !== a.rank) return b.rank - a.rank;
      return a.subject.localeCompare(b.subject);
    });

    if (!candidates.length) return;
    collapsed.push({
      day: slot.day,
      start: slot.start,
      end: slot.end,
      subject: candidates[0].subject
    });
  });

  return dedupeSchoolBlocks(collapsed);
}

function parseIcsOccurrences(buffer, options = {}) {
  const text = String(buffer?.toString("utf8") || "");
  if (!text.trim()) return [];
  const preferredTimeZone = normalizeIanaTimezone(options?.preferredTimeZone || "");

  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let current = null;
  let calendarTimeZone = "";

  lines.forEach((rawLine) => {
    const line = String(rawLine || "").trim();
    if (!line) return;
    if (line.toUpperCase() === "BEGIN:VEVENT") {
      current = {};
      return;
    }
    if (line.toUpperCase() === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      return;
    }
    const property = parseIcsPropertyLine(line);
    if (!property) return;

    if (!current) {
      if (property.key === "X-WR-TIMEZONE") {
        calendarTimeZone = normalizeIanaTimezone(property.value) || calendarTimeZone;
      }
      return;
    }

    current[property.key] = property.value;
    if (property.params && Object.keys(property.params).length) {
      current[`${property.key}__PARAMS`] = property.params;
    }
  });

  if (!events.length) {
    throw new Error(
      "ICS file has no VEVENT entries. This file only has calendar headers, not class events. If this is a subscribed calendar, use its webcal/https feed URL."
    );
  }

  const occurrences = [];
  events.forEach((event) => {
    const startInfo = parseIcsDateTime(
      event.DTSTART || "",
      getIcsDateTimeContext(event, "DTSTART", calendarTimeZone, preferredTimeZone)
    );
    if (!startInfo?.time) return;
    const endInfo = parseIcsDateTime(
      event.DTEND || "",
      getIcsDateTimeContext(event, "DTEND", calendarTimeZone, preferredTimeZone)
    );
    const start = startInfo.time;
    let end = endInfo?.time || addMinutesToClock(start, 60);
    if (hourToInt(end) <= hourToInt(start)) {
      end = addMinutesToClock(start, 60);
    }

    const summary = normalizeConceptLabel(event.SUMMARY || "School Block") || "School Block";
    const days = extractByDayFromRrule(event.RRULE);
    if (!days.length && startInfo.day) days.push(startInfo.day);

    days.forEach((day) => {
      if (!DAYS.includes(day)) return;
      occurrences.push({
        day,
        start,
        end,
        subject: summary,
        date: startInfo.date || ""
      });
    });
  });

  if (!occurrences.length) {
    throw new Error("ICS contains events, but no weekday timed blocks were detected (MON-FRI with DTSTART/DTEND).");
  }

  return occurrences;
}

function parseIcsTimetableBuffer(buffer, options = {}) {
  const occurrences = parseIcsOccurrences(buffer, options);
  return collapseSchoolBlocksByTimeslot(occurrences.map((item) => ({
    day: item.day,
    start: item.start,
    end: item.end,
    subject: item.subject
  })));
}

function parseIcsWeeklyBlocks(buffer, options = {}) {
  const occurrences = parseIcsOccurrences(buffer, options);
  const weekly = {};

  occurrences.forEach((item) => {
    const date = String(item.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const weekStart = normalizeWeekStart(date);
    if (!weekly[weekStart]) weekly[weekStart] = [];
    weekly[weekStart].push({
      day: item.day,
      start: item.start,
      end: item.end,
      subject: item.subject
    });
  });

  Object.keys(weekly).forEach((weekStart) => {
    weekly[weekStart] = collapseSchoolBlocksByTimeslot(weekly[weekStart]);
  });

  return weekly;
}

function parsePdfTimeToken(value) {
  const raw = String(value || "").trim().replace(".", ":");
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  return normalizeClockTime(`${String(Number(match[1])).padStart(2, "0")}:${match[2]}`);
}

async function parsePdfTimetableBuffer(buffer, pdfParseLib) {
  if (!pdfParseLib) {
    throw new Error("PDF parser unavailable on server.");
  }
  const parsed = await pdfParseLib(buffer);
  const text = String(parsed?.text || "");
  if (!text.trim()) return [];

  const blocks = [];
  const lines = text
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  lines.forEach((line) => {
    let day = "";
    let start = "";
    let end = "";
    let subject = "";

    const dayFirst = line.match(/^(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?)\b.*?(\d{1,2}[:.]\d{2})\s*(?:-|–|to)\s*(\d{1,2}[:.]\d{2})(.*)$/i);
    const timeFirst = line.match(/^(\d{1,2}[:.]\d{2})\s*(?:-|–|to)\s*(\d{1,2}[:.]\d{2}).*?\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?)\b(.*)$/i);

    if (dayFirst) {
      day = normalizeDayName(dayFirst[1]);
      start = parsePdfTimeToken(dayFirst[2]);
      end = parsePdfTimeToken(dayFirst[3]);
      subject = normalizeConceptLabel(dayFirst[4] || "");
    } else if (timeFirst) {
      day = normalizeDayName(timeFirst[3]);
      start = parsePdfTimeToken(timeFirst[1]);
      end = parsePdfTimeToken(timeFirst[2]);
      subject = normalizeConceptLabel(timeFirst[4] || "");
    }

    if (!day || !start || !end) return;
    if (hourToInt(end) <= hourToInt(start)) return;
    blocks.push({
      day,
      start,
      end,
      subject: subject || "School Block"
    });
  });

  return dedupeSchoolBlocks(blocks);
}

function bytesToBestEffortText(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return "";
  const utf8 = buffer.toString("utf8");
  return String(utf8 || "").replace(/\0/g, " ").trim();
}

async function extractDocxText(buffer, mammothLib) {
  if (!mammothLib?.extractRawText) return "";
  try {
    const out = await mammothLib.extractRawText({ buffer });
    return String(out?.value || "").trim();
  } catch {
    return "";
  }
}

function normalizeCalendarUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Calendar URL is required.");
  const normalized = value.replace(/^webcals?:\/\//i, "https://");
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Invalid calendar URL.");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Calendar URL must use webcal/http/https.");
  }
  return parsed.toString();
}

async function fetchCalendarUrlBuffer(calendarUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALENDAR_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(calendarUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch calendar URL (${res.status}).`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
      throw new Error("Calendar URL returned an empty file.");
    }
    if (buffer.length > MAX_CALENDAR_FETCH_BYTES) {
      throw new Error("Calendar file is too large. Please use a smaller timetable export.");
    }
    return buffer;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Calendar URL request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractPdfText(buffer, pdfParseLib) {
  if (!pdfParseLib) return "";
  try {
    const out = await pdfParseLib(buffer);
    return String(out?.text || "").trim();
  } catch {
    return "";
  }
}

function looksLikeStructuredText(ext, mime) {
  if (ext === ".ics") return true;
  if ([".txt", ".csv", ".md", ".json", ".xml", ".html", ".htm", ".tsv", ".yaml", ".yml"].includes(ext)) return true;
  if (String(mime || "").startsWith("text/")) return true;
  return false;
}

function normalizeAiBlock(block) {
  const day = normalizeDay(block?.day || block?.weekday || "");
  const start = normalizeClockTime(block?.start || block?.startTime || "");
  const end = normalizeClockTime(block?.end || block?.endTime || "");
  if (hourToInt(end) <= hourToInt(start)) throw new Error("Invalid time range");
  const subject = normalizeConceptLabel(block?.subject || block?.title || "School Block") || "School Block";
  return { day, start, end, subject };
}

async function inferSchoolBlocksWithAI({
  fileName,
  mimeType,
  extractedText,
  callOpenAIChat,
  safeParseJson,
  isOpenAIConfigured
}) {
  const text = String(extractedText || "").trim();
  if (!text) {
    throw new Error("File text could not be extracted. Try PDF, DOCX, TXT, CSV, or ICS.");
  }

  if (!isOpenAIConfigured?.()) {
    throw new Error("OpenAI API is not configured, so AI extraction is unavailable for this file.");
  }

  const system = [
    "You extract school timetable blocks from uploaded file text.",
    "Return strict JSON with key: blocks.",
    "blocks must be an array of objects: day, start, end, subject.",
    "day must be one of MON,TUE,WED,THU,FRI.",
    "start/end must be 24h HH:MM.",
    "Include only explicit class blocks from the text; do not invent events."
  ].join(" ");

  const user = {
    fileName: String(fileName || ""),
    mimeType: String(mimeType || ""),
    text: text.slice(0, 24000)
  };

  const raw = await callOpenAIChat(
    [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) }
    ],
    0.1
  );

  const parsed = safeParseJson(raw);
  if (!parsed || !Array.isArray(parsed.blocks)) {
    throw new Error("AI could not parse timetable blocks from this file.");
  }

  const normalized = [];
  parsed.blocks.forEach((block) => {
    try {
      normalized.push(normalizeAiBlock(block));
    } catch {
      // skip invalid block
    }
  });

  return dedupeSchoolBlocks(normalized);
}

async function extractSchoolBlocksFromUpload(file, deps) {
  const originalName = String(file?.originalname || "").toLowerCase();
  const mime = String(file?.mimetype || "").toLowerCase();
  const ext = path.extname(originalName);
  const buffer = file?.buffer;
  const {
    pdfParse,
    mammoth,
    callOpenAIChat,
    safeParseJson,
    isOpenAIConfigured,
    preferredTimeZone
  } = deps || {};

  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("Missing upload file buffer.");
  }

  let primaryParseError = "";

  if (ext === ".ics" || mime.includes("text/calendar") || mime.includes("application/ics")) {
    try {
      const blocks = parseIcsTimetableBuffer(buffer, { preferredTimeZone });
      const weeklyBlocks = parseIcsWeeklyBlocks(buffer, { preferredTimeZone });
      return { fileType: "ics", provider: "ics-parser", blocks, weeklyBlocks };
    } catch (error) {
      primaryParseError = String(error?.message || "ICS parsing failed.");
      // Continue with AI fallback from extracted text.
    }
  }

  if (ext === ".pdf" || mime.includes("application/pdf")) {
    const blocks = await parsePdfTimetableBuffer(buffer, pdfParse);
    if (blocks.length) return { fileType: "pdf", provider: "pdf-parser", blocks, weeklyBlocks: {} };
  }

  let text = "";
  if (looksLikeStructuredText(ext, mime)) {
    text = bytesToBestEffortText(buffer);
  } else if (ext === ".docx" || mime.includes("wordprocessingml")) {
    text = await extractDocxText(buffer, mammoth);
  } else if (ext === ".pdf" || mime.includes("application/pdf")) {
    text = await extractPdfText(buffer, pdfParse);
  } else {
    // Best effort for unknown/binary types.
    text = bytesToBestEffortText(buffer);
  }

  const aiBlocks = await inferSchoolBlocksWithAI({
    fileName: file?.originalname || "",
    mimeType: mime,
    extractedText: text,
    callOpenAIChat,
    safeParseJson,
    isOpenAIConfigured
  });

  if (!aiBlocks.length) {
    if (primaryParseError) {
      throw new Error(`${primaryParseError} AI fallback also could not find timetable blocks in this file.`);
    }
    throw new Error("AI could not find timetable blocks in uploaded file.");
  }

  return { fileType: ext.replace(".", "") || "unknown", provider: "ai", blocks: aiBlocks, weeklyBlocks: {} };
}

async function extractSchoolBlocksFromCalendarUrl(calendarUrlRaw, deps) {
  const calendarUrl = normalizeCalendarUrl(calendarUrlRaw);
  const buffer = await fetchCalendarUrlBuffer(calendarUrl);
  const {
    callOpenAIChat,
    safeParseJson,
    isOpenAIConfigured,
    preferredTimeZone
  } = deps || {};

  let primaryParseError = "";
  try {
    const blocks = parseIcsTimetableBuffer(buffer, { preferredTimeZone });
    const weeklyBlocks = parseIcsWeeklyBlocks(buffer, { preferredTimeZone });
    return { fileType: "ics-url", provider: "ics-url-parser", blocks, weeklyBlocks, calendarUrl };
  } catch (error) {
    primaryParseError = String(error?.message || "Calendar URL parsing failed.");
  }

  const text = bytesToBestEffortText(buffer);
  const aiBlocks = await inferSchoolBlocksWithAI({
    fileName: "calendar-url.ics",
    mimeType: "text/calendar",
    extractedText: text,
    callOpenAIChat,
    safeParseJson,
    isOpenAIConfigured
  });

  if (!aiBlocks.length) {
    throw new Error(`${primaryParseError} AI fallback also could not find timetable blocks at this calendar URL.`);
  }

  return { fileType: "ics-url", provider: "ai", blocks: aiBlocks, weeklyBlocks: {}, calendarUrl };
}

function expandSchoolBlockHours(start, end) {
  const startMin = hourToInt(start);
  const endMin = hourToInt(end);
  const hours = [];
  if (endMin <= startMin) return hours;

  for (let h = 0; h < 24; h += 1) {
    const slotStart = h * 60;
    const slotEnd = slotStart + 60;
    const overlaps = slotStart < endMin && slotEnd > startMin;
    if (overlaps) {
      hours.push(`${String(h).padStart(2, "0")}:00`);
    }
  }
  return hours;
}

async function syncSchoolTimetableForWeek(db, studentId, weekStart, profile, schoolBlocks = null) {
  await run(
    db,
    `DELETE FROM timetable_slots WHERE student_id = ? AND week_start = ? AND source = 'school'`,
    [studentId, weekStart]
  );
  await run(
    db,
    `DELETE FROM timetable_tasks WHERE student_id = ? AND week_start = ? AND source = 'school'`,
    [studentId, weekStart]
  );

  const blocks = dedupeSchoolBlocks(schoolBlocks || profile?.schoolBlocks || []);
  if (!blocks.length) return;

  const now = nowIso();

  for (const block of blocks) {
    const subject = normalizeConceptLabel(block.subject || "School Block") || "School Block";
    const title = `${subject} class`;
    const duration = clampInt(Math.max(60, hourToInt(block.end) - hourToInt(block.start)), 15, 240, 60);
    const taskId = createId("school");

    await run(
      db,
      `INSERT INTO timetable_tasks (
        id, student_id, week_start, title, subject, topic, type, priority, estimated_minutes, status, source, notes, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        taskId,
        studentId,
        weekStart,
        title,
        subject,
        subject,
        "school-block",
        100,
        duration,
        "planned",
        "school",
        "Imported from school timetable file",
        now,
        now
      ]
    );

    let placed = 0;
    const hours = expandSchoolBlockHours(block.start, block.end);
    for (const hour of hours) {
      const occupied = await get(
        db,
        `SELECT source FROM timetable_slots WHERE student_id = ? AND week_start = ? AND day = ? AND hour = ?`,
        [studentId, weekStart, block.day, hour]
      );

      if (occupied?.source && String(occupied.source) !== "school") {
        continue;
      }

      await run(
        db,
        `INSERT INTO timetable_slots (
          student_id, week_start, day, hour, task_id, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, week_start, day, hour) DO UPDATE SET
          task_id = excluded.task_id,
          source = excluded.source,
          updated_at = excluded.updated_at`,
        [studentId, weekStart, block.day, hour, taskId, "school", now, now]
      );
      placed += 1;
    }

    if (!placed) {
      await run(db, `DELETE FROM timetable_tasks WHERE id = ? AND student_id = ?`, [taskId, studentId]);
    }
  }
}

async function saveSchoolWeekBlocks(db, studentId, weeklyBlocks, sourceType = "ics") {
  await run(db, `DELETE FROM timetable_school_week_blocks WHERE student_id = ?`, [studentId]);

  const keys = Object.keys(weeklyBlocks || {});
  if (!keys.length) return;

  const now = nowIso();
  for (const weekStartRaw of keys) {
    const weekStart = normalizeWeekStart(weekStartRaw);
    const blocks = dedupeSchoolBlocks(weeklyBlocks[weekStartRaw] || []);
    await run(
      db,
      `INSERT INTO timetable_school_week_blocks (
        student_id, week_start, blocks_json, source_type, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(student_id, week_start) DO UPDATE SET
        blocks_json = excluded.blocks_json,
        source_type = excluded.source_type,
        updated_at = excluded.updated_at`,
      [studentId, weekStart, JSON.stringify(blocks), String(sourceType || "ics"), now]
    );
  }
}

async function loadSchoolWeekBlocks(db, studentId, weekStart) {
  const row = await get(
    db,
    `SELECT blocks_json FROM timetable_school_week_blocks WHERE student_id = ? AND week_start = ?`,
    [studentId, weekStart]
  );
  return row ? dedupeSchoolBlocks(safeJsonParse(row.blocks_json, [])) : [];
}

async function resolveSchoolBlocksForWeek(db, studentId, weekStart, profile) {
  const weekSpecific = await loadSchoolWeekBlocks(db, studentId, weekStart);
  if (weekSpecific.length) return weekSpecific;
  return dedupeSchoolBlocks(profile?.schoolBlocks || []);
}

function nearestExamDays(examDates) {
  if (!Array.isArray(examDates) || !examDates.length) return null;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let best = null;

  examDates.forEach((dateStr) => {
    const exam = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(exam.getTime())) return;
    const diff = Math.ceil((exam.getTime() - todayStart.getTime()) / 86400000);
    if (best === null || diff < best) best = diff;
  });

  return best;
}

function hourToInt(hour) {
  const [h, m] = String(hour || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function isWithinRanges(hour, ranges) {
  const value = hourToInt(hour);
  return (ranges || []).some((range) => {
    const [start, end] = String(range).split("-");
    return value >= hourToInt(start) && value < hourToInt(end);
  });
}

function isWithinSchoolBlock(day, hour, blocks) {
  const value = hourToInt(hour);
  return (blocks || []).some((block) => {
    if (String(block.day || "") !== day) return false;
    return value >= hourToInt(block.start) && value < hourToInt(block.end);
  });
}

function inferSubject(topic) {
  const cleanTopic = simplifySchoolSubjectLabel(topic) || normalizeConceptLabel(topic);
  const t = String(cleanTopic || "").toLowerCase();
  if (t.includes("machine learning")) return "Machine Learning";
  if (t.includes("data structure") || t.includes("algorithm")) return "Data Structures & Algorithms";
  if (t.includes("web system")) return "Web Systems";
  if (t.includes("object oriented") || t === "oop") return "Object-Oriented Programming";
  if (t.includes("math") || t.includes("calculus") || t.includes("probability")) return "Mathematics";
  if (t.includes("graph") || t.includes("discrete")) return "Discrete Math";
  if (t.includes("vector") || t.includes("algebra")) return "Linear Algebra";
  if (t.includes("algorithm") || t.includes("dp") || t.includes("dynamic")) return "Algorithms";
  if (t.includes("os") || t.includes("operating")) return "Operating Systems";
  if (cleanTopic && !isGenericPlanningLabel(cleanTopic) && cleanTopic.length <= 80) return cleanTopic;
  return "Study";
}

function normalizeConceptLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function simplifySchoolSubjectLabel(value) {
  let label = normalizeConceptLabel(value);
  if (!label) return "";
  label = label.replace(/^[A-Z]{2,}\s*\d{3,5}[A-Z]?\s*-\s*/i, "");
  label = label.replace(/\s*\((?:[^()]*(?:lecture|tutorial|laboratory|lab|workshop|quiz)[^()]*)\)\s*$/i, "");
  label = normalizeConceptLabel(label);
  return label;
}

function normalizeSchoolSubjectForImportance(value) {
  const label = simplifySchoolSubjectLabel(value) || normalizeConceptLabel(value);
  if (!label) return "";
  const lowered = String(label).toLowerCase();
  if (lowered === "school block") return "";
  if (isGenericPlanningLabel(label)) return "";
  return label;
}

function isGenericPlanningLabel(value) {
  const v = String(value || "").toLowerCase().trim();
  if (!v) return true;
  return (
    v === "study" ||
    v === "revision" ||
    v === "mock test" ||
    v === "exam prep" ||
    v === "focused revision block" ||
    v === "practice"
  );
}

function mergeUniqueConcepts(primary, extra, limit = 8) {
  const seen = new Set();
  const merged = [];
  [...(primary || []), ...(extra || [])].forEach((item) => {
    const label = normalizeConceptLabel(item);
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(label);
  });
  return merged.slice(0, limit);
}

function buildSubjectImportanceEntries(blocks) {
  const buckets = new Map();

  (blocks || []).forEach((block) => {
    const subject = normalizeSchoolSubjectForImportance(block?.subject || "");
    if (!subject) return;

    const durationMinutes = clampInt(Math.max(15, hourToInt(block?.end) - hourToInt(block?.start)), 15, 480, 60);
    const key = subject.toLowerCase();
    if (!buckets.has(key)) {
      buckets.set(key, {
        subject,
        weeklyMinutes: 0,
        blockCount: 0
      });
    }

    const bucket = buckets.get(key);
    bucket.weeklyMinutes += durationMinutes;
    bucket.blockCount += 1;
  });

  const rows = [...buckets.values()].sort((a, b) => {
    if (b.weeklyMinutes !== a.weeklyMinutes) return b.weeklyMinutes - a.weeklyMinutes;
    if (b.blockCount !== a.blockCount) return b.blockCount - a.blockCount;
    return a.subject.localeCompare(b.subject);
  });

  const totalMinutes = rows.reduce((sum, row) => sum + Number(row.weeklyMinutes || 0), 0);
  return rows.map((row) => ({
    ...row,
    importanceRatio: totalMinutes > 0 ? Number((row.weeklyMinutes / totalMinutes).toFixed(4)) : 0,
    importanceScore: totalMinutes > 0 ? Math.max(1, Math.round((row.weeklyMinutes * 100) / totalMinutes)) : 0
  }));
}

function mapSubjectImportanceRow(row) {
  return {
    studentId: row.student_id,
    weekStart: row.week_start,
    subject: row.subject,
    weeklyMinutes: Number(row.weekly_minutes || 0),
    blockCount: Number(row.block_count || 0),
    importanceRatio: Number(row.importance_ratio || 0),
    importanceScore: Number(row.importance_score || 0),
    updatedAt: row.updated_at
  };
}

async function saveSubjectImportanceForWeek(db, studentId, weekStart, blocks) {
  const normalizedWeekStart = normalizeWeekStart(weekStart);
  await run(
    db,
    `DELETE FROM timetable_subject_importance WHERE student_id = ? AND week_start = ?`,
    [studentId, normalizedWeekStart]
  );

  const entries = buildSubjectImportanceEntries(blocks);
  if (!entries.length) return [];

  const now = nowIso();
  for (const entry of entries) {
    await run(
      db,
      `INSERT INTO timetable_subject_importance (
        student_id, week_start, subject, weekly_minutes, block_count, importance_ratio, importance_score, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        studentId,
        normalizedWeekStart,
        entry.subject,
        entry.weeklyMinutes,
        entry.blockCount,
        entry.importanceRatio,
        entry.importanceScore,
        now
      ]
    );
  }

  return entries;
}

async function saveSubjectImportanceForWeeks(db, studentId, weeklyBlocks) {
  await run(db, `DELETE FROM timetable_subject_importance WHERE student_id = ?`, [studentId]);

  const weeks = Object.keys(weeklyBlocks || {});
  if (!weeks.length) return;

  for (const weekStartRaw of weeks) {
    const weekStart = normalizeWeekStart(weekStartRaw);
    await saveSubjectImportanceForWeek(db, studentId, weekStart, weeklyBlocks[weekStartRaw] || []);
  }
}

async function loadSubjectImportanceForWeek(db, studentId, weekStart) {
  const rows = await all(
    db,
    `SELECT * FROM timetable_subject_importance WHERE student_id = ? AND week_start = ? ORDER BY importance_score DESC, weekly_minutes DESC, subject ASC`,
    [studentId, normalizeWeekStart(weekStart)]
  );
  return rows.map(mapSubjectImportanceRow);
}

function extractSchoolSubjectSignals(profile) {
  const counts = new Map();
  const blocks = Array.isArray(profile?.schoolBlocks) ? profile.schoolBlocks : [];
  blocks.forEach((block) => {
    const raw = normalizeConceptLabel(block?.subject || "");
    const simplified = simplifySchoolSubjectLabel(raw);
    const label = simplified || raw;
    if (!label || isGenericPlanningLabel(label)) return;
    counts.set(label, Number(counts.get(label) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label)
    .slice(0, 6);
}

function extractExistingTaskSignals(existingTasks) {
  const conceptCounts = new Map();
  const subjectCounts = new Map();
  const conceptToSubject = new Map();
  const bump = (map, key, amount = 1) => {
    const label = normalizeConceptLabel(key);
    if (!label || isGenericPlanningLabel(label)) return;
    map.set(label, Number(map.get(label) || 0) + amount);
  };

  (existingTasks || []).forEach((task) => {
    const source = String(task?.source || "manual").toLowerCase();
    const type = String(task?.type || "").toLowerCase();
    if (source === "ai" || source === "school" || type === "school-block") return;

    const title = normalizeConceptLabel(task?.title);
    const topic = normalizeConceptLabel(task?.topic);
    const subject = normalizeConceptLabel(task?.subject);
    const subjectKey = subject || "";
    const mapConceptToSubject = (concept) => {
      const c = normalizeConceptLabel(concept);
      if (!c || !subjectKey) return;
      const key = c.toLowerCase();
      if (!conceptToSubject.has(key)) conceptToSubject.set(key, subjectKey);
    };

    if (topic) bump(conceptCounts, topic, 3);
    if (subject) {
      bump(subjectCounts, subject, 2);
      bump(conceptCounts, subject, 1);
    }
    mapConceptToSubject(topic);
    mapConceptToSubject(subject);

    if (title) {
      const lead = title.split(/[-:|]/)[0].trim();
      bump(conceptCounts, lead, 1);
      mapConceptToSubject(lead);
    }
  });

  const concepts = [...conceptCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label)
    .slice(0, 5);

  const subjects = [...subjectCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label)
    .slice(0, 4);

  return { concepts, subjects, conceptToSubject };
}

function getMappedSubjectForConcept(signals, concept) {
  const key = normalizeConceptLabel(concept).toLowerCase();
  if (!key) return "";
  return String(signals?.conceptToSubject?.get?.(key) || "").trim();
}

function taskRelatesToConcept(task, concept) {
  const t = `${task?.title || ""} ${task?.topic || ""} ${task?.subject || ""}`.toLowerCase();
  const c = String(concept || "").toLowerCase().trim();
  if (!c) return false;
  return t.includes(c);
}

function taskIdentityKey(task) {
  const title = normalizeConceptLabel(task?.title || "").toLowerCase();
  const topic = normalizeConceptLabel(task?.topic || "").toLowerCase();
  const type = normalizeConceptLabel(task?.type || "").toLowerCase();
  const subject = normalizeConceptLabel(task?.subject || "").toLowerCase();
  return `${title}|${topic}|${type}|${subject}`;
}

function topUpTasksToTarget(primaryTasks, fallbackTasks, targetCount) {
  const out = Array.isArray(primaryTasks) ? [...primaryTasks] : [];
  const seen = new Set(out.map((task) => taskIdentityKey(task)));

  (fallbackTasks || []).forEach((task) => {
    if (out.length >= targetCount) return;
    const key = taskIdentityKey(task);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(task);
  });

  // Final safety net: never return fewer than requested count.
  while (out.length < targetCount) {
    out.push({
      title: `Focused revision block ${out.length + 1}`,
      subject: "Revision",
      topic: "Revision",
      type: "study",
      priority: 55,
      estimatedMinutes: 60,
      source: "ai"
    });
  }

  return out.slice(0, targetCount);
}

function injectExistingCoverageTasks(tasks, signals, availableBlockCount) {
  const current = Array.isArray(tasks) ? [...tasks] : [];
  const concepts = (signals?.concepts || []).slice(0, 2);
  if (!concepts.length) return current.slice(0, availableBlockCount);

  const injected = [];
  concepts.forEach((concept, idx) => {
    if (current.some((task) => taskRelatesToConcept(task, concept)) || injected.some((task) => taskRelatesToConcept(task, concept))) {
      return;
    }

    const mapped = getMappedSubjectForConcept(signals, concept);
    const inferred = inferSubject(concept);
    const subject = mapped || (inferred !== "Study" ? inferred : (signals?.subjects?.[0] || "Study"));
    const basePriority = 86 - idx * 5;

    injected.push({
      title: `${concept} focused practice`,
      subject,
      topic: concept,
      type: "practice",
      priority: basePriority,
      estimatedMinutes: 60,
      source: "ai"
    });

    if (availableBlockCount >= 8) {
      injected.push({
        title: `Spaced review: ${concept}`,
        subject,
        topic: concept,
        type: "spaced-review",
        priority: basePriority - 8,
        estimatedMinutes: 60,
        source: "ai"
      });
    }
  });

  return [...injected, ...current].slice(0, availableBlockCount);
}

function buildScoredSlots(profile) {
  const productiveRanges = profile.productiveHours || [];
  const schoolBlocks = profile.schoolBlocks || [];
  const mode = profile.mode || "productive_hours";
  const hasSchoolBlocks = schoolBlocks.length > 0;

  const slots = [];
  DAYS.forEach((day, dayIndex) => {
    HOURS.forEach((hour, hourIndex) => {
      const inProductive = isWithinRanges(hour, productiveRanges);
      const inSchool = isWithinSchoolBlock(day, hour, schoolBlocks);

      let score = 10;
      if (inProductive) score += 30;
      if (mode === "school_blocks" && hasSchoolBlocks) {
        score += inSchool ? 20 : -8;
      } else if (inSchool) {
        score += 5;
      }
      if (hourToInt(hour) >= 1200) score += 1;
      if (hourToInt(hour) >= 1800) score += 3;

      slots.push({ day, hour, score, inProductive, dayIndex, hourIndex });
    });
  });

  return slots.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
    return a.hourIndex - b.hourIndex;
  });
}

function buildHeuristicTasks(profile, weakConcepts, forgettingRiskTopics) {
  const daysToExam = nearestExamDays(profile.examDates);
  const weeklyGoal = clampInt(profile.weeklyGoalsHours, 4, 40, 14);
  const targetCount = weeklyGoal;

  const weak = normalizeTopicList(weakConcepts).slice(0, 4);
  const risk = normalizeTopicList(forgettingRiskTopics).filter((x) => !weak.includes(x)).slice(0, 4);

  const tasks = [];

  weak.forEach((topic, index) => {
    tasks.push({
      title: `${topic} focused study`,
      subject: inferSubject(topic),
      topic,
      type: "weak-focus",
      priority: 95 - index * 5,
      estimatedMinutes: 60,
      source: "ai"
    });

    if (targetCount >= 10) {
      tasks.push({
        title: `${topic} practice drill`,
        subject: inferSubject(topic),
        topic,
        type: "practice",
        priority: 88 - index * 4,
        estimatedMinutes: 60,
        source: "ai"
      });
    }
  });

  risk.forEach((topic, index) => {
    tasks.push({
      title: `Spaced review: ${topic}`,
      subject: inferSubject(topic),
      topic,
      type: "spaced-review",
      priority: 78 - index * 3,
      estimatedMinutes: 60,
      source: "ai"
    });
  });

  const mockCount = daysToExam !== null && daysToExam <= 14 ? 2 : 1;
  for (let i = 0; i < mockCount; i += 1) {
    tasks.push({
      title: i === 0 ? "Mock test (timed)" : "Mock test corrections",
      subject: "Exam Prep",
      topic: "Mock Test",
      type: "mock-test",
      priority: daysToExam !== null && daysToExam <= 14 ? 90 - i * 3 : 72 - i * 2,
      estimatedMinutes: 60,
      source: "ai"
    });
  }

  while (tasks.length < targetCount) {
    tasks.push({
      title: "Focused revision block",
      subject: "Revision",
      topic: "Revision",
      type: "study",
      priority: 55,
      estimatedMinutes: 60,
      source: "ai"
    });
  }

  return tasks.slice(0, targetCount);
}

function normalizeGeneratedTask(task, fallback) {
  const normalizePlanLabel = (value, fallbackValue = "") => {
    let out = normalizeConceptLabel(value || fallbackValue || "");
    if (!out) return "";
    // Remove common course-code prefixes (e.g. INF 1004 - Topic Name).
    out = out.replace(/^[A-Z]{2,}\s*\d{3,5}[A-Z]?\s*-\s*/i, "");
    // Remove section suffixes (e.g. "(ALL Lecture)", "(P2 Lab)").
    out = out.replace(/\s*\((?:[^()]|\([^)]*\))*\)\s*$/g, "").trim();
    return out;
  };

  const fallbackTopic = normalizePlanLabel(fallback?.topic || fallback?.title || "");
  const topic = normalizePlanLabel(task?.topic, fallbackTopic);
  const fallbackSubject = normalizePlanLabel(
    fallback?.subject || inferSubject(fallbackTopic || "Study"),
    "Study"
  );
  const subject = normalizePlanLabel(task?.subject, fallbackSubject) || fallbackSubject || "Study";
  const fallbackTitle = normalizePlanLabel(fallback?.title || fallbackTopic || "Study block") || "Study block";
  const title = normalizePlanLabel(task?.title, fallbackTitle) || fallbackTitle;

  return {
    title: String(title).slice(0, 120),
    subject: String(subject).slice(0, 80),
    topic: String(topic).slice(0, 120),
    type: String(task?.type || fallback?.type || "study").slice(0, 40),
    priority: clampInt(task?.priority, 1, 100, clampInt(fallback?.priority, 1, 100, 60)),
    estimatedMinutes: clampInt(task?.estimatedMinutes, 15, 240, clampInt(fallback?.estimatedMinutes, 15, 240, 60)),
    source: "ai"
  };
}

async function refineTasksWithOpenAI({
  callOpenAIChat,
  safeParseJson,
  isOpenAIConfigured,
  profile,
  weakConcepts,
  forgettingRiskTopics,
  existingTaskSignals,
  existingSessions,
  baselineTasks,
  existingSummary,
  availableBlockCount
}) {
  if (!isOpenAIConfigured()) {
    return { tasks: baselineTasks, notes: [], provider: "heuristic" };
  }

  const system = [
    "You are a timetable planning assistant for one student.",
    "Return strict JSON with keys: tasks and notes.",
    "tasks must be an array where each item has: title, subject, topic, type, priority, estimatedMinutes.",
    "Do not exceed the same number of tasks as provided in baselineTasks.",
    "Prioritize weak concepts first, include spaced review and mock tests.",
    "Use existingSessions (title/topic/subject/assignedSlot/status) as the primary personalization signal.",
    "When a student has existing manual sessions, generate related continuation blocks in the same subject taxonomy.",
    "Consider existing timetable coverage and avoid duplicating already-heavy subjects.",
    "Do not use raw school class event labels/codes as study titles (e.g. INF 1004 - ...).",
    "Keep labels human-friendly and concise. Prefer baseline task wording when uncertain."
  ].join(" ");

  const profileContext = {
    mode: profile?.mode || "productive_hours",
    productiveHours: Array.isArray(profile?.productiveHours) ? profile.productiveHours : [],
    examDates: Array.isArray(profile?.examDates) ? profile.examDates : [],
    weeklyGoalsHours: Number(profile?.weeklyGoalsHours || 14),
    schoolBlockCount: Array.isArray(profile?.schoolBlocks) ? profile.schoolBlocks.length : 0
  };

  const user = {
    profile: profileContext,
    weakConcepts,
    forgettingRiskTopics,
    existingTaskSignals,
    existingSessions,
    baselineTasks,
    existingTimetable: existingSummary,
    availableBlockCount
  };

  try {
    const raw = await callOpenAIChat(
      [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ],
      0.2
    );

    const parsed = safeParseJson(raw);
    if (!parsed || !Array.isArray(parsed.tasks) || !parsed.tasks.length) {
      return { tasks: baselineTasks, notes: [], provider: "heuristic" };
    }

    const tasks = parsed.tasks
      .slice(0, baselineTasks.length)
      .map((task, idx) => normalizeGeneratedTask(task, baselineTasks[idx]));

    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5)
      : [];

    return { tasks, notes, provider: "openai" };
  } catch {
    return { tasks: baselineTasks, notes: [], provider: "heuristic" };
  }
}

function scheduleTasks(tasks, profile, options = {}) {
  const slots = buildScoredSlots(profile);
  const used = new Set((options.blockedSlots || []).map((x) => String(x)));
  const topicLastDay = new Map();
  const assignments = [];
  const seedTopicLastDay = options.seedTopicLastDay || {};
  Object.keys(seedTopicLastDay).forEach((topic) => {
    topicLastDay.set(topic, Number(seedTopicLastDay[topic]));
  });

  const sortedTasks = tasks
    .map((task, idx) => ({ ...task, taskIndex: idx }))
    .sort((a, b) => b.priority - a.priority);

  sortedTasks.forEach((task) => {
    let selected = null;

    for (const slot of slots) {
      const key = `${slot.day}_${slot.hour}`;
      if (used.has(key)) continue;

      const isPriorityTask = task.type === "weak-focus" || task.type === "mock-test";
      if (isPriorityTask && !slot.inProductive) continue;

      if (task.type === "spaced-review" && task.topic) {
        const previousDay = topicLastDay.get(task.topic);
        if (previousDay !== undefined) {
          const diff = Math.abs(previousDay - slot.dayIndex);
          if (diff < 2) continue;
        }
      }

      selected = slot;
      break;
    }

    if (!selected) {
      selected = slots.find((slot) => !used.has(`${slot.day}_${slot.hour}`)) || null;
    }

    if (!selected) return;

    used.add(`${selected.day}_${selected.hour}`);
    if (task.topic) {
      topicLastDay.set(task.topic, selected.dayIndex);
    }

    assignments.push({
      taskIndex: task.taskIndex,
      day: selected.day,
      hour: selected.hour,
      source: "ai"
    });
  });

  return assignments;
}

function buildExistingSessionsContext(existingTasks, existingSlots) {
  const slotByTaskId = new Map();
  (existingSlots || []).forEach((slot) => {
    if (!slot?.taskId) return;
    slotByTaskId.set(slot.taskId, { day: slot.day, hour: slot.hour });
  });

  return (existingTasks || [])
    .filter((task) => {
      const source = String(task?.source || "manual").toLowerCase();
      const type = String(task?.type || "").toLowerCase();
      if (source === "ai" || source === "school" || type === "school-block") return false;
      return true;
    })
    .map((task) => ({
      id: task.id,
      title: String(task.title || "").trim(),
      topic: String(task.topic || "").trim(),
      subject: String(task.subject || "").trim(),
      type: String(task.type || "").trim(),
      priority: Number(task.priority || 0),
      estimatedMinutes: Number(task.estimatedMinutes || 60),
      status: String(task.status || "planned"),
      source: String(task.source || "manual"),
      assignedSlot: slotByTaskId.get(task.id) || null
    }))
    .filter((task) => task.title || task.topic || task.subject)
    .sort((a, b) => {
      if (a.source !== b.source) return a.source === "manual" ? -1 : 1;
      return b.priority - a.priority;
    });
}

function buildExistingTimetableSummary(tasks, slots) {
  const taskById = new Map((tasks || []).map((task) => [task.id, task]));
  const assigned = (slots || []).filter((slot) => slot.taskId);
  const assignedStudyOnly = assigned.filter((slot) => {
    const task = taskById.get(slot.taskId);
    if (!task) return false;
    const source = String(task.source || "").toLowerCase();
    const type = String(task.type || "").toLowerCase();
    return source !== "school" && type !== "school-block";
  });
  const schoolSlots = assigned.length - assignedStudyOnly.length;
  const subjectHours = {};

  assignedStudyOnly.forEach((slot) => {
    const task = taskById.get(slot.taskId);
    if (!task) return;
    const subject = String(task.subject || "Study");
    subjectHours[subject] = Number(subjectHours[subject] || 0) + 1;
  });

  const occupiedSlots = assignedStudyOnly.length;
  const occupiedByDay = {};
  assignedStudyOnly.forEach((slot) => {
    occupiedByDay[slot.day] = Number(occupiedByDay[slot.day] || 0) + 1;
  });

  return {
    occupiedSlots,
    occupiedByDay,
    subjectHours,
    schoolSlots
  };
}

function buildSeedTopicLastDay(existingTasks, existingSlots) {
  const map = {};
  const taskById = new Map((existingTasks || []).map((task) => [task.id, task]));

  (existingSlots || []).forEach((slot) => {
    if (!slot.taskId) return;
    const task = taskById.get(slot.taskId);
    if (!task?.topic) return;
    const idx = DAYS.indexOf(slot.day);
    if (idx < 0) return;
    const key = String(task.topic);
    map[key] = Math.max(Number(map[key] ?? -1), idx);
  });

  return map;
}

function buildFallbackNotes(profile, weakConcepts, forgettingRiskTopics, existingSummary = null) {
  const notes = [];
  const weak = normalizeTopicList(weakConcepts);
  const risk = normalizeTopicList(forgettingRiskTopics);
  const days = nearestExamDays(profile.examDates);

  if (days !== null) {
    notes.push(`Nearest exam is in ${days} day(s), so mock-test blocks were included.`);
  }
  if (weak.length) {
    notes.push(`Weak concepts prioritized first: ${weak.slice(0, 3).join(", ")}.`);
  }
  if (risk.length) {
    notes.push(`Spaced review added for forgetting-risk topics: ${risk.slice(0, 3).join(", ")}.`);
  }
  if (existingSummary && typeof existingSummary.occupiedSlots === "number") {
    notes.push(`Analyzed your existing timetable: ${existingSummary.occupiedSlots} slot(s) already occupied this week.`);
  }

  notes.push("High-priority sessions were placed in productive time windows where possible.");
  return notes;
}

function mapTaskRow(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    weekStart: row.week_start,
    title: row.title,
    subject: row.subject,
    topic: row.topic,
    type: row.type,
    priority: Number(row.priority || 0),
    estimatedMinutes: Number(row.estimated_minutes || 60),
    status: row.status || "planned",
    source: row.source || "manual",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null
  };
}

function mapSlotRow(row) {
  return {
    studentId: row.student_id,
    weekStart: row.week_start,
    day: row.day,
    hour: row.hour,
    taskId: row.task_id || null,
    source: row.source || "manual",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function computeStats(tasks, slots, profile) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const assignedSlots = slots.filter((slot) => {
    if (!slot.taskId) return false;
    const task = taskById.get(slot.taskId);
    if (!task) return false;
    if (String(task.source || "").toLowerCase() === "school") return false;
    if (String(task.type || "").toLowerCase() === "school-block") return false;
    return true;
  });
  const completedSlots = assignedSlots.filter((slot) => taskById.get(slot.taskId)?.status === "completed").length;
  const completionPercent = assignedSlots.length ? Math.round((completedSlots * 100) / assignedSlots.length) : 0;

  const completedMinutes = assignedSlots.reduce((sum, slot) => {
    const task = taskById.get(slot.taskId);
    if (!task || task.status !== "completed") return sum;
    return sum + Number(task.estimatedMinutes || 60);
  }, 0);

  const completedHours = Number((completedMinutes / 60).toFixed(1));
  const weeklyGoalHours = Number(profile.weeklyGoalsHours || 14);
  const remainingHours = Number(Math.max(weeklyGoalHours - completedHours, 0).toFixed(1));

  return {
    assignedSlots: assignedSlots.length,
    completedSlots,
    completionPercent,
    completedHours,
    weeklyGoalHours,
    remainingHours,
    daysToNearestExam: nearestExamDays(profile.examDates)
  };
}

function buildAgenda(weekStart, tasks, slots) {
  const todayWeekStart = getWeekStart(new Date());
  const dayIndex = new Date().getDay();
  const todayDay = dayIndex === 0 ? "MON" : DAYS[Math.max(0, dayIndex - 1)] || "MON";
  const targetDay = weekStart === todayWeekStart ? todayDay : "MON";
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  return slots
    .filter((slot) => slot.day === targetDay && slot.taskId)
    .sort((a, b) => hourToInt(a.hour) - hourToInt(b.hour))
    .map((slot) => ({
      day: slot.day,
      hour: slot.hour,
      task: taskById.get(slot.taskId) || null
    }))
    .filter((entry) => {
      if (!entry.task) return false;
      const source = String(entry.task.source || "").toLowerCase();
      const type = String(entry.task.type || "").toLowerCase();
      return source !== "school" && type !== "school-block";
    });
}

async function ensureSchema(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS timetable_profiles (
      student_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'productive_hours',
      school_blocks_json TEXT NOT NULL DEFAULT '[]',
      productive_hours_json TEXT NOT NULL DEFAULT '[]',
      exam_dates_json TEXT NOT NULL DEFAULT '[]',
      weekly_goal_hours INTEGER NOT NULL DEFAULT 14,
      configured INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS timetable_tasks (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      title TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT 'Study',
      topic TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'study',
      priority INTEGER NOT NULL DEFAULT 60,
      estimated_minutes INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'planned',
      source TEXT NOT NULL DEFAULT 'manual',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )`
  );

  await run(db, `CREATE INDEX IF NOT EXISTS idx_timetable_tasks_student_week ON timetable_tasks(student_id, week_start)`);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS timetable_slots (
      student_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      day TEXT NOT NULL,
      hour TEXT NOT NULL,
      task_id TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (student_id, week_start, day, hour),
      FOREIGN KEY(task_id) REFERENCES timetable_tasks(id) ON DELETE SET NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS timetable_plan_meta (
      student_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'heuristic',
      notes_json TEXT NOT NULL DEFAULT '[]',
      generated_at TEXT NOT NULL,
      PRIMARY KEY (student_id, week_start)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS timetable_school_week_blocks (
      student_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      blocks_json TEXT NOT NULL DEFAULT '[]',
      source_type TEXT NOT NULL DEFAULT 'ics',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (student_id, week_start)
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS timetable_subject_importance (
      student_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      subject TEXT NOT NULL,
      weekly_minutes INTEGER NOT NULL DEFAULT 0,
      block_count INTEGER NOT NULL DEFAULT 0,
      importance_ratio REAL NOT NULL DEFAULT 0,
      importance_score INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (student_id, week_start, subject)
    )`
  );

  await run(
    db,
    `CREATE INDEX IF NOT EXISTS idx_timetable_subject_importance_student_week ON timetable_subject_importance(student_id, week_start)`
  );
}

async function getProfile(db, studentId) {
  const row = await get(db, `SELECT * FROM timetable_profiles WHERE student_id = ?`, [studentId]);
  if (!row) {
    return { ...DEFAULT_PROFILE };
  }

  return {
    mode: row.mode || DEFAULT_PROFILE.mode,
    schoolBlocks: safeJsonParse(row.school_blocks_json, []),
    productiveHours: safeJsonParse(row.productive_hours_json, []),
    examDates: safeJsonParse(row.exam_dates_json, []),
    weeklyGoalsHours: Number(row.weekly_goal_hours || 14),
    configured: Boolean(Number(row.configured || 0))
  };
}

async function saveProfile(db, studentId, input) {
  const existing = await getProfile(db, studentId);
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(input || {}, key);

  const mode = input.mode === "school_blocks"
    ? "school_blocks"
    : input.mode === "productive_hours"
      ? "productive_hours"
      : (existing.mode || "productive_hours");

  const schoolBlocks = (hasOwn("schoolBlocks") || hasOwn("schoolBlocksText"))
    ? parseSchoolBlocksInput(input.schoolBlocks, input.schoolBlocksText)
    : (existing.schoolBlocks || []);

  const productiveHours = (hasOwn("productiveHours") || hasOwn("productiveHoursText"))
    ? parseHourRangesInput(input.productiveHours, input.productiveHoursText)
    : (existing.productiveHours || []);

  const examDates = (hasOwn("examDates") || hasOwn("examDatesText"))
    ? parseExamDates(input.examDates, input.examDatesText)
    : (existing.examDates || []);

  const weeklyGoalsHours = hasOwn("weeklyGoalsHours")
    ? clampInt(input.weeklyGoalsHours, 1, 60, 14)
    : clampInt(existing.weeklyGoalsHours, 1, 60, 14);

  const configured = Boolean(schoolBlocks.length || productiveHours.length || examDates.length || weeklyGoalsHours);

  await run(
    db,
    `INSERT INTO timetable_profiles (
      student_id, mode, school_blocks_json, productive_hours_json, exam_dates_json, weekly_goal_hours, configured, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id) DO UPDATE SET
      mode = excluded.mode,
      school_blocks_json = excluded.school_blocks_json,
      productive_hours_json = excluded.productive_hours_json,
      exam_dates_json = excluded.exam_dates_json,
      weekly_goal_hours = excluded.weekly_goal_hours,
      configured = excluded.configured,
      updated_at = excluded.updated_at`,
    [
      studentId,
      mode,
      JSON.stringify(schoolBlocks),
      JSON.stringify(productiveHours),
      JSON.stringify(examDates),
      weeklyGoalsHours,
      configured ? 1 : 0,
      nowIso()
    ]
  );

  return {
    mode,
    schoolBlocks,
    productiveHours,
    examDates,
    weeklyGoalsHours,
    configured
  };
}

async function fetchWeekState(db, studentId, weekStart) {
  const profile = await getProfile(db, studentId);
  const schoolBlocksForWeek = await resolveSchoolBlocksForWeek(db, studentId, weekStart, profile);
  const profileForWeek = {
    ...profile,
    schoolBlocks: schoolBlocksForWeek
  };
  await syncSchoolTimetableForWeek(db, studentId, weekStart, profileForWeek, schoolBlocksForWeek);
  await saveSubjectImportanceForWeek(db, studentId, weekStart, schoolBlocksForWeek);
  const taskRows = await all(
    db,
    `SELECT * FROM timetable_tasks WHERE student_id = ? AND week_start = ? ORDER BY priority DESC, created_at ASC`,
    [studentId, weekStart]
  );
  const slotRows = await all(
    db,
    `SELECT * FROM timetable_slots WHERE student_id = ? AND week_start = ? ORDER BY day, hour`,
    [studentId, weekStart]
  );
  const planMeta = await get(
    db,
    `SELECT provider, notes_json, generated_at FROM timetable_plan_meta WHERE student_id = ? AND week_start = ?`,
    [studentId, weekStart]
  );

  const tasks = taskRows.map(mapTaskRow);
  const slots = slotRows.map(mapSlotRow);
  const stats = computeStats(tasks, slots, profileForWeek);
  const agenda = buildAgenda(weekStart, tasks, slots);
  const subjectImportance = await loadSubjectImportanceForWeek(db, studentId, weekStart);

  return {
    studentId,
    weekStart,
    profile: profileForWeek,
    subjectImportance,
    tasks,
    slots,
    stats,
    agenda,
    notes: safeJsonParse(planMeta?.notes_json || "[]", []),
    planProvider: planMeta?.provider || "none",
    planGeneratedAt: planMeta?.generated_at || null
  };
}

async function replaceWeekWithPlan(db, studentId, weekStart, plan) {
  const now = nowIso();

  await run(db, "BEGIN TRANSACTION");
  try {
    await run(db, `DELETE FROM timetable_slots WHERE student_id = ? AND week_start = ?`, [studentId, weekStart]);
    await run(db, `DELETE FROM timetable_tasks WHERE student_id = ? AND week_start = ?`, [studentId, weekStart]);

    const taskIds = [];
    for (let index = 0; index < plan.tasks.length; index += 1) {
      const task = normalizeGeneratedTask(plan.tasks[index], plan.tasks[index]);
      const id = createId("task");
      taskIds[index] = id;

      await run(
        db,
        `INSERT INTO timetable_tasks (
          id, student_id, week_start, title, subject, topic, type, priority, estimated_minutes, status, source, notes, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          id,
          studentId,
          weekStart,
          task.title,
          task.subject,
          task.topic,
          task.type,
          task.priority,
          task.estimatedMinutes,
          "planned",
          "ai",
          "",
          now,
          now
        ]
      );
    }

    for (const assignment of plan.assignments) {
      const day = normalizeDay(assignment.day);
      const hour = normalizeHour(assignment.hour);
      const taskId = taskIds[Number(assignment.taskIndex)];
      if (!taskId) continue;

      await run(
        db,
        `INSERT INTO timetable_slots (
          student_id, week_start, day, hour, task_id, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, week_start, day, hour) DO UPDATE SET
          task_id = excluded.task_id,
          source = excluded.source,
          updated_at = excluded.updated_at`,
        [studentId, weekStart, day, hour, taskId, assignment.source || "ai", now, now]
      );
    }

    await run(
      db,
      `INSERT INTO timetable_plan_meta (student_id, week_start, provider, notes_json, generated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(student_id, week_start) DO UPDATE SET
         provider = excluded.provider,
         notes_json = excluded.notes_json,
         generated_at = excluded.generated_at`,
      [studentId, weekStart, plan.provider || "heuristic", JSON.stringify(plan.notes || []), now]
    );

    await run(db, "COMMIT");
  } catch (error) {
    await run(db, "ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function mergeWeekWithPlanPreservingManual(db, studentId, weekStart, plan) {
  const now = nowIso();

  await run(db, "BEGIN TRANSACTION");
  try {
    await run(
      db,
      `DELETE FROM timetable_slots
       WHERE student_id = ? AND week_start = ? AND source = 'ai'`,
      [studentId, weekStart]
    );
    await run(
      db,
      `DELETE FROM timetable_tasks
       WHERE student_id = ? AND week_start = ? AND source = 'ai'`,
      [studentId, weekStart]
    );

    const taskIds = [];
    for (let index = 0; index < plan.tasks.length; index += 1) {
      const task = normalizeGeneratedTask(plan.tasks[index], plan.tasks[index]);
      const id = createId("task");
      taskIds[index] = id;

      await run(
        db,
        `INSERT INTO timetable_tasks (
          id, student_id, week_start, title, subject, topic, type, priority, estimated_minutes, status, source, notes, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          id,
          studentId,
          weekStart,
          task.title,
          task.subject,
          task.topic,
          task.type,
          task.priority,
          task.estimatedMinutes,
          "planned",
          "ai",
          "",
          now,
          now
        ]
      );
    }

    for (const assignment of plan.assignments || []) {
      const day = normalizeDay(assignment.day);
      const hour = normalizeHour(assignment.hour);
      const taskId = taskIds[Number(assignment.taskIndex)];
      if (!taskId) continue;

      const occupied = await get(
        db,
        `SELECT task_id FROM timetable_slots
         WHERE student_id = ? AND week_start = ? AND day = ? AND hour = ?`,
        [studentId, weekStart, day, hour]
      );
      if (occupied?.task_id) continue;

      await run(
        db,
        `INSERT INTO timetable_slots (
          student_id, week_start, day, hour, task_id, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, week_start, day, hour) DO UPDATE SET
          task_id = excluded.task_id,
          source = excluded.source,
          updated_at = excluded.updated_at`,
        [studentId, weekStart, day, hour, taskId, "ai", now, now]
      );
    }

    await run(
      db,
      `INSERT INTO timetable_plan_meta (student_id, week_start, provider, notes_json, generated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(student_id, week_start) DO UPDATE SET
         provider = excluded.provider,
         notes_json = excluded.notes_json,
         generated_at = excluded.generated_at`,
      [studentId, weekStart, plan.provider || "heuristic", JSON.stringify(plan.notes || []), now]
    );

    await run(db, "COMMIT");
  } catch (error) {
    await run(db, "ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function generatePlanPayload({
  callOpenAIChat,
  safeParseJson,
  isOpenAIConfigured,
  profile,
  weakConcepts,
  forgettingRiskTopics,
  existingTasks = [],
  existingSlots = [],
  replaceExisting = false
}) {
  const weeklyGoalHours = clampInt(profile.weeklyGoalsHours, 1, 60, 14);
  const taskById = new Map((existingTasks || []).map((task) => [task.id, task]));
  const occupiedSlots = replaceExisting
    ? 0
    : (existingSlots || []).filter((slot) => {
      if (!slot.taskId) return false;
      const task = taskById.get(slot.taskId);
      if (!task) return false;
      const source = String(task.source || "").toLowerCase();
      const type = String(task.type || "").toLowerCase();
      return source !== "school" && type !== "school-block";
    }).length;
  const availableBlockCount = Math.max(1, weeklyGoalHours - occupiedSlots);
  const existingSummary = buildExistingTimetableSummary(existingTasks, existingSlots);
  const existingSessions = buildExistingSessionsContext(existingTasks, existingSlots);
  const existingTaskSignals = extractExistingTaskSignals(existingTasks);
  const schoolSignals = extractSchoolSubjectSignals(profile);

  const inputWeak = normalizeTopicList(weakConcepts);
  const inputRisk = normalizeTopicList(forgettingRiskTopics);

  // Prioritize the student's current manual timetable sessions first.
  // If school timetable exists, use its subjects before global weak-topic noise.
  const effectiveWeak = mergeUniqueConcepts(existingTaskSignals.concepts, schoolSignals, inputWeak).slice(0, 4);
  const weakKeys = new Set(effectiveWeak.map((item) => String(item || "").toLowerCase()));
  const signalRisk = mergeUniqueConcepts(existingTaskSignals.concepts, schoolSignals)
    .filter((concept) => !weakKeys.has(String(concept || "").toLowerCase()));
  const effectiveRisk = mergeUniqueConcepts(signalRisk, inputRisk)
    .filter((concept) => !weakKeys.has(String(concept || "").toLowerCase()))
    .slice(0, 4);

  let baselineTasks = buildHeuristicTasks(profile, effectiveWeak, effectiveRisk).slice(0, availableBlockCount);
  baselineTasks = baselineTasks.map((task) => {
    if (String(task.subject || "").toLowerCase() !== "study") return task;
    const mapped = getMappedSubjectForConcept(existingTaskSignals, task.topic || task.title || "");
    if (!mapped) return task;
    return { ...task, subject: mapped };
  });
  const ai = await refineTasksWithOpenAI({
    callOpenAIChat,
    safeParseJson,
    isOpenAIConfigured,
    profile,
    weakConcepts: effectiveWeak,
    forgettingRiskTopics: effectiveRisk,
    existingTaskSignals,
    existingSessions,
    baselineTasks,
    existingSummary,
    availableBlockCount
  });

  const aiTasks = (Array.isArray(ai.tasks) && ai.tasks.length ? ai.tasks : baselineTasks).slice(0, availableBlockCount);
  let tasks = topUpTasksToTarget(aiTasks, baselineTasks, availableBlockCount);
  tasks = injectExistingCoverageTasks(tasks, existingTaskSignals, availableBlockCount);
  tasks = topUpTasksToTarget(tasks, baselineTasks, availableBlockCount);

  const blockedSlots = replaceExisting
    ? []
    : (existingSlots || []).filter((slot) => slot.taskId).map((slot) => `${slot.day}_${slot.hour}`);
  const assignments = scheduleTasks(tasks, profile, {
    blockedSlots,
    seedTopicLastDay: buildSeedTopicLastDay(existingTasks, existingSlots)
  });
  const notes = ai.notes?.length
    ? ai.notes
    : buildFallbackNotes(profile, effectiveWeak, effectiveRisk, existingSummary);
  if (existingTaskSignals.concepts.length) {
    notes.unshift(`Included continuation blocks for your existing sessions: ${existingTaskSignals.concepts.slice(0, 3).join(", ")}.`);
  }
  if (!existingTaskSignals.concepts.length && schoolSignals.length) {
    notes.unshift(`Derived study focus from your school timetable subjects: ${schoolSignals.slice(0, 3).join(", ")}.`);
  }
  if (existingSessions.length) {
    notes.unshift(`Used ${existingSessions.length} existing session(s) as AI context (title/topic/subject).`);
  }
  notes.unshift(`AI analyzed your current timetable and generated ${tasks.length} additional study block(s).`);
  const provider = ai.provider || "heuristic";

  return { tasks, assignments, notes, provider };
}

function handleRouteError(res, label, error) {
  console.error(label, error?.message || error);
  res.status(500).json({ error: label, details: error?.message || "Unknown error" });
}

function toTaskPayload(body) {
  return {
    title: String(body.title || "").trim(),
    subject: String(body.subject || "Study").trim() || "Study",
    topic: String(body.topic || "").trim(),
    type: String(body.type || "study").trim() || "study",
    priority: clampInt(body.priority, 1, 100, 60),
    estimatedMinutes: clampInt(body.estimatedMinutes, 15, 240, 60),
    notes: String(body.notes || "").trim(),
    source: String(body.source || "manual").trim() || "manual"
  };
}

function validateStatus(status) {
  return status === "completed" ? "completed" : "planned";
}

function parseWeekFromRequest(req) {
  return normalizeWeekStart(req.body?.weekStart || req.query?.weekStart || req.params?.weekStart);
}

function registerTimeManagementRoutes(app, deps) {
  const db = createDatabase();
  const schemaReady = ensureSchema(db);

  const {
    callOpenAIChat,
    safeParseJson,
    isOpenAIConfigured,
    normalizeStudentId,
    requireFirebaseAuth,
    resolveAuthorizedStudentId,
    upload,
    pdfParse,
    mammoth
  } = deps;
  const authGuard = typeof requireFirebaseAuth === "function" ? requireFirebaseAuth : (_req, _res, next) => next();
  const getStudentId = (req) => {
    if (typeof resolveAuthorizedStudentId === "function") {
      return resolveAuthorizedStudentId(req, req.params.studentId);
    }
    return normalizeStudentId(req.params.studentId);
  };
  const schoolUploadMiddleware = upload?.single
    ? upload.single("timetable")
    : (_req, res) => res.status(503).json({ error: "File upload unavailable on server." });

  const saveProfileHandler = async (req, res) => {
    try {
      await schemaReady;
      const studentId = getStudentId(req);
      const profile = await saveProfile(db, studentId, req.body || {});
      const raw = req.body || {};
      const hasSchoolBlocksInput = Object.prototype.hasOwnProperty.call(raw, "schoolBlocks")
        || Object.prototype.hasOwnProperty.call(raw, "schoolBlocksText");
      if (hasSchoolBlocksInput) {
        const weekStart = normalizeWeekStart(raw.weekStart || req.query?.weekStart);
        await saveSubjectImportanceForWeek(db, studentId, weekStart, profile.schoolBlocks || []);
      }
      res.json({ ok: true, studentId, profile, updatedAt: nowIso() });
    } catch (error) {
      handleRouteError(res, "Failed to save time management profile", error);
    }
  };

  app.get("/api/time-management/:studentId", authGuard, async (req, res) => {
    try {
      await schemaReady;
      const studentId = getStudentId(req);
      const weekStart = normalizeWeekStart(req.query.weekStart);
      const state = await fetchWeekState(db, studentId, weekStart);
      res.json(state);
    } catch (error) {
      handleRouteError(res, "Failed to load time management state", error);
    }
  });

  app.put("/api/time-management/:studentId/profile", authGuard, saveProfileHandler);
  app.post("/api/time-management/:studentId/profile", authGuard, saveProfileHandler);

  app.post("/api/time-management/:studentId/upload-school-timetable", authGuard, schoolUploadMiddleware, async (req, res) => {
    try {
      await schemaReady;
      const studentId = getStudentId(req);
      const weekStart = normalizeWeekStart(req.body?.weekStart || req.query?.weekStart);
      const preferredTimeZone = normalizeIanaTimezone(req.body?.browserTimeZone || req.query?.browserTimeZone || "");
      const file = req.file;
      const calendarUrl = String(req.body?.calendarUrl || "").trim();
      if (!file && !calendarUrl) {
        return res.status(400).json({ error: "Upload a timetable file or provide a calendar URL." });
      }

      const parsed = file
        ? await extractSchoolBlocksFromUpload(file, {
          pdfParse,
          mammoth,
          callOpenAIChat,
          safeParseJson,
          isOpenAIConfigured,
          preferredTimeZone
        })
        : await extractSchoolBlocksFromCalendarUrl(calendarUrl, {
          callOpenAIChat,
          safeParseJson,
          isOpenAIConfigured,
          preferredTimeZone
        });
      if (!parsed.blocks.length) {
        return res.status(400).json({ error: "No timetable blocks detected from the uploaded file/calendar URL." });
      }

      const weeklyBlocks = parsed.weeklyBlocks && typeof parsed.weeklyBlocks === "object" ? parsed.weeklyBlocks : {};
      const hasWeeklyBlocks = Object.keys(weeklyBlocks).length > 0;
      const selectedWeekBlocks = dedupeSchoolBlocks(
        hasWeeklyBlocks ? (weeklyBlocks[weekStart] || []) : (parsed.blocks || [])
      );
      const totalWeeksImported = Object.keys(weeklyBlocks).length;

      const profile = await saveProfile(db, studentId, {
        mode: "school_blocks",
        schoolBlocks: selectedWeekBlocks,
        examDatesText: req.body?.examDatesText || "",
        weeklyGoalsHours: req.body?.weeklyGoalsHours
      });

      await saveSchoolWeekBlocks(db, studentId, weeklyBlocks, parsed.fileType || "ics");
      await saveSubjectImportanceForWeeks(
        db,
        studentId,
        hasWeeklyBlocks ? weeklyBlocks : { [weekStart]: selectedWeekBlocks }
      );
      await syncSchoolTimetableForWeek(db, studentId, weekStart, profile, selectedWeekBlocks);
      const state = await fetchWeekState(db, studentId, weekStart);
      return res.json({
        ok: true,
        studentId,
        uploadedType: parsed.fileType,
        parseProvider: parsed.provider || "ai",
        calendarUrl: parsed.calendarUrl || null,
        importedBlocks: parsed.blocks.length,
        importedWeeks: totalWeeksImported,
        state
      });
    } catch (error) {
      handleRouteError(res, "Failed to upload school timetable", error);
    }
  });

  app.post("/api/time-management/:studentId/generate-plan", authGuard, async (req, res) => {
    try {
      await schemaReady;
      const studentId = getStudentId(req);
      const weekStart = parseWeekFromRequest(req);
      const profile = await getProfile(db, studentId);
      const payload = req.body || {};
      const replaceExisting = Boolean(payload.replaceExisting);
      const weakConcepts = normalizeTopicList(payload.weakConcepts);
      const forgettingRiskTopics = normalizeTopicList(payload.forgettingRiskTopics);
      const currentState = await fetchWeekState(db, studentId, weekStart);
      const planningProfile = {
        ...profile,
        schoolBlocks: currentState?.profile?.schoolBlocks || profile.schoolBlocks || []
      };
      const preservedSlots = replaceExisting
        ? []
        : (currentState.slots || []).filter((slot) => String(slot.source || "").toLowerCase() !== "ai");
      const preservedTaskIds = new Set(preservedSlots.map((slot) => slot.taskId).filter(Boolean));
      const preservedTasks = replaceExisting
        ? []
        : (currentState.tasks || []).filter((task) =>
          String(task.source || "").toLowerCase() !== "ai" || preservedTaskIds.has(task.id)
        );

      const plan = await generatePlanPayload({
        callOpenAIChat,
        safeParseJson,
        isOpenAIConfigured,
        profile: planningProfile,
        weakConcepts,
        forgettingRiskTopics,
        existingTasks: preservedTasks,
        existingSlots: preservedSlots,
        replaceExisting
      });

      if (replaceExisting) {
        await replaceWeekWithPlan(db, studentId, weekStart, plan);
      } else {
        await mergeWeekWithPlanPreservingManual(db, studentId, weekStart, plan);
      }
      const state = await fetchWeekState(db, studentId, weekStart);
      res.json(state);
    } catch (error) {
      handleRouteError(res, "Failed to generate timetable plan", error);
    }
  });

  app.post("/api/time-management/:studentId/tasks", authGuard, async (req, res) => {
    try {
      await schemaReady;
      const studentId = getStudentId(req);
      const weekStart = parseWeekFromRequest(req);
      const payload = toTaskPayload(req.body || {});
      const rawDay = String(req.body?.day || "").trim();
      const rawHour = String(req.body?.hour || "").trim();
      const hasDay = Boolean(rawDay);
      const hasHour = Boolean(rawHour);

      if (!payload.title) {
        return res.status(400).json({ error: "title is required" });
      }
      if ((hasDay && !hasHour) || (!hasDay && hasHour)) {
        return res.status(400).json({ error: "day and hour must be provided together" });
      }

      const id = createId("task");
      const now = nowIso();

      await run(
        db,
        `INSERT INTO timetable_tasks (
          id, student_id, week_start, title, subject, topic, type, priority, estimated_minutes, status, source, notes, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          id,
          studentId,
          weekStart,
          payload.title,
          payload.subject,
          payload.topic,
          payload.type,
          payload.priority,
          payload.estimatedMinutes,
          "planned",
          payload.source,
          payload.notes,
          now,
          now
        ]
      );

      if (hasDay && hasHour) {
        const day = normalizeDay(rawDay);
        const hour = normalizeHour(rawHour);
        const occupied = await get(
          db,
          `SELECT task_id FROM timetable_slots
           WHERE student_id = ? AND week_start = ? AND day = ? AND hour = ?`,
          [studentId, weekStart, day, hour]
        );
        if (occupied?.task_id) {
          await run(db, `DELETE FROM timetable_tasks WHERE id = ? AND student_id = ?`, [id, studentId]);
          return res.status(409).json({ error: "Selected slot is already occupied." });
        }

        await run(
          db,
          `INSERT INTO timetable_slots (
            student_id, week_start, day, hour, task_id, source, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [studentId, weekStart, day, hour, id, "manual", now, now]
        );
      }

      const row = await get(db, `SELECT * FROM timetable_tasks WHERE id = ?`, [id]);
      res.status(201).json({ ok: true, task: mapTaskRow(row) });
    } catch (error) {
      handleRouteError(res, "Failed to create timetable task", error);
    }
  });

  app.put("/api/time-management/:studentId/tasks/:taskId", authGuard, async (req, res) => {
    try {
      await schemaReady;
      const studentId = getStudentId(req);
      const taskId = String(req.params.taskId || "").trim();
      if (!taskId) {
        return res.status(400).json({ error: "taskId is required" });
      }

      const existing = await get(db, `SELECT * FROM timetable_tasks WHERE id = ? AND student_id = ?`, [taskId, studentId]);
      if (!existing) {
        return res.status(404).json({ error: "Task not found" });
      }

      const body = req.body || {};
      const updates = [];
      const params = [];
      let slotInstruction = null;

      if (body.title !== undefined) {
        const title = String(body.title || "").trim();
        if (!title) return res.status(400).json({ error: "title cannot be empty" });
        updates.push("title = ?");
        params.push(title);
      }

      if (body.subject !== undefined) {
        updates.push("subject = ?");
        params.push(String(body.subject || "Study").trim() || "Study");
      }

      if (body.topic !== undefined) {
        updates.push("topic = ?");
        params.push(String(body.topic || "").trim());
      }

      if (body.type !== undefined) {
        updates.push("type = ?");
        params.push(String(body.type || "study").trim() || "study");
      }

      if (body.priority !== undefined) {
        updates.push("priority = ?");
        params.push(clampInt(body.priority, 1, 100, 60));
      }

      if (body.estimatedMinutes !== undefined) {
        updates.push("estimated_minutes = ?");
        params.push(clampInt(body.estimatedMinutes, 15, 240, 60));
      }

      if (body.notes !== undefined) {
        updates.push("notes = ?");
        params.push(String(body.notes || "").trim());
      }

      if (body.day !== undefined || body.hour !== undefined) {
        const rawDay = String(body.day || "").trim();
        const rawHour = String(body.hour || "").trim();
        const hasDay = Boolean(rawDay);
        const hasHour = Boolean(rawHour);
        if ((hasDay && !hasHour) || (!hasDay && hasHour)) {
          return res.status(400).json({ error: "day and hour must be provided together" });
        }
        if (!hasDay && !hasHour) {
          slotInstruction = { type: "clear" };
        } else {
          slotInstruction = { type: "assign", day: normalizeDay(rawDay), hour: normalizeHour(rawHour) };
        }
      }

      if (body.status !== undefined) {
        const status = validateStatus(body.status);
        updates.push("status = ?");
        params.push(status);
        updates.push("completed_at = ?");
        params.push(status === "completed" ? nowIso() : null);
      }

      if (!updates.length && !slotInstruction) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const now = nowIso();
      await run(db, "BEGIN TRANSACTION");
      try {
        if (updates.length) {
          updates.push("updated_at = ?");
          params.push(now);
          params.push(taskId, studentId);
          await run(db, `UPDATE timetable_tasks SET ${updates.join(", ")} WHERE id = ? AND student_id = ?`, params);
        }

        if (slotInstruction?.type === "clear") {
          await run(
            db,
            `DELETE FROM timetable_slots
             WHERE student_id = ? AND week_start = ? AND task_id = ?`,
            [studentId, existing.week_start, taskId]
          );
        }

        if (slotInstruction?.type === "assign") {
          const occupied = await get(
            db,
            `SELECT task_id FROM timetable_slots
             WHERE student_id = ? AND week_start = ? AND day = ? AND hour = ?`,
            [studentId, existing.week_start, slotInstruction.day, slotInstruction.hour]
          );
          if (occupied?.task_id && occupied.task_id !== taskId) {
            await run(db, "ROLLBACK").catch(() => undefined);
            return res.status(409).json({ error: "Selected slot is already occupied." });
          }

          await run(
            db,
            `DELETE FROM timetable_slots
             WHERE student_id = ? AND week_start = ? AND task_id = ?`,
            [studentId, existing.week_start, taskId]
          );

          await run(
            db,
            `INSERT INTO timetable_slots (
              student_id, week_start, day, hour, task_id, source, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, week_start, day, hour) DO UPDATE SET
              task_id = excluded.task_id,
              source = excluded.source,
              updated_at = excluded.updated_at`,
            [studentId, existing.week_start, slotInstruction.day, slotInstruction.hour, taskId, "manual", now, now]
          );
        }

        await run(db, "COMMIT");
      } catch (error) {
        await run(db, "ROLLBACK").catch(() => undefined);
        throw error;
      }

      const row = await get(db, `SELECT * FROM timetable_tasks WHERE id = ? AND student_id = ?`, [taskId, studentId]);
      res.json({ ok: true, task: mapTaskRow(row) });
    } catch (error) {
      handleRouteError(res, "Failed to update timetable task", error);
    }
  });

  app.delete("/api/time-management/:studentId/tasks/:taskId", authGuard, async (req, res) => {
    try {
      await schemaReady;
      const studentId = getStudentId(req);
      const taskId = String(req.params.taskId || "").trim();

      await run(db, `DELETE FROM timetable_slots WHERE student_id = ? AND task_id = ?`, [studentId, taskId]);
      const result = await run(db, `DELETE FROM timetable_tasks WHERE id = ? AND student_id = ?`, [taskId, studentId]);
      if (!result.changes) {
        return res.status(404).json({ error: "Task not found" });
      }

      res.json({ ok: true, deletedTaskId: taskId });
    } catch (error) {
      handleRouteError(res, "Failed to delete timetable task", error);
    }
  });

  app.put("/api/time-management/:studentId/slots/:day/:hour", authGuard, async (req, res) => {
    try {
      await schemaReady;
      const studentId = getStudentId(req);
      const weekStart = parseWeekFromRequest(req);
      const day = normalizeDay(req.params.day);
      const hour = normalizeHour(req.params.hour);
      const taskId = req.body?.taskId ? String(req.body.taskId).trim() : "";

      if (!taskId) {
        await run(
          db,
          `DELETE FROM timetable_slots WHERE student_id = ? AND week_start = ? AND day = ? AND hour = ?`,
          [studentId, weekStart, day, hour]
        );
        return res.json({ ok: true, cleared: true, studentId, weekStart, day, hour });
      }

      const task = await get(
        db,
        `SELECT id FROM timetable_tasks WHERE id = ? AND student_id = ? AND week_start = ?`,
        [taskId, studentId, weekStart]
      );
      if (!task) {
        return res.status(400).json({ error: "Task does not exist for this student/week" });
      }

      const now = nowIso();
      await run(
        db,
        `INSERT INTO timetable_slots (
          student_id, week_start, day, hour, task_id, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, week_start, day, hour) DO UPDATE SET
          task_id = excluded.task_id,
          source = excluded.source,
          updated_at = excluded.updated_at`,
        [studentId, weekStart, day, hour, taskId, String(req.body?.source || "manual"), now, now]
      );

      res.json({ ok: true, studentId, weekStart, day, hour, taskId });
    } catch (error) {
      handleRouteError(res, "Failed to update timetable slot", error);
    }
  });

  app.delete("/api/time-management/:studentId/slots/:day/:hour", authGuard, async (req, res) => {
    try {
      await schemaReady;
      const studentId = getStudentId(req);
      const weekStart = normalizeWeekStart(req.query.weekStart);
      const day = normalizeDay(req.params.day);
      const hour = normalizeHour(req.params.hour);

      await run(
        db,
        `DELETE FROM timetable_slots WHERE student_id = ? AND week_start = ? AND day = ? AND hour = ?`,
        [studentId, weekStart, day, hour]
      );

      res.json({ ok: true, studentId, weekStart, day, hour });
    } catch (error) {
      handleRouteError(res, "Failed to clear timetable slot", error);
    }
  });

  app.delete("/api/time-management/:studentId/week/:weekStart", authGuard, async (req, res) => {
    try {
      await schemaReady;
      const studentId = getStudentId(req);
      const weekStart = normalizeWeekStart(req.params.weekStart);

      await run(db, "BEGIN TRANSACTION");
      try {
        await run(db, `DELETE FROM timetable_slots WHERE student_id = ? AND week_start = ?`, [studentId, weekStart]);
        await run(db, `DELETE FROM timetable_tasks WHERE student_id = ? AND week_start = ?`, [studentId, weekStart]);
        await run(db, `DELETE FROM timetable_plan_meta WHERE student_id = ? AND week_start = ?`, [studentId, weekStart]);
        await run(db, "COMMIT");
      } catch (error) {
        await run(db, "ROLLBACK").catch(() => undefined);
        throw error;
      }

      const state = await fetchWeekState(db, studentId, weekStart);
      res.json({ ok: true, ...state });
    } catch (error) {
      handleRouteError(res, "Failed to clear week timetable", error);
    }
  });
}

module.exports = { registerTimeManagementRoutes };
