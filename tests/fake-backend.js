// A pretend Google (sheet, cache, mail) that runs apps-script/Code.gs for the tests; no network.
const vm = require('vm'), fs = require('fs'), crypto = require('crypto'), path = require('path');
const sheets = {
  People: [['Name','Group','Title','Status','Courses','Email','Phone','Notes','Contract','Sort order'],
    ['Kyle Bateson','Board','President','Confirmed','','k@x.org','(775) 555-0101','board note','yes','1'],
    ['Gregg Allison','Professor','Professor','Confirmed','Doctrine','','+1 775-555-0102','prof note','yes','11'],
    ['Tony Merida','Professor','Professor','Confirmed','Preaching','','775.555.0103 / 775-555-0113','tony note','no','12'],
    ['Deborah Rydman','Staff','Registrar','Confirmed','','','1-775-555-0104','staff note','','40'],
    ['Brad Borowski','Board','Board Member · Professor','Confirmed','','','7755550105','','','6'],
    ['Brad Borowski','Professor','Professor · Board Member','Confirmed','','','','','','21'],
    ['No Phone','Professor','Professor','Confirmed','','','','','','50']],
  Announcements: [['Date','Title','Message','Audience'],['2026-10-01','All','a','Everyone'],['2026-10-01','Fac','b','Faculty'],['2026-10-01','Brd','c','Board'],['2026-10-01','Stf','d','Staff']],
  'Action Items': [['Item','Status','Owner'],['Mine','Open','Tony Merida'],['Theirs','Open','Gregg Allison'],['Anyone','Open','']],
  Calendar: [['Title','Date','Type'],['Intensive','2026-11-01','Intensive'],['Board mtg','2026-11-02','Board meeting']],
  Links: [['Title','URL'],['a','https://a.org']], Metrics: [['Metric','Value'],['Students','12']],
  Access: [['Name','Phone','Role'],['Nicole','775-555-0199','admin']],
};
const props = { SESSION_SECRET: 'test-secret-xyz', SMS_MODE: 'test', TEST_EMAIL: 'brad@test' };
const mails = [], cacheMem = {};
const sb = {
  console, Date, JSON, Math, Number, String, parseInt, Array, Object,
  SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => sheets[n] ? { getDataRange: () => ({ getValues: () => sheets[n] }) } : null }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cacheMem[k] || null, put: (k, v) => { cacheMem[k] = v; }, remove: (k) => { delete cacheMem[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  MailApp: { sendEmail: (to, s, b) => mails.push({ to, s, b }) },
  UrlFetchApp: { fetch: () => ({}) }, Session: { getScriptTimeZone: () => 'UTC' },
  ContentService: { MimeType: { JSON: 1, TEXT: 2 }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) },
  HtmlService: { createHtmlOutputFromFile: () => ({ getContent: () => '<p>playbook</p>' }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (a, s) => [...crypto.createHash('sha256').update(s).digest()],
    computeHmacSha256Signature: (b, k) => [...crypto.createHmac('sha256', k).update(b).digest()],
    base64EncodeWebSafe: (x) => (typeof x === 'string' ? Buffer.from(x) : Buffer.from(x)).toString('base64url'),
    base64DecodeWebSafe: (s) => [...Buffer.from(s, 'base64url')], base64Encode: (s) => Buffer.from(s).toString('base64'),
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString() }),
    getUuid: () => crypto.randomUUID(), formatDate: (d) => d.toISOString().slice(0, 10).replace(/-/g, ''),
  },
};
vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), sb);
const post = (o) => JSON.parse(sb.doPost({ postData: { contents: JSON.stringify(o) } }).t);
module.exports = { sb, sheets, props, mails, cacheMem, post };
