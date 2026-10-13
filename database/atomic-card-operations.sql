-- One user action for the linked purchase/financing balances of a single card.
-- Uses the existing owner-scoped operation receipts and payment/undo primitive.
begin;
create or replace function finpulse_private.mutate_card(p_operation_id uuid,p_kind text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 actor uuid := auth.uid(); receipt finpulse_private.operations%rowtype; removed finpulse_private.operations%rowtype;
 ids uuid[]; regular public.transactions%rowtype; financing public.transactions%rowtype; part public.transactions%rowtype;
 child jsonb; v_result jsonb; source text; finance_source text; child_id uuid; i integer;
 before_balance numeric := 0; original numeric := 0; minimum numeric := 0;
 interest numeric := 0; principal numeric := 0; total numeric := 0; extra_paid numeric := 0;
 remaining_extra numeric; allocated numeric; after_monthly numeric; replayed boolean := false;
begin
 if actor is null then raise exception 'Sign in before changing transactions'; end if;
 if p_operation_id is null or p_kind is null or p_kind not in ('record','delete','undo') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid operation'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
 insert into finpulse_private.operations(user_id,operation_id,kind,request) values(actor,p_operation_id,p_kind,p_payload) on conflict do nothing;
 select * into receipt from finpulse_private.operations where user_id=actor and operation_id=p_operation_id for update;
 if receipt.kind is distinct from p_kind or receipt.request is distinct from p_payload then raise exception 'Operation key was reused with a different request'; end if;
 if receipt.result is not null then v_result:=receipt.result;replayed:=true;
 else
  select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(p_payload->'card_ids') with ordinality;
  if coalesce(array_length(ids,1),0)<>2 or ids[1] is null or ids[2] is null or ids[1]=ids[2] then raise exception 'Two linked card balances are required'; end if;
  if p_kind='undo' then
   select * into removed from finpulse_private.operations where user_id=actor and operation_id=(p_payload->>'delete_operation_id')::uuid and kind='delete' for update;
   if not found or removed.result is null or removed.result->'card_ids' is distinct from to_jsonb(ids) or removed.undone_by is not null then raise exception 'Card deletion is unavailable'; end if;
   for i in 1..2 loop
    child_id:=pg_catalog.md5(p_operation_id::text||':'||ids[i]::text||':'||p_kind)::uuid;
    child:=finpulse_private.mutate(child_id,'undo',jsonb_build_object('delete_operation_id',pg_catalog.md5(removed.operation_id::text||':'||ids[i]::text||':delete')::uuid));
   end loop;
   update finpulse_private.operations set undone_by=p_operation_id where user_id=actor and operation_id=removed.operation_id;
   v_result:=jsonb_build_object('restored_id',ids[1],'card_ids',ids);
  else
   perform id from public.transactions where id=any(ids) and user_id=actor and type='loan' order by id for update;
   select * into regular from public.transactions where id=ids[1] and user_id=actor and type='loan';
   if not found then raise exception 'Card not found'; end if;
   select * into financing from public.transactions where id=ids[2] and user_id=actor and type='loan';
   if not found then raise exception 'Card not found'; end if;
   source:=btrim((regexp_match(regular.lender,'(?:^|[|]) *account:([^|]+)'))[1]);
   finance_source:=btrim((regexp_match(financing.lender,'(?:^|[|]) *account:([^|]+)'))[1]);
   if source is null or source not like 'import:card:%' or source like '%:installments' or finance_source is distinct from source||':installments' then raise exception 'These balances do not belong to the same card'; end if;
   before_balance:=greatest(0,coalesce(regular.balance,regular.amount,0))+greatest(0,coalesce(financing.balance,financing.amount,0));
   original:=greatest(0,coalesce(regular.original_balance,regular.balance,0))+greatest(0,coalesce(financing.original_balance,financing.balance,0));
   minimum:=(case when regular.balance>0 then coalesce(regular.min_payment,regular.amount,0) else 0 end)+(case when financing.balance>0 then coalesce(financing.min_payment,financing.amount,0) else 0 end);
   if p_kind='delete' then
    for i in 1..2 loop
     child_id:=pg_catalog.md5(p_operation_id::text||':'||ids[i]::text||':delete')::uuid;
     child:=finpulse_private.mutate(child_id,'delete',jsonb_build_object('id',ids[i]));
    end loop;
    v_result:=jsonb_build_object('removed_id',ids[1],'card_ids',ids,'deleted',to_jsonb(regular)||jsonb_build_object('description',regexp_replace(regular.description,' *· *purchases$',''),'balance',before_balance,'amount',minimum,'min_payment',minimum,'_cardIds',ids),'restore_info',null);
   else
    remaining_extra:=(p_payload->>'extra')::numeric;
    if remaining_extra is null or remaining_extra<0 or remaining_extra>1000000000000 or remaining_extra::text in ('NaN','Infinity','-Infinity') or (p_payload->>'include_monthly')::boolean is null or (p_payload->>'date')::date is null then raise exception 'Invalid payment inputs'; end if;
    if before_balance<=0 then raise exception 'This card is already paid off'; end if;
    for part in select * from public.transactions where id=any(ids) and user_id=actor and type='loan' order by apr desc nulls last,id loop
     if coalesce(part.balance,part.amount,0)<=0 then continue; end if;
     if part.apr is null then raise exception 'Add the card interest rate before recording a payment'; end if;
     after_monthly:=greatest(0,coalesce(part.balance,part.amount,0)-(case when (p_payload->>'include_monthly')::boolean then least(coalesce(part.balance,part.amount,0),greatest(0,least(coalesce(part.min_payment,part.amount,0),coalesce(part.balance,part.amount,0)*(1+part.apr/100/12))-coalesce(part.balance,part.amount,0)*part.apr/100/12)) else 0 end));
     allocated:=least(remaining_extra,after_monthly);
     if not (p_payload->>'include_monthly')::boolean and allocated<=0 then continue; end if;
     child_id:=pg_catalog.md5(p_operation_id::text||':'||part.id::text||':record')::uuid;
     child:=finpulse_private.mutate(child_id,'record',jsonb_build_object('loan_id',part.id,'extra',allocated,'include_monthly',(p_payload->>'include_monthly')::boolean,'date',p_payload->>'date'));
     interest:=interest+(child->>'interest')::numeric;principal:=principal+(child->>'principal')::numeric;total:=total+(child->>'total_paid')::numeric;extra_paid:=extra_paid+(child->>'extra_paid')::numeric;remaining_extra:=remaining_extra-(child->>'extra_paid')::numeric;
    end loop;
    if total<=0 then raise exception 'No payment to record'; end if;
    v_result:=jsonb_build_object('loan_id',ids[1],'card_ids',ids,'loan_description',regexp_replace(regular.description,' *· *purchases$',''),'before_balance',before_balance,'new_balance',before_balance-principal,'original_balance',original,'apr',financing.apr,'minimum_payment',minimum,'interest',interest,'principal',principal,'total_paid',total,'extra_paid',extra_paid);
   end if;
  end if;
  update finpulse_private.operations set result=v_result where user_id=actor and operation_id=p_operation_id;
 end if;
 return v_result||jsonb_build_object('operation_id',p_operation_id,'kind',p_kind,'replayed',replayed,'transactions',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at,t.id) from public.transactions t where t.user_id=actor),'[]'::jsonb));
end;
$$;
revoke all on function finpulse_private.mutate_card(uuid,text,jsonb) from public,anon;
grant execute on function finpulse_private.mutate_card(uuid,text,jsonb) to authenticated;
create or replace function public.fp_mutate_card(p_operation_id uuid,p_kind text,p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select finpulse_private.mutate_card(p_operation_id,p_kind,p_payload); $$;
revoke all on function public.fp_mutate_card(uuid,text,jsonb) from public,anon;
grant execute on function public.fp_mutate_card(uuid,text,jsonb) to authenticated;
commit;
