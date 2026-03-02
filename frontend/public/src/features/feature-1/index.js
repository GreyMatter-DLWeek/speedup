const STORAGE_KEY = "speedup_feature1_interactions_v1";

const note = {
  title: "Dynamic Programming Basics",
  paragraphs: [
    {
      id: "p1",
      text: "Dynamic Programming solves complex problems by splitting them into overlapping subproblems and reusing saved results.",
    },
    {
      id: "p2",
      text: "A DP problem usually has optimal substructure and overlapping subproblems.",
    },
    {
      id: "p3",
      text: "Top-down memoization computes on demand, while bottom-up tabulation fills a table iteratively.",
    },
  ],
};

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function performanceSignal() {
  return {
    weakTopic: "Graph Theory",
    clarityRate: "71%",
    recentTrend: "improving",
  };
}

function explain({ text, title, signal }) {
  return `Context-aware explanation for ${title}: ${text} This connects to your recent weak area (${signal.weakTopic}), so focus on identifying repeated subproblems first.`;
}

function simpler(text) {
  return {
    explanation: `Simpler: ${text} means solve small parts once, then reuse the answers instead of repeating work.`,
    example: "Example: Fibonacci numbers where f(5) and f(4) are reused many times.",
    check: "Quick check: Why is reusing f(3) in Fibonacci faster than recomputing it every time?",
  };
}

export function mountFeature1(container) {
  const interactions = load();

  container.innerHTML = `
    <h3>Paragraph Ticks with Contextual Doubt Resolution</h3>
    <p class="small">Stores: paragraph_id, attempts, clarity outcome, timestamps.</p>
    <div id="f1-list"></div>
    <div class="card"><strong>Recent signals:</strong> weak topic ${performanceSignal().weakTopic}, clarity rate ${performanceSignal().clarityRate}, trend ${performanceSignal().recentTrend}.</div>
  `;

  const list = container.querySelector("#f1-list");

  note.paragraphs.forEach((para) => {
    const el = document.createElement("div");
    el.className = "f1-paragraph card";
    el.innerHTML = `
      <button class="f1-tick" title="Answer doubt">?</button>
      <div>
        <div><strong>${para.id}</strong> - ${para.text}</div>
        <div class="f1-response" hidden></div>
      </div>
    `;

    const tick = el.querySelector(".f1-tick");
    const response = el.querySelector(".f1-response");

    tick.addEventListener("click", () => {
      const prior = interactions.filter((x) => x.paragraph_id === para.id);
      const attempt = prior.length + 1;
      const stamp = new Date().toISOString();
      const text = explain({ text: para.text, title: note.title, signal: performanceSignal() });

      response.hidden = false;
      response.innerHTML = `
        <div>${text}</div>
        <div class="f1-actions">
          <button data-clear="yes">Clear</button>
          <button data-clear="no">Not Clear</button>
        </div>
      `;

      response.querySelector('[data-clear="yes"]').addEventListener("click", () => {
        interactions.push({ paragraph_id: para.id, attempts: attempt, clarity_outcome: "clear", timestamp: stamp });
        save(interactions);
        response.innerHTML = `<div>${text}</div><div class="small">Marked clear at ${new Date(stamp).toLocaleString()}</div>`;
      });

      response.querySelector('[data-clear="no"]').addEventListener("click", () => {
        const detail = simpler(para.text);
        interactions.push({ paragraph_id: para.id, attempts: attempt, clarity_outcome: "not_clear", timestamp: stamp });
        save(interactions);
        response.innerHTML = `
          <div>${detail.explanation}</div>
          <div><strong>Example:</strong> ${detail.example}</div>
          <div><strong>Quick check:</strong> ${detail.check}</div>
          <div class="small">Logged not clear at ${new Date(stamp).toLocaleString()}</div>
        `;
      });
    });

    list.appendChild(el);
  });
}
