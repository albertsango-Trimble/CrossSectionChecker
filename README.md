# Cross Section Viewer — Trimble Connect 3D Extension

A lightweight extension for the Trimble Connect for Browser 3D Viewer that lets
you slice the loaded model along the X, Y and Z axes with live sliders,
independent of the built-in section box tool.

## What it does

- Click **"Draw section line"**, then click two points directly in the 3D
  view to define a cutting line in plan (X/Y). The camera automatically
  snaps to a top-down view first so you're drawing in true plan.
- Whatever elevation (Z) the clicks land on is discarded — the cut is
  always a perfectly vertical plane through that line, so it shows
  everything the line crosses at every height, like a standard building
  section.
- A manual entry form (X1/Y1/X2/Y2 in millimeters) is available as a
  fallback if you'd rather type exact coordinates than click.
- **⇄** flips which side of the line gets cut away.
- **Show plane handles** toggles the on-screen gizmo/border.
- **Clear section** removes the plane (and the line markup used to define it).

## How it works

It's a plain HTML/JS page that loads the `trimble-connect-workspace-api`
IIFE bundle and talks to the Workspace API:

- `viewer.setCamera("top")` — snaps to plan view before drawing, so clicks
  naturally define an X/Y line.
- `viewer.activateTool("lineMarkup", options)` — activates Trimble
  Connect's built-in line-drawing tool so the user can click two points
  directly in the 3D view.
- The `viewer.onMarkupChanged` event fires when the line is completed,
  delivering a `LineMarkup` with `start`/`end` points (`positionX/Y/Z` in
  mm). Only the X/Y coordinates are used — Z is intentionally ignored so
  the cut is always level regardless of what surface was clicked.
- From the two (x, y) points, the extension computes a horizontal unit
  normal perpendicular to the line (`directionZ` is always 0, keeping the
  plane vertical) and calls `viewer.addSectionPlane(plane)` with that
  normal and the line's midpoint as the position.
- `viewer.removeSectionPlanes([id])` / `removeSectionPlanes()` — removes
  the current plane, or everything, on "Clear section".
- `markup.removeMarkups([id])` — cleans up the line markup once its job
  (defining the cut) is done.

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
