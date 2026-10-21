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

const pubSS = env.seedPublic([
  ['Name', 'Group', 'Title', 'Status', 'Courses', 'Email', 'Phone'],
  ['Ana Núñez', 'Professor', 'Professor', 'Confirmed', 'Hermeneutics, Greek I', 'ana@example.org', ''],
  ['Ben Ortiz', 'Professor', 'Professor', 'Tentative', '', '', ''],
  ['Cara Diaz', 'Board', 'Chair', 'Confirmed', '', '', ''],
  ['Dee Lane', 'School of Music', 'Director', 'Confirmed', '', '', '']
]);

eq(call('ping').ready, false, 'not ready before setup');
eq(call('prof_code', { name: 'Ana Núñez', phone: '7755550142' }).error, 'not_setup', 'professor calls refused before setup');
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
const np = call('prof_code', { name: 'Ana Nunez', phone: '7755550142' });
eq([np.error, np.email], ['no_phone', 'a•••@example.org'], 'no phone on file → explained, email offered');
eq(call('prof_code', { name: 'Dee Lane', via: 'email' }).error, 'no_email', 'no email on file → explained');

/* admin sets phones, needs and a contract */
eq(call('adm_update', { adm, name: 'Ana Núñez', patch: { phone: '(775) 555-0142' } }).prof.phoneOk, true, 'admin sets phone');
call('adm_update', { adm, name: 'Ben Ortiz', patch: { phone: '775.555.9876', needs: { photo: false, desc: false } } });
const pdf = Buffer.from('%PDF-1.4\n% fake contract for Ana\n%%EOF').toString('base64');
const up = call('adm_contract', { adm, name: 'Ana Núñez', mime: 'application/pdf', data: pdf }, 'POST');
eq(up.prof.contractFile, true, 'admin uploads a contract');
eq(call('adm_contract', { adm, name: 'Ana Núñez', mime: 'text/html', data: pdf }, 'POST').error, 'bad_type', 'contract type checked');

/* professor sign-in: mobile number → 6-digit code (emailed until Twilio is set up) and lockout */
const codeMails = () => env.mail.filter(m => /Praxis Hub code$/.test(m.subject));
const lastCode = () => { const c = codeMails(); return c[c.length - 1].subject.slice(0, 6); };
const wrong = c => c === '000000' ? '111111' : '000000';
const signIn = (name, phone) => { const c = call('prof_code', { name, phone }); return call('prof_verify', { cid: c.cid, code: lastCode() }); };
eq(call('prof_code', { name: 'Nobody', phone: '7755550142' }).error, 'no_match', 'unknown name');
eq(call('prof_code', { name: 'Ana Núñez', phone: '775-555-9999' }).error, 'wrong_phone', 'number must match the one on file');
eq(call('prof_code', { name: 'Ana Núñez', phone: '0142' }).error, 'wrong_phone', 'last 4 digits alone no longer work');
const c1 = call('prof_code', { name: 'Ana Núñez', phone: '+1 (775) 555-0142' });
eq([c1.ch, c1.to, c1.fallback], ['email', 'a•••@example.org', true], 'no Twilio yet → code emailed');
const code1 = lastCode();
ok(/^\d{6}$/.test(code1) && codeMails().slice(-1)[0].to === 'ana@example.org', 'code emailed to the address on file');
eq(call('prof_verify', { cid: c1.cid, code: wrong(code1) }).error, 'wrong_code', 'wrong code');
eq(call('prof_verify', { cid: c1.cid, code: wrong(code1) }).error, 'wrong_code', 'wrong code again');
eq(call('prof_verify', { cid: c1.cid, code: wrong(code1) }).error, 'locked', '5th wrong try (phone + codes) locks');
eq(call('prof_verify', { cid: c1.cid, code: code1 }).error, 'locked', 'even the right code waits while locked');
clock += 16 * 60000;
eq(call('prof_verify', { cid: c1.cid, code: code1 }).error, 'code_expired', 'codes expire after 10 minutes');
const c2 = call('prof_code', { name: 'ana nunez', phone: '775 555 0142' });
const V = call('prof_verify', { cid: c2.cid, code: lastCode() });
ok(V.ok && V.tok, 'right code after the lock, accent-insensitive name');
eq(call('prof_verify', { cid: c2.cid, code: lastCode() }).error, 'code_expired', 'a code works once');
const tok = V.tok;
eq(V.me.items.map(i => [i.key, i.needed, i.done]), [['contract', true, false], ['contact', true, false], ['photo', true, false], ['desc', true, false]], 'four items, all open');
eq(V.me.courses, ['Hermeneutics', 'Greek I'], 'courses parsed');
eq(V.me.contact.email, 'ana@example.org', 'contact prefilled from file');
eq(V.me.contract.ready, true, 'contract ready');

