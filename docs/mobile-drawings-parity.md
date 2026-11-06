# Mobile drawings & File Management — parity checklist

**Definition of done** for bringing admin-web's Drawing Viewer, drawing tagging
and File Management into the mobile app with full feature parity. Every row
must be marked done in Step 6 with a screenshot pair (web | app).

- Reference: admin-web branch `feature/drawing-viewer` (local only; **not on
  admin-web `main` and not deployed**). Files read: `components/drawings/*`,
  `components/files/*`, `app/(app)/files/**`, `app/(app)/projects/[projectId]/drawings/**`,
  `app/actions/drawings.ts`, `lib/data/drawings.ts`, `lib/data/files.ts`,
  `lib/data/sample-files.ts`, `lib/types/drawings.ts`, `lib/supabase/drawing-storage.ts`,
  `components/tasks/DrawingRevisionControl.tsx`.
- Built in the one app (`site-engineer-app`), not a separate branch.
- Status: Step 0 (inventory) — waiting for OK. Nothing built yet.

Legend for **App** column: *same* = same feature, same labels, phone layout
only; *adapted* = can't work identically on a phone, equivalent described
(see §4).

---

## 1. Data model (shared with the web — same tables, same storage)

| Table | Purpose | Key fields | Rows today |
|---|---|---|---|
| `drawings` | One sheet in the register | project_id, sheet_number (unique per project), title, discipline, base_drawing_id (department sheet drawn over a floor plan), consultant_name, consultant_email, response_days (default 3, 1–60), last_reminder_at, created_by_id | 5 |
| `drawing_versions` | Revisions R0, R1… | drawing_id, revision_number (unique per drawing), storage_path, file_name, file_size_bytes, change_note, based_on_version_id (which base-sheet revision a department sheet was drawn against), uploaded_by_id, uploaded_at | 6 |
| `drawing_tags` | Tagged areas (boxes) | drawing_id, page, name, layer (discipline), room, task_id, **x, y, width, height** | 11 |
| `drawing_tag_photos` | Site photos on a tag | tag_id, storage_path, caption, uploaded_by_id, uploaded_at | 8 |
| `documents` + `document_task_links` | Documents uploaded from the app, linked to tasks | title, storage_path, revision_label, document_date, uploaded_by | 0 |
| `dpr_entries`, `dpr_entry_photos` | DPR Submissions + DPR site photos (already owned by the app) | — | — |
| `drawing_revisions` | Older, separate feature: drawing revisions on a task's checklist item (max 5) | dependency_item_id, revision_number, file_url | 0 |

- **Disciplines (= departments = layers):** Architectural `#1A2230`, Structural `#8A6D46`,
  Electrical `#D9480F`, Plumbing `#1C7ED6`, HVAC `#0F9D8A`, Other `#7C3AED`.
- **Tag status (colour comes from the linked task, not stored on the tag):**
  Done `#15803D` (task completed) · In progress `#B45309` · Delayed `#DC2626`
  (blocked, on hold, or past due date) · Not started `#6B7280` · No task linked `#2563EB`.
- **Tag positions:** already **relative 0–1 of the page** (x, y, width,
  height + page number). Same spot on any screen size; no conversion and no
  data change needed. Minimum box 0.002 × 0.002.
- **Tags have no type, icon, comments, notes or own status field on the web.**
  Parity therefore means: name, layer, room/location, linked task, photos.
- **Storage:** bucket `project-drawings` (private, 50 MB limit, PDF/JPEG/PNG/WebP)
  holds drawing PDFs and tag photos; `project-documents` (25 MB, PDF/JPEG/PNG)
  holds documents; `dpr-photos` holds DPR photos. The web serves files through
  short-lived signed URLs created on its server.
