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
const SIDEBAR_ORDER_KEY = "speedup_sidebar_order_v1";

let defaultSidebarOrder = null;
let initialSidebarSnapshot = null;
let settingsDragState = null;

const API = {
  health: "/api/health",
  userState: "/api/user/state",
  userExam: "/api/user/exam",
  practiceAnalyze: "/api/practice/analyze",
  explain: "/api/explain",
  highlightAnalyze: "/api/highlight/analyze",
  ragQuery: "/api/rag/query",
  ragIndexNote: "/api/rag/index-note",
  recommendations: "/api/recommendations",
  timeManagementState: (studentId, weekStart) => {
    const base = `/api/time-management/${encodeURIComponent(studentId)}`;
    return weekStart ? `${base}?weekStart=${encodeURIComponent(weekStart)}` : base;
  },
  timeManagementProfile: (studentId) => `/api/time-management/${encodeURIComponent(studentId)}/profile`,
  timeManagementGeneratePlan: (studentId) => `/api/time-management/${encodeURIComponent(studentId)}/generate-plan`,
  timeManagementTasks: (studentId) => `/api/time-management/${encodeURIComponent(studentId)}/tasks`,
  timeManagementTask: (studentId, taskId) => `/api/time-management/${encodeURIComponent(studentId)}/tasks/${encodeURIComponent(taskId)}`,
  timeManagementSlot: (studentId, day, hour) => `/api/time-management/${encodeURIComponent(studentId)}/slots/${encodeURIComponent(day)}/${encodeURIComponent(hour)}`,
  timeManagementClearWeek: (studentId, weekStart) => `/api/time-management/${encodeURIComponent(studentId)}/week/${encodeURIComponent(weekStart)}`
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
  apiDelete,
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
const appPath = (p) => (window.toAppPath ? window.toAppPath(p) : p);
const apiUrl = (p) => (window.toApiUrl ? window.toApiUrl(p) : p);

async function init() {
  const authed = await ensureAuthenticated();
  if (!authed) return;

  initialSidebarSnapshot = captureSidebarOrder();
  initSidebarOrdering();
  applyUserProfileToUi();
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
  feature4.initTimeManagement();
}

function initSidebarOrdering() {
  if (!defaultSidebarOrder) defaultSidebarOrder = captureSidebarOrder();
  const savedOrder = loadSidebarOrder();
  if (savedOrder) applySidebarOrder(savedOrder);
  if (!savedOrder) saveSidebarOrder();
}

function getSidebarSections() {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return [];
  return Array.from(sidebar.children).filter((child) => child.classList?.contains("nav-section"));
}

function getSectionLabel(section) {
  return section?.querySelector(".nav-label")?.textContent?.trim() || "";
}

function getSectionItems(section) {
  return Array.from(section?.children || []).filter((child) => child.classList?.contains("nav-item"));
}

function getNavItemPageKey(item) {
  const onclick = item?.getAttribute("onclick") || "";
  const match = onclick.match(/navigate\('([^']+)'\)/);
  return match?.[1] || "";
}

function captureSidebarOrder() {
  const sectionOrder = [];
  const itemOrders = {};
  getSidebarSections().forEach((section) => {
    const label = getSectionLabel(section);
    if (!label) return;
    sectionOrder.push(label);
    itemOrders[label] = getSectionItems(section).map((item) => getNavItemPageKey(item)).filter(Boolean);
  });
  return { sectionOrder, itemOrders };
}

function applySidebarOrder(order) {
  if (!order) return;
  const sidebar = document.querySelector(".sidebar");
  const bottom = document.querySelector(".sidebar-bottom");
  if (!sidebar || !bottom) return;

  const sections = getSidebarSections();
  const byLabel = new Map();
  sections.forEach((section) => {
    const label = getSectionLabel(section);
    if (label) byLabel.set(label, section);
  });

  const reorderedSections = [];
  (order.sectionOrder || []).forEach((label) => {
    const section = byLabel.get(label);
    if (section) {
      reorderedSections.push(section);
      byLabel.delete(label);
    }
  });
  reorderedSections.push(...byLabel.values());
  reorderedSections.forEach((section) => sidebar.insertBefore(section, bottom));

  const allItems = sections.flatMap((section) => getSectionItems(section));
  const itemByPage = new Map();
  const originalSectionByPage = new Map();
  allItems.forEach((item) => {
    const page = getNavItemPageKey(item);
    if (!page) return;
    itemByPage.set(page, item);
    originalSectionByPage.set(page, getSectionLabel(item.closest(".nav-section")));
  });

  reorderedSections.forEach((section) => {
    const label = getSectionLabel(section);
    const desiredPages = Array.isArray(order.itemOrders?.[label]) ? order.itemOrders[label] : [];
    desiredPages.forEach((page) => {
      const item = itemByPage.get(page);
      if (!item) return;
      section.appendChild(item);
      itemByPage.delete(page);
    });
  });

  itemByPage.forEach((item, page) => {
    const originalLabel = originalSectionByPage.get(page);
    const targetSection = reorderedSections.find((section) => getSectionLabel(section) === originalLabel) || reorderedSections[0];
    targetSection?.appendChild(item);
  });
}

function loadSidebarOrder() {
  try {
    const raw = localStorage.getItem(SIDEBAR_ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.sectionOrder) || typeof parsed.itemOrders !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSidebarOrder() {
  localStorage.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(captureSidebarOrder()));
}

function resetSidebarOrder(event) {
  event?.preventDefault();
  event?.stopPropagation();
  const fallback = defaultSidebarOrder || initialSidebarSnapshot || captureSidebarOrder();
  applySidebarOrder(fallback);
  localStorage.removeItem(SIDEBAR_ORDER_KEY);
  saveSidebarOrder();
  if (document.getElementById("settingsNavDndBoard")) renderSettingsNavDndBoard();
}

function getCurrentUserProfile() {
  const nameEl = document.querySelector(".user-name");
  const levelEl = document.querySelector(".user-level");
  const avatarEl = document.querySelector(".avatar");
  const name = nameEl?.textContent?.trim() || "Alex Kim";
  const levelText = levelEl?.textContent?.trim() || "Level 7 · Computer Science";
  const initials = avatarEl?.textContent?.trim() || computeInitials(name);

  let level = "Level 7";
  let program = "Computer Science";
  if (levelText.includes("·")) {
    const [left, right] = levelText.split("·").map((s) => s.trim());
    level = left || level;
    program = right || program;
  } else {
    level = levelText || level;
  }

  return { name, initials, level, program };
}

function loadUserProfile() {
  const fallback = getCurrentUserProfile();
  try {
    const raw = localStorage.getItem("speedup_user_profile_v1");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      name: parsed?.name || fallback.name,
      initials: parsed?.initials || computeInitials(parsed?.name || fallback.name),
      level: parsed?.level || fallback.level,
      program: parsed?.program || fallback.program
    };
  } catch {
    return fallback;
  }
}

function saveUserProfile(profile) {
  localStorage.setItem("speedup_user_profile_v1", JSON.stringify(profile));
}

function computeInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return "ST";
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "ST";
}

