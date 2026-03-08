const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_LABELS = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun"
};

const SUBJECT_FILL_CLASS = ["fill-green", "fill-purple", "fill-pink", "fill-yellow", "fill-red"];
const GROUP_ICON = {
  algorithms: "📘",
  mathematics: "📐",
  systems: "💻",
  practice: "📝",
  general: "📚"
};

const CHART_COLORS = {
  accent: "#6ee7b7",
  accent2: "#818cf8",
  accent3: "#f472b6",
  accent4: "#fbbf24",
  danger: "#f87171",
  text3: "#5a5a72",
  border: "rgba(255,255,255,0.08)"
};

const FOCUS_MODE_LABELS = {
  reading: "Active Reading",
  tutor: "AI Tutor",
  practice: "Practice Questions"
};

const STREAK_TARGET_MINUTES = 20;
const HISTORY_DAYS = 16 * 7;

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function formatDateOnly(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function getCurrentWeekStart() {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday);
  return formatDateOnly(date);
}

function getDayToken(dateInput) {
  const dt = dateInput instanceof Date ? dateInput : parseDate(dateInput);
  if (!dt) return "MON";
  const idx = dt.getDay();
  if (idx === 0) return "SUN";
  return DAY_ORDER[idx - 1] || "MON";
}

function formatMinutes(totalMinutes) {
  const mins = Math.max(0, toInt(totalMinutes));
  if (!mins) return "0m";
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function formatRelative(ts) {
  const dt = parseDate(ts);
  if (!dt) return "recent";
  const ms = Date.now() - dt.getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getMasteryFromTopic(topic) {
  return clamp(100 - Number(topic?.weakScore || 0), 0, 100);
}

function isSchoolTask(task) {
  const source = String(task?.source || "").toLowerCase();
  const type = String(task?.type || "").toLowerCase();
  return source === "school" || type === "school-block";
}

function getTaskConceptName(task) {
  return normalizeTopicName(task?.topic || task?.subject || task?.title || "");
}

function isGenericStudyLabel(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return true;
  return [
    "revision",
    "review",
    "study",
    "study session",
    "practice",
    "practice set",
    "practice paper",
    "mock test",
    "exam prep",
    "exam preparation",
    "quiz prep",
    "test prep",
    "general"
  ].includes(text);
}

function getTaskSubjectName(task) {
  const subject = normalizeTopicName(task?.subject || "");
  if (subject && !isGenericStudyLabel(subject)) return subject;

  const topic = normalizeTopicName(task?.topic || "");
  if (topic && !isGenericStudyLabel(topic)) return topic;

  return "";
}

function simplifySubjectLabel(value) {
  let label = normalizeTopicName(value);
  if (!label) return "";
  label = label.replace(/^[A-Z]{2,}\s*\d{3,5}[A-Z]?\s*-\s*/i, "");
  label = label.replace(/\s*\((?:[^()]|\([^)]*\))*\)\s*$/g, "").trim();
  label = label.replace(/&/g, " and ");
  label = label.replace(/[-/]+/g, " ");
  return label.replace(/\s+/g, " ").trim();
}

function getSubjectKey(value) {
  return simplifySubjectLabel(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSubjectTokens(value) {
  const key = getSubjectKey(value);
  return key ? key.split(" ").filter(Boolean) : [];
}

function getSubjectMatchScore(a, b) {
  const left = getSubjectKey(a);
  const right = getSubjectKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.92;

  const leftTokens = new Set(getSubjectTokens(left));
  const rightTokens = new Set(getSubjectTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });

  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function getSubjectImportanceItems(tmState) {
  return (Array.isArray(tmState?.subjectImportance) ? tmState.subjectImportance : [])
    .map((item) => ({
      ...item,
      label: simplifySubjectLabel(item?.subject || ""),
      key: getSubjectKey(item?.subject || "")
    }))
    .filter((item) => item.label && item.key)
    .sort((a, b) => {
      if (Number(b.importanceScore || 0) !== Number(a.importanceScore || 0)) {
        return Number(b.importanceScore || 0) - Number(a.importanceScore || 0);
      }
      return Number(b.weeklyMinutes || 0) - Number(a.weeklyMinutes || 0);
    });
}

function findMatchingImportanceSubject(subjectName, importanceItems) {
  let best = null;
  let bestScore = 0;

  (importanceItems || []).forEach((item) => {
    const score = getSubjectMatchScore(subjectName, item?.label || item?.subject || "");
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  });

  return bestScore >= 0.5 ? best : null;
}

function buildSyntheticTopicsFromTimetable(tmState) {
  const tasks = Array.isArray(tmState?.tasks) ? tmState.tasks : [];
  const byName = new Map();

  tasks.forEach((task) => {
    if (!task || isSchoolTask(task)) return;
    const name = getTaskConceptName(task);
    if (!name) return;
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        totalMinutes: 0,
        completedMinutes: 0,
        count: 0
      });
    }
    const bucket = byName.get(name);
    const mins = clamp(task?.estimatedMinutes || 60, 15, 240);
    bucket.totalMinutes += mins;
    bucket.count += 1;
    if (String(task?.status || "").toLowerCase() === "completed") {
      bucket.completedMinutes += mins;
    }
  });

  return [...byName.values()].map((bucket) => {
    const completionRatio = bucket.totalMinutes > 0 ? bucket.completedMinutes / bucket.totalMinutes : 0;
    const repetitionBonus = clamp(bucket.count / 5, 0, 1);
    const derivedMastery = clamp(Math.round((completionRatio * 72) + (repetitionBonus * 18) + 10), 10, 92);
    return {
      name: bucket.name,
      totalMinutes: bucket.totalMinutes,
      completedMinutes: bucket.completedMinutes,
      count: bucket.count,
      signalSource: "timetable",
      weakScore: clamp(100 - derivedMastery, 8, 95)
    };
  });
}

function mergeTopicSignals(stateTopics, timetableTopics) {
  const merged = new Map();

  (Array.isArray(stateTopics) ? stateTopics : []).forEach((topic) => {
    const name = normalizeTopicName(topic?.name);
    if (!name) return;
    merged.set(name.toLowerCase(), { ...topic, name });
  });

  (Array.isArray(timetableTopics) ? timetableTopics : []).forEach((topic) => {
    const name = normalizeTopicName(topic?.name);
    if (!name) return;
    const key = name.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, { ...topic, name });
      return;
    }
    const existing = merged.get(key);
    const existingWeak = Number(existing?.weakScore);
    const incomingWeak = Number(topic?.weakScore);
    if (!Number.isFinite(existingWeak) && Number.isFinite(incomingWeak)) {
      merged.set(key, { ...existing, ...topic, name, weakScore: incomingWeak });
      return;
    }
    if (Number.isFinite(existingWeak) && Number.isFinite(incomingWeak)) {
      merged.set(key, {
        ...existing,
        ...topic,
        name,
        weakScore: clamp(Math.round((existingWeak * 0.7) + (incomingWeak * 0.3)), 0, 100)
      });
    }
  });

  return [...merged.values()];
}

function hasMeasuredTopicSignal(topic) {
  return Number(topic?.count || 0) > 0
    || Number(topic?.totalMinutes || 0) > 0
    || Number(topic?.completedMinutes || 0) > 0;
}

function selectDashboardTopics(topics) {
  const measured = (Array.isArray(topics) ? topics : [])
    .filter((topic) => topic && hasMeasuredTopicSignal(topic));
  return measured.length ? measured : [];
}

