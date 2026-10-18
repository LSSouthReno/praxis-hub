/* Local preview with a working backend: node tools/dev-server.js [port]
   Serves index.html and runs backend/Code.gs in memory (tools/gas-mock.js),
   seeded with the professor names from the live People tab and made-up
   phone numbers (775-555-01NN, so sign in with 01NN). Nothing leaves this
   machine and nothing is written to Google.
   Open http://localhost:8787/?api=http://localhost:8787/exec */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), { URL } = require('url');
const { makeEnv } = require('./gas-mock');
const port = Number(process.argv[2]) || 8787;
const root = path.join(__dirname, '..');
const env = makeEnv({ quiet: true });

function samplePdf(title, lines) {
  const esc = s => s.replace(/[\\()]/g, m => '\\' + m);
  const body = ['BT /F1 20 Tf 72 720 Td (' + esc(title) + ') Tj ET']
    .concat(lines.map((l, i) => 'BT /F1 12 Tf 72 ' + (680 - i * 20) + ' Td (' + esc(l) + ') Tj ET')).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const x = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF';
  return Buffer.from(out, 'latin1');
}

async function seed() {
  let rows;
  try {
    const r = await fetch('https://docs.google.com/spreadsheets/d/1tkiJcJP1Eux57y4qkI2DUynBpc6teKtAWdNNY-M8MXE/gviz/tq?tqx=out:csv&sheet=People&headers=1');
    const csv = await r.text();
    rows = csv.trim().split(/\r?\n/).map(l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).slice(0, -1).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
  } catch (e) {
    rows = [['Name', 'Group', 'Title', 'Status'], ['Sample Professor A', 'Professor', 'Professor', 'Confirmed'], ['Sample Professor B', 'Professor', 'Professor', 'Confirmed']];
  }
  env.seedPublic(rows);
  env.ctx.setup();
  const pw = env.priv().getSheetByName('Settings').toObjects()[0].Value;
  const adm = env.call('adm_login', { password: pw, who: 'Dev' }).adm;
  const profs = env.call('adm_list', { adm }).profs;
  profs.forEach((p, i) => {
    if (i === profs.length - 1) return; // leave one without a phone, to see that state
    env.call('adm_update', { adm, name: p.name, patch: { phone: '775-555-' + String(100 + i).padStart(4, '0') } });
  });
  profs.slice(0, Math.ceil(profs.length / 2)).forEach(p => {
    const pdf = samplePdf('Praxis Theological Seminary · SAMPLE contract', ['Professor: ' + p.name, 'Compensation: $0,000 per course (sample)', 'This is test data from tools/dev-server.js.']);
    env.call('adm_contract', { adm, name: p.name, mime: 'application/pdf', data: pdf.toString('base64') }, 'POST');
  });
  if (profs[1]) env.call('adm_update', { adm, name: profs[1].name, patch: { needs: { photo: false, desc: false } } });
  console.log('Dev backend ready with ' + profs.length + ' professors.');
  console.log('  Admin password: ' + pw);
  profs.slice(0, 4).forEach((p, i) => console.log('  ' + p.name + ' signs in with ' + String(100 + i).padStart(4, '0')));
  console.log('  ' + (profs[profs.length - 1] || {}).name + ' has no phone on file.');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/exec') {
    const send = o => { const body = o.getContent(); res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(body); };
    if (req.method === 'POST') {
      let b = ''; req.on('data', c => b += c); req.on('end', () => send(env.ctx.doPost({ postData: { contents: b } })));
    } else send(env.ctx.doGet({ parameter: Object.fromEntries(u.searchParams) }));
    return;
  }
  const f = path.join(root, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(port, async () => {
  await seed();
  console.log('Open http://localhost:' + port + '/?api=http://localhost:' + port + '/exec');
});
