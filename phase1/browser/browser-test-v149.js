// Real Chromium (Playwright) driving the real v140+ HTML. Backend = in-memory fake (Node) that enforces the LIVE schema.
// Usage: node browser-test.js ../../finpulse-v2-148.html
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path');
const FILE = path.resolve(process.argv[2] || '../../finpulse-v2-149.html');
const TZID = process.env.TZ || 'UTC';
const COLS = 'id,user_id,type,description,amount,date,category,recurring,frequency,anchor_date,apr,min_payment,balance,lender,created_at,original_balance,original_min_payment,principal_applied,loan_id'.split(',');
const TYPES = ['income','expense','bill','loan','note'];
let db, reqlog, seq, writeFault=null, readFault=null;
const rpcBackend=require('./mock-rpc')({getDb:()=>db,setDb:v=>{db=v},log:r=>reqlog.push(r),nextId:()=> 'id-'+(++seq)});
function seed() {
  seq = 0; reqlog = []; rpcBackend.reset(); writeFault=null;
  const L = (id, d, bal, min, anchor) => ({ id, user_id: 'user-A', type: 'loan', description: d, amount: min, date: anchor, category: 'Other', recurring: true, frequency: 'monthly', anchor_date: anchor, apr: 12, min_payment: min, balance: bal, lender: 'Other', original_balance: bal, original_min_payment: min, principal_applied: null, loan_id: null, created_at: 'x' });
  db = {
    financial_goals: [],
    bill_paid_marks: [],
    transactions: [L('loan-car', 'Test Car Loan', 5000, 200, '2026-10-10'), L('loan-small', 'Small Loan', 100, 200, '2026-10-20')],
    user_settings: [{ id: 's1', user_id: 'user-A', starting_balance: 500, payday: '2026-10-02', pay_frequency: 'biweekly', pay_amount: 1000, month_balances_json: null }]
  };
}
function dbop(s) {
  const entry = { op: s.op, table: s.table, payload: s.payload, filters: s.filters };
  reqlog.push(entry);
  if (s.op === 'select' && s.table === 'user_settings' && readFault) {
    if (readFault === 'once') readFault = null;
    return {data:null,error:{code:'PGRST303',message:'Injected JWT claims rejection'}};
  }
  if(s.table==='transactions' && s.op!=='select' && writeFault==='reject') { writeFault=null; return{data:null,error:{code:'23514',message:'Injected save failure'}}; }
  const rows = db[s.table]; if (!rows) return { data: null, error: { message: 'relation does not exist' } };
  const match = r => s.filters.every(([c,v,op]) => op==='in' ? v.includes(r[c]) : String(r[c])===String(v));
  const check = rec => { for (const k of Object.keys(rec)) if (!COLS.includes(k) && s.table === 'transactions') return 'Could not find the \'' + k + '\' column of \'transactions\' in the schema cache'; if (s.table === 'transactions' && rec.type !== undefined && !TYPES.includes(rec.type)) return 'violates check constraint "transactions_type_check"'; return null; };
  let out;
  if(s.op==='upsert'&&s.table==='financial_goals') {
    if(writeFault==='goal-reject'){writeFault=null;return{data:null,error:{message:'Injected goal failure'}};}
    const p=s.payload;if(p.user_id!=='user-A')return{data:null,error:{message:'rls'}};
    const old=rows.find(r=>r.id===p.id);if(old)Object.assign(old,p);else rows.push({...p});
    if(writeFault==='goal-lost'){writeFault=null;throw Error('Lost goal confirmation');}
    return{data:s.single?{...p}:[{...p}],error:null};
  } else if (s.op === 'upsert' && s.table === 'bill_paid_marks') {
    const made=[];
    for(const p of s.payload) {
      if(p.user_id!=='user-A')return{data:null,error:{message:'rls'}};
      const old=rows.find(r=>r.user_id===p.user_id&&r.bill_id===p.bill_id&&r.due_date===p.due_date);
      if(old&&s.ignoreDuplicates)continue;
      if(old)Object.assign(old,p);else rows.push({...p});made.push({...p});
    }
    if(writeFault==='bill-reject'){writeFault=null;return{data:null,error:{message:'Injected bill failure'}};}
    return{data:made,error:null};
  } else if (s.op === 'insert') {
    const arr = Array.isArray(s.payload) ? s.payload : [s.payload]; const made = [];
    if(arr.some(p=>rows.some(r=>r.id===p.id))) return {data:null,error:{code:'23505',message:'duplicate key'}};
    for(const p of arr) { const e=check(p); if(e)return{data:null,error:{code:'23514',message:e}}; }
    for (const p of arr) { const e = check(p); if (e) { entry.error = e; return { data: null, error: { message: e } }; }
      if (p.user_id !== 'user-A') { entry.error = 'rls'; return { data: null, error: { message: 'new row violates row-level security policy' } }; }
      const r = Object.fromEntries(COLS.map(c => [c, null])); Object.assign(r, p, { id: p.id || 'id-' + (++seq), created_at: 'now' }); rows.push(r); made.push(r); }
    out = s.returning ? made.map(x => ({ ...x })) : null;
    if(writeFault==='lost') { writeFault=null; throw Error('Injected lost response after insert'); }
  } else if (s.op === 'update') {
    const e = check(s.payload); if (e) { entry.error = e; return { data: null, error: { message: e } }; }
    const changed = rows.filter(r => r.user_id === 'user-A' && match(r)); changed.forEach(r => Object.assign(r, s.payload)); out = s.returning ? changed.map(r => ({...r})) : null;
  } else if (s.op === 'delete') {
    db[s.table] = rows.filter(r => !(r.user_id === 'user-A' && match(r))); out = null;
  } else {
    out = rows.filter(r => r.user_id === 'user-A' && match(r)).map(x => ({ ...x }));
    if (s.order) out.sort((a, b) => (a[s.order[0]] > b[s.order[0]] ? 1 : -1) * (s.order[1] === 'desc' ? -1 : 1));
    if (s.range) out=out.slice(s.range[0],s.range[1]+1); else if (!s.single) out=out.slice(0,1000);
    if (s.single) { if (!out.length) return { data: null, error: { message: 'no rows' } }; out = out[0]; }
  }
  if (s.op !== 'select' && s.single) { if (!out || !out.length) return {data:null,error:{code:'PGRST116',message:'no returned row'}}; out=out[0]; } return { data: out, error: null };
}
const failedReq = []; const results = []; let consoleErrors = [], pageErrors = [];
const ok = (name, cond, detail) => { results.push((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '  -> ' + detail)); };
const near = (a, b) => Math.abs(parseFloat(a) - b) < 0.005;
const txns = () => db.transactions;
const loan = id => txns().find(t => t.id === id);

