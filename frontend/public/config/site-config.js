(function bootstrapSiteConfig() {
  var host = String(window.location.hostname || "").toLowerCase();
  var isLocalHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.endsWith(".local");

  // Use remote API only outside local/dev environments.
  var configuredApiBase = isLocalHost ? "" : "https://speedup-api.onrender.com";
  var path = String(window.location.pathname || "/");
  var segments = path.split("/").filter(Boolean);
  var repoBase = "";

  // GitHub Pages project site: /<repo-name>/...
  if (window.location.hostname.endsWith("github.io") && segments.length > 0) {
    repoBase = "/" + segments[0];
  }

  function normalizePath(p) {
    var v = String(p || "");
    if (!v.startsWith("/")) v = "/" + v;
    return v;
  }

  var apiFromStorage = "";
  if (!isLocalHost) {
    try {
      apiFromStorage = window.localStorage.getItem("speedup_api_base") || "";
    } catch {
      apiFromStorage = "";
    }
  }

  window.SPEEDUP_SITE_BASE = window.SPEEDUP_SITE_BASE || repoBase;
  window.SPEEDUP_API_BASE = window.SPEEDUP_API_BASE || configuredApiBase || apiFromStorage || "";

  window.toAppPath = function toAppPath(p) {
    var rel = normalizePath(p);
    return (window.SPEEDUP_SITE_BASE || "") + rel;
  };

  window.toApiUrl = function toApiUrl(p) {
    var rel = normalizePath(p);
    var apiBase = String(window.SPEEDUP_API_BASE || "").replace(/\/+$/, "");
    if (!apiBase) return rel;
    return apiBase + rel;
  };
})();
