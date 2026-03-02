import { initFeature1 } from "./src/feature-modules/feature1.js";
import { initFeature2 } from "./src/feature-modules/feature2.js";
import { initFeature3 } from "./src/feature-modules/feature3.js";
import { initFeature4 } from "./src/feature-modules/feature4.js";
import { initFeature5 } from "./src/feature-modules/feature5.js";
import { initFeature6 } from "./src/feature-modules/feature6.js";
import { initFeature7 } from "./src/feature-modules/feature7.js";
import { initFeature8 } from "./src/feature-modules/feature8.js";

const STORAGE_KEY = "speedup_dashboard_reference_v1";
const STUDENT_ID = "anonymous";

const API = {
  health: "/api/health",
  userState: "/api/user/state",
  userExam: "/api/user/exam",
  practiceAnalyze: "/api/practice/analyze",
  explain: "/api/explain",
  highlightAnalyze: "/api/highlight/analyze",
  ragQuery: "/api/rag/query",
  ragIndexNote: "/api/rag/index-note",
  recommendations: "/api/recommendations"
};

const defaultState = {
  student: {
    id: STUDENT_ID,
    name: "",
    focus: "",
    productiveSlot: "",
    weeklyHours: 0
  },
  mastery: [],
  topics: [],
  recommendedActions: [],
  liveRecommendation: {
    recommendation: "Live recommendation pending...",
    qualityCheck: "",
    why: "",
    nextActions: [],
    sources: [],
    provider: "local"
  },
  notes: {},
  highlights: [],
  practiceUploads: [],
  examHistory: [],
  responsibleControls: {
    explainability: true,
    personalization: true,
    decayModeling: true,
    errorTypeDetection: true
  },
  auditLog: []
};

const flashcards = [];

const modals = {
  focus: { title: "Start Focus Session", body: "<div class='form-group'><label class='form-label'>Mode</label><select class='select'><option>Active Reading</option><option>AI Tutor</option><option>Practice Questions</option></select></div>", confirm: "Start" },
  visual: { title: "Concept Visualization", body: "<div class='form-group'><label class='form-label'>Concept</label><input class='input' placeholder='Enter concept...'></div>", confirm: "Generate" },
  export: { title: "Export Highlights", body: "<div style='font-size:13px;color:var(--text3);line-height:1.7;'>Export current highlights to JSON report from dashboard.</div>", confirm: "Close" },
  "full-plan": { title: "Generate Full Plan", body: "<div class='form-group'><label class='form-label'>Available hours</label><input class='input' type='number' value='12'></div>", confirm: "Generate" },
  "override-rec": { title: "Override Recommendation", body: "<div class='form-group'><label class='form-label'>Reason</label><textarea class='input' style='height:90px;resize:none;' placeholder='Why this recommendation does not fit...'></textarea></div>", confirm: "Submit" },
  snooze: { title: "Snooze Recommendation", body: "<div class='form-group'><select class='select'><option>3 days</option><option>1 week</option></select></div>", confirm: "Snooze" },
  "context-override": { title: "Override Tutor Context", body: "<div class='form-group'><label class='form-label'>Learning style</label><select class='select'><option>Analogy-based</option><option>Visual-first</option></select></div>", confirm: "Save" },
  "add-session": { title: "Add Session", body: "<div class='form-group'><label class='form-label'>Subject</label><input class='input' value='Algorithms'></div>", confirm: "Add" },
  "upload-paper": { title: "Upload Practice Paper", body: "<div style='font-size:13px;color:var(--text3);'>Upload from Practice tab.</div>", confirm: "Close" },
  "time-input": { title: "30-minute Plan", body: "<div style='font-size:13px;color:var(--text3);'>Focus on one weak-topic drill + one timed check.</div>", confirm: "Apply" }
};

const runtime = {
  state: loadLocalState(),
  cloudServices: { openaiConfigured: false, ragConfigured: false, firebaseConfigured: false, fileStorageConfigured: false },
  highlightMode: false,
  currentParagraphId: 1,
  currentAttempt: 0,
  cardIndex: 0,
  flipped: false,
  voiceActive: false,
  authUser: null,
  flashcards
};

const ctx = {
  runtime,
  API,
  modals,
  apiGet,
  apiPost,
  apiPostForm,
  apiPut,
  parseMaybeJson,
  escapeHtml,
  timeNow,
  logAudit,
  scheduleSave
};

