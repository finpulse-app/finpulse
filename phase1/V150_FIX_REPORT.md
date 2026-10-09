# FinPulse v150 review candidate

Draft PR: https://github.com/finpulse-app/finpulse/pull/1
Verified code revision: `ba652e70b2faa6668f77f7fcd73be0586e723dea`.
All seven jobs passed in [GitHub Actions run 37989499589](https://github.com/finpulse-app/finpulse/actions/runs/37989499589).

## Implemented

The candidate preserves the supplied redacted v149 as a control and fixes unsafe
stored-text rendering, failed settings saves, account state leaking across account
changes, signup before email confirmation, and impossible imported dates. Failed
settings saves preserve the old state/cache and keep dialogs open. Account and
load guards discard stale responses. Skipped-purchase caches are account/year scoped.

Loan recording, transaction deletion and undo now call one database operation.
Regular and optional extra payment rows commit with their principal reduction.
Deletion/undo commit with the matching balance reversal. The database calculates
from stored owner rows, locks changes, and protects receipts in a private schema.
Undo restores the original row UUID so payment links survive restoring a loan.
Explicit zero balances remain zero. Legacy regular payments retain the prior
interest estimate only when a unique owned loan matches; ambiguous matches fail.

A pending operation UUID is stored before sending the request. A lost confirmation
can be retried without applying a second payment. Reload offers Check change to
recover pending recording, deletion or undo. Success animations/toasts await a
commit; failed forms stay open, confirmation controls recover, and undo state is
retained. Responses and animations from a different account/dialog are discarded.

## Verification

- 40 client regression tests passed in New York, UTC, Los Angeles and Auckland.
- 26 real PostgreSQL 17 tests passed against the live schema's column constraints
  and synthetic accounts. They cover commit/rollback, injected failures, retries,
  concurrent requests, cross-account denial, anonymous access, receipt permissions,
  zero balances, payment links, legacy matching and stale undo.
- 134 Chromium browser assertions passed in New York and Auckland. This includes
  real clicks and recovery after reload for a committed operation whose response
  was lost. Browser tests use a fake backend; database tests run independently.
- The unchanged formula suite has 226 passes in each of four time zones, 18
  unavailable v147 comparisons and 12 skips. Missing comparisons are never counted
  as passes. Inline JavaScript and changed test scripts pass syntax checks.

## Supabase change and verification

The additive `atomic_transaction_operations` migration was applied to FinPulse
project `qllshfubwzdoiyavypan`. It adds the private receipts table, private operation
function, public invoker wrapper, and an index for owner-scoped transaction reads.
No existing financial records were changed. The public `index.html`, Auth settings
and website deployment remain unchanged; the updated client remains a draft.

Live metadata checks confirmed the deployed function bodies match the tested SQL,
empty search paths, anonymous execute denial, RLS on receipts, and no client
SELECT/INSERT/UPDATE access to receipts. An unauthenticated function call was
rejected and created no receipt. No signed-in financial mutation was run live.

Security advisor: the new [no-policy information notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
is intentional: private receipts deny all direct client access, and the private
function accesses them under its owner with explicit account checks. The existing
[disabled leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
remains. Performance notices concern existing [per-row auth checks in public RLS](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)
and the [new index not yet used](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Remaining release checks

Other transaction writes (including loan edits, new entries and imports) still
need consistent error and account-transition handling. Verify real Supabase sign-in,
email confirmation, two-account API behavior and staged read/write flows before
release. Real statement imports and device checks remain. Bill settlement marks
are device-local, twice-monthly business-day shifts are deferred, and extra-payment
allocation remains disabled. No local developer tools or browser package installs
were required; test dependencies run on GitHub's machines.
