# Phone-number sign-in and role views (Atlas database version; built, tested, NOT live)

**Status:** the back end runs on Atlas's server with its own small database (`data/praxis.db`). `index.html` still has `AUTH_URL:''`, so the live site behaves exactly as before. Nothing is pushed. This replaces the old Google Apps Script design (`apps-script/` is kept only as history; nothing needs it).

## How it works
- People, phones, roles, announcements, action items, calendar, links, metrics and the Playbook live in Atlas's database. Atlas copied them once from the Praxis Hub Data sheet (read-only, through the sheet's public CSV link; no Google login needed). The sheet is never written to.
- The page asks Atlas (`/praxis`) to sign in: type mobile number, get a 6-digit code, stay in for 30 days on that device. Atlas sends each person only what their role may see.
- Roles: admin and board see everything; professors/School of Music see courses, schedule, Everyone+Faculty posts, directory without phones/notes, calendar without board meetings, their own checklist and action items; staff see Everyone+Staff posts and their own action items.
- Brad manages everything by talking to Atlas (tool `praxis_admin`): add/remove people, add or remove a phone number, change a role, make an admin, post an announcement, add an action item. Removing a number locks that person out on their next request.

## Privacy guarantees (covered by `node /home/atlas/atlas/tests/praxis-test.ts`, 47 checks, all passing)
Unknown numbers get the identical reply and no text is sent; codes expire in 10 min, die after 5 wrong tries, and are stored only as salted hashes; max 3 texts per number per 15 min and 150 a day; sessions are signed and re-checked against the people list on every request; the page never receives the phone list, the access list, or the Playbook (board/admin only, fetched separately); the public port serves only the sign-in conversation, and only the Pages site may call it from a browser.

## Rollback
- Soft: tell Atlas "Praxis back to the sheet" (`mode sheet`): the same server answers from the read-only Google Sheet.
- Hard: restore the previous `index.html` (AUTH_URL empty). The sheet is untouched, so the old site works as before.

## Text-code delivery
Atlas has no text-message service. With delivery set to `auto` it tries: (1) a texting service if its keys are saved (Twilio, about $1-2/month plus about a cent per text, short one-time registration); (2) otherwise the code is emailed from the church address to the email on that person's People row; (3) otherwise nothing. In `test` delivery (the default) codes go only to Brad's phone. The sheet has no phone numbers yet, so numbers are added by telling Atlas.

## Going live (Atlas does these after Brad says go)
1. Open the public door for just the sign-in path: `tailscale funnel --bg --https=8443 --set-path=/praxis http://127.0.0.1:4821/praxis` (this machine is already allowed to use Funnel). Address: `https://atlas.taila89b12.ts.net:8443/praxis`.
2. Add the real numbers by talking to Atlas; try test delivery on Brad's phone first.
3. `node tools/build-secure.js "https://atlas.taila89b12.ts.net:8443/praxis"`, check the page against the live door, copy `secure-build/index.html` over `index.html`, commit, push.
4. Switch delivery to `auto`.

## Honest limits
The repo is public and the Playbook is already in its git history; securing the site now doesn't un-publish that. Anyone who can read someone's texts can sign in as them, as with any text-code login.
