const STORAGE_KEY = "speedup_dashboard_reference_v1";
const STUDENT_ID = "demo-student-1";

const API = {
  health: "/api/health",
  state: (studentId) => `/api/state/${encodeURIComponent(studentId)}`,
  explain: "/api/explain",
  highlightAnalyze: "/api/highlight/analyze",
  ragQuery: "/api/rag/query",
  ragIndexNote: "/api/rag/index-note",
  recommendations: "/api/recommendations"
};

const defaultState = {
  student: {
    id: STUDENT_ID,
    name: "Alex Kim",
    focus: "Master Graph Theory and Dynamic Programming before finals.",
    productiveSlot: "morning",
    weeklyHours: 14
  },
  mastery: [54, 57, 59, 61, 60, 64, 67, 69],
  topics: [
    { name: "Graph Theory", weakScore: 79, reason: "Persistent conceptual errors" },
    { name: "Vector Spaces", weakScore: 72, reason: "Long inactivity gap" },
    { name: "LCS DP", weakScore: 65, reason: "Transition logic confusion" },
    { name: "SQL Joins", weakScore: 44, reason: "Occasional careless mistakes" }
  ],
  recommendedActions: [
    "Do 25 minutes of Graph Theory weak-topic drills and explain each step out loud.",
    "Run one timed DP problem at your peak focus window and review error types.",
    "Revisit Vector Spaces with one worked example and one self-test question."
  ],
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
  examHistory: [
    { name: "Algorithms Quiz 2", score: 68, hours: 7, confidence: 6, date: "2026-02-20" },
    { name: "Discrete Math Practice", score: 62, hours: 5.5, confidence: 5, date: "2026-02-25" }
  ],
  responsibleControls: {
    explainability: true,
    personalization: true,
    decayModeling: true,
    errorTypeDetection: true
  },
  auditLog: [
    { ts: new Date().toISOString(), message: "System initialized on reference UI." }
  ]
};

let state = loadLocalState();
let cloudServices = { openaiConfigured: false, searchConfigured: false, blobConfigured: false };
let highlightMode = false;
let currentParagraphId = 1;
let currentAttempt = 0;
let cardIndex = 0;
let flipped = false;
let voiceActive = false;

const flashcards = [
  { q: "What are the two key properties needed for Dynamic Programming?", a: "Optimal substructure and overlapping subproblems." },
  { q: "Memoization vs Tabulation: key difference?", a: "Memoization computes on demand recursively. Tabulation computes bottom-up iteratively." },
  { q: "What does LCS stand for?", a: "Longest Common Subsequence." },
  { q: "What is the typical complexity of 0/1 Knapsack DP?", a: "O(nW), where n is item count and W is capacity." },
  { q: "When is a graph bipartite?", a: "If and only if it has no odd-length cycle." }
];

function init() {
  ensureDynamicContainers();
  bindNotesSelectionCapture();
  loadCloudHealth().then(() => hydrateStateFromBackend()).then(() => {
    hydrateFromDom();
    renderHighlights();
    renderRecommendations();
    renderCloudStatus();
    renderFlashcard();
    initWeeklyChart();
    initHeatmap();
  });
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
    const aiBox = wrap.querySelector(".para-ai-box");
    if (!id || !paraText || !aiBox) return;
    if (!state.notes[id]) {
      state.notes[id] = {
        text: paraText.textContent.trim(),
        status: id === 1 ? "clear" : "unreviewed",
        attempt: 0
      };
    }
  });
  scheduleSave();
}

function renderCloudStatus() {
  const topbarSub = document.querySelector("#page-dashboard .topbar-sub");
  if (!topbarSub) return;
  const status = `OpenAI: ${cloudServices.openaiConfigured ? "Connected" : "Not configured"} · Search: ${cloudServices.searchConfigured ? "Connected" : "Not configured"} · Blob: ${cloudServices.blobConfigured ? "Connected" : "Not configured"}`;
  topbarSub.textContent = `${topbarSub.textContent.split("|")[0].trim()} | ${status}`;
}

