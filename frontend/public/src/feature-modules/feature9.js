export function initFeature9() {
  let bound = false;

  function bindBridge() {
    if (bound) return;
    bound = true;

    window.addEventListener("message", (event) => {
      if (event?.origin && event.origin !== window.location.origin) return;
      const payload = event?.data || {};
      if (payload?.type === "studyhub:open-practice-legacy") {
        window.openPracticeLegacyFromStudyHub?.();
      }
    });
  }

  function mountStudyHubPage() {
    bindBridge();
    const root = document.getElementById("studyHubRoot");
    if (!root) return;

    root.innerHTML = `
      <div class="card" style="padding:0;overflow:hidden;min-height:70vh;">
        <iframe
          title="Study Hub React"
          src="./study-hub-react/index.html"
          style="width:100%;height:75vh;border:0;background:#090A10;"
        ></iframe>
      </div>
    `;
  }

  return {
    mountStudyHubPage
  };
}
