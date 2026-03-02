const KEY = "speedup_feature7_practice_v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function save(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function summarize(rows) {
  const weak = {};
  const errors = { conceptual: 0, careless: 0, timing: 0 };

  rows.forEach((r) => {
    if (!r.correct) {
      weak[r.topic] = (weak[r.topic] || 0) + 1;
      errors[r.errorType] = (errors[r.errorType] || 0) + 1;
    }
  });

  const weakSorted = Object.entries(weak)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic, count]) => `${topic} (${count} misses)`);

  const next = weakSorted.map((w, i) => `${i + 1}. 25 min targeted drill: ${w}`);

  return {
    weak: weakSorted,
    errors,
    next,
  };
}

export function mountFeature7(container) {
  const attempts = load();

  container.innerHTML = `
    <h3>Paper Upload + Self-Practice Analyzer</h3>
    <div class="grid grid-2">
      <div class="card">
        <div class="f7-drop">Upload PDF/Image (metadata only in this demo). If OCR unavailable, use manual entry below.</div>
        <input id="f7-file" type="file" class="input" accept=".pdf,.png,.jpg,.jpeg" />
        <h4 style="margin-top:12px;">Manual question attempt</h4>
        <input id="f7-topic" class="input" placeholder="Topic tag" />
        <input id="f7-time" class="input" type="number" placeholder="Time taken (seconds)" style="margin-top:8px;" />
        <select id="f7-correct" class="select" style="margin-top:8px;"><option value="true">Correct</option><option value="false">Incorrect</option></select>
        <select id="f7-confidence" class="select" style="margin-top:8px;"><option>High</option><option>Medium</option><option>Low</option></select>
        <select id="f7-error" class="select" style="margin-top:8px;"><option value="conceptual">Conceptual</option><option value="careless">Careless</option><option value="timing">Timing</option></select>
        <button id="f7-add" class="button" style="margin-top:8px;">Log Attempt</button>
      </div>
      <div class="card">
        <h4>Post-practice report</h4>
        <div id="f7-report"></div>
        <h4>Attempts</h4>
        <table class="table"><thead><tr><th>Topic</th><th>Correct</th><th>Time</th><th>Confidence</th></tr></thead><tbody id="f7-table"></tbody></table>
      </div>
    </div>
  `;

  const tbody = container.querySelector("#f7-table");
  const report = container.querySelector("#f7-report");

  function render() {
    tbody.innerHTML = attempts
      .slice(-10)
      .reverse()
      .map((x) => `<tr><td>${x.topic}</td><td>${x.correct ? "Yes" : "No"}</td><td>${x.timeTaken}s</td><td>${x.confidence}</td></tr>`)
      .join("");

    const sum = summarize(attempts);
    report.innerHTML = `
      <div><strong>Top weak concepts:</strong> ${sum.weak.join(", ") || "None yet"}</div>
      <div class="small">Repeated error types: conceptual ${sum.errors.conceptual}, careless ${sum.errors.careless}, timing ${sum.errors.timing}</div>
      <div><strong>Next revision (time-boxed):</strong> ${sum.next.join(" | ") || "Log more attempts"}</div>
    `;
  }

  container.querySelector("#f7-add").addEventListener("click", () => {
    attempts.push({
      topic: container.querySelector("#f7-topic").value || "General",
      timeTaken: Number(container.querySelector("#f7-time").value || 0),
      correct: container.querySelector("#f7-correct").value === "true",
      confidence: container.querySelector("#f7-confidence").value,
      errorType: container.querySelector("#f7-error").value,
      timestamp: new Date().toISOString(),
    });
    save(attempts);
    render();
  });

  render();
}
