# Phone-number sign-in and role views (branch `phone-login`, not live)

**Status: built and tested, switched OFF.** `CONFIG.AUTH_URL` in `index.html` is empty, so the live site behaves exactly as before. Nothing has been pushed.

## What it does
A person opens the hub, types their mobile number, gets a 6-digit text code, types it, and is in for 30 days on that device. No password. What they see depends on their role, decided by the server (not the page).

| Role | Found from | Sees |
|---|---|---|
| **Admin** | `Access` tab row with Role = admin | Everything the board sees |
| **Board** | People tab, Group = Board | Everything: Briefing, Program Status, Action Items, Playbook, board posts and meetings, all phones and notes, onboarding |
| **Professor** (and School of Music) | Group = Professor / School of Music | Courses & Schedule, Everyone + Faculty announcements, directory without other people's phones/notes/paperwork, calendar without board meetings, **their own** checklist and the action items assigned to them, Ideas |
| **Staff** | Group = Staff | Everyone + Staff announcements, directory without phones/notes, calendar without board meetings, their own action items |

Someone in two groups (Brad B. is Board + Professor) gets the higher role. The optional `Access` tab (columns Name, Phone, Role) adds a number or overrides a role. A phone cell may hold two numbers (`775-555-0101 / 775-555-0199`). Any US format works (`(775) 555-0101`, `+1 775.555.0101`, `17755550101`).

## Security design
- The Google Sheet becomes **private**. Only the Apps Script (running as Brad) reads it. The page never gets the sheet, the phone list, or other people's data; it gets one filtered copy per signed-in person.
- Filtering is on the server (`apps-script/Code.gs`, `filterTab`). The page's own hiding of tabs is only cosmetic.
- Codes: 6 digits from a random source, stored only as a salted hash, expire in 10 minutes, die after 5 wrong tries. Max 3 texts per number per 15 minutes and 150 per day overall.
- Unknown numbers get the same on-screen reply as known ones and no text is sent, so the sign-in box can't be used to find out who is on the list. The message tells them to ask Brad to add their number.
- Session tokens are signed (HMAC), expire after 30 days, and are re-checked against the sheet on every request: delete someone's number and they are out at once.
- The Playbook text is taken out of the page in the secure build and served only to board/admin.
- Signing out (or an expired session) wipes everything the device saved (cached sheet copies, who-am-I).
- Sample-data mode is disabled in signed-in mode (sample rows would bypass the filtering).
- Secrets (session secret, Twilio keys) live only in Apps Script "Script properties", never in the code or repo.
- `node tests/auth-test.js` runs 26 checks against the real script logic (formats, role filtering, no leaks, lockout, forged/expired tokens, revocation). `node tests/run.js` still passes.

## Honest limits
- **The repo is public and the Playbook is already in its history.** Making the site secure from now on does not un-publish what was committed before. If the Playbook is sensitive, make the repo private (GitHub Pages then needs a paid plan) or host elsewhere, and rewrite history.
- Text messages need a texting service. **Twilio** costs roughly $1–2 a month plus about 1 cent per text; US numbers need a short registration (toll-free verification or A2P 10DLC) before delivery is reliable. Until then use `SMS_MODE=test` (codes go to Brad's email), which is fine for trying it.
- Anyone who has a person's phone and can read their texts can sign in as them (same as any text-code login). Removing the number from the sheet cuts them off.
- The Apps Script cannot be deployed from the Atlas server (no clasp login), so setup has a short click-through on Brad's Mac: see the PDF "Praxis sign-in - setup steps" (in for-brad).

## How to ship
1. Do the Apps Script setup (PDF) and get the web app address (`https://script.google.com/macros/s/…/exec`).
2. `node tools/build-secure.js "<that address>"` writes `secure-build/index.html` (sign-in on, Playbook removed) and `secure-build/Playbook.html` (paste into the Apps Script project as a file named `Playbook`).
3. Test with `SMS_MODE=test`: sign in as a professor and as a board member (codes arrive in Brad's email).
4. Copy `secure-build/index.html` over `index.html`, commit, push (GitHub Pages updates).
5. **Only then** set the sheet to Restricted (the old page reads it publicly; the new one doesn't).
6. Switch to real texts when Twilio is ready: set `SMS_MODE=twilio`, `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`.

To go back: restore the previous `index.html` and set the sheet to "Anyone with the link · Viewer".
