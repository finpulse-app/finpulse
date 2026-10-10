# FinPulse v150 release review

The work remains in [draft PR #1](https://github.com/finpulse-app/finpulse/pull/1). The public website and production `index.html` have not been replaced. The private [review preview](http://127.0.0.1:62240/finpulse-v150.html) connects to the real account, so changes a user saves there update that account.

## Completed changes

- Account state resets between users. Saves check database errors and returned confirmations; late responses cannot replace another account's state. Settings saves also guard against overlapping requests and an earlier visit to the same account. Sign-out network failures leave the account available for retry. A missing account library shows a connection error instead of an endless loading screen.
- Loan payment, deletion and undo commit atomically with their principal changes. Owner-scoped operation receipts make retries idempotent. Interrupted transaction batches retain UUIDs and can be checked without duplicating records. Reload now fetches all transaction pages, including accounts above the API's 1,000-row default.
- Bill status belongs to the account and can be refreshed across devices. Explicit unmarks override stale device marks. Older device marks have an explicit sync action. A status mark does not execute a bank payment, change a transaction, or refund a calendar outflow. Failed confirmations remain visible and recoverable.
- Imports support quoted commas, escaped quotes, multiline cells, debit/credit columns and explicit card sign conventions. Invalid dates and malformed amounts are rejected. Users can exclude any preview row; canceled or older asynchronous reads cannot repopulate the preview. Imports require confirmation before saving.
- Calendar, Expenses and Insights use selected-month occurrences, including scheduled loans. Summaries preserve cents. Unrelated gifts/refunds no longer suppress a scheduled paycheck simply because their amount is large. An explicit zero loan balance remains paid off. Blank bank balances cannot silently overwrite a saved balance with zero.
- Plan no longer invents savings progress or a financial finish date. The future-value calculator accepts a hypothetical annual rate, including zero and negative rates, and explains its assumptions. Card research links to issuer information without invented offers or personalized approval claims. Preview billing and statement-import labels reflect what is implemented.
- Narrow navigation, stacked cards, readable text, keyboard focus, reduced-motion support and form labels improve usability. The final visual review caught and corrected an implicit second grid column that collapsed the Insights expense card at 312 pixels.

## Database changes

Three additive migrations are applied to project `qllshfubwzdoiyavypan`: atomic transaction operations, account-owned bill paid marks, and optimized owner-policy checks. Owner checks remain in both read and write policies. The final performance advisor has no notices. The private operations table intentionally has no client RLS policy, denying direct client access.

The security advisor still reports [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The connected tools cannot change Auth configuration. This needs a dashboard review before a public launch. Email confirmation is currently automatic; email delivery and password-reset delivery have not been verified.

## Verification and limits

The final status and exact counts are attached to PR #1 and its GitHub Actions run. Checks cover four formula/client time zones, two Chromium time zones, disposable PostgreSQL 17 and public API isolation. Historical v147 comparisons unavailable from the supplied files are explicitly excluded from passes.

Twenty additional authenticated API checks passed using two disposable accounts, covering account isolation, real loan operations, bill paid/unpaid persistence and foreign-account denial. Both accounts signed out globally and were removed. Cleanup queries confirmed no remaining test users, sessions, transactions, settings, operation receipts or bill marks. No existing financial records were changed for tests. Browser mutation tests used synthetic backend data; real-account browser review was read-only.

Statement fixtures cover supported CSV formats; they cannot establish compatibility with every bank's export. Paycheck matching remains a heuristic based on paycheck identity, date and amount, rather than a bank reconciliation service. Weekend and holiday dates follow the entered schedule and are not shifted automatically. Automatic extra-payment allocation remains deferred. Bill changes appear on reload, Bills navigation or explicit refresh; realtime synchronization is not claimed.

No local developer tools or test packages were installed. Remote test dependencies ran on GitHub's runners.

## Concrete release steps

1. Confirm the destination host/domain and email-verification policy. Configure and verify confirmation/reset delivery if verified-email accounts are required. Review leaked-password protection in the Supabase dashboard. Keep billing and direct bank connections disabled until implemented and tested.
2. Review the final candidate, CI evidence and this document. Obtain approval for the exact public release; the existing instruction to repair the candidate does not itself select a deployment destination.
3. Replace the deployed entry point with the tested candidate, retain the previous entry point for rollback, and verify that the deployed file matches the approved candidate. The current draft PR deliberately retains the existing `index.html`.
4. Verify session restoration, month navigation and read-only account loading on the published URL. Roll back the frontend entry point if these checks fail. Retain the additive database migrations; frontend rollback does not require deleting user status or operation receipts.

This closes the repair and preview-review work for the confirmed defects. It does not claim every possible defect or future feature is resolved, or that public release has already been approved.
