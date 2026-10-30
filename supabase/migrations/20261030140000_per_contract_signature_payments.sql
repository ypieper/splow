-- Digital contract signing is charged once per contract before the sponsor
-- receives access to the contract for signing.

create table if not exists public.contract_signature_pricing (
  singleton boolean primary key default true check (singleton),
  amount_cents integer not null default 400 check (amount_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  updated_at timestamptz not null default now()
);
insert into public.contract_signature_pricing (singleton, amount_cents, currency)
values (true, 400, 'eur')
on conflict (singleton) do nothing;
update public.event_contract_packages set signature_addon_per_contract_cents = 0;
alter table public.contract_signature_pricing enable row level security;
revoke all on public.contract_signature_pricing from anon, authenticated;
grant all on public.contract_signature_pricing to service_role;

create table if not exists public.contract_signature_payments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  signing_document_id uuid not null references public.contract_documents(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'expired')),
  stripe_checkout_session_id text unique,
  stripe_checkout_url text,
  stripe_payment_intent_id text unique,
  payment_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((payment_status = 'paid') = (payment_confirmed_at is not null))
);
create index if not exists contract_signature_payments_contract_idx
  on public.contract_signature_payments(contract_id, created_at desc);
create unique index if not exists contract_signature_payments_one_pending_per_contract
  on public.contract_signature_payments(contract_id) where payment_status = 'pending';
alter table public.contract_signature_payments enable row level security;
revoke all on public.contract_signature_payments from anon, authenticated;
grant all on public.contract_signature_payments to service_role;

-- Existing, unsigned simple-signature requests predate the payment gate. Return
-- them to draft so the sponsor cannot sign until the organizer completes checkout.
update public.contracts set signature_status = 'draft'
where signature_status = 'pending_sponsor'
  and sponsor_signed_at is null and signed_at is null
  and signing_provider is null and signing_request_id is null
  and exists (
    select 1 from public.events e
    where e.id = contracts.event_id and public.event_feature_enabled(e.id, 'contracts')
  );

create or replace function public.event_signature_addon_enabled(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select ((select auth.role()) = 'service_role' or public.is_organization_member(e.organization_id))
      and (
        public.organization_enterprise_active(e.organization_id)
        or exists (
          select 1 from public.event_contract_package_bookings b
          where b.event_id = e.id and b.payment_status = 'paid'
        )
      )
    from public.events e where e.id = target_event_id
  ), false);
$$;
revoke all on function public.event_signature_addon_enabled(uuid) from public, anon;
grant execute on function public.event_signature_addon_enabled(uuid) to authenticated, service_role;

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

create or replace function public.save_contract_signature_checkout(
  target_payment_id uuid,
  target_checkout_session_id text,
  target_checkout_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Trusted payment service required'; end if;
  if target_checkout_session_id is null or target_checkout_url is null then raise exception 'Checkout reference required'; end if;
  update public.contract_signature_payments set
    stripe_checkout_session_id = target_checkout_session_id,
    stripe_checkout_url = target_checkout_url,
    updated_at = now()
  where id = target_payment_id and payment_status = 'pending'
    and (stripe_checkout_session_id is null or stripe_checkout_session_id = target_checkout_session_id);
  if not found and not exists (
    select 1 from public.contract_signature_payments p where p.id = target_payment_id
      and p.stripe_checkout_session_id = target_checkout_session_id
  ) then raise exception 'Payment reservation is no longer available'; end if;
end;
$$;
revoke all on function public.save_contract_signature_checkout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_contract_signature_checkout(uuid, text, text) to service_role;

create or replace function public.expire_contract_signature_payment(target_checkout_session_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Trusted payment service required'; end if;
  update public.contract_signature_payments set payment_status = 'expired', updated_at = now()
  where stripe_checkout_session_id = target_checkout_session_id and payment_status = 'pending';
end;
$$;
revoke all on function public.expire_contract_signature_payment(text) from public, anon, authenticated;
grant execute on function public.expire_contract_signature_payment(text) to service_role;

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
  if contract_row.signature_status = 'draft' then
    update public.contracts set signing_document_id = payment_row.signing_document_id, signature_status = 'pending_sponsor'
    where id = contract_row.id and signature_status = 'draft';
    if not found then raise exception 'Contract is no longer ready for signing'; end if;
  elsif contract_row.signature_status not in ('pending_sponsor', 'pending_organizer')
    or contract_row.signing_document_id <> payment_row.signing_document_id then
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
begin
  select c.event_id into target_event from public.contracts c
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
      and p.payment_status = 'paid'
  ) then raise exception using errcode = '42501', message = 'CONTRACT_SIGNATURE_PAYMENT_REQUIRED'; end if;
  update public.contracts set signature_status = 'pending_sponsor'
  where id = target_contract_id and signature_status = 'draft';
  if not found then raise exception 'Contract is not ready for signing'; end if;
end;
$$;
revoke all on function public.start_simple_contract_signing(uuid) from public, anon;
grant execute on function public.start_simple_contract_signing(uuid) to authenticated, service_role;
