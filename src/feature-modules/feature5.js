export function initFeature5(ctx) {
  const { runtime, apiPost, API, escapeHtml, logAudit, scheduleSave } = ctx;

  async function runRagQuery() {
    const input = document.getElementById("ragQueryInput");
    const out = document.getElementById("ragResults");
    if (!input || !out) return;

    const query = input.value.trim();
    if (!query) return;
    out.textContent = "Querying RAG index...";

    try {
      const res = await apiPost(API.ragQuery, { query, topK: 5 });
      if (!res.hits?.length) {
        out.textContent = "No matching documents in index.";
        return;
      }
      out.innerHTML = res.hits
        .map((h) => `<div style="margin-bottom:8px;"><strong>${escapeHtml(h.title || "Untitled")}</strong><br>${escapeHtml(h.snippet || "")}<br><span style="color:var(--text3)">Source: ${escapeHtml(h.source || "")}</span></div>`)
        .join("");
      logAudit(`RAG query executed: ${query}`);
    } catch (error) {
      out.textContent = `RAG query failed: ${error.message || "unknown error"}`;
    }
  }

  async function indexLatestHighlight() {
    const out = document.getElementById("ragResults");
    const latest = runtime.state.highlights[0];
    if (!out) return;
    if (!latest) {
      out.textContent = "No highlight to index. Save one from Active Reading first.";
      return;
    }

    out.textContent = "Indexing latest highlight...";
    try {
      await apiPost(API.ragIndexNote, {
        studentId: runtime.state.student.id,
        title: `${latest.topic} ${latest.date}`,
        text: `${latest.text}\nSummary: ${latest.summary}\nContext: ${latest.context}`,
        source: "student-highlight"
      });
      out.textContent = "Latest highlight indexed successfully.";
      logAudit("Indexed latest highlight to search.");
    } catch (error) {
      out.textContent = `Indexing failed: ${error.message || "unknown error"}`;
    }
  }

  async function renderRecommendations() {
    const recCards = document.querySelectorAll("#page-recommendations .rec-card");
    if (!recCards.length) return;

    try {
      const result = await apiPost(API.recommendations, { state: runtime.state });
      runtime.state.liveRecommendation = result;
      const next = result.nextActions || [];
      if (next[0]) recCards[0].querySelector(".rec-title").textContent = next[0];
      if (next[1] && recCards[1]) recCards[1].querySelector(".rec-title").textContent = next[1];
      if (next[2] && recCards[2]) recCards[2].querySelector(".rec-title").textContent = next[2];
      logAudit(`Recommendations refreshed (${result.provider || "unknown"}).`);
      scheduleSave();
    } catch {
      // keep static cards
    }
  }

  return { runRagQuery, indexLatestHighlight, renderRecommendations };
}