function applyUserProfileToUi(profile = null) {
  const safeProfile = profile || loadUserProfile();
  const nameEl = document.querySelector(".user-name");
  const levelEl = document.querySelector(".user-level");
  const avatarEl = document.querySelector(".avatar");
  if (nameEl) nameEl.textContent = safeProfile.name;
  if (levelEl) levelEl.textContent = `${safeProfile.level} · ${safeProfile.program}`;
  if (avatarEl) avatarEl.textContent = (safeProfile.initials || computeInitials(safeProfile.name)).slice(0, 2).toUpperCase();
}

function buildSettingsModalBody() {
  return `
    <div class="settings-layout">
      <div class="settings-card">
        <div class="settings-card-title">Navigation order</div>
        <div class="settings-help">Drag categories or tabs to reorder. Changes apply instantly.</div>
        <div id="settingsNavDndBoard" class="settings-dnd-board"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="settings-card">
          <div class="settings-card-title">Profile</div>
          <div class="form-group">
            <label class="form-label">Name</label>
            <input id="settingsNameInput" class="input" placeholder="Your name" />
          </div>
          <div class="form-group">
            <label class="form-label">Level</label>
            <input id="settingsLevelInput" class="input" placeholder="e.g. Level 7" />
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Program</label>
            <input id="settingsProgramInput" class="input" placeholder="e.g. Computer Science" />
          </div>
          <button class="btn btn-secondary" style="width:100%;margin-top:10px;" onclick="saveSettingsProfile()">Save profile</button>
        </div>

        <div class="settings-card">
          <div class="settings-card-title">Quick actions</div>
          <div class="settings-inline-row" style="margin-bottom:8px;">
            <div style="font-size:12px;color:var(--text2);">Reset navigation order</div>
            <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" onclick="resetSidebarOrder(event)">Reset</button>
          </div>
          <div style="font-size:11px;color:var(--text3);line-height:1.6;">Tip: Open this settings panel anytime from the sidebar to update order or profile info.</div>
        </div>
      </div>
    </div>
  `;
}

