const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

function tryRequire(name) {
  try {
    return require(name);
  } catch {
    return null;
  }
}

const express = require("express");
const cors = require("cors");
const multer = tryRequire("multer");
const mammoth = tryRequire("mammoth");
const pdfParse = tryRequire("pdf-parse");
const JSZip = tryRequire("jszip");
const cloudinaryModule = tryRequire("cloudinary");
const cloudinary = cloudinaryModule?.v2 || null;
const { isFirebaseConfigured, getFirestore } = require("./firebase/firebaseAdmin");
const { requireFirebaseAuth } = require("./firebase/firebaseAuth");
const { getUserState, setUserState, appendAuditEvent } = require("./firebase/firebaseStore");
const timeManagementModule = tryRequire("../time-management");
const registerTimeManagementRoutes = timeManagementModule?.registerTimeManagementRoutes || null;

const app = express();
const port = Number(process.env.PORT || 3000);
const requestCounters = new Map();
const FRONTEND_PUBLIC_DIR = path.resolve(__dirname, "../frontend/public");

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS blocked for origin."));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(express.static(FRONTEND_PUBLIC_DIR));
app.use((req, res, next) => {
  req.requestId = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  next();
});

const upload = multer
  ? multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }
  })
  : { single: () => (_req, res) => res.status(503).json({ error: "File upload feature unavailable. Missing dependencies." }) };

const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  },
  rag: {
    collection: process.env.FIREBASE_RAG_COLLECTION || "speedup_rag_notes"
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || ""
  }
};

if (cloudinary && config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret
  });
}

app.get("/api/health", async (req, res) => {
  res.json({
    ok: true,
    services: {
      openaiConfigured: Boolean(config.openai.apiKey && config.openai.model),
      ragConfigured: Boolean(isFirebaseConfigured()),
      firebaseConfigured: Boolean(isFirebaseConfigured()),
      fileStorageConfigured: Boolean(isCloudinaryConfigured())
    },
    timestamp: new Date().toISOString()
  });
});

