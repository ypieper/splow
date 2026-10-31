create table if not exists public.firma_webhook_jobs (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique check (length(provider_event_id) between 1 and 160),
  signing_request_id text not null check (length(signing_request_id) between 1 and 255),
  event_type text not null check (length(event_type) between 1 and 120),
  event_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(event_payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists firma_webhook_jobs_due_idx
  on public.firma_webhook_jobs (next_attempt_at, created_at)
  where status = 'pending';
create index if not exists firma_webhook_jobs_expired_lease_idx
  on public.firma_webhook_jobs (locked_until)
  where status = 'processing';

alter table public.firma_webhook_jobs enable row level security;
revoke all on public.firma_webhook_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.firma_webhook_jobs to service_role;

create or replace function public.enqueue_firma_webhook_job(
  target_event_id text,
  target_signing_request_id text,
  target_event_type text,
  target_event_payload jsonb
)
returns table (job_id uuid, job_status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_event_id is null or length(target_event_id) not between 1 and 160
    or target_signing_request_id is null or length(target_signing_request_id) not between 1 and 255
    or target_event_type is null or length(target_event_type) not between 1 and 120
    or target_event_payload is null or jsonb_typeof(target_event_payload) <> 'object' then
    raise exception 'Invalid Firma webhook job';
  end if;

  return query
    insert into public.firma_webhook_jobs as existing (
      provider_event_id, signing_request_id, event_type, event_payload
    ) values (
      target_event_id, target_signing_request_id, target_event_type, target_event_payload
    )
    on conflict (provider_event_id) do update set
      signing_request_id = excluded.signing_request_id,
      event_type = excluded.event_type,
      event_payload = case when existing.status in ('completed', 'processing') then existing.event_payload else excluded.event_payload end,
      status = case when existing.status = 'failed' then 'pending' else existing.status end,
      attempts = case when existing.status = 'failed' then 0 else existing.attempts end,
      next_attempt_at = case when existing.status = 'failed' then now() else existing.next_attempt_at end,
      last_error = case when existing.status = 'failed' then null else existing.last_error end,
      updated_at = now()
    returning existing.id, existing.status;
end;
$$;

create or replace function public.claim_firma_webhook_jobs(target_batch_size integer default 10, target_job_id uuid default null)
returns table (
  job_id uuid,
  provider_event_id text,
  signing_request_id text,
  event_type text,
  event_payload jsonb,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    with candidates as (
      select j.id
      from public.firma_webhook_jobs j
      where (
          (j.status = 'pending' and (target_job_id is not null or j.next_attempt_at <= now()))
          or (j.status = 'processing' and j.locked_until <= now())
        )
        and (target_job_id is null or j.id = target_job_id)
      order by j.next_attempt_at, j.created_at
      for update skip locked
      limit greatest(1, least(coalesce(target_batch_size, 10), 25))
    )
    update public.firma_webhook_jobs j
    set status = 'processing',
        attempts = j.attempts + 1,
        locked_until = now() + interval '5 minutes',
        last_attempt_at = now(),
        updated_at = now()
    from candidates c
    where j.id = c.id
    returning j.id, j.provider_event_id, j.signing_request_id, j.event_type, j.event_payload, j.attempts;
end;
$$;

create or replace function public.complete_firma_webhook_job(target_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.firma_webhook_jobs
  set status = 'completed',
      event_payload = '{}'::jsonb,
      locked_until = null,
      last_error = null,
      processed_at = now(),
      updated_at = now()
  where id = target_job_id and status = 'processing';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.fail_firma_webhook_job(target_job_id uuid, failure_message text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  resulting_status text;
begin
  update public.firma_webhook_jobs
  set status = case when attempts >= 5 then 'failed' else 'pending' end,
      event_payload = case when attempts >= 5 then '{}'::jsonb else event_payload end,
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, greatest(attempts - 1, 0)))::integer),
      locked_until = null,
      last_error = left(coalesce(failure_message, 'Unbekannter Verarbeitungsfehler'), 1000),
      updated_at = now()
  where id = target_job_id and status = 'processing'
  returning status into resulting_status;
  return resulting_status;
end;
$$;

revoke all on function public.enqueue_firma_webhook_job(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_firma_webhook_jobs(integer, uuid) from public, anon, authenticated;
revoke all on function public.complete_firma_webhook_job(uuid) from public, anon, authenticated;
revoke all on function public.fail_firma_webhook_job(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_firma_webhook_job(text, text, text, jsonb) to service_role;
grant execute on function public.claim_firma_webhook_jobs(integer, uuid) to service_role;
grant execute on function public.complete_firma_webhook_job(uuid) to service_role;
grant execute on function public.fail_firma_webhook_job(uuid, text) to service_role;
