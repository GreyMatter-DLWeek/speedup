import { generatePlan } from "./ai.js";
import { loadState, saveState } from "./storage.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const HOURS = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "20:00", "21:00"];

function key(day, hour) {
  return `${day}_${hour}`;
}

function base() {
  return { tasks: [], slots: {}, notes: [], daysLeft: null };
}

function parse(container) {
  return {
    productiveHours: container.querySelector("#f4-hours").value,
    examDate: container.querySelector("#f4-exam").value,
    weeklyGoal: Number(container.querySelector("#f4-goal").value || 14),
    weakTopics: container.querySelector("#f4-weak").value,
    forgettingRisk: container.querySelector("#f4-risk").value,
  };
}

function renderPool(container, state) {
  const pool = container.querySelector("#f4-pool");
  pool.innerHTML = "";
  const assigned = new Set(Object.values(state.slots).map((s) => s.taskId));
  state.tasks
    .filter((t) => !assigned.has(t.id))
    .forEach((task) => {
      const el = document.createElement("div");
      el.className = "f4-task";
      el.draggable = true;
      el.dataset.taskId = task.id;
      el.textContent = task.label;
      el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", task.id));
      pool.appendChild(el);
    });
}

function renderTable(container, state) {
  const table = container.querySelector("#f4-table");
  table.innerHTML = "";

  const blank = document.createElement("div");
  blank.className = "f4-head";
  table.appendChild(blank);

  DAYS.forEach((day) => {
    const h = document.createElement("div");
    h.className = "f4-head";
    h.textContent = day;
    table.appendChild(h);
  });

  HOURS.forEach((hour) => {
    const t = document.createElement("div");
    t.className = "f4-time";
    t.textContent = hour;
    table.appendChild(t);

    DAYS.forEach((day) => {
      const cell = document.createElement("div");
      const slot = key(day, hour);
      cell.className = "f4-cell";

      cell.addEventListener("dragover", (e) => {
        e.preventDefault();
        cell.classList.add("hover");
      });
      cell.addEventListener("dragleave", () => cell.classList.remove("hover"));
      cell.addEventListener("drop", (e) => {
        e.preventDefault();
        cell.classList.remove("hover");
        const taskId = e.dataTransfer.getData("text/plain");
        if (!taskId) return;

        Object.keys(state.slots).forEach((k) => {
          if (state.slots[k].taskId === taskId) delete state.slots[k];
        });

        state.slots[slot] = { taskId };
        saveState(state);
        rerender(container, state);
      });

      const placed = state.slots[slot];
      if (placed) {
        const task = state.tasks.find((x) => x.id === placed.taskId);
        if (task) {
          const box = document.createElement("div");
          box.className = "f4-placed";
          box.innerHTML = `<span>${task.label}</span><input type="checkbox" ${task.done ? "checked" : ""}>`;
          box.querySelector("input").addEventListener("change", (event) => {
            task.done = event.target.checked;
            saveState(state);
            renderTracking(container, state);
          });
          cell.appendChild(box);
        }
      }

      table.appendChild(cell);
    });
  });
}

function renderTracking(container, state) {
  const total = Object.keys(state.slots).length;
  const done = Object.values(state.slots)
    .map((s) => state.tasks.find((t) => t.id === s.taskId))
    .filter((t) => t?.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  container.querySelector("#f4-completed").textContent = `${done}/${total}`;
  container.querySelector("#f4-progress").value = pct;
  container.querySelector("#f4-percent").textContent = `${pct}%`;
  container.querySelector("#f4-days").textContent = typeof state.daysLeft === "number" ? `${state.daysLeft} day(s)` : "Not set";

  container.querySelector("#f4-notes").innerHTML = state.notes.map((x) => `<li>${x}</li>`).join("");
}

function rerender(container, state) {
  renderPool(container, state);
  renderTable(container, state);
  renderTracking(container, state);
}

export function mountFeature4(container) {
  const state = loadState() || base();

  container.innerHTML = `
    <h3>Time Management: Onboarding + Timetable + Adherence</h3>
    <div class="f4-grid">
      <div class="card">
        <div class="f4-field"><label>Preferred productive hours</label><input id="f4-hours" class="input" value="09:00-11:00,20:00-22:00"></div>
        <div class="f4-field"><label>Upcoming exam date</label><input id="f4-exam" class="input" type="date"></div>
        <div class="f4-field"><label>Weekly goals (hours)</label><input id="f4-goal" class="input" type="number" value="14"></div>
        <div class="f4-field"><label>Weak concepts</label><input id="f4-weak" class="input" value="Graph Theory, Vector Spaces"></div>
        <div class="f4-field"><label>Forgetting risk</label><input id="f4-risk" class="input" value="Dynamic Programming"></div>
        <button id="f4-generate" class="button">AI Suggest Weekly Plan</button>
      </div>
      <div class="card">
        <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:8px;">
          <strong>Drag tasks into slots</strong>
          <button id="f4-reset" class="button secondary" style="width:auto;">Reset Week</button>
        </div>
        <div id="f4-pool" class="f4-task-pool"></div>
        <div id="f4-table" class="f4-table"></div>
      </div>
      <div class="card">
        <h4>Plan adherence</h4>
        <p>Completed: <strong id="f4-completed">0/0</strong> (<span id="f4-percent">0%</span>)</p>
        <progress id="f4-progress" max="100" value="0" style="width:100%"></progress>
        <p>Exam proximity: <strong id="f4-days">Not set</strong></p>
        <h4>AI notes</h4>
        <ul id="f4-notes"></ul>
      </div>
    </div>
  `;

  container.querySelector("#f4-generate").addEventListener("click", () => {
    const plan = generatePlan(parse(container));
    state.tasks = plan.tasks;
    state.notes = plan.notes;
    state.daysLeft = plan.daysLeft;
    state.slots = {};
    saveState(state);
    rerender(container, state);
  });

  container.querySelector("#f4-reset").addEventListener("click", () => {
    state.tasks = [];
    state.notes = [];
    state.slots = {};
    state.daysLeft = null;
    saveState(state);
    rerender(container, state);
  });

  rerender(container, state);
}