function withRateLimit(bucket, limit, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${bucket}:${req.ip || "unknown"}`;
    const current = requestCounters.get(key);
    if (!current || now - current.windowStart >= windowMs) {
      requestCounters.set(key, { count: 1, windowStart: now });
      return next();
    }
    if (current.count >= limit) {
      return res.status(429).json({ error: "Too many requests. Please try again in a moment." });
    }
    current.count += 1;
    requestCounters.set(key, current);
    return next();
  };
}

app.get("/api/user/profile", requireFirebaseAuth, async (req, res) => {
  const u = req.firebaseUser || {};
  return res.json({
    ok: true,
    user: {
      uid: u.uid,
      email: u.email || "",
      name: u.name || "Student"
    }
  });
});

app.put("/api/user/profile", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const current = mergeDeep(createMinimalState(uid), await getUserState(uid));
    const next = {
      name: cleanText(req.body?.name, 80),
      focus: cleanText(req.body?.focus, 220),
      productiveSlot: cleanText(req.body?.productiveSlot, 30),
      weeklyHours: Number(req.body?.weeklyHours || 0)
    };
    if (next.name) current.student.name = next.name;
    if (next.focus || next.focus === "") current.student.focus = next.focus;
    if (next.productiveSlot || next.productiveSlot === "") current.student.productiveSlot = next.productiveSlot;
    if (!Number.isNaN(next.weeklyHours)) current.student.weeklyHours = Math.max(0, Math.min(60, next.weeklyHours));
    await setUserState(uid, current);
    return res.json({ ok: true, profile: current.student });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update profile. Please try again." });
  }
});

app.get("/api/user/state", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const state = await getUserState(uid);
    return res.json({ ok: true, state });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load user state. Please try again." });
  }
});

app.put("/api/user/state", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const state = req.body?.state;
    if (!state || typeof state !== "object") return res.status(400).json({ error: "state object is required." });
    await setUserState(uid, state);
    return res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(500).json({ error: "Failed to save user state. Please try again." });
  }
});

app.get("/api/user/bootstrap", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const state = await getUserState(uid);
    const hydrated = mergeDeep(createMinimalState(uid), state);
    const notesPack = await buildNotesPack(hydrated);
    const dashboard = buildDashboardPack(hydrated);
    const timetable = buildTimetablePack(hydrated);
    const flashcards = buildFlashcards(notesPack.paragraphs);
    const recommendations = await buildRecommendationPack(hydrated);
    const progress = buildProgressPack(hydrated);
    return res.json({
      ok: true,
      state: hydrated,
      dashboard,
      notes: notesPack,
      timetable,
      flashcards,
      recommendations,
      progress
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load dashboard data. Please try again." });
  }
});

app.post("/api/user/event", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const message = cleanText(req.body?.message, 400);
    if (!message) return res.status(400).json({ error: "message is required." });
    const state = await appendAuditEvent(uid, message);
    return res.json({ ok: true, state });
  } catch (error) {
    return res.status(500).json({ error: "Failed to save event. Please try again." });
  }
});

app.post("/api/user/exam", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const name = cleanText(req.body?.name, 160);
    const score = Number(req.body?.score);
    const hours = Number(req.body?.hours);
    const confidence = Number(req.body?.confidence);
    if (!name || Number.isNaN(score) || Number.isNaN(hours) || Number.isNaN(confidence)) {
      return res.status(400).json({ error: "name, score, hours, confidence are required." });
    }

    const state = mergeDeep(createMinimalState(uid), await getUserState(uid));
    state.examHistory = state.examHistory || [];
    state.mastery = state.mastery || [];
    state.auditLog = state.auditLog || [];
    state.examHistory.push({
      name,
      score: Math.max(0, Math.min(100, score)),
      hours: Math.max(0, hours),
      confidence: Math.max(1, Math.min(10, confidence)),
      date: new Date().toISOString().slice(0, 10)
    });
    const lastMastery = state.mastery.length ? Number(state.mastery[state.mastery.length - 1]) : estimateMasteryFromHistory(state.examHistory);
    state.mastery.push(Math.max(20, Math.min(99, Math.round((lastMastery * 0.65) + (score * 0.35)))));
    state.auditLog.push({ ts: new Date().toISOString(), message: `Exam added: ${name} (${score}%).` });
    state.auditLog = state.auditLog.slice(-300);
    await setUserState(uid, state);
    return res.json({ ok: true, state });
  } catch (error) {
    return res.status(500).json({ error: "Failed to save exam. Please try again." });
  }
});

app.post("/api/user/controls", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const controls = req.body?.controls;
    if (!controls || typeof controls !== "object") return res.status(400).json({ error: "controls object is required." });
    const state = mergeDeep(createMinimalState(uid), await getUserState(uid));
    state.responsibleControls = mergeDeep(state.responsibleControls || {}, controls);
    state.auditLog = state.auditLog || [];
    state.auditLog.push({ ts: new Date().toISOString(), message: "Responsible controls updated." });
    state.auditLog = state.auditLog.slice(-300);
    await setUserState(uid, state);
    return res.json({ ok: true, state });
  } catch (error) {
    return res.status(500).json({ error: "Failed to save settings. Please try again." });
  }
});

app.get("/api/state/:studentId", requireFirebaseAuth, async (req, res) => {
  try {
    const studentId = resolveAuthorizedStudentId(req, req.params.studentId);
    const state = await loadStateWithFallback(studentId);
    res.json(state || {});
  } catch (error) {
    handleError(res, "Failed to load student state", error);
  }
});

app.put("/api/state/:studentId", requireFirebaseAuth, async (req, res) => {
  try {
    const studentId = resolveAuthorizedStudentId(req, req.params.studentId);
    const state = req.body;
    if (!state || typeof state !== "object") {
      return res.status(400).json({ error: "Invalid state payload." });
    }
    await saveStateToBlob(studentId, state);

    res.json({ ok: true, studentId, savedAt: new Date().toISOString() });
  } catch (error) {
    handleError(res, "Failed to save student state", error);
  }
});

app.post("/api/explain", requireFirebaseAuth, withRateLimit("explain", 40, 60 * 1000), async (req, res) => {
  try {
    const paragraph = cleanText(req.body?.paragraph, 4000);
    const attempt = Number(req.body?.attempt || 0);
    const feedback = cleanText(req.body?.feedback, 800);
    const topicHint = cleanText(req.body?.topicHint, 160);
    if (!paragraph || typeof paragraph !== "string") {
      return res.status(400).json({ error: "paragraph is required." });
    }

    const prompt = [
      "You are an educational AI tutor for university students.",
      "Return strict JSON with keys: concept, context, example, check, confidenceLabel.",
      "Explanations must be clear, concise, and actionable.",
      "If attempt > 0 or feedback says not clear, simplify using plain language and short sentences.",
      "Do not invent source citations."
    ].join(" ");

    const userContent = {
      paragraph,
      attempt,
      feedback,
      topicHint
    };

    const output = await callOpenAIChat([
      { role: "system", content: prompt },
      { role: "user", content: JSON.stringify(userContent) }
    ], 0.2);

    const parsed = safeParseJson(output);
    if (parsed) {
      return res.json({
        ...parsed,
        provider: "openai-api"
      });
    }

    res.json({
      concept: paragraph.split(".")[0] + ".",
      context: "This concept often appears in exam questions requiring both speed and accuracy.",
      example: "Practice one worked example, then solve one timed question without notes.",
      check: "Can you restate this rule in one sentence and apply it to a fresh question?",
      confidenceLabel: attempt > 0 ? `Simplified x${attempt + 1}` : "High Confidence",
      provider: "fallback"
    });
  } catch (error) {
    handleError(res, "Failed to generate explanation", error);
  }
});

app.post("/api/tutor/query", requireFirebaseAuth, withRateLimit("tutor_query", 60, 60 * 1000), async (req, res) => {
  try {
    const contextType = cleanText(req.body?.contextType || "active-reading", 40).toLowerCase();
    const question = cleanText(req.body?.question, 2000);
    const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
    if (!question) return res.status(400).json({ error: "question is required." });

    const ownerId = normalizeStudentId(req.firebaseUser?.uid || "");
    const evidence = buildTutorEvidence(contextType, context);

    let ragHits = [];
    try {
      ragHits = await searchDocuments(question, 4, ownerId);
    } catch {
      ragHits = [];
    }

    const ragCitations = ragHits.map((hit) => ({
      docName: cleanText(hit.title || "Indexed Notes", 160),
      page: "RAG",
      quote: cleanText(hit.snippet || "", 220),
      jumpRef: "study-notes",
      sourceType: "retrieval"
    }));

    const baselineCitations = dedupeTutorCitations([...(evidence.citations || []), ...ragCitations]).slice(0, 6);

    const system = [
      "You are SpeedUp AI Tutor.",
      "Always stay within the supplied context scope.",
      "Return strict JSON with keys: answer, citations, actions.",
      "citations must be an array of {docName,page,quote,jumpRef,sourceType}.",
      "actions must be an array of up to 4 items with keys {type,label,target,jumpRef,text}.",
      "If evidence is weak, clearly state uncertainty and ask user to expand scope."
    ].join(" ");

    const userPayload = {
      contextType,
      question,
      scope: evidence.scope,
      localCitations: baselineCitations,
      retrievedNotes: ragHits.map((h) => ({ title: h.title, source: h.source, snippet: h.snippet }))
    };

    let parsed = null;
    let provider = "fallback";
    try {
      const raw = await callOpenAIChat([
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(userPayload) }
      ], 0.2);
      parsed = safeParseJson(raw);
      provider = "openai-api";
    } catch {
      parsed = null;
      provider = "fallback";
    }

    const fallback = buildTutorFallback(contextType, question, evidence.scope, baselineCitations);
    const answer = cleanText(parsed?.answer || fallback.answer, 2800);
    const citations = dedupeTutorCitations((parsed?.citations || []).map(normalizeTutorCitation).filter(Boolean).length
      ? (parsed?.citations || []).map(normalizeTutorCitation).filter(Boolean)
      : fallback.citations);
    const actions = normalizeTutorActions(parsed?.actions, contextType, citations, answer, fallback.actions);

    return res.json({
      ok: true,
      provider,
      contextType,
      scope: evidence.scope,
      answer,
      citations,
      actions
    });
  } catch (error) {
    handleError(res, "Failed to generate tutor response", error);
  }
});

app.post("/api/highlight/analyze", requireFirebaseAuth, withRateLimit("highlight", 50, 60 * 1000), async (req, res) => {
  try {
    const text = cleanText(req.body?.text, 3000);
    const topic = cleanText(req.body?.topic || "General", 120) || "General";
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required." });
    }

    const prompt = [
      "You are an academic learning assistant.",
      "Return strict JSON with keys: summary, context, followUpQuestion.",
      "Summary max 25 words. Context max 35 words."
    ].join(" ");

    const output = await callOpenAIChat([
      { role: "system", content: prompt },
      { role: "user", content: JSON.stringify({ text, topic }) }
    ], 0.2);

    const parsed = safeParseJson(output);
    if (parsed) {
      return res.json({ ...parsed, provider: "openai-api" });
    }

    res.json({
      summary: text.split(" ").slice(0, 20).join(" ") + (text.split(" ").length > 20 ? "..." : ""),
      context: `Revisit ${topic} with one worked example and one timed check.`,
      followUpQuestion: "What common mistake should you avoid when applying this concept?",
      provider: "fallback"
    });
  } catch (error) {
    handleError(res, "Failed to analyze highlight", error);
  }
});

app.post("/api/rag/query", requireFirebaseAuth, withRateLimit("rag_query", 80, 60 * 1000), async (req, res) => {
  try {
    const query = cleanText(req.body?.query, 300);
    const topK = Number(req.body?.topK || 5);
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required." });
    }
    const ownerId = normalizeStudentId(req.firebaseUser?.uid || "");
    const hits = await searchDocuments(query, topK, ownerId);
    res.json({ query, hits });
  } catch (error) {
    handleError(res, "Failed to query RAG index", error);
  }
});

app.post("/api/rag/index-note", requireFirebaseAuth, withRateLimit("rag_index", 40, 60 * 1000), async (req, res) => {
  try {
    const title = cleanText(req.body?.title || "", 200);
    const text = cleanText(req.body?.text, 20000);
    const source = cleanText(req.body?.source || "notes", 80) || "notes";
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required." });
    }
    const ownerId = normalizeStudentId(req.firebaseUser?.uid || "");
    const docId = await indexRagNote({
      studentId: ownerId,
      title: String(title || ""),
      text: String(text || ""),
      source: String(source || "notes")
    });
    res.json({ ok: true, docId });
  } catch (error) {
    handleError(res, "Failed to index note", error);
  }
});

app.post("/api/recommendations", requireFirebaseAuth, withRateLimit("recommend", 20, 60 * 1000), async (req, res) => {
  try {
    const learningState = req.body?.state;
    if (!learningState || typeof learningState !== "object") {
      return res.status(400).json({ error: "state is required." });
    }
    const normalizedState = normalizeLearningState(learningState);
    const hasSignal = Boolean(
      (normalizedState.topics || []).length ||
      (normalizedState.examHistory || []).length ||
      (normalizedState.mastery || []).length
    );
    const deterministic = buildDeterministicPlan(normalizedState);
    if (!hasSignal) {
      return res.json({
        recommendation: deterministic.recommendation,
        qualityCheck: deterministic.qualityCheck,
        why: deterministic.why,
        nextActions: deterministic.nextActions,
        sources: [],
        provider: "deterministic"
      });
    }

    const weaknessQuery = (normalizedState.topics || [])
      .slice(0, 3)
      .map((t) => t.name)
      .join(" ") || "study skills";

    let sources = [];
    try {
      sources = await searchDocuments(weaknessQuery, 4, normalizeStudentId(normalizedState?.student?.id || ""));
    } catch {
      sources = [];
    }

    const system = [
      "You are an educational planning assistant.",
      "Return strict JSON with keys: recommendation, qualityCheck, why, nextActions.",
      "nextActions must be an array of exactly 3 actionable strings.",
      "why must cite concrete evidence from the provided student metrics and retrieved context.",
      "Keep advice consistent with the deterministic baseline plan if present."
    ].join(" ");

    const user = {
      learningState: normalizedState,
      deterministicBaseline: deterministic,
      retrievedContext: sources.map((s) => ({ title: s.title, source: s.source, snippet: s.snippet }))
    };

    const raw = await callOpenAIChat([
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) }
    ], 0.2);

    const parsed = safeParseJson(raw);
    if (parsed && Array.isArray(parsed.nextActions)) {
      return res.json({
        recommendation: cleanText(parsed.recommendation, 600) || deterministic.recommendation,
        qualityCheck: cleanText(parsed.qualityCheck, 400) || deterministic.qualityCheck,
        why: cleanText(parsed.why, 700) || deterministic.why,
        nextActions: cleanList(parsed.nextActions, 3, 180).length ? cleanList(parsed.nextActions, 3, 180) : deterministic.nextActions,
        sources,
        provider: "openai-api-rag"
      });
    }

    res.json({
      recommendation: deterministic.recommendation,
      qualityCheck: deterministic.qualityCheck,
      why: deterministic.why,
      nextActions: deterministic.nextActions,
      sources,
      provider: "deterministic"
    });
  } catch (error) {
    handleError(res, "Failed to generate recommendations", error);
  }
});

if (registerTimeManagementRoutes) {
  registerTimeManagementRoutes(app, {
    callOpenAIChat,
    safeParseJson,
    isOpenAIConfigured,
    normalizeStudentId,
    requireFirebaseAuth,
    resolveAuthorizedStudentId,
    upload,
    pdfParse,
    mammoth
  });
} else {
  console.warn("Time management routes disabled: optional dependency `sqlite3` is missing.");
}

app.post("/api/live/event/:studentId", requireFirebaseAuth, async (req, res) => {
  try {
    const studentId = resolveAuthorizedStudentId(req, req.params.studentId);
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message is required." });
    const current = await loadStateWithFallback(studentId);
    const state = mergeDeep(createMinimalState(studentId), current);
    state.auditLog = state.auditLog || [];
    state.auditLog.push({ ts: new Date().toISOString(), message });
    state.auditLog = state.auditLog.slice(-250);
    await saveStateToBlob(studentId, state);
    res.json({ ok: true, message: "event logged", state });
  } catch (error) {
    handleError(res, "Failed to log live event", error);
  }
});

app.post("/api/live/exam/:studentId", requireFirebaseAuth, async (req, res) => {
  try {
    const studentId = resolveAuthorizedStudentId(req, req.params.studentId);
    const name = String(req.body?.name || "").trim();
    const score = Number(req.body?.score);
    const hours = Number(req.body?.hours);
    const confidence = Number(req.body?.confidence);
    if (!name || Number.isNaN(score) || Number.isNaN(hours) || Number.isNaN(confidence)) {
      return res.status(400).json({ error: "name, score, hours, confidence are required." });
    }

    const current = await loadStateWithFallback(studentId);
    const state = mergeDeep(createMinimalState(studentId), current);
    state.examHistory = state.examHistory || [];
    state.mastery = state.mastery || [];
    state.auditLog = state.auditLog || [];

    state.examHistory.push({
      name,
      score: Math.max(0, Math.min(100, score)),
      hours: Math.max(0, hours),
      confidence: Math.max(1, Math.min(10, confidence)),
      date: new Date().toISOString().slice(0, 10)
    });
    const lastMastery = state.mastery.length ? Number(state.mastery[state.mastery.length - 1]) : estimateMasteryFromHistory(state.examHistory);
    state.mastery.push(Math.max(20, Math.min(99, Math.round((lastMastery * 0.65) + (score * 0.35)))));
    state.auditLog.push({ ts: new Date().toISOString(), message: `Exam added: ${name} (${score}%).` });
    state.auditLog = state.auditLog.slice(-250);

    await saveStateToBlob(studentId, state);
    res.json({ ok: true, state });
  } catch (error) {
    handleError(res, "Failed to add exam", error);
  }
});

app.post("/api/live/controls/:studentId", requireFirebaseAuth, async (req, res) => {
  try {
    const studentId = resolveAuthorizedStudentId(req, req.params.studentId);
    const controls = req.body?.controls;
    if (!controls || typeof controls !== "object") {
      return res.status(400).json({ error: "controls object is required." });
    }
    const current = await loadStateWithFallback(studentId);
    const state = mergeDeep(createMinimalState(studentId), current);
    state.responsibleControls = mergeDeep(state.responsibleControls || {}, controls);
    state.auditLog = state.auditLog || [];
    state.auditLog.push({ ts: new Date().toISOString(), message: "Responsible AI controls updated." });
    state.auditLog = state.auditLog.slice(-250);
    await saveStateToBlob(studentId, state);
    res.json({ ok: true, state });
  } catch (error) {
    handleError(res, "Failed to update controls", error);
  }
});

app.post("/api/practice/analyze", requireFirebaseAuth, withRateLimit("practice", 15, 60 * 1000), upload.single("paper"), async (req, res) => {
  try {
    const pastedText = String(req.body?.pastedText || "").trim();
    const topic = String(req.body?.topic || "General").trim() || "General";
    const file = req.file || null;

    if (!file && !pastedText) {
      return res.status(400).json({ error: "Upload a file or paste text." });
    }

    let extractedText = pastedText;
    let source = "pasted-text";
    let fileMeta = null;

    const uid = normalizeStudentId(req.firebaseUser?.uid || "");

    if (file) {
      extractedText = await extractTextFromFile(file);
      source = file.originalname || "uploaded-file";
      fileMeta = {
        name: file.originalname,
        type: file.mimetype,
        size: file.size
      };
      const uploadInfo = await maybeStoreUploadedFile(uid, file).catch(() => null);
      if (uploadInfo?.storagePath) fileMeta.storagePath = uploadInfo.storagePath;
      if (uploadInfo?.url) fileMeta.url = uploadInfo.url;
      if (uploadInfo?.provider) fileMeta.provider = uploadInfo.provider;
    }

    if (!extractedText || extractedText.trim().length < 20) {
      return res.status(400).json({ error: "Could not extract enough readable text from input." });
    }

    const prompt = [
      "You are an educational assessment analyzer.",
      "Return strict JSON with keys:",
      "summary, likelyTopics, difficultyLevel, weakSignals, recommendedNextSteps.",
      "likelyTopics and weakSignals must be arrays of short strings.",
      "recommendedNextSteps must be exactly 3 actionable strings."
    ].join(" ");

    const fallback = {
      summary: "Practice paper ingested. Run targeted drills on repeated mistakes and do one timed reattempt.",
      likelyTopics: [topic],
      difficultyLevel: "Medium",
      weakSignals: ["Needs concept-to-application consistency"],
      recommendedNextSteps: [
        "Redo 5 missed questions and explain each answer choice.",
        "Create one-page formula/concept sheet for weak areas.",
        "Do a 30-minute timed mixed-question set."
      ]
    };

    let parsed = null;
    let provider = "fallback";
    try {
      const modelOut = await callOpenAIChat(
        [
          { role: "system", content: prompt },
          { role: "user", content: JSON.stringify({ topic, source, text: snippet(extractedText, 9000) }) }
        ],
        0.2
      );
      parsed = safeParseJson(modelOut);
      provider = "openai-api";
    } catch {
      parsed = null;
      provider = "fallback";
    }

    const analysis = parsed || fallback;
    await applyPracticeSignals(uid, analysis).catch(() => null);
    const sourceTextSnippet = snippet(extractedText, 6000);
    const uploadId = createPracticeUploadId();
    await persistPracticeUpload(uid, {
      uploadId,
      name: fileMeta?.name || "Pasted Text Input",
      type: fileMeta?.type || "text/plain",
      size: Number(fileMeta?.size || pastedText.length || 0),
      source,
      textLength: extractedText.length,
      sourceTextSnippet,
      analysis,
      date: new Date().toISOString().slice(0, 10),
      url: fileMeta?.url || "",
      storagePath: fileMeta?.storagePath || "",
      fileProvider: fileMeta?.provider || ""
    }).catch(() => null);

    res.json({
      ok: true,
      provider,
      source,
      uploadId,
      file: fileMeta,
      textLength: extractedText.length,
      sourceTextSnippet,
      analysis
    });
  } catch (error) {
    handleError(res, "Failed to analyze practice paper", error);
  }
});

app.get("/api/practice/uploads", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = normalizeStudentId(req.firebaseUser?.uid || "");
    const state = mergeDeep(createMinimalState(uid), await getUserState(uid));
    const { uploads, changed } = normalizePracticeUploads(state.practiceUploads || []);
    if (changed) {
      state.practiceUploads = uploads;
      await setUserState(uid, state);
    }
    return res.json({ ok: true, uploads });
  } catch (error) {
    handleError(res, "Failed to load practice uploads", error);
  }
});

app.delete("/api/practice/uploads/:uploadId", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = normalizeStudentId(req.firebaseUser?.uid || "");
    const targetId = cleanText(req.params.uploadId, 120);
    if (!targetId) return res.status(400).json({ error: "uploadId is required." });

    const state = mergeDeep(createMinimalState(uid), await getUserState(uid));
    const { uploads, changed } = normalizePracticeUploads(state.practiceUploads || []);
    const found = uploads.find((u) => String(u.uploadId) === targetId);
    if (!found) return res.status(404).json({ error: "Upload source not found." });

    state.practiceUploads = uploads.filter((u) => String(u.uploadId) !== targetId);
    state.auditLog = state.auditLog || [];
    state.auditLog.push({ ts: new Date().toISOString(), message: `Practice source deleted: ${found.name || targetId}` });
    state.auditLog = state.auditLog.slice(-300);
    await setUserState(uid, state);

    await maybeDeleteStoredFile(found).catch(() => null);
    return res.json({ ok: true, deleted: 1, uploads: state.practiceUploads, normalized: changed });
  } catch (error) {
    handleError(res, "Failed to delete practice upload", error);
  }
});

app.post("/api/practice/uploads/delete-bulk", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = normalizeStudentId(req.firebaseUser?.uid || "");
    const ids = cleanList(req.body?.uploadIds, 100, 120);
    if (!ids.length) return res.status(400).json({ error: "uploadIds is required." });

    const idSet = new Set(ids);
    const state = mergeDeep(createMinimalState(uid), await getUserState(uid));
    const { uploads } = normalizePracticeUploads(state.practiceUploads || []);
    const matched = uploads.filter((u) => idSet.has(String(u.uploadId)));
    if (!matched.length) return res.status(404).json({ error: "No matching upload sources found." });

    state.practiceUploads = uploads.filter((u) => !idSet.has(String(u.uploadId)));
    state.auditLog = state.auditLog || [];
    state.auditLog.push({ ts: new Date().toISOString(), message: `Practice sources deleted: ${matched.length}` });
    state.auditLog = state.auditLog.slice(-300);
    await setUserState(uid, state);

    await Promise.allSettled(matched.map((item) => maybeDeleteStoredFile(item)));
    return res.json({ ok: true, deleted: matched.length, uploads: state.practiceUploads });
  } catch (error) {
    handleError(res, "Failed to bulk delete practice uploads", error);
  }
});

app.post("/api/practice/generate-quiz", requireFirebaseAuth, withRateLimit("practice_quiz", 20, 60 * 1000), async (req, res) => {
  try {
    const sourceText = cleanText(req.body?.sourceText, 20000);
    const difficulty = normalizeDifficulty(req.body?.difficulty);
    const questionType = normalizeQuestionType(req.body?.questionType);
    const numQuestions = Math.max(1, Math.min(20, Number(req.body?.numQuestions || 5)));

    if (!sourceText || sourceText.length < 40) {
      return res.status(400).json({ error: "sourceText is required and must contain enough context." });
    }

    const fallbackQuiz = buildFallbackQuizFromSource(sourceText, {
      numQuestions,
      difficulty,
      questionType
    });

    let provider = "fallback";
    let modelQuiz = null;
    try {
      const prompt = [
        "You are an assessment generator for student revision.",
        "Return strict JSON with key quiz only.",
        "quiz must be an object with keys: title, difficulty, questionType, questions.",
        "questions must be an array with EXACTLY the requested number of items.",
        "each question item keys: question, options, answer, explanation.",
        "If questionType is mcq, options must contain exactly 4 choices.",
        "Use only the provided source text."
      ].join(" ");
      const out = await callOpenAIChat(
        [
          { role: "system", content: prompt },
          {
            role: "user",
            content: JSON.stringify({
              difficulty,
              questionType,
              numQuestions,
              sourceText: snippet(sourceText, 14000)
            })
          }
        ],
        0.2
      );
      const parsed = safeParseJson(out);
      modelQuiz = normalizeQuizPayload(parsed?.quiz, { numQuestions, difficulty, questionType });
      provider = "openai-api";
    } catch {
      modelQuiz = null;
      provider = "fallback";
    }

    const quiz = modelQuiz?.questions?.length ? modelQuiz : fallbackQuiz;
    return res.json({
      ok: true,
      provider,
      quiz
    });
  } catch (error) {
    handleError(res, "Failed to generate quiz", error);
  }
});

app.post("/api/practice/generate-flashcards", requireFirebaseAuth, withRateLimit("practice_flashcards", 20, 60 * 1000), async (req, res) => {
  try {
    const sourceText = cleanText(req.body?.sourceText, 20000);
    const count = Math.max(1, Math.min(30, Number(req.body?.count || 8)));

    if (!sourceText || sourceText.length < 40) {
      return res.status(400).json({ error: "sourceText is required and must contain enough context." });
    }

    const fallback = {
      title: "Generated Flashcards",
      cards: buildFallbackFlashcards(sourceText, count)
    };

    let provider = "fallback";
    let flashcards = null;
    try {
      const prompt = [
        "You are a flashcard generator for exam revision.",
        "Return strict JSON with key flashcards only.",
        "flashcards must be an object with keys: title, cards.",
        "cards must be an array with EXACTLY the requested count.",
        "each card keys: question, answer.",
        "Use only the provided source text."
      ].join(" ");
      const out = await callOpenAIChat(
        [
          { role: "system", content: prompt },
          {
            role: "user",
            content: JSON.stringify({
              count,
              sourceText: snippet(sourceText, 14000)
            })
          }
        ],
        0.2
      );
      const parsed = safeParseJson(out);
      flashcards = normalizeFlashcardsPayload(parsed?.flashcards, count);
      provider = "openai-api";
    } catch {
      flashcards = null;
      provider = "fallback";
    }

    return res.json({
      ok: true,
      provider,
      flashcards: flashcards?.cards?.length ? flashcards : fallback
    });
  } catch (error) {
    handleError(res, "Failed to generate flashcards", error);
  }
});

app.get("/api/live/bootstrap/:studentId", requireFirebaseAuth, async (req, res) => {
  try {
    const studentId = resolveAuthorizedStudentId(req, req.params.studentId);
    const state = await loadStateWithFallback(studentId);
    const hydrated = mergeDeep(createMinimalState(studentId), state);
    const notesPack = await buildNotesPack(hydrated);
    const dashboard = buildDashboardPack(hydrated);
    const timetable = buildTimetablePack(hydrated);
    const flashcards = buildFlashcards(notesPack.paragraphs);
    const recommendations = await buildRecommendationPack(hydrated);
    const progress = buildProgressPack(hydrated);

    res.json({
      ok: true,
      state: hydrated,
      dashboard,
      notes: notesPack,
      timetable,
      flashcards,
      recommendations,
      progress
    });
  } catch (error) {
    handleError(res, "Failed to build live bootstrap payload", error);
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.resolve(FRONTEND_PUBLIC_DIR, "index.html"));
});

startServer(port);

function startServer(preferredPort, attempt = 0) {
  const candidatePort = Number(preferredPort) + attempt;
  const server = app.listen(candidatePort, () => {
    console.log(`SpeedUp server running on http://localhost:${candidatePort}`);
  });

  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE" && attempt < 10) {
      console.warn(`Port ${candidatePort} is in use. Trying ${candidatePort + 1}...`);
      try {
        server.close();
      } catch {
        // ignore
      }
      setTimeout(() => startServer(preferredPort, attempt + 1), 50);
      return;
    }

    console.error("Server failed to start", error?.message || error);
    process.exit(1);
  });
}

