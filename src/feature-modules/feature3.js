export function initFeature3(ctx) {
  const { runtime, apiPost, API, escapeHtml, timeNow, logAudit, scheduleSave } = ctx;

  function userInitials() {
    const email = String(runtime.authUser?.email || "").trim();
    if (!email) return "U";
    return email.slice(0, 2).toUpperCase();
  }

  async function tutorResponse(question, attempt = 0, feedback = "") {
    const prompt = `Student asked: ${question}. Explain clearly with short steps and one example.`;
    try {
      const out = await apiPost(API.explain, {
        paragraph: prompt,
        attempt,
        feedback,
        topicHint: "Tutor"
      });
      const html = `<div style="font-size:11px;color:var(--accent);margin-bottom:8px;font-weight:600;">Why this response: based on your active topic and recent weak areas.</div><strong>${escapeHtml(out.concept || "Concept")}</strong><br><br>${escapeHtml(out.context || "")}<br><br><strong>Example:</strong> ${escapeHtml(out.example || "")}<br><br><strong>Check:</strong> ${escapeHtml(out.check || "")}`;
      return { html, provider: out.provider || "openai-api", raw: out };
    } catch {
      return {
        html: "I can still help offline: break the concept into one rule, one example, and one test question. Then explain it in your own words.",
        provider: "fallback",
        raw: {}
      };
    }
  }

  function ensureHistory() {
    if (!Array.isArray(runtime.state.tutorMessages)) runtime.state.tutorMessages = [];
  }

  function saveMessage(msg) {
    ensureHistory();
    runtime.state.tutorMessages.push(msg);
    runtime.state.tutorMessages = runtime.state.tutorMessages.slice(-120);
    scheduleSave();
  }

  function addUserMsg(text, persist = true) {
    const container = document.getElementById("chatMessages");
    if (!container) return;
    const stamp = timeNow();
    const div = document.createElement("div");
    div.className = "msg user";
    div.innerHTML = `
      <div class="msg-avatar msg-user-avatar">${escapeHtml(userInitials())}</div>
      <div>
        <div class="msg-bubble">${escapeHtml(text)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px;text-align:right;padding-right:4px;">${stamp}</div>
      </div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    if (persist) saveMessage({ role: "user", text, ts: new Date().toISOString() });
  }

  function addAIMsg(html, provider = "openai", meta = {}, persist = true) {
    const container = document.getElementById("chatMessages");
    if (!container) return;
    const stamp = timeNow();
    const div = document.createElement("div");
    div.className = "msg ai";
    const showClarity = meta.showClarity !== false;
    div.innerHTML = `
      <div class="msg-avatar msg-ai-avatar">AI</div>
      <div>
        <div class="msg-bubble">${html}<div style="margin-top:8px;font-size:11px;color:var(--text3);">Provider: ${escapeHtml(provider)}</div></div>
        ${showClarity ? `<div class="msg-clarity">
          <button class="clarity-btn clarity-yes" onclick="sendClarityMsg(true)">Clear</button>
          <button class="clarity-btn clarity-no" onclick="sendClarityMsg(false)">Still confused</button>
        </div>` : ""}
        <div style="font-size:11px;color:var(--text3);margin-top:4px;padding-left:4px;">${stamp}</div>
      </div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    runtime.lastTutorMeta = {
      question: String(meta.question || "").trim(),
      attempt: Number(meta.attempt || 0),
      feedback: String(meta.feedback || "").trim()
    };
    if (persist) {
      saveMessage({ role: "ai", html, provider, ts: new Date().toISOString(), meta: { ...runtime.lastTutorMeta, showClarity } });
    }
  }

  async function sendMessage() {
    const input = document.getElementById("chatInput");
    const msg = (input?.value || "").trim();
    if (!msg) return;
    addUserMsg(msg, true);
    input.value = "";

    const response = await tutorResponse(msg, 0, "");
    addAIMsg(response.html, response.provider, { question: msg, attempt: 0, feedback: "" }, true);
    logAudit("Tutor response generated.");
  }

  function quickAsk(q) {
    const input = document.getElementById("chatInput");
    if (!input) return;
    input.value = q;
    sendMessage();
  }

  async function sendClarityMsg(clear) {
    const current = runtime.lastTutorMeta || {};
    if (!current.question) {
      addAIMsg("Ask a question first so I can track the clarification loop.", "system", { showClarity: false }, true);
      return;
    }

    if (clear) {
      addUserMsg("Clear.", true);
      addAIMsg("Great. I marked this concept as understood and will increase depth gradually.", "system", { question: current.question, attempt: current.attempt || 0, feedback: "clear", showClarity: false }, true);
      logAudit("Tutor explanation marked clear.");
      return;
    }

    const nextAttempt = Number(current.attempt || 0) + 1;
    addUserMsg("Still confused, simplify.", true);
    const response = await tutorResponse(current.question, nextAttempt, "not clear");
    addAIMsg(response.html, response.provider, { question: current.question, attempt: nextAttempt, feedback: "not clear" }, true);
    logAudit(`Tutor simplification requested (attempt ${nextAttempt}).`);
  }

  function renderHistory() {
    ensureHistory();
    const container = document.getElementById("chatMessages");
    if (!container) return;
    container.innerHTML = "";

    if (!runtime.state.tutorMessages.length) {
      addAIMsg("Hi. I am your SpeedUp tutor. Ask any concept and I will explain with examples, then simplify if needed.", "system", { showClarity: false }, true);
      return;
    }

    runtime.state.tutorMessages.forEach((m) => {
      if (m.role === "user") {
        addUserMsg(m.text || "", false);
      } else {
        addAIMsg(m.html || m.text || "", m.provider || "system", m.meta || {}, false);
      }
    });
  }

  function clearTutorHistory() {
    runtime.state.tutorMessages = [];
    runtime.lastTutorMeta = null;
    scheduleSave();
    renderHistory();
    logAudit("Tutor history cleared.");
  }

  function handleChatKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function initTutor() {
    renderHistory();
  }

  return {
    tutorResponse,
    addUserMsg,
    addAIMsg,
    sendMessage,
    quickAsk,
    sendClarityMsg,
    handleChatKey,
    clearTutorHistory,
    initTutor
  };
}
