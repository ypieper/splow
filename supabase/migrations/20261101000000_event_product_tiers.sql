-- Event products replace the legacy one-size-fits-all paid package entitlements.
-- Existing event rows and legacy entitlements remain readable during rollout;
-- the new catalog and all new purchases use the event-scoped products below.

alter table public.event_plans
  drop constraint if exists event_plans_code_check,
  add column if not exists tier_order integer not null default 0,
  add column if not exists included_sponsors integer not null default 0
    check (included_sponsors >= 0);

insert into public.event_plans
  (code, name, price_cents, max_events, max_sponsors, features, tier_order, included_sponsors)
values
  ('starter', 'Starter', 4900, null, null,
   '{"sponsor_management":true,"manual_benefits":true,"contract_upload":true,"internal_tasks":true,"standard_reporting":true,"benefit_library":false,"contract_generation":false,"sponsor_portal":false,"sponsor_task_evidence":false,"advanced_analytics":false,"automated_closing_report":false,"reports_tab":false,"contracts":true,"benefits":true,"tasks":true,"evidence":true,"reports":false}'::jsonb, 1, 3),
  ('professional', 'Professional', 9900, null, null,
   '{"sponsor_management":true,"manual_benefits":true,"contract_upload":true,"internal_tasks":true,"standard_reporting":true,"benefit_library":true,"contract_generation":true,"sponsor_portal":true,"sponsor_task_evidence":true,"advanced_analytics":false,"automated_closing_report":false,"reports_tab":false,"contracts":true,"benefits":true,"tasks":true,"evidence":true,"reports":false}'::jsonb, 2, 3),
  ('business', 'Business', 14900, null, null,
   '{"sponsor_management":true,"manual_benefits":true,"contract_upload":true,"internal_tasks":true,"standard_reporting":true,"benefit_library":true,"contract_generation":true,"sponsor_portal":true,"sponsor_task_evidence":true,"advanced_analytics":true,"automated_closing_report":true,"reports_tab":true,"contracts":true,"benefits":true,"tasks":true,"evidence":true,"reports":true}'::jsonb, 3, 3)
on conflict (code) do update set
  name = excluded.name,
  price_cents = excluded.price_cents,
  max_events = excluded.max_events,
  max_sponsors = excluded.max_sponsors,
  features = excluded.features,
  tier_order = excluded.tier_order,
  included_sponsors = excluded.included_sponsors,
  updated_at = now();

alter table public.benefits
  add column if not exists benefit_template_id uuid references public.benefit_templates (id) on delete set null;
create index if not exists benefits_benefit_template_id_idx on public.benefits (benefit_template_id);

create table if not exists public.event_product_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payment_type text not null check (payment_type in ('initial', 'upgrade', 'sponsor_slots')),
  from_plan_code text references public.event_plans (code),
  to_plan_code text references public.event_plans (code),
  sponsor_slots integer not null default 0 check (sponsor_slots >= 0),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'expired', 'failed')),
  idempotency_key text not null unique,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_webhook_event_id text unique,
  payment_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_product_payments_plan_shape check (
    (payment_type = 'initial' and from_plan_code is null and to_plan_code in ('starter', 'professional', 'business')) or
    (payment_type = 'upgrade' and from_plan_code in ('starter', 'professional', 'business') and to_plan_code in ('professional', 'business')) or
    (payment_type = 'sponsor_slots' and from_plan_code in ('starter', 'professional', 'business') and to_plan_code = from_plan_code and sponsor_slots > 0)
  )
);

create index if not exists event_product_payments_event_status_idx
  on public.event_product_payments (event_id, payment_status, created_at desc);
create unique index if not exists event_product_payments_one_pending_per_event_idx
  on public.event_product_payments (event_id) where payment_status = 'pending';

alter table public.event_product_payments enable row level security;
revoke all on public.event_product_payments from public, anon, authenticated;
grant all on public.event_product_payments to service_role;

create or replace function public.sponsor_slot_price_cents(starting_slot integer, slot_count integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(
    case
      when slot_number between 4 and 10 then 600
      when slot_number between 11 and 20 then 400
      else 300
    end
  ), 0)::integer
  from generate_series(greatest(starting_slot + 1, 4), starting_slot + greatest(slot_count, 0)) as slot_number
