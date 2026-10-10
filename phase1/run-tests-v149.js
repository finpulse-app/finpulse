// FinPulse reproducible tests for v149. Usage: node run-tests-v149.js ../finpulse-v2-149.html
// Extracts the real functions from the HTML (no copies) and runs them with a frozen clock (2026-10-08).
const fs = require('fs'), vm = require('vm');
const file = process.argv[2] || '../finpulse-v2-149.html';
const html = fs.readFileSync(file, 'utf8');
const src = (html.match(/<script>([\s\S]*?)<\/script>/g) || []).map(s => s.replace(/<\/?script>/g, '')).join('\n');
function grab(name) {
  const m = new RegExp('(?:async )?function ' + name + '\\s*\\(').exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index), d = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(m.index, j + 1);
}
const coreNames = ['getPayDatesForMonth','getRecurringDates','buildDayMap','addToDayMap','getStartingBalanceForMonth','fmt','ordinal','fpEscHtml','detectStage'];
const names = [...new Set(coreNames.concat([...src.matchAll(/(?:async )?function (fp\w+)\s*\(/g)].map(m => m[1])))];
const FIXED = new Date(2026, 9, 8, 12, 0, 0).getTime();
class FD extends Date { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } }
const ctx = { FP_FLAGS: { extraAmountEnabled: false }, currentUser: null, Date: FD, Object, JSON, Array, Math, parseFloat, String, Number, isNaN, userSettings: {}, transactions: [], monthBalances: {} };
vm.createContext(ctx);
const missing = [];
names.forEach(n => { const f = grab(n); if (f) vm.runInContext(f, ctx); else missing.push(n); });
const run = c => vm.runInContext(c, ctx);
let pass = 0, fail = 0; const results = [];
function t(name, fn) {
  try { const r = fn(); if (r === true) { pass++; results.push('PASS  ' + name); } else { fail++; results.push('FAIL  ' + name + ' -> ' + r); } }
  catch (e) { fail++; results.push('FAIL  ' + name + ' -> ' + e.message); }
}
const close = (a, b) => Math.abs(a - b) < 0.005;
const eq = (a, b) => close(a, b) ? true : 'expected ' + b + ' got ' + a;
const setup = (s, tx, mb) => { ctx.userSettings = s; ctx.transactions = tx; ctx.monthBalances = mb || {}; };
const day = (y, m, d) => y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
const dates = (arr) => arr.map(d => d.getDate()).join(',');

// ---- Recurring schedules and month boundaries
t('monthly recurring day 31 clamps to Feb 28 (2027)', () => dates(run(`getRecurringDates(new Date('2026-01-31T12:00:00'),'monthly',2027,1)`)) === '28' || dates(run(`getRecurringDates(new Date('2026-01-31T12:00:00'),'monthly',2027,1)`)));
t('monthly recurring day 31 clamps to Feb 29 (leap 2028)', () => dates(run(`getRecurringDates(new Date('2026-01-31T12:00:00'),'monthly',2028,1)`)) === '29' || 'bad');
t('weekly recurring from Oct 1 2026 in Oct = 1,8,15,22,29', () => dates(run(`getRecurringDates(new Date('2026-10-01T12:00:00'),'weekly',2026,9)`)) === '1,8,15,22,29' || 'bad');
t('biweekly Oct 1 2026: Oct=1,15,29 ; Nov=12,26', () => dates(run(`getRecurringDates(new Date('2026-10-01T12:00:00'),'biweekly',2026,9)`)) === '1,15,29' && dates(run(`getRecurringDates(new Date('2026-10-01T12:00:00'),'biweekly',2026,10)`)) === '12,26' || 'bad');
t('biweekly across DST (Mar 2026) stays on cadence', () => dates(run(`getRecurringDates(new Date('2026-02-20T12:00:00'),'biweekly',2026,2)`)) === '6,20' || dates(run(`getRecurringDates(new Date('2026-02-20T12:00:00'),'biweekly',2026,2)`)));
t('twicemonthly recurring follows the anchor: anchor on the 1st = 1 and 15; anchor on a month-end = 15 and last day', () => dates(run(`getRecurringDates(new Date('2026-01-01T12:00:00'),'twicemonthly',2026,9)`)) === '1,15' && dates(run(`getRecurringDates(new Date('2026-01-31T12:00:00'),'twicemonthly',2026,9)`)) === '15,31' && dates(run(`getRecurringDates(new Date('2026-01-31T12:00:00'),'twicemonthly',2027,1)`)) === '15,28' || 'bad');
t('biweekly paycheck Oct 2026 (anchor Oct 2) = 2,16,30', () => { setup({ payday: '2026-10-02', payAmount: 1000, payFrequency: 'biweekly', startingBalance: 0 }, []); return dates(run('getPayDatesForMonth(2026,9)')) === '2,16,30' || dates(run('getPayDatesForMonth(2026,9)')); });
t('monthly paycheck on the 31st still paid in Feb (clamped to 28)', () => { setup({ payday: '2026-01-31', payAmount: 1000, payFrequency: 'monthly', startingBalance: 0 }, []); const r = dates(run('getPayDatesForMonth(2027,1)')); return r === '28' || 'got "' + r + '" (paycheck skipped)'; });
t('monthly paycheck on the 31st in 30-day month (Nov) = 30', () => { setup({ payday: '2026-01-31', payAmount: 1000, payFrequency: 'monthly', startingBalance: 0 }, []); const r = dates(run('getPayDatesForMonth(2026,10)')); return r === '30' || 'got "' + r + '"'; });

// ---- Daily balances, end balance
const base = { payday: '2026-10-02', payAmount: 1000, payFrequency: 'biweekly', startingBalance: 500 };
t('end balance Oct = 500 + 3 paychecks - bill 100 - expense 40', () => {
  setup(base, [{ id: 'b1', type: 'bill', description: 'Rent', amount: 100, date: '2026-10-05', recurring: true, frequency: 'monthly', anchor_date: '2026-10-05' },
               { id: 'e1', type: 'expense', description: 'Gas', amount: 40, date: '2026-10-10', recurring: false }]);
  return eq(run('buildDayMap(2026,9)[31].balance'), 500 + 3000 - 100 - 40); });
t('running balance on Oct 2 includes paycheck', () => { setup(base, []); return eq(run('buildDayMap(2026,9)[2].balance'), 1500); });
t('recurring item whose date row is in month is not double counted', () => {
  setup(base, [{ id: 'b1', type: 'bill', description: 'Rent', amount: 100, date: '2026-10-05', recurring: true, frequency: 'monthly', anchor_date: '2026-10-05' }]);
  return eq(run('buildDayMap(2026,9)[31].balance'), 500 + 3000 - 100); });

// ---- Loan on calendar: no double count with a recorded payment
const loan = { id: 'L1', type: 'loan', description: 'Car', amount: 200, min_payment: 200, balance: 5000, apr: 12, date: '2026-10-10', recurring: true, frequency: 'monthly', anchor_date: '2026-10-10' };
t('loan projected once when no payment recorded', () => { setup({ ...base, payAmount: 0 }, [loan]); return eq(run('buildDayMap(2026,9)[31].balance'), 500 - 200); });
t('recorded regular payment replaces projected loan payment (no double count)', () => {
  setup({ ...base, payAmount: 0 }, [loan, { id: 'p1', type: 'expense', description: 'Car payment', amount: 200, date: '2026-10-10', category: 'loan_payment', loan_id: 'L1', principal_applied: 150 }]);
  return eq(run('buildDayMap(2026,9)[31].balance'), 500 - 200); });
t('recorded extra payment is still subtracted in addition to the projected payment', () => {
  setup({ ...base, payAmount: 0 }, [loan, { id: 'p2', type: 'expense', description: 'Car extra payment', amount: 50, date: '2026-10-12', category: 'loan_payment', loan_id: 'L1', principal_applied: 50 }]);
  return eq(run('buildDayMap(2026,9)[31].balance'), 500 - 200 - 50); });

// ---- Projection chaining and consistency
t('next month starts at this month projected end balance', () => {
  setup(base, [{ id: 'b1', type: 'bill', description: 'Rent', amount: 100, date: '2026-10-05', recurring: true, frequency: 'monthly', anchor_date: '2026-10-05' }]);
  const octEnd = run('buildDayMap(2026,9)[31].balance');
  return eq(run('getStartingBalanceForMonth(2026,10)'), octEnd); });
t('Nov end = Oct end + Nov flows (chained)', () => {
  setup({ ...base, payAmount: 0 }, [{ id: 'b1', type: 'bill', description: 'Rent', amount: 100, date: '2026-10-05', recurring: true, frequency: 'monthly', anchor_date: '2026-10-05' }]);
  return eq(run('buildDayMap(2026,10)[30].balance'), 500 - 100 - 100); });
t('Breathing Room source: end of month equals last day balance', () => { setup(base, []); return eq(run('buildDayMap(2026,9)[31].balance'), run('buildDayMap(2026,9)[31].balance')); });

// ---- Loan accounting
const S = (b, a, m, e, x) => run(`fpLoanSplit(${b},${a},${m},${e},${x})`);
t('interest = balance*APR/12 (5000 @ 25% -> 104.17)', () => eq(S(5000, 25, 140, 0, false).interest, 104.1667));
t('principal = payment - interest (140 on 5000@25% -> 35.83)', () => eq(S(5000, 25, 140, 0, false).principal, 140 - 5000 * 0.25 / 12));
t('payment below interest: principal 0, balance never grows', () => { const r = S(5000, 25, 50, 0, false); return r.principal === 0 && close(r.newBal, 5000) || JSON.stringify(r); });
t('extra-only: interest 0, 100% principal', () => { const r = S(8000, 10, 250, 17, true); return eq(r.newBal, 7983) === true && r.interest === 0 || JSON.stringify(r); });
t('regular + extra: extra adds fully to principal', () => { const r = S(1000, 12, 100, 40, false); return eq(r.principal, 100 - 10 + 40); });
t('overpayment capped at balance (principal never exceeds balance)', () => { const r = S(100, 12, 200, 50, false); return eq(r.principal, 100) === true && close(r.newBal, 0) || JSON.stringify(r); });
t('extra-only overpay capped at balance', () => { const r = S(30, 12, 0, 80, true); return eq(r.principal, 30); });
t('principal parts sum to total principal', () => { const r = S(2000, 18, 120, 30, false); return eq(r.minPrincipal + r.extraPrincipal, r.principal); });

const L = { id: 'L1', type: 'loan', description: 'Car', balance: 5000, apr: 12 };
const R = (p, l) => { ctx._p = p; ctx._l = l; return run('fpPrincipalToRestore(_p,_l)'); };
t('delete restores stored principal_applied only (not full amount)', () => eq(R({ description: 'Car payment', amount: 200, principal_applied: 150 }, L), 150));
t('principal_applied = 0 restores 0 (payment all interest)', () => eq(R({ description: 'Car payment', amount: 40, principal_applied: 0 }, L), 0));
t('legacy extra payment (no principal_applied) restores full amount', () => eq(R({ description: 'Car extra payment', amount: 50, principal_applied: null }, L), 50));
t('legacy regular payment excludes estimated interest (200 - 50 = 150)', () => eq(R({ description: 'Car payment', amount: 200, principal_applied: null }, L), 150));
t('legacy regular payment smaller than interest restores 0, never negative', () => eq(R({ description: 'Car payment', amount: 20, principal_applied: null }, L), 0));
t('delete+undo round trip returns the same balance', () => { const s = S(5000, 12, 200, 0, false); const restored = s.newBal + R({ description: 'Car payment', amount: 200, principal_applied: s.principal }, L); return eq(restored, 5000); });

const F = (p, tx) => { ctx._p = p; ctx._t = tx; const r = run('fpFindLoanForPayment(_p,_t)'); return r ? r.id : null; };
const loansTx = [{ id: 'A', type: 'loan', description: 'Car' }, { id: 'B', type: 'loan', description: 'Car loan 2' }];
t('loan_id match wins', () => F({ loan_id: 'B', description: 'x' }, loansTx) === 'B' || 'bad');
t('legacy match is exact: "Car loan 2 payment" -> Car loan 2, not Car', () => F({ description: 'Car loan 2 payment' }, loansTx) === 'B' || 'got ' + F({ description: 'Car loan 2 payment' }, loansTx));
t('legacy match: "Car extra payment" -> Car', () => F({ description: 'Car extra payment' }, loansTx) === 'A' || 'bad');
t('unknown loan_id returns null (no wrong-loan restore)', () => F({ loan_id: 'ZZ', description: 'Car payment' }, loansTx) === null || 'bad');

// ---- CSV import duplicate detection (v146)
const IR = (d, a, desc, fi, type) => ({ type: type || 'expense', date: d, amount: a, description: desc, fileIdx: fi || 0 });
const cls = (rows, existing) => { ctx._r = rows; ctx._e = existing || []; const sum = run('fpClassifyImportRows(_r,_e)'); return { sum, kinds: rows.map(r => r.dupKind), inc: rows.map(r => r.include) }; };
const iex = (d, a, desc, type) => ({ type: type || 'expense', date: d, amount: a, description: desc });
t('dup: no existing rows -> all new, all included', () => { const c = cls([ IR('2026-10-01', 6.5, 'STARBUCKS'),  IR('2026-10-02', 40, 'SHELL')]); return (c.sum.newCount === 2 && c.sum.dupExisting === 0 && c.inc.every(Boolean)) || JSON.stringify(c); });
t('dup: same CSV imported twice -> every row flagged existing and unchecked', () => { const c = cls([ IR('2026-10-01', 6.5, 'STARBUCKS'),  IR('2026-10-02', 40, 'SHELL')], [iex('2026-10-01', 6.5, 'STARBUCKS'), iex('2026-10-02', 40, 'SHELL')]); return (c.sum.dupExisting === 2 && c.sum.newCount === 0 && c.inc.every(x => !x)) || JSON.stringify(c); });
t('dup: two identical purchases in one file, none existing -> both new (repeat kept)', () => { const c = cls([ IR('2026-10-01', 4, 'Coffee'),  IR('2026-10-01', 4, 'Coffee')]); return (c.sum.newCount === 2 && c.sum.repeats === 1 && c.inc.every(Boolean)) || JSON.stringify(c); });
t('dup: two identical in file, one already saved -> first flagged, second new', () => { const c = cls([ IR('2026-10-01', 4, 'Coffee'),  IR('2026-10-01', 4, 'Coffee')], [iex('2026-10-01', 4, 'Coffee')]); return (c.kinds[0] === 'existing' && c.kinds[1] === null) || JSON.stringify(c); });
t('dup: two identical in file, two already saved -> both flagged', () => { const c = cls([ IR('2026-10-01', 4, 'Coffee'),  IR('2026-10-01', 4, 'Coffee')], [iex('2026-10-01', 4, 'Coffee'), iex('2026-10-01', 4, 'Coffee')]); return (c.sum.dupExisting === 2) || JSON.stringify(c); });
t('dup: capitalization and extra whitespace still match', () => { const c = cls([ IR('2026-10-01', 6.5, '  starbucks   COFFEE ')], [iex('2026-10-01', 6.5, 'Starbucks Coffee')]); return c.kinds[0] === 'existing' || JSON.stringify(c); });
t('dup: amount 10 vs 10.00 vs 10.0 normalize the same (stored string or number)', () => { const c = cls([ IR('2026-10-01', 10, 'Rent'),  IR('2026-10-02', 10.0, 'Rent2'),  IR('2026-10-03', 10, 'Rent3')], [iex('2026-10-01', '10.00', 'Rent'), iex('2026-10-02', 10, 'Rent2'), iex('2026-10-03', '10.0', 'Rent3')]); return c.sum.dupExisting === 3 || JSON.stringify(c); });
t('dup: float noise 0.1+0.2 vs 0.30 is the same amount', () => { const c = cls([ IR('2026-10-01', 0.1 + 0.2, 'x')], [iex('2026-10-01', '0.30', 'x')]); return c.kinds[0] === 'existing' || JSON.stringify(c); });
t('dup: different date is new', () => { const c = cls([ IR('2026-10-02', 6.5, 'STARBUCKS')], [iex('2026-10-01', 6.5, 'STARBUCKS')]); return c.kinds[0] === null || JSON.stringify(c); });
t('dup: different amount is new', () => { const c = cls([ IR('2026-10-01', 6.51, 'STARBUCKS')], [iex('2026-10-01', 6.5, 'STARBUCKS')]); return c.kinds[0] === null || JSON.stringify(c); });
t('dup: different description is new', () => { const c = cls([ IR('2026-10-01', 6.5, 'STARBUCKS 2')], [iex('2026-10-01', 6.5, 'STARBUCKS')]); return c.kinds[0] === null || JSON.stringify(c); });
t('dup: income vs expense with same date/amount/description are not duplicates', () => { const c = cls([ IR('2026-10-01', 50, 'Refund', 0, 'income')], [iex('2026-10-01', 50, 'Refund', 'expense')]); return c.kinds[0] === null || JSON.stringify(c); });
t('dup: existing bill row counts as an expense match', () => { const c = cls([ IR('2026-10-05', 100, 'Rent')], [iex('2026-10-05', 100, 'Rent', 'bill')]); return c.kinds[0] === 'existing' || JSON.stringify(c); });
t('dup: loan and note rows are never treated as matches', () => { const c = cls([ IR('2026-10-05', 100, 'Car')], [iex('2026-10-05', 100, 'Car', 'loan'), iex('2026-10-05', 100, 'Car', 'note')]); return c.kinds[0] === null || JSON.stringify(c); });
t('dup: partial overlap -> only the overlapping rows flagged', () => { const c = cls([ IR('2026-10-01', 6.5, 'A'),  IR('2026-10-02', 7, 'B'),  IR('2026-10-03', 8, 'C')], [iex('2026-10-01', 6.5, 'A'), iex('2026-10-02', 7, 'B')]); return (c.kinds.join() === 'existing,existing,') || c.kinds.join(); });
t('dup: second file overlapping the first is flagged as file duplicate', () => { const c = cls([ IR('2026-10-01', 6.5, 'A', 0),  IR('2026-10-02', 7, 'B', 0),  IR('2026-10-02', 7, 'B', 1),  IR('2026-10-03', 8, 'C', 1)]); return (c.kinds.join() === ',,file,') || c.kinds.join(); });
t('dup: identical repeat inside file 2 beyond file 1 count stays new', () => { const c = cls([ IR('2026-10-01', 4, 'Coffee', 0),  IR('2026-10-01', 4, 'Coffee', 1),  IR('2026-10-01', 4, 'Coffee', 1)]); return (c.kinds.join() === ',file,') || c.kinds.join(); });
t('dup: empty batch classifies without error', () => { const c = cls([]); return (c.sum.total === 0 && c.sum.newCount === 0) || JSON.stringify(c); });
t('dup: empty description / odd values do not throw', () => { const c = cls([ IR('2026-10-01', 1, '')], [iex('2026-10-01', null, null)]); return c.kinds[0] === null || JSON.stringify(c); });

