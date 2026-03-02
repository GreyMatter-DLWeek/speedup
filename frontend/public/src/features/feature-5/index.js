const KEY = "speedup_feature5_exams_v1";

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

function avg(list) {
  if (!list.length) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function analyze(exams) {
  if (exams.length < 2) {
    return { suggestion: "Log at least 2 exams to unlock behavior correlations.", evidence: [] };
  }

  const consistent = exams.filter((x) => x.consistency >= 4);
  const cram = exams.filter((x) => x.cramHours >= 6);
  const practiceHeavy = exams.filter((x) => x.practiceCount >= 20);

  const evidence = [
    `Avg score with high consistency (>=4/5): ${avg(consistent.map((x) => x.score)).toFixed(1)}%`,
    `Avg score when cramming >=6h day before: ${avg(cram.map((x) => x.score)).toFixed(1)}%`,
    `Avg score with >=20 practice questions: ${avg(practiceHeavy.map((x) => x.score)).toFixed(1)}%`,
  ];

  const suggestion =
    avg(consistent.map((x) => x.score)) > avg(cram.map((x) => x.score))
      ? "Based on your last exams, consistent study beats last-minute cramming. Keep daily sessions and keep practice counts high."
      : "Your current data does not strongly penalize cramming yet, but practice volume still correlates with better outcomes.";

  return { suggestion, evidence };
}

export function mountFeature5(container) {
  const exams = load();

  container.innerHTML = `
    <h3>Personalized Agent from Exam Outcomes</h3>
    <div class="grid grid-2">
      <div class="card">
        <h4>Log Exam</h4>
        <input id="f5-subject" class="input" placeholder="Subject" />
        <input id="f5-date" class="input" type="date" style="margin-top:8px;" />
        <input id="f5-score" class="input" type="number" min="0" max="100" placeholder="Score" style="margin-top:8px;" />
        <input id="f5-consistency" class="input" type="number" min="1" max="5" placeholder="Consistency (1-5)" style="margin-top:8px;" />
        <input id="f5-cram" class="input" type="number" min="0" placeholder="Last-minute cram hours" style="margin-top:8px;" />
        <input id="f5-practice" class="input" type="number" min="0" placeholder="Practice questions count" style="margin-top:8px;" />
        <textarea id="f5-reflect" class="textarea" rows="3" placeholder="Reflections" style="margin-top:8px;"></textarea>
        <button id="f5-add" class="button" style="margin-top:8px;">Save Exam</button>
      </div>
      <div class="card">
        <h4>Tailored Suggestion with Evidence</h4>
        <div id="f5-suggestion" class="f5-evidence"></div>
        <h4>Exam Logs</h4>
        <table class="table">
          <thead><tr><th>Subject</th><th>Date</th><th>Score</th></tr></thead>
          <tbody id="f5-table"></tbody>
        </table>
      </div>
    </div>
  `;

  const table = container.querySelector("#f5-table");
  const suggestion = container.querySelector("#f5-suggestion");

  function render() {
    table.innerHTML = exams
      .map((x) => `<tr><td>${x.subject}</td><td>${x.date}</td><td>${x.score}%</td></tr>`)
      .join("");

    const report = analyze(exams.slice(-3));
    suggestion.innerHTML = `<p>${report.suggestion}</p>${report.evidence.map((x) => `<div class="small">- ${x}</div>`).join("")}`;
  }

  container.querySelector("#f5-add").addEventListener("click", () => {
    const row = {
      subject: container.querySelector("#f5-subject").value || "Unknown",
      date: container.querySelector("#f5-date").value || new Date().toISOString().slice(0, 10),
      score: Number(container.querySelector("#f5-score").value || 0),
      consistency: Number(container.querySelector("#f5-consistency").value || 1),
      cramHours: Number(container.querySelector("#f5-cram").value || 0),
      practiceCount: Number(container.querySelector("#f5-practice").value || 0),
      reflections: container.querySelector("#f5-reflect").value || "",
      timestamp: new Date().toISOString(),
    };

    exams.push(row);
    save(exams);
    render();
  });

  render();
}