async function explainPara(id) {
  const wrap = document.getElementById(`para-${id}`);
  if (!wrap) return;
  currentParagraphId = id;
  currentAttempt = 0;

  const checkbox = wrap.querySelector(".para-checkbox");
  const aiBox = document.getElementById(`ai-box-${id}`);
  const paraText = wrap.querySelector(".para-text");
  if (!aiBox || !paraText) return;

  checkbox?.classList.add("checked");
  checkbox.textContent = "✓";
  aiBox.classList.add("visible");
  aiBox.innerHTML = `<div class="para-ai-header">AI is generating explanation...</div>`;

  const explanation = await getExplanation(paraText.textContent, 0, "");
  aiBox.innerHTML = `
    <div class="para-ai-header">AI Explanation · ${escapeHtml(explanation.provider || "unknown")}</div>
    <div>${escapeHtml(explanation.context || "")}</div>
    <div style="margin-top:8px;color:var(--text);"><strong>Example:</strong> ${escapeHtml(explanation.example || "")}</div>
    <div style="margin-top:8px;color:var(--text3);"><strong>Check:</strong> ${escapeHtml(explanation.check || "")}</div>
    <div class="msg-clarity">
      <button class="clarity-btn clarity-yes" onclick="markClear(${id}, true)">✓ Clear!</button>
      <button class="clarity-btn clarity-no" onclick="markClear(${id}, false)">✗ Still confused</button>
    </div>
  `;

  state.notes[id].status = "reviewed";
  state.notes[id].attempt = 0;
  logAudit(`Paragraph ${id} explained (${explanation.provider || "unknown"}).`);
  scheduleSave();
}

async function markClear(id, clear) {
  const aiBox = document.getElementById(`ai-box-${id}`);
  if (!aiBox) return;
  if (clear) {
    state.notes[id].status = "clear";
    aiBox.insertAdjacentHTML("beforeend", `<div style="margin-top:10px;color:var(--accent);font-size:12px;">Marked clear. Mastery signal updated.</div>`);
    logAudit(`Paragraph ${id} marked clear.`);
    scheduleSave();
    return;
  }

  state.notes[id].status = "not_clear";
  state.notes[id].attempt = (state.notes[id].attempt || 0) + 1;
  currentAttempt = state.notes[id].attempt;
  const paragraph = state.notes[id].text;
  const explanation = await getExplanation(paragraph, currentAttempt, "not clear");
  aiBox.innerHTML = `
    <div class="para-ai-header">Simplified Explanation · Attempt ${currentAttempt + 1}</div>
    <div>${escapeHtml(explanation.context || explanation.concept || "")}</div>
    <div style="margin-top:8px;"><strong>Example:</strong> ${escapeHtml(explanation.example || "")}</div>
    <div class="msg-clarity" style="margin-top:10px;">
      <button class="clarity-btn clarity-yes" onclick="markClear(${id}, true)">✓ Got it now!</button>
      <button class="clarity-btn clarity-no" onclick="markClear(${id}, false)">✗ Simplify again</button>
    </div>
  `;
  logAudit(`Paragraph ${id} requested simplification attempt ${currentAttempt + 1}.`);
  scheduleSave();
}

async function getExplanation(paragraph, attempt, feedback) {
  try {
    return await apiPost(API.explain, {
      paragraph,
      attempt,
      feedback,
      topicHint: "Dynamic Programming"
    });
  } catch {
    return {
      concept: paragraph.split(".")[0] + ".",
      context: "Break the idea into one simple rule and apply it to a small example first.",
      example: "Solve one sample by hand, then explain each step aloud.",
      check: "Can you restate this in one line without notes?",
      provider: "fallback"
    };
  }
}

function toggleHighlightMode() {
  highlightMode = !highlightMode;
  const btn = document.getElementById("tb-highlight");
  if (!btn) return;
  btn.classList.toggle("active", highlightMode);
  btn.textContent = highlightMode ? "🖊 Highlight ON" : "🖊 Highlight";
}

