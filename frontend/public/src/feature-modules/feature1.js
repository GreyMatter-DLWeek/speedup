export function initFeature1(ctx) {
  const { runtime, apiPost, API, escapeHtml, logAudit, scheduleSave } = ctx;

  async function getExplanation(paragraph, attempt, feedback) {
    try {
      return await apiPost(API.explain, {
        paragraph,
        attempt,
        feedback,
        topicHint: "Dynamic Programming"
      });
    } catch {
      return {
        concept: paragraph.split(".")[0] + ".",
        context: "Break the idea into one simple rule and apply it to a small example first.",
        example: "Solve one sample by hand, then explain each step aloud.",
        check: "Can you restate this in one line without notes?",
        provider: "fallback"
      };
    }
  }

  async function explainPara(id) {
    const wrap = document.getElementById(`para-${id}`);
    if (!wrap) return;

    runtime.currentParagraphId = id;
    runtime.currentAttempt = 0;

    const checkbox = wrap.querySelector(".para-checkbox");
    const aiBox = document.getElementById(`ai-box-${id}`);
    const paraText = wrap.querySelector(".para-text");
    if (!aiBox || !paraText) return;

    checkbox?.classList.add("checked");
    checkbox.textContent = "✓";
    aiBox.classList.add("visible");
    aiBox.innerHTML = `<div class="para-ai-header">AI is generating explanation...</div>`;

    const explanation = await getExplanation(paraText.textContent, 0, "");
    aiBox.innerHTML = `
      <div class="para-ai-header">AI Explanation · ${escapeHtml(explanation.provider || "unknown")}</div>
      <div>${escapeHtml(explanation.context || "")}</div>
      <div style="margin-top:8px;color:var(--text);"><strong>Example:</strong> ${escapeHtml(explanation.example || "")}</div>
      <div style="margin-top:8px;color:var(--text3);"><strong>Check:</strong> ${escapeHtml(explanation.check || "")}</div>
      <div class="msg-clarity">
        <button class="clarity-btn clarity-yes" onclick="markClear(${id}, true)">✓ Clear!</button>
        <button class="clarity-btn clarity-no" onclick="markClear(${id}, false)">✗ Still confused</button>
      </div>
    `;

    if (!runtime.state.notes[id]) runtime.state.notes[id] = { text: paraText.textContent.trim(), status: "reviewed", attempt: 0 };
    runtime.state.notes[id].status = "reviewed";
    runtime.state.notes[id].attempt = 0;
    logAudit(`Paragraph ${id} explained (${explanation.provider || "unknown"}).`);
    scheduleSave();
  }

  async function markClear(id, clear) {
    const aiBox = document.getElementById(`ai-box-${id}`);
    if (!aiBox || !runtime.state.notes[id]) return;

    if (clear) {
      runtime.state.notes[id].status = "clear";
      aiBox.insertAdjacentHTML("beforeend", `<div style="margin-top:10px;color:var(--accent);font-size:12px;">Marked clear. Mastery signal updated.</div>`);
      logAudit(`Paragraph ${id} marked clear.`);
      scheduleSave();
      return;
    }

    runtime.state.notes[id].status = "not_clear";
    runtime.state.notes[id].attempt = (runtime.state.notes[id].attempt || 0) + 1;
    runtime.currentAttempt = runtime.state.notes[id].attempt;
    const paragraph = runtime.state.notes[id].text;
    const explanation = await getExplanation(paragraph, runtime.currentAttempt, "not clear");

    aiBox.innerHTML = `
      <div class="para-ai-header">Simplified Explanation · Attempt ${runtime.currentAttempt + 1}</div>
      <div>${escapeHtml(explanation.context || explanation.concept || "")}</div>
      <div style="margin-top:8px;"><strong>Example:</strong> ${escapeHtml(explanation.example || "")}</div>
      <div class="msg-clarity" style="margin-top:10px;">
        <button class="clarity-btn clarity-yes" onclick="markClear(${id}, true)">✓ Got it now!</button>
        <button class="clarity-btn clarity-no" onclick="markClear(${id}, false)">✗ Simplify again</button>
      </div>
    `;

    logAudit(`Paragraph ${id} requested simplification attempt ${runtime.currentAttempt + 1}.`);
    scheduleSave();
  }

  return { explainPara, markClear, getExplanation };
}
