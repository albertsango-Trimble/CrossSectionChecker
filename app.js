(() => {
  "use strict";

  const AXES = ["X", "Y", "Z"];

  const state = {
    X: { enabled: false, pos: 0, flip: false, id: null },
    Y: { enabled: false, pos: 0, flip: false, id: null },
    Z: { enabled: false, pos: 0, flip: false, id: null },
  };

  let API = null;
  const els = {};
  let debounceTimers = {};

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  function cacheEls() {
    AXES.forEach((axis) => {
      els[axis] = {
        slider: $(`.pos-slider[data-axis="${axis}"]`),
        number: $(`.pos-number[data-axis="${axis}"]`),
        flipBtn: $(`.flip-btn[data-axis="${axis}"]`),
        enableBtn: $(`.enable-btn[data-axis="${axis}"]`),
      };
    });
    els.showHandles = $("#showHandles");
    els.rangeMin = $("#rangeMin");
    els.rangeMax = $("#rangeMax");
    els.fitBtn = $("#fitBtn");
    els.clearBtn = $("#clearBtn");
    els.status = $("#status");
  }

  function setStatus(msg, isError) {
    els.status.textContent = msg || "";
    els.status.classList.toggle("error", !!isError);
  }

  function buildSectionPlane(axis) {
    const s = state[axis];
    const dir = s.flip ? -1 : 1;
    const plane = {
      directionX: axis === "X" ? dir : 0,
      directionY: axis === "Y" ? dir : 0,
      directionZ: axis === "Z" ? dir : 0,
      positionX: axis === "X" ? s.pos : 0,
      positionY: axis === "Y" ? s.pos : 0,
      positionZ: axis === "Z" ? s.pos : 0,
      controlsVisible: !!els.showHandles.checked,
    };
    return plane;
  }

  async function applyPlane(axis) {
    if (!API) return;
    const s = state[axis];
    try {
      if (s.id !== null) {
        await API.viewer.removeSectionPlanes([s.id]);
        s.id = null;
      }
      if (s.enabled) {
        const added = await API.viewer.addSectionPlane(buildSectionPlane(axis));
        if (Array.isArray(added) && added.length && typeof added[0].id === "number") {
          s.id = added[0].id;
        }
      }
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(`Failed to update ${axis} section plane.`, true);
    }
  }

  function applyAllVisibility() {
    AXES.forEach((axis) => {
      if (state[axis].enabled) applyPlane(axis);
    });
  }

  function debounced(key, fn, wait = 60) {
    clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(fn, wait);
  }

  function setUIEnabled(axis, enabled) {
    els[axis].slider.disabled = !enabled;
    els[axis].number.disabled = !enabled;
    els[axis].flipBtn.disabled = !enabled;
    els[axis].enableBtn.classList.toggle("active", enabled);
  }

  function wireAxis(axis) {
    const { slider, number, flipBtn, enableBtn } = els[axis];

    enableBtn.addEventListener("click", () => {
      const s = state[axis];
      s.enabled = !s.enabled;
      setUIEnabled(axis, s.enabled);
      applyPlane(axis);
    });

    slider.addEventListener("input", () => {
      const val = Number(slider.value);
      state[axis].pos = val;
      number.value = val;
      debounced(`pos-${axis}`, () => applyPlane(axis));
    });

    number.addEventListener("change", () => {
      let val = Number(number.value);
      if (Number.isNaN(val)) val = 0;
      const min = Number(els.rangeMin.value);
      const max = Number(els.rangeMax.value);
      val = Math.min(max, Math.max(min, val));
      state[axis].pos = val;
      slider.value = val;
      number.value = val;
      applyPlane(axis);
    });

    flipBtn.addEventListener("click", () => {
      state[axis].flip = !state[axis].flip;
      flipBtn.classList.toggle("active", state[axis].flip);
      applyPlane(axis);
    });
  }

  function applyRangeToSliders() {
    const min = Number(els.rangeMin.value);
    const max = Number(els.rangeMax.value);
    AXES.forEach((axis) => {
      els[axis].slider.min = min;
      els[axis].slider.max = max;
      if (state[axis].pos < min || state[axis].pos > max) {
        const clamped = Math.min(max, Math.max(min, state[axis].pos));
        state[axis].pos = clamped;
        els[axis].slider.value = clamped;
        els[axis].number.value = clamped;
        if (state[axis].enabled) applyPlane(axis);
      }
    });
  }

  function wireGlobalControls() {
    els.showHandles.addEventListener("change", applyAllVisibility);

    els.rangeMin.addEventListener("change", applyRangeToSliders);
    els.rangeMax.addEventListener("change", applyRangeToSliders);

    els.clearBtn.addEventListener("click", async () => {
      try {
        await API.viewer.removeSectionPlanes(); // no id => removes all planes in the viewer
        AXES.forEach((axis) => {
          state[axis].enabled = false;
          state[axis].pos = 0;
          state[axis].flip = false;
          state[axis].id = null;
          els[axis].slider.value = 0;
          els[axis].number.value = 0;
          els[axis].flipBtn.classList.remove("active");
          setUIEnabled(axis, false);
        });
        setStatus("All section planes cleared.");
      } catch (err) {
        console.error(err);
        setStatus("Failed to clear section planes.", true);
      }
    });

    els.fitBtn.addEventListener("click", fitRangeToModel);
  }

  async function fitRangeToModel() {
    if (!API) return;
    setStatus("Calculating model bounds\u2026");
    els.fitBtn.disabled = true;
    try {
      const modelObjectSets = await API.viewer.getObjects();
      if (!modelObjectSets || !modelObjectSets.length) {
        setStatus("No loaded model objects found. Load a model first.", true);
        return;
      }

      let min = { x: Infinity, y: Infinity, z: Infinity };
      let max = { x: -Infinity, y: -Infinity, z: -Infinity };
      let found = false;

      for (const modelObjects of modelObjectSets) {
        const ids = (modelObjects.objects || [])
          .map((o) => o.id)
          .filter((id) => typeof id === "number");
        if (!ids.length) continue;

        // Avoid overly large single calls on huge models.
        const chunkSize = 2000;
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const boxes = await API.viewer.getObjectBoundingBoxes(modelObjects.modelId, chunk);
          for (const b of boxes || []) {
            if (!b || !b.boundingBox) continue;
            const { min: bmin, max: bmax } = b.boundingBox;
            if (!bmin || !bmax) continue;
            found = true;
            min.x = Math.min(min.x, bmin.x);
            min.y = Math.min(min.y, bmin.y);
            min.z = Math.min(min.z, bmin.z);
            max.x = Math.max(max.x, bmax.x);
            max.y = Math.max(max.y, bmax.y);
            max.z = Math.max(max.z, bmax.z);
          }
        }
      }

      if (!found) {
        setStatus("Couldn't determine model bounds.", true);
        return;
      }

      const overallMin = Math.min(min.x, min.y, min.z);
      const overallMax = Math.max(max.x, max.y, max.z);
      const padding = (overallMax - overallMin) * 0.05 || 500;

      els.rangeMin.value = Math.floor(overallMin - padding);
      els.rangeMax.value = Math.ceil(overallMax + padding);
      applyRangeToSliders();

      setStatus("Range fitted to loaded model bounds.");
    } catch (err) {
      console.error(err);
      setStatus("Failed to compute model bounds.", true);
    } finally {
      els.fitBtn.disabled = false;
    }
  }

  async function init() {
    cacheEls();
    AXES.forEach(wireAxis);
    wireGlobalControls();

    setStatus("Connecting to Trimble Connect\u2026");
    try {
      API = await TrimbleConnectWorkspace.connect(window.parent, (event, data) => {
        // React to relevant workspace events if needed.
        if (event === "extension.command" && data === "close") {
          // Extension is being closed/removed by the host.
        }
      }, 5000);
      setStatus("Ready. Toggle X, Y or Z to add a cutting plane.");
    } catch (err) {
      console.error(err);
      setStatus("Could not connect to Trimble Connect. Open this app as a 3D Viewer extension.", true);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
