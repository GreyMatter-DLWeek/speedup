import { initFeature1 } from "./src/feature-modules/feature1.js";
import { initFeature2 } from "./src/feature-modules/feature2.js";
import { initFeature3 } from "./src/feature-modules/feature3.js";
import { initFeature4 } from "./src/feature-modules/feature4.js";
import { initFeature5 } from "./src/feature-modules/feature5.js";
import { initFeature6 } from "./src/feature-modules/feature6.js";
import { initFeature7 } from "./src/feature-modules/feature7.js";
import { initFeature8 } from "./src/feature-modules/feature8.js";

const STORAGE_KEY_PREFIX = "speedup_dashboard_reference_v1";
const STUDENT_ID = "";
const SIDEBAR_ORDER_KEY = "speedup_sidebar_order_v1";

let defaultSidebarOrder = null;
let initialSidebarSnapshot = null;
let settingsDragState = null;

const API = {
  health: "/api/health",
  userState: "/api/user/state",
  userControls: "/api/user/controls",
  userExam: "/api/user/exam",
  practiceAnalyze: "/api/practice/analyze",
  practiceUploads: "/api/practice/uploads",
  practiceUpload: (uploadId) => `/api/practice/uploads/${encodeURIComponent(uploadId)}`,
  practiceDeleteUploads: "/api/practice/uploads/delete-bulk",
  practiceGenerateQuiz: "/api/practice/generate-quiz",
  practiceGenerateFlashcards: "/api/practice/generate-flashcards",
  explain: "/api/explain",
  tutorQuery: "/api/tutor/query",
  highlightAnalyze: "/api/highlight/analyze",
  ragQuery: "/api/rag/query",
  ragIndexNote: "/api/rag/index-note",
  recommendations: "/api/recommendations",
  timeManagementState: (studentId, weekStart) => {
    const base = `/api/time-management/${encodeURIComponent(studentId)}`;
    return weekStart ? `${base}?weekStart=${encodeURIComponent(weekStart)}` : base;
  },
  timeManagementProfile: (studentId) => `/api/time-management/${encodeURIComponent(studentId)}/profile`,
  timeManagementUploadSchoolTimetable: (studentId) => `/api/time-management/${encodeURIComponent(studentId)}/upload-school-timetable`,
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
  tutorHistory: [],
  tutorDrafts: {
    "active-reading": "",
    "study-notes": "",
    "practice-papers": ""
  },
  tutorRevisitQueue: [],
  practiceErrorLog: [],
  notes: {},
  highlights: [],
  practiceUploads: [],
  focusSessions: [],
  dashboardFeedback: {},
  examHistory: [],
  responsibleControls: {
    explainability: true,
    personalization: true,
    decayModeling: true,
    errorTypeDetection: true,
    externalStudyCredit: false
  },
  auditLog: []
};

const flashcards = [];

