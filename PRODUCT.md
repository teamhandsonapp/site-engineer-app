# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

- **Primary: site engineers and admins** (confirmed 2026-11-19). Site engineers (and senior site engineers) work on construction sites, mostly on phones, often outdoors in bright sunlight and in a hurry. Their daily job: daily progress reports (DPR), checklists, workers attendance, site alerts, drawings and site photos. Admins (the PMC office head) create accounts and projects, keep the company Contact Book, approve DPR edit requests and watch every project.
- **Also in the app** (from the client guide, `docs/app-flow-and-client-inputs.md`): managers (plan tasks and schedules, run MoM meetings, send alerts, read reports) and clients (follow progress, answer approval requests, read reports; a client account belongs to exactly one project).

## Product Purpose

PMC Portal is the mobile app a construction project management consultancy (PMC) uses to run its projects day to day: the task flowchart and schedule, DPR and PR progress reporting, pre-construction and quality checklists, workers attendance, alerts, drawings and files, meetings (MoM) and status reports. It exists so the office and the client can see true site progress and what is causing delay, from reports filled on site.

## Positioning

Open decision (asked 2026-11-19, not yet answered): whether PMC Portal is a custom build for one PMC company or a product for many PMC firms, each with its own name and logo. Do not claim either until this is answered.

## Operating Context

- Used on phones at construction sites, often outdoors in sunlight and in a hurry; portrait only, light theme.
- A separate admin website (the `admin-web` repo) covers office work; site engineers use only this app.
- Daily rhythm: one DPR per task per planned day. DPR and PR open only after a task's pre-construction checklist is complete. Task status is worked out from planned dates and submitted DPRs (India time; Sundays and holidays skipped).
- Current live project: ROAST @ Kokapet (Hyderabad).
- Distribution: Google Play closed test now; the App Store (iPhone) is planned and uses the same design.

## Capabilities and Constraints

- Existing codebase: Expo / React Native with expo-router, NativeWind styling, Supabase backend, Cloudflare R2 for files.
- Roles: Admin, Manager, Senior Site Engineer, Site Engineer, Client. Menus and screens differ by role.
- Terminology to keep: DPR (Daily Progress Report), PR (Progress Report), MoM, Flowchart (tabs: Current Status, 56 Tasks, Copy, Main Flowchart), pre-construction checklist (items Issued / Not Required), Reasons for Delay (Architect, Client, Consultant, Contractor, Vendor, Other), task statuses (Yet to Start, Delayed, In Progress, On Hold, Completed).
- Language: English only.
- Some areas still show sample data (e.g. the Notifications list); sample data must stay clearly marked.

## Brand Commitments

- Name: PMC Portal. Logo: rounded badge with a building glyph (`components/Logo.tsx`, `assets/icon.png`).
- Brand colour: the safety orange from the app logo (stated by the user, 2026-11-19).

## Evidence on Hand

- Client guide: `docs/app-flow-and-client-inputs.md`. Formats: `docs/DPR-Format.pdf`, `docs/PR-Format.pdf`.
- Real project data for ROAST @ Kokapet in Supabase.
- No testimonials, customer logos, usage metrics or pricing are on hand; do not invent them.

## Product Principles

1. Built for the site: fast, one-handed, readable in sunlight.
2. Today's work and what is blocking it come first.
3. Truth over decoration: statuses come from real dates and reports, and sample data is always labelled.
4. Each role sees what it can act on.

## Accessibility & Inclusion

- Outdoor use: high contrast and tap targets of at least 48px (stated by the user for the Home screen, 2026-11-19).
- Text scaling is capped at 1.3× across the app (`components/ui/AppText.tsx`).