function buildSubjectSignals(tmState) {
  const tasks = Array.isArray(tmState?.tasks) ? tmState.tasks : [];
  const importanceItems = getSubjectImportanceItems(tmState);
  const buckets = new Map();

  const ensureBucket = (label, importance = null) => {
    const key = getSubjectKey(label);
    if (!key) return null;
    if (!buckets.has(key)) {
      buckets.set(key, {
        name: simplifySubjectLabel(label) || label,
        key,
        totalMinutes: 0,
        completedMinutes: 0,
        count: 0,
        schoolMinutes: Number(importance?.weeklyMinutes || 0),
        blockCount: Number(importance?.blockCount || 0),
        importanceRatio: Number(importance?.importanceRatio || 0),
        importanceScore: Number(importance?.importanceScore || 0)
      });
    }

    const bucket = buckets.get(key);
    if (importance) {
      bucket.name = importance.label || bucket.name;
      bucket.schoolMinutes = Math.max(bucket.schoolMinutes, Number(importance.weeklyMinutes || 0));
      bucket.blockCount = Math.max(bucket.blockCount, Number(importance.blockCount || 0));
      bucket.importanceRatio = Math.max(bucket.importanceRatio, Number(importance.importanceRatio || 0));
      bucket.importanceScore = Math.max(bucket.importanceScore, Number(importance.importanceScore || 0));
    }
    return bucket;
  };

  importanceItems.forEach((item) => {
    ensureBucket(item.label, item);
  });

  tasks.forEach((task) => {
    if (!task || isSchoolTask(task)) return;
    if (String(task?.type || "").toLowerCase() === "mock-test") return;

    const subjectName = getTaskSubjectName(task);
    if (!subjectName) return;

    const matchedImportance = findMatchingImportanceSubject(subjectName, importanceItems);
    const bucket = ensureBucket(matchedImportance?.label || subjectName, matchedImportance);
    if (!bucket) return;
    const mins = clamp(task?.estimatedMinutes || 60, 15, 240);
    bucket.totalMinutes += mins;
    bucket.count += 1;
    if (String(task?.status || "").toLowerCase() === "completed") {
      bucket.completedMinutes += mins;
    }
  });

  return [...buckets.values()].map((bucket) => {
    const expectedMinutes = bucket.schoolMinutes > 0
      ? Math.max(bucket.totalMinutes, Math.round(bucket.schoolMinutes * 1.2), 60)
      : Math.max(bucket.totalMinutes, 60);
    const completionRatio = expectedMinutes > 0 ? bucket.completedMinutes / expectedMinutes : 0;
    const planningRatio = expectedMinutes > 0 ? bucket.totalMinutes / expectedMinutes : 0;
    const repetitionBonus = clamp(bucket.count / 5, 0, 1);
    const derivedMastery = clamp(
      Math.round((completionRatio * 68) + (planningRatio * 16) + (repetitionBonus * 10) + 6),
      6,
      96
    );
    return {
      name: bucket.name,
      mastery: derivedMastery,
      totalMinutes: bucket.totalMinutes,
      completedMinutes: bucket.completedMinutes,
      count: bucket.count,
      schoolMinutes: bucket.schoolMinutes,
      blockCount: bucket.blockCount,
      importanceRatio: bucket.importanceRatio,
      importanceScore: bucket.importanceScore
    };
  }).sort((a, b) => {
    if (Number(b.importanceScore || 0) !== Number(a.importanceScore || 0)) {
      return Number(b.importanceScore || 0) - Number(a.importanceScore || 0);
    }
    if (Number(b.schoolMinutes || 0) !== Number(a.schoolMinutes || 0)) {
      return Number(b.schoolMinutes || 0) - Number(a.schoolMinutes || 0);
    }
    if (Number(b.mastery || 0) !== Number(a.mastery || 0)) {
      return Number(b.mastery || 0) - Number(a.mastery || 0);
    }
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function getOverallMastery(state, topicList) {
  const mastery = Array.isArray(state?.mastery) ? state.mastery : [];
  if (mastery.length) {
    return clamp(mastery[mastery.length - 1], 0, 100);
  }
  if (topicList.length) {
    const sum = topicList.reduce((acc, topic) => acc + getMasteryFromTopic(topic), 0);
    return clamp(Math.round(sum / topicList.length), 0, 100);
  }
  const exams = Array.isArray(state?.examHistory) ? state.examHistory : [];
  if (exams.length) {
    const avg = exams.reduce((acc, exam) => acc + Number(exam?.score || 0), 0) / exams.length;
    return clamp(Math.round(avg), 0, 100);
  }
  return 0;
}

function getPreviousMastery(state, current) {
  const mastery = Array.isArray(state?.mastery) ? state.mastery : [];
  if (mastery.length >= 2) return clamp(mastery[mastery.length - 2], 0, 100);
  const exams = Array.isArray(state?.examHistory) ? state.examHistory : [];
  if (exams.length >= 2) return clamp(exams[exams.length - 2]?.score || current, 0, 100);
  return current;
}

function normalizeTopicName(value) {
  return String(value || "").trim();
}

function getTopicDomain(nameRaw) {
  const name = String(nameRaw || "").toLowerCase();
  if (!name) return "general";
  if (name.includes("algorithm") || name.includes("graph") || name.includes("dp") || name.includes("sort")) return "algorithms";
  if (name.includes("math") || name.includes("calculus") || name.includes("algebra") || name.includes("probab") || name.includes("stat")) return "mathematics";
  if (name.includes("os") || name.includes("system") || name.includes("process") || name.includes("network") || name.includes("database")) return "systems";
  if (name.includes("mock") || name.includes("paper") || name.includes("exam") || name.includes("quiz") || name.includes("practice")) return "practice";
  return "general";
}

function fillClassForScore(score, index = 0) {
  const s = clamp(score, 0, 100);
  if (s >= 80) return "fill-green";
  if (s >= 65) return "fill-purple";
  if (s >= 50) return "fill-pink";
  if (s >= 35) return "fill-yellow";
  return SUBJECT_FILL_CLASS[index % SUBJECT_FILL_CLASS.length];
}

function mapHeatIntensity(minutes) {
  if (minutes >= 150) return 4;
  if (minutes >= 90) return 3;
  if (minutes >= 45) return 2;
  if (minutes >= 10) return 1;
  return 0;
}

function ensureFeature6State(runtime) {
  runtime.state.feature6 = runtime.state.feature6 || {};
  runtime.state.feature6.masterySnapshots = Array.isArray(runtime.state.feature6.masterySnapshots)
    ? runtime.state.feature6.masterySnapshots
    : [];
  return runtime.state.feature6;
}

function seedSnapshotsIfNeeded(runtime, topics, overallMastery, sourceState = null) {
  const feature6State = ensureFeature6State(runtime);
  if (feature6State.masterySnapshots.length) return false;

  const state = sourceState && typeof sourceState === "object" ? sourceState : (runtime.state || {});
  const examDates = (state.examHistory || [])
    .map((exam) => String(exam?.date || "").slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const auditDates = (state.auditLog || [])
    .map((event) => String(event?.ts || "").slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));

  const uniqueDates = [...new Set([...examDates, ...auditDates])].sort();
  if (!uniqueDates.length) return false;

  const masterySeries = Array.isArray(state.mastery) && state.mastery.length
    ? state.mastery.slice(-uniqueDates.length)
    : uniqueDates.map(() => overallMastery);

  const seeds = uniqueDates.map((date, index) => {
    const target = clamp(masterySeries[Math.min(index, masterySeries.length - 1)] ?? overallMastery, 0, 100);
    const concepts = {};
    topics.forEach((topic) => {
      const base = getMasteryFromTopic(topic);
      const adjusted = clamp(Math.round(base + ((target - overallMastery) * 0.35)), 0, 100);
      concepts[normalizeTopicName(topic.name)] = adjusted;
    });
    return { date, overall: target, concepts };
  });

  feature6State.masterySnapshots.push(...seeds.slice(-60));
  return seeds.length > 0;
}

function upsertTodaySnapshot(runtime, topics, overallMastery) {
  const feature6State = ensureFeature6State(runtime);
  const today = formatDateOnly(new Date());
  const concepts = {};
  topics.forEach((topic) => {
    const name = normalizeTopicName(topic.name);
    if (!name) return;
    concepts[name] = getMasteryFromTopic(topic);
  });

  const idx = feature6State.masterySnapshots.findIndex((entry) => entry?.date === today);
  const payload = {
    date: today,
    overall: clamp(overallMastery, 0, 100),
    concepts
  };

  if (idx >= 0) {
    const prev = feature6State.masterySnapshots[idx] || {};
    const sameOverall = Number(prev.overall) === Number(payload.overall);
    const sameConcepts = JSON.stringify(prev.concepts || {}) === JSON.stringify(payload.concepts);
    if (sameOverall && sameConcepts) return false;
    feature6State.masterySnapshots[idx] = payload;
  } else {
    feature6State.masterySnapshots.push(payload);
  }

  feature6State.masterySnapshots = feature6State.masterySnapshots
    .filter((entry) => entry && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || "")))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-120);
  return true;
}

function computeErrorBreakdown(state) {
  const logs = Array.isArray(state.practiceErrorLog) ? state.practiceErrorLog : [];
  const carelessTokens = ["careless", "typo", "misread", "sign error", "time pressure", "forgot"];
  let careless = 0;
  let knowledge = 0;

  logs.forEach((entry) => {
    const text = `${entry?.question || ""} ${entry?.fix || ""}`.toLowerCase();
    if (!text.trim()) return;
    if (carelessTokens.some((token) => text.includes(token))) {
      careless += 1;
    } else {
      knowledge += 1;
    }
  });

  const topics = Array.isArray(state.topics) ? state.topics : [];
  topics.forEach((topic) => {
    const weak = Number(topic?.weakScore || 0);
    if (weak >= 70) knowledge += 2;
    else if (weak >= 50) knowledge += 1;
  });

  if (!careless && !knowledge) {
    return { carelessCount: 0, knowledgeCount: 0, carelessPct: 0, knowledgePct: 0 };
  }
  const total = careless + knowledge;
  return {
    carelessCount: careless,
    knowledgeCount: knowledge,
    carelessPct: Math.round((careless * 100) / total),
    knowledgePct: Math.round((knowledge * 100) / total)
  };
}

function createDailyMinutesMap(days = HISTORY_DAYS) {
  const map = new Map();
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    map.set(formatDateOnly(date), 0);
  }
  return map;
}

function shiftDate(dayOffset, hour = 9, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function parseHourToken(value, fallbackHour = 9, fallbackMinute = 0) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { hour: fallbackHour, minute: fallbackMinute };
  return {
    hour: clamp(Number(match[1]), 0, 23),
    minute: clamp(Number(match[2]), 0, 59)
  };
}

