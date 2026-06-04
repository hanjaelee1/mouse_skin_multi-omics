const DATA_URL = "../data/pd2_cells.json.gz";
const PANEL_GAP = 12;
const DEFAULT_WORKSPACE_HEIGHT = 1220;

const state = {
  rows: [],
  columns: {},
  markers: [],
  colors: {},
  order: [],
  markerRanges: {},
  visibleTypes: new Set(),
  colorMode: "cell_type",
  gene: "Mef2c",
  spatialRotation: 0,
  spatialView: {
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
  },
  workspaceHeight: DEFAULT_WORKSPACE_HEIGHT,
  spatialPointSize: 1.8,
  umapPointSize: 1.8,
  panels: {
    spatial: { x: 0, y: 0, w: 0, h: 0, z: 2 },
    umap: { x: 0, y: 0, w: 0, h: 0, z: 3 },
  },
  panelZ: 3,
  panelsInitialized: false,
  umapAutoPlaced: false,
  bounds: {},
  hoverCell: null,
};

const els = {
  datasetMeta: document.getElementById("datasetMeta"),
  colorMode: document.getElementById("colorMode"),
  geneInput: document.getElementById("geneInput"),
  geneList: document.getElementById("geneList"),
  rotateButtons: Array.from(document.querySelectorAll(".rotateButton")),
  pointButtons: Array.from(document.querySelectorAll(".pointButton")),
  rotationStatus: document.getElementById("rotationStatus"),
  zoomButtons: Array.from(document.querySelectorAll(".zoomButton")),
  fitSpatial: document.getElementById("fitSpatial"),
  zoomStatus: document.getElementById("zoomStatus"),
  workspaceHeight: document.getElementById("workspaceHeight"),
  viewerGrid: document.getElementById("viewerGrid"),
  spatialPointSize: document.getElementById("spatialPointSize"),
  spatialPointStatus: document.getElementById("spatialPointStatus"),
  umapPointSize: document.getElementById("umapPointSize"),
  umapPointStatus: document.getElementById("umapPointStatus"),
  resetPanels: document.getElementById("resetPanels"),
  spatialPanel: document.getElementById("spatialPanel"),
  umapPanel: document.getElementById("umapPanel"),
  spatialCanvas: document.getElementById("spatialCanvas"),
  umapCanvas: document.getElementById("umapCanvas"),
  spatialStatus: document.getElementById("spatialStatus"),
  umapStatus: document.getElementById("umapStatus"),
  legend: document.getElementById("legend"),
  hoverInfo: document.getElementById("hoverInfo"),
  showAll: document.getElementById("showAll"),
  hideAll: document.getElementById("hideAll"),
};

function col(name) {
  return state.columns[name];
}

function value(row, name) {
  return row[col(name)];
}

function numberValue(row, name) {
  const v = value(row, name);
  return Number.isFinite(v) ? v : Number(v);
}

function visibleRows() {
  return state.rows.filter((row) => state.visibleTypes.has(value(row, "cell_type")));
}

