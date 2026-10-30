-- Keep a confirmed payment separate from releasing the contract to the sponsor.
-- The organizer can release only the exact PDF whose fee was paid.
create or replace function public.record_contract_signature_payment(
  target_checkout_session_id text,
  target_payment_intent_id text,
  target_paid_amount_cents integer,
  target_currency text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.contract_signature_payments%rowtype;
  contract_row public.contracts%rowtype;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Trusted payment service required'; end if;
  select * into payment_row from public.contract_signature_payments p
  where p.stripe_checkout_session_id = target_checkout_session_id for update;
  if payment_row.id is null then raise exception 'Unknown contract signature payment'; end if;
  if payment_row.amount_cents <> target_paid_amount_cents or payment_row.currency <> lower(target_currency)
    or target_payment_intent_id is null then raise exception 'Confirmed payment does not match the expected amount'; end if;
  select * into contract_row from public.contracts c where c.id = payment_row.contract_id for update;
  if contract_row.id is null then raise exception 'Contract not found'; end if;
  if payment_row.payment_status = 'paid' then return; end if;
  if payment_row.payment_status <> 'pending' then raise exception 'Payment is no longer pending'; end if;
  if contract_row.signature_status not in ('draft', 'pending_sponsor', 'pending_organizer')
    or (contract_row.signature_status in ('pending_sponsor', 'pending_organizer')
      and contract_row.signing_document_id <> payment_row.signing_document_id) then
    raise exception 'Contract is not awaiting signature';
  end if;
  update public.contract_signature_payments set payment_status = 'paid',
    stripe_payment_intent_id = target_payment_intent_id, payment_confirmed_at = now(), updated_at = now()
  where id = payment_row.id;
end;
$$;
revoke all on function public.record_contract_signature_payment(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_contract_signature_payment(text, text, integer, text) to service_role;

create or replace function public.start_simple_contract_signing(target_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event uuid;
  target_document uuid;
begin
  select c.event_id, c.signing_document_id into target_event, target_document
  from public.contracts c
  where c.id = target_contract_id and c.signature_status = 'draft'
    and c.signing_document_id is not null
    and exists (
      select 1 from public.contract_documents d where d.id = c.signing_document_id
        and d.contract_id = c.id and d.kind in ('generated_pdf', 'uploaded_pdf')
    );
  if target_event is null then raise exception 'Contract is not ready for signing'; end if;
  if auth.uid() is null or not public.owns_event(target_event) then raise exception 'EVENT_ACCESS_DENIED'; end if;
  if not public.event_signature_addon_enabled(target_event) then
    raise exception using errcode = '42501', message = 'EVENT_SIGNATURE_ADDON_REQUIRED';
  end if;
  if not exists (
    select 1 from public.contract_signature_payments p where p.contract_id = target_contract_id
      and p.signing_document_id = target_document and p.payment_status = 'paid'
  ) then raise exception using errcode = '42501', message = 'CONTRACT_SIGNATURE_PAYMENT_REQUIRED'; end if;
  update public.contracts set signature_status = 'pending_sponsor'
  where id = target_contract_id and signature_status = 'draft' and signing_document_id = target_document;
  if not found then raise exception 'Contract is not ready for signing'; end if;
end;
$$;
revoke all on function public.start_simple_contract_signing(uuid) from public, anon;
grant execute on function public.start_simple_contract_signing(uuid) to authenticated, service_role;