function normalizeStudentId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-");
}

function trimSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function cleanText(value, max = 8000) {
  return String(value || "")
    .replace(/\0/g, "")
    .trim()
    .slice(0, max);
}

function cleanList(input, maxItems = 10, maxItemLength = 120) {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => cleanText(v, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function handleError(res, label, error) {
  console.error(label, error?.message || error);
  res.status(500).json({ error: `${label}. Please try again.` });
}

function safeParseJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function callOpenAIChat(messages, temperature = 0.2) {
  if (!isOpenAIConfigured()) {
    throw new Error("OpenAI API is not configured.");
  }

  const endpoint = `${trimSlash(config.openai.baseUrl)}/chat/completions`;
  const requestBody = {
    model: config.openai.model,
    messages,
    temperature,
    max_tokens: 800,
    response_format: { type: "json_object" }
  };

  let response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  let payload = await response.json();
  if (!response.ok && isTemperatureUnsupported(payload?.error?.message)) {
    delete requestBody.temperature;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    payload = await response.json();
  }

  if (!response.ok) {
    const errMsg = payload?.error?.message || "OpenAI request failed.";
    // Fallback for responses-only models.
    if (errMsg.includes("supported in v1/responses")) {
      return callOpenAIResponses(messages, temperature);
    }
    // Fallback for legacy non-chat completion models.
    if (errMsg.includes("not a chat model")) {
      return callOpenAICompletions(messages, temperature);
    }
    throw new Error(errMsg);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response.");
  }
  return content;
}

async function callOpenAICompletions(messages, temperature = 0.2) {
  const endpoint = `${trimSlash(config.openai.baseUrl)}/completions`;
  const prompt = messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
  const requestBody = {
    model: config.openai.model,
    prompt,
    temperature,
    max_tokens: 800
  };

  let response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  let payload = await response.json();
  if (!response.ok && isTemperatureUnsupported(payload?.error?.message)) {
    delete requestBody.temperature;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    payload = await response.json();
  }

  if (!response.ok) {
    const errMsg = payload?.error?.message || "OpenAI completions request failed.";
    if (errMsg.includes("supported in v1/responses")) {
      return callOpenAIResponses(messages, temperature);
    }
    throw new Error(errMsg);
  }

  const text = payload?.choices?.[0]?.text;
  if (!text) {
    throw new Error("OpenAI completions returned empty response.");
  }
  return text;
}

async function callOpenAIResponses(messages, temperature = 0.2) {
  const endpoint = `${trimSlash(config.openai.baseUrl)}/responses`;
  const input = messages.map((m) => ({
    role: m.role,
    content: [{ type: "input_text", text: String(m.content || "") }]
  }));

  const requestBody = {
    model: config.openai.model,
    input,
    temperature,
    text: { format: { type: "json_object" } }
  };

  let response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openai.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  let payload = await response.json();
  if (!response.ok && isTemperatureUnsupported(payload?.error?.message)) {
    delete requestBody.temperature;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    payload = await response.json();
  }

  // Some models may not support structured text format.
  if (!response.ok && /Unsupported parameter/i.test(payload?.error?.message || "") && /text\.format/i.test(payload?.error?.message || "")) {
    delete requestBody.text;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openai.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
    payload = await response.json();
  }

  if (!response.ok) {
    throw new Error(payload?.error?.message || "OpenAI responses request failed.");
  }

  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const joined = (payload?.output || [])
    .flatMap((item) => item?.content || [])
    .map((part) => part?.text || "")
    .join("")
    .trim();

  if (!joined) {
    throw new Error("OpenAI responses returned empty output.");
  }
  return joined;
}

async function searchDocuments(query, topK = 5, ownerId = "") {
  if (!isFirebaseConfigured()) return [];
  const raw = String(query || "").toLowerCase().trim();
  if (!raw) return [];

  const tokens = raw.split(/\s+/).filter((t) => t.length > 1).slice(0, 12);
  const snap = await getFirestore()
    .collection(config.rag.collection)
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  const scored = [];
  snap.forEach((doc) => {
    const data = doc.data() || {};
    if (ownerId && normalizeStudentId(data.studentId || "") !== ownerId) return;
    const text = String(data.text || "").toLowerCase();
    const title = String(data.title || "");
    if (!text) return;
    let score = 0;
    for (const token of tokens) {
      if (text.includes(token)) score += 2;
      if (title.toLowerCase().includes(token)) score += 3;
    }
    if (score > 0) {
      scored.push({
        id: doc.id,
        title: title || "Untitled",
        snippet: snippet(data.text || ""),
        source: data.source || "student-note",
        score
      });
    }
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(10, Number(topK) || 5)))
    .map(({ score, ...rest }) => rest);
}

function snippet(text, max = 260) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return value.slice(0, Math.max(1, max - 3)) + "...";
}

function resolveAuthorizedStudentId(req, requestedStudentId) {
  const tokenUid = normalizeStudentId(req?.firebaseUser?.uid || "");
  if (!tokenUid) throw new Error("Unauthorized user context.");
  const requested = normalizeStudentId(requestedStudentId || tokenUid);
  if (requested && requested !== tokenUid) {
    throw new Error("Forbidden student scope.");
  }
  return tokenUid;
}

function normalizeDifficulty(value) {
  const raw = String(value || "").toLowerCase().trim();
  if (["easy", "medium", "hard"].includes(raw)) return raw;
  return "medium";
}

function normalizeQuestionType(value) {
  const raw = String(value || "").toLowerCase().trim();
  if (["mcq", "short-answer", "true-false", "mixed"].includes(raw)) return raw;
  return "mcq";
}

function splitSourceIntoKeyLines(sourceText, max = 30) {
  return String(sourceText || "")
    .replace(/\r/g, "\n")
    .split(/[\n.?!]+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 20)
    .slice(0, max);
}

function buildFallbackQuizFromSource(sourceText, { numQuestions, difficulty, questionType }) {
  const lines = splitSourceIntoKeyLines(sourceText, 40);
  const questions = [];
  for (let i = 0; i < numQuestions; i += 1) {
    const seed = lines[i % Math.max(1, lines.length)] || "Review the core idea from your uploaded material.";
    const q = {
      question: `Based on your notes, explain this idea in your own words: ${seed}`,
      options: [],
      answer: "A clear explanation should define the concept and include one applied example.",
      explanation: "Use a definition + one example + one pitfall to show mastery."
    };
    if (questionType === "mcq" || questionType === "mixed") {
      q.question = `Which option best reflects this statement: ${seed}`;
      q.options = [
        "A direct interpretation of the statement.",
        "An unrelated concept from another topic.",
        "A partially correct but incomplete interpretation.",
        "A contradictory interpretation."
      ];
      q.answer = "A direct interpretation of the statement.";
      q.explanation = "Option A matches the source statement most accurately.";
    } else if (questionType === "true-false") {
      q.question = `True or False: ${seed}`;
      q.answer = "True";
      q.explanation = "The statement is drawn from the provided source text.";
    }
    questions.push(q);
  }
  return {
    title: "Generated Quiz",
    difficulty,
    questionType,
    questions
  };
}

function normalizeQuizPayload(quiz, { numQuestions, difficulty, questionType }) {
  if (!quiz || typeof quiz !== "object") return null;
  const normalizedQuestions = Array.isArray(quiz.questions)
    ? quiz.questions
      .map((q) => {
        const question = cleanText(q?.question, 400);
        const answer = cleanText(q?.answer, 300);
        const explanation = cleanText(q?.explanation, 400);
        let options = [];
        if (Array.isArray(q?.options)) {
          options = q.options.map((o) => cleanText(o, 180)).filter(Boolean).slice(0, 4);
        }
        if (!question || !answer) return null;
        if ((questionType === "mcq" || questionType === "mixed") && options.length < 4) {
          options = [
            "Most accurate interpretation.",
            "Common misconception.",
            "Partially correct statement.",
            "Unrelated statement."
          ];
        }
        return { question, options, answer, explanation };
      })
      .filter(Boolean)
    : [];

  let questions = normalizedQuestions.slice(0, numQuestions);
  if (questions.length < numQuestions) {
    const fallback = buildFallbackQuizFromSource(quiz?.title || "", { numQuestions, difficulty, questionType }).questions;
    questions = questions.concat(fallback.slice(0, numQuestions - questions.length));
  }

  return {
    title: cleanText(quiz?.title, 140) || "Generated Quiz",
    difficulty: normalizeDifficulty(quiz?.difficulty || difficulty),
    questionType: normalizeQuestionType(quiz?.questionType || questionType),
    questions: questions.slice(0, numQuestions)
  };
}

function buildFallbackFlashcards(sourceText, count) {
  const lines = splitSourceIntoKeyLines(sourceText, Math.max(12, count * 2));
  const cards = [];
  for (let i = 0; i < count; i += 1) {
    const line = lines[i % Math.max(1, lines.length)] || "Review a core concept from your source text.";
    cards.push({
      question: `What is the key idea in: "${line}"?`,
      answer: "Summarize the concept, then give one concrete example from your notes."
    });
  }
  return cards;
}

function normalizeFlashcardsPayload(flashcards, count) {
  if (!flashcards || typeof flashcards !== "object") return null;
  const cards = Array.isArray(flashcards.cards)
    ? flashcards.cards
      .map((c) => {
        const question = cleanText(c?.question, 280);
        const answer = cleanText(c?.answer, 420);
        if (!question || !answer) return null;
        return { question, answer };
      })
      .filter(Boolean)
    : [];

  let result = cards.slice(0, count);
  if (result.length < count) {
    const filler = buildFallbackFlashcards("", count - result.length);
    result = result.concat(filler.slice(0, count - result.length));
  }

  return {
    title: cleanText(flashcards.title, 140) || "Generated Flashcards",
    cards: result.slice(0, count)
  };
}

async function loadStateWithFallback(studentId) {
  if (!isFirebaseConfigured()) return {};
  try {
    return await getUserState(studentId);
  } catch {
    return {};
  }
}

async function saveStateToBlob(studentId, state) {
  if (!isFirebaseConfigured()) return false;
  await setUserState(studentId, state);
  return true;
}

function createMinimalState(studentId) {
  return {
    student: {
      id: studentId,
      name: "",
      focus: "",
      productiveSlot: "",
      weeklyHours: 0
    },
    mastery: [],
    topics: [],
    highlights: [],
    notes: {},
    practiceUploads: [],
    focusSessions: [],
    dashboardFeedback: {},
    examHistory: [],
    responsibleControls: {},
    auditLog: []
  };
}

async function buildNotesPack(state) {
  const existingParagraphs = Object.values(state.notes || {}).map((n) => n?.text).filter(Boolean);
  return {
    title: String(state.student?.focus || "").trim() || "Notes",
    paragraphs: existingParagraphs.slice(0, 6)
  };
}

function buildDashboardPack(state) {
  const masterySeries = (state.mastery || []).slice(-8);
  const latestMastery = masterySeries.length ? masterySeries[masterySeries.length - 1] : estimateMasteryFromHistory(state.examHistory || []);
  const weakTopics = (state.topics || [])
    .slice()
    .sort((a, b) => Number(b.weakScore || 0) - Number(a.weakScore || 0))
    .slice(0, 5);
  const weekly = buildWeeklyActivity(state.auditLog || []);
  const heatmap = buildHeatmap((state.auditLog || []).map((a) => a.ts));

  return {
    latestMastery,
    weakTopics,
    weekly,
    heatmap,
    activities: (state.auditLog || []).slice(-8).reverse()
  };
}

function buildTimetablePack(state) {
  const slot = state.student?.productiveSlot || "";
  const weeklyHours = Number(state.student?.weeklyHours || 0);
  const labels = {
    morning: "09:00-11:00",
    afternoon: "13:00-15:00",
    evening: "20:00-22:00",
    late: "22:00-00:00"
  };
  const topics = (state.topics || []).slice(0, 5).map((t) => t.name).filter(Boolean);
  if (!slot || !weeklyHours || !topics.length) {
    return {
      slot,
      window: "",
      blocks: []
    };
  }
  const perDay = Math.max(1, Math.round(weeklyHours / 5));
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  return {
    slot,
    window: labels[slot] || labels.afternoon,
    blocks: days.map((d, i) => ({
      day: d,
      topic: topics[i % topics.length],
      durationHours: perDay
    }))
  };
}

function buildFlashcards(paragraphs) {
  return (paragraphs || [])
    .slice(0, 5)
    .map((p, idx) => {
      const first = String(p).split(".")[0] || `Concept ${idx + 1}`;
      return {
        q: `Explain: ${first.trim()}?`,
        a: String(p).trim()
      };
    });
}

async function buildRecommendationPack(state) {
  const normalized = normalizeLearningState(state);
  const deterministic = buildDeterministicPlan(normalized);
  const hasSignal = Boolean((normalized.topics || []).length || (normalized.examHistory || []).length || (normalized.mastery || []).length);
  if (!hasSignal) {
    return {
      recommendation: deterministic.recommendation,
      qualityCheck: deterministic.qualityCheck,
      why: deterministic.why,
      nextActions: deterministic.nextActions,
      sources: [],
      provider: "deterministic"
    };
  }
  const weaknessQuery = (normalized.topics || []).slice(0, 3).map((t) => t.name).join(" ") || "study improvement";
  const sources = await searchDocuments(weaknessQuery, 4, normalizeStudentId(normalized?.student?.id || "")).catch(() => []);
  try {
    const out = await callOpenAIChat(
      [
        {
          role: "system",
          content: "Return strict JSON: {\"recommendation\":string,\"qualityCheck\":string,\"why\":string,\"nextActions\":string[3]}"
        },
        {
          role: "user",
          content: JSON.stringify({
            learningState: normalized,
            deterministicBaseline: deterministic,
            sources
          })
        }
      ],
      0.2
    );
    const parsed = safeParseJson(out);
    if (parsed?.nextActions?.length) {
      return {
        recommendation: cleanText(parsed.recommendation, 600) || deterministic.recommendation,
        qualityCheck: cleanText(parsed.qualityCheck, 400) || deterministic.qualityCheck,
        why: cleanText(parsed.why, 700) || deterministic.why,
        nextActions: cleanList(parsed.nextActions, 3, 180).length ? cleanList(parsed.nextActions, 3, 180) : deterministic.nextActions,
        sources,
        provider: "openai-api"
      };
    }
  } catch {
    // fallback below
  }
  return {
    recommendation: deterministic.recommendation,
    qualityCheck: deterministic.qualityCheck,
    why: deterministic.why,
    nextActions: deterministic.nextActions,
    sources,
    provider: "deterministic"
  };
}

function buildProgressPack(state) {
  const exams = state.examHistory || [];
  const avgScore = exams.length ? Math.round(exams.reduce((a, b) => a + Number(b.score || 0), 0) / exams.length) : 0;
  const trend = exams.length >= 2 ? Number(exams[exams.length - 1].score || 0) - Number(exams[exams.length - 2].score || 0) : 0;
  return {
    avgScore,
    trend,
    attempts: exams.length,
    masterySeries: (state.mastery || []).slice(-10)
  };
}

function normalizeLearningState(state) {
  const safe = state && typeof state === "object" ? state : {};
  const topics = Array.isArray(safe.topics)
    ? safe.topics
      .map((t) => ({
        name: cleanText(t?.name, 120),
        weakScore: Math.max(0, Math.min(100, Number(t?.weakScore || 0))),
        reason: cleanText(t?.reason, 220)
      }))
      .filter((t) => t.name)
    : [];
  const examHistory = Array.isArray(safe.examHistory)
    ? safe.examHistory
      .map((e) => ({
        name: cleanText(e?.name, 120),
        score: Math.max(0, Math.min(100, Number(e?.score || 0))),
        hours: Math.max(0, Number(e?.hours || 0)),
        confidence: Math.max(1, Math.min(10, Number(e?.confidence || 1))),
        date: cleanText(e?.date, 20)
      }))
      .filter((e) => e.name)
    : [];
  const mastery = Array.isArray(safe.mastery)
    ? safe.mastery.map((m) => Math.max(0, Math.min(100, Number(m || 0)))).slice(-20)
    : [];
  return {
    student: {
      id: cleanText(safe?.student?.id, 80),
      productiveSlot: cleanText(safe?.student?.productiveSlot, 40),
      weeklyHours: Math.max(0, Math.min(60, Number(safe?.student?.weeklyHours || 0)))
    },
    topics,
    examHistory,
    mastery
  };
}

function buildDeterministicPlan(state) {
  const weak = [...(state.topics || [])]
    .sort((a, b) => Number(b.weakScore || 0) - Number(a.weakScore || 0))
    .slice(0, 3);
  const latestMastery = state.mastery?.length ? Number(state.mastery[state.mastery.length - 1]) : 0;
  const hours = Math.max(2, Number(state.student?.weeklyHours || 6));
  const focusTopic = weak[0]?.name || "your weakest topic";
  const trend = getScoreTrend(state.examHistory || []);
  const recommendation = `Prioritize ${focusTopic} in ${Math.min(5, Math.max(2, Math.round(hours / 2)))} focused sessions this week, then run one timed mixed practice set.`;
  const whyParts = [];
  if (weak.length) whyParts.push(`Weakest topic risk is ${weak[0].weakScore} for ${focusTopic}`);
  if (latestMastery) whyParts.push(`latest mastery is ${latestMastery}%`);
  if (trend !== null) whyParts.push(`score trend is ${trend >= 0 ? "+" : ""}${trend.toFixed(1)} points`);
  const why = whyParts.length ? `${whyParts.join("; ")}.` : "Plan generated from your available learning data.";
  const nextActions = [
    `Do a 25-minute drill on ${focusTopic} and correct every error immediately.`,
    "Run one 20-minute timed mixed quiz and log mistakes by concept.",
    "Review mistakes after 24 hours and reattempt only previously incorrect questions."
  ];
  return {
    recommendation,
    qualityCheck: "Verify improvement by comparing timed quiz score and confidence before vs after this plan.",
    why,
    nextActions
  };
}

function getScoreTrend(examHistory) {
  if (!Array.isArray(examHistory) || examHistory.length < 2) return null;
  const recent = examHistory.slice(-4).map((e) => Number(e.score || 0));
  if (recent.length < 2) return null;
  return recent[recent.length - 1] - recent[0];
}

function buildWeeklyActivity(auditLog) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const counts = Object.fromEntries(days.map((d) => [d, 0]));
  for (const entry of auditLog || []) {
    const dt = new Date(entry.ts);
    if (Number.isNaN(dt.getTime())) continue;
    const day = days[(dt.getDay() + 6) % 7];
    counts[day] += 1;
  }
  return days.map((d) => ({ day: d, value: counts[d] }));
}

