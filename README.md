# Praxis Hub

Praxis Hub for Praxis Theological Seminary. Professors get their courses, schedule, a personal checklist and updates. The board signs in to also see the briefing, program status, action items and the playbook.

- **Site:** https://lssouthreno.github.io/praxis-hub/
- **Data:** the [Praxis Hub Data](https://docs.google.com/spreadsheets/d/1tkiJcJP1Eux57y4qkI2DUynBpc6teKtAWdNNY-M8MXE/edit) Google Sheet. The page reads every tab live on load, so edits in the sheet appear on the next refresh. No build step and nothing to push.

## Two audiences

| | Professors (default) | Board (after sign-in) |
|---|---|---|
| Opens to | **My Praxis**: pick your name; see paperwork still needed, dates to hold, tasks assigned to you, and a “Your next thing is…” card | **Briefing** |
| Sees | Courses & Schedule, Announcements (Everyone and Faculty), Directory (no phone numbers or notes), Calendar (no board meetings), Ideas & Updates | Everything, including **Program Status** (scorecard, launch numbers, onboarding, decisions log, items awaiting reply), Action Items, Playbook, board-only posts, board meetings |

**Ideas & Updates** opens the visitor's email app with their note addressed to the address in `CONFIG.IDEAS_EMAIL` (top of the script in `index.html`). Move it to the hub's own Gmail address later by editing that one line.

**Sample data.** *More → Show sample data* (or add `?demo=1` to the address) mixes clearly labelled “(sample)” professors, dates, posts and numbers into the hub so the views can be demonstrated. It never touches the sheet. Turn it off the same way.

## Professor onboarding, contracts and the admin view

Asked for by Nicole and Kyle (October 2026). Unlike the rest of the hub, this part is **really private**: it runs through a small Google Apps Script backend (`backend/Code.gs`) that keeps everything in a private spreadsheet and a private Drive folder. None of it is in the public sheet or this public repo.

**For professors (My Praxis → “From the Praxis office”).** A professor picks their name, types their **mobile number** (it must match the one the office has on file) and gets a **6-digit code by text**. Professors with no mobile on file, or anyone who prefers it, can have the code **emailed** to the address on file instead. The code opens their own checklist for a few hours in that browser tab:

- **Sign your contract.** The contract opens only **within 10 minutes of a code**; after that it sends a fresh code first. The contract is streamed from the private Drive folder only after that check and shown in the page; it is never sent as a link. They sign by typing their full name and ticking “I agree”, or upload a signed paper copy. If the office prefers DocuSign or similar, paste the professor's signing link in the admin view and the hub shows a *Sign online* button instead. The signature record keeps the typed name, the time and a fingerprint (SHA-256) of the exact file they signed.
- **Update your contact information** (name for the website, email, mobile, mailing address, notes), prefilled from what the office has.
- **Send a photo for the website.** Phone photos and iPhone HEIC are fine; large photos are scaled to 2400 px.
- **Describe your course in two sentences**, one box per course, with a live sentence count.

Each professor's checklist is their own: the office unticks an item it already has and it disappears for that professor.

**For the office (More → Office admin, or `#admin`).** Kyle and Nicole sign in with the admin password and their name. They see progress tiles, a table of every professor with a mark per item, filters (still to do, complete, no phone on file, no contract uploaded, locked out), and a detail drawer per professor: phone on file, which items apply, mark done or reopen, upload or replace the contract (PDF), view the contract or signed copy, the signature record, contact details and course descriptions with copy buttons, the photo with download, office notes, a copy-or-email reminder listing what is still open, and that professor's recent activity. *Export CSV* gives everything in one spreadsheet for the website team.

**Security, honestly.**

- Sign-in is a one-time code sent to the professor's own phone or inbox, so knowing someone's number is not enough. Codes last 10 minutes, work once, and are stored only as a salted hash (texted codes are checked by Twilio). At most 5 codes per professor per 15 minutes. Five wrong tries (wrong number or wrong code) pause that professor for 15 minutes; ten in a day lock them until the office unlocks them, and the office is emailed.
- **Texting** uses Twilio Verify. Put `TWILIO_SID`, `TWILIO_TOKEN` and `TWILIO_VERIFY_SID` in the script's Project Settings → Script Properties and run `authorize` once in the editor. Without them, or if Twilio refuses a text, codes go by email automatically (the refusal is logged in *Activity*).
- **Never put phone numbers in the public sheet.** It is readable by anyone with its link. Enter them in the admin view or the private sheet's *Phone on file* column.
- The admin password lives in the private sheet's *Settings* tab, not in the page. Sessions are server-side and expire after 6 hours. Every sign-in, wrong try, contract view, signature, upload and admin change is written to the private sheet's *Activity* tab.
- The private sheet, Drive folder and script are owned by the Google account that ran `setup` (Brad's today). Share the private sheet only with the office, never “anyone with the link”. Moving them to a Praxis Google account later is a matter of transferring ownership of the three items.

**Switching it on (once, by the script owner).** The web app is deployed and wired into the page (`CONFIG.API_URL`). Until it is switched on, professors see “Your onboarding checklist opens soon”. To switch on:

1. Open the [Praxis Hub backend script](https://script.google.com/d/1kBsyO6BkkSTYQYV0FkbQ5yDhaN2vQhWIcmVIscC65b9yi1jj2ItWhHJk/edit), choose **setup** in the function menu, press **Run**, and approve the permissions (Sheets, Drive, send email).
2. The log shows the private sheet link and the admin password. setup creates the sheet (tabs Professors, Activity, Settings, Read me), the private Drive folder, and one row per professor from the public People tab.
3. Give Kyle and Nicole the admin password. In *Settings*, put their emails in *Notify emails* to get an email when a professor finishes something, and put their name in *Office contact*.
4. Add each professor's phone number (admin view, or the *Phone on file* column), upload contracts, and untick anything the office already has.

**Changing the backend.** From `backend/`: `clasp push --force`, then `clasp update-deployment AKfycby_4JeNLfjk_CxK8h3AXV68f7cYTjRStkcrqAs0QfX_amz_L-R28ewyxN_yIKfbQn-_` so the same URL serves the new code. (`.clasp.json` is gitignored; the script ID is `1kBsyO6BkkSTYQYV0FkbQ5yDhaN2vQhWIcmVIscC65b9yi1jj2ItWhHJk`.)

**Trying it locally without touching Google.** `node tools/dev-server.js` runs the real backend code against in-memory stand-ins (`tools/gas-mock.js`), seeded with the professor names from the live People tab, made-up phone numbers and sample contracts. It prints the admin password and each sign-in code as it is "sent". Open `http://localhost:8787/?api=http://localhost:8787/exec` (the `?api=` override only works on localhost).

## Board sign-in: what it is and what it is not

The board passcode hides the board views from professors so the page is tidy. **It is not security.** This is a static site: every visitor's browser downloads the whole page and reads the Google Sheet directly, and the sheet is shared “anyone with the link”. A technical person can open the browser tools and see everything, and the source code in this public repository includes the playbook text. The passcode is stored only as a hash, but a hash of a short passcode can be guessed offline. Do not put anything in the sheet or the page that must stay confidential from professors. (The professor checklists, contracts and admin view below are different: they are server-checked and kept out of the sheet.)

Change the passcode with `node tools/set-passcode.js "new passcode"`, then commit.

**A real solution** puts the whole site behind a login at the network edge, so unauthorised people never receive the page or the data: Cloudflare Access (free for small teams, email one-time codes, separate policies for professors and board), or a private repo with Cloudflare Pages / Netlify password protection, plus a separate private sheet (or Apps Script endpoint that checks the signed-in Google account) for board-only data. That is the recommended next step before any sensitive material (finances, candidate evaluations) goes into the hub.

## Custom domain and automatic emails

Both are planned, neither is switched on. See `docs/CUSTOM-DOMAIN.md` (placeholder `CNAME.placeholder`, DNS steps) and `docs/AUTO-EMAILS.md` (design for a dedicated Gmail that sends each professor their checklist; the *Preview my reminder email* button shows the wording).

## How it works

`index.html` is a single static page. On load it fetches each tab of the sheet as CSV through Google's `gviz` endpoint and renders it. The sheet must be shared as **Anyone with the link · Viewer** for the page to read it; editing rights stay with whoever you invite as an editor. Columns are matched by header name, so column order does not matter. Keep the header row intact.

| Tab | Required columns | Optional columns |
|---|---|---|
| People | Name, Group, Title, Status | Church or Institution, Courses (comma-separated), Email, Phone, City, Photo (a direct image URL), Notes, Sort order, and onboarding steps: Contract, Handbook, Syllabus, Bio & photo, W-9 (a date, "yes" or TRUE marks a step done) |
| Announcements | Date, Title, Message, Audience | Pinned, Posted by, Type (Update · Decision · Request · Prayer · Celebration), Response needed, Respond by, Link |
| Action Items | Item, Status | Owner, Due date, Priority (High · Normal · Low), Link, Notes |
| Calendar | Date, Title, Type | End date, Time, Location, Link, Agenda (one item per line or `;`), Minutes, Date TBD, Notes |
| Links | Title, URL | Category, Description |
| Metrics (optional tab) | Metric, Value | Target, Unit (`$`, `%`), As of, Note |

Values that drive behaviour:

- **Group:** Board, Professor, Staff, School of Music.
- **Status (People):** Confirmed, Tentative, In conversation, Open role.
- **Audience:** Everyone, Board, Faculty, Staff.
- **Type (Calendar):** Intensive, Board meeting, Milestone, Deadline, Other. The next *Board meeting* row powers the meeting card on the briefing.
- **Posted by** matching the person whose Title contains "President" turns that announcement into the *From the President* card.
- **Courses** on the People tab feed the *By course* coverage board in the directory.

## Features

My Praxis · Courses & Schedule · Program Status · Ideas & Updates · board sign-in · Briefing with launch countdown and milestone timeline · needs-attention panel · president's note · next board meeting · launch numbers · weekly summary (copy or email) · one-page print brief · email or group text by category, status or hand-picked selection (Select mode in the Directory; desktop shows a QR to open the group text on your phone) · command palette (⌘K, `/`, keys 1–6) · person drawer · calendar export (.ics) · light/dark/system theme · "new since your last visit" badges · phone layout with bottom tabs.

## A weekly rhythm for the president

1. Open the hub on Monday. The **Needs attention** panel lists what is overdue, waiting on a response, or still undated.
2. Press **More → Weekly summary** and send it to the board with one click, or paste it into your own note.
3. Post updates with **More → New post**, which copies a row you paste into the Announcements tab. Use Type *Decision* for anything the board decided so it lands in the decisions log, and *Request* with a Respond-by date when you need answers.
4. Before a board meeting, put the agenda on the meeting's Calendar row and the hub shows it on the briefing with a join link. Afterwards add the Minutes link to the same row.
5. Share the hub with **More → Share the hub**: copy the link or drop the QR code on a slide.
6. To reach people, press **E** (email) or **X** (text), pick a group and a status, or use **Select** in the Directory to tick exactly who you mean. Texts send from a phone; on a laptop the panel shows a QR code that opens Messages with everyone filled in.

## Branding

Palette and type follow the Praxis brand sheets and website: rich black `#171A21`, Payne's gray `#617073`, ghost white `#F8F7FF`, dark goldenrod `#B68F40`, midnight green `#003D52`; Droid Serif (Noto Serif) for headings and Century Gothic (Montserrat fallback) for text.

## Tests

`node tests/run.js` checks the CSV parser, date parsing and column mapping against sample rows. `node tests/backend.js` runs the backend (`backend/Code.gs`) through 73 checks: sign-in and lockouts, per-professor checklists, contract re-checks and single-use signing grants, chunked uploads, admin actions, notifications and session expiry. No dependencies.
