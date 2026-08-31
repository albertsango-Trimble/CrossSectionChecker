(() => {
  "use strict";

  let API = null;
  let drawing = false;
  let currentPlaneId = null;
  let currentMarkupId = null;
  let flip = false;
  let lastLine = null; // { x1, y1, x2, y2 } in mm

  const els = {};

  function $(sel) { return document.querySelector(sel); }

  function cacheEls() {
    els.drawBtn = $("#drawBtn");
    els.cancelDrawBtn = $("#cancelDrawBtn");
    els.x1 = $("#x1");
    els.y1 = $("#y1");
    els.x2 = $("#x2");
    els.y2 = $("#y2");
    els.applyManualBtn = $("#applyManualBtn");
    els.flipBtn = $("#flipBtn");
    els.showHandles = $("#showHandles");
    els.clearBtn = $("#clearBtn");
    els.status = $("#status");
  }

  function setStatus(msg, isError) {
    els.status.textContent = msg || "";
    els.status.classList.toggle("error", !!isError);
  }

  function buildVerticalPlane(x1, y1, x2, y2) {
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

    return {
      directionX: nx,
      directionY: ny,
      directionZ: 0,
      positionX: midX,
      positionY: midY,
      positionZ: 0, // elevation is irrelevant to a vertical plane's orientation
      controlsVisible: !!els.showHandles.checked,
    };
  }

  async function applySection(x1, y1, x2, y2) {
    const plane = buildVerticalPlane(x1, y1, x2, y2);
    if (!plane) {
      setStatus("The two points are the same \u2014 can't define a line.", true);
      return;
    }
    try {
      if (currentPlaneId !== null) {
        await API.viewer.removeSectionPlanes([currentPlaneId]);
        currentPlaneId = null;
      }
      const added = await API.viewer.addSectionPlane(plane);
      if (Array.isArray(added) && added.length && typeof added[0].id === "number") {
        currentPlaneId = added[0].id;
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
    els.cancelDrawBtn.style.display = "";
    setStatus("Click two points in the 3D view to draw the section line\u2026");
    try {
      // Put the user in plan view so the line is naturally drawn in X/Y.
      await API.viewer.setCamera("top");
      await API.viewer.activateTool("lineMarkup", {
        instruction: "Click two points to define the cross-section line.",
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
    els.cancelDrawBtn.style.display = "none";
    try {
      await API.viewer.activateTool("reset");
    } catch (err) {
      console.error(err);
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
    // Z is intentionally discarded: the drawn line always defines a level
    // (Z = 0 reference) cut, regardless of what elevation was clicked on.

    els.x1.value = Math.round(x1);
    els.y1.value = Math.round(y1);
    els.x2.value = Math.round(x2);
    els.y2.value = Math.round(y2);

    await stopDraw();
    await applySection(x1, y1, x2, y2);
  }

  function wireControls() {
    els.drawBtn.addEventListener("click", startDraw);
    els.cancelDrawBtn.addEventListener("click", stopDraw);

    els.applyManualBtn.addEventListener("click", () => {
      const x1 = Number(els.x1.value);
      const y1 = Number(els.y1.value);
      const x2 = Number(els.x2.value);
      const y2 = Number(els.y2.value);
      if ([x1, y1, x2, y2].some((v) => Number.isNaN(v))) {
        setStatus("Please enter valid numbers for all four coordinates.", true);
        return;
      }
      applySection(x1, y1, x2, y2);
    });

    els.flipBtn.addEventListener("click", () => {
      flip = !flip;
      els.flipBtn.classList.toggle("active", flip);
      reapplyCurrent();
    });

    els.showHandles.addEventListener("change", reapplyCurrent);

    els.clearBtn.addEventListener("click", async () => {
      try {
        await API.viewer.removeSectionPlanes();
        if (currentMarkupId !== null) {
          await API.markup.removeMarkups([currentMarkupId]).catch(() => {});
        }
        currentPlaneId = null;
        currentMarkupId = null;
        lastLine = null;
        flip = false;
        els.flipBtn.classList.remove("active");
        els.flipBtn.disabled = true;
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
