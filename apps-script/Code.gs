/**
 * Praxis Hub: sign in with a phone number (text-message code), then see only what your role allows.
 *
 * This runs as a Google Apps Script web app owned by Brad. The Google Sheet stays PRIVATE: only this script reads it,
 * and it hands each signed-in person just the rows and columns their role is allowed to see. The page (index.html)
 * never receives the phone list or anyone else's private data.
 *
 * Roles (worked out from the sheet, so there is nothing extra to maintain):
 *   admin      Access tab says admin. Sees everything, same as board.
 *   board      People tab Group = Board. Everything: phones, notes, onboarding, action items, metrics, board posts/meetings, playbook.
 *   professor  Group = Professor (or School of Music). Courses, schedule, Everyone + Faculty posts, directory without phones/notes,
 *              calendar without board meetings, and ONLY their own onboarding checklist and the action items assigned to them.
 *   staff      Group = Staff. Everyone + Staff posts, directory without phones, calendar without board meetings, own action items.
 * Someone in two groups (e.g. Board + Professor) gets the higher role. An optional "Access" tab (Name, Phone, Role) can add
 * a number or override a role. A number that is not on the list gets nothing; the sign-in screen answers the same way
 * whether or not a number is known, so nobody can use it to find out who is on the list.
 *
 * Script properties to set (Project Settings > Script properties) - never in the code:
 *   SESSION_SECRET   any long random text (signs the "stay signed in" tokens)
 *   SMS_MODE         twilio (real texts) | test (codes are emailed to TEST_EMAIL instead - for trying it out)
 *   TEST_EMAIL       your email, for test mode
 *   TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM   (or TWILIO_SERVICE instead of TWILIO_FROM)   only for real texts
 */
var SHEET_ID = '1tkiJcJP1Eux57y4qkI2DUynBpc6teKtAWdNNY-M8MXE';
var TAB_NAMES = ['People', 'Announcements', 'Action Items', 'Calendar', 'Links', 'Metrics'];
var CODE_MINUTES = 10, SESSION_DAYS = 30, MAX_CODE_TRIES = 5, MAX_SENDS_PER_PHONE = 3, MAX_SENDS_PER_DAY = 150;
var ROLE_RANK = { admin: 5, board: 4, professor: 3, music: 3, staff: 2 };

/* ---------- web app entry (the page POSTs JSON as text/plain, so it is a "simple" cross-site request) ---------- */
function doPost(e) {
  var out;
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (b.action === 'requestCode') out = requestCode(b.phone);
    else if (b.action === 'verifyCode') out = verifyCode(b.phone, b.code);
    else if (b.action === 'data') out = getData(b.token);
    else if (b.action === 'playbook') out = getPlaybook(b.token);
    else out = { ok: false, error: 'unknown' };
  } catch (err) { out = { ok: false, error: 'server' }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return ContentService.createTextOutput('Praxis Hub sign-in is running.').setMimeType(ContentService.MimeType.TEXT); }

/* ---------- phone numbers ---------- */
/** US/Canada numbers to 10 digits ("(775) 555-0123", "+1 775-555-0123", "1.775.555.0123" all match). Other countries: + and the full number. */
function normPhone(s) {
  s = String(s == null ? '' : s).trim();
  var plus = s.charAt(0) === '+', d = s.replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  if (d.length === 10) return d;
  return plus && d.length >= 8 && d.length <= 15 ? '+' + d : '';
}
/** A cell may hold several numbers ("775-555-0123 / 775-555-0199"). */
function phonesIn(cell) { return String(cell || '').split(/[\/;,|\n]|\s{2,}|\bor\b/i).map(normPhone).filter(Boolean); }
function toE164(p) { return p.charAt(0) === '+' ? p : '+1' + p; }

