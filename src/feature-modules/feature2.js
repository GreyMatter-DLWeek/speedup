export function initFeature2(ctx) {
  const { runtime, apiPost, API, escapeHtml, logAudit, scheduleSave } = ctx;

  async function analyzeHighlight(text, topic) {
    try {
      return await apiPost(API.highlightAnalyze, { text, topic });
    } catch {
      return {
        summary: text.split(/\s+/).slice(0, 18).join(" ") + "...",
        context: "Review this with one worked example and one timed question.",
        followUpQuestion: "Where does this fail if assumptions change?",
        provider: "fallback"
      };
    }
  }

  async function saveHighlightFromSelection(selectedText) {
    const analysis = await analyzeHighlight(selectedText, "Algorithms");
    const item = {
      text: selectedText,
      topic: "Algorithms",
      summary: analysis.summary,
      context: analysis.context,
      followUpQuestion: analysis.followUpQuestion,
      provider: analysis.provider || "fallback",
      date: new Date().toISOString().slice(0, 10)
    };
    runtime.state.highlights.unshift(item);
    logAudit(`Highlight saved (${item.provider}).`);
    scheduleSave();
    renderHighlights();
  }

  function toggleHighlightMode() {
    runtime.highlightMode = !runtime.highlightMode;
    const btn = document.getElementById("tb-highlight");
    if (!btn) return;
    btn.classList.toggle("active", runtime.highlightMode);
    btn.textContent = runtime.highlightMode ? "🖊 Highlight ON" : "🖊 Highlight";
  }

  function bindNotesSelectionCapture() {
    const notesBody = document.getElementById("notesBody");
    if (!notesBody) return;

    notesBody.addEventListener("mouseup", async () => {
      if (!runtime.highlightMode) return;
      const selected = (window.getSelection()?.toString() || "").trim();
      if (!selected || selected.length < 10) return;
      await saveHighlightFromSelection(selected);
      window.getSelection()?.removeAllRanges();
    });
  }

  function renderHighlights() {
    const wrap = document.getElementById("dynamicHighlights");
    if (!wrap) return;

    wrap.innerHTML = "";
    runtime.state.highlights.slice(0, 8).forEach((h) => {
      const item = document.createElement("div");
      item.className = "highlight-item";
      item.innerHTML = `
        <div class="highlight-color" style="background:var(--accent)"></div>
        <div class="highlight-body">
          <div class="highlight-text">${escapeHtml(h.text)}</div>
          <div class="highlight-context">${escapeHtml(h.topic)} · ${h.date} · ${escapeHtml(h.provider)}</div>
          <div class="highlight-tags">
            <span class="chip chip-green" style="font-size:11px;">Summary</span>
            <span class="chip chip-purple" style="font-size:11px;">Context</span>
          </div>
          <div class="para-ai-box visible" style="margin-top:10px;">
            <div class="para-ai-header">Auto Context</div>
            <div style="font-size:12px;color:var(--text2);line-height:1.7;">${escapeHtml(h.summary)}<br><br>${escapeHtml(h.context)}</div>
          </div>
        </div>
      `;
      wrap.appendChild(item);
    });
  }

  function renderFlashcard() {
    const q = document.getElementById("flashcard-q");
    if (!q) return;
    if (!runtime.flashcards.length) {
      q.textContent = "No flashcards yet. Add notes to generate cards.";
      return;
    }
    const item = runtime.flashcards[runtime.cardIndex];
    q.textContent = runtime.flipped ? item.a : item.q;
  }

  function flipCard() {
    runtime.flipped = !runtime.flipped;
    const btn = document.querySelector("#page-highlights .btn-secondary");
    renderFlashcard();
    if (btn) btn.textContent = runtime.flipped ? "🔄 Back to Question" : "🔄 Reveal Answer";
  }

  function nextCard() {
    if (!runtime.flashcards.length) return;
    runtime.cardIndex = (runtime.cardIndex + 1) % runtime.flashcards.length;
    runtime.flipped = false;
    renderFlashcard();
    const btn = document.querySelector("#page-highlights .btn-secondary");
    if (btn) btn.textContent = "🔄 Reveal Answer";
  }

  return {
    toggleHighlightMode,
    bindNotesSelectionCapture,
    saveHighlightFromSelection,
    analyzeHighlight,
    renderHighlights,
    renderFlashcard,
    flipCard,
    nextCard
  };
}