function computeBounds(rows, xName, yName) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const row of rows) {
    const x = numberValue(row, xName);
    const y = numberValue(row, yName);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function rotateUnitPoint(x, y, rotation) {
  if (rotation === 90) return { x: 1 - y, y: x };
  if (rotation === 180) return { x: 1 - x, y: 1 - y };
  if (rotation === 270) return { x: y, y: 1 - x };
  return { x, y };
}

function applyViewTransform(point, width, height, view) {
  if (!view) return point;
  const cx = width / 2;
  const cy = height / 2;
  return {
    x: cx + (point.x - cx) * view.zoom + view.panX,
    y: cy + (point.y - cy) * view.zoom + view.panY,
  };
}

function project(row, bounds, width, height, xName, yName, invertY = false, rotation = 0, view = null) {
  const pad = 18;
  const x = numberValue(row, xName);
  const y = numberValue(row, yName);
  const sx = (x - bounds.minX) / Math.max(bounds.maxX - bounds.minX, 1e-9);
  const sy = (y - bounds.minY) / Math.max(bounds.maxY - bounds.minY, 1e-9);
  const rotated = rotateUnitPoint(sx, sy, rotation);
  const point = {
    x: pad + rotated.x * (width - pad * 2),
    y: invertY
      ? height - pad - rotated.y * (height - pad * 2)
      : pad + rotated.y * (height - pad * 2),
  };
  return applyViewTransform(point, width, height, view);
}

function expressionColor(v, maxValue) {
  if (!Number.isFinite(v) || v <= 0) return "#d7dde6";
  const t = Math.max(0, Math.min(1, v / Math.max(maxValue, 0.001)));
  const stops = [
    [231, 238, 241],
    [99, 190, 181],
    [43, 111, 171],
    [244, 181, 65],
    [190, 54, 54],
  ];
  const scaled = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = stops[i];
  const b = stops[i + 1];
  const rgb = a.map((av, idx) => Math.round(av + (b[idx] - av) * f));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function pointColor(row) {
  if (state.colorMode === "gene") {
    const range = state.markerRanges[state.gene] || { p95: 1 };
    return expressionColor(numberValue(row, state.gene), range.p95 || range.max || 1);
  }
  return state.colors[value(row, "cell_type")] || "#747b85";
}

function plottedPointSize(view = null) {
  const base = view ? Number(state.spatialPointSize) : Number(state.umapPointSize);
  if (!view) return base;
  const zoomScale = 1 + (Math.max(1, view.zoom) - 1) * 1.5;
  return clampValue(base * zoomScale, base, 20);
}

function drawPlot(canvas, statusEl, xName, yName, bounds, invertY = false, rotation = 0, view = null) {
  const { ctx, width, height } = resizeCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, width, height);

  const rows = visibleRows();
  const pointSize = plottedPointSize(view);
  ctx.globalAlpha = state.colorMode === "gene" ? 0.92 : 0.82;

  for (const row of rows) {
    const p = project(row, bounds, width, height, xName, yName, invertY, rotation, view);
    ctx.fillStyle = pointColor(row);
    ctx.beginPath();
    ctx.arc(p.x, p.y, pointSize, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  if (state.hoverCell) {
    const p = project(state.hoverCell, bounds, width, height, xName, yName, invertY, rotation, view);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(5, pointSize + 3), 0, Math.PI * 2);
    ctx.stroke();
  }
  statusEl.textContent = `${rows.length.toLocaleString()} cells`;
}

function drawAll() {
  drawPlot(
    els.spatialCanvas,
    els.spatialStatus,
    "x",
    "y",
    state.bounds.spatial,
    false,
    state.spatialRotation,
    state.spatialView,
  );
  drawPlot(els.umapCanvas, els.umapStatus, "umap_x", "umap_y", state.bounds.umap, true);
}

function normalizeRotation(value) {
  return ((value % 360) + 360) % 360;
}

function updateRotationStatus() {
  els.rotationStatus.textContent = `${state.spatialRotation} deg`;
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampZoom(value) {
  return clampValue(value, 1, 12);
}

function updateZoomStatus() {
  els.zoomStatus.textContent = `${state.spatialView.zoom.toFixed(1)}x`;
  updateSpatialPointStatus();
}

function updateUmapPointStatus() {
  els.umapPointStatus.textContent = Number(state.umapPointSize).toFixed(1);
}

function updateSpatialPointStatus() {
  const renderedSize = plottedPointSize(state.spatialView);
  els.spatialPointSize.value = String(renderedSize.toFixed(1));
  els.spatialPointStatus.textContent = renderedSize.toFixed(1);
}

function rangeNumber(input, value) {
  return clampValue(
    Number(value),
    Number(input.min) || 0.6,
    Number(input.max) || 5,
  );
}

function setSpatialPointSize(value) {
  const renderedSize = rangeNumber(els.spatialPointSize, value);
  const zoomScale = 1 + (Math.max(1, state.spatialView.zoom) - 1) * 1.5;
  state.spatialPointSize = renderedSize / zoomScale;
  updateSpatialPointStatus();
  drawAll();
}

function setUmapPointSize(value) {
  state.umapPointSize = rangeNumber(els.umapPointSize, value);
  els.umapPointSize.value = String(state.umapPointSize);
  updateUmapPointStatus();
  drawAll();
}

function workspaceHeightLimits() {
  return {
    min: Number(els.workspaceHeight.min) || 620,
    max: Number(els.workspaceHeight.max) || 1400,
    step: Number(els.workspaceHeight.step) || 1,
  };
}

function setWorkspaceHeight(value) {
  const limits = workspaceHeightLimits();
  const clamped = clampValue(value, limits.min, limits.max);
  const stepped = limits.min + Math.round((clamped - limits.min) / limits.step) * limits.step;
  state.workspaceHeight = Math.round(clampValue(stepped, limits.min, limits.max));
  els.workspaceHeight.value = String(state.workspaceHeight);
  document.documentElement.style.setProperty("--workspace-height", `${state.workspaceHeight}px`);
}

function clampSpatialPan() {
  const view = state.spatialView;
  const rect = els.spatialCanvas.getBoundingClientRect();
  if (view.zoom <= 1.001 || rect.width <= 0 || rect.height <= 0) {
    view.panX = 0;
    view.panY = 0;
    return;
  }
  const maxX = rect.width * (view.zoom - 1) * 0.6;
  const maxY = rect.height * (view.zoom - 1) * 0.6;
  view.panX = clampValue(view.panX, -maxX, maxX);
  view.panY = clampValue(view.panY, -maxY, maxY);
}

function resetSpatialView(options = {}) {
  const { redraw = true } = options;
  state.spatialView.zoom = 1;
  state.spatialView.panX = 0;
  state.spatialView.panY = 0;
  state.spatialView.isPanning = false;
  els.spatialCanvas.classList.remove("isPanning");
  updateZoomStatus();
  if (redraw) drawAll();
}

function zoomSpatial(factor, focusX = null, focusY = null) {
  const view = state.spatialView;
  const rect = els.spatialCanvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const cx = width / 2;
  const cy = height / 2;
  const fx = Number.isFinite(focusX) ? focusX : cx;
  const fy = Number.isFinite(focusY) ? focusY : cy;
  const oldZoom = view.zoom;
  const nextZoom = clampZoom(oldZoom * factor);
  if (Math.abs(nextZoom - oldZoom) < 0.001) return;

  view.panX = fx - cx - ((fx - cx - view.panX) * nextZoom) / oldZoom;
  view.panY = fy - cy - ((fy - cy - view.panY) * nextZoom) / oldZoom;
  view.zoom = nextZoom;
  clampSpatialPan();
  updateZoomStatus();
  drawAll();
}

function getWorkspaceSize() {
  const rect = els.viewerGrid.getBoundingClientRect();
  return {
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height)),
  };
}

function getPanelLimits() {
  const { width, height } = getWorkspaceSize();
  const maxW = Math.max(1, width - 16);
  const maxH = Math.max(1, height - 16);
  return {
    width,
    height,
    maxW,
    maxH,
    minW: Math.min(maxW, Math.max(120, Math.min(280, maxW))),
    minH: Math.min(maxH, Math.max(160, Math.min(240, maxH))),
  };
}

function clampPanel(panel) {
  const limits = getPanelLimits();
  panel.w = clampValue(panel.w, limits.minW, limits.maxW);
  panel.h = clampValue(panel.h, limits.minH, limits.maxH);
  panel.x = clampValue(panel.x, 8, limits.width - panel.w - 8);
  panel.y = clampValue(panel.y, 8, limits.height - panel.h - 8);
}

function resizePanel(target, startPanel, edge, dx, dy) {
  const limits = getPanelLimits();
  let left = startPanel.x;
  let top = startPanel.y;
  let right = startPanel.x + startPanel.w;
  let bottom = startPanel.y + startPanel.h;

  if (edge.includes("e")) right = clampValue(right + dx, left + limits.minW, limits.width - 8);
  if (edge.includes("s")) bottom = clampValue(bottom + dy, top + limits.minH, limits.height - 8);
  if (edge.includes("w")) left = clampValue(left + dx, 8, right - limits.minW);
  if (edge.includes("n")) top = clampValue(top + dy, 8, bottom - limits.minH);

  target.x = left;
  target.y = top;
  target.w = right - left;
  target.h = bottom - top;
  clampPanel(target);
}

function panelsOverlap(first, second, gap = 0) {
  return (
    first.x < second.x + second.w + gap &&
    first.x + first.w + gap > second.x &&
    first.y < second.y + second.h + gap &&
    first.y + first.h + gap > second.y
  );
}

function placeUmapBelowSpatialIfNeeded() {
  const spatial = state.panels.spatial;
  const umap = state.panels.umap;
  if (!state.umapAutoPlaced && !panelsOverlap(spatial, umap, PANEL_GAP)) return;

  state.umapAutoPlaced = true;
  const desiredY = spatial.y + spatial.h + PANEL_GAP;
  const desiredHeight = desiredY + umap.h + 8;
  if (desiredHeight > state.workspaceHeight) {
    setWorkspaceHeight(desiredHeight);
  }

  clampPanel(umap);
  const limits = getPanelLimits();
  const maxY = Math.max(8, limits.height - umap.h - 8);
  umap.y = clampValue(desiredY, 8, maxY);
  clampPanel(umap);
}

function applyPanelLayout() {
  setWorkspaceHeight(state.workspaceHeight);
  for (const [key, panel] of Object.entries(state.panels)) {
    clampPanel(panel);
    const el = key === "spatial" ? els.spatialPanel : els.umapPanel;
    el.style.left = `${panel.x}px`;
    el.style.top = `${panel.y}px`;
    el.style.width = `${panel.w}px`;
    el.style.height = `${panel.h}px`;
    el.style.zIndex = String(panel.z);
  }
  requestAnimationFrame(() => {
    clampSpatialPan();
    drawAll();
  });
}

function resetPanelLayout() {
  setWorkspaceHeight(DEFAULT_WORKSPACE_HEIGHT);
  const { width, height } = getWorkspaceSize();
  const spatialH = Math.min(650, Math.max(460, Math.floor(height * 0.52)));
  const umapW = Math.min(Math.max(420, Math.floor(width * 0.42)), width - 16);
  const umapH = Math.min(Math.max(360, Math.floor(height * 0.42)), height - spatialH - PANEL_GAP - 8);
  state.panels.spatial = { x: 8, y: 8, w: width - 16, h: spatialH, z: 3 };
  state.panels.umap = {
    x: 8,
    y: 8 + spatialH + PANEL_GAP,
    w: umapW,
    h: umapH,
    z: 2,
  };
  state.panelZ = 3;
  state.panelsInitialized = true;
  state.umapAutoPlaced = false;
  els.spatialPanel.classList.add("isActive");
  els.umapPanel.classList.remove("isActive");
  applyPanelLayout();
}

function bringPanelToFront(key) {
  state.panelZ += 1;
  state.panels[key].z = state.panelZ;
  els.spatialPanel.classList.toggle("isActive", key === "spatial");
  els.umapPanel.classList.toggle("isActive", key === "umap");
  applyPanelLayout();
}

function renderLegend() {
  const counts = new Map();
  for (const row of state.rows) {
    const type = value(row, "cell_type");
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  els.legend.innerHTML = "";
  const ordered = state.order.filter((type) => counts.has(type));
  for (const type of ordered) {
    const label = document.createElement("label");
    label.className = "legendItem";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.visibleTypes.has(type);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.visibleTypes.add(type);
      else state.visibleTypes.delete(type);
      drawAll();
    });

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = state.colors[type] || "#747b85";

    const name = document.createElement("span");
    name.className = "legendName";
    name.textContent = type;

    const count = document.createElement("span");
    count.className = "legendCount";
    count.textContent = counts.get(type).toLocaleString();

    label.append(checkbox, swatch, name, count);
    els.legend.appendChild(label);
  }
}