function bindNotesSelectionCapture() {
  const notesBody = document.getElementById("notesBody");
  if (!notesBody) return;
  notesBody.addEventListener("mouseup", async () => {
    if (!highlightMode) return;
    const selected = (window.getSelection()?.toString() || "").trim();
    if (!selected || selected.length < 10) return;
    await saveHighlightFromSelection(selected);
    window.getSelection()?.removeAllRanges();
  });
}

async function saveHighlightFromSelection(selectedText) {
  const analysis = await analyzeHighlight(selectedText, "Algorithms");
  const item = {
    text: selectedText,
    topic: "Algorithms",
    summary: analysis.summary,
    context: analysis.context,
    followUpQuestion: analysis.followUpQuestion,
    provider: analysis.provider || "fallback",
    date: new Date().toISOString().slice(0, 10)
  };
  state.highlights.unshift(item);
  logAudit(`Highlight saved (${item.provider}).`);
  scheduleSave();
  renderHighlights();
}

async function analyzeHighlight(text, topic) {
  try {
    return await apiPost(API.highlightAnalyze, { text, topic });
  } catch {
    return {
      summary: text.split(/\s+/).slice(0, 18).join(" ") + "...",
      context: "Review this with one worked example and one timed question.",
      followUpQuestion: "Where does this fail if assumptions change?",
      provider: "fallback"
    };
  }
}

function renderHighlights() {
  const wrap = document.getElementById("dynamicHighlights");
  if (!wrap) return;
  wrap.innerHTML = "";
  state.highlights.slice(0, 8).forEach((h) => {
    const item = document.createElement("div");
    item.className = "highlight-item";
    item.innerHTML = `
      <div class="highlight-color" style="background:var(--accent)"></div>
      <div class="highlight-body">
        <div class="highlight-text">${escapeHtml(h.text)}</div>
        <div class="highlight-context">${escapeHtml(h.topic)} · ${h.date} · ${escapeHtml(h.provider)}</div>
        <div class="highlight-tags">
          <span class="chip chip-green" style="font-size:11px;">Summary</span>
          <span class="chip chip-purple" style="font-size:11px;">Context</span>
        </div>
        <div class="para-ai-box visible" style="margin-top:10px;">
          <div class="para-ai-header">Auto Context</div>
          <div style="font-size:12px;color:var(--text2);line-height:1.7;">${escapeHtml(h.summary)}<br><br>${escapeHtml(h.context)}</div>
        </div>
      </div>
    `;
    wrap.appendChild(item);
  });
}

function renderFlashcard() {
  const q = document.getElementById("flashcard-q");
  if (!q) return;
  const item = flashcards[cardIndex];
  q.textContent = flipped ? item.a : item.q;
}

function flipCard() {
  flipped = !flipped;
  const btn = document.querySelector("#page-highlights .btn-secondary");
  renderFlashcard();
  if (btn) btn.textContent = flipped ? "🔄 Back to Question" : "🔄 Reveal Answer";
}

function nextCard() {
  cardIndex = (cardIndex + 1) % flashcards.length;
  flipped = false;
  renderFlashcard();
  const btn = document.querySelector("#page-highlights .btn-secondary");
  if (btn) btn.textContent = "🔄 Reveal Answer";
}

async function sendMessage() {
  const input = document.getElementById("chatInput");
  const msg = (input?.value || "").trim();
  if (!msg) return;
  addUserMsg(msg);
  input.value = "";

  const response = await tutorResponse(msg);
  addAIMsg(response.html, response.provider);
}

async function tutorResponse(question) {
  const prompt = `Student asked: ${question}. Explain clearly with short steps and one example.`;
  try {
    const out = await apiPost(API.explain, {
      paragraph: prompt,
      attempt: 0,
      feedback: "",
      topicHint: "Tutor"
    });
    return {
      html: `<div style="font-size:11px;color:var(--accent);margin-bottom:8px;font-weight:600;">Why this response: based on your active topic and recent weak areas.</div><strong>${escapeHtml(out.concept || "Concept")}</strong><br><br>${escapeHtml(out.context || "")}<br><br><strong>Example:</strong> ${escapeHtml(out.example || "")}<br><br><strong>Check:</strong> ${escapeHtml(out.check || "")}`,
      provider: out.provider || "openai"
    };
  } catch {
    return {
      html: `I can still help offline: break the concept into one rule, one example, and one test question. Then explain it in your own words.`,
      provider: "fallback"
    };
  }
}