function buildHeatmap(timestamps) {
  const days = 16 * 7;
  const today = new Date();
  const map = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const key = `${yyyy}-${mm}-${dd}`;
    const val = (timestamps || []).filter((ts) => String(ts).slice(0, 10) === key).length;
    map.push(Math.min(4, val));
  }
  return map;
}

function estimateMasteryFromHistory(history) {
  if (!history?.length) return 0;
  const avg = history.reduce((a, b) => a + Number(b.score || 0), 0) / history.length;
  return Math.max(0, Math.min(100, Math.round(avg)));
}

function mergeDeep(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (Array.isArray(value)) {
      target[key] = value;
    } else if (value && typeof value === "object") {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      mergeDeep(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

async function extractTextFromFile(file) {
  if (!pdfParse || !mammoth || !JSZip) {
    throw new Error("Document parsing dependencies are missing. Please run npm install.");
  }
  const original = String(file.originalname || "");
  const ext = path.extname(original).toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  const buffer = file.buffer;

  if (!buffer || !buffer.length) {
    throw new Error("Uploaded file is empty.");
  }

  if (ext === ".txt" || mime.startsWith("text/")) {
    return buffer.toString("utf8");
  }

  if (ext === ".pdf" || mime.includes("pdf")) {
    const out = await pdfParse(buffer);
    return out.text || "";
  }

  if (ext === ".docx" || mime.includes("wordprocessingml")) {
    const out = await mammoth.extractRawText({ buffer });
    return out.value || "";
  }

  if (ext === ".pptx" || mime.includes("presentationml")) {
    return extractTextFromPptx(buffer);
  }

  throw new Error(`Unsupported file type: ${ext || mime}`);
}

async function extractTextFromPptx(buffer) {
  if (!JSZip) {
    throw new Error("PPTX parsing dependency is missing. Please run npm install.");
  }
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  let text = "";
  for (const f of slideFiles) {
    const xml = await zip.files[f].async("string");
    const chunks = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]));
    if (chunks.length) {
      text += chunks.join(" ") + "\n";
    }
  }
  return text.trim();
}

