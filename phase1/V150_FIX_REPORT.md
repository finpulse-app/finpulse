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
rejected and created no receipt. The initial verification did not mutate signed-in financial rows. The live integration follow-up below used only disposable test accounts.

Security advisor: the new [no-policy information notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
is intentional: private receipts deny all direct client access, and the private
function accesses them under its owner with explicit account checks. The existing
[disabled leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
remains. Performance notices concern existing [per-row auth checks in public RLS](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)
and the [new index not yet used](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Remaining release checks

The live Auth/Data API follow-up below verifies sign-in and two-account API behavior. Full browser flows against the live service and email delivery/confirmation (currently disabled) still need release verification. Real statement imports and device checks remain. Bill settlement marks
are device-local, twice-monthly business-day shifts are deferred, and extra-payment
allocation remains disabled. No local developer tools or browser package installs
were required; test dependencies run on GitHub's machines.

## Transaction form and import follow-up

All remaining transaction write paths now check returned errors, thrown failures and missing confirmations. Expense/category/loan/income editors commit local state only from an owner-scoped returned row. Failure retains the form and inputs; zero loan balances stay zero. Loan payment category and amount edits are blocked to preserve principal linkage.

New entries and statement imports store stable client-generated UUIDs in account-scoped browser storage before sending. A duplicate-key response on retry triggers owner-scoped reads of the original IDs; every row must be present before success is shown. Read requests are grouped in 100-ID chunks. One pending insert batch blocks a different batch until confirmed. Clearing browser storage before an ambiguous save is checked removes this retry protection. System notes use the same confirmed write path.

The expanded client suite passes 60 tests locally; new browser fault checks and live anonymous API checks are queued for GitHub validation. The live API check uses only the existing public anon key, reads Auth settings and confirms anonymous reads return no account records. It creates no users, sends no emails and changes no financial records. Authenticated sign-in and two-account Data API behavior were subsequently verified as described below.

## Live authenticated integration verification

Fourteen real Auth/Data API checks passed on October 9, 2026. Two disposable accounts used generated credentials held only in process memory. Current Auth settings enable automatic confirmation, so signup returned sessions without sending emails. Both accounts could sign in with passwords and verify their users. Owner-scoped reads, updates, insert ownership checks and settings isolation passed; foreign-account loan mutation and ownership transfer were rejected. A stable UUID insert retry returned the original row after a duplicate-key error. Live regular/extra payment, operation replay, deletion and undo matched exact principal and row IDs.

Both accounts signed out globally (HTTP 204). They and their synthetic data were then removed through exact ID/email predicates. Follow-up SQL confirmed zero remaining test users, sessions, transactions, settings or receipts. Existing accounts and financial records were not changed. No credentials or tokens are committed. Email delivery was not tested and Auth configuration was not changed.

The first follow-up CI run passed client/formula and live anonymous API checks but could not start PostgreSQL because Docker Hub rate-limited its image pull. The workflow now uses [Docker's verified PostgreSQL image on ECR Public](https://gallery.ecr.aws/docker/library/postgres). A browser test trying to fill the read-only calculated loan payment field was corrected to enter APR and use the actual calculator. Final browser/database checks are pending the updated run.

Large imports also recover when the Data API truncates the insert response at its row limit: all original UUIDs are read in 100-ID groups before the batch is confirmed. A 1,001-row test verifies this without duplicate inserts or partial success.
