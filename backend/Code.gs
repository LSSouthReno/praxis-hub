/* =====================================================================
   Praxis Hub · private backend (Google Apps Script web app)

   Holds everything that must NOT live in the public "Praxis Hub Data"
   sheet: professors' phone numbers, their checklist submissions, photos,
   contracts and signatures. All of it sits in a private spreadsheet and a
   private Drive folder owned by whoever runs setup(). Nothing is shared.

   One-time setup (the owner, in the Apps Script editor):
     1. Choose setup in the function list and press Run.
     2. Approve the permissions prompt.
     3. The log prints the private sheet link and the admin password.
   The web app is already deployed; it starts answering after step 2.

   Who can do what
   - A professor picks their name in the hub and enters the last 4 digits
     of the phone number the office has on file. That unlocks their own
     checklist for this browser session (6 hours).
   - Viewing or signing the contract asks for those 4 digits again, every
     time, and the contract is streamed from Drive only after that check.
     The file itself is never shared or linked.
   - 5 wrong tries lock that professor for 15 minutes; 10 in a day lock
     them until the office unlocks them in the admin view.
   - The admin view (Kyle and Nicole) uses the password in the Settings
     tab of the private sheet. Change it there any time.
   ===================================================================== */

var PH = {
  PUBLIC_SHEET_ID: '1tkiJcJP1Eux57y4qkI2DUynBpc6teKtAWdNNY-M8MXE',
  TOKEN_SECONDS: 6 * 3600,      // professor + admin sessions
  GRANT_SECONDS: 30 * 60,       // contract view → sign window
  SOFT_FAILS: 5, SOFT_LOCK_MIN: 15,
  HARD_FAILS: 10,               // within 24 h → locked until the office unlocks
  ADMIN_FAILS: 5, ADMIN_LOCK_MIN: 15,
  MAX_FILE_BYTES: 12 * 1024 * 1024,
  CHUNK_SECONDS: 20 * 60
};

var ITEMS = [
  { key: 'contract', label: 'Sign your contract',            need: 'Needs contract',            done: 'Contract signed', said: 'signed their contract' },
  { key: 'contact',  label: 'Update your contact information', need: 'Needs contact info',      done: 'Contact updated', said: 'updated their contact information' },
  { key: 'photo',    label: 'Send a photo for the website',  need: 'Needs photo',               done: 'Photo updated', said: 'sent a photo for the website' },
  { key: 'desc',     label: 'Describe your course in two sentences', need: 'Needs course description', done: 'Descriptions updated', said: 'sent their course description' }
];

var COLS = ['Name', 'Phone on file', 'Email on file', 'Courses',
  'Needs contract', 'Needs contact info', 'Needs photo', 'Needs course description',
  'Contract file', 'Signing link', 'Contract signed', 'Signed as', 'Signed copy file',
  'Contact updated', 'Preferred name', 'Email (submitted)', 'Phone (submitted)', 'Mailing address', 'Contact notes',
  'Photo file', 'Photo updated', 'Course descriptions', 'Descriptions updated',
  'Office notes', 'Last activity', '_data'];

var PROF_TAB = 'Professors', LOG_TAB = 'Activity', SET_TAB = 'Settings', README_TAB = 'Read me';

/* ---------------------------------------------------------------- setup */

function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss = privateSS_(true);
  var folder = privateFolder_(true);
  try { DriveApp.getFileById(ss.getId()).moveTo(folder); } catch (e) {}
  ensureTabs_(ss);
  var added = syncRoster_();
  var pw = setting_('Admin password');
  var msg = [
    'Praxis Hub backend is ready.',
    'Private sheet: ' + ss.getUrl(),
    'Private files folder: ' + folder.getUrl(),
    'Admin password (change it in the Settings tab): ' + pw,
    'Professors added from the public People tab: ' + added.length
  ].join('\n');
  Logger.log(msg);
  props.setProperty('SETUP_AT', new Date().toISOString());
  return msg;
}

function privateSS_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PRIVATE_SS_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { if (!create) throw e; } }
  if (!create) throw new Error('not_setup');
  var ss = SpreadsheetApp.create('Praxis Hub · Private professor records');
  props.setProperty('PRIVATE_SS_ID', ss.getId());
  return ss;
}

function privateFolder_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PRIVATE_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { if (!create) throw e; } }
  if (!create) throw new Error('not_setup');
  var f = DriveApp.createFolder('Praxis Hub · Private files');
  props.setProperty('PRIVATE_FOLDER_ID', f.getId());
  return f;
}

