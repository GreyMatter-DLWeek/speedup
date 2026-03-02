function parseRubric(rubricText) {
  return rubricText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ id: index + 1, line }));
}

function analyze(rubric, draft) {
  const draftLower = draft.toLowerCase();
  return rubric.map((r) => {
    const keywords = r.line
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((x) => x.length > 4)
      .slice(0, 4);
    const matched = keywords.filter((k) => draftLower.includes(k));
    const covered = matched.length >= Math.max(1, Math.ceil(keywords.length / 2));

    return {
      rubricLine: r.line,
      covered,
      risk: covered ? "Low" : "High",
      suggestion: covered ? "Looks addressed; tighten examples and evidence." : "Add a dedicated section explicitly addressing this criterion.",
      why: `Triggered by rubric line ${r.id}. Matched keywords: ${matched.join(", ") || "none"}.`,
    };
  });
}

export function mountFeature8(container) {
  container.innerHTML = `
    <h3>Project Work Analysis and Evaluation</h3>
    <div class="grid grid-2">
      <div class="card">
        <label class="small">Rubric (one criterion per line)</label>
        <textarea id="f8-rubric" class="textarea" rows="8">Problem definition is clear and specific.
Methodology is justified with evidence.
Evaluation includes measurable outcomes.
Limitations and future work are discussed.</textarea>
        <label class="small" style="margin-top:8px; display:block;">Project draft text</label>
        <textarea id="f8-draft" class="textarea" rows="8">This draft defines the problem and includes an evaluation section with benchmark outcomes. We also outline future improvements.</textarea>
        <button id="f8-run" class="button" style="margin-top:8px;">Analyze</button>
      </div>
      <div class="card">
        <h4>Rubric checklist and risks</h4>
        <div id="f8-results"></div>
      </div>
    </div>
  `;

  const results = container.querySelector("#f8-results");

  container.querySelector("#f8-run").addEventListener("click", () => {
    const rubric = parseRubric(container.querySelector("#f8-rubric").value);
    const draft = container.querySelector("#f8-draft").value;
    const report = analyze(rubric, draft);

    results.innerHTML = report
      .map(
        (row, idx) => `
      <div class="card" style="margin-bottom:8px;">
        <div><strong>${row.covered ? "[OK]" : "[GAP]"}</strong> ${row.rubricLine}</div>
        <div class="small">Risk: ${row.risk} | Suggestion: ${row.suggestion}</div>
        <button class="button secondary" data-idx="${idx}" style="margin-top:6px; width:auto;">Explain why</button>
        <div class="f8-reason" id="f8-why-${idx}" hidden>${row.why}</div>
      </div>
    `,
      )
      .join("");

    results.querySelectorAll("button[data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.idx;
        const reason = results.querySelector(`#f8-why-${id}`);
        reason.hidden = !reason.hidden;
      });
    });
  });
}
