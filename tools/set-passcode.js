// Change the board passcode. Run: node tools/set-passcode.js "new-passcode"
// Stores only a hash in index.html. Remember: this is a tidy-up gate, not real security (see README).
const fs=require('fs'),crypto=require('crypto'),path=require('path');
const pass=(process.argv[2]||'').trim();
if(pass.length<8){console.error('Pick a passcode of at least 8 characters.');process.exit(1);}
const f=path.join(__dirname,'..','index.html');
const h=crypto.createHash('sha256').update('praxis-hub:'+pass).digest('hex');
const src=fs.readFileSync(f,'utf8');
if(!/BOARD_HASH:'[0-9a-f]{64}'/.test(src)){console.error('Could not find BOARD_HASH in index.html');process.exit(1);}
fs.writeFileSync(f,src.replace(/BOARD_HASH:'[0-9a-f]{64}'/,"BOARD_HASH:'"+h+"'"));
console.log('Board passcode updated. Commit index.html to publish it.');
