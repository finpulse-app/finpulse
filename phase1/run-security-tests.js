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
  const element = id => els[id] || (els[id]={value:'',style:{},closest(){return this},textContent:'',innerHTML:'',classList:{remove(){},toggle(){}}});
  const c = vm.createContext(Object.assign({console,Date,Math,JSON,parseFloat,isNaN,setTimeout(){},
    currentUser:{id:'A'},userSettings:{startingBalance:100,payAmount:0},monthBalances:{},transactions:[],
    _dataLoadVersion:0,_activeUserId:'A', savedPurchases:[],_importReadVersion:0,_importEditIndex:-1,_importSaving:false,_fpRecurringSaving:false,_fpRecurringSuggestions:[],fpReviewRecurringBills(){},fpImportLocked:()=>false,fpLockImportControls(){},_fpSettingsVersion:0,_fpSettingsBusy:false,_fpSignOutBusy:false,fpReadTransactions:async()=>({data:[],error:null}),
    fpLoadGoals:async()=>true,_fpGoals:[],_fpGoalsReady:true,_fpGoalBusy:false,_fpGoalDraftId:null,_fpGoalVersion:0,fpRenderAgenda(){},fpRefreshOpenMoneyViews(){},_fpExpenseQuery:'',
    _fpBillMarkRows:[],_fpBillMarksReady:true,_fpBillMarkBusy:false,_fpBillMarkVersion:0,fpRefreshBillMarks:async()=>true,renderPriorityReport(){},dRenderCashImpact(){},
    window:{},document:{getElementById:element,querySelector(){return element('modal')},querySelectorAll(){return []}},
    localStorage:{getItem:k=>cache[k]||null,setItem:(k,v)=>{cache[k]=v},removeItem:k=>{delete cache[k]}},
    crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
    _fpMutationBusy:false,_fpMutationVersion:0,_lastDeletedOperation:null,_rpPendingDate:null,_rpDialogVersion:0,_rpHasPending:false,
    fpPendingOperation:()=>null,fpRenderTransactionState(){},fpUpdatePendingNotice(){},panelOpen:false,
    showView(){},showToast:(...m)=>messages.push(m),renderCalendar(){},renderLoans(){},renderBillsView(){},updateStats(){},dUpdate(){},updateTopbarButtons(){},openSetup(){},loadSavedPurchases(){},shouldShowStageModal(){return false},checkMonthRollover:async()=>{},
    _els:els,_cache:cache,_messages:messages},extra));
  ['fpIsStatementRecord','fpEverydayEntryDestination','fpStatementPDFSection','fpPrivateText','fpSafeTransactionRecord','fpStatementPrivateValues','fpPrivateStatementDescription','fpParseBalance','fpCreditCardPaymentEstimate','fpRestoreExpenseEditor','fpLoanRateKnown','fpRound2','fpParseMoney','fpLoanBalanceAmount','fpIsPaycheckRecord','fpPad2','fpIso','fpParseIso','fpInitialCalendarMode','fpDueDateText','fpLinkedCardParts','fpManagedLoan','fpLoanDisplayEntries','fpDebtPayoff','fpDebtPaymentSplit','fpCardRateLabel','fpSaveManagedLoan'].concat(names).forEach(n=>vm.runInContext(grab(n),c)); return c;
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
  await test('older balance is a reference instead of being relabeled with today by the editor',()=>{const c=make(['openEditBalance','fmt','fpDateLabel'],{fpBalanceAnchor:()=>({status:'ok',amount:-125.5,asOf:'2026-09-28'}),fpPrefillBalanceDate(){},fpRefreshPayQuestion(){}});c.openEditBalance();assert.equal(c._els['edit-balance-input'].value,'');assert.equal(c._els['edit-balance-last'].hidden,false);assert(c._els['edit-balance-last'].textContent.includes('−$125.5'));assert(c._els['edit-balance-last'].textContent.includes('Sep 28'));});
  await test('today balance can be edited with its confirmed amount prefilled',()=>{const c=make(['openEditBalance','fmt','fpDateLabel'],{fpBalanceAnchor:iso=>({status:'ok',amount:0,asOf:iso}),fpPrefillBalanceDate(){},fpRefreshPayQuestion(){}});c.openEditBalance();assert.equal(c._els['edit-balance-input'].value,0);assert.equal(c._els['edit-balance-last'].hidden,true);});
  await test('undated balance does not show a false dated reference in the editor',()=>{const c=make(['openEditBalance','fmt','fpDateLabel'],{fpBalanceAnchor:()=>({status:'undated',amount:null,asOf:null}),fpPrefillBalanceDate(){},fpRefreshPayQuestion(){}});c.openEditBalance();assert.equal(c._els['edit-balance-input'].value,'');assert.equal(c._els['edit-balance-last'].hidden,true);});
  await test('new-month focus asks for a current dated balance and retains missed payments',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const p=c.fpTodayFocus({asOf:'2026-11-02',balanceBasis:{status:'ok',asOf:'2026-10-25'},overdue:[{kind:'bill',dueDate:'2026-10-28'}]});assert.equal(p.code,'month_balance');assert.equal(p.destination,'balance');assert(p.title.includes('this month'));assert(p.description.includes('Oct 25'));assert.equal(p.secondaryDestination,'bills');});
  await test('a confirmed balance from this month keeps the routine next step',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const p=c.fpTodayFocus({asOf:'2026-11-02',balanceBasis:{status:'ok',asOf:'2026-11-02'},upcoming:[{date:'2026-11-15'}],monthNet:100});assert.equal(p.destination,'dreams');});
  await test('legacy month values retain zero and reject malformed balances',()=>{const c=make(['fpStoredMonthBalance','fpRound2'],{monthBalances:{zero:0,string:'-125.50',blank:' ',bad:'oops',object:{},infinite:Infinity}});assert.equal(c.fpStoredMonthBalance('zero'),0);assert.equal(c.fpStoredMonthBalance('string'),-125.5);for(const k of ['blank','bad','object','infinite','missing'])assert.equal(c.fpStoredMonthBalance(k),null);});
  await test('opening saved finances cannot save a rollover estimate or schedule its dialog',async()=>{let writes=0;const c=make(['loadUserData'],{sb:{from:()=>({select(){return this},eq(){return this},single:async()=>({data:{starting_balance:100,pay_amount:0,month_balances_json:'{"2026-09":1000}'},error:null})})},saveMonthBalance:async()=>{writes++;return true},checkMonthRollover:async()=>{throw Error('automatic rollover called')}});await c.loadUserData();assert.equal(writes,0);assert.equal(c.monthBalances['2026-09'],1000);assert.equal(c._els.app.style.display,'block');});
  await test('legacy rollover compatibility entry point does not write or open a popup',async()=>{let effect=false;const c=make(['checkMonthRollover'],{saveMonthBalance:async()=>{effect=true},showRolloverModal:()=>{effect=true}});assert.equal(await c.checkMonthRollover(),false);assert.equal(effect,false);});
  await test('local midnight refresh updates the views without financial writes',()=>{let now=new Date(2026,9,12,23,59,59).getTime(),callback,delay,refreshes=0;class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}}const c=make(['fpRefreshDay','fpScheduleDayRefresh'],{Date:Clock,_fpDisplayedDay:'2026-10-12',_fpDayRefreshTimer:null,setTimeout:(cb,ms)=>{callback=cb;delay=ms;return 1},clearTimeout(){},renderCalendar:()=>refreshes++,updateStats:()=>refreshes++,renderBillsView:()=>refreshes++,renderPriorityReport:()=>refreshes++,updateBillBadge:()=>refreshes++});c.fpScheduleDayRefresh();assert.equal(delay,1050);now+=1050;callback();assert.equal(c._fpDisplayedDay,'2026-10-13');assert.equal(refreshes,5);assert(delay>23*60*60*1000);c.fpRefreshDay();assert.equal(refreshes,5);});
  function sampleCard(){return[{id:'r',type:'loan',description:'Example Card · purchases',balance:5,amount:5,min_payment:5,apr:24,lender:'Credit Card | account:import:card:Example Card | statement:2026-09-30'},{id:'f',type:'loan',description:'Example Card · 0% financing',balance:800,amount:40,min_payment:40,apr:0,lender:'Credit Card | account:import:card:Example Card:installments | financing:0%'}];}
  await test('one card model contains the total balance and one combined minimum',()=>{const c=make([],{transactions:sampleCard()});const l=c.fpManagedLoan('r');assert.equal(l.balance,805);assert.equal(l.min_payment,45);assert.equal(l.description,'Example Card');assert.equal(c.fpLoanDisplayEntries(c.transactions).length,1);});
  await test('snowball model compares total card balances with other loans',()=>{const c=make([],{transactions:[...sampleCard(),{id:'small',type:'loan',description:'Small loan',balance:100,amount:20,apr:0}]});const entries=c.fpLoanDisplayEntries(c.transactions).sort((a,b)=>a.balance-b.balance);assert.equal(entries[0].id,'small');assert.equal(entries[1].balance,805);});
  await test('mixed APR payoff never charges financing at the purchase APR',()=>{const c=make([],{transactions:sampleCard()});const result=c.fpDebtPayoff(c.fpManagedLoan('r'),45);assert.equal(result.interest,0.1);assert.equal(result.months,18);assert(result.canPayOff);});
  await test('one mixed card payment retains both rates and caps an extra payoff',()=>{const c=make(['fpLoanSplit'],{transactions:sampleCard()});const l=c.fpManagedLoan('r');const regular=c.fpDebtPaymentSplit(l,45,false);assert.equal(regular.interest,0.1);assert.equal(regular.newBal,760.1);assert.equal(regular.totalPaid,45);const extra=c.fpDebtPaymentSplit(l,2000,true);assert.equal(extra.totalPaid,805);assert.equal(extra.newBal,0);assert.equal(extra.interest,0);});
  await test('card minimum edits update its baseline while What If preserves the original minimum',async()=>{let rows;const c=make([],{transactions:sampleCard(),fpSaveCardBatch:async r=>{rows=r;return true;}});const l=c.fpManagedLoan('r');await c.fpSaveManagedLoan(l,{min_payment:100,original_min_payment:100});assert.equal(rows.reduce((n,r)=>n+r.original_min_payment,0),100);await c.fpSaveManagedLoan(l,{min_payment:100,original_min_payment:l.original_min_payment});assert.equal(rows.reduce((n,r)=>n+r.original_min_payment,0),45);assert.equal(rows.reduce((n,r)=>n+r.min_payment,0),100);});
  await test('one card paid-off save applies the date to both stored balances',async()=>{let rows;const c=make(['fpPaidOffDate','parseImportDate'],{transactions:sampleCard(),fpSaveCardBatch:async r=>{rows=r;return true;}});await c.fpSaveManagedLoan(c.fpManagedLoan('r'),{balance:0,lender:'Credit Card | paid_off:2026-10-08'});assert.equal(rows.length,2);assert(rows.every(r=>r.balance===0&&r.lender.endsWith('paid_off:2026-10-08')));assert(!rows.some(r=>'_cardParts'in r));});
  await test('payment reminders change from tomorrow to today to overdue',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const base={balanceBasis:{status:'ok'},dueThisWeek:[{kind:'loan',description:'Card',amount:35,date:'2026-10-13'}]};assert.equal(c.fpTodayFocus({...base,asOf:'2026-10-12'}).title,'Card is due tomorrow.');assert.equal(c.fpTodayFocus({...base,asOf:'2026-10-13'}).title,'Card is due today.');const late=c.fpTodayFocus({balanceBasis:{status:'ok'},asOf:'2026-10-14',overdue:[{kind:'loan',description:'Card',dueDate:'2026-10-13'}]});assert.equal(late.title,'Card is overdue.');assert(late.description.includes('due yesterday'));});
  await test('relative payment dates cross month year and daylight saving boundaries',()=>{const c=make(['fpDateLabel']);for(const [today,tomorrow] of [['2026-10-31','2026-11-01'],['2026-12-31','2027-01-01'],['2026-11-01','2026-11-02'],['2026-03-08','2026-03-09']])assert.equal(c.fpDueDateText(tomorrow,today),'tomorrow');});
  await test('today focus reviews the earliest scheduled expense alongside repeating bills',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const p=c.fpTodayFocus({asOf:'2026-10-08',weekEnd:'2026-10-10',balanceBasis:{status:'ok'},dueThisWeek:[{kind:'bill',description:'Phone',amount:30,date:'2026-10-10'}],upcomingOneTime:[{description:'Car repair',amount:250.25,date:'2026-10-09'}]});assert.equal(p.destination,'expenses');assert(p.title.includes('Car repair'));assert(p.description.includes('$250.25'));});
  await test('today focus keeps a later scheduled expense in the purchase comparison path',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const p=c.fpTodayFocus({asOf:'2026-10-08',weekEnd:'2026-10-10',balanceBasis:{status:'ok'},monthNet:0,upcomingOneTime:[{description:'Car repair',amount:250,date:'2026-10-20'}]});assert.equal(p.destination,'dreams');});
  await test('today focus checks unconfirmed pay before attributing a shortfall to spending',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const p=c.fpTodayFocus({balanceBasis:{status:'ok'},unconfirmedIncome:[{amount:500}],firstNegative:{date:'2026-10-12'}});assert.equal(p.destination,'balance');assert(p.description.includes('If the paycheck arrived'));assert(p.description.includes('possible shortfall'));assert(p.description.includes('Oct 12'));});
  await test('today focus does not double-count income that may already be in a balance',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const p=c.fpTodayFocus({balanceBasis:{status:'ok'},uncertainIncome:[{amount:500}]});assert(p.description.includes('already in your balance'));assert.equal(p.destination,'balance');});
  await test('today focus balance reminder links to the oldest mixed overdue payment',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const p=c.fpTodayFocus({balanceBasis:{status:'undated'},overdue:[{kind:'bill',dueDate:'2026-10-05'},{kind:'loan',dueDate:'2026-09-20'}]});assert.equal(p.secondaryDestination,'loans');assert.equal(p.secondaryLabel,'Review loans');});
  await test('account reset clears the previous next-step details and action',()=>{const c=make(['fpResetAccountState']);const b=c.document.getElementById('today-focus-button');b.hidden=false;b.onclick=()=>{};c.document.getElementById('today-focus-payday').textContent='Old income';c.fpResetAccountState();assert.equal(b.hidden,true);assert.equal(b.onclick,null);assert.equal(c._els['today-focus-payday'].textContent,'');assert.equal(c._els['today-focus-title'].textContent,'Getting your plan ready');});
  await test('today focus updates an undated balance without hiding late payments',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const focus=c.fpTodayFocus({balanceBasis:{status:'undated'},overdue:[{kind:'bill',description:'Rent',dueDate:'2026-09-01'}]});assert.equal(focus.destination,'balance');assert.equal(focus.secondaryDestination,'bills');assert(focus.secondary.includes('1 past-due payment'));});
  await test('today focus sends stale balance and failed paid status to their working editors',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);assert.equal(c.fpTodayFocus({balanceBasis:{status:'stale'}}).destination,'balance');assert.equal(c.fpTodayFocus({balanceBasis:{status:'ok'}},false).destination,'bills');});
  await test('today focus reviews the oldest open payment without executing a payment',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const p=c.fpTodayFocus({balanceBasis:{status:'ok'},overdue:[{kind:'bill',description:'Rent',dueDate:'2026-10-05'},{kind:'loan',description:'Car',dueDate:'2026-09-20'}]});assert.equal(p.destination,'loans');assert(p.description.includes('Car'));assert.equal(p.tone,'urgent');});
  await test('today focus labels a projected shortfall without naming free cash',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const p=c.fpTodayFocus({balanceBasis:{status:'ok'},firstNegative:{date:'2026-10-12'}});assert.equal(p.destination,'expenses');assert(p.title.includes('calendar'));assert(p.description.includes('Oct 12'));});
  await test('today focus offers bill entry for a zero-income empty calendar',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const p=c.fpTodayFocus({balanceBasis:{status:'ok'},monthNet:0,upcoming:[],loans:[]});assert.equal(p.destination,'bill_entry');assert(!p.title.includes('income'));});
  await test('today focus offers a purchase check without promising spending money',()=>{const c=make(['fpTodayFocus','fpDateLabel','fmt']);const p=c.fpTodayFocus({balanceBasis:{status:'ok'},monthNet:100,upcoming:[{date:'2026-10-25'}],loans:[]});assert.equal(p.destination,'dreams');assert.equal(p.title,'Check before you spend.');});
  await test('today focus bill shortcut opens the monthly entry form',()=>{let kind,view;const c=make(['fpOpenPriority'],{showView:v=>view=v,openDayPanel:(day,k)=>kind=k});c.fpOpenPriority('bill_entry');assert.equal(view,'bills');assert.equal(kind,'bill');});

  for(const [amount,date] of [['','2026-10-12'],['-1','2026-10-12'],['1.234','2026-10-12'],['1000',''],['1000','2026-02-31']])await test('primary income rejects blank or invalid inputs '+amount+' '+date,async()=>{let wrote=false;const c=make(['saveEditIncome'],{saveUserSettings:async()=>{wrote=true}});c.document.getElementById('ei-amount').value=amount;c.document.getElementById('ei-frequency').value='biweekly';c.document.getElementById('ei-payday').value=date;await c.saveEditIncome();assert.equal(wrote,false);assert.equal(c._messages.length,1);});
  await test('explicit zero income is saved without requiring a payday',async()=>{let saved;const c=make(['saveEditIncome'],{saveUserSettings:async record=>{saved=record;return true},shouldShowStageModal:()=>false});c.document.getElementById('ei-amount').value='0';c.document.getElementById('ei-frequency').value='biweekly';c.document.getElementById('ei-payday').value='';await c.saveEditIncome();assert.equal(saved.payAmount,0);});
  await test('additional income rejects an invalid date before mutation',async()=>{let wrote=false;const c=make(['saveIncomeSource'],{saveTxn:async()=>{wrote=true}});for(const [id,value] of [['ais-desc','Side job'],['ais-amount','250.50'],['ais-frequency','weekly'],['ais-payday','2026-02-31']])c.document.getElementById(id).value=value;await c.saveIncomeSource();assert.equal(wrote,false);assert.equal(c._messages.length,1);});
  await test('out-of-range statement amounts are caught during parsing',()=>{const c=make(['fpParseStatement','parseCsvText','findColumn','fpImportAmount','parseImportDate','categorizeImportedRow']);const r=c.fpParseStatement('Date,Description,Amount\n2026-10-09,Unusable,-1000000000000\n2026-10-10,Coffee,-6.50\n','bank');assert.equal(r.rows.length,1);assert.equal(r.rows[0].amount,6.5);assert.equal(r.unreadable,1);});

  await test('quick entry date moves month while preserving amounts and description',()=>{const c=make(['bsChangeDate'],{currentYear:2026,currentMonth:9,bsSelectedDay:8,renderBottomSheetBody(){}});c.document.getElementById('bs-entry-date').value='2026-11-03';c.document.getElementById('bs-ai-input').value='Rent $1200';c.document.getElementById('bs-cat-amount').value='1200';c.bsChangeDate();assert.equal(c.currentMonth,10);assert.equal(c.bsSelectedDay,3);assert.equal(c._els['bs-ai-input'].value,'Rent $1200');assert.equal(c._els['bs-cat-amount'].value,'1200');});
  await test('invalid entry date restores previous date without moving the schedule',()=>{const c=make(['bsChangeDate'],{currentYear:2026,currentMonth:9,bsSelectedDay:8});c.document.getElementById('bs-entry-date').value='2026-02-31';c.bsChangeDate();assert.equal(c.currentMonth,9);assert.equal(c.bsSelectedDay,8);assert.equal(c._els['bs-entry-date'].value,'2026-10-08');});

  await test('today entry resets a browsed month and starts as a one-time expense',()=>{const c=make(['openBottomSheet'],{currentYear:2025,currentMonth:0,renderBottomSheetBody(){}});c.document.getElementById('bottom-sheet').classList.add=()=>{};c.openBottomSheet(null);const now=new Date();assert.equal(c.currentYear,now.getFullYear());assert.equal(c.currentMonth,now.getMonth());assert.equal(c.bsSelectedDay,now.getDate());assert.equal(c.bsRecurring,false);});
  await test('explicit calendar bill entry retains its date and monthly repeat',()=>{const c=make(['openBottomSheet','openDayPanel'],{currentYear:2025,currentMonth:0,renderBottomSheetBody(){}});c.document.getElementById('bottom-sheet').classList.add=()=>{};c.openDayPanel(15,'bill');assert.equal(c.currentYear,2025);assert.equal(c.currentMonth,0);assert.equal(c.bsSelectedDay,15);assert.equal(c.bsRecurring,true);assert.equal(c.bsEntryKind,'bill');assert.equal(c.bsFrequency,'monthly');});

  for(const [raw,amount,description] of [['Rent $1,200',1200,'Rent'],['7-eleven $6.50',6.5,'7-eleven'],['3M Tape $4',4,'3M Tape'],['Coffee 6',6,'Coffee'],['$ 6 Coffee',6,'Coffee'],['Tea $.50',.5,'Tea'],['1,234.56 Insurance',1234.56,'Insurance']])await test('quick entry reads exact amount and preserves name '+raw,()=>{const c=make(['fpParseQuickExpense']);const p=c.fpParseQuickExpense(raw);assert.equal(p.amount,amount);assert.equal(p.description,description);});
  for(const raw of ['Coffee -$6','Coffee −$6','Coffee $6.555','Coffee $1,20','Coffee $-6','Coffee 10 20','Coffee $6 $7','Coffee 1e3','Coffee $1000000000000','$6','7-eleven'])await test('quick entry rejects ambiguous or invalid amount '+raw,()=>{const c=make(['fpParseQuickExpense']);assert.equal(c.fpParseQuickExpense(raw),null);});
  await test('quick expense saves grouped currency with merchant digits intact',async()=>{let saved;const c=make(['fpParseQuickExpense','bsAiSubmit','fmt'],{currentYear:2026,currentMonth:9,bsSelectedDay:8,bsEntryKind:'expense',bsRecurring:false,bsFrequency:'monthly',saveTxn:async row=>{saved=row;return true},shouldShowRipple:()=>false,renderBottomSheetBody(){}});c.document.getElementById('bs-ai-input').value='7-eleven $1,234.56';await c.bsAiSubmit();assert.equal(saved.amount,1234.56);assert.equal(saved.description,'7-eleven');assert.equal(saved.date,'2026-10-08');});
  await test('invalid quick expense keeps text and performs no save',async()=>{let wrote=false;const c=make(['fpParseQuickExpense','bsAiSubmit'],{saveTxn:async()=>{wrote=true}});c.document.getElementById('bs-ai-input').value='Coffee $6.555';await c.bsAiSubmit();assert.equal(wrote,false);assert.equal(c._els['bs-ai-input'].value,'Coffee $6.555');assert.equal(c._messages.length,1);});
  await test('goal deadline calculates monthly deposits and rounds up cents',()=>{const c=make(['fpGoalProgress','fpGoalSchedule']);const p=c.fpGoalSchedule({target_amount:1000,saved_amount:250.5,monthly_amount:90,target_date:'2027-06-01'},new Date(2026,9,8,12));assert.equal(p.months,8);assert.equal(p.needed,93.69);assert.equal(p.status,'needs_plan');assert.equal(p.firstDate,'2026-11-01');});
  await test('goal deadline uses stable first-of-month deposits and confirmed monthly plan',()=>{const c=make(['fpGoalProgress','fpGoalSchedule']);const p=c.fpGoalSchedule({target_amount:100,saved_amount:0,monthly_amount:100,target_date:'2027-02-28'},new Date(2027,0,31,12));assert.equal(p.months,1);assert.equal(p.status,'on_track');assert.equal(p.firstDate,'2027-02-01');});
  await test('goal deadline does not invent a monthly deposit before a near or past target',()=>{const c=make(['fpGoalProgress','fpGoalSchedule']);const goal={target_amount:100,saved_amount:0,monthly_amount:100,target_date:'2026-10-20'};assert.equal(c.fpGoalSchedule(goal,new Date(2026,9,8,12)).status,'soon');goal.target_date='2026-10-01';assert.equal(c.fpGoalSchedule(goal,new Date(2026,9,8,12)).status,'overdue');goal.saved_amount=100;assert.equal(c.fpGoalSchedule(goal,new Date(2026,9,8,12)).status,'reached');});

  await test('payoff horizon does not call a fifty-year estimate impossible',()=>{const c=make(['payoffTime']);assert.equal(c.payoffTime(600),'50 years');assert.equal(c.payoffTime(999),'over 50 years at this rate');});
  await test('loan rate distinguishes confirmed zero from missing or invalid values',()=>{const c=make(['fpLoanRateKnown']);for(const apr of [null,undefined,'',' ', 'oops',-1])assert.equal(c.fpLoanRateKnown({apr}),false);for(const apr of [0,'0',12.99])assert.equal(c.fpLoanRateKnown({apr}),true);});
  await test('missing rate routes payoff comparison to loan details',()=>{let edited;const c=make(['fpLoanRateKnown','openWhatIf'],{transactions:[{id:'loan',apr:null}],openLoanEdit:id=>edited=id});c.openWhatIf('loan');assert.equal(edited,'loan');assert.equal(c._messages.length,1);});
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
  await test('money formatting retains cents and zero',()=>{const c=make(['fmt']);assert.equal(c.fmt(1234.56),'1,234.56');assert.equal(c.fmt(62.5),'62.50');assert.equal(c.fmt(62.50000000001),'62.50');assert.equal(c.fmt(1.005),'1.01');assert.equal(c.fmt(0),'0')});
  await test('paid-off loan balance never falls back to payment amount',()=>{const c=make([]);assert.equal(c.fpLoanBalanceAmount({balance:0,amount:200}),0);assert.equal(c.fpLoanBalanceAmount({balance:null,amount:200}),200)});
  await test('paycheck matching rejects a large refund or gift',()=>{const c=make([]);for(const description of ['Refund','Gift','Rental income'])assert.equal(c.fpIsPaycheckRecord({description}),false);assert(c.fpIsPaycheckRecord({description:'Pay deposit'}));assert(c.fpIsPaycheckRecord({description:'ACME',category:'paycheck'}));});
  await test('CSV preserves quoted commas, escaped quotes, multiline fields and BOM',()=>{
    const c=make(['parseCsvText']);const r=c.parseCsvText('\uFEFFDate,Description,Amount\r\n2026-10-09,"Coffee, ""daily""\nshop",-3.25\r\n');assert.equal(r.length,2);assert.equal(r[0][0],'Date');assert.equal(r[1][1],'Coffee, "daily"\nshop');
    assert.throws(()=>c.parseCsvText('Date,Description\n2026-10-09,"unfinished'));
  });
  for(const [raw,want] of [['($1,234.56)',-1234.56],['$4.20',4.2],['-20.01',-20.01],['12oops',null],['1,23',null],['1.234',null],['Infinity',null],['',null]]) await test('CSV strict amount '+raw,()=>{const c=make(['fpImportAmount']);assert.equal(c.fpImportAmount(raw),want)});
  for(const mode of ['bank','card','card-negative']) await test('statement signed direction '+mode,()=>{
    const c=make(['fpParseStatement','parseCsvText','findColumn','fpImportAmount','parseImportDate','fpIso','fpPad2','categorizeImportedRow']);const r=c.fpParseStatement('Date,Description,Amount\n2026-10-09,Purchase,-25\n2026-10-10,Deposit,30\n2026-02-31,Bad date,-5\n2026-10-11,Bad amount,2oops\n',mode);
    assert.equal(r.unreadable,2);if(mode==='bank'){assert.equal(r.rows.length,2);assert.equal(r.rows[0].type,'expense');assert.equal(r.rows[1].type,'income')}else{assert.equal(r.rows.length,1);assert.equal(r.rows[0].type,'expense');assert.equal(r.rows[0].amount,mode==='card'?30:25);assert.equal(r.cardCredits,1)}
  });
  await test('statement Debit/Credit columns do not invert income and spending',()=>{
    const c=make(['fpParseStatement','parseCsvText','findColumn','fpImportAmount','parseImportDate','fpIso','fpPad2','categorizeImportedRow']);const r=c.fpParseStatement('Posting Date,Description,Debit Amount,Credit Amount\n10/09/2026,Shop,25,\n10/10/2026,Pay,,100\n10/11/2026,Ambiguous,20,30\n','bank');assert.equal(r.rows.length,2);assert.equal(r.rows[0].type,'expense');assert.equal(r.rows[1].type,'income');assert.equal(r.unreadable,1);
  });
  for(const change of ['account','cancel','newer']) await test('late statement read discarded after '+change,async()=>{
    let resolveRead;const c=make(['handleStatementFiles'],{_pendingImportRows:[],fpParseStatement:()=>({rows:[{}]}),fpClassifyImportRows(){throw Error('stale classified')},renderImportPreview(){throw Error('stale rendered')}});const loading=c.handleStatementFiles([{name:'test.csv',text:()=>new Promise(r=>{resolveRead=r})}]);if(change==='account')c.currentUser={id:'B'};else c._importReadVersion++;resolveRead('Date,Description,Amount');await loading;assert.equal(c._pendingImportRows.length,0);
  });
  await test('failed statement file is reported while readable files still preview',async()=>{
    let renders=0;const c=make(['handleStatementFiles'],{_pendingImportRows:[],fpParseStatement:()=>({rows:[{type:'expense'}],unreadable:0,cardCredits:0}),fpClassifyImportRows(){},renderImportPreview(){renders++}});await c.handleStatementFiles([{name:'bad',text:async()=>{throw Error('unreadable')}},{name:'good',text:async()=> 'CSV'}]);assert.equal(renders,1);assert.equal(c._importMeta.failedFiles,1);assert.equal(c._pendingImportRows.length,1);
  });
  await test('Insights escapes stored description and category without changing data',()=>{
    const payload='<img src=x onerror="window.marker=1">';
    const rows=[{type:'expense',amount:10,description:payload,category:payload},{type:'income',amount:20,description:payload}];const c=make(['renderInsights','fmt','fpEscHtml'],{currentYear:2026,currentMonth:9,fpAmountDue:t=>t.amount,buildDayMap:()=>({1:{expenses:[rows[0]],income:[rows[1]],bills:[],loans:[]}}),transactions:rows});
    c.renderInsights();for(const id of ['insights-expenses','insights-income']){assert(!c._els[id].innerHTML.includes(payload));assert(c._els[id].innerHTML.includes('&lt;img'));}assert.equal(c.transactions[0].description,payload);
  });
  await test('monthly spending split includes calendar loan events and reconciles every outflow',()=>{
    const dm={1:{expenses:[{type:'expense',amount:'1.25',recurring:false},{type:'expense',amount:10,category:'loan_payment'}],bills:[{type:'bill',amount:40,recurring:true}],loans:[{type:'loan',amount:999,min_payment:100}]},2:{expenses:[{type:'expense',amount:2.5,recurring:false}],bills:[],loans:[]}};
    const c=make(['fpMonthlySpendingBreakdown'],{buildDayMap(y,m){assert.equal(y,2026);assert.equal(m,9);return dm}});
    const r=c.fpMonthlySpendingBreakdown(2026,9);assert.equal(r.fixedTotal,150);assert.equal(r.varTotal,3.75);assert.equal(r.total,153.75);
  });
  for(const failure of ['returned','missing']) await test('bill paid '+failure+' confirmation cannot report success',async()=>{
    const c=make(['fpSaveBillMarks'],{sb:{from:()=>({upsert(){return this},select:async()=>failure==='returned'?{error:{message:'offline'}}:{data:[]}})}});
    assert.equal(await c.fpSaveBillMarks([{bill_id:'bill',due_date:'2026-10-03',paid:true,marked_at:'2026-10-08'}]),false);assert.equal(c._fpBillMarkRows.length,0);assert.equal(c._fpBillMarkBusy,false);assert(c._messages[0][0].startsWith('Could not'));
  });
  await test('explicit unpaid mark suppresses stale legacy session paid flag',()=>{
    const c=make(['fpReadPaidMarks','fpReadLocalPaidMarks','fpMergePaidMarks','fpMarksFor'],{fpIso:()=> '2026-10-08',sessionStorage:{getItem:()=>JSON.stringify({bill:true,legacy:true})}});
    c._cache.fp_bill_paid_marks_A=JSON.stringify({bill:null});const marks=c.fpReadPaidMarks();assert(!marks.bill);assert.equal(marks.legacy.length,1);
  });
  await test('bill unmark cannot claim to undo a recorded expense',async()=>{
    const c=make(['toggleBillPaid'],{transactions:[{id:'bill',type:'bill'}],sessionStorage:{getItem:()=>null,setItem(){throw Error('unexpected write')}},fpIso:()=> '2026-10-08',fpAddDays:()=>new Date(2026,8,1),fpPriorityConfig:()=>({OVERDUE_LOOKBACK:45}),fpOccurrences:()=>['2026-10-03'],fpReadPaidMarks:()=>({}),fpBillPaidFor:()=>true,fpMarksFor:()=>[]});
    c._cache.fp_bill_paid_marks_A='{}';assert.equal(await c.toggleBillPaid('bill'),false);assert.equal(c._cache.fp_bill_paid_marks_A,'{}');assert(c._messages[0][0].includes('recorded as an expense'));
  });
  await test('remote unmark overrides stale local and legacy marks',()=>{
    const c=make(['fpMergePaidMarks','fpMarksFor']);const r=c.fpMergePaidMarks({bill:[{due:'2026-10-03',at:'2026-10-08'},{due:'2026-11-03',at:'2026-10-08'}]},[{bill_id:'bill',due_date:'2026-10-03',paid:false,marked_at:'2026-10-09'}]);assert.equal(r.bill.length,1);assert.equal(r.bill[0].due,'2026-11-03');assert.equal(c.fpMergePaidMarks({bill:[{due:null,at:'2026-10-08'}]},[{bill_id:'bill',due_date:'2026-10-03',paid:false}]).bill,undefined);
  });
  await test('confirmed account mark survives blocked local cache',async()=>{
    const row={user_id:'A',bill_id:'bill',due_date:'2026-10-03',paid:true,marked_at:'2026-10-08'};const c=make(['fpSaveBillMarks'],{localStorage:{setItem(){throw Error('full')}},fpReadPaidMarks:()=>({}),sb:{from:()=>({upsert(){return this},select:async()=>({data:[row]})})}});assert.equal(await c.fpSaveBillMarks([row]),true);assert.equal(c._fpBillMarkRows.length,1);assert.equal(c._messages.length,0);
  });
  await test('account switch discards a late paid-mark write confirmation',async()=>{
    let done;const row={user_id:'A',bill_id:'bill',due_date:'2026-10-03',paid:true,marked_at:'2026-10-08'};const c=make(['fpSaveBillMarks'],{sb:{from:()=>({upsert(){return this},select:()=>new Promise(r=>done=r)})}});const saving=c.fpSaveBillMarks([row]);c.currentUser={id:'B'};c._fpBillMarkRows=[];done({data:[row]});assert.equal(await saving,false);assert.equal(c._fpBillMarkRows.length,0);assert.equal(c._messages.length,0);
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
    const c=make(['renderExpensesView','fpExpenseRecordLabel','fpEscHtml','fmt'],{currentYear:2026,currentMonth:9,transactions:[old,weekly,expense],fpRenderSpendingReviewPrompt(){},fpMonthlySpendingBreakdown(y,m){assert.equal(y,2026);assert.equal(m,9);return{fixedTotal:50,varTotal:2,total:52}},catIconSvg:()=>''});
    c.renderExpensesView();assert.equal(c._els['exp-stat-total'].textContent,'-$52');assert.equal(c._els['exp-stat-recurring'].textContent,'-$50');assert.equal(c._els['fv-fixed-total'].textContent,'2 saved records');assert(c._els['fv-fixed-list'].innerHTML.includes('Old payment'));assert(c._els['fv-fixed-list'].innerHTML.includes('2025'));assert(c._els['fv-fixed-list'].innerHTML.includes('Weekly'));assert(!c._els['fv-fixed-list'].innerHTML.includes('/mo'));assert.equal(c.transactions[0],old);
  });
  for (const end of [-50,50]) await test('month-end estimate '+end+' avoids unsupported bank-balance claims',()=>{
    const dm={};for(let d=1;d<=31;d++)dm[d]={income:[],expenses:[],bills:[],loans:[],balance:end};
    const c=make(['updateStats','fmt','fpMoneyMathRows','fpEscHtml'],{currentYear:2026,currentMonth:9,buildDayMap:()=>dm,getStartingBalanceForMonth:()=>end,fpAllocationEnabled:()=>false,renderSpendingRings(){},renderPriorityReport(){},updateBillBadge(){},detectStage(){return null},clearTimeout(){}});
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
    const c=make(['confirmRecordPayment'],{currentYear:2026,currentMonth:9,_rpLoanId:'loan',_rpIncludeMonthly:true,transactions:[{id:'loan',balance:5000,amount:200,apr:12,anchor_date:'2026-10-10'}],fpAtomicMutation:async()=>null});
    c.document.getElementById('rp-input-stage').style.display='block';c.document.getElementById('rp-date').value='2026-10-08';await c.confirmRecordPayment();assert.equal(c._els['rp-input-stage'].style.display,'block');assert.equal(c._els['rp-confirm-btn'].disabled,false);assert.equal(c._messages.length,0);
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
    const rows=[{...expense,include:true}];const c=make(['confirmStatementImport','fpStatementImportRecords'],{_pendingImportRows:rows,fpInsertTransactions:async()=>false,updateImportSummary(){}});c.document.getElementById('import-preview').style.display='block';await c.confirmStatementImport();assert.equal(c._pendingImportRows,rows);assert.equal(c._els['import-preview'].style.display,'block');assert.equal(c._els['import-confirm-btn'].disabled,false);assert.equal(c._messages.length,0);
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
  await test('account reload reads all 1001 transactions using stable pages',async()=>{
    const rows=Array.from({length:1001},(_,i)=>({id:String(i).padStart(5,'0'),date:'2026-10-09'}));let calls=0;
    const c=make(['fpReadTransactions'],{sb:{from(){const q={select(){return q},eq(){return q},order(){return q},range:async(a,b)=>{calls++;return{data:rows.slice(a,b+1),error:null}}};return q;}}});
    const r=await c.fpReadTransactions('A',0);assert.equal(r.data.length,1001);assert.equal(calls,3);
  });
  await test('transaction pagination rejects partial data after page failure',async()=>{
    let calls=0;const c=make(['fpReadTransactions'],{sb:{from(){const q={select(){return q},eq(){return q},order(){return q},range:async()=>++calls===1?{data:Array(500).fill({id:'x'}),error:null}:{data:null,error:{message:'offline'}}};return q;}}});assert.equal((await c.fpReadTransactions('A',0)).error.message,'offline');
  });
  await test('settings response from earlier account visit cannot overwrite a later visit',async()=>{
    let done;const c=make(['saveUserSettings'],{sb:{from(){const q={select(){return q},eq(){return q},single:()=>new Promise(r=>{done=r})};return q;}}});const save=c.saveUserSettings({startingBalance:999});
    assert.equal(await c.saveUserSettings({startingBalance:5}),false);c._fpSettingsVersion++;c.currentUser={id:'A'};done({data:{id:'s'}});assert.equal(await save,false);assert.equal(c.userSettings.startingBalance,100);
  });
  await test('thrown sign-out failure keeps current account and permits retry',async()=>{
    const c=make(['signOut'],{sb:{auth:{signOut:async()=>{throw Error('offline')}}}});await c.signOut();assert.equal(c.currentUser.id,'A');assert.equal(c._fpSignOutBusy,false);assert.equal(c._messages.length,1);
  });
  for(const name of ['saveEditBalance','saveStartingBalance','saveSetup']) await test(name+' rejects blank balance without writing',async()=>{
    let written=false;const c=make([name],{fpApplyDatedBalance:async()=>{written=true}});await c[name]();assert.equal(written,false);assert.equal(c._messages.length,1);
  });
  await test('goal progress caps completion and retains over-target saved amount',()=>{
    const c=make(['fpGoalProgress','fpRound2']);const p=c.fpGoalProgress({target_amount:100,saved_amount:150,monthly_amount:10});assert.equal(p.percent,100);assert.equal(p.remaining,0);assert.equal(p.saved,150);assert.equal(p.months,0);
  });
  await test('goal timeline uses remaining cents and has no estimate without monthly plan',()=>{
    const c=make(['fpGoalProgress','fpRound2']);assert.equal(c.fpGoalProgress({target_amount:1000,saved_amount:250.5,monthly_amount:100}).months,8);assert.equal(c.fpGoalProgress({target_amount:1000,saved_amount:0,monthly_amount:0}).months,null);
  });
  await test('goal stays below 100 percent until the last cent is saved',()=>{
    const c=make(['fpGoalProgress','fpRound2']);assert.equal(c.fpGoalProgress({target_amount:1000,saved_amount:999.99,monthly_amount:0}).percent,99);assert.equal(c.fpGoalProgress({target_amount:1000,saved_amount:1000,monthly_amount:0}).months,0);
  });
  await test('goal months use exact cents at contribution boundaries',()=>{
    const c=make(['fpGoalProgress','fpRound2']);for(let n=1;n<500;n++){const p=c.fpGoalProgress({target_amount:n*7/100,saved_amount:0,monthly_amount:.07});assert.equal(p.months,n);}
  });
  for(const amount of ['0.001','1.234','1e3'])await test('goal rejects invalid currency '+amount,async()=>{
    let wrote=false;const c=make(['fpSaveGoal'],{fpWriteGoal:async()=>{wrote=true},_fpGoalDraftId:'goal'});for(const [id,v] of [['goal-name','Fund'],['goal-target',amount],['goal-saved','0'],['goal-monthly','0']])c.document.getElementById(id).value=v;assert.equal(await c.fpSaveGoal(),false);assert.equal(wrote,false);
  });
  for(const [amount,date] of [['2.345','2026-10-10'],['2junk','2026-10-10'],['2','2026-02-31']])await test('expense rejects invalid amount or date '+amount+' '+date,async()=>{
    let wrote=false;const c=make(['saveExpenseEdit'],{_editExpenseTxnId:'e',fpUpdateTransaction:async()=>{wrote=true}});for(const [id,v] of [['ee-desc','Coffee'],['ee-amount',amount],['ee-date',date]])c.document.getElementById(id).value=v;await c.saveExpenseEdit();assert.equal(wrote,false);assert.equal(c._messages.length,1);
  });
  await test('rejected loan payment edit keeps the entire record unchanged',async()=>{
    let wrote=false;const c=make(['saveExpenseEdit'],{_editExpenseTxnId:'p',transactions:[{id:'p',category:'loan_payment',description:'Car payment',amount:200}],fpUpdateTransaction:async()=>{wrote=true}});for(const [id,v] of [['ee-desc','Car payment'],['ee-amount','201'],['ee-date','2026-10-11']])c.document.getElementById(id).value=v;await c.saveExpenseEdit();assert.equal(wrote,false);assert.equal(c._editExpenseTxnId,'p');
  });
  await test('invalid goal target never reaches storage',async()=>{
    let wrote=false;const c=make(['fpSaveGoal'],{fpWriteGoal:async()=>{wrote=true},_fpGoalDraftId:'goal'});for(const [id,v] of [['goal-name','Fund'],['goal-target','0'],['goal-saved','0'],['goal-monthly','0']])c.document.getElementById(id).value=v;assert.equal(await c.fpSaveGoal(),false);assert.equal(wrote,false);
  });
  await test('CSV export escapes quotes, newlines and formula-like text while preserving numeric amounts',()=>{
    const c=make(['fpTransactionCsv']);const csv=c.fpTransactionCsv([{date:'2026-10-09',type:'expense',description:'=SUM(1,2)',amount:-12.5,category:'A "quote"\nline'}]);assert(csv.includes('"\'=SUM(1,2)"'));assert(csv.includes(',-12.5,'));assert(csv.includes('"A ""quote""\nline"'));
  });
  await test('late goal refresh cannot replace newer saved progress',async()=>{
    let done;const c=make(['fpLoadGoals'],{renderPlan(){},sb:{from(){const q={select(){return q},eq(){return q},order(){return q},range:()=>new Promise(r=>{done=r})};return q;}}});const load=c.fpLoadGoals(false);c._fpGoalVersion++;c._fpGoals=[{id:'saved',saved_amount:100}];done({data:[{id:'saved',saved_amount:0}],error:null});assert.equal(await load,false);assert.equal(c._fpGoals[0].saved_amount,100);
  });
  await test('monthly spending comparison compounds each contribution, including zero and losses',()=>{
    const c=make(['dScenario','dCompound','fpRound2'],{RATE:0.1,_fpDreamMode:'monthly'});let expected=0;const factor=Math.pow(1.1,1/12);for(let month=0;month<120;month++)expected=expected*factor+200;assert.equal(c.dScenario(200,10),Math.round(expected*100)/100);
    c.RATE=0;assert.equal(c.dScenario(12.5,2),300);c.RATE=-1;assert.equal(c.dScenario(200,10),200);c._fpDreamMode='once';assert.equal(c.dScenario(200,10),0);
  });
  await test('priority shortcuts route obligations and balance checks to working editors',()=>{
    const c=make(['fpPriorityShortcut']);assert.equal(c.fpPriorityShortcut('overdue_bill').destination,'bills');assert.equal(c.fpPriorityShortcut('due_loan').destination,'loans');assert.equal(c.fpPriorityShortcut('income_unconfirmed').destination,'balance');assert.equal(c.fpPriorityShortcut('on_track').destination,'plan');assert.equal(c.fpPriorityShortcut('unknown'),null);
  });
  await test('annual category entry preserves the full amount and annual schedule',async()=>{
    let saved;const c=make(['saveItem'],{currentYear:2026,currentMonth:9,selectedDay:10,saveTxn:async row=>{saved=row;return true;},alert(){throw Error('invalid')}});c.document.getElementById('iamt-Insurance').value='1200';c.document.getElementById('ifreq-Insurance').value='yearly';c.document.getElementById('iday-Insurance').value='10';c.document.getElementById('irow-Insurance').querySelector=()=>null;await c.saveItem('Insurance','home','Insurance');assert.equal(saved.amount,1200);assert.equal(saved.frequency,'yearly');assert.equal(saved.anchor_date,'2026-10-10');
  });
  await test('stopping recurrence preserves a one-time bill under Bills',async()=>{
    let update;const c=make(['saveExpenseEdit'],{_editExpenseTxnId:'bill',transactions:[{id:'bill',type:'bill',recurring:true,frequency:'monthly',anchor_date:'2026-10-10'}],fpUpdateTransaction:async(id,row)=>{update=row;return true},renderExpensesView(){}});c.document.getElementById('ee-desc').value='Insurance';c.document.getElementById('ee-amount').value='1200';c.document.getElementById('ee-date').value='2026-10-10';c.document.getElementById('ee-frequency').value='once';await c.saveExpenseEdit();assert.equal(update.recurring,false);assert.equal(update.frequency,null);assert.equal(update.anchor_date,null);assert.equal(update.type,'bill');
  });
  await test('blocked skipped-purchase storage preserves pending choice and reports failure',()=>{
    const pending={description:'Coffee',amount:12.5};const c=make(['rippleSaveInstead','fpRecordSkippedPurchase','fpRound2'],{_ripplePending:pending,fpSavedPurchasesKey:()=> 'choices',fpIso:()=> '2026-10-01',updateSavedCard(){throw Error('must not claim saved')},localStorage:{setItem(){throw Error('full')}}});assert.equal(c.rippleSaveInstead(),false);assert.equal(c._ripplePending,pending);assert.equal(c.savedPurchases.length,0);assert.equal(c._messages[0][1],'error');
  });
  await test('skipped-purchase undo persists empty storage and leaves transactions untouched',()=>{
    const c=make(['fpRecordSkippedPurchase','fpRound2'],{fpSavedPurchasesKey:()=> 'choices',fpIso:()=> '2026-10-01',updateSavedCard(){},fmt:n=>String(n),transactions:[{amount:20}]});assert.equal(c.fpRecordSkippedPurchase('Coffee',12.5),true);assert.equal(c.savedPurchases[0].amount,12.5);const undo=c._messages[0][3];assert.equal(undo(),true);assert.equal(c.savedPurchases.length,0);assert.equal(c._cache.choices,'[]');assert.equal(c.transactions.length,1);
  });
  await test('first-day skipped choice uses local calendar date in negative time zones',()=>{
    const c=make(['getSavedTotal','fpParseIso'],{Date:class extends Date{constructor(...args){super(...(args.length?args:['2026-10-01T12:00:00-04:00']))}},savedPurchases:[{date:'2026-10-01',amount:12.5}]});assert.equal(c.getSavedTotal(),12.5);
  });
  const purchaseFns=['fpPurchaseImpact','fpRound2','fpDaysBetween','fpParseIso','fpOccurrences','fpObligationStart','fpEffectiveAnchorIso','fpIso','fpPad2','getRecurringDates'];
  const purchaseSnap=(timeline,extra={})=>Object.assign({asOf:timeline[0].date,horizonEnd:timeline[timeline.length-1].date,balanceBasis:{status:'ok'},spending:{reliable:true,reserveRate:0},cash:{blockers:[]},buffer:500,timeline},extra);
  await test('purchase check finds a pre-payday shortfall even when the month ends positive',()=>{
    const c=make(purchaseFns),snap=purchaseSnap([{date:'2026-10-08',balance:400},{date:'2026-10-10',balance:100},{date:'2026-10-16',balance:2100},{date:'2026-10-31',balance:1800}]);
    const a=c.fpPurchaseImpact(snap,150,false);assert.equal(a.status,'shortfall');assert.equal(a.after.amount,-50);assert.equal(a.firstNegative.date,'2026-10-10');assert.equal(a.before.amount,100);
    const later=c.fpPurchaseImpact(snap,150,false,'2026-10-16');assert.equal(later.after.amount,100);assert.equal(later.firstNegative,null);assert.equal(later.status,'tight');
  });
  await test('waiting until payday cannot hide a shortfall that already exists',()=>{
    const c=make(purchaseFns),a=c.fpPurchaseImpact(purchaseSnap([{date:'2026-10-08',balance:-20},{date:'2026-10-16',balance:1200}]),100,false,'2026-10-16');assert.equal(a.status,'shortfall');assert.equal(a.firstNegative.date,'2026-10-08');assert.equal(a.before.amount,-20);assert.equal(a.after.amount,-20);
  });
  await test('purchase impact reserves everyday spending cumulatively and preserves cents',()=>{
    const c=make(purchaseFns),a=c.fpPurchaseImpact(purchaseSnap([{date:'2026-10-08',balance:1000},{date:'2026-10-18',balance:1000}],{spending:{reliable:true,reserveRate:12.5}}),12.75,false);assert.equal(a.before.amount,875);assert.equal(a.after.amount,862.25);assert.equal(a.total,12.75);assert.equal(a.includesSpending,true);
  });
  await test('monthly purchase dates clamp month ends without drifting the original day',()=>{
    const c=make(purchaseFns),a=c.fpPurchaseImpact(purchaseSnap([{date:'2027-01-31',balance:1000},{date:'2027-02-27',balance:1000},{date:'2027-02-28',balance:1000},{date:'2027-03-30',balance:1000},{date:'2027-03-31',balance:1000}]),100,true);assert.equal(a.charges,3);assert.equal(a.total,300);assert.equal(a.series[1].after,900);assert.equal(a.series[2].after,800);assert.equal(a.series[3].after,800);assert.equal(a.series[4].after,700);
  });
  await test('stale or undated balances cannot produce purchase reassurance',()=>{
    const c=make(purchaseFns);for(const status of ['unknown','stale']){const a=c.fpPurchaseImpact(purchaseSnap([{date:'2026-10-08',balance:5000}],{balanceBasis:{status}}),100,false);assert.equal(a.status,'needs_balance');assert.equal(a.after,undefined);}
  });
  await test('missing spending, uncertain income and missing loan payments retain incomplete status',()=>{
    const c=make(purchaseFns);for(const patch of [{spending:{reliable:false,reserveRate:null}},{cash:{blockers:['income_inclusion_unknown']}},{cash:{blockers:['loan_data_missing']}}]){const a=c.fpPurchaseImpact(purchaseSnap([{date:'2026-10-08',balance:5000}],patch),100,false);assert.equal(a.status,'incomplete');assert.ok(a.blockers.length);}
  });
  await test('truncated purchase timeline cannot claim a complete horizon',()=>{
    const c=make(purchaseFns),a=c.fpPurchaseImpact(purchaseSnap([{date:'2026-10-08',balance:5000}],{horizonEnd:'2026-10-31'}),100,false);assert.equal(a.status,'unavailable');
  });
  await test('purchase comparisons are read-only and reject invalid amounts and dates',()=>{
    const c=make(purchaseFns),snap=purchaseSnap([{date:'2026-10-08',balance:5000},{date:'2026-10-31',balance:5000}]),saved=JSON.stringify(snap);for(const n of [0,-1,NaN,Infinity])assert.equal(c.fpPurchaseImpact(snap,n,false).status,'invalid');assert.equal(c.fpPurchaseImpact(snap,100,false,'2026-09-01').status,'invalid_date');c.fpPurchaseImpact(snap,100,true);assert.equal(JSON.stringify(snap),saved);assert.equal(c.transactions.length,0);assert.equal(c._fpGoals.length,0);assert.equal(Object.keys(c._cache).length,0);
  });
  await test('purchase snapshot cache refreshes after account, balance, data or paid-status changes',()=>{
    let calls=0;const c=make(['fpPurchaseSnapshot'],{_fpPurchaseSnapshotCache:null,fpIso:()=> '2026-10-08',fpReadPaidMarks:()=>({}),fpPrioritySnapshot:()=>({n:++calls})});assert.equal(c.fpPurchaseSnapshot().n,1);assert.equal(c.fpPurchaseSnapshot().n,1);c.monthBalances={};assert.equal(c.fpPurchaseSnapshot().n,2);c.transactions=[];assert.equal(c.fpPurchaseSnapshot().n,3);c._fpBillMarkRows=[];assert.equal(c.fpPurchaseSnapshot().n,4);c._dataLoadVersion++;assert.equal(c.fpPurchaseSnapshot().n,5);c.currentUser={id:'B'};assert.equal(c.fpPurchaseSnapshot().n,6);c._fpMutationVersion++;c._fpMutationBusy=true;assert.equal(c.fpPurchaseSnapshot().n,7);c.transactions.push({amount:100});c._fpMutationBusy=false;assert.equal(c.fpPurchaseSnapshot().n,8);assert.equal(c.fpPurchaseSnapshot().n,8);
  });

  await test('loan payment defaults ignore extra-only and similarly named loan payments',()=>{
    const loan={id:'A',description:'Car',amount:200};const c=make(['fpLoanMonthPayments'],{transactions:[{type:'expense',category:'loan_payment',description:'Car 2 payment',loan_id:'B',amount:200,date:'2026-10-08'},{type:'expense',category:'loan_payment',description:'Car extra payment',loan_id:'A',amount:50,date:'2026-10-08'}]});let r=c.fpLoanMonthPayments(loan,'2026-10-08');assert.equal(r.total,50);assert.equal(r.regular,0);assert.equal(r.complete,false);c.transactions.push({type:'expense',category:'loan_payment',description:'Old name payment',loan_id:'A',amount:200,date:'2026-10-08'});r=c.fpLoanMonthPayments(loan,'2026-10-08');assert.equal(r.regular,200);assert.equal(r.complete,true);assert.equal(c.fpLoanMonthPayments(loan,'2026-09-08').complete,false);
  });
  await test('legacy payment matching is exact and partial regular payment is not complete',()=>{
    const loan={id:'A',description:'Car',amount:200};const c=make(['fpLoanMonthPayments'],{transactions:[{type:'expense',category:'loan_payment',description:'Car 2 payment',amount:200,date:'2026-10-08'},{type:'expense',category:'loan_payment',description:'Car payment',amount:50,date:'2026-10-08'}]});const r=c.fpLoanMonthPayments(loan,'2026-10-08');assert.equal(r.total,50);assert.equal(r.complete,false);
  });
  await test('recorded loan payment uses the explicit date instead of the viewed calendar month',async()=>{
    let payload;const c=make(['confirmRecordPayment'],{currentYear:2025,currentMonth:0,_rpLoanId:'loan',_rpIncludeMonthly:true,transactions:[{id:'loan',balance:5000,amount:200,apr:12,anchor_date:'2026-10-10'}],fpAtomicMutation:async(k,p)=>{payload=p;return null;}});c.document.getElementById('rp-date').value='2026-10-08';await c.confirmRecordPayment();assert.equal(payload.date,'2026-10-08');
  });
  await test('invalid calendar payment dates cannot save a financial record',async()=>{
    let calls=0;const c=make(['confirmRecordPayment'],{_rpLoanId:'loan',_rpIncludeMonthly:true,transactions:[{id:'loan',balance:5000,amount:200}],fpAtomicMutation:async()=>{calls++;}});for(const date of ['', '2026-02-31']){c.document.getElementById('rp-date').value=date;await c.confirmRecordPayment();}assert.equal(calls,0);assert.equal(c._messages.length,2);
  });
  await test('pending payment retry retains the original date even if the field changes',async()=>{
    let payload;const c=make(['confirmRecordPayment'],{_rpLoanId:'loan',_rpIncludeMonthly:true,transactions:[{id:'loan',balance:5000,amount:200}],fpPendingOperation:()=>({payload:{date:'2026-10-07'}}),fpAtomicMutation:async(k,p)=>{payload=p;return null;}});c.document.getElementById('rp-date').value='2026-10-08';await c.confirmRecordPayment();assert.equal(payload.date,'2026-10-07');assert.equal(c._els['rp-date'].disabled,true);
  });

  const importCorrectionFns=['fpImportCorrection','fpImportCategories','fpImportAmount'];
  const importDraft={description:'  Bank description  ',date:'2026-10-09',amount:'$1,200.01',type:'expense',category:'home'};
  await test('statement correction keeps exact cents and a local date without saving',()=>{const c=make(importCorrectionFns),r=c.fpImportCorrection(importDraft);assert.equal(r.row.amount,1200.01);assert.equal(r.row.description,'Bank description');assert.equal(r.row.date,'2026-10-09');assert.equal(r.row.category,'home');assert.equal(c.transactions.length,0);});
  await test('statement correction rejects invalid amounts, dates and descriptions',()=>{const c=make(importCorrectionFns);for(const change of [{amount:''},{amount:'0'},{amount:'-10'},{amount:'1.001'},{amount:'1,23'},{amount:'1000000000000'},{date:'2026-02-31'},{date:''},{date:'2026-2-1'},{description:'  '},{category:'loan_payment'},{type:'bill'}])assert(c.fpImportCorrection({...importDraft,...change}).error,JSON.stringify(change));});
  await test('statement income correction clears the expense category',()=>{const c=make(importCorrectionFns),r=c.fpImportCorrection({...importDraft,type:'income',category:'food'});assert.equal(r.row.category,null);assert.equal(r.row.type,'income');});
  const correctFns=['fpCorrectImportRows','fpClassifyImportRows','fpImportKey','fpImportDesc'];
  const importRow=(d,fileIdx=0)=>({type:'expense',description:d,date:'2026-10-09',amount:10,category:'other',fileIdx});
  await test('correction to a saved transaction skips the duplicate and preserves unrelated selection',()=>{const c=make(correctFns),rows=[importRow('New'),importRow('Unselected')],existing=[importRow('Saved')];c.fpClassifyImportRows(rows,existing);rows[1].include=false;c.fpCorrectImportRows(rows,0,{description:'Saved'},existing);assert.equal(rows[0].dupKind,'existing');assert.equal(rows[0].include,false);assert.equal(rows[1].include,false);});
  await test('correction away from a duplicate includes the new transaction',()=>{const c=make(correctFns),rows=[importRow('Saved')],existing=[importRow('Saved')];c.fpClassifyImportRows(rows,existing);c.fpCorrectImportRows(rows,0,{amount:10.01},existing);assert.equal(rows[0].dupKind,null);assert.equal(rows[0].include,true);});
  await test('cross-file duplicate status refreshes while identical same-file purchases remain separate',()=>{const c=make(correctFns),rows=[importRow('Twin'),importRow('Twin'),importRow('Twin',1)];c.fpClassifyImportRows(rows,[]);c.fpCorrectImportRows(rows,0,{description:'Changed'},[]);assert.equal(rows[1].include,true);assert.equal(rows[2].dupKind,'file');c.fpCorrectImportRows(rows,1,{description:'Changed'},[]);assert.equal(rows[2].dupKind,null);assert.equal(rows[2].include,true);});
  await test('category correction retains an intentionally selected duplicate',()=>{const c=make(correctFns),rows=[importRow('Saved')],existing=[importRow('Saved')];c.fpClassifyImportRows(rows,existing);rows[0].include=true;c.fpCorrectImportRows(rows,0,{category:'food'},existing);assert.equal(rows[0].dupKind,'existing');assert.equal(rows[0].include,true);});
  await test('pending or active statement save blocks corrections',()=>{const c=make(['fpImportLocked']);assert.equal(c.fpImportLocked(),false);c._importSaving=true;assert.equal(c.fpImportLocked(),true);c._importSaving=false;c.fpPendingOperation=()=>({kind:'insert'});assert.equal(c.fpImportLocked(),true);});
  await test('an open statement correction cannot import the old row',async()=>{let writes=0;const c=make(['confirmStatementImport'],{_importEditIndex:0,_pendingImportRows:[{include:true}],fpInsertTransactions:async()=>{writes++;}});await c.confirmStatementImport();assert.equal(writes,0);});

  const storyFns=['fpHistoryMonth','fpStoredMonthBalance','fpRound2'];
  const storyContext={getStartingBalanceForMonth:()=>1000,fpAmountDue:t=>Number(t.min_payment??t.amount)||0,buildDayMap:()=>({1:{income:[{amount:100}],expenses:[{amount:10}],bills:[{amount:20}],loans:[{amount:999,min_payment:5}],balance:1065},31:{income:[],expenses:[],bills:[],loans:[],balance:1500}})};
  await test('story calendar totals include recurring payments and never treat a balance correction as income',()=>{const c=make(storyFns,storyContext),p=c.fpHistoryMonth(2026,9,new Date(2026,9,8));assert.equal(p.calendarIn,100);assert.equal(p.calendarOut,35);assert.equal(p.calendarNet,65);assert.equal(p.endBal,1500);assert.equal(p.recordedIn,0);assert.equal(p.recordedNet,0);});
  await test('story past totals use one-time income and expenses instead of recurring schedules or loan balances',()=>{const rows=[{type:'income',amount:200,date:'2026-09-10'},{type:'expense',amount:50,date:'2026-09-12',category:'food'},{type:'income',amount:1000,date:'2026-09-01',recurring:true},{type:'bill',amount:100,date:'2026-09-15',recurring:true},{type:'loan',amount:5000,date:'2026-09-02'}];const c=make(storyFns,{...storyContext,transactions:rows}),p=c.fpHistoryMonth(2026,8,new Date(2026,9,8));assert.equal(p.recordedIn,200);assert.equal(p.recordedOut,50);assert.equal(p.recordedNet,150);assert.equal(p.topCat[0],'food');assert(p.hasRecords);assert(p.hasHistory);});
  await test('story recorded totals exclude future dates and retain cents',()=>{const c=make(storyFns,{...storyContext,transactions:[{type:'expense',amount:1.01,date:'2026-10-08'},{type:'income',amount:5.02,date:'2026-10-07'},{type:'expense',amount:100,date:'2026-10-09'},{type:'income',amount:200,date:'2026-11-01'}]}),p=c.fpHistoryMonth(2026,9,new Date(2026,9,8));assert.equal(p.recordedIn,5.02);assert.equal(p.recordedOut,1.01);assert.equal(p.recordedNet,4.01);});
  await test('story balance-only history has no invented recorded earnings',()=>{const c=make(storyFns,{...storyContext,monthBalances:{'2026-09':0,__dated_balance:{amount:500,asOf:'2026-10-08'}}}),p=c.fpHistoryMonth(2026,8,new Date(2026,9,8));assert(p.hasHistory);assert.equal(p.hasRecords,false);assert.equal(p.recordedNet,0);assert.equal(c.fpHistoryMonth(2026,9,new Date(2026,9,8)).hasHistory,true);assert.equal(c.fpHistoryMonth(2026,7,new Date(2026,9,8)).hasHistory,false);});

  for(const raw of ['1.234','1e3','NaN','Infinity','1000000000000','--2',''])await test('balance rejects malformed currency '+raw,()=>{assert.equal(make([]).fpParseBalance(raw),null);});
  await test('balance preserves exact cents, zero and overdrafts',()=>{const c=make([]);assert.equal(c.fpParseBalance('-$1,200.01'),-1200.01);assert.equal(c.fpParseBalance('0'),0);assert.equal(c.fpParseBalance('5.02'),5.02);});
  await test('credit card estimate supports zero APR and never exceeds debt plus interest',()=>{const c=make([]);assert.equal(c.fpCreditCardPaymentEstimate(5,0),5);assert.equal(c.fpCreditCardPaymentEstimate(1000,0),25);assert.equal(c.fpCreditCardPaymentEstimate(5000,24),150);});
  for(const [field,value]of [['lm-balance','100.001'],['lm-balance','1e3'],['lm-payment','0'],['lm-payment','-5'],['lm-payment','2.345'],['lm-apr','12junk'],['lm-anchor','2026-02-31']])await test('loan draft rejects '+field+' '+value,async()=>{let writes=0;const c=make(['saveLoanFromModal'],{saveTxn:async()=>{writes++;return true;},closeLoanModal(){}});for(const [id,v]of Object.entries({'lm-desc':'Test debt','lm-balance':'500','lm-apr':'12','lm-payment':'25','lm-cat':'Credit Card','lm-anchor':'2026-10-10'}))c.document.getElementById(id).value=v;c.document.getElementById(field).value=value;await c.saveLoanFromModal();assert.equal(writes,0);assert.equal(c._messages.length,1);});
  for(const [raw,expected]of [['',null],['0',0]])await test('loan save retains APR '+JSON.stringify(raw),async()=>{let payload;const c=make(['saveLoanFromModal'],{saveTxn:async p=>{payload=p;return true;},closeLoanModal(){}});for(const [id,v]of Object.entries({'lm-desc':'Test debt','lm-balance':'500','lm-apr':raw,'lm-payment':'25','lm-cat':'Credit Card','lm-anchor':'2026-10-10'}))c.document.getElementById(id).value=v;await c.saveLoanFromModal();assert.equal(payload.apr,expected);assert.equal(payload.original_min_payment,25);});
  await test('unknown APR cannot silently record a zero-interest payment',async()=>{let writes=0;const c=make(['confirmRecordPayment'],{_rpLoanId:'loan',_rpIncludeMonthly:true,transactions:[{id:'loan',balance:500,amount:25,apr:null}],fpAtomicMutation:async()=>{writes++;}});c.document.getElementById('rp-date').value='2026-10-10';await c.confirmRecordPayment();assert.equal(writes,0);assert.match(c._messages[0][0],/interest rate/);});
  await test('payment extra rejects fractional cents before mutation',async()=>{let writes=0;const c=make(['confirmRecordPayment'],{_rpLoanId:'loan',_rpIncludeMonthly:true,transactions:[{id:'loan',balance:500,amount:25,apr:0}],fpAtomicMutation:async()=>{writes++;}});c.document.getElementById('rp-date').value='2026-10-10';c.document.getElementById('rp-extra').value='1.234';await c.confirmRecordPayment();assert.equal(writes,0);});
  await test('expense delete cancellation restores editor markup once',()=>{const c=make([]);c.window._eeOriginalContent='<input id="ee-desc">';c.document.querySelector().innerHTML='delete confirmation';c.fpRestoreExpenseEditor();assert.equal(c._els.modal.innerHTML,'<input id="ee-desc">');assert.equal(c.window._eeOriginalContent,null);c.fpRestoreExpenseEditor();assert.equal(c._els.modal.innerHTML,'<input id="ee-desc">');});
  await test('cancel deletion keeps the typed expense draft',()=>{const c=make([]);c.window._eeOriginalContent='<input>';c.window._eeOriginalDraft={'ee-desc':'Edited shopping','ee-amount':'199.99'};c.fpRestoreExpenseEditor();assert.equal(c._els['ee-desc'].value,'Edited shopping');assert.equal(c._els['ee-amount'].value,'199.99');assert.equal(c.window._eeOriginalDraft,null);});
  await test('future expense is labeled scheduled rather than recorded spending',()=>{const c=make(['fpExpenseRecordLabel']);assert(c.fpExpenseRecordLabel({date:'2999-01-01'}).startsWith('Scheduled'));});

  for(const date of ['2026-10-18','2026-02-31'])await test('loan schedule correction validates '+date,async()=>{let saved;const c=make(['saveLoanEdit'],{_loanEditId:'loan',transactions:[{id:'loan',type:'loan',balance:500,amount:25,apr:12}],fpUpdateTransaction:async(id,p)=>{saved=p;return true;}});for(const [id,v]of Object.entries({'le-desc':'Debt','le-balance':'500','le-apr':'12','le-payment':'25','le-date':date}))c.document.getElementById(id).value=v;await c.saveLoanEdit();if(date==='2026-10-18'){assert.equal(saved.date,date);assert.equal(saved.anchor_date,date);assert.equal(saved.original_min_payment,25);}else assert.equal(saved,undefined);});
  console.log('TOTAL pass='+pass+' fail='+fail);process.exitCode=fail?1:0;
})();