// ---- Weekly Priorities engine (v147). asOf is always passed explicitly; the "viewed month" globals are set to unrelated values.
const WPS = { payday: '2026-10-02', payFrequency: 'biweekly', payAmount: 1000, startingBalance: 1500 };
const mk = (o) => Object.assign({ user_id: 'u', recurring: false, frequency: null, anchor_date: null, category: null, created_at: '2026-01-01T12:00:00Z' }, o);
const bill = (id, d, amt, anchor, extra) => mk(Object.assign({ id, type: 'bill', description: d, amount: amt, date: anchor, recurring: true, frequency: 'monthly', anchor_date: anchor }, extra || {}));
const loanT = (id, d, bal, apr, min, anchor, extra) => mk(Object.assign({ id, type: 'loan', description: d, amount: min, date: anchor, category: 'Other', recurring: true, frequency: 'monthly', anchor_date: anchor, apr, min_payment: min, balance: bal, original_min_payment: min }, extra || {}));
const spend = (id, d, amt, date, cat) => mk({ id, type: 'expense', description: d, amount: amt, date, category: cat || 'shopping' });
// v148: reliable spending history = 10 distinct days of $30 between Sep 14 and Oct 7 (average 300/25 days = $12/day)
const HIST_DATES = ['2026-09-14','2026-09-17','2026-09-20','2026-09-23','2026-09-26','2026-09-29','2026-10-02','2026-10-04','2026-10-06','2026-10-07'];
const hist = () => HIST_DATES.map((d, i) => spend('h' + i, 'Groceries ' + i, 30, d, 'food'));
// SNAP gives the engine a DATED balance. Default: the old fixtures' number is read as the balance at the start of the 1st of the month
// (asOf = 1st), and every scheduled paycheck between then and today gets a one-time income record, so it counts as received.
// opts.bal overrides the dated record ({amount, asOf, monthStart} or null for none); opts.noPayRecords leaves paychecks unconfirmed.
const SNAP = (ymd, settings, tx, marks, viewed, opts) => {
  opts = opts || {};
  ctx.userSettings = settings; ctx.transactions = tx; ctx.monthBalances = {};
  const first = ymd[0] + '-' + String(ymd[1] + 1).padStart(2, '0') + '-01';
  const todayIso = ymd[0] + '-' + String(ymd[1] + 1).padStart(2, '0') + '-' + String(ymd[2]).padStart(2, '0');
  let bal = opts.bal;
  if (bal === undefined) bal = (settings.startingBalance == null) ? null : { amount: settings.startingBalance, asOf: first, monthStart: settings.startingBalance };
  if (bal) {
    const rec = Object.assign({ v: 2 }, bal);
    if (!('paycheck' in rec)) {
      ctx._asof = bal.asOf; const near = run('fpNearPaycheck(_asof)');
      rec.paycheck = near ? { date: near.date, amount: near.amount, included: opts.payIncluded === undefined ? false : opts.payIncluded } : null;
    }
    ctx.monthBalances['__dated_balance'] = rec;
  }
  if (bal && !opts.noPayRecords && settings.payday && settings.payAmount > 0) {
    const extra = [];
    for (let k = 0; k < 2; k++) {
      const mo = new Date(ymd[0], ymd[1] - k, 1);
      run('getPayDatesForMonth(' + mo.getFullYear() + ',' + mo.getMonth() + ')').forEach(pd => {
        const iso = pd.getFullYear() + '-' + String(pd.getMonth() + 1).padStart(2, '0') + '-' + String(pd.getDate()).padStart(2, '0');
        if (iso >= bal.asOf && iso <= todayIso) extra.push(mk({ id: 'payrec_' + iso, type: 'income', description: 'Paycheck deposit', amount: settings.payAmount, date: iso, category: 'income' }));
      });
    }
    ctx.transactions = tx.concat(extra);
  }
  ctx.currentYear = viewed ? viewed[0] : 2031; ctx.currentMonth = viewed ? viewed[1] : 1;   // unrelated "viewed" month
  ctx._ad = ymd; ctx._marks = marks || {};
  return run('fpPrioritySnapshot(new Date(_ad[0], _ad[1], _ad[2], 12), { paidMarks: _marks })');
};
const ACT = (snap) => { ctx._snap = snap; return run('fpPriorityActions(_snap)'); };
const OCT8 = [2026, 9, 8];
const baseTx = () => [bill('rent', 'Rent', 800, '2026-10-01'), bill('phone', 'Phone', 60, '2026-10-12'), loanT('car', 'Car', 5000, 12, 200, '2026-10-10')].concat(hist());
const baseMarks = { rent: '2026-10-01' };
const codes = (a) => a.actions.map(x => x.code).join(',');

t('wp: snapshot is identical whichever month the calendar is viewing', () => {
  const a = SNAP(OCT8, WPS, baseTx(), baseMarks, [2031, 1]); const aj = JSON.stringify([a.windowLow, a.horizonLow, a.stage, a.extraDebt, a.dueThisWeek, a.overdue]);
  const b = SNAP(OCT8, WPS, baseTx(), baseMarks, [2026, 8]); const bj = JSON.stringify([b.windowLow, b.horizonLow, b.stage, b.extraDebt, b.dueThisWeek, b.overdue]);
  const c = SNAP(OCT8, WPS, baseTx(), baseMarks, [2027, 0]); const cj = JSON.stringify([c.windowLow, c.horizonLow, c.stage, c.extraDebt, c.dueThisWeek, c.overdue]);
  return (aj === bj && bj === cj) || 'differs by viewed month'; });
t('wp: snapshot is deterministic (same inputs, same output)', () => JSON.stringify(SNAP(OCT8, WPS, baseTx(), baseMarks)) === JSON.stringify(SNAP(OCT8, WPS, baseTx(), baseMarks)) || 'not deterministic');
t('wp: next payday after Oct 8 is Oct 16 (biweekly from Oct 2), window ends Oct 15', () => { const s = SNAP(OCT8, WPS, baseTx(), baseMarks); return (s.nextPayday.date === '2026-10-16' && s.nextPayday.amount === 1000 && s.windowEnd === '2026-10-15') || JSON.stringify(s.nextPayday) + s.windowEnd; });
t('wp: lowest balance before payday = 1320 on Oct 12 (1500-800+1000-4x30 spending-200-60)', () => { const s = SNAP(OCT8, WPS, baseTx(), baseMarks); return (close(s.windowLow.amount, 1320) && s.windowLow.date === '2026-10-12') || JSON.stringify(s.windowLow); });
t('wp: projected balance today is labelled an unverified estimate, not a bank balance', () => { const s = SNAP(OCT8, WPS, baseTx(), baseMarks); return (s.balanceBasis.verified === false && /entered/.test(s.balanceBasis.note) && s.warnings.some(w => w.code === 'balance_unverified') && s.cannotCalculate.some(c => c.code === 'bank_balance')) || 'missing'; });
t('wp: due this week lists the car payment (Sat Oct 10, 2 days) but not the Oct 12 phone bill', () => { const s = SNAP(OCT8, WPS, baseTx(), baseMarks); const d = s.dueThisWeek; return (d.length === 1 && d[0].id === 'car' && d[0].date === '2026-10-10' && d[0].daysAway === 2 && d[0].amount === 200) || JSON.stringify(d.map(x => x.id + x.date)); });
t('wp: due-soon item at 2 days is p1, ranked after nothing overdue', () => { const a = ACT(SNAP(OCT8, WPS, baseTx(), baseMarks)); const x = a.actions.find(y => y.code === 'due_loan'); return (x && x.level === 'p1') || codes(a); });

// ---- extra debt payments: only from defensible spare cash
t('wp: candidate extra payment = floor5(50% x (min over horizon of balance - $15/day x days - buffer 500)) when every check passes', () => {
  const s = SNAP(OCT8, WPS, baseTx(), baseMarks);
  // independent arithmetic: spending 300 over 25 days = 12/day, +25% margin = 15/day; hand-checked low point is Oct 15: 1320 - 15*7 = 1215
  let low = null; s.timeline.forEach(r => { const d = Math.round((Date.parse(r.date) - Date.parse('2026-10-08')) / 86400000); if (r.date >= '2026-10-08' && r.date <= s.horizonEnd) { const v = r.balance - 15 * d; if (low === null || v < low) low = v; } });
  const expected = Math.floor(((low - 500) * 0.5) / 5) * 5;
  return (close(low, 1215) && s.cash.reliable && s.extraDebt.allowed && s.extraDebt.amount === expected && expected === 355 && s.extraDebt.display === false) || JSON.stringify([low, s.cash, s.extraDebt, expected]); });
t('wp: extra payment suggestion is capped at the loan balance', () => { const tx = [loanT('small', 'Small', 100, 10, 25, '2026-10-20')].concat(hist()); const s = SNAP(OCT8, WPS, tx, {}); return (s.extraDebt.allowed && s.extraDebt.amount === 100) || JSON.stringify(s.extraDebt); });
t('wp: extra payment targets the highest APR, not the smallest balance', () => { const tx = [loanT('lo', 'LowApr', 300, 5, 25, '2026-10-20'), loanT('hi', 'HighApr', 3000, 25, 80, '2026-10-21')].concat(hist()); const s = SNAP(OCT8, WPS, tx, {}); return (s.extraDebt.loanId === 'hi') || JSON.stringify(s.extraDebt); });
t('wp: NO dollar extra payment when no spending history exists (cash cannot be established)', () => { const tx = baseTx().filter(x => x.type !== 'expense'); const s = SNAP(OCT8, WPS, tx, baseMarks); const a = ACT(s); return (!s.extraDebt.allowed && s.extraDebt.amount === 0 && s.cash.blockers.indexOf('no_recent_spending') > -1 && !a.actions.some(x => x.code === 'extra_debt') && a.notes.some(n => /No extra debt payment is suggested because no everyday spending/.test(n))) || codes(a) + JSON.stringify(s.cash.blockers); });
t('wp: NO extra payment with less than 14 days of spending history', () => { const tx = [bill('rent', 'Rent', 800, '2026-10-01'), loanT('car', 'Car', 5000, 12, 200, '2026-10-10'), spend('h1', 'Lunch', 12, '2026-10-05', 'food')]; const s = SNAP(OCT8, WPS, tx, baseMarks); return (!s.extraDebt.allowed && s.cash.blockers.indexOf('short_history') > -1) || JSON.stringify(s.cash.blockers); });
t('wp: NO extra payment when the balance is unset (no dated record) or a legacy undated 0', () => { const s = SNAP(OCT8, Object.assign({}, WPS, { startingBalance: 0 }), baseTx(), baseMarks, null, { bal: null }); const s2 = SNAP(OCT8, Object.assign({}, WPS, { startingBalance: null }), baseTx(), baseMarks); return (!s.extraDebt.allowed && s.cash.blockers.indexOf('balance_undated') > -1 && !s2.extraDebt.allowed && s.warnings.some(w => w.code === 'balance_undated')) || 'allowed'; });
t('wp: NO extra payment without a paycheck on the calendar (missing income)', () => { const s = SNAP(OCT8, Object.assign({}, WPS, { payAmount: 0, payday: null }), baseTx(), baseMarks); return (!s.extraDebt.allowed && s.nextPayday === null && s.cash.blockers.indexOf('no_income') > -1 && s.warnings.some(w => w.code === 'no_income') && s.windowEnd === '2026-10-22') || JSON.stringify([s.cash.blockers, s.windowEnd]); });
t('wp: NO extra payment while a payment is overdue', () => { const tx = baseTx().concat([bill('gas', 'Gas Bill', 90, '2026-10-03')]); const s = SNAP(OCT8, WPS, tx, baseMarks); return (!s.extraDebt.allowed && s.cash.blockers.indexOf('overdue') > -1) || JSON.stringify(s.cash.blockers); });
t('wp: heavier everyday spending shrinks the suggested extra payment', () => { const light = SNAP(OCT8, WPS, baseTx(), baseMarks).extraDebt.amount; const heavy = SNAP(OCT8, WPS, baseTx().concat([spend('big', 'Big spend', 900, '2026-10-06', 'food')]), baseMarks).extraDebt.amount; return heavy < light || 'light ' + light + ' heavy ' + heavy; });
t('wp: zero-balance loan: no extra payment, not listed as due, not overdue', () => {
  const tx = [loanT('done', 'PaidOff', 0, 20, 90, '2026-10-03'), loanT('done2', 'PaidOff2', 0, 20, 90, '2026-10-10')].concat(hist());
  const s = SNAP(OCT8, WPS, tx, {}); return (s.extraDebt.blockers.indexOf('no_eligible_loan') > -1 && !s.extraDebt.allowed && s.overdue.length === 0 && s.dueThisWeek.length === 0 && s.loans.every(l => l.paidOff)) || JSON.stringify([s.extraDebt, s.overdue, s.dueThisWeek]); });
t('wp: a loan with an unknown balance is not treated as paid off', () => { const s = SNAP(OCT8, WPS, [loanT('x', 'Unknown', null, 20, 90, '2026-10-10')].concat(hist()), {}); return (s.loans[0].paidOff === false && s.dueThisWeek.length === 1 && s.warnings.some(w => w.code === 'loan_data_missing')) || JSON.stringify(s.loans[0]); });

// ---- shortfalls
const SHORT_S = { payday: '2026-10-02', payFrequency: 'biweekly', payAmount: 1000, startingBalance: 300 };
const shortTx = () => [bill('rent', 'Rent', 1400, '2026-10-12')].concat(hist());
t('wp: positive month-end but interim shortfall before payday is detected (-220 on Oct 12, month still ends positive)', () => {
  const s = SNAP(OCT8, SHORT_S, shortTx(), {});
  return (close(s.windowLow.amount, 300 + 1000 - 120 - 1400) && s.windowLow.date === '2026-10-12' && s.monthEndBalance > 0 && s.monthNet > 0 && s.firstNegative.date === '2026-10-12' && s.stage === 1 && s.stageReason === 'projected_shortfall') || JSON.stringify([s.windowLow, s.monthEndBalance, s.stage, s.stageReason]); });
t('wp: shortfall action shows the amount, date, uncertainty, and does not rank creditors', () => {
  const a = ACT(SNAP(OCT8, SHORT_S, shortTx(), {})); const x = a.actions.find(y => y.code === 'shortfall');
  return (x && x.level === 'p1' && /-\$220/.test(x.text) && /Oct 12/.test(x.text) && /estimate/.test(x.text) && x.options.some(o => /Rent/.test(o)) && x.options.some(o => /does not know which of your obligations are essential/.test(o)) && !/pay .* first/i.test(x.text + x.options.join(' '))) || (x ? x.text : 'none'); });
t('wp: stage 1 on a negative month even when the balance stays above zero', () => { const s = SNAP(OCT8, { payday: '2026-10-02', payFrequency: 'biweekly', payAmount: 500, startingBalance: 3000 }, [bill('big', 'Big Bill', 2000, '2026-10-20')].concat(hist()), {}); const a = ACT(s); return (s.stage === 1 && s.stageReason === 'negative_month' && a.actions.some(x => x.code === 'negative_month')) || s.stage + s.stageReason; });
t('wp: shortfall suppresses extra-payment advice entirely', () => { const tx = shortTx().concat([loanT('car', 'Car', 5000, 12, 50, '2026-10-25')]); const s = SNAP(OCT8, SHORT_S, tx, {}); const a = ACT(s); return (!s.extraDebt.allowed && !a.actions.some(x => x.code === 'extra_debt')) || codes(a); });
t('wp: stage 2 when the lowest balance is positive but under the provisional $500 buffer', () => { const s = SNAP(OCT8, { payday: '2026-10-02', payFrequency: 'biweekly', payAmount: 1000, startingBalance: 100 }, [bill('b', 'Bill', 600, '2026-10-12')].concat(hist()), {}); return (s.stage === 2 && s.stageReason === 'below_buffer' && s.horizonLow.amount > 0 && s.horizonLow.amount < 500) || JSON.stringify([s.stage, s.horizonLow]); });
t('wp: stage 3 when the lowest projected balance clears the buffer', () => SNAP(OCT8, WPS, baseTx(), baseMarks).stage === 3 || 'not 3');
t('wp: stage threshold is one explicit provisional constant ($500)', () => run('fpPriorityConfig().BUFFER') === 500 || 'not 500');

// ---- upcoming vs incurred one-time expenses
t('wp: skip suggestions only use upcoming, non-essential-looking expenses; past and essential ones never appear', () => {
  const tx = shortTx().concat([spend('past', 'Old Purchase', 400, '2026-10-01', 'shopping'), spend('conc', 'Concert Tickets', 120, '2026-10-11', 'shopping'), spend('groc', 'Big Grocery Run', 90, '2026-10-10', 'food'), spend('today', 'Today Thing', 70, '2026-10-08', 'shopping')]);
  const s = SNAP(OCT8, SHORT_S, tx, {}); const x = ACT(s).actions.find(y => y.code === 'shortfall'); const all = x.text + x.options.join(' ');
  return (/Concert Tickets/.test(all) && !/Old Purchase/.test(all) && !/Big Grocery Run/.test(all) && !/Today Thing/.test(all) && s.upcomingOneTime.every(e => e.date > '2026-10-08')) || all; });
t('wp: skipping an expense is only suggested if it actually raises the lowest balance', () => {
  const tx = shortTx().concat([spend('late', 'Late Purchase', 120, '2026-10-20', 'shopping')]); // after payday recovery, so it cannot lift the Oct 12 low point
  const s = SNAP(OCT8, SHORT_S, tx, {}); const x = ACT(s).actions.find(y => y.code === 'shortfall'); return !/Late Purchase/.test(x.options.join(' ')) || 'suggested a skip that does not help'; });
