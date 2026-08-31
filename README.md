# Cross Section Viewer — Trimble Connect 3D Extension

A lightweight extension for the Trimble Connect for Browser 3D Viewer that lets
you slice the loaded model along the X, Y and Z axes with live sliders,
independent of the built-in section box tool.

## What it does

- Toggle an axis-aligned cutting plane on X, Y and/or Z independently.
- Drag a slider (or type an exact value in millimeters) to move each plane
  through the model in real time.
- Flip the cut direction per axis with the ⇄ button.
- Show/hide the on-screen plane handles.
- "Fit to model" automatically sets the slider range to the loaded model's
  bounding box.
- "Clear all sections" removes every section plane currently in the viewer.

## How it works

It's a plain HTML/JS page that loads the `trimble-connect-workspace-api`
IIFE bundle and talks to the 3D Viewer's `ViewerAPI`:

- `viewer.addSectionPlane(plane)` — adds a plane defined by a
  `directionX/Y/Z` unit vector and a `positionX/Y/Z` point (mm) on the plane.
- `viewer.removeSectionPlanes([id])` — removes a specific plane by the id
  returned from `addSectionPlane`.
- `viewer.removeSectionPlanes()` — removes all section planes (used by
  "Clear all").
- `viewer.getObjects()` + `viewer.getObjectBoundingBoxes()` — used by
  "Fit to model" to compute the overall model bounds.

Because the API only supports add/remove (no in-place update), moving a
slider removes the previous plane for that axis and adds a new one. Slider
drags are debounced (~60ms) so this stays smooth.

## Files

- `index.html` — UI markup and styling.
- `app.js` — all extension logic (connects via `TrimbleConnectWorkspace.connect`).
- `manifest.json` — the extension manifest Trimble Connect needs to install it.

## Hosting & installing

1. Host these three files (plus an optional icon) on any HTTPS static host
   you control (e.g. GitHub Pages, Netlify, S3 + CloudFront, Azure Static
   Web Apps). CORS/framing: the page must be allowed to run inside an
   iframe (don't set `X-Frame-Options: DENY` / a restrictive
   `frame-ancestors` CSP), since Trimble Connect loads it in an iframe.
2. Edit `manifest.json` and replace `YOUR_HOSTING_DOMAIN` with your real
   domain (or drop the `icon`/`infoUrl` fields if you don't have those
   yet — only `title` and `url` are required).
3. Host `manifest.json` itself somewhere reachable too (it can live next to
   the other files).
4. In Trimble Connect for Browser: open a project → **Settings → Extensions**
   → add extension → paste the URL to your `manifest.json` → Add.
5. The extension will appear as a menu item / side panel. Open the 3D Viewer
   with a model loaded, then open the extension panel.

## Notes / limitations

- Position values are in millimeters, consistent with the `SectionPlane`
  API (`positionX/Y/Z`).
- "Clear all sections" removes *every* section plane in the viewer,
  including ones added by other tools — by design, per the API
  (`removeSectionPlanes()` with no arguments clears all).
- "Fit to model" only considers objects from currently **loaded** models
  (via `getObjects()`); load the models you want to section before using it.
- No build step or dependencies — it's plain HTML/CSS/JS, so you can edit
  and redeploy directly.
