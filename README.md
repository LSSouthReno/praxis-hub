# Praxis Hub

Internal leadership hub for Praxis Theological Seminary: announcements, directory, action items, calendar and playbook.

- **Site:** https://lssouthreno.github.io/praxis-hub/
- **Data:** the [Praxis Hub Data](https://docs.google.com/spreadsheets/d/1tkiJcJP1Eux57y4qkI2DUynBpc6teKtAWdNNY-M8MXE/edit) Google Sheet. The page reads every tab live on load, so edits in the sheet appear on the next refresh. No build step and nothing to push.

## How it works

`index.html` is a single static page. On load it fetches each tab of the sheet as CSV through Google's `gviz` endpoint and renders it. The sheet must be shared as **Anyone with the link · Viewer** for the page to read it; editing rights stay with whoever you invite as an editor.

| Tab | Drives |
|---|---|
| People | Directory, counts, email copy buttons |
| Announcements | Announcements feed and the overview |
| Action Items | Open and completed items |
| Calendar | Upcoming and past dates |
| Links | The links list on the Playbook page |

Column order doesn't matter; the page matches columns by header name. Keep the header row intact.

## Branding

Palette and type follow the Praxis brand sheets and website: rich black `#171A21`, Payne's gray `#617073`, ghost white `#F8F7FF`, dark goldenrod `#B68F40`, midnight green `#003D52`; Droid Serif (Noto Serif) for headings and Century Gothic (Montserrat fallback) for text.
