export function initFeature5(ctx) {
  const { runtime, apiGet, apiPost, apiPostForm, API, escapeHtml, logAudit, scheduleSave } = ctx;

  let studyNotesInitialized = false;

  function setStudyNotesStep(step) {
    const step1 = document.getElementById("studyNotesStep1");
    const step2 = document.getElementById("studyNotesStep2");
    if (!step1 || !step2) return;
    step1.style.display = step === 1 ? "block" : "none";
    step2.style.display = step === 2 ? "block" : "none";
  }

  function setStudyNotesProgress(value, label = "") {
    const pct = Math.max(0, Math.min(100, Number(value || 0)));
    const fill = document.getElementById("studyNotesProgressFill");
    const meta = document.getElementById("studyNotesProgressMeta");
    const line = document.getElementById("studyNotesProgressLabel");
    if (fill) fill.style.width = `${pct}%`;
    if (meta) meta.textContent = `${Math.round(pct)}%`;
    if (line && label) line.textContent = label;
  }

  function activeStudyPack() {
    const packs = Array.isArray(runtime.state.studyPacks) ? runtime.state.studyPacks : [];
    const activeId = String(runtime.state.activeStudyPackId || "");
    return packs.find((p) => String(p.id || "") === activeId) || packs[0] || null;
  }

  function renderStudyPackSummary() {
    const summaryEl = document.getElementById("studyPackSummary");
    if (!summaryEl) return;
    const pack = activeStudyPack();
    if (!pack) {
      summaryEl.innerHTML = "No study pack loaded yet.";
      return;
    }

    const synthesis = pack.synthesis || {};
    const concepts = Array.isArray(synthesis.keyConcepts) ? synthesis.keyConcepts : [];
    const plan = Array.isArray(synthesis.quickRevisionPlan) ? synthesis.quickRevisionPlan : [];
    summaryEl.innerHTML = `
      <div><strong>${escapeHtml(pack.title || "Study Pack")}</strong></div>
      <div style="font-size:12px;color:var(--text3);margin-top:2px;">Files: ${Number(pack.totalFiles || 0)} | Success: ${Number(pack.successFiles || 0)} | Failed: ${Number(pack.failedFiles || 0)}</div>
      <div style="margin-top:8px;"><strong>Overview:</strong> ${escapeHtml(synthesis.overview || "Upload PDFs to generate combined notes.")}</div>
      <div style="margin-top:8px;"><strong>Key concepts:</strong>
        <ul style="margin:6px 0 0 18px;">
          ${(concepts.length ? concepts.slice(0, 5) : ["No concepts yet."]).map((c) => `<li>${escapeHtml(c)}</li>`).join("")}
        </ul>
      </div>
      <div style="margin-top:8px;"><strong>Quick revision plan:</strong>
        <ol style="margin:6px 0 0 18px;">
          ${(plan.length ? plan.slice(0, 3) : ["Upload and process PDFs first."]).map((c) => `<li>${escapeHtml(c)}</li>`).join("")}
        </ol>
      </div>
    `;
  }

  function renderStudyPackSelect() {
    const select = document.getElementById("studyPackSelect");
    if (!select) return;
    const packs = Array.isArray(runtime.state.studyPacks) ? runtime.state.studyPacks : [];
    if (!packs.length) {
      select.innerHTML = '<option value="">No study packs yet</option>';
      renderStudyPackSummary();
      return;
    }

    select.innerHTML = packs
      .map((p) => `<option value="${escapeHtml(p.id || "")}">${escapeHtml(p.title || "Study Pack")} · ${Number(p.successFiles || 0)}/${Number(p.totalFiles || 0)} ready</option>`)
      .join("");
    const current = String(runtime.state.activeStudyPackId || "");
    select.value = packs.some((p) => String(p.id || "") === current) ? current : String(packs[0].id || "");
    runtime.state.activeStudyPackId = select.value;
    renderStudyPackSummary();
  }

  function renderProcessingRows(files, states = {}) {
    const wrap = document.getElementById("studyNotesProcessingList");
    if (!wrap) return;
    if (!files.length) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML = files
      .map((f, idx) => {
        const key = `${f.name || "file"}-${idx}`;
        const s = states[key] || { state: "queued", msg: "Queued" };
        const color = s.state === "ok" ? "var(--success)" : s.state === "error" ? "var(--danger)" : "var(--text3)";
        return `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);">
          <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f.name || `File ${idx + 1}`)}</span>
          <span style="font-size:12px;color:${color};white-space:nowrap;">${escapeHtml(s.msg || "Queued")}</span>
        </div>`;
      })
      .join("");
  }

  async function loadStudyPacks() {
    try {
      const res = await apiGet(API.studyNotesPacks);
      runtime.state.studyPacks = Array.isArray(res.packs) ? res.packs : [];
      runtime.state.activeStudyPackId = res.activePackId || runtime.state.studyPacks?.[0]?.id || "";
      scheduleSave();
    } catch {
      runtime.state.studyPacks = Array.isArray(runtime.state.studyPacks) ? runtime.state.studyPacks : [];
    }
    renderStudyPackSelect();
  }

  async function uploadStudyPackPdfs() {
    const input = document.getElementById("studyPdfInput");
    const titleInput = document.getElementById("studyPackTitleInput");
    const finalStatus = document.getElementById("studyNotesFinalStatus");
    const files = Array.from(input?.files || []);

    if (!files.length) {
      if (finalStatus) finalStatus.textContent = "Please choose at least one PDF file.";
      return;
    }

    const invalid = files.find((f) => !String(f.name || "").toLowerCase().endsWith(".pdf") && String(f.type || "").toLowerCase() !== "application/pdf");
    if (invalid) {
      if (finalStatus) finalStatus.textContent = `Only PDF files are accepted. Invalid: ${invalid.name}`;
      return;
    }

    setStudyNotesStep(2);
    const states = {};
    renderProcessingRows(files, states);
    setStudyNotesProgress(8, "Uploading PDFs...");
    if (finalStatus) finalStatus.textContent = "";

    const form = new FormData();
    const title = String(titleInput?.value || "").trim();
    if (title) form.append("packTitle", title);
    const currentPackId = String(runtime.state.activeStudyPackId || "");
    if (currentPackId) form.append("packId", currentPackId);
    files.forEach((f) => form.append("pdfs", f));

    setStudyNotesProgress(22, `Processing ${files.length} PDF(s)...`);

    try {
      const out = await apiPostForm(API.studyNotesUpload, form);
      const rows = Array.isArray(out.files) ? out.files : [];
      const byName = {};
      rows.forEach((r) => {
        byName[String(r.name || "")] = r;
      });

      files.forEach((f, idx) => {
        const key = `${f.name || "file"}-${idx}`;
        const hit = byName[String(f.name || "")];
        if (!hit) {
          states[key] = { state: "error", msg: "Failed" };
        } else if (hit.ok) {
          states[key] = { state: "ok", msg: "Processed" };
        } else {
          states[key] = { state: "error", msg: hit.error || "Failed" };
        }
      });
      renderProcessingRows(files, states);
      setStudyNotesProgress(100, `Processed ${Number(out.summary?.success || 0)}/${Number(out.summary?.total || files.length)} PDF(s)`);

      await loadStudyPacks();
      if (out?.pack?.id) runtime.state.activeStudyPackId = out.pack.id;
      renderStudyPackSelect();

      if (finalStatus) {
        finalStatus.textContent = `Done: ${Number(out.summary?.success || 0)} success, ${Number(out.summary?.failed || 0)} failed.`;
      }
      logAudit(`Study pack processed (${Number(out.summary?.success || 0)}/${Number(out.summary?.total || files.length)} PDFs).`);
      scheduleSave();
    } catch (error) {
      setStudyNotesProgress(100, "Processing failed");
      if (finalStatus) finalStatus.textContent = error.message || "Failed to upload/process PDFs.";
    }
  }

  function initStudyNotesFeature() {
    if (studyNotesInitialized) return;
    studyNotesInitialized = true;

    const uploadBtn = document.getElementById("studyNotesUploadBtn");
    const backBtn = document.getElementById("studyNotesBackBtn");
    const select = document.getElementById("studyPackSelect");
    if (!uploadBtn || !backBtn || !select) return;

    uploadBtn.addEventListener("click", uploadStudyPackPdfs);
    backBtn.addEventListener("click", () => setStudyNotesStep(1));
    select.addEventListener("change", () => {
      runtime.state.activeStudyPackId = String(select.value || "");
      renderStudyPackSummary();
      scheduleSave();
    });

    setStudyNotesStep(1);
    loadStudyPacks();
  }

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

  return { runRagQuery, indexLatestHighlight, renderRecommendations, initStudyNotesFeature, loadStudyPacks, activeStudyPack };
}