function openSettingsModal() {
  const overlay = document.getElementById("modal-overlay");
  const content = document.getElementById("modal-content");
  if (!overlay || !content) return;

  content.classList.add("settings-modal");
  content.innerHTML = `
    <div class="modal-title">Settings</div>
    <div class="modal-sub">Configure navigation order with drag-and-drop and update your profile details.</div>
    ${buildSettingsModalBody()}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
    </div>
  `;
  overlay.classList.add("open");

  const profile = loadUserProfile();
  const nameInput = document.getElementById("settingsNameInput");
  const levelInput = document.getElementById("settingsLevelInput");
  const programInput = document.getElementById("settingsProgramInput");
  if (nameInput) nameInput.value = profile.name;
  if (levelInput) levelInput.value = profile.level;
  if (programInput) programInput.value = profile.program;

  renderSettingsNavDndBoard();
}

function renderSettingsNavDndBoard() {
  const board = document.getElementById("settingsNavDndBoard");
  if (!board) return;
  board.innerHTML = "";

  const sections = getSidebarSections();
  sections.forEach((section, sectionIndex) => {
    const label = getSectionLabel(section);
    if (!label) return;
    const sectionBlock = document.createElement("div");
    sectionBlock.className = "settings-dnd-section";
    sectionBlock.dataset.sectionIndex = String(sectionIndex);

    const header = document.createElement("div");
    header.className = "settings-dnd-section-header";
    header.draggable = true;
    header.dataset.sectionIndex = String(sectionIndex);
    header.innerHTML = `<span>${escapeHtml(label)}</span><span class="settings-dnd-hint">Drag category</span>`;

    const tabsWrap = document.createElement("div");
    tabsWrap.className = "settings-dnd-tabs";
    tabsWrap.dataset.sectionIndex = String(sectionIndex);

    getSectionItems(section).forEach((item, tabIndex) => {
      const pageKey = getNavItemPageKey(item);
      const tab = document.createElement("div");
      tab.className = "settings-dnd-tab";
      tab.draggable = true;
      tab.dataset.sectionIndex = String(sectionIndex);
      tab.dataset.tabIndex = String(tabIndex);
      tab.dataset.pageKey = pageKey;
      tab.textContent = getNavItemLabel(item);
      tabsWrap.appendChild(tab);
    });

    sectionBlock.append(header, tabsWrap);
    board.appendChild(sectionBlock);
  });

  bindSettingsDragAndDrop();
}

function getNavItemLabel(item) {
  const clone = item.cloneNode(true);
  clone.querySelectorAll(".nav-icon, .nav-badge, .item-reorder-controls").forEach((el) => el.remove());
  return clone.textContent.replace(/\s+/g, " ").trim();
}

function bindSettingsDragAndDrop() {
  const board = document.getElementById("settingsNavDndBoard");
  if (!board) return;

  board.querySelectorAll(".settings-dnd-section-header").forEach((header) => {
    header.addEventListener("dragstart", (event) => {
      settingsDragState = { type: "section", fromSection: Number(header.dataset.sectionIndex) };
      event.dataTransfer.effectAllowed = "move";
    });
  });

  board.querySelectorAll(".settings-dnd-section").forEach((sectionEl) => {
    sectionEl.addEventListener("dragover", (event) => {
      if (settingsDragState?.type === "section") {
        event.preventDefault();
        sectionEl.classList.add("settings-drop-target");
      }
    });
    sectionEl.addEventListener("dragleave", () => sectionEl.classList.remove("settings-drop-target"));
    sectionEl.addEventListener("drop", (event) => {
      if (settingsDragState?.type !== "section") return;
      event.preventDefault();
      sectionEl.classList.remove("settings-drop-target");
      const toSection = Number(sectionEl.dataset.sectionIndex);
      reorderSectionByIndex(settingsDragState.fromSection, toSection);
      settingsDragState = null;
    });
  });

  board.querySelectorAll(".settings-dnd-tab").forEach((tab) => {
    tab.addEventListener("dragstart", (event) => {
      settingsDragState = {
        type: "tab",
        fromSection: Number(tab.dataset.sectionIndex),
        fromTab: Number(tab.dataset.tabIndex)
      };
      event.dataTransfer.effectAllowed = "move";
    });
    tab.addEventListener("dragover", (event) => {
      if (settingsDragState?.type === "tab") {
        event.preventDefault();
        tab.classList.add("settings-drop-target");
      }
    });
    tab.addEventListener("dragleave", () => tab.classList.remove("settings-drop-target"));
    tab.addEventListener("drop", (event) => {
      if (settingsDragState?.type !== "tab") return;
      event.preventDefault();
      tab.classList.remove("settings-drop-target");
      const toSection = Number(tab.dataset.sectionIndex);
      const toTab = Number(tab.dataset.tabIndex);
      reorderTabByIndex(settingsDragState.fromSection, settingsDragState.fromTab, toSection, toTab);
      settingsDragState = null;
    });
  });

  board.querySelectorAll(".settings-dnd-tabs").forEach((tabsWrap) => {
    tabsWrap.addEventListener("dragover", (event) => {
      if (settingsDragState?.type === "tab") {
        event.preventDefault();
        tabsWrap.classList.add("settings-drop-target");
      }
    });
    tabsWrap.addEventListener("dragleave", () => tabsWrap.classList.remove("settings-drop-target"));
    tabsWrap.addEventListener("drop", (event) => {
      if (settingsDragState?.type !== "tab") return;
      event.preventDefault();
      tabsWrap.classList.remove("settings-drop-target");
      const toSection = Number(tabsWrap.dataset.sectionIndex);
      const toTab = getSectionItems(getSidebarSections()[toSection] || {}).length;
      reorderTabByIndex(settingsDragState.fromSection, settingsDragState.fromTab, toSection, toTab);
      settingsDragState = null;
    });
  });
}

