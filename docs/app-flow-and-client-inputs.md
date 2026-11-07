# PMC Portal: how it works and what we need from you

This guide explains how PMC Portal is set up for a new project, how it is used every day, and exactly what information we need from you.

It describes the system as it is today (checked on 7 November 2026). Where something still shows sample data or is not switched on yet, we say so clearly.

---

## Before you start

### The two parts of PMC Portal

| Part | Who uses it | What it is for |
|---|---|---|
| **Mobile app** (Android phones) | Site engineers, managers, admin, clients | Daily site work: attendance, daily progress reports, checklists, alerts, drawings, meetings, reports |
| **Admin website** (computer browser) | Admin, managers, senior site engineers, and clients (a separate client page) | Office work: setting up projects, departments, tasks, schedules, checklists, attendance review, reports |

Site engineers do not use the admin website. If they log in there, they see a message asking them to use the mobile app.

### Who's who (roles)

| Role | Typical person | Uses | Main jobs |
|---|---|---|---|
| **Admin** | PMC office head | Website + app | Creates user accounts, sets up projects, keeps the company Contact Book, approves DPR edit requests, invoices |
| **Manager** | Project manager | Website + app | Plans tasks and schedules, reviews checklists, runs meetings (MoM), sends alerts, reads reports. Cannot create user accounts. |
| **Senior Site Engineer** | Lead engineer on site | App (+ website) | Same daily app work as a site engineer, plus full use of the admin website |
| **Site Engineer** | Engineer on site | App only | Attendance, daily progress reports (DPR), checklists, reporting site issues, drawing tags and photos |
| **Client** | Owner / client representative | App (+ client page on website) | Answers approval requests, follows progress, reads reports |

### What the status labels mean

- **✅ Live**: working with your real information.
- **🟡 Partly live**: works, but with the limits we describe.
- **🧪 Demo**: shows sample information for now, not your real data.
- **⏳ Not live yet**: built, but switched off or waiting on setup.

---

## Part 1: Setting up a project (in order)

Do these steps in this order. Some steps depend on earlier ones. For example, every new task copies the checklist, so the checklist must be ready before tasks are created.

### Step 1: User accounts and roles

- **Who:** Admin.
- **Where:** Admin website (Access), or mobile app (Access & Roles).
- **What it's for:** every person gets their own login and role. The role decides what they can see and do.
- **Status:** 🟡 Partly live. Creating accounts works. Email invitations are currently sent from a test address and may not arrive. Until your email domain is connected (Step 2), we create accounts with a password and share it with each person.

**What we need from you, for each person:**

| Field | Required? | Example | Notes |
|---|---|---|---|
| Full name | Required | Ravi Kumar | 2 to 100 characters |
| Email address | Required | ravi@yourcompany.com | This is their login. Must be different for every person. |
| Phone number | Optional | 98765 43210 | |
| Role | Required | Site Engineer | Admin, Manager, Senior Site Engineer, Site Engineer or Client |
| Project | Required for clients only | Elmwood Villas | A client account belongs to exactly one project, so client accounts are made after Step 4 |
| Projects they work on | Recommended for engineers | Elmwood Villas | Sets which project opens by default for them |

**Good to know:**
- Passwords must have at least 8 characters, with at least one letter and one number.
- A name, email or phone number cannot be changed from the screens after the account is created. Tell us and we will correct it.
- Only an admin can create accounts. A manager can see the user list but cannot add people.

### Step 2: Company settings

- **Who:** our team.
- **Where:** set up by us. There is no company settings page yet.
- **What it's for:** your company name and logo, and sending emails (such as invitations and reports) from your own email address.
- **Status:** ⏳ Not live yet. The system currently shows "PMC Portal" everywhere and sends email from a test address.

**What we need from you:**

| Item | Required? | Example |
|---|---|---|
| Company name as it should appear | Required | Acme Constructions Pvt Ltd |
| Logo | Optional | PNG file, square, at least 512 × 512 pixels |
| Email address to send from | Required for email features | updates@acmeconstructions.in |
| Access to your email domain settings (your IT person) | Required for email features | So we can verify the sending address |

### Step 3: Working days and holidays

- **Who:** Admin or Manager (our team can do this for you).
- **Where:** Admin website (Holiday calendar).
- **What it's for:** working days are used to work out task end dates, delays and procurement deadlines. Holidays are skipped.
- **Status:** 🟡 Partly live.
  - Holidays apply to all projects together, not one project at a time.
  - The calendar is currently set up for the year 2026 only.
  - Sunday is treated as the weekly off day in the mobile app.

**What we need from you:**

| Field | Required? | Example |
|---|---|---|
| Holiday name | Required | Diwali |
| Date | Required | 08-11-2026 |
| Type | Optional | National, Festival, Regional or Company shutdown |
| Weekly off day(s) | Required | Sunday (tell us if yours is different) |

### Step 4: Create the project

