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

function seedSnapshotsIfNeeded(runtime, topics, overallMastery) {
  const feature6State = ensureFeature6State(runtime);
  if (feature6State.masterySnapshots.length) return false;

  const state = runtime.state || {};
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

function buildMinutesTimeline(state, tmState) {
  const map = createDailyMinutesMap(HISTORY_DAYS);

  (state.auditLog || []).forEach((entry) => {
    const date = String(entry?.ts || "").slice(0, 10);
    if (!map.has(date)) return;
    map.set(date, map.get(date) + 12);
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

function buildWeeklyMinutes(tmState) {
  const minutesByDay = Object.fromEntries(DAY_ORDER.map((day) => [day, 0]));
  const tasks = new Map((tmState?.tasks || []).map((task) => [task.id, task]));

  (tmState?.slots || []).forEach((slot) => {
    const day = String(slot?.day || "").toUpperCase();
    const task = tasks.get(slot?.taskId);
    if (!DAY_ORDER.includes(day) || !task) return;
    const source = String(task?.source || "").toLowerCase();
    const type = String(task?.type || "").toLowerCase();
    if (source === "school" || type === "school-block") return;
    minutesByDay[day] += clamp(task?.estimatedMinutes || 60, 15, 180);
  });

  return DAY_ORDER.map((day) => ({
    day,
    label: DAY_LABELS[day],
    minutes: minutesByDay[day]
  }));
}

function buildTodayMinutes(tmState) {
  const todayDay = getDayToken(new Date());
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

  return { planned, completed };
}

function buildRecentActivities(state, tmState) {
  const feed = [];
  const audits = Array.isArray(state.auditLog) ? state.auditLog : [];
  const recentAudits = audits.slice(-8).reverse();
  recentAudits.forEach((entry, index) => {
    feed.push({
      title: entry?.message || "Learning activity",
      meta: formatRelative(entry?.ts),
      dotColor: [CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.accent4, CHART_COLORS.accent3][index % 4]
    });
  });

  const completedTasks = (tmState?.tasks || [])
    .filter((task) => task?.status === "completed" && task?.completedAt)
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
    .slice(0, 4)
    .map((task, index) => ({
      title: `Completed ${task.title || task.subject || "study session"} · ${clamp(task.estimatedMinutes || 60, 15, 180)} min`,
      meta: formatRelative(task.completedAt),
      dotColor: [CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.accent4, CHART_COLORS.accent3][index % 4]
    }));

  const merged = [...completedTasks, ...feed].slice(0, 6);
  if (merged.length) return merged;
  return [{
    title: "No activity logged yet",
    meta: "Complete a task or ask AI Tutor to start tracking",
    dotColor: CHART_COLORS.text3
  }];
}

function buildSubjectMastery(topics) {
  if (!topics.length) {
    return [{ name: "No topic data yet", mastery: 0 }];
  }
  return topics
    .map((topic) => ({
      name: normalizeTopicName(topic?.name || "Topic"),
      mastery: getMasteryFromTopic(topic)
    }))
    .sort((a, b) => b.mastery - a.mastery)
    .slice(0, 5);
}

function buildTopicBreakdown(topics) {
  if (!topics.length) {
    return [{
      domain: "general",
      title: "Concepts",
      items: [{ name: "No topic data yet", mastery: 0 }]
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

function buildMasteryTrend(runtime, topics, overallMastery) {
  const feature6State = ensureFeature6State(runtime);
  const snapshots = (feature6State.masterySnapshots || [])
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

  return {
    labels,
    datasets,
    hasEnoughData: labels.length >= 2
  };
}

function buildStatsPayload(state, tmState, topics, overallMastery) {
  const previousMastery = getPreviousMastery(state, overallMastery);
  const masteryDelta = toInt(overallMastery - previousMastery);
  const dailyMinutes = buildMinutesTimeline(state, tmState);
  const streakData = computeStreakAndDecay(dailyMinutes, overallMastery);
  const todayMinutes = buildTodayMinutes(tmState);
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
      masteryValue: `${toInt(overallMastery)}%`,
      masteryChange: masteryDelta > 0
        ? `↑ +${masteryDelta}% vs previous`
        : masteryDelta < 0
          ? `↓ ${Math.abs(masteryDelta)}% vs previous`
          : "→ Stable vs previous",
      topicsValue: String(topics.length),
      topicsChange: `→ ${weakCount} pending`,
      timeTodayValue: formatMinutes(todayMinutes.completed || todayMinutes.planned),
      timeTodayChange: todayMinutes.completed > 0
        ? `↑ ${formatMinutes(todayMinutes.completed)} completed`
        : todayMinutes.planned > 0
          ? `→ ${formatMinutes(todayMinutes.planned)} planned`
          : "→ No sessions scheduled"
    },
    progress: {
      levelValue: `Lv.${level}`,
      levelChange: streakData.streakDays > 0 ? `↑ ${streakData.streakDays} day streak` : "→ No streak yet",
      masteredValue: String(masteredCount),
      masteredChange: `→ ${masteredCount} at 70%+ mastery`,
      gapsValue: String(weakCount),
      gapsChange: `→ ${criticalWeak} critical`,
      decayValue: `${streakData.confidenceDecayPct}%`,
      decayChange: streakData.inactivityDays > 0
        ? `↓ ${streakData.inactivityDays} day inactivity`
        : "↑ No inactivity gap"
    },
    streak: streakData,
    dailyMinutes
  };
}

function getChartCtor() {
  return typeof window !== "undefined" ? window.Chart : null;
}

function setStatChangeClass(el, tone) {
  if (!el) return;
  el.classList.remove("up", "down", "neutral");
  el.classList.add(tone || "neutral");
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
      return null;
    }
  }

  function buildModel(tmState) {
    const state = runtime.state || {};
    const topics = Array.isArray(state.topics)
      ? state.topics.filter((topic) => normalizeTopicName(topic?.name))
      : [];
    const subjectMastery = buildSubjectMastery(topics);
    const overallMastery = getOverallMastery(state, topics);

    const seeded = seedSnapshotsIfNeeded(runtime, topics, overallMastery);
    const updated = upsertTodaySnapshot(runtime, topics, overallMastery);
    if (seeded || updated) scheduleSave();

    const weeklyMinutes = buildWeeklyMinutes(tmState || {});
    const errorBreakdown = computeErrorBreakdown(state);
    const stats = buildStatsPayload(state, tmState || {}, topics, overallMastery);
    const recentActivities = buildRecentActivities(state, tmState || {});
    const topicBreakdown = buildTopicBreakdown(topics);
    const masteryTrend = buildMasteryTrend(runtime, topics, overallMastery);

    return {
      weeklyMinutes,
      errorBreakdown,
      subjectMastery,
      topicBreakdown,
      masteryTrend,
      dashboardStats: stats.dashboard,
      progressStats: stats.progress,
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

  async function refreshFeature6(force = false) {
    if (refreshInFlight && !force) return refreshInFlight;
    refreshInFlight = (async () => {
      const tmState = await fetchTimeManagementState();
      const model = buildModel(tmState || {});
      lastModel = model;
      bindProgressActions();
      renderAll(model);
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
