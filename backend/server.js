const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
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
const { requireFirebaseAuth, tryGetFirebaseUser } = require("./firebase/firebaseAuth");
const { getUserState, setUserState, appendAuditEvent } = require("./firebase/firebaseStore");
const timeManagementModule = tryRequire("../time-management");
const registerTimeManagementRoutes = timeManagementModule?.registerTimeManagementRoutes || null;

const app = express();
const port = Number(process.env.PORT || 3000);
const requestCounters = new Map();
const FRONTEND_PUBLIC_DIR = path.resolve(__dirname, "../frontend/public");
const PROJECT_ROOT_DIR = path.resolve(__dirname, "..");
const STUDY_HUB_PDF_MAX_CHARS = 60_000;
const SERVER_BOOT_ID = `boot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

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

const uploadStudyNotes = multer
  ? multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 12 }
  })
  : { array: () => (_req, res) => res.status(503).json({ error: "File upload feature unavailable. Missing dependencies." }) };

const defaultOpenAIModel = String(process.env.OPENAI_MODEL || "gpt-4.1-mini").trim() || "gpt-4.1-mini";
const envAllowedOpenAIModels = String(process.env.OPENAI_ALLOWED_MODELS || "")
  .split(",")
  .map((v) => String(v || "").trim())
  .filter(Boolean);
const openAIAllowedModels = Array.from(new Set([defaultOpenAIModel, ...envAllowedOpenAIModels]));

const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: defaultOpenAIModel,
    allowedModels: openAIAllowedModels.length ? openAIAllowedModels : [defaultOpenAIModel],
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  },
  rag: {
    collection: process.env.FIREBASE_RAG_COLLECTION || "speedup_rag_notes"
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || ""
  },
  pdfbox: {
    jarPath: resolvePdfboxJarPath()
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
    serverBootId: SERVER_BOOT_ID,
    services: {
      openaiConfigured: Boolean(config.openai.apiKey && config.openai.model),
      ragConfigured: Boolean(isFirebaseConfigured()),
      firebaseConfigured: Boolean(isFirebaseConfigured()),
      fileStorageConfigured: Boolean(isCloudinaryConfigured())
    },
    timestamp: new Date().toISOString()
  });
});

app.get("/api/study-hub/models", async (_req, res) => {
  return res.json({
    ok: true,
    defaultModel: config.openai.model,
    allowedModels: config.openai.allowedModels
  });
});

app.post("/api/study-hub/llm", withRateLimit("study_hub_llm", 50, 60 * 1000), async (req, res) => {
  try {
    const requestedModel = cleanText(req.body?.model, 120);
    const resolvedModel = resolveOpenAIModel(requestedModel);
    if (requestedModel && !resolvedModel) {
      return res.status(400).json({
        error: "Requested model is not allowed.",
        allowedModels: config.openai.allowedModels
      });
    }

    const system = cleanText(req.body?.system, 6000);
    const userText = cleanText(req.body?.userText, 28000);
    const inputMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const messages = inputMessages
      .map((m) => ({
        role: m?.role === "assistant" ? "assistant" : "user",
        content: cleanText(m?.content, 28000)
      }))
      .filter((m) => m.content)
      .slice(-20);

    if (!messages.length && !userText) {
      return res.status(400).json({ error: "messages or userText is required." });
    }

    const modelMessages = [];
    if (system) modelMessages.push({ role: "system", content: system });
    if (messages.length) {
      modelMessages.push(...messages);
    } else {
      modelMessages.push({ role: "user", content: userText });
    }

    const maxTokens = clampNumber(req.body?.maxTokens, 64, 4000, 1800);
    const temperature = clampNumber(req.body?.temperature, 0, 2, 0.2);
    const text = await callOpenAIText(modelMessages, temperature, {
      model: resolvedModel || config.openai.model,
      maxTokens
    });

    return res.json({
      ok: true,
      model: resolvedModel || config.openai.model,
      text: cleanText(text, 50000),
      provider: "openai-api"
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to generate Study Hub response.",
      details: cleanText(error?.message, 240)
    });
  }
});

app.post(
  "/api/study-hub/extract-pdfs",
  withRateLimit("study_hub_extract_pdfs", 20, 60 * 1000),
  uploadStudyNotes.array("pdfs", 12),
  async (req, res) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) {
        return res.status(400).json({ error: "Please upload at least one PDF file." });
      }

      const extracted = [];
      const failed = [];
      for (const file of files) {
        const safeName = cleanText(file?.originalname, 200) || "uploaded.pdf";
        if (!isPdfFile(file)) {
          failed.push({ name: safeName, ok: false, error: "Only PDF files are accepted." });
          continue;
        }

        try {
          const pack = await extractStudyHubPdfPack(file);
          extracted.push(pack);
        } catch (error) {
          failed.push({
            name: safeName,
            ok: false,
            error: cleanText(error?.message, 260) || "Failed to extract text from PDF."
          });
        }
      }

      if (!extracted.length) {
        return res.status(400).json({
          error: "Could not extract text from uploaded PDF(s).",
          failed
        });
      }

      return res.json({
        ok: true,
        files: extracted,
        failed
      });
    } catch (error) {
      return res.status(500).json({
        error: "Failed to extract PDFs for Study Hub.",
        details: cleanText(error?.message, 240)
      });
    }
  }
);

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

app.get("/api/state/:studentId", async (req, res) => {
  try {
    const studentId = normalizeStudentId(req.params.studentId);
    const state = await loadStateWithFallback(studentId);
    res.json(state || {});
  } catch (error) {
    handleError(res, "Failed to load student state", error);
  }
});

app.put("/api/state/:studentId", async (req, res) => {
  try {
    const studentId = normalizeStudentId(req.params.studentId);
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

app.post("/api/explain", withRateLimit("explain", 40, 60 * 1000), async (req, res) => {
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

app.post("/api/tutor/query", withRateLimit("tutor_query", 60, 60 * 1000), async (req, res) => {
  try {
    const contextType = cleanText(req.body?.contextType || "active-reading", 40).toLowerCase();
    const question = cleanText(req.body?.question, 2000);
    const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
    if (!question) return res.status(400).json({ error: "question is required." });

    const authUser = await tryGetFirebaseUser(req);
    const ownerId = normalizeStudentId(authUser?.uid || cleanText(req.body?.studentId || "", 80));
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

app.post("/api/highlight/analyze", withRateLimit("highlight", 50, 60 * 1000), async (req, res) => {
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

app.post("/api/rag/query", withRateLimit("rag_query", 80, 60 * 1000), async (req, res) => {
  try {
    const query = cleanText(req.body?.query, 300);
    const topK = Number(req.body?.topK || 5);
    const studentId = cleanText(req.body?.studentId || "", 80);
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required." });
    }
    const authUser = await tryGetFirebaseUser(req);
    const ownerId = normalizeStudentId(authUser?.uid || studentId || "");
    const hits = await searchDocuments(query, topK, ownerId);
    res.json({ query, hits });
  } catch (error) {
    handleError(res, "Failed to query RAG index", error);
  }
});

app.post("/api/rag/index-note", withRateLimit("rag_index", 40, 60 * 1000), async (req, res) => {
  try {
    const studentId = cleanText(req.body?.studentId || "", 80);
    const title = cleanText(req.body?.title || "", 200);
    const text = cleanText(req.body?.text, 20000);
    const source = cleanText(req.body?.source || "notes", 80) || "notes";
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required." });
    }
    const authUser = await tryGetFirebaseUser(req);
    const ownerId = normalizeStudentId(authUser?.uid || studentId);
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

app.post("/api/recommendations", withRateLimit("recommend", 20, 60 * 1000), async (req, res) => {
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
    normalizeStudentId
  });
} else {
  console.warn("Time management routes disabled: optional dependency `sqlite3` is missing.");
}

app.post("/api/live/event/:studentId", async (req, res) => {
  try {
    const studentId = normalizeStudentId(req.params.studentId);
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

app.post("/api/live/exam/:studentId", async (req, res) => {
  try {
    const studentId = normalizeStudentId(req.params.studentId);
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

app.post("/api/live/controls/:studentId", async (req, res) => {
  try {
    const studentId = normalizeStudentId(req.params.studentId);
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

app.post("/api/practice/analyze", withRateLimit("practice", 15, 60 * 1000), upload.single("paper"), async (req, res) => {
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

    const authUser = await tryGetFirebaseUser(req);
    const uid = authUser?.uid || normalizeStudentId(req.body?.studentId || "anonymous");

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
    await persistPracticeUpload(uid, {
      name: fileMeta?.name || "Pasted Text Input",
      type: fileMeta?.type || "text/plain",
      size: Number(fileMeta?.size || pastedText.length || 0),
      source,
      textLength: extractedText.length,
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
      file: fileMeta,
      textLength: extractedText.length,
      analysis
    });
  } catch (error) {
    handleError(res, "Failed to analyze practice paper", error);
  }
});

app.get("/api/study-notes/packs", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const state = mergeDeep(createMinimalState(uid), await getUserState(uid));
    const packs = Array.isArray(state.studyPacks) ? state.studyPacks : [];
    packs.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    return res.json({
      ok: true,
      activePackId: cleanText(state.activeStudyPackId, 120),
      packs: packs.map((p) => summarizeStudyPack(p))
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load study packs. Please try again." });
  }
});

app.post("/api/study-notes/upload", requireFirebaseAuth, uploadStudyNotes.array("pdfs", 12), async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const files = Array.isArray(req.files) ? req.files : [];
    const packTitle = cleanText(req.body?.packTitle, 140);
    const requestedPackId = cleanText(req.body?.packId, 120);

    if (!files.length) {
      return res.status(400).json({ error: "Please upload at least one PDF file." });
    }

    const state = mergeDeep(createMinimalState(uid), await getUserState(uid));
    const studyPacks = Array.isArray(state.studyPacks) ? state.studyPacks : [];
    const nowIso = new Date().toISOString();
    let pack = studyPacks.find((p) => p?.id === requestedPackId) || null;

    if (!pack) {
      pack = {
        id: `pack_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        title: packTitle || `Study Pack ${new Date().toLocaleDateString("en-GB")}`,
        createdAt: nowIso,
        updatedAt: nowIso,
        files: [],
        combinedText: "",
        synthesis: null,
        status: "processing"
      };
      studyPacks.unshift(pack);
    } else {
      pack.updatedAt = nowIso;
      if (packTitle) pack.title = packTitle;
      pack.status = "processing";
      pack.files = Array.isArray(pack.files) ? pack.files : [];
      pack.combinedText = String(pack.combinedText || "");
    }

    const perFile = [];
    for (const file of files) {
      const baseMeta = {
        name: cleanText(file?.originalname, 200) || "uploaded.pdf",
        type: cleanText(file?.mimetype, 120),
        size: Number(file?.size || 0)
      };

      if (!isPdfFile(file)) {
        const failed = { ...baseMeta, ok: false, error: "Only PDF files are accepted." };
        perFile.push(failed);
        pack.files.unshift({ ...failed, createdAt: nowIso });
        continue;
      }

      if (!pdfParse) {
        const failed = { ...baseMeta, ok: false, error: "PDF parser dependency missing. Run npm install." };
        perFile.push(failed);
        pack.files.unshift({ ...failed, createdAt: nowIso });
        continue;
      }

      let text = "";
      try {
        const parsed = await pdfParse(file.buffer);
        text = cleanText(parsed?.text, 500000);
      } catch {
        text = "";
      }

      if (!text || text.trim().length < 40) {
        const failed = { ...baseMeta, ok: false, error: "Could not extract enough readable text from PDF." };
        perFile.push(failed);
        pack.files.unshift({ ...failed, createdAt: nowIso });
        continue;
      }

      const docId = await indexRagNote({
        studentId: uid,
        title: baseMeta.name,
        text,
        source: "study-pack-pdf",
        packId: pack.id
      });

      const success = {
        ...baseMeta,
        ok: true,
        textLength: text.length,
        docId
      };
      perFile.push(success);
      pack.files.unshift({ ...success, createdAt: nowIso });
      pack.combinedText = `${pack.combinedText}\n\n# ${baseMeta.name}\n${text}`.slice(-600000);
    }

    const successCount = perFile.filter((f) => f.ok).length;
    if (successCount > 0 && pack.combinedText.trim()) {
      pack.synthesis = await synthesizeStudyPackNotes(pack.title, pack.combinedText);
      pack.status = "ready";
      pack.updatedAt = new Date().toISOString();
      state.activeStudyPackId = pack.id;
    } else {
      pack.status = "failed";
      pack.updatedAt = new Date().toISOString();
    }

    pack.files = pack.files.slice(0, 120);
    state.studyPacks = studyPacks.slice(0, 40);
    await setUserState(uid, state);

    return res.json({
      ok: true,
      pack: summarizeStudyPack(pack),
      files: perFile,
      summary: {
        total: perFile.length,
        success: successCount,
        failed: perFile.length - successCount
      }
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to process study notes upload. Please try again." });
  }
});

