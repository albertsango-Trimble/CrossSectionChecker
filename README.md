# Cross Section Viewer — Trimble Connect 3D Extension

A lightweight extension for the Trimble Connect for Browser 3D Viewer that
generates a vertical cutting plane through a line — either drawn by hand in
plan, or picked out as a chainage along an uploaded alignment — so you get
a proper cross-section through the model at that location.

## What it does

- Click **"Draw section line"**, then click two points directly in the 3D
  view to define a cutting line in plan (X/Y). The camera automatically
  snaps to a top-down view first so you're drawing in true plan.
- Click **Done** in Trimble Connect's own top toolbar once you've placed
  both points (this is how Trimble Connect's line-drawing tool commits a
  line — the extension can't skip this step).
- Click **"Use drawn line"** in the extension panel to fetch that finished
  line and turn it into a section. Whatever elevation (Z) the two clicks
  landed on is discarded — the cut is always a perfectly vertical plane
  through the line, so it shows everything the line crosses at every
  height, like a standard building section.
- **Alignment / chainage**: upload a CSV alignment (or pick one you've used
  before), then drag a chainage slider to generate a section perpendicular
  to the alignment at that exact point along it — the standard way
  road/rail cross-sections are picked out. This is the tool for that
  workflow instead of typing raw coordinates.
- **⇄** flips which side of the line gets cut away.
- **Show plane handles** toggles the on-screen gizmo/border.
- **Slice thickness (mm)** controls how thick the cut is (default 10mm) —
  see below.
- **Clear section** removes the plane (and the line markup used to define it).
- **Views**: "Top view" and "Section view" snap the single 3D camera
  between plan and a computed front-on look at the current cutting plane.
  "Capture split view" grabs a still image of each and shows them stacked
  in the panel, one above the other, as a plan/section reference pair.

## Using the alignment / chainage feature

1. Under **Alignment**, click **"Upload CSV…"** and pick a file. Expected
   format: a header row of `station,x,y`, or just `x,y` if you don't have
   stations (they'll be computed as cumulative distance along the points).
   One point per row, comma-separated. Set the units dropdown to match
   your file (meters or millimeters) before uploading.
2. The alignment is saved in your browser (`localStorage`) under its
   filename, so it stays in the **alignment picker dropdown** for next
   time — no need to re-upload. Use the 🗑 button to delete one you no
   longer need.
3. Once loaded, the extension draws the alignment's centerline into the
   3D view as a reference polyline, and shows a **chainage slider**.
   Drag it (or type an exact value in the millimeter field) to move along
   the alignment; a section plane perpendicular to the alignment is
   generated live at that point.
4. **Half-width** controls how far the cutting line extends to each side
   of the alignment (in mm) — effectively how wide a "window" the section
   plane covers, since a plane is infinite in the API but the alignment's
   local direction only makes sense near that chainage.

Note: this is a general-purpose CSV-based alignment, not a live link to a
specific alignment/road design object in your Trimble Connect project —
the Workspace API doesn't expose civil alignment geometry directly, so
exporting your alignment's points to CSV is the practical bridge.

## Slice thickness

By default the section isn't a single infinite cutting plane (which would
just clip away everything on one side and leave the model looking cut in
half) — it's a thin **slab**, 10mm thick by default. This is built from
**two** opposing section planes, offset by half the thickness on either
side of the drawn/chainage line:

- A "near" plane facing one way, positioned half the thickness back from
  the line.
- A "far" plane facing the opposite way, positioned half the thickness
  forward.

Only the material between the two planes stays visible — everything else,
on both sides, is clipped away. This gives you a true thin cross-section
slice rather than a half-model cutaway. Change the **Slice thickness (mm)**
field any time to make the slab thicker or thinner; it regenerates the
section immediately.

## A note on "split screen"

Trimble Connect extensions only get one shared camera on one embedded 3D
scene — there's no API for rendering two independent, live, orbitable
viewports side by side inside the native 3D viewer. What this extension
gives you instead:

- **Top view / Section view** buttons that instantly snap the single
  camera to either perspective, so switching back and forth is one click.
- **Capture split view**, which takes a snapshot at each camera position
  and displays both images stacked in the extension's side panel. This is
  a static pair of images (not a live view) but it gives you the
  plan-over-section reference layout in one glance; click the button
  again any time to refresh it.

## How it works

It's a plain HTML/JS page that loads the `trimble-connect-workspace-api`
IIFE bundle and talks to the Workspace API:

- `viewer.setCamera("top")` — snaps to plan view before drawing, so clicks
  naturally define an X/Y line.
- `viewer.activateTool("lineMarkup", options)` — activates Trimble
  Connect's built-in line-drawing tool so the user can click two points
  directly in the 3D view.
- `markup.getLineMarkups()` — called once when drawing starts (to record
  existing line ids) and again when the user clicks "Use drawn line", so
  the extension can pick out the newly finished line by id. This is the
  primary, reliable path, since it doesn't depend on any event firing.
- `viewer.onMarkupChanged` is also wired up as a bonus fast-path: if it
  does fire with a completed `lineMarkup`, the extension applies the
  section immediately without needing "Use drawn line".
- Only the X/Y coordinates of any line (drawn or from an alignment
  chainage) are used — Z is intentionally ignored so the cut is always
  level.
- From the two (x, y) endpoints, the extension computes a horizontal unit
  normal perpendicular to the line (`directionZ` is always 0, keeping the
  planes vertical) and calls `viewer.addSectionPlane([nearPlane, farPlane])`
  with **two** opposing planes offset by half the slice thickness on
  either side of the line's midpoint, so only the thin slab between them
  stays visible (see "Slice thickness" above).
- The alignment CSV is parsed client-side, converted to millimeters, and
  stored in `localStorage`. Moving the chainage slider interpolates a
  point and local tangent direction along the alignment's polyline, then
  builds a perpendicular line of the chosen half-width around that point
  — fed through the same `applySection()` used by the draw/click workflow.
- `markup.addLineMarkups(segments)` — draws the alignment's full polyline
  as a chain of line-markup segments for visual reference.
- For the section-view camera, the extension builds a `Camera` object
  (`position`/`lookAt`/`upDirection`, all in **meters** — note this differs
  from the section plane's millimeter units) placed back along the plane's
  normal from the line's midpoint, looking at it with Z-up.
- `viewer.getSnapshot()` — returns a data URL PNG of whatever the camera
  is currently looking at; used for "Capture split view".
- `viewer.removeSectionPlanes([ids])` / `removeSectionPlanes()` — removes
  the current pair of planes, or everything, on "Clear section".
- `markup.removeMarkups([ids])` — cleans up line markups (the drawn cut
  line, or the alignment reference polyline) once no longer needed.

## Known limitations

- The section-view camera direction is a best-effort calculation. If it
  ends up facing the wrong way (looking away from the model instead of at
  it), just orbit manually, or click "Section view" again after flipping
  the cut direction (⇄) — both computations share the same normal.
- "Capture split view" waits 400ms after each camera move before taking
  the snapshot to let the scene render; on a very large model this may
  not be quite enough time and the image could show it mid-transition. If
  that happens, just click the button again.
- Alignments are stored in the browser's `localStorage`, so they're local
  to that browser/device — they aren't shared across users or synced to
  the Trimble Connect project. Re-upload the CSV on another machine if
  needed.
- Position values for section planes and markups are in millimeters,
  consistent with the `SectionPlane` and `LineMarkup` APIs.

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
