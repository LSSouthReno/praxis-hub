# Praxis Hub

Leadership hub for Praxis Theological Seminary: a briefing for the president and board, announcements, directory, action items, calendar and playbook.

- **Site:** https://lssouthreno.github.io/praxis-hub/
- **Data:** the [Praxis Hub Data](https://docs.google.com/spreadsheets/d/1tkiJcJP1Eux57y4qkI2DUynBpc6teKtAWdNNY-M8MXE/edit) Google Sheet. The page reads every tab live on load, so edits in the sheet appear on the next refresh. No build step and nothing to push.

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

Briefing with launch countdown and milestone timeline · needs-attention panel · president's note · next board meeting · launch numbers · weekly summary (copy or email) · one-page print brief · group email with BCC · command palette (⌘K, `/`, keys 1–6) · person drawer · calendar export (.ics) · light/dark/system theme · "new since your last visit" badges · phone layout with bottom tabs.

## Branding

Palette and type follow the Praxis brand sheets and website: rich black `#171A21`, Payne's gray `#617073`, ghost white `#F8F7FF`, dark goldenrod `#B68F40`, midnight green `#003D52`; Droid Serif (Noto Serif) for headings and Century Gothic (Montserrat fallback) for text.

## Tests

`node tests/run.js` checks the CSV parser, date parsing and column mapping against sample rows. No dependencies.