function renderHover(row) {
  if (!row) {
    els.hoverInfo.textContent = "Move over a point.";
    return;
  }
  const lines = [
    ["ID", value(row, "cell_id")],
    ["Type", value(row, "cell_type")],
    ["Leiden", value(row, "leiden_scanpy")],
    ["Sub", value(row, "sub_cluster")],
    ["Counts", numberValue(row, "total_counts").toLocaleString()],
    [state.gene, numberValue(row, state.gene).toFixed(3)],
  ];
  els.hoverInfo.innerHTML = lines.map(([k, v]) => `<div><b>${k}</b>${v}</div>`).join("");
}

function nearestCell(event, canvas, xName, yName, bounds, invertY = false, rotation = 0, view = null) {
  const rect = canvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;
  const width = rect.width;
  const height = rect.height;
  let best = null;
  const hitRadius = Math.max(8, plottedPointSize(view) + 5);
  let bestDist = hitRadius * hitRadius;
  for (const row of visibleRows()) {
    const p = project(row, bounds, width, height, xName, yName, invertY, rotation, view);
    const dx = p.x - mx;
    const dy = p.y - my;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  }
  return best;
}

function attachHover(
  canvas,
  xName,
  yName,
  bounds,
  invertY = false,
  rotationGetter = () => 0,
  viewGetter = () => null,
) {
  canvas.addEventListener("mousemove", (event) => {
    if (canvas === els.spatialCanvas && state.spatialView.isPanning) return;
    state.hoverCell = nearestCell(event, canvas, xName, yName, bounds, invertY, rotationGetter(), viewGetter());
    renderHover(state.hoverCell);
    drawAll();
  });
  canvas.addEventListener("mouseleave", () => {
    state.hoverCell = null;
    renderHover(null);
    drawAll();
  });
}