function ensureTabs_(ss) {
  var sh = ss.getSheetByName(PROF_TAB);
  if (!sh) {
    sh = ss.getSheets()[0];
    if (sh && sh.getLastRow() === 0 && sh.getName() !== LOG_TAB && sh.getName() !== SET_TAB) sh.setName(PROF_TAB);
    else sh = ss.insertSheet(PROF_TAB);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]);
    cosmetic_(function () {
      sh.setFrozenRows(1); sh.setFrozenColumns(1);
      sh.getRange(1, 1, 1, COLS.length).setFontWeight('bold').setBackground('#171A21').setFontColor('#F8F7FF');
      sh.setColumnWidth(1, 200);
      ['Course descriptions', 'Mailing address', 'Office notes'].forEach(function (c) { sh.setColumnWidth(COLS.indexOf(c) + 1, 320); });
      sh.hideColumns(COLS.indexOf('_data') + 1);
      var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
      ['Needs contract', 'Needs contact info', 'Needs photo', 'Needs course description'].forEach(function (c) {
        sh.getRange(2, COLS.indexOf(c) + 1, 200, 1).setDataValidation(rule);
      });
      sh.getRange(2, COLS.indexOf('Phone on file') + 1, 200, 1).setNumberFormat('@');
    });
  }
  var log = ss.getSheetByName(LOG_TAB);
  if (!log) {
    log = ss.insertSheet(LOG_TAB);
    log.getRange(1, 1, 1, 5).setValues([['When', 'Who', 'Professor', 'What', 'Detail']]);
    cosmetic_(function () { log.setFrozenRows(1); log.getRange(1, 1, 1, 5).setFontWeight('bold'); log.setColumnWidth(5, 420); });
  }
  var st = ss.getSheetByName(SET_TAB);
  if (!st) {
    st = ss.insertSheet(SET_TAB);
    st.getRange(1, 1, 5, 3).setValues([
      ['Setting', 'Value', 'What it does'],
      ['Admin password', randomPassword_(), 'Kyle and Nicole sign in to the hub admin view with this. Change it any time; it takes effect at once.'],
      ['Notify emails', '', 'Comma-separated. Gets an email when a professor finishes an item or is locked out. Leave blank for none.'],
      ['Hub address', 'https://lssouthreno.github.io/praxis-hub/', 'Used in notification emails.'],
      ['Office contact', 'the Praxis office', 'Shown to professors who cannot sign in, e.g. "Nicole Cox (nicole@…)".']
    ]);
    cosmetic_(function () { st.setFrozenRows(1); st.getRange(1, 1, 1, 3).setFontWeight('bold'); st.setColumnWidth(2, 320); st.setColumnWidth(3, 520); });
  }
  var rm = ss.getSheetByName(README_TAB);
  if (!rm) {
    rm = ss.insertSheet(README_TAB);
    rm.getRange(1, 1, 10, 1).setValues([
      ['Praxis Hub · private professor records'],
      ['This sheet is private. Do not share it with "anyone with the link". Share it only with the people who run the Praxis office.'],
      ['Professors tab: one row per professor. "Phone on file" is what they sign in with (last 4 digits). Untick a "Needs …" box when the office already has that item, and it disappears from that professor\'s checklist.'],
      ['Contract file: upload a contract from the hub admin view, or paste a Google Drive link to a PDF or Google Doc here. The file stays private; professors see it only through the hub after re-entering their 4 digits.'],
      ['Signing link: optional. If you use DocuSign, Adobe Sign or similar, paste the professor\'s signing link here and the hub shows a Sign button that opens it.'],
      ['Contract signed: filled in when a professor signs in the hub or uploads a signed copy. You can also type a date here yourself to mark it done.'],
      ['Columns from "Contact updated" onward are filled by the hub. You can edit them, but the next submission overwrites them.'],
      ['Activity tab: every sign-in, failed try, contract view, signature and upload, newest at the bottom.'],
      ['Settings tab: admin password and who gets notification emails.'],
      ['Names must match the public People tab exactly (accents and capitals do not matter). If you rename someone there, rename them here too, or they will not find their checklist.']
    ]);
    cosmetic_(function () { rm.setColumnWidth(1, 900); rm.getRange(1, 1).setFontWeight('bold').setFontSize(14); rm.getRange(2, 1, 9, 1).setWrap(true); });
  }
}

function cosmetic_(fn) { try { fn(); } catch (e) {} }

function randomPassword_() {
  var words = ['cedar', 'harbor', 'lantern', 'meadow', 'summit', 'timber', 'quarry', 'beacon', 'orchard', 'canyon', 'granite', 'willow'];
  var u = Utilities.getUuid().replace(/-/g, '');
  var a = words[parseInt(u.slice(0, 2), 16) % words.length], b = words[parseInt(u.slice(2, 4), 16) % words.length];
  return a + '-' + b + '-' + (1000 + parseInt(u.slice(4, 8), 16) % 9000);
}

