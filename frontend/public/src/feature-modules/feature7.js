export function initFeature7(ctx) {
  const { runtime, API, apiGet, apiPost, apiPostForm, apiPut, apiDelete, escapeHtml, logAudit, scheduleSave } = ctx;

  let initialized = false;
  let selectedUploadIds = new Set();
  let supportsPracticeUploadRoutes = false;

  function formatBytes(value) {
    const size = Number(value || 0);
    if (!Number.isFinite(size) || size <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let n = size;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i += 1;
    }
    return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function getUploadRows() {
    const rows = Array.isArray(runtime.state.practiceUploads) ? runtime.state.practiceUploads : [];
    return rows
      .map((item, index) => {
        const uploadId = String(item?.uploadId || `legacy-${index}`);
        return { ...item, uploadId };
      });
  }

  function getUploadBySelected(selectId) {
    const rows = getUploadRows();
    if (!rows.length) return null;
    const el = document.getElementById(selectId);
    const selectedId = String(el?.value || "").trim();
    const byId = rows.find((r) => String(r.uploadId) === selectedId);
    return byId || rows[0];
  }

  function getSourceTextFor(selectId) {
    const item = getUploadBySelected(selectId);
    if (!item) return "";
    return String(item.sourceTextSnippet || item.analysis?.summary || "").trim();
  }

  function populateSourceSelectors() {
    const rows = getUploadRows();
    const selectors = ["quizSourceSelect", "flashcardSourceSelect"];
    selectors.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!rows.length) {
        el.innerHTML = '<option value="">No uploads available</option>';
        return;
      }
      const currentVal = el.value;
      el.innerHTML = rows
        .map((item) => `<option value="${escapeHtml(String(item.uploadId))}">${escapeHtml(item.name || "Uploaded file")} | ${escapeHtml(item.date || "")}</option>`)
        .join("");
      const hasCurrent = rows.some((r) => String(r.uploadId) === String(currentVal));
      if (hasCurrent) {
        el.value = String(currentVal);
      } else {
        el.value = String(rows[0].uploadId);
      }
    });
  }

  function updateSelectionCount() {
    const label = document.getElementById("uploadSelectionCount");
    if (!label) return;
    label.textContent = `${selectedUploadIds.size} selected`;
  }

  function renderUploads() {
    const wrap = document.getElementById("uploadedPapersList");
    if (!wrap) return;
    const rows = getUploadRows();
    if (!rows.length) {
      selectedUploadIds = new Set();
      updateSelectionCount();
      wrap.innerHTML = '<div style="font-size:13px;color:var(--text3);">No uploads yet.</div>';
      return;
    }
    const rowIds = new Set(rows.map((r) => String(r.uploadId)));
    selectedUploadIds = new Set([...selectedUploadIds].filter((id) => rowIds.has(id)));
    updateSelectionCount();

    const activeQuizId = String(document.getElementById("quizSourceSelect")?.value || "");
    wrap.innerHTML = rows
      .slice(0, 20)
      .map((item) => {
        const hasUrl = Boolean(item.url);
        const action = hasUrl
          ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost" style="padding:6px 10px;font-size:12px;">Open File</a>`
          : '<span class="chip" style="font-size:11px;">No file URL</span>';
        const isCurrentSource = String(item.uploadId) === activeQuizId;
        const selectedClass = isCurrentSource ? " upload-card active" : " upload-card";
        const checked = selectedUploadIds.has(String(item.uploadId)) ? "checked" : "";
        return `
          <div class="${selectedClass.trim()}" data-upload-id="${escapeHtml(String(item.uploadId))}">
            <div style="display:flex;align-items:center;gap:10px;">
              <input type="checkbox" class="upload-select-checkbox" data-upload-id="${escapeHtml(String(item.uploadId))}" ${checked} />
              <div style="font-size:18px;">File</div>
              <div style="flex:1;min-width:0;">
                <div class="upload-card-title">${escapeHtml(item.name || "Uploaded file")}</div>
                <div class="upload-card-meta">${escapeHtml(item.date || "")} | ${formatBytes(item.size)} | ${escapeHtml(item.type || "")}</div>
              </div>
              ${action}
              <button class="btn btn-ghost delete-upload-btn" data-upload-id="${escapeHtml(String(item.uploadId))}" style="padding:6px 10px;font-size:12px;color:var(--danger);border-color:rgba(248,113,113,0.35);">Delete</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderInsights(latestAnalysis) {
    const insightEl = document.getElementById("practiceInsights");
    if (!insightEl) return;
    const fromState = runtime.state.practiceUploads?.[0]?.analysis;
    const analysis = latestAnalysis || fromState;
    if (!analysis) {
      insightEl.textContent = "Upload and analyze a paper to generate learning signals.";
      return;
    }

    const topics = Array.isArray(analysis.likelyTopics) ? analysis.likelyTopics : [];
    const weakSignals = Array.isArray(analysis.weakSignals) ? analysis.weakSignals : [];
    insightEl.innerHTML = `
      <div><strong>Likely topics:</strong> ${escapeHtml(topics.join(", ") || "N/A")}</div>
      <div style="margin-top:8px;"><strong>Weak signals:</strong> ${escapeHtml(weakSignals.join(", ") || "N/A")}</div>
      <div style="margin-top:8px;"><strong>Difficulty:</strong> ${escapeHtml(analysis.difficultyLevel || "N/A")}</div>
    `;
  }

  function renderAnalysis(analysis, provider) {
    const out = document.getElementById("practiceAnalysis");
    if (!out) return;
    if (!analysis) {
      out.textContent = "No analysis yet.";
      return;
    }

    const steps = Array.isArray(analysis.recommendedNextSteps) ? analysis.recommendedNextSteps : [];
    out.innerHTML = `
      <div><strong>Provider:</strong> ${escapeHtml(provider || "unknown")}</div>
      <div style="margin-top:8px;"><strong>Summary:</strong> ${escapeHtml(analysis.summary || "")}</div>
      <div style="margin-top:8px;"><strong>Likely topics:</strong> ${escapeHtml((analysis.likelyTopics || []).join(", ") || "N/A")}</div>
      <div style="margin-top:8px;"><strong>Weak signals:</strong> ${escapeHtml((analysis.weakSignals || []).join(", ") || "N/A")}</div>
      <div style="margin-top:8px;"><strong>Next actions:</strong></div>
      <ol style="margin:6px 0 0 18px;">
        ${steps.slice(0, 3).map((s) => `<li>${escapeHtml(s)}</li>`).join("") || "<li>No actions returned.</li>"}
      </ol>
    `;
  }

  function renderQuiz(out) {
    const wrap = document.getElementById("quizOutput");
    if (!wrap) return;
    const questions = out?.quiz?.questions || [];
    if (!questions.length) {
      wrap.textContent = "No quiz generated yet.";
      return;
    }
    wrap.innerHTML = `
      <div style="font-size:16px;font-weight:700;margin-bottom:10px;">${escapeHtml(out.quiz.title || "Generated Quiz")}</div>
      <div style="margin-bottom:10px;font-size:11px;color:var(--text3);">AI-generated questions. Verify content accuracy with your uploaded source before using for revision.</div>
      ${questions
        .map((q, idx) => {
          const options = Array.isArray(q.options) && q.options.length
            ? `<ul style="margin:8px 0 8px 20px;">${q.options.map((o) => `<li>${escapeHtml(o)}</li>`).join("")}</ul>`
            : "";
          return `<div style="margin-bottom:12px;padding:10px;border:1px solid var(--border);border-radius:10px;"><strong>Q${idx + 1}:</strong> ${escapeHtml(q.question || "")}${options}<div style="font-size:12px;color:var(--text3);margin-top:6px;">Answer: ${escapeHtml(q.answer || "")}</div></div>`;
        })
        .join("")}
    `;
  }

  function renderFlashcards(out) {
    const wrap = document.getElementById("flashcardOutput");
    if (!wrap) return;
    const cards = out?.flashcards?.cards || [];
    if (!cards.length) {
      wrap.textContent = "No flashcards generated yet.";
      return;
    }
    wrap.innerHTML = cards
      .map((c, idx) => `<div style="padding:12px;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;background:var(--surface2);"><div style=\"margin-bottom:6px;font-size:11px;color:var(--text3);\">AI-generated flashcard. Verify with source.</div><div style="font-size:14px;font-weight:700;">${idx + 1}. ${escapeHtml(c.question || "")}</div><div style="margin-top:6px;color:var(--text2);font-size:14px;">${escapeHtml(c.answer || "")}</div></div>`)
      .join("");
  }

  async function refreshUserState() {
    try {
      const out = await apiGet(API.userState);
      if (out?.state && typeof out.state === "object") {
        runtime.state = { ...runtime.state, ...out.state, student: { ...runtime.state.student, ...(out.state.student || {}) } };
      }
      try {
        const uploadsOut = await apiGet(API.practiceUploads);
        if (uploadsOut?.ok && Array.isArray(uploadsOut.uploads)) {
          runtime.state.practiceUploads = uploadsOut.uploads;
          supportsPracticeUploadRoutes = true;
        }
      } catch {
        // Backward-compatible: older backend may not expose /api/practice/uploads.
        supportsPracticeUploadRoutes = false;
      }
    } catch {
      // Keep in-memory state.
    }
    populateSourceSelectors();
    renderUploads();
    renderInsights();
  }

  async function onAnalyzePaper() {
    const statusEl = document.getElementById("practiceStatus");
    const fileInput = document.getElementById("practiceFileInput");
    const topicInput = document.getElementById("practiceTopicInput");
    const pastedInput = document.getElementById("practicePastedText");

    const file = fileInput?.files?.[0] || null;
    const topic = String(topicInput?.value || "").trim() || "General";
    const pastedText = String(pastedInput?.value || "").trim();

    if (!file && !pastedText) {
      if (statusEl) statusEl.textContent = "Upload a file or paste text first.";
      return;
    }

    if (statusEl) statusEl.textContent = "Analyzing...";

    const form = new FormData();
    form.append("topic", topic);
    if (file) form.append("paper", file);
    if (pastedText) form.append("pastedText", pastedText);

    try {
      const out = await apiPostForm(API.practiceAnalyze, form);
      if (statusEl) statusEl.textContent = "Analysis complete.";
      renderAnalysis(out.analysis, out.provider);
      renderInsights(out.analysis);

      const fileMeta = out.file || {};
      const item = {
        uploadId: out.uploadId || "",
        name: fileMeta.name || "Pasted Text Input",
        type: fileMeta.type || "text/plain",
        size: Number(fileMeta.size || pastedText.length || 0),
        analysis: out.analysis || {},
        date: new Date().toISOString().slice(0, 10),
        url: fileMeta.url || "",
        storagePath: fileMeta.storagePath || "",
        fileProvider: fileMeta.provider || "",
        sourceTextSnippet: out.sourceTextSnippet || ""
      };

      runtime.state.practiceUploads = Array.isArray(runtime.state.practiceUploads) ? runtime.state.practiceUploads : [];
      runtime.state.practiceUploads.unshift(item);
      runtime.state.practiceUploads = runtime.state.practiceUploads.slice(0, 30);
      logAudit(`Practice upload analyzed: ${item.name}`);
      scheduleSave();

      await refreshUserState();
      if (out.uploadId) {
        const quizSelect = document.getElementById("quizSourceSelect");
        const flashSelect = document.getElementById("flashcardSourceSelect");
        if (quizSelect) quizSelect.value = String(out.uploadId);
        if (flashSelect) flashSelect.value = String(out.uploadId);
      }
      renderUploads();
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message || "Upload/analysis failed.";
    }
  }

  async function deleteSingleUpload(uploadId) {
    const id = String(uploadId || "").trim();
    if (!id) return;
    const ok = window.confirm("Delete this uploaded source?");
    if (!ok) return;
    const status = document.getElementById("practiceStatus");
    if (status) status.textContent = "Deleting source...";
    let deletedViaApi = false;
    if (!id.startsWith("legacy-") && supportsPracticeUploadRoutes) {
      try {
        await apiDelete(API.practiceUpload(id));
        deletedViaApi = true;
      } catch {
        deletedViaApi = false;
      }
    }
    let savedRemotely = true;
    if (!deletedViaApi) {
      savedRemotely = await deleteUploadsViaStateFallback([id]);
    }
    selectedUploadIds.delete(id);
    await refreshUserState();
    renderUploads();
    if (status) status.textContent = savedRemotely ? "Source deleted." : "Source deleted locally (backend sync failed).";
    logAudit("Practice source deleted.");
    scheduleSave();
  }

  async function deleteSelectedUploads() {
    const ids = [...selectedUploadIds];
    if (!ids.length) return;
    const ok = window.confirm(`Delete ${ids.length} selected source(s)?`);
    if (!ok) return;
    const status = document.getElementById("practiceStatus");
    if (status) status.textContent = "Deleting selected sources...";
    let deletedViaApi = false;
    if (!ids.every((id) => String(id).startsWith("legacy-")) && supportsPracticeUploadRoutes) {
      try {
        await apiPost(API.practiceDeleteUploads, { uploadIds: ids });
        deletedViaApi = true;
      } catch {
        deletedViaApi = false;
      }
    }
    let savedRemotely = true;
    if (!deletedViaApi) {
      savedRemotely = await deleteUploadsViaStateFallback(ids);
    }
    selectedUploadIds = new Set();
    await refreshUserState();
    renderUploads();
    if (status) status.textContent = savedRemotely ? "Selected sources deleted." : "Selected sources deleted locally (backend sync failed).";
    logAudit(`Practice sources deleted: ${ids.length}.`);
    scheduleSave();
  }

  function compactStateForSave(state) {
    const safe = { ...(state || {}) };
    const uploads = Array.isArray(safe.practiceUploads) ? safe.practiceUploads : [];
    safe.practiceUploads = uploads.slice(0, 40).map((item) => ({
      ...item,
      name: String(item?.name || "").slice(0, 180),
      type: String(item?.type || "").slice(0, 80),
      source: String(item?.source || "").slice(0, 180),
      sourceTextSnippet: String(item?.sourceTextSnippet || "").slice(0, 1800),
      analysis: item?.analysis && typeof item.analysis === "object"
        ? {
          summary: String(item.analysis.summary || "").slice(0, 600),
          difficultyLevel: String(item.analysis.difficultyLevel || "").slice(0, 40),
          likelyTopics: Array.isArray(item.analysis.likelyTopics) ? item.analysis.likelyTopics.slice(0, 8).map((x) => String(x || "").slice(0, 80)) : [],
          weakSignals: Array.isArray(item.analysis.weakSignals) ? item.analysis.weakSignals.slice(0, 8).map((x) => String(x || "").slice(0, 140)) : [],
          recommendedNextSteps: Array.isArray(item.analysis.recommendedNextSteps) ? item.analysis.recommendedNextSteps.slice(0, 5).map((x) => String(x || "").slice(0, 220)) : []
        }
        : {}
    }));
    return safe;
  }

  async function deleteUploadsViaStateFallback(uploadIds) {
    const idSet = new Set((uploadIds || []).map((x) => String(x || "")));
    if (!idSet.size) return true;
    const state = runtime.state && typeof runtime.state === "object" ? runtime.state : {};
    const rows = getUploadRows();
    const filtered = rows
      .map((item) => ({ ...item, __uploadId: String(item?.uploadId || "") }))
      .filter((item) => !idSet.has(item.__uploadId))
      .map((item) => {
        const next = { ...item };
        delete next.__uploadId;
        return next;
      });
    const nextState = { ...state, practiceUploads: filtered };
    runtime.state = { ...runtime.state, ...nextState, student: { ...runtime.state.student, ...(nextState.student || {}) } };
    try {
      await apiPut(API.userState, { state: nextState });
      return true;
    } catch {
      try {
        const compacted = compactStateForSave(nextState);
        await apiPut(API.userState, { state: compacted });
        runtime.state = { ...runtime.state, ...compacted, student: { ...runtime.state.student, ...(compacted.student || {}) } };
        return true;
      } catch {
        // Keep local deletion even if backend persistence fails.
        scheduleSave();
        return false;
      }
    }
  }

  function bindUploadListInteractions() {
    const list = document.getElementById("uploadedPapersList");
    if (!list) return;
    list.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const checkbox = target.closest(".upload-select-checkbox");
      if (!(checkbox instanceof HTMLInputElement)) return;
      const id = String(checkbox.getAttribute("data-upload-id") || "");
      if (!id) return;
      if (checkbox.checked) selectedUploadIds.add(id);
      else selectedUploadIds.delete(id);
      updateSelectionCount();
    });
    list.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest(".delete-upload-btn");
      if (!(btn instanceof HTMLButtonElement)) return;
      const id = String(btn.getAttribute("data-upload-id") || "");
      try {
        await deleteSingleUpload(id);
      } catch (error) {
        const status = document.getElementById("practiceStatus");
        if (status) status.textContent = error.message || "Failed to delete source.";
      }
    });
  }

  async function onGenerateQuiz() {
    const status = document.getElementById("quizStatus");
    const difficulty = String(document.getElementById("quizDifficulty")?.value || "medium");
    const numQuestions = Math.max(1, Math.min(20, Number(document.getElementById("quizCount")?.value || 5)));
    const questionType = String(document.getElementById("quizType")?.value || "mcq");
    const sourceText = getSourceTextFor("quizSourceSelect");

    if (!sourceText) {
      if (status) status.textContent = "Select an uploaded source with extracted content first.";
      return;
    }

    if (status) status.textContent = "Generating quiz...";
    try {
      const out = await apiPost(API.practiceGenerateQuiz, {
        difficulty,
        numQuestions,
        questionType,
        sourceText
      });
      renderQuiz(out);
      if (status) status.textContent = "Quiz generated.";
      logAudit("Practice quiz generated.");
    } catch (error) {
      if (status) status.textContent = error.message || "Failed to generate quiz.";
    }
  }

  async function onGenerateFlashcards() {
    const status = document.getElementById("flashcardStatus");
    const count = Math.max(1, Math.min(30, Number(document.getElementById("flashcardCount")?.value || 8)));
    const sourceText = getSourceTextFor("flashcardSourceSelect");

    if (!sourceText) {
      if (status) status.textContent = "Select an uploaded source with extracted content first.";
      return;
    }

    if (status) status.textContent = "Generating flashcards...";
    try {
      const out = await apiPost(API.practiceGenerateFlashcards, {
        count,
        sourceText
      });
      renderFlashcards(out);
      if (status) status.textContent = `Generated ${out?.flashcards?.cards?.length || count} flashcards.`;
      logAudit("Practice flashcards generated.");
    } catch (error) {
      if (status) status.textContent = error.message || "Failed to generate flashcards.";
    }
  }

  function initPracticeFeature() {
    if (initialized) return;
    initialized = true;

    document.getElementById("practiceAnalyzeBtn")?.addEventListener("click", onAnalyzePaper);
    document.getElementById("generateQuizBtn")?.addEventListener("click", onGenerateQuiz);
    document.getElementById("generateFlashcardsBtn")?.addEventListener("click", onGenerateFlashcards);
    document.getElementById("quizSourceSelect")?.addEventListener("change", renderUploads);
    document.getElementById("flashcardSourceSelect")?.addEventListener("change", renderUploads);
    document.getElementById("selectAllUploadsBtn")?.addEventListener("click", () => {
      getUploadRows().forEach((item) => selectedUploadIds.add(String(item.uploadId)));
      renderUploads();
    });
    document.getElementById("clearUploadSelectionBtn")?.addEventListener("click", () => {
      selectedUploadIds = new Set();
      renderUploads();
    });
    document.getElementById("deleteSelectedUploadsBtn")?.addEventListener("click", async () => {
      try {
        await deleteSelectedUploads();
      } catch (error) {
        const status = document.getElementById("practiceStatus");
        if (status) status.textContent = error.message || "Failed to delete selected sources.";
      }
    });
    bindUploadListInteractions();

    renderAnalysis(null, "");
    refreshUserState();
  }

  return { initPracticeFeature };
}