function bindSpatialViewGestures() {
  els.spatialCanvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = els.spatialCanvas.getBoundingClientRect();
      zoomSpatial(event.deltaY < 0 ? 1.2 : 1 / 1.2, event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false },
  );

  els.spatialCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.spatialView.zoom <= 1.001) return;
    event.preventDefault();
    bringPanelToFront("spatial");
    state.spatialView.isPanning = true;
    els.spatialCanvas.classList.add("isPanning");
    const start = {
      x: event.clientX,
      y: event.clientY,
      panX: state.spatialView.panX,
      panY: state.spatialView.panY,
    };

    function moveSpatialView(moveEvent) {
      state.spatialView.panX = start.panX + moveEvent.clientX - start.x;
      state.spatialView.panY = start.panY + moveEvent.clientY - start.y;
      clampSpatialPan();
      drawAll();
    }

    function stopSpatialView() {
      state.spatialView.isPanning = false;
      els.spatialCanvas.classList.remove("isPanning");
      window.removeEventListener("pointermove", moveSpatialView);
      window.removeEventListener("pointerup", stopSpatialView);
      window.removeEventListener("pointercancel", stopSpatialView);
    }

    window.addEventListener("pointermove", moveSpatialView);
    window.addEventListener("pointerup", stopSpatialView);
    window.addEventListener("pointercancel", stopSpatialView);
  });
}

