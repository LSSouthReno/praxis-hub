/* Runs backend/Code.gs against in-memory Apps Script stand-ins.
   node tests/backend.js */
'use strict';
const { makeEnv } = require('../tools/gas-mock');
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log('ok   ' + m); else { fails++; console.log('FAIL ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? '' : '  (got ' + JSON.stringify(a) + ')'));

let clock = Date.parse('2026-10-17T16:00:00Z');
const env = makeEnv({ quiet: true, now: () => clock });
const { call } = env;

env.seedPublic([
  ['Name', 'Group', 'Title', 'Status', 'Courses', 'Email', 'Phone'],
  ['Ana Núñez', 'Professor', 'Professor', 'Confirmed', 'Hermeneutics, Greek I', 'ana@example.org', ''],
  ['Ben Ortiz', 'Professor', 'Professor', 'Tentative', '', '', ''],
  ['Cara Diaz', 'Board', 'Chair', 'Confirmed', '', '', ''],
  ['Dee Lane', 'School of Music', 'Director', 'Confirmed', '', '', '']
]);

eq(call('ping').ready, false, 'not ready before setup');
eq(call('prof_verify', { name: 'Ana Núñez', pin: '1234' }).error, 'not_setup', 'professor calls refused before setup');
const msg = env.ctx.setup();
ok(/Admin password/.test(msg), 'setup reports the admin password');
eq(call('ping').ready, true, 'ready after setup');
const priv = env.priv();
eq(priv.getSheets().map(s => s.getName()), ['Professors', 'Activity', 'Settings', 'Read me'], 'private tabs created');
const profs = priv.getSheetByName('Professors').toObjects();
eq(profs.map(p => p.Name), ['Ana Núñez', 'Ben Ortiz', 'Dee Lane'], 'roster: professors and music, not board');
eq(profs[0]['Email on file'], 'ana@example.org', 'email copied');
eq(env.ctx.setup().includes('added from the public People tab: 0'), true, 'setup is re-runnable without duplicating');

/* admin sign-in */
const pw = priv.getSheetByName('Settings').toObjects()[0].Value;
eq(call('adm_login', { password: 'nope' }).error, 'wrong_password', 'wrong admin password refused');
const A = call('adm_login', { password: pw, who: 'Nicole' });
ok(A.ok && A.adm.length >= 40, 'admin signs in');
const adm = A.adm;
eq(call('adm_list', { adm: 'x'.repeat(64) }).error, 'bad_admin', 'admin list needs a session');
let L = call('adm_list', { adm });
eq(L.profs.length, 3, 'admin sees 3 professors');
eq(L.profs[0].phoneOk, false, 'no phone on file yet');

/* professor without a phone */
const np = call('prof_verify', { name: 'Ana Nunez', pin: '1234' });
eq(np.error, 'no_phone', 'no phone on file → explained, not a wrong-pin');

/* admin sets phones, needs and a contract */
eq(call('adm_update', { adm, name: 'Ana Núñez', patch: { phone: '(775) 555-0142' } }).prof.phoneOk, true, 'admin sets phone');
call('adm_update', { adm, name: 'Ben Ortiz', patch: { phone: '775.555.9876', needs: { photo: false, desc: false } } });
const pdf = Buffer.from('%PDF-1.4\n% fake contract for Ana\n%%EOF').toString('base64');
const up = call('adm_contract', { adm, name: 'Ana Núñez', mime: 'application/pdf', data: pdf }, 'POST');
eq(up.prof.contractFile, true, 'admin uploads a contract');
eq(call('adm_contract', { adm, name: 'Ana Núñez', mime: 'text/html', data: pdf }, 'POST').error, 'bad_type', 'contract type checked');

/* professor sign-in and lockout */
eq(call('prof_verify', { name: 'Nobody', pin: '0142' }).error, 'no_match', 'unknown name');
eq(call('prof_verify', { name: 'Ana Núñez', pin: '9999' }).error, 'wrong_pin', 'wrong digits');
for (let i = 0; i < 3; i++) call('prof_verify', { name: 'Ana Núñez', pin: '9999' });
eq(call('prof_verify', { name: 'Ana Núñez', pin: '9999' }).error, 'locked', '5th wrong try locks');
eq(call('prof_verify', { name: 'Ana Núñez', pin: '0142' }).error, 'locked', 'even the right digits wait while locked');
clock += 16 * 60000;
const V = call('prof_verify', { name: 'ana nunez', pin: '0142' });
ok(V.ok && V.tok, 'right digits after the lock, accent-insensitive name');
const tok = V.tok;
eq(V.me.items.map(i => [i.key, i.needed, i.done]), [['contract', true, false], ['contact', true, false], ['photo', true, false], ['desc', true, false]], 'four items, all open');
eq(V.me.courses, ['Hermeneutics', 'Greek I'], 'courses parsed');
eq(V.me.contact.email, 'ana@example.org', 'contact prefilled from file');
eq(V.me.contract.ready, true, 'contract ready');

const B = call('prof_verify', { name: 'Ben Ortiz', pin: '9876' });
eq(B.me.items.filter(i => i.needed).map(i => i.key), ['contract', 'contact'], 'custom checklist per professor');
eq(B.me.contract.ready, false, 'Ben has no contract yet');
eq(call('prof_contract', { tok: B.tok, pin: '9876' }).error, 'no_contract', 'no contract → clear message');

/* session isolation */
eq(call('prof_me', { tok: 'z'.repeat(64) }).error, 'bad_token', 'fake token refused');
eq(call('adm_list', { adm: tok }).error, 'bad_admin', 'professor token is not an admin token');

/* contact */
eq(call('prof_contact', { tok, contact: { email: 'bad' } }).error, 'missing', 'bad email refused');
const C = call('prof_contact', { tok, contact: { preferredName: 'Dr. Ana Núñez', email: 'ana@new.org', phone: '775-555-0000', address: '1 Main St\nReno NV' } });
eq(C.me.items.find(i => i.key === 'contact').done, true, 'contact done');
eq(env.mail.length, 0, 'no email when Notify emails is blank');

/* photo */
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 200, 201]).toString('base64');
eq(call('prof_photo', { tok, mime: 'image/gif', data: png }, 'POST').error, 'bad_type', 'photo type checked');
const P = call('prof_photo', { tok, mime: 'image/png', data: png, w: 1200, h: 1500 }, 'POST');
eq(P.me.items.find(i => i.key === 'photo').done, true, 'photo done');

