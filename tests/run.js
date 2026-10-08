// Parser and column-mapping checks for the Praxis Hub page. Run: node tests/run.js
const fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.match(/<script>([\s\S]*?)<\/script>/)[1];
// Lift the pure helpers out of the IIFE: everything from the helpers down to the fetch layer.
const start=src.indexOf('const $=');const end=src.indexOf('async function fetchTab');
let code=src.slice(start,end).replace(/^const /gm,'var ').replace(/^let /gm,'var ');
code=code.replace("var toast=(m)=>{","var toast=(m)=>{return;");
const sb={document:{querySelector:()=>({textContent:'',classList:{add(){},remove(){},toggle(){}}}),querySelectorAll:()=>[]},window:{},navigator:{},localStorage:{getItem:()=>null,setItem(){}},Date,console,setInterval:()=>0,setTimeout:()=>0,clearTimeout:()=>0,location:{hash:''}};
vm.createContext(sb);vm.runInContext(code+';this.parseCSV=parseCSV;this.rowsToObjects=rowsToObjects;this.MAP=MAP;this.toISO=toISO;this.groupKey=groupKey;this.statusKey=statusKey;this.courseMatch=typeof courseMatch==="function"?courseMatch:null;this.onboardOf=onboardOf;',sb);
let fails=0;const eq=(name,a,b)=>{const ok=JSON.stringify(a)===JSON.stringify(b);if(!ok){fails++;console.log('FAIL',name,'\n  got     ',JSON.stringify(a),'\n  expected',JSON.stringify(b));}else console.log('ok  ',name);};
// CSV
eq('csv quotes and newlines',sb.parseCSV('"a","b"\r\n"x, y","line1\nline2"\n"q ""quoted"""," "'),[['a','b'],['x, y','line1\nline2'],['q "quoted"',' ']]);
eq('csv skips blank rows',sb.parseCSV('a,b\n,\nc,d').length,2);
// dates
eq('iso date',sb.toISO('2027-03-01'),'2027-03-01');
eq('us date',sb.toISO('3/1/2027'),'2027-03-01');
eq('two-digit year',sb.toISO('9/14/27'),'2027-09-14');
eq('text date',sb.toISO('Sep 14, 2027'),'2027-09-14');
eq('blank date',sb.toISO(''),'');
// keys
eq('group aliases',[sb.groupKey('Board'),sb.groupKey('Prof'),sb.groupKey('Operational staff'),sb.groupKey('School of Music')],['board','faculty','staff','music']);
eq('status aliases',[sb.statusKey('Confirmed'),sb.statusKey('In conversation'),sb.statusKey('Open role'),sb.statusKey('maybe')],['confirmed','prospect','open','tentative']);
// people mapping, column order independent
const rows=sb.rowsToObjects(sb.parseCSV('Email,Name,Group,Courses,Contract\nk@x.org,Kyle B,Board,"Hermeneutics, Church History",2026-10-01'));
const p=sb.MAP.people(rows[0],0);
eq('people map',[p.name,p.group,p.email,p.courses,p.ob&&p.ob.contract,p.ob&&p.ob.handbook],['Kyle B','board','k@x.org','Hermeneutics, Church History',true,null]);
// announcements
const a=sb.MAP.ann(sb.rowsToObjects(sb.parseCSV('Date,Title,Message,Audience,Pinned,Posted by,Type,Respond by\n10/6/2026,Hello,Body,Board,TRUE,Kyle,Decision,10/20/2026'))[0],0);
eq('announcement map',[a.date,a.audience,a.pinned,a.type,a.respond,a.respondBy],['2026-10-06','board',true,'decision',true,'2026-10-20']);
// tasks
const t=sb.MAP.tasks(sb.rowsToObjects(sb.parseCSV('Item,Status,Due date,Priority\nDo it,Done,,High'))[0],0);
eq('task map',[t.status,t.priority,t.due],['done','high','']);
// events
const e=sb.MAP.events(sb.rowsToObjects(sb.parseCSV('Date,Title,Type,Agenda,Date TBD\n2027-09-14,Intensive,Intensive,"Open; Budget; Close",yes'))[0],0);
eq('event map',[e.type,e.agenda,e.tbd],['intensive',['Open','Budget','Close'],true]);
// course matching
if(sb.courseMatch){eq('course aliases',[sb.courseMatch('OT Survey','Old Testament Survey'),sb.courseMatch('Hermeneutics','hermeneutics'),sb.courseMatch('Law','Church Law')],[true,true,false]);}
console.log(fails?`\n${fails} failing`:'\nall passed');process.exit(fails?1:0);
