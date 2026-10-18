/* In-memory stand-ins for the Apps Script services backend/Code.gs uses, so the
   backend can run under node for tests and the local preview server.
   Only what Code.gs touches is modelled; formatting calls are no-ops. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

function noop() { return new Proxy(function () {}, { get: (t, k) => k === 'then' ? undefined : noop(), apply: () => noop() }); }

let idn = 0;
const newId = p => (p || 'id') + '_' + (++idn).toString(36) + crypto.randomBytes(12).toString('hex');

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = (this.sh.rows[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; }
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this; }
  setValue(x) { this.sh.set(this.r, this.c, x); return this; }
  getValue() { return this.getValues()[0][0]; }
}
['setNumberFormat', 'setDataValidation', 'setFontWeight', 'setBackground', 'setFontColor', 'setWrap', 'setFontSize'].forEach(m => { Range.prototype[m] = function () { return this; }; });

class Sheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; } setName(n) { this.name = n; return this; }
  set(r, c, x) { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = x; }
  getLastRow() { let n = this.rows.length; while (n > 0 && this.rows[n - 1].every(v => v === '' || v === undefined)) n--; return n; }
  getLastColumn() { return this.rows.reduce((m, r) => { let n = r.length; while (n > 0 && (r[n - 1] === '' || r[n - 1] === undefined)) n--; return Math.max(m, n); }, 0); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  deleteRows(r, n) { this.rows.splice(r - 1, n); return this; }
  appendRow(v) { const r = this.getLastRow() + 1; v.forEach((x, j) => this.set(r, j + 1, x)); return this; }
  toObjects() { const v = this.getDataRange().getValues(); return v.slice(1).map(r => Object.fromEntries(v[0].map((h, i) => [h, r[i]]))); }
}
['setFrozenRows', 'setFrozenColumns', 'setColumnWidth', 'hideColumns'].forEach(m => { Sheet.prototype[m] = function () { return this; }; });

class Spreadsheet {
  constructor(name, id) { this.name = name; this.id = id || newId('ss'); this.sheets = [new Sheet('Sheet1')]; }
  getId() { return this.id; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
}

class Blob {
  constructor(bytes, mime, name) { this.bytes = Buffer.from(bytes); this.mime = mime || 'application/octet-stream'; this.name = name || ''; }
  getBytes() { return [...this.bytes].map(b => b > 127 ? b - 256 : b); }
  getContentType() { return this.mime; } getName() { return this.name; }
}

function makeEnv(opts = {}) {
  const sheets = new Map(), files = new Map(), folders = new Map();
  const props = new Map(), cache = new Map(), mail = [];
  const now = opts.now || (() => Date.now());

  const SpreadsheetApp = {
    create(name) { const s = new Spreadsheet(name); sheets.set(s.id, s); files.set(s.id, { id: s.id, name, mime: 'application/vnd.google-apps.spreadsheet', bytes: Buffer.alloc(0), updated: new Date() }); return s; },
    openById(id) { const s = sheets.get(id); if (!s) throw new Error('No spreadsheet ' + id); return s; },
    newDataValidation: () => noop()
  };
  const fileObj = f => ({
    getId: () => f.id, getName: () => f.name, getMimeType: () => f.mime, getSize: () => f.bytes.length,
    getUrl: () => 'https://drive.google.com/file/d/' + f.id + '/view', getLastUpdated: () => f.updated,
    getBlob: () => new Blob(f.bytes, f.mime, f.name),
    getAs: m => new Blob(f.bytes, m, f.name), moveTo() { return this; }, setName(n) { f.name = n; return this; }
  });
  const folderObj = d => ({
    getId: () => d.id, getUrl: () => 'https://drive.google.com/drive/folders/' + d.id,
    createFile(blob) { const f = { id: newId('file'), name: blob.name, mime: blob.mime, bytes: blob.bytes, updated: new Date(), folder: d.id }; files.set(f.id, f); return fileObj(f); }
  });
  const DriveApp = {
    createFolder(name) { const d = { id: newId('fold'), name }; folders.set(d.id, d); return folderObj(d); },
    getFolderById(id) { const d = folders.get(id); if (!d) throw new Error('No folder'); return folderObj(d); },
    getFileById(id) { const f = files.get(id); if (!f) throw new Error('No file ' + id); return fileObj(f); }
  };
  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    base64Encode: b => Buffer.from(b.map ? b.map(x => x < 0 ? x + 256 : x) : b).toString('base64'),
    base64Decode: s => { if (/[^A-Za-z0-9+/=\s]/.test(s)) throw new Error('Could not decode string.'); return [...Buffer.from(s, 'base64')].map(b => b > 127 ? b - 256 : b); },
    newBlob: (bytes, mime, name) => new Blob(Buffer.from(bytes.map(x => x < 0 ? x + 256 : x)), mime, name),
    computeDigest: (alg, bytes) => [...crypto.createHash('sha256').update(Buffer.from(bytes.map(x => x < 0 ? x + 256 : x))).digest()].map(b => b > 127 ? b - 256 : b),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    formatDate: (d) => d.toISOString().slice(0, 16).replace('T', ' ').replace(':', '')
  };
  const ttl = new Map();
  const live = k => { if (ttl.has(k) && ttl.get(k) < now()) { cache.delete(k); ttl.delete(k); } return cache.has(k); };
  const scriptCache = {
    get: k => live(k) ? cache.get(k) : null,
    put: (k, v, s) => { if (String(v).length > 100000) throw new Error('Argument too large: value'); cache.set(k, String(v)); ttl.set(k, now() + (s || 600) * 1000); },
    remove: k => { cache.delete(k); ttl.delete(k); },
    removeAll: ks => ks.forEach(k => { cache.delete(k); ttl.delete(k); }),
    getAll: ks => Object.fromEntries(ks.filter(live).map(k => [k, cache.get(k)]))
  };
  const scriptProps = {
    getProperty: k => props.has(k) ? props.get(k) : null,
    setProperty: (k, v) => { props.set(k, String(v)); return scriptProps; },
    deleteProperty: k => { props.delete(k); return scriptProps; },
    getProperties: () => Object.fromEntries(props)
  };
  const ctx = {
    SpreadsheetApp, DriveApp, Utilities,
    CacheService: { getScriptCache: () => scriptCache },
    PropertiesService: { getScriptProperties: () => scriptProps },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: { sendEmail: m => mail.push(m) },
    ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }), MimeType: { JSON: 'json' } },
    Logger: { log: (...a) => opts.quiet ? 0 : console.log(...a) },
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(now()); } static now() { return now(); } },
    JSON, Math, Object, String, Number, Array, Error, RegExp, parseInt, isNaN, Buffer
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });

  /* The public "Praxis Hub Data" sheet, with a People tab. */
  function seedPublic(rows) {
    const pub = new Spreadsheet('Praxis Hub Data', ctx.PH.PUBLIC_SHEET_ID);
    pub.sheets = [new Sheet('People')];
    pub.sheets[0].rows = rows;
    sheets.set(pub.id, pub);
    return pub;
  }
  function call(action, body, method) {
    const out = method === 'POST'
      ? ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ action }, body || {})) } })
      : ctx.doGet({ parameter: { action, p: JSON.stringify(body || {}) } });
    return JSON.parse(out.getContent());
  }
  function priv() { return sheets.get(props.get('PRIVATE_SS_ID')); }
  return { ctx, call, seedPublic, priv, files, mail, props, cache };
}

module.exports = { makeEnv };