function startPanelGesture(event, key, mode) {
  event.preventDefault();
  bringPanelToFront(key);
  if (key === "umap") state.umapAutoPlaced = false;
  const panel = state.panels[key];
  const start = {
    x: event.clientX,
    y: event.clientY,
    panel: { ...panel },
    mode,
    key,
  };
  const panelEl = key === "spatial" ? els.spatialPanel : els.umapPanel;
  panelEl.classList.add("isDragging");

  function movePanel(moveEvent) {
    const dx = moveEvent.clientX - start.x;
    const dy = moveEvent.clientY - start.y;
    const target = state.panels[start.key];
    if (start.mode === "drag") {
      target.x = start.panel.x + dx;
      target.y = start.panel.y + dy;
    } else {
      const edge = start.mode.startsWith("resize-") ? start.mode.replace("resize-", "") : "se";
      resizePanel(target, start.panel, edge, dx, dy);
      if (start.key === "spatial") placeUmapBelowSpatialIfNeeded();
    }
    applyPanelLayout();
  }

  function stopPanelGesture() {
    panelEl.classList.remove("isDragging");
    window.removeEventListener("pointermove", movePanel);
    window.removeEventListener("pointerup", stopPanelGesture);
    window.removeEventListener("pointercancel", stopPanelGesture);
  }

  window.addEventListener("pointermove", movePanel);
  window.addEventListener("pointerup", stopPanelGesture);
  window.addEventListener("pointercancel", stopPanelGesture);
}

function bindPanelGestures() {
  for (const [key, panelEl] of [
    ["spatial", els.spatialPanel],
    ["umap", els.umapPanel],
  ]) {
    const header = panelEl.querySelector(".panelHeader");
    const handles = Array.from(panelEl.querySelectorAll(".resizeHandle"));
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-nodrag='true']")) return;
      startPanelGesture(event, key, "drag");
    });
    handles.forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        startPanelGesture(event, key, `resize-${handle.dataset.resize}`);
      });
    });
    panelEl.addEventListener("pointerdown", () => bringPanelToFront(key));
  }
}

