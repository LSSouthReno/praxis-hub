# Automatic reminder emails (design only. Nothing is built or turned on.)

**Status: OFF.** The hub cannot send email today. The "Preview my reminder email" button on My Praxis only shows text on screen.

## The idea from the call

A dedicated Gmail account for Praxis (for example an "admin" address) is connected to the hub. Each Saturday night, or ahead of a term, it emails every professor their own checklist, ending with "Your next thing is…" (their next commitment, even if it is months away). The same machinery can send one-off announcements to a group.

## How it would work

1. **Account.** Create the Praxis Gmail account. Turn on 2-step verification. Create an app password (or, better, an OAuth grant limited to "send mail"). The secret goes in Google Apps Script properties or GitHub Actions secrets, never in this repo.
2. **Sender.** A small Google Apps Script bound to the Praxis Hub Data sheet (same pattern as the church hub's checklist email). It reads People, Calendar and Action Items, builds each person's message with the same wording as the preview on My Praxis, and sends with `MailApp.sendEmail` from the Praxis account.
3. **Trigger.** A time-based trigger, weekly. Nothing runs unless someone creates the trigger.
4. **Safety.** Before any live send:
   - A `Send mode` cell in the sheet with values `off`, `test`, `live`. Ship as `off`.
   - `test` sends every message only to Brad.
   - A per-person opt-out column ("Reminders: no").
   - Skip anyone with no email on file, and skip people with nothing open and no upcoming date.
   - A log tab recording who was sent what and when.
   - A daily cap well under Gmail's limits (about 100 a day for free Gmail, 1,500 for Workspace). A Google Workspace account is the better home for this.
5. **Approval.** Brad reviews a `test` run, then flips the cell to `live`.

## What is still needed from Brad

- Who creates the Praxis Gmail/Workspace account, and its address.
- What day and time the reminders should go.
- Whether announcements should also email people, or only the weekly checklist.

Draft wording lives in `reminderText()` in `index.html` so the preview and the real email stay identical.