function dateForWeekday(weekStart, dayToken, fallbackOffset, hour = 9, minute = 0) {
  const weekDate = parseDate(`${String(weekStart || "").slice(0, 10)}T00:00:00`);
  const dayIndex = DAY_ORDER.indexOf(String(dayToken || "").toUpperCase());
  if (!weekDate || dayIndex < 0) return shiftDate(fallbackOffset, hour, minute);

  const date = new Date(weekDate);
  date.setDate(date.getDate() + dayIndex);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function getWeekEnd(weekStart) {
  const start = parseDate(`${String(weekStart || "").slice(0, 10)}T00:00:00`);
  if (!start) return "";
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return formatDateOnly(end);
}

function isDateWithinWeek(dateKey, weekStart) {
  const key = String(dateKey || "").slice(0, 10);
  const start = String(weekStart || "").slice(0, 10);
  const end = getWeekEnd(start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return false;
  }
  return key >= start && key <= end;
}

function collectRealStudyActivityDateKeys(state, tmState, weekStart = getCurrentWeekStart()) {
  const keys = new Set();

  getFocusSessions(state).forEach((session) => {
    if (!session || String(session.status || "").toLowerCase() === "cancelled") return;
    const key = String(session?.endedAt || session?.startedAt || "").slice(0, 10);
    if (isDateWithinWeek(key, weekStart)) keys.add(key);
  });

  (Array.isArray(tmState?.tasks) ? tmState.tasks : []).forEach((task) => {
    if (isSchoolTask(task)) return;
    if (String(task?.status || "").toLowerCase() !== "completed") return;
    const key = String(task?.completedAt || task?.updatedAt || "").slice(0, 10);
    if (isDateWithinWeek(key, weekStart)) keys.add(key);
  });

  return keys;
}

function mergePreviewFocusSessions(state, tmState, previewSessions, force = false) {
  const existing = getFocusSessions(state);
  if (force) return previewSessions;
  if (!previewSessions.length) return existing;

  const realKeys = collectRealStudyActivityDateKeys(state, tmState, tmState?.weekStart || getCurrentWeekStart());
  const supplements = previewSessions.filter((session) => {
    const key = String(session?.endedAt || session?.startedAt || "").slice(0, 10);
    return key && !realKeys.has(key);
  });

  return [...existing, ...supplements];
}

function mergePreviewAuditLog(existingAudit, previewAudit, force = false) {
  const current = Array.isArray(existingAudit) ? existingAudit : [];
  if (force) return previewAudit;
  if (!previewAudit.length) return current;

  const seen = new Set(current.map((entry) => `${String(entry?.ts || "").slice(0, 10)}|${String(entry?.message || "")}`));
  const supplements = previewAudit.filter((entry) => {
    const key = `${String(entry?.ts || "").slice(0, 10)}|${String(entry?.message || "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...current, ...supplements].sort((a, b) => String(a?.ts || "").localeCompare(String(b?.ts || ""))).slice(-60);
}

function buildProjectedSeries(currentValue, length = 7) {
  const safeCurrent = clamp(currentValue, 0, 100);
  const window = clamp(Math.round(((100 - safeCurrent) * 0.14) + 8), 6, 18);
  return Array.from({ length }, (_unused, index) => {
    const ratio = length <= 1 ? 1 : index / (length - 1);
    return clamp(Math.round(safeCurrent - ((1 - ratio) * window)), 0, 100);
  });
}

function derivePreviewTopics(state, tmState) {
  const stateTopics = Array.isArray(state?.topics) ? state.topics : [];
  const timetableTopics = buildSyntheticTopicsFromTimetable(tmState);
  return mergeTopicSignals(stateTopics, timetableTopics);
}

function buildPreviewMasterySnapshots(topics, state) {
  const offsets = [-6, -5, -4, -3, -2, -1, 0];
  const overallSeries = buildProjectedSeries(getOverallMastery(state, topics), offsets.length);

  return offsets.map((offset, index) => {
    const date = shiftDate(offset, 0, 0);
    const progress = offsets.length <= 1 ? 1 : index / (offsets.length - 1);
    const concepts = {};
    topics.forEach((topic, topicIndex) => {
      const name = normalizeTopicName(topic?.name);
      if (!name) return;
      const current = getMasteryFromTopic(topic);
      const lag = clamp(Math.round(((100 - current) * 0.16) + (topicIndex * 1.5) + 4), 4, 18);
      concepts[name] = clamp(Math.round(current - ((1 - progress) * lag)), 0, 100);
    });
    return {
      date: formatDateOnly(date),
      overall: overallSeries[index],
      concepts
    };
  });
}

function derivePreviewFocusMode(task) {
  const type = String(task?.type || "").toLowerCase();
  const source = String(task?.source || "").toLowerCase();
  if (type.includes("practice") || type.includes("quiz") || type.includes("exam")) return "practice";
  if (source === "ai") return "tutor";
  return "reading";
}

function buildPreviewFocusSessions(tmState) {
  const tasks = (Array.isArray(tmState?.tasks) ? tmState.tasks : [])
    .filter((task) => task && !isSchoolTask(task) && String(task?.type || "").toLowerCase() !== "mock-test");
  if (!tasks.length) return [];

  const count = 5;
  const slots = Array.isArray(tmState?.slots) ? tmState.slots : [];
  const slotByTaskId = new Map();
  slots.forEach((slot) => {
    if (!slot?.taskId || slotByTaskId.has(slot.taskId)) return;
    slotByTaskId.set(slot.taskId, slot);
  });

  const orderedTasks = tasks
    .slice()
    .sort((a, b) => {
      const slotA = slotByTaskId.has(a?.id) ? 1 : 0;
      const slotB = slotByTaskId.has(b?.id) ? 1 : 0;
      if (slotB !== slotA) return slotB - slotA;
      return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
    });

  const previewDays = DAY_ORDER.slice(0, 5);

  return Array.from({ length: count }, (_unused, index) => {
    const task = orderedTasks[index % orderedTasks.length];
    const slot = slotByTaskId.get(task?.id);
    const dayToken = previewDays[index] || slot?.day || "MON";
    const offset = -(count - 1 - index);
    const fallbackHour = 8 + ((index % 4) * 3);
    const parsedTime = parseHourToken(slot?.hour, fallbackHour, 0);
    const start = dateForWeekday(tmState?.weekStart, dayToken, offset, parsedTime.hour, parsedTime.minute);
    const duration = clamp(Math.round((clamp(task?.estimatedMinutes || 45, 20, 90) / 2) / 5) * 5, 20, 30);
    const end = new Date(start.getTime() + (duration * 60000));
    return {
      id: `preview-focus-${task?.id || index}`,
      mode: derivePreviewFocusMode(task),
      targetMinutes: duration,
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      status: "completed"
    };
  });
}

function buildPreviewAuditLog(state, tmState, focusSessions) {
  const entries = [];

  focusSessions.slice(-4).forEach((session) => {
    entries.push({
      ts: session.endedAt || session.startedAt,
      message: `Focus session completed: ${getFocusModeLabel(session.mode)} · ${formatMinutes(getFocusSessionMinutes(session))}.`
    });
  });

  const latestCompletedTask = (Array.isArray(tmState?.tasks) ? tmState.tasks : [])
    .filter((task) => task?.status === "completed")
    .sort((a, b) => String(b.completedAt || b.updatedAt || "").localeCompare(String(a.completedAt || a.updatedAt || "")))[0];
  if (latestCompletedTask) {
    entries.push({
      ts: latestCompletedTask.completedAt || latestCompletedTask.updatedAt || latestCompletedTask.createdAt || new Date().toISOString(),
      message: `Completed ${latestCompletedTask.title || latestCompletedTask.subject || "study session"}.`
    });
  }

  const latestUpload = (Array.isArray(state?.practiceUploads) ? state.practiceUploads : [])[0];
  if (latestUpload?.name) {
    entries.push({
      ts: latestUpload.date || new Date().toISOString(),
      message: `Practice upload analyzed: ${latestUpload.name}`
    });
  }

  const latestHighlight = (Array.isArray(state?.highlights) ? state.highlights : [])[0];
  if (latestHighlight?.topic) {
    entries.push({
      ts: latestHighlight.date || new Date().toISOString(),
      message: `Highlight saved (${latestHighlight.provider || "local"}).`
    });
  }

  return entries
    .filter((entry) => entry?.message)
    .sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")))
    .slice(-12);
}

function buildDashboardPreviewFixture(runtime, tmState, force = false) {
  const baseState = runtime.state || {};
  const topics = derivePreviewTopics(baseState, tmState);
  const stateForPreview = {
    ...baseState,
    topics
  };
  const masterySnapshots = buildPreviewMasterySnapshots(topics, stateForPreview);
  const focusSessions = buildPreviewFocusSessions(tmState);
  const auditLog = buildPreviewAuditLog(baseState, tmState, focusSessions);

  return {
    state: {
      ...baseState,
      topics: topics.length ? topics : (Array.isArray(baseState.topics) ? baseState.topics : []),
      mastery: force || !Array.isArray(baseState.mastery) || !baseState.mastery.length
        ? masterySnapshots.map((entry) => entry.overall)
        : baseState.mastery,
      focusSessions: mergePreviewFocusSessions(baseState, tmState, focusSessions, force),
      auditLog: mergePreviewAuditLog(baseState.auditLog, auditLog, force)
    },
    tmState: tmState || {},
    masterySnapshots
  };
}

function hasDashboardSignals(state, tmState) {
  return Boolean(
    (Array.isArray(state?.topics) && state.topics.length)
    || (Array.isArray(state?.mastery) && state.mastery.length)
    || (Array.isArray(state?.examHistory) && state.examHistory.length)
    || (Array.isArray(state?.practiceUploads) && state.practiceUploads.length)
    || (Array.isArray(state?.highlights) && state.highlights.length)
    || getFocusSessions(state).length
    || (Array.isArray(tmState?.tasks) && tmState.tasks.length)
    || (Array.isArray(tmState?.slots) && tmState.slots.length)
  );
}

function hasRealStudyActivity(state, tmState) {
  return collectRealStudyActivityDateKeys(state, tmState, tmState?.weekStart || getCurrentWeekStart()).size > 0;
}

function shouldAutoPreviewDashboard(state, tmState) {
  return collectRealStudyActivityDateKeys(state, tmState, tmState?.weekStart || getCurrentWeekStart()).size <= 1;
}

function shouldForceDashboardPreview() {
  try {
    const search = typeof window !== "undefined" ? window.location?.search || "" : "";
    const value = new URLSearchParams(search).get("previewDashboard");
    return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
  } catch {
    return false;
  }
}

function getFocusSessions(state) {
  return Array.isArray(state?.focusSessions) ? state.focusSessions : [];
}

function getFocusModeLabel(mode) {
  return FOCUS_MODE_LABELS[mode] || "Focus Session";
}

function getFocusSessionEffectiveEnd(session, now = new Date()) {
  const start = parseDate(session?.startedAt);
  if (!start) return null;

  const explicitEnd = parseDate(session?.endedAt);
  const targetMinutes = Math.max(0, toInt(session?.targetMinutes || 0));
  let end = explicitEnd || now;

  if (targetMinutes > 0) {
    const cappedEnd = new Date(start.getTime() + (targetMinutes * 60000));
    if (cappedEnd < end) end = cappedEnd;
  }

  return end >= start ? end : start;
}

function getFocusSessionMinutes(session, now = new Date()) {
  const start = parseDate(session?.startedAt);
  const end = getFocusSessionEffectiveEnd(session, now);
  if (!start || !end || end <= start) return 0;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
}

function addMinutesAcrossDays(map, start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || end <= start) return;
  let cursor = new Date(start);

  while (cursor < end) {
    const nextBoundary = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    const segmentEnd = end < nextBoundary ? end : nextBoundary;
    const minutes = Math.max(1, Math.round((segmentEnd.getTime() - cursor.getTime()) / 60000));
    const key = formatDateOnly(cursor);
    if (map.has(key)) {
      map.set(key, map.get(key) + minutes);
    }
    cursor = segmentEnd;
  }
}

function buildMinutesTimeline(state, tmState) {
  const map = createDailyMinutesMap(HISTORY_DAYS);
  const now = new Date();

  getFocusSessions(state).forEach((session) => {
    if (!session || String(session.status || "").toLowerCase() === "cancelled") return;
    const start = parseDate(session?.startedAt);
    const end = getFocusSessionEffectiveEnd(session, now);
    if (!start || !end || end <= start) return;
    addMinutesAcrossDays(map, start, end);
  });

  const tasks = Array.isArray(tmState?.tasks) ? tmState.tasks : [];
  tasks.forEach((task) => {
    if (task?.status !== "completed") return;
    const completedDate = String(task?.completedAt || task?.updatedAt || "").slice(0, 10);
    if (!map.has(completedDate)) return;
    map.set(completedDate, map.get(completedDate) + clamp(task?.estimatedMinutes || 60, 15, 180));
  });

  return map;
}

function computeStreakAndDecay(dailyMinutes, overallMastery) {
  const entries = [...dailyMinutes.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    return { streakDays: 0, inactivityDays: 0, confidenceDecayPct: 0 };
  }

  let streakDays = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i][1] >= STREAK_TARGET_MINUTES) streakDays += 1;
    else break;
  }

  let inactivityDays = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i][1] >= STREAK_TARGET_MINUTES) break;
    inactivityDays += 1;
  }

  const confidenceDecayPct = clamp(Math.round((inactivityDays * 2.6) + ((100 - overallMastery) * 0.06)), 0, 45);
  return { streakDays, inactivityDays, confidenceDecayPct };
}

function buildWeeklyMinutes(dailyMinutes) {
  const weekStart = parseDate(`${getCurrentWeekStart()}T00:00:00`) || new Date();
  return DAY_ORDER.map((day, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const key = formatDateOnly(date);
    return {
      day,
      label: DAY_LABELS[day],
      minutes: toInt(dailyMinutes.get(key) || 0)
    };
  });
}

function buildTodayMinutes(tmState, dailyMinutes) {
  const todayDay = getDayToken(new Date());
  const todayKey = formatDateOnly(new Date());
  const tasks = new Map((tmState?.tasks || []).map((task) => [task.id, task]));
  let planned = 0;
  let completed = 0;

  (tmState?.slots || []).forEach((slot) => {
    if (String(slot?.day || "").toUpperCase() !== todayDay) return;
    const task = tasks.get(slot?.taskId);
    if (!task) return;
    const source = String(task?.source || "").toLowerCase();
    const type = String(task?.type || "").toLowerCase();
    if (source === "school" || type === "school-block") return;
    const mins = clamp(task?.estimatedMinutes || 60, 15, 180);
    planned += mins;
    if (task.status === "completed") completed += mins;
  });

  return {
    planned,
    completed,
    logged: toInt(dailyMinutes.get(todayKey) || 0)
  };
}

function buildRecentActivities(state, tmState) {
  const feed = [];
  const push = (item) => {
    if (!item?.title) return;
    feed.push(item);
  };

  const focusSessions = getFocusSessions(state)
    .filter((session) => session && String(session.status || "").toLowerCase() !== "cancelled")
    .slice()
    .sort((a, b) => String(b.endedAt || b.startedAt || "").localeCompare(String(a.endedAt || a.startedAt || "")))
    .slice(0, 3);

  focusSessions.forEach((session, index) => {
    const active = String(session.status || "").toLowerCase() === "active" && !session.endedAt;
    const sortTs = parseDate(session.endedAt || session.startedAt)?.getTime() || 0;
    push({
      sortTs,
      title: `${active ? "Focus in progress" : "Completed"} ${getFocusModeLabel(session.mode)} · ${formatMinutes(getFocusSessionMinutes(session))}`,
      meta: active ? `Started ${formatRelative(session.startedAt)}` : formatRelative(session.endedAt || session.startedAt),
      dotColor: [CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.accent3][index % 3]
    });
  });

  const audits = Array.isArray(state.auditLog) ? state.auditLog : [];
  const recentAudits = audits
    .filter((entry) => {
      const message = String(entry?.message || "");
      return message
        && !/^focus session (started|completed|discarded):/i.test(message)
        && !/^feature 6 render failed:/i.test(message)
        && message !== "Loaded user state from backend.";
    })
    .slice(-8)
    .reverse();
  recentAudits.forEach((entry, index) => {
    push({
      sortTs: parseDate(entry?.ts)?.getTime() || 0,
      title: entry?.message || "Learning activity",
      meta: formatRelative(entry?.ts),
      dotColor: [CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.accent4, CHART_COLORS.accent3][index % 4]
    });
  });

  (tmState?.tasks || [])
    .filter((task) => task?.status === "completed" && task?.completedAt)
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
    .slice(0, 4)
    .forEach((task, index) => {
      push({
        sortTs: parseDate(task.completedAt)?.getTime() || 0,
        title: `Completed ${task.title || task.subject || "study session"} · ${clamp(task.estimatedMinutes || 60, 15, 180)} min`,
        meta: formatRelative(task.completedAt),
        dotColor: [CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.accent4, CHART_COLORS.accent3][index % 4]
      });
    });

  (tmState?.tasks || [])
    .filter((task) => !isSchoolTask(task) && task?.status !== "completed")
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, 3)
    .forEach((task, index) => {
      push({
        sortTs: parseDate(task.updatedAt || task.createdAt)?.getTime() || 0,
        title: `Scheduled ${task.title || task.subject || "study session"} · ${clamp(task.estimatedMinutes || 60, 15, 180)} min`,
        meta: formatRelative(task.updatedAt || task.createdAt),
        dotColor: [CHART_COLORS.accent2, CHART_COLORS.accent3, CHART_COLORS.accent4][index % 3]
      });
    });

  const merged = feed
    .sort((a, b) => Number(b.sortTs || 0) - Number(a.sortTs || 0))
    .slice(0, 6)
    .map(({ sortTs, ...entry }) => entry);
  if (merged.length) return merged;
  return [{
    title: "No activity logged yet",
    meta: "Complete a task or ask AI Tutor to start tracking",
    dotColor: CHART_COLORS.text3
  }];
}

function buildSubjectMastery(topics) {
  if (!topics.length) {
    return [{ name: "No measured subjects yet", mastery: 0 }];
  }
  return topics
    .slice()
    .map((topic) => ({
      name: normalizeTopicName(topic?.name || "Subject"),
      mastery: Number.isFinite(Number(topic?.mastery))
        ? clamp(Number(topic.mastery), 0, 100)
        : getMasteryFromTopic(topic)
    }))
    .slice(0, 5);
}

function buildTopicBreakdown(topics) {
  if (!topics.length) {
    return [{
      domain: "general",
      title: "Concepts",
      items: [{ name: "No measured mastery yet", mastery: 0 }]
    }];
  }

  const grouped = new Map();
  topics.forEach((topic) => {
    const name = normalizeTopicName(topic?.name || "");
    if (!name) return;
    const domain = getTopicDomain(name);
    if (!grouped.has(domain)) grouped.set(domain, []);
    grouped.get(domain).push({ name, mastery: getMasteryFromTopic(topic) });
  });

  return [...grouped.entries()]
    .map(([domain, items]) => ({
      domain,
      title: `${GROUP_ICON[domain] || GROUP_ICON.general} ${domain.charAt(0).toUpperCase()}${domain.slice(1)}`,
      items: items.sort((a, b) => b.mastery - a.mastery).slice(0, 4)
    }))
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, 3);
}

function buildMasteryTrend(runtime, topics, overallMastery, snapshotsOverride = null) {
  const feature6State = ensureFeature6State(runtime);
  const snapshots = (Array.isArray(snapshotsOverride) ? snapshotsOverride : feature6State.masterySnapshots || [])
    .filter((entry) => entry && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || "")))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-10);

  const labels = snapshots.map((entry) => {
    const dt = parseDate(`${entry.date}T00:00:00`);
    return dt ? dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : entry.date;
  });

  const prioritizedConcepts = topics
    .slice()
    .sort((a, b) => Number(b?.weakScore || 0) - Number(a?.weakScore || 0))
    .slice(0, 3)
    .map((topic) => normalizeTopicName(topic.name))
    .filter(Boolean);

  const colors = [CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.accent3];
  const datasets = prioritizedConcepts.map((name, index) => ({
    label: name,
    data: snapshots.map((entry) => {
      const value = Number(entry?.concepts?.[name]);
      if (Number.isFinite(value)) return clamp(value, 0, 100);
      return null;
    }),
    borderColor: colors[index % colors.length],
    backgroundColor: "transparent",
    tension: 0.35,
    borderWidth: 2.2,
    pointRadius: 2,
    pointHoverRadius: 4,
    spanGaps: true
  }));

  if (!datasets.length) {
    datasets.push({
      label: "Overall Mastery",
      data: snapshots.map((entry) => clamp(Number(entry?.overall || overallMastery), 0, 100)),
      borderColor: CHART_COLORS.accent,
      backgroundColor: "transparent",
      tension: 0.35,
      borderWidth: 2.2,
      pointRadius: 2,
      pointHoverRadius: 4
    });
  }

  if (labels.length < 2) {
    const fallbackLabels = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      fallbackLabels.push(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    }
    const fallbackLabel = datasets[0]?.label || "Overall Mastery";
    return {
      labels: fallbackLabels,
      datasets: [{
        label: fallbackLabel,
        data: fallbackLabels.map(() => 0),
        borderColor: CHART_COLORS.accent,
        backgroundColor: "transparent",
        tension: 0.35,
        borderWidth: 2.2,
        pointRadius: 2,
        pointHoverRadius: 4
      }],
      hasEnoughData: true
    };
  }

  return {
    labels,
    datasets,
    hasEnoughData: true
  };
}

function resolveResponsibleControls(state) {
  const controls = state?.responsibleControls || {};
  const conceptMasteryDetection = typeof controls.conceptMasteryDetection === "boolean"
    ? controls.conceptMasteryDetection
    : (typeof controls.explainability === "boolean" ? controls.explainability : true);

  return {
    conceptMasteryDetection,
    personalization: controls.personalization !== false,
    decayModeling: controls.decayModeling !== false,
    errorTypeDetection: controls.errorTypeDetection !== false
  };
}

function buildStatsPayload(state, tmState, topics, overallMastery, controls) {
  const previousMastery = getPreviousMastery(state, overallMastery);
  const masteryDelta = toInt(overallMastery - previousMastery);
  const dailyMinutes = buildMinutesTimeline(state, tmState);
  const weeklyMinutes = buildWeeklyMinutes(dailyMinutes);
  const streakData = computeStreakAndDecay(dailyMinutes, overallMastery);
  const todayMinutes = buildTodayMinutes(tmState, dailyMinutes);
  const topicMetrics = topics.map((topic) => ({ mastery: getMasteryFromTopic(topic) }));
  const weakCount = topicMetrics.filter((topic) => topic.mastery < 60).length;
  const criticalWeak = topicMetrics.filter((topic) => topic.mastery < 40).length;
  const masteredCount = topicMetrics.filter((topic) => topic.mastery >= 70).length;
  const level = Math.max(1, Math.min(10, Math.ceil(overallMastery / 10)));

  return {
    dashboard: {
      streakValue: `${streakData.streakDays}d`,
      streakChange: streakData.streakDays > 0
        ? `↑ ${streakData.streakDays >= 7 ? "Strong consistency" : "Building momentum"}`
        : "→ Start your first streak",
      masteryValue: controls.conceptMasteryDetection ? `${toInt(overallMastery)}%` : "Off",
      masteryChange: controls.conceptMasteryDetection
        ? (masteryDelta > 0
          ? `↑ +${masteryDelta}% vs previous`
          : masteryDelta < 0
            ? `↓ ${Math.abs(masteryDelta)}% vs previous`
            : "→ Stable vs previous")
        : "→ Enable concept mastery detection",
      topicsValue: String(topics.length),
      topicsChange: `→ ${weakCount} pending`,
      timeTodayValue: formatMinutes(todayMinutes.logged || todayMinutes.completed || todayMinutes.planned),
      timeTodayChange: todayMinutes.logged > 0
        ? `↑ ${formatMinutes(todayMinutes.logged)} logged today`
        : todayMinutes.completed > 0
          ? `↑ ${formatMinutes(todayMinutes.completed)} completed`
        : todayMinutes.planned > 0
          ? `→ ${formatMinutes(todayMinutes.planned)} planned`
          : "→ No timed sessions logged"
    },
    progress: {
      levelValue: `Lv.${level}`,
      levelChange: streakData.streakDays > 0 ? `↑ ${streakData.streakDays} day streak` : "→ No streak yet",
      masteredValue: controls.conceptMasteryDetection ? String(masteredCount) : "Off",
      masteredChange: controls.conceptMasteryDetection
        ? `→ ${masteredCount} at 70%+ mastery`
        : "→ Enable concept mastery detection",
      gapsValue: controls.errorTypeDetection ? String(weakCount) : "Off",
      gapsChange: controls.errorTypeDetection
        ? `→ ${criticalWeak} critical`
        : "→ Enable careless vs gap detection",
      decayValue: controls.decayModeling ? `${streakData.confidenceDecayPct}%` : "Off",
      decayChange: controls.decayModeling
        ? (streakData.inactivityDays > 0 ? `↓ ${streakData.inactivityDays} day inactivity` : "↑ No inactivity gap")
        : "→ Enable mastery decay modeling"
    },
    streak: streakData,
    dailyMinutes,
    weeklyMinutes
  };
}

function getStudentDisplayName(runtime) {
  const raw = String(runtime?.state?.student?.name || "").trim();
  if (!raw) return "Student";
  return raw.split(/\s+/)[0] || "Student";
}

function getGreetingPrefix(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function buildDashboardHeader(runtime, tmState) {
  const now = new Date();
  const name = getStudentDisplayName(runtime);
  const profile = tmState?.profile || {};
  const dates = Array.isArray(profile.examDates) ? profile.examDates : [];
  const nearest = dates
    .map((value) => ({
      raw: value,
      date: parseDate(`${value}T00:00:00`)
    }))
    .filter((item) => item.date && Number.isFinite(item.date.getTime()))
    .sort((a, b) => a.date - b.date)
    .find((item) => item.date >= new Date(now.getFullYear(), now.getMonth(), now.getDate()));

  const dayLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  let examText = "No exam dates set";

  if (nearest) {
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startExam = new Date(nearest.date.getFullYear(), nearest.date.getMonth(), nearest.date.getDate());
    const diffDays = Math.round((startExam - startToday) / 86400000);
    if (diffDays <= 0) examText = "Exam day";
    else if (diffDays === 1) examText = "Exam in 1 day";
    else examText = `Exam in ${diffDays} days`;
  }

  return {
    title: `Good ${getGreetingPrefix(now)}, ${name} 👋`,
    sub: `${dayLabel} · ${examText}`
  };
}

function getDashboardFeedback(state) {
  return state?.dashboardFeedback && typeof state.dashboardFeedback === "object"
    ? state.dashboardFeedback
    : {};
}

function formatProductiveWindows(productiveHours) {
  const windows = Array.isArray(productiveHours) ? productiveHours.filter(Boolean) : [];
  return windows.join(" and ") || "your productive windows";
}

function isHourWithinProductiveRanges(hour, productiveHours) {
  const [hh, mm] = String(hour || "00:00").split(":").map((part) => toInt(part, 0));
  const target = (hh * 60) + (mm || 0);
  return (productiveHours || []).some((range) => {
    const [start, end] = String(range || "").split("-");
    const [startH, startM] = String(start || "").split(":").map((part) => toInt(part, 0));
    const [endH, endM] = String(end || "").split(":").map((part) => toInt(part, 0));
    const startMinutes = (startH * 60) + (startM || 0);
    const endMinutes = (endH * 60) + (endM || 0);
    return target >= startMinutes && target < endMinutes;
  });
}

function getNearestExamDays(tmState) {
  const dates = Array.isArray(tmState?.profile?.examDates) ? tmState.profile.examDates : [];
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let best = null;

  dates.forEach((value) => {
    const exam = parseDate(`${value}T00:00:00`);
    if (!exam) return;
    const examStart = new Date(exam.getFullYear(), exam.getMonth(), exam.getDate());
    const diffDays = Math.round((examStart.getTime() - todayStart.getTime()) / 86400000);
    if (diffDays < 0) return;
    if (best === null || diffDays < best) best = diffDays;
  });

  return best;
}

function dedupeInsightCandidates(candidates) {
  const seen = new Set();
  return (candidates || []).filter((candidate) => {
    if (!candidate?.type || !candidate?.text) return false;
    const key = `${candidate.type}|${candidate.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectInsightCandidate(candidates, feedbackValue, fallback) {
  const available = dedupeInsightCandidates(candidates);
  if (!available.length) return fallback;
  if (String(feedbackValue || "") === "down" && available.length > 1) {
    return available[1];
  }
  return available[0];
}

function buildWeakTopicInsight(sortedTopics) {
  const weakest = sortedTopics[0] || null;
  if (!weakest) return null;
  const weakMastery = getMasteryFromTopic(weakest);
  return {
    type: weakMastery < 50 ? "Knowledge Gap Detected" : "Reinforcement Suggested",
    text: `${normalizeTopicName(weakest.name)} is at ${toInt(weakMastery)}% mastery (weak score ${toInt(weakest.weakScore || 0)}). Prioritize this concept in your next focused session.`
  };
}

function buildWeightedSubjectInsight(subjectSignals) {
  const weighted = (subjectSignals || [])
    .slice()
    .sort((a, b) => {
      if (Number(a.mastery || 0) !== Number(b.mastery || 0)) return Number(a.mastery || 0) - Number(b.mastery || 0);
      if (Number(b.importanceScore || 0) !== Number(a.importanceScore || 0)) return Number(b.importanceScore || 0) - Number(a.importanceScore || 0);
      return Number(b.schoolMinutes || 0) - Number(a.schoolMinutes || 0);
    })
    .find((item) => Number(item?.importanceScore || 0) > 0);

  if (!weighted) return null;
  const share = toInt(weighted.importanceScore || Math.round(Number(weighted.importanceRatio || 0) * 100));
  const remainingMinutes = Math.max(30, toInt((Number(weighted.schoolMinutes || 0) * 1.2) - Number(weighted.completedMinutes || 0), 0));
  return {
    type: weighted.mastery < 55 ? "High-Weight Module Risk" : "High-Weight Module Focus",
    text: `${normalizeTopicName(weighted.name)} carries about ${share}% of your weekly class load and is sitting at ${toInt(weighted.mastery)}% mastery. Add ${formatMinutes(remainingMinutes)} of focused work to protect this module.`
  };
}

function buildDecayRiskInsight(sortedTopics, stats) {
  const inactivityDays = Number(stats?.streak?.inactivityDays || 0);
  const decay = Number(stats?.streak?.confidenceDecayPct || 0);
  if (!inactivityDays && decay < 12) return null;
  const weakest = sortedTopics[0] || null;
  const label = weakest ? normalizeTopicName(weakest.name) : "your weakest material";
  return {
    type: "Retention Risk Rising",
    text: inactivityDays > 0
      ? `You have ${inactivityDays} low-activity day(s) in a row, pushing mastery decay risk to ${toInt(decay)}%. Revisit ${label} before the gap gets harder to recover.`
      : `${label} is beginning to decay. Schedule one retrieval session this week to keep mastery from slipping.`
  };
}

function buildExamProximityInsight(sortedTopics, tmState) {
  const nearestDays = getNearestExamDays(tmState);
  if (nearestDays === null || nearestDays > 14) return null;
  const weakest = sortedTopics[0] || null;
  const label = weakest ? normalizeTopicName(weakest.name) : "your weakest topic";
  return {
    type: nearestDays <= 3 ? "Exam Pressure Alert" : "Exam Readiness Check",
    text: nearestDays <= 0
      ? `Today is an exam day. Do a short confidence check on ${label} instead of opening broad new content.`
      : `Your next exam is in ${nearestDays} day${nearestDays === 1 ? "" : "s"}. Keep ${label} near the top of your revision queue this week.`
  };
}

function buildGoalCoverageInsight(tmState, weeklyMinutes) {
  const profile = tmState?.profile || {};
  const productiveHours = Array.isArray(profile.productiveHours) ? profile.productiveHours : [];
  const weeklyGoalHours = clamp(profile.weeklyGoalsHours || 14, 1, 60);
  const loggedMinutes = weeklyMinutes.reduce((sum, item) => sum + toInt(item.minutes), 0);
  const loggedHours = Number((loggedMinutes / 60).toFixed(1));
  const remainingHours = Math.max(0, Number((weeklyGoalHours - loggedHours).toFixed(1)));

  return {
    type: loggedHours >= weeklyGoalHours ? "Goal Coverage On Track" : "Goal Coverage Gap",
    text: loggedHours >= weeklyGoalHours
      ? `You have already logged ${loggedHours}h against a ${weeklyGoalHours}h weekly goal. Keep your next sessions aligned to productive windows: ${formatProductiveWindows(productiveHours)}.`
      : `You have logged ${loggedHours}h of ${weeklyGoalHours}h this week. Add ${remainingHours}h in productive windows (${formatProductiveWindows(productiveHours)}) to stay on target.`
  };
}

function buildSchedulingGapInsight(tmState) {
  const tasks = Array.isArray(tmState?.tasks) ? tmState.tasks : [];
  const pending = tasks.filter((task) => task && !isSchoolTask(task) && String(task.status || "").toLowerCase() !== "completed");
  if (!pending.length) return null;

  const assigned = new Set(
    (Array.isArray(tmState?.slots) ? tmState.slots : [])
      .map((slot) => String(slot?.taskId || "").trim())
      .filter(Boolean)
  );
  const unscheduled = pending.filter((task) => !assigned.has(String(task.id || "").trim()));
  if (!unscheduled.length) return null;

  const top = unscheduled
    .slice()
    .sort((a, b) => Number(b?.priority || 0) - Number(a?.priority || 0))[0];
  const label = normalizeTopicName(top?.title || top?.subject || "your highest-priority task");
  return {
    type: "Scheduling Gap",
    text: `${unscheduled.length} pending study session${unscheduled.length === 1 ? "" : "s"} still have no timetable slot this week. Place ${label} on the calendar next so your plan is actually executable.`
  };
}

function buildProductiveWindowInsight(tmState) {
  const profile = tmState?.profile || {};
  const productiveHours = Array.isArray(profile.productiveHours) ? profile.productiveHours.filter(Boolean) : [];
  if (!productiveHours.length) return null;

  const taskById = new Map((Array.isArray(tmState?.tasks) ? tmState.tasks : []).map((task) => [String(task.id || ""), task]));
  let assigned = 0;
  let outside = 0;

  (Array.isArray(tmState?.slots) ? tmState.slots : []).forEach((slot) => {
    const task = taskById.get(String(slot?.taskId || ""));
    if (!task || isSchoolTask(task)) return;
    assigned += 1;
    if (!isHourWithinProductiveRanges(slot?.hour, productiveHours)) outside += 1;
  });

  if (!assigned || !outside) return null;
  return {
    type: "Productive Window Drift",
    text: `${outside} scheduled session${outside === 1 ? "" : "s"} sit outside your productive windows (${formatProductiveWindows(productiveHours)}). Move the hardest block into those hours for better follow-through.`
  };
}

function buildMomentumInsight(stats, tmState) {
  const streakDays = Number(stats?.streak?.streakDays || 0);
  const pending = (Array.isArray(tmState?.tasks) ? tmState.tasks : [])
    .filter((task) => task && !isSchoolTask(task) && String(task.status || "").toLowerCase() !== "completed");

  if (streakDays >= 3) {
    return {
      type: "Momentum Building",
      text: `You are on a ${streakDays}-day study streak. Keep tomorrow's first block short and specific so the streak converts into another completed session.`
    };
  }
  if (pending.length) {
    return {
      type: "Execution Focus",
      text: `${pending.length} planned study session${pending.length === 1 ? "" : "s"} are still open this week. Finish one already-scheduled block before generating more tasks.`
    };
  }
  return null;
}

function buildDashboardInsights(topics, tmState, weeklyMinutes, subjectSignals, stats, state) {
  const sortedTopics = topics
    .slice()
    .sort((a, b) => Number(b?.weakScore || 0) - Number(a?.weakScore || 0));

  const feedback = getDashboardFeedback(state);
  const primary = selectInsightCandidate(
    [
      buildWeakTopicInsight(sortedTopics),
      buildWeightedSubjectInsight(subjectSignals),
      buildDecayRiskInsight(sortedTopics, stats),
      buildExamProximityInsight(sortedTopics, tmState)
    ],
    feedback["dashboard-primary"],
    {
      type: "Baseline Building",
      text: "No topic weakness data yet. Complete a practice analysis or tutor session to unlock targeted gap insights."
    }
  );

  const secondary = selectInsightCandidate(
    [
      buildGoalCoverageInsight(tmState, weeklyMinutes),
      buildSchedulingGapInsight(tmState),
      buildProductiveWindowInsight(tmState),
      buildMomentumInsight(stats, tmState)
    ],
    feedback["dashboard-secondary"],
    {
      type: "Plan Setup",
      text: "Set a weekly goal and productive windows to unlock more specific timetable guidance."
    }
  );

  return { primary, secondary };
}

function getChartCtor() {
  return typeof window !== "undefined" ? window.Chart : null;
}

function setStatChangeClass(el, tone) {
  if (!el) return;
  el.classList.remove("up", "down", "neutral");
  el.classList.add(tone || "neutral");
}

function renderDashboardHeader(header) {
  const title = document.getElementById("dashboard-greeting-title");
  const sub = document.getElementById("dashboard-greeting-sub");
  if (title && header?.title) title.textContent = header.title;
  if (sub && header?.sub) sub.textContent = header.sub;
}

function renderDashboardInsights(insights) {
  const primaryType = document.getElementById("dashboard-insight-primary-type");
  const primaryText = document.getElementById("dashboard-insight-primary-text");
  const secondaryType = document.getElementById("dashboard-insight-secondary-type");
  const secondaryText = document.getElementById("dashboard-insight-secondary-text");

  if (primaryType && insights?.primary?.type) primaryType.textContent = insights.primary.type;
  if (primaryText && insights?.primary?.text) primaryText.textContent = insights.primary.text;
  if (secondaryType && insights?.secondary?.type) secondaryType.textContent = insights.secondary.type;
  if (secondaryText && insights?.secondary?.text) secondaryText.textContent = insights.secondary.text;
}

function renderDashboardStats(stats) {
  const streakValue = document.getElementById("dashboard-study-streak-value");
  const streakChange = document.getElementById("dashboard-study-streak-change");
  const masteryValue = document.getElementById("dashboard-overall-mastery-value");
  const masteryChange = document.getElementById("dashboard-overall-mastery-change");
  const topicsValue = document.getElementById("dashboard-topics-reviewed-value");
  const topicsChange = document.getElementById("dashboard-topics-reviewed-change");
  const timeValue = document.getElementById("dashboard-study-time-today-value");
  const timeChange = document.getElementById("dashboard-study-time-today-change");

  if (streakValue) streakValue.textContent = stats.streakValue;
  if (streakChange) {
    streakChange.textContent = stats.streakChange;
    setStatChangeClass(streakChange, stats.streakValue === "0d" ? "neutral" : "up");
  }
  if (masteryValue) masteryValue.textContent = stats.masteryValue;
  if (masteryChange) {
    masteryChange.textContent = stats.masteryChange;
    setStatChangeClass(masteryChange, stats.masteryChange.startsWith("↑") ? "up" : stats.masteryChange.startsWith("↓") ? "down" : "neutral");
  }
  if (topicsValue) topicsValue.textContent = stats.topicsValue;
  if (topicsChange) {
    topicsChange.textContent = stats.topicsChange;
    setStatChangeClass(topicsChange, "neutral");
  }
  if (timeValue) timeValue.textContent = stats.timeTodayValue;
  if (timeChange) {
    timeChange.textContent = stats.timeTodayChange;
    setStatChangeClass(timeChange, stats.timeTodayChange.startsWith("↑") ? "up" : "neutral");
  }
}

function renderSubjectMastery(subjectMastery) {
  const host = document.getElementById("dashboard-subject-mastery-list");
  if (!host) return;

  host.innerHTML = subjectMastery
    .map((item, index) => `
      <div class="progress-wrap">
        <div class="progress-header"><span class="progress-label">${escapeHtml(item.name)}</span><span class="progress-val">${toInt(item.mastery)}%</span></div>
        <div class="progress-bar"><div class="progress-fill ${fillClassForScore(item.mastery, index)}" style="width:${clamp(item.mastery, 0, 100)}%"></div></div>
      </div>
    `)
    .join("");
}

function renderRecentActivity(activities) {
  const host = document.getElementById("dashboard-recent-activity");
  if (!host) return;

  host.innerHTML = activities
    .map((entry) => `
      <div class="activity-item">
        <div class="activity-dot" style="background:${entry.dotColor || CHART_COLORS.text3}"></div>
        <div class="activity-content">
          <div class="activity-title">${escapeHtml(entry.title)}</div>
          <div class="activity-meta">${escapeHtml(entry.meta)}</div>
        </div>
      </div>
    `)
    .join("");
}

function renderHeatmap(dailyMinutesMap) {
  const host = document.getElementById("heatmap");
  if (!host) return;
  const values = [...dailyMinutesMap.values()];
  host.innerHTML = values
    .map((mins) => {
      const level = mapHeatIntensity(mins);
      return `<div class="heat-cell ${level ? `heat-${level}` : ""}" data-tip="${formatMinutes(mins)}"></div>`;
    })
    .join("");
}

function renderProgressStats(stats) {
  const levelValue = document.getElementById("progress-overall-level-value");
  const levelChange = document.getElementById("progress-overall-level-change");
  const masteredValue = document.getElementById("progress-concepts-mastered-value");
  const masteredChange = document.getElementById("progress-concepts-mastered-change");
  const gapsValue = document.getElementById("progress-gaps-identified-value");
  const gapsChange = document.getElementById("progress-gaps-identified-change");
  const decayValue = document.getElementById("progress-mastery-decay-value");
  const decayChange = document.getElementById("progress-mastery-decay-change");

  if (levelValue) levelValue.textContent = stats.levelValue;
  if (levelChange) {
    levelChange.textContent = stats.levelChange;
    setStatChangeClass(levelChange, stats.levelChange.startsWith("↑") ? "up" : "neutral");
  }

  if (masteredValue) masteredValue.textContent = stats.masteredValue;
  if (masteredChange) {
    masteredChange.textContent = stats.masteredChange;
    setStatChangeClass(masteredChange, "neutral");
  }

  if (gapsValue) gapsValue.textContent = stats.gapsValue;
  if (gapsChange) {
    gapsChange.textContent = stats.gapsChange;
    setStatChangeClass(gapsChange, "neutral");
  }

  if (decayValue) decayValue.textContent = stats.decayValue;
  if (decayChange) {
    decayChange.textContent = stats.decayChange;
    setStatChangeClass(decayChange, stats.decayChange.startsWith("↓") ? "down" : "up");
  }
}

function renderTopicBreakdown(groups) {
  const host = document.getElementById("progress-topic-breakdown");
  if (!host) return;

  host.innerHTML = groups
    .map((group, groupIdx) => `
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:10px;">${escapeHtml(group.title)}</div>
        ${group.items
      .map((item, idx) => `
            <div class="progress-wrap">
              <div class="progress-header"><span class="progress-label">${escapeHtml(item.name)}</span><span class="progress-val">${toInt(item.mastery)}%</span></div>
              <div class="progress-bar"><div class="progress-fill ${fillClassForScore(item.mastery, groupIdx + idx)}" style="width:${clamp(item.mastery, 0, 100)}%"></div></div>
            </div>
          `)
      .join("")}
      </div>
    `)
    .join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function initFeature6(ctx) {
  const { runtime, API, apiGet, scheduleSave, logAudit } = ctx;
  const charts = {
    weekly: null,
    masteryTrend: null,
    errorBreakdown: null
  };
  let lastModel = null;
  let refreshInFlight = null;
  let liveRefreshTimer = null;

  function destroyChart(name) {
    if (charts[name]) {
      charts[name].destroy();
      charts[name] = null;
    }
  }

  async function fetchTimeManagementState() {
    const studentId = runtime.state?.student?.id || "anonymous";
    if (!studentId) return null;
    try {
      const weekStart = getCurrentWeekStart();
      const state = await apiGet(API.timeManagementState(studentId, weekStart));
      return state && typeof state === "object" ? state : null;
    } catch {
      return runtime.state?.timeManagement || null;
    }
  }

  function syncLiveRefreshTimer() {
    const hasActiveFocus = getFocusSessions(runtime.state).some((session) => session?.status === "active" && !session?.endedAt);
    if (hasActiveFocus && !liveRefreshTimer && typeof window !== "undefined") {
      liveRefreshTimer = window.setInterval(() => {
        refreshFeature6(true).catch(() => {});
      }, 60000);
      return;
    }

    if (!hasActiveFocus && liveRefreshTimer && typeof window !== "undefined") {
      window.clearInterval(liveRefreshTimer);
      liveRefreshTimer = null;
    }
  }

  function buildModel(tmState) {
    const baseState = runtime.state || {};
    const safeTmState = tmState || {};
    const forcePreview = shouldForceDashboardPreview();
    const preview = forcePreview || shouldAutoPreviewDashboard(baseState, safeTmState)
      ? buildDashboardPreviewFixture(runtime, safeTmState, forcePreview)
      : null;
    const state = preview?.state || baseState;
    const effectiveTmState = preview?.tmState || safeTmState;
    const responsibleControls = resolveResponsibleControls(state);
    const stateTopics = Array.isArray(state.topics)
      ? state.topics.filter((topic) => normalizeTopicName(topic?.name))
      : [];
    const syntheticTopics = buildSyntheticTopicsFromTimetable(effectiveTmState);
    const topics = mergeTopicSignals(stateTopics, syntheticTopics);
    const dashboardTopics = selectDashboardTopics(topics);
    const subjectSignals = buildSubjectSignals(effectiveTmState);
    const subjectMastery = buildSubjectMastery(subjectSignals);
    const overallMastery = getOverallMastery(state, topics);

    let seeded = false;
    let updated = false;
    if (!preview) {
      seeded = seedSnapshotsIfNeeded(runtime, topics, overallMastery, state);
      updated = upsertTodaySnapshot(runtime, topics, overallMastery);
      if (seeded || updated) scheduleSave();
    }

    const errorBreakdown = responsibleControls.personalization
      ? computeErrorBreakdown(state)
      : { carelessCount: 0, knowledgeCount: 0, carelessPct: 0, knowledgePct: 0 };
    const stats = buildStatsPayload(state, effectiveTmState, dashboardTopics, overallMastery, responsibleControls);
    const recentActivities = buildRecentActivities(state, effectiveTmState);
    const topicBreakdown = buildTopicBreakdown(dashboardTopics);
    const masteryTrend = buildMasteryTrend(runtime, topics, overallMastery, preview?.masterySnapshots || null);
    const dashboardHeader = buildDashboardHeader(runtime, effectiveTmState);
    const dashboardInsights = buildDashboardInsights(dashboardTopics, effectiveTmState, stats.weeklyMinutes, subjectSignals, stats, state);

    return {
      weeklyMinutes: stats.weeklyMinutes,
      errorBreakdown,
      subjectMastery,
      topicBreakdown,
      masteryTrend,
      dashboardHeader,
      dashboardInsights,
      dashboardStats: stats.dashboard,
      progressStats: stats.progress,
      responsibleControls,
      recentActivities,
      dailyMinutes: stats.dailyMinutes
    };
  }

  function renderWeeklyChart(model) {
    const host = document.getElementById("weeklyChart");
    if (!host) return;

    const labels = model.weeklyMinutes.map((item) => item.label);
    const values = model.weeklyMinutes.map((item) => toInt(item.minutes));
    const ChartCtor = getChartCtor();

    if (!ChartCtor) {
      host.innerHTML = model.weeklyMinutes
        .map((item) => `<div class="chart-bar-wrap"><div class="chart-bar" style="height:${clamp(Math.round((item.minutes / Math.max(1, ...values)) * 100), 0, 100)}%;background:${CHART_COLORS.accent};opacity:0.85;"></div><div class="chart-label">${item.label}</div></div>`)
        .join("");
      return;
    }

    host.innerHTML = "<div style='position:relative;width:100%;height:160px;'><canvas id='weeklyChartCanvas'></canvas></div>";
    const canvas = host.querySelector("#weeklyChartCanvas");
    if (!canvas) return;

    destroyChart("weekly");
    charts.weekly = new ChartCtor(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Study Minutes",
            data: values,
            borderRadius: 6,
            backgroundColor: [
              CHART_COLORS.accent,
              CHART_COLORS.accent2,
              CHART_COLORS.accent3,
              CHART_COLORS.accent4,
              CHART_COLORS.accent,
              CHART_COLORS.accent2,
              CHART_COLORS.accent3
            ],
            maxBarThickness: 28
          }
        ]
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                return `${toInt(context.parsed.y || 0)} min`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: false },
            ticks: { color: CHART_COLORS.text3, font: { size: 10 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: CHART_COLORS.border, drawBorder: false },
            ticks: {
              color: CHART_COLORS.text3,
              stepSize: 30,
              callback(value) {
                return `${value}m`;
              }
            }
          }
        }
      }
    });
  }

  function renderMasteryTrendChart(model) {
    const canvas = document.getElementById("progressMasteryTrendChart");
    const empty = document.getElementById("progress-mastery-empty");
    const title = document.getElementById("progress-mastery-trend-title");
    if (!canvas) return;

    const ChartCtor = getChartCtor();
    if (!ChartCtor) return;

    const firstLabel = model.masteryTrend.datasets?.[0]?.label || "Concepts";
    if (title) title.textContent = `Mastery Over Time — ${firstLabel}`;

    destroyChart("masteryTrend");

    if (!model.masteryTrend.hasEnoughData) {
      if (empty) empty.style.display = "flex";
      return;
    }
    if (empty) empty.style.display = "none";

    charts.masteryTrend = new ChartCtor(canvas, {
      type: "line",
      data: {
        labels: model.masteryTrend.labels,
        datasets: model.masteryTrend.datasets
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: "#9898b0",
              usePointStyle: true,
              boxWidth: 8
            }
          }
        },
        scales: {
          x: {
            grid: { color: CHART_COLORS.border, drawBorder: false },
            ticks: { color: CHART_COLORS.text3, maxRotation: 0, autoSkip: true }
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: CHART_COLORS.border, drawBorder: false },
            ticks: {
              color: CHART_COLORS.text3,
              callback(value) {
                return `${value}%`;
              }
            }
          }
        }
      }
    });
  }

  function renderErrorBreakdownChart(model) {
    const canvas = document.getElementById("progressErrorBreakdownChart");
    const centerValue = document.getElementById("progress-error-center-value");
    const gapLabel = document.getElementById("progress-gap-label");
    const carelessLabel = document.getElementById("progress-careless-label");
    if (!canvas) return;

    const personalizationEnabled = model.responsibleControls?.personalization !== false;
    if (!personalizationEnabled) {
      if (centerValue) centerValue.textContent = "Off";
      if (gapLabel) gapLabel.textContent = "Off — Knowledge Gaps";
      if (carelessLabel) carelessLabel.textContent = "Off — Careless Mistakes";
      destroyChart("errorBreakdown");
      const ctx2d = canvas.getContext("2d");
      ctx2d?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const gapPct = model.errorBreakdown.knowledgePct;
    const carelessPct = model.errorBreakdown.carelessPct;
    if (centerValue) centerValue.textContent = `${gapPct}%`;
    if (gapLabel) gapLabel.textContent = `${gapPct}% — Knowledge Gaps`;
    if (carelessLabel) carelessLabel.textContent = `${carelessPct}% — Careless Mistakes`;

    const ChartCtor = getChartCtor();
    if (!ChartCtor) return;

    destroyChart("errorBreakdown");
    charts.errorBreakdown = new ChartCtor(canvas, {
      type: "doughnut",
      data: {
        labels: ["Careless", "Knowledge Gap"],
        datasets: [
          {
            data: [model.errorBreakdown.carelessCount, model.errorBreakdown.knowledgeCount],
            backgroundColor: [CHART_COLORS.accent4, CHART_COLORS.danger],
            borderWidth: 0
          }
        ]
      },
      options: {
        maintainAspectRatio: false,
        cutout: "72%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                const val = toInt(context.parsed || 0);
                return `${context.label}: ${val}`;
              }
            }
          }
        }
      }
    });
  }

  function renderAll(model) {
    renderDashboardHeader(model.dashboardHeader);
    renderDashboardInsights(model.dashboardInsights);
    renderDashboardStats(model.dashboardStats);
    renderSubjectMastery(model.subjectMastery);
    renderRecentActivity(model.recentActivities);
    renderHeatmap(model.dailyMinutes);

    renderProgressStats(model.progressStats);
    renderTopicBreakdown(model.topicBreakdown);
    renderMasteryTrendChart(model);
    renderErrorBreakdownChart(model);
    renderWeeklyChart(model);
  }

  function buildExportPayload(model) {
    const state = runtime.state || {};
    return {
      exportedAt: new Date().toISOString(),
      studentId: state.student?.id || "",
      progress: {
        overallLevel: model?.progressStats?.levelValue || "Lv.1",
        levelChange: model?.progressStats?.levelChange || "",
        conceptsMastered: model?.progressStats?.masteredValue || "0",
        gapsIdentified: model?.progressStats?.gapsValue || "0",
        avgMasteryDecay: model?.progressStats?.decayValue || "0%"
      },
      topicBreakdown: (model?.topicBreakdown || []).map((group) => ({
        group: group.title,
        items: (group.items || []).map((item) => ({
          topic: item.name,
          mastery: toInt(item.mastery)
        }))
      })),
      masteryTrend: {
        labels: model?.masteryTrend?.labels || [],
        datasets: (model?.masteryTrend?.datasets || []).map((dataset) => ({
          label: dataset.label,
          data: Array.isArray(dataset.data) ? dataset.data.map((value) => (value == null ? null : toInt(value))) : []
        }))
      },
      weeklyStudyMinutes: (model?.weeklyMinutes || []).map((item) => ({
        day: item.label,
        minutes: toInt(item.minutes)
      })),
      recentActivities: model?.recentActivities || []
    };
  }

  function downloadProgressReport() {
    const model = lastModel || buildModel({});
    const payload = buildExportPayload(model);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `speedup-progress-report-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    logAudit("Progress report exported.");
    scheduleSave();
  }

  function bindProgressActions() {
    const exportBtn = document.getElementById("progressExportReportBtn");
    if (!exportBtn || exportBtn.dataset.bound) return;
    exportBtn.dataset.bound = "1";
    exportBtn.addEventListener("click", downloadProgressReport);
  }

  async function refreshFeature6() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const tmState = await fetchTimeManagementState();
      const model = buildModel(tmState || {});
      lastModel = model;
      bindProgressActions();
      renderAll(model);
      syncLiveRefreshTimer();
      return model;
    })()
      .catch((error) => {
        logAudit(`Feature 6 render failed: ${error?.message || "unknown error"}`);
        return lastModel;
      })
      .finally(() => {
        refreshInFlight = null;
      });

    return refreshInFlight;
  }

  function initWeeklyChart() {
    if (lastModel) renderWeeklyChart(lastModel);
    else refreshFeature6();
  }

  function initHeatmap() {
    if (lastModel) renderHeatmap(lastModel.dailyMinutes);
    else refreshFeature6();
  }

  return {
    refreshFeature6,
    initWeeklyChart,
    initHeatmap
  };
}
