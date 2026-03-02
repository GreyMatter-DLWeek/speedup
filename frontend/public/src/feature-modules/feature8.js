export function initFeature8(ctx) {
  const { modals } = ctx;

  function toggleFeedback(btn, type) {
    const parent = btn.parentElement;
    if (!parent) return;
    parent.querySelectorAll(".feedback-btn").forEach((b) => b.classList.remove("active-up", "active-down"));
    if (type === "up") btn.classList.add("active-up");
    else btn.classList.add("active-down");
  }

  function openModal(key) {
    const m = modals[key];
    if (!m) return;

    const overlay = document.getElementById("modal-overlay");
    const content = document.getElementById("modal-content");
    if (!overlay || !content) return;

    content.classList.remove("settings-modal");

    content.innerHTML = `
      <div class="modal-title">${m.title}</div>
      <div class="modal-sub">${m.body}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="closeModal()">${m.confirm}</button>
      </div>`;
    overlay.classList.add("open");
  }

  function closeModal(e) {
    if (!e || e.target === document.getElementById("modal-overlay")) {
      document.getElementById("modal-content")?.classList.remove("settings-modal");
      document.getElementById("modal-overlay")?.classList.remove("open");
    }
  }

  return { toggleFeedback, openModal, closeModal };
}