$$;
revoke all on function public.sponsor_slot_price_cents(integer, integer) from public, anon, authenticated;
grant execute on function public.sponsor_slot_price_cents(integer, integer) to service_role;

create or replace function public.get_event_product_state(target_event_id uuid)
returns table (
  plan_code text,
  plan_name text,
  base_price_cents integer,
  included_sponsors integer,
  purchased_sponsor_slots integer,
  assigned_sponsors integer,
  available_sponsors integer,
  can_view_reports boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  event_organization uuid;
  current_plan public.event_plans%rowtype;
  purchased_slots integer := 0;
  assigned_count integer := 0;
begin
  select e.organization_id into event_organization from public.events e where e.id = target_event_id;
  if event_organization is null or not public.is_organization_member(event_organization) then
    raise exception using errcode = '42501', message = 'EVENT_ACCESS_DENIED';
  end if;
  select p.* into current_plan
  from public.event_entitlements ee join public.event_plans p on p.code = ee.plan_code
  where ee.event_id = target_event_id and ee.entitlement_status = 'active';
  if current_plan.code is null then
    select p.* into current_plan from public.event_plans p where p.code = 'free';
  end if;
  select coalesce(sum(pp.sponsor_slots), 0)::integer into purchased_slots
  from public.event_product_payments pp
  where pp.event_id = target_event_id and pp.payment_status = 'paid'
    and pp.payment_type in ('initial', 'sponsor_slots');
  select count(*)::integer into assigned_count from public.event_sponsors es where es.event_id = target_event_id;
  plan_code := current_plan.code;
  plan_name := current_plan.name;
  base_price_cents := current_plan.price_cents::integer;
  included_sponsors := case when current_plan.code in ('starter', 'professional', 'business') then current_plan.included_sponsors else coalesce(current_plan.max_sponsors, 1) end;
  purchased_sponsor_slots := purchased_slots;
  assigned_sponsors := assigned_count;
  available_sponsors := greatest(included_sponsors + purchased_slots - assigned_count, 0);
  can_view_reports := coalesce((current_plan.features ->> 'reports_tab')::boolean, false);
  return next;
end;
$$;
revoke all on function public.get_event_product_state(uuid) from public, anon;
grant execute on function public.get_event_product_state(uuid) to authenticated;

create or replace function public.reserve_event_product_payment(
  target_event_id uuid,
  target_payment_type text,
  target_plan_code text default null,
  target_sponsor_slots integer default 0
)
returns table (payment_id uuid, amount_cents integer, payment_type text, from_plan_code text, to_plan_code text, sponsor_slots integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_organization uuid;
  current_plan public.event_plans%rowtype;
  next_plan public.event_plans%rowtype;
  assigned_count integer := 0;
  paid_slots integer := 0;
  existing_payment public.event_product_payments%rowtype;
  calculated_amount integer;
  calculated_slots integer := 0;
  new_payment_id uuid;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select e.organization_id into event_organization from public.events e where e.id = target_event_id for update;
  if event_organization is null or not public.is_organization_member(event_organization) then
    raise exception using errcode = '42501', message = 'EVENT_ACCESS_DENIED';
  end if;
  select p.* into current_plan
  from public.event_entitlements ee join public.event_plans p on p.code = ee.plan_code
  where ee.event_id = target_event_id and ee.entitlement_status = 'active';
  if current_plan.code is null then select p.* into current_plan from public.event_plans p where p.code = 'free'; end if;
  select count(*)::integer into assigned_count from public.event_sponsors es where es.event_id = target_event_id;
  select coalesce(sum(pp.sponsor_slots), 0)::integer into paid_slots
  from public.event_product_payments pp where pp.event_id = target_event_id
    and pp.payment_status = 'paid' and pp.payment_type in ('initial', 'sponsor_slots');

  if target_payment_type not in ('initial', 'upgrade', 'sponsor_slots') then raise exception 'Invalid payment type'; end if;
  if target_payment_type in ('initial', 'upgrade') then
    select p.* into next_plan from public.event_plans p
    where p.code = target_plan_code and p.code in ('starter', 'professional', 'business');
    if next_plan.code is null then raise exception 'Invalid target plan'; end if;
    if target_payment_type = 'initial' then
      if current_plan.code in ('starter', 'professional', 'business') then raise exception 'Event already has a paid product'; end if;
      calculated_slots := greatest(assigned_count - next_plan.included_sponsors, 0);
      calculated_amount := next_plan.price_cents::integer + public.sponsor_slot_price_cents(next_plan.included_sponsors, calculated_slots);
    else
      if current_plan.code not in ('starter', 'professional', 'business') or next_plan.tier_order <= current_plan.tier_order then
        raise exception 'Upgrade must move to a higher paid product';
      end if;
      if assigned_count > current_plan.included_sponsors + paid_slots then raise exception 'Current sponsor quota is exceeded'; end if;
      calculated_amount := (next_plan.price_cents - current_plan.price_cents + 2000)::integer;
      calculated_slots := 0;
    end if;
  else
    if current_plan.code not in ('starter', 'professional', 'business') then raise exception 'Choose a paid product before buying sponsor slots'; end if;
    if target_sponsor_slots < 1 or target_sponsor_slots > 500 then raise exception 'Invalid sponsor slot quantity'; end if;
    calculated_slots := target_sponsor_slots;
    calculated_amount := public.sponsor_slot_price_cents(current_plan.included_sponsors + paid_slots, calculated_slots);
    if calculated_amount <= 0 then raise exception 'No additional sponsor slots are available at this price'; end if;
    next_plan := current_plan;
  end if;

  select pp.* into existing_payment from public.event_product_payments pp
  where pp.event_id = target_event_id and pp.payment_status = 'pending' for update;
  if existing_payment.id is not null and existing_payment.created_at < now() - interval '24 hours' then
    update public.event_product_payments set payment_status = 'expired', updated_at = now() where id = existing_payment.id;
    existing_payment := null;
  end if;
  if existing_payment.id is not null then
    if existing_payment.payment_type = target_payment_type
      and existing_payment.to_plan_code is not distinct from next_plan.code
      and existing_payment.sponsor_slots = calculated_slots
      and existing_payment.amount_cents = calculated_amount then
      payment_id := existing_payment.id; amount_cents := existing_payment.amount_cents;
      payment_type := existing_payment.payment_type; from_plan_code := existing_payment.from_plan_code;
      to_plan_code := existing_payment.to_plan_code; sponsor_slots := existing_payment.sponsor_slots;
      return next; return;
    end if;
    raise exception using errcode = 'P0001', message = 'EVENT_PAYMENT_ALREADY_PENDING';
  end if;

  new_payment_id := gen_random_uuid();
  insert into public.event_product_payments (
    id, event_id, organization_id, payment_type, from_plan_code, to_plan_code,
    sponsor_slots, amount_cents, idempotency_key
  ) values (
    new_payment_id, target_event_id, event_organization, target_payment_type,
    case when target_payment_type = 'initial' then null else current_plan.code end,
    next_plan.code, calculated_slots, calculated_amount,
    'event-product-' || new_payment_id::text
  );
  payment_id := new_payment_id; amount_cents := calculated_amount;
  payment_type := target_payment_type;
  from_plan_code := case when target_payment_type = 'initial' then null else current_plan.code end;
  to_plan_code := next_plan.code; sponsor_slots := calculated_slots;
  return next;
end;
$$;
revoke all on function public.reserve_event_product_payment(uuid, text, text, integer) from public, anon;
grant execute on function public.reserve_event_product_payment(uuid, text, text, integer) to authenticated;

create or replace function public.save_event_product_checkout(target_payment_id uuid, target_session_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Trusted payment service required'; end if;
  if target_session_id is null or target_session_id !~ '^cs_[A-Za-z0-9_]+$' then raise exception 'Checkout reference required'; end if;
  update public.event_product_payments set stripe_checkout_session_id = target_session_id, updated_at = now()
  where id = target_payment_id and payment_status = 'pending'
    and (stripe_checkout_session_id is null or stripe_checkout_session_id = target_session_id);
  if not found and not exists (select 1 from public.event_product_payments p where p.id = target_payment_id and p.stripe_checkout_session_id = target_session_id) then
    raise exception 'Payment reservation is no longer available';
  end if;
end;
$$;
revoke all on function public.save_event_product_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.save_event_product_checkout(uuid, text) to service_role;

create or replace function public.record_event_product_payment(
  target_payment_id uuid,
  target_session_id text,
  target_payment_intent_id text,
  target_paid_amount_cents integer,
  target_currency text,
  target_provider_event_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.event_product_payments%rowtype;
  event_organization uuid;
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Trusted payment service required'; end if;
  select * into payment_row from public.event_product_payments p where p.id = target_payment_id for update;
  if payment_row.id is null then raise exception 'Unknown event product payment'; end if;
  if payment_row.stripe_checkout_session_id <> target_session_id
    or payment_row.amount_cents <> target_paid_amount_cents
    or payment_row.currency <> lower(target_currency)
    or target_payment_intent_id is null or target_provider_event_id is null then
    raise exception 'Confirmed payment does not match the reservation';
  end if;
  if payment_row.payment_status = 'paid' then return; end if;
  if payment_row.payment_status <> 'pending' then raise exception 'Payment is no longer pending'; end if;
  select e.organization_id into event_organization from public.events e where e.id = payment_row.event_id for update;
  if event_organization is distinct from payment_row.organization_id then raise exception 'Event organization changed'; end if;
  if payment_row.payment_type in ('initial', 'upgrade') then
    update public.event_entitlements set plan_code = payment_row.to_plan_code, entitlement_status = 'active',
      activated_at = now(), activation_source = 'stripe', paid_amount_cents = payment_row.amount_cents,
      payment_reference = target_session_id, payment_provider = 'stripe', updated_at = now()
    where event_id = payment_row.event_id and organization_id = payment_row.organization_id;
    if not found then
      insert into public.event_entitlements (event_id, organization_id, plan_code, entitlement_status,
        activated_at, activation_source, paid_amount_cents, payment_reference, payment_provider)
      values (payment_row.event_id, payment_row.organization_id, payment_row.to_plan_code, 'active',
        now(), 'stripe', payment_row.amount_cents, target_session_id, 'stripe');
    end if;
  end if;
  update public.event_product_payments set payment_status = 'paid',
    stripe_payment_intent_id = target_payment_intent_id,
    stripe_webhook_event_id = target_provider_event_id,
    payment_confirmed_at = now(), updated_at = now()
  where id = target_payment_id and payment_status = 'pending';
end;
$$;
revoke all on function public.record_event_product_payment(uuid, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.record_event_product_payment(uuid, text, text, integer, text, text) to service_role;

create or replace function public.expire_event_product_payment(target_session_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Trusted payment service required'; end if;
  update public.event_product_payments set payment_status = 'expired', updated_at = now()
  where stripe_checkout_session_id = target_session_id and payment_status = 'pending';
end;
$$;
revoke all on function public.expire_event_product_payment(text) from public, anon, authenticated;
grant execute on function public.expire_event_product_payment(text) to service_role;

create or replace function public.fail_event_product_payment(target_session_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then raise exception 'Trusted payment service required'; end if;
  update public.event_product_payments set payment_status = 'failed', updated_at = now()
  where stripe_checkout_session_id = target_session_id and payment_status = 'pending';
end;
$$;
revoke all on function public.fail_event_product_payment(text) from public, anon, authenticated;
grant execute on function public.fail_event_product_payment(text) to service_role;

create or replace function public.event_feature_enabled(target_event_id uuid, target_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (p.features ->> target_feature)::boolean
    from public.events e
    join public.event_entitlements ee on ee.event_id = e.id and ee.entitlement_status = 'active'
    join public.event_plans p on p.code = ee.plan_code
    where e.id = target_event_id
      and ((select auth.role()) = 'service_role' or public.is_organization_member(e.organization_id))
      and (public.organization_enterprise_active(e.organization_id) or coalesce((p.features ->> target_feature)::boolean, false))
  ), false);
$$;
revoke all on function public.event_feature_enabled(uuid, text) from public, anon;
grant execute on function public.event_feature_enabled(uuid, text) to authenticated, service_role;

create or replace function public.organization_has_event_feature(target_organization_id uuid, target_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.organization_id = target_organization_id
      and public.is_organization_member(e.organization_id)
      and public.event_feature_enabled(e.id, target_feature)
  );
$$;
revoke all on function public.organization_has_event_feature(uuid, text) from public, anon;
grant execute on function public.organization_has_event_feature(uuid, text) to authenticated;

drop policy if exists "members manage workspace benefit templates" on public.benefit_templates;
create policy "entitled members manage workspace benefit templates" on public.benefit_templates
  for all to authenticated
  using (public.is_organization_member(organization_id) and public.organization_has_event_feature(organization_id, 'benefit_library'))
  with check (public.is_organization_member(organization_id) and public.organization_has_event_feature(organization_id, 'benefit_library'));

drop policy if exists "workspace members manage benefit template tasks" on public.benefit_template_tasks;
create policy "entitled members manage benefit template tasks" on public.benefit_template_tasks
  for all to authenticated
  using (exists (
    select 1 from public.benefit_templates bt where bt.id = benefit_template_id
      and public.is_organization_member(bt.organization_id)
      and public.organization_has_event_feature(bt.organization_id, 'benefit_library')
  ))
  with check (exists (
    select 1 from public.benefit_templates bt where bt.id = benefit_template_id
      and public.is_organization_member(bt.organization_id)
      and public.organization_has_event_feature(bt.organization_id, 'benefit_library')
  ));

drop policy if exists "workspace members manage contracts" on public.contracts;
create policy "event product members manage contracts" on public.contracts
  for all to authenticated
  using (public.owns_event(event_id) and public.event_feature_enabled(event_id, 'contracts'))
  with check (public.owns_event(event_id) and public.event_feature_enabled(event_id, 'contracts'));

drop policy if exists "workspace members manage benefits" on public.benefits;
create policy "event product members manage benefits" on public.benefits
  for all to authenticated
  using (public.owns_event(event_id) and public.event_feature_enabled(event_id, 'benefits'))
  with check (public.owns_event(event_id) and public.event_feature_enabled(event_id, 'benefits'));

drop policy if exists "workspace members manage tasks" on public.tasks;
create policy "event product members manage tasks" on public.tasks
  for all to authenticated
  using (
    (event_id is null and public.is_organization_member(organization_id)) or
    (event_id is not null and public.owns_event(event_id) and public.event_feature_enabled(event_id, 'tasks'))
  )
  with check (
    (event_id is null and public.is_organization_member(organization_id)) or
    (event_id is not null and public.owns_event(event_id) and public.event_feature_enabled(event_id, 'tasks'))
  );

drop policy if exists "workspace members manage evidence metadata" on public.evidence_files;
create policy "event product members manage evidence metadata" on public.evidence_files
  for all to authenticated
  using (
    public.owns_event(event_id) and
    public.event_feature_enabled(event_id, case when task_id is not null and exists (
      select 1 from public.tasks t where t.id = evidence_files.task_id and t.assigned_to_sponsor
    ) then 'sponsor_task_evidence' else 'evidence' end)
  )
  with check (
    public.owns_event(event_id) and uploaded_by = (select auth.uid()) and
    public.event_feature_enabled(event_id, case when task_id is not null and exists (
      select 1 from public.tasks t where t.id = evidence_files.task_id and t.assigned_to_sponsor
    ) then 'sponsor_task_evidence' else 'evidence' end)
  );

drop policy if exists "workspace members manage contract documents" on public.contract_documents;
create policy "event product members manage contract documents" on public.contract_documents
  for all to authenticated
  using (public.is_organization_member(organization_id) and exists (
    select 1 from public.contracts c where c.id = contract_documents.contract_id and
      public.event_feature_enabled(c.event_id, case when contract_documents.kind = 'uploaded_pdf' then 'contract_upload' when contract_documents.kind = 'signed' then 'contracts' else 'contract_generation' end)
  ))
  with check (public.is_organization_member(organization_id) and exists (
    select 1 from public.contracts c where c.id = contract_documents.contract_id and
      public.event_feature_enabled(c.event_id, case when contract_documents.kind = 'uploaded_pdf' then 'contract_upload' when contract_documents.kind = 'signed' then 'contracts' else 'contract_generation' end)
  ));

-- Sponsor assignments always check the event's current paid quota while holding
-- the event row lock. Free limits continue to come from the Free plan unchanged.
create or replace function public.add_sponsor_to_event(
  target_event_id uuid,
  target_sponsor_id uuid,
  initial_contract_value_cents bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_organization uuid;
  sponsor_organization uuid;
  current_plan public.event_plans%rowtype;
  assigned_count integer;
  paid_slots integer := 0;
  new_contract uuid;
begin
  select e.organization_id into event_organization from public.events e where e.id = target_event_id for update;
  if event_organization is null or not public.is_organization_member(event_organization) then raise exception 'EVENT_ACCESS_DENIED'; end if;
  select s.organization_id into sponsor_organization from public.sponsors s where s.id = target_sponsor_id;
  if sponsor_organization is null or sponsor_organization <> event_organization then raise exception 'SPONSOR_WORKSPACE_MISMATCH'; end if;
  select p.* into current_plan from public.event_entitlements ee
  join public.event_plans p on p.code = ee.plan_code
  where ee.event_id = target_event_id and ee.entitlement_status = 'active';
  if current_plan.code is null then select p.* into current_plan from public.event_plans p where p.code = 'free'; end if;
  select count(*)::integer into assigned_count from public.event_sponsors es where es.event_id = target_event_id;
  if public.organization_enterprise_active(event_organization) then
    null;
  elsif current_plan.code in ('starter', 'professional', 'business') then
    select coalesce(sum(pp.sponsor_slots), 0)::integer into paid_slots from public.event_product_payments pp
    where pp.event_id = target_event_id and pp.payment_status = 'paid' and pp.payment_type in ('initial', 'sponsor_slots');
    if assigned_count >= current_plan.included_sponsors + paid_slots then
      raise exception using errcode = 'P0001', message = 'SPONSOR_LIMIT_REACHED';
    end if;
  elsif current_plan.max_sponsors is not null and assigned_count >= current_plan.max_sponsors then
    raise exception using errcode = 'P0001', message = 'SPONSOR_LIMIT_REACHED';
  end if;
  if initial_contract_value_cents is not null then
    if not public.event_feature_enabled(target_event_id, 'contracts') then
      raise exception using errcode = '42501', message = 'EVENT_FEATURE_REQUIRED:contracts';
    end if;
    if initial_contract_value_cents < 0 then raise exception 'Invalid contract amount'; end if;
  end if;
  insert into public.event_sponsors (event_id, sponsor_id) values (target_event_id, target_sponsor_id);
  if initial_contract_value_cents is not null then
    insert into public.contracts (event_id, sponsor_id, title, value_cents, status)
    values (target_event_id, target_sponsor_id, 'Sponsoringvertrag', initial_contract_value_cents, 'Offen')
    returning id into new_contract;
  end if;
  return new_contract;
end;
$$;
revoke all on function public.add_sponsor_to_event(uuid, uuid, bigint) from public, anon;
grant execute on function public.add_sponsor_to_event(uuid, uuid, bigint) to authenticated;

drop trigger if exists contracts_package_limit_guard on public.contracts;

-- Reports remain visible in navigation, but their content and writes are
-- restricted to Business by RLS as well as the UI.
drop policy if exists "workspace members manage contract reports" on public.contract_reports;
create policy "business members manage contract reports" on public.contract_reports
  for all to authenticated
  using (public.is_organization_member(organization_id) and exists (
    select 1 from public.contracts c where c.id = contract_reports.contract_id
      and public.event_feature_enabled(c.event_id, 'reports_tab')
  ))
  with check (public.is_organization_member(organization_id) and exists (
    select 1 from public.contracts c where c.id = contract_reports.contract_id
      and public.event_feature_enabled(c.event_id, 'reports_tab')
  ));

drop policy if exists "workspace members manage event report metrics" on public.event_report_metrics;
create policy "business members manage event report metrics" on public.event_report_metrics
  for all to authenticated
  using (exists (
    select 1 from public.events e where e.id = event_report_metrics.event_id
      and public.is_organization_member(e.organization_id)
      and public.event_feature_enabled(e.id, 'reports_tab')
  ))
  with check (exists (
    select 1 from public.events e where e.id = event_report_metrics.event_id
      and public.is_organization_member(e.organization_id)
      and public.event_feature_enabled(e.id, 'reports_tab')
  ));

create or replace function public.guard_event_feature_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event uuid;
  target_feature text;
  related_event uuid;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'tasks'
      and (to_jsonb(new) - array['status', 'sponsor_approval_status', 'sponsor_approved_at', 'publish_ready', 'updated_at'])
        = (to_jsonb(old) - array['status', 'sponsor_approval_status', 'sponsor_approved_at', 'publish_ready', 'updated_at']) then return new;
    elsif tg_table_name = 'benefits'
      and (to_jsonb(new) - array['status', 'updated_at']) = (to_jsonb(old) - array['status', 'updated_at']) then return new;
    elsif tg_table_name = 'evidence_files'
      and (to_jsonb(new) - array['sponsor_visible']) = (to_jsonb(old) - array['sponsor_visible']) then return new;
    end if;
  end if;
  if tg_table_name in ('contracts', 'benefits', 'evidence_files', 'tasks') then
    if tg_table_name = 'tasks' and new.event_id is null then return new; end if;
    target_event := new.event_id;
  elsif tg_table_name in ('contract_documents', 'contract_reports') then
    select c.event_id into target_event from public.contracts c where c.id = new.contract_id;
  end if;
  if tg_table_name = 'contracts' then target_feature := 'contracts';
  elsif tg_table_name = 'benefits' then target_feature := case when new.benefit_template_id is null then 'benefits' else 'benefit_library' end;
  elsif tg_table_name = 'tasks' then target_feature := 'tasks';
  elsif tg_table_name = 'evidence_files' then
    if new.task_id is not null and exists (
      select 1 from public.tasks t where t.id = new.task_id and t.assigned_to_sponsor
    ) then target_feature := 'sponsor_task_evidence';
    else target_feature := 'evidence'; end if;
  elsif tg_table_name = 'contract_reports' then target_feature := 'reports_tab';
  elsif tg_table_name = 'contract_documents' then
    target_feature := case when new.kind = 'uploaded_pdf' then 'contract_upload' when new.kind = 'signed' then 'contracts' else 'contract_generation' end;
  end if;
  if target_event is null then raise exception using errcode = '42501', message = 'EVENT_FEATURE_REQUIRED'; end if;
  if not public.event_feature_enabled(target_event, target_feature) then
    raise exception using errcode = '42501', message = 'EVENT_FEATURE_REQUIRED:' || target_feature;
  end if;
  if tg_table_name = 'evidence_files' then
    if new.task_id is null and new.benefit_id is null then raise exception using errcode = '42501', message = 'EVIDENCE_REQUIRES_EVENT'; end if;
    if not exists (select 1 from public.events e where e.id = new.event_id and e.organization_id = new.organization_id) then raise exception using errcode = '42501', message = 'EVIDENCE_REQUIRES_EVENT'; end if;
    if new.benefit_id is not null then
      select b.event_id into related_event from public.benefits b where b.id = new.benefit_id;
      if related_event is distinct from new.event_id then raise exception using errcode = '42501', message = 'EVIDENCE_REQUIRES_EVENT'; end if;
    end if;
    if new.task_id is not null then
      select t.event_id into related_event from public.tasks t where t.id = new.task_id;
      if related_event is distinct from new.event_id then raise exception using errcode = '42501', message = 'EVIDENCE_REQUIRES_EVENT'; end if;
    end if;
  end if;
  return new;
end;
$$;