- **Who:** Admin (mobile app: Projects → Add New Project), or Admin / Manager / Senior Site Engineer (admin website: Projects → New).
- **Where:** Admin website or mobile app.
- **What it's for:** everything else (departments, tasks, attendance, reports) belongs to a project.
- **Status:** ✅ Live.

**What we need from you:**

| Field | Required? | Example | Used for |
|---|---|---|---|
| Project name | Required | Elmwood Villas | Shown everywhere |
| Site address | Optional | Plot 12, Kokapet, Hyderabad | Project details |
| Area / size | Optional | 3,475 sq ft | Project details |
| Budget | Optional | ₹2.4 crore | Project details |
| Cover photo | Optional | A site photo | Project card |
| Total built-up area in SFT | Recommended | 2500 | Progress % in the client's Project Progress card |
| Site location | Recommended | A full Google Maps link to the site gate | Attendance location check (see note) |
| Attendance radius | Optional | 60 metres | How close to the site counts as "on site" (5 to 5000 m) |
| Number of floors | Optional | 3 | Project details |
| Number of rooms | Optional | 12 | Project details |
| Site working hours | Required | 9:00 AM to 6:00 PM | Attendance: late arrival and early leaving |
| Show workforce numbers on reports? | Optional | Yes / No | Task reports |

**Good to know:**
- Please send the **full** Google Maps link. The short "maps.app.goo.gl" links do not work.
- Location checking during attendance is **switched off** in the current app version (⏳). We still recommend sending the site location now, so it is ready when it is switched back on.
- Site working hours are fixed at 9:00 AM to 6:00 PM unless you ask us to change them. There is no screen to change them yourself.
- The project does not store a client name or start/end dates. Dates come from the tasks (Step 10).

### Step 5: Departments (trades)

- **Who:** Admin, Manager or Senior Site Engineer.
- **Where:** Admin website (project → Add Work). The mobile app's project Settings also lists departments.
- **What it's for:** every task belongs to a department, such as Civil Works, Electrical or Plumbing. Reports, alerts and schedules are grouped by department.
- **Status:** ✅ Live.

**What we need from you, for each department:**

| Field | Required? | Example | Notes |
|---|---|---|---|
| Department name | Required | Electrical | |
| Short code | Required | ELEC | 2 to 10 letters or numbers. Must be different across **all** your projects, so a second project might use ELEC2. Task numbers start with this code (for example ELEC-000123). |
| Description | Optional | Wiring, DBs, fixtures | |
| Colour | Optional | Blue | Used on charts |
| Matching standard trade | Required | Electrical | From the list below. Our team links it. |

**Standard trades and AC / AV.** Each department is matched to a standard trade. The trade decides whether its tasks are **AC** or **AV**:
- **AC (consultant-led):** the task needs Architect, Consultant and Contractor inputs.
  - Trades: Civil Execution (Structural Consultant), HVAC, Electrical, Plumbing, Lighting, Automation, AV (Audio & Video) Consultant, Landscape, Waterbody Consultant.
- **AV (vendor-led):** the task needs Architect and Contractor/Vendor (procurement) inputs.
  - Trades: Flooring, Dado/Cladding, Paints, Furniture, Soft Furnishing, False Ceiling, Sanitary Fixtures.

If you need a trade that is not in this list, tell us and we will add it.

### Step 6: Floors, rooms and areas

- **Who:** Admin or Manager (our team sets up the photo locations).
- **Where:** mobile app project Settings (number of floors and rooms), Drawings (one floor plan per floor), and site photo tagging (Floor → Room → Wall).
- **What it's for:** finding drawings by floor, and tagging site photos to the exact place they were taken.
- **Status:** 🧪 Demo.
  - The Floor → Room → Wall list used for tagging photos is currently a fixed sample list (Foundation, Ground Floor, First Floor, Second Floor, Terrace).
  - Tasks do not yet have their own floor or room field.

**What we need from you:**

| Field | Required? | Example |
|---|---|---|
| List of floors / levels | Required | Basement, Ground Floor, First Floor, Terrace |
| Rooms or areas on each floor | Recommended | Ground Floor: Living, Kitchen, Bedroom 1, Bath 1 |
| How you name walls (if you tag photos by wall) | Optional | Wall A / B / C / D, clockwise from the door |

### Step 7: Contacts (architect, client, consultant, contractor, vendor)

There are two address books. Both are ✅ Live.

**Contact Book (company-wide).**
- **Who:** Admin only.
- **Where:** mobile app.
- **What it's for:** your master list of every outside party. Used for meeting invitations, "Follow up with" cards in the status reports, and sharing contacts on WhatsApp.

**Specific Book (per project).**
- **Who:** all staff.
- **Where:** mobile app.
- **What it's for:** the people working on one project.
- Managers can see only the Specific Book, not the Contact Book. To invite someone to a meeting, add them to that project's Specific Book.

**What we need from you, for each contact:**

