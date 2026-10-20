// Builds the signed-in version of the hub:  node tools/build-secure.js "https://atlas.taila89b12.ts.net:8443/praxis"
//   secure-build/index.html   the page with sign-in turned on (pointing at Atlas's Praxis server) and the Playbook text taken OUT (Atlas serves it only to board/admin)
//   secure-build/Playbook.html  a copy of the Playbook text (Atlas already holds its own copy from the import)
// Nothing here is pushed anywhere. See docs/PHONE-LOGIN.md for the ship steps.
const fs = require('fs'), path = require('path');
const url = process.argv[2];
if (!/^https:\/\/[\w.-]+(:\d+)?\/praxis$/.test(url || '')) { console.error('Give the Atlas Praxis address (https://.../praxis).'); process.exit(1); }
const root = path.join(__dirname, '..'), out = path.join(root, 'secure-build');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/AUTH_URL:'[^']*'/, "AUTH_URL:'" + url + "'");
const open = '<section class="view" id="view-playbook" hidden>', a = html.indexOf(open), b = html.indexOf('</section>', a);
if (a < 0 || b < 0) { console.error('Could not find the Playbook section.'); process.exit(1); }
const inner = html.slice(a + open.length, b);
html = html.slice(0, a + open.length) + '\n      ' + html.slice(b);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'Playbook.html'), inner.trim() + '\n');
console.log('Wrote secure-build/index.html (' + html.length + ' bytes) and secure-build/Playbook.html (' + inner.length + ' bytes).');