/* ---------- reading the sheet (private; only this script can) ---------- */
function readTab(name) {
  var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
  if (!sh) return null;
  var v = sh.getDataRange().getValues();
  return v.length ? v : null;
}
function normKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function headIndex(head) { var m = {}; head.forEach(function (h, i) { m[normKey(h)] = i; }); return m; }
function groupToRole(g) {
  g = normKey(g);
  if (g.indexOf('board') >= 0) return 'board';
  if (g.indexOf('music') >= 0) return 'music';
  if (g.indexOf('staff') >= 0 || g.indexOf('ops') >= 0 || g.indexOf('operation') >= 0) return 'staff';
  return 'professor';
}
/** Everyone who may sign in: phone (normalized) -> { name, role }. Highest role wins when a number appears twice. */
function loadRoster() {
  var roster = {}, add = function (ph, name, role) {
    var cur = roster[ph];
    if (!cur || ROLE_RANK[role] > ROLE_RANK[cur.role]) roster[ph] = { name: name, role: role };
  };
  var people = readTab('People');
  if (people) {
    var h = headIndex(people[0]);
    for (var i = 1; i < people.length; i++) {
      var r = people[i], name = String(r[h.name] || '').trim(); if (!name) continue;
      var role = groupToRole(r[h.group]);
      phonesIn(r[h.phone]).forEach(function (ph) { add(ph, name, role); });
    }
  }
  var access = readTab('Access');   // optional: Name, Phone, Role
  if (access) {
    var a = headIndex(access[0]);
    for (var j = 1; j < access.length; j++) {
      var row = access[j], rr = normKey(row[a.role]);
      var role2 = rr === 'admin' ? 'admin' : rr === 'board' ? 'board' : rr === 'staff' ? 'staff' : (rr === 'professor' || rr === 'faculty' || rr === 'music') ? 'professor' : '';
      if (!role2) continue;
      phonesIn(row[a.phone]).forEach(function (ph) { roster[ph] = { name: String(row[a.name] || '').trim() || 'Praxis', role: role2 }; });   // an explicit row overrides
    }
  }
  return roster;
}

/* ---------- sign-in ---------- */
function props() { return PropertiesService.getScriptProperties(); }
function sha(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)); }
function same(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function randomCode() {   // Utilities.getUuid() is a proper random source (Math.random is not)
  var hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 12);
  return ('000000' + (parseInt(hex, 16) % 1000000)).slice(-6);
}
var GENERIC = { ok: true, sent: true };   // the same answer for known and unknown numbers

function requestCode(phoneRaw) {
  var ph = normPhone(phoneRaw);
  if (!ph) return { ok: false, error: 'badphone' };   // not a phone number at all (reveals nothing about the list)
  var cache = CacheService.getScriptCache(), lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var day = 'day:' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd'), n = Number(cache.get(day) || 0);
    if (n >= MAX_SENDS_PER_DAY) return { ok: false, error: 'busy' };
    var sk = 'sends:' + sha(ph), sent = Number(cache.get(sk) || 0);
    if (sent >= MAX_SENDS_PER_PHONE) return { ok: false, error: 'toomany' };
    cache.put(sk, String(sent + 1), 15 * 60);
    var person = loadRoster()[ph];
    if (!person) return GENERIC;   // unknown number: no text, same reply
    var code = randomCode();
    cache.put('code:' + sha(ph), JSON.stringify({ h: sha(code + ':' + ph + ':' + props().getProperty('SESSION_SECRET')), tries: 0 }), CODE_MINUTES * 60);
    cache.put(day, String(n + 1), 24 * 3600);
    sendCode(ph, code, person);
    return GENERIC;
  } finally { lock.releaseLock(); }
}
function sendCode(ph, code, person) {
  var mode = props().getProperty('SMS_MODE') || 'test', text = 'Your Praxis code is ' + code + '. It expires in ' + CODE_MINUTES + ' minutes. Do not share it.';
  if (mode === 'twilio') {
    var sid = props().getProperty('TWILIO_SID'), tok = props().getProperty('TWILIO_TOKEN');
    var payload = { To: toE164(ph), Body: text };
    if (props().getProperty('TWILIO_SERVICE')) payload.MessagingServiceSid = props().getProperty('TWILIO_SERVICE'); else payload.From = props().getProperty('TWILIO_FROM');
    UrlFetchApp.fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', { method: 'post', payload: payload, headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + tok) }, muteHttpExceptions: true });
  } else {   // test mode: the code goes to Brad's own email, never to the person
    var to = props().getProperty('TEST_EMAIL');
    if (to) MailApp.sendEmail(to, 'Praxis sign-in code (test) for ' + person.name, text + '\n\n(' + person.name + ', ' + person.role + ', ' + ph + ')');
  }
}
function verifyCode(phoneRaw, codeRaw) {
  var ph = normPhone(phoneRaw), code = String(codeRaw || '').replace(/\D/g, '');
  if (!ph || code.length !== 6) return { ok: false, error: 'badcode' };
  var cache = CacheService.getScriptCache(), lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var key = 'code:' + sha(ph), raw = cache.get(key);
    if (!raw) return { ok: false, error: 'badcode' };
    var rec = JSON.parse(raw);
    if (rec.tries >= MAX_CODE_TRIES) { cache.remove(key); return { ok: false, error: 'badcode' }; }
    if (!same(rec.h, sha(code + ':' + ph + ':' + props().getProperty('SESSION_SECRET')))) {
      rec.tries++; cache.put(key, JSON.stringify(rec), CODE_MINUTES * 60); return { ok: false, error: 'badcode' };
    }
    cache.remove(key);
    var person = loadRoster()[ph];
    if (!person) return { ok: false, error: 'badcode' };
    return { ok: true, token: makeToken(ph), role: person.role, name: person.name };
  } finally { lock.releaseLock(); }
}

