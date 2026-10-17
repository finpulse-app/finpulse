-- Synthetic CI schema only. Never execute this against a Supabase project.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create table public.transactions(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 type text not null check(type in ('income','expense','bill','loan','note')), description text not null,
 amount numeric not null, date date not null, category text, recurring boolean default false, frequency text, anchor_date date,
 apr numeric, min_payment numeric, balance numeric, lender text, created_at timestamptz default now(),
 original_balance numeric, original_min_payment numeric, principal_applied numeric, loan_id text
);
alter table public.transactions enable row level security;
create policy "Users can manage their own transactions" on public.transactions for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
create table public.user_settings(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),starting_balance numeric);
alter table public.user_settings enable row level security;
create policy "Users can manage their own settings" on public.user_settings for all using(auth.uid()=user_id) with check(auth.uid()=user_id);
grant select,insert,update,delete on public.user_settings to authenticated;
grant select,insert,update,delete on public.transactions to authenticated;
insert into auth.users values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
