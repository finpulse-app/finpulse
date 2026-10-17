# FinPulse v150 review candidate

Development is in draft PR #1. Production index.html is deliberately unchanged.
See phase1/V150_FIX_REPORT.md for the repaired behavior, database migrations,
verification limits and release steps. No public deployment is implied by this branch.

## Checks

Run node phase1/run-security-tests.js finpulse-v2-150.html and
node phase1/run-current-formulas.js finpulse-v2-150.html.
GitHub runs these in New York, UTC, Los Angeles and Auckland, Chromium checks in
New York and Auckland, disposable PostgreSQL 17 tests and anonymous API checks.
The unavailable historical v147 comparisons and skips are not passes.
Test dependencies run on GitHub runners; no local installation is needed.
Never run the database fixture or test-atomic.js against a live project.

## Live integration

Twenty authenticated API checks passed with two disposable accounts. Both signed
out globally and were removed with their synthetic records; cleanup was verified.
Real-account browser review was read-only. The preview connects to real account data.
Bill paid/unpaid marks now persist to owner-scoped account rows and refresh across
devices. They record status; they do not move money or change calendar expenses.
Transaction reload and import confirmation handle accounts above 1,000 rows.

## Release limits

Verify the destination host and email confirmation/reset delivery before publishing.
Leaked-password protection needs a Supabase dashboard review. Billing and direct
bank connections are not enabled. Weekend/holiday paycheck shifts and automatic
extra-payment allocation remain deferred. Statement-format fixtures do not establish
compatibility with every bank export. See the final PR checks for the verified revision.

## Product functionality

See phase1/PRODUCT_FUNCTIONALITY.md for account-saved goals, calendar agenda, expense search, CSV/JSON exports, calculator improvements and design polish. Current work prioritizes the look and everyday functionality; login/security configuration and publishing are deferred.