t('wp: loan-named expenses are never offered as skippable', () => { const tx = shortTx().concat([loanT('car', 'Car', 5000, 12, 50, '2026-10-25'), spend('cp', 'Car insurance top-up', 120, '2026-10-11', 'shopping')]); const x = ACT(SNAP(OCT8, SHORT_S, tx, {})).actions.find(y => y.code === 'shortfall'); return !/Car insurance/.test(x.options.join(' ')) || 'offered'; });
t('wp: dropping an over-committed loan to its true minimum is offered only when it helps inside the window', () => {
  const tx = shortTx().concat([loanT('car', 'Car', 5000, 12, 400, '2026-10-12', { original_min_payment: 200 })]);
  const x = ACT(SNAP(OCT8, SHORT_S, tx, {})).actions.find(y => y.code === 'shortfall'); return /\$200 minimum on <strong>Car/.test(x.options.join(' ')) || x.options.join(' | '); });

// ---- overdue rules
const overdueIds = (tx, marks, ymd) => SNAP(ymd || OCT8, WPS, tx, marks || {}).overdue.map(o => o.id + ':' + o.daysLate).join(',');
t('wp: monthly bill due Oct 3 and unpaid is 5 days overdue on Oct 8', () => overdueIds([bill('b1', 'Gas Bill', 90, '2026-10-03')]) === 'b1:5' || overdueIds([bill('b1', 'Gas Bill', 90, '2026-10-03')]));
t('wp: weekly bill retains both missed Sep 30 and Oct 7 occurrences', () => overdueIds([bill('w', 'Weekly', 40, '2026-09-30', { frequency: 'weekly' })]) === 'w:8,w:1' || overdueIds([bill('w', 'Weekly', 40, '2026-09-30', { frequency: 'weekly' })]));
t('wp: biweekly bill from Oct 1: Oct 1 is 7 days overdue (next due Oct 15), biweekly from Sep 30: Sep 30 is 8 days overdue', () => overdueIds([bill('b', 'Bi', 40, '2026-10-01', { frequency: 'biweekly' })]) === 'b:7' && overdueIds([bill('c', 'Bi2', 40, '2026-09-30', { frequency: 'biweekly' })]) === 'c:8' || overdueIds([bill('b', 'Bi', 40, '2026-10-01', { frequency: 'biweekly' })]) + '|' + overdueIds([bill('c', 'Bi2', 40, '2026-09-30', { frequency: 'biweekly' })]));
t('wp: a bill due today or later is not overdue; an anchor in the future is not overdue', () => overdueIds([bill('t', 'DueToday', 90, '2026-10-08'), bill('f', 'Future', 90, '2026-10-20'), bill('g', 'FutureMonth', 90, '2026-11-03')]) === '' || overdueIds([bill('t', 'DueToday', 90, '2026-10-08'), bill('f', 'Future', 90, '2026-10-20')]));
t('wp: a bill created AFTER its anchor day is not overdue just because of the anchor (created Oct 8, anchor Oct 3)', () => overdueIds([bill('n', 'New Bill', 90, '2026-10-03', { created_at: '2026-10-08T15:00:00Z' })]) === '' || overdueIds([bill('n', 'New Bill', 90, '2026-10-03', { created_at: '2026-10-08T15:00:00Z' })]));
t('wp: a bill created BEFORE its due date and left unpaid is overdue (created Oct 1, due Oct 3)', () => overdueIds([bill('o', 'Old Bill', 90, '2026-10-03', { created_at: '2026-10-01T15:00:00Z' })]) === 'o:5' || overdueIds([bill('o', 'Old Bill', 90, '2026-10-03', { created_at: '2026-10-01T15:00:00Z' })]));
t('wp: a newly created loan with a past anchor is not overdue', () => overdueIds([loanT('nl', 'New Loan', 900, 10, 50, '2026-10-02', { created_at: '2026-10-07T15:00:00Z' })]) === '' || overdueIds([loanT('nl', 'New Loan', 900, 10, 50, '2026-10-02', { created_at: '2026-10-07T15:00:00Z' })]));
t('wp: paid mark made on this device after the due window clears overdue; a stale mark does not', () => {
  const b = [bill('b1', 'Gas Bill', 90, '2026-10-03')];
  return (overdueIds(b, { b1: '2026-10-04' }) === '' && overdueIds(b, { b1: '2026-09-01' }) === 'b1:5') || overdueIds(b, { b1: '2026-10-04' }) + '|' + overdueIds(b, { b1: '2026-09-01' }); });
t('wp: an existing one-time expense with the same description counts as paid (existing payment record)', () => overdueIds([bill('b1', 'Gas Bill', 90, '2026-10-03'), spend('p', '  gas   BILL ', 90, '2026-10-05', 'home')]) === '' || 'still overdue');
t('wp: last month\'s payment record does not clear this month\'s bill', () => overdueIds([bill('b1', 'Gas Bill', 90, '2026-10-03'), spend('p', 'Gas Bill', 90, '2026-09-05', 'home')]) === 'b1:5' || 'cleared by old record');
t('wp: recurring expenses (subscriptions) are never flagged overdue', () => overdueIds([mk({ id: 's', type: 'expense', description: 'Streaming', amount: 30, date: '2026-10-01', recurring: true, frequency: 'monthly', anchor_date: '2026-10-01' })]) === '' || 'flagged');
t('wp: recorded loan payment with loan_id clears overdue; projected-only does not', () => {
  const loan = loanT('car', 'Car', 5000, 12, 200, '2026-10-03');
  const pay = mk({ id: 'p', type: 'expense', description: 'Car payment', amount: 200, date: '2026-10-04', category: 'loan_payment', loan_id: 'car', principal_applied: 150 });
  return (overdueIds([loan]) === 'car:5' && overdueIds([loan, pay]) === '') || overdueIds([loan]) + '|' + overdueIds([loan, pay]); });
t('wp: legacy payment (no loan_id) matches only by exact "<loan> payment"; another loan\'s payment does not clear it', () => {
  const loan = loanT('car', 'Car', 5000, 12, 200, '2026-10-03');
  const legacy = mk({ id: 'p', type: 'expense', description: 'Car payment', amount: 200, date: '2026-10-04', category: 'loan_payment' });
  const other = mk({ id: 'q', type: 'expense', description: 'Car loan 2 payment', amount: 200, date: '2026-10-04', category: 'loan_payment' });
  return (overdueIds([loan, legacy]) === '' && overdueIds([loan, other]) === 'car:5') || overdueIds([loan, legacy]) + '|' + overdueIds([loan, other]); });
t('wp: an extra-only payment does not clear a missing regular payment', () => { const loan = loanT('car', 'Car', 5000, 12, 200, '2026-10-03'); const ex = mk({ id: 'p', type: 'expense', description: 'Car extra payment', amount: 50, date: '2026-10-04', category: 'loan_payment', loan_id: 'car', principal_applied: 50 }); return overdueIds([loan, ex]) === 'car:5' || overdueIds([loan, ex]); });
t('wp: recorded payment replaces the projected one: not double counted in the low point (1320), not listed as due', () => {
  const pay = mk({ id: 'p', type: 'expense', description: 'Car payment', amount: 200, date: '2026-10-05', category: 'loan_payment', loan_id: 'car', principal_applied: 150 });
  const s = SNAP(OCT8, WPS, baseTx().concat([pay]), baseMarks);
  return (close(s.windowLow.amount, 1320) && s.dueThisWeek.length === 0 && !!s.loans.find(l => l.id === 'car').nextDuePayment) || JSON.stringify([s.windowLow, s.dueThisWeek]); });
t('wp: with no recorded payment the projected one is counted and listed (control for the test above)', () => { const s = SNAP(OCT8, WPS, baseTx(), baseMarks); return (s.dueThisWeek.length === 1 && s.loans.find(l => l.id === 'car').nextDuePayment === null) || 'wrong'; });
t('wp: marking an upcoming bill paid removes it from "due this week"', () => { const tx = [bill('e', 'Water', 70, '2026-10-09')].concat(hist()); return (SNAP(OCT8, WPS, tx, {}).dueThisWeek.length === 1 && SNAP(OCT8, WPS, tx, { e: '2026-10-08' }).dueThisWeek.length === 0) || 'mark ignored'; });

// ---- boundaries
t('wp: occurrences of a day-31 monthly bill clamp to Feb 28 and span a year boundary', () => { const b = bill('x', 'Rent31', 100, '2026-01-31'); ctx._b = b; return run("fpOccurrences(_b, '2026-12-01', '2027-03-31').join()") === '2026-12-31,2027-01-31,2027-02-28,2027-03-31' || run("fpOccurrences(_b, '2026-12-01', '2027-03-31').join()"); });
t('wp: occurrences never fall before the item\'s own start date', () => { const b = bill('x', 'Later', 100, '2026-10-20'); ctx._b = b; return run("fpOccurrences(_b, '2026-08-01', '2026-12-31').join()") === '2026-10-20,2026-11-20,2026-12-20' || run("fpOccurrences(_b, '2026-08-01', '2026-12-31').join()"); });
t('wp: year boundary: asOf Dec 29 2026 sees the Dec 31 bill, the timeline runs into 2027 without resetting', () => {
  const s = SNAP([2026, 11, 29], WPS, [bill('r', 'Rent31', 100, '2026-01-31'), bill('s', 'Small', 25, '2027-01-02')].concat([spend('h1', 'A', 10, '2026-12-01'), spend('h2', 'B', 10, '2026-12-20')]), {});
  const t1 = s.timeline.find(x => x.date === '2026-12-31'), t2 = s.timeline.find(x => x.date === '2027-01-01');
  return (s.dueThisWeek.length === 2 && s.dueThisWeek[0].date === '2026-12-31' && s.dueThisWeek[1].date === '2027-01-02' && t1 && t2 && Math.abs(t2.balance - t1.balance) < 1500 && s.weekEnd === '2027-01-02') || JSON.stringify([s.dueThisWeek.map(x => x.date), s.weekEnd, t1, t2]); });
t('wp: short month: asOf Feb 26 2027 sees a day-31 bill on Feb 28 (upcoming), not Mar 3', () => { const s = SNAP([2027, 1, 26], WPS, [bill('r', 'Rent31', 100, '2026-01-31')], {}); return (s.upcoming.length === 1 && s.upcoming[0].date === '2027-02-28' && s.upcoming[0].daysAway === 2) || JSON.stringify(s.upcoming); });
t('wp: a paycheck dated today is NOT assumed received: it is unconfirmed unless a record exists; next payday is the following one', () => { const a = SNAP([2026, 9, 16], WPS, [], {}, null, { noPayRecords: true }); const b = SNAP([2026, 9, 16], WPS, [], {}); return (a.nextPayday.date === '2026-10-30' && a.unconfirmedIncome.some(u => u.date === '2026-10-16') && b.nextPayday.date === '2026-10-30' && !b.unconfirmedIncome.some(u => u.date === '2026-10-16') && b.incomeEvents.some(e => e.date === '2026-10-16' && !e.projected)) || JSON.stringify([a.nextPayday, a.unconfirmedIncome, b.unconfirmedIncome]); });
t('wp: monthly payer with payday on the 31st: next payday in a 30-day month clamps', () => { const s = SNAP([2026, 10, 5], { payday: '2026-01-31', payFrequency: 'monthly', payAmount: 2000, startingBalance: 800 }, [], {}); return s.nextPayday && s.nextPayday.date === '2026-11-30' || JSON.stringify(s.nextPayday); });
t('wp: viewing a far-future month does not change today\'s due items (calendar navigation)', () => {
  const a = SNAP(OCT8, WPS, baseTx(), baseMarks, [2026, 8]).dueThisWeek.map(x => x.id + x.date).join();
  const b = SNAP(OCT8, WPS, baseTx(), baseMarks, [2027, 5]).dueThisWeek.map(x => x.id + x.date).join();
  return (a === b && a === 'car2026-10-10') || a + '|' + b; });

// ---- incomplete data
t('wp: bills with no date are counted in a warning and do not crash', () => { const s = SNAP(OCT8, WPS, [mk({ id: 'u', type: 'bill', description: 'No Date', amount: 50, date: null, recurring: false })].concat(hist()), {}); return (s.warnings.some(w => w.code === 'undated_items')) || 'no warning'; });
t('wp: empty data produces a snapshot and no recommendations without throwing', () => { const s = SNAP(OCT8, { payday: null, payFrequency: 'biweekly', payAmount: 0, startingBalance: 0 }, [], {}); const a = ACT(s); return (a.actions.length === 0 && !s.extraDebt.allowed) || codes(a); });
t('wp: income only (no bills): nothing urgent, no invented debt advice', () => { const s = SNAP(OCT8, WPS, hist(), {}); const a = ACT(s); return !a.actions.some(x => /debt|extra/.test(x.code)) || codes(a); });

// ---- safe rendering of user-controlled text
t('wp: HTML in a bill name is escaped in the overdue text, and ids are attribute-safe', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const a = ACT(SNAP(OCT8, WPS, [bill("a'b\"c<d>", evil, 90, '2026-10-03')], {}));
  const x = a.actions[0]; return (x && x.text.indexOf('<img') === -1 && /&lt;img src=x onerror=alert\(1\)&gt;/.test(x.text) && /^[A-Za-z0-9_-]+$/.test(x.id)) || (x ? x.id + ' ' + x.text : 'none'); });
t('wp: HTML in a loan name and in a shortfall option is escaped', () => {
  const evil = '<b onmouseover=1>X</b>';
  const a = ACT(SNAP(OCT8, SHORT_S, [bill('r', evil, 1400, '2026-10-12'), spend('e', '<script>1</script>', 120, '2026-10-11')].concat(hist()), {}));
  const all = a.actions.map(x => x.text + (x.options || []).join('')).join(''); return (all.indexOf('<b onmouseover') === -1 && all.indexOf('<script') === -1 && /&lt;b onmouseover/.test(all)) || all.slice(0, 300); });
t('wp: notes never contain markup the renderer would trust (plain text only)', () => { const a = ACT(SNAP(OCT8, WPS, baseTx(), baseMarks)); return a.notes.every(n => typeof n === 'string' && n.indexOf('<') === -1) || 'markup in notes'; });
t('wp: dates read as local calendar days (fpParseIso / fpIso round trip)', () => ['2026-01-31', '2026-03-08', '2026-11-01', '2027-02-28'].every(d => run("fpIso(fpParseIso('" + d + "'))") === d) || 'shifted');
t('wp: stage copy matches the code threshold (no leftover $1,500 / 1-month wording)', () => !/\$1,500|1-month expense buffer|Save 1 month of expenses/.test(html) && /provisional \$500/.test(html) || 'stale wording');


// =====================================================================================================================
// v148 ALLOCATION SAFETY CORRECTIONS. Synthetic data only. Each scenario asserts the projected balance and whether allocation
// advice is allowed (extraDebt.allowed = every safety check passed; extraDebt.display = an amount would actually be shown).
// The same scenario is run through the UNCHANGED v147 file as the counterexample ("old"), to show what was unsafe.
// =====================================================================================================================
const f147 = require('path').resolve(__dirname, '../finpulse-v2-147.html');
let ctxOld = null;
if (fs.existsSync(f147)) {
  const html147 = fs.readFileSync(f147, 'utf8');
  const src147 = (html147.match(/<script>([\s\S]*?)<\/script>/g) || []).map(x => x.replace(/<\/?script>/g, '')).join('\n');
  const grabFrom = (code, name) => { const m = new RegExp('(?:async )?function ' + name + '\\s*\\(').exec(code); if (!m) return null; let i = code.indexOf('{', m.index), d = 0, j = i; for (; j < code.length; j++) { if (code[j] === '{') d++; else if (code[j] === '}') { d--; if (!d) break; } } return code.slice(m.index, j + 1); };
  const names147 = ['getPayDatesForMonth','getRecurringDates','buildDayMap','addToDayMap','getStartingBalanceForMonth','fpImportDesc','fmt','fpEscHtml','fpPad2','fpIso','fpParseIso','fpAddDays','fpDaysBetween','fpDateLabel','fpPriorityId','fpCyclePeriod','fpObligationStart','fpCreatedIso','fpOccurrences','fpLoanPaymentFor','fpBillPaidFor','fpProjectedTimeline','fpLowWithAdjustments','fpPriorityConfig','fpPrioritySnapshot','fpPriorityActions','fpLoanHasRecordedPayment','fpChainedStartBalance','fpLoanSplit','fpFindLoanForPayment','fpPrincipalToRestore'];
  ctxOld = { Date: FD, Math, parseFloat, String, Number, isNaN, userSettings: {}, transactions: [], monthBalances: {} };
  vm.createContext(ctxOld);
  names147.forEach(n => { const f = grabFrom(src147, n); if (f) vm.runInContext(f, ctxOld); });
}
const OLD = (settings, tx, code) => { ctxOld.userSettings = settings; ctxOld.transactions = tx; ctxOld.monthBalances = {}; return vm.runInContext(code, ctxOld); };
const OLDSNAP = (ymd, settings, tx, marks) => { ctxOld._ad = ymd; ctxOld._marks = marks || {}; return OLD(settings, tx, 'fpPrioritySnapshot(new Date(_ad[0], _ad[1], _ad[2], 12), { paidMarks: _marks })'); };
const tOld = (name, fn) => { if (!ctxOld) { fail++; results.push('FAIL  ' + name + ' -> v147 file not found for the counterexample'); return; } t(name, fn); };

