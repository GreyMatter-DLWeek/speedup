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

  function latestContext() {
    const latest = runtime.state.practiceUploads?.[0];
    if (!latest) return "";
    return String(latest.sourceTextSnippet || latest.analysis?.summary || "").trim();
  }

  function renderExamHistory() {
    const wrap = document.getElementById("examHistoryList");
    if (!wrap) return;
    const rows = Array.isArray(runtime.state.examHistory) ? runtime.state.examHistory.slice().reverse() : [];
    if (!rows.length) {
      wrap.innerHTML = '<div style="font-size:12px;color:var(--text3);">No exam history yet.</div>';
      return;
    }

    wrap.innerHTML = rows
      .slice(0, 12)
      .map((item) => {
        const score = Number(item.score || 0);
        const grade = score >= 85 ? "A" : score >= 75 ? "B" : score >= 65 ? "C" : "D";
        return `
          <div class="exam-row">
            <div class="exam-score score-${grade.toLowerCase()}">${grade}</div>
            <div class="exam-info">
              <div class="exam-name">${escapeHtml(item.name || "Exam")}</div>
              <div class="exam-date">Score: ${score}% | ${escapeHtml(item.date || "") || "Date N/A"} | Studied ${Number(item.hours || 0)}h</div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderUploads() {
    const wrap = document.getElementById("uploadedPapersList");
    if (!wrap) return;
    const rows = Array.isArray(runtime.state.practiceUploads) ? runtime.state.practiceUploads : [];
    if (!rows.length) {
      wrap.innerHTML = '<div style="font-size:12px;color:var(--text3);">No uploads yet.</div>';
      return;
    }

    wrap.innerHTML = rows
      .slice(0, 20)
      .map((item) => {
        const hasUrl = Boolean(item.url);
        const action = hasUrl
          ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost" style="padding:5px 10px;font-size:11px;">Open uploaded file</a>`
          : '<span class="chip" style="font-size:11px;">No file URL</span>';
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;">
            <div style="font-size:18px;">File</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name || "Uploaded file")}</div>
              <div style="font-size:11px;color:var(--text3);">${escapeHtml(item.date || "")} | ${formatBytes(item.size)} | ${escapeHtml(item.type || "")}</div>
            </div>
            ${action}
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
      <div style="font-weight:600;margin-bottom:8px;">${escapeHtml(out.quiz.title || "Generated Quiz")}</div>
      ${questions
        .map((q, idx) => {
          const options = Array.isArray(q.options) && q.options.length
            ? `<ul style="margin:6px 0 6px 18px;">${q.options.map((o) => `<li>${escapeHtml(o)}</li>`).join("")}</ul>`
            : "";
          return `<div style="margin-bottom:10px;"><strong>Q${idx + 1}:</strong> ${escapeHtml(q.question || "")}${options}<div style="font-size:12px;color:var(--text3);">Answer: ${escapeHtml(q.answer || "")}</div></div>`;
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
      .map((c, idx) => `<div style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;"><strong>${idx + 1}. ${escapeHtml(c.question || "")}</strong><div style="margin-top:4px;color:var(--text3);">${escapeHtml(c.answer || "")}</div></div>`)
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
    renderUploads();
    renderExamHistory();
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
      renderUploads();

      await refreshUserState();
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message || "Upload/analysis failed.";
    }
  }

  async function onGenerateQuiz() {
    const status = document.getElementById("quizStatus");
    const difficulty = String(document.getElementById("quizDifficulty")?.value || "medium");
    const numQuestions = Number(document.getElementById("quizCount")?.value || 5);
    const questionType = String(document.getElementById("quizType")?.value || "mcq");
    const sourceText = latestContext();

    if (!sourceText) {
      if (status) status.textContent = "Upload or analyze a paper first so quiz can be grounded in your content.";
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
    const count = Number(document.getElementById("flashcardCount")?.value || 8);
    const sourceText = latestContext();

    if (!sourceText) {
      if (status) status.textContent = "Upload or analyze a paper first so flashcards can be grounded in your content.";
      return;
    }

    if (status) status.textContent = "Generating flashcards...";
    try {
      const out = await apiPost(API.practiceGenerateFlashcards, {
        count,
        sourceText
      });
      renderFlashcards(out);
      if (status) status.textContent = "Flashcards generated.";
      logAudit("Practice flashcards generated.");
    } catch (error) {
      if (status) status.textContent = error.message || "Failed to generate flashcards.";
    }
  }

  async function onAddExam() {
    const statusEl = document.getElementById("examStatus");
    const name = String(document.getElementById("examNameInput")?.value || "").trim();
    const score = Number(document.getElementById("examScoreInput")?.value || 0);
    const hours = Number(document.getElementById("examHoursInput")?.value || 0);
    const confidence = Number(document.getElementById("examConfidenceInput")?.value || 0);

    if (!name || Number.isNaN(score) || Number.isNaN(hours) || Number.isNaN(confidence)) {
      if (statusEl) statusEl.textContent = "Please fill all exam fields.";
      return;
    }

    try {
      if (statusEl) statusEl.textContent = "Saving exam...";
      const out = await apiPost(API.userExam, { name, score, hours, confidence });
      if (out?.state) {
        runtime.state = { ...runtime.state, ...out.state, student: { ...runtime.state.student, ...(out.state.student || {}) } };
      }
      renderExamHistory();
      if (statusEl) statusEl.textContent = "Exam saved.";
      logAudit(`Exam recorded: ${name}`);
      scheduleSave();
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message || "Failed to save exam.";
    }
  }

  function initPracticeFeature() {
    if (initialized) return;
    initialized = true;

    document.getElementById("practiceAnalyzeBtn")?.addEventListener("click", onAnalyzePaper);
    document.getElementById("generateQuizBtn")?.addEventListener("click", onGenerateQuiz);
    document.getElementById("generateFlashcardsBtn")?.addEventListener("click", onGenerateFlashcards);
    document.getElementById("addExamBtn")?.addEventListener("click", onAddExam);

    renderAnalysis(null, "");
    refreshUserState();
  }

  return { initPracticeFeature };
}