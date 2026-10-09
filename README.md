# FinPulse development

`finpulse-v2-150.html` is the review candidate based on the supplied v149 review
ZIP. It fixes settings-save failures, unsafe text rendering, account isolation,
signup confirmation, invalid import dates, and atomic loan recording/deletion/undo.
The original redacted v149 is retained for regression controls. The candidate uses
only the existing public Supabase anon key. Production `index.html` is unchanged.

The atomic database operation has been added to FinPulse Supabase through the
`atomic_transaction_operations` migration. The updated HTML remains in a draft PR,
not deployed. See `database/README.md` for ownership and retry behavior.

## Checks

Node.js 22 or newer runs the standard-library client and formula checks without
npm dependencies:

```sh
TZ=America/New_York node phase1/run-security-tests.js finpulse-v2-150.html
TZ=America/New_York node phase1/run-current-formulas.js finpulse-v2-150.html
```

GitHub repeats these in four time zones, runs Chromium browser checks in New York
and Auckland, and runs real SQL tests on a disposable PostgreSQL 17 service.
Dependencies are installed only on GitHub runners. Never run the database fixture
or test script on a real Supabase project.

On code revision ba652e7, all seven jobs passed: 40 client tests in each time zone,
26 database tests, 134 browser assertions in each browser time zone, and 226 formula
passes per time zone. Eighteen historical comparisons are unavailable because v147
is missing, and 12 checks are skipped; missing comparisons are not passes.

Browser checks use a fake backend. Real Supabase Auth/Data API integration,
authenticated account integration and device/import checks still need
verification before deployment. Bill marks remain device-local; business-day shifts
are deferred; extra-payment allocation remains disabled. Auth password screening
and public RLS performance notices are documented in `phase1/V150_FIX_REPORT.md`.

New transaction and import writes now persist their UUIDs before sending, confirm every returned row, and recover pending batches after reload. Imports allow up to 500 selected rows per request. Expense, category, income and loan editors retain input on failure. These changes require no additional database migration.

Fourteen live Auth/Data API checks passed with two disposable accounts, including real password sign-in, ownership isolation, UUID retries and payment/deletion/undo operations. Both accounts signed out and were removed with their test records; cleanup was verified. Email confirmation is currently disabled in the project and was not changed. Full browser integration with live Auth remains a release check.