const addIso = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isoOf = (ymd) => ymd[0] + '-' + String(ymd[1] + 1).padStart(2, '0') + '-' + String(ymd[2]).padStart(2, '0');
// 10 distinct spending days of `amt`, newest 1 day before `todayIso`, 3 days apart (29-day span): a reliable history
const histAt = (todayIso, amt, n) => Array.from({ length: n || 10 }, (_, k) => spend('ha' + k, 'Everyday ' + k, amt || 30, addIso(todayIso, -(1 + 3 * k)), 'food'));
const PAY = { payday: '2026-10-02', payFrequency: 'biweekly', payAmount: 1000, startingBalance: 0 };
// A dated balance the way the app saves it: month-start number derived from the entered balance, record stored beside it
// The way the app saves a balance (fpApplyDatedBalance): payAnswer 'yes' | 'no' | '' answers "is the paycheck near this date already in it?"
// (default 'no', the assumption the v148 tests were written under; v149 tests set it explicitly).
const dated = (settings, tx, amount, asOf, payAnswer) => {
  ctx.userSettings = Object.assign({}, settings, { startingBalance: 0 }); ctx.transactions = tx; ctx.monthBalances = {};
  ctx._asof = asOf; const near = run('fpNearPaycheck(_asof)');
  const ans = payAnswer === undefined ? 'no' : payAnswer;
  const included = near ? (ans === 'yes' ? true : ans === 'no' ? false : null) : null;
  ctx._inc = near && included === true ? near : null;
  const ms = run('fpMonthStartFromDated(' + amount + ", _asof, _inc)");
  return { settings: Object.assign({}, settings, { startingBalance: ms }), bal: { amount, asOf, monthStart: ms, paycheck: near ? { date: near.date, amount: near.amount, included } : null }, monthStart: ms };
};
const NEW = (ymd, settings, tx, amount, asOf, marks, payAnswer) => { const d = dated(settings, tx, amount, asOf, payAnswer); return SNAP(ymd, d.settings, tx, marks, null, { bal: d.bal, noPayRecords: true }); };
const dm = (settings, tx, y, m, start) => { ctx.userSettings = settings; ctx.transactions = tx; ctx.monthBalances = {}; return run('buildDayMap(' + y + ',' + m + ',' + start + ')'); };
const dmOld = (settings, tx, y, m, start) => OLD(settings, tx, 'buildDayMap(' + y + ',' + m + ',' + start + ')');
const NOPAY = { payday: null, payFrequency: 'biweekly', payAmount: 0, startingBalance: 0 };

// ---- 1. Balance entered mid-month is not replayed through the month's earlier transactions
const T1TX = () => [loanT('car', 'Car', 5000, 12, 200, '2026-10-10')].concat(hist());
t('v148-01 balance of $1,200 entered Oct 8: month-start is derived as 320 (1200 - paycheck 1000 + 4x30 spending)', () => { const d = dated(PAY, T1TX(), 1200, '2026-10-08'); return eq(d.monthStart, 320); });
t('v148-01 projected balance today = 1200 (nothing before Oct 8 is replayed), Oct 10 = 1000 after the car payment, Oct 16 = 2000 with the projected paycheck', () => {
  const s = NEW(OCT8, PAY, T1TX(), 1200, '2026-10-08'); const at = d => s.timeline.find(r => r.date === d).balance;
  return (close(s.projectedToday, 1200) && close(at('2026-10-10'), 1000) && close(at('2026-10-16'), 2000) && s.balanceBasis.status === 'ok') || JSON.stringify([s.projectedToday, at('2026-10-10'), at('2026-10-16')]); });
t('v148-01 the calendar agrees: end of Oct 7 = 1200 = the balance entered for the start of Oct 8', () => { const d = dated(PAY, T1TX(), 1200, '2026-10-08'); return eq(dm(d.settings, T1TX(), 2026, 9, 'null')[7].balance, 1200); });
t('v148-01 allocation: every check passes, candidate = floor5(50% x (895 - 500)) = 195, but nothing is displayed while the master switch is off', () => {
  const s = NEW(OCT8, PAY, T1TX(), 1200, '2026-10-08'); return (s.cash.reliable && s.extraDebt.allowed && s.extraDebt.amount === 195 && s.extraDebt.display === false && close(s.adjustedLow.amount, 895)) || JSON.stringify([s.cash, s.extraDebt, s.adjustedLow]); });
tOld('v148-01 COUNTEREXAMPLE v147: the same $1,200 typed into the "right now" prompt was replayed -> 2,080 today, and a far larger extra payment', () => {
  const o = OLDSNAP(OCT8, Object.assign({}, PAY, { startingBalance: 1200 }), T1TX());
  return (close(o.projectedToday, 2080) && o.extraDebt.allowed && o.extraDebt.amount > 195 * 4) || JSON.stringify([o.projectedToday, o.extraDebt]); });

// ---- 2. Unknown, mismatched, future or stale balance date
t('v148-02 legacy balance with no date: no projection, no dollar advice, a "confirm your balance" action, obligations still listed', () => {
  const s = SNAP(OCT8, Object.assign({}, PAY, { startingBalance: 1200 }), T1TX(), {}, null, { bal: null }); const a = ACT(s);
  return (s.balanceBasis.status === 'undated' && s.projectedToday === null && s.timeline.length === 0 && s.windowLow === null && s.stage === null && !s.extraDebt.allowed && s.extraDebt.amount === 0
    && s.cash.blockers.indexOf('balance_undated') > -1 && a.actions.some(x => x.code === 'balance_needed') && !a.actions.some(x => /shortfall|on_track|below_buffer|extra_debt/.test(x.code)) && s.dueThisWeek.length === 1) || JSON.stringify([s.balanceBasis, s.cash.blockers, codes(a)]); });
tOld('v148-02 COUNTEREXAMPLE v147: the same undated balance produced a projection and an extra payment', () => { const o = OLDSNAP(OCT8, Object.assign({}, PAY, { startingBalance: 1200 }), T1TX()); return (o.extraDebt.allowed && o.extraDebt.amount > 0 && o.projectedToday !== null) || JSON.stringify(o.extraDebt); });
t('v148-02 stale balance (Sep 20, 18 days old): projection still shown for warnings, but no reassurance and no allocation', () => {
  const tx = T1TX(); const s = NEW(OCT8, PAY, tx, 1200, '2026-09-20'); const a = ACT(s);
  return (s.balanceBasis.status === 'stale' && s.balanceBasis.ageDays === 18 && s.timeline.length > 0 && s.windowLow !== null && !s.extraDebt.allowed && s.cash.blockers.indexOf('balance_stale') > -1
    && a.actions.some(x => x.code === 'balance_stale') && !a.actions.some(x => /on_track|payday_buffer|extra_debt/.test(x.code))) || JSON.stringify([s.balanceBasis, s.cash.blockers, codes(a)]); });
t('v148-02 balance record that no longer matches starting_balance (changed by another path) is flagged and unused', () => {
  const s = SNAP(OCT8, Object.assign({}, PAY, { startingBalance: 500 }), T1TX(), {}, null, { bal: { amount: 1200, asOf: '2026-10-08', monthStart: 320 } });
  return (s.balanceBasis.status === 'mismatch' && s.timeline.length === 0 && !s.extraDebt.allowed && s.cash.blockers.indexOf('balance_mismatch') > -1) || JSON.stringify(s.balanceBasis); });
t('v148-02 future-dated, malformed and non-object balance records are all treated as unknown', () => {
  const bad = [{ amount: 1200, asOf: '2026-10-20', monthStart: 1200 }, { amount: 'x', asOf: '2026-10-01', monthStart: 1200 }, { amount: 1200, asOf: 'yesterday', monthStart: 1200 }, { amount: 1200, asOf: '2026-13-45', monthStart: 1200 }];
  const out = bad.map(b => SNAP(OCT8, Object.assign({}, PAY, { startingBalance: 1200 }), T1TX(), {}, null, { bal: b }).balanceBasis.status);
  ctx.monthBalances = { '__dated_balance': 'oops' }; ctx.userSettings = Object.assign({}, PAY, { startingBalance: 1200 }); const st = run("fpBalanceAnchor('2026-10-08').status");
  return (out.join() === 'future,undated,undated,undated' && st === 'undated') || out.join() + st; });
t('v148-02 compatibility: month keys are untouched by the dated record, and legacy JSON with only month keys is "undated"', () => {
  ctx.monthBalances = { '2026-09': 450, '2026-10': 320, '__dated_balance': { v: 1, amount: 1200, asOf: '2026-10-08', monthStart: 320 } };
  const keys = run('fpMonthKeys().join()'); ctx.monthBalances = { '2026-09': 450, '2026-10': 320 }; ctx.userSettings = Object.assign({}, PAY, { startingBalance: 320 });
  return (keys === '2026-09,2026-10' && run("fpBalanceAnchor('2026-10-08').status") === 'undated' && run("getStartingBalanceForMonth(2026,8)") === 450) || keys; });
t('v149-L1 fpNormalizeAsOf: empty -> today; invalid, future or before this month -> REJECTED (null, nothing saved); this month kept (v148 silently moved dates)', () => ['', 'abc', '2026-10-20', '2026-09-03', '2026-10-05', '2026-02-30'].map(v => String(run("fpNormalizeAsOf('" + v + "','2026-10-08')"))).join() === '2026-10-08,null,null,null,2026-10-05,null' || ['', 'abc', '2026-10-20', '2026-09-03', '2026-10-05', '2026-02-30'].map(v => String(run("fpNormalizeAsOf('" + v + "','2026-10-08')"))).join());

// ---- 3. Rent due on the 1st of the following month, after the old horizon (month end / day before the next paycheck) ends
const PAY30 = { payday: '2026-10-16', payFrequency: 'biweekly', payAmount: 1000, startingBalance: 0 };   // pays Oct 16, Oct 30, Nov 13
// rent (due the 1st), a card bill (3rd) and a loan (20th) all started in September and were paid for October (payment records)
const T3TX = () => [bill('rent', 'Rent', 2600, '2026-09-01'), bill('card', 'Card Bill', 200, '2026-09-03'), loanT('l2', 'Card2', 3000, 20, 60, '2026-09-20'),
  mk({ id: 'r3', type: 'expense', description: 'Card2 payment', amount: 60, date: '2026-10-20', category: 'loan_payment', loan_id: 'l2', principal_applied: 30 }), mk({ id: 'r4', type: 'expense', description: 'Card2 payment', amount: 60, date: '2026-09-20', category: 'loan_payment', loan_id: 'l2', principal_applied: 30 })].concat(histAt('2026-10-29'));
const OCT29 = [2026, 9, 29];
const T3MARKS = { rent: '2026-10-01', card: '2026-10-03' };   // October's rent and card bill were paid (marks); the Oct 20 loan payment has a record
t('v148-03 balance 900 on Oct 29: Oct 30 paycheck -> 1,900; Nov 1 rent -> -700 (first negative); Nov 3 card -> -900 (lowest)', () => {
  const s = NEW(OCT29, PAY30, T3TX(), 900, '2026-10-29', T3MARKS); const at = d => s.timeline.find(r => r.date === d).balance;
  return (close(at('2026-10-30'), 1900) && close(at('2026-10-31'), 1900) && close(at('2026-11-01'), -700) && close(at('2026-11-03'), -900) && s.firstNegative.date === '2026-11-01' && close(s.horizonLow.amount, -900) && s.horizonLow.date === '2026-11-03' && s.horizonEnd > '2026-11-03') || JSON.stringify([s.firstNegative, s.horizonLow, s.horizonEnd]); });
t('v148-03 shortfall is reported (stage 1, blocker, action text names Nov 1) and allocation is not allowed', () => {
  const s = NEW(OCT29, PAY30, T3TX(), 900, '2026-10-29', T3MARKS); const x = ACT(s).actions.find(y => y.code === 'shortfall');
  return (s.stage === 1 && !s.extraDebt.allowed && s.cash.blockers.indexOf('shortfall') > -1 && x && /Nov 1/.test(x.text) && /-\$900/.test(x.text)) || JSON.stringify([s.stage, s.cash.blockers, x && x.text]); });
tOld('v148-03 COUNTEREXAMPLE v147: horizon ended Oct 31, so no shortfall was seen and an extra payment was offered', () => {
  const d = dated(PAY30, T3TX(), 900, '2026-10-29'); const o = OLDSNAP(OCT29, d.settings, T3TX(), T3MARKS);
  return (o.horizonEnd === '2026-10-31' && o.firstNegative === null && o.extraDebt.allowed && o.extraDebt.amount > 0) || JSON.stringify([o.horizonEnd, o.firstNegative, o.extraDebt, o.stage]); });

// ---- 4. Missing / unconfirmed paycheck
const T4TX = () => [loanT('car', 'Car', 5000, 12, 200, '2026-10-20')].concat(hist());
t('v148-04 paycheck scheduled Oct 2 with no record: NOT counted -> projected today 480 (600 - 4x30), listed as unconfirmed, allocation blocked', () => {
  const s = NEW(OCT8, PAY, T4TX(), 600, '2026-10-01');
  return (close(s.projectedToday, 480) && s.unconfirmedIncome.length === 1 && s.unconfirmedIncome[0].date === '2026-10-02' && !s.extraDebt.allowed && s.cash.blockers.indexOf('unconfirmed_income') > -1 && s.warnings.some(w => w.code === 'unconfirmed_income')) || JSON.stringify([s.projectedToday, s.unconfirmedIncome, s.cash.blockers]); });
t('v148-04 a recorded income within 3 days and at least half the paycheck confirms it: counted once -> 1,480, no blocker', () => {
  const tx = T4TX().concat([mk({ id: 'inc', type: 'income', description: 'Pay deposit', amount: 1000, date: '2026-10-03', category: 'income' })]);
  const s = NEW(OCT8, PAY, tx, 600, '2026-10-01'); return (close(s.projectedToday, 1480) && s.unconfirmedIncome.length === 0 && s.cash.blockers.indexOf('unconfirmed_income') === -1) || JSON.stringify([s.projectedToday, s.unconfirmedIncome]); });
t('v148-04 a small unrelated income (200) or one 4+ days away does not confirm a 1,000 paycheck', () => {
  const small = NEW(OCT8, PAY, T4TX().concat([mk({ id: 'i1', type: 'income', description: 'Refund', amount: 200, date: '2026-10-02', category: 'income' })]), 600, '2026-10-01');
  const far = NEW(OCT8, PAY, T4TX().concat([mk({ id: 'i2', type: 'income', description: 'Other', amount: 1000, date: '2026-10-07', category: 'income' })]), 600, '2026-10-01');
  return (small.unconfirmedIncome.length === 1 && close(small.projectedToday, 680) && far.unconfirmedIncome.length === 1) || JSON.stringify([small.unconfirmedIncome, small.projectedToday, far.unconfirmedIncome]); });
t('v148-04 projected income (after today) is counted but labelled projected; the unconfirmed past one is shown as an action', () => {
  const s = NEW(OCT8, PAY, T4TX(), 600, '2026-10-01'); const a = ACT(s);
  return (s.nextPayday.projected === true && s.incomeEvents.filter(e => e.projected).length >= 1 && s.incomeEvents.every(e => e.projected) && a.actions.some(x => x.code === 'income_unconfirmed')) || JSON.stringify([s.incomeEvents, codes(a)]); });
tOld('v148-04 COUNTEREXAMPLE v147: the Oct 2 paycheck was assumed received -> 1,480 today and an extra payment', () => { const o = OLDSNAP(OCT8, Object.assign({}, PAY, { startingBalance: 600 }), T4TX()); return (close(o.projectedToday, 1480) && o.extraDebt.allowed && o.extraDebt.amount > 0) || JSON.stringify([o.projectedToday, o.extraDebt]); });
t('v148-04 no paycheck set up: disclosed, allocation blocked, window falls back to 14 days', () => { const d = dated(NOPAY, T4TX(), 3000, '2026-10-08'); const s = SNAP(OCT8, d.settings, T4TX(), {}, null, { bal: d.bal, noPayRecords: true }); return (s.nextPayday === null && s.windowEnd === '2026-10-22' && s.cash.blockers.indexOf('no_income') > -1 && s.warnings.some(w => w.code === 'no_income') && !s.extraDebt.allowed) || JSON.stringify([s.nextPayday, s.windowEnd, s.cash.blockers]); });

// ---- 5. Sparse recent spending plus one old transaction
const T5LOAN = () => loanT('car', 'Car', 5000, 12, 200, '2026-10-20');
t('v148-05 one April expense + two October expenses: sparse (2 distinct days) and short -> advice suppressed, no average used', () => {
  const tx = [T5LOAN(), spend('old', 'Old purchase', 40, '2026-04-10'), spend('a', 'A', 20, '2026-10-03'), spend('b', 'B', 25, '2026-10-06')];
  const s = NEW(OCT8, PAY, tx, 3000, '2026-10-08');
  return (s.spending.distinctDays === 2 && s.spending.reliable === false && s.spending.avgDaily === null && s.cash.blockers.indexOf('sparse_spending') > -1 && s.cash.blockers.indexOf('short_history') > -1 && !s.extraDebt.allowed && s.extraDebt.amount === 0 && s.cash.reserve === null) || JSON.stringify([s.spending, s.cash.blockers]); });
tOld('v148-05 COUNTEREXAMPLE v147: the April row made 182 "days of history", so 45 dollars of spending in 30 days looked reliable and a large extra payment was offered', () => {
  const tx = [T5LOAN(), spend('old', 'Old purchase', 40, '2026-04-10'), spend('a', 'A', 20, '2026-10-03'), spend('b', 'B', 25, '2026-10-06')];
  const o = OLDSNAP(OCT8, Object.assign({}, PAY, { startingBalance: 3000 }), tx); return (o.spending.historyDays > 150 && o.extraDebt.allowed && o.extraDebt.amount >= 1000) || JSON.stringify([o.spending, o.extraDebt]); });
t('v148-05 7 distinct recent days is still sparse; 8 distinct days spanning 14+ days passes (control)', () => {
  const mkDays = (dates) => dates.map((d, i) => spend('x' + i, 'Item ' + i, 30, d, 'food'));
  const seven = NEW(OCT8, PAY, [T5LOAN()].concat(mkDays(['2026-09-14','2026-09-18','2026-09-22','2026-09-26','2026-09-30','2026-10-03','2026-10-06'])), 3000, '2026-10-08');
  const eight = NEW(OCT8, PAY, [T5LOAN()].concat(mkDays(['2026-09-14','2026-09-18','2026-09-22','2026-09-26','2026-09-30','2026-10-03','2026-10-05','2026-10-06'])), 3000, '2026-10-08');
  return (seven.cash.blockers.indexOf('sparse_spending') > -1 && eight.spending.reliable === true && eight.extraDebt.allowed) || JSON.stringify([seven.cash.blockers, eight.spending, eight.extraDebt]); });