- **Formats & sizes:** drawings are **PDF only** ("Only PDF drawings are
  supported for now"; DWG must be exported). Max 50 MB per PDF, 10 MB per photo
  (JPG/PNG/WebP). Live data is demo only: 5 single-page vector PDFs of 3–6 KB.
  Real architectural sheets are typically A1/A0 vector PDFs of 0.5–10 MB
  (scans up to 50 MB). The web draws each page on a canvas 2 400 px wide, and
  4 200 px when zoomed in: about **50 MB of memory per layer** at 4 200 px,
  ~250 MB with all layers or a comparison. Fine on a desktop; on a low-end
  Android phone that is the Flowchart crash again (see §4.1).

### Access today
- Web: drawings and File Management are used by **admin, manager and senior
  site engineer** (site engineers and clients are sent to their own pages;
  every drawing action checks those three roles on the server).
- Database: the 4 drawing tables have **RLS on with no policies** (only the web
  server can read them). Bucket `project-drawings` has no storage policies.
  So the app **cannot read any drawing data until access rules are added**
  (a shared data change — shown to you before applying, Step 1).

---

## 2. Drawing features

### 2.1 Drawing register (`/projects/[id]/drawings`, `DrawingsList.tsx`)

| # | Feature (web labels) | Web location | App |
|---|---|---|---|
| D1 | Breadcrumb Projects / project / File Management / Drawings; title "Drawings" | drawings/page.tsx | same (screen header + back) |
| D2 | Summary "N floor plans · M drawings", overdue count | DrawingsList | same |
| D3 | **Floor plan tabs** (one per base sheet, plus "Other drawings"), remembers `?floor=` | DrawingsList | same (horizontal scrolling tabs) |
| D4 | Department cards per floor: discipline colour, sheet number, title, "Base plan" label, latest "R1 · date" or "No PDF yet", "Open drawing →" | DrawingsList | same (list cards) |
| D5 | Consultant status badge: "Up to date", "Base sheet not issued", "Not issued / Out of date · due {date}", "… · N days overdue" | DrawingsList, lib/data/drawings `consultantStatus` | same (same rule: due = base revision upload + response days) |
| D6 | "New floor plan" form: Sheet number, Title, Department, Floor plan, Consultant, Consultant email, Days to reissue (1–60, default 3), First issue (R0) PDF (optional, ≤ 50 MB) | NewDrawingForm | same (bottom-sheet form, PDF from phone storage) |
| D7 | "Add department drawing" (same form, preset to the floor plan, default Electrical) | DrawingsList, viewer | same |
| D8 | Errors: "Sheet A-101 already exists in this project", "Only PDF drawings…", "PDF is larger than 50 MB", "Sheet created, but the PDF upload failed…" | actions/drawings.ts | same messages |
| D9 | Empty state "No drawings yet" (form opens) | DrawingsList | same |
| D10 | Delete drawing / edit details (server actions exist, **no button on the web**) | actions/drawings.ts | not shown (same as web) |

### 2.2 Viewer (`/projects/[id]/drawings/[drawingId]`, `DrawingViewer.tsx`, `DrawingCanvas.tsx`)

| # | Feature (web labels) | Web location | App |
|---|---|---|---|
| V1 | Title "A-101 · Ground Floor Plan", sub-line discipline · consultant · "drawn over {base}" (link) | DrawingViewer | same |
| V2 | Revision switcher "R0 · 4 Nov", "R1 · 5 Nov" (latest selected) | DrawingViewer | same (segmented chips) |
| V3 | "Upload R{n}" (next revision) | DrawingViewer | same |
| V4 | **Department switcher** "{floor}: All layers · Architectural A-101 · Electrical E-101 …" | DepartmentSwitcher | same (scrolling chips) |
| V5 | Hint line: "Scroll to zoom, drag to move. Click a box…" / tagging hint / compare result | DrawingViewer | adapted wording ("Pinch to zoom, drag to move. Tap a box…") |
| V6 | Zoom 0.2×–10×, zoom around cursor, drag to pan, "Fit", "Zoom in", "Zoom out", fit on first open | DrawingCanvas | adapted: pinch around fingers, double-tap zoom, same +/−/Fit buttons and limits |
| V7 | Sharp re-render when zoomed in, old render stays until the sharp one is ready ("Rendering drawing…") | DrawingCanvas | adapted: rendering method in §4.1 (never one giant bitmap) |
| V8 | Multi-page PDFs: "Page 1 of N" selector | DrawingViewer | same (page chips/selector) |
| V9 | **Show changes / Hide changes**: compare current revision with the previous one; green added, red removed, grey unchanged, numbered revision clouds "△ 1"; "N changed areas since R0 · green added, red removed"; "Sheet size changed since R0 — can't compare automatically"; disabled "Needs an earlier revision" | DrawingViewer, pdfRender `compare` | adapted (§4.2) |
| V10 | **+ Tag area / Cancel tagging** | DrawingViewer | same |
| V11 | Legend: Done / In progress / Delayed / Not started / No task linked with counts | DrawingViewer | same |
| V12 | "Updating…" while refreshing | DrawingViewer | same |
| V13 | "No PDF uploaded for this sheet yet." | DrawingCanvas | same |
| V14 | Esc cancels tagging / clears selection | DrawingViewer | adapted: Cancel button and Android back |
| V15 | Landscape | — | app extra (phone rotation) |

### 2.3 Layers panel

| # | Feature | Web location | App |
|---|---|---|---|
| L1 | "Layers" with "Show all" / "Hide others" | DrawingViewer side panel | same (Layers bottom sheet) |
| L2 | Row per sheet: colour bar, "A-101 · Architectural", "R1 · date" / "No PDF yet", checkbox | LayerRow | same |
| L3 | Consultant layers tinted in their discipline colour, laid over the base (paper transparent, multiply) | pdfRender `tint` | adapted (§4.3) |
| L4 | Base sheet fades (8 %) when its layer is off | DrawingCanvas | same |
| L5 | Layer row "R0 · on A-101 R0", "Not issued yet" (disabled) | DrawingViewer | same |
| L6 | Stale warning: "E-101 R0 was drawn on A-101 R0, so it may not match R1." | `staleNoteFor` | same |
| L7 | Tags on hidden layers are hidden | `layerHidden` | same |
| L8 | "+ Add department drawing" link | DrawingViewer | same |

### 2.4 Revisions panel

| # | Feature | Web location | App |
|---|---|---|---|
| R1 | "This sheet is behind the latest revision of A-101." + badge (on department sheets) | DrawingViewer | same |
| R2 | "Consultant drawing overdue" / "N consultant drawings overdue: E-101 (4d)… not yet updated for A-101 R1." | DrawingViewer | same |
| R3 | Per consultant sheet: status badge, consultant name, "reminded {date time}", "Upload E-101 R1", **"Send reminder"** ("Sending…", toast "Reminder sent to …", disabled with "Add a consultant email…") | DrawingViewer, `sendConsultantReminder` | same; email sent via an Edge Function (§4.6) |
| R4 | Revision history: "A-101 R1 · date", uploaded by, "on A-101 R0", "PDF" link, change note; tap to view that revision; "No revisions uploaded yet." | DrawingViewer | same ("PDF" opens/shares the file) |
| R5 | Upload revision dialog "Upload A-101 R2": Drawing PDF, "Drawn against A-101 R1 (latest)" (department sheets), "What changed? (optional)" ("First issue" / "e.g. Window W3 widened…"), toast "A-101 R2 uploaded" | UploadRevisionDialog | same (bottom sheet, PDF from phone) |

### 2.5 Tagging (`TagPanels.tsx`, `DrawingCanvas.tsx`)

| # | Feature | Web location | App |
|---|---|---|---|
| T1 | Tag boxes drawn on the sheet: status colour, dashed 2.5 px border, light fill; selected = solid 3.5 px; name label above (cut at 28 chars); constant on-screen size at any zoom | DrawingCanvas | same |
| T2 | Click a box → "Selected area" panel; empty texts "No areas tagged yet. Use "+ Tag area"…" / "Click a box on the drawing…" | DrawingViewer | same (bottom sheet; "Tap a box…") |
| T3 | Detail: name, status pill, Task (code + name, link to task), Status "In progress · due 12 Nov", Work, Layer, Location; stale-layer warning | TagDetail | same (task opens the app's task detail) |
| T4 | "Site photos (N)", "+ Add photos" (multiple, JPG/PNG/WebP ≤ 10 MB, "Uploading photo 1 of 3…"), 3-column grid with date-time, tap to open, × "Delete this photo?", "No photos for this area yet." | TagDetail | same; photos from camera or gallery, resized (H12) |
| T5 | "Edit" → "Edit tagged area" dialog | TagDetail | same |
| T6 | "Delete tag" → "Delete the tag "…" and its N photo(s)?", toast "Tag deleted" | TagDetail | same |
| T7 | Create: "+ Tag area" → drag a box (≥ ~12 px; "Draw a bigger box") → "Tag this area" dialog | DrawingCanvas, TagDialog | adapted: drag a box with one finger in tag mode (two fingers still pan/zoom) |
| T8 | Dialog fields: Name ("e.g. Window W3, Kitchen north wall", required, 200), **Layer** chips (visible layers first), "Room / location" with suggestions from existing rooms ("e.g. Kitchen"), "Linked task" grouped by work "code · name (status)" or "No task", note "The box takes its colour from this task's status and due date.", Cancel / "Save tag" ("Saving…"), toast "Area tagged" | TagDialog | same (bottom sheet; task picker is a searchable list grouped by work) |
| T9 | Server checks: task must be in this project, box minimum size | actions/drawings.ts | same (enforced in the database) |
| T10 | Moving or resizing a tag (**not on the web**: position is fixed after creation) | — | not added (parity); say if you want it |
| T11 | Tags list, filter chips, comments, tag types/icons (**not on the web**) | — | not added (parity) |
| T12 | Tags created in the app show on the web, and vice versa | — | app sees web changes live (Realtime, open drawing only); **web shows app changes on its next page load/refresh** (making the web live needs a web change, §4.7) |

### 2.6 Related drawing feature already in the app

| # | Feature | Web location | App |
|---|---|---|---|
| X1 | Task checklist "drawing revisions" (R1…R5 per checklist item, `drawing_revisions`) | components/tasks/DrawingRevisionControl.tsx | exists (`components/taskDetail/DrawingRevisionDrawer.tsx`); re-check in Step 6 |

---

## 3. File Management (`/files`, `/projects/[id]/files/**`)

| # | Feature (web labels) | Web location | App |
|---|---|---|---|
| F1 | "File Management": "Choose a project to see its drawings, DPR submissions, photos and documents.", project cards "Open files →", "No projects yet." | app/(app)/files/page.tsx | same via ProjectGate (selected project) |
| F2 | Project page "File Management — Everything for this project, organised in folders." | projects/[id]/files/page.tsx | same |
| F3 | **Project records** folders with counts: Drawings ("Architect & consultant sheets, revisions, layers and tagged areas"), DPR Submissions ("Daily progress reports from site, by date and task"), Site Photos ("Photos from DPRs and drawing areas, by work and task"), Documents ("Documents uploaded from the app, linked to tasks") | files/page.tsx, lib/data/files `getFilesOverview` | same (replaces the demo Files screen) |
| F4 | **Commercial** sample folders: Transmittal, RA Bills, Quotes (Comparative Quotes, Finalised Quotes) — hard-coded sample files, "Sample data" badge, "Sample file — for demonstration only" | [folder]/page.tsx, SampleFilesBrowser, lib/data/sample-files | same (same sample list and labels) |
| F5 | Sample folder filters "All departments" / "All floors", type badges PDF/DWG/XLSX/DOCX/IMG/FILE, "No files match these filters." | SampleFilesBrowser | same |
| F6 | **DPR Submissions**: newest day first, per task: Progress, Workforce (actual / target), Comment, "Waiting on:", Architect / Client remarks, By, Last saved, photos, link to task; "Filter by work" ("All works"); "DPR data could not be loaded." | files/dpr/page.tsx, `getDprSubmissions` | same |
| F7 | **Site Photos**: by work and task, newest first; sources DPR photos and drawing-tag photos (with area name and room); link to task | files/photos/page.tsx, `getSitePhotos` | same (replaces the app's device-local sample photos) |
| F8 | **Documents** table: Document, Revision, Date, Linked tasks, Uploaded; "Documents could not be loaded." | files/documents/page.tsx | same (list rows) |
| F9 | Open a file ("PDF" link, photo opens full size) | several | same (in-app image viewer; PDFs open with the viewer/share sheet) |
| F10 | Upload, rename, delete, versions, search, sort, share for general files (**not on the web**; only drawings have upload + revisions; documents are uploaded from the app, admin only) | — | no extra features (parity); the app's existing document upload stays admin-only |

---

## 4. What can't work identically on a phone — proposed equivalents

1. **Rendering (V6, V7).** The web uses pdf.js to draw the whole page on a
   2 400 / 4 200 px canvas. The app **has no way to draw a PDF today**:
   nothing installed can do it. Any option needs one new native library and a
   new Play build (e.g. a web view running the same pdf.js code, or a native PDF
   renderer), or pre-rendered image tiles. Either way, only the visible area is
   drawn sharp, never the whole sheet as one bitmap. Recommendation with
   memory and speed numbers in Step 1.
2. **Show changes (V9).** The web compares two revisions pixel by pixel in
   the browser. Same result on the phone (green/red, numbered clouds, same
   messages), computed at phone resolution (about 2 000 px wide instead of
   4 200), so a 1 px edit on a huge sheet may need zooming in to see. If the
   pdf.js web view is chosen, the web's own compare code runs unchanged.
3. **Tinted consultant layers (L3).** Needs per-pixel tinting and multiply
   blending. Same look with the pdf.js web view; with other renderers it needs
   pre-tinted images. Decided in Step 1.
4. **Hover tooltips, Esc key, mouse wheel, file chooser.** Become: subtitles
   or long-press, Cancel/back button, pinch, the phone's document picker,
   camera or gallery.
5. **Side panels and dialogs.** Become bottom sheets (Layers, Selected area,
   Revisions, Tag form, Upload form) and Alerts for confirmations.
6. **Send reminder (R3).** The web sends the email from its own server with the
   Resend key. The app can't call the web's server code, so the same email
   (same text, same "reminded" time) goes through a Supabase Edge Function that
   reads the key from Edge Function secrets. That function would be deployed by
   name only, after your OK.
7. **Web ↔ app sync (T12).** The app updates live from the web via Realtime.
   The web only reloads its data after its own actions, so the web shows a tag
   added on a phone when the page is reloaded. Live updates on the web need a
   web change, which this brief excludes.
8. **Permissions and server checks.** The web checks roles in its server code
   with a service key the app must never have. The app needs the same rules in
   the database: access rules on the 4 drawing tables and the
   `project-drawings` bucket, plus checks for "task is in this project",
   "base sheet in same project", revision numbering and the minimum box size.
   Shown to you as one migration in Step 1.

---

## 5. Decisions needed before Step 1

Your answers to the earlier (non-parity) brief conflict with "same
permissions and same features as the web" in four places:

| Topic | Earlier answer | Parity with web | Needs your choice |
|---|---|---|---|
| Site engineers | view + add tags & photos | no access to drawings or File Management | which one? |
| Offline downloads | yes, view + queue tags offline | the web has no offline | keep as an app extra (after parity) or drop? |
| Sample commercial folders | don't show | shown with "Sample data" badge | show (parity) or hide? |
| Upload, revisions, new sheets, reminders, compare | web only | all on the web | do all in the app (parity) — confirm |

Also confirm: the web drawing viewer is still only on admin-web's local
branch `feature/drawing-viewer`. The app will match that branch.