/* ---------- "stay signed in" tokens: signed, expire, and are re-checked against the sheet on every use ---------- */
function sign(body) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, props().getProperty('SESSION_SECRET'))); }
function makeToken(ph) { var body = Utilities.base64EncodeWebSafe(JSON.stringify({ p: ph, e: Date.now() + SESSION_DAYS * 86400000 })); return body + '.' + sign(body); }
/** The signed-in person, or null. Removing a number from the sheet cuts that person off straight away. */
function whoIs(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2 || !props().getProperty('SESSION_SECRET') || !same(parts[1], sign(parts[0]))) return null;
  var p; try { p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); } catch (e) { return null; }
  if (!p || !p.p || p.e < Date.now()) return null;
  var person = loadRoster()[p.p];
  return person ? { phone: p.p, name: person.name, role: person.role } : null;
}

/* ---------- what each role may see ---------- */
function csvCell(v) { if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd'); v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function toCsv(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n'); }
var BLANK_FOR_OTHERS = /^(phone|notes?|contract.*|handbook.*|syllabus.*|bio.*|w-?9|taxform)$/;   // private columns on someone else's People row
function sameName(a, b) { return normKey(a) !== '' && normKey(a) === normKey(b); }

function filterTab(tab, rows, who) {
  var head = rows[0], h = headIndex(head), body = rows.slice(1), full = who.role === 'board' || who.role === 'admin';
  function col(names) { for (var i = 0; i < names.length; i++) if (h[normKey(names[i])] !== undefined) return h[normKey(names[i])]; return -1; }
  if (tab === 'Action Items') {
    if (!full) { var oc = col(['Owner', 'Assigned to', 'Who', 'Assignee']); body = body.filter(function (r) { return oc >= 0 && sameName(r[oc], who.name); }); }
  } else if (tab === 'Metrics') {
    if (!full) body = [];
  } else if (tab === 'Announcements') {
    var ac = col(['Audience', 'For', 'To']);
    if (!full) body = body.filter(function (r) {
      var a = normKey(ac >= 0 ? r[ac] : '');
      if (a.indexOf('board') >= 0) return false;
      if (a.indexOf('staff') >= 0) return who.role === 'staff';
      if (a.indexOf('fac') >= 0 || a.indexOf('prof') >= 0) return who.role !== 'staff';
      return true;   // Everyone / blank
    });
  } else if (tab === 'Calendar') {
    var tc = col(['Type', 'Kind', 'Category']);
    if (!full) body = body.filter(function (r) { var t = normKey(tc >= 0 ? r[tc] : ''); return t.indexOf('board') < 0 && t.indexOf('meeting') < 0; });
  } else if (tab === 'People') {
    if (!full) {
      var nc = col(['Name', 'Full name', 'Person']);
      body = body.map(function (r) {
        var mine = nc >= 0 && sameName(r[nc], who.name);
        return r.map(function (v, i) { return (!mine && BLANK_FOR_OTHERS.test(normKey(head[i]))) ? '' : v; });
      });
    }
  }
  return [head].concat(body);
}
function getData(token) {
  var who = whoIs(token);
  if (!who) return { ok: false, error: 'session' };
  var tabs = {};
  TAB_NAMES.forEach(function (t) { var rows = readTab(t); if (rows) tabs[t] = toCsv(filterTab(t, rows, who)); });
  return { ok: true, role: who.role, name: who.name, tabs: tabs };
}
/** The playbook text lives only here (Playbook.html in this project), never in the public page. Board and admin only. */
function getPlaybook(token) {
  var who = whoIs(token);
  if (!who) return { ok: false, error: 'session' };
  if (who.role !== 'board' && who.role !== 'admin') return { ok: false, error: 'forbidden' };
  return { ok: true, html: HtmlService.createHtmlOutputFromFile('Playbook').getContent() };
}
