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

  await page.evaluate(()=>showView('bills',null));await page.waitForSelector('#pm-slider');
  ok('M1 map replaces Bills landing and retains bill management',await page.textContent('#view-bills h2')==='Paycheck Map'&&await page.isVisible('#bill-list-view')&&/Rent/.test(await page.textContent('#bill-list-view')),'missing map or original checklist');
  ok('M2 focus is the same smallest debt as Loans',/Small student loan/.test(await page.textContent('#pm-focus')),'wrong focus debt');
  const choose=async v=>{await page.locator('#pm-slider').fill(String(v));await page.locator('#pm-slider').dispatchEvent('input');};
  await choose(55);
  ok('M3 ripple splits keep and extra without changing saved finances',await page.textContent('#pm-extra')==='$55'&&await page.textContent('#pm-keep')==='$3,407.50'&&JSON.stringify(db)===stageBefore&&reqlog.filter(r=>r.op!=='select').length===0,'split or write failure');
  await page.evaluate(()=>renderBillsView());
  ok('M4 status refresh preserves selected amount',await page.inputValue('#pm-slider')==='55','choice reset during refresh');
  await page.click('#pm-focus');
  ok('M5 one tap opens correct debt with selected extra and regular payment',await page.isVisible('#record-payment-overlay')&&/Small student loan/.test(await page.textContent('#rp-title'))&&await page.inputValue('#rp-extra')==='55'&&await page.textContent('#rp-confirm-btn')==='I paid $75'&&await page.evaluate(()=>_rpIncludeMonthly),'payment handoff lost amount');
  await page.evaluate(()=>{window.__realMapMutation=fpAtomicMutation;fpAtomicMutation=async function(kind,payload,key){window.__mapPayment={kind,payload,key};return null;};});
  await page.click('#rp-confirm-btn');
  ok('M5b confirmation passes the selected amount to the existing atomic payment path',await page.evaluate(()=>__mapPayment.kind==='record'&&__mapPayment.payload.extra===55&&__mapPayment.payload.include_monthly===true&&__mapPayment.payload.loan_id==='stage-student'),'confirmation changed the chosen payment');
  await page.evaluate(()=>{fpAtomicMutation=window.__realMapMutation;});
  ok('M6 reviewing a payment never writes it',JSON.stringify(db)===stageBefore&&reqlog.filter(r=>r.op!=='select').length===0,'map recorded without confirmation');
  await page.evaluate(()=>{closeRecordPayment();transactions.push({id:'map-paid',user_id:'user-A',type:'expense',category:'loan_payment',loan_id:'stage-student',description:'Small student loan payment',amount:20,date:'2026-10-08'});showView('bills',null);});
  await choose(55);await page.click('#pm-focus');
  ok('M7 previously recorded regular payment is not added twice',!await page.evaluate(()=>_rpIncludeMonthly)&&await page.textContent('#rp-confirm-btn')==='I paid $55 extra','already paid minimum added again');
  await page.evaluate(()=>{closeRecordPayment();transactions.find(t=>t.id==='map-paid').amount=5;showView('bills',null);});await choose(55);await page.click('#pm-focus');
  ok('M8 partial regular payment does not cause another full monthly charge',!await page.evaluate(()=>_rpIncludeMonthly)&&await page.textContent('#rp-confirm-btn')==='I paid $55 extra','partial payment duplicate');
  await page.evaluate(()=>{closeRecordPayment();transactions=transactions.filter(t=>t.id!=='map-paid');showView('bills',null);});await choose(55);
  await page.evaluate(()=>{monthBalances.__dated_balance.amount=500;monthBalances.__dated_balance.monthStart=fpMonthStartFromDated(500,monthBalances.__dated_balance.asOf,null);userSettings.startingBalance=monthBalances.__dated_balance.monthStart;});await page.click('#pm-focus');
  ok('M9 stale map rechecks cash before handing off extra',!await page.isVisible('#record-payment-overlay')&&await page.locator('#pm-slider').count()===0,'outdated recommendation accepted');
  await page.evaluate(()=>{monthBalances.__dated_balance.amount=4000;monthBalances.__dated_balance.monthStart=fpMonthStartFromDated(4000,monthBalances.__dated_balance.asOf,null);userSettings.startingBalance=monthBalances.__dated_balance.monthStart;showView('bills',null);});
  await choose(0);ok('M10 choosing to keep money disables extra payment',await page.isDisabled('#pm-focus')&&await page.textContent('#pm-extra')==='$0','zero paid action remains enabled');
  await page.evaluate(()=>{document.getElementById('paycheck-bill-list').open=false;fpMoneyMapBranch('bills');});
  ok('M11 Bills branch opens due dates and payment controls',await page.locator('#paycheck-bill-list').getAttribute('open')!==null&&await page.isVisible('#bill-list-view'),'bill route missing');
  await page.setViewportSize({width:320,height:900});
  ok('M12 map fits a narrow phone',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.getElementById('paycheck-map').getBoundingClientRect().right<=innerWidth),'map overflow');
  await page.setViewportSize({width:1280,height:1000});await page.evaluate(()=>{_fpRippleExtra=null;renderBillsView();});
  await page.evaluate(()=>document.querySelectorAll('.toast').forEach(e=>e.remove()));
  if(process.env.MAP_SCREENSHOT)await page.locator('#view-bills').screenshot({path:process.env.MAP_SCREENSHOT});
  await page.evaluate(()=>{transactions.find(t=>t.id==='stage-student').apr=null;renderBillsView();});
  ok('M13 missing details offer a clear correction rather than extra',await page.locator('#pm-slider').count()===0&&/One quick check first/.test(await page.textContent('#paycheck-map')),'missing APR ignored');
  await page.evaluate(()=>{transactions.find(t=>t.id==='stage-student').apr=5;userSettings.payday='2026-11-12';transactions.push({id:'next-month-bill',user_id:'user-A',type:'bill',description:'Next-month utility',amount:50,date:'2026-11-05',anchor_date:'2026-11-05',frequency:'monthly',recurring:true,category:'home'});showView('bills',null);});
  ok('M13b a pay window crossing month end includes the next-month bill',/Next-month utility/.test(await page.textContent('#bill-list-view'))&&/Nov 5/.test(await page.textContent('#bill-list-view')),'next-month obligation hidden');
  ok('M14 all map exploration left backend finances unchanged',JSON.stringify(db)===stageBefore&&reqlog.filter(r=>r.op!=='select').length===0,'read-only exploration wrote data');


ok('M15 no application errors',errors.length===0,JSON.stringify(errors));
console.log('MONEY MAP BROWSER TOTAL pass='+pass+' fail='+fail+' (timezone '+(process.env.TZ||'UTC')+')');
process.exitCode=fail?1:0;
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
