export function initFeature9(ctx) {
  const { runtime, API, apiPost, escapeHtml, logAudit, scheduleSave } = ctx;

  let initialized = false;
  let sprintStartedMs = 0;
  let currentSprint = null;
  const answers = new Map();

  function getTopicOptions() {
    const list = Array.isArray(runtime.state.topics) ? runtime.state.topics : [];
    const fromTopics = list
      .map((t) => String(t?.name || "").trim())
      .filter(Boolean);
    const set = new Set(fromTopics);
    if (!set.size) set.add("General Revision");
    return [...set].slice(0, 24);
  }

  function renderTopicSelect() {
    const el = document.getElementById("sprintTopicSelect");
    if (!el) return;
    const topics = getTopicOptions();
    el.innerHTML = topics.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  }

  function setStatus(text) {
    const el = document.getElementById("sprintStatus");
    if (el) el.textContent = text;
  }

  function renderMetaRow() {
    const row = document.getElementById("sprintMetaRow");
    if (!row || !currentSprint) return;
    const elapsed = sprintStartedMs ? Math.max(0, Math.round((Date.now() - sprintStartedMs) / 1000)) : 0;
    row.innerHTML = `
      <span class="sprint-pill">Topic: ${escapeHtml(currentSprint.topic || "N/A")}</span>
      <span class="sprint-pill">Difficulty: ${escapeHtml(currentSprint.difficulty || "medium")}</span>
      <span class="sprint-pill">Questions: ${Number(currentSprint.questions?.length || 0)}</span>
      <span class="sprint-pill">Elapsed: ${elapsed}s</span>
    `;
  }

  function chooseOption(questionId, option) {
    answers.set(String(questionId), String(option || ""));
    const rows = Array.from(document.querySelectorAll(".sprint-option"))
      .filter((el) => String(el.getAttribute("data-question-id") || "") === String(questionId));
    rows.forEach((r) => r.classList.remove("active"));
    const target = [...rows].find((r) => String(r.getAttribute("data-value") || "") === String(option || ""));
    target?.classList.add("active");
  }

  function onInputAnswer(questionId, value) {
    answers.set(String(questionId), String(value || ""));
  }

  function renderQuestions() {
    const wrap = document.getElementById("sprintQuestions");
    const attemptWrap = document.getElementById("sprintAttemptWrap");
    if (!wrap || !attemptWrap) return;
    const rows = Array.isArray(currentSprint?.questions) ? currentSprint.questions : [];
    if (!rows.length) {
      attemptWrap.style.display = "none";
      wrap.innerHTML = "";
      return;
    }
    attemptWrap.style.display = "";
    wrap.innerHTML = rows.map((q, idx) => {
      const qid = String(q.id || `q${idx + 1}`);
      const options = Array.isArray(q.options) ? q.options : [];
      if (options.length) {
        return `
          <div class="sprint-q">
            <div class="sprint-q-title">Q${idx + 1}. ${escapeHtml(q.question || "")}</div>
            <div class="sprint-options">
              ${options.map((opt) => `
                <button class="sprint-option" data-question-id="${escapeHtml(qid)}" data-value="${escapeHtml(opt)}" type="button">${escapeHtml(opt)}</button>
              `).join("")}
            </div>
          </div>
        `;
      }
      return `
        <div class="sprint-q">
          <div class="sprint-q-title">Q${idx + 1}. ${escapeHtml(q.question || "")}</div>
          <textarea class="input sprint-answer-input" data-question-id="${escapeHtml(qid)}" rows="2" placeholder="Type your answer..."></textarea>
        </div>
      `;
    }).join("");
  }

  function renderHistory() {
    const wrap = document.getElementById("sprintHistoryList");
    if (!wrap) return;
    const rows = Array.isArray(runtime.state.sprintHistory) ? runtime.state.sprintHistory : [];
    if (!rows.length) {
      wrap.innerHTML = `<div style="font-size:13px;color:var(--text3);">No sprint attempts yet.</div>`;
      return;
    }
    wrap.innerHTML = rows.slice(0, 8).map((r) => `
      <div style="border:1px solid var(--border);background:var(--surface2);border-radius:10px;padding:10px;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
          <strong style="font-size:13px;color:var(--text);">${escapeHtml(r.topic || "Topic")}</strong>
          <span style="font-size:12px;color:${Number(r.score || 0) >= 70 ? "var(--success)" : "var(--warn)"};">${Number(r.score || 0)}%</span>
        </div>
        <div style="margin-top:6px;font-size:12px;color:var(--text3);">Difficulty: ${escapeHtml(r.difficulty || "medium")} · ${Number(r.correct || 0)}/${Number(r.total || 0)} correct</div>
      </div>
    `).join("");
  }

  async function startSprintChallenge() {
    const topic = String(document.getElementById("sprintTopicSelect")?.value || "").trim();
    const difficulty = String(document.getElementById("sprintDifficulty")?.value || "medium");
    const count = Math.max(3, Math.min(10, Number(document.getElementById("sprintCount")?.value || 5)));
    const resultBox = document.getElementById("sprintResult");
    if (resultBox) {
      resultBox.style.display = "none";
      resultBox.innerHTML = "";
    }
    setStatus("Starting sprint...");
    try {
      const out = await apiPost(API.sprintStart, { topic, difficulty, count });
      currentSprint = out?.sprint || null;
      runtime.state.sprintCurrent = currentSprint;
      answers.clear();
      sprintStartedMs = Date.now();
      renderMetaRow();
      renderQuestions();
      setStatus("Sprint started. Answer all questions then submit.");
      const submitBtn = document.getElementById("sprintSubmitBtn");
      if (submitBtn) submitBtn.disabled = false;
      scheduleSave();
      logAudit(`Sprint started (${topic || "auto-topic"}, ${difficulty}, ${count}Q).`);
    } catch (error) {
      currentSprint = null;
      setStatus(error.message || "Failed to start sprint.");
    }
  }

  async function submitSprintChallenge() {
    if (!currentSprint?.sprintId) return;
    setStatus("Submitting sprint...");
    const payloadAnswers = (currentSprint.questions || []).map((q) => ({
      questionId: q.id,
      answer: answers.get(String(q.id)) || ""
    }));
    const elapsedSec = sprintStartedMs ? Math.max(0, Math.round((Date.now() - sprintStartedMs) / 1000)) : 0;
    try {
      const out = await apiPost(API.sprintSubmit, {
        sprintId: currentSprint.sprintId,
        answers: payloadAnswers,
        elapsedSec
      });
      const result = out?.result || {};
      runtime.state.sprintHistory = Array.isArray(runtime.state.sprintHistory) ? runtime.state.sprintHistory : [];
      runtime.state.sprintHistory.unshift({
        sprintId: result.sprintId,
        topic: result.topic,
        difficulty: result.difficulty,
        total: result.total,
        correct: result.correct,
        score: result.score,
        elapsedSec: result.elapsedSec,
        createdAt: new Date().toISOString(),
        mistakeBreakdown: result.breakdown || {}
      });
      runtime.state.sprintHistory = runtime.state.sprintHistory.slice(0, 80);
      runtime.state.sprintCurrent = null;
      renderHistory();
      renderResult(result);
      currentSprint = null;
      sprintStartedMs = 0;
      const attemptWrap = document.getElementById("sprintAttemptWrap");
      if (attemptWrap) attemptWrap.style.display = "none";
      const submitBtn = document.getElementById("sprintSubmitBtn");
      if (submitBtn) submitBtn.disabled = true;
      setStatus(`Sprint completed: ${Number(result.score || 0)}%`);
      scheduleSave();
      logAudit(`Sprint submitted (${result.topic || "topic"}, ${Number(result.score || 0)}%).`);
    } catch (error) {
      setStatus(error.message || "Failed to submit sprint.");
    }
  }

  function renderResult(result) {
    const box = document.getElementById("sprintResult");
    if (!box) return;
    const breakdown = result.breakdown || {};
    const actions = Array.isArray(result.coaching?.nextActions) ? result.coaching.nextActions : [];
    box.style.display = "";
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <strong style="font-size:15px;color:var(--text);">Result: ${Number(result.score || 0)}%</strong>
        <span class="sprint-pill">Streak: ${Number(result.streakDays || 0)} day(s)</span>
      </div>
      <div style="margin-top:6px;">${Number(result.correct || 0)} / ${Number(result.total || 0)} correct in ${Number(result.elapsedSec || 0)}s</div>
      <div style="margin-top:8px;"><strong>Mistake profile:</strong> Concept gap ${Number(breakdown.concept_gap || 0)}, careless ${Number(breakdown.careless || 0)}, time pressure ${Number(breakdown.time_pressure || 0)}, misread ${Number(breakdown.misread_question || 0)}</div>
      <div style="margin-top:8px;"><strong>AI coach:</strong> ${escapeHtml(result.coaching?.summary || "No coach summary returned.")}</div>
      <ol style="margin:8px 0 0 18px;">${actions.map((a) => `<li>${escapeHtml(a)}</li>`).join("") || "<li>Retry sprint with same topic tomorrow.</li>"}</ol>
      <div style="margin-top:8px;font-size:11px;color:var(--text3);">AI-generated coaching may be imperfect. Validate with your instructor materials.</div>
    `;
  }

  function bindInteractions() {
    document.getElementById("sprintStartBtn")?.addEventListener("click", startSprintChallenge);
    document.getElementById("sprintSubmitBtn")?.addEventListener("click", submitSprintChallenge);
    document.getElementById("sprintQuestions")?.addEventListener("click", (event) => {
      const btn = event.target?.closest?.(".sprint-option");
      if (!btn) return;
      const questionId = String(btn.getAttribute("data-question-id") || "");
      const value = String(btn.getAttribute("data-value") || "");
      if (!questionId) return;
      chooseOption(questionId, value);
    });
    document.getElementById("sprintQuestions")?.addEventListener("input", (event) => {
      const input = event.target?.closest?.(".sprint-answer-input");
      if (!input) return;
      const questionId = String(input.getAttribute("data-question-id") || "");
      if (!questionId) return;
      onInputAnswer(questionId, input.value);
    });
  }

  function initSprintFeature() {
    if (initialized) return;
    initialized = true;
    renderTopicSelect();
    renderHistory();
    bindInteractions();
    if (runtime.state.sprintCurrent?.sprintId) {
      currentSprint = runtime.state.sprintCurrent;
      sprintStartedMs = Date.parse(runtime.state.sprintCurrent.startedAt || "") || Date.now();
      renderMetaRow();
      renderQuestions();
      const submitBtn = document.getElementById("sprintSubmitBtn");
      if (submitBtn) submitBtn.disabled = false;
      setStatus("Recovered active sprint. Continue and submit when ready.");
    }
  }

  return {
    initSprintFeature,
    startSprintChallenge,
    submitSprintChallenge
  };
}
