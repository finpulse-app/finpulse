# FinPulse development

`finpulse-v2-150.html` is the current review candidate. It is based on the supplied
v149 review ZIP, with fixes for unsafe description rendering, failed settings
writes, account state isolation, signup awaiting email confirmation, and invalid
CSV dates. The older numbered HTML files are historical snapshots.

The production entry point `index.html` is unchanged. This branch is not a release.
v149 is preserved as the original redacted review input for regression controls.
The v150 client uses the existing project's public anon key, never a service-role key.

## Checks

Requires Node.js 22 or newer; no npm install is required for the formula and
security tests.

```sh
TZ=America/New_York node phase1/run-security-tests.js finpulse-v2-150.html
TZ=America/New_York node phase1/run-current-formulas.js finpulse-v2-150.html
```

GitHub Actions repeats these commands in four time zones. The original formula
suite is preserved in `phase1/run-tests-v149.js`. It needs v147 and v148 to run
historical comparison tests. The wrapper reports missing comparison inputs as
unavailable, never as passing, and fails for other assertion failures.

The supplied browser harness remains in `phase1/browser/`. Its Playwright import
is configured through `PLAYWRIGHT_MODULE` or the installed `playwright` package,
and `CHROME` can select a browser executable. It uses a fake backend. Browser
checks have not been verified here because local Chrome aborted on launch.

```sh
TZ=America/New_York node phase1/browser/browser-test-v149.js finpulse-v2-150.html
```

Do not deploy this candidate until browser checks and a staging Supabase test
confirm its read/write and auth flows. Settings saves now require a returned row;
zero-row writes and explicit errors leave the form open and do not update cache.

## Remaining work

- Loan payment recording/deletion still needs atomic backend operations and
  comprehensive error handling. These changes do not fix every transaction write.
- Bill settlement marks remain local to a device.
- Twice-monthly business-day shifts remain deferred.
- The Supabase security advisor flags disabled compromised-password protection.
- Extra-payment allocation remains disabled.
- CSV dates accept ISO dates (optionally with a timestamp), MM/DD/YYYY, or
  MM/DD/YY. Ambiguous free-form dates are rejected and counted as unreadable rows.

See `phase1/V150_FIX_REPORT.md` for verification evidence and scope.
