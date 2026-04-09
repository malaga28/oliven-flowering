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

let currentOverlay = null;
let currentGeoraster = null;
let activeRequestId = 0;

let olivesVisible = false;
let oliveOverlay = null;
let oliveRasterPromise = null;

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
    return layersConfig.floweringRasters.historical[period] || null;
  }

  return layersConfig.floweringRasters.future[scenario]?.[period] || null;
}

function floweringDoyToColor(doy) {
  if (doy === null || doy === undefined || isNaN(doy)) return null;

  if (doy < 90) return "#8b0000";
  if (doy < 100) return "#d73027";
  if (doy < 110) return "#f46d43";
  if (doy < 120) return "#fdae61";
  if (doy < 130) return "#fee08b";
  if (doy < 140) return "#d9ef8b";
  if (doy < 150) return "#a6d96a";
  if (doy < 160) return "#66bd63";
  return "#1a9850";
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
        const doy = Math.round(value);
        const color = hexToRgb(floweringDoyToColor(doy));

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
      opacity: 0.6,
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

  await loadRaster(url, requestId);
}

map.on("mousemove", (e) => {
  const doy = getRasterValueAtLatLng(e.latlng);

  if (doy === null) {
    map.closeTooltip(hoverTooltip);
    return;
  }

  hoverTooltip
    .setLatLng(e.latlng)
    .setContent(`Blühbeginn: <b>DOY ${doy}</b>`)
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
