-- Deployment SQL, not a CLI-generated migration filename. Review/apply before
-- deploying this client. No production DDL is executed by the test workflow.
begin;
create index if not exists transactions_user_id_idx on public.transactions(user_id);
create schema if not exists finpulse_private;
revoke all on schema finpulse_private from public, anon;
grant usage on schema finpulse_private to authenticated;
create table if not exists finpulse_private.operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  kind text not null check (kind in ('record','delete','undo')),
  request jsonb not null,
  result jsonb,
  undone_by uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
alter table finpulse_private.operations enable row level security;
revoke all on finpulse_private.operations from public, anon, authenticated;

create or replace function finpulse_private.mutate(
  p_operation_id uuid, p_kind text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  op finpulse_private.operations%rowtype;
  deleted_op finpulse_private.operations%rowtype;
  target public.transactions%rowtype;
  probe public.transactions%rowtype;
  debt public.transactions%rowtype;
  debt_id uuid;
  payment_id uuid;
  extra numeric;
  monthly boolean;
  payment_date date;
  bal numeric;
  minimum numeric;
  rate numeric;
  interest numeric := 0;
  regular_amount numeric := 0;
  min_principal numeric := 0;
  extra_principal numeric := 0;
  principal numeric := 0;
  restored numeric := 0;
  estimate boolean := false;
  matches integer;
  v_result jsonb;
  replayed boolean := false;
begin
  if actor is null then raise exception 'Sign in before changing transactions'; end if;
  if p_operation_id is null or p_kind not in ('record','delete','undo')
     or p_kind is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Invalid operation';
  end if;
  -- Short per-account lock orders receipt and loan locks consistently, including
  -- undo of a different receipt. Plain SQL row updates still respect FOR UPDATE.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
  insert into finpulse_private.operations(user_id,operation_id,kind,request)
    values(actor,p_operation_id,p_kind,p_payload) on conflict do nothing;
  select * into op from finpulse_private.operations
    where user_id=actor and operation_id=p_operation_id for update;
  if op.kind is distinct from p_kind or op.request is distinct from p_payload then
    raise exception 'Operation key was reused with a different request';
  end if;
  if op.result is not null then
    v_result := op.result;
    replayed := true;
  elsif p_kind='record' then
    debt_id := (p_payload->>'loan_id')::uuid;
    extra := (p_payload->>'extra')::numeric;
    monthly := (p_payload->>'include_monthly')::boolean;
    payment_date := (p_payload->>'date')::date;
    if extra is null or extra < 0 or extra > 1000000000000 or extra::text in ('NaN','Infinity','-Infinity')
       or monthly is null or payment_date is null or payment_date < date '1900-01-01'
       or payment_date > date '2200-12-31' then raise exception 'Invalid payment inputs'; end if;
    select * into debt from public.transactions where id=debt_id and user_id=actor and type='loan' for update;
    if not found then raise exception 'Loan not found'; end if;
    bal := coalesce(debt.balance,debt.amount,0);
    minimum := coalesce(debt.min_payment,debt.amount,0);
    rate := coalesce(debt.apr,0)/100/12;
    if bal <= 0 then raise exception 'This loan is already paid off'; end if;
    if bal > 1000000000000 or bal::text in ('NaN','Infinity','-Infinity')
       or minimum < 0 or minimum > 1000000000000 or minimum::text in ('NaN','Infinity','-Infinity')
       or rate < 0 or rate > 1000 or rate::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Invalid stored loan values';
    end if;
    if monthly then
      interest := bal*rate;
      regular_amount := least(minimum,bal+interest);
      min_principal := least(bal,greatest(0,regular_amount-interest));
    end if;
    extra_principal := least(bal-min_principal,extra);
    principal := min_principal+extra_principal;
    if regular_amount+extra_principal <= 0 then raise exception 'No payment to record'; end if;
    if regular_amount > 0 then
      insert into public.transactions(user_id,type,description,amount,date,category,recurring,principal_applied,loan_id)
      values(actor,'expense',debt.description||' payment',regular_amount,payment_date,'loan_payment',false,min_principal,debt.id::text);
    end if;
    if extra_principal > 0 then
      insert into public.transactions(user_id,type,description,amount,date,category,recurring,principal_applied,loan_id)
      values(actor,'expense',debt.description||' extra payment',extra_principal,payment_date,'loan_payment',false,extra_principal,debt.id::text);
    end if;
    update public.transactions set balance=bal-principal,
      original_balance=coalesce(original_balance,bal)
      where id=debt.id and user_id=actor;
    v_result := jsonb_build_object('loan_id',debt.id,'loan_description',debt.description,
      'before_balance',bal,'new_balance',bal-principal,'original_balance',coalesce(debt.original_balance,bal),
      'apr',debt.apr,'minimum_payment',minimum,'interest',interest,'principal',principal,'total_paid',regular_amount+extra_principal,'extra_paid',extra_principal);
  elsif p_kind='delete' then
    payment_id := (p_payload->>'id')::uuid;
    select * into probe from public.transactions where id=payment_id and user_id=actor;
    if not found then raise exception 'Transaction not found'; end if;
    if probe.category='loan_payment' and probe.type='expense' then
      if probe.loan_id is not null then
        select id into debt_id from public.transactions where id::text=probe.loan_id and user_id=actor and type='loan';
      else
        select count(*) into matches from public.transactions where user_id=actor and type='loan'
          and probe.description in (description||' payment',description||' extra payment');
        if matches > 1 then raise exception 'Legacy payment matches multiple loans; link it before deleting'; end if;
        select id into debt_id from public.transactions where user_id=actor and type='loan'
          and probe.description in (description||' payment',description||' extra payment');
      end if;
      if debt_id is not null then
        select * into debt from public.transactions where id=debt_id and user_id=actor and type='loan' for update;
        if not found then raise exception 'Loan changed; retry deletion'; end if;
      end if;
    end if;
    select * into target from public.transactions where id=payment_id and user_id=actor for update;
    if not found or to_jsonb(target) is distinct from to_jsonb(probe) then raise exception 'Transaction changed; retry deletion'; end if;
    if debt_id is not null then
      bal := coalesce(debt.balance,debt.amount,0);
      if target.principal_applied is not null then restored := target.principal_applied;
      elsif target.description=debt.description||' extra payment' then restored := coalesce(target.amount,0);
      else
        restored := greatest(0,coalesce(target.amount,0)-bal*coalesce(debt.apr,0)/100/12);
        estimate := true;
      end if;
      if restored < 0 or restored > coalesce(target.amount,0) or restored::text in ('NaN','Infinity','-Infinity')
         or bal < 0 or bal > 1000000000000 or bal::text in ('NaN','Infinity','-Infinity') then
        raise exception 'Invalid payment principal or loan balance';
      end if;
      update public.transactions set balance=bal+restored where id=debt_id and user_id=actor;
    end if;
    delete from public.transactions where id=payment_id and user_id=actor;
    v_result := jsonb_build_object('removed_id',payment_id,'deleted',to_jsonb(target),
      'restore_info',case when debt_id is null then null else jsonb_build_object(
        'loanId',debt_id,'loanDescription',debt.description,'amount',restored,'estimated',estimate) end);
  else
    select * into deleted_op from finpulse_private.operations where user_id=actor
      and operation_id=(p_payload->>'delete_operation_id')::uuid and kind='delete' for update;
    if not found or deleted_op.result is null then raise exception 'Deletion not found'; end if;
    if deleted_op.undone_by is not null then raise exception 'Deletion was already undone'; end if;
    target := jsonb_populate_record(null::public.transactions,deleted_op.result->'deleted');
    if target.user_id is distinct from actor or target.id is null then raise exception 'Invalid deletion receipt'; end if;
    debt_id := (deleted_op.result->'restore_info'->>'loanId')::uuid;
    restored := coalesce((deleted_op.result->'restore_info'->>'amount')::numeric,0);
    if debt_id is not null then
      select * into debt from public.transactions where id=debt_id and user_id=actor and type='loan' for update;
      if not found then raise exception 'Restore the loan before undoing its payment deletion'; end if;
      bal := coalesce(debt.balance,debt.amount,0);
      if bal < restored or bal::text in ('NaN','Infinity','-Infinity') then raise exception 'Loan balance changed; cannot undo this deletion'; end if;
      update public.transactions set balance=bal-restored where id=debt_id and user_id=actor;
    end if;
    -- Restore original ID so existing payment loan_id links survive loan undo.
    insert into public.transactions select target.*;
    update finpulse_private.operations set undone_by=p_operation_id where user_id=actor and operation_id=deleted_op.operation_id;
    v_result := jsonb_build_object('restored_id',target.id);
  end if;
  if not replayed then
    update finpulse_private.operations set result=v_result where user_id=actor and operation_id=p_operation_id;
  end if;
  -- Fresh owner-only snapshot even on retry; never replay stale loan balances.
  return v_result || jsonb_build_object('operation_id',p_operation_id,'kind',p_kind,'replayed',replayed,
    'transactions',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at,t.id)
      from public.transactions t where t.user_id=actor),'[]'::jsonb));
end;
$$;
revoke all on function finpulse_private.mutate(uuid,text,jsonb) from public, anon;
grant execute on function finpulse_private.mutate(uuid,text,jsonb) to authenticated;
create or replace function public.fp_mutate_transaction(p_operation_id uuid,p_kind text,p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select finpulse_private.mutate(p_operation_id,p_kind,p_payload);
$$;
revoke all on function public.fp_mutate_transaction(uuid,text,jsonb) from public, anon;
grant execute on function public.fp_mutate_transaction(uuid,text,jsonb) to authenticated;
commit;