const feature1 = initFeature1(ctx);
const feature2 = initFeature2(ctx);
const feature3 = initFeature3(ctx);
const feature4 = initFeature4(ctx);
const feature5 = initFeature5(ctx);
const feature6 = initFeature6(ctx);
const feature7 = initFeature7(ctx);
const feature8 = initFeature8(ctx);

async function init() {
  const authed = await ensureAuthenticated();
  if (!authed) return;

  updateSidebarIdentity();
  bindSidebarActions();
  ensureDynamicContainers();
  feature2.bindNotesSelectionCapture();

  await loadCloudHealth();
  await hydrateStateFromBackend();

  hydrateFromDom();
  feature2.renderHighlights();
  feature5.renderRecommendations();
  renderCloudStatus();
  feature2.renderFlashcard();
  feature6.initWeeklyChart();
  feature6.initHeatmap();
  feature7.initPracticeFeature();
}

function ensureDynamicContainers() {
  const highlightsPage = document.getElementById("page-highlights");
  if (highlightsPage) {
    const sectionHead = highlightsPage.querySelector(".section-head");
    if (sectionHead && !document.getElementById("dynamicHighlights")) {
      const wrap = document.createElement("div");
      wrap.id = "dynamicHighlights";
      wrap.style.marginBottom = "10px";
      sectionHead.insertAdjacentElement("afterend", wrap);
    }
  }

  const tutorRightCol = document.querySelector("#page-tutor .grid-2-1 > div:last-child");
  if (tutorRightCol && !document.getElementById("ragCard")) {
    const card = document.createElement("div");
    card.className = "card";
    card.id = "ragCard";
    card.innerHTML = `
      <div class="card-title">RAG Assistant</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:8px;">Grounded retrieval on your indexed notes.</div>
      <input id="ragQueryInput" class="input" placeholder="Ask from your indexed notes..." />
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;" onclick="runRagQuery()">Run RAG</button>
        <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" onclick="indexLatestHighlight()">Index Last Highlight</button>
      </div>
      <div id="ragResults" style="margin-top:8px;font-size:12px;color:var(--text2);max-height:140px;overflow:auto;"></div>
    `;
    tutorRightCol.appendChild(card);
  }
}

function hydrateFromDom() {
  document.querySelectorAll(".paragraph-wrap").forEach((wrap) => {
    const id = Number((wrap.id || "").replace("para-", ""));
    const paraText = wrap.querySelector(".para-text");
    if (!id || !paraText) return;

    if (!runtime.state.notes[id]) {
      runtime.state.notes[id] = {
        text: paraText.textContent.trim(),
        status: "unreviewed",
        attempt: 0
      };
    }
  });
  scheduleSave();
}

function renderCloudStatus() {
  const topbarSub = document.querySelector("#page-dashboard .topbar-sub");
  if (!topbarSub) return;
  const status = `OpenAI: ${runtime.cloudServices.openaiConfigured ? "Connected" : "Not configured"} | RAG: ${runtime.cloudServices.ragConfigured ? "Connected" : "Not configured"} | Firebase: ${runtime.cloudServices.firebaseConfigured ? "Connected" : "Not configured"} | Files: ${runtime.cloudServices.fileStorageConfigured ? "Connected" : "Not configured"}`;
  topbarSub.textContent = `${topbarSub.textContent.split("|")[0].trim()} | ${status}`;
}

function navigate(page) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));

  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add("active");

  document.querySelectorAll(".nav-item").forEach((item) => {
    const onclick = item.getAttribute("onclick") || "";
    if (onclick.includes(`'${page}'`)) item.classList.add("active");
  });
}

async function loadCloudHealth() {
  try {
    const health = await apiGet(API.health);
    runtime.cloudServices = health.services || runtime.cloudServices;
  } catch {
    runtime.cloudServices = { openaiConfigured: false, ragConfigured: false, firebaseConfigured: false, fileStorageConfigured: false };
  }
}

async function hydrateStateFromBackend() {
  try {
    const remote = await apiGet(API.userState);
    runtime.state = mergeDeep(structuredClone(defaultState), remote.state || {});
    if (runtime.authUser?.uid) runtime.state.student.id = runtime.authUser.uid;
    if (!runtime.state.student.name && runtime.authUser?.email) runtime.state.student.name = runtime.authUser.email.split("@")[0];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runtime.state));
    logAudit("Loaded user state from backend.");
  } catch {
    logAudit("User state unavailable. Using local state.");
  }
}

