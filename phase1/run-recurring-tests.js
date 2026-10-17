const fs=require('fs'),vm=require('vm'),assert=require('assert');const html=fs.readFileSync(process.argv[2]||'finpulse-v2-150.html','utf8');function grab(n){let i=html.indexOf('function '+n+'(');if(i<0)throw Error(n);let a=html.indexOf('{',i),d=0,j=a;for(;j<html.length;j++){if(html[j]==='{')d++;else if(html[j]==='}'&&!--d)break;}return html.slice(i,j+1);}
const c=vm.createContext({Date,Map,Set,Math,Number,String,fpParseIso:s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const [y,m,d]=s.split('-').map(Number),x=new Date(y,m-1,d,12);return x.getDate()===d?x:null;},fpIso:d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),fpDaysBetween:(a,b)=>(Date.UTC(b.getFullYear(),b.getMonth(),b.getDate())-Date.UTC(a.getFullYear(),a.getMonth(),a.getDate()))/86400000,fpAddDays:(d,n)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n,12)});vm.runInContext(grab('fpRecurringMerchant')+'\n'+grab('fpSuggestRecurringBills'),c);
let passed=0;function check(name,rows,expected,today='2026-10-11'){const r=c.fpSuggestRecurringBills(rows,today);assert.equal(r.length,expected,name);passed++;return r;}
const rows=(name,dates,amounts,category='home')=>dates.map((date,i)=>({description:name,date,amount:amounts[i],type:'expense',recurring:false,category}));
let r=check('monthly rent',rows('Rent',['2026-08-20','2026-09-20'],[900,900]),1);assert.equal(r[0].date,'2026-10-20');
check('variable utility',rows('Electric',['2026-08-20','2026-09-20'],[70,103]),1);
r=check('single recognizable subscription is a possibility',rows('Netflix',['2026-09-20'],[20]),1);assert.equal(r[0].possible,true);
check('single ordinary purchase is not a subscription',rows('Coffee',['2026-09-20'],[20],'food'),0);
check('shopping not a bill',rows('Amazon',['2026-07-20','2026-08-20','2026-09-20'],[20,20,20],'shopping'),0);
check('duplicate dates not repetition',rows('Rent',['2026-09-20','2026-09-20'],[900,900]),0);
check('already scheduled',rows('Rent',['2026-08-20','2026-09-20'],[900,900]).concat({description:'Rent',recurring:true,type:'bill'}),0);
check('old bill',rows('Rent',['2025-08-20','2025-09-20'],[900,900]),0);
r=check('month end clamp',rows('Rent',['2026-01-31','2026-02-28'],[900,900]),1,'2026-03-01');assert.equal(r[0].date,'2026-03-28');
r=check('weekly requires three',rows('Gym',['2026-09-30','2026-10-07'],[20,20]),0);r=check('weekly',rows('Gym',['2026-09-23','2026-09-30','2026-10-07'],[20,20,20]),1);assert.equal(r[0].frequency,'weekly');
check('card payment excluded',rows('Card payment',['2026-08-20','2026-09-20'],[100,100]),0);
for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
check('old single subscription not active',rows('Netflix',['2025-09-20'],[20]),0);
console.log(passed+' recurring detection checks passed; application scripts compile');