function reorderSectionByIndex(fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const sidebar = document.querySelector(".sidebar");
  const bottom = document.querySelector(".sidebar-bottom");
  const sections = getSidebarSections();
  if (!sidebar || !bottom || !sections[fromIndex] || !sections[toIndex]) return;

  const reordered = [...sections];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  reordered.forEach((section) => sidebar.insertBefore(section, bottom));
  saveSidebarOrder();
  renderSettingsNavDndBoard();
}

function reorderTabByIndex(fromSectionIdx, fromTabIdx, toSectionIdx, toTabIdx) {
  const sections = getSidebarSections();
  const fromSection = sections[fromSectionIdx];
  const toSection = sections[toSectionIdx];
  if (!fromSection || !toSection) return;

  const fromItems = getSectionItems(fromSection);
  const moving = fromItems[fromTabIdx];
  if (!moving) return;

  if (fromSection === toSection) {
    const items = getSectionItems(fromSection);
    const reordered = [...items];
    const [moved] = reordered.splice(fromTabIdx, 1);
    const bounded = Math.max(0, Math.min(toTabIdx, reordered.length));
    reordered.splice(bounded, 0, moved);
    reordered.forEach((item) => fromSection.appendChild(item));
  } else {
    const targetItems = getSectionItems(toSection);
    const anchor = targetItems[Math.max(0, Math.min(toTabIdx, targetItems.length - 1))];
    if (anchor) toSection.insertBefore(moving, anchor);
    else toSection.appendChild(moving);
  }

  saveSidebarOrder();
  renderSettingsNavDndBoard();
}

function saveSettingsProfile() {
  const nameInput = document.getElementById("settingsNameInput");
  const levelInput = document.getElementById("settingsLevelInput");
  const programInput = document.getElementById("settingsProgramInput");
  const profile = {
    name: (nameInput?.value || "").trim() || "Alex Kim",
    level: (levelInput?.value || "").trim() || "Level 7",
    program: (programInput?.value || "").trim() || "Computer Science"
  };
  profile.initials = computeInitials(profile.name);
  saveUserProfile(profile);
  applyUserProfileToUi(profile);
}