function scheduleSave() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runtime.state));
  persistStateToBackend();
}

async function persistStateToBackend() {
  try {
    await apiPut(API.userState, { state: runtime.state });
  } catch {
    // Keep local only.
  }
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    return mergeDeep(structuredClone(defaultState), JSON.parse(raw));
  } catch {
    return structuredClone(defaultState);
  }
}

function mergeDeep(target, source) {
  if (!source || typeof source !== "object") return target;
  Object.keys(source).forEach((key) => {
    const value = source[key];
    if (Array.isArray(value)) target[key] = value;
    else if (value && typeof value === "object") {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      mergeDeep(target[key], value);
    } else target[key] = value;
  });
  return target;
}

function logAudit(message) {
  runtime.state.auditLog.push({ ts: new Date().toISOString(), message });
  if (runtime.state.auditLog.length > 150) runtime.state.auditLog = runtime.state.auditLog.slice(-150);
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function ensureAuthenticated() {
  try {
    const authClient = window.firebaseAuthClient;
    if (!authClient?.initFirebaseClient) {
      window.location.replace("/login.html");
      return false;
    }
    await authClient.initFirebaseClient();
    await authClient.waitForAuthReady();
    const user = await authClient.getUser();
    if (!user) {
      window.location.replace("/login.html");
      return false;
    }
    runtime.authUser = user;
    runtime.state.student.id = user.uid || runtime.state.student.id || STUDENT_ID;
    if (!runtime.state.student.name && user.email) runtime.state.student.name = user.email.split("@")[0];
    authClient.onAuthChanged((nextUser) => {
      if (!nextUser) window.location.replace("/login.html");
    });
    return true;
  } catch {
    window.location.replace("/login.html");
    return false;
  }
}

function updateSidebarIdentity() {
  const user = runtime.authUser;
  const avatar = document.getElementById("sidebarAvatar");
  const nameEl = document.getElementById("sidebarUserName");
  const metaEl = document.getElementById("sidebarUserMeta");
  const email = String(user?.email || "").trim();
  const initials = (runtime.state.student.name || email || "ST")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("") || "ST";
  if (avatar) avatar.textContent = initials;
  if (nameEl) nameEl.textContent = runtime.state.student.name || "Student";
  if (metaEl) metaEl.textContent = email || "Authenticated user";
}

function bindSidebarActions() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (!logoutBtn) return;
  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    try {
      await window.firebaseAuthClient?.signOutUser?.();
    } finally {
      window.location.replace("/login.html");
    }
  });
}

async function apiGet(url) {
  const res = await fetch(url, { headers: await authHeaders() });
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `GET ${url} failed`);
  return payload;
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `POST ${url} failed`);
  return payload;
}

async function apiPostForm(url, formData) {
  const res = await fetch(url, {
    method: "POST",
    headers: await authHeaders(),
    body: formData
  });
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `POST ${url} failed`);
  return payload;
}

async function apiPut(url, body) {
  const res = await fetch(url, {
    method: "PUT",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `PUT ${url} failed`);
  return payload;
}

async function authHeaders(base = {}) {
  const headers = { ...base };
  const token = await window.firebaseAuthClient?.getIdToken?.();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseMaybeJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export function bootstrapApp() {
  window.navigate = navigate;
  window.explainPara = feature1.explainPara;
  window.markClear = feature1.markClear;
  window.toggleHighlightMode = feature2.toggleHighlightMode;
  window.flipCard = feature2.flipCard;
  window.nextCard = feature2.nextCard;
  window.sendMessage = feature3.sendMessage;
  window.quickAsk = feature3.quickAsk;
  window.addUserMsg = feature3.addUserMsg;
  window.addAIMsg = feature3.addAIMsg;
  window.sendClarityMsg = feature3.sendClarityMsg;
  window.handleChatKey = feature3.handleChatKey;
  window.startVoice = feature4.startVoice;
  window.toggleVoice = feature4.toggleVoice;
  window.toggleFeedback = feature8.toggleFeedback;
  window.openModal = feature8.openModal;
  window.closeModal = feature8.closeModal;
  window.initWeeklyChart = feature6.initWeeklyChart;
  window.initHeatmap = feature6.initHeatmap;
  window.runRagQuery = feature5.runRagQuery;
  window.indexLatestHighlight = feature5.indexLatestHighlight;
  init();
}