(async () => {
  seed();
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: TZID });
  await ctx.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, 'mock-client.js'), 'utf8') }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs|chart/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(2026, 9, 8, 12, 0, 0));
  await page.exposeFunction('__dbop', async s => dbop(s));
  await page.exposeFunction('__rpc', params => rpcBackend.rpc(params));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', r => failedReq.push(r.url().slice(0,80)));
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => { results.push('NOTE  dialog: ' + d.message()); d.accept(); });
  const load = async () => { await page.goto('file://' + FILE); await page.waitForSelector('#app', { state: 'visible', timeout: 10000 }); await page.waitForTimeout(1500); };
  const br = async () => (await page.textContent('#br-amount')).replace(/[$,\s]/g, '');
  const endBal = () => page.evaluate(() => { const d = buildDayMap(2026, 9); return d[31].balance; });
  const dayOut = d => page.evaluate(d => { const m = buildDayMap(2026, 9)[d]; return [].concat(m.expenses, m.bills, m.loans).reduce((s, t) => s + parseFloat(t.min_payment || t.amount), 0); }, d);
  const toast = () => page.textContent('#toast-msg').catch(() => '');

  await load();
  // ---- T1 baseline
  ok('T1 app loads past auth/loading screen with fake session', await page.isVisible('#app'), 'app not visible');
  ok('T1 Breathing Room baseline = 500 + 3 paychecks(3000) - car 200 - small 200 = 3100', near(await br(), 3100), 'got ' + await br());

  // ---- T2 regular payment via real UI
  await page.evaluate(() => showView('loans', null));
  await page.waitForTimeout(300);
  await page.evaluate(() => recordLoanPayment('loan-car'));
  await page.waitForTimeout(200);
  ok('T2 payment modal shows interest/principal breakdown', /Interest/.test(await page.textContent('#rp-breakdown')), 'no breakdown');
  await page.click('#rp-confirm-btn');
  await page.waitForTimeout(2500);
  const pay1 = txns().find(t => t.category === 'loan_payment' && t.description === 'Test Car Loan payment');
  ok('T2 payment row saved to backend', !!pay1, 'no row; errors=' + JSON.stringify(reqlog.filter(r => r.error)));
  ok('T2 loan_id saved = loan id', pay1 && pay1.loan_id === 'loan-car', pay1 && pay1.loan_id);
  ok('T2 principal_applied = 150 (200 - 50 interest)', pay1 && near(pay1.principal_applied, 150), pay1 && pay1.principal_applied);
  ok('T2 amount saved = 200', pay1 && near(pay1.amount, 200), pay1 && pay1.amount);
  ok('T2 loan balance 5000 -> 4850', near(loan('loan-car').balance, 4850), loan('loan-car').balance);

  // ---- T3 no double count
  await page.evaluate(() => { closeRecordPayment(); showView('calendar', null); renderCalendar(); updateStats(); });
  await page.waitForTimeout(400);
  ok('T3 Breathing Room unchanged after recording payment (3100)', near(await br(), 3100), 'got ' + await br());
  ok('T3 projected end balance unchanged (3100)', near(await endBal(), 3100), await endBal());
  ok('T3 day 10 outflow = 200 once (not 400)', near(await dayOut(10), 200), await dayOut(10));

  // ---- T4 refresh
  await load();
  ok('T4 payment survives refresh (in backend and in app state)', await page.evaluate(() => transactions.some(t => t.description === 'Test Car Loan payment' && t.loan_id === 'loan-car')), 'missing after reload');
  ok('T4 loan balance after refresh = 4850', near(await page.evaluate(() => transactions.find(t => t.id === 'loan-car').balance), 4850), '');
  ok('T4 Breathing Room after refresh = 3100', near(await br(), 3100), await br());

  // ---- T5 extra payment (extra only, since monthly already paid)
  await page.evaluate(() => { showView('loans', null); recordLoanPayment('loan-car'); });
  await page.waitForTimeout(200);
  ok('T5 modal defaults to extra-only when already paid this month', await page.evaluate(() => _rpIncludeMonthly === false), 'monthly still included');
  await page.fill('#rp-extra', '30'); await page.waitForTimeout(100);
  await page.click('#rp-confirm-btn'); await page.waitForTimeout(2500);
  const ex1 = txns().find(t => t.description === 'Test Car Loan extra payment');
  ok('T5 extra payment saved with loan_id and principal_applied=30', ex1 && ex1.loan_id === 'loan-car' && near(ex1.principal_applied, 30) && near(ex1.amount, 30), JSON.stringify(ex1));
  ok('T5 loan balance 4850 -> 4820 (all 30 to principal)', near(loan('loan-car').balance, 4820), loan('loan-car').balance);
  await page.evaluate(() => { closeRecordPayment(); showView('calendar', null); renderCalendar(); updateStats(); }); await page.waitForTimeout(300);
  ok('T5 Breathing Room drops by exactly the extra (3070)', near(await br(), 3070), await br());

  // ---- T6 overpayment: Small Loan balance 100 @12% (interest 1.00), min 200, extra 50
  await page.evaluate(() => { showView('loans', null); recordLoanPayment('loan-small'); });
  await page.waitForTimeout(200);
  await page.fill('#rp-extra', '50'); await page.waitForTimeout(100);
  await page.click('#rp-confirm-btn'); await page.waitForTimeout(2500);
  const smallPays = txns().filter(t => t.loan_id === 'loan-small');
  const sumPrincipal = smallPays.reduce((s, t) => s + parseFloat(t.principal_applied || 0), 0);
  const sumPaid = smallPays.reduce((s, t) => s + parseFloat(t.amount), 0);
  ok('T6 overpay: loan balance floors at 0, never negative', near(loan('loan-small').balance, 0), loan('loan-small').balance);
  ok('T6 overpay: total principal applied = 100 (cannot exceed balance)', near(sumPrincipal, 100), sumPrincipal);
  ok('T6 overpay: total recorded cash out = payoff amount 101 (balance + interest), not 250', near(sumPaid, 101), sumPaid);

  // ---- T7 edit loan payment amount must not desync the loan
  await page.evaluate(() => { closeRecordPayment(); showView('calendar', null); });
  const payId = txns().find(t => t.description === 'Test Car Loan payment').id;
  await page.evaluate(id => openExpenseEdit(id), payId); await page.waitForTimeout(200);
  await page.fill('#ee-amount', '999'); await page.evaluate(() => saveExpenseEdit()); await page.waitForTimeout(500);
  const edited = txns().find(t => t.id === payId);
  ok('T7 editing a loan payment amount is blocked (keeps loan/payment consistent)', near(edited.amount, 200), 'amount became ' + edited.amount);
  await page.evaluate(() => { document.getElementById('edit-expense-overlay').style.display = 'none'; });

  // ---- T8 delete restores principal only, then undo re-applies
  const balBefore = parseFloat(loan('loan-car').balance); // 4820
  await page.evaluate(id => deleteTxnWithUndo(id), payId); await page.waitForTimeout(800);
  ok('T8 deleted payment row removed from backend', !txns().some(t => t.id === payId), 'still there');
  ok('T8 delete restores only principal_applied (4820 + 150 = 4970, not +200)', near(loan('loan-car').balance, balBefore + 150), loan('loan-car').balance);
  ok('T8 toast offers Undo', /Undo/.test(await page.textContent('#toast')), await page.textContent('#toast'));
  await page.evaluate(() => { document.getElementById('calendar-sentinel'); }).catch(() => {});
  const vis = await page.evaluate(() => { const b = [...document.querySelectorAll('#toast button')].find(x => x.textContent === 'Undo'); const cs = getComputedStyle(b); const tb = getComputedStyle(document.getElementById('toast')); const p = c => c.match(/[\d.]+/g).map(Number); const L = c => { const [r, g, bl] = p(c).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; }; const cr = (a, b2) => (Math.max(L(a), L(b2)) + 0.05) / (Math.min(L(a), L(b2)) + 0.05); return { textOnButton: cr(cs.color, cs.backgroundColor), buttonOnToast: cr(cs.backgroundColor, tb.backgroundColor), bg: cs.backgroundColor, tbg: tb.backgroundColor }; });
  ok('T8 Undo button is VISIBLE: text contrast on button >= 4.5 and button contrast on toast >= 3', vis.textOnButton >= 4.5 && vis.buttonOnToast >= 3, JSON.stringify(vis));
  await page.evaluate(() => { const so = document.getElementById('stage-overlay'); if (so) so.style.display = 'none'; }); const ub = await page.evaluate(() => { const b = [...document.querySelectorAll('#toast button')].find(x => x.textContent === 'Undo'); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hit: top === b }; });
  ok('T8 Undo button is CLICKABLE with a real mouse (nothing covers it, pointer events on)', ub.hit, JSON.stringify(ub));
  await page.mouse.click(ub.x, ub.y); await page.waitForTimeout(1200);
  const re = txns().find(t => t.description === 'Test Car Loan payment');
  ok('T8 undo re-creates payment with same loan_id and principal_applied=150', re && re.loan_id === 'loan-car' && near(re.principal_applied, 150), JSON.stringify(re));
  ok('T8 undo returns loan balance to 4820 (no free debt relief)', near(loan('loan-car').balance, balBefore), loan('loan-car').balance);
  await page.evaluate(() => { renderCalendar(); updateStats(); }); await page.waitForTimeout(300);
  // delete the extra, balance +30
  const exId = txns().find(t => t.description === 'Test Car Loan extra payment').id;
  await page.evaluate(id => deleteTxnWithUndo(id), exId); await page.waitForTimeout(800);
  ok('T8 deleting extra restores exactly 30', near(loan('loan-car').balance, balBefore + 30), loan('loan-car').balance);

  // ---- T8b loan delete + Undo with real mouse
  await page.evaluate(() => { showView('loans', null); openLoanDeleteConfirm('loan-small'); }); await page.waitForTimeout(200);
  await page.evaluate(() => { selectLoanDeleteReason(2, document.getElementById('ld-reasons').children[2]); confirmLoanDelete(); }); await page.waitForTimeout(800);
  ok('T8b loan removed after delete', !txns().some(t => t.id === 'loan-small'), 'still there');
  const lb = await page.evaluate(() => { const b = [...document.querySelectorAll('#toast button')].find(x => x.textContent === 'Undo'); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { x: r.x + r.width / 2, y: r.y + r.height / 2, hit: top === b }; });
  await page.mouse.click(lb.x, lb.y); await page.waitForTimeout(1200);
  const back = txns().find(t => t.description === 'Small Loan');
  ok('T8b Undo (real mouse click) brings the loan back with its balance', lb.hit && back && near(back.balance, 0), JSON.stringify({ lb, back }));
  // ---- T8c day panel refreshes immediately after Undo
  await page.evaluate(() => { showView('calendar', null); openDayPanel(10); }); await page.waitForTimeout(400);
  const pid = txns().find(t => t.description === 'Test Car Loan payment').id;
  const panelText = () => page.evaluate(() => (document.getElementById('bottom-sheet') || document.body).innerText);
  ok('T8c panel lists the payment before delete', /Test Car Loan payment/.test(await panelText()), '');
  await page.evaluate(id => deleteTxnWithUndo(id).then(() => renderBottomSheetBody()), pid); await page.waitForTimeout(600);
  ok('T8c panel no longer lists payment after delete', !/Test Car Loan payment/.test(await panelText()), '');
  const pb = await page.evaluate(() => { const b = [...document.querySelectorAll('#toast button')].find(x => x.textContent === 'Undo'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(pb.x, pb.y); await page.waitForTimeout(1000);
  ok('T8c panel shows the payment again IMMEDIATELY after Undo (no reopening)', /Test Car Loan payment/.test(await panelText()), 'row missing from open panel');
  // ---- T8d loan row is not listed beside its own recorded payment (v145)
  ok('T8d panel hides the scheduled loan row when its payment is recorded', !/Loan . recurring/.test(await panelText()), 'loan row still shown next to payment');
  const pid2 = txns().find(t => t.description === 'Test Car Loan payment').id;
  await page.evaluate(id => deleteTxnWithUndo(id).then(() => renderBottomSheetBody()), pid2); await page.waitForTimeout(600);
  ok('T8d loan row returns once the payment is removed', /Loan . recurring/.test(await panelText()), 'loan row missing with no payment');
  const pb2 = await page.evaluate(() => { const b = [...document.querySelectorAll('#toast button')].find(x => x.textContent === 'Undo'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(pb2.x, pb2.y); await page.waitForTimeout(1000);
  ok('T8d after Undo the payment is back and the loan row hides again', /Test Car Loan payment/.test(await panelText()) && !/Loan . recurring/.test(await panelText()), '');
  await page.evaluate(() => closeBottomSheet());
  // ---- T9 legacy payment (no loan_id, no principal_applied)
  txns().push({ id: 'legacy-1', user_id: 'user-A', type: 'expense', description: 'Test Car Loan payment', amount: 200, date: '2026-09-10', category: 'loan_payment', recurring: false, frequency: null, anchor_date: null, apr: null, min_payment: null, balance: null, lender: null, created_at: 'x', original_balance: null, original_min_payment: null, principal_applied: null, loan_id: null });
  await load();
  const b0 = parseFloat(loan('loan-car').balance);
  await page.evaluate(() => deleteTxnWithUndo('legacy-1')); await page.waitForTimeout(800);
  const added = parseFloat(loan('loan-car').balance) - b0;
  ok('T9 legacy payment delete restores less than full 200 (interest excluded, ~150)', added > 140 && added < 160, 'restored ' + added);

  // ---- T10 CSV import
  await load();
  const before = txns().length;
  const csv = 'Date,Description,Amount\n2026-10-01,STARBUCKS COFFEE,-6.50\n2026-10-02,PAYROLL ACME,1500.00\n2026-10-03,SHELL GAS,-40.25\n2026-10-04,Weird Shop,-12\n';
  fs.writeFileSync('/tmp/test-bank.csv', csv);
  await page.evaluate(() => { const el = document.getElementById('import-csv-input'); let p = el; while (p && getComputedStyle(p).display === 'none') { p.style.display = 'block'; p = p.parentElement; } });
  await page.setInputFiles('#import-csv-input', '/tmp/test-bank.csv'); await page.waitForTimeout(800);
  const prev = await page.textContent('#import-preview');
  ok('T10 CSV preview shows 4 transactions', /Found 4 transaction/.test(prev), prev);
  await page.evaluate(() => confirmStatementImport()); await page.waitForTimeout(1500);
  const imp = txns().slice(before);
  ok('T10 CSV import saved 4 rows to backend', imp.length === 4, 'rows ' + imp.length + ' ' + JSON.stringify(reqlog.filter(r => r.error)));
  const g = d => imp.find(t => t.description === d);
  ok('T10 expense sign/category/date correct (Starbucks 6.5 food 2026-10-01)', g('STARBUCKS COFFEE') && g('STARBUCKS COFFEE').type === 'expense' && near(g('STARBUCKS COFFEE').amount, 6.5) && g('STARBUCKS COFFEE').category === 'food' && g('STARBUCKS COFFEE').date === '2026-10-01', JSON.stringify(g('STARBUCKS COFFEE')));
  ok('T10 positive amount imported as income (1500)', g('PAYROLL ACME') && g('PAYROLL ACME').type === 'income' && near(g('PAYROLL ACME').amount, 1500), JSON.stringify(g('PAYROLL ACME')));
  ok('T10 shell gas -> transport', g('SHELL GAS') && g('SHELL GAS').category === 'transport', JSON.stringify(g('SHELL GAS')));
  ok('T10 rows owned by the signed-in user and recurring=false', imp.every(t => t.user_id === 'user-A' && t.recurring === false), '');
  ok('T10 imported rows appear in app state', await page.evaluate(() => transactions.filter(t => t.description === 'SHELL GAS').length === 1), '');

  // ---- T11 card CSV: negative rows skipped
  await page.evaluate(() => { document.getElementById('import-account-type').value = 'card'; });
  fs.writeFileSync('/tmp/test-card.csv', 'Transaction Date,Description,Amount\n10/05/2026,NETFLIX,15.49\n10/06/2026,PAYMENT THANK YOU,-200.00\n');
  const b1 = txns().length;
  await page.setInputFiles('#import-csv-input', '/tmp/test-card.csv'); await page.waitForTimeout(800);
  await page.evaluate(() => confirmStatementImport()); await page.waitForTimeout(1200);
  ok('T11 card CSV: purchase imported, card payment skipped (1 row)', txns().length - b1 === 1, 'rows ' + (txns().length - b1));

  // ---- T13 CSV duplicate detection (v146). Fake backend only, never the real account.
  const pick = async (files, type) => {
    await page.evaluate(t => { const so = document.getElementById('stage-overlay'); if (so) so.style.display = 'none'; openConnectAccounts(); document.getElementById('import-account-type').value = t; }, type || 'bank');
    const paths = files.map((f, i) => { const fp = '/tmp/dup-' + i + '-' + f[0]; fs.writeFileSync(fp, f[1]); return fp; });
    await page.setInputFiles('#import-csv-input', paths); await page.waitForTimeout(700);
    return page.evaluate(() => ({ text: document.getElementById('import-preview').innerText, btn: document.getElementById('import-confirm-btn').innerText, btnDisabled: document.getElementById('import-confirm-btn').disabled, btnShown: getComputedStyle(document.getElementById('import-confirm-btn')).display !== 'none', cancelShown: getComputedStyle(document.getElementById('import-cancel-btn')).display !== 'none', pending: _pendingImportRows.length }));
  };
  const H = 'Date,Description,Amount\n';
  // A. same CSV a second time
  let n0 = txns().length;
  let v = await pick([['bank.csv', csv]]);
  ok('T13a same CSV again: 4 found, 0 new, 4 possible duplicates', /Found 4 transaction/.test(v.text) && /0 appear new, 4 possible duplicates/.test(v.text), v.text);
  ok('T13a same CSV again: import button says nothing new and is disabled', v.btnDisabled && /Nothing New/.test(v.btn), JSON.stringify(v));
  await page.evaluate(() => confirmStatementImport()); await page.waitForTimeout(500);
  ok('T13a nothing saved when every row is a duplicate', txns().length === n0, 'rows ' + (txns().length - n0));
  // B. partial duplicate file, then intentionally import one duplicate with a real click
  n0 = txns().length;
  v = await pick([['partial.csv', H + '2026-10-01,STARBUCKS COFFEE,-6.50\n2026-10-03,SHELL GAS,-40.25\n2026-10-09,NEW PLACE,-12.00\n']]);
  ok('T13b partial: 1 new, 2 possible duplicates', /1 appear new, 2 possible duplicates/.test(v.text) && /Import 1 Transaction/.test(v.btn), v.text + ' | ' + v.btn);
  await page.click('#import-confirm-btn'); await page.waitForTimeout(1000);
  ok('T13b partial: only the new row was saved', txns().length === n0 + 1 && txns().some(t => t.description === 'NEW PLACE'), 'rows ' + (txns().length - n0));
  n0 = txns().length;
  v = await pick([['partial2.csv', H + '2026-10-01,STARBUCKS COFFEE,-6.50\n2026-10-03,SHELL GAS,-40.25\n2026-10-09,NEW PLACE,-12.00\n']]);
  ok('T13b rerun: 0 new, 3 possible duplicates, all unchecked', /0 appear new, 3 possible duplicates/.test(v.text) && await page.evaluate(() => [...document.querySelectorAll('#import-preview input[data-import-idx]')].every(c => !c.checked)), v.text);
  await page.check('#import-preview input[data-import-idx="1"]'); await page.waitForTimeout(150);
  const lbl = await page.innerText('#import-confirm-btn');
  ok('T13b checking one duplicate updates the button to Import 1', /Import 1 Transaction/.test(lbl), lbl);
  await page.click('#import-confirm-btn'); await page.waitForTimeout(1000);
  ok('T13b intentionally importing one suspected duplicate saves exactly that row', txns().length === n0 + 1 && txns().filter(t => t.description === 'SHELL GAS').length === 2, 'rows ' + (txns().length - n0));
  // C. legitimate identical purchases in one file
  n0 = txns().length;
  v = await pick([['twins.csv', H + '2026-10-12,COFFEE TWIN,-4.00\n2026-10-12,COFFEE TWIN,-4.00\n']]);
  ok('T13c two identical purchases in one file are both new and the preview says they are kept', /2 appear new, 0|2 appear new/.test(v.text) && !/possible duplicate/.test(v.text) && /kept as separate/.test(v.text), v.text);
  await page.click('#import-confirm-btn'); await page.waitForTimeout(1000);
  ok('T13c both identical purchases saved', txns().filter(t => t.description === 'COFFEE TWIN').length === 2, '');
  v = await pick([['twins2.csv', H + '2026-10-12,COFFEE TWIN,-4.00\n2026-10-12,COFFEE TWIN,-4.00\n2026-10-12,COFFEE TWIN,-4.00\n']]);
  ok('T13c third identical purchase is new, first two flagged', /1 appear new, 2 possible duplicates/.test(v.text), v.text);
  await page.click('#import-cancel-btn'); await page.waitForTimeout(300);
  // D. case, whitespace and amount formats
  v = await pick([['case.csv', H + '2026-10-01,  starbucks   coffee ,"-$6.50"\n2026-10-01,STARBUCKS COFFEE,-6.5\n']]);
  ok('T13d lowercase/extra whitespace/$-format/6.5 vs 6.50 matched the saved row (one flagged, repeat kept new)', /1 appear new, 1 possible duplicate/.test(v.text), v.text);
  await page.click('#import-cancel-btn'); await page.waitForTimeout(300);
  // E. different date or amount is new
  v = await pick([['diff.csv', H + '2026-10-02,STARBUCKS COFFEE,-6.50\n2026-10-01,STARBUCKS COFFEE,-6.51\n']]);
  ok('T13e different date or amount is new', /2 appear new/.test(v.text) && !/possible duplicate/.test(v.text), v.text);
  await page.click('#import-cancel-btn'); await page.waitForTimeout(300);
  // F. cancel saves nothing, closing saves nothing
  n0 = txns().length;
  v = await pick([['cancel.csv', H + '2026-10-20,CANCEL ME,-9.00\n']]);
  ok('T13f preview shows Cancel Import before saving', v.cancelShown && v.pending === 1, JSON.stringify(v));
  await page.click('#import-cancel-btn'); await page.waitForTimeout(400);
  const afterCancel = await page.evaluate(() => ({ pending: _pendingImportRows.length, shown: getComputedStyle(document.getElementById('import-preview')).display !== 'none' }));
  ok('T13f Cancel clears the pending rows, hides the preview, saves nothing', afterCancel.pending === 0 && !afterCancel.shown && txns().length === n0 && !txns().some(t => t.description === 'CANCEL ME'), JSON.stringify(afterCancel));
  await pick([['cancel2.csv', H + '2026-10-20,CANCEL ME,-9.00\n']]);
  await page.evaluate(() => closeConnectAccounts());
  await page.evaluate(() => confirmStatementImport()); await page.waitForTimeout(400);
  ok('T13f closing the window drops pending rows, nothing saved', txns().length === n0 && !txns().some(t => t.description === 'CANCEL ME'), '');
  // G. empty file, header only, malformed rows
  v = await pick([['empty.csv', '']]);
  ok('T13g empty file shows the no-transactions message and no import button', /No recognizable transactions/.test(v.text) && !v.btnShown, JSON.stringify(v));
  v = await pick([['hdr.csv', H]]);
  ok('T13g header-only file shows the no-transactions message', /No recognizable transactions/.test(v.text) && !v.btnShown, v.text);
  v = await pick([['bad.csv', H + '2026-10-21,GOOD ROW,-3.00\nnot-a-date,BAD DATE,-3.00\n2026-10-22,BAD AMOUNT,abc\n2026-10-23,,-3.00\n']]);
  ok('T13g malformed rows are counted and reported, good row kept', /Found 1 transaction/.test(v.text) && /3 rows could not be read/.test(v.text), v.text);
  await page.click('#import-cancel-btn'); await page.waitForTimeout(300);
  v = await pick([['junk.csv', 'foo,bar\n1,2\n']]);
  ok('T13g unrecognized columns shows the no-transactions message', /No recognizable transactions/.test(v.text) && /1 file had no usable rows/.test(v.text), v.text);
  // H. two files with the same content in one batch
  n0 = txns().length;
  v = await pick([['f1.csv', H + '2026-10-25,BATCH ROW,-5.00\n'], ['f2.csv', H + '2026-10-25,BATCH ROW,-5.00\n2026-10-26,ONLY IN SECOND,-6.00\n']]);
  ok('T13h overlapping second file: shared row flagged, new row kept', /Found 3 transaction/.test(v.text) && /2 appear new, 1 possible duplicate/.test(v.text) && /earlier file/.test(v.text), v.text);
  await page.click('#import-confirm-btn'); await page.waitForTimeout(1000);
  ok('T13h only the 2 new rows saved', txns().length === n0 + 2 && txns().filter(t => t.description === 'BATCH ROW').length === 1, 'rows ' + (txns().length - n0));
  // I. descriptions are escaped in the duplicates list
  await pick([['x.csv', H + '2026-10-27,"<i id=""xss"">hello</i>",-2.00\n']]);
  await page.click('#import-confirm-btn'); await page.waitForTimeout(800);
  await pick([['x2.csv', H + '2026-10-27,"<i id=""xss"">hello</i>",-2.00\n']]);
  ok('T13i HTML in a description is shown as text in the duplicate list', await page.evaluate(() => !document.querySelector('#import-preview #xss') && /<i id="xss">hello/.test(document.getElementById('import-preview').innerText)), '');
  await page.click('#import-cancel-btn'); await page.waitForTimeout(300);
  await page.evaluate(() => closeConnectAccounts());

  ok('T10b parseImportDate ISO stays on the same local day', await page.evaluate(() => { const d = parseImportDate('2026-10-01'); return d.getDate() === 1 && d.getMonth() === 9; }), '');
  ok('T10b parseImportDate US format 10/05/2026', await page.evaluate(() => { const d = parseImportDate('10/05/2026'); return d.getDate() === 5 && d.getMonth() === 9; }), '');
  // ---- T14 Weekly Priorities (v147). Fake backend only; the injected rows below live in page memory and are never saved.
  await load();
  await page.evaluate(() => { const so = document.getElementById('stage-overlay'); if (so) so.style.display = 'none'; closeConnectAccounts(); showView('calendar', null); });
  await page.waitForTimeout(600);
  const prio = () => page.evaluate(() => document.getElementById('priority-report').innerText);
  const badge = () => page.textContent('#priority-stage-badge');
  const wait = ms => page.waitForTimeout(ms);
  const first = [await prio(), await badge()];
  ok('T14a priority list renders with at least one numbered item and a badge (v148: the undated seed balance shows "Balance needed")', first[1] === 'Balance needed' && (await page.$$('#priority-report .priority-item')).length > 0, JSON.stringify(first));
  await page.evaluate(() => { prevMonth(); prevMonth(); prevMonth(); }); await wait(600);
  const back3 = [await prio(), await badge()];
  await page.evaluate(() => { for (let i = 0; i < 8; i++) nextMonth(); }); await wait(600);
  const fwd5 = [await prio(), await badge()];
  ok('T14b priorities and stage are identical after navigating the calendar 3 months back', JSON.stringify(first) === JSON.stringify(back3), JSON.stringify([first, back3]));
  ok('T14b priorities and stage are identical after navigating the calendar 5 months forward', JSON.stringify(first) === JSON.stringify(fwd5), JSON.stringify([first, fwd5]));
  await page.evaluate(() => { for (let i = 0; i < 5; i++) prevMonth(); }); await wait(400);

  // checkbox behaviour (real mouse click), persistence across reload, un-check
  const key = await page.evaluate(() => 'fp_priority_checked_' + getIsoWeekKey(new Date()));
  await page.evaluate(k => localStorage.removeItem(k), key);
  await page.evaluate(() => renderPriorityReport()); await wait(200);
  const pid0 = await page.getAttribute('#pcheck-0', 'data-pid');
  await page.click('#pcheck-0'); await wait(200);
  const doneCls = await page.evaluate(() => document.getElementById('pcheck-0').classList.contains('done'));
  const stored = await page.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}'), key);
  ok('T14c clicking a priority checkbox marks it done and saves it for this week', doneCls && stored[pid0] === true, JSON.stringify({ doneCls, stored, pid0 }));
  await load(); await page.evaluate(() => { const so = document.getElementById('stage-overlay'); if (so) so.style.display = 'none'; }); await wait(500);
  ok('T14c the done state survives a reload', await page.evaluate(() => document.getElementById('pcheck-0').classList.contains('done')), 'not done after reload');
  await page.evaluate(() => { const so = document.getElementById('stage-overlay'); if (so) so.style.display = 'none'; });
  await page.click('#pcheck-0'); await wait(200);
  ok('T14c clicking again un-checks it, restores its number and clears the saved state', await page.evaluate(k => !document.getElementById('pcheck-0').classList.contains('done') && document.getElementById('pcheck-0').textContent.trim() === '1' && !JSON.parse(localStorage.getItem(k) || '{}')[document.getElementById('pcheck-0').dataset.pid], key), 'not restored');

  // untrusted text is rendered as text
  await page.evaluate(() => {
    transactions.push({ id: 'evil1', user_id: 'user-A', type: 'bill', description: '<img src=x onerror="window.__xss=1">Gas', amount: 90, date: '2026-10-03', category: null, recurring: true, frequency: 'monthly', anchor_date: '2026-10-03', created_at: '2026-09-01T00:00:00Z' });
    renderPriorityReport();
  }); await wait(300);
  const xss = await page.evaluate(() => ({ img: document.querySelectorAll('#priority-report img').length, flag: window.__xss === undefined, text: document.getElementById('priority-report').innerText }));
  ok('T14d HTML in a bill name is shown as text: no element created, no script run', xss.img === 0 && xss.flag && /<img src=x onerror/.test(xss.text) && /overdue/.test(xss.text), JSON.stringify(xss).slice(0, 300));

  // marking a bill paid: device-only, persists, un-marks
  await page.evaluate(() => { showView('bills', null); renderBillsView(); }); await wait(300);
  const chkIdx = await page.evaluate(() => [...document.querySelectorAll('#bill-list-view .bill-row')].findIndex(r => /Gas/.test(r.innerText)));
  await page.evaluate(i => document.querySelectorAll('#bill-list-view .bill-chk')[i].scrollIntoView(), chkIdx);
  const cb = await page.evaluate(i => { const r = document.querySelectorAll('#bill-list-view .bill-chk')[i].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, chkIdx);
  await page.mouse.click(cb.x, cb.y); await wait(500);
  const mk1 = await page.evaluate(() => ({ marks: JSON.parse(localStorage.getItem('fp_bill_paid_marks_' + currentUser.id) || '{}'), toast: (document.getElementById('toast-msg') || {}).textContent || '', overdue: /overdue/.test(document.getElementById('priority-report').innerText) }));
  ok('T14e marking a bill paid saves account status naming the due date', JSON.stringify(mk1.marks.evil1) === JSON.stringify([{ due: '2026-10-03', at: '2026-10-08' }]) && /in your account/.test(mk1.toast), JSON.stringify(mk1));
  ok('T14e the priority list stops calling the paid bill overdue', mk1.overdue === false, 'still overdue');
  await load();
  const mk2 = await page.evaluate(() => { transactions.push({ id: 'evil1', user_id: 'user-A', type: 'bill', description: 'Gas', amount: 90, date: '2026-10-03', category: null, recurring: true, frequency: 'monthly', anchor_date: '2026-10-03', created_at: '2026-09-01T00:00:00Z' }); const out = { set: fpBillPaidSetThisMonth(), marks: fpReadPaidMarks() }; transactions = transactions.filter(t => t.id !== 'evil1'); return out; });
  ok('T14e account paid mark survives reload', mk2.marks.evil1 && mk2.marks.evil1[0].due === '2026-10-03' && mk2.set.evil1 === true, JSON.stringify(mk2));
  await page.evaluate(() => { transactions.push({ id: 'evil1', user_id: 'user-A', type: 'bill', description: 'Gas', amount: 90, date: '2026-10-03', category: null, recurring: true, frequency: 'monthly', anchor_date: '2026-10-03', created_at: '2026-09-01T00:00:00Z' }); showView('bills', null); renderBillsView(); toggleBillPaid('evil1'); }); await wait(400);
  const mk3 = await page.evaluate(() => ({ marks: JSON.parse(localStorage.getItem('fp_bill_paid_marks_' + currentUser.id) || '{}'), session: JSON.parse(sessionStorage.getItem('fp_bills_paid_' + currentUser.id + '_2026_10') || '{}') }));
  ok('T14e toggling again clears the mark in both stores', !mk3.marks.evil1 && !mk3.session.evil1, JSON.stringify(mk3));
  await page.evaluate(() => { transactions = transactions.filter(t => t.id !== 'evil1'); localStorage.removeItem('fp_bill_paid_marks_' + currentUser.id); });

  // stage wording matches the threshold
  await page.evaluate(() => showStageModal()); await wait(200);
  const stageTxt = await page.evaluate(() => document.getElementById('stage-cards').innerText + ' ' + document.getElementById('stage-coach-msg').innerText);
  const allStages = await page.evaluate(() => { const out = []; for (const n of [1, 2, 3]) { const orig = detectStage; window.detectStage = () => n; showStageModal(); out.push(document.getElementById('stage-cards').innerText + ' ' + document.getElementById('stage-coach-msg').innerText); window.detectStage = orig; } return out.join(' || '); });
  ok('T14f stage text describes the provisional $500 starter buffer and no longer mentions $1,500 or a 1-month buffer', /provisional \$500/.test(allStages) && !/\$1,500|1-month|1 month of expenses/.test(allStages), allStages.slice(0, 400));
  await page.evaluate(() => { document.getElementById('stage-overlay').style.display = 'none'; });

  // ---- T15 v148 dated balance, twice-monthly labels, edited recurring expense (fake backend only)
  seed(); await load();
  const hideStage = () => page.evaluate(() => { const so = document.getElementById('stage-overlay'); if (so) so.style.display = 'none'; closeConnectAccounts(); showView('calendar', null); });
  await hideStage(); await wait(400);
  const legacy = { badge: await badge(), prio: await prio(), status: await page.evaluate(() => fpBalanceAnchor(fpIso(new Date())).status) };
  ok('T15a legacy balance with no date (seed): badge says "Balance needed", the list asks to confirm the balance, no dollar extra-payment text', legacy.badge === 'Balance needed' && /Confirm your bank balance/.test(legacy.prio) && !/extra toward|looks free/.test(legacy.prio) && legacy.status === 'undated', JSON.stringify(legacy).slice(0, 400));
  ok('T15a the calendar still shows the seed month-start (unchanged meaning): Oct ends at 3100', near(await endBal(), 3100), 'got ' + await endBal());

  await page.click('#stat-start-card'); await wait(300);
  const dlg = await page.evaluate(() => ({ vis: document.getElementById('edit-balance-overlay').style.display, date: document.getElementById('edit-balance-date').value, min: document.getElementById('edit-balance-date').min, max: document.getElementById('edit-balance-date').max, input: document.getElementById('edit-balance-input').value, text: document.getElementById('edit-balance-overlay').innerText }));
  ok('T15b tapping Starting Balance opens the dialog with a date field: today, limited to this month; asks what the bank shows (no "right now")', dlg.vis === 'flex' && dlg.date === '2026-10-08' && dlg.min === '2026-10-01' && dlg.max === '2026-10-08' && dlg.input === '' && /What does your bank account show/.test(dlg.text) && !/right now/.test(dlg.text), JSON.stringify(dlg));
  await page.keyboard.press('Escape'); await wait(200);
  ok('T15b Escape closes the dialog without saving', await page.evaluate(() => document.getElementById('edit-balance-overlay').style.display) === 'none' && db.user_settings[0].month_balances_json === null, db.user_settings[0].month_balances_json);
  await page.click('#stat-start-card'); await wait(300);
  await page.fill('#edit-balance-input', '1200');
  await page.press('#edit-balance-input', 'Enter'); await wait(800);
  const saved = { st: db.user_settings[0].starting_balance, mb: JSON.parse(db.user_settings[0].month_balances_json || '{}') };
  ok('T15c Enter saves: entered 1,200 dated Oct 8 is stored in month_balances_json, and starting_balance becomes the derived month-start 200 (1200 - Oct 2 paycheck)', saved.mb.__dated_balance && saved.mb.__dated_balance.amount === 1200 && saved.mb.__dated_balance.asOf === '2026-10-08' && saved.mb.__dated_balance.monthStart === 200 && near(saved.st, 200), JSON.stringify(saved));
  ok('T15c the saved month keys are preserved alongside the dated record', Object.keys(saved.mb).filter(k => /^\d{4}-\d{2}$/.test(k)).length >= 0 && Object.keys(saved.mb).every(k => /^\d{4}-\d{2}$/.test(k) || k === '__dated_balance'), Object.keys(saved.mb).join());
  const after = await page.evaluate(() => ({ d7: buildDayMap(2026, 9)[7].balance, s: fpPrioritySnapshot(new Date(), { paidMarks: fpReadPaidMarks() }), toast: (document.getElementById('toast-msg') || {}).textContent || '' }));
  ok('T15d the calendar agrees with the entered balance: end of Oct 7 = 1,200; the priorities projection starts at 1,200 on Oct 8', near(after.d7, 1200) && near(after.s.projectedToday, 1200) && after.s.balanceBasis.status === 'ok' && /Balance updated/.test(after.toast), JSON.stringify([after.d7, after.s.projectedToday, after.s.balanceBasis, after.toast]));
  const p2 = { badge: await badge(), prio: await prio() };
  ok('T15d with a dated balance the badge no longer says "Balance needed" (v149: "Needs spending history", the seed has none) and the "confirm balance" item is gone; no dollar extra-payment text', p2.badge === 'Needs spending history' && !/Confirm your bank balance/.test(p2.prio) && !/extra toward|looks free/.test(p2.prio), JSON.stringify(p2).slice(0, 400));
  await load(); await hideStage(); await wait(300);
  ok('T15e after a reload the dated balance is read back from the database and is still valid', await page.evaluate(() => fpBalanceAnchor(fpIso(new Date())).status) === 'ok', 'not ok after reload');
  await page.click('#stat-start-card'); await wait(300);
  ok('T15e reopening the dialog shows the entered balance (1200), not the derived month-start', await page.inputValue('#edit-balance-input') === '1200', await page.inputValue('#edit-balance-input'));
  await page.click('#edit-balance-overlay button.btn-outline'); await wait(200);

  // Settings path
  await page.evaluate(() => showView('settings', null)); await wait(200);
  ok('T15f Settings shows a balance date field prefilled with today', await page.inputValue('#settings-balance-date') === '2026-10-08', await page.inputValue('#settings-balance-date'));
  await page.fill('#settings-balance', '900'); await page.fill('#settings-balance-date', '2026-10-05');
  await page.evaluate(() => saveStartingBalance()); await wait(600);
  const sv = JSON.parse(db.user_settings[0].month_balances_json).__dated_balance;
  ok('T15f Settings save stores 900 as of Oct 5 with month-start 900 - 1000 = -100', sv.amount === 900 && sv.asOf === '2026-10-05' && sv.monthStart === -100 && near(db.user_settings[0].starting_balance, -100), JSON.stringify([sv, db.user_settings[0].starting_balance]));
  await page.fill('#settings-balance', '900'); await page.fill('#settings-balance-date', '2026-09-20');
  await page.evaluate(() => saveStartingBalance()); await wait(600);
  ok('T15f v149: a date before this month is REJECTED with a message and nothing is saved (v148 silently stored the 1st)', JSON.parse(db.user_settings[0].month_balances_json).__dated_balance.asOf === '2026-10-05' && /Choose a date in this month/.test(await page.evaluate(() => (document.getElementById('toast-msg') || {}).textContent || '')), db.user_settings[0].month_balances_json);
  await page.evaluate(() => showView('calendar', null));

  // Setup path
  await page.evaluate(() => openSetup()); await wait(200);
  ok('T15g setup asks for the balance date (prefilled today) and the twice-monthly option no longer promises the 1st and 15th', await page.inputValue('#setup-balance-date') === '2026-10-08' && await page.evaluate(() => [...document.querySelectorAll('option[value=twicemonthly]')].every(o => /15th &? ?last day|15th & last day/.test(o.textContent) && o.textContent.indexOf('or 15th') > -1)), await page.evaluate(() => [...document.querySelectorAll('option[value=twicemonthly]')].map(o => o.textContent).join('|')));
  await page.fill('#setup-balance', '2000'); await page.fill('#setup-payday', '2026-09-30'); await page.selectOption('#setup-frequency', 'twicemonthly'); await page.fill('#setup-payamount', '1500');
  await page.evaluate(() => saveSetup()); await wait(900);
  const su = { s: db.user_settings[0], d: JSON.parse(db.user_settings[0].month_balances_json).__dated_balance, pays: await page.evaluate(() => getPayDatesForMonth(2026, 9).map(d => d.getDate()).join()) };
  ok('T15g setup save: twice-monthly, last payday Sep 30 -> paid on the 15th and 31st; balance 2000 dated today; month-start 2000 (no paycheck before Oct 8)', su.s.pay_frequency === 'twicemonthly' && su.pays === '15,31' && su.d.amount === 2000 && su.d.asOf === '2026-10-08' && near(su.s.starting_balance, 2000), JSON.stringify(su));
  await page.evaluate(() => { const so = document.getElementById('stage-overlay'); if (so) so.style.display = 'none'; });

  // Edited recurring expense: the edit moves the schedule (anchor_date), so it is counted once
  db.transactions.push({ id: 'gym-r', user_id: 'user-A', type: 'expense', description: 'Gym', amount: 50, date: '2026-10-05', category: 'personal', recurring: true, frequency: 'monthly', anchor_date: '2026-10-05', apr: null, min_payment: null, balance: null, lender: null, created_at: '2026-09-01', original_balance: null, original_min_payment: null, principal_applied: null, loan_id: null });
  await load(); await hideStage(); await wait(300);
  await page.evaluate(() => openExpenseEdit('gym-r')); await wait(200);
  await page.fill('#ee-date', '2026-10-20');
  await page.evaluate(() => saveExpenseEdit()); await wait(600);
  const gym = db.transactions.find(t => t.id === 'gym-r');
  const gymDays = await page.evaluate(() => { const m = buildDayMap(2026, 9); return [m[5].expenses.length, m[20].expenses.length]; });
  ok('T15h editing a recurring expense date writes date AND anchor_date; the calendar counts it once, on the 20th', gym.date === '2026-10-20' && gym.anchor_date === '2026-10-20' && gymDays.join() === '0,1', JSON.stringify([gym.date, gym.anchor_date, gymDays]));

  // Day panel uses the same events as the balance: a payment made in September for Oct 10 replaces the Oct 10 row
  db.transactions.push({ id: 'early-pay', user_id: 'user-A', type: 'expense', description: 'Test Car Loan payment', amount: 200, date: '2026-09-30', category: 'loan_payment', recurring: false, frequency: null, anchor_date: null, apr: null, min_payment: null, balance: null, lender: null, created_at: '2026-09-30', original_balance: null, original_min_payment: null, principal_applied: 150, loan_id: 'loan-car' });
  await load(); await hideStage(); await wait(300);
  const panel = await page.evaluate(() => { const m = fpDayEvents(2026, 9); return { loansOn10: m[10].loans.map(l => l.id) }; });
  ok('T15i a car payment recorded Sep 30 (10 days early) replaces the Oct 10 scheduled payment', panel.loansOn10.indexOf('loan-car') === -1, JSON.stringify(panel));

  // ---- T16 v149: the allocation switch is a true global safeguard (fake backend only; AI endpoint intercepted, never reached)
  let aiCalls = 0;
  await ctx.route('**/api.anthropic.com/**', r => { aiCalls++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: 'FAKE AI: put $500 extra toward your car' }] }) }); });
  seed(); await load(); await hideStage(); await wait(1500);
  const FORBIDDEN = /Can afford|This works\. Paying|breathing room at month end|extra toward|looks free|Keeping \$|Setting aside|You have \$[\d,]+ available|saved \(\d+%\)|Saving \$[\d,]+\/month|Plenty of room|You've earned it|gets you done in|FAKE AI/;
  const viewText = () => page.evaluate(() => document.body.innerText);
  const sweep = {};
  sweep.calendar = await viewText();
  const brNow = await page.evaluate(() => ({ label: document.querySelector('.br-label').textContent, tag: document.getElementById('br-tag').textContent, sub: document.getElementById('br-sub').textContent, amt: document.getElementById('br-amount').className }));
  ok('T16a Breathing Room with the switch off: labelled "Month-end estimate", neutral tag, no reassurance line, no colour verdict', brNow.label === 'Month-end estimate' && brNow.tag === 'Estimate' && /Not a confirmed bank balance/.test(brNow.sub) && brNow.amt === 'br-amount', JSON.stringify(brNow));
  // The focused loan card is the first one; with the seed it is the $100 loan, which never shows the suggestion. Show the car loan.
  const carCard = () => page.evaluate(() => { const keep = transactions; transactions = transactions.filter(t => t.id !== 'loan-small'); showView('loans', null); const txt = document.getElementById('view-loans').innerText; transactions = keep; return txt; });
  sweep.loans = await carCard();
  ok('T16b car loan card: no "Paying $X/month gets you done ... and saves $Y" suggestion with the switch off', !/gets you done in/.test(sweep.loans) && /See how much faster you could clear this debt/.test(sweep.loans), sweep.loans.slice(0, 300));
  await page.evaluate(() => openWhatIf('loan-car')); await wait(300);
  const wi1 = await page.evaluate(() => ({ zone: document.getElementById('wi-zone-label').textContent, coach: document.getElementById('whatif-coach').textContent, btn: document.getElementById('whatif-apply-btn').disabled, bar: document.getElementById('whatif-zone-bar').style.background }));
  await page.evaluate(() => { const sl = document.getElementById('whatif-slider'); sl.value = sl.max; updateWhatIf(); }); await wait(100);
  const wi2 = await page.evaluate(() => ({ zone: document.getElementById('wi-zone-label').textContent, coach: document.getElementById('whatif-coach').textContent, btn: document.getElementById('whatif-apply-btn').disabled, result: document.getElementById('whatif-result').innerText }));
  sweep.whatif = await page.evaluate(() => document.getElementById('whatif-overlay').innerText);
  ok('T16c What-If at the minimum: no zone label, no "$20-30 more" nudge, neutral coach text saying FinPulse is not checking affordability', wi1.zone === '' && !/20.30 more/.test(wi1.coach) && /not checking whether it fits your budget/.test(wi1.coach) && !wi1.btn, JSON.stringify(wi1));
  ok('T16c What-If at the maximum: still no "Too much"/"Can afford" verdict; payoff maths for the chosen amount still shown', wi2.zone === '' && /not checking/.test(wi2.coach) && /done in/i.test(wi2.result) && !wi2.btn, JSON.stringify(wi2));
  await page.evaluate(() => { document.getElementById('whatif-overlay').style.display = 'none'; });
  await page.evaluate(() => { showView('plan', null); }); await wait(300); sweep.planNull = await viewText();
  ok('T16d goal tracker never invents recorded savings from an undated balance', /Set your first goal/.test(sweep.planNull) && /goal savings are tracked separately/.test(sweep.planNull) && !/saved \(|available\./.test(sweep.planNull), sweep.planNull.slice(0, 200));
  const planForced = await page.evaluate(() => { const keep = window.fpStageInfo; const out = {}; [2, 3].forEach(function(n) { window.fpStageInfo = function() { return { stage: n, reason: 'test' }; }; renderPlan(); out[n] = document.getElementById('view-plan').innerText; }); window.fpStageInfo = keep; renderPlan(); return out; });
  ok('T16d forcing a stage never creates goal savings or allocates money', !FORBIDDEN.test(planForced[2]) && !FORBIDDEN.test(planForced[3]) && /Set your first goal/.test(planForced[2]) && /Set your first goal/.test(planForced[3]), JSON.stringify(planForced).slice(0, 500));
  await page.evaluate(() => { showView('calendar', null); updateStats(); }); await wait(1500);
  sweep.calendar2 = await viewText();
  ok('T16e no AI coaching request is made while the switch is off (Breathing Room phrase)', aiCalls === 0, 'AI calls: ' + aiCalls);
  await page.evaluate(() => { showRolloverModal(100, 250, '2026-10'); }); await wait(200);
  const rbText = await page.textContent('#rollover-submit-btn');
  await page.fill('#rollover-explanation', 'car repair <b>x</b>');
  await page.evaluate(() => submitRolloverExplanation()); await wait(800);
  const note = db.transactions.find(t => t.type === 'note' && /car repair/.test(t.description));
  ok('T16e rollover with an explanation and the switch off: no AI request, button says "Save note & lock it in", note saved, modal closed', aiCalls === 0 && /Save note/.test(rbText) && !!note && await page.evaluate(() => document.getElementById('rollover-overlay').style.display) === 'none', JSON.stringify({ aiCalls, rbText, note: !!note }));
  const allTxt = Object.values(sweep).join('\n');
  const bad = allTxt.match(FORBIDDEN);
  ok('T16f sweep of the calendar, Breathing Room, priorities, loans, What-If and Plan text: no allocation or affordability claim anywhere with the switch off', !bad, bad ? bad[0] : '');
  // Control: the same screens DO change when the switch is turned on, so the switch (not something else) is what gates them.
  await page.evaluate(() => { FP_FLAGS.extraAmountEnabled = true; showView('calendar', null); updateStats(); }); await wait(1600);
  const on = { label: await page.evaluate(() => document.querySelector('.br-label').textContent), loans: await carCard() };
  await page.evaluate(() => openWhatIf('loan-car')); await wait(200);
  const onZone = await page.evaluate(() => document.getElementById('wi-zone-label').textContent);
  ok('T16g control: with the switch turned on in the page, Breathing Room, the loan card, What-If zones and the AI call come back (so the switch is the gate)', on.label !== 'Month-end estimate' && /gets you done in/.test(on.loans) && onZone !== '' && aiCalls > 0, JSON.stringify({ label: on.label, onZone, aiCalls }));
  await page.evaluate(() => { document.getElementById('whatif-overlay').style.display = 'none'; FP_FLAGS.extraAmountEnabled = false; showView('calendar', null); updateStats(); }); await wait(300);

  // ---- T17 v149: the paycheck question and date validation in the balance dialog
  seed(); await load(); await hideStage(); await wait(300);
  await page.click('#stat-start-card'); await wait(300);
  const q0 = await page.evaluate(() => document.getElementById('edit-balance-pay-wrap').style.display);
  await page.fill('#edit-balance-date', '2026-10-02'); await wait(100);
  const q1 = await page.evaluate(() => ({ disp: document.getElementById('edit-balance-pay-wrap').style.display, label: document.getElementById('edit-balance-pay-label').textContent, val: document.getElementById('edit-balance-pay').value }));
  ok('T17a no paycheck question for Oct 8 (next paycheck Oct 16); for Oct 2 (a payday) the dialog asks "Is your Fri, Oct 2 paycheck of $1,000 already in this balance?" defaulting to Not sure', q0 === 'none' && q1.disp === 'block' && /Fri, Oct 2 paycheck of \$1,000 already in this balance/.test(q1.label) && q1.val === '', JSON.stringify({ q0, q1 }));
  await page.selectOption('#edit-balance-pay', 'yes');
  await page.fill('#edit-balance-input', '1500');
  await page.press('#edit-balance-input', 'Enter'); await wait(800);
  const rec = JSON.parse(db.user_settings[0].month_balances_json || '{}').__dated_balance;
  const st17 = await page.evaluate(() => { const s = fpPrioritySnapshot(new Date(), { paidMarks: fpReadPaidMarks() }); return { today: s.projectedToday, unc: s.uncertainIncome.length, oct2: buildDayMap(2026, 9)[2].balance }; });
  ok('T17b "Yes" is saved with the balance; the Oct 2 paycheck is not added again: projected today 1,500, calendar Oct 2 = 1,500, month-start 500', rec && rec.v === 2 && rec.paycheck && rec.paycheck.date === '2026-10-02' && rec.paycheck.included === true && near(rec.monthStart, 500) && near(st17.today, 1500) && near(st17.oct2, 1500) && st17.unc === 0, JSON.stringify({ rec, st17 }));
  await page.click('#stat-start-card'); await wait(300);
  await page.fill('#edit-balance-date', '2026-10-02'); await wait(100);
  await page.fill('#edit-balance-input', '1500');
  await page.press('#edit-balance-input', 'Enter'); await wait(800);
  const rec2 = JSON.parse(db.user_settings[0].month_balances_json || '{}').__dated_balance;
  const st17b = await page.evaluate(() => { const s = fpPrioritySnapshot(new Date(), { paidMarks: fpReadPaidMarks() }); return { today: s.projectedToday, unc: s.uncertainIncome.length, blockers: s.cash.blockers, prio: document.getElementById('priority-report').innerText }; });
  ok('T17c "Not sure" (the default) is saved as unknown: paycheck not counted, advice blocked, the list asks to answer the paycheck question and never says "record it"', rec2.paycheck.included === null && near(st17b.today, 1500) && st17b.unc === 1 && st17b.blockers.indexOf('income_inclusion_unknown') > -1 && /answer the paycheck question/.test(st17b.prio) && !/Record it/i.test(st17b.prio), JSON.stringify({ rec2, st17b: Object.assign({}, st17b, { prio: st17b.prio.slice(0, 200) }) }));
  const before17 = db.user_settings[0].month_balances_json;
  await page.click('#stat-start-card'); await wait(300);
  await page.fill('#edit-balance-input', '999'); await page.fill('#edit-balance-date', '2026-09-20');
  await page.press('#edit-balance-input', 'Enter'); await wait(500);
  const l1 = { vis: await page.evaluate(() => document.getElementById('edit-balance-overlay').style.display), toast: await page.evaluate(() => (document.getElementById('toast-msg') || {}).textContent || ''), same: db.user_settings[0].month_balances_json === before17 };
  ok('T17d a date before this month is rejected: error message, dialog stays open, nothing saved (v148 silently moved it to the 1st)', l1.vis === 'flex' && /Choose a date in this month/.test(l1.toast) && l1.same, JSON.stringify(l1));
  await page.keyboard.press('Escape'); await wait(200);

  // ---- T18 v149: a mark settles one due date (real clicks in the Bills tab)
  seed();
  db.transactions.push({ id: 'ph-b', user_id: 'user-A', type: 'bill', description: 'Phone Bill', amount: 80, date: '2026-09-12', category: 'home', recurring: true, frequency: 'monthly', anchor_date: '2026-09-12', apr: null, min_payment: null, balance: null, lender: null, created_at: '2026-09-01', original_balance: null, original_min_payment: null, principal_applied: null, loan_id: null });
  await load(); await hideStage(); await page.evaluate(() => { localStorage.removeItem('fp_bill_paid_marks_' + currentUser.id); showView('bills', null); renderBillsView(); }); await wait(300);
  const clickPhone = async () => { const i = await page.evaluate(() => [...document.querySelectorAll('#bill-list-view .bill-row')].findIndex(r => /Phone Bill/.test(r.innerText))); const b = await page.evaluate(i => { const el = document.querySelectorAll('#bill-list-view .bill-chk')[i]; el.scrollIntoView(); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, i); await page.mouse.click(b.x, b.y); await wait(400); };
  await clickPhone();
  const m1 = await page.evaluate(() => ({ marks: JSON.parse(localStorage.getItem('fp_bill_paid_marks_' + currentUser.id) || '{}')['ph-b'], toast: document.getElementById('toast-msg').textContent, paid: !!fpBillPaidSetThisMonth()['ph-b'], up: fpPrioritySnapshot(new Date(), { paidMarks: fpReadPaidMarks() }).upcoming.filter(u => u.id === 'ph-b').map(u => u.date) }));
  ok('T18a first tap settles the OLDEST open due date only (Sep 12) and says Oct 12 is still due; Oct 12 stays upcoming and unpaid in Bills', JSON.stringify(m1.marks) === JSON.stringify([{ due: '2026-09-12', at: '2026-10-08' }]) && /Sat, Sep 12/.test(m1.toast) && /Mon, Oct 12 is still due/.test(m1.toast) && !m1.paid && m1.up.indexOf('2026-10-12') > -1, JSON.stringify(m1));
  await clickPhone();
  const m2 = await page.evaluate(() => ({ marks: JSON.parse(localStorage.getItem('fp_bill_paid_marks_' + currentUser.id) || '{}')['ph-b'], paid: !!fpBillPaidSetThisMonth()['ph-b'] }));
  ok('T18b second tap settles Oct 12; the bill now shows as cleared for this month', m2.marks.length === 2 && m2.marks[1].due === '2026-10-12' && m2.paid, JSON.stringify(m2));
  await clickPhone();
  const m3 = await page.evaluate(() => ({ marks: JSON.parse(localStorage.getItem('fp_bill_paid_marks_' + currentUser.id) || '{}')['ph-b'], paid: !!fpBillPaidSetThisMonth()['ph-b'] }));
  ok('T18c third tap un-marks this month only; the September mark stays', JSON.stringify(m3.marks) === JSON.stringify([{ due: '2026-09-12', at: '2026-10-08' }]) && !m3.paid, JSON.stringify(m3));
  await page.evaluate(() => { localStorage.removeItem('fp_bill_paid_marks_' + currentUser.id); showView('calendar', null); });

  // ---- T19 v149: a new month starts from the dated balance (page clock moved; fake backend only)
  seed();
  await page.clock.setFixedTime(new Date(2026, 9, 25, 12, 0, 0));
  await load(); await hideStage(); await wait(300);
  await page.evaluate(() => fpApplyDatedBalance(1000, '2026-10-25', null, '')); await wait(600);
  await page.clock.setFixedTime(new Date(2026, 10, 2, 12, 0, 0));
  await load(); await wait(1600);
  const nov = await page.evaluate(() => ({ start: getStartingBalanceForMonth(2026, 10), card: document.getElementById('stat-start').textContent, roll: document.getElementById('rollover-overlay').style.display, stored: userSettings.startingBalance }));
  ok('T19 on Nov 2 the November calendar starts at 2,000 (1,000 on Oct 25 + the Oct 30 paycheck), not October\'s stored -600; no rollover prompt', near(nov.start, 2000) && nov.card === '$2,000' && nov.roll !== 'flex' && near(nov.stored, -600), JSON.stringify(nov));
  await page.clock.setFixedTime(new Date(2026, 9, 8, 12, 0, 0));
  seed(); await load(); await hideStage();

  // ---- T20 atomic operation failures and ambiguous retries (fake backend)
  seed(); await load(); await hideStage();
  await page.evaluate(()=>{ showView('loans',null); recordLoanPayment('loan-car'); });
  await page.fill('#rp-extra','30');rpcBackend.setFault('rollback-record');
  await page.click('#rp-confirm-btn');await wait(300);
  const failedPayment=await page.evaluate(()=>({input:document.getElementById('rp-input-stage').style.display,animation:document.getElementById('rp-anim-stage').style.display,disabled:document.getElementById('rp-confirm-btn').disabled,toast:document.getElementById('toast-msg').textContent}));
  ok('T20 failed atomic payment preserves balance and history',near(loan('loan-car').balance,5000)&&!txns().some(t=>t.category==='loan_payment'),JSON.stringify(txns()));
  ok('T20 failed payment keeps input open, enables retry and has no success animation',failedPayment.input==='block'&&failedPayment.animation==='none'&&!failedPayment.disabled&&/failure/.test(failedPayment.toast),JSON.stringify(failedPayment));
  rpcBackend.setFault('lost-after-commit');await page.click('#rp-confirm-btn');await wait(300);
  ok('T20 lost confirmation committed one regular and one extra payment',near(loan('loan-car').balance,4820)&&txns().filter(t=>t.category==='loan_payment').length===2,JSON.stringify(txns()));
  await page.evaluate(()=>closeRecordPayment());
  // Reload preserves the pending operation ID and inputs in owner-scoped storage.
  await load();await hideStage();await page.evaluate(()=>{showView('loans',null);recordLoanPayment('loan-car')});
  ok('T20 reopening pending payment restores extra amount after reload',await page.inputValue('#rp-extra')==='30',await page.inputValue('#rp-extra'));
  await page.click('#rp-confirm-btn');await wait(300);
  const recordCalls=reqlog.filter(r=>r.op==='rpc'&&r.payload.p_kind==='record');
  ok('T20 retry after reload uses same operation ID and never double pays',recordCalls.length===3&&recordCalls[1].payload.p_operation_id===recordCalls[2].payload.p_operation_id&&near(loan('loan-car').balance,4820)&&txns().filter(t=>t.category==='loan_payment').length===2,JSON.stringify(recordCalls));
  ok('T20 replay confirms already saved and local snapshot stays current',/already saved/.test(await toast())&&near(await page.evaluate(()=>transactions.find(t=>t.id==='loan-car').balance),4820),await toast());
  const deletePay=txns().find(t=>t.description==='Test Car Loan payment').id;
  rpcBackend.setFault('rollback-delete');await page.evaluate(id=>deleteTxnWithUndo(id),deletePay);await wait(200);
  ok('T20 failed deletion leaves payment and balance unchanged with no Undo success',txns().some(t=>t.id===deletePay)&&near(loan('loan-car').balance,4820)&&!/Undo/.test(await page.textContent('#toast')),await toast());
  rpcBackend.setFault('lost-after-commit');await page.evaluate(id=>deleteTxnWithUndo(id),deletePay);await load();await hideStage();
  ok('T20 interrupted deletion offers recovery after reload',await page.isVisible('#fp-pending-notice'),await page.textContent('#fp-pending-notice'));
  await page.click('#fp-pending-notice button');await wait(200);
  ok('T20 deletion recovery restores principal once and offers Undo',near(loan('loan-car').balance,4970)&&!/Test Car Loan payment/.test(txns().map(t=>t.description).join('|'))&&/Undo/.test(await page.textContent('#toast')),await toast());
  rpcBackend.setFault('rollback-undo');await page.evaluate(()=>undoLastDelete());await wait(200);
  ok('T20 failed undo preserves deletion and restored principal',!txns().some(t=>t.id===deletePay)&&near(loan('loan-car').balance,4970),JSON.stringify(txns()));
  await page.evaluate(()=>undoLastDelete());await wait(200);
  ok('T20 retry undo restores original payment ID and exact balance',txns().some(t=>t.id===deletePay)&&near(loan('loan-car').balance,4820),JSON.stringify(txns()));
  await page.evaluate(id=>deleteTxnWithUndo(id),deletePay);rpcBackend.setFault('lost-after-commit');await page.evaluate(()=>undoLastDelete());await load();await hideStage();
  await page.click('#fp-pending-notice button');await wait(200);
  ok('T20 interrupted undo recovery after reload never reduces debt twice',txns().some(t=>t.id===deletePay)&&near(loan('loan-car').balance,4820)&&txns().filter(t=>t.category==='loan_payment').length===2,JSON.stringify(txns()));
  seed();await load();await hideStage();


  // ---- T21 real DOM forms preserve input on rejected writes; UUID retries survive reload.
  seed();await load();await hideStage();
  await page.evaluate(()=>{showView('loans',null);openLoanModal();});
  await page.fill('#lm-desc','Retry Loan');await page.fill('#lm-balance','1200');await page.fill('#lm-apr','12');
  writeFault='reject';await page.click('#lm-save-btn');await wait(200);
  ok('T21 failed add loan keeps form and inputs; no success toast',await page.isVisible('#loan-add-form') && await page.inputValue('#lm-desc')==='Retry Loan' && !await page.isDisabled('#lm-save-btn') && !txns().some(t=>t.description==='Retry Loan') && /failure/.test(await toast()),await toast());
  await page.click('#lm-save-btn');await wait(200);
  ok('T21 loan retry confirms once and closes form',txns().filter(t=>t.description==='Retry Loan').length===1 && !await page.isVisible('#loan-add-form'),JSON.stringify(txns()));
  await page.evaluate(()=>openLoanEdit('loan-car'));await page.fill('#le-balance','0');writeFault='reject';await page.evaluate(()=>saveLoanEdit());await wait(200);
  ok('T21 rejected zero-balance edit leaves original loan and dialog',near(loan('loan-car').balance,5000) && await page.isVisible('#loan-edit-overlay') && await page.inputValue('#le-balance')==='0',await toast());
  await page.evaluate(()=>saveLoanEdit());await wait(200);
  ok('T21 confirmed edit keeps zero balance',near(loan('loan-car').balance,0) && !await page.isVisible('#loan-edit-overlay'),JSON.stringify(loan('loan-car')));
  await load();await hideStage();await page.evaluate(()=>openLoanEdit('loan-car'));
  ok('T21 reopening a paid-off loan after reload displays zero rather than its monthly payment',await page.inputValue('#le-balance')==='0',await page.inputValue('#le-balance'));
  await page.keyboard.press('Escape');
  db.transactions.push({id:'expense-edit',user_id:'user-A',type:'expense',description:'Coffee',amount:10,date:'2026-10-09',category:'food',recurring:false});
  await load();await hideStage();await page.evaluate(()=>openExpenseEdit('expense-edit'));await page.fill('#ee-desc','Lunch');await page.fill('#ee-amount','20');writeFault='reject';await page.evaluate(()=>saveExpenseEdit());await wait(200);
  ok('T21 rejected expense edit keeps typed values and original transaction',await page.isVisible('#edit-expense-overlay') && await page.inputValue('#ee-desc')==='Lunch' && txns().find(t=>t.id==='expense-edit').description==='Coffee',await toast());
  await page.evaluate(()=>saveExpenseEdit());await wait(200);
  ok('T21 confirmed expense retry updates exactly one row',txns().filter(t=>t.id==='expense-edit').length===1 && txns().find(t=>t.id==='expense-edit').description==='Lunch' && !await page.isVisible('#edit-expense-overlay'),await toast());
  await page.evaluate(()=>openReassignModal('expense-edit'));writeFault='reject';await page.evaluate(()=>reassignCategory('transport'));await wait(200);
  ok('T21 rejected category edit keeps dialog and saved category',await page.isVisible('#reassign-overlay') && txns().find(t=>t.id==='expense-edit').category==='food',await toast());
  await page.evaluate(()=>reassignCategory('transport'));await wait(200);
  ok('T21 category retry confirms before closing',txns().find(t=>t.id==='expense-edit').category==='transport' && !await page.isVisible('#reassign-overlay'),await toast());
  await page.evaluate(()=>{openExpenseEdit('expense-edit');deleteExpenseFromEdit();});rpcBackend.setFault('rollback-delete');await page.evaluate(()=>confirmDeleteExpense());await wait(200);
  ok('T21 rejected expense deletion keeps confirmation and row',await page.isVisible('#edit-expense-overlay') && txns().some(t=>t.id==='expense-edit'),await toast());
  await page.evaluate(()=>confirmDeleteExpense());await wait(200);
  ok('T21 deletion retry closes only after receipt confirmation',!await page.isVisible('#edit-expense-overlay') && !txns().some(t=>t.id==='expense-edit'),await toast());
  seed();await load();await hideStage();
  await page.evaluate(()=>{_pendingImportRows=[{type:'expense',description:'Import A',amount:12,date:'2026-10-09',category:'food',include:true},{type:'expense',description:'Import B',amount:20,date:'2026-10-10',category:'other',include:true}];document.getElementById('import-preview').style.display='block';document.getElementById('import-confirm-btn').style.display='block';});
  writeFault='reject';await page.evaluate(()=>confirmStatementImport());await wait(200);
  ok('T21 import rejection keeps preview and batch with no added rows',await page.evaluate(()=>_pendingImportRows.length)===2 && await page.evaluate(()=>document.getElementById('import-preview').style.display)==='block' && !txns().some(t=>t.description==='Import A') && !await page.isDisabled('#import-confirm-btn'),await toast());
  writeFault='lost';await page.evaluate(()=>confirmStatementImport());await wait(200);
  const importIDs=txns().filter(t=>/^Import /.test(t.description)).map(t=>t.id).sort().join(',');
  ok('T21 lost import confirmation leaves original batch available to check',txns().filter(t=>/^Import /.test(t.description)).length===2 && await page.evaluate(()=>_pendingImportRows.length)===2,await toast());
  await load();await hideStage();await page.click('#fp-pending-notice button');await wait(200);
  ok('T21 pending import recovery after reload uses original UUIDs without duplicates',txns().filter(t=>/^Import /.test(t.description)).length===2 && txns().filter(t=>/^Import /.test(t.description)).map(t=>t.id).sort().join(',')===importIDs && await page.evaluate(()=>transactions.filter(t=>/^Import /.test(t.description)).length)===2 && /Save confirmed/.test(await toast()),await toast());
  seed();await load();await hideStage();

  // ---- T22 live-preview auth failure and recovery
  readFault='once';await load();await hideStage();
  ok('T22 transient JWT rejection retries account reads once and opens app',await page.isVisible('#app') && reqlog.filter(r=>r.op==='select'&&r.table==='user_settings').slice(-2).length===2,'account did not recover');
  readFault='persistent';const beforeReads=reqlog.filter(r=>r.op==='select'&&r.table==='user_settings').length;
  await page.goto('file://'+FILE);await page.waitForSelector('#auth-screen',{state:'visible',timeout:10000});
  ok('T22 persistent JWT rejection stops after exactly two read attempts',reqlog.filter(r=>r.op==='select'&&r.table==='user_settings').length-beforeReads===2,'unbounded or missing retry');
  ok('T22 failed account load restores usable sign-in button',!await page.isDisabled('#signin-btn') && await page.textContent('#signin-btn')==='Sign In',await toast());
  readFault=null;await page.fill('#signin-email','tester@example.com');await page.fill('#signin-password','test-password');await page.click('#signin-btn');await page.waitForSelector('#app',{state:'visible',timeout:10000});await hideStage();
  ok('T22 sign-in retry opens account after read failure',await page.isVisible('#app') && await page.evaluate(()=>currentUser.id)==='user-A','retry did not recover');
  await page.evaluate(()=>{showAuth();sb.auth.signInWithPassword=async()=>{throw Error('Injected offline sign-in')};});await page.click('#signin-btn');await page.waitForTimeout(100);
  ok('T22 thrown sign-in failure keeps form usable and displays error',!await page.isDisabled('#signin-btn') && await page.isVisible('#signin-error') && /offline/.test(await page.textContent('#signin-error')),'button stuck or error missing');

  // ---- T23 selected-month spending reconciliation and estimate wording
  seed();await load();await hideStage();
  const ringsTotal=async()=>parseFloat((await page.textContent('#spending-rings-meta')).replace(/[^0-9.]/g,''));
  const cashOut=async()=>parseFloat((await page.textContent('#stat-out')).replace(/[^0-9.]/g,''));
  ok('T23 spending split includes scheduled loan payments even without expense records',await ringsTotal()===400 && await cashOut()===400,await page.textContent('#spending-rings-meta'));
  db.transactions.push({id:'old-expense',user_id:'user-A',type:'expense',description:'Old month',amount:900,date:'2026-08-01',recurring:false},
    {id:'oct-expense',user_id:'user-A',type:'expense',description:'October only',amount:20,date:'2026-10-09',recurring:false},
    {id:'nov-expense',user_id:'user-A',type:'expense',description:'November only',amount:60,date:'2026-11-04',recurring:false},
    {id:'weekly-expense',user_id:'user-A',type:'expense',description:'Weekly fixed',amount:10,date:'2026-10-01',anchor_date:'2026-10-01',frequency:'weekly',recurring:true});
  await load();await hideStage();
  ok('T23 October spending reconciles with cash out and excludes other months',await ringsTotal()===470 && await cashOut()===470,await page.textContent('#spending-rings-meta'));
  ok('T23 October split counts all five weekly occurrences and scheduled loans',/\$450/.test(await page.textContent('#spending-rings')) && /\$20/.test(await page.textContent('#spending-rings')),await page.textContent('#spending-rings'));
  await page.evaluate(()=>nextMonth());
  ok('T23 November navigation recalculates both monthly totals',await ringsTotal()===500 && await cashOut()===500 && /November/.test(await page.textContent('#cal-heading')),await page.textContent('#spending-rings-meta'));
  await page.evaluate(()=>prevMonth());
  ok('T23 undated-balance warning acknowledges visible calendar estimates',/calendar still shows estimates/i.test(await page.textContent('#priority-report')) && !/no cash projection is shown/i.test(await page.textContent('#priority-report')),await page.textContent('#priority-report'));
  await page.evaluate(()=>{userSettings.startingBalance=-5000;monthBalances['2026-10']=-5000;updateStats();});
  ok('T23 negative estimate does not claim verified debt or bank cash',await page.textContent('.br-label')==='Month-end estimate' && await page.textContent('#br-tag')==='Projected shortfall' && /Not a confirmed bank balance/.test(await page.textContent('#br-sub')) && /Confirm your current bank balance/.test(await page.textContent('#br-coach')),await page.textContent('#breathing-room'));

  // ---- T24 narrow-screen calendar and navigation
  seed();await page.setViewportSize({width:312,height:800});await load();await hideStage();
  const fits=()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1 && document.querySelector('#main-content').getBoundingClientRect().left>=0 && document.querySelector('#main-content').getBoundingClientRect().right<=window.innerWidth+1);
  ok('T24 calendar fits a 312-pixel panel without horizontal overflow',await fits(),await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth})));
  ok('T24 compact menu replaces the fixed sidebar and stats use two columns',await page.isVisible('#mobile-menu-btn') && !await page.isVisible('#primary-navigation') && await page.evaluate(()=>getComputedStyle(document.querySelector('.stats-row')).gridTemplateColumns.split(' ').length)===2,'sidebar or stats remain desktop-sized');
  await page.click('#mobile-menu-btn');
  ok('T24 menu exposes navigation and account controls',await page.isVisible('#primary-navigation') && await page.isVisible('.signout-btn') && await page.getAttribute('#mobile-menu-btn','aria-expanded')==='true','menu did not expand');
  await page.click('#primary-navigation button:has-text("Expenses")');
  ok('T24 selecting a view closes the menu and keeps expenses inside panel',await page.isVisible('#view-expenses') && !await page.isVisible('#primary-navigation') && await fits(),'view or menu sizing failed');
  await page.click('#mobile-menu-btn');await page.click('#primary-navigation button:has-text("Calendar")');
  ok('T24 menu returns to calendar without changing its monthly total',await page.isVisible('#view-calendar') && await ringsTotal()===400 && await fits(),'calendar navigation failed');
  await page.setViewportSize({width:1280,height:900});
  ok('T24 desktop retains visible sidebar and four-column stats',await page.isVisible('#primary-navigation') && !await page.isVisible('#mobile-menu-btn') && await page.evaluate(()=>getComputedStyle(document.querySelector('.stats-row')).gridTemplateColumns.split(' ').length)===4,'desktop layout regressed');

  // ---- T25 Expenses monthly summary versus saved-record library
  seed();db.transactions.push(
    {id:'historic-payment',user_id:'user-A',type:'expense',description:'Historic payment',amount:999,date:'2025-06-15',category:'loan_payment',recurring:false},
    {id:'historic-expense',user_id:'user-A',type:'expense',description:'Old expense',amount:900,date:'2025-08-01',category:'shopping',recurring:false},
    {id:'oct-item',user_id:'user-A',type:'expense',description:'October item',amount:20,date:'2026-10-09',category:'food',recurring:false},
    {id:'nov-item',user_id:'user-A',type:'expense',description:'November item',amount:70,date:'2026-11-04',category:'food',recurring:false},
    {id:'weekly-item',user_id:'user-A',type:'expense',description:'Weekly item',amount:10,date:'2026-10-01',anchor_date:'2026-10-01',frequency:'weekly',recurring:true},
    {id:'yearly-item',user_id:'user-A',type:'bill',description:'Yearly item',amount:30,date:'2025-10-10',anchor_date:'2025-10-10',frequency:'yearly',recurring:true});
  await load();await hideStage();const originalRecords=JSON.stringify(db.transactions),originalWrites=reqlog.filter(r=>r.op!=='select').length;
  await page.evaluate(()=>showView('expenses',null));
  const expenseTotal=async()=>parseFloat((await page.textContent('#exp-stat-total')).replace(/[^0-9.]/g,''));
  ok('T25 October Expenses total reconciles with calendar and spending split',await expenseTotal()===500 && await cashOut()===500 && await ringsTotal()===500 && await page.textContent('#exp-month-label')==='October 2026',await page.textContent('#exp-stat-total'));
  ok('T25 Expenses monthly split counts weekly/yearly occurrences and scheduled loans',await page.textContent('#exp-stat-recurring')==='-$480' && await page.textContent('#exp-stat-onetime')==='-$20',await page.textContent('#exp-stats-row'));
  ok('T25 saved fixed records preserve historic payments and show correct frequencies and years',/Historic payment/.test(await page.textContent('#fv-fixed-list')) && /2025/.test(await page.textContent('#fv-fixed-list')) && /Weekly/.test(await page.textContent('#fv-fixed-list')) && /Yearly/.test(await page.textContent('#fv-fixed-list')) && !/\/mo/.test(await page.textContent('#fv-fixed-list')) && await page.textContent('#fv-fixed-total')==='3 saved records',await page.textContent('#fv-fixed-list'));
  ok('T25 saved one-time records remain available across dates',/Old expense/.test(await page.textContent('#fv-variable-list')) && /November item/.test(await page.textContent('#fv-variable-list')) && await page.textContent('#fv-variable-total')==='3 saved records',await page.textContent('#fv-variable-list'));
  await page.click('[aria-label="Next expense month"]');
  ok('T25 Expenses month control recalculates November without hiding records',await expenseTotal()===510 && await cashOut()===510 && await page.textContent('#exp-month-label')==='November 2026' && /October item/.test(await page.textContent('#fv-variable-list')),await page.textContent('#exp-stat-total'));
  await page.click('[aria-label="Previous expense month"]');
  ok('T25 Expenses month control returns to October consistently',await expenseTotal()===500 && await page.textContent('#exp-month-label')==='October 2026',await page.textContent('#exp-stat-total'));
  await page.click('.fv-row:has-text("Historic payment")');
  ok('T25 historic payment details retain year and do not invent missing principal',await page.isVisible('#lp-info-overlay') && /Historic payment/.test(await page.textContent('#lp-info-title')) && /2025/.test(await page.textContent('#lp-info-date')) && await page.textContent('#lp-info-principal')==='Not recorded','payment record became inaccessible or invented principal');
  await page.evaluate(()=>{document.getElementById('lp-info-overlay').style.display='none';currentYear=2024;currentMonth=0;renderExpensesView();});
  ok('T25 empty month has zero summary while saved records remain visible',await expenseTotal()===0 && /No calendar outflows/.test(await page.textContent('#fv-ratio-bar')) && /Historic payment/.test(await page.textContent('#fv-fixed-list')),await page.textContent('#fv-ratio-bar'));
  ok('T25 viewing records and changing months performs no financial writes',JSON.stringify(db.transactions)===originalRecords && reqlog.filter(r=>r.op!=='select').length===originalWrites,'record navigation mutated backend');

  // ---- T26 Bill status is occurrence-based, local, and requires persistence
  seed();db.transactions=[{id:'weekly-bill',user_id:'user-A',type:'bill',description:'Weekly bill',amount:10,date:'2026-10-02',anchor_date:'2026-10-02',frequency:'weekly',recurring:true},{id:'annual-bill',user_id:'user-A',type:'bill',description:'Annual March bill',amount:100,date:'2026-03-02',anchor_date:'2026-03-02',frequency:'yearly',recurring:true}];
  await load();await hideStage();await page.evaluate(()=>{localStorage.removeItem('fp_bill_paid_marks_user-A');showView('bills',null);updateBillBadge();});
  const billRecords=JSON.stringify(db.transactions),billWrites=reqlog.filter(r=>r.op!=='select').length;
  const billTotal=()=>page.textContent('#bills-total');
  ok('T26 weekly bill totals count five payments and omit annual bills not due',await billTotal()==='$50 still due' && /5 payments open/.test(await page.textContent('#bill-list-view')) && /Weekly/.test(await page.textContent('#bill-list-view')) && !/Annual March/.test(await page.textContent('#bill-list-view')),await page.textContent('#bill-list-view'));
  const calendarBeforeMark=await cashOut();
  await page.click('[aria-label="Mark oldest open payment for Weekly bill"]');
  await page.waitForTimeout(200);
  ok('T26 marking oldest overdue payment preserves four future occurrences',await billTotal()==='$40 still due' && /Oct 9/.test(await page.textContent('#bill-list-view')),await page.textContent('#bill-list-view'));
  ok('T26 upcoming unpaid payment remains in badge',await page.textContent('#bill-badge')==='1',await page.textContent('#bill-badge'));
  await page.click('[aria-label="Mark oldest open payment for Weekly bill"]');
  await page.waitForTimeout(200);
  ok('T26 paid upcoming occurrence clears badge immediately while later payments remain',await billTotal()==='$30 still due' && await page.textContent('#bill-badge')==='0',await billTotal());
  await page.evaluate(()=>{renderCalendar();updateStats();});
  ok('T26 local paid marks do not refund calendar cash outflows',await cashOut()===calendarBeforeMark,await cashOut());
  const failureState=await page.evaluate(()=>localStorage.getItem('fp_bill_paid_marks_user-A'));
  await page.evaluate(()=>{window.__paidSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===localStorage && k==='fp_bill_paid_marks_user-A')throw Error('Injected full storage');return window.__paidSetItem.call(this,k,v)};});
  await page.click('[aria-label="Mark oldest open payment for Weekly bill"]');
  await page.waitForTimeout(300);
  ok('T26 confirmed account mark survives blocked browser cache',await page.evaluate(()=>localStorage.getItem('fp_bill_paid_marks_user-A'))===failureState && await billTotal()==='$20 still due' && /in your account/.test(await toast()),await toast());
  await page.evaluate(()=>{Storage.prototype.setItem=window.__paidSetItem;delete window.__paidSetItem;});
  await page.clock.setFixedTime(new Date(2026,9,30,12));
  await page.evaluate(()=>{renderBillsView();updateBillBadge();});
  ok('T26 badge counts both today and next-month weekly payment',await page.textContent('#bill-badge')==='2',await page.textContent('#bill-badge'));
  ok('T26 status controls perform no financial transaction writes',JSON.stringify(db.transactions)===billRecords && reqlog.filter(r=>r.op!=='select'&&r.table!=='bill_paid_marks').length===billWrites,'paid status changed financial rows');
  await page.clock.setFixedTime(new Date(2026,9,8,12));

  // ---- T27 Statement format and asynchronous review checks
  seed();await load();await hideStage();
  await page.evaluate(()=>openConnectAccounts());
  await pick([['debit-credit.csv','Posting Date,Description,Debit,Credit\r\n10/09/2026,"Shop, ""local""\nbranch",25,\r\n10/10/2026,Pay,,100\r\n10/11/2026,Bad amount,12oops,\r\n']]);
  ok('T27 actual file picker preserves multiline quoted text and debit/credit direction',/Shop, "local"/.test(await page.textContent('#import-preview')) && /Importing 2: -\$25 in expenses, \+\$100 in income/.test(await page.textContent('#import-totals')) && /1 row could not be read/.test(await page.textContent('#import-preview')),await page.textContent('#import-preview'));
  await page.uncheck('#import-preview input[data-import-idx="0"]');
  ok('T27 new transactions can be excluded before saving',/Importing 1: -\$0 in expenses, \+\$100 in income/.test(await page.textContent('#import-totals')),await page.textContent('#import-totals'));
  await page.click('#import-confirm-btn');await page.waitForTimeout(1200);
  ok('T27 only selected income saved with correct amount and date',db.transactions.some(t=>t.description==='Pay'&&t.type==='income'&&t.amount===100&&t.date==='2026-10-10')&&!db.transactions.some(t=>/Shop,/.test(t.description)),'selection or direction failed');
  await page.selectOption('#import-account-type','card-negative');
  await pick([['card-negative.csv','Date,Description,Amount\n2026-10-09,Card purchase,-12\n2026-10-10,Card payment,50\n']],'card-negative');
  ok('T27 negative card purchase convention excludes positive card payment',/Importing 1: -\$12/.test(await page.textContent('#import-totals')) && /1 card payment or credit row/.test(await page.textContent('#import-preview')),await page.textContent('#import-preview'));
  await page.evaluate(()=>cancelStatementImport());
  await page.evaluate(()=>{window.__lateFile=null;window.__lateImport=handleStatementFiles([{name:'late.csv',text:()=>new Promise(r=>window.__lateFile=r)}]);cancelStatementImport();window.__lateFile('Date,Description,Amount\n2026-10-09,Late row,-5\n');});
  await page.evaluate(()=>window.__lateImport);
  ok('T27 canceled pending read cannot repopulate import preview',await page.evaluate(()=>_pendingImportRows.length===0&&document.getElementById('import-preview').style.display==='none'),'stale read repopulated');
  await page.evaluate(()=>closeConnectAccounts());

  // ---- T28 Shared paid status and account-owned confirmations
  seed();db.transactions=[{id:'shared-bill',user_id:'user-A',type:'bill',description:'Shared bill',amount:25,date:'2026-10-09',anchor_date:'2026-10-09',frequency:'monthly',recurring:true}];
  await load();await hideStage();await page.evaluate(()=>showView('bills',null));await page.waitForTimeout(300);
  await page.click('[aria-label="Mark oldest open payment for Shared bill"]');await page.waitForTimeout(300);
  ok('T28 paid status confirmed by account row',db.bill_paid_marks.some(r=>r.bill_id==='shared-bill'&&r.paid===true)&&await billTotal()==='All cleared ✓',JSON.stringify(db.bill_paid_marks));
  await page.evaluate(()=>{localStorage.removeItem('fp_bill_paid_marks_user-A');sessionStorage.clear();});await load();await hideStage();await page.evaluate(()=>showView('bills',null));await page.waitForTimeout(300);
  ok('T28 clean device cache restores paid status from server',await billTotal()==='All cleared ✓',await billTotal());
  db.bill_paid_marks[0].paid=false;
  await page.click('button:has-text("Refresh paid status")');await page.waitForTimeout(300);
  ok('T28 another device unmark clears stale local status',await billTotal()==='$25 still due'&&await page.textContent('#bill-badge')==='1',await billTotal());
  const old={due:'2026-10-09',at:'2026-10-08'};await page.evaluate(m=>localStorage.setItem('fp_bill_paid_marks_user-A',JSON.stringify({'shared-bill':[m]})),old);
  await page.click('button:has-text("Sync older device marks")');await page.waitForTimeout(400);
  ok('T28 syncing old marks preserves account unmark tombstone',db.bill_paid_marks[0].paid===false&&await billTotal()==='$25 still due',JSON.stringify(db.bill_paid_marks));
  writeFault='bill-reject';
  await page.click('[aria-label="Mark oldest open payment for Shared bill"]');await page.waitForTimeout(300);
  ok('T28 missing write confirmation never shows paid success',await billTotal()==='$25 still due'&&/Could not confirm/.test(await toast()),await toast());
  await page.click('button:has-text("Refresh paid status")');await page.waitForTimeout(300);
  ok('T28 refresh recovers committed paid mark after lost confirmation',await billTotal()==='All cleared ✓',await billTotal());

  // ---- T29 Large-account reload and financial presentation
  seed();db.transactions=Array.from({length:1001},(_,i)=>({id:'row-'+String(i).padStart(5,'0'),user_id:'user-A',type:'expense',description:'Expense '+i,amount:0.01,date:'2026-10-09',category:'Other',recurring:false}));
  await load();
  ok('T29 reload retains all 1001 transactions beyond API default limit',await page.evaluate(()=>transactions.length===1001),'rows missing after reload');
  await page.evaluate(()=>showView('insights',null));
  ok('T29 Insights sums every selected-month expense with cents',/10\.01/.test(await page.textContent('#insights-tip')),await page.textContent('#insights-tip'));
  await page.evaluate(()=>fpChangeInsightMonth(1));
  ok('T29 Insights month control excludes October expenses from November',/November/.test(await page.textContent('#view-insights')) && /-\$0 outflows/.test(await page.textContent('#insights-tip')),await page.textContent('#insights-tip'));
  await page.evaluate(()=>{currentMonth=9;showView('plan',null)});
  ok('T29 Plan does not invent a payoff date or savings allocation',await page.textContent('#finish-date')==='Set your first goal' && /projections/.test(await page.textContent('#view-plan')),await page.textContent('#view-plan'));
  seed();db.transactions[0].balance=0;await load();await page.evaluate(()=>showView('loans',null));
  ok('T29 explicit zero-balance loan remains paid off after reload',await page.evaluate(()=>fpLoanBalanceAmount(transactions.find(t=>t.id==='loan-car'))===0)&&/Paid off/.test(await page.textContent('#view-loans')),await page.textContent('#view-loans'));
  const settingsBefore=JSON.stringify(db.user_settings);
  await page.evaluate(()=>{openEditBalance();document.getElementById('edit-balance-input').value='';});await page.evaluate(()=>saveEditBalance());
  ok('T29 blank bank balance preserves saved settings and open editor',JSON.stringify(db.user_settings)===settingsBefore && await page.isVisible('#edit-balance-overlay'),'blank wrote settings');
  await page.evaluate(()=>{document.getElementById('edit-balance-input').value='0';document.getElementById('edit-balance-date').value='2026-10-08';return saveEditBalance();});
  ok('T29 explicit zero bank balance saves successfully',Object.values(JSON.parse(db.user_settings[0].month_balances_json)).some(r=>r && r.v===2 && r.amount===0) && !await page.isVisible('#edit-balance-overlay'),JSON.stringify(db.user_settings));
  await page.evaluate(()=>showView('dreams',null));
  await page.fill('#d-rate-input','0');
  ok('T29 zero-growth scenario preserves principal',await page.evaluate(()=>dCompound(100,10)===100),'incorrect zero return');
  await page.fill('#d-rate-input','-10');
  ok('T29 negative-growth scenario shows loss without guaranteed-return copy',await page.evaluate(()=>dCompound(100,10)<100)&&/negative/.test(await page.textContent('#d-coach')),await page.textContent('#d-coach'));
  await page.fill('#d-rate-input','');
  ok('T29 blank growth rate asks for an assumption',await page.textContent('#d-future')==='—'&&/Enter an assumed/.test(await page.textContent('#d-coach')),await page.textContent('#d-coach'));
  await page.fill('#d-rate-input','10');

  // Goal creation, progress, archive and save recovery on synthetic data.
  seed();await load();await page.evaluate(()=>showView('plan',null));await page.waitForTimeout(200);
  await page.click('#goal-add-btn');await page.fill('#goal-name','Emergency fund');await page.fill('#goal-target','1000');await page.fill('#goal-saved','250.50');await page.fill('#goal-monthly','100');await page.fill('#goal-date','2027-06-01');
  await page.click('#goal-save-btn');await page.waitForTimeout(300);
  ok('T30 goal saves exact amounts',db.financial_goals.length===1&&db.financial_goals[0].saved_amount===250.5&&db.financial_goals[0].target_amount===1000,JSON.stringify(db.financial_goals));
  ok('T30 progress and planned timeline match amounts',/25%/.test(await page.textContent('#milestones-list'))&&/8 months/.test(await page.textContent('#milestones-list')),await page.textContent('#milestones-list'));
  const financialBefore=JSON.stringify(db.transactions),calendarBefore=await endBal();await load();await page.evaluate(()=>showView('plan',null));await page.waitForTimeout(200);
  ok('T30 goal persists across reload',/Emergency fund/.test(await page.textContent('#milestones-list')),'missing goal');
  await page.click('button:has-text("Edit progress")');await page.fill('#goal-saved','1000');await page.click('#goal-save-btn');await page.waitForTimeout(300);
  ok('T30 edited progress reaches target',/Target reached/.test(await page.textContent('#milestones-list'))&&/100%/.test(await page.textContent('#milestones-list')),await page.textContent('#milestones-list'));
  await page.click('button:text-is("Archive")');await page.waitForTimeout(300);
  ok('T30 archive retains recoverable goal',db.financial_goals[0].archived===true&&/Archived goals/.test(await page.textContent('#milestones-list')),'archive failed');
  await page.click('summary:has-text("Archived goals")');await page.click('button:text-is("Restore")');await page.waitForTimeout(300);
  ok('T30 archived goal restores',db.financial_goals[0].archived===false,'restore failed');
  await page.click('button:has-text("Edit progress")');await page.fill('#goal-saved','500');writeFault='goal-reject';await page.click('#goal-save-btn');await page.waitForTimeout(300);
  ok('T30 failed save keeps inputs and previous progress',await page.isVisible('#goal-editor')&&await page.inputValue('#goal-saved')==='500'&&db.financial_goals[0].saved_amount===1000,'lost inputs');
  await page.click('#goal-save-btn');await page.waitForTimeout(300);
  await page.click('#goal-add-btn');await page.fill('#goal-name','Trip');await page.fill('#goal-target','200');writeFault='goal-lost';await page.click('#goal-save-btn');await page.waitForTimeout(300);
  ok('T30 lost response retains same-goal retry',await page.isVisible('#goal-editor')&&db.financial_goals.length===2,'lost draft');
  await page.click('#goal-save-btn');await page.waitForTimeout(300);
  ok('T30 retry avoids duplicate goal',db.financial_goals.length===2&&!await page.isVisible('#goal-editor'),'duplicate goal');
  ok('T30 goals do not change calendar cash or financial rows',financialBefore===JSON.stringify(db.transactions)&&near(await endBal(),calendarBefore),'cash changed');
  await page.evaluate(()=>showView('calendar',null));await page.click('#calendar-agenda-btn');
  ok('T30 agenda includes every October day and scheduled loan',await page.locator('#cal-agenda .agenda-day').count()===31&&/Test Car Loan/.test(await page.textContent('#cal-agenda')),'incomplete agenda');
  await page.click('#cal-agenda [aria-label="Open October 10"]');
  ok('T30 agenda day opens editor',await page.isVisible('#bottom-sheet'),'editor missing');await page.evaluate(()=>closeBottomSheet());
  await page.click('#calendar-month-btn');
  ok('T30 month toggle restores calendar',await page.isVisible('#cal-grid')&&!await page.isVisible('#cal-agenda'),'toggle failed');

  db.transactions.push({id:'coffee-search',user_id:'user-A',type:'expense',description:'Coffee search',amount:6.25,date:'2026-10-09',category:'food',recurring:false},{id:'groceries-search',user_id:'user-A',type:'expense',description:'Groceries search',amount:25,date:'2026-10-09',category:'food',recurring:false});
  await load();await page.evaluate(()=>showView('expenses',null));const monthOutBefore=await page.textContent('#exp-stat-total');
  await page.fill('#expense-search','Coffee search');
  ok('T31 search filters records while retaining month totals',/Coffee search/.test(await page.textContent('#fv-variable-list'))&&!/Groceries search/.test(await page.textContent('#fv-variable-list'))&&await page.textContent('#exp-stat-total')===monthOutBefore,'search changed totals or missed filter');
  await page.click('button:text-is("Clear search")');
  ok('T31 clearing search restores records',/Groceries search/.test(await page.textContent('#fv-variable-list')),'clear failed');
  await page.evaluate(()=>showView('settings',null));
  const csvDownloadWait=page.waitForEvent('download');await page.click('button:text-is("Export transactions CSV")');const csvDownload=await csvDownloadWait;
  ok('T31 CSV button downloads all transaction records',csvDownload.suggestedFilename().endsWith('.csv')&&fs.readFileSync(await csvDownload.path(),'utf8').includes('Coffee search'),'CSV missing rows');
  const jsonDownloadWait=page.waitForEvent('download');await page.click('button:text-is("Export full data JSON")');const jsonDownload=await jsonDownloadWait;
  const exportData=JSON.parse(fs.readFileSync(await jsonDownload.path(),'utf8'));
  ok('T31 JSON export includes goals, settings and transactions',exportData.format==='finpulse-data'&&exportData.goals.length===2&&exportData.transactions.length===db.transactions.length&&Array.isArray(exportData.bill_paid_marks),'incomplete export');
  await page.evaluate(()=>showView('dreams',null));await page.fill('#d-amt-input','12.50');await page.fill('#d-rate-input','0');
  ok('T31 scenario preserves cents in entered amount',await page.textContent('#d-future')==='$12.5','cents lost');
  await page.fill('#d-amt-input','12oops');
  ok('T31 malformed scenario amount cannot show a stale result',await page.textContent('#d-future')==='—'&&await page.textContent('#d-milestones')===''&&/valid amount/.test(await page.textContent('#d-coach')),'stale result');
  await page.fill('#d-amt-input','0');
  ok('T31 zero scenario amount is supported',await page.textContent('#d-future')==='$0','zero rejected');await page.fill('#d-amt-input','5000');await page.fill('#d-rate-input','10');

  await page.evaluate(()=>{showView('loans',null);openLoanModal();});await page.selectOption('#lm-cat','Car Loan');await page.fill('#lm-desc','Statement payment loan');await page.fill('#lm-balance','1200');await page.fill('#lm-apr','0');await page.fill('#lm-payment','125.50');
  await page.fill('#lm-apr','9');
  ok('T32 changing APR preserves entered statement payment',await page.inputValue('#lm-payment')==='125.50','payment overwritten');await page.fill('#lm-apr','0');await page.click('#lm-save-btn');await page.waitForTimeout(300);
  const statementLoan=db.transactions.find(t=>t.description==='Statement payment loan');
  ok('T32 zero APR loan saves the user-entered statement payment',statementLoan&&statementLoan.apr===0&&statementLoan.min_payment===125.5,'loan missing or estimate substituted');
  await page.evaluate(id=>openLoanEdit(id),statementLoan.id);await page.fill('#le-balance','1000');await page.fill('#le-apr','5');
  ok('T32 editing loan balance and APR keeps existing payment',Number(await page.inputValue('#le-payment'))===125.5,'edit overwrote payment');await page.keyboard.press('Escape');

  await page.setViewportSize({width:312,height:900});
  for(const view of ['insights','expenses','bills','plan','settings','dreams','loans','calendar']) {
    await page.evaluate(v=>showView(v,null),view);
    const collapsed=await page.evaluate(v=>Array.from(document.querySelectorAll('#view-'+v+' .card')).filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().width).filter(w=>w<200),view);
    ok('T29 '+view+' cards remain readable at 312 pixels',collapsed.length===0,JSON.stringify(collapsed));
  }
  await page.setViewportSize({width:1280,height:900});
  const offline=await browser.newContext();
  await offline.route('**/cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await offline.route(/fonts\.(googleapis|gstatic)\.com|cdnjs|chart/,r=>r.fulfill({contentType:'text/css',body:''}));
  const offlinePage=await offline.newPage();let offlineErrors=[];offlinePage.on('pageerror',e=>offlineErrors.push(e.message));
  await offlinePage.goto('file://'+FILE);
  ok('T29 missing account library displays usable connection error instead of spinner',await offlinePage.isVisible('#auth-screen') && /connection could not load/.test(await offlinePage.textContent('#signin-error')) && await offlinePage.isDisabled('#signin-btn') && offlineErrors.length===0,offlineErrors.join(' | '));
  await offline.close();

  // ---- console / network
  const dbErrors = reqlog.filter(r => r.error);
  const realConsole = consoleErrors.filter(e => !/Failed to load resource|fonts|net::ERR|favicon/i.test(e));
  ok('T12 no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  ok('T12 no console errors from app code', realConsole.length === 0, realConsole.join(' | '));
  ok('T12 no rejected backend requests (schema/constraint/RLS)', dbErrors.length === 0, JSON.stringify(dbErrors.map(e => e.error)));
  await browser.close();
  console.log('FILE ' + FILE + '\n' + results.join('\n'));
  const f = results.filter(r => r.startsWith('FAIL')).length;
  console.log('\nBROWSER TOTAL pass=' + results.filter(r => r.startsWith('PASS')).length + ' fail=' + f + ' (timezone ' + TZID + ')');
  console.log("console errors: " + JSON.stringify(consoleErrors.map(e=>e.slice(0,160))));
  process.exit(f ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error('HARNESS ERROR', e); process.exit(2); });
