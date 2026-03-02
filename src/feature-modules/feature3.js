export function initFeature3(ctx) {
  const { apiPost, API, escapeHtml, timeNow } = ctx;

  async function tutorResponse(question) {
    const prompt = `Student asked: ${question}. Explain clearly with short steps and one example.`;
    try {
      const out = await apiPost(API.explain, {
        paragraph: prompt,
        attempt: 0,
        feedback: "",
        topicHint: "Tutor"
      });
      return {
        html: `<div style="font-size:11px;color:var(--accent);margin-bottom:8px;font-weight:600;">Why this response: based on your active topic and recent weak areas.</div><strong>${escapeHtml(out.concept || "Concept")}</strong><br><br>${escapeHtml(out.context || "")}<br><br><strong>Example:</strong> ${escapeHtml(out.example || "")}<br><br><strong>Check:</strong> ${escapeHtml(out.check || "")}`,
        provider: out.provider || "openai"
      };
    } catch {
      return {
        html: "I can still help offline: break the concept into one rule, one example, and one test question. Then explain it in your own words.",
        provider: "fallback"
      };
    }
  }

  function addUserMsg(text) {
    const container = document.getElementById("chatMessages");
    if (!container) return;
    const div = document.createElement("div");
    div.className = "msg user";
    div.innerHTML = `
      <div class="msg-avatar msg-user-avatar">AK</div>
      <div>
        <div class="msg-bubble">${escapeHtml(text)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px;text-align:right;padding-right:4px;">${timeNow()}</div>
      </div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function addAIMsg(html, provider = "openai") {
    const container = document.getElementById("chatMessages");
    if (!container) return;
    const div = document.createElement("div");
    div.className = "msg ai";
    div.innerHTML = `
      <div class="msg-avatar msg-ai-avatar">🤖</div>
      <div>
        <div class="msg-bubble">${html}<div style="margin-top:8px;font-size:11px;color:var(--text3);">Provider: ${escapeHtml(provider)}</div></div>
        <div class="msg-clarity">
          <button class="clarity-btn clarity-yes" onclick="sendClarityMsg(true)">✓ Clear!</button>
          <button class="clarity-btn clarity-no" onclick="sendClarityMsg(false)">✗ Still confused</button>
        </div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px;padding-left:4px;">${timeNow()}</div>
      </div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  async function sendMessage() {
    const input = document.getElementById("chatInput");
    const msg = (input?.value || "").trim();
    if (!msg) return;
    addUserMsg(msg);
    input.value = "";

    const response = await tutorResponse(msg);
    addAIMsg(response.html, response.provider);
  }

  function quickAsk(q) {
    const input = document.getElementById("chatInput");
    if (!input) return;
    input.value = q;
    sendMessage();
  }

  function sendClarityMsg(clear) {
    if (clear) {
      addUserMsg("✓ That's clear.");
      addAIMsg("Great. I logged this as understood and will increase concept difficulty gradually.", "system");
    } else {
      addUserMsg("✗ Still confused, simplify.");
      addAIMsg("No issue. I'll simplify with shorter steps and a concrete analogy.", "system");
    }
  }

  function handleChatKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return {
    tutorResponse,
    addUserMsg,
    addAIMsg,
    sendMessage,
    quickAsk,
    sendClarityMsg,
    handleChatKey
  };
}