/* chunked photo upload (fallback when a POST body is dropped) */
const big = Buffer.alloc(20000, 7).toString('base64');
const uid = 'abc123def456ghi7';
const parts = big.match(/.{1,6000}/g);
parts.forEach((d, i) => eq(call('chunk', { tok, uid, i, d }).ok, true, 'chunk ' + i));
const P2 = call('prof_photo', { tok, mime: 'image/jpeg', uid, n: parts.length });
ok(P2.ok, 'chunked upload assembles');
eq(call('prof_photo', { tok, mime: 'image/jpeg', uid, n: parts.length }).error, 'chunks_missing', 'chunks are single-use');
eq(call('chunk', { uid, i: 0, d: 'AAAA' }).error, 'bad_token', 'chunks need a session');

/* descriptions */
eq(call('prof_desc', { tok, items: [{ course: 'Hermeneutics', text: '' }] }).error, 'missing', 'empty description refused');
const D = call('prof_desc', { tok, items: [{ course: 'Hermeneutics', text: 'How to read the Bible well. Practised on real texts.' }, { course: 'Greek I', text: 'Koine basics. Reading John.' }] });
eq(D.me.descriptions.length, 2, 'two descriptions saved');

/* contract: needs digits again */
eq(call('prof_contract', { tok, pin: '' }).error, 'wrong_pin', 'contract asks for the digits again');
const K = call('prof_contract', { tok, pin: '0142' });
ok(K.ok && K.grant && Buffer.from(K.data, 'base64').toString().startsWith('%PDF'), 'contract streamed after digits');
eq(K.sha256.length, 64, 'contract fingerprint');
eq(call('prof_sign', { tok, grant: 'y'.repeat(64), typedName: 'Ana', agree: true }).error, 'bad_grant', 'signing needs a fresh contract view');
eq(call('prof_sign', { tok: B.tok, grant: K.grant, typedName: 'Ben', agree: true }).error, 'bad_grant', 'grant belongs to one professor');
eq(call('prof_sign', { tok, grant: K.grant, typedName: 'Ana Núñez', agree: false }).error, 'missing', 'must tick agree');
const SG = call('prof_sign', { tok, grant: K.grant, typedName: 'Ana Núñez', agree: true });
eq(SG.me.items.every(i => !i.needed || i.done), true, 'Ana fully done');
eq(SG.me.contract.signedAs, 'Ana Núñez', 'signature recorded');
eq(call('prof_sign', { tok, grant: K.grant, typedName: 'Ana', agree: true }).error, 'bad_grant', 'grant is single-use');