/* Adds a row for every professor on the public People tab who is not here yet. */
function syncRoster_() {
  var pub = SpreadsheetApp.openById(PH.PUBLIC_SHEET_ID).getSheetByName('People');
  if (!pub) return [];
  var v = pub.getDataRange().getValues();
  var h = v[0].map(function (x) { return String(x).trim().toLowerCase(); });
  var iN = h.indexOf('name'), iG = h.indexOf('group'), iT = h.indexOf('title'), iC = h.indexOf('courses'), iE = h.indexOf('email');
  var have = {};
  readProfs_().forEach(function (r) { have[norm_(r.Name)] = true; });
  var add = [];
  for (var i = 1; i < v.length; i++) {
    var name = String(v[i][iN] || '').trim();
    if (!name) continue;
    var g = String(iG >= 0 ? v[i][iG] : '').toLowerCase(), t = String(iT >= 0 ? v[i][iT] : '').toLowerCase();
    var courses = iC >= 0 ? String(v[i][iC] || '').trim() : '';
    if (!(/prof|faculty|music/.test(g) || /prof/.test(t) || courses)) continue;
    if (have[norm_(name)]) continue;
    have[norm_(name)] = true;
    var row = {};
    row.Name = name;
    row['Email on file'] = iE >= 0 ? String(v[i][iE] || '').trim() : '';
    // Phone numbers are NOT copied from the public sheet: the last 4 digits are the sign-in secret.
    row['Phone on file'] = '';
    row.Courses = courses;
    row['Needs contract'] = true; row['Needs contact info'] = true; row['Needs photo'] = true; row['Needs course description'] = true;
    add.push(row);
  }
  if (add.length) {
    var sh = profSheet_();
    var hdr = headers_(sh);
    sh.getRange(sh.getLastRow() + 1, 1, add.length, hdr.length).setValues(add.map(function (r) {
      return hdr.map(function (c) { return r[c] === undefined ? '' : r[c]; });
    }));
  }
  return add.map(function (r) { return r.Name; });
}

/* ---------------------------------------------------------------- web app */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) {
    var body = {};
    if (p.p) { try { body = JSON.parse(p.p); } catch (err) { return out_(p.action, { ok: false, error: 'bad_json' }); } }
    return out_(p.action, route_(p.action, body));
  }
  return out_('', { ok: true, service: 'praxis-hub', ready: isReady_() });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out_('', { ok: false, error: 'bad_json' }); }
  var action = String(body.action || '');
  return out_(action, route_(action, body));
}

function out_(action, obj) {
  obj['for'] = action;
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

var ROUTES = {
  ping: function () { return { ok: true, ready: isReady_() }; },
  chunk: apiChunk_,
  prof_verify: apiProfVerify_, prof_me: apiProfMe_, prof_contact: apiProfContact_,
  prof_photo: apiProfPhoto_, prof_desc: apiProfDesc_, prof_contract: apiProfContract_,
  prof_sign: apiProfSign_, prof_signed_copy: apiProfSignedCopy_, prof_signout: apiSignout_,
  adm_login: apiAdmLogin_, adm_list: apiAdmList_, adm_update: apiAdmUpdate_, adm_file: apiAdmFile_,
  adm_contract: apiAdmContract_, adm_unlock: apiAdmUnlock_, adm_log: apiAdmLog_, adm_sync: apiAdmSync_,
  adm_signout: apiSignout_
};

function route_(action, body) {
  var fn = ROUTES[action];
  if (!fn) return { ok: false, error: 'unknown_action' };
  if (action !== 'ping' && !isReady_()) return { ok: false, error: 'not_setup', message: 'The hub’s private store is not switched on yet.' };
  try {
    return fn(body || {});
  } catch (err) {
    var code = String(err && err.message || err);
    if (/^[a-z_]+$/.test(code)) return { ok: false, error: code, message: MESSAGES[code] || '' };
    try { log_('System', '', 'Error', action + ': ' + code); } catch (e2) {}
    return { ok: false, error: 'server', message: 'Something went wrong on our side. Try again in a minute.' };
  }
}

var MESSAGES = {
  bad_token: 'Your session ended. Confirm it is you again.',
  bad_admin: 'Your admin session ended. Sign in again.',
  no_match: 'We could not find that name in the professor records.',
  no_phone: 'The Praxis office has not added a phone number for you yet, so the hub cannot check it is you.',
  wrong_pin: 'Those digits do not match the phone number on file.',
  locked: 'Too many tries. Wait 15 minutes and try again.',
  hard_locked: 'This checklist is locked after too many tries. Ask the Praxis office to unlock it.',
  admin_locked: 'Too many tries. Wait 15 minutes and try again.',
  wrong_password: 'That password did not match.',
  no_contract: 'Your contract is not ready yet. The office will let you know.',
  bad_grant: 'Open your contract again to sign it.',
  bad_file: 'That file could not be read.',
  too_big: 'That file is too large. Keep it under 12 MB.',
  bad_type: 'That kind of file is not accepted here.',
  chunks_missing: 'The upload was interrupted. Try again.',
  missing: 'Some required information is missing.',
  not_needed: 'That item is not on your checklist.'
};

function isReady_() {
  var props = PropertiesService.getScriptProperties();
  return !!(props.getProperty('PRIVATE_SS_ID') && props.getProperty('PRIVATE_FOLDER_ID'));
}

/* ---------------------------------------------------------------- sheet access */

function profSheet_() { return privateSS_(false).getSheetByName(PROF_TAB); }

function headers_(sh) {
  var lc = Math.max(1, sh.getLastColumn());
  var h = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (x) { return String(x).trim(); });
  // Add any column a later version introduced, so old sheets keep working.
  var missing = COLS.filter(function (c) { return h.indexOf(c) < 0; });
  if (missing.length) {
    sh.getRange(1, h.length + 1, 1, missing.length).setValues([missing]);
    h = h.concat(missing);
  }
  return h;
}