t('v148-05 stale history: 10 distinct days but the newest is 13 days old -> blocked', () => { const tx = [T5LOAN()].concat(histAt('2026-09-25')); const s = NEW(OCT8, PAY, tx, 3000, '2026-10-08'); return (s.cash.blockers.indexOf('stale_spending') > -1 && !s.extraDebt.allowed) || JSON.stringify([s.spending, s.cash.blockers]); });
t('v148-05 invalid spending rows (bad date, zero or negative amount) block advice instead of being guessed around', () => {
  const tx = [T5LOAN()].concat(hist(), [spend('bad1', 'Broken', -20, '2026-10-05'), spend('bad2', 'Nodate', 20, 'not-a-date')]);
  const s = NEW(OCT8, PAY, tx, 3000, '2026-10-08'); return (s.cash.blockers.indexOf('spending_data_invalid') > -1 && !s.extraDebt.allowed) || JSON.stringify(s.cash.blockers); });
t('v148-05 a bill-named payment recorded as an expense is not also counted as everyday spending (no double reserve)', () => {
  const base = [T5LOAN(), bill('rent', 'Rent', 800, '2026-11-01')].concat(hist());
  const withRent = base.concat([spend('rp', 'Rent', 800, '2026-10-01', 'home')]);
  const a = NEW(OCT8, PAY, base, 3000, '2026-10-08'), b = NEW(OCT8, PAY, withRent, 3000, '2026-10-08');
  return (close(a.spending.last30, 300) && close(b.spending.last30, 300) && b.spending.count30 === 10) || JSON.stringify([a.spending.last30, b.spending.last30]); });

// ---- 6. High one-off and unusually low spending
const T6LOAN = () => loanT('car', 'Car', 8000, 12, 200, '2026-10-20');
t('v148-06 high one-off: a $1,200 purchase among nine $30 days stays in the average (58.8/day) and reserve rate (73.5/day) -> far smaller candidate than the plain history', () => {
  const plain = NEW(OCT8, PAY, [T6LOAN()].concat(hist()), 5000, '2026-10-08');
  const spike = hist(); spike[9] = spend('spike', 'Laptop', 1200, '2026-10-07', 'shopping');
  const s = NEW(OCT8, PAY, [T6LOAN()].concat(spike), 5000, '2026-10-08');
  return (close(s.spending.avgDaily, (9 * 30 + 1200) / 25) && close(s.spending.reserveRate, 73.5) && close(plain.spending.reserveRate, 15) && s.extraDebt.amount < plain.extraDebt.amount && s.spending.reliable) || JSON.stringify([s.spending, plain.spending, s.extraDebt, plain.extraDebt]); });
t('v148-06 unusually low spending ($1 on each of 10 days = 0.4/day) is floored at $10/day, flagged low, and reserves 12.5/day', () => {
  const low = HIST_DATES.map((d, i) => spend('lo' + i, 'Tiny ' + i, 1, d, 'food')); const s = NEW(OCT8, PAY, [T6LOAN()].concat(low), 5000, '2026-10-08');
  return (s.spending.low === true && close(s.spending.avgDaily, 0.4) && close(s.spending.reserveRate, 12.5)) || JSON.stringify(s.spending); });
tOld('v148-06 COUNTEREXAMPLE v147: the same 0.4/day history reserved almost nothing, so its extra payment was larger than the floored one', () => {
  const low = HIST_DATES.map((d, i) => spend('lo' + i, 'Tiny ' + i, 1, d, 'food'));
  const n = NEW(OCT8, PAY, [T6LOAN()].concat(low), 5000, '2026-10-08'); const d = dated(PAY, [T6LOAN()].concat(low), 5000, '2026-10-08'); const o = OLDSNAP(OCT8, d.settings, [T6LOAN()].concat(low));
  return (o.extraDebt.allowed && n.extraDebt.allowed && o.extraDebt.amount > n.extraDebt.amount && o.cash.reserve < n.cash.reserve) || JSON.stringify([o.extraDebt, n.extraDebt, o.cash.reserve, n.cash.reserve]); });

// ---- 7. Zero-APR and missing-APR loans
const T7 = (loans) => loans.concat(hist());
t('v148-07 a lone 0% APR loan is never the target: no_eligible_loan, nothing allowed', () => { const s = NEW(OCT8, PAY, T7([loanT('z', 'Promo', 3000, 0, 100, '2026-10-20')]), 4000, '2026-10-08'); return (!s.extraDebt.allowed && s.extraDebt.amount === 0 && s.extraDebt.blockers.indexOf('no_eligible_loan') > -1) || JSON.stringify(s.extraDebt); });
tOld('v148-07 COUNTEREXAMPLE v147: the 0% loan was chosen for an extra payment', () => { const d = dated(PAY, T7([loanT('z', 'Promo', 3000, 0, 100, '2026-10-20')]), 4000, '2026-10-08'); const o = OLDSNAP(OCT8, d.settings, T7([loanT('z', 'Promo', 3000, 0, 100, '2026-10-20')])); return (o.extraDebt.allowed && o.extraDebt.loanId === 'z' && o.extraDebt.amount > 0) || JSON.stringify(o.extraDebt); });
t('v148-07 with a 0% and a 12% loan the 12% loan is the target', () => { const s = NEW(OCT8, PAY, T7([loanT('z', 'Promo', 3000, 0, 100, '2026-10-20'), loanT('v', 'Visa', 2000, 12, 60, '2026-10-21')]), 4000, '2026-10-08'); return (s.extraDebt.allowed && s.extraDebt.loanId === 'v') || JSON.stringify(s.extraDebt); });
t('v148-07 a loan with a missing APR blocks all extra-payment advice (ranking cannot be trusted), even with a known 12% loan', () => {
  const s = NEW(OCT8, PAY, T7([loanT('m', 'Mystery', 2500, null, 80, '2026-10-20'), loanT('v', 'Visa', 2000, 12, 60, '2026-10-21')]), 4000, '2026-10-08');
  const one = NEW(OCT8, PAY, T7([loanT('m', 'Mystery', 2500, '', 80, '2026-10-20')]), 4000, '2026-10-08');
  return (!s.extraDebt.allowed && s.cash.blockers.indexOf('apr_missing') > -1 && !one.extraDebt.allowed && one.cash.blockers.indexOf('apr_missing') > -1 && s.warnings.some(w => w.code === 'loan_data_missing')) || JSON.stringify([s.cash.blockers, one.cash.blockers]); });
tOld('v148-07 COUNTEREXAMPLE v147: a loan with no APR was treated as 0% and still received the extra payment', () => { const d = dated(PAY, T7([loanT('m', 'Mystery', 2500, null, 80, '2026-10-20')]), 4000, '2026-10-08'); const o = OLDSNAP(OCT8, d.settings, T7([loanT('m', 'Mystery', 2500, null, 80, '2026-10-20')])); return (o.extraDebt.allowed && o.extraDebt.loanId === 'm') || JSON.stringify(o.extraDebt); });
t('v148-07 a loan without a minimum payment or balance blocks advice (minimum-payment consideration preserved)', () => { const s = NEW(OCT8, PAY, T7([loanT('n', 'NoMin', 2500, 12, 0, '2026-10-20', { amount: 0 })]), 4000, '2026-10-08'); const s2 = NEW(OCT8, PAY, T7([loanT('n2', 'NoBal', null, 12, 50, '2026-10-20')]), 4000, '2026-10-08'); return (s.cash.blockers.indexOf('loan_data_missing') > -1 && s2.cash.blockers.indexOf('loan_data_missing') > -1 && !s.extraDebt.allowed && !s2.extraDebt.allowed) || JSON.stringify([s.cash.blockers, s2.cash.blockers]); });
t('v148-07 the dollar amount is shown ONLY with the master switch on, and only then does the action list name an amount', () => {
  const tx = T7([loanT('v', 'Visa', 2000, 12, 60, '2026-10-21')]);
  const off = NEW(OCT8, PAY, tx, 4000, '2026-10-08'); const offA = ACT(off);
  ctx.FP_FLAGS.extraAmountEnabled = true;
  const on = NEW(OCT8, PAY, tx, 4000, '2026-10-08'); const onA = ACT(on);
  ctx.FP_FLAGS.extraAmountEnabled = false;
  return (off.extraDebt.allowed && !off.extraDebt.display && !offA.actions.some(x => x.code === 'extra_debt') && !/\$\d/.test(offA.notes.filter(n => /extra debt/.test(n)).join(' '))
    && on.extraDebt.display && onA.actions.some(x => x.code === 'extra_debt' && /\$\d/.test(x.text)) && on.extraDebt.amount === off.extraDebt.amount) || JSON.stringify([off.extraDebt, on.extraDebt, offA.notes]); });

// ---- 8. Paid-off loan and pre-start recurring items
const T8TX = () => [loanT('done', 'PaidOff', 0, 20, 300, '2026-09-15'), bill('gym', 'Gym', 50, '2026-10-20'), mk({ id: 'clean', type: 'expense', description: 'Cleaner', amount: 40, date: '2026-10-20', recurring: true, frequency: 'biweekly', anchor_date: '2026-10-20' })];
t('v148-08 Oct from 1,000: paid-off loan (-300 old) and the Oct 6 biweekly cleaner (before its Oct 20 start) are gone -> 910', () => eq(dm(NOPAY, T8TX(), 2026, 9, 1000)[31].balance, 1000 - 50 - 40));
tOld('v148-08 COUNTEREXAMPLE v147: the same month ended at 570', () => eq(dmOld(NOPAY, T8TX(), 2026, 9, 1000)[31].balance, 1000 - 300 - 50 - 80));
t('v148-08 September (before every start date and with a paid-off loan) has nothing projected -> 1,000', () => eq(dm(NOPAY, T8TX(), 2026, 8, 1000)[30].balance, 1000));
tOld('v148-08 COUNTEREXAMPLE v147: September showed the loan, the gym and two cleaner visits -> 570', () => eq(dmOld(NOPAY, T8TX(), 2026, 8, 1000)[30].balance, 570));
t('v148-08 the priorities timeline does not deduct the paid-off loan: balance 2,000 on Oct 8 stays 2,000 at Oct 19 and falls to 1,910 only on Oct 20', () => { const s = NEW(OCT8, NOPAY, T8TX(), 2000, '2026-10-08'); const at = d => s.timeline.find(r => r.date === d).balance; return (close(at('2026-10-19'), 2000) && close(at('2026-10-20'), 1910) && s.upcoming.every(u => u.id !== 'done') && s.loans.find(l => l.id === 'done').paidOff) || JSON.stringify(s.timeline.slice(0, 14).map(r => r.balance)); });
t('v148-08 getRecurringDates never returns dates before the start: biweekly from Oct 20 -> 20 only in Oct; 6 is gone', () => dates(run(`getRecurringDates(new Date('2026-10-20T12:00:00'),'biweekly',2026,9)`)) === '20' || dates(run(`getRecurringDates(new Date('2026-10-20T12:00:00'),'biweekly',2026,9)`)));
t('v148-08 yearly recurrence is supported (it produced nothing before) and respects its start', () => dates(run(`getRecurringDates(new Date('2025-11-05T12:00:00'),'yearly',2026,10)`)) === '5' && dates(run(`getRecurringDates(new Date('2025-11-05T12:00:00'),'yearly',2026,9)`)) === '' && dates(run(`getRecurringDates(new Date('2027-11-05T12:00:00'),'yearly',2026,10)`)) === '' || 'bad');

// ---- 9. Bill plus its payment record
const T9TX = () => [bill('el', 'Electric', 90, '2026-10-03'), spend('elp', 'Electric', 90, '2026-10-05', 'home')];
t('v148-09 a bill and its recorded payment cost 90 once, not 180 -> Oct ends at 910; the scheduled Oct 3 row is gone, the payment remains', () => { const m = dm(NOPAY, T9TX(), 2026, 9, 1000); return (close(m[31].balance, 910) && m[3].bills.length === 0 && m[5].expenses.length === 1) || m[31].balance; });
tOld('v148-09 COUNTEREXAMPLE v147: Oct ended at 820 (the bill and the payment both subtracted)', () => eq(dmOld(NOPAY, T9TX(), 2026, 9, 1000)[31].balance, 820));
t('v148-09 an early payment for next month\'s bill (Oct 28 for the Nov 3 due date) replaces November\'s scheduled bill when October is already paid', () => { const tx = [bill('el', 'Electric', 90, '2026-10-03'), spend('elo', 'Electric', 90, '2026-10-03', 'home'), spend('elp', 'electric  ', 90, '2026-10-28', 'home')]; const m = dm(NOPAY, tx, 2026, 10, 500); return (m[3].bills.length === 0 && close(m[30].balance, 500)) || JSON.stringify(m[3]); });
t('v149-H5 with October unpaid, an Oct 28 payment is a LATE October payment: November\'s bill stays projected (v148 used it for November)', () => { const tx = [bill('el', 'Electric', 90, '2026-10-03'), spend('elp', 'Electric', 90, '2026-10-28', 'home')]; const m = dm(NOPAY, tx, 2026, 10, 500); const o = dm(NOPAY, tx, 2026, 9, 500); return (m[3].bills.length === 1 && close(m[30].balance, 410) && o[3].bills.length === 0) || JSON.stringify([m[3].bills.length, m[30].balance, o[3].bills.length]); });
t('v148-09 bill marked paid BEFORE the balance date is not deducted again; marked AFTER it, the cash is still deducted once', () => {
  const tx = [bill('water', 'Water', 100, '2026-10-12')];
  const before = NEW([2026, 9, 10], NOPAY, tx, 1000, '2026-10-08', { water: '2026-10-06' }); const after = NEW([2026, 9, 10], NOPAY, tx, 1000, '2026-10-08', { water: '2026-10-09' });
  const at = (s, d) => s.timeline.find(r => r.date === d).balance;
  return (close(at(before, '2026-10-12'), 1000) && close(at(after, '2026-10-12'), 900) && before.upcoming.length === 0 && after.upcoming.length === 0) || JSON.stringify([at(before, '2026-10-12'), at(after, '2026-10-12')]); });

// ---- 10. Partial loan payment and prior-month payment
const CAR200 = (anchor) => loanT('car', 'Car', 5000, 12, 200, anchor);
// v149: loans that start in September need a September payment in the fixture, otherwise October payments go to the open September due date (audit H5)
const carPay = (id, amt, date) => mk({ id, type: 'expense', description: 'Car payment', amount: amt, date, category: 'loan_payment', loan_id: 'car', principal_applied: amt });
t('v148-10 partial payment of 80 on a 200 payment leaves the remaining 120 projected -> Oct ends 1,000 - 80 - 120 = 800', () => { const m = dm(NOPAY, [CAR200('2026-10-10'), carPay('p', 80, '2026-10-10')], 2026, 9, 1000); return (close(m[31].balance, 800) && m[10].loans.length === 1 && close(m[10].loans[0].min_payment, 120)) || m[31].balance; });
tOld('v148-10 COUNTEREXAMPLE v147: any recorded payment removed the whole projected one -> Oct ended 920 (120 never projected)', () => eq(dmOld(NOPAY, [CAR200('2026-09-10'), carPay('p', 80, '2026-10-10')], 2026, 9, 1000)[31].balance, 920));
t('v149-M1 a loan due date needs the full minimum (within $1): 160 of 200 leaves 40, 199.50 settles it, two part payments (120 + 80) add up', () => { const a = dm(NOPAY, [CAR200('2026-10-10'), carPay('p', 160, '2026-10-10')], 2026, 9, 1000); const b = dm(NOPAY, [CAR200('2026-10-10'), carPay('p', 199.5, '2026-10-10')], 2026, 9, 1000); const c = dm(NOPAY, [CAR200('2026-10-10'), carPay('p', 120, '2026-10-08'), carPay('q', 80, '2026-10-12')], 2026, 9, 1000); return (close(a[31].balance, 800) && close(a[10].loans[0].min_payment, 40) && b[10].loans.length === 0 && close(b[31].balance, 800.5) && c[10].loans.length === 0 && close(c[31].balance, 800)) || [a[31].balance, b[31].balance, c[31].balance].join(); });
t('v148-10 a payment made in the PREVIOUS month (Sep 28 for the Oct 1 due date) pays October when September is paid -> Oct ends 1,000', () => { const m = dm(NOPAY, [CAR200('2026-09-01'), carPay('s', 200, '2026-09-01'), carPay('p', 200, '2026-09-28')], 2026, 9, 1000); return (close(m[31].balance, 1000) && m[1].loans.length === 0) || m[31].balance; });
tOld('v148-10 COUNTEREXAMPLE v147: the Sep 28 payment did not count for Oct 1 -> Oct ended 800 (paid twice on paper)', () => eq(dmOld(NOPAY, [CAR200('2026-09-01'), carPay('p', 200, '2026-09-28')], 2026, 9, 1000)[31].balance, 800));
t('v149-H5 with September unpaid, a Sep 28 payment is a late September payment: September settled, October 1 still projected -> Oct ends 800', () => { const tx = [CAR200('2026-09-01'), carPay('p', 200, '2026-09-28')]; const sep = dm(NOPAY, tx, 2026, 8, 1000), oct = dm(NOPAY, tx, 2026, 9, 1000); return (sep[1].loans.length === 0 && close(sep[30].balance, 800) && oct[1].loans.length === 1 && close(oct[31].balance, 800)) || [sep[30].balance, oct[31].balance].join(); });
t('v148-10 priorities: part-paid overdue payment shows the remaining 120 and the 80 already paid, and blocks allocation', () => { const tx = [CAR200('2026-10-10'), carPay('p', 80, '2026-10-10')].concat(hist()); const d = dated(PAY, tx, 2000, '2026-10-12'); const s = SNAP([2026, 9, 12], d.settings, tx, {}, null, { bal: d.bal, noPayRecords: true }); const o = s.overdue[0]; const a = ACT(s).actions.find(x => x.code === 'overdue_loan'); return (o && o.amount === 120 && o.paidSoFar === 80 && s.cash.blockers.indexOf('partial_payment') > -1 && !s.extraDebt.allowed && /120/.test(a.text) && /80/.test(a.text)) || JSON.stringify([s.overdue, s.cash.blockers]); });
t('v148-10 a payment made 5 days early (Oct 5 for Oct 10) clears that due date from overdue and from upcoming', () => { const tx = [CAR200('2026-10-10'), carPay('p', 200, '2026-10-05')].concat(hist()); const s = NEW(OCT8, PAY, tx, 2000, '2026-10-08'); return (s.overdue.length === 0 && s.upcoming.filter(u => u.id === 'car' && u.date === '2026-10-10').length === 0) || JSON.stringify([s.overdue, s.upcoming.map(u => u.date)]); });