| Field | Required? | Example |
|---|---|---|
| Name | Required | Anil Mehta |
| Phone number | Required | 98480 12345 |
| Alternate phone | Optional | 040 2345 6789 |
| Email | Optional | anil@mehtaarchitects.in |
| Company | Optional | Mehta Architects |
| Category / role | Required | Architect, Client, Consultant, Contractor, Vendor or Other |
| Which project(s) | Required | Elmwood Villas, or "All projects" |
| Office location link | Optional | Google Maps link |
| Notes | Optional | Handles lighting design |

### Step 8: Checklists (prerequisites and quality)

**Prerequisite checklist (master list).**
- **Who:** Admin, Manager or Senior Site Engineer.
- **Where:** Admin website (Dependencies page, which our team opens for you). In the mobile app, Home → Checklist edits the AC and AV lists.
- **What it's for:** every task gets a checklist of things that must be in place before work can start. For example: GFC drawings issued, client material approval, material delivered. A task can only start when its checklist is cleared.
- **Status:** ✅ Live. **Set this up before creating tasks:** each new task copies the master list when it is created. Changing the list later also updates existing tasks.

The checklist has six groups. This is the current default list. Please review it and tell us what to add, remove or rename:

| Group | Current items |
|---|---|
| Architect | Design Intent, 3D Renders, GFC Drawings, Specifications, Material Selection, Test *(a leftover test item, to be removed)* |
| Client | Design Approval, Material Approval, Equipment Approval, Payment Clearances, Contractor Approval |
| Consultant | Technical Drawing, Specification, Vendor Suggestion, Quality List, Estimated Cost |
| Contractor | Manpower, Deadlines, Quality of Work, Mockup on Site, Manpower Quantity, Support On Site, Present |
| Procurement (Vendor) | Material Samples, List of Materials Required, Client Approval Date, Client Advance Payment Date, Material Procurement Lead Time, Material Procured Quantity, Material Wastage Allowance (%), Planned Material Delivery Date, List of Materials Received, List of Pending Materials, Material Stock Available, List of Materials Issued for Work, Quantity of Materials Used, Quantity of Materials Wasted During Execution, Closing Material Stock Balance, Material Intent Date During Work |
| Quantity of Work | Targeted Quantity, Quantity Of Work Done, Pending Quantity, Excess Quantity |

AC tasks skip the Procurement group. AV tasks skip the Consultant group.

**Quality checklist (used during daily reports).**
- **Where:** mobile app, DPR → Quality Checklist.
- **What it's for:** the quality checks a site engineer prints, gets signed on site and uploads as a photo.
- **Status:** 🧪 Demo. Until your own quality items are entered, the app shows a standard sample list of 10 checks per group. Uploading the signed copy is live.

**What we need from you:** your quality checks, per department (for example, Electrical: "Conduit routing as per drawing", "Earthing continuity tested").

### Step 9: Task types (lead times)

- **Who:** Admin, Manager or Senior Site Engineer.
- **Where:** Admin website (inside the New Task form).
- **What it's for:** a task type is a standard duration. It suggests a task's end date, and for items that must be ordered it is the **procurement lead time**. The system works backwards to show "must order by" dates.
- **Status:** ✅ Live.

Current types:

| Type | Working days |
|---|---|
| Type 1 | 2 |
| Type 2 | 7 |
| Type 3 | 15 |
| Type 4 | 30 |
| Type 5 | 45 |
| Type 6 | 60 |
| Type 7 | 90 |

**What we need from you:** for each long-lead item (lifts, imported tiles, modular kitchen, HVAC units and so on), how many days it takes from order to delivery.

### Step 10: Template Kit → tasks → apply to the project

This is how the full task list and its order are built.

**10a. Build a template (a standard sequence of tasks).**
- **Who:** Admin or Manager in the mobile app (Template Kit). Admin, Manager or Senior Site Engineer on the admin website (Templates).
- **Where:** mobile app or admin website.
- **What it's for:** a reusable plan, for example "Villa – standard sequence", that can be copied into any project.
- **Status:** ✅ Live. There are three ways to build one:
  1. Draw it on screen: add tasks, then link them.
  2. Upload an Excel sheet (see Part 3 for the columns).
  3. On the website, select tasks on an existing project's flowchart and save them as a template.

Each task in a template needs:

| Field | Required? | Example |
|---|---|---|
| Task name | Required | Ground floor slab casting |
| Department | Required | Civil Works |
| Planned start and end dates | Required | 01-12-2026 to 05-12-2026 |
| AC or AV | Required | AC |
| Procurement duration (task type) | Optional | Type 3 (15 days) |
| Track label | Optional | Block A |

**Links between tasks.**
- **Finish → Start:** B starts after A finishes. This is the most common.
- **Start → Start:** B starts when A starts.
- **Finish → Finish:** B finishes when A finishes.
- **Start → Finish:** B finishes when A starts.
- **Parallel:** both run side by side.
- **Gaps or overlaps between linked tasks** ("start 2 days after", "start 1 day before") are ⏳ not available yet. They are being built.

