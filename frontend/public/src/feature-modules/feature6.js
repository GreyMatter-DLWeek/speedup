export function initFeature6() {
  function initWeeklyChart() {
    const chart = document.getElementById("weeklyChart");
    if (!chart) return;

    const data = [
      { day: "Mon", h: 1.8, col: "var(--accent)" },
      { day: "Tue", h: 2.4, col: "var(--accent2)" },
      { day: "Wed", h: 1.2, col: "var(--accent3)" },
      { day: "Thu", h: 2.0, col: "var(--accent4)" },
      { day: "Fri", h: 2.6, col: "var(--accent)" },
      { day: "Sat", h: 3.1, col: "var(--accent2)" },
      { day: "Sun", h: 1.7, col: "var(--accent3)" }
    ];

    const maxH = Math.max(...data.map((d) => d.h));
    chart.innerHTML = "";

    data.forEach((d) => {
      const wrap = document.createElement("div");
      wrap.className = "chart-bar-wrap";
      const h = Math.round((d.h / maxH) * 100);
      wrap.innerHTML = `<div class="chart-bar" style="height:${h}%;background:${d.col};opacity:${d.col === "var(--accent)" ? "0.9" : "0.5"};"></div><div class="chart-label">${d.day}</div>`;
      chart.appendChild(wrap);
    });
  }

  function initHeatmap() {
    const heatmap = document.getElementById("heatmap");
    if (!heatmap) return;

    heatmap.innerHTML = "";
    for (let i = 0; i < 16 * 7; i += 1) {
      const cell = document.createElement("div");
      const v = Math.random();
      cell.className = `heat-cell ${v > 0.82 ? "heat-4" : v > 0.65 ? "heat-3" : v > 0.45 ? "heat-2" : v > 0.22 ? "heat-1" : ""}`;
      heatmap.appendChild(cell);
    }
  }

  return { initWeeklyChart, initHeatmap };
}