function readProfs_() {
  var sh = profSheet_();
  var hdr = headers_(sh);
  var n = sh.getLastRow();
  if (n < 2) return [];
  var v = sh.getRange(2, 1, n - 1, hdr.length).getValues();
  var rows = [];
  for (var i = 0; i < v.length; i++) {
    var r = { _row: i + 2 };
    for (var j = 0; j < hdr.length; j++) r[hdr[j]] = v[i][j];
    if (String(r.Name || '').trim()) rows.push(r);
  }
  return rows;
}

function findProf_(name) {
  var k = norm_(name);
  if (!k) return null;
  var rows = readProfs_();
  for (var i = 0; i < rows.length; i++) if (norm_(rows[i].Name) === k) return rows[i];
  return null;
}

function writeProf_(row, fields) {
  var sh = profSheet_();
  var hdr = headers_(sh);
  Object.keys(fields).forEach(function (c) {
    var j = hdr.indexOf(c);
    if (j < 0) return;
    var cell = sh.getRange(row._row, j + 1);
    var val = fields[c];
    if (c === 'Phone on file') cosmetic_(function () { cell.setNumberFormat('@'); });
    cell.setValue(val);
    row[c] = val;
  });
}

function data_(row) { try { return JSON.parse(row._data || '{}') || {}; } catch (e) { return {}; } }

function saveData_(row, d, extra) {
  var f = extra || {};
  f._data = JSON.stringify(d);
  writeProf_(row, f);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function log_(who, prof, what, detail) {
  var sh = privateSS_(false).getSheetByName(LOG_TAB);
  if (sh) sh.appendRow([new Date(), who, prof || '', what, detail || '']);
}

function setting_(key) {
  var sh = privateSS_(false).getSheetByName(SET_TAB);
  if (!sh) return '';
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim().toLowerCase() === key.toLowerCase()) return String(v[i][1] || '').trim();
  return '';
}

/* ---------------------------------------------------------------- helpers */

function norm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\(sample\)/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function digits_(s) { return String(s || '').replace(/\D+/g, ''); }
function last4_(s) { var d = digits_(s); return d.length >= 4 ? d.slice(-4) : ''; }
function truthy_(v) { return v === true || /^(true|yes|y|1|x|✓)$/i.test(String(v || '').trim()); }
function iso_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v.toISOString();
  return String(v);
}
function clip_(s, n) { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n) : s; }
function token_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function fileId_(v) {
  var s = String(v || '').trim();
  if (!s) return '';
  var m = s.match(/\/d\/([-\w]{20,})/) || s.match(/[?&]id=([-\w]{20,})/) || s.match(/^([-\w]{20,})$/);
  return m ? m[1] : '';
}
function hex_(bytes) {
  return bytes.map(function (b) { var x = (b < 0 ? b + 256 : b).toString(16); return x.length < 2 ? '0' + x : x; }).join('');
}

function cache_() { return CacheService.getScriptCache(); }

function session_(tok, kind) {
  if (!tok || typeof tok !== 'string' || tok.length < 40) return null;
  var raw = cache_().get('t:' + tok);
  if (!raw) return null;
  var s = JSON.parse(raw);
  return s.kind === kind ? s : null;
}

function profFromToken_(body) {
  var s = session_(body.tok, 'prof');
  if (!s) throw new Error('bad_token');
  var row = findProf_(s.name);
  if (!row) throw new Error('bad_token');
  return row;
}

function requireAdmin_(body) {
  var s = session_(body.adm, 'admin');
  if (!s) throw new Error('bad_admin');
  return s;
}

/* Failed-try tracking, per professor. */
function failKey_(name) { return 'f:' + norm_(name).slice(0, 80); }
function failState_(name) {
  var raw = PropertiesService.getScriptProperties().getProperty(failKey_(name));
  var s = raw ? JSON.parse(raw) : { n: 0, first: 0, until: 0, hard: false };
  if (!s.hard && s.first && Date.now() - s.first > 24 * 3600 * 1000) s = { n: 0, first: 0, until: 0, hard: false };
  return s;
}
function checkLock_(name) {
  var s = failState_(name);
  if (s.hard) throw new Error('hard_locked');
  if (s.until && Date.now() < s.until) throw new Error('locked');
}
function recordFail_(row, what) {
  var name = row.Name;
  var s = failState_(name);
  s.n++; if (!s.first) s.first = Date.now();
  var notice = '';
  if (s.n >= PH.HARD_FAILS) { s.hard = true; notice = 'hard'; }
  else if (s.n % PH.SOFT_FAILS === 0) { s.until = Date.now() + PH.SOFT_LOCK_MIN * 60000; notice = 'soft'; }
  PropertiesService.getScriptProperties().setProperty(failKey_(name), JSON.stringify(s));
  log_('Professor', name, 'Wrong digits', what + (notice === 'hard' ? ' · locked until the office unlocks' : notice === 'soft' ? ' · locked 15 min' : ''));
  if (notice === 'hard') notify_(name + ' is locked out of the Praxis Hub', 'There were ' + s.n + ' wrong tries at ' + name + '’s 4 digits in the last day, so their checklist and contract are locked. If it was them, unlock them in the admin view. If not, someone may be guessing.');
  if (notice) throw new Error(notice === 'hard' ? 'hard_locked' : 'locked');
  throw new Error('wrong_pin');
}
function clearFails_(name) { PropertiesService.getScriptProperties().deleteProperty(failKey_(name)); }

