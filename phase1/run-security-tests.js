const fs = require('fs'), vm = require('vm'), assert = require('assert');
const file = process.argv[2] || 'finpulse-v2-150.html';
const html = fs.readFileSync(file, 'utf8');
function grab(name) {
  const match = new RegExp('(?:async )?function ' + name + '\\s*\\(').exec(html);
  if (!match) throw new Error('Missing function '+name);
  let i = html.indexOf('{', match.index), depth = 0, j = i;
  for (; j < html.length; j++) { if(html[j]==='{') depth++; else if(html[j]==='}' && --depth===0) break; }
  return html.slice(match.index,j+1);
}
function make(names, extra={}) {
  const els = {}, cache = {}, messages=[];
  const element = id => els[id] || (els[id]={value:'',style:{},textContent:'',innerHTML:'',classList:{remove(){},toggle(){}}});
  const c = vm.createContext(Object.assign({console,Date,Math,JSON,parseFloat,isNaN,setTimeout(){},
    currentUser:{id:'A'},userSettings:{startingBalance:100,payAmount:0},monthBalances:{},transactions:[],
    _dataLoadVersion:0,_activeUserId:'A', savedPurchases:[],
    window:{},document:{getElementById:element,querySelector(){return element('modal')},querySelectorAll(){return []}},
    localStorage:{getItem:k=>cache[k]||null,setItem:(k,v)=>{cache[k]=v},removeItem:k=>{delete cache[k]}},
    crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
    _fpMutationBusy:false,_fpMutationVersion:0,_lastDeletedOperation:null,_rpPendingDate:null,_rpDialogVersion:0,_rpHasPending:false,
    fpPendingOperation:()=>null,fpRenderTransactionState(){},fpUpdatePendingNotice(){},panelOpen:false,
    showToast:(...m)=>messages.push(m),renderCalendar(){},renderLoans(){},renderBillsView(){},updateStats(){},dUpdate(){},updateTopbarButtons(){},openSetup(){},loadSavedPurchases(){},shouldShowStageModal(){return false},checkMonthRollover:async()=>{},
    _els:els,_cache:cache,_messages:messages},extra));
  names.forEach(n=>vm.runInContext(grab(n),c)); return c;
}
function backend({writeError=null,readError=null,rows=true,throwWrite=false}={}) {
  let written=null;
  return {get written(){return written}, from(){
    let op='read',payload;
    const q={eq(){return q},select(){return q},update(v){op='write';payload=v;return q},insert(v){op='write';payload=v[0];return q},
      async single(){if(op==='read')return{data:{id:'s'},error:readError}; if(throwWrite)throw Error('offline'); if(!writeError&&rows)written=payload; return {data:rows&&!writeError?{id:'s'}:null,error:writeError};}};
    return q;
  }};
}
let pass=0,fail=0;
async function test(name,fn){try{await fn();pass++;console.log('PASS '+name)}catch(e){fail++;console.log('FAIL '+name+' -> '+e.message)}}
(async()=>{
  for(const [name,options] of [['returned error',{writeError:{message:'failed'}}],['thrown network error',{throwWrite:true}],['no returned row',{rows:false}],['read failure',{readError:{message:'failed',code:'503'}}]]) {
    await test('settings '+name+' preserves settings and cache',async()=>{
      const c=make(['saveUserSettings'],{sb:backend(options)});
      const result=await c.saveUserSettings({startingBalance:999,payAmount:0}, {'2026-10':999});
      assert.equal(result,false);assert.equal(c.userSettings.startingBalance,100);assert.equal(Object.keys(c._cache).length,0);assert.equal(Object.keys(c.monthBalances).length,0);assert.equal(c._messages.length,1);
    });
  }
  await test('successful settings write advances settings and cache together',async()=>{
    const sb=backend(),c=make(['saveUserSettings'],{sb});
    assert.equal(await c.saveUserSettings({startingBalance:999,payAmount:0},{'2026-10':999}),true);
    assert.equal(c.userSettings.startingBalance,999);assert.equal(c.monthBalances['2026-10'],999);assert.equal(JSON.parse(c._cache.fp_month_balances_A)['2026-10'],999);assert.equal(sb.written.starting_balance,999);
  });
  for(const authenticated of [false,true]) await test('signup session '+authenticated+' chooses correct screen',async()=>{
    let shown=false;const c=make(['signUp'],{showApp(){shown=true},sb:{auth:{signUp:async()=>({data:{user:{id:'A'},session:authenticated?{user:{id:'A'}}:null},error:null})}}});
    ['signup-name','signup-email','signup-password'].forEach(id=>{c.document.getElementById(id).value='valid-password'});
    await c.signUp();assert.equal(shown,authenticated);if(!authenticated)assert.equal(c._els['signup-success'].style.display,'block');
  });
  for (const method of ['signIn','signUp']) for (const failure of ['returned','thrown']) await test(method+' '+failure+' failure restores submit button',async()=>{
    const signup=method==='signUp',prefix=signup?'signup':'signin';let shown=false;
    const authCall=async()=>{if(failure==='thrown')throw Error('offline');return{data:null,error:{message:'Rejected'}}};
    const c=make([method],{showApp(){shown=true},sb:{auth:{[signup?'signUp':'signInWithPassword']:authCall}}});
    for(const suffix of ['name','email','password'])c.document.getElementById(prefix+'-'+suffix).value='valid-password';
    await c[method]();assert.equal(shown,false);assert.equal(c._els[prefix+'-btn'].disabled,false);assert.equal(c._els[prefix+'-error'].style.display,'block');
  });
  await test('signin without authenticated session keeps auth usable',async()=>{
    let shown=false;const c=make(['signIn'],{showApp(){shown=true},sb:{auth:{signInWithPassword:async()=>({data:{user:{id:'A'}},error:null})}}});
    await c.signIn();assert.equal(shown,false);assert.equal(c._els['signin-btn'].disabled,false);assert.equal(c._els['signin-error'].style.display,'block');
  });
  await test('signin ignores a second submit while first request is pending',async()=>{
    let finish,calls=0,shown=0;const pending=new Promise(r=>finish=r);
    const c=make(['signIn'],{showApp(){shown++},sb:{auth:{signInWithPassword:()=>{calls++;return pending}}}});
    const first=c.signIn();await c.signIn();assert.equal(calls,1);finish({data:{session:{user:{id:'A'}}},error:null});await first;assert.equal(shown,1);assert.equal(c._els['signin-btn'].disabled,false);
  });
  await test('returning to auth restores both submit buttons',()=>{
    const c=make(['showAuth']);for(const id of ['signin-btn','signup-btn'])c.document.getElementById(id).disabled=true;
    c.showAuth();assert.equal(c._els['signin-btn'].disabled,false);assert.equal(c._els['signup-btn'].disabled,false);assert.equal(c._els['signin-btn'].textContent,'Sign In');
  });
  await test('deferred auth event does not duplicate sign-in account load',()=>{
    let callback,deferred,shown=0;const c=make([],{_activeUserId:null,setTimeout(fn){deferred=fn},showApp(){shown++},sb:{auth:{onAuthStateChange(fn){callback=fn}}}});
    vm.runInContext(html.slice(html.indexOf('sb.auth.onAuthStateChange('),html.indexOf('// ── DATA LAYER')),c);
    callback('SIGNED_IN',{user:{id:'A'}});c._activeUserId='A';deferred();assert.equal(shown,0);
    callback('SIGNED_IN',{user:{id:'B'}});deferred();assert.equal(shown,1);
  });
  for(const persistent of [false,true]) await test('JWT claims read rejection '+(persistent?'stops after one retry':'recovers once'),async()=>{
    let reads=0;const c=make(['loadUserData','showAuth'],{setTimeout(fn){fn()},sb:{from:table=>({select(){return this},eq(){return this},single:async()=>{reads++;return persistent||reads===1?{data:null,error:{code:'PGRST303'}}:{data:null,error:{code:'PGRST116'}}},order:async()=>({data:[],error:null})})}});
    await c.loadUserData();assert.equal(reads,2);assert.equal(c._messages.length,persistent?1:0);if(persistent)assert.equal(c._els['signin-btn'].disabled,false);else assert.equal(c._els.app.style.display,'block');
  });
  await test('account switch during JWT retry cannot read or populate old account',async()=>{
    let reads=0,delayed,readyResolve;const ready=new Promise(r=>readyResolve=r);const c=make(['loadUserData'],{setTimeout(fn){delayed=fn;readyResolve()},sb:{from:()=>({select(){return this},eq(){return this},single:async()=>{reads++;return{error:{code:'PGRST303'}}},order:async()=>({data:[],error:null})})}});
    const loading=c.loadUserData();await ready;c.currentUser={id:'B'};c.userSettings={startingBalance:7};delayed();await loading;assert.equal(reads,1);assert.equal(c.userSettings.startingBalance,7);assert.equal(c._messages.length,0);
  });
  await test('Insights escapes stored description and category without changing data',()=>{
    const payload='<img src=x onerror="window.marker=1">';
    const c=make(['renderInsights','fmt','fpEscHtml'],{transactions:[{type:'expense',amount:10,description:payload,category:payload},{type:'income',amount:20,description:payload}]});
    c.renderInsights();for(const id of ['insights-expenses','insights-income']){assert(!c._els[id].innerHTML.includes(payload));assert(c._els[id].innerHTML.includes('&lt;img'));}assert.equal(c.transactions[0].description,payload);
  });
  await test('monthly spending split includes calendar loan events and reconciles every outflow',()=>{
    const dm={1:{expenses:[{type:'expense',amount:'1.25',recurring:false},{type:'expense',amount:10,category:'loan_payment'}],bills:[{type:'bill',amount:40,recurring:true}],loans:[{type:'loan',amount:999,min_payment:100}]},2:{expenses:[{type:'expense',amount:2.5,recurring:false}],bills:[],loans:[]}};
    const c=make(['fpMonthlySpendingBreakdown'],{buildDayMap(y,m){assert.equal(y,2026);assert.equal(m,9);return dm}});
    const r=c.fpMonthlySpendingBreakdown(2026,9);assert.equal(r.fixedTotal,150);assert.equal(r.varTotal,3.75);assert.equal(r.total,153.75);
  });
  for(const failure of ['write','corrupt']) await test('bill paid '+failure+' failure cannot show success or alter marks',()=>{
    const c=make(['toggleBillPaid'],{transactions:[{id:'bill',type:'bill'}],sessionStorage:{getItem:()=>null,setItem(){}},fpIso:()=> '2026-10-08',fpAddDays:()=>new Date(2026,8,1),fpPriorityConfig:()=>({OVERDUE_LOOKBACK:45}),fpOccurrences:()=>['2026-10-03'],fpReadPaidMarks:()=>({}),fpBillPaidFor:()=>false,fpMarksFor:()=>[],fpDateLabel:s=>s,renderBillsView(){throw Error('failed save rendered')},updateBillBadge(){throw Error('failed save updated badge')}});
    const value=failure==='corrupt'?'bad JSON':'{}';c._cache.fp_bill_paid_marks_A=value;
    if(failure==='write')c.localStorage.setItem=()=>{throw Error('Storage full')};
    assert.equal(c.toggleBillPaid('bill'),false);assert.equal(c._cache.fp_bill_paid_marks_A,value);assert.equal(c._messages.length,1);assert(c._messages[0][0].startsWith('Could not'));
  });
  await test('explicit unpaid mark suppresses stale legacy session paid flag',()=>{
    const c=make(['fpReadPaidMarks','fpMarksFor'],{fpIso:()=> '2026-10-08',sessionStorage:{getItem:()=>JSON.stringify({bill:true,legacy:true})}});
    c._cache.fp_bill_paid_marks_A=JSON.stringify({bill:null});const marks=c.fpReadPaidMarks();assert(!marks.bill);assert.equal(marks.legacy.length,1);
  });
  await test('bill unmark cannot claim to undo a recorded expense',()=>{
    const c=make(['toggleBillPaid'],{transactions:[{id:'bill',type:'bill'}],sessionStorage:{getItem:()=>null,setItem(){throw Error('unexpected write')}},fpIso:()=> '2026-10-08',fpAddDays:()=>new Date(2026,8,1),fpPriorityConfig:()=>({OVERDUE_LOOKBACK:45}),fpOccurrences:()=>['2026-10-03'],fpReadPaidMarks:()=>({}),fpBillPaidFor:()=>true,fpMarksFor:()=>[]});
    c._cache.fp_bill_paid_marks_A='{}';assert.equal(c.toggleBillPaid('bill'),false);assert.equal(c._cache.fp_bill_paid_marks_A,'{}');assert(c._messages[0][0].includes('recorded as an expense'));
  });
  await test('bill totals count open occurrences and remaining partial amounts',()=>{
    const c=make(['fpBillStatusRows','fpIso','fpPad2','fpAddDays'],{transactions:[{id:'weekly',type:'bill'},{id:'yearly',type:'bill'}],fpPriorityConfig:()=>({OVERDUE_LOOKBACK:45}),fpReadPaidMarks:()=>({}),fpAmountDue:b=>b.id==='weekly'?10:100,fpOccurrences:(b,from,to)=>b.id==='weekly'?['2026-10-02','2026-10-09','2026-10-16','2026-10-23','2026-10-30']:[],fpPaidTotal:(b,d)=>({settled:d==='2026-10-02',total:d==='2026-10-09'?5:0})});
    const rows=c.fpBillStatusRows(new Date(2026,9,8,12));assert.equal(rows.length,1);assert.equal(rows[0].open.length,4);assert.equal(rows[0].openTotal,35);
  });
  await test('bill badge checks unpaid occurrences through next month',()=>{
    class ClockDate extends Date {constructor(...args){super(...(args.length?args:[2026,9,30,12]))}}
    let through;const c=make(['updateBillBadge','fpIso','fpPad2','fpAddDays'],{Date:ClockDate,fpBillStatusRows:(now,end)=>{through=end;return[{open:[{due:'2026-10-30'},{due:'2026-11-02'},{due:'2026-11-08'},{due:'2026-10-29'}]}]}});
    c.updateBillBadge();assert.equal(through,'2026-11-06');assert.equal(c._els['bill-badge'].textContent,2);
  });
  for(const [frequency,label] of [['weekly','Weekly'],['biweekly','Every two weeks'],['twicemonthly','Twice monthly'],['monthly','Monthly'],['yearly','Yearly']]) await test('expense record labels '+frequency+' without claiming a monthly amount',()=>{
    const c=make(['fpExpenseRecordLabel']);const text=c.fpExpenseRecordLabel({recurring:true,frequency,anchor_date:'2026-10-01'});assert(text.startsWith(label));assert(text.includes('2026'));assert(!text.includes('/mo'));
  });
  await test('historical loan payment label includes its recorded year',()=>{
    const c=make(['fpExpenseRecordLabel']);assert.equal(c.fpExpenseRecordLabel({category:'loan_payment',date:'2025-06-15'}),'Payment recorded · Jun 15, 2025');
  });
  for(const principal of [null,0]) await test('payment details '+principal+' do not invent principal allocation',()=>{
    const c=make(['openLoanPaymentInfo','fmt'],{transactions:[{id:'payment',description:'Recorded payment',amount:999,date:'2025-06-15',principal_applied:principal}]});
    c.openLoanPaymentInfo('payment');assert.equal(c._els['lp-info-principal'].textContent,principal===null?'Not recorded':'$0');assert(c._els['lp-info-date'].textContent.includes('2025'));
  });
  await test('expense summary uses monthly events while library retains historical records',()=>{
    const old={id:'old',type:'expense',description:'Old payment',amount:999,date:'2025-06-15',category:'loan_payment'},weekly={id:'weekly',type:'expense',description:'Weekly item',amount:10,date:'2026-10-01',anchor_date:'2026-10-01',recurring:true,frequency:'weekly'},expense={id:'other',type:'expense',description:'One time',amount:2,date:'2026-10-09'};
    const c=make(['renderExpensesView','fpExpenseRecordLabel','fpEscHtml','fmt'],{currentYear:2026,currentMonth:9,transactions:[old,weekly,expense],fpMonthlySpendingBreakdown(y,m){assert.equal(y,2026);assert.equal(m,9);return{fixedTotal:50,varTotal:2,total:52}},catIconSvg:()=>''});
    c.renderExpensesView();assert.equal(c._els['exp-stat-total'].textContent,'-$52');assert.equal(c._els['exp-stat-recurring'].textContent,'-$50');assert.equal(c._els['fv-fixed-total'].textContent,'2 saved records');assert(c._els['fv-fixed-list'].innerHTML.includes('Old payment'));assert(c._els['fv-fixed-list'].innerHTML.includes('2025'));assert(c._els['fv-fixed-list'].innerHTML.includes('Weekly'));assert(!c._els['fv-fixed-list'].innerHTML.includes('/mo'));assert.equal(c.transactions[0],old);
  });
  for (const end of [-50,50]) await test('month-end estimate '+end+' avoids unsupported bank-balance claims',()=>{
    const dm={};for(let d=1;d<=31;d++)dm[d]={income:[],expenses:[],bills:[],loans:[],balance:end};
    const c=make(['updateStats','fmt'],{currentYear:2026,currentMonth:9,buildDayMap:()=>dm,getStartingBalanceForMonth:()=>end,fpAllocationEnabled:()=>false,renderSpendingRings(){},renderPriorityReport(){},updateBillBadge(){},detectStage(){return null},clearTimeout(){}});
    c.updateStats();assert.equal(c._els.modal.textContent,'Month-end estimate');assert.equal(c._els['br-tag'].textContent,end<0?'Projected shortfall':'Estimate');assert(c._els['br-sub'].textContent.includes('Not a confirmed bank balance'));assert(!c._els['br-tag'].textContent.includes('owe'));if(end<0)assert(c._els['br-coach'].textContent.includes('Confirm your current bank balance'));
  });
  await test('delete confirmation escapes the stored name',async()=>{
    const payload='<img src=x onerror="window.marker=1">';const c=make(['deleteExpenseFromEdit','fpEscHtml'],{_editExpenseTxnId:'expense',transactions:[{id:'expense',description:payload}]});
    await c.deleteExpenseFromEdit();assert(!c._els.modal.innerHTML.includes(payload));assert(c._els.modal.innerHTML.includes('&lt;img'));
  });
  for(const value of ['2026-02-31','2026-13-01','2026-00-10','02/29/2026','2026-01-00','2026-10-09garbage','10/09/20261']) await test('CSV rejects '+value,()=>{
    const c=make(['parseImportDate']);assert.equal(c.parseImportDate(value),null);
  });
  for(const [value,expected] of [['2028-02-29','2028-02-29'],['10/09/26','2026-10-09'],['10/09/2026','2026-10-09'],['2026-10-09T00:00:00Z','2026-10-09']]) await test('CSV keeps local date '+value,()=>{
    const c=make(['parseImportDate']);const d=c.parseImportDate(value);assert(d);assert.equal([d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),expected);assert.equal(d.getHours(),12);
  });
  await test('new account without settings or cache gets empty state',async()=>{
    const sb={from:()=>({select(){return this},eq(){return this},single:async()=>({data:null,error:{code:'PGRST116'}}),order:async()=>({data:[],error:null})})};
    const c=make(['loadUserData'],{sb,currentUser:{id:'B'},userSettings:{startingBalance:1234,payAmount:999},monthBalances:{'2026-09':777}});
    await c.loadUserData();assert.equal(c.userSettings.startingBalance,0);assert.equal(Object.keys(c.monthBalances).length,0);assert.equal(c.transactions.length,0);
  });
  await test('late account A response cannot populate account B',async()=>{
    let resolveSettings;const pending=new Promise(r=>resolveSettings=r);
    const sb={from:table=>({select(){return this},eq(){return this},single:()=>pending,order:async()=>({data:[{id:'A-txn',type:'expense'}],error:null})})};
    const c=make(['loadUserData'],{sb});const load=c.loadUserData();c.currentUser={id:'B'};c.userSettings={startingBalance:7};c.transactions=[];
    resolveSettings({data:{starting_balance:1234},error:null});await load;assert.equal(c.userSettings.startingBalance,7);assert.equal(c.transactions.length,0);
  });
  await test('signout reset clears balances, imports, undo and saved purchases',()=>{
    const c=make(['fpResetAccountState'],{transactions:[{id:'old'}],userSettings:{startingBalance:1234},monthBalances:{old:1},savedPurchases:[{amount:50}],_pendingImportRows:[{amount:5}],_lastDeleted:{id:'old'}});
    c.fpResetAccountState();assert.equal(c.transactions.length,0);assert.equal(c.userSettings.startingBalance,0);assert.equal(Object.keys(c.monthBalances).length,0);assert.equal(c.savedPurchases.length,0);assert.equal(c._pendingImportRows.length,0);assert.equal(c._lastDeleted,null);
  });
  await test('saved purchase cache separates accounts and years',()=>{
    const c=make(['fpSavedPurchasesKey']);const a=c.fpSavedPurchasesKey();c.currentUser={id:'B'};assert.notEqual(c.fpSavedPurchasesKey(),a);assert(a.includes(String(new Date().getFullYear())));
  });
  await test('dated balance save failure preserves old record and cache',async()=>{
    const c=make(['fpApplyDatedBalance'],{monthBalances:{old:10},fpIso:()=> '2026-10-09',fpNormalizeAsOf:()=> '2026-10-09',fpNearPaycheck:()=>null,fpMonthStartFromDated:()=>999,fpRound2:v=>v,fpDatedKey:()=> '__dated_balance',saveUserSettings:async()=>false});
    assert.equal(await c.fpApplyDatedBalance(999,'2026-10-09',null,''),null);assert.equal(c.monthBalances.old,10);assert(!c.monthBalances.__dated_balance);assert.equal(Object.keys(c._cache).length,0);
  });
  await test('failed edit leaves balance dialog open without success toast',async()=>{
    const c=make(['saveEditBalance'],{fpNormalizeAsOf:()=>true,fpIso:()=> '2026-10-09',fpPayAnswer:()=>'',fpApplyDatedBalance:async()=>null});
    c.document.getElementById('edit-balance-input').value='999';c.document.getElementById('edit-balance-date').value='2026-10-09';c.document.getElementById('edit-balance-overlay').style.display='flex';
    await c.saveEditBalance();assert.equal(c._els['edit-balance-overlay'].style.display,'flex');assert.equal(c._messages.length,0);
  });
  for(const balance of [0, '0']) await test('paid-off loan '+typeof balance+' cannot create a new payment',async()=>{
    const c=make(['confirmRecordPayment','fpLoanSplit'],{transactions:[{id:'loan',balance,amount:200,min_payment:200,apr:12}],_rpLoanId:'loan',_rpIncludeMonthly:true,sb:{from(){throw Error('paid-off loan attempted database write')}}});
    await c.confirmRecordPayment();assert.equal(c._messages.length,0);assert.equal(c.transactions[0].balance,balance);
  });
  const atomicNames=['fpOperationStorageKey','fpPendingOperation','fpAtomicMutation'];
  const snapshot=(params,rows=[])=>({data:{operation_id:params.p_operation_id,kind:params.p_kind,transactions:rows},error:null});
  await test('atomic SQL rejection preserves rows and allows corrected retry',async()=>{
    const c=make(atomicNames,{transactions:[{id:'old'}],sb:{rpc:async()=>({error:{code:'P0001',message:'invalid payment'}})}});
    assert.equal(await c.fpAtomicMutation('record',{extra:10},'record:loan'),null);assert.equal(c.transactions[0].id,'old');assert.equal(Object.keys(c._cache).length,0);assert.equal(c._fpMutationBusy,false);assert.equal(c._messages.length,1);
  });
  await test('lost response retry reuses operation ID and accepts fresh owner snapshot',async()=>{
    const ids=[];let n=0;const c=make(atomicNames,{sb:{rpc:async(name,params)=>{ids.push(params.p_operation_id);if(n++===0)throw Error('connection lost');return snapshot(params,[{id:'loan',user_id:'A',balance:0}]);}}});
    const p={extra:10};assert.equal(await c.fpAtomicMutation('record',p,'record:loan'),null);assert.equal(Object.keys(c._cache).length,1);assert(await c.fpAtomicMutation('record',p,'record:loan'));assert.equal(ids[0],ids[1]);assert.equal(c.transactions[0].balance,0);assert.equal(Object.keys(c._cache).length,0);
  });
  await test('ambiguous retry cannot change amount or create a second request',async()=>{
    let calls=0;const c=make(atomicNames,{sb:{rpc:async()=>{calls++;throw Error('lost')}}});
    await c.fpAtomicMutation('record',{extra:10},'record:loan');await c.fpAtomicMutation('record',{extra:20},'record:loan');assert.equal(calls,1);assert.equal(Object.keys(c._cache).length,1);assert(c._messages[1][0].includes('Retry the pending'));
  });
  await test('unavailable local persistence prevents ambiguous financial write',async()=>{
    let calls=0;const c=make(atomicNames,{sb:{rpc:async()=>{calls++;}}});c.localStorage.setItem=()=>{throw Error('storage unavailable')};
    assert.equal(await c.fpAtomicMutation('record',{},'record:loan'),null);assert.equal(calls,0);assert.equal(c._fpMutationBusy,false);
  });
  await test('late mutation from account A cannot populate account B',async()=>{
    let resolve,params;const wait=new Promise(r=>resolve=r);const c=make(atomicNames,{transactions:[],sb:{rpc:async(n,p)=>{params=p;return wait}}});
    const task=c.fpAtomicMutation('record',{},'record:loan');c.currentUser={id:'B'};c._fpMutationVersion++;c._fpMutationBusy=false;
    resolve(snapshot(params,[{id:'old',user_id:'A'}]));assert.equal(await task,null);assert.equal(c.transactions.length,0);assert.equal(c._messages.length,0);
  });
  await test('cross-account or incomplete mutation response cannot enter local state',async()=>{
    for(const rows of [[{id:'foreign',user_id:'B'}],null]){const c=make(atomicNames,{transactions:[{id:'old'}],sb:{rpc:async(n,p)=>snapshot(p,rows)}});assert.equal(await c.fpAtomicMutation('delete',{},'delete:row'),null);assert.equal(c.transactions[0].id,'old');assert.equal(Object.keys(c._cache).length,1);}
  });
  await test('display exception after commit cannot create duplicate save',async()=>{
    const c=make(atomicNames,{fpRenderTransactionState(){throw Error('display failed')},sb:{rpc:async(n,p)=>snapshot(p)}});
    assert(await c.fpAtomicMutation('record',{},'record:loan'));assert.equal(Object.keys(c._cache).length,0);assert.equal(c._messages.length,0);
  });
  await test('double click sends only one in-flight operation',async()=>{
    let resolve,params,calls=0;const pending=new Promise(r=>resolve=r);const c=make(atomicNames,{sb:{rpc:async(n,p)=>{calls++;params=p;return pending}}});
    const first=c.fpAtomicMutation('record',{},'record:loan');assert.equal(await c.fpAtomicMutation('record',{},'record:loan'),null);resolve(snapshot(params));assert(await first);assert.equal(calls,1);
  });
  await test('failed payment stays open and re-enables confirmation without animation',async()=>{
    const c=make(['confirmRecordPayment'],{currentYear:2026,currentMonth:9,_rpLoanId:'loan',_rpIncludeMonthly:true,transactions:[{id:'loan',balance:5000,amount:200,anchor_date:'2026-10-10'}],fpAtomicMutation:async()=>null});
    c.document.getElementById('rp-input-stage').style.display='block';await c.confirmRecordPayment();assert.equal(c._els['rp-input-stage'].style.display,'block');assert.equal(c._els['rp-confirm-btn'].disabled,false);assert.equal(c._messages.length,0);
  });
  await test('failed deletion does not replace undo state or show success',async()=>{
    const c=make(['deleteTxnWithUndo'],{deleteTxn:async()=>null,_lastDeleted:{id:'previous'},_lastDeletedOperation:'previous-op'});assert.equal(await c.deleteTxnWithUndo('row'),false);assert.equal(c._lastDeleted.id,'previous');assert.equal(c._lastDeletedOperation,'previous-op');assert.equal(c._messages.length,0);
  });
  await test('failed undo retains receipt for retry without success toast',async()=>{
    const c=make(['undoLastDelete'],{_lastDeleted:{id:'deleted'},_lastDeletedOperation:'delete-op',fpAtomicMutation:async()=>null});await c.undoLastDelete();assert.equal(c._lastDeleted.id,'deleted');assert.equal(c._lastDeletedOperation,'delete-op');assert.equal(c._messages.length,0);
  });
  await test('loan deletion dialog remains open after database rejection',async()=>{
    const c=make(['confirmLoanDelete'],{_loanDeleteId:'loan',_loanDeleteReason:'mistake',deleteTxnWithUndo:async()=>false});c.document.getElementById('loan-delete-overlay').style.display='flex';await c.confirmLoanDelete();assert.equal(c._els['loan-delete-overlay'].style.display,'flex');assert.equal(c._els['ld-confirm-btn'].disabled,false);assert.equal(c._loanDeleteId,'loan');
  });

  function writeBackend(mode='ok') {
    let db=[],calls=0,uuid=0;
    const sb={from(){let op='read',payload,filters=[];const q={insert(v){op='insert';payload=v;return q},update(v){op='update';payload=v;return q},select(){return q},eq(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v,'in']);return q},single(){q.one=true;return q},then(resolve,reject){return Promise.resolve().then(()=>{
      calls++;
      if(mode==='throw')throw Error('offline');
      if(mode==='error')return{error:{code:'23514',message:'rejected'}};
      if(mode==='empty')return{data:q.one?null:[],error:null};
      if(op==='insert'){
        if(payload.some(p=>db.some(r=>r.id===p.id)))return{data:null,error:{code:'23505',message:'duplicate'}};
        db.push(...payload.map(r=>({...r})));
        if(mode==='lost'){mode='ok';throw Error('lost after commit');}
        if(mode==='truncated'){mode='ok';return{data:payload.slice(0,1).map(r=>({...r})),error:null};}
        return{data:payload.map(r=>({...r})),error:null};
      }
      const found=db.filter(r=>filters.every(([k,v,op])=>op==='in'?v.includes(r[k]):r[k]===v));
      if(op==='update')found.forEach(r=>Object.assign(r,payload));
      return{data:q.one?found[0]||null:found.map(r=>({...r})),error:null};
    }).then(resolve,reject)}};return q;}};
    return{sb,get db(){return db},get calls(){return calls},id:()=> 'uuid-'+(++uuid),set mode(v){mode=v}};
  }
  const insertNames=['fpOperationStorageKey','fpPendingOperation','fpInsertTransactions'];
  const expense={type:'expense',description:'Coffee',amount:10,date:'2026-10-09'};
  for(const mode of ['error','throw','empty'])await test('new transaction '+mode+' preserves rows and reports failure',async()=>{
    const b=writeBackend(mode),c=make(insertNames,{sb:b.sb,crypto:{randomUUID:b.id}});
    assert.equal(await c.fpInsertTransactions([expense]),false);assert.equal(c.transactions.length,0);assert.equal(c._messages.length,1);assert.equal(c._fpMutationBusy,false);
    if(mode==='error')assert.equal(Object.keys(c._cache).length,0);
  });
  await test('import lost after commit retries same UUIDs without duplicates',async()=>{
    const b=writeBackend('lost'),c=make(insertNames,{sb:b.sb,crypto:{randomUUID:b.id}}),batch=[expense,{...expense,description:'Lunch'}];
    assert.equal(await c.fpInsertTransactions(batch),false);assert.equal(b.db.length,2);const ids=b.db.map(r=>r.id).join(',');
    assert.equal(await c.fpInsertTransactions(batch),true);assert.equal(b.db.length,2);assert.equal(c.transactions.length,2);assert.equal(b.db.map(r=>r.id).join(','),ids);assert.equal(Object.keys(c._cache).length,0);
  });
  await test('pending insert blocks a different batch until original is checked',async()=>{
    const b=writeBackend('lost'),c=make(insertNames,{sb:b.sb,crypto:{randomUUID:b.id}});await c.fpInsertTransactions([expense]);const calls=b.calls;
    assert.equal(await c.fpInsertTransactions([{...expense,amount:20}]),false);assert.equal(b.calls,calls);assert.equal(b.db.length,1);
  });
  await test('insert persistence failure sends no financial request',async()=>{
    const b=writeBackend(),c=make(insertNames,{sb:b.sb,crypto:{randomUUID:b.id}});c.localStorage.setItem=()=>{throw Error('full')};assert.equal(await c.fpInsertTransactions([expense]),false);assert.equal(b.calls,0);
  });
  await test('new insert after confirmed save can legitimately repeat same expense',async()=>{
    const b=writeBackend(),c=make(insertNames,{sb:b.sb,crypto:{randomUUID:b.id}});assert(await c.fpInsertTransactions([expense]));assert(await c.fpInsertTransactions([expense]));assert.equal(b.db.length,2);assert.notEqual(b.db[0].id,b.db[1].id);
  });
  await test('partial import confirmation cannot report success',async()=>{
    const c=make(insertNames,{sb:{from(){return{insert(){return this},select:async()=>({data:[{id:'one',user_id:'A'}],error:null})}}},crypto:{randomUUID:(()=>{let n=0;return()=> 'id'+(++n)})()}});
    assert.equal(await c.fpInsertTransactions([expense,expense]),false);assert.equal(c.transactions.length,0);assert.equal(Object.keys(c._cache).length,1);
  });
  for(const mode of ['error','throw','empty']) await test('edit '+mode+' preserves stored values',async()=>{
    const b=writeBackend(mode),row={id:'loan',user_id:'A',balance:5000};b.db.push({...row});const c=make(['fpUpdateTransaction'],{sb:b.sb,transactions:[row]});assert.equal(await c.fpUpdateTransaction('loan',{balance:0}),false);assert.equal(c.transactions[0].balance,5000);assert.equal(c._fpMutationBusy,false);
  });
  await test('confirmed loan edit retains zero balance from returned row',async()=>{
    const b=writeBackend(),row={id:'loan',user_id:'A',balance:5000};b.db.push({...row});const c=make(['fpUpdateTransaction'],{sb:b.sb,transactions:[row]});assert(await c.fpUpdateTransaction('loan',{balance:0}));assert.equal(c.transactions[0].balance,0);
  });
  for(const name of ['fpInsertTransactions','fpUpdateTransaction'])await test(name+' ignores a late response after account switch',async()=>{
    let resolve,payload;const promise=new Promise(r=>resolve=r);const sb={from(){return{insert(p){payload=p;return this},update(p){payload=p;return this},eq(){return this},select(){return this},single(){return this},then(a,b){return promise.then(a,b)}}}};
    const c=make(name==='fpInsertTransactions'?insertNames:[name],{sb,crypto:{randomUUID:(()=>{let n=0;return()=> 'id'+(++n)})()}});
    const task=name==='fpInsertTransactions'?c[name]([expense]):c[name]('row',{amount:10});c.currentUser={id:'B'};c._fpMutationVersion++;c._fpMutationBusy=false;
    resolve({data:name==='fpInsertTransactions'?payload:[{...payload,id:'row',user_id:'A'}][0],error:null});assert.equal(await task,false);assert.equal(c.transactions.length,0);assert.equal(c._messages.length,0);
  });
  await test('loan payment reassignment and amount edit cannot corrupt principal linkage',async()=>{
    const b=writeBackend(),c=make(['fpUpdateTransaction'],{sb:b.sb,transactions:[{id:'payment',category:'loan_payment'}]});assert.equal(await c.fpUpdateTransaction('payment',{category:'food'}),false);assert.equal(b.calls,0);
  });
  await test('failed expense delete confirmation keeps dialog and ID',async()=>{
    const c=make(['confirmDeleteExpense'],{_editExpenseTxnId:'expense',deleteTxnWithUndo:async()=>false});c.document.getElementById('edit-expense-overlay').style.display='flex';await c.confirmDeleteExpense();assert.equal(c._editExpenseTxnId,'expense');assert.equal(c._els['edit-expense-overlay'].style.display,'flex');
  });
  await test('failed new loan keeps modal open and re-enables save',async()=>{
    let closed=false;const c=make(['saveLoanFromModal'],{saveTxn:async()=>false,closeLoanModal(){closed=true},alert(){},currentYear:2026,currentMonth:9});for(const [id,v] of [['lm-desc','Test Loan'],['lm-balance','5000'],['lm-payment','200'],['lm-anchor','2026-10-10']])c.document.getElementById(id).value=v;await c.saveLoanFromModal();assert.equal(closed,false);assert.equal(c._els['lm-save-btn'].disabled,false);assert.equal(c._messages.length,0);
  });
  await test('failed ripple purchase preserves pending purchase and warning',async()=>{
    const pending={txnObj:expense};const c=make(['rippleStillBuy'],{_ripplePending:pending,saveTxn:async()=>false});c.document.getElementById('ripple-overlay').style.display='flex';await c.rippleStillBuy();assert.equal(c._ripplePending,pending);assert.equal(c._els['ripple-overlay'].style.display,'flex');assert.equal(c._messages.length,0);
  });
  await test('failed import keeps preview and rows available for retry',async()=>{
    const rows=[{...expense,include:true}];const c=make(['confirmStatementImport'],{_pendingImportRows:rows,fpInsertTransactions:async()=>false,updateImportSummary(){}});c.document.getElementById('import-preview').style.display='block';await c.confirmStatementImport();assert.equal(c._pendingImportRows,rows);assert.equal(c._els['import-preview'].style.display,'block');assert.equal(c._els['import-confirm-btn'].disabled,false);assert.equal(c._messages.length,0);
  });

  await test('large import confirms every UUID when API truncates insert response',async()=>{
    const b=writeBackend('truncated'),c=make(insertNames,{sb:b.sb,crypto:{randomUUID:b.id}});
    const batch=Array.from({length:1001},(_,i)=>({...expense,description:'Row '+i}));
    assert.equal(await c.fpInsertTransactions(batch),true);assert.equal(c.transactions.length,1001);assert.equal(b.db.length,1001);assert.equal(new Set(b.db.map(x=>x.id)).size,1001);assert.equal(Object.keys(c._cache).length,0);
  });

  await test('expense focus timer tolerates replacement by delete confirmation',()=>{
    let timer,removed=false;const c=make(['openExpenseEdit'],{transactions:[{id:'expense',description:'Coffee',amount:10,date:'2026-10-09'}],setTimeout:fn=>{timer=fn;}});
    const getter=c.document.getElementById;c.document.getElementById=id=>removed && id==='ee-desc'?null:getter(id);
    c.openExpenseEdit('expense');removed=true;assert.doesNotThrow(()=>timer());
  });
  console.log('TOTAL pass='+pass+' fail='+fail);process.exitCode=fail?1:0;
})();
