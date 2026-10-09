# FinPulse v150 review candidate

Based on the user-supplied redacted v149 review ZIP. Original v149 source is retained
as `finpulse-v2-149.html`; v150 is a separate candidate. `index.html` is unchanged.

## Changes

- Escape transaction descriptions and category/lender labels at HTML display
  boundaries in expenses, calendar details, loan dialogs/cards, bills, income and
  Insights. Stored descriptions and financial matching remain unchanged.
- Require a successful returned settings row before updating settings, dated
  balances or the browser cache. Read errors, write errors, network exceptions and
  zero-row writes preserve the prior state. Balance/setup/income dialogs remain
  open after failure and do not show a success message.
- Load both settings and transactions for a captured account ID, and discard
  responses from an older load or a different signed-in account. Clear financial
  state, pending dialogs/imports/undo state and cached Insights on account changes.
  Reset the visible section to Calendar before displaying the next account.
- Use a year-and-account-scoped skipped-purchase cache. Legacy unscoped cache is
  deliberately not imported because its account cannot be determined.
- Open the authenticated app after signup only when Supabase returns a session.
  Otherwise show the email-confirmation message.
- Reject impossible CSV dates instead of normalizing them into another month.
  Supported formats: ISO date (optionally followed by a timestamp), MM/DD/YYYY and
  MM/DD/YY. Invalid/unsupported rows use the existing unreadable-row summary.
- Restore only the existing publicly published Supabase anon key in v150. v149
  remains redacted. No service-role keys or private financial data are included.
- Preserve explicit zero loan balances when calculating a payment or reversing
  payment deletion/undo. A paid-off loan cannot use its monthly amount as debt.
- Add standard-library Node regression checks and GitHub Actions for four time
  zones. Adjust the supplied browser fake backend to return settings rows for
  `.select().single()` after writes and model signup sessions correctly; make its
  Playwright module path configurable.

## Verification

30 new regression checks pass in America/New_York, UTC, America/Los_Angeles and
Pacific/Auckland. They include fault injection, zero-row writes, valid/invalid
signup sessions, HTML payload rendering, leap-year dates, empty new accounts,
late account responses, clearing pending state, cache isolation, dated-balance
failure and keeping failed edit dialogs open. Four additional checks cover numeric
and text zero balances, deleting a payment from a paid-off loan and undo.

The supplied formula suite is unchanged. Against v150 it reports the same result
as v149 in all four time zones: 226 passes, 18 missing-v147 comparison failures,
12 skips (missing v148 comparisons and the deferred payday behavior).
`run-current-formulas.js` labels the 18 missing-input failures as UNAVAILABLE and
fails on any other failure. These missing comparisons are never counted as passes.

The original five independent audit reproductions failed against v149 before
implementation. Their failure scenarios are covered by the new regression suite.
Full inline JavaScript and the adapted browser harness pass syntax checks.

Browser tests run on GitHub-hosted Chromium in New York and Auckland time zones,
with Playwright 1.58.2 and a fake backend. Their first run is pending; local Chrome
aborted before any assertion ran. No live Supabase mutation or two-account backend
test was performed. Local tests use synthetic values and mocked responses.

## Remaining release blockers

This patch handles settings persistence, not every transaction write. Loan
recording/deletion still uses multiple backend operations and must be made atomic.
Other transaction writes need consistent error and account-transition handling.
Bill paid marks remain local to a device. Twice-monthly business-day shifts are
deferred. Extra-payment allocation stays disabled. Staging auth, browser flows,
real imports and device checks are required before deployment.

No production files, Supabase rows/schema, Auth configuration or deployment were
changed. The GitHub work is a draft pull request for review.