function verifyPin_(row, pin, what) {
  checkLock_(row.Name);
  var want = last4_(row['Phone on file']);
  if (!want) throw new Error('no_phone');
  var got = digits_(pin);
  if (got.length !== 4 || got !== want) recordFail_(row, what);
  clearFails_(row.Name);
}

function notify_(subject, text) {
  var to = setting_('Notify emails');
  if (!to) return;
  try {
    MailApp.sendEmail({ to: to, subject: '[Praxis Hub] ' + subject, body: text + '\n\nOpen the admin view: ' + (setting_('Hub address') || '') + '#admin' });
  } catch (e) { log_('System', '', 'Email failed', String(e)); }
}

/* ---------------------------------------------------------------- uploads */

/* Large files are posted in one request. If a browser drops the POST body
   (it happens on the Apps Script redirect for some signed-in Google users)
   the hub falls back to sending small GET chunks; this stores them. */
function apiChunk_(b) {
  if (!session_(b.tok, 'prof') && !session_(b.adm, 'admin')) throw new Error('bad_token');
  var uid = String(b.uid || ''), i = Number(b.i);
  if (!/^[a-z0-9]{12,40}$/i.test(uid) || !(i >= 0 && i < 4000) || typeof b.d !== 'string' || b.d.length > 90000) throw new Error('bad_file');
  cache_().put('c:' + uid + ':' + i, b.d, PH.CHUNK_SECONDS);
  return { ok: true, i: i };
}

function payload_(b) {
  var data = b.data;
  if (!data && b.uid) {
    var n = Number(b.n);
    if (!(n > 0 && n <= 4000)) throw new Error('bad_file');
    var keys = []; for (var i = 0; i < n; i++) keys.push('c:' + b.uid + ':' + i);
    var got = {};
    for (var k = 0; k < keys.length; k += 100) {
      var part = cache_().getAll(keys.slice(k, k + 100));
      Object.keys(part).forEach(function (x) { got[x] = part[x]; });
    }
    var parts = [];
    for (var j = 0; j < n; j++) { if (got[keys[j]] == null) throw new Error('chunks_missing'); parts.push(got[keys[j]]); }
    data = parts.join('');
    cache_().removeAll(keys);
  }
  if (!data || typeof data !== 'string') throw new Error('bad_file');
  data = data.replace(/^data:[^,]*,/, '');
  if (data.length > PH.MAX_FILE_BYTES * 1.37) throw new Error('too_big');
  var bytes;
  try { bytes = Utilities.base64Decode(data); } catch (e) { throw new Error('bad_file'); }
  if (!bytes.length) throw new Error('bad_file');
  if (bytes.length > PH.MAX_FILE_BYTES) throw new Error('too_big');
  return bytes;
}

function saveFile_(bytes, mime, name) {
  var blob = Utilities.newBlob(bytes, mime, name);
  return privateFolder_(false).createFile(blob);
}

var PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
var DOC_TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic' };
var CONTRACT_TYPES = { 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };

function stamp_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HHmm'); }

/* ---------------------------------------------------------------- professor API */

function itemsFor_(row) {
  return ITEMS.map(function (it) {
    var at = row[it.done];
    return { key: it.key, label: it.label, needed: truthy_(row[it.need]), done: !!String(at || '').trim(), at: iso_(at) };
  });
}

function meFor_(row) {
  var d = data_(row);
  var c = d.contact || {};
  var courses = String(row.Courses || '').split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(String);
  var descs = d.descriptions || [];
  var cid = fileId_(row['Contract file']);
  return {
    name: row.Name,
    items: itemsFor_(row),
    contact: {
      preferredName: c.preferredName || row['Preferred name'] || row.Name,
      email: c.email || row['Email (submitted)'] || row['Email on file'] || '',
      phone: c.phone || row['Phone (submitted)'] || row['Phone on file'] || '',
      address: c.address || row['Mailing address'] || '',
      notes: c.notes || ''
    },
    courses: courses,
    descriptions: descs,
    photo: { at: iso_(row['Photo updated']) },
    contract: {
      ready: !!cid || !!String(row['Signing link'] || '').trim(),
      hasFile: !!cid,
      signingUrl: String(row['Signing link'] || '').trim(),
      signedAt: iso_(row['Contract signed']),
      signedAs: String(row['Signed as'] || ''),
      signedCopy: !!fileId_(row['Signed copy file'])
    },
    office: setting_('Office contact') || 'the Praxis office'
  };
}

function apiProfVerify_(b) {
  var row = findProf_(b.name);
  if (!row) throw new Error('no_match');
  if (!last4_(row['Phone on file'])) {
    log_('Professor', row.Name, 'Could not sign in', 'No phone on file');
    return { ok: false, error: 'no_phone', message: MESSAGES.no_phone, office: setting_('Office contact') || 'the Praxis office' };
  }
  verifyPin_(row, b.pin, 'sign-in');
  var tok = token_();
  cache_().put('t:' + tok, JSON.stringify({ kind: 'prof', name: row.Name, at: Date.now() }), PH.TOKEN_SECONDS);
  writeProf_(row, { 'Last activity': new Date() });
  log_('Professor', row.Name, 'Signed in', '');
  return { ok: true, tok: tok, me: meFor_(row) };
}

