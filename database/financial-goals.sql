create table public.financial_goals (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 100),
 target_amount numeric(14,2) not null check (target_amount > 0),
 saved_amount numeric(14,2) not null default 0 check (saved_amount >= 0),
 monthly_amount numeric(14,2) not null default 0 check (monthly_amount >= 0),
 target_date date,
 archived boolean not null default false,
 created_at timestamptz not null default now()
);
create index financial_goals_owner on public.financial_goals(user_id,id);
alter table public.financial_goals enable row level security;
revoke all on public.financial_goals from public,anon,authenticated;
grant select,insert,update on public.financial_goals to authenticated;
create policy financial_goals_owner on public.financial_goals for all to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
