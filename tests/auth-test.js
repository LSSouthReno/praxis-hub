// Runs apps-script/Code.gs against a pretend Google (no network): `node tests/auth-test.js`
const { sb, sheets, mails, cacheMem, post } = require('./fake-backend.js');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const csvRows = (t) => t.split('\n');
const login = (phone) => { mails.length = 0; Object.keys(cacheMem).forEach((k) => delete cacheMem[k]); const r = post({ action: 'requestCode', phone }); const code = mails[0] && /code is (\d{6})/.exec(mails[0].b)[1]; return { r, code, v: code ? post({ action: 'verifyCode', phone, code }) : null }; };

ok(sb.normPhone('(775) 555-0123') === '7755550123' && sb.normPhone('+1 775-555-0123') === '7755550123' && sb.normPhone('1.775.555.0123') === '7755550123', 'phone formats normalize');
ok(sb.normPhone('123') === '' && sb.normPhone('') === '', 'junk is not a phone');
let a = login('775 555 0102'); ok(a.v && a.v.ok && a.v.role === 'professor' && a.v.name === 'Gregg Allison', 'professor signs in');
const prof = post({ action: 'data', token: a.v.token });
ok(!/0101|0103|0104|0105|0113/.test(JSON.stringify(prof.tabs)), 'professor payload has no one else\'s phone number');
ok(!prof.tabs.People.includes('board note') && !prof.tabs.People.includes('tony note'), 'no one else\'s notes');
ok(prof.tabs.People.includes('prof note'), 'own notes kept');
ok(!prof.tabs.Announcements.includes('Brd') && !prof.tabs.Announcements.includes('Stf') && prof.tabs.Announcements.includes('Fac'), 'professor posts: everyone+faculty only');
ok(!prof.tabs.Calendar.includes('Board mtg') && prof.tabs.Calendar.includes('Intensive'), 'no board meetings');
ok(prof.tabs['Action Items'].includes('Theirs') && !prof.tabs['Action Items'].includes('Mine') && !prof.tabs['Action Items'].includes('Anyone'), 'only the action items assigned to that professor');
ok(csvRows(prof.tabs.Metrics).length === 1, 'no metrics');
ok(post({ action: 'playbook', token: a.v.token }).error === 'forbidden', 'professor cannot get playbook');
a = login('7755550103'); const tm = post({ action: 'data', token: a.v.token });
ok(tm.tabs['Action Items'].includes('Mine') && !tm.tabs['Action Items'].includes('Theirs'), 'professor sees only own tasks');
ok(login('775-555-0113').v.ok, 'second number in one cell also works');
a = login('(775) 555-0101'); const bd = post({ action: 'data', token: a.v.token });
ok(a.v.role === 'board' && bd.tabs.People.includes('775') && bd.tabs.Announcements.includes('Brd') && bd.tabs.Calendar.includes('Board mtg') && bd.tabs.Metrics.includes('Students'), 'board sees everything');
ok(post({ action: 'playbook', token: a.v.token }).ok, 'board gets playbook');
a = login('7755550105'); ok(a.v.role === 'board', 'two-group person gets higher role');
a = login('775-555-0104'); const st = post({ action: 'data', token: a.v.token });
ok(a.v.role === 'staff' && st.tabs.Announcements.includes('Stf') && !st.tabs.Announcements.includes('Fac') && !/0101|0102|0103|0105/.test(st.tabs.People), 'staff view');
a = login('775-555-0199'); ok(a.v.role === 'admin' && post({ action: 'playbook', token: a.v.token }).ok, 'admin via Access tab');
// unknown number
mails.length = 0; Object.keys(cacheMem).forEach((k) => delete cacheMem[k]);
const unk = post({ action: 'requestCode', phone: '775-555-9999' }), kn = post({ action: 'requestCode', phone: '775-555-0102' });
ok(JSON.stringify(unk) === JSON.stringify(kn) && mails.length === 1, 'unknown number: identical answer, no text sent');
ok(post({ action: 'verifyCode', phone: '775-555-9999', code: '123456' }).ok === false, 'unknown number cannot verify');
// wrong code lockout
a = login('775-555-0102'); const real = a.code; let bad = real === '000000' ? '111111' : '000000';
for (let i = 0; i < 5; i++) post({ action: 'verifyCode', phone: '775-555-0102', code: bad });
ok(post({ action: 'verifyCode', phone: '775-555-0102', code: real }).ok === false, 'five wrong tries kills the code');
// rate limit
Object.keys(cacheMem).forEach((k) => delete cacheMem[k]); let last; for (let i = 0; i < 4; i++) last = post({ action: 'requestCode', phone: '775-555-0102' });
ok(last.error === 'toomany', 'texts per number are limited');
// token tampering, expiry, revocation
a = login('775-555-0102'); const t = a.v.token, [body, sig] = t.split('.');
ok(post({ action: 'data', token: body + '.' + sig.slice(0, -2) + 'AA' }).error === 'session', 'forged signature refused');
const forged = Buffer.from(JSON.stringify({ p: '7755550101', e: Date.now() + 1e9 })).toString('base64url');
ok(post({ action: 'data', token: forged + '.' + sig }).error === 'session', 'swapped body refused');
ok(post({ action: 'data', token: '' }).error === 'session', 'no token refused');
sheets.People[2][6] = ''; ok(post({ action: 'data', token: t }).error === 'session', 'removing the number cuts access at once');
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
