alter table public.contracts
  add column if not exists signature_declined_by text,
  add column if not exists signature_declined_at timestamptz,
  add column if not exists signature_decline_reason text,
  add column if not exists signature_cancelled_at timestamptz,
  add column if not exists signature_new_version_required boolean not null default false;

alter table public.contracts
  drop constraint if exists contracts_signature_status_check;
alter table public.contracts
  add constraint contracts_signature_status_check
  check (signature_status in ('draft', 'pending_sponsor', 'pending_organizer', 'signed', 'declined', 'cancelled'));

create table if not exists public.contract_signing_attempts (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  provider text not null,
  request_id text not null,
  signing_document_id uuid,
  document_storage_path text,
  document_file_name text,
  signature_status text not null check (signature_status in ('declined', 'cancelled')),
  sponsor_signed_at timestamptz,
  organizer_signed_at timestamptz,
  signed_at date,
  declined_by text check (declined_by is null or declined_by in ('sponsor', 'organizer')),
  declined_at timestamptz,
  decline_reason text,
  closed_at timestamptz not null,
  archived_at timestamptz not null default now(),
  unique (provider, request_id)
);

alter table public.contract_signing_attempts enable row level security;
revoke all on public.contract_signing_attempts from public, anon, authenticated;
grant all on public.contract_signing_attempts to service_role;

