const DAYS = ["MON", "TUE", "WED", "THU", "FRI"];
const DAY_LABELS = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri"
};
const HOURS = Array.from({ length: 24 }, (_v, hour) => `${String(hour).padStart(2, "0")}:00`);

const SUBJECT_STYLES = {
  math: "tt-math",
  mathematics: "tt-math",
  algebra: "tt-math",
  algorithms: "tt-physics",
  dp: "tt-physics",
  "dynamic programming": "tt-physics",
  computer: "tt-cs",
  os: "tt-cs",
  "operating systems": "tt-cs",
  discrete: "tt-chem",
  graph: "tt-chem",
  mock: "tt-pink"
};

function getCurrentWeekStart() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return formatDateOnly(d);
}

function formatDateOnly(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(dateString, delta) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return date;
}

function formatDateHuman(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function parseList(input) {
  return String(input || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeDay(value) {
  const v = String(value || "").trim().slice(0, 3).toUpperCase();
  return DAYS.includes(v) ? v : "";
}

function normalizeHour(value) {
  const v = String(value || "").trim();
  return HOURS.includes(v) ? v : "";
}

function formatHour(hour) {
  const [h, m] = String(hour || "00:00").split(":");
  return `${Number(h)}:${m || "00"}`;
}

function getStyleClass(subject, type) {
  const normalized = String(subject || type || "").toLowerCase();
  const key = Object.keys(SUBJECT_STYLES).find((k) => normalized.includes(k));
  const mapped = key ? SUBJECT_STYLES[key] : "tt-physics";
  return mapped === "tt-pink" ? "tt-cs" : mapped;
}

function getChipClass(subject, idx) {
  const normalized = String(subject || "").toLowerCase();
  if (normalized.includes("math") || normalized.includes("algebra")) return "chip-green";
  if (normalized.includes("algorithm") || normalized.includes("dp")) return "chip-purple";
  if (normalized.includes("os") || normalized.includes("computer")) return "chip-pink";
  if (normalized.includes("discrete") || normalized.includes("graph")) return "chip-yellow";
  return ["chip-green", "chip-purple", "chip-pink", "chip-yellow"][idx % 4];
}

function getTaskEmoji(task) {
  const combined = `${task?.subject || ""} ${task?.type || ""} ${task?.topic || ""}`.toLowerCase();
  if (combined.includes("math") || combined.includes("algebra")) return "📗";
  if (combined.includes("algorithm") || combined.includes("dp")) return "📘";
  if (combined.includes("os") || combined.includes("computer")) return "💻";
  if (combined.includes("discrete") || combined.includes("graph")) return "⚗️";
  if (combined.includes("mock") || combined.includes("exam")) return "📝";
  if (combined.includes("review")) return "🔁";
  return "📚";
}

export function initFeature4(ctx) {
  const { runtime, API, apiGet, apiPost, apiPostForm, apiPut, apiDelete, escapeHtml, logAudit, scheduleSave } = ctx;

  let timetableState = null;
  let activeWeekStart = getCurrentWeekStart();

  function getStudentId() {
    const authUid = String(runtime.authUser?.uid || "").trim();
    if (authUid) {
      runtime.state.student.id = authUid;
      return authUid;
    }
    return String(runtime.state?.student?.id || "").trim();
  }

  function requireStudentId() {
    const studentId = getStudentId();
    if (!studentId) {
      throw new Error("Your session is not ready yet. Please refresh and sign in again.");
    }
    return studentId;
  }

  function showModal(html) {
    const overlay = document.getElementById("modal-overlay");
    const content = document.getElementById("modal-content");
    if (!overlay || !content) return;
    content.innerHTML = html;
    overlay.classList.add("open");
  }

  function hideModal() {
    document.getElementById("modal-overlay")?.classList.remove("open");
  }

  function getStateSafe() {
    if (!timetableState) {
      return {
        weekStart: activeWeekStart,
        profile: {
          mode: "productive_hours",
          schoolBlocks: [],
          productiveHours: ["09:00-11:00", "20:00-22:00"],
          examDates: [],
          weeklyGoalsHours: 14
        },
        tasks: [],
        slots: [],
        notes: [],
        stats: {
          assignedSlots: 0,
          completedSlots: 0,
          completionPercent: 0,
          completedHours: 0,
          weeklyGoalHours: 14,
          remainingHours: 14,
          daysToNearestExam: null
        },
        agenda: []
      };
    }
    return timetableState;
  }

  function attachTaskPoolListeners(container, tasks) {
    container.querySelectorAll(".tm-task-pill").forEach((pill) => {
      pill.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", pill.dataset.taskId || "");
      });

      pill.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const taskId = pill.dataset.taskId;
          if (!taskId) return;
          if (btn.dataset.action === "edit") {
            openTimetableTaskModal(taskId);
          } else if (btn.dataset.action === "delete") {
            deleteTimetableTask(taskId);
          }
        });
      });
    });
  }

  function renderLegend(state) {
    const legend = document.getElementById("tm-legend");
    if (!legend) return;

    const subjects = [...new Set(
      (state.tasks || [])
        .filter((task) => {
          const source = String(task?.source || "").toLowerCase();
          const type = String(task?.type || "").toLowerCase();
          return source !== "school" && type !== "school-block";
        })
        .map((task) => task.subject || task.type || "Study")
    )]
      .filter(Boolean)
      .slice(0, 4);
    if (!subjects.length) {
      legend.innerHTML = "<span class='chip chip-purple'>📚 Study</span>";
      return;
    }

    legend.innerHTML = subjects
      .map((subject, idx) => `<span class="chip ${getChipClass(subject, idx)}">${escapeHtml(subject)}</span>`)
      .join("");
  }

  function renderProfile(state) {
    const title = document.getElementById("tm-peak-title");
    const sub = document.getElementById("tm-peak-sub");
    if (!title || !sub) return;

    const profile = state.profile || {};
    const productive = (profile.productiveHours || []).join(" and ") || "Not set";
    const modeLabel = profile.mode === "school_blocks" ? "School timetable blocks" : "Preferred productive hours";
    const examSummary = (profile.examDates || []).length ? `${profile.examDates.length} exam date(s) saved` : "No exam dates yet";

    title.textContent = `Peak Productivity: ${productive}`;
    sub.textContent = `${modeLabel} · Weekly goal ${profile.weeklyGoalsHours || 14}h · ${examSummary}`;
  }

  function renderTaskPool(state) {
    const pool = document.getElementById("tm-task-pool");
    if (!pool) return;

    const assigned = new Set((state.slots || []).map((slot) => slot.taskId).filter(Boolean));
    const unassigned = (state.tasks || []).filter((task) => {
      if (assigned.has(task.id)) return false;
      const source = String(task?.source || "").toLowerCase();
      const type = String(task?.type || "").toLowerCase();
      return source !== "school" && type !== "school-block";
    });

    if (!unassigned.length) {
      pool.innerHTML = "<div style='font-size:12px;color:var(--text3);'>No unassigned tasks. Add a session or regenerate plan.</div>";
      return;
    }

    pool.innerHTML = unassigned
      .map(
        (task) => `
          <div class="chip ${getChipClass(task.subject || task.type, 0)} tm-task-pill" draggable="true" data-task-id="${escapeHtml(task.id)}" style="gap:8px;padding-right:8px;">
            <span>${escapeHtml(getTaskEmoji(task))} ${escapeHtml(task.title)}</span>
            <button class="tm-mini-btn" data-action="edit" title="Edit task">✏️</button>
            <button class="tm-mini-btn danger" data-action="delete" title="Delete task">✕</button>
          </div>
        `
      )
      .join("");

    attachTaskPoolListeners(pool, unassigned);
  }

  function renderTimetableGrid(state) {
    const grid = document.getElementById("tm-timetable-grid");
    if (!grid) return;

    const weekStart = state.weekStart || activeWeekStart;
    const taskById = new Map((state.tasks || []).map((task) => [task.id, task]));
    const slotByKey = new Map((state.slots || []).map((slot) => [`${slot.day}_${slot.hour}`, slot]));

    const fragment = document.createDocumentFragment();

    const blank = document.createElement("div");
    blank.className = "tt-header";
    fragment.appendChild(blank);

    DAYS.forEach((day, index) => {
      const header = document.createElement("div");
      header.className = "tt-header";
      const date = addDays(weekStart, index);
      header.textContent = `${DAY_LABELS[day]} ${date.getDate()}`;
      fragment.appendChild(header);
    });

    HOURS.forEach((hour) => {
      const time = document.createElement("div");
      time.className = "tt-time";
      time.textContent = formatHour(hour);
      fragment.appendChild(time);

      DAYS.forEach((day) => {
        const cell = document.createElement("div");
        cell.className = "tt-slot";
        cell.dataset.day = day;
        cell.dataset.hour = hour;

        cell.addEventListener("dragover", (event) => {
          event.preventDefault();
          cell.classList.add("tm-slot-hover");
        });

        cell.addEventListener("dragleave", () => {
          cell.classList.remove("tm-slot-hover");
        });

        cell.addEventListener("drop", async (event) => {
          event.preventDefault();
          cell.classList.remove("tm-slot-hover");
          const taskId = event.dataTransfer?.getData("text/plain");
          if (!taskId) return;
          await assignTaskToTimetableSlot(taskId, day, hour);
        });

        cell.addEventListener("dblclick", async () => {
          const slot = slotByKey.get(`${day}_${hour}`);
          if (String(slot?.source || "").toLowerCase() === "school") return;
          await clearTimetableSlot(day, hour);
        });

        const slot = slotByKey.get(`${day}_${hour}`);
        if (slot?.taskId) {
          const task = taskById.get(slot.taskId);
          if (task) {
            const eventBox = document.createElement("div");
            const isSchool = String(task.source || "").toLowerCase() === "school";
            const completeClass = task.status === "completed" ? "tm-task-completed" : "";
            eventBox.className = `tt-event ${getStyleClass(task.subject, task.type)} ${completeClass}`;
            eventBox.draggable = !isSchool;
            eventBox.dataset.taskId = task.id;
            if (isSchool) {
              eventBox.innerHTML = `
                <span class="tm-event-label">${escapeHtml(getTaskEmoji(task))} ${escapeHtml(task.subject || task.title)}</span>
              `;
            } else {
              eventBox.innerHTML = `
                <span class="tm-event-label">${escapeHtml(getTaskEmoji(task))} ${escapeHtml(task.title)}</span>
                <span class="tm-event-actions">
                  <button class="tm-mini-btn ${task.status === "completed" ? "active" : ""}" data-action="toggle">${task.status === "completed" ? "↺" : "✓"}</button>
                  <button class="tm-mini-btn danger" data-action="clear">✕</button>
                </span>
              `;

              eventBox.addEventListener("dragstart", (event) => {
                event.dataTransfer?.setData("text/plain", task.id);
              });

              eventBox.querySelectorAll("button").forEach((btn) => {
                btn.addEventListener("click", async (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (btn.dataset.action === "toggle") {
                    await toggleTimetableTaskCompletion(task.id);
                  }
                  if (btn.dataset.action === "clear") {
                    await clearTimetableSlot(day, hour);
                  }
                });
              });
            }

            cell.appendChild(eventBox);
          }
        }

        fragment.appendChild(cell);
      });
    });

    grid.innerHTML = "";
    grid.appendChild(fragment);
  }

  function renderAgenda(state) {
    const title = document.getElementById("tm-agenda-title");
    const agenda = document.getElementById("tm-today-agenda");
    if (!title || !agenda) return;

    const today = new Date();
    const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(today);
    title.textContent = `Today's Agenda · ${dateLabel}`;

    const list = state.agenda || [];
    if (!list.length) {
      agenda.innerHTML = "<div style='font-size:12px;color:var(--text3);'>No scheduled study blocks for today yet. Drag tasks into today's slots.</div>";
      return;
    }

    agenda.innerHTML = list
      .map((item) => {
        const task = item.task || {};
        const isSchool = String(task.source || "").toLowerCase() === "school";
        const statusClass = task.status === "completed" ? "on" : "";
        const bg = isSchool
          ? "rgba(251,191,36,0.09);border:1px solid rgba(251,191,36,0.2);"
          : task.status === "completed"
          ? "rgba(110,231,183,0.09);border:1px solid rgba(110,231,183,0.2);"
          : "rgba(129,140,248,0.09);border:1px solid rgba(129,140,248,0.2);";
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px;${bg}border-radius:9px;">
            <div style="font-size:20px;">${escapeHtml(getTaskEmoji(task))}</div>
            <div>
              <div style="font-size:13px;font-weight:600;">${escapeHtml(task.title || "Study Session")}</div>
              <div style="font-size:11px;color:var(--text3);">${escapeHtml(formatHour(item.hour))} · ${escapeHtml(task.estimatedMinutes || 60)} min</div>
            </div>
            <div style="margin-left:auto;">
              ${isSchool ? "<span class='chip chip-yellow' style='font-size:10px;'>School</span>" : `<div class="toggle ${statusClass}" data-task-id="${escapeHtml(task.id)}"></div>`}
            </div>
          </div>
        `;
      })
      .join("");

    agenda.querySelectorAll(".toggle").forEach((toggle) => {
      toggle.addEventListener("click", async () => {
        const taskId = toggle.dataset.taskId;
        if (!taskId) return;
        await toggleTimetableTaskCompletion(taskId);
      });
    });
  }

  function renderWeeklyProgress(state) {
    const donut = document.getElementById("tm-weekly-donut");
    const percent = document.getElementById("tm-weekly-percent");
    const sub = document.getElementById("tm-weekly-sub");
    if (!donut || !percent || !sub) return;

    const stats = state.stats || {};
    const pct = Number(stats.completionPercent || 0);
    const circumference = 251;
    const offset = circumference - Math.round((circumference * pct) / 100);

    donut.style.strokeDashoffset = String(offset);
    percent.textContent = `${pct}%`;

    const done = Number(stats.completedHours || 0);
    const goal = Number(stats.weeklyGoalHours || state.profile?.weeklyGoalsHours || 14);
    const remaining = Number(stats.remainingHours || Math.max(goal - done, 0));
    sub.textContent = `${done}h of ${goal}h target · ${remaining}h remaining`;
  }

  function renderSmartSuggestions(state) {
    const host = document.getElementById("tm-smart-suggestions");
    if (!host) return;

    const notes = (state.notes || []).slice(0, 3);
    if (!notes.length) {
      host.innerHTML = `
        <div style="padding:10px;background:rgba(110,231,183,0.07);border:1px solid rgba(110,231,183,0.15);border-radius:9px;">
          <div style="font-size:11px;color:var(--accent);font-weight:700;margin-bottom:4px;">✓ READY</div>
          <div style="font-size:12px;">Run AI Optimize Schedule after onboarding to get personalized suggestions.</div>
        </div>
      `;
      return;
    }

    host.innerHTML = notes
      .map((note, idx) => {
        const isUrgent = idx === 0;
        const tone = isUrgent
          ? "rgba(248,113,113,0.07);border:1px solid rgba(248,113,113,0.15);"
          : "rgba(110,231,183,0.07);border:1px solid rgba(110,231,183,0.15);";
        const title = isUrgent ? "⚠ PRIORITY" : "✓ PLAN NOTE";
        const color = isUrgent ? "var(--danger)" : "var(--accent)";
        return `
          <div style="padding:10px;${tone}border-radius:9px;">
            <div style="font-size:11px;color:${color};font-weight:700;margin-bottom:4px;">${title}</div>
            <div style="font-size:12px;">${escapeHtml(note)}</div>
          </div>
        `;
      })
      .join("");
  }

  function renderWeekLabel(state) {
    const el = document.getElementById("tm-week-label");
    if (!el) return;
    const weekStart = state.weekStart || activeWeekStart;
    const weekEnd = addDays(weekStart, 4);
    el.textContent = `Week of ${formatDateHuman(weekStart)} – ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(weekEnd)}`;
  }

  function renderAll() {
    const page = document.getElementById("page-timetable");
    if (!page) return;

    const state = getStateSafe();
    renderWeekLabel(state);
    renderProfile(state);
    renderLegend(state);
    renderTaskPool(state);
    renderTimetableGrid(state);
    renderAgenda(state);
    renderWeeklyProgress(state);
    renderSmartSuggestions(state);
  }

  async function loadTimeManagement() {
    try {
      const response = await apiGet(API.timeManagementState(requireStudentId(), activeWeekStart));
      activeWeekStart = response.weekStart || activeWeekStart;
      timetableState = response;
      runtime.state.timeManagement = response;
      scheduleSave();
      renderAll();

      if (!response.profile?.configured) {
        openTimeManagementOnboarding();
      }
    } catch (error) {
      logAudit(`Time management load failed: ${error.message || "unknown"}`);
      const summary = document.getElementById("tm-peak-sub");
      if (summary) summary.textContent = error.message || "Failed to load timetable.";
      const cached = runtime.state?.timeManagement;
      if (cached && typeof cached === "object") {
        timetableState = cached;
        activeWeekStart = cached.weekStart || activeWeekStart;
      }
      renderAll();
    }
  }

  function buildOnboardingModeFields(mode, profile) {
    if (mode === "school_blocks") {
      const importedCount = Array.isArray(profile.schoolBlocks) ? profile.schoolBlocks.length : 0;
      return `
        <div class="form-group">
          <label class="form-label">School timetable file (any format)</label>
          <input class="input" id="tm-ob-file" type="file">
          <div style="font-size:11px;color:var(--text3);margin-top:6px;">
            Upload timetable file (.ics, .pdf, .docx, .txt, etc). AI will extract class blocks. Imported weekly blocks currently saved: ${escapeHtml(importedCount)}.
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Calendar URL (optional)</label>
          <input class="input" id="tm-ob-calendar-url" placeholder="webcal://... or https://..." value="">
          <div style="font-size:11px;color:var(--text3);margin-top:6px;">
            Use this when your iPhone calendar is subscribed and your local .ics file has no VEVENT entries.
          </div>
        </div>
      `;
    }

    return `
      <div class="form-group">
        <label class="form-label">Productive hours (optional)</label>
        <input class="input" id="tm-ob-productive" placeholder="09:00-11:00,20:00-22:00" value="${escapeHtml((profile.productiveHours || []).join(","))}">
      </div>
    `;
  }

  function bindOnboardingModeUI(profile) {
    const select = document.getElementById("tm-ob-mode");
    const container = document.getElementById("tm-ob-mode-fields");
    if (!select || !container) return;

    const render = () => {
      const mode = select.value || "productive_hours";
      container.innerHTML = buildOnboardingModeFields(mode, profile);
    };

    select.addEventListener("change", render);
    render();
  }

  async function saveTimeManagementOnboarding() {
    const mode = document.getElementById("tm-ob-mode")?.value || "productive_hours";
    const examDatesText = document.getElementById("tm-ob-exams")?.value || "";
    const weeklyGoalsHours = Number(document.getElementById("tm-ob-goal")?.value || 14);

    try {
      if (mode === "school_blocks") {
        const fileInput = document.getElementById("tm-ob-file");
        const file = fileInput?.files?.[0];
        const calendarUrl = (document.getElementById("tm-ob-calendar-url")?.value || "").trim();
        if (!file && !calendarUrl) {
          throw new Error("Please upload a timetable file or paste a calendar URL.");
        }

        const form = new FormData();
        if (file) form.append("timetable", file);
        if (calendarUrl) form.append("calendarUrl", calendarUrl);
        form.append("weekStart", activeWeekStart);
        form.append("examDatesText", examDatesText);
        form.append("weeklyGoalsHours", String(weeklyGoalsHours));

        await apiPostForm(API.timeManagementUploadSchoolTimetable(requireStudentId()), form);
      } else {
        const payload = {
          mode,
          examDatesText,
          weeklyGoalsHours
        };
        const productiveEl = document.getElementById("tm-ob-productive");
        if (productiveEl) {
          payload.productiveHoursText = productiveEl.value || "";
        }

        try {
          await apiPut(API.timeManagementProfile(requireStudentId()), payload);
        } catch (putError) {
          await apiPost(API.timeManagementProfile(requireStudentId()), payload);
        }
      }

      hideModal();
      logAudit("Time management onboarding saved.");
      await loadTimeManagement();
    } catch (error) {
      const err = document.getElementById("tm-ob-error");
      if (err) err.textContent = error.message || "Failed to save onboarding.";
    }
  }

  function openTimeManagementOnboarding() {
    const profile = getStateSafe().profile || {};
    const mode = profile.mode || "productive_hours";

    const html = `
      <div class="modal-title">Time Management Onboarding</div>
      <div class="modal-sub">Set your comfortable study structure first: school blocks or productive hours. AI will use this to generate your weekly timetable.</div>

      <div class="form-group">
        <label class="form-label">Planning mode</label>
        <select class="select" id="tm-ob-mode">
          <option value="school_blocks" ${mode === "school_blocks" ? "selected" : ""}>Use school timetable blocks</option>
          <option value="productive_hours" ${mode !== "school_blocks" ? "selected" : ""}>Use productive hours</option>
        </select>
      </div>

      <div id="tm-ob-mode-fields"></div>

      <div class="form-group">
        <label class="form-label">Upcoming exam dates</label>
        <input class="input" id="tm-ob-exams" placeholder="2026-03-20,2026-04-02" value="${escapeHtml((profile.examDates || []).join(","))}">
      </div>

      <div class="form-group">
        <label class="form-label">Weekly goals (hours)</label>
        <input class="input" id="tm-ob-goal" type="number" min="1" max="60" value="${escapeHtml(profile.weeklyGoalsHours || 14)}">
      </div>

      <div id="tm-ob-error" style="color:var(--danger);font-size:12px;min-height:18px;"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveTimeManagementOnboarding()">Save</button>
      </div>
    `;

    showModal(html);
    bindOnboardingModeUI(profile);
  }

  async function generateTimeManagementPlan() {
    const button = document.getElementById("tm-optimize-btn");
    if (button) {
      button.disabled = true;
      button.innerHTML = "<span class='spinner'></span> Optimizing...";
    }

    try {
      const topics = (runtime.state.topics || []).slice().sort((a, b) => (b.weakScore || 0) - (a.weakScore || 0));
      const weakConcepts = topics.slice(0, 4).map((topic) => topic.name);
      const forgettingRiskTopics = topics.filter((topic) => Number(topic.weakScore || 0) >= 60).slice(0, 4).map((topic) => topic.name);

      const response = await apiPost(API.timeManagementGeneratePlan(requireStudentId()), {
        weekStart: activeWeekStart,
        weakConcepts,
        forgettingRiskTopics,
        replaceExisting: false
      });

      activeWeekStart = response.weekStart || activeWeekStart;
      timetableState = response;
      runtime.state.timeManagement = response;
      scheduleSave();
      renderAll();
      logAudit(`Timetable generated (${response.planProvider || "heuristic"}).`);
    } catch (error) {
      logAudit(`Timetable generation failed: ${error.message || "unknown"}`);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "⚡ AI Optimize Schedule";
      }
    }
  }

  function findTask(taskId) {
    return (getStateSafe().tasks || []).find((task) => task.id === taskId) || null;
  }

  function findSlotForTask(taskId) {
    return (getStateSafe().slots || []).find((slot) => slot.taskId === taskId) || null;
  }

  function openTimetableTaskModal(taskId = "") {
    const editing = Boolean(taskId);
    const task = editing ? findTask(taskId) : null;
    const slot = editing ? findSlotForTask(taskId) : null;
    const selectedDay = normalizeDay(slot?.day || "");
    const selectedHour = normalizeHour(slot?.hour || "");

    const html = `
      <div class="modal-title">${editing ? "Edit Session" : "Add Session"}</div>
      <div class="modal-sub">Create or update a timetable task. You can assign it to a slot immediately.</div>

      <div class="form-group">
        <label class="form-label">Title</label>
        <input class="input" id="tm-task-title" value="${escapeHtml(task?.title || "")}" placeholder="Graph Theory - Bipartite Graphs">
      </div>

      <div class="form-group">
        <label class="form-label">Subject</label>
        <input class="input" id="tm-task-subject" value="${escapeHtml(task?.subject || "Algorithms")}" placeholder="Algorithms">
      </div>

      <div class="form-group">
        <label class="form-label">Topic</label>
        <input class="input" id="tm-task-topic" value="${escapeHtml(task?.topic || "")}" placeholder="Dynamic Programming">
      </div>

      <div class="grid-2" style="margin-bottom:14px;">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Priority (1-100)</label>
          <input class="input" id="tm-task-priority" type="number" min="1" max="100" value="${escapeHtml(task?.priority || 70)}">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Duration (min)</label>
          <input class="input" id="tm-task-duration" type="number" min="15" max="240" value="${escapeHtml(task?.estimatedMinutes || 60)}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Type</label>
        <select class="select" id="tm-task-type">
          <option value="study" ${task?.type === "study" ? "selected" : ""}>Study</option>
          <option value="weak-focus" ${task?.type === "weak-focus" ? "selected" : ""}>Weak Focus</option>
          <option value="spaced-review" ${task?.type === "spaced-review" ? "selected" : ""}>Spaced Review</option>
          <option value="practice" ${task?.type === "practice" ? "selected" : ""}>Practice</option>
          <option value="mock-test" ${task?.type === "mock-test" ? "selected" : ""}>Mock Test</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Notes</label>
        <input class="input" id="tm-task-notes" value="${escapeHtml(task?.notes || "")}" placeholder="Optional">
      </div>

      <div class="grid-2" style="margin-bottom:14px;">
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Assign day (optional)</label>
          <select class="select" id="tm-task-day">
            <option value="">No slot yet</option>
            ${DAYS.map((day) => `<option value="${day}" ${selectedDay === day ? "selected" : ""}>${DAY_LABELS[day]}</option>`).join("")}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label">Assign hour (optional)</label>
          <select class="select" id="tm-task-hour">
            <option value="">No slot yet</option>
            ${HOURS.map((hour) => `<option value="${hour}" ${selectedHour === hour ? "selected" : ""}>${formatHour(hour)}</option>`).join("")}
          </select>
        </div>
      </div>

      <div id="tm-task-error" style="color:var(--danger);font-size:12px;min-height:18px;"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveTimetableTask('${escapeHtml(taskId)}')">${editing ? "Update" : "Create"}</button>
      </div>
    `;

    showModal(html);
  }

  async function saveTimetableTask(taskId = "") {
    const title = document.getElementById("tm-task-title")?.value?.trim();
    const subject = document.getElementById("tm-task-subject")?.value?.trim() || "Study";
    const topic = document.getElementById("tm-task-topic")?.value?.trim() || "";
    const type = document.getElementById("tm-task-type")?.value || "study";
    const priority = Number(document.getElementById("tm-task-priority")?.value || 70);
    const estimatedMinutes = Number(document.getElementById("tm-task-duration")?.value || 60);
    const notes = document.getElementById("tm-task-notes")?.value?.trim() || "";
    const day = normalizeDay(document.getElementById("tm-task-day")?.value || "");
    const hour = normalizeHour(document.getElementById("tm-task-hour")?.value || "");

    if (!title) {
      const err = document.getElementById("tm-task-error");
      if (err) err.textContent = "Task title is required.";
      return;
    }

    if ((day && !hour) || (!day && hour)) {
      const err = document.getElementById("tm-task-error");
      if (err) err.textContent = "Select both day and hour to assign a slot.";
      return;
    }

    try {
      if (taskId) {
        await apiPut(API.timeManagementTask(requireStudentId(), taskId), {
          title,
          subject,
          topic,
          type,
          priority,
          estimatedMinutes,
          notes,
          day,
          hour
        });
      } else {
        await apiPost(API.timeManagementTasks(requireStudentId()), {
          weekStart: activeWeekStart,
          title,
          subject,
          topic,
          type,
          priority,
          estimatedMinutes,
          notes,
          day,
          hour,
          source: "manual"
        });
      }

      hideModal();
      await loadTimeManagement();
    } catch (error) {
      const err = document.getElementById("tm-task-error");
      if (err) err.textContent = error.message || "Failed to save task.";
    }
  }

  async function deleteTimetableTask(taskId) {
    if (!taskId) return;
    const confirmed = window.confirm("Delete this timetable task?");
    if (!confirmed) return;

    try {
      await apiDelete(API.timeManagementTask(requireStudentId(), taskId));
      await loadTimeManagement();
    } catch (error) {
      logAudit(`Task delete failed: ${error.message || "unknown"}`);
    }
  }

  async function assignTaskToTimetableSlot(taskId, day, hour) {
    if (!taskId || !day || !hour) return;
    try {
      await apiPut(API.timeManagementSlot(requireStudentId(), day, hour), {
        weekStart: activeWeekStart,
        taskId,
        source: "manual"
      });
      await loadTimeManagement();
    } catch (error) {
      logAudit(`Slot assignment failed: ${error.message || "unknown"}`);
    }
  }

  async function clearTimetableSlot(day, hour) {
    if (!day || !hour) return;
    try {
      const url = `${API.timeManagementSlot(requireStudentId(), day, hour)}?weekStart=${encodeURIComponent(activeWeekStart)}`;
      await apiDelete(url);
      await loadTimeManagement();
    } catch (error) {
      logAudit(`Slot clear failed: ${error.message || "unknown"}`);
    }
  }

  async function toggleTimetableTaskCompletion(taskId) {
    const task = findTask(taskId);
    if (!task) return;
    const nextStatus = task.status === "completed" ? "planned" : "completed";

    try {
      await apiPut(API.timeManagementTask(requireStudentId(), taskId), { status: nextStatus });
      await loadTimeManagement();
    } catch (error) {
      logAudit(`Completion update failed: ${error.message || "unknown"}`);
    }
  }

  async function clearTimetableWeek() {
    const confirmed = window.confirm("Clear all timetable tasks and slots for this week?");
    if (!confirmed) return;

    try {
      await apiDelete(API.timeManagementClearWeek(requireStudentId(), activeWeekStart));
      await loadTimeManagement();
    } catch (error) {
      logAudit(`Week reset failed: ${error.message || "unknown"}`);
    }
  }

  async function initTimeManagement() {
    renderAll();
    await loadTimeManagement();
  }

  async function refreshTimeManagement() {
    await loadTimeManagement();
  }

  function toggleVoice() {
    const btn = document.getElementById("voiceBtn");
    const status = document.getElementById("voiceStatus");
    if (!btn) return;

    runtime.voiceActive = !runtime.voiceActive;
    if (runtime.voiceActive) {
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
          runtime.voiceActive = false;
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

  function startVoice() {
    toggleVoice();
  }

  return {
    startVoice,
    toggleVoice,
    initTimeManagement,
    refreshTimeManagement,
    openTimeManagementOnboarding,
    saveTimeManagementOnboarding,
    generateTimeManagementPlan,
    openTimetableTaskModal,
    saveTimetableTask,
    deleteTimetableTask,
    clearTimetableWeek,
    toggleTimetableTaskCompletion,
    clearTimetableSlot
  };
}