function decodeXml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

async function maybeStoreUploadedFile(uid, file) {
  if (!cloudinary) return null;
  if (String(process.env.ENABLE_FILE_STORAGE || "true").toLowerCase() === "false") return null;
  if (!isCloudinaryConfigured()) return null;
  if (!file?.buffer?.length) return null;
  const safeUid = String(uid || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "-");
  const ext = path.extname(file.originalname || "").toLowerCase().replace(".", "") || "bin";
  const folder = `speedup/practice-papers/${safeUid}`;
  const publicId = `${Date.now()}-${safeUid}`;

  const uploaded = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder,
        public_id: publicId,
        format: ext,
        use_filename: false,
        unique_filename: false
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(file.buffer);
  });

  return {
    provider: "cloudinary",
    storagePath: uploaded?.public_id || "",
    url: uploaded?.secure_url || uploaded?.url || ""
  };
}

async function persistPracticeUpload(uid, item) {
  if (!uid || !isFirebaseConfigured()) return false;
  const current = await getUserState(uid);
  const state = mergeDeep(createMinimalState(uid), current);
  const { uploads } = normalizePracticeUploads(state.practiceUploads || []);
  state.practiceUploads = uploads;
  state.practiceUploads.unshift({
    ...item,
    uploadId: cleanText(item?.uploadId, 120) || createPracticeUploadId(),
    createdAt: new Date().toISOString()
  });
  state.practiceUploads = state.practiceUploads.slice(0, 30);
  state.auditLog = state.auditLog || [];
  state.auditLog.push({
    ts: new Date().toISOString(),
    message: `Practice upload analyzed: ${item.name}`
  });
  state.auditLog = state.auditLog.slice(-300);
  await setUserState(uid, state);
  return true;
}

