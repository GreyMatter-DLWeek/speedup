export function renderShell() {
  return `
    <div class="shell">
      <aside class="shell-sidebar">
        <h1>SpeedUp</h1>
        <p>Feature-based architecture</p>
        <nav id="feature-nav" class="feature-nav"></nav>
      </aside>
      <main class="shell-main">
        <header class="shell-header">
          <h2 id="page-title">Dashboard</h2>
          <span>Modular feature workspace</span>
        </header>
        <section id="feature-content" class="feature-content"></section>
      </main>
    </div>
  `;
}

export function wireNavigation(items, onChange) {
  const nav = document.getElementById("feature-nav");
  const title = document.getElementById("page-title");

  nav.innerHTML = items
    .map(
      (item, idx) =>
        `<button class="nav-btn ${idx === 0 ? "active" : ""}" data-id="${item.id}">${item.label}</button>`,
    )
    .join("");

  nav.addEventListener("click", (event) => {
    const btn = event.target.closest(".nav-btn");
    if (!btn) return;

    const id = btn.dataset.id;
    nav.querySelectorAll(".nav-btn").forEach((x) => x.classList.remove("active"));
    btn.classList.add("active");

    const entry = items.find((x) => x.id === id);
    title.textContent = entry ? entry.label : "Feature";
    onChange(id);
  });
}
