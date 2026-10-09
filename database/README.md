# Atomic FinPulse operations

`atomic-loan-operations.sql` is reviewed deployment SQL. It was applied to
FinPulse Supabase as the atomic_transaction_operations migration. The updated
HTML remains a draft; twenty authenticated API checks passed with disposable accounts. The client deliberately fails clearly if
the RPC is missing; it never falls back to separate balance/payment writes.

The public `fp_mutate_transaction` wrapper runs as the caller. Its private
implementation needs elevated rights solely to protect operation receipts from
client edits. It uses an empty search path, authenticates with `auth.uid()`, filters
every row and receipt by that ID, denies anonymous execution, and returns only that
owner's transactions. Private receipts have RLS and no client table privileges.

Recording inserts regular/extra payment rows and updates the loan together.
Deletion and undo include their balance adjustment in the same transaction. Undo
restores the original transaction UUID, preserving existing payment links when a
loan itself is restored. A short account lock orders operations; loan row locks
ensure calculation uses the stored balance. Stable operation UUIDs make retries
idempotent, while reused IDs with changed inputs fail.

Legacy payments without principal metadata retain the previous interest estimate
when exactly one owned loan matches. Ambiguous names fail without deleting data.
Undo fails if a linked loan is missing or its balance cannot absorb the reversal.

The app persists pending operation IDs before sending requests, keeps forms open
on failure, and offers a Check change notice after reload. SQL validation errors
clear the pending ID because the transaction rolled back. Uncertain network
failures retain it. Retries return a fresh owner snapshot, not stale receipt balances.

Tests run against a disposable PostgreSQL 17 service on GitHub. The fixture and
`phase1/database/test-atomic.js` must never run on a real Supabase project: the test
script requires an explicit disposable flag and a localhost URL. It tests real SQL
rollback, permissions, ownership, idempotency, loan links and concurrent requests.
Browser tests use a separate fake RPC backend to drive input, reload and retry UI.
Live authenticated API checks and cleanup are documented in phase1/V150_FIX_REPORT.md.

Account bill paid/unpaid status uses bill-paid-marks.sql, with owner RLS and
explicit false tombstones that prevent stale device caches from resurrecting marks.
The owner-policy-performance.sql migration preserves owner comparisons while
evaluating auth.uid() once per statement. Both migrations are applied and tested.