function ensureDynamicContainers() {
  const studyNotesPage = document.getElementById("page-study-notes");
  if (studyNotesPage) {
    const sectionHead = studyNotesPage.querySelector(".section-head");
    if (sectionHead && !document.getElementById("dynamicHighlights")) {
      const wrap = document.createElement("div");
      wrap.id = "dynamicHighlights";
      wrap.style.marginBottom = "10px";
      sectionHead.insertAdjacentElement("afterend", wrap);
    }
  }

  const studyNotesRightCol = document.querySelector("#page-study-notes .grid-2-1 > div:last-child");
  if (studyNotesRightCol && !document.getElementById("ragCard")) {
    const card = document.createElement("div");
    card.className = "card";
    card.id = "ragCard";
    card.innerHTML = `
      <div class="card-title">Study Notes RAG Assistant</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:8px;">Context-aware retrieval across your indexed notes and highlights.</div>
      <input id="ragQueryInput" class="input" placeholder="Ask from your indexed notes..." />
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;" onclick="runRagQuery()">Run RAG</button>
        <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" onclick="indexLatestHighlight()">Index Last Highlight</button>
      </div>
      <div id="ragResults" style="margin-top:8px;font-size:12px;color:var(--text2);max-height:140px;overflow:auto;"></div>
    `;
    studyNotesRightCol.appendChild(card);
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

  if (page === "timetable") {
    feature4.refreshTimeManagement();
  }
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
      window.location.replace(appPath("/login.html"));
      return false;
    }
    await authClient.initFirebaseClient();
    await authClient.waitForAuthReady();
    const user = await authClient.getUser();
    if (!user) {
      window.location.replace(appPath("/login.html"));
      return false;
    }
    runtime.authUser = user;
    runtime.state.student.id = user.uid || runtime.state.student.id || STUDENT_ID;
    if (!runtime.state.student.name && user.email) runtime.state.student.name = user.email.split("@")[0];
    authClient.onAuthChanged((nextUser) => {
      if (!nextUser) window.location.replace(appPath("/login.html"));
    });
    return true;
  } catch {
    window.location.replace(appPath("/login.html"));
    return false;
  }
}

function updateSidebarIdentity() {
  const user = runtime.authUser;
  const avatar = document.getElementById("sidebarAvatar");
  const nameEl = document.getElementById("sidebarUserName");
  const metaEl = document.getElementById("sidebarUserMeta");
  const profile = loadUserProfile();
  const email = String(user?.email || "").trim();
  const fallbackName = runtime.state.student.name || (email ? email.split("@")[0] : "Student");
  const displayName = profile.name || fallbackName;
  const initials = (profile.initials || computeInitials(displayName)).slice(0, 2).toUpperCase();
  const level = profile.level || "Level 7";
  const program = profile.program || "Computer Science";

  if (avatar) avatar.textContent = initials;
  if (nameEl) nameEl.textContent = displayName;
  if (metaEl) metaEl.textContent = `${level} · ${program}`;
}

function bindSidebarActions() {
  const settingsBtn = document.getElementById("sidebarSettingsBtn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", openSettingsModal);
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (!logoutBtn) return;
  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    try {
      await window.firebaseAuthClient?.signOutUser?.();
    } finally {
      window.location.replace(appPath("/login.html"));
    }
  });
}

async function apiGet(url) {
  const res = await fetch(apiUrl(url), { headers: await authHeaders() });
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `GET ${url} failed`);
  return payload;
}

async function apiPost(url, body) {
  const res = await fetch(apiUrl(url), {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `POST ${url} failed`);
  return payload;
}

async function apiPostForm(url, formData) {
  const res = await fetch(apiUrl(url), {
    method: "POST",
    headers: await authHeaders(),
    body: formData
  });
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `POST ${url} failed`);
  return payload;
}

async function apiPut(url, body) {
  const res = await fetch(apiUrl(url), {
    method: "PUT",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `PUT ${url} failed`);
  return payload;
}

async function apiDelete(url) {
  const res = await fetch(apiUrl(url), {
    method: "DELETE",
    headers: await authHeaders()
  });
  const payload = await parseMaybeJson(res);
  if (!res.ok) throw new Error(payload.error || `DELETE ${url} failed`);
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
  window.openTimeManagementOnboarding = feature4.openTimeManagementOnboarding;
  window.saveTimeManagementOnboarding = feature4.saveTimeManagementOnboarding;
  window.generateTimeManagementPlan = feature4.generateTimeManagementPlan;
  window.refreshTimeManagement = feature4.refreshTimeManagement;
  window.openTimetableTaskModal = feature4.openTimetableTaskModal;
  window.saveTimetableTask = feature4.saveTimetableTask;
  window.deleteTimetableTask = feature4.deleteTimetableTask;
  window.clearTimetableWeek = feature4.clearTimetableWeek;
  window.toggleTimetableTaskCompletion = feature4.toggleTimetableTaskCompletion;
  window.clearTimetableSlot = feature4.clearTimetableSlot;
  window.toggleFeedback = feature8.toggleFeedback;
  window.openModal = feature8.openModal;
  window.closeModal = feature8.closeModal;
  window.initWeeklyChart = feature6.initWeeklyChart;
  window.initHeatmap = feature6.initHeatmap;
  window.runRagQuery = feature5.runRagQuery;
  window.indexLatestHighlight = feature5.indexLatestHighlight;
  window.openSettingsModal = openSettingsModal;
  window.saveSettingsProfile = saveSettingsProfile;
  window.resetSidebarOrder = resetSidebarOrder;
  init();
}
