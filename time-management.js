const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DAYS = ["MON", "TUE", "WED", "THU", "FRI"];
const HOURS = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "20:00", "21:00"];

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
        list.push({ day, start, end });
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
      const match = item.match(/^([A-Za-z]+)\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
      if (!match) return;
      try {
        const day = normalizeDay(match[1]);
        const start = normalizeClockTime(match[2]);
        const end = normalizeClockTime(match[3]);
        list.push({ day, start, end });
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
  const t = String(topic || "").toLowerCase();
  if (t.includes("graph") || t.includes("discrete")) return "Discrete Math";
  if (t.includes("vector") || t.includes("algebra")) return "Linear Algebra";
  if (t.includes("algorithm") || t.includes("dp") || t.includes("dynamic")) return "Algorithms";
  if (t.includes("os") || t.includes("operating")) return "Operating Systems";
  return "Study";
}

function normalizeConceptLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
    if (source === "ai") return;

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
      title: `${topic} concept repair`,
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
  return {
    title: String(task?.title || fallback?.title || "Study block").slice(0, 120),
    subject: String(task?.subject || fallback?.subject || inferSubject(task?.topic || "Study")).slice(0, 80),
    topic: String(task?.topic || fallback?.topic || "").slice(0, 120),
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
    "Consider existing timetable coverage and avoid duplicating already-heavy subjects."
  ].join(" ");

  const user = {
    profile,
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
  const subjectHours = {};

  assigned.forEach((slot) => {
    const task = taskById.get(slot.taskId);
    if (!task) return;
    const subject = String(task.subject || "Study");
    subjectHours[subject] = Number(subjectHours[subject] || 0) + 1;
  });

  const occupiedSlots = assigned.length;
  const occupiedByDay = {};
  assigned.forEach((slot) => {
    occupiedByDay[slot.day] = Number(occupiedByDay[slot.day] || 0) + 1;
  });

  return { occupiedSlots, occupiedByDay, subjectHours };
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
  const assignedSlots = slots.filter((slot) => slot.taskId);
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
    .filter((entry) => entry.task);
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
  const mode = input.mode === "school_blocks" ? "school_blocks" : "productive_hours";
  const schoolBlocks = parseSchoolBlocksInput(input.schoolBlocks, input.schoolBlocksText);
  const productiveHours = parseHourRangesInput(input.productiveHours, input.productiveHoursText);
  const examDates = parseExamDates(input.examDates, input.examDatesText);
  const weeklyGoalsHours = clampInt(input.weeklyGoalsHours, 1, 60, 14);

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
  const stats = computeStats(tasks, slots, profile);
  const agenda = buildAgenda(weekStart, tasks, slots);

  return {
    studentId,
    weekStart,
    profile,
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
  const occupiedSlots = replaceExisting ? 0 : (existingSlots || []).filter((slot) => slot.taskId).length;
  const availableBlockCount = Math.max(1, weeklyGoalHours - occupiedSlots);
  const existingSummary = buildExistingTimetableSummary(existingTasks, existingSlots);
  const existingSessions = buildExistingSessionsContext(existingTasks, existingSlots);
  const existingTaskSignals = extractExistingTaskSignals(existingTasks);

  const inputWeak = normalizeTopicList(weakConcepts);
  const inputRisk = normalizeTopicList(forgettingRiskTopics);

  // Prioritize the student's current manual timetable sessions first.
  // Global weak topics are used as secondary signals.
  const effectiveWeak = mergeUniqueConcepts(existingTaskSignals.concepts, inputWeak).slice(0, 4);
  const weakKeys = new Set(effectiveWeak.map((item) => String(item || "").toLowerCase()));
  const signalRisk = (existingTaskSignals.concepts || []).filter((concept) => !weakKeys.has(String(concept || "").toLowerCase()));
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

  let tasks = (Array.isArray(ai.tasks) && ai.tasks.length ? ai.tasks : baselineTasks).slice(0, availableBlockCount);
  tasks = injectExistingCoverageTasks(tasks, existingTaskSignals, availableBlockCount);

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

  const { callOpenAIChat, safeParseJson, isOpenAIConfigured, normalizeStudentId } = deps;

  const saveProfileHandler = async (req, res) => {
    try {
      await schemaReady;
      const studentId = normalizeStudentId(req.params.studentId);
      const profile = await saveProfile(db, studentId, req.body || {});
      res.json({ ok: true, studentId, profile, updatedAt: nowIso() });
    } catch (error) {
      handleRouteError(res, "Failed to save time management profile", error);
    }
  };

  app.get("/api/time-management/:studentId", async (req, res) => {
    try {
      await schemaReady;
      const studentId = normalizeStudentId(req.params.studentId);
      const weekStart = normalizeWeekStart(req.query.weekStart);
      const state = await fetchWeekState(db, studentId, weekStart);
      res.json(state);
    } catch (error) {
      handleRouteError(res, "Failed to load time management state", error);
    }
  });

  app.put("/api/time-management/:studentId/profile", saveProfileHandler);
  app.post("/api/time-management/:studentId/profile", saveProfileHandler);

  app.post("/api/time-management/:studentId/generate-plan", async (req, res) => {
    try {
      await schemaReady;
      const studentId = normalizeStudentId(req.params.studentId);
      const weekStart = parseWeekFromRequest(req);
      const profile = await getProfile(db, studentId);
      const payload = req.body || {};
      const replaceExisting = Boolean(payload.replaceExisting);
      const weakConcepts = normalizeTopicList(payload.weakConcepts);
      const forgettingRiskTopics = normalizeTopicList(payload.forgettingRiskTopics);
      const currentState = await fetchWeekState(db, studentId, weekStart);
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
        profile,
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

  app.post("/api/time-management/:studentId/tasks", async (req, res) => {
    try {
      await schemaReady;
      const studentId = normalizeStudentId(req.params.studentId);
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

  app.put("/api/time-management/:studentId/tasks/:taskId", async (req, res) => {
    try {
      await schemaReady;
      const studentId = normalizeStudentId(req.params.studentId);
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

  app.delete("/api/time-management/:studentId/tasks/:taskId", async (req, res) => {
    try {
      await schemaReady;
      const studentId = normalizeStudentId(req.params.studentId);
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

  app.put("/api/time-management/:studentId/slots/:day/:hour", async (req, res) => {
    try {
      await schemaReady;
      const studentId = normalizeStudentId(req.params.studentId);
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

  app.delete("/api/time-management/:studentId/slots/:day/:hour", async (req, res) => {
    try {
      await schemaReady;
      const studentId = normalizeStudentId(req.params.studentId);
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

  app.delete("/api/time-management/:studentId/week/:weekStart", async (req, res) => {
    try {
      await schemaReady;
      const studentId = normalizeStudentId(req.params.studentId);
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
