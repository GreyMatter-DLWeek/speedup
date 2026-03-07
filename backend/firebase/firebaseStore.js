const { getFirestore } = require("./firebaseAdmin");

const COLLECTION = "speedup_users";
const MAX_STATE_BYTES = 850000;

function userDoc(uid) {
  return getFirestore().collection(COLLECTION).doc(uid);
}

async function getUserState(uid) {
  const doc = await userDoc(uid).get();
  if (!doc.exists) return {};
  return doc.data()?.state || {};
}

async function setUserState(uid, state) {
  const normalizedState = normalizeState(uid, state);
  const payloadBytes = Buffer.byteLength(JSON.stringify(normalizedState), "utf8");
  if (payloadBytes > MAX_STATE_BYTES) {
    const error = new Error(`State payload too large (${payloadBytes} bytes).`);
    error.code = "STATE_TOO_LARGE";
    throw error;
  }
  await userDoc(uid).set(
    {
      state: normalizedState,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
  return true;
}

async function appendAuditEvent(uid, message) {
  const current = await getUserState(uid);
  current.auditLog = current.auditLog || [];
  current.auditLog.push({ ts: new Date().toISOString(), message: String(message || "") });
  current.auditLog = current.auditLog.slice(-300);
  await setUserState(uid, current);
  return current;
}

module.exports = {
  getUserState,
  setUserState,
  appendAuditEvent
};

function normalizeState(uid, state) {
  const safeUid = String(uid || "").trim();
  const source = state && typeof state === "object" ? state : {};
  const next = { ...source };

  next.student = next.student && typeof next.student === "object" ? { ...next.student } : {};
  next.student.id = safeUid;
  next.student.name = String(next.student.name || "").slice(0, 120);
  next.student.focus = String(next.student.focus || "").slice(0, 600);
  next.student.productiveSlot = String(next.student.productiveSlot || "").slice(0, 40);
  next.student.weeklyHours = Number(next.student.weeklyHours || 0);

  next.auditLog = Array.isArray(next.auditLog) ? next.auditLog.slice(-300) : [];
  next.tutorHistory = Array.isArray(next.tutorHistory) ? next.tutorHistory.slice(-200) : [];

  const uploads = Array.isArray(next.practiceUploads) ? next.practiceUploads : [];
  next.practiceUploads = uploads.slice(0, 40).map((item) => ({
    ...item,
    uploadId: String(item?.uploadId || "").slice(0, 120),
    name: String(item?.name || "").slice(0, 220),
    type: String(item?.type || "").slice(0, 120),
    source: String(item?.source || "").slice(0, 220),
    sourceTextSnippet: String(item?.sourceTextSnippet || "").slice(0, 6000),
    url: String(item?.url || "").slice(0, 1200),
    storagePath: String(item?.storagePath || "").slice(0, 400),
    fileProvider: String(item?.fileProvider || "").slice(0, 80),
    analysis: normalizeAnalysis(item?.analysis)
  }));

  next.sprintCurrent = normalizeSprintCurrent(next.sprintCurrent);
  next.sprintHistory = Array.isArray(next.sprintHistory)
    ? next.sprintHistory.slice(0, 120).map((row) => ({
      sprintId: String(row?.sprintId || "").slice(0, 120),
      topic: String(row?.topic || "").slice(0, 140),
      difficulty: String(row?.difficulty || "").slice(0, 20),
      total: Number(row?.total || 0),
      correct: Number(row?.correct || 0),
      score: Number(row?.score || 0),
      elapsedSec: Number(row?.elapsedSec || 0),
      createdAt: String(row?.createdAt || "").slice(0, 40),
      mistakeBreakdown: normalizeMistakeBreakdown(row?.mistakeBreakdown)
    }))
    : [];

  return next;
}

function normalizeAnalysis(analysis) {
  const a = analysis && typeof analysis === "object" ? analysis : {};
  return {
    summary: String(a.summary || "").slice(0, 1400),
    difficultyLevel: String(a.difficultyLevel || "").slice(0, 40),
    likelyTopics: Array.isArray(a.likelyTopics) ? a.likelyTopics.slice(0, 12).map((x) => String(x || "").slice(0, 100)) : [],
    weakSignals: Array.isArray(a.weakSignals) ? a.weakSignals.slice(0, 12).map((x) => String(x || "").slice(0, 180)) : [],
    recommendedNextSteps: Array.isArray(a.recommendedNextSteps)
      ? a.recommendedNextSteps.slice(0, 8).map((x) => String(x || "").slice(0, 260))
      : []
  };
}

function normalizeSprintCurrent(current) {
  if (!current || typeof current !== "object") return null;
  return {
    sprintId: String(current.sprintId || "").slice(0, 120),
    topic: String(current.topic || "").slice(0, 140),
    difficulty: String(current.difficulty || "").slice(0, 20),
    startedAt: String(current.startedAt || "").slice(0, 40),
    questions: Array.isArray(current.questions)
      ? current.questions.slice(0, 10).map((q, i) => ({
        id: String(q?.id || `q${i + 1}`).slice(0, 30),
        question: String(q?.question || "").slice(0, 500),
        options: Array.isArray(q?.options) ? q.options.slice(0, 4).map((v) => String(v || "").slice(0, 180)) : [],
        answer: String(q?.answer || "").slice(0, 240),
        explanation: String(q?.explanation || "").slice(0, 600)
      }))
      : []
  };
}

function normalizeMistakeBreakdown(breakdown) {
  const safe = breakdown && typeof breakdown === "object" ? breakdown : {};
  return {
    concept_gap: Number(safe.concept_gap || 0),
    careless: Number(safe.careless || 0),
    time_pressure: Number(safe.time_pressure || 0),
    misread_question: Number(safe.misread_question || 0)
  };
}

