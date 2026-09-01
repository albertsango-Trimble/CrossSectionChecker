(() => {
  "use strict";

  let API = null;
  let drawing = false;
  let currentPlaneIds = [];
  let currentMarkupId = null;
  let flip = false;
  let lastLine = null; // { x1, y1, x2, y2 } in mm
  let preDrawMarkupIds = new Set();

  const els = {};

  function $(sel) { return document.querySelector(sel); }

  function cacheEls() {
    els.drawBtn = $("#drawBtn");
    els.useDrawnBtn = $("#useDrawnBtn");
    els.cancelDrawBtn = $("#cancelDrawBtn");
    els.x1 = null;
    els.y1 = null;
    els.x2 = null;
    els.y2 = null;
    els.alignmentSelect = $("#alignmentSelect");
    els.deleteAlignmentBtn = $("#deleteAlignmentBtn");
    els.alignmentUnit = $("#alignmentUnit");
    els.uploadAlignmentBtn = $("#uploadAlignmentBtn");
    els.alignmentFile = $("#alignmentFile");
    els.alignmentActive = $("#alignmentActive");
    els.alignmentInfo = $("#alignmentInfo");
    els.chainageReadout = $("#chainageReadout");
    els.chainageSlider = $("#chainageSlider");
    els.chainageNumber = $("#chainageNumber");
    els.halfWidth = $("#halfWidth");
    els.flipBtn = $("#flipBtn");
    els.showHandles = $("#showHandles");
    els.thickness = $("#thickness");
    els.clearBtn = $("#clearBtn");
    els.status = $("#status");
    els.topViewBtn = $("#topViewBtn");
    els.sectionViewBtn = $("#sectionViewBtn");
    els.captureSplitBtn = $("#captureSplitBtn");
    els.splitPreview = $("#splitPreview");
    els.splitTopImg = $("#splitTopImg");
    els.splitSectionImg = $("#splitSectionImg");
  }

  function setStatus(msg, isError) {
    els.status.textContent = msg || "";
    els.status.classList.toggle("error", !!isError);
  }

  function buildSlabPlanes(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!len || Number.isNaN(len)) return null;

    // Perpendicular, horizontal normal (plane is vertical: no Z component).
    let nx = -dy / len;
    let ny = dx / len;
    if (flip) {
      nx = -nx;
      ny = -ny;
    }

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const thickness = Math.max(Number(els.thickness.value) || 10, 1);
    const half = thickness / 2;
    const controlsVisible = !!els.showHandles.checked;

    // Two opposing planes, offset by half the thickness on either side of
    // the line, keep only the slab of material between them visible.
    const nearPlane = {
      directionX: nx,
      directionY: ny,
      directionZ: 0,
      positionX: midX - nx * half,
      positionY: midY - ny * half,
      positionZ: 0,
      controlsVisible,
    };
    const farPlane = {
      directionX: -nx,
      directionY: -ny,
      directionZ: 0,
      positionX: midX + nx * half,
      positionY: midY + ny * half,
      positionZ: 0,
      controlsVisible,
    };
    return [nearPlane, farPlane];
  }

  async function applySection(x1, y1, x2, y2) {
    const planes = buildSlabPlanes(x1, y1, x2, y2);
    if (!planes) {
      setStatus("The two points are the same \u2014 can't define a line.", true);
      return;
    }
    try {
      if (currentPlaneIds.length) {
        await API.viewer.removeSectionPlanes(currentPlaneIds);
        currentPlaneIds = [];
      }
      const added = await API.viewer.addSectionPlane(planes);
      if (Array.isArray(added)) {
        currentPlaneIds = added.map((p) => p.id).filter((id) => typeof id === "number");
      }
      lastLine = { x1, y1, x2, y2 };
      els.flipBtn.disabled = false;
      setStatus("Section applied.");
    } catch (err) {
      console.error(err);
      setStatus("Failed to create the section plane.", true);
    }
  }

  async function reapplyCurrent() {
    if (!lastLine) return;
    await applySection(lastLine.x1, lastLine.y1, lastLine.x2, lastLine.y2);
  }

  async function startDraw() {
    if (!API || drawing) return;
    drawing = true;
    els.drawBtn.disabled = true;
    els.useDrawnBtn.style.display = "";
    els.cancelDrawBtn.style.display = "";
    setStatus("Draw two points, click \u201cDone\u201d in the top toolbar, then click \u201cUse drawn line\u201d.");
    try {
      // Remember what line markups already exist so we can spot the new one.
      const existing = await API.markup.getLineMarkups().catch(() => []);
      preDrawMarkupIds = new Set((existing || []).map((m) => m.id));

      // Put the user in plan view so the line is naturally drawn in X/Y.
      await API.viewer.setCamera("top");
      await API.viewer.activateTool("lineMarkup", {
        instruction: "Click two points to define the cross-section line, then click Done.",
      });
    } catch (err) {
      console.error(err);
      setStatus("Could not activate the line drawing tool.", true);
      await stopDraw();
    }
  }

  async function stopDraw() {
    drawing = false;
    els.drawBtn.disabled = false;
    els.useDrawnBtn.style.display = "none";
    els.cancelDrawBtn.style.display = "none";
    try {
      await API.viewer.activateTool("reset");
    } catch (err) {
      console.error(err);
    }
  }

  async function useDrawnLine() {
    if (!API) return;
    try {
      const lines = await API.markup.getLineMarkups();
      const newLine = (lines || []).find((l) => !preDrawMarkupIds.has(l.id))
        || (lines && lines[lines.length - 1]);

      if (!newLine || !newLine.start || !newLine.end) {
        setStatus("No finished line found yet \u2014 draw two points and click Done first.", true);
        return;
      }

      currentMarkupId = typeof newLine.id === "number" ? newLine.id : null;

      const x1 = newLine.start.positionX;
      const y1 = newLine.start.positionY;
      const x2 = newLine.end.positionX;
      const y2 = newLine.end.positionY;
      // Z is intentionally discarded: the drawn line always defines a level
      // cut, regardless of what elevation was clicked on.

      await stopDraw();
      await applySection(x1, y1, x2, y2);
    } catch (err) {
      console.error(err);
      setStatus("Failed to read the drawn line.", true);
    }
  }

  async function onMarkupChanged(eventArg) {
    if (!drawing) return;
    // eventArg is a MarkupChangedArgument; the actual payload is in .data
    const update = eventArg && eventArg.data;
    if (!update || update.markupType !== "lineMarkup" || update.action !== "added") return;

    const markup = update.markup;
    const start = markup && markup.start;
    const end = markup && markup.end;
    if (!start || !end) return;

    currentMarkupId = typeof markup.id === "number" ? markup.id : null;

    const x1 = start.positionX;
    const y1 = start.positionY;
    const x2 = end.positionX;
    const y2 = end.positionY;

    await stopDraw();
    await applySection(x1, y1, x2, y2);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function computeSectionCamera() {
    if (!lastLine) return null;
    const { x1, y1, x2, y2 } = lastLine;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenMm = Math.sqrt(dx * dx + dy * dy);
    if (!lenMm) return null;

    let nx = -dy / lenMm;
    let ny = dx / lenMm;
    if (flip) {
      nx = -nx;
      ny = -ny;
    }

    const midXm = (x1 + x2) / 2 / 1000;
    const midYm = (y1 + y2) / 2 / 1000;
    const lenM = lenMm / 1000;
    const distanceM = Math.max(lenM * 1.2, 10);

    // Keep whatever vertical framing the user currently has, so the
    // section view lines up roughly with what they were looking at.
    let elevationZ = 0;
    try {
      const current = await API.viewer.getCamera();
      if (current && current.position && typeof current.position.z === "number") {
        elevationZ = current.position.z;
      }
    } catch (err) {
      console.error(err);
    }

    return {
      position: { x: midXm + nx * distanceM, y: midYm + ny * distanceM, z: elevationZ },
      lookAt: { x: midXm, y: midYm, z: elevationZ },
      upDirection: { x: 0, y: 0, z: 1 },
    };
  }

  async function goToTopView() {
    if (!API) return;
    try {
      await API.viewer.setCamera("top", { animationTime: 400 });
    } catch (err) {
      console.error(err);
      setStatus("Failed to switch to top view.", true);
    }
  }

  async function goToSectionView() {
    if (!API) return;
    const camera = await computeSectionCamera();
    if (!camera) {
      setStatus("Create a section first.", true);
      return;
    }
    try {
      await API.viewer.setCamera(camera, { animationTime: 400 });
    } catch (err) {
      console.error(err);
      setStatus("Failed to switch to section view. Try orbiting manually if it looks off.", true);
    }
  }

  async function captureSplitView() {
    if (!API) return;
    if (!lastLine) {
      setStatus("Create a section first.", true);
      return;
    }
    els.captureSplitBtn.disabled = true;
    setStatus("Capturing plan and section views\u2026");
    try {
      await API.viewer.setCamera("top", { animationTime: 0 });
      await wait(400);
      const topImg = await API.viewer.getSnapshot();

      const sectionCamera = await computeSectionCamera();
      await API.viewer.setCamera(sectionCamera, { animationTime: 0 });
      await wait(400);
      const sectionImg = await API.viewer.getSnapshot();

      els.splitTopImg.src = topImg;
      els.splitSectionImg.src = sectionImg;
      els.splitPreview.style.display = "";
      setStatus("Split view captured.");
    } catch (err) {
      console.error(err);
      setStatus("Failed to capture the split view.", true);
    } finally {
      els.captureSplitBtn.disabled = false;
    }
  }

  // ---- Alignment / chainage feature ----

  const ALIGN_STORAGE_KEY = "tc-cross-section-alignments-v1";
  let alignments = [];
  let activeAlignment = null;
  let alignmentMarkupIds = [];
  let debounceTimers2 = {};

  function debounced(key, fn, ms = 60) {
    clearTimeout(debounceTimers2[key]);
    debounceTimers2[key] = setTimeout(fn, ms);
  }

  function loadAlignments() {
    try {
      const raw = localStorage.getItem(ALIGN_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error(err);
      return [];
    }
  }

  function persistAlignments() {
    try {
      localStorage.setItem(ALIGN_STORAGE_KEY, JSON.stringify(alignments));
    } catch (err) {
      console.error(err);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function refreshAlignmentSelect() {
    const options = ['<option value="">— none —</option>']
      .concat(alignments.map((a) => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`));
    els.alignmentSelect.innerHTML = options.join("");
    els.alignmentSelect.value = activeAlignment ? activeAlignment.name : "";
  }

  function parseAlignmentCsv(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
    if (!lines.length) throw new Error("Empty file");

    const headerTokens = lines[0].split(",").map((s) => s.trim().toLowerCase());
    const looksLikeHeader = headerTokens.some((t) => /[a-z]/.test(t));

    let colMap = null;
    let startIdx = 0;
    if (looksLikeHeader) {
      colMap = {};
      headerTokens.forEach((t, i) => {
        if (["station", "chainage", "ch"].includes(t)) colMap.station = i;
        else if (["x", "easting", "east"].includes(t)) colMap.x = i;
        else if (["y", "northing", "north"].includes(t)) colMap.y = i;
      });
      startIdx = 1;
    }

    const rows = [];
    for (let i = startIdx; i < lines.length; i++) {
      const parts = lines[i].split(",").map((s) => s.trim());
      if (parts.length < 2) continue;
      let x;
      let y;
      let station;
      if (colMap && colMap.x !== undefined && colMap.y !== undefined) {
        x = parseFloat(parts[colMap.x]);
        y = parseFloat(parts[colMap.y]);
        station = colMap.station !== undefined ? parseFloat(parts[colMap.station]) : undefined;
      } else if (parts.length >= 3) {
        station = parseFloat(parts[0]);
        x = parseFloat(parts[1]);
        y = parseFloat(parts[2]);
      } else {
        x = parseFloat(parts[0]);
        y = parseFloat(parts[1]);
      }
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      rows.push({ x, y, station });
    }

    if (rows.length < 2) throw new Error("Need at least 2 valid points");

    const hasAllStations = rows.every((r) => typeof r.station === "number" && !Number.isNaN(r.station));
    if (hasAllStations) {
      rows.sort((a, b) => a.station - b.station);
    } else {
      let cum = 0;
      rows[0].station = 0;
      for (let i = 1; i < rows.length; i++) {
        const dx = rows[i].x - rows[i - 1].x;
        const dy = rows[i].y - rows[i - 1].y;
        cum += Math.sqrt(dx * dx + dy * dy);
        rows[i].station = cum;
      }
    }
    return rows;
  }

  function pointAtChainage(alignment, station) {
    const pts = alignment.points;
    const clamped = Math.min(Math.max(station, pts[0].station), pts[pts.length - 1].station);
    let i = 0;
    for (; i < pts.length - 2; i++) {
      if (clamped <= pts[i + 1].station) break;
    }
    const a = pts[i];
    const b = pts[i + 1];
    const span = b.station - a.station;
    const t = span > 0 ? (clamped - a.station) / span : 0;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x, y, tangentX: dx / len, tangentY: dy / len };
  }

  function updateChainageReadout(station) {
    els.chainageReadout.textContent = `${(station / 1000).toFixed(2)} m`;
  }

  function generateSectionAtChainage(station) {
    if (!activeAlignment) return;
    const halfWidth = Number(els.halfWidth.value) || 20000;
    const p = pointAtChainage(activeAlignment, station);
    const perpX = -p.tangentY;
    const perpY = p.tangentX;
    const x1 = p.x - perpX * halfWidth;
    const y1 = p.y - perpY * halfWidth;
    const x2 = p.x + perpX * halfWidth;
    const y2 = p.y + perpY * halfWidth;
    applySection(x1, y1, x2, y2);
  }

  async function clearAlignmentMarkup() {
    if (!API || !alignmentMarkupIds.length) return;
    try {
      await API.markup.removeMarkups(alignmentMarkupIds);
    } catch (err) {
      console.error(err);
    }
    alignmentMarkupIds = [];
  }

  async function drawAlignmentPolyline(alignment) {
    if (!API) return;
    await clearAlignmentMarkup();
    const pts = alignment.points;
    const segments = [];
    for (let i = 0; i < pts.length - 1; i++) {
      segments.push({
        start: { positionX: pts[i].x, positionY: pts[i].y, positionZ: 0 },
        end: { positionX: pts[i + 1].x, positionY: pts[i + 1].y, positionZ: 0 },
      });
    }
    try {
      const added = await API.markup.addLineMarkups(segments);
      alignmentMarkupIds = (added || []).map((m) => m.id).filter((id) => typeof id === "number");
    } catch (err) {
      console.error(err);
      setStatus("Could not draw the alignment reference line in the viewer (the section still works).", true);
    }
  }

  async function setActiveAlignment(name) {
    activeAlignment = alignments.find((a) => a.name === name) || null;
    els.deleteAlignmentBtn.disabled = !activeAlignment;

    if (!activeAlignment) {
      els.alignmentActive.style.display = "none";
      await clearAlignmentMarkup();
      return;
    }

    const pts = activeAlignment.points;
    const minSt = pts[0].station;
    const maxSt = pts[pts.length - 1].station;
    const mid = Math.round((minSt + maxSt) / 2);

    els.chainageSlider.min = minSt;
    els.chainageSlider.max = maxSt;
    els.chainageSlider.step = Math.max(Math.round((maxSt - minSt) / 500), 1);
    els.chainageSlider.value = mid;
    els.chainageNumber.value = mid;

    els.alignmentInfo.textContent = `${pts.length} points \u2022 length ${((maxSt - minSt) / 1000).toFixed(1)} m (stations ${(minSt / 1000).toFixed(1)} to ${(maxSt / 1000).toFixed(1)} m)`;
    els.alignmentActive.style.display = "";

    updateChainageReadout(mid);
    await drawAlignmentPolyline(activeAlignment);
    generateSectionAtChainage(mid);
  }

  function wireControls() {
    els.drawBtn.addEventListener("click", startDraw);
    els.useDrawnBtn.addEventListener("click", useDrawnLine);
    els.cancelDrawBtn.addEventListener("click", stopDraw);

    els.topViewBtn.addEventListener("click", goToTopView);
    els.sectionViewBtn.addEventListener("click", goToSectionView);
    els.captureSplitBtn.addEventListener("click", captureSplitView);

    els.alignmentSelect.addEventListener("change", () => setActiveAlignment(els.alignmentSelect.value));

    els.deleteAlignmentBtn.addEventListener("click", async () => {
      if (!activeAlignment) return;
      const removedName = activeAlignment.name;
      alignments = alignments.filter((a) => a.name !== removedName);
      persistAlignments();
      await clearAlignmentMarkup();
      activeAlignment = null;
      refreshAlignmentSelect();
      els.alignmentActive.style.display = "none";
      setStatus(`Alignment "${removedName}" deleted.`);
    });

    els.uploadAlignmentBtn.addEventListener("click", () => els.alignmentFile.click());

    els.alignmentFile.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        let points = parseAlignmentCsv(text);
        const scale = els.alignmentUnit.value === "m" ? 1000 : 1;
        points = points.map((p) => ({ x: p.x * scale, y: p.y * scale, station: p.station * scale }));

        let baseName = file.name.replace(/\.[^.]+$/, "") || "Alignment";
        let finalName = baseName;
        let n = 1;
        while (alignments.some((a) => a.name === finalName)) {
          n += 1;
          finalName = `${baseName} (${n})`;
        }

        alignments.push({ name: finalName, points });
        persistAlignments();
        refreshAlignmentSelect();
        els.alignmentSelect.value = finalName;
        await setActiveAlignment(finalName);
        setStatus(`Alignment "${finalName}" loaded (${points.length} points).`);
      } catch (err) {
        console.error(err);
        setStatus("Could not parse that file. Expected CSV with station,x,y or x,y columns.", true);
      } finally {
        els.alignmentFile.value = "";
      }
    });

    els.chainageSlider.addEventListener("input", () => {
      const st = Number(els.chainageSlider.value);
      els.chainageNumber.value = Math.round(st);
      updateChainageReadout(st);
      debounced("chainage", () => generateSectionAtChainage(st));
    });

    els.chainageNumber.addEventListener("change", () => {
      let st = Number(els.chainageNumber.value);
      if (Number.isNaN(st)) st = 0;
      const min = Number(els.chainageSlider.min);
      const max = Number(els.chainageSlider.max);
      st = Math.min(max, Math.max(min, st));
      els.chainageSlider.value = st;
      els.chainageNumber.value = st;
      updateChainageReadout(st);
      generateSectionAtChainage(st);
    });

    els.halfWidth.addEventListener("change", () => {
      if (!activeAlignment) return;
      generateSectionAtChainage(Number(els.chainageSlider.value));
    });

    els.flipBtn.addEventListener("click", () => {
      flip = !flip;
      els.flipBtn.classList.toggle("active", flip);
      reapplyCurrent();
    });

    els.showHandles.addEventListener("change", reapplyCurrent);
    els.thickness.addEventListener("change", reapplyCurrent);

    els.clearBtn.addEventListener("click", async () => {
      try {
        await API.viewer.removeSectionPlanes();
        if (currentMarkupId !== null) {
          await API.markup.removeMarkups([currentMarkupId]).catch(() => {});
        }
        currentPlaneIds = [];
        currentMarkupId = null;
        lastLine = null;
        preDrawMarkupIds = new Set();
        flip = false;
        els.flipBtn.classList.remove("active");
        els.flipBtn.disabled = true;
        els.splitPreview.style.display = "none";
        setStatus("Section cleared.");
      } catch (err) {
        console.error(err);
        setStatus("Failed to clear the section.", true);
      }
    });
  }

  async function init() {
    cacheEls();
    wireControls();

    alignments = loadAlignments();
    refreshAlignmentSelect();

    setStatus("Connecting to Trimble Connect\u2026");
    try {
      API = await TrimbleConnectWorkspace.connect(window.parent, (event, data) => {
        if (event === "viewer.onMarkupChanged") {
          onMarkupChanged(data);
        }
      }, 5000);
      setStatus("Ready. Click \"Draw section line\" to begin.");
    } catch (err) {
      console.error(err);
      setStatus("Could not connect to Trimble Connect. Open this app as a 3D Viewer extension.", true);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
