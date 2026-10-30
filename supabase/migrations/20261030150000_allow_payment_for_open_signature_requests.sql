-- A sponsor may already have an unsigned request from before per-contract
-- billing was enabled. Keep that request intact and require payment before
-- accepting the first signature.
create or replace function public.reserve_contract_signature_payment(target_contract_id uuid, target_signing_document_id uuid)
returns table(payment_id uuid, payment_status text, amount_cents integer, stripe_checkout_session_id text, stripe_checkout_url text, signing_document_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_row public.contracts%rowtype;
  event_org uuid;
  price_row public.contract_signature_pricing%rowtype;
  existing_row public.contract_signature_payments%rowtype;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Trusted payment service required'; end if;
  select c.* into contract_row from public.contracts c where c.id = target_contract_id for update;
  if contract_row.id is null or contract_row.signature_status not in ('draft', 'pending_sponsor', 'pending_organizer') or target_signing_document_id is null then
    raise exception 'Contract is not ready for signing';
  end if;
  if contract_row.signature_status in ('pending_sponsor', 'pending_organizer')
    and contract_row.signing_document_id <> target_signing_document_id then
    raise exception 'The in-progress contract PDF cannot be changed';
  end if;
  if not exists (
    select 1 from public.contract_documents d where d.id = target_signing_document_id
      and d.contract_id = contract_row.id and d.kind in ('generated_pdf', 'uploaded_pdf')
  ) then raise exception 'A signing PDF is required'; end if;
  if not public.event_signature_addon_enabled(contract_row.event_id) then
    raise exception using errcode = '42501', message = 'EVENT_SIGNATURE_ADDON_REQUIRED';
  end if;
  select e.organization_id into event_org from public.events e where e.id = contract_row.event_id;
  if event_org is null then raise exception 'Event not found'; end if;
  select * into price_row from public.contract_signature_pricing p where p.singleton;
  if price_row.amount_cents is null then raise exception 'Contract signature price is not configured'; end if;

  select * into existing_row from public.contract_signature_payments p
  where p.contract_id = contract_row.id and p.payment_status = 'paid'
  order by p.created_at desc limit 1;
  if existing_row.id is not null then
    return query select existing_row.id, existing_row.payment_status, existing_row.amount_cents,
      existing_row.stripe_checkout_session_id, existing_row.stripe_checkout_url, existing_row.signing_document_id;
    return;
  end if;
  select * into existing_row from public.contract_signature_payments p
  where p.contract_id = contract_row.id and p.payment_status = 'pending'
  order by p.created_at desc limit 1;
  if existing_row.id is not null then
    return query select existing_row.id, existing_row.payment_status, existing_row.amount_cents,
      existing_row.stripe_checkout_session_id, existing_row.stripe_checkout_url, existing_row.signing_document_id;
    return;
  end if;
  insert into public.contract_signature_payments (
    contract_id, event_id, organization_id, signing_document_id, amount_cents, currency
  ) values (
    contract_row.id, contract_row.event_id, event_org, target_signing_document_id,
    price_row.amount_cents, price_row.currency
  ) returning * into existing_row;
  return query select existing_row.id, existing_row.payment_status, existing_row.amount_cents,
    existing_row.stripe_checkout_session_id, existing_row.stripe_checkout_url, existing_row.signing_document_id;
end;
$$;
revoke all on function public.reserve_contract_signature_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_contract_signature_payment(uuid, uuid) to service_role;