function apiProfMe_(b) { return { ok: true, me: meFor_(profFromToken_(b)) }; }

function apiSignout_(b) {
  if (b.tok) cache_().remove('t:' + b.tok);
  if (b.adm) cache_().remove('t:' + b.adm);
  return { ok: true };
}

function markDone_(row, key, d, extra) {
  var it = ITEMS.filter(function (x) { return x.key === key; })[0];
  var first = !String(row[it.done] || '').trim();
  var f = extra || {};
  f[it.done] = new Date();
  f['Last activity'] = new Date();   // professor activity only; office edits do not count
  saveData_(row, d, f);
  if (first) notify_(row.Name + ' ' + it.said, row.Name + ' ' + it.said + ' in the Praxis Hub.' + (left_(row) ? ' Still open for them: ' + left_(row) + '.' : ' Their checklist is complete.'));
}

function left_(row) {
  return itemsFor_(row).filter(function (x) { return x.needed && !x.done; }).map(function (x) { return x.label.toLowerCase(); }).join(', ');
}

function apiProfContact_(b) {
  return withLock_(function () {
    var row = profFromToken_(b);
    var c = b.contact || {};
    var contact = {
      preferredName: clip_(c.preferredName, 120), email: clip_(c.email, 160), phone: clip_(c.phone, 40),
      address: clip_(c.address, 400), notes: clip_(c.notes, 1000)
    };
    if (!contact.email && !contact.phone) throw new Error('missing');
    if (contact.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) return { ok: false, error: 'missing', message: 'That email address does not look complete.' };
    var d = data_(row); d.contact = contact; d.contactAt = new Date().toISOString();
    var changed = [];
    if (contact.phone && digits_(contact.phone) !== digits_(row['Phone on file'])) changed.push('phone differs from the one on file');
    markDone_(row, 'contact', d, {
      'Preferred name': contact.preferredName, 'Email (submitted)': contact.email, 'Phone (submitted)': contact.phone,
      'Mailing address': contact.address, 'Contact notes': contact.notes
    });
    log_('Professor', row.Name, 'Updated contact info', changed.join('; '));
    return { ok: true, me: meFor_(row) };
  });
}

function apiProfPhoto_(b) {
  var row = profFromToken_(b);
  var mime = String(b.mime || '').toLowerCase();
  if (!PHOTO_TYPES[mime]) throw new Error('bad_type');
  var bytes = payload_(b);
  var file = saveFile_(bytes, mime, row.Name + ' · photo · ' + stamp_() + '.' + PHOTO_TYPES[mime]);
  return withLock_(function () {
    row = findProf_(row.Name);
    var d = data_(row);
    d.photos = (d.photos || []).concat([{ id: file.getId(), at: new Date().toISOString(), bytes: bytes.length, w: Number(b.w) || 0, h: Number(b.h) || 0 }]).slice(-10);
    markDone_(row, 'photo', d, { 'Photo file': file.getUrl() });
    log_('Professor', row.Name, 'Uploaded photo', Math.round(bytes.length / 1024) + ' KB' + (b.w ? ' · ' + b.w + '×' + b.h : ''));
    return { ok: true, me: meFor_(row) };
  });
}

function apiProfDesc_(b) {
  return withLock_(function () {
    var row = profFromToken_(b);
    var list = (b.items || []).map(function (x) { return { course: clip_(x.course, 160), text: clip_(x.text, 1200) }; })
      .filter(function (x) { return x.text; }).slice(0, 8);
    if (!list.length) throw new Error('missing');
    var d = data_(row); d.descriptions = list; d.descAt = new Date().toISOString();
    markDone_(row, 'desc', d, {
      'Course descriptions': list.map(function (x) { return (x.course ? x.course + ': ' : '') + x.text; }).join('\n\n')
    });
    log_('Professor', row.Name, 'Sent course description', list.map(function (x) { return x.course || '(untitled)'; }).join(', '));
    return { ok: true, me: meFor_(row) };
  });
}

function contractBlob_(row) {
  var id = fileId_(row['Contract file']);
  if (!id) throw new Error('no_contract');
  var file = DriveApp.getFileById(id);
  var mime = file.getMimeType();
  var blob = /google-apps/.test(mime) ? file.getAs('application/pdf') : file.getBlob();
  return { file: file, blob: blob };
}

function apiProfContract_(b) {
  var row = profFromToken_(b);
  verifyPin_(row, b.pin, 'contract');
  var c = contractBlob_(row);
  var bytes = c.blob.getBytes();
  var sha = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  var grant = token_();
  cache_().put('g:' + grant, JSON.stringify({ name: row.Name, fileId: c.file.getId(), sha: sha, updated: iso_(c.file.getLastUpdated()) }), PH.GRANT_SECONDS);
  log_('Professor', row.Name, 'Viewed contract', '');
  return {
    ok: true, grant: grant, mime: c.blob.getContentType() || 'application/pdf',
    filename: 'Praxis contract · ' + row.Name + '.pdf',
    data: Utilities.base64Encode(bytes), sha256: sha,
    signedAt: iso_(row['Contract signed']), signedAs: String(row['Signed as'] || ''),
    signingUrl: String(row['Signing link'] || '').trim()
  };
}