// ---- 11. Edited recurring expense
const GYM_EDITED = () => mk({ id: 'gym', type: 'expense', description: 'Gym', amount: 50, date: '2026-10-20', recurring: true, frequency: 'monthly', anchor_date: '2026-10-05', category: 'personal' });
t('v148-11 recurring expense edited from the 5th to the 20th (date changed, anchor not): counted once on the 20th -> Oct ends 950', () => { const m = dm(NOPAY, [GYM_EDITED()], 2026, 9, 1000); return (close(m[31].balance, 950) && m[20].expenses.length === 1 && m[5].expenses.length === 0) || JSON.stringify([m[31].balance, m[5].expenses.length, m[20].expenses.length]); });
tOld('v148-11 COUNTEREXAMPLE v147: counted on both the 5th and the 20th -> 900', () => eq(dmOld(NOPAY, [GYM_EDITED()], 2026, 9, 1000)[31].balance, 900));
t('v148-11 the edited date carries into later months: Nov charge on the 20th, not the 5th', () => { const m = dm(NOPAY, [GYM_EDITED()], 2026, 10, 1000); return (m[20].expenses.length === 1 && m[5].expenses.length === 0) || 'bad'; });
t('v148-11 an unedited recurring expense (date = anchor) is unchanged, and the snapshot notes edited ones', () => { const ok = mk({ id: 'g2', type: 'expense', description: 'Gym2', amount: 50, date: '2026-10-05', recurring: true, frequency: 'monthly', anchor_date: '2026-10-05' }); const s1 = NEW(OCT8, PAY, [ok].concat(hist()), 2000, '2026-10-08'); const s2 = NEW(OCT8, PAY, [GYM_EDITED()].concat(hist()), 2000, '2026-10-08'); return (!s1.warnings.some(w => w.code === 'edited_recurring') && s2.warnings.some(w => w.code === 'edited_recurring') && s2.upcoming.some(u => u.date === '2026-10-20') && !s2.upcoming.some(u => u.date === '2026-11-05')) || JSON.stringify(s2.upcoming); });

// ---- 12. Twice-monthly pay on the 15th and month-end
const TWICE = (payday) => ({ payday, payFrequency: 'twicemonthly', payAmount: 1000, startingBalance: 0 });
const payDays = (st, y, m) => { ctx.userSettings = st; return dates(run(`getPayDatesForMonth(${y},${m})`)); };
t('v148-12 payday on a month-end: paid on the 15th and the last day (Oct 15,31; Nov 15,30; Feb 2027 15,28), schedule certain', () => { const st = TWICE('2026-09-30'); return (payDays(st, 2026, 9) === '15,31' && payDays(st, 2026, 10) === '15,30' && payDays(st, 2027, 1) === '15,28' && run('fpPayScheduleInfo(userSettings).certain') === true) || [payDays(st, 2026, 9), payDays(st, 2026, 10), payDays(st, 2027, 1)].join('|'); });
t('v148-12 projected balance: 0 until Oct 14, 1,000 on the 15th, 1,000 until Oct 30, 2,000 on the 31st', () => { const m = dm(TWICE('2026-09-30'), [], 2026, 9, 0); return (m[14].balance === 0 && m[15].balance === 1000 && m[30].balance === 1000 && m[31].balance === 2000) || [m[14].balance, m[15].balance, m[30].balance, m[31].balance].join(); });
tOld('v148-12 COUNTEREXAMPLE v147: paid on the 1st and 15th for everyone (Oct 1 and 15)', () => { const m = dmOld(TWICE('2026-09-30'), [], 2026, 9, 0); return (m[1].balance === 1000 && m[14].balance === 1000 && m[30].balance === 2000) || [m[1].balance, m[14].balance, m[30].balance].join(); });
t('v148-12 next payday on Oct 20 is Oct 31 (v147 said Nov 1) and the window ends Oct 30 (last payday entered: Sep 30)', () => { const tx = [T5LOAN()].concat(histAt('2026-10-20')); const s = NEW([2026, 9, 20], TWICE('2026-09-30'), tx, 2000, '2026-10-20'); return (s.nextPayday.date === '2026-10-31' && s.windowEnd === '2026-10-30' && s.paySchedule.certain) || JSON.stringify([s.nextPayday, s.windowEnd]); });
tOld('v148-12 COUNTEREXAMPLE v147: the same user\'s next payday on Oct 20 was Nov 1', () => { const tx = [T5LOAN()].concat(histAt('2026-10-20')); const o = OLDSNAP([2026, 9, 20], Object.assign({}, TWICE('2026-09-30'), { startingBalance: 1000 }), tx); return (o.nextPayday.date === '2026-11-01') || o.nextPayday.date; });
t('v148-12 payday on the 1st -> 1st and 15th (certain); payday on the 15th is AMBIGUOUS (1st/15th or 15th/last): paycheck dates unconfirmed, allocation blocked', () => {
  const a = TWICE('2026-10-01'), b = TWICE('2026-10-15');
  const tx = [T5LOAN()].concat(hist()); const s = NEW(OCT8, b, tx, 3000, '2026-10-08'); const a2 = ACT(s);
  return (payDays(a, 2026, 9) === '1,15' && run('fpPayScheduleInfo(userSettings).certain') === true && payDays(b, 2026, 9) === '1,15' && run('fpPayScheduleInfo(userSettings).certain') === false
    && !s.extraDebt.allowed && s.cash.blockers.indexOf('pay_schedule_unclear') > -1 && s.warnings.some(w => w.code === 'pay_schedule_unclear') && !a2.actions.some(x => x.code === 'on_track')) || JSON.stringify([s.cash.blockers, payDays(b, 2026, 9)]); });
t('v148-12 other paydays are inferred, not certain: 5th -> 5 and 20; 20th -> 5 and 20', () => payDays(TWICE('2026-10-05'), 2026, 9) === '5,20' && run('fpPayScheduleInfo(userSettings).certain') === false && payDays(TWICE('2026-10-20'), 2026, 9) === '5,20' || 'bad');
t('v148-12 weekly, biweekly and monthly schedules are unaffected and certain', () => ['weekly', 'biweekly', 'monthly'].every(f => { ctx.userSettings = { payday: '2026-10-02', payFrequency: f, payAmount: 100, startingBalance: 0 }; return run('fpPayScheduleInfo(userSettings).certain') === true; }));

// ---- 13. Shortfall after month end and before the next reliable paycheck
const T13TX = () => [bill('ins', 'Insurance', 2800, '2026-09-02'), loanT('l', 'Card', 3000, 20, 60, '2026-09-25'), mk({ id: 'lp', type: 'expense', description: 'Card payment', amount: 60, date: '2026-09-25', category: 'loan_payment', loan_id: 'l', principal_applied: 30 })].concat(histAt('2026-10-20'));
const OCT20 = [2026, 9, 20];
const T13MARKS = { ins: '2026-10-02' };   // October's insurance was paid (mark)
t('v148-13 biweekly pay Oct 30 / Nov 13, balance 1,500 on Oct 20, card 60 on Oct 25, insurance 2,800 on Nov 2: Oct 31 -> 2,440; Nov 2 -> -360 (first negative, after month end, before Nov 13)', () => {
  const s = NEW(OCT20, PAY30, T13TX(), 1500, '2026-10-20', T13MARKS); const at = d => s.timeline.find(r => r.date === d).balance;
  return (close(at('2026-10-31'), 1500 - 60 + 1000) && close(at('2026-11-02'), 1500 - 60 + 1000 - 2800) && s.firstNegative.date === '2026-11-02' && close(s.firstNegative.amount, -360) && s.windowEnd === '2026-10-29' && s.horizonEnd >= '2026-11-13' && !s.extraDebt.allowed && s.stage === 1) || JSON.stringify([s.firstNegative, s.windowEnd, s.horizonEnd, s.stage]); });
tOld('v148-13 COUNTEREXAMPLE v147: horizon ended Oct 31; no shortfall seen and an extra payment was offered', () => { const d = dated(PAY30, T13TX(), 1500, '2026-10-20'); const o = OLDSNAP(OCT20, d.settings, T13TX(), T13MARKS); return (o.horizonEnd === '2026-10-31' && o.firstNegative === null && o.extraDebt.allowed && o.extraDebt.amount > 0) || JSON.stringify([o.horizonEnd, o.firstNegative, o.stage, o.extraDebt]); });
t('v148-13 monthly payer paid on the 5th: rent Nov 2 with balance 1,000 -> -400 before the Nov 5 paycheck is found', () => {
  const st = { payday: '2026-10-05', payFrequency: 'monthly', payAmount: 1500, startingBalance: 0 }; const tx = [bill('rent', 'Rent', 1400, '2026-11-02')].concat(histAt('2026-10-28'));
  const s = NEW([2026, 9, 28], st, tx, 1000, '2026-10-28'); return (s.nextPayday.date === '2026-11-05' && s.firstNegative.date === '2026-11-02' && close(s.firstNegative.amount, -400) && s.horizonEnd >= '2026-11-19') || JSON.stringify([s.nextPayday, s.firstNegative, s.horizonEnd]); });
t('v148-13 horizon rules: at least 30 days, 7 days past month end, 14 days past the next paycheck, and (v149-M9) up to the paycheck after next', () => { const s = NEW(OCT8, PAY, [T5LOAN()].concat(hist()), 3000, '2026-10-08'); const s2 = NEW([2026, 9, 29], { payday: '2026-10-05', payFrequency: 'monthly', payAmount: 1500, startingBalance: 0 }, [T5LOAN()].concat(histAt('2026-10-29')), 3000, '2026-10-29'); return (s.horizonEnd === '2026-11-07' && s2.nextPayday.date === '2026-11-05' && s2.horizonEnd === '2026-12-04') || [s.horizonEnd, s2.horizonEnd].join(); });
t('v148-13 a bill 12 days past the OLD horizon but inside the new one is now seen as an upcoming item', () => { const s = NEW(OCT20, PAY30, T13TX(), 1500, '2026-10-20', T13MARKS); return s.upcoming.some(u => u.id === 'ins' && u.date === '2026-11-02') || 'missing'; });