function createPracticeUploadId() {
  return `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePracticeUploads(items) {
  const rows = Array.isArray(items) ? items : [];
  let changed = false;
  const used = new Set();
  const uploads = rows.map((item, index) => {
    const rawId = cleanText(item?.uploadId, 120);
    let uploadId = rawId || `legacy_${Date.now().toString(36)}_${index.toString(36)}`;
    if (used.has(uploadId)) uploadId = `${uploadId}_${index}`;
    used.add(uploadId);
    if (!rawId || rawId !== uploadId) changed = true;
    return {
      ...item,
      uploadId,
      createdAt: cleanText(item?.createdAt, 40) || ""
    };
  });
  return { uploads, changed };
}

async function maybeDeleteStoredFile(item) {
  if (!cloudinary || !isCloudinaryConfigured()) return false;
  const pathValue = cleanText(item?.storagePath, 240);
  if (!pathValue) return false;
  await cloudinary.uploader.destroy(pathValue, { resource_type: "raw", invalidate: true });
  return true;
}

async function applyPracticeSignals(uid, analysis) {
  if (!uid || !isFirebaseConfigured()) return false;
  const state = mergeDeep(createMinimalState(uid), await getUserState(uid));
  const topics = cleanList(analysis?.likelyTopics, 5, 100);
  const weakSignals = cleanList(analysis?.weakSignals, 6, 140);
  state.topics = Array.isArray(state.topics) ? state.topics : [];
  topics.forEach((name) => {
    const idx = state.topics.findIndex((t) => String(t?.name || "").toLowerCase() === name.toLowerCase());
    if (idx === -1) {
      state.topics.push({
        name,
        weakScore: 55,
        reason: weakSignals[0] || "Detected from recent practice analysis."
      });
      return;
    }
    const current = state.topics[idx];
    current.weakScore = Math.max(0, Math.min(100, Math.round((Number(current.weakScore || 50) * 0.8) + 12)));
    if (weakSignals[0]) current.reason = weakSignals[0];
    state.topics[idx] = current;
  });
  await setUserState(uid, state);
  return true;
}

function isOpenAIConfigured() {
  return Boolean(config.openai.apiKey && config.openai.model);
}

function isCloudinaryConfigured() {
  return Boolean(cloudinary && config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret);
}

async function indexRagNote({ studentId, title, text, source }) {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured.");
  }
  const docId = `${studentId}-${Date.now()}`;
  await getFirestore().collection(config.rag.collection).doc(docId).set({
    studentId,
    title: String(title || "Untitled"),
    text: String(text || ""),
    source: String(source || "notes"),
    createdAt: new Date().toISOString()
  });
  return docId;
}

function isTemperatureUnsupported(message) {
  return /Unsupported parameter/i.test(String(message || "")) && /temperature/i.test(String(message || ""));
}

function buildTutorEvidence(contextType, context) {
  const safeContext = context && typeof context === "object" ? context : {};
  const type = String(contextType || "active-reading").toLowerCase();

  if (type === "study-notes") {
    const packName = cleanText(safeContext.packName || "Study Pack", 140) || "Study Pack";
    const section = cleanText(safeContext.section || "", 140);
    const selection = cleanText(safeContext.selection || "", 700);
    const highlights = Array.isArray(safeContext.highlights) ? safeContext.highlights.slice(0, 5) : [];
    const citations = [];
    if (selection) {
      citations.push({
        docName: packName,
        page: section || "Section",
        quote: selection,
        jumpRef: "study-notes",
        sourceType: "selection"
      });
    }
    highlights.forEach((h, idx) => {
      const quote = cleanText(h?.text || h?.summary || "", 220);
      if (!quote) return;
      citations.push({
        docName: packName,
        page: cleanText(h?.section || section || `S${idx + 1}`, 40),
        quote,
        jumpRef: "study-notes",
        sourceType: "pack"
      });
    });
    return {
      scope: {
        label: `Context: Study Pack (${packName}${section ? ` · ${section}` : ""})`,
        contextType: "study-notes",
        packName,
        section
      },
      citations
    };
  }

  if (type === "practice-papers") {
    const sourceName = cleanText(safeContext.sourceName || "Practice Paper", 160) || "Practice Paper";
    const questionText = cleanText(safeContext.questionText || "", 900);
    const markingScheme = cleanText(safeContext.markingScheme || "", 900);
    const linkedNote = cleanText(safeContext.linkedNote || "", 220);
    const questionId = cleanText(safeContext.questionId || "Q", 40) || "Q";
    const citations = [];
    if (questionText) {
      citations.push({
        docName: sourceName,
        page: questionId,
        quote: questionText,
        jumpRef: "practice",
        sourceType: "question"
      });
    }
    if (markingScheme) {
      citations.push({
        docName: `${sourceName} Marking`,
        page: questionId,
        quote: markingScheme,
        jumpRef: "practice",
        sourceType: "marking"
      });
    }
    if (linkedNote) {
      citations.push({
        docName: "Study Notes",
        page: "Linked",
        quote: linkedNote,
        jumpRef: "study-notes",
        sourceType: "revision-link"
      });
    }
    return {
      scope: {
        label: `Context: Practice (${sourceName}${questionId ? ` · ${questionId}` : ""})`,
        contextType: "practice-papers",
        sourceName,
        questionId
      },
      citations
    };
  }

  const docName = cleanText(safeContext.docName || "Current Reading", 160) || "Current Reading";
  const page = cleanText(String(safeContext.page || safeContext.pageNumber || "Current page"), 40) || "Current page";
  const selection = cleanText(safeContext.selection || "", 700);
  const paragraph = cleanText(safeContext.currentParagraph || "", 900);
  const jumpRef = cleanText(safeContext.jumpRef || "notesBody", 80) || "notesBody";
  const highlights = Array.isArray(safeContext.highlights) ? safeContext.highlights.slice(0, 4) : [];
  const citations = [];
  if (selection) {
    citations.push({ docName, page, quote: selection, jumpRef, sourceType: "selection" });
  }
  if (paragraph) {
    citations.push({ docName, page, quote: paragraph, jumpRef, sourceType: "paragraph" });
  }
  highlights.forEach((h) => {
    const quote = cleanText(h?.text || h?.summary || "", 220);
    if (!quote) return;
    citations.push({
      docName,
      page: cleanText(String(h?.page || page), 40),
      quote,
      jumpRef: cleanText(h?.jumpRef || jumpRef, 80),
      sourceType: "highlight"
    });
  });

  return {
    scope: {
      label: `Context: Active Reading (${docName} · p.${page})`,
      contextType: "active-reading",
      docName,
      page
    },
    citations
  };
}

function normalizeTutorCitation(value) {
  if (!value || typeof value !== "object") return null;
  const quote = cleanText(value.quote || value.snippet || "", 260);
  if (!quote) return null;
  return {
    docName: cleanText(value.docName || value.title || "Source", 180) || "Source",
    page: cleanText(String(value.page || "N/A"), 50) || "N/A",
    quote,
    jumpRef: cleanText(value.jumpRef || "", 80),
    sourceType: cleanText(value.sourceType || "source", 50) || "source"
  };
}

function dedupeTutorCitations(citations) {
  const out = [];
  const seen = new Set();
  (citations || []).forEach((raw) => {
    const c = normalizeTutorCitation(raw);
    if (!c) return;
    const key = `${c.docName}|${c.page}|${c.quote.slice(0, 80)}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  });
  return out;
}