function grantFor_(row, grant) {
  var raw = grant && cache_().get('g:' + grant);
  if (!raw) throw new Error('bad_grant');
  var g = JSON.parse(raw);
  if (norm_(g.name) !== norm_(row.Name)) throw new Error('bad_grant');
  return g;
}

function apiProfSign_(b) {
  return withLock_(function () {
    var row = profFromToken_(b);
    var g = grantFor_(row, b.grant);
    var typed = clip_(b.typedName, 120);
    if (!typed || b.agree !== true) throw new Error('missing');
    var d = data_(row);
    var sig = { at: new Date().toISOString(), typedName: typed, fileId: g.fileId, fileUpdated: g.updated, sha256: g.sha, agent: clip_(b.agent, 200), method: 'typed' };
    d.signatures = (d.signatures || []).concat([sig]);
    markDone_(row, 'contract', d, { 'Signed as': typed });
    cache_().remove('g:' + b.grant);
    log_('Professor', row.Name, 'Signed contract', 'Typed “' + typed + '” · file ' + g.fileId + ' · sha256 ' + g.sha.slice(0, 16) + '…');
    return { ok: true, me: meFor_(row) };
  });
}

function apiProfSignedCopy_(b) {
  var row = profFromToken_(b);
  grantFor_(row, b.grant);
  var mime = String(b.mime || '').toLowerCase();
  if (!DOC_TYPES[mime]) throw new Error('bad_type');
  var bytes = payload_(b);
  var file = saveFile_(bytes, mime, row.Name + ' · signed contract · ' + stamp_() + '.' + DOC_TYPES[mime]);
  return withLock_(function () {
    row = findProf_(row.Name);
    var d = data_(row);
    d.signatures = (d.signatures || []).concat([{ at: new Date().toISOString(), method: 'upload', fileId: file.getId() }]);
    markDone_(row, 'contract', d, { 'Signed copy file': file.getUrl(), 'Signed as': 'Uploaded a signed copy' });
    log_('Professor', row.Name, 'Uploaded signed contract', Math.round(bytes.length / 1024) + ' KB');
    return { ok: true, me: meFor_(row) };
  });
}

/* ---------------------------------------------------------------- admin API */

function apiAdmLogin_(b) {
  var props = PropertiesService.getScriptProperties();
  var st = JSON.parse(props.getProperty('adm_fail') || '{"n":0,"until":0}');
  if (st.until && Date.now() < st.until) throw new Error('admin_locked');
  var want = setting_('Admin password');
  var got = String(b.password || '').trim();
  if (!want || got !== want) {
    st.n++;
    if (st.n >= PH.ADMIN_FAILS) { st.until = Date.now() + PH.ADMIN_LOCK_MIN * 60000; st.n = 0; }
    props.setProperty('adm_fail', JSON.stringify(st));
    log_('Admin', '', 'Wrong admin password', clip_(b.who, 60));
    throw new Error(st.until > Date.now() ? 'admin_locked' : 'wrong_password');
  }
  props.deleteProperty('adm_fail');
  var tok = token_();
  var who = clip_(b.who, 60) || 'Admin';
  cache_().put('t:' + tok, JSON.stringify({ kind: 'admin', who: who, at: Date.now() }), PH.TOKEN_SECONDS);
  log_('Admin', '', 'Admin signed in', who);
  return { ok: true, adm: tok, who: who };
}

function profSummary_(row) {
  var d = data_(row);
  var fs = failState_(row.Name);
  var phone = String(row['Phone on file'] || '');
  return {
    name: row.Name,
    phone: phone, phoneOk: !!last4_(phone),
    email: String(row['Email on file'] || ''),
    courses: String(row.Courses || ''),
    items: itemsFor_(row),
    contractFile: !!fileId_(row['Contract file']),
    contractName: fileId_(row['Contract file']) ? 'Contract on file' : '',
    signingUrl: String(row['Signing link'] || ''),
    signedAs: String(row['Signed as'] || ''),
    signedCopy: !!fileId_(row['Signed copy file']),
    signatures: (d.signatures || []).slice(-5),
    contact: d.contact || null,
    descriptions: d.descriptions || [],
    photo: !!fileId_(row['Photo file']),
    photoAt: iso_(row['Photo updated']),
    notes: String(row['Office notes'] || ''),
    last: iso_(row['Last activity']),
    lock: fs.hard ? 'hard' : (fs.until && Date.now() < fs.until ? 'soft' : ''),
    fails: fs.n || 0
  };
}

function apiAdmList_(b) {
  requireAdmin_(b);
  return {
    ok: true,
    profs: readProfs_().map(profSummary_),
    sheetUrl: privateSS_(false).getUrl(),
    notify: setting_('Notify emails')
  };
}