/* admin sees it all */
L = call('adm_list', { adm });
const ana = L.profs.find(p => p.name === 'Ana Núñez');
eq([ana.contact.email, ana.descriptions.length, ana.photo, ana.signatures.length], ['ana@new.org', 2, true, 1], 'admin sees submissions');
const F = call('adm_file', { adm, name: 'Ana Núñez', kind: 'photo' });
eq(F.mime, 'image/jpeg', 'admin downloads latest photo');
eq(call('adm_file', { adm, name: 'Ana Núñez', kind: '../etc' }).error, 'missing', 'file kind whitelisted');
const LG = call('adm_log', { adm, name: 'Ana Núñez' });
ok(LG.rows.some(r => r.what === 'Signed contract') && LG.rows.some(r => r.what === 'Viewed contract'), 'activity log records contract view + signature');
ok(!JSON.stringify(LG.rows).includes('0142'), 'digits never written to the log');

/* new contract version clears the old signature */
const up2 = call('adm_contract', { adm, name: 'Ana Núñez', mime: 'application/pdf', data: pdf }, 'POST');
eq(up2.prof.items.find(i => i.key === 'contract').done, false, 'new contract needs a new signature');

/* hard lock + unlock + notification */
priv.getSheetByName('Settings').getRange(3, 2).setValue('nicole@example.org');
for (let i = 0; i < 10; i++) call('prof_verify', { name: 'Ben Ortiz', pin: '0000' }), clock += 16 * 60000;
eq(call('prof_verify', { name: 'Ben Ortiz', pin: '9876' }).error, 'hard_locked', '10 wrong tries in a day lock until the office unlocks');
ok(env.mail.some(m => /locked out/.test(m.subject)), 'office emailed about the lockout');
eq(call('adm_list', { adm }).profs.find(p => p.name === 'Ben Ortiz').lock, 'hard', 'admin sees the lock');
call('adm_unlock', { adm, name: 'Ben Ortiz' });
ok(call('prof_verify', { name: 'Ben Ortiz', pin: '9876' }).ok, 'unlocked');

/* notification on completion */
const before = env.mail.length;
const B2 = call('prof_verify', { name: 'Ben Ortiz', pin: '9876' });
call('prof_contact', { tok: B2.tok, contact: { email: 'ben@example.org' } });
ok(env.mail.length === before + 1 && /Ben Ortiz updated their contact information/.test(env.mail[env.mail.length - 1].subject), 'office emailed on completion');

/* admin marks done / reopens */
const m1 = call('adm_update', { adm, name: 'Ben Ortiz', patch: { done: { contract: true } } });
eq(m1.prof.items.find(i => i.key === 'contract').done, true, 'admin can mark done');
eq(call('adm_update', { adm, name: 'Ben Ortiz', patch: { signingUrl: 'javascript:alert(1)' } }).error, 'missing', 'signing link must be https');

/* sessions expire */
clock += 7 * 3600 * 1000;
eq(call('prof_me', { tok }).error, 'bad_token', 'professor session expires');
eq(call('adm_list', { adm }).error, 'bad_admin', 'admin session expires');

/* rows with no name (old checkbox pre-fill) are cleaned up on sync */
const ps = priv.getSheetByName('Professors');
const cnt = ps.getLastRow();
ps.rows.splice(1, 0, ['', '', '', '', false, false, false, false], ['', '', '', '', false, false, false, false]);
eq(ps.getLastRow(), cnt + 2, 'blank checkbox rows count as data');
const A2 = call('adm_login', { password: pw, who: 'Nicole' });
call('adm_sync', { adm: A2.adm });
eq([ps.getLastRow(), ps.toObjects()[0].Name], [cnt, 'Ana Núñez'], 'sync removes blank rows so names start at row 2');

/* transport */
const g = JSON.parse(env.ctx.doGet({ parameter: {} }).getContent());
eq([g.service, g.for], ['praxis-hub', ''], 'bare GET answers');
eq(call('nope').error, 'unknown_action', 'unknown action');
eq(call('ping').for, 'ping', 'every reply echoes its action');

console.log('\n' + (fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' passed'));
process.exit(fails ? 1 : 0);
