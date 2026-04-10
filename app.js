const map = L.map("map", {
  zoomAnimation: false,
  fadeAnimation: false,
  markerZoomAnimation: false
}).setView([37.4, -4.5], 7);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; OpenStreetMap-Mitwirkende &copy; CARTO',
  subdomains: "abcd",
  maxZoom: 20
}).addTo(map);

const periods = [
  "1951-1980",
  "1981-2014",
  "2015-2040",
  "2041-2070",
  "2071-2100"
];

const periodSlider = document.getElementById("periodSlider");
const periodLabel = document.getElementById("periodLabel");
const scenarioSelect = document.getElementById("scenarioSelect");
const toggleOlivesBtn = document.getElementById("toggleOlivesBtn");
const chartCanvas = document.getElementById("chartCanvas");
const chartTitle = document.getElementById("chartTitle");
const chartStatus = document.getElementById("chartStatus");

let currentOverlay = null;
let currentGeoraster = null;
let activeRequestId = 0;

let olivesVisible = false;
let oliveOverlay = null;
let oliveRasterPromise = null;

let scoreChart = null;

const hoverTooltip = L.tooltip({
  permanent: false,
  direction: "top",
  offset: [0, -8],
  opacity: 0.95
});

function getCurrentPeriod() {
  return periods[Number(periodSlider.value)];
}

function isHistoricalPeriod(period) {
  return period === "1951-1980" || period === "1981-2014";
}

function getRasterUrl() {
  const period = getCurrentPeriod();
  const scenario = scenarioSelect.value;

  if (isHistoricalPeriod(period)) {
    return layersConfig.scoreRasters.historical[period] || null;
  }

  return layersConfig.scoreRasters.future[scenario]?.[period] || null;
}

function getChartCsvUrl() {
  const period = getCurrentPeriod();
  const scenario = scenarioSelect.value;

  if (isHistoricalPeriod(period)) {
    return layersConfig.chartCSVs.historical[period] || null;
  }

  return layersConfig.chartCSVs.future[scenario]?.[period] || null;
}

function scoreToColor(score) {
  const colors = {
    0: "#8b0000",
    1: "#b22222",
    2: "#d95f0e",
    3: "#f16913",
    4: "#fdae6b",
    5: "#fee08b",
    6: "#d9ef8b",
    7: "#a6d96a",
    8: "#66bd63",
    9: "#1a9850",
    10: "#006837"
  };
  return colors[score] ?? null;
}

