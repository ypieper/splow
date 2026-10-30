begin;

-- Event creation stays available on every plan. Monetization is handled when
-- sponsors are added to an event, not when an event itself is created.
update public.event_plans set max_events = null;

create or replace function public.create_event_with_free_entitlement(
  event_title text,
  event_start_date date,
  event_end_date date,
  event_location text,
  event_responsible text,
  event_location_street text,
  event_location_postal_code text,
  event_location_city text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := public.current_organization_id();
  new_event uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if event_title is null or length(trim(event_title)) = 0 then raise exception 'Event title is required'; end if;
  if event_end_date < event_start_date then raise exception 'Event end date must not precede start date'; end if;
  if event_location_street is null or length(trim(event_location_street)) = 0 then raise exception 'Event street is required'; end if;
  if event_location_postal_code !~ '^[0-9]{5}$' then raise exception 'A five-digit postal code is required'; end if;
  if event_location_city is null or length(trim(event_location_city)) = 0 then raise exception 'Event city is required'; end if;

  insert into public.events (
    organization_id, owner_id, title, start_date, end_date, location,
    location_street, location_postal_code, location_city, responsible
  )
  values (
    organization, auth.uid(), trim(event_title), event_start_date, event_end_date,
    coalesce(event_location, ''), trim(event_location_street), trim(event_location_postal_code),
    trim(event_location_city), coalesce(event_responsible, '')
  )
  returning id into new_event;
  perform public.set_event_entitlement(new_event, 'free', 'free', null, null, null, auth.uid());
  return new_event;
end;
$$;

revoke all on function public.create_event_with_free_entitlement(text, date, date, text, text, text, text, text) from public, anon;
grant execute on function public.create_event_with_free_entitlement(text, date, date, text, text, text, text, text) to authenticated;

create or replace function public.duplicate_event_with_configuration(
  source_event_id uuid,
  new_event_title text,
  new_event_start_date date,
  new_event_end_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_event public.events%rowtype;
  source_benefit public.benefits%rowtype;
  sponsor_assignment record;
  new_event_id uuid;
  new_benefit_id uuid;
  benefit_ids jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select e.* into source_event
  from public.events e
  where e.id = source_event_id
    and public.owns_event(e.id)
  for share;
  if not found then raise exception 'EVENT_ACCESS_DENIED'; end if;
  if source_event.organization_id <> public.current_organization_id() then
    raise exception 'EVENT_ACCESS_DENIED';
  end if;
  if new_event_title is null or length(trim(new_event_title)) = 0 then
    raise exception 'Event title is required';
  end if;
  if new_event_start_date is null or new_event_end_date is null or new_event_end_date < new_event_start_date then
    raise exception 'Valid event dates are required';
  end if;

  -- Older events may have incomplete structured address fields. Preserve them
  -- as-is instead of inventing missing address information.
  insert into public.events (
    organization_id, owner_id, title, start_date, end_date, location,
    location_street, location_postal_code, location_city, location_latitude,
    location_longitude, location_place_id, responsible, contact_first_name,
    contact_last_name, contact_email, contact_phone, organizer_logo_path
  ) values (
    source_event.organization_id, auth.uid(), trim(new_event_title),
    new_event_start_date, new_event_end_date, source_event.location,
    source_event.location_street, source_event.location_postal_code,
    source_event.location_city, source_event.location_latitude,
    source_event.location_longitude, source_event.location_place_id,
    source_event.responsible, source_event.contact_first_name,
    source_event.contact_last_name, source_event.contact_email,
    source_event.contact_phone, source_event.organizer_logo_path
  ) returning id into new_event_id;

  perform public.set_event_entitlement(new_event_id, 'free', 'free', null, null, null, auth.uid());

  insert into public.event_sponsors (event_id, sponsor_id)
  select new_event_id, es.sponsor_id
  from public.event_sponsors es
  where es.event_id = source_event_id;

  -- New event codes are generated, but no sponsor account links are copied.
  -- Each sponsor must redeem the new event's code to gain access.
  for sponsor_assignment in
    select es.sponsor_id
    from public.event_sponsors es
    where es.event_id = new_event_id
  loop
    perform public.create_sponsor_event_code(new_event_id, sponsor_assignment.sponsor_id, null);
  end loop;

  for source_benefit in
    select b.*
    from public.benefits b
    where b.event_id = source_event_id
    order by b.created_at, b.id
  loop
    insert into public.benefits (
      event_id, sponsor_id, contract_id, title, benefit_type, material_logistics,
      category, description, detail, quantity, tasks_per_unit, completion_required,
      status, evidence_summary, due_at
    ) values (
      new_event_id, source_benefit.sponsor_id, null, source_benefit.title,
      source_benefit.benefit_type, source_benefit.material_logistics,
      source_benefit.category, source_benefit.description, source_benefit.detail,
      source_benefit.quantity, source_benefit.tasks_per_unit,
      source_benefit.completion_required, 'Offen', 'Noch kein Nachweis', null
    ) returning id into new_benefit_id;

    benefit_ids := benefit_ids || jsonb_build_object(source_benefit.id::text, new_benefit_id::text);
  end loop;

  insert into public.tasks (
    organization_id, event_id, sponsor_id, sponsor_name, benefit_id, assigned_to,
    assigned_to_sponsor, template_task_id, workflow_order, workflow_instance,
    completion_type, requires_sponsor_approval, sponsor_approval_status,
    sponsor_approved_at, publish_ready, title, description, due_at, status, source
  )
  select
    source_event.organization_id,
    new_event_id,
    t.sponsor_id,
    t.sponsor_name,
    case when t.benefit_id is null then null else (benefit_ids ->> t.benefit_id::text)::uuid end,
    t.assigned_to,
    t.assigned_to_sponsor,
    t.template_task_id,
    t.workflow_order,
    t.workflow_instance,
    t.completion_type,
    t.requires_sponsor_approval,
    case when t.completion_type = 'sponsor_approval' or t.requires_sponsor_approval then 'pending' else 'not_required' end,
    null,
    false,
    t.title,
    t.description,
    null,
    'Offen',
    t.source
  from public.tasks t
  where t.event_id = source_event_id;

  return new_event_id;
end;
$$;

revoke all on function public.duplicate_event_with_configuration(uuid, text, date, date) from public, anon;
grant execute on function public.duplicate_event_with_configuration(uuid, text, date, date) to authenticated;

commit;