function buildTutorFallback(contextType, question, scope, citations) {
  const hint = String(contextType || "active-reading").toLowerCase();
  let answer = "I could not reach the full tutor model, so here is a safe scoped answer.";
  if (hint === "study-notes") {
    answer = `From your selected Study Pack context, start by summarizing the core rule in 2 lines, then test it with one checkpoint question. Question received: ${question}`;
  } else if (hint === "practice-papers") {
    answer = `For this practice question, use progressive help: identify known data, choose method, then compare with marking points. Question received: ${question}`;
  } else {
    answer = `From the current reading context, explain the selected part in plain words, then apply one worked example before moving on. Question received: ${question}`;
  }

  const safeCitations = dedupeTutorCitations(citations).slice(0, 4);
  const fallbackActions = [
    safeCitations[0]?.jumpRef ? { type: "jump", label: "Jump to source", jumpRef: safeCitations[0].jumpRef } : null,
    { type: "add-note", label: "Add to my notes", text: answer },
    hint === "practice-papers"
      ? { type: "revise-link", label: "Revise in Study Notes", target: "study-notes" }
      : { type: "flashcards", label: "Turn into flashcards", text: answer }
  ].filter(Boolean);

  return {
    answer,
    citations: safeCitations,
    actions: fallbackActions,
    scope
  };
}

function normalizeTutorActions(actions, contextType, citations, answer, fallbackActions = []) {
  const normalized = Array.isArray(actions)
    ? actions
      .map((a) => {
        if (!a || typeof a !== "object") return null;
        return {
          type: cleanText(a.type || "", 40),
          label: cleanText(a.label || "", 80),
          target: cleanText(a.target || "", 80),
          jumpRef: cleanText(a.jumpRef || "", 80),
          text: cleanText(a.text || "", 280)
        };
      })
      .filter((a) => a && a.label)
      .slice(0, 4)
    : [];

  if (normalized.length) return normalized;

  const hint = String(contextType || "active-reading").toLowerCase();
  const defaults = [
    citations[0]?.jumpRef ? { type: "jump", label: "Jump to source", jumpRef: citations[0].jumpRef } : null,
    { type: "add-note", label: "Add to my notes", text: cleanText(answer, 240) },
    hint === "practice-papers"
      ? { type: "revise-link", label: "Revise in Study Notes", target: "study-notes" }
      : { type: "flashcards", label: "Turn into flashcards", text: cleanText(answer, 200) }
  ].filter(Boolean);

  return (fallbackActions.length ? fallbackActions : defaults).slice(0, 4);
}