app.post("/api/study-notes/pack/:packId/synthesize", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const packId = cleanText(req.params.packId, 120);
    const state = mergeDeep(createMinimalState(uid), await getUserState(uid));
    const pack = findStudyPack(state, packId);
    if (!pack) return res.status(404).json({ error: "Study pack not found." });
    if (!String(pack.combinedText || "").trim()) {
      return res.status(400).json({ error: "No extracted study content found in this pack." });
    }

    pack.synthesis = await synthesizeStudyPackNotes(pack.title, pack.combinedText);
    pack.status = "ready";
    pack.updatedAt = new Date().toISOString();
    state.activeStudyPackId = pack.id;
    await setUserState(uid, state);

    return res.json({ ok: true, pack: summarizeStudyPack(pack) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to synthesize study pack." });
  }
});

app.post("/api/study-notes/pack/:packId/query", requireFirebaseAuth, async (req, res) => {
  try {
    const uid = req.firebaseUser.uid;
    const packId = cleanText(req.params.packId, 120);
    const question = cleanText(req.body?.question, 1800);
    const chatHistory = Array.isArray(req.body?.chatHistory) ? req.body.chatHistory : [];
    if (!question) return res.status(400).json({ error: "question is required." });

    const state = mergeDeep(createMinimalState(uid), await getUserState(uid));
    const pack = findStudyPack(state, packId);
    if (!pack) return res.status(404).json({ error: "Study pack not found." });

    const combinedText = cleanText(pack.combinedText || "", 180000);
    const hits = await searchDocuments(question, 8, uid, { packId });
    const fallbackContextChunks = buildPackContextChunks(question, combinedText, 6, 1400);
    const evidenceChunks = dedupePackEvidence([
      ...hits.map((h) => ({
        title: cleanText(h.title, 180) || "Study Pack",
        snippet: cleanText(h.snippet, 900),
        source: cleanText(h.source, 80) || "study-pack"
      })),
      ...fallbackContextChunks.map((chunk, idx) => ({
        title: pack.title || `Study Pack Chunk ${idx + 1}`,
        snippet: chunk,
        source: "study-pack-combined-text"
      }))
    ]).slice(0, 8);

    const citations = evidenceChunks.map((item) => ({
      docName: cleanText(item.title, 180) || "Study Pack",
      page: "Pack",
      quote: cleanText(item.snippet, 280),
      jumpRef: "study-notes",
      sourceType: "study-pack"
    }));

    const fallbackAnswer = citations.length
      ? `I found relevant content in "${pack.title}". Here is the closest answer from your uploaded PDFs: ${citations[0].quote}`
      : `I could not find enough matching content in "${pack.title}" yet. Try asking with keywords that appear in your uploaded PDFs, or upload more notes for this topic.`;

    let answer = fallbackAnswer;
    let provider = "fallback";
    if (isOpenAIConfigured() && evidenceChunks.length) {
      try {
        const modelMessages = [
          {
            role: "system",
            content: [
              "You are SpeedUp Study Pack Tutor.",
              "Answer like a helpful ChatGPT-style tutor, but stay grounded in the uploaded PDFs for this study pack.",
              "Use the provided study-pack content as your knowledge base for this answer.",
              "When the answer is only partially supported, say that briefly, then still provide the best grounded answer you can.",
              "Do not refuse just because retrieval is weak if relevant study-pack text is provided.",
              "Do not use outside knowledge unless the user explicitly asks for a general explanation.",
              "Return strict JSON with keys: answer, confidence."
            ].join(" ")
          },
          ...chatHistory.slice(-8).map((msg) => ({
            role: msg?.role === "assistant" ? "assistant" : "user",
            content: cleanText(msg?.text, 1200)
          })).filter((msg) => msg.content),
          {
            role: "user",
            content: JSON.stringify({
              packTitle: pack.title,
              question,
              studyPackEvidence: evidenceChunks,
              instruction: "Answer the question using the uploaded PDFs as the source of truth."
            })
          }
        ];

        const raw = await callOpenAIChat(modelMessages, 0.2);
        const parsed = safeParseJson(raw);
        if (parsed?.answer) {
          answer = cleanText(parsed.answer, 2800) || answer;
          provider = "openai-api";
        }
      } catch {
        provider = "fallback";
      }
    }

    return res.json({
      ok: true,
      provider,
      pack: summarizeStudyPack(pack),
      answer,
      citations: citations.slice(0, 6)
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to answer study pack question." });
  }
});

app.get("/api/live/bootstrap/:studentId", async (req, res) => {
  try {
    const studentId = normalizeStudentId(req.params.studentId);
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

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
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

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function resolveOpenAIModel(model) {
  const requested = String(model || "").trim();
  if (!requested) return config.openai.model;
  if (Array.isArray(config.openai.allowedModels) && config.openai.allowedModels.includes(requested)) {
    return requested;
  }
  return "";
}

async function callOpenAIChat(messages, temperature = 0.2, options = {}) {
  if (!isOpenAIConfigured()) {
    throw new Error("OpenAI API is not configured.");
  }

  const model = resolveOpenAIModel(options.model);
  if (!model) throw new Error("Requested model is not allowed.");
  const endpoint = `${trimSlash(config.openai.baseUrl)}/chat/completions`;
  const requestBody = {
    model,
    messages,
    temperature,
    max_tokens: clampNumber(options.maxTokens, 64, 4000, 800),
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
      return callOpenAIResponses(messages, temperature, options);
    }
    // Fallback for legacy non-chat completion models.
    if (errMsg.includes("not a chat model")) {
      return callOpenAICompletions(messages, temperature, options);
    }
    throw new Error(errMsg);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response.");
  }
  return content;
}

async function callOpenAICompletions(messages, temperature = 0.2, options = {}) {
  const model = resolveOpenAIModel(options.model);
  if (!model) throw new Error("Requested model is not allowed.");
  const endpoint = `${trimSlash(config.openai.baseUrl)}/completions`;
  const prompt = messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
  const requestBody = {
    model,
    prompt,
    temperature,
    max_tokens: clampNumber(options.maxTokens, 64, 4000, 800)
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
      return callOpenAIResponses(messages, temperature, options);
    }
    throw new Error(errMsg);
  }

  const text = payload?.choices?.[0]?.text;
  if (!text) {
    throw new Error("OpenAI completions returned empty response.");
  }
  return text;
}

async function callOpenAIResponses(messages, temperature = 0.2, options = {}) {
  const model = resolveOpenAIModel(options.model);
  if (!model) throw new Error("Requested model is not allowed.");
  const endpoint = `${trimSlash(config.openai.baseUrl)}/responses`;
  const input = messages.map((m) => ({
    role: m.role,
    content: [{ type: "input_text", text: String(m.content || "") }]
  }));

  const requestBody = {
    model,
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

async function callOpenAIText(messages, temperature = 0.2, options = {}) {
  if (!isOpenAIConfigured()) {
    throw new Error("OpenAI API is not configured.");
  }
  const model = resolveOpenAIModel(options.model);
  if (!model) throw new Error("Requested model is not allowed.");

  const endpoint = `${trimSlash(config.openai.baseUrl)}/chat/completions`;
  const requestBody = {
    model,
    messages,
    temperature,
    max_tokens: clampNumber(options.maxTokens, 64, 4000, 1200)
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
    if (errMsg.includes("supported in v1/responses")) {
      return callOpenAIResponsesText(messages, temperature, options);
    }
    if (errMsg.includes("not a chat model")) {
      return callOpenAICompletionsText(messages, temperature, options);
    }
    throw new Error(errMsg);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response.");
  }
  return typeof content === "string" ? content : JSON.stringify(content);
}

async function callOpenAICompletionsText(messages, temperature = 0.2, options = {}) {
  const model = resolveOpenAIModel(options.model);
  if (!model) throw new Error("Requested model is not allowed.");
  const endpoint = `${trimSlash(config.openai.baseUrl)}/completions`;
  const prompt = messages.map((m) => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n");
  const requestBody = {
    model,
    prompt,
    temperature,
    max_tokens: clampNumber(options.maxTokens, 64, 4000, 1200)
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
      return callOpenAIResponsesText(messages, temperature, options);
    }
    throw new Error(errMsg);
  }

  const text = payload?.choices?.[0]?.text;
  if (!text) {
    throw new Error("OpenAI completions returned empty response.");
  }
  return text;
}

async function callOpenAIResponsesText(messages, temperature = 0.2, options = {}) {
  const model = resolveOpenAIModel(options.model);
  if (!model) throw new Error("Requested model is not allowed.");
  const endpoint = `${trimSlash(config.openai.baseUrl)}/responses`;
  const input = messages.map((m) => ({
    role: m.role,
    content: [{ type: "input_text", text: String(m.content || "") }]
  }));

  const requestBody = {
    model,
    input,
    temperature,
    max_output_tokens: clampNumber(options.maxTokens, 64, 4000, 1200)
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

async function searchDocuments(query, topK = 5, ownerId = "", options = {}) {
  if (!isFirebaseConfigured()) return [];
  const raw = String(query || "").toLowerCase().trim();
  if (!raw) return [];
  const filterPackId = cleanText(options?.packId, 120);

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
    if (filterPackId && cleanText(data.packId, 120) !== filterPackId) return;
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
    studyPacks: [],
    activeStudyPackId: "",
    practiceUploads: [],
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

function resolvePdfboxJarPath() {
  const envPath = cleanText(process.env.PDFBOX_JAR_PATH, 600);
  const candidates = [
    envPath,
    path.resolve(PROJECT_ROOT_DIR, "pdfbox-app-3.0.6.jar"),
    path.resolve(process.env.USERPROFILE || "", "Downloads", "pdfbox-app-3.0.6.jar")
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // continue trying
    }
  }

  return candidates[0] || "";
}

function parsePdfboxPages(rawText) {
  const normalized = String(rawText || "").replace(/\r\n/g, "\n");
  const pages = normalized
    .split(/\f+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (pages.length) return pages;
  const fallback = normalized.trim();
  return fallback ? [fallback] : [];
}

function cleanStudyHubHeading(raw) {
  return String(raw || "")
    .replace(/^\d+(?:\.\d+){0,4}\s*/g, "")
    .replace(/^[\u2022\-*]\s*/g, "")
    .replace(/[|:;,.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyStudyHubHeading(raw) {
  const text = cleanStudyHubHeading(raw);
  if (!text || text.length < 5 || text.length > 120) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (/^(topics?\s+for\s+week|in this chapter|the next chapter|see how|copyright|logo here|additional materials)/i.test(text)) return false;
  if (/\b(covered in chapter|all rights reserved|this chapter|next chapter)\b/i.test(text)) return false;
  if (/[{}[\];'"`<>]/.test(text)) return false;
  if (/(insert\s+into|select\s+.+\s+from|values\s*\(|=>|::|==|!=)/i.test(text)) return false;
  if (/^(get|post|put|delete|http)\b/i.test(text)) return false;
  return true;
}

function isLikelyStudyHubOverviewPage(pageText) {
  const top = String(pageText || "").slice(0, 4200);
  const lower = top.toLowerCase();
  if (/(overview|table of contents|contents|learning objectives?|chapter summary|unit summary|course outline)/i.test(lower)) return true;
  if (/(topics?\s+for\s+week|topic overview|what you will learn|client-side form processing|form processing with)/i.test(lower)) return true;

  const lines = top.split("\n").map((line) => line.trim()).filter(Boolean);
  const bulletLines = lines.filter((line) => /^[\u2022\u25CF\u25E6\u2023\u2043\u2219\u00B7\-*�]\s+/.test(line)).length;
  if (bulletLines >= 6 && /(validation|security|processing|form|overview|stack|cloud|injection|sanitization)/i.test(lower)) return true;

  return false;
}

function detectStudyHubHeadings(pageText, pageNo) {
  const out = [];
  const lines = String(pageText || "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 300);

  for (const line of lines) {
    const numbered = line.match(/^(\d+(?:\.\d+){0,4})\s+(.{3,100})$/);
    const allCaps = line === line.toUpperCase() && /[A-Z]/.test(line);
    const headingish = /(overview|table of contents|contents|learning objectives?|summary|introduction|conclusion|chapter|unit|topic)/i.test(line);
    const candidate = numbered ? numbered[2] : (allCaps || headingish ? line : "");
    if (!candidate) continue;
    const title = cleanStudyHubHeading(candidate);
    if (!isLikelyStudyHubHeading(title)) continue;
    out.push({ page: pageNo, title });
  }
  return out;
}

async function runPdfboxExtractText(buffer, originalName) {
  const jarPath = cleanText(config?.pdfbox?.jarPath, 800);
  if (!jarPath || !fs.existsSync(jarPath)) {
    throw new Error("PDFBox jar not found. Set PDFBOX_JAR_PATH or place pdfbox-app-3.0.6.jar in project root.");
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "studyhub-pdfbox-"));
  const inputName = `${Date.now()}-${slugify(path.basename(originalName || "uploaded")) || "uploaded"}.pdf`;
  const inputPath = path.join(tempDir, inputName);
  const outputPath = path.join(tempDir, `${slugify(path.basename(originalName || "uploaded")) || "uploaded"}.txt`);

  try {
    await fs.promises.writeFile(inputPath, buffer);
    const args = [
      "-jar",
      jarPath,
      "export:text",
      "-i",
      inputPath,
      "-o",
      outputPath,
      "-encoding",
      "UTF-8",
      "-sort"
    ];

    const { stderr, exitCode } = await new Promise((resolve, reject) => {
      const child = spawn("java", args, { windowsHide: true });
      const errChunks = [];

      child.stderr.on("data", (chunk) => errChunks.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          stderr: Buffer.concat(errChunks).toString("utf8"),
          exitCode: Number(code || 0)
        });
      });
    });

    if (exitCode !== 0) {
      throw new Error(cleanText(stderr, 400) || "PDFBox extraction failed.");
    }
    const text = String(await fs.promises.readFile(outputPath, "utf8")).replace(/\0/g, "").trim();
    if (!text) {
      throw new Error("PDFBox returned no readable text.");
    }
    return text;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractPdfTextWithPdfbox(buffer, originalName) {
  return runPdfboxExtractText(buffer, originalName);
}

async function extractStudyHubPdfPack(file) {
  const rawText = await extractPdfTextWithPdfbox(file.buffer, file.originalname);
  const pages = parsePdfboxPages(rawText);
  const safeName = cleanText(file?.originalname, 200) || "uploaded.pdf";
  const overviewPages = [];
  const headingPool = [];
  let fullText = "";

  const pageList = pages.length ? pages : [String(rawText || "").trim()];
  for (let i = 0; i < pageList.length; i += 1) {
    const pageNo = i + 1;
    const pageText = String(pageList[i] || "").trim();
    if (!pageText) continue;
    const lower = pageText.toLowerCase();

    if (isLikelyStudyHubOverviewPage(pageText)) {
      overviewPages.push({ page: pageNo, snippet: cleanText(pageText, 2500) });
    }

    headingPool.push(...detectStudyHubHeadings(pageText, pageNo));
    fullText += `\n--- Page ${pageNo} ---\n${pageText}`;
    if (fullText.length > STUDY_HUB_PDF_MAX_CHARS) {
      fullText = fullText.slice(0, STUDY_HUB_PDF_MAX_CHARS) + "\n\n[... content truncated for length ...]";
      break;
    }
  }

  const dedupHeadings = [];
  const seen = new Set();
  for (const item of headingPool) {
    const key = String(item?.title || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedupHeadings.push({ page: Number(item.page || 0), title: cleanText(item.title, 120) });
    if (dedupHeadings.length >= 80) break;
  }

  return {
    name: safeName,
    text: fullText.trim(),
    pageCount: pageList.length || 1,
    overviewPages: overviewPages.slice(0, 20),
    headings: dedupHeadings,
    provider: "pdfbox"
  };
}

async function extractTextFromFile(file) {
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
    try {
      return await extractPdfTextWithPdfbox(buffer, original);
    } catch (error) {
      if (!pdfParse) {
        throw new Error(`PDFBox extraction failed and pdf-parse fallback is unavailable: ${cleanText(error?.message, 220)}`);
      }
      const out = await pdfParse(buffer);
      return out.text || "";
    }
  }

  if (ext === ".docx" || mime.includes("wordprocessingml")) {
    if (!mammoth) throw new Error("DOCX parser dependency is missing. Please run npm install.");
    const out = await mammoth.extractRawText({ buffer });
    return out.value || "";
  }

  if (ext === ".pptx" || mime.includes("presentationml")) {
    if (!JSZip) throw new Error("PPTX parser dependency is missing. Please run npm install.");
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
  state.practiceUploads = state.practiceUploads || [];
  state.practiceUploads.unshift(item);
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

async function indexRagNote({ studentId, title, text, source, packId = "" }) {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured.");
  }
  const docId = `${studentId}-${Date.now()}`;
  await getFirestore().collection(config.rag.collection).doc(docId).set({
    studentId,
    packId: cleanText(packId, 120),
    title: String(title || "Untitled"),
    text: String(text || ""),
    source: String(source || "notes"),
    createdAt: new Date().toISOString()
  });
  return docId;
}

function isPdfFile(file) {
  const ext = path.extname(String(file?.originalname || "")).toLowerCase();
  const mime = String(file?.mimetype || "").toLowerCase();
  return ext === ".pdf" || mime === "application/pdf" || mime.includes("pdf");
}

function summarizeStudyPack(pack) {
  const safePack = pack && typeof pack === "object" ? pack : {};
  const files = Array.isArray(safePack.files) ? safePack.files : [];
  const success = files.filter((f) => f?.ok).length;
  const failed = files.filter((f) => f && f.ok === false).length;
  const synthesis = safePack.synthesis || null;
  return {
    id: cleanText(safePack.id, 120),
    title: cleanText(safePack.title, 160) || "Study Pack",
    createdAt: cleanText(safePack.createdAt, 40),
    updatedAt: cleanText(safePack.updatedAt, 40),
    status: cleanText(safePack.status, 40) || "ready",
    totalFiles: files.length,
    successFiles: success,
    failedFiles: failed,
    synthesis
  };
}

function findStudyPack(state, packId) {
  const packs = Array.isArray(state?.studyPacks) ? state.studyPacks : [];
  return packs.find((p) => String(p?.id || "") === String(packId || "")) || null;
}

async function synthesizeStudyPackNotes(packTitle, combinedText) {
  const text = cleanText(combinedText, 120000);
  const fallback = buildStudyPackFallbackNotes(packTitle, text);
  if (!isOpenAIConfigured() || !text) return fallback;
  try {
    const raw = await callOpenAIChat([
      {
        role: "system",
        content: [
          "You are an expert revision assistant.",
          "Combine all uploaded study notes into one concise study set.",
          "Return strict JSON with keys: overview, keyConcepts, examFocus, commonPitfalls, quickRevisionPlan.",
          "keyConcepts/commonPitfalls/quickRevisionPlan must be arrays of short strings."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          packTitle,
          text
        })
      }
    ], 0.2);
    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      overview: cleanText(parsed.overview, 1000) || fallback.overview,
      keyConcepts: cleanList(parsed.keyConcepts, 10, 180).length ? cleanList(parsed.keyConcepts, 10, 180) : fallback.keyConcepts,
      examFocus: cleanText(parsed.examFocus, 1000) || fallback.examFocus,
      commonPitfalls: cleanList(parsed.commonPitfalls, 8, 180).length ? cleanList(parsed.commonPitfalls, 8, 180) : fallback.commonPitfalls,
      quickRevisionPlan: cleanList(parsed.quickRevisionPlan, 6, 180).length ? cleanList(parsed.quickRevisionPlan, 6, 180) : fallback.quickRevisionPlan,
      provider: "openai-api"
    };
  } catch {
    return fallback;
  }
}

function buildStudyPackFallbackNotes(packTitle, text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 80);
  const keyConcepts = lines
    .filter((l) => l.length > 30)
    .slice(0, 6)
    .map((l) => snippet(l, 140));
  return {
    overview: `Combined notes generated for ${packTitle || "your study pack"}. Review key themes first, then test application with timed questions.`,
    keyConcepts: keyConcepts.length ? keyConcepts : ["Upload richer PDFs with selectable text for stronger summary output."],
    examFocus: "Prioritize high-yield definitions, method steps, and common worked-example patterns.",
    commonPitfalls: [
      "Memorizing formulas without linking to when to use them.",
      "Skipping error-analysis after practice attempts.",
      "Not revisiting weak topics within 24-48 hours."
    ],
    quickRevisionPlan: [
      "Do a 20-minute concept review from this combined note set.",
      "Attempt 5 mixed questions without notes.",
      "Review mistakes and patch gaps with targeted recap."
    ],
    provider: "fallback"
  };
}

function buildPackContextChunks(question, combinedText, maxChunks = 6, chunkSize = 1400) {
  const text = String(combinedText || "").trim();
  if (!text) return [];
  const normalizedQuestion = String(question || "").toLowerCase();
  const tokens = normalizedQuestion.split(/\s+/).filter((t) => t.length > 2).slice(0, 12);
  const chunks = [];

  for (let start = 0; start < text.length; start += Math.max(500, chunkSize - 180)) {
    const piece = text.slice(start, start + chunkSize).trim();
    if (!piece) continue;
    let score = 0;
    const lower = piece.toLowerCase();
    tokens.forEach((token) => {
      if (lower.includes(token)) score += 2;
    });
    if (score > 0) {
      chunks.push({ text: piece, score });
    }
  }

  if (!chunks.length) {
    return text.length <= chunkSize ? [text] : [text.slice(0, chunkSize), text.slice(chunkSize, chunkSize * 2)].filter(Boolean);
  }

  return chunks
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(10, maxChunks)))
    .map((item) => item.text);
}

function dedupePackEvidence(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = `${String(item?.title || "")}|${String(item?.snippet || "").slice(0, 180)}`.toLowerCase();
    if (!item?.snippet || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