create or replace function public.record_contract_signature_decline(
  target_contract_id uuid,
  provider_request_id text,
  signer_role text,
  occurred_at timestamptz,
  decline_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_contract public.contracts%rowtype;
  source_document public.contract_documents%rowtype;
  decline_time timestamptz := coalesce(occurred_at, now());
begin
  if signer_role is null or signer_role not in ('sponsor', 'organizer') then raise exception 'Invalid signer role'; end if;

  select * into current_contract
  from public.contracts c
  where c.id = target_contract_id
    and c.signing_provider = 'firma'
    and c.signing_request_id = provider_request_id
  for update;
  if not found then raise exception 'Contract signing request not found'; end if;

  if (signer_role = 'sponsor' and current_contract.signature_status <> 'pending_sponsor')
    or (signer_role = 'organizer' and current_contract.signature_status <> 'pending_organizer') then
    return;
  end if;

  if current_contract.signing_document_id is not null then
    select * into source_document from public.contract_documents d where d.id = current_contract.signing_document_id;
  end if;

  insert into public.contract_signing_attempts (
    contract_id, provider, request_id, signing_document_id, document_storage_path, document_file_name,
    signature_status, sponsor_signed_at, organizer_signed_at, signed_at,
    declined_by, declined_at, decline_reason, closed_at
  ) values (
    current_contract.id, current_contract.signing_provider, current_contract.signing_request_id,
    current_contract.signing_document_id, source_document.storage_path, source_document.file_name,
    'declined', current_contract.sponsor_signed_at, current_contract.organizer_signed_at, current_contract.signed_at,
    signer_role, decline_time, nullif(trim(decline_reason), ''), decline_time
  )
  on conflict (provider, request_id) do update set
    signature_status = excluded.signature_status,
    declined_by = excluded.declined_by,
    declined_at = excluded.declined_at,
    decline_reason = excluded.decline_reason,
    sponsor_signed_at = excluded.sponsor_signed_at,
    organizer_signed_at = excluded.organizer_signed_at,
    signed_at = excluded.signed_at,
    closed_at = excluded.closed_at;

  update public.contracts c
  set signature_status = 'declined',
      signature_declined_by = signer_role,
      signature_declined_at = decline_time,
      signature_decline_reason = nullif(trim(decline_reason), ''),
      signature_cancelled_at = null
  where c.id = target_contract_id;
end;
$$;

create or replace function public.record_contract_signing_cancellation(
  target_contract_id uuid,
  provider_request_id text,
  occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_contract public.contracts%rowtype;
  source_document public.contract_documents%rowtype;
  cancellation_time timestamptz := coalesce(occurred_at, now());
begin
  select * into current_contract
  from public.contracts c
  where c.id = target_contract_id
    and c.signing_provider = 'firma'
    and c.signing_request_id = provider_request_id
  for update;
  if not found or current_contract.signature_status not in ('pending_sponsor', 'pending_organizer') then return; end if;

  if current_contract.signing_document_id is not null then
    select * into source_document from public.contract_documents d where d.id = current_contract.signing_document_id;
  end if;

  insert into public.contract_signing_attempts (
    contract_id, provider, request_id, signing_document_id, document_storage_path, document_file_name,
    signature_status, sponsor_signed_at, organizer_signed_at, signed_at, closed_at
  ) values (
    current_contract.id, current_contract.signing_provider, current_contract.signing_request_id,
    current_contract.signing_document_id, source_document.storage_path, source_document.file_name,
    'cancelled', current_contract.sponsor_signed_at, current_contract.organizer_signed_at, current_contract.signed_at,
    cancellation_time
  )
  on conflict (provider, request_id) do update set
    signature_status = excluded.signature_status,
    sponsor_signed_at = excluded.sponsor_signed_at,
    organizer_signed_at = excluded.organizer_signed_at,
    signed_at = excluded.signed_at,
    closed_at = excluded.closed_at;

  update public.contracts c
  set signature_status = 'cancelled',
      signature_cancelled_at = cancellation_time,
      signature_declined_by = null,
      signature_declined_at = null,
      signature_decline_reason = null
  where c.id = target_contract_id;
end;
$$;

create or replace function public.prepare_new_contract_version(target_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_contract public.contracts%rowtype;
  source_document public.contract_documents%rowtype;
begin
  select * into current_contract
  from public.contracts c
  where c.id = target_contract_id
    and c.signature_status in ('declined', 'cancelled')
  for update;
  if not found then raise exception 'Contract is not ready for a new version'; end if;
  if current_contract.signing_request_id is not null then
    if current_contract.signing_document_id is not null then
      select * into source_document from public.contract_documents d where d.id = current_contract.signing_document_id;
    end if;
    insert into public.contract_signing_attempts (
      contract_id, provider, request_id, signing_document_id, document_storage_path, document_file_name,
      signature_status, sponsor_signed_at, organizer_signed_at, signed_at,
      declined_by, declined_at, decline_reason, closed_at
    ) values (
      current_contract.id, coalesce(current_contract.signing_provider, 'firma'), current_contract.signing_request_id,
      current_contract.signing_document_id, source_document.storage_path, source_document.file_name,
      current_contract.signature_status, current_contract.sponsor_signed_at, current_contract.organizer_signed_at,
      current_contract.signed_at, current_contract.signature_declined_by, current_contract.signature_declined_at,
      current_contract.signature_decline_reason,
      coalesce(current_contract.signature_declined_at, current_contract.signature_cancelled_at, now())
    ) on conflict (provider, request_id) do nothing;
  end if;

  update public.contracts c
  set signature_status = 'draft',
      signed_at = null,
      sponsor_signed_at = null,
      organizer_signed_at = null,
      signing_provider = null,
      signing_request_id = null,
      signing_document_id = null,
      signature_declined_by = null,
      signature_declined_at = null,
      signature_decline_reason = null,
      signature_cancelled_at = null,
      signature_new_version_required = true
  where c.id = target_contract_id;
end;
$$;

revoke all on function public.record_contract_signature_decline(uuid, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.record_contract_signing_cancellation(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.prepare_new_contract_version(uuid) from public, anon, authenticated;
grant execute on function public.record_contract_signature_decline(uuid, text, text, timestamptz, text) to service_role;
grant execute on function public.record_contract_signing_cancellation(uuid, text, timestamptz) to service_role;
grant execute on function public.prepare_new_contract_version(uuid) to service_role;