const modals = {
  focus: { title: "Start Focus Session", body: "", confirm: "Start" },
  reschedule: { title: "Reschedule Session", body: "", confirm: "Open timetable" },
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
  state: structuredClone(defaultState),
  cloudServices: { openaiConfigured: false, ragConfigured: false, firebaseConfigured: false, fileStorageConfigured: false },
  highlightMode: false,
  currentParagraphId: 1,
  currentAttempt: 0,
  cardIndex: 0,
  flipped: false,
  voiceActive: false,
  authUser: null,
  flashcards,
  tutorPanelOpen: false,
  tutorPanelDocked: true,
  tutorPanelPosition: null,
  tutorPeekTop: 132,
  tutorDragState: null,
  tutorInteractionsBound: false,
  tutorContextType: "active-reading",
  tutorContextLabel: "Context: Active Reading",
  tutorScopeMeta: []
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
  bindTutorKeyboardShortcuts();
  initTutorPanelInteractions();

  await loadCloudHealth();
  await hydrateStateFromBackend();

  hydrateFromDom();
  initResponsibleAiPage();
  feature2.renderHighlights();
  feature5.renderRecommendations();
  renderCloudStatus();
  feature2.renderFlashcard();
  await feature6.refreshFeature6();
  feature8.hydrateFeedbackSelections();
  feature7.initPracticeFeature();

  renderTutorPanel();
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

function initResponsibleAiPage() {
  const page = document.getElementById("page-responsible");
  if (!page) return;

  const defaultControls = structuredClone(defaultState.responsibleControls || {});
  runtime.state.responsibleControls = mergeDeep(defaultControls, runtime.state.responsibleControls || {});
  renderResponsibleControls();

  if (!page.dataset.responsibleBound) {
    page.dataset.responsibleBound = "1";

    page.addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-responsible-control]");
      if (!toggle) return;
      const key = toggle.dataset.responsibleControl;
      if (!key) return;
      const current = Boolean(runtime.state.responsibleControls?.[key]);
      setResponsibleControl(key, !current);
    });

    page.addEventListener("keydown", (event) => {
      const toggle = event.target.closest("[data-responsible-control]");
      if (!toggle) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const key = toggle.dataset.responsibleControl;
      if (!key) return;
      const current = Boolean(runtime.state.responsibleControls?.[key]);
      setResponsibleControl(key, !current);
    });
  }

  const downloadBtn = document.getElementById("downloadDataBtn");
  if (downloadBtn && !downloadBtn.dataset.bound) {
    downloadBtn.dataset.bound = "1";
    downloadBtn.addEventListener("click", downloadResponsibleData);
  }

  const resetBtn = document.getElementById("resetAiProfileBtn");
  if (resetBtn && !resetBtn.dataset.bound) {
    resetBtn.dataset.bound = "1";
    resetBtn.addEventListener("click", resetAiProfile);
  }

  const deleteBtn = document.getElementById("deleteAllDataBtn");
  if (deleteBtn && !deleteBtn.dataset.bound) {
    deleteBtn.dataset.bound = "1";
    deleteBtn.addEventListener("click", deleteAllUserData);
  }
}

function renderResponsibleControls() {
  const controls = runtime.state.responsibleControls || {};
  document.querySelectorAll("[data-responsible-control]").forEach((el) => {
    const key = el.dataset.responsibleControl;
    const on = Boolean(controls[key]);
    el.classList.toggle("on", on);
    el.setAttribute("aria-checked", on ? "true" : "false");
  });
}

function setResponsibleControl(key, enabled) {
  if (!runtime.state.responsibleControls || typeof runtime.state.responsibleControls !== "object") {
    runtime.state.responsibleControls = structuredClone(defaultState.responsibleControls || {});
  }
  runtime.state.responsibleControls[key] = Boolean(enabled);
  renderResponsibleControls();
  logAudit(`Responsible setting changed: ${key}=${Boolean(enabled) ? "on" : "off"}.`);
  scheduleSave();
  apiPost(API.userControls, { controls: { [key]: Boolean(enabled) } }).catch(() => {});
}