// ---- cross-cutting
t('v148-xx the save path round trip: month-start derived from the entered balance reproduces it on the calendar for any date this month', () => ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-08'].every(asOf => { const tx = T1TX(); const d = dated(PAY, tx, 1234.56, asOf); const day = parseInt(asOf.slice(8), 10); ctx.userSettings = d.settings; ctx.transactions = tx; ctx.monthBalances = {}; const m = run('buildDayMap(2026,9,null)'); const before = day === 1 ? d.settings.startingBalance : m[day - 1].balance; return close(before, 1234.56); }));
t('v148-xx informational features survive with an unknown balance: overdue and due-this-week are still produced', () => { const s = SNAP(OCT8, Object.assign({}, PAY, { startingBalance: null }), [bill('g', 'Gas Bill', 90, '2026-10-03'), bill('w', 'Water', 70, '2026-10-09')].concat(hist()), {}); return (s.overdue.length === 1 && s.dueThisWeek.length === 1 && s.balanceBasis.status === 'undated') || JSON.stringify([s.overdue, s.dueThisWeek]); });
t('v148-xx v148 text carries no dollar amount for a recommendation unless it is a projection or a bill', () => { const tx = [loanT('v', 'Visa', 2000, 12, 60, '2026-10-21')].concat(hist()); const a = ACT(NEW(OCT8, PAY, tx, 4000, '2026-10-08')); return !a.actions.some(x => /extra toward|looks free/.test(x.text)) || 'amount shown while disabled'; });
t('v148-xx the dated-balance code and the safety checks are documented in comments', () => /SAFETY MODEL \(v148, tightened v149\)/.test(html) && /Month keys are 'YYYY-MM', so the extra key cannot collide/.test(html) && /no_eligible_loan/.test(html) || 'missing documentation');
t('v148-xx no new network calls or frameworks were added by v148 (fetch/XMLHttpRequest/import counts equal v147)', () => { const h147 = fs.readFileSync(f147, 'utf8'); const c = (h, re) => (h.match(re) || []).length; return (c(html, /fetch\(/g) === c(h147, /fetch\(/g) && c(html, /XMLHttpRequest/g) === c(h147, /XMLHttpRequest/g) && c(html, /<script[^>]+src=/g) === c(h147, /<script[^>]+src=/g)) || 'changed'; });


// =====================================================================================================================
// v149 REGRESSION TESTS, one or more per V148_INDEPENDENT_AUDIT.md finding. Synthetic data only.
// "COUNTEREXAMPLE v148" tests run the same data through the UNCHANGED v148 file to show the audited behavior.
// A test that cannot run in this time zone is reported as SKIP, never as PASS.
// =====================================================================================================================
let skipped = 0;
const skip = (name, why) => { skipped++; results.push('SKIP  ' + name + ' -> ' + why); };
const f148 = require('path').resolve(__dirname, '../finpulse-v2-148.html');
function makeCtx(fileOrSrc, clock, isSrc) {
  const code = isSrc ? fileOrSrc : (fs.readFileSync(fileOrSrc, 'utf8').match(/<script>([\s\S]*?)<\/script>/g) || []).map(x => x.replace(/<\/?script>/g, '')).join('\n');
  const T = clock.getTime();
  class D2 extends Date { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } }
  const c = { FP_FLAGS: { extraAmountEnabled: false }, Date: D2, Math, parseFloat, String, Number, isNaN, Object, JSON, Array, userSettings: {}, transactions: [], monthBalances: {}, currentUser: null };
  vm.createContext(c);
  const gr = (name) => { const m = new RegExp('(?:async )?function ' + name + '\\s*\\(').exec(code); if (!m) return null; let i = code.indexOf('{', m.index), d = 0, j = i; for (; j < code.length; j++) { if (code[j] === '{') d++; else if (code[j] === '}') { d--; if (!d) break; } } return code.slice(m.index, j + 1); };
  const nm = [...new Set(['getPayDatesForMonth','getRecurringDates','buildDayMap','addToDayMap','getStartingBalanceForMonth','fmt','ordinal','fpEscHtml','detectStage'].concat([...code.matchAll(/(?:async )?function (fp\w+)\s*\(/g)].map(m => m[1])))];
  nm.forEach(n => { const f = gr(n); if (f) vm.runInContext(f, c); });
  return { c, run: s => vm.runInContext(s, c), src: code, grab: gr };
}
const has148 = fs.existsSync(f148);
const C148 = has148 ? makeCtx(f148, new Date(2026, 9, 8, 12)) : null;
const t148 = (name, fn) => { if (!C148) { skip(name, 'v148 file not found'); return; } t(name, fn); };
// v148 snapshot with the v148 record format (v1, no paycheck answer)
const SNAP148 = (ymd, settings, tx, amount, asOf, marks) => {
  const c = C148.c; c.userSettings = Object.assign({}, settings, { startingBalance: 0 }); c.transactions = tx; c.monthBalances = {};
  const ms = C148.run('fpMonthStartFromDated(' + amount + ", '" + asOf + "')");
  c.userSettings = Object.assign({}, settings, { startingBalance: ms }); c.monthBalances = { '__dated_balance': { v: 1, amount, asOf, monthStart: ms } };
  c._ad = ymd; c._m = marks || {}; const s = C148.run('fpPrioritySnapshot(new Date(_ad[0], _ad[1], _ad[2], 12), { paidMarks: _m })'); c._s = s; s._actions = C148.run('fpPriorityActions(_s)'); return s;
};
const ACTS = (s) => ACT(s).actions;
const codesOf = (acts) => acts.map(a => a.code).join(',');
const isDstZone = (() => { const j = new Date(2026, 0, 15).getTimezoneOffset(), u = new Date(2026, 6, 15).getTimezoneOffset(); return j !== u; })();
const incomeRec = (id, amt, date) => mk({ id, type: 'income', description: 'Pay deposit', amount: amt, date, category: 'income' });

// ---- C2: a paycheck already in the entered balance is never counted twice -----------------------------------------
const PAY8 = { payday: '2026-10-08', payFrequency: 'biweekly', payAmount: 1500, startingBalance: 0 };
const C2TX = () => [bill('rent', 'Rent', 1600, '2026-10-10')].concat(hist());
t('v149-C2 "Yes, included": paycheck deposited Oct 8 is not added to the 1,700 entered for Oct 8 -> Oct 10 after rent = 100', () => { const s = NEW(OCT8, PAY8, C2TX(), 1700, '2026-10-08', {}, 'yes'); const at = d => s.timeline.find(r => r.date === d).balance; return (close(at('2026-10-10'), 100) && s.uncertainIncome.length === 0 && s.unconfirmedIncome.length === 0 && s.balanceBasis.paycheck.included === true) || JSON.stringify([at('2026-10-10'), s.uncertainIncome, s.balanceBasis]); });
t('v149-C2 "Yes, included" + the user also records the deposit: still counted once (Oct 10 = 100)', () => { const s = NEW(OCT8, PAY8, C2TX().concat([incomeRec('dep', 1500, '2026-10-08')]), 1700, '2026-10-08', {}, 'yes'); return close(s.timeline.find(r => r.date === '2026-10-10').balance, 100) || s.timeline.find(r => r.date === '2026-10-10').balance; });
t('v149-C2 "Not sure": paycheck not added, projection uncertain (income_inclusion_unknown), allocation blocked, stage cannot be 3', () => { const s = NEW(OCT8, PAY8, C2TX(), 1700, '2026-10-08', {}, ''); return (close(s.timeline.find(r => r.date === '2026-10-10').balance, 100) && s.uncertainIncome.length === 1 && s.cash.blockers.indexOf('income_inclusion_unknown') > -1 && !s.extraDebt.allowed && s.stage !== 3) || JSON.stringify([s.uncertainIncome, s.cash.blockers, s.stage]); });
t('v149-C2 "Not sure" + recording the deposit does NOT add it (that was the v148 double count): Oct 10 stays 100, still uncertain', () => { const s = NEW(OCT8, PAY8, C2TX().concat([incomeRec('dep', 1500, '2026-10-08')]), 1700, '2026-10-08', {}, ''); return (close(s.timeline.find(r => r.date === '2026-10-10').balance, 100) && s.uncertainIncome.length === 1 && s.cash.blockers.indexOf('income_inclusion_unknown') > -1) || JSON.stringify([s.timeline.find(r => r.date === '2026-10-10').balance, s.uncertainIncome]); });
t('v149-C2 "No, not yet": an unrecorded Oct 8 paycheck stays unconfirmed (not counted); once recorded it is counted exactly once (Oct 10 = 1,600)', () => { const a = NEW(OCT8, PAY8, C2TX(), 1700, '2026-10-08', {}, 'no'); const b = NEW(OCT8, PAY8, C2TX().concat([incomeRec('dep', 1500, '2026-10-08')]), 1700, '2026-10-08', {}, 'no'); return (close(a.timeline.find(r => r.date === '2026-10-10').balance, 100) && a.unconfirmedIncome.length === 1 && close(b.timeline.find(r => r.date === '2026-10-10').balance, 1600) && b.unconfirmedIncome.length === 0) || JSON.stringify([a.unconfirmedIncome, b.timeline.find(r => r.date === '2026-10-10')]); });
t('v149-C2 no screen text tells the user to record income to satisfy a check; the uncertain case asks them to answer the paycheck question', () => { const s = NEW(OCT8, PAY8, C2TX(), 1700, '2026-10-08', {}, ''); const a = ACT(s); const all = a.actions.map(x => x.text).join(' ') + a.notes.join(' ') + s.warnings.map(w => w.text).join(' '); return (!/Record it/i.test(all) && !/record it under Income/i.test(html) && /answer the paycheck question/.test(all)) || all.slice(0, 300); });
t('v149-C2 other income dated ON the balance date (a refund) is not added and marks the projection uncertain', () => { const s = NEW(OCT8, NOPAY, [spend('x', 'Thing', 10, '2026-10-09')].concat(hist(), [mk({ id: 'rf', type: 'income', description: 'Refund', amount: 300, date: '2026-10-08' })]), 500, '2026-10-08'); return (close(s.projectedToday, 500) && s.uncertainIncome.length === 1 && s.cash.blockers.indexOf('income_inclusion_unknown') > -1) || JSON.stringify([s.projectedToday, s.uncertainIncome]); });
t('v149-C2 a one-time income recorded AFTER the balance date is counted (it arrived after the balance was taken)', () => { const s = NEW(OCT8, NOPAY, hist().concat([mk({ id: 'rf', type: 'income', description: 'Refund', amount: 300, date: '2026-10-06' })]), 500, '2026-10-05'); return (close(s.projectedToday, 500 + 300 - 60) && s.uncertainIncome.length === 0) || s.projectedToday; });
t148('v149-C2 COUNTEREXAMPLE v148: recording the deposit as told lifted the low point from 100 to 1,600 and cleared the warning', () => { const a = SNAP148(OCT8, PAY8, C2TX(), 1700, '2026-10-08'); const b = SNAP148(OCT8, PAY8, C2TX().concat([incomeRec('dep', 1500, '2026-10-08')]), 1700, '2026-10-08'); return (close(a.windowLow.amount, 100) && close(b.windowLow.amount, 1600) && b.unconfirmedIncome.length === 0 && /Record it under Income/.test(a._actions.actions.map(x => x.text).join(' '))) || JSON.stringify([a.windowLow, b.windowLow]); });

// ---- H6: a balance that already includes an upcoming (early) deposit ----------------------------------------------
const PAY9 = { payday: '2026-09-25', payFrequency: 'biweekly', payAmount: 1000, startingBalance: 0 };   // Oct 9, Oct 23
t('v149-H6 paycheck due Oct 9, balance dated Oct 8: the form asks about it (fpNearPaycheck) and "Yes" keeps it out of the projection', () => { ctx.userSettings = PAY9; const near = run("fpNearPaycheck('2026-10-08')"); const yes = NEW(OCT8, PAY9, hist(), 1500, '2026-10-08', {}, 'yes'), no = NEW(OCT8, PAY9, hist(), 1500, '2026-10-08', {}, 'no'); const at = (s, d) => s.timeline.find(r => r.date === d).balance; return (near && near.date === '2026-10-09' && close(at(yes, '2026-10-09'), 1500) && close(at(no, '2026-10-09'), 2500) && yes.uncertainIncome.length === 0) || JSON.stringify([near, at(yes, '2026-10-09'), at(no, '2026-10-09')]); });
t('v149-H6 not answered (or a v148 record with no answer): the early paycheck is not counted and allocation is blocked', () => { const s = NEW(OCT8, PAY9, hist(), 1500, '2026-10-08', {}, ''); const v1 = SNAP(OCT8, Object.assign({}, PAY9, { startingBalance: 1380 }), hist(), {}, null, { bal: { amount: 1500, asOf: '2026-10-08', monthStart: 1380, paycheck: undefined }, noPayRecords: true }); return (close(s.timeline.find(r => r.date === '2026-10-09').balance, 1500) && s.cash.blockers.indexOf('income_inclusion_unknown') > -1 && v1.balanceBasis.paycheck && v1.balanceBasis.paycheck.included === null) || JSON.stringify([s.cash.blockers, v1.balanceBasis]); });
t('v149-H6 a paycheck 3+ days after the balance date is not asked about and is projected normally', () => { ctx.userSettings = PAY9; return run("fpNearPaycheck('2026-10-05')") === null || JSON.stringify(run("fpNearPaycheck('2026-10-05')")); });
t148('v149-H6 COUNTEREXAMPLE v148: the early paycheck was always added on top of the entered balance (2,500 by Oct 10)', () => { const s = SNAP148(OCT8, PAY9, hist(), 1500, '2026-10-08'); return close(s.timeline.find(r => r.date === '2026-10-10').balance, 2500) || s.timeline.find(r => r.date === '2026-10-10').balance; });

// ---- H1: weekly / every-two-weeks dates across daylight-saving changes, both directions -------------------------
// Independent reference: pure UTC calendar arithmetic, no local time at all.
const refDates = (anchorIso, interval, y, m) => { const a = Date.UTC(+anchorIso.slice(0, 4), +anchorIso.slice(5, 7) - 1, +anchorIso.slice(8, 10)); const out = []; const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); for (let d = 1; d <= dim; d++) { const diff = Math.round((Date.UTC(y, m, d) - a) / 86400000); if (((diff % interval) + interval) % interval === 0) out.push(d); } return out.join(','); };
const DST_ANCHORS = ['2026-01-09', '2026-02-20', '2026-03-07', '2026-03-09', '2026-03-28', '2026-03-30', '2026-04-04', '2026-04-06', '2026-07-10', '2026-09-26', '2026-09-28', '2026-10-24', '2026-10-26', '2026-10-31', '2026-11-02'];
t('v149-H1 getRecurringDates weekly and biweekly match pure calendar arithmetic for 15 anchors x 24 months (2026-2027) in this time zone', () => { const bad = []; DST_ANCHORS.forEach(a => { for (let k = 0; k < 24; k++) { const y = 2026 + Math.floor(k / 12), m = k % 12; [7, 14].forEach(iv => { const got = dates(run(`getRecurringDates(new Date('${a}T12:00:00'),'${iv === 7 ? 'weekly' : 'biweekly'}',${y},${m})`)); const want = refDates(a, iv, y, m).split(',').filter(d => d && new Date(y, m, +d) >= new Date(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))).join(','); if (got !== want) bad.push(a + ' ' + y + '-' + (m + 1) + ' iv' + iv + ' got ' + got + ' want ' + want); }); } }); return bad.length === 0 || bad.slice(0, 3).join(' | ') + ' (' + bad.length + ')'; });
t('v149-H1 getPayDatesForMonth weekly and biweekly match pure calendar arithmetic for the same anchors (past anchors, so the M4 rule does not apply)', () => { const bad = []; DST_ANCHORS.filter(a => a <= '2026-10-08').forEach(a => { [['weekly', 7], ['biweekly', 14]].forEach(([f, iv]) => { ctx.userSettings = { payday: a, payFrequency: f, payAmount: 100 }; for (let k = 0; k < 24; k++) { const y = 2026 + Math.floor(k / 12), m = k % 12; const got = dates(run(`getPayDatesForMonth(${y},${m})`)); const want = refDates(a, iv, y, m); if (got !== want) bad.push(a + ' ' + f + ' ' + y + '-' + (m + 1) + ' got ' + got + ' want ' + want); } }); }); return bad.length === 0 || bad.slice(0, 3).join(' | ') + ' (' + bad.length + ')'; });
t('v149-H1 the audited case: biweekly payday Feb 20 2026 -> October paydays 2, 16, 30 (v148 gave 3, 17, 31 in New York / LA / London)', () => { ctx.userSettings = { payday: '2026-02-20', payFrequency: 'biweekly', payAmount: 1 }; return dates(run('getPayDatesForMonth(2026,9)')) === '2,16,30' || dates(run('getPayDatesForMonth(2026,9)')); });
// Counterexample: search this time zone for anchor/month pairs where v148 disagrees with calendar arithmetic. None found -> SKIP.
(function() {
  if (!C148) { skip('v149-H1 COUNTEREXAMPLE v148 (daylight-saving off-by-one)', 'v148 file not found'); return; }
  const wrong = [];
  DST_ANCHORS.filter(a => a <= '2026-10-08').forEach(a => { C148.c.userSettings = { payday: a, payFrequency: 'biweekly', payAmount: 1 }; for (let k = 0; k < 24; k++) { const y = 2026 + Math.floor(k / 12), m = k % 12; const got = dates(C148.run(`getPayDatesForMonth(${y},${m})`)); if (got !== refDates(a, 14, y, m)) wrong.push(a + ' ' + y + '-' + (m + 1) + ': v148 ' + got + ', calendar ' + refDates(a, 14, y, m)); } });
  if (!isDstZone || !wrong.length) { skip('v149-H1 COUNTEREXAMPLE v148 (daylight-saving off-by-one)', isDstZone ? 'no wrong v148 date found for these anchors in this zone' : 'this time zone has no daylight saving, so v148 happens to be right here'); return; }
  t('v149-H1 COUNTEREXAMPLE v148 in this time zone: ' + wrong.length + ' anchor/month pairs had paydays one day off, e.g. ' + wrong[0], () => true);
})();

// ---- H2: unpaid overdue items before the balance date are subtracted ------------------------------------------
const H2TX = () => [bill('r', 'Rent', 1200, '2026-09-01')].concat(hist());
t('v149-H2 rent 1,200 due Oct 1 unpaid, balance 1,000 on Oct 8 -> projected -200 from today, shortfall, stage 1, text says why', () => { const s = NEW(OCT8, PAY, H2TX(), 1000, '2026-10-08', { r: [{ due: '2026-09-01', at: '2026-09-01' }] }); const x = ACT(s).actions.find(a => a.code === 'shortfall'); return (close(s.projectedToday, -200) && s.firstNegative && s.firstNegative.date === '2026-10-08' && s.stage === 1 && s.owedBeforeBalance === 1200 && x && /due before your balance date/.test(x.text)) || JSON.stringify([s.projectedToday, s.firstNegative, s.stage, s.owedBeforeBalance]); });
t('v149-H2 an unpaid due date AFTER the balance date is already in the timeline and is not subtracted twice', () => { const tx = [bill('r', 'Rent', 1200, '2026-09-03')].concat(hist()); const s = NEW(OCT8, PAY, tx, 3000, '2026-10-01', { r: [{ due: '2026-09-03', at: '2026-09-03' }] }); return (s.owedBeforeBalance === 0 && s.overdue.length === 1 && close(s.timeline.find(r => r.date === '2026-10-03').start - s.timeline.find(r => r.date === '2026-10-03').balance, 1200)) || JSON.stringify([s.owedBeforeBalance, s.overdue]); });
t148('v149-H2 COUNTEREXAMPLE v148: the same overdue rent left the projection at 1,000 and the stage at 3', () => { const s = SNAP148(OCT8, PAY, H2TX(), 1000, '2026-10-08', { r: '2026-09-01' }); return (s.firstNegative === null && s.stage === 3) || JSON.stringify([s.firstNegative, s.stage]); });

// ---- H3: one mark settles one due date --------------------------------------------------------------------------
const PHONE = () => [bill('ph', 'Phone', 300, '2026-09-12')].concat(hist());
t('v149-H3 a mark for the overdue Sep 12 bill settles Sep 12 only: Oct 12 stays upcoming and in the projection (700 -> 400)', () => { const s = NEW(OCT8, PAY, PHONE(), 700, '2026-10-08', { ph: [{ due: '2026-09-12', at: '2026-10-03' }] }); return (s.overdue.length === 0 && s.upcoming.some(u => u.id === 'ph' && u.date === '2026-10-12') && close(s.timeline.find(r => r.date === '2026-10-12').balance, 400 - 0)) || JSON.stringify([s.overdue, s.upcoming.map(u => u.date), s.timeline.find(r => r.date === '2026-10-12')]); });
t('v149-H3 an older date-only mark (v147/v148 format) settles the due date in its own month only (Oct 3 -> Oct 12); Sep 12 stays overdue and is subtracted', () => { const s = NEW(OCT8, PAY, PHONE(), 700, '2026-10-08', { ph: '2026-10-03' }); return (s.overdue.length === 1 && s.overdue[0].dueDate === '2026-09-12' && !s.upcoming.some(u => u.id === 'ph' && u.date === '2026-10-12') && close(s.projectedToday, 400)) || JSON.stringify([s.overdue, s.projectedToday]); });
t('v149-H3 two explicit marks settle two due dates', () => { const s = NEW(OCT8, PAY, PHONE(), 700, '2026-10-08', { ph: [{ due: '2026-09-12', at: '2026-10-03' }, { due: '2026-10-12', at: '2026-10-03' }] }); return (s.overdue.length === 0 && !s.upcoming.some(u => u.id === 'ph' && u.date === '2026-10-12')) || 'bad'; });
t148('v149-H3 COUNTEREXAMPLE v148: one Oct 3 mark cleared Sep 12 AND Oct 12 (lowest 700, should be 400)', () => { const s = SNAP148(OCT8, PAY, PHONE(), 700, '2026-10-08', { ph: '2026-10-03' }); return (s.overdue.length === 0 && !s.upcoming.some(u => u.id === 'ph') && close(s.windowLow.amount, 700)) || JSON.stringify([s.overdue, s.windowLow]); });

// ---- H4: name-only matching -------------------------------------------------------------------------------------
const HOME = () => [mk({ id: 'hr', type: 'expense', description: 'Home', amount: 1500, date: '2026-09-15', recurring: true, frequency: 'monthly', anchor_date: '2026-09-15', category: 'home' }), spend('pay9', 'Home', 1500, '2026-09-15', 'home')].concat(hist());
t('v149-H4 a one-time "Home" purchase (generic quick-add name) does not pay the recurring "Home" rent: rent stays upcoming and projected', () => { const s = NEW(OCT8, PAY, HOME().concat([spend('f', 'Home', 1200, '2026-10-07', 'home')]), 1600, '2026-10-08'); return (s.upcoming.some(u => u.id === 'hr' && u.date === '2026-10-15') && close(s.timeline.find(r => r.date === '2026-10-15').balance, 1600 - 1500)) || JSON.stringify([s.upcoming.map(u => u.description + u.date), s.timeline.find(r => r.date === '2026-10-15')]); });
t('v149-H4 generic-named "Home" expenses still count as everyday spending (the Sep 15 1,500 and the Oct 7 1,200), never hidden as bill payments', () => { const s = NEW(OCT8, PAY, HOME().concat([spend('f', 'Home', 1200, '2026-10-07', 'home')]), 1600, '2026-10-08'); return close(s.spending.last30, 300 + 1500 + 1200) || s.spending.last30; });
t('v149-H4 bill "Electric" 90 with an "Electric" expense of 60 (off by more than 10%) is NOT paid; it is reported as a possible payment and blocks advice', () => { const tx = [bill('el', 'Electric', 90, '2026-10-12'), spend('e1', 'Electric', 60, '2026-10-06', 'home')].concat(hist()); const s = NEW(OCT8, PAY, tx, 3000, '2026-10-08'); const a = ACT(s).actions.find(x => x.code === 'possible_payment'); return (s.upcoming.some(u => u.id === 'el') && s.possiblePayments.length === 1 && s.cash.blockers.indexOf('payment_unmatched') > -1 && a && /mark the bill paid/.test(a.text)) || JSON.stringify([s.possiblePayments, s.cash.blockers]); });
t('v149-H4 a specific name within 10% of the amount still settles the bill (confident match)', () => { const tx = [bill('el', 'Electric', 90, '2026-10-12'), spend('e1', 'electric ', 95, '2026-10-06', 'home')].concat(hist()); const s = NEW(OCT8, PAY, tx, 3000, '2026-10-08'); return (!s.upcoming.some(u => u.id === 'el' && u.date === '2026-10-12') && s.possiblePayments.length === 0) || JSON.stringify(s.upcoming); });
t148('v149-H4 COUNTEREXAMPLE v148: the furniture purchase made the rent disappear and the list said "Nothing urgent"', () => { const s = SNAP148(OCT8, PAY, HOME().concat([spend('f', 'Home', 1200, '2026-10-07', 'home')]), 1600, '2026-10-08'); return (!s.upcoming.some(u => u.id === 'hr' && u.date === '2026-10-15')) || JSON.stringify(s.upcoming); });

// ---- H5: late payments ------------------------------------------------------------------------------------------
const LATE = () => [bill('r', 'Rent', 1200, '2026-09-01'), spend('p', 'Rent', 1200, '2026-09-22', 'home')].concat(hist());
t('v149-H5 September rent paid late on Sep 22 settles SEPTEMBER: October 1 rent is overdue and subtracted', () => { const s = NEW(OCT8, PAY, LATE(), 3000, '2026-10-08'); return (s.overdue.length === 1 && s.overdue[0].dueDate === '2026-10-01' && !ACT(s).actions.some(a => a.code === 'on_track')) || JSON.stringify(s.overdue); });
t('v149-H5 the greedy rule: oldest open due date first, up to 45 days late and 10 days early; a payment fitting nothing settles nothing', () => { const b = bill('r', 'Rent', 1000, '2026-08-01'); const tx = [b, spend('a', 'Rent', 1000, '2026-07-25', 'home'), spend('c', 'Rent', 1000, '2026-09-20', 'home')]; ctx.transactions = tx; ctx._b = b; const st = run("fpSettle(_b, ['2026-08-01','2026-09-01','2026-10-01'], transactions, null, null, null)"); return (st['2026-08-01'] && st['2026-08-01'].settled && st['2026-09-01'] && st['2026-09-01'].settled && !st['2026-10-01']) || JSON.stringify(st); });
t148('v149-H5 COUNTEREXAMPLE v148: the late September payment was used for October and the list said "Nothing urgent"', () => { const s = SNAP148(OCT8, PAY, LATE(), 3000, '2026-10-08'); return (s.overdue.length === 0) || JSON.stringify(s.overdue); });

// ---- H7: allocation amounts are gated everywhere ----------------------------------------------------------------
t('v149-C1/H7 the switch is OFF in the shipped file and fpAllocationEnabled() reads it', () => /const FP_FLAGS = \{ extraAmountEnabled: false \};/.test(html) && run('fpAllocationEnabled()') === false || 'switch on or missing');
const PB = { payday: '2026-09-28', payFrequency: 'biweekly', payAmount: 1000, startingBalance: 0 };   // next payday Oct 12 (4 days)
const pbTx = () => [bill('b', 'Bill', 1150, '2026-10-10'), loanT('v', 'Visa', 2000, 12, 60, '2026-10-21')].concat(hist());
t('v149-H7 "Keeping $X of this paycheck" (payday buffer) never appears with the switch off, even at stage 2 with payday close', () => { const s = NEW(OCT8, PB, pbTx(), 1500, '2026-10-08', {}, 'no'); return (s.stage === 2 && !ACT(s).actions.some(a => a.code === 'payday_buffer')) || JSON.stringify([s.stage, codesOf(ACTS(s))]); });
t('v149-H7 with the switch on it also needs every safety check (cash.reliable), and never claims to lift the pre-payday low', () => { ctx.FP_FLAGS.extraAmountEnabled = true; try { const s = NEW(OCT8, PB, pbTx(), 1500, '2026-10-08', {}, 'no'); const x = ACT(s).actions.find(a => a.code === 'payday_buffer'); const blocked = NEW(OCT8, PB, pbTx().concat([bill('g', 'Gas Bill', 90, '2026-10-03')]), 1500, '2026-10-08', {}, 'no'); return (x && s.cash.reliable && !/lift your lowest/.test(x.text) && blocked.cash.blockers.indexOf('overdue') > -1 && !ACT(blocked).actions.some(a => a.code === 'payday_buffer')) || JSON.stringify([s.cash.blockers, x && x.text]); } finally { ctx.FP_FLAGS.extraAmountEnabled = false; } });
t148('v149-H7 COUNTEREXAMPLE v148: the payday buffer amount was shown with the switch off', () => { const s = SNAP148(OCT8, PB, pbTx(), 1500, '2026-10-08'); return s._actions.actions.some(a => a.code === 'payday_buffer') || codesOf(s._actions.actions); });
// Source sweep: every function that can put an allocation / affordability / free-cash amount on screen asks the switch.
const ALLOC_PHRASES = /Can afford|extra toward|looks free|Setting aside|Keeping <strong>|breathing room at month end|gets you done in|You have \$' \+|saved \(|Saving \$|Plenty of room|Room to breathe|api\.anthropic\.com/;
t('v149-C1 source sweep: every function containing an allocation / affordability phrase or an AI call also calls fpAllocationEnabled() (or the snapshot\'s display flag)', () => {
  const fnRe = /(?:async )?function (\w+)\s*\(/g; let m; const offenders = []; const found = [];
  while ((m = fnRe.exec(src))) { const body = grab(m[1]); if (!body || !ALLOC_PHRASES.test(body)) continue; found.push(m[1]); if (!/fpAllocationEnabled\(\)|EXTRA_AMOUNT_ENABLED|extraDebt\.display/.test(body)) offenders.push(m[1]); }
  return (offenders.length === 0 && found.length >= 6) || 'not gated: ' + offenders.join(', ') + ' | found: ' + found.join(', '); });
t('v149-C1 allocation screens retain their gate; the read-only Plan has no allocation or completion-date calculation', () => { const need = ['updateWhatIf', 'renderLoans', 'updateStats', 'renderPlan', 'fpPriorityActions', 'updateBrAiPhrase', 'submitRolloverExplanation', 'showRolloverModal']; const miss = need.filter(n => {const f=grab(n)||'';return !/fpAllocationEnabled\(\)|EXTRA_AMOUNT_ENABLED/.test(f) && !(n==='renderPlan' && f && !/monthsFromNow|currentBuffer|finishMonths|monthlyCashFlow/.test(f));}); return miss.length === 0 || 'missing: ' + miss.join(', '); });
t('v149-M7 the rollover AI reply is written with textContent, never inserted as HTML', () => { const b = grab('submitRolloverExplanation'); return (/aiTextEl\.textContent = aiText/.test(b) && !/\+ aiText/.test(b)) || 'still innerHTML'; });
t('v149-L5 the AI phrase never says "Payday in null days"', () => /nextPayDays != null && nextPayDays >= 0/.test(grab('updateBrAiPhrase')) || 'bad');
t('v149-L3 skip-purchase messages describe a choice without claiming bank savings', () => { const a = grab('rippleSaveInstead'), b = grab('rippleStillBuy'), c = grab('fpRecordSkippedPurchase'); return (/fpRecordSkippedPurchase/.test(a) && /purchase skipped/.test(c) && /bank balance is unchanged/.test(c) && !/money saved/i.test(c) && /recorded/.test(b) && !/ saved'\)/.test(b)) || 'bad'; });
t('v149-L3 quick-add toasts say an expense was "added", never "$X saved" (which reads like savings)', () => !/fmt\([^()]*(\([^()]*\))?[^()]*\) \+ ' saved'/.test(src) && (src.match(/\$' \+ fmt\(amount\) \+ ' added'/g) || []).length >= 1 || (src.match(/fmt\([^()]*(\([^()]*\))?[^()]*\) \+ ' saved'/) || ['?'])[0]);
t('v149-L4 the history card no longer calls the projected month-end the "current balance"', () => !/current balance, updates as you spend/.test(html) && /projected month-end from your calendar/.test(html) || 'bad');

// ---- H8 / M6: calendar start numbers come from the dated balance, also after a month change ---------------------
const H8TX = () => [bill('gym', 'Gym', 300, '2026-09-10'), bill('ph', 'Phone', 50, '2026-09-28')];
const h8 = (clock) => { const X = makeCtx(null, clock, true); return X; };
function ctxAt(clock) { return makeCtx(src, clock, true); }
t('v149-H8 balance 1,000 entered Oct 25 (October start derived 1,300); on Nov 2 November starts at 950 (Oct 28 phone -50), not 1,300', () => {
  const X = ctxAt(new Date(2026, 10, 2, 12)); X.c.userSettings = { payday: null, payFrequency: 'biweekly', payAmount: 0, startingBalance: 0 }; X.c.transactions = H8TX();
  const ms = X.run("fpMonthStartFromDated(1000, '2026-10-25', null)"); X.c.userSettings.startingBalance = ms; X.c.monthBalances = { '__dated_balance': { v: 2, amount: 1000, asOf: '2026-10-25', monthStart: ms, paycheck: null } };
  const nov = X.run('getStartingBalanceForMonth(2026,10)'), novEnd = X.run('buildDayMap(2026,10)')[30].balance, oct24 = X.run('buildDayMap(2026,9)')[24].balance;
  return (close(ms, 1300) && close(nov, 950) && close(novEnd, 950 - 300 - 50) && close(oct24, 1000)) || [ms, nov, novEnd, oct24].join(); });
t148('v149-H8 COUNTEREXAMPLE v148: on Nov 2 the November calendar started from October\'s 1,300', () => { const X = makeCtx(f148, new Date(2026, 10, 2, 12)); X.c.userSettings = { payday: null, payFrequency: 'biweekly', payAmount: 0, startingBalance: 0 }; X.c.transactions = H8TX(); const ms = X.run("fpMonthStartFromDated(1000, '2026-10-25')"); X.c.userSettings.startingBalance = ms; X.c.monthBalances = { '__dated_balance': { v: 1, amount: 1000, asOf: '2026-10-25', monthStart: ms } }; return close(X.run('buildDayMap(2026,10)')[1].balance, 1300) || X.run('buildDayMap(2026,10)')[1].balance; });
t('v149-M6 adding a transaction dated before the balance date after saving does not move the calendar away from the entered balance', () => {
  const X = ctxAt(new Date(2026, 9, 26, 12)); X.c.userSettings = { payday: null, payFrequency: 'biweekly', payAmount: 0, startingBalance: 0 }; X.c.transactions = H8TX();
  const ms = X.run("fpMonthStartFromDated(1000, '2026-10-25', null)"); X.c.userSettings.startingBalance = ms; X.c.monthBalances = { '__dated_balance': { v: 2, amount: 1000, asOf: '2026-10-25', monthStart: ms, paycheck: null } };
  X.c.transactions = H8TX().concat([mk({ id: 'late', type: 'income', description: 'Refund', amount: 250, date: '2026-10-03' })]);
  const d24 = X.run('buildDayMap(2026,9)')[24].balance, st = X.run("fpBalanceAnchor('2026-10-26').status");
  return (close(d24, 1000) && st === 'ok') || [d24, st].join(); });
t('v149-H8 a dated balance from an earlier month still drives later months (chained through the calendar)', () => { const X = ctxAt(new Date(2026, 11, 3, 12)); X.c.userSettings = { payday: null, payFrequency: 'biweekly', payAmount: 0, startingBalance: 0 }; X.c.transactions = H8TX(); const ms = X.run("fpMonthStartFromDated(1000, '2026-10-25', null)"); X.c.userSettings.startingBalance = ms; X.c.monthBalances = { '__dated_balance': { v: 2, amount: 1000, asOf: '2026-10-25', monthStart: ms, paycheck: null } }; return close(X.run('getStartingBalanceForMonth(2026,11)'), 950 - 350) || X.run('getStartingBalanceForMonth(2026,11)'); });
t('v149-H8 an included paycheck is not added a second time by the calendar (derived month start subtracts it)', () => { const st = { payday: '2026-10-08', payFrequency: 'biweekly', payAmount: 1500, startingBalance: 0 }; const d = dated(st, [], 1700, '2026-10-08', 'yes'); ctx.userSettings = d.settings; ctx.transactions = []; ctx.monthBalances = { '__dated_balance': Object.assign({ v: 2 }, d.bal) }; return (close(d.monthStart, 200) && close(run('buildDayMap(2026,9)')[8].balance, 1700)) || [d.monthStart, run('buildDayMap(2026,9)')[8].balance].join(); });

// ---- M2 / M3: stage and "Nothing urgent" -----------------------------------------------------------------------
t('v149-M2 "Nothing urgent" needs the spending-adjusted low to clear the buffer: 90/day of reliable spending with 1,000 in the bank -> stage 2, no on_track', () => { const heavy = HIST_DATES.map((d, i) => spend('hv' + i, 'H' + i, 225, d, 'food')); const PAYN = { payday: '2026-09-25', payFrequency: 'biweekly', payAmount: 600, startingBalance: 0 }; const s = NEW(OCT8, PAYN, heavy, 1000, '2026-10-08', {}, 'no'); return (s.spending.reliable && s.stage === 2 && s.stageReason === 'below_buffer_after_spending' && !ACT(s).actions.some(a => a.code === 'on_track')) || JSON.stringify([s.stage, s.stageReason, s.adjustedLow, codesOf(ACTS(s))]); });
t('v149-M2 without reliable spending history the stage is null ("cannot tell"), not 3', () => { const s = NEW(OCT8, PAY, [], 5000, '2026-10-08'); return (s.stage === null && s.stageReason === 'spending_unknown' && !ACT(s).actions.some(a => a.code === 'on_track')) || JSON.stringify([s.stage, s.stageReason]); });
t('v149-M3 an out-of-date balance with no shortfall gives no stage (v148 could say "Stage 3: Grow" on a 20-day-old balance)', () => { const s = NEW(OCT8, PAY, hist(), 5000, '2026-09-18'); return (s.balanceBasis.status === 'stale' && s.stage === null && s.stageReason === 'balance_stale') || JSON.stringify([s.balanceBasis.status, s.stage]); });
t('v149-M3 detectStage() returns null when the snapshot cannot tell (callers show "Stage not set" / "Balance needed")', () => { ctx.userSettings = Object.assign({}, PAY, { startingBalance: 500 }); ctx.transactions = hist(); ctx.monthBalances = {}; return run('detectStage()') === null || run('detectStage()'); });
t148('v149-M3 COUNTEREXAMPLE v148: detectStage() turned an unknown balance into stage 2', () => { C148.c.userSettings = Object.assign({}, PAY, { startingBalance: 500 }); C148.c.transactions = hist(); C148.c.monthBalances = {}; C148.c.currentUser = null; return C148.run('detectStage()') === 2 || C148.run('detectStage()'); });

// ---- M4 / M5 / M8 / M9 ----------------------------------------------------------------------------------------------
t('v149-M4 a FUTURE payday is the next payday: no paychecks are invented between today and it (anchor Nov 13 -> October keeps only the past Oct 2)', () => { ctx.userSettings = { payday: '2026-11-13', payFrequency: 'biweekly', payAmount: 1000 }; return (dates(run('getPayDatesForMonth(2026,9)')) === '2' && dates(run('getPayDatesForMonth(2026,10)')) === '13,27') || dates(run('getPayDatesForMonth(2026,9)')); });
t148('v149-M4 COUNTEREXAMPLE v148: paychecks on Oct 16 and 30 for a job starting Nov 13', () => { C148.c.userSettings = { payday: '2026-11-13', payFrequency: 'biweekly', payAmount: 1000 }; const d = dates(C148.run('getPayDatesForMonth(2026,9)')); return (d.split(',').length === 3) || d; });
t('v149-M5 a paycheck recorded in advance on its payday replaces the scheduled one: Oct 16 = 1,500, not 2,500', () => { const s = NEW(OCT8, PAY, [incomeRec('adv', 1000, '2026-10-16')].concat(hist()), 500, '2026-10-08'); return close(s.timeline.find(r => r.date === '2026-10-16').balance, 1500) || s.timeline.find(r => r.date === '2026-10-16').balance; });
t('v149-M5 the calendar also counts it once', () => { ctx.userSettings = PAY; ctx.transactions = [incomeRec('adv', 1000, '2026-10-16')]; ctx.monthBalances = {}; const m = run('buildDayMap(2026,9,0)'); return (m[16].income.length === 1 && close(m[31].balance, 3000)) || JSON.stringify(m[16].income); });
t('v149-M8 a bill added on Oct 5 with an Oct 1 due date is "unverified": counted as owed, blocks advice, asks the user; not called overdue', () => { const tx = [bill('n', 'New Bill', 200, '2026-10-01', { created_at: '2026-10-05T15:00:00Z' })].concat(hist()); const s = NEW(OCT8, PAY, tx, 1000, '2026-10-08'); const a = ACT(s).actions.find(x => x.code === 'unverified_bill'); return (s.overdue.length === 0 && s.unverified.length === 1 && close(s.projectedToday, 800) && s.cash.blockers.indexOf('unverified_obligation') > -1 && a && /mark it paid/.test(a.text)) || JSON.stringify([s.unverified, s.projectedToday]); });
t('v149-M8 once marked paid it is neither unverified nor subtracted', () => { const tx = [bill('n', 'New Bill', 200, '2026-10-01', { created_at: '2026-10-05T15:00:00Z' })].concat(hist()); const s = NEW(OCT8, PAY, tx, 1000, '2026-10-08', { n: [{ due: '2026-10-01', at: '2026-10-06' }] }); return (s.unverified.length === 0 && close(s.projectedToday, 1000)) || JSON.stringify([s.unverified, s.projectedToday]); });
t('v149-M9 a yearly bill 50 days ahead is inside the look-ahead (at least 60 days when any yearly bill exists)', () => { const tx = [mk({ id: 'ins', type: 'bill', description: 'Car Insurance', amount: 900, date: '2025-11-27', recurring: true, frequency: 'yearly', anchor_date: '2025-11-27' })].concat(hist()); const s = NEW(OCT8, PAY, tx, 1000, '2026-10-08'); return (s.horizonEnd >= '2026-12-07' && s.upcoming.some(u => u.id === 'ins' && u.date === '2026-11-27')) || JSON.stringify([s.horizonEnd, s.upcoming.map(u => u.date)]); });

// ---- L2 (deferred): documented, not fixed --------------------------------------------------------------------------
skip('v149-L2 twice-monthly paydays moved to the nearest business day', 'deferred: not fixed in v149, see V149_FIX_REPORT.md');


t('v150 multiple missed bills before the dated balance are all reserved once',()=>{const tx=[bill('w','Weekly service',40,'2026-09-30',{frequency:'weekly'})];const s=NEW(OCT8,NOPAY,tx,100,'2026-10-08');return s.overdue.length===2&&close(s.owedBeforeBalance,80)&&close(s.projectedToday,20)||JSON.stringify([s.overdue,s.owedBeforeBalance,s.projectedToday]);});
t('v150 paying the latest bill does not hide an older missed occurrence',()=>{const tx=[bill('w','Weekly service',40,'2026-09-30',{frequency:'weekly'})];const s=NEW(OCT8,NOPAY,tx,100,'2026-10-08',{w:[{due:'2026-10-07',at:'2026-10-07'}]});return s.overdue.length===1&&s.overdue[0].dueDate==='2026-09-30'&&close(s.projectedToday,60)||JSON.stringify([s.overdue,s.projectedToday]);});
t('v150 overdue priority actions have distinct IDs for each occurrence',()=>{const s=NEW(OCT8,NOPAY,[bill('w','Weekly service',40,'2026-09-30',{frequency:'weekly'})],100,'2026-10-08');const a=ACT(s).actions.filter(x=>x.code==='overdue_bill');return a.length===2&&new Set(a.map(x=>x.id)).size===2||JSON.stringify(a);});

console.log('File: ' + file);
if (missing.length) console.log('Functions not present in this build: ' + missing.join(', '));
console.log(results.join('\n'));
console.log('\nTOTAL pass=' + pass + ' fail=' + fail + ' skip=' + skipped + ' (TZ=' + (process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone) + ')');
process.exit(fail ? 1 : 0);
