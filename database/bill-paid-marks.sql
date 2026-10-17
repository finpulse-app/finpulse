-- Additive account-scoped settlement status. No transactions or balances are changed.
create table public.bill_paid_marks (
 user_id uuid not null references auth.users(id) on delete cascade,
 bill_id uuid not null references public.transactions(id) on delete cascade,
 due_date date not null,
 paid boolean not null,
 marked_at date not null,
 primary key (user_id, bill_id, due_date)
);
create index bill_paid_marks_bill_id_idx on public.bill_paid_marks(bill_id);
alter table public.bill_paid_marks enable row level security;
create policy bill_marks_read on public.bill_paid_marks for select to authenticated
 using ((select auth.uid()) = user_id);
create policy bill_marks_insert on public.bill_paid_marks for insert to authenticated
 with check ((select auth.uid()) = user_id and exists (
  select 1 from public.transactions t where t.id = bill_id and t.user_id = (select auth.uid())
   and (t.type = 'bill' or (t.type = 'expense' and t.recurring and t.category is distinct from 'loan_payment'))
 ));
create policy bill_marks_update on public.bill_paid_marks for update to authenticated
 using ((select auth.uid()) = user_id)
 with check ((select auth.uid()) = user_id and exists (
  select 1 from public.transactions t where t.id = bill_id and t.user_id = (select auth.uid())
   and (t.type = 'bill' or (t.type = 'expense' and t.recurring and t.category is distinct from 'loan_payment'))
 ));
revoke all on public.bill_paid_marks from public, anon, authenticated;
grant select, insert, update on public.bill_paid_marks to authenticated;
-- False rows are deliberate tombstones: an old device cache cannot resurrect a paid mark.
