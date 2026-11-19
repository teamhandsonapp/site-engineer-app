---
version: 1
slug: "app-authenticated-home-tsx"
primary_target: "app/(authenticated)/home.tsx"
related_targets: ["components/home/AppHome.tsx"]
---

## Scope

Staff Home screen (`components/home/AppHome.tsx`, shown by `app/(authenticated)/home.tsx`). Mode: Operate. Client Home, the bottom tab bar, the side menu and shared navigation files are out of scope.

## Audience and job

Site engineers and admins (also managers), on phones at the site, outdoors, in a hurry. Job: see the selected project's work for today and act on it in one tap.

## Constraints

48px+ tap targets, high contrast outdoors, sentence-case headings, one accent (logo orange), red only for critical items, grey icons from the app's Ionicons set (no emoji). Loading placeholders, grey zero states with a short message, a clear error with Retry, pull-to-refresh. Placeholder data only where real data is missing, marked in code.

## Direction contract

THESIS: Home is today's site sheet for one project, not a launcher. It refuses the default greeting plus rainbow tile grid of shortcuts that repeat the tab bar and menu.

OWN-WORLD: The incumbent PMC Portal world: navy #0F1F33 bar and ink, white cards on #F6F7F9, IBM Plex Sans, grey outline Ionicons. Logo orange #F0A227 appears only on the DPR action, the DPR progress bar and the current-project mark; red #DC2626 only on open critical alerts and overdue.

STORY: The user sees which project they are on, how much of today's DPR is done, and what is holding the site back (critical alerts, checklist, workers, delayed tasks). Admins and managers also see what waits on them or on the client. Every number opens the screen that fixes it.

FIRST VIEWPORT: Navy app bar: menu, project name with chevron as the title (opens Switch project), bell. Body: date and greeting in small type, then the Today's DPR card (count, orange progress bar, full-width 52px orange "Submit today's DPR" while anything is unsubmitted), then the "Today on site" list of four 56px rows with the number on the right.

FORM: Grouped Material list rows under sentence-case headings, position 1 of 1; seed: none (pinned) "Approved, with these changes: 1. Remove the "→" from the Submit button text. 2. "Waiting on client" isn't an approval. 3. Use the app's existing icon set for all rows, not emoji. 4. Add loading, empty and error states."

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

Whether Home should later get a light app bar for sunlight; kept navy for consistency with every other screen (user, 2026-11-19).