async function downloadResponsibleData() {
  let payload = runtime.state;
  try {
    const remote = await apiGet(API.userState);
    payload = remote?.state || payload;
  } catch {
    // Keep local payload fallback.
  }

  const exported = {
    exportedAt: new Date().toISOString(),
    studentId: runtime.authUser?.uid || runtime.state.student?.id || "",
    state: payload
  };
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `speedup-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  logAudit("User exported data copy.");
  scheduleSave();
}

function resetAiProfile() {
  const ok = window.confirm("Reset AI profile now? This will clear learned mastery and recommendation signals.");
  if (!ok) return;

  runtime.state.responsibleControls = structuredClone(defaultState.responsibleControls || {});
  runtime.state.mastery = [];
  runtime.state.topics = [];
  runtime.state.recommendedActions = [];
  runtime.state.liveRecommendation = structuredClone(defaultState.liveRecommendation || {});
  runtime.state.practiceErrorLog = [];
  runtime.state.tutorRevisitQueue = [];

  renderResponsibleControls();
  feature8.hydrateFeedbackSelections();
  logAudit("AI profile reset by user.");
  scheduleSave();
}

function deleteAllUserData() {
  const ok = window.confirm("Delete all saved learning data? This action cannot be undone.");
  if (!ok) return;

  runtime.state = structuredClone(defaultState);
  runtime.state.student.id = runtime.authUser?.uid || runtime.state.student.id || "";
  if (!runtime.state.student.name && runtime.authUser?.email) {
    runtime.state.student.name = runtime.authUser.email.split("@")[0];
  }
  logAudit("All user data deleted by user.");
  renderResponsibleControls();
  feature8.hydrateFeedbackSelections();
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

  syncTutorContextFromPage(page);

  if (page === "timetable") {
    feature4.refreshTimeManagement();
  }
  if (page === "dashboard" || page === "progress") {
    feature6.refreshFeature6().then(() => {
      feature8.hydrateFeedbackSelections();
    });
  }
}

function inferCurrentPage() {
  const active = document.querySelector(".page.active")?.id || "";
  return active.replace(/^page-/, "") || "dashboard";
}

function mapPageToTutorContext(page) {
  if (page === "study-notes") return "study-notes";
  if (page === "practice") return "practice-papers";
  return "active-reading";
}

function syncTutorContextFromPage(page = inferCurrentPage()) {
  if (!runtime.tutorPanelOpen) {
    runtime.tutorContextType = mapPageToTutorContext(page);
  }
  renderTutorContextHeader();
}

function bindTutorKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const target = e.target;
    const tag = String(target?.tagName || "").toLowerCase();
    const isTyping = ["input", "textarea", "select"].includes(tag) || target?.isContentEditable;

    if (e.key === "/" && !isTyping) {
      e.preventDefault();
      openTutorPanel();
      return;
    }

    if (e.key === "Escape" && (runtime.tutorPanelOpen || runtime.tutorPanelDocked)) {
      closeTutorPanel();
    }
  });
}

function initTutorPanelInteractions() {
  if (runtime.tutorInteractionsBound) return;
  runtime.tutorInteractionsBound = true;

  const dragHandle = document.getElementById("tutorDragHandle");
  const panel = document.getElementById("tutorPanel");
  if (!dragHandle || !panel) return;

  dragHandle.addEventListener("pointerdown", (event) => {
    if (!runtime.tutorPanelOpen || runtime.tutorPanelDocked) return;
    if (event.button !== 0) return;
    if (event.target?.closest("button, textarea, input, .tutor-action-btn, .chip")) return;

    const rect = panel.getBoundingClientRect();
    const current = ensureTutorPanelPosition(rect);
    runtime.tutorDragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTop: current.top,
      startRight: current.right,
      moved: false
    };

    panel.classList.add("dragging");
    dragHandle.setPointerCapture?.(event.pointerId);
  });

  dragHandle.addEventListener("pointermove", (event) => {
    const drag = runtime.tutorDragState;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) drag.moved = true;

    runtime.tutorPanelPosition = {
      top: drag.startTop + deltaY,
      right: drag.startRight - deltaX
    };
    applyTutorPanelPosition();
    event.preventDefault();
  });

  const stopDrag = (event) => {
    const drag = runtime.tutorDragState;
    if (!drag) return;
    if (event?.pointerId != null && drag.pointerId !== event.pointerId) return;

    runtime.tutorDragState = null;
    panel.classList.remove("dragging");
    try {
      if (event?.pointerId != null) dragHandle.releasePointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
  };

  dragHandle.addEventListener("pointerup", stopDrag);
  dragHandle.addEventListener("pointercancel", stopDrag);
  window.addEventListener("resize", () => {
    applyTutorPanelPosition();
    updateTutorPeekPosition();
  });

  updateTutorPeekPosition();
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ensureTutorPanelPosition(existingRect = null) {
  const panel = document.getElementById("tutorPanel");
  if (!panel) return { top: 88, right: 16 };
  if (window.matchMedia("(max-width: 700px)").matches) {
    return { top: 74, right: 7 };
  }
  if (!runtime.tutorPanelPosition) {
    const rect = existingRect || panel.getBoundingClientRect();
    runtime.tutorPanelPosition = {
      top: Number.isFinite(rect.top) ? rect.top : 88,
      right: Number.isFinite(window.innerWidth - rect.right) ? window.innerWidth - rect.right : 16
    };
  }
  return clampTutorPanelPosition(runtime.tutorPanelPosition);
}

function clampTutorPanelPosition(pos) {
  const panel = document.getElementById("tutorPanel");
  if (window.matchMedia("(max-width: 700px)").matches) {
    return { top: 74, right: 7 };
  }
  const width = panel?.offsetWidth || Math.min(560, Math.floor(window.innerWidth * 0.96));
  const height = panel?.offsetHeight || Math.min(760, Math.floor(window.innerHeight * 0.78));

  const minTop = 56;
  const maxTop = Math.max(minTop, window.innerHeight - height - 8);
  const minRight = 6;
  const maxRight = Math.max(minRight, window.innerWidth - width - 6);

  return {
    top: clampNumber(Number(pos?.top ?? 88), minTop, maxTop),
    right: clampNumber(Number(pos?.right ?? 16), minRight, maxRight)
  };
}

function applyTutorPanelPosition() {
  const panel = document.getElementById("tutorPanel");
  if (!panel) return;

  const clamped = ensureTutorPanelPosition();
  runtime.tutorPanelPosition = clamped;

  panel.style.left = "auto";
  panel.style.top = `${Math.round(clamped.top)}px`;
  panel.style.right = `${Math.round(clamped.right)}px`;

  const peekTop = window.matchMedia("(max-width: 700px)").matches ? 118 : clamped.top + 54;
  runtime.tutorPeekTop = clampNumber(peekTop, 80, Math.max(80, window.innerHeight - 140));
  updateTutorPeekPosition();
}

function updateTutorPeekPosition() {
  const peek = document.getElementById("tutorPeekRobot");
  if (!peek) return;
  const top = clampNumber(Number(runtime.tutorPeekTop || 160), 76, Math.max(76, window.innerHeight - 140));
  peek.style.top = `${Math.round(top)}px`;
}

function dockTutorPanel() {
  const panel = document.getElementById("tutorPanel");
  if (panel) {
    const rect = panel.getBoundingClientRect();
    runtime.tutorPanelPosition = {
      top: rect.top,
      right: window.innerWidth - rect.right
    };
    runtime.tutorPeekTop = clampNumber(rect.top + 54, 80, Math.max(80, window.innerHeight - 140));
    panel.classList.remove("dragging");
  }
  runtime.tutorDragState = null;
  runtime.tutorPanelDocked = true;
  runtime.tutorPanelOpen = false;
  renderTutorPanel();
}

function restoreTutorPanel() {
  runtime.tutorPanelDocked = false;
  runtime.tutorPanelOpen = true;
  runtime.tutorDragState = null;
  renderTutorPanel();
  document.getElementById("tutorInput")?.focus();
}

function contextLabel(type, details = {}) {
  if (type === "study-notes") {
    return `Context: Study Pack (${details.packName || "Current Pack"}${details.section ? ` · ${details.section}` : ""})`;
  }
  if (type === "practice-papers") {
    return `Context: Practice (${details.sourceName || "Current Paper"}${details.questionId ? ` · ${details.questionId}` : ""})`;
  }
  return `Context: Active Reading (${details.docName || "Current Reading"}${details.page ? ` · p.${details.page}` : ""})`;
}

function buildTutorContext(type) {
  const activeType = type || runtime.tutorContextType || "active-reading";
  const nowPage = inferCurrentPage();
  const resolvedType = type || mapPageToTutorContext(nowPage);
  const highlights = Array.isArray(runtime.state.highlights) ? runtime.state.highlights.slice(0, 4) : [];

  if (resolvedType === "study-notes") {
    const packName = runtime.state.student?.focus ? `${runtime.state.student.focus} Study Pack` : "Study Notes Pack";
    const section = document.querySelector("#page-study-notes .section-title")?.textContent?.trim() || "Captured Highlights";
    return {
      contextType: "study-notes",
      details: { packName, section },
      context: {
        packName,
        section,
        selection: highlights[0]?.summary || highlights[0]?.text || "",
        highlights: highlights.map((h) => ({ text: h.text, summary: h.summary, section }))
      }
    };
  }

  if (resolvedType === "practice-papers") {
    const uploads = Array.isArray(runtime.state.practiceUploads) ? runtime.state.practiceUploads : [];
    const selectedValue = String(document.getElementById("quizSourceSelect")?.value || "");
    const selected = uploads.find((u) => String(u?.uploadId || "") === selectedValue) || uploads[0] || null;
    const sourceName = selected?.name || "Practice Paper";
    const questionText = selected?.analysis?.summary || selected?.sourceTextSnippet || "Current question context not selected.";
    const markingScheme = (selected?.analysis?.recommendedNextSteps || []).join(" ");
    const linkedNote = highlights[0]?.summary || "";
    const questionId = selected ? String(selected.uploadId || "Q1") : "Q1";
    return {
      contextType: "practice-papers",
      details: { sourceName, questionId },
      context: {
        sourceName,
        questionId,
        questionText,
        markingScheme,
        linkedNote
      }
    };
  }

  const paragraph = document.querySelector("#page-notes .paragraph-wrap .para-text")?.textContent?.trim() || "";
  const selection = window.getSelection?.()?.toString?.().trim?.() || "";
  const page = runtime.currentParagraphId || 1;
  const docName = "Algorithms Chapter 7";
  return {
    contextType: "active-reading",
    details: { docName, page },
    context: {
      docName,
      page,
      selection,
      currentParagraph: paragraph,
      jumpRef: "notesBody",
      highlights: highlights.map((h) => ({ text: h.text, summary: h.summary, page: page, jumpRef: "dynamicHighlights" }))
    }
  };
}

function renderTutorContextHeader() {
  const labelEl = document.getElementById("tutorScopeLabel");
  const chipsEl = document.getElementById("tutorContextChips");
  if (!labelEl || !chipsEl) return;
  labelEl.textContent = runtime.tutorContextLabel || "Context: Active Reading";
  chipsEl.innerHTML = (runtime.tutorScopeMeta || [])
    .map((v) => `<span class="tutor-context-chip">${escapeHtml(v)}</span>`)
    .join("");
}

function pushTutorMsg(role, payload) {
  runtime.state.tutorHistory = Array.isArray(runtime.state.tutorHistory) ? runtime.state.tutorHistory : [];
  runtime.state.tutorHistory.push({
    role,
    contextType: runtime.tutorContextType,
    ts: new Date().toISOString(),
    ...payload
  });
  runtime.state.tutorHistory = runtime.state.tutorHistory.slice(-120);
  scheduleSave();
}

function renderTutorMessages() {
  const wrap = document.getElementById("tutorMessages");
  if (!wrap) return;
  const rows = Array.isArray(runtime.state.tutorHistory) ? runtime.state.tutorHistory : [];
  if (!rows.length) {
    wrap.innerHTML = `<div class="tutor-msg"><div class="tutor-msg-head">Tutor · ready</div><div class="tutor-msg-body">Ask me from your current context. I will cite source snippets with page/section references.</div></div>`;
    return;
  }

  wrap.innerHTML = rows.map((m) => {
    if (m.role === "user") {
      return `<div class="tutor-msg user"><div class="tutor-msg-head">You <span>${escapeHtml(new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span></div><div class="tutor-msg-body">${escapeHtml(m.text || "")}</div></div>`;
    }

    const citations = Array.isArray(m.citations) ? m.citations : [];
    const actions = Array.isArray(m.actions) ? m.actions : [];
    const citationsHtml = citations.length
      ? `<div class="tutor-citations">${citations.map((c, i) => `
        <div class="tutor-cite">
          <div class="tutor-cite-head">
            <span>${escapeHtml(c.docName || "Source")} · ${escapeHtml(String(c.page || "N/A"))}</span>
            ${c.jumpRef ? `<button class="tutor-action-btn" onclick="jumpTutorSource('${escapeHtml(c.jumpRef)}')">Jump</button>` : ""}
          </div>
          <div class="tutor-cite-quote">${escapeHtml(c.quote || "")}</div>
        </div>
      `).join("")}</div>`
      : "";

    const actionsHtml = actions.length
      ? `<div class="tutor-actions">${actions.map((a, i) => `<button class="tutor-action-btn" onclick="runTutorAction(${rows.indexOf(m)}, ${i})">${escapeHtml(a.label || "Action")}</button>`).join("")}</div>`
      : "";

    return `<div class="tutor-msg"><div class="tutor-msg-head">Tutor · ${escapeHtml(m.provider || "local")}</div><div class="tutor-msg-body">${escapeHtml(m.answer || "")}</div>${citationsHtml}${actionsHtml}</div>`;
  }).join("");

  wrap.scrollTop = wrap.scrollHeight;
}

function renderTutorPanel() {
  const panel = document.getElementById("tutorPanel");
  const peek = document.getElementById("tutorPeekRobot");
  const fab = document.getElementById("tutorFabBtn");
  if (!panel) return;

  panel.classList.toggle("open", Boolean(runtime.tutorPanelOpen));
  panel.classList.toggle("docked", Boolean(runtime.tutorPanelDocked));
  panel.setAttribute("aria-hidden", runtime.tutorPanelOpen ? "false" : "true");

  if (runtime.tutorPanelOpen && !runtime.tutorPanelDocked) {
    applyTutorPanelPosition();
  }

  if (peek) {
    updateTutorPeekPosition();
    peek.classList.toggle("show", Boolean(runtime.tutorPanelDocked));
    peek.setAttribute("aria-hidden", runtime.tutorPanelDocked ? "false" : "true");
  }

  if (fab) {
    fab.style.display = runtime.tutorPanelOpen || runtime.tutorPanelDocked ? "none" : "inline-flex";
  }

  renderTutorContextHeader();
  renderTutorMessages();
  const input = document.getElementById("tutorInput");
  if (input) {
    input.value = runtime.state.tutorDrafts?.[runtime.tutorContextType] || "";
    input.oninput = () => {
      runtime.state.tutorDrafts = runtime.state.tutorDrafts || {};
      runtime.state.tutorDrafts[runtime.tutorContextType] = input.value;
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendTutorMessage();
      }
    };
  }
}

function openTutorPanel(type = null) {
  const built = buildTutorContext(type || mapPageToTutorContext(inferCurrentPage()));
  runtime.tutorPanelDocked = false;
  runtime.tutorPanelOpen = true;
  runtime.tutorContextType = built.contextType;
  runtime.tutorContextLabel = contextLabel(built.contextType, built.details);
  runtime.tutorScopeMeta = Object.values(built.details || {})
    .filter(Boolean)
    .map((v) => String(v));
  runtime.tutorContextCache = built;
  renderTutorPanel();
  document.getElementById("tutorInput")?.focus();
}

function closeTutorPanel() {
  dockTutorPanel();
}

function askTutorQuick(question) {
  const input = document.getElementById("tutorInput");
  if (!input) return;
  input.value = question;
  runtime.state.tutorDrafts = runtime.state.tutorDrafts || {};
  runtime.state.tutorDrafts[runtime.tutorContextType] = question;
  sendTutorMessage();
}

async function sendTutorMessage() {
  const input = document.getElementById("tutorInput");
  const text = String(input?.value || "").trim();
  if (!text) return;

  const built = buildTutorContext(runtime.tutorContextType);
  runtime.tutorContextType = built.contextType;
  runtime.tutorContextLabel = contextLabel(built.contextType, built.details);
  runtime.tutorScopeMeta = Object.values(built.details || {}).filter(Boolean).map((v) => String(v));
  runtime.tutorContextCache = built;

  pushTutorMsg("user", { text });
  runtime.state.tutorDrafts[runtime.tutorContextType] = "";
  if (input) input.value = "";
  renderTutorPanel();

  try {
    const out = await apiPost(API.tutorQuery, {
      contextType: built.contextType,
      question: text,
      context: built.context,
      studentId: runtime.state.student.id
    });

    pushTutorMsg("assistant", {
      answer: out.answer,
      provider: out.provider,
      citations: Array.isArray(out.citations) ? out.citations : [],
      actions: Array.isArray(out.actions) ? out.actions : []
    });

    if (built.contextType === "practice-papers") {
      runtime.state.practiceErrorLog = Array.isArray(runtime.state.practiceErrorLog) ? runtime.state.practiceErrorLog : [];
      runtime.state.practiceErrorLog.unshift({
        ts: new Date().toISOString(),
        question: text,
        fix: out.answer,
        reviseLink: (out.actions || []).find((a) => a.type === "revise-link")?.target || "study-notes"
      });
      runtime.state.practiceErrorLog = runtime.state.practiceErrorLog.slice(0, 80);
      runtime.state.tutorRevisitQueue = Array.isArray(runtime.state.tutorRevisitQueue) ? runtime.state.tutorRevisitQueue : [];
      runtime.state.tutorRevisitQueue.unshift({
        ts: new Date().toISOString(),
        contextType: built.contextType,
        prompt: text,
        revisitOn: addDaysIso(2)
      });
      runtime.state.tutorRevisitQueue = runtime.state.tutorRevisitQueue.slice(0, 80);
      scheduleSave();
    }
  } catch (error) {
    pushTutorMsg("assistant", {
      answer: `Tutor unavailable: ${error.message || "unknown error"}`,
      provider: "fallback",
      citations: [],
      actions: []
    });
  }

  renderTutorPanel();
}

function addDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function jumpTutorSource(jumpRef) {
  if (!jumpRef) return;
  if (jumpRef === "study-notes") {
    navigate("study-notes");
    closeTutorPanel();
    return;
  }
  if (jumpRef === "practice") {
    navigate("practice");
    closeTutorPanel();
    return;
  }
  if (jumpRef === "notes") {
    navigate("notes");
    closeTutorPanel();
    return;
  }

  const el = document.getElementById(jumpRef);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.outline = "2px solid rgba(110,231,183,0.5)";
  setTimeout(() => {
    el.style.outline = "";
  }, 1200);
}

function runTutorAction(msgIndex, actionIndex) {
  const row = runtime.state.tutorHistory?.[msgIndex];
  const action = row?.actions?.[actionIndex];
  if (!action) return;

  if (action.type === "jump") {
    jumpTutorSource(action.jumpRef);
    return;
  }

  if (action.type === "revise-link") {
    navigate(action.target || "study-notes");
    closeTutorPanel();
    return;
  }

  if (action.type === "add-note") {
    const key = `tutor-${Date.now()}`;
    runtime.state.notes[key] = {
      text: action.text || row.answer || "",
      status: "saved",
      attempt: 0
    };
    logAudit("Tutor answer added to notes.");
    scheduleSave();
    return;
  }

  if (action.type === "flashcards") {
    runtime.flashcards.unshift({
      q: "Tutor Insight",
      a: action.text || row.answer || ""
    });
    runtime.flashcards.splice(20);
    feature2.renderFlashcard();
    logAudit("Tutor answer converted to flashcard.");
    scheduleSave();
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
    saveLocalState(runtime.authUser?.uid || runtime.state.student?.id || "");
    logAudit("Loaded user state from backend.");
  } catch {
    logAudit("User state unavailable. Using local state.");
  }
}

function scheduleSave() {
  saveLocalState(runtime.authUser?.uid || runtime.state.student?.id || "");
  persistStateToBackend();
}

async function persistStateToBackend() {
  try {
    await apiPut(API.userState, { state: runtime.state });
  } catch {
    // Keep local only.
  }
}

function stateStorageKeyFor(uid = "") {
  const safeUid = String(uid || "").trim();
  return safeUid ? `${STORAGE_KEY_PREFIX}:${safeUid}` : STORAGE_KEY_PREFIX;
}

function saveLocalState(uid = "") {
  localStorage.setItem(stateStorageKeyFor(uid), JSON.stringify(runtime.state));
}

function loadLocalStateForUser(uid) {
  try {
    const scopedRaw = localStorage.getItem(stateStorageKeyFor(uid));
    if (scopedRaw) return mergeDeep(structuredClone(defaultState), JSON.parse(scopedRaw));

    if (!uid) return structuredClone(defaultState);

    // Legacy fallback for installs that used a shared single key.
    const legacyRaw = localStorage.getItem(STORAGE_KEY_PREFIX);
    if (!legacyRaw) return structuredClone(defaultState);
    return mergeDeep(structuredClone(defaultState), JSON.parse(legacyRaw));
  } catch {
    return structuredClone(defaultState);
  }
}

function loadLocalState(uid = "") {
  return loadLocalStateForUser(uid);
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
    // Load a user-scoped local cache to avoid cross-account state leakage.
    runtime.state = loadLocalStateForUser(user.uid);
    runtime.state.student.id = user.uid || runtime.state.student.id || "";
    if (!runtime.state.student.name && user.email) runtime.state.student.name = user.email.split("@")[0];
    // Cleanup legacy shared key once user-scoped storage is active.
    localStorage.removeItem(STORAGE_KEY_PREFIX);
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
  return requestJson("GET", url);
}

async function apiPost(url, body) {
  return requestJson("POST", url, body);
}

async function apiPostForm(url, formData) {
  return requestJson("POST", url, formData, true);
}

async function apiPut(url, body) {
  return requestJson("PUT", url, body);
}

async function apiDelete(url) {
  return requestJson("DELETE", url);
}

async function authHeaders(base = {}, forceRefresh = false) {
  const headers = { ...base };
  const token = await window.firebaseAuthClient?.getIdToken?.(forceRefresh);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function requestJson(method, url, body = undefined, isForm = false) {
  const attempt = async (forceRefresh = false) => {
    const headers = isForm
      ? await authHeaders({}, forceRefresh)
      : await authHeaders({ "Content-Type": "application/json" }, forceRefresh);
    const options = { method, headers };
    if (method !== "GET" && method !== "DELETE" && body !== undefined) {
      options.body = isForm ? body : JSON.stringify(body);
    }
    const res = await fetch(apiUrl(url), options);
    const payload = await parseMaybeJson(res);
    return { res, payload };
  };

  let { res, payload } = await attempt(false);
  if (!res.ok && res.status === 401 && /invalid firebase token/i.test(String(payload?.error || ""))) {
    ({ res, payload } = await attempt(true));
  }
  if (!res.ok) throw new Error(extractErrorMessage(payload, `${method} ${url} failed`));
  return payload;
}

async function parseMaybeJson(res) {
  try {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { details: text.slice(0, 500) };
    }
  } catch {
    return {};
  }
}

function extractErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  return payload.error || payload.details || payload.message || fallback;
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
  window.refreshFeature6 = feature6.refreshFeature6;
  window.initWeeklyChart = feature6.initWeeklyChart;
  window.initHeatmap = feature6.initHeatmap;
  window.runRagQuery = feature5.runRagQuery;
  window.indexLatestHighlight = feature5.indexLatestHighlight;
  window.openTutorPanel = openTutorPanel;
  window.closeTutorPanel = closeTutorPanel;
  window.dockTutorPanel = dockTutorPanel;
  window.restoreTutorPanel = restoreTutorPanel;
  window.sendTutorMessage = sendTutorMessage;
  window.askTutorQuick = askTutorQuick;
  window.jumpTutorSource = jumpTutorSource;
  window.runTutorAction = runTutorAction;
  window.openSettingsModal = openSettingsModal;
  window.saveSettingsProfile = saveSettingsProfile;
  window.resetSidebarOrder = resetSidebarOrder;
  init();
}