function apiAdmUpdate_(b) {
  var s = requireAdmin_(b);
  return withLock_(function () {
    var row = findProf_(b.name);
    if (!row) throw new Error('no_match');
    var p = b.patch || {}, f = {}, what = [];
    if ('phone' in p) { f['Phone on file'] = clip_(p.phone, 40); what.push('phone on file'); }
    if ('email' in p) { f['Email on file'] = clip_(p.email, 160); what.push('email on file'); }
    if ('courses' in p) { f.Courses = clip_(p.courses, 400); what.push('courses'); }
    if ('signingUrl' in p) {
      var u = clip_(p.signingUrl, 500);
      if (u && !/^https:\/\//i.test(u)) return { ok: false, error: 'missing', message: 'The signing link must start with https://' };
      f['Signing link'] = u; what.push('signing link');
    }
    if ('notes' in p) { f['Office notes'] = clip_(p.notes, 2000); what.push('office notes'); }
    if (p.needs) ITEMS.forEach(function (it) { if (it.key in p.needs) { f[it.need] = !!p.needs[it.key]; what.push((p.needs[it.key] ? 'needs ' : 'skip ') + it.key); } });
    if (p.done) ITEMS.forEach(function (it) {
      if (!(it.key in p.done)) return;
      f[it.done] = p.done[it.key] ? new Date() : '';
      if (it.key === 'contract' && !p.done[it.key]) f['Signed as'] = '';
      what.push((p.done[it.key] ? 'marked done: ' : 'reopened: ') + it.key);
    });
    if (!what.length) throw new Error('missing');
    writeProf_(row, f);
    log_('Admin', row.Name, 'Edited', s.who + ': ' + what.join(', '));
    return { ok: true, prof: profSummary_(row) };
  });
}

function apiAdmFile_(b) {
  var s = requireAdmin_(b);
  var row = findProf_(b.name);
  if (!row) throw new Error('no_match');
  var kind = String(b.kind || '');
  var col = { photo: 'Photo file', contract: 'Contract file', signed: 'Signed copy file' }[kind];
  if (!col) throw new Error('missing');
  var id = fileId_(row[col]);
  if (!id) throw new Error('bad_file');
  var file = DriveApp.getFileById(id);
  var blob = (kind === 'contract' && /google-apps/.test(file.getMimeType())) ? file.getAs('application/pdf') : file.getBlob();
  if (kind !== 'photo') log_('Admin', row.Name, 'Opened ' + (kind === 'signed' ? 'signed contract' : 'contract'), s.who);
  return { ok: true, mime: blob.getContentType(), filename: file.getName(), data: Utilities.base64Encode(blob.getBytes()) };
}

function apiAdmContract_(b) {
  var s = requireAdmin_(b);
  var row = findProf_(b.name);
  if (!row) throw new Error('no_match');
  var mime = String(b.mime || '').toLowerCase();
  if (!CONTRACT_TYPES[mime]) throw new Error('bad_type');
  var bytes = payload_(b);
  var file = saveFile_(bytes, mime, row.Name + ' · contract · ' + stamp_() + '.' + CONTRACT_TYPES[mime]);
  return withLock_(function () {
    row = findProf_(b.name);
    var d = data_(row);
    var f = { 'Contract file': file.getUrl(), 'Needs contract': true };
    if (String(row['Contract signed'] || '').trim()) {
      d.previousContracts = (d.previousContracts || []).concat([{ file: String(row['Contract file'] || ''), signedAt: iso_(row['Contract signed']), signedAs: String(row['Signed as'] || '') }]);
      f['Contract signed'] = ''; f['Signed as'] = '';
    }
    saveData_(row, d, f);
    log_('Admin', row.Name, 'Uploaded contract', s.who + ' · ' + Math.round(bytes.length / 1024) + ' KB');
    return { ok: true, prof: profSummary_(row) };
  });
}

function apiAdmUnlock_(b) {
  var s = requireAdmin_(b);
  var row = findProf_(b.name);
  if (!row) throw new Error('no_match');
  clearFails_(row.Name);
  log_('Admin', row.Name, 'Unlocked', s.who);
  return { ok: true, prof: profSummary_(row) };
}

function apiAdmLog_(b) {
  requireAdmin_(b);
  var sh = privateSS_(false).getSheetByName(LOG_TAB);
  var n = sh.getLastRow();
  if (n < 2) return { ok: true, rows: [] };
  var take = Math.min(n - 1, 400);
  var v = sh.getRange(n - take + 1, 1, take, 5).getValues();
  var k = b.name ? norm_(b.name) : '';
  var rows = v.filter(function (r) { return !k || norm_(r[2]) === k; }).reverse().slice(0, Number(b.limit) || 60)
    .map(function (r) { return { at: iso_(r[0]), who: String(r[1]), prof: String(r[2]), what: String(r[3]), detail: String(r[4]) }; });
  return { ok: true, rows: rows };
}

function apiAdmSync_(b) {
  var s = requireAdmin_(b);
  var added = withLock_(syncRoster_);
  if (added.length) log_('Admin', '', 'Added professors from the People tab', s.who + ': ' + added.join(', '));
  return { ok: true, added: added };
}
