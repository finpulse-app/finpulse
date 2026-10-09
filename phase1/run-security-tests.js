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
  await test('Insights escapes stored description and category without changing data',()=>{
    const payload='<img src=x onerror="window.marker=1">';
    const c=make(['renderInsights','fmt','fpEscHtml'],{transactions:[{type:'expense',amount:10,description:payload,category:payload},{type:'income',amount:20,description:payload}]});
    c.renderInsights();for(const id of ['insights-expenses','insights-income']){assert(!c._els[id].innerHTML.includes(payload));assert(c._els[id].innerHTML.includes('&lt;img'));}assert.equal(c.transactions[0].description,payload);
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
  console.log('TOTAL pass='+pass+' fail='+fail);process.exitCode=fail?1:0;
})();