**10b. Apply the template to the project.**
- **Who:** Admin or Manager.
- **Where:** mobile app only (Template Kit → template → Apply to Project).
- **What happens:**
  1. Pick the project and the date the first task starts.
  2. Match the template's departments to the project's departments, or create new ones.
  3. Preview the tasks.
  4. Confirm. All tasks are created in Draft.
- **Status:** 🟡 Partly live. Known issues, being fixed. Until then, our team checks every applied plan:
  - The arrows between tasks currently come out the wrong way round.
  - Dates are not yet fully adjusted for holidays.
  - AC/AV choices from the template are not carried over.

**10c. Add or change single tasks.**
- **Where:** Admin website (department → New Task), or the flowchart on the website or in the app (Project Dashboard → Flowchart → tap "Locked" to switch to editing).
- **Status:** ✅ Live.

| Field | Required? | Example |
|---|---|---|
| Task name | Required | Level 3 ductwork installation |
| Department | Required | HVAC |
| Planned start and end | Recommended | Holidays cannot be chosen |
| Task type | Optional | Type 4 |
| Total SFT for this task | Optional | 1200 |
| Assigned site engineer | Optional | Ravi Kumar |
| Description | Optional | |

Good to know:
- Task numbers are given automatically.
- Once a task is created on the website, its assigned engineer cannot be changed from the screens. Tell us and we will change it.

**How a task moves through its stages.**
- **Draft:** the task has just been created and its checklist is not filled in yet.
- **Ready:** every prerequisite on its checklist is cleared.
- **Not Started:** still waiting on prerequisites or on earlier tasks.
- **In Progress:** an engineer starts it. This is blocked until earlier linked tasks allow it.
- **On Hold:** work is paused. A reason is recorded in the DPR.
- **Completed:** the task is locked.

### Step 11: Schedule and Gantt chart

- **Who:** Admin, Manager, Senior Site Engineer.
- **Where:**
  - Admin website (Gantt): view only, with filters by department, status, engineer and project, and day / week / month zoom.
  - Mobile app (Project Dashboard → Gantt): view only.
  - The flowchart (website, or Project Dashboard → Flowchart in the app) is where links and dates are edited.
- **What it's for:** the schedule is built automatically from each task's dates and links. When a task runs late, the chart shows the knock-on delay ("projected" dates) for the tasks after it.
- **Status:** ✅ Live.

**What we need from you:** nothing extra beyond the task list in Step 10. Please confirm the baseline (planned) dates before work starts.

### Step 12: Drawings and project files

**Drawings.**
- **Who:** Admin, Manager or Senior Site Engineer add drawings. All site staff can view them, mark areas and add photos.
- **Where:** mobile app (Files → Drawings).
- **What it's for:** one place for every drawing sheet, its revisions (R0, R1, …), layers per department, and "tagged areas" linked to tasks and site photos.
- **Status:**
  - 🟡 Partly live. Drawings, revisions, layers and tags work.
  - Viewing a drawing currently works in the web version of the app. Viewing on the phone comes with the next app update.
  - The website version of Drawings is not released yet.
  - The "send reminder to consultant" email is ⏳ not switched on yet.

| Field (per drawing sheet) | Required? | Example |
|---|---|---|
| Sheet number | Required | A-101 |
| Title | Required | Ground Floor Plan |
| Department | Optional | Architectural |
| Floor plan it belongs to | Optional | Ground Floor Plan |
| Consultant name and email | Optional | Mehta Architects, anil@mehtaarchitects.in |
| Days allowed to reissue after a change | Optional | 3 (from 1 to 60) |
| PDF file | Required | PDF only, up to 50 MB |

**Other file folders.**
- **Status:** 🧪 Demo.
  - The Transmittal, RA Bills and Quotes folders show sample files.
  - The Site Photos folder shows sample photos.
  - The "Upload Document" button keeps a file only until the screen is closed. It is not saved yet.
- **What we need from you:** your existing transmittals, RA bills and quotes, so they are ready when saving goes live.

### Step 13: Everything else before daily use

| Item | Who / where | Status | What we need from you |
|---|---|---|---|
| Install the app | Every user, Android Play Store | ✅ Live | Each user's phone model and Android version (only if they have problems) |
| Allow notifications on each phone | Every user | ✅ Live | Users must tap "Allow" when the app asks |
| Allow critical alarms through Do Not Disturb | Every site engineer (phone settings) | 🟡 See Part 2, step 5 | Your engineers' phones, to help them set this up |
| Who receives critical alerts and site issues | Admin / Manager | ✅ Live | Names of the people at the office who should receive them |
| Who receives reports by email | Admin | ⏳ Test only | Names and email addresses, and weekly or monthly |
| Site WhatsApp groups (Site Groups) | Our team | ⏳ Not live yet | See Part 2, step 10 |

---

## Part 2: Daily use

### 1. Site engineer attendance

