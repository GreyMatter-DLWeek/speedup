const STORAGE_KEY = "speedup_feature2_highlights_v1";

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

function aiMeta(text) {
  return {
    concise: `Key idea: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`,
    why: "Matters because this concept appears repeatedly in exam-style reasoning tasks.",
    tags: ["core", "exam", "revision"],
  };
}

function downloadMarkdown(items) {
  const lines = ["# Highlights Vault", ""];
  items.forEach((item, i) => {
    lines.push(`## ${i + 1}. ${item.text}`);
    lines.push(`- Explanation: ${item.explanation}`);
    lines.push(`- Why it matters: ${item.why}`);
    lines.push(`- Tags: ${item.tags.join(", ")}`);
    lines.push(`- Timestamp: ${item.timestamp}`);
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "highlights.md";
  a.click();
  URL.revokeObjectURL(url);
}

export function mountFeature2(container) {
  const state = load();
  container.innerHTML = `
    <h3>Highlights Vault with AI Context</h3>
    <div class="grid grid-2">
      <div class="card">
        <p class="small">Select text below, then click Save Highlight.</p>
        <div id="f2-note" class="f2-note" contenteditable="true">Dynamic programming uses overlapping subproblems and memoization. Graph theory includes bipartite checks and cycle detection. Spaced repetition strengthens long-term memory.</div>
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button id="f2-save" class="button">Save Highlight</button>
          <button id="f2-export" class="button secondary">Export highlights.md</button>
        </div>
      </div>
      <div class="card">
        <h4>Vault</h4>
        <div id="f2-vault"></div>
      </div>
    </div>
  `;

  const vault = container.querySelector("#f2-vault");

  function renderVault() {
    vault.innerHTML = state
      .map(
        (item) => `
        <div class="f2-vault-item card">
          <div><strong>${item.text}</strong></div>
          <div class="small">${item.explanation}</div>
          <div class="small">Why it matters: ${item.why}</div>
          <div>${item.tags.map((x) => `<span class="badge">${x}</span>`).join(" ")}</div>
        </div>
      `,
      )
      .join("");
  }

  container.querySelector("#f2-save").addEventListener("click", () => {
    const selected = window.getSelection()?.toString().trim();
    if (!selected) return;

    const meta = aiMeta(selected);
    state.unshift({
      student_id: "alex-kim",
      text: selected,
      explanation: meta.concise,
      why: meta.why,
      tags: meta.tags,
      timestamp: new Date().toISOString(),
    });

    save(state);
    renderVault();
  });

  container.querySelector("#f2-export").addEventListener("click", () => downloadMarkdown(state));

  renderVault();
}
