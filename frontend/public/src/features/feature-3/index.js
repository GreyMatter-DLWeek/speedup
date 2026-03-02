const STORAGE_KEY = "speedup_feature3_visuals_v1";

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

function buildSvg(topic, words) {
  const nodes = words.slice(0, 4);
  const centerX = 220;
  const centerY = 110;
  const points = [
    [80, 40],
    [360, 40],
    [80, 180],
    [360, 180],
  ];

  const edges = nodes
    .map((_, idx) => `<line x1="${centerX}" y1="${centerY}" x2="${points[idx][0]}" y2="${points[idx][1]}" stroke="#60a5fa" stroke-width="2"/>`)
    .join("");

  const children = nodes
    .map(
      (node, idx) => `
      <g>
        <circle cx="${points[idx][0]}" cy="${points[idx][1]}" r="30" fill="#1d4ed8" />
        <text x="${points[idx][0]}" y="${points[idx][1]}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="10">${node.slice(0, 12)}</text>
      </g>
    `,
    )
    .join("");

  return `
    <svg viewBox="0 0 440 220" width="100%" height="220" xmlns="http://www.w3.org/2000/svg">
      ${edges}
      <circle cx="${centerX}" cy="${centerY}" r="34" fill="#16a34a" />
      <text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="12">${topic.slice(0, 14)}</text>
      ${children}
    </svg>
  `;
}

export function mountFeature3(container) {
  const visuals = load();

  container.innerHTML = `
    <h3>Illustration + Audio Explanation</h3>
    <div class="grid grid-2">
      <div class="card">
        <label class="small">Paste or select text</label>
        <textarea id="f3-text" class="textarea" rows="6">Dynamic programming for shortest paths stores optimal sub-results and reuses them.</textarea>
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button id="f3-visualize" class="button">Visualize</button>
          <button id="f3-play" class="button secondary">Play</button>
        </div>
      </div>
      <div class="card">
        <div id="f3-svg" class="f3-svg-wrap"></div>
        <div class="small" id="f3-meta"></div>
      </div>
    </div>
  `;

  const textEl = container.querySelector("#f3-text");
  const svgEl = container.querySelector("#f3-svg");
  const metaEl = container.querySelector("#f3-meta");

  container.querySelector("#f3-visualize").addEventListener("click", () => {
    const text = textEl.value.trim();
    if (!text) return;

    const words = text.split(/\s+/).filter((x) => x.length > 4);
    const topic = words[0] || "Concept";
    const tags = Array.from(new Set(words.slice(0, 5).map((x) => x.toLowerCase())));
    const svg = buildSvg(topic, words.slice(1, 5));

    svgEl.innerHTML = svg;

    const row = {
      concept: topic,
      tags,
      timestamp: new Date().toISOString(),
      source: "svg-programmatic",
    };
    visuals.unshift(row);
    save(visuals);

    metaEl.textContent = `Stored visualization metadata with tags: ${tags.join(", ")}`;
  });

  container.querySelector("#f3-play").addEventListener("click", () => {
    const text = textEl.value.trim();
    if (!text || !("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance(`Explanation: ${text}`);
    utter.rate = 0.95;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  });
}
