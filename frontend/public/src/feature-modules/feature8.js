const FOCUS_MODE_META = {
  reading: { label: "Active Reading", launch() { window.navigate?.("notes"); } },
  tutor: {
    label: "AI Tutor",
    launch() {
      window.navigate?.("notes");
      window.openTutorPanel?.("active-reading");
    }
  },
  practice: { label: "Practice Questions", launch() { window.navigate?.("practice"); } }
};

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function toPositiveInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

function formatMinutes(totalMinutes) {
  const mins = Math.max(0, toPositiveInt(totalMinutes));
  if (!mins) return "0m";
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function initFeature8(ctx) {
  const { modals, runtime, logAudit, scheduleSave } = ctx;
  let activeModalKey = "";

  function ensureFocusSessions() {
    runtime.state.focusSessions = Array.isArray(runtime.state.focusSessions) ? runtime.state.focusSessions : [];
    return runtime.state.focusSessions;
  }

  function ensureDashboardFeedback() {
    runtime.state.dashboardFeedback = runtime.state.dashboardFeedback && typeof runtime.state.dashboardFeedback === "object"
      ? runtime.state.dashboardFeedback
      : {};
    return runtime.state.dashboardFeedback;
  }

  function getFeedbackKey(el) {
    return el?.dataset?.feedbackKey
      || el?.closest?.("[data-feedback-key]")?.dataset?.feedbackKey
      || "";
  }

  function applyFeedbackState(row, value) {
    if (!row) return;
    row.querySelectorAll(".feedback-btn").forEach((button) => {
      button.classList.remove("active-up", "active-down");
      if (value === "up" && button.dataset.feedbackDirection === "up") button.classList.add("active-up");
      if (value === "down" && button.dataset.feedbackDirection === "down") button.classList.add("active-down");
    });
  }

  function hydrateFeedbackSelections() {
    const feedback = ensureDashboardFeedback();
    document.querySelectorAll(".feedback-row[data-feedback-key]").forEach((row) => {
      applyFeedbackState(row, feedback[row.dataset.feedbackKey] || "");
    });
  }

  function toggleFeedback(btn, type) {
    const row = btn?.closest?.(".feedback-row");
    if (!row) return;

    const key = getFeedbackKey(btn);
    const feedback = ensureDashboardFeedback();
    const current = key ? String(feedback[key] || "") : "";
    const next = current === type ? "" : type;

    applyFeedbackState(row, next);

    if (!key) return;
    if (next) feedback[key] = next;
    else delete feedback[key];

    logAudit(`Dashboard insight feedback updated: ${key}=${next || "cleared"}.`);
    scheduleSave();
  }

  function getFocusModeMeta(mode) {
    return FOCUS_MODE_META[mode] || FOCUS_MODE_META.reading;
  }

  function getSessionEffectiveEnd(session, now = new Date()) {
    const start = parseDate(session?.startedAt);
    if (!start) return null;

    const targetMinutes = toPositiveInt(session?.targetMinutes, 0);
    const explicitEnd = parseDate(session?.endedAt);
    let end = explicitEnd || now;

    if (targetMinutes > 0) {
      const capped = new Date(start.getTime() + (targetMinutes * 60000));
      if (capped < end) end = capped;
    }

    return end >= start ? end : start;
  }

  function getSessionMinutes(session, now = new Date()) {
    const start = parseDate(session?.startedAt);
    const end = getSessionEffectiveEnd(session, now);
    if (!start || !end) return 0;
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  }

  function getActiveFocusSession() {
    return ensureFocusSessions()
      .slice()
      .reverse()
      .find((session) => session && session.status === "active" && !session.endedAt) || null;
  }

  function persistDashboardState(message) {
    if (message) logAudit(message);
    scheduleSave();
    window.refreshFeature6?.(true);
    hydrateFeedbackSelections();
  }

  function startFocusSession(mode, targetMinutes) {
    const normalizedMode = FOCUS_MODE_META[mode] ? mode : "reading";
    const target = Math.max(15, Math.min(180, toPositiveInt(targetMinutes, 25)));
    ensureFocusSessions().push({
      id: `focus-${Date.now()}`,
      mode: normalizedMode,
      targetMinutes: target,
      startedAt: new Date().toISOString(),
      endedAt: "",
      status: "active"
    });

    persistDashboardState(`Focus session started: ${getFocusModeMeta(normalizedMode).label} (${target} min).`);
    getFocusModeMeta(normalizedMode).launch?.();
  }

  function completeFocusSession(sessionId) {
    const session = ensureFocusSessions().find((item) => String(item?.id) === String(sessionId));
    if (!session) return;

    session.endedAt = new Date().toISOString();
    session.status = "completed";
    persistDashboardState(`Focus session completed: ${getFocusModeMeta(session.mode).label} (${formatMinutes(getSessionMinutes(session))}).`);
  }

  function discardFocusSession(sessionId) {
    const session = ensureFocusSessions().find((item) => String(item?.id) === String(sessionId));
    if (!session) return;

    session.endedAt = new Date().toISOString();
    session.status = "cancelled";
    persistDashboardState(`Focus session discarded: ${getFocusModeMeta(session.mode).label}.`);
  }

  function getNextReschedulableTask() {
    const tmState = runtime.state?.timeManagement || {};
    const tasks = Array.isArray(tmState.tasks) ? tmState.tasks : [];
    const slotByTaskId = new Map(
      (Array.isArray(tmState.slots) ? tmState.slots : [])
        .filter((slot) => slot?.taskId)
        .map((slot) => [String(slot.taskId), slot])
    );

    return tasks
      .filter((task) => {
        const source = String(task?.source || "").toLowerCase();
        const type = String(task?.type || "").toLowerCase();
        return task && task.status !== "completed" && source !== "school" && type !== "school-block";
      })
      .map((task) => ({ ...task, slot: slotByTaskId.get(String(task.id)) || null }))
      .sort((a, b) => {
        const aAssigned = a.slot ? 0 : 1;
        const bAssigned = b.slot ? 0 : 1;
        if (aAssigned !== bAssigned) return aAssigned - bAssigned;
        return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
      })[0] || null;
  }

  function buildFocusModal() {
    const active = getActiveFocusSession();
    if (!active) {
      return {
        title: "Start Focus Session",
        body: `
          <div class="form-group">
            <label class="form-label">Mode</label>
            <select class="select" id="focus-mode-select">
              <option value="reading">Active Reading</option>
              <option value="tutor">AI Tutor</option>
              <option value="practice">Practice Questions</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Duration</label>
            <select class="select" id="focus-duration-select">
              <option value="25">25 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">60 minutes</option>
              <option value="90">90 minutes</option>
            </select>
          </div>
        `,
        confirm: "Start",
        onConfirm() {
          const mode = document.getElementById("focus-mode-select")?.value || "reading";
          const duration = document.getElementById("focus-duration-select")?.value || "25";
          startFocusSession(mode, duration);
        }
      };
    }

    const meta = getFocusModeMeta(active.mode);
    const startedAt = parseDate(active.startedAt);
    const elapsed = getSessionMinutes(active);
    const target = toPositiveInt(active.targetMinutes, 0);

    return {
      title: "Focus Session In Progress",
      body: `
        <div style="font-size:13px;color:var(--text3);line-height:1.7;margin-bottom:14px;">
          Keep the session running while you study, or complete it now to update your dashboard metrics.
        </div>
        <div class="form-group">
          <label class="form-label">Current focus</label>
          <div class="input" style="height:auto;min-height:0;line-height:1.6;">
            ${escapeHtml(meta.label)}<br>
            <span style="font-size:12px;color:var(--text3);">
              Started ${escapeHtml(startedAt ? startedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "recently")}
              · ${escapeHtml(formatMinutes(elapsed))}
              ${target ? ` of ${escapeHtml(formatMinutes(target))}` : ""}
            </span>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-secondary" type="button" id="focus-continue-btn">Continue Session</button>
          <button class="btn btn-ghost" type="button" id="focus-discard-btn" style="color:var(--danger);border-color:rgba(248,113,113,0.35);">Discard Session</button>
        </div>
      `,
      confirm: "Complete Session",
      onOpen(content) {
        content.querySelector("#focus-continue-btn")?.addEventListener("click", () => {
          closeModal();
          meta.launch?.();
        });
        content.querySelector("#focus-discard-btn")?.addEventListener("click", () => {
          discardFocusSession(active.id);
          closeModal();
        });
      },
      onConfirm() {
        completeFocusSession(active.id);
      }
    };
  }

  function buildRescheduleModal() {
    const tmState = runtime.state?.timeManagement || {};
    const configured = Boolean(tmState?.profile?.configured);
    const nextTask = getNextReschedulableTask();
    const slotLabel = nextTask?.slot
      ? `${String(nextTask.slot.day || "").toUpperCase()} ${String(nextTask.slot.hour || "")}`
      : "No slot assigned yet";

    return {
      title: configured ? "Reschedule Session" : "Set Up Study Timetable",
      body: configured
        ? `
          <div style="font-size:13px;color:var(--text3);line-height:1.7;margin-bottom:14px;">
            Open your timetable to move the next study block into a better slot.
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Next session</label>
            <div class="input" style="height:auto;min-height:0;line-height:1.6;">
              ${escapeHtml(nextTask?.title || nextTask?.subject || "Review upcoming study tasks")}<br>
              <span style="font-size:12px;color:var(--text3);">${escapeHtml(slotLabel)}</span>
            </div>
          </div>
        `
        : `
          <div style="font-size:13px;color:var(--text3);line-height:1.7;">
            Your timetable is not configured yet. Open onboarding to add productive hours or import your school schedule before rescheduling sessions.
          </div>
        `,
      confirm: configured ? "Open Timetable" : "Set Up Timetable",
      onConfirm() {
        window.navigate?.("timetable");
        window.setTimeout(() => {
          if (!configured) {
            window.openTimeManagementOnboarding?.();
            return;
          }
          if (nextTask?.id) window.openTimetableTaskModal?.(nextTask.id);
        }, 0);
      }
    };
  }

  function buildModalDefinition(key) {
    if (key === "focus") return buildFocusModal();
    if (key === "reschedule") return buildRescheduleModal();
    return modals[key];
  }

  function openModal(key) {
    const modal = buildModalDefinition(key);
    if (!modal) return;

    const overlay = document.getElementById("modal-overlay");
    const content = document.getElementById("modal-content");
    if (!overlay || !content) return;

    activeModalKey = key;
    content.classList.remove("settings-modal");
    content.innerHTML = `
      <div class="modal-title">${modal.title}</div>
      <div class="modal-sub">${modal.body || ""}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" data-modal-cancel>Cancel</button>
        <button class="btn btn-primary" type="button" data-modal-confirm>${modal.confirm || "Close"}</button>
      </div>
    `;

    content.querySelector("[data-modal-cancel]")?.addEventListener("click", () => closeModal());
    content.querySelector("[data-modal-confirm]")?.addEventListener("click", async () => {
      const keepOpen = await modal.onConfirm?.(content);
      if (keepOpen !== false) closeModal();
    });

    modal.onOpen?.(content);
    overlay.classList.add("open");
  }

  function closeModal(e) {
    if (!e || e.target === document.getElementById("modal-overlay")) {
      activeModalKey = "";
      document.getElementById("modal-content")?.classList.remove("settings-modal");
      document.getElementById("modal-overlay")?.classList.remove("open");
    }
  }

  return {
    toggleFeedback,
    openModal,
    closeModal,
    hydrateFeedbackSelections,
    getActiveModalKey: () => activeModalKey
  };
}