const B = signIn('Ben Ortiz', '(775) 555-9876');
eq(B.me.items.filter(i => i.needed).map(i => i.key), ['contract', 'contact'], 'custom checklist per professor');
eq(B.me.contract.ready, false, 'Ben has no contract yet');
eq(call('prof_contract', { tok: B.tok }).error, 'no_contract', 'no contract → clear message');
for (let i = 0; i < 4; i++) call('prof_code', { name: 'Ben Ortiz', phone: '7755559876' });
eq(call('prof_code', { name: 'Ben Ortiz', phone: '7755559876' }).error, 'too_many_codes', 'at most 5 codes per 15 minutes');

/* session isolation */
eq(call('prof_me', { tok: 'z'.repeat(64) }).error, 'bad_token', 'fake token refused');
eq(call('adm_list', { adm: tok }).error, 'bad_admin', 'professor token is not an admin token');

/* contact */
eq(call('prof_contact', { tok, contact: { email: 'bad' } }).error, 'missing', 'bad email refused');
const C = call('prof_contact', { tok, contact: { preferredName: 'Dr. Ana Núñez', email: 'ana@new.org', phone: '775-555-0000', address: '1 Main St\nReno NV' } });
eq(C.me.items.find(i => i.key === 'contact').done, true, 'contact done');
eq(env.mail.length, codeMails().length, 'no office email when Notify emails is blank');

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

/* contract: opens right after a code, asks for a fresh one later */
ok(call('prof_contract', { tok }).ok, 'contract opens within 10 minutes of the sign-in code');
clock += 11 * 60000;
eq(call('prof_contract', { tok }).error, 'need_code', 'later it asks for a new code');
eq(call('prof_contract', { tok, cid: 'q'.repeat(64), code: '123456' }).error, 'code_expired', 'made-up code id refused');
const kc = call('prof_code', { tok });
eq(kc.ch, 'email', 'contract code sent without retyping the number');
const kcode = lastCode();
eq(call('prof_verify', { cid: kc.cid, code: kcode }).error, 'code_expired', 'a contract code cannot start a new session');
const kc2 = call('prof_code', { tok });
const K = call('prof_contract', { tok, cid: kc2.cid, code: lastCode() });
ok(K.ok && K.grant && Buffer.from(K.data, 'base64').toString().startsWith('%PDF'), 'contract streamed after a fresh code');
ok(call('prof_contract', { tok }).ok, 'and stays open for 10 minutes after that');
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
ok(!codeMails().some(m => JSON.stringify(call('adm_log', { adm, limit: 400 }).rows).includes(m.subject.slice(0, 6))), 'codes never written to the log');

/* new contract version clears the old signature */
const up2 = call('adm_contract', { adm, name: 'Ana Núñez', mime: 'application/pdf', data: pdf }, 'POST');
eq(up2.prof.items.find(i => i.key === 'contract').done, false, 'new contract needs a new signature');

/* hard lock + unlock + notification */
priv.getSheetByName('Settings').getRange(3, 2).setValue('nicole@example.org');
for (let i = 0; i < 10; i++) call('prof_code', { name: 'Ben Ortiz', phone: '7755550000' }), clock += 16 * 60000;
eq(call('prof_code', { name: 'Ben Ortiz', phone: '7755559876' }).error, 'hard_locked', '10 wrong tries in a day lock until the office unlocks');
ok(env.mail.some(m => /locked out/.test(m.subject)), 'office emailed about the lockout');
eq(call('adm_list', { adm }).profs.find(p => p.name === 'Ben Ortiz').lock, 'hard', 'admin sees the lock');
call('adm_unlock', { adm, name: 'Ben Ortiz' });
ok(signIn('Ben Ortiz', '7755559876').ok, 'unlocked');

