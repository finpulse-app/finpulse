// Stage-only browser checks with fictional amounts and an entirely read-only fake backend.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),path=require('path');
const FILE=path.resolve(process.argv[2]||'finpulse-v2-150.html');
let db,reqlog=[],pass=0,fail=0;
function seed(){db={transactions:[],user_settings:[{id:'stage-settings',user_id:'user-A'}],financial_goals:[],bill_paid_marks:[]};reqlog=[];}
function ok(name,condition,detail){if(condition){pass++;console.log('PASS '+name);}else{fail++;console.log('FAIL '+name+' -> '+detail);}}
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROME||undefined,args:['--no-sandbox']});
try{
const ctx=await browser.newContext({viewport:{width:1280,height:900},timezoneId:process.env.TZ||'UTC'});
await ctx.route('**/cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'mock-client.js'),'utf8')}));
await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs|chart/,r=>r.fulfill({contentType:'text/css',body:''}));
const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.clock.setFixedTime(new Date(2026,9,8,12));
await page.exposeFunction('__dbop',spec=>{reqlog.push(spec);if(spec.op!=='select')return {data:null,error:{message:'Stage tests do not write finances'}};let rows=(db[spec.table]||[]).filter(r=>(spec.filters||[]).every(([k,v,op])=>op==='in'?v.includes(r[k]):r[k]===v));if(spec.range)rows=rows.slice(spec.range[0],spec.range[1]+1);return {data:spec.single?rows[0]||null:rows,error:null};});
await page.exposeFunction('__rpc',()=>({error:{message:'Stage tests do not write finances'}}));
const load=async()=>{await page.goto('file://'+FILE);await page.waitForFunction(()=>document.getElementById('app').style.display!=='none'&&document.getElementById('loading-screen').style.display==='none'&&_fpGoalsReady&&_fpBillMarksReady);};
const hideStage=()=>page.evaluate(()=>{document.getElementById('stage-overlay').style.display='none';showView('calendar',null);});
  // T61 Stage guidance shares the complete model used by goals and payments.
  seed();db.transactions=[];
  for(let i=0;i<24;i++){const d=new Date(2026,8,14+i,12),date=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');db.transactions.push({id:'stage-spend-'+i,user_id:'user-A',type:'expense',description:'Everyday purchase',amount:10,date,recurring:false,category:'food',lender:'import:bank:Example'});}
  db.transactions.push({id:'stage-rent',user_id:'user-A',type:'bill',description:'Rent',amount:800,date:'2026-10-20',anchor_date:'2026-10-20',frequency:'monthly',recurring:true,category:'home',created_at:'2026-09-01T00:00:00Z'},
    {id:'stage-student',user_id:'user-A',type:'loan',description:'Small student loan',amount:20,min_payment:20,original_min_payment:20,balance:100,apr:5,date:'2026-10-20',anchor_date:'2026-10-20',frequency:'monthly',recurring:true,category:'Student Loan',created_at:'2026-09-01T00:00:00Z'},
    {id:'stage-card',user_id:'user-A',type:'loan',description:'Everyday card',amount:35,min_payment:35,original_min_payment:35,balance:600,apr:25,date:'2026-10-20',anchor_date:'2026-10-20',frequency:'monthly',recurring:true,category:'Credit Card',created_at:'2026-09-01T00:00:00Z'});
  db.financial_goals=[];Object.assign(db.user_settings[0],{starting_balance:4000,pay_amount:1800,pay_frequency:'monthly',payday:'2026-10-12',month_balances_json:JSON.stringify({__dated_balance:{v:2,amount:4000,asOf:'2026-10-08',monthStart:4000,paycheck:null}})});await load();await hideStage();const stageBefore=JSON.stringify(db);
  ok('T61 a complete positive plan says Build and offers the focused-debt comparison',await page.textContent('#priority-stage-badge')==='Stage 3: Build'&&/Focus on your next debt/.test(await page.textContent('#today-focus'))&&await page.textContent('#today-focus-button')==='Review focused debt','stage and next action disagree');
  await page.click('#today-focus-button');
  ok('T61 the smallest student loan is the same focus in list and payment tool',await page.isVisible('#whatif-overlay')&&/Small student loan/.test(await page.textContent('.wi-card-summary'))&&/Focus here/.test(await page.locator('.loan-card').filter({has:page.locator('.loan-name').filter({hasText:'Small student loan'})}).textContent())&&await page.evaluate(()=>fpFocusedLoanId())==='stage-student','loan order and focus disagree');await page.evaluate(()=>{closeWhatIf();showView('calendar',null);});
  await page.evaluate(()=>{monthBalances.__dated_balance.amount=520;userSettings.startingBalance=520;updateStats();});
  ok('T61 reducing available cash changes Build to Stabilize without saving a payment',await page.textContent('#priority-stage-badge')==='Stage 2: Stabilize'&&/Build a little breathing room/.test(await page.textContent('#today-focus')),'stage did not update with the balance');
  await page.evaluate(()=>{monthBalances.__dated_balance.amount=4000;userSettings.startingBalance=4000;userSettings.payAmount=600;updateStats();});
  ok('T61 a longer cash shortage avoids a growth action',await page.textContent('#priority-stage-badge')==='Stage 1: Stop the Bleed'&&!/Give your next goal a plan|Focus on your next debt/.test(await page.textContent('#today-focus')),'longer cash-flow shortage was ignored');
  await page.evaluate(()=>{userSettings.payAmount=1800;_fpGoals=[{id:'stage-goal',user_id:'user-A',name:'Big plan',target_amount:100000,saved_amount:0,monthly_amount:5000,archived:false}];updateStats();});
  ok('T61 goal deposits are included in stage selection',await page.textContent('#priority-stage-badge')==='Stage 1: Stop the Bleed','saved goal commitments were ignored');
  await page.evaluate(()=>{_fpGoals[0].archived=true;updateStats();});
  ok('T61 removing a goal commitment refreshes stage guidance immediately',await page.textContent('#priority-stage-badge')==='Stage 3: Build','stage cache ignored changed goal plans');
  await page.evaluate(()=>{transactions.find(t=>t.id==='stage-student').apr=null;updateStats();});
  ok('T61 missing loan information asks for its editor instead of declaring Build',await page.textContent('#priority-stage-badge')==='Check your details'&&await page.textContent('#today-focus-button')==='Check loan details','missing loan information produced a confident stage');await page.click('#today-focus-button');
  ok('T61 missing-detail action opens Loans and preserves saved finances',await page.isVisible('#view-loans')&&JSON.stringify(db)===stageBefore&&reqlog.filter(r=>r.op!=='select').length===0,'stage review wrote finances or routed to the wrong page');
  await page.evaluate(()=>{transactions.find(t=>t.id==='stage-student').apr=5;showView('calendar',null);showStageModal();});
  ok('T61 stage explanation uses the same three names',/Stop the Bleed/.test(await page.textContent('#stage-cards'))&&/Stabilize/.test(await page.textContent('#stage-cards'))&&/Build/.test(await page.textContent('#stage-cards'))&&!/Build your floor|Stop the bleeding/.test(await page.textContent('#stage-cards')),'stage names differ across screens');
  await page.setViewportSize({width:312,height:900});
  ok('T61 stage explanations fit a narrow phone',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#stage-cards').getBoundingClientRect().right<=innerWidth),'stage dialog overflow');await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>closeStageModal());


ok('T61 no application errors',errors.length===0,JSON.stringify(errors));
console.log('STAGE BROWSER TOTAL pass='+pass+' fail='+fail+' (timezone '+(process.env.TZ||'UTC')+')');
process.exitCode=fail?1:0;
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
