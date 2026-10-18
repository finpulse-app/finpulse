const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(process.argv[2]||'finpulse-v2-150.html','utf8');
function grab(name){const m=new RegExp('function '+name+'\\s*\\(').exec(source);if(!m)throw Error('Missing '+name);let start=source.indexOf('{',m.index),depth=0,end=start;for(;end<source.length;end++){if(source[end]==='{')depth++;else if(source[end]==='}'&&--depth===0)break;}return source.slice(m.index,end+1);}
const c=vm.createContext({Date,Math,Number,Set,Map,JSON});
for(const n of ['fpRound2','fpPad2','fpIso','fpParseIso','fpGoalDepositDate','fpGoalCapacity','fpLoanBalanceAmount','fpPaycheckMapPlan'])vm.runInContext(grab(n),c);
vm.runInContext('function fpGoalProgress(g){return {remaining:g.target_amount-g.saved_amount}}; function fpGoalSchedule(){return {needed:0}};',c);
const snap=()=>({nextPayday:{date:'2026-10-16'}}),loan=()=>({id:'focus',description:'Focus card',balance:600});
const model=()=>({asOf:'2026-10-08',start:2000,buffer:500,missing:[],risks:[],monthly:{income:3000,bills:500,debt:100,spending:600,other:0},rows:[{date:'2026-10-09',income:0,bills:100,debt:40,spending:10,other:0,net:-150},{date:'2026-10-16',income:3000,bills:0,debt:0,spending:10,other:0,net:2990},{date:'2026-11-01',income:0,bills:500,debt:100,spending:10,other:0,net:-610}],daily:10});
let pass=0,fail=0;function t(n,f){try{f();pass++;console.log('PASS '+n)}catch(e){fail++;console.log('FAIL '+n+' -> '+e.message)}}
const plan=(m=model(),s=snap(),g=[],l=loan())=>c.fpPaycheckMapPlan(m,s,g,l);
t('future paycheck is not available cash in this window',()=>{const p=plan();assert.equal(p.start,2000);assert.equal(p.income,0);assert.equal(p.spending,10);assert.equal(p.low,1850);});
t('an extra never exceeds the debt balance',()=>assert.equal(plan().extra,600));
t('cash cushion and 20 percent breathing room are protected',()=>{const m=model();m.start=1000;assert.equal(plan(m).extra,280);});
t('saved goal money stays protected',()=>{const p=plan(model(),snap(),[{id:'g',saved_amount:500,target_amount:500,archived:false}]);assert.equal(p.saved,500);assert.equal(p.extra,600);});
t('larger saved reserves reduce an extra dollar for dollar before margin',()=>assert.equal(plan(model(),snap(),[{id:'g',saved_amount:1100,target_amount:1100,archived:false}]).extra,200));
t('a later shortfall prevents spending money that only looks free before payday',()=>{const m=model();m.rows.push({date:'2027-01-01',net:-10000});assert.equal(plan(m).extra,0);});
t('unknown balance never produces a recommendation',()=>{const m=model();m.start=null;assert.equal(plan(m).extra,0);assert.equal(plan(m).ready,false);});
t('missing spending history blocks extra',()=>{const m=model();m.missing=['Import recent statements.'];assert.equal(plan(m).extra,0);});
t('unpaid or uncertain obligations block extra',()=>{const m=model();m.risks=['Resolve outstanding payments.'];assert.equal(plan(m).extra,0);});
t('missing payday asks for confirmation',()=>{const p=plan(model(),{});assert.equal(p.extra,0);assert(p.missing.includes('Confirm your next payday.'));});
t('no debt means no invented focus card',()=>{const p=plan(model(),snap(),[],null);assert.equal(p.loanId,null);assert.equal(p.extra,0);});
t('longer goal commitments are counted before a one-off extra',()=>{const p=plan(model(),snap(),[{id:'g',target_amount:10000,saved_amount:0,monthly_amount:5000,archived:false}]);assert.equal(p.extra,0);});
t('map calculations leave source records untouched',()=>{const m=model(),s=snap(),g=[],l=loan(),before=JSON.stringify([m,s,g,l]);plan(m,s,g,l);assert.equal(JSON.stringify([m,s,g,l]),before);});
console.log('MONEY MAP TOTAL pass='+pass+' fail='+fail);process.exitCode=fail?1:0;