/* notification on completion */
const B2 = signIn('Ben Ortiz', '7755559876');
const before = env.mail.length;
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

/* admin edits the public directory; phones never go there */
const A3 = call('adm_login', { password: pw, who: 'Nicole' });
const pe = call('adm_people', { adm: A3.adm,
  edits: [{ name: 'ben ortiz', set: { Email: 'ben@example.org', Phone: '775-555-0000', Title: 'Professor of Greek' } },
          { name: 'Cara Diaz', group: 'Professor', set: { Email: 'cara@example.org' } },
          { name: 'Dee Lane', set: { Email: 'not-an-email' } }],
  add: [{ name: 'Eli Fox', set: { Group: 'Professor', Title: 'Professor', Status: 'Confirmed', Email: 'eli@example.org', Phone: '1' } },
        { name: 'Ana Núñez', set: { Group: 'Professor' } }] });
eq([pe.updated, pe.added, pe.missed], [['ben ortiz'], ['Eli Fox (Professor)'], ['Cara Diaz (Professor)']], 'directory edits: matched, added, group-filtered');
const pub = pubSS.getSheetByName('People').toObjects();
const ben = pub.find(r => r.Name === 'Ben Ortiz');
eq([ben.Email, ben.Title, ben.Phone], ['ben@example.org', 'Professor of Greek', ''], 'email and title set, phone refused');
eq(pub.find(r => r.Name === 'Dee Lane').Email, '', 'bad email ignored');
eq([pub.length, pub[pub.length - 1].Phone], [5, ''], 'new person appended without a phone, no duplicate');
eq(call('adm_people', { adm: 'x'.repeat(64), edits: [] }).error, 'bad_admin', 'directory edits need admin');
eq(call('adm_update', { adm: A3.adm, name: 'Ben Ortiz', patch: { address: '1 Main St, Reno, NV' } }).ok, true, 'admin sets mailing address');
eq(priv.getSheetByName('Professors').toObjects().find(r => r.Name === 'Ben Ortiz')['Mailing address'], '1 Main St, Reno, NV', 'address stored privately');

/* texting through Twilio Verify, once its keys are in Script Properties */
clock += 20 * 60000;
env.props.set('TWILIO_SID', 'AC1'); env.props.set('TWILIO_TOKEN', 'secret'); env.props.set('TWILIO_VERIFY_SID', 'VA1');
eq(call('ping').sms, true, 'ping reports texting is on');
env.twilio = (url, f) => /VerificationCheck$/.test(url) ? { code: 200, body: { status: f.Code === '424242' ? 'approved' : 'pending' } } : { code: 201, body: { status: 'pending' } };
const mailsBefore = env.mail.length;
const t1 = call('prof_code', { name: 'Ben Ortiz', phone: '775-555-9876' });
eq([t1.ch, t1.to, t1.fallback], ['sms', '(•••) •••-9876', false], 'code texted when Twilio is set up');
eq([env.fetches.slice(-1)[0].o.payload.To, env.mail.length], ['+17755559876', mailsBefore], 'texted to the number on file, no email');
eq(call('prof_verify', { cid: t1.cid, code: '111111' }).error, 'wrong_code', 'Twilio says no → wrong code');
ok(call('prof_verify', { cid: t1.cid, code: '424242' }).ok, 'Twilio approves → signed in');
env.twilio = () => ({ code: 400, body: { code: 21608, message: 'unverified number' } });
const t2 = call('prof_code', { name: 'Ana Núñez', phone: '7755550142' });
eq([t2.ch, t2.fallback], ['email', true], 'a refused text falls back to email');
ok(call('adm_log', { adm: A3.adm, limit: 5 }).rows.some(r => r.what === 'Text failed'), 'refused text logged for the office');
eq(call('prof_code', { name: 'Ana Núñez', phone: '7755550142', via: 'email' }).ch, 'email', 'professor can ask for email instead');

/* transport */
const g = JSON.parse(env.ctx.doGet({ parameter: {} }).getContent());
eq([g.service, g.for], ['praxis-hub', ''], 'bare GET answers');
eq(call('nope').error, 'unknown_action', 'unknown action');
eq(call('ping').for, 'ping', 'every reply echoes its action');

console.log('\n' + (fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' passed'));
process.exit(fails ? 1 : 0);
