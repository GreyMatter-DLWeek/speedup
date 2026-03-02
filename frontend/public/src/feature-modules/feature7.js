export function initFeature7(ctx) {
  const { runtime, API, apiGet, apiPost, apiPostForm, escapeHtml, logAudit, scheduleSave } = ctx;

  let initialized = false;

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

  function getUploadBySelected(selectId) {
    const rows = Array.isArray(runtime.state.practiceUploads) ? runtime.state.practiceUploads : [];
    if (!rows.length) return null;
    const el = document.getElementById(selectId);
    const idx = Number(el?.value ?? 0);
    if (Number.isNaN(idx) || idx < 0 || idx >= rows.length) return rows[0];
    return rows[idx];
  }

  function getSourceTextFor(selectId) {
    const item = getUploadBySelected(selectId);
    if (!item) return "";
    return String(item.sourceTextSnippet || item.analysis?.summary || "").trim();
  }

  function populateSourceSelectors() {
    const rows = Array.isArray(runtime.state.practiceUploads) ? runtime.state.practiceUploads : [];
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
        .map((item, idx) => `<option value="${idx}">${escapeHtml(item.name || "Uploaded file")} | ${escapeHtml(item.date || "")}</option>`)
        .join("");
      const currentIdx = Number(currentVal);
      if (!Number.isNaN(currentIdx) && currentIdx >= 0 && currentIdx < rows.length) {
        el.value = String(currentIdx);
      } else {
        el.value = "0";
      }
    });
  }

  function renderUploads() {
    const wrap = document.getElementById("uploadedPapersList");
    if (!wrap) return;
    const rows = Array.isArray(runtime.state.practiceUploads) ? runtime.state.practiceUploads : [];
    if (!rows.length) {
      wrap.innerHTML = '<div style="font-size:13px;color:var(--text3);">No uploads yet.</div>';
      return;
    }

    const activeQuizIndex = Number(document.getElementById("quizSourceSelect")?.value ?? 0);
    wrap.innerHTML = rows
      .slice(0, 20)
      .map((item, idx) => {
        const hasUrl = Boolean(item.url);
        const action = hasUrl
          ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost" style="padding:6px 10px;font-size:12px;">Open File</a>`
          : '<span class="chip" style="font-size:11px;">No file URL</span>';
        const selectedClass = idx === activeQuizIndex ? " upload-card active" : " upload-card";
        return `
          <div class="${selectedClass.trim()}">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="font-size:18px;">File</div>
              <div style="flex:1;min-width:0;">
                <div class="upload-card-title">${escapeHtml(item.name || "Uploaded file")}</div>
                <div class="upload-card-meta">${escapeHtml(item.date || "")} | ${formatBytes(item.size)} | ${escapeHtml(item.type || "")}</div>
              </div>
              ${action}
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
      .map((c, idx) => `<div style="padding:12px;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;background:var(--surface2);"><div style="font-size:14px;font-weight:700;">${idx + 1}. ${escapeHtml(c.question || "")}</div><div style="margin-top:6px;color:var(--text2);font-size:14px;">${escapeHtml(c.answer || "")}</div></div>`)
      .join("");
  }

  async function refreshUserState() {
    try {
      const out = await apiGet(API.userState);
      if (out?.state && typeof out.state === "object") {
        runtime.state = { ...runtime.state, ...out.state, student: { ...runtime.state.student, ...(out.state.student || {}) } };
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
      document.getElementById("quizSourceSelect").value = "0";
      document.getElementById("flashcardSourceSelect").value = "0";
      renderUploads();
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message || "Upload/analysis failed.";
    }
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

    renderAnalysis(null, "");
    refreshUserState();
  }

  return { initPracticeFeature };
}