- **Who:** Site engineers and senior site engineers mark their own attendance. Admin and managers review it.
- **Where:**
  - Mobile app: Attendance tab (engineers), and Site Attendance → Site Engineer Attendance and Leave Log (office).
  - Admin website: Attendance and scorecards (office).
- **How it works:**
  1. On arriving, the engineer picks the project and taps **Check In**. The time is recorded.
  2. **Check Out** becomes available at the end of the shift (6:00 PM by default).
  3. If the engineer has to step away during the day (material pickup, client visit, site inspection, supply run, other), they tap **Leave**, pick a reason and can add a note.
  4. The office sees a 30-day score for each engineer. Points are taken off for arriving more than 10 minutes late or leaving early, and an absent day scores 0. The website also shows detailed scorecards.
- **Status:** 🟡 Partly live.
  - Check-in and check-out work.
  - **Location is not checked** in the current app version: the system records the time, not where the engineer was.
  - There is no "I'm back" button after stepping away.
  - On the ROAST @ Kokapet demo project, three sample engineers appear in the office view.
  - Requests for leave days (days off) are not built yet.
- **Inputs from you:** none daily. Only the site working hours from Step 4.

### 2. Site attendance (labour on site)

- **Who:** Admin and Managers.
- **Where:** mobile app (Site Attendance).
- **What it's for:** planned against actual workers per department each day, with shortfalls.
- **Status:** 🧪 Demo. The numbers shown are sample numbers. There is no way to enter real labour counts yet. Workforce numbers can be entered in each task's DPR instead (next section).
- **Inputs from you:** how you count labour today (per department, per contractor or per trade), so we can build the entry screen to match.

### 3. DPR (daily progress report)

- **Who:** Site engineers (and senior site engineers and admin) fill it in. Admin approves edit requests. Office and client read the results in reports.
- **Where:** mobile app (DPR tab).
- **How it works:**
  1. The DPR screen lists today's tasks by stage (Priority, In Progress, On Hold, Pending).
  2. For each task the engineer taps **Edit DPR** and fills in:

     | Field | Required? | Example |
     |---|---|---|
     | Quantity of work done today | Optional | 20% |
     | Status | Optional (shows the current status) | In Progress / On Hold / Completed |
     | Actual start date | Optional (filled in when work starts) | 12-10-2026 |
     | Reason for delay | Required when the task is On Hold | Material not delivered |
     | Comments | Required when the task is Pending or On Hold | Waiting for GFC drawing |
     | Architect remarks, client remarks | Optional | |
     | Subtasks worked on today | Optional | Wall steel frame work |
     | Workforce: targeted and actual per day | Optional | 12 / 9 |
     | Photos | Optional | From the phone camera |

  3. **Save Draft** to finish later, or **Submit DPR**.
  4. Once submitted, today's DPR is locked for the engineer. To change it, they tap **Contact Admin to Edit** and the admin approves (DPR → Edit Requests). Older days' DPRs can still be opened and changed. This lock is being tightened.
  5. Engineers get a reminder notification at **12:00 PM, 3:00 PM and 5:30 PM** if their DPR is due.
- **Status:** 🟡 Partly live.
  - Filling in, saving and submitting DPRs works, and the reminders are being sent.
  - The admin's "Submission History" list shows sample entries.
  - The quality checklist shows a sample list until your items are entered (Part 1, Step 8).
  - A photo's floor/room/wall tag is kept only on the phone that took it.
  - The reminder may still arrive after the DPR has been submitted, and tapping it opens Home rather than the DPR.
  - The admin website's DPR page shows reports in an older format. New app DPRs appear in the app's Status reports.
- **Inputs from you:** none daily beyond the engineer's report. Please tell us your usual delay reasons, so the pick list matches your sites.

### 4. Checklists (prerequisites)

- **Who:**
  - Site staff and office mark checklist items.
  - Clients answer the items that need the client.
  - Admin or Manager verify a completed checklist.
