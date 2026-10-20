// Builds the signed-in version of the hub:  node tools/build-secure.js "https://script.google.com/macros/s/XXXX/exec"
//   secure-build/index.html   the page with sign-in turned on and the Playbook text taken OUT (it is served only to board/admin)
//   secure-build/Playbook.html  the Playbook text, to paste into the Apps Script project as a file named Playbook
// Nothing here is pushed anywhere. See docs/PHONE-LOGIN.md for the ship steps.
const fs = require('fs'), path = require('path');
const url = process.argv[2];
if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url || '')) { console.error('Give the Apps Script web app address (ends in /exec).'); process.exit(1); }
const root = path.join(__dirname, '..'), out = path.join(root, 'secure-build');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!html.includes("AUTH_URL:''")) { console.error('index.html already has an AUTH_URL set.'); process.exit(1); }
html = html.replace("AUTH_URL:''", "AUTH_URL:'" + url + "'");
const open = '<section class="view" id="view-playbook" hidden>', a = html.indexOf(open), b = html.indexOf('</section>', a);
if (a < 0 || b < 0) { console.error('Could not find the Playbook section.'); process.exit(1); }
const inner = html.slice(a + open.length, b);
html = html.slice(0, a + open.length) + '\n      ' + html.slice(b);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'Playbook.html'), inner.trim() + '\n');
console.log('Wrote secure-build/index.html (' + html.length + ' bytes) and secure-build/Playbook.html (' + inner.length + ' bytes).');
