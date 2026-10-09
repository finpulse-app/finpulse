# FinPulse product functionality pass

This pass prioritizes the app's appearance and working everyday features. Login,
security configuration and public launch setup are deferred at the user's request.

## Working additions

- Goals: create a target, record saved progress, set an optional monthly plan/date,
  edit it, archive it and restore it. Goals are account-owned and load across devices.
  The progress bar uses recorded savings, not calendar estimates. The timeline is
  arithmetic using the user's planned monthly amount; it does not move money.
- Calendar agenda: switch between the month grid and a readable daily list. The
  list includes every day, scheduled items and the same projected balances as the
  grid. Each day opens the existing transaction editor. Grid days work by keyboard.
- Expenses: search saved records by name, category or date, clear the search and
  export a CSV report. Searching does not change monthly totals.
- Data export: CSV reports preserve quotes, newlines and cents and protect text
  from spreadsheet formula interpretation. JSON includes transactions, settings,
  dated balances, goals, account bill status and device purchase notes. These are
  exports; a JSON restore workflow is not implemented in this pass.
- Loans: enter the actual statement payment, including zero-interest loans.
  Credit-card estimates remain editable. Changing an APR or balance preserves a
  payment the user already entered.
- Future Value: entered amounts preserve cents, support zero and reject malformed
  input without displaying stale amounts, milestone values or chart data.
- Navigation and design: clearer Goals navigation, active states for all view
  changes, return to the top when changing screens, keyboard card controls,
  comfortable spacing and responsive stacked goal forms.
- Routine account loading no longer opens a delayed stage modal over a working
  editor. Save failures keep goal inputs; retry reuses the goal's UUID. Late goal
  refreshes cannot replace a newly confirmed save.

## Verification

The PR's latest checks contain the exact verified head and counts. Browser tests
exercise the actual goal form, save/reload/edit/archive/restore, injected failures,
lost confirmations, agenda day selection, search, downloads, calculator inputs and statement-payment loan forms.
Database tests run the financial-goals migration against disposable PostgreSQL.
Real-account preview review is read-only; no sample goal or transaction is saved
to the existing account. Test dependencies run on GitHub, with no local installs.

The financial_goals table is additive and separate from transactions. A new goal
does not change a loan balance, payment history or calendar cash. Existing repair
checks remain required. Eighteen missing historical comparisons and twelve skips
are not counted as passes.