- **Where:** mobile app (task page, and the client's Home screen) and admin website (task page).
- **How it works:**
  1. Each checklist item is marked **Issued (Yes)**, **Pending**, **On Hold**, **Revisions** or **Not Required (No)**. Each item can also take a quantity, comments and a history of drawings and approvals.
  2. Items that need the client appear on the client's Home screen under **"Needs your response"**. The client taps **YES**, **PROCEED** or **NO**.
  3. When every item is cleared, the checklist goes to **Pending review**. An admin or manager then taps **Mark Verified** or **Needs Rework** (with a note). Needs Rework sends the items back to be checked again.
- **Status:** ✅ Live.
  - A client "NO" keeps the item open, and the card comes back. Only YES or PROCEED clears it.
  - Clients cannot add a comment with their answer yet.
- **Inputs from you (client):** answer approval requests in the app as they come in.

### 5. Site issues and critical alerts

- **Who:**
  - Site engineers report issues.
  - Admin and Managers send critical alerts to engineers.
- **Where:** mobile app.
- **How it works:**
  - **Engineer → office:** Alerts tab → **Report Issue** → type the problem. The office gets a phone notification at once.
  - **Office → engineers:** Notifications → send a critical alert to all engineers on the project or chosen ones, with a choice of 10 alarm tones. MoM → Custom Alerts can also send an alert to one department's engineers.
  - On the engineer's phone a **full-screen red alert** appears and stays until they tap **Acknowledge**.
- **Status:** 🟡 Partly live.
  - Sending, receiving and acknowledging alerts works.
  - **If a phone is on silent or vibrate, the alarm sound may not play.** A fix is ready to build and needs a new app version. Until then, each engineer should allow the "Critical alarm" notifications to override Do Not Disturb in their phone settings.
  - There is no screen yet to mark a reported issue as resolved.
  - The admin website's Alerts page is 🧪 Demo.
- **Inputs from you:** the office people who should receive issues and alerts (Part 1, Step 13).

### 6. Meetings (MoM: minutes of meeting)

- **Who:** Admin and Managers.
- **Where:** mobile app (MoM: Meeting, Reports, Custom Alerts and, for admin, Email Reports).
- **How it works:**
  1. **Meeting:** create a meeting (title, date, time, duration, venue, notes), invite people from the Contact Book or Specific Book, then send the invitation by WhatsApp or email. Further tabs cover:
     - **Agenda:** collect points, then build the final agenda.
     - **Record:** record the meeting on the phone.
     - **Attendance:** mark present or absent.
  2. **Reports:** make a Task Based Report or Project Health Report as a PDF and share it. Automatic schedules can also be set up.
  3. **Custom Alerts:** send a live alert to one department's engineers, or share a list of pending or upcoming tasks with the client and architect.
- **Status:** 🟡 Partly live.
  - Building and sharing the report PDFs works.
  - **Meetings, agendas, attendance, recordings and report history are saved only on the phone that created them.** They are not shared with other users and are lost if the app is removed.
  - "Send" opens WhatsApp or the email app with the message ready. The app cannot confirm that it was sent.
  - Automatic report schedules are saved but **do not send by themselves yet**.
  - Recordings are not turned into text yet.
  - A manager can invite only people in the project's Specific Book.
  - The admin's Email Reports tab sends a **test** report with sample data only.
- **Inputs from you:** who should receive MoM and progress reports, and how often (weekly or monthly).

### 7. Files and drawings

- **Who:** all staff, and clients (they can view).
- **Where:** mobile app (Files).
- **How it works:**
  1. Pick a project to see its folders: Site Photos, Drawings, Transmittal, RA Bills, Quotes.
  2. **Drawings:** open a floor plan, switch department layers, compare revisions with "Show changes", and tap a tagged area to see its task and photos. Site engineers can mark a new area ("+ Tag area") and add photos to it.
- **Status:**
  - Drawings 🟡: see Part 1, Step 12.
  - Other folders 🧪 Demo: sample files, and uploads are not saved yet.
- **Inputs from you:** drawing PDFs and register (Part 3), and existing project documents.

### 8. Notifications

- **Who:** everyone.
- **Where:** mobile app (bell icon and Notifications screen), plus phone notifications.
- **Status:**
  - ✅ Live:
    - Phone notifications for DPR reminders and critical alerts.
    - The bell count of open site issues.
  - 🟡 Built but not yet tested on phones: notifications for client approvals and invoices.
  - 🧪 Demo: the Notifications **screen** (the list grouped by type) shows sample entries for now.
- **Inputs from you:** who should be told about what (for example, should the client be told when a task is delayed?).

### 9. Reports

**Status reports in the mobile app (menu → Status).** These are for staff and clients (clients do not see Site Engineer Status).

| Report | What it shows | Status |
|---|---|---|
| Daily / Weekly / Monthly / Custom date range | Every task that had a DPR in the period, its progress %, and a forecast end date. Download as PDF. | ✅ Live (drafts are counted too) |
| Architect / Client / Vendor / Contractor status | Tasks waiting on that party, what is pending, how late, and which tasks are held up | ✅ Live |
| Department status | The same, for one department | ✅ Live |
| Site Engineer status | One engineer's delays, attendance, leave, DPRs and signed checklists | 🧪 Shows sample rows whenever the engineer has no real activity in the chosen dates |
| Task Based status | Everything about one task: checklist, delays, workforce, DPR history | 🟡 The "Contractor" name is a fixed sample name for now |

**Reports on the admin website.**
- **Project report:** progress, overdue tasks, a breakdown by department, schedule and SFT. ✅ Live.
  - "Send to client" makes the report visible on the client's web page. It does **not** email it.
- **Weekly report:** all projects together. ✅ Live.
- **Monthly report:** delays by department and person, and targeted against completed quantity. ✅ Live.
- **Task report:** ✅ Live.
- **Project Health:** 🧪 Demo.

**Home screen numbers.** The "Overview" counts on the staff Home screen (Architect, Client, Consultant and so on) are 🧪 sample numbers. The project progress list below them is ✅ real.

- **Inputs from you:** report recipients and frequency (Part 3), and the contractor responsible for each department.

### 10. Site Groups (WhatsApp groups inside the app)

- **Who:** people you choose (any role), with read-only or read-and-reply access.
- **Where:** mobile app (Site Groups).
- **What it's for:** read and reply to each project's WhatsApp site groups from inside the app, next to the project's tasks and reports.
- **Status:** ⏳ Not live yet. It works in testing, but is switched off in the app you install. To go live it needs:
  - a WhatsApp connection service account;
  - a dedicated WhatsApp number that is a member of your site groups;
  - the groups linked to projects;
  - a list of who may read or reply;
  - a new app version.
- **Inputs from you:**
  - the WhatsApp number to use;
  - the list of site groups and which project each belongs to;
  - who may read, and who may reply.

### Other screens you may see

| Screen | Who | Status |
|---|---|---|
| Invoices: create, preview, send to client | Admin, Manager (app) | 🟡 Creating and sending works, but clients cannot open the invoice screen yet |
| Inventory: stock in and out, invoice scanning | Office (website, available on request) | ⏳ Built but not switched on in the menu |
| Devices & Logins: which phones are signed in | Admin, Manager (app) | ✅ Live (view only) |
| Client sequence sketch: client draws their own task order | Client (website) | ✅ Live, but the office cannot view these sketches yet |
| App Progress: what is done and pending in each screen | Admin, Manager (app) | ✅ Live |

---

## Part 3: Client input checklist

Please send everything in **one Excel workbook, one sheet per item**, using the columns below. Dates as **DD-MM-YYYY**. Where you already have a document in another format (for example, a schedule in MS Project or a drawing register), send it as it is and we will convert it.

### Summary

| # | What we need | Needed for | Required? | Preferred format |
|---|---|---|---|---|
| 1 | List of users with roles and emails | Logins (Step 1) | Required | Excel sheet "Users" |
| 2 | Company name, logo, sending email address | Branding and emails (Step 2) | Required for email features | Logo as PNG; details in an email |
| 3 | Weekly off day and holiday list | Dates and delays (Step 3) | Required | Excel sheet "Holidays" |
| 4 | Project details, site location, working hours | Project setup (Step 4) | Required | Excel sheet "Project" |
| 5 | Departments / trades | Tasks and reports (Step 5) | Required | Excel sheet "Departments" |
| 6 | Floors, rooms and areas | Drawings and photo tagging (Step 6) | Recommended | Excel sheet "Floors & Areas" |
| 7 | Contacts (architect, client, consultant, contractor, vendor) | Address books, meetings, follow-ups (Step 7) | Required | Excel sheet "Contacts" |
| 8 | Checklist changes (prerequisites) | Task readiness (Step 8) | Required: review the current list | Excel sheet "Checklist" |
| 9 | Quality checks per department | DPR quality checklist (Step 8) | Recommended | Excel sheet "Quality Checks" |
| 10 | Lead times for long-lead items | Procurement deadlines (Step 9) | Recommended | Excel sheet "Lead Times" |
| 11 | Task list / schedule with links | Flowchart, Gantt, DPR (Steps 10–11) | Required | Excel sheet "Tasks" |
| 12 | Drawing register and PDF files | Drawings (Step 12) | Required for drawings | Excel sheet "Drawings" + PDFs |
| 13 | Report, alert and meeting recipients | Reports, alerts, MoM | Required | Excel sheet "Recipients" |
| 14 | WhatsApp number and site group list | Site Groups (when it goes live) | Optional for now | Excel sheet "WhatsApp Groups" |
| 15 | Existing transmittals, RA bills, quotes | Files (when saving goes live) | Optional for now | Original files (PDF) |

### Columns for each sheet

**1. Users**

| Full name | Email | Phone | Role | Project(s) | Notes |
|---|---|---|---|---|---|
| Ravi Kumar | ravi@acme.in | 98765 43210 | Site Engineer | Elmwood Villas | |

Role is one of: Admin, Manager, Senior Site Engineer, Site Engineer, Client. A client is linked to exactly one project.

**3. Holidays**

| Date | Holiday name | Type |
|---|---|---|
| 08-11-2026 | Diwali | Festival |

Type is one of: National, Festival, Regional, Company shutdown. Also write your weekly off day(s) at the top of the sheet.

**4. Project** (one row per project)

| Project name | Site address | Area / size | Budget | Total SFT | Google Maps link (full) | Attendance radius (m) | Working hours | No. of floors | No. of rooms | Show workforce on reports (Yes/No) |
|---|---|---|---|---|---|---|---|---|---|---|
| Elmwood Villas | Plot 12, Kokapet | 3,475 sq ft | ₹2.4 cr | 2500 | https://www.google.com/maps/… | 60 | 9:00–18:00 | 3 | 12 | Yes |

**5. Departments**

| Department name | Short code (2–10 letters) | Standard trade (from Step 5 list) | AC or AV | Colour (optional) |
|---|---|---|---|---|
| Electrical | ELEC | Electrical | AC | Blue |

**6. Floors & Areas**

| Floor / level | Room or area | Wall names (optional) |
|---|---|---|
| Ground Floor | Kitchen | A, B, C, D |

**7. Contacts**

| Name | Phone | Alternate phone | Email | Company | Category | Project(s) | Location link | Notes |
|---|---|---|---|---|---|---|---|---|
| Anil Mehta | 98480 12345 | | anil@mehta.in | Mehta Architects | Architect | All projects | | Lighting design |

Category is one of: Architect, Client, Consultant, Contractor, Vendor, Other.

**8. Checklist** (changes to the list in Part 1, Step 8)

| Group | Item | Change (Add / Remove / Rename to …) | Mandatory (Yes/No) |
|---|---|---|---|
| Client | Colour scheme approval | Add | Yes |

Group is one of: Architect, Client, Consultant, Contractor, Procurement, Quantity of Work.

**9. Quality Checks**

| Department | Check item |
|---|---|
| Electrical | Earthing continuity tested |

**10. Lead Times**

| Item / task | Days from order to delivery |
|---|---|
| Imported floor tiles | 45 |

**11. Tasks** (our preferred layout; we convert it to the upload format)

| Row no. | Task name | Department | Planned start | Planned end | Comes after (row no.) | Link type | Gap / overlap days | AC or AV | Total SFT | Lead time (days) | Site engineer (email) | Floor / area |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | PCC works at -6' level | Civil Works | 14-08-2026 | 18-08-2026 | | | | AC | 800 | | ravi@acme.in | Foundation |
| 2 | Ground floor slab casting | Civil Works | 19-08-2026 | 24-08-2026 | 1 | Finish → Start | 0 | AC | 1200 | | ravi@acme.in | Ground Floor |

- Link type is one of: Finish → Start, Start → Start, Finish → Finish, Start → Finish, Parallel. Leave it blank for "Finish → Start".
- "Gap / overlap days" can be filled in now. It will be used when that feature goes live (Part 1, Step 10).
- If your schedule is simpler, the app can also read a sheet with just these columns: **Main Task**, **Parallel Task** (one or more columns), **Planned Start Date**, **Planned End Date**. Tasks in the same column run one after another. A Parallel Task runs alongside the Main Task on the same row.

**12. Drawings** (plus one PDF per sheet; file name = sheet number)

| Sheet no. | Title | Department | Floor | Revision | Revision date | Consultant | Consultant email | Days to reissue |
|---|---|---|---|---|---|---|---|---|
| A-101 | Ground Floor Plan | Architectural | Ground Floor | R0 | 16-10-2026 | Mehta Architects | anil@mehta.in | 3 |

PDF only, up to 50 MB per file.

**13. Recipients**

| What | Name | Email | Phone | How often |
|---|---|---|---|---|
| Weekly progress report | Client – Mr. Rao | rao@client.in | | Weekly |
| Critical alerts / site issues | Site manager | sm@acme.in | 90000 11111 | As they happen |
| MoM / meeting invites | Architect | anil@mehta.in | 98480 12345 | Per meeting |

**14. WhatsApp Groups** (only when Site Groups goes live)

| Group name | Project | People who may read | People who may reply |
|---|---|---|---|
| Elmwood – Site Team | Elmwood Villas | Ravi, Priya, Mr. Rao | Ravi, Priya |

Also tell us the WhatsApp number that will be connected.

---

## Summary: what is not fully live yet

| Area | What to expect today |
|---|---|
| Email invitations and emailed reports | Sent from a test address. Needs your email domain (Part 1, Step 2). |
| Company name and logo | Shows "PMC Portal" until we set yours |
| Location check at attendance | Switched off. Only times are recorded. |
| Site Attendance (labour counts) | Sample numbers. No entry screen yet. |
| Site photo locations (Floor → Room → Wall) | Fixed sample list. Tags are kept on the phone only. |
| Quality checklist in DPR | Sample checks until yours are entered |
| DPR "Submission History" (admin) | Sample entries |
| Applying a template to a project | Links come out reversed. Our team checks every applied plan. |
| Gaps / overlaps between linked tasks | Being built |
| Critical alarm on a silent phone | May not ring. Fix needs a new app version. |
| Meetings (MoM) | Saved only on the phone that made them. Automatic report schedules do not send. |
| Files: Transmittal, RA Bills, Quotes, Site Photos | Sample files. Uploads are not saved. |
| Drawings | Work in the web version of the app. The phone viewer comes with the next update. Consultant reminder email not switched on. |
| Notifications screen list | Sample entries (phone notifications themselves are live) |
| Home "Overview" counts | Sample numbers |
| Site Engineer status report | Shows sample rows when there is no real data |
| Task report "Contractor" name | Fixed sample name |
| Site Groups (WhatsApp) | Not live yet |
| Admin website: Alerts, Project Health, old Documents and Photos pages | Demo pages |