function hexToRgb(hex) {
  if (!hex) return null;
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function removeOldOverlay() {
  if (currentOverlay) {
    map.removeLayer(currentOverlay);
    currentOverlay = null;
  }
  currentGeoraster = null;
  map.closeTooltip(hoverTooltip);
}

function rasterToDataUrl(georaster) {
  const width = georaster.width;
  const height = georaster.height;
  const band = georaster.values[0];
  const noDataValue = georaster.noDataValue;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  let p = 0;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const value = band[row][col];

      if (
        value === null ||
        value === undefined ||
        isNaN(value) ||
        value === noDataValue
      ) {
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 0;
      } else {
        const score = Math.round(value);
        const color = hexToRgb(scoreToColor(score));

        if (!color) {
          data[p] = 0;
          data[p + 1] = 0;
          data[p + 2] = 0;
          data[p + 3] = 0;
        } else {
          data[p] = color.r;
          data[p + 1] = color.g;
          data[p + 2] = color.b;
          data[p + 3] = 255;
        }
      }

      p += 4;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function oliveRasterToDataUrl(georaster) {
  const width = georaster.width;
  const height = georaster.height;
  const band = georaster.values[0];
  const noDataValue = georaster.noDataValue;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  let p = 0;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const value = band[row][col];

      const isNoData =
        value === null ||
        value === undefined ||
        isNaN(value) ||
        value === noDataValue;

      const hasOlives = !isNoData && Number(value) > 0;

      if (!hasOlives) {
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 0;
      } else {
        data[p] = 36;
        data[p + 1] = 110;
        data[p + 2] = 54;
        data[p + 3] = 150;
      }

      p += 4;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function getRasterValueAtLatLng(latlng) {
  if (!currentGeoraster) return null;

  const { xmin, xmax, ymin, ymax, width, height, values, noDataValue } = currentGeoraster;
  const band = values[0];

  if (
    latlng.lng < xmin ||
    latlng.lng > xmax ||
    latlng.lat < ymin ||
    latlng.lat > ymax
  ) {
    return null;
  }

  const xRatio = (latlng.lng - xmin) / (xmax - xmin);
  const yRatio = (ymax - latlng.lat) / (ymax - ymin);

  let col = Math.floor(xRatio * width);
  let row = Math.floor(yRatio * height);

  col = Math.max(0, Math.min(width - 1, col));
  row = Math.max(0, Math.min(height - 1, row));

  const value = band[row][col];

  if (
    value === null ||
    value === undefined ||
    isNaN(value) ||
    value === noDataValue
  ) {
    return null;
  }

  return Math.round(value);
}

async function loadRaster(url, requestId) {
  try {
    removeOldOverlay();

    if (!url) {
      console.warn("Kein Raster für diese Auswahl gefunden.");
      return;
    }

    console.log("Lade Raster:", url, "requestId:", requestId);

    const fetchUrl = `${url}?v=${requestId}`;
    const response = await fetch(fetchUrl, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Datei konnte nicht geladen werden: ${fetchUrl} (${response.status})`);
    }

    const arrayBuffer = await response.arrayBuffer();

    if (requestId !== activeRequestId) {
      console.log("Veralteter Request verworfen:", requestId);
      return;
    }

    const georaster = await parseGeoraster(arrayBuffer);

    if (requestId !== activeRequestId) {
      console.log("Veralteter Request nach parse verworfen:", requestId);
      return;
    }

    const imageUrl = rasterToDataUrl(georaster);

    const bounds = [
      [georaster.ymin, georaster.xmin],
      [georaster.ymax, georaster.xmax]
    ];

    const overlay = L.imageOverlay(imageUrl, bounds, {
      opacity: 0.55,
      interactive: false,
      className: "pixelated-overlay"
    });

    if (requestId !== activeRequestId) {
      console.log("Veraltetes Overlay verworfen:", requestId);
      return;
    }

    currentGeoraster = georaster;
    currentOverlay = overlay;
    currentOverlay.addTo(map);

    if (olivesVisible) {
      await ensureOliveOverlay();
    }

  } catch (error) {
    console.error("Fehler beim Laden des Rasters:", error);
  }
}

async function fetchOliveGeoraster() {
  if (!oliveRasterPromise) {
    oliveRasterPromise = (async () => {
      const response = await fetch(`${layersConfig.oliveRaster}?v=1`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Olivenraster konnte nicht geladen werden: ${layersConfig.oliveRaster} (${response.status})`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return parseGeoraster(arrayBuffer);
    })();
  }
  return oliveRasterPromise;
}

async function ensureOliveOverlay() {
  if (oliveOverlay) {
    if (!map.hasLayer(oliveOverlay)) {
      oliveOverlay.addTo(map);
    }
    return;
  }

  try {
    const georaster = await fetchOliveGeoraster();
    const imageUrl = oliveRasterToDataUrl(georaster);

    const bounds = [
      [georaster.ymin, georaster.xmin],
      [georaster.ymax, georaster.xmax]
    ];

    oliveOverlay = L.imageOverlay(imageUrl, bounds, {
      opacity: 0.75,
      interactive: false,
      className: "pixelated-overlay olives-overlay"
    });

    if (olivesVisible) {
      oliveOverlay.addTo(map);
    }
  } catch (error) {
    console.error("Fehler beim Laden des Olivenrasters:", error);
  }
}

function setOliveButtonState() {
  toggleOlivesBtn.classList.toggle("active", olivesVisible);
  toggleOlivesBtn.textContent = olivesVisible ? "Olivenflächen: an" : "Olivenflächen: aus";
}

async function toggleOliveOverlay() {
  olivesVisible = !olivesVisible;
  setOliveButtonState();

  if (olivesVisible) {
    await ensureOliveOverlay();
  } else if (oliveOverlay && map.hasLayer(oliveOverlay)) {
    map.removeLayer(oliveOverlay);
  }
}

function detectDelimiter(line) {
  return line.includes(";") ? ";" : ",";
}

function parseNumber(value) {
  if (value === null || value === undefined) return NaN;
  const cleaned = String(value).trim().replace("%", "").replace(",", ".");
  return Number(cleaned);
}

function normalizeCsvRows(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (!lines.length) return [];

  const delimiter = detectDelimiter(lines[0]);
  const rows = lines.map(line => line.split(delimiter).map(cell => cell.trim()));

  const firstRow = rows[0];
  const hasHeader = firstRow.some(cell => /[a-zA-ZäöüÄÖÜ]/.test(cell));

  if (!hasHeader) {
    return rows.map(cols => ({
      value: parseNumber(cols[0]),
      pixelCount: parseNumber(cols[1]),
      percent: parseNumber(cols[2] ?? cols[1])
    }));
  }

  const headers = firstRow.map(h => h.toLowerCase());

  const valueIndex = headers.findIndex(h =>
    h.includes("score_value") ||
    h.includes("score") ||
    h.includes("klasse") ||
    h.includes("class") ||
    h.includes("value") ||
    h.includes("skala")
  );

  const pixelCountIndex = headers.findIndex(h =>
    h.includes("pixel_count") ||
    h.includes("pixelcount") ||
    h.includes("count") ||
    h.includes("pixels")
  );

  const percentIndex = headers.findIndex(h =>
    h.includes("share_percent") ||
    h.includes("percent") ||
    h.includes("percentage") ||
    h.includes("prozent") ||
    h.includes("anteil") ||
    h.includes("share") ||
    h.includes("%")
  );

  return rows.slice(1).map(cols => ({
    value: parseNumber(cols[valueIndex >= 0 ? valueIndex : 0]),
    pixelCount: parseNumber(cols[pixelCountIndex >= 0 ? pixelCountIndex : 1]),
    percent: parseNumber(cols[percentIndex >= 0 ? percentIndex : 2])
  }));
}

function toChartArray(rows) {
  const arr = Array.from({ length: 11 }, () => 0);

  rows.forEach(row => {
    const score = Math.round(row.value);
    const percent = row.percent;

    if (
      Number.isFinite(score) &&
      Number.isFinite(percent) &&
      score >= 0 &&
      score <= 10
    ) {
      arr[score] = percent;
    }
  });

  return arr;
}

function calculateWeightedStats(rows) {
  const validRows = rows
    .map(row => ({
      value: Number(row.value),
      weight: Number(row.pixelCount)
    }))
    .filter(row =>
      Number.isFinite(row.value) &&
      Number.isFinite(row.weight) &&
      row.weight > 0
    )
    .sort((a, b) => a.value - b.value);

  if (!validRows.length) {
    return {
      mean: null,
      median: null
    };
  }

  const totalWeight = validRows.reduce((sum, row) => sum + row.weight, 0);

  const weightedSum = validRows.reduce((sum, row) => {
    return sum + row.value * row.weight;
  }, 0);

  const mean = weightedSum / totalWeight;

  let cumulativeWeight = 0;
  let median = validRows[validRows.length - 1].value;

  for (const row of validRows) {
    cumulativeWeight += row.weight;
    if (cumulativeWeight >= totalWeight / 2) {
      median = row.value;
      break;
    }
  }

  return { mean, median };
}

function destroyChart() {
  if (scoreChart) {
    scoreChart.destroy();
    scoreChart = null;
  }
}

function renderChart(percentages, stats, period, scenario) {
  destroyChart();

  const labels = Array.from({ length: 11 }, (_, i) => String(i));
  const barColors = labels.map(label => scoreToColor(Number(label)));

  scoreChart = new Chart(chartCanvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Olivenflächen [%]",
        data: percentages,
        backgroundColor: barColors,
        borderColor: barColors,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const value = context.raw ?? 0;
              return `${context.label}: ${Number(value).toFixed(1)} %`;
            }
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Olivenanbau-Score"
          },
          grid: {
            display: false
          }
        },
        y: {
          beginAtZero: true,
          max: 60,
          title: {
            display: true,
            text: "Olivenflächen [%]"
          },
          ticks: {
            callback: function(value) {
              return value + " %";
            }
          }
        }
      }
    }
  });

  const scenarioText = isHistoricalPeriod(period) ? "" : `, ${scenario.toUpperCase()}`;
  const statsText = [
    Number.isFinite(stats.mean) ? `Mittelwert = ${stats.mean.toFixed(1)}` : null,
    Number.isFinite(stats.median) ? `Median = ${stats.median.toFixed(1)}` : null
  ].filter(Boolean).join(" | ");

  chartTitle.textContent = `Klimatische Anbaueignung (${period}${scenarioText}) der Olivenflächen (Stand 2000)`;
  chartStatus.textContent = statsText;
}

