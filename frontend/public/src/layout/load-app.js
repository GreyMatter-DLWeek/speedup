const pages = [
  "dashboard",
  "notes",
  "study-notes",
  "timetable",
  "practice",
  "progress",
  "recommendations",
  "responsible"
];

async function loadText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.text();
}

async function render() {
  const root = document.getElementById("app-root");
  if (!root) return;
  const auth = window.firebaseAuthClient;
  const toLogin = () => {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(`./login.html?next=${encodeURIComponent(next)}`);
  };
  if (!auth?.initFirebaseClient) {
    toLogin();
    return;
  }
  await auth.initFirebaseClient();
  await auth.waitForAuthReady();
  const user = await auth.getUser();
  if (!user) {
    toLogin();
    return;
  }

  const sidebarPromise = loadText("./src/layout/sidebar.html");
  const modalsPromise = loadText("./src/layout/modals.html");
  const pagesPromise = Promise.all(pages.map((name) => loadText(`./src/pages/${name}.html`)));

  const [sidebar, modals, pageHtml] = await Promise.all([sidebarPromise, modalsPromise, pagesPromise]);

  root.innerHTML = `
    <div class="app">
      <button id="mobileNavToggle" class="mobile-nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false">
        <span class="mobile-nav-toggle-bar"></span>
        <span class="mobile-nav-toggle-bar"></span>
        <span class="mobile-nav-toggle-bar"></span>
      </button>
      <div id="mobileNavOverlay" class="mobile-nav-overlay" aria-hidden="true"></div>
      ${sidebar}
      <main class="main">
        ${pageHtml.join("\n")}
      </main>
    </div>
    ${modals}
  `;

  const { bootstrapApp } = await import("../../app.js");
  bootstrapApp();
}

render().catch((error) => {
  const root = document.getElementById("app-root");
  if (root) {
    root.innerHTML = `<div style="padding:24px;color:#f87171;font-family:sans-serif;">Failed to load app layout: ${error.message}</div>`;
  }
  console.error(error);
});