function bindControls() {
  els.colorMode.addEventListener("change", () => {
    state.colorMode = els.colorMode.value;
    drawAll();
  });
  els.geneInput.addEventListener("input", () => {
    const gene = els.geneInput.value.trim();
    if (state.markers.includes(gene)) {
      state.gene = gene;
      if (state.colorMode !== "gene") {
        state.colorMode = "gene";
        els.colorMode.value = "gene";
      }
      renderHover(state.hoverCell);
      drawAll();
    }
  });
  els.spatialPointSize.addEventListener("input", () => {
    setSpatialPointSize(els.spatialPointSize.value);
  });
  els.umapPointSize.addEventListener("input", () => {
    setUmapPointSize(els.umapPointSize.value);
  });
  els.pointButtons.forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const delta = Number(button.dataset.pointDelta);
      if (button.dataset.pointTarget === "spatial") {
        setSpatialPointSize(plottedPointSize(state.spatialView) + delta);
      } else if (button.dataset.pointTarget === "umap") {
        setUmapPointSize(state.umapPointSize + delta);
      }
    });
  });
  els.rotateButtons.forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const delta = Number(button.dataset.rotation);
      state.spatialRotation = normalizeRotation(state.spatialRotation + delta);
      updateRotationStatus();
      drawAll();
    });
  });
  els.zoomButtons.forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      zoomSpatial(button.dataset.zoom === "in" ? 1.25 : 1 / 1.25);
    });
  });
  els.fitSpatial.addEventListener("pointerdown", (event) => event.stopPropagation());
  els.fitSpatial.addEventListener("click", (event) => {
    event.stopPropagation();
    resetSpatialView();
  });
  els.workspaceHeight.addEventListener("input", () => {
    setWorkspaceHeight(Number(els.workspaceHeight.value));
    applyPanelLayout();
  });
  els.resetPanels.addEventListener("click", () => {
    resetSpatialView({ redraw: false });
    resetPanelLayout();
  });
  els.showAll.addEventListener("click", () => {
    state.visibleTypes = new Set(state.order);
    renderLegend();
    drawAll();
  });
  els.hideAll.addEventListener("click", () => {
    state.visibleTypes = new Set();
    renderLegend();
    drawAll();
  });
  window.addEventListener("resize", () => {
    if (!state.panelsInitialized) return;
    applyPanelLayout();
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status}`);
  }
  if (!url.endsWith(".gz")) {
    return response.json();
  }
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser cannot decompress gzip viewer data.");
  }
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}

async function init() {
  const data = await fetchJson(DATA_URL);
  state.rows = data.rows;
  state.columns = Object.fromEntries(data.schema.columns.map((name, idx) => [name, idx]));
  state.markers = data.markers;
  state.colors = data.cell_type_colors;
  state.order = data.cell_type_order;
  state.markerRanges = data.marker_ranges;
  state.visibleTypes = new Set(state.order);
  state.bounds.spatial = computeBounds(state.rows, "x", "y");
  state.bounds.umap = computeBounds(state.rows, "umap_x", "umap_y");

  for (const marker of state.markers) {
    const option = document.createElement("option");
    option.value = marker;
    els.geneList.appendChild(option);
  }

  els.datasetMeta.textContent = `${data.dataset} | ${state.rows.length.toLocaleString()} filtered cells | ${state.markers.length} markers`;
  updateRotationStatus();
  updateZoomStatus();
  updateSpatialPointStatus();
  updateUmapPointStatus();
  renderLegend();
  bindControls();
  bindPanelGestures();
  bindSpatialViewGestures();
  resetPanelLayout();
  attachHover(
    els.spatialCanvas,
    "x",
    "y",
    state.bounds.spatial,
    false,
    () => state.spatialRotation,
    () => state.spatialView,
  );
  attachHover(els.umapCanvas, "umap_x", "umap_y", state.bounds.umap, true);
  drawAll();
}

init().catch((error) => {
  els.datasetMeta.textContent = "Failed to load viewer data.";
  console.error(error);
});