async function updateChart() {
  const period = getCurrentPeriod();
  const scenario = scenarioSelect.value;
  const csvUrl = getChartCsvUrl();

  chartTitle.textContent = "Verteilung der Olivenflächen";
  chartStatus.textContent = "Lade Diagramm ...";

  destroyChart();

  if (!csvUrl) {
    chartStatus.textContent = "Keine CSV gefunden.";
    return;
  }

  try {
    const response = await fetch(`${csvUrl}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`CSV konnte nicht geladen werden: ${csvUrl} (${response.status})`);
    }

    const text = await response.text();
    const rows = normalizeCsvRows(text);
    const percentages = toChartArray(rows);
    const stats = calculateWeightedStats(rows);

    renderChart(percentages, stats, period, scenario);
  } catch (error) {
    console.error("Fehler beim Laden des Diagramms:", error);
    chartStatus.textContent = "Diagramm konnte nicht geladen werden.";
  }
}

async function updateMap() {
  const period = getCurrentPeriod();
  periodLabel.textContent = period;

  const historical = isHistoricalPeriod(period);
  scenarioSelect.disabled = historical;

  const url = getRasterUrl();

  activeRequestId += 1;
  const requestId = activeRequestId;

  console.log("Aktuelle Auswahl:");
  console.log("Periode:", period);
  console.log("Szenario:", scenarioSelect.value);
  console.log("URL:", url);
  console.log("Neue requestId:", requestId);

  await Promise.all([
    loadRaster(url, requestId),
    updateChart()
  ]);
}

map.on("mousemove", (e) => {
  const score = getRasterValueAtLatLng(e.latlng);

  if (score === null) {
    map.closeTooltip(hoverTooltip);
    return;
  }

  hoverTooltip
    .setLatLng(e.latlng)
    .setContent(`Anbau-Score: <b>${score}</b>`)
    .addTo(map);
});

map.on("mouseout", () => {
  map.closeTooltip(hoverTooltip);
});

periodSlider.addEventListener("input", updateMap);
scenarioSelect.addEventListener("change", updateMap);
toggleOlivesBtn.addEventListener("click", toggleOliveOverlay);

setOliveButtonState();
updateMap();