function quickAsk(q) {
  const input = document.getElementById("chatInput");
  if (!input) return;
  input.value = q;
  sendMessage();
}

function addUserMsg(text) {
  const container = document.getElementById("chatMessages");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "msg user";
  div.innerHTML = `
    <div class="msg-avatar msg-user-avatar">AK</div>
    <div>
      <div class="msg-bubble">${escapeHtml(text)}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px;text-align:right;padding-right:4px;">${timeNow()}</div>
    </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function addAIMsg(html, provider = "openai") {
  const container = document.getElementById("chatMessages");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "msg ai";
  div.innerHTML = `
    <div class="msg-avatar msg-ai-avatar">🤖</div>
    <div>
      <div class="msg-bubble">${html}<div style="margin-top:8px;font-size:11px;color:var(--text3);">Provider: ${escapeHtml(provider)}</div></div>
      <div class="msg-clarity">
        <button class="clarity-btn clarity-yes" onclick="sendClarityMsg(true)">✓ Clear!</button>
        <button class="clarity-btn clarity-no" onclick="sendClarityMsg(false)">✗ Still confused</button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px;padding-left:4px;">${timeNow()}</div>
    </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function sendClarityMsg(clear) {
  if (clear) {
    addUserMsg("✓ That's clear.");
    addAIMsg("Great. I logged this as understood and will increase concept difficulty gradually.", "system");
  } else {
    addUserMsg("✗ Still confused, simplify.");
    addAIMsg("No issue. I'll simplify with shorter steps and a concrete analogy.", "system");
  }
}

function handleChatKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function startVoice() {
  toggleVoice();
}

function toggleVoice() {
  const btn = document.getElementById("voiceBtn");
  const status = document.getElementById("voiceStatus");
  if (!btn) return;
  voiceActive = !voiceActive;
  if (voiceActive) {
    btn.classList.add("listening");
    btn.textContent = "🎙";
    if (status) status.textContent = "Listening or playing explanation...";
    const text = "Dynamic programming solves repeated sub-problems efficiently by storing intermediate results.";
    if ("speechSynthesis" in window) {
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.92;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
      utter.onend = () => {
        voiceActive = false;
        btn.classList.remove("listening");
        btn.textContent = "🔊";
        if (status) status.textContent = "Tap to listen to AI audio explanation";
      };
    }
  } else {
    btn.classList.remove("listening");
    btn.textContent = "🔊";
    if (status) status.textContent = "Tap to listen to AI audio explanation";
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }
}

function toggleFeedback(btn, type) {
  const parent = btn.parentElement;
  parent.querySelectorAll(".feedback-btn").forEach((b) => b.classList.remove("active-up", "active-down"));
  if (type === "up") btn.classList.add("active-up");
  else btn.classList.add("active-down");
}

async function runRagQuery() {
  const input = document.getElementById("ragQueryInput");
  const out = document.getElementById("ragResults");
  if (!input || !out) return;
  const query = input.value.trim();
  if (!query) return;
  out.textContent = "Querying Azure AI Search...";
  try {
    const res = await apiPost(API.ragQuery, { query, topK: 5 });
    if (!res.hits?.length) {
      out.textContent = "No matching documents in index.";
      return;
    }
    out.innerHTML = res.hits.map((h) => `<div style="margin-bottom:8px;"><strong>${escapeHtml(h.title || "Untitled")}</strong><br>${escapeHtml(h.snippet || "")}<br><span style="color:var(--text3)">Source: ${escapeHtml(h.source || "")}</span></div>`).join("");
    logAudit(`RAG query executed: ${query}`);
  } catch (error) {
    out.textContent = `RAG query failed: ${error.message || "unknown error"}`;
  }
}

async function indexLatestHighlight() {
  const out = document.getElementById("ragResults");
  const latest = state.highlights[0];
  if (!out) return;
  if (!latest) {
    out.textContent = "No highlight to index. Save one from Active Reading first.";
    return;
  }
  out.textContent = "Indexing latest highlight...";
  try {
    await apiPost(API.ragIndexNote, {
      studentId: state.student.id,
      title: `${latest.topic} ${latest.date}`,
      text: `${latest.text}\nSummary: ${latest.summary}\nContext: ${latest.context}`,
      source: "student-highlight"
    });
    out.textContent = "Latest highlight indexed successfully.";
    logAudit("Indexed latest highlight to search.");
  } catch (error) {
    out.textContent = `Indexing failed: ${error.message || "unknown error"}`;
  }
}

async function renderRecommendations() {
  const recCards = document.querySelectorAll("#page-recommendations .rec-card");
  if (!recCards.length) return;
  try {
    const result = await apiPost(API.recommendations, { state });
    state.liveRecommendation = result;
    const next = result.nextActions || [];
    if (next[0]) recCards[0].querySelector(".rec-title").textContent = next[0];
    if (next[1] && recCards[1]) recCards[1].querySelector(".rec-title").textContent = next[1];
    if (next[2] && recCards[2]) recCards[2].querySelector(".rec-title").textContent = next[2];
    logAudit(`Recommendations refreshed (${result.provider || "unknown"}).`);
    scheduleSave();
  } catch {
    // keep static cards
  }
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

function initWeeklyChart() {
  const chart = document.getElementById("weeklyChart");
  if (!chart) return;
  const data = [
    { day: "Mon", h: 1.8, col: "var(--accent)" },
    { day: "Tue", h: 2.4, col: "var(--accent2)" },
    { day: "Wed", h: 1.2, col: "var(--accent3)" },
    { day: "Thu", h: 2.0, col: "var(--accent4)" },
    { day: "Fri", h: 2.6, col: "var(--accent)" },
    { day: "Sat", h: 3.1, col: "var(--accent2)" },
    { day: "Sun", h: 1.7, col: "var(--accent3)" }
  ];
  const maxH = Math.max(...data.map((d) => d.h));
  chart.innerHTML = "";
  data.forEach((d) => {
    const wrap = document.createElement("div");
    wrap.className = "chart-bar-wrap";
    const h = Math.round((d.h / maxH) * 100);
    wrap.innerHTML = `<div class="chart-bar" style="height:${h}%;background:${d.col};opacity:${d.col === "var(--accent)" ? "0.9" : "0.5"};"></div><div class="chart-label">${d.day}</div>`;
    chart.appendChild(wrap);
  });
}

function initHeatmap() {
  const heatmap = document.getElementById("heatmap");
  if (!heatmap) return;
  heatmap.innerHTML = "";
  for (let i = 0; i < 16 * 7; i += 1) {
    const cell = document.createElement("div");
    const v = Math.random();
    cell.className = `heat-cell ${v > 0.82 ? "heat-4" : v > 0.65 ? "heat-3" : v > 0.45 ? "heat-2" : v > 0.22 ? "heat-1" : ""}`;
    heatmap.appendChild(cell);
  }
}

const modals = {
  focus: { title: "Start Focus Session", body: "<div class='form-group'><label class='form-label'>Mode</label><select class='select'><option>Active Reading</option><option>AI Tutor</option><option>Practice Questions</option></select></div>", confirm: "Start" },
  visual: { title: "Concept Visualization", body: "<div class='form-group'><label class='form-label'>Concept</label><input class='input' placeholder='Enter concept...' value='Memoization vs Tabulation'></div>", confirm: "Generate" },
  export: { title: "Export Highlights", body: "<div style='font-size:13px;color:var(--text3);line-height:1.7;'>Export current highlights to JSON report from dashboard.</div>", confirm: "Close" },
  "full-plan": { title: "Generate Full Plan", body: "<div class='form-group'><label class='form-label'>Available hours</label><input class='input' type='number' value='12'></div>", confirm: "Generate" },
  "override-rec": { title: "Override Recommendation", body: "<div class='form-group'><label class='form-label'>Reason</label><textarea class='input' style='height:90px;resize:none;' placeholder='Why this recommendation does not fit...'></textarea></div>", confirm: "Submit" },
  snooze: { title: "Snooze Recommendation", body: "<div class='form-group'><select class='select'><option>3 days</option><option>1 week</option></select></div>", confirm: "Snooze" },
  "context-override": { title: "Override Tutor Context", body: "<div class='form-group'><label class='form-label'>Learning style</label><select class='select'><option>Analogy-based</option><option>Visual-first</option></select></div>", confirm: "Save" },
  "add-session": { title: "Add Session", body: "<div class='form-group'><label class='form-label'>Subject</label><input class='input' value='Algorithms'></div>", confirm: "Add" },
  "upload-paper": { title: "Upload Practice Paper", body: "<div style='font-size:13px;color:var(--text3);'>Upload is demo-only in this build.</div>", confirm: "Close" },
  "time-input": { title: "30-minute Plan", body: "<div style='font-size:13px;color:var(--text3);'>Focus on one weak-topic drill + one timed check.</div>", confirm: "Apply" }
};

function openModal(key) {
  const m = modals[key];
  if (!m) return;
  const overlay = document.getElementById("modal-overlay");
  const content = document.getElementById("modal-content");
  if (!overlay || !content) return;
  content.innerHTML = `
    <div class="modal-title">${m.title}</div>
    <div class="modal-sub">${m.body}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="closeModal()">${m.confirm}</button>
    </div>`;
  overlay.classList.add("open");
}

function closeModal(e) {
  if (!e || e.target === document.getElementById("modal-overlay")) {
    document.getElementById("modal-overlay")?.classList.remove("open");
  }
}

async function loadCloudHealth() {
  try {
    const health = await apiGet(API.health);
    cloudServices = health.services || cloudServices;
  } catch {
    cloudServices = { openaiConfigured: false, searchConfigured: false, blobConfigured: false };
  }
}

async function hydrateStateFromBackend() {
  if (!cloudServices.blobConfigured) return;
  try {
    const remote = await apiGet(API.state(state.student.id || STUDENT_ID));
    state = mergeDeep(structuredClone(defaultState), remote);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    logAudit("Loaded student state from Blob.");
  } catch {
    logAudit("Cloud state unavailable. Using local state.");
  }
}

function scheduleSave() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  persistStateToBackend();
}

async function persistStateToBackend() {
  if (!cloudServices.blobConfigured) return;
  try {
    await apiPut(API.state(state.student.id || STUDENT_ID), state);
  } catch {
    // keep local only
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
  state.auditLog.push({ ts: new Date().toISOString(), message });
  if (state.auditLog.length > 150) state.auditLog = state.auditLog.slice(-150);
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function apiGet(url) {
  const res = await fetch(url);
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `GET ${url} failed`);
  return payload;
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `POST ${url} failed`);
  return payload;
}

async function apiPut(url, body) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `PUT ${url} failed`);
  return payload;
}

async function parseMaybeJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

window.navigate = navigate;
window.explainPara = explainPara;
window.markClear = markClear;
window.toggleHighlightMode = toggleHighlightMode;
window.flipCard = flipCard;
window.nextCard = nextCard;
window.sendMessage = sendMessage;
window.quickAsk = quickAsk;
window.addUserMsg = addUserMsg;
window.addAIMsg = addAIMsg;
window.sendClarityMsg = sendClarityMsg;
window.handleChatKey = handleChatKey;
window.startVoice = startVoice;
window.toggleVoice = toggleVoice;
window.toggleFeedback = toggleFeedback;
window.openModal = openModal;
window.closeModal = closeModal;
window.initWeeklyChart = initWeeklyChart;
window.initHeatmap = initHeatmap;
window.runRagQuery = runRagQuery;
window.indexLatestHighlight = indexLatestHighlight;

window.addEventListener("DOMContentLoaded", init);
