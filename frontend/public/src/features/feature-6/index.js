const KEY = "speedup_feature6_agenda_v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function save(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

function mountCharts(container, items) {
  if (!window.Chart) {
    container.querySelector("#f6-fallback").textContent = "Chart.js not loaded. Graphs unavailable.";
    return;
  }

  const labels = items.map((x) => x.date);
  const minutes = items.map((x) => x.minutes);
  const mastery = items.map((x) => x.mastery);
  const careless = items.map((x) => x.careless);
  const knowledgeGap = items.map((x) => x.gap);

  new Chart(container.querySelector("#f6-minutes"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Study Minutes", data: minutes, backgroundColor: "#60a5fa" }] },
  });

  new Chart(container.querySelector("#f6-mastery"), {
    type: "line",
    data: { labels, datasets: [{ label: "Mastery %", data: mastery, borderColor: "#22c55e" }] },
  });

  new Chart(container.querySelector("#f6-errors"), {
    type: "doughnut",
    data: {
      labels: ["Careless", "Knowledge Gap"],
      datasets: [{ data: [careless.reduce((a, b) => a + b, 0), knowledgeGap.reduce((a, b) => a + b, 0)], backgroundColor: ["#f59e0b", "#ef4444"] }],
    },
  });
}

function streak(items) {
  let run = 0;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].minutes > 0) run += 1;
    else break;
  }
  return run;
}

export function mountFeature6(container) {
  const items = load();

  container.innerHTML = `
    <h3>Agenda + Progress Tracker + Graphs</h3>
    <div class="grid grid-2">
      <div class="card">
        <h4>Add agenda item</h4>
        <input id="f6-title" class="input" placeholder="Topic" />
        <input id="f6-minutes-input" class="input" type="number" placeholder="Study minutes" style="margin-top:8px;" />
        <input id="f6-mastery-input" class="input" type="number" min="0" max="100" placeholder="Mastery %" style="margin-top:8px;" />
        <input id="f6-careless-input" class="input" type="number" min="0" placeholder="Careless errors" style="margin-top:8px;" />
        <input id="f6-gap-input" class="input" type="number" min="0" placeholder="Knowledge-gap errors" style="margin-top:8px;" />
        <button id="f6-add" class="button" style="margin-top:8px;">Log Today</button>
        <p class="small">Streak: <strong id="f6-streak"></strong> days | Confidence decay: <strong id="f6-decay"></strong></p>
        <div id="f6-fallback" class="small"></div>
      </div>
      <div class="card">
        <h4>Recent logs</h4>
        <table class="table">
          <thead><tr><th>Date</th><th>Topic</th><th>Minutes</th></tr></thead>
          <tbody id="f6-table"></tbody>
        </table>
      </div>
    </div>
    <div class="f6-chart-grid" style="margin-top:12px;">
      <div class="card"><canvas id="f6-minutes" class="f6-chart"></canvas></div>
      <div class="card"><canvas id="f6-mastery" class="f6-chart"></canvas></div>
      <div class="card"><canvas id="f6-errors" class="f6-chart"></canvas></div>
    </div>
  `;

  const tbody = container.querySelector("#f6-table");

  function render() {
    tbody.innerHTML = items
      .slice(-7)
      .reverse()
      .map((x) => `<tr><td>${x.date}</td><td>${x.title}</td><td>${x.minutes}</td></tr>`)
      .join("");

    const s = streak(items);
    container.querySelector("#f6-streak").textContent = String(s);
    container.querySelector("#f6-decay").textContent = `${Math.max(0, 100 - s * 8)}%`;

    mountCharts(container, items.slice(-7));
  }

  container.querySelector("#f6-add").addEventListener("click", () => {
    items.push({
      date: new Date().toISOString().slice(0, 10),
      title: container.querySelector("#f6-title").value || "Study",
      minutes: Number(container.querySelector("#f6-minutes-input").value || 0),
      mastery: Number(container.querySelector("#f6-mastery-input").value || 0),
      careless: Number(container.querySelector("#f6-careless-input").value || 0),
      gap: Number(container.querySelector("#f6-gap-input").value || 0),
    });
    save(items);
    render();
  });

  render();
}
