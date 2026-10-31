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

  -- Preserve the partial signing record in the attempt history before clearing it
  -- from the active contract, since the declined version is no longer executable.
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
      signed_at = null,
      sponsor_signed_at = null,
      organizer_signed_at = null,
      signature_declined_by = signer_role,
      signature_declined_at = decline_time,
      signature_decline_reason = nullif(trim(decline_reason), ''),
      signature_cancelled_at = null
  where c.id = target_contract_id;
end;
$$;

revoke all on function public.record_contract_signature_decline(uuid, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_contract_signature_decline(uuid, text, text, timestamptz, text) to service_role;

create or replace function public.record_contract_signature(
  target_contract_id uuid,
  signer_role text,
  occurred_at timestamptz
)
returns table (signature_status text, signed_at date, sponsor_signed_at timestamptz, organizer_signed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_contract public.contracts%rowtype;
  signing_time timestamptz := coalesce(occurred_at, now());
begin
  if signer_role is null or signer_role not in ('sponsor', 'organizer') then raise exception 'Invalid signer role'; end if;

  select * into current_contract
  from public.contracts c
  where c.id = target_contract_id
  for update;
  if not found then raise exception 'Contract not found'; end if;

  -- A delayed Firma webhook must never restore a partial signature after the
  -- other party has declined or the request has been cancelled.
  if current_contract.signature_status in ('declined', 'cancelled') then
    return query select c.signature_status, c.signed_at, c.sponsor_signed_at, c.organizer_signed_at
      from public.contracts c where c.id = target_contract_id;
    return;
  end if;

  if signer_role = 'sponsor' then
    if current_contract.sponsor_signed_at is null and current_contract.signature_status = 'pending_sponsor' then
      update public.contracts c
      set sponsor_signed_at = signing_time,
          signature_status = 'pending_organizer'
      where c.id = target_contract_id;
    elsif current_contract.sponsor_signed_at is null then
      raise exception 'Sponsor signature is not currently expected';
    end if;
  elsif current_contract.organizer_signed_at is null then
    if current_contract.sponsor_signed_at is null or current_contract.signature_status <> 'pending_organizer' then
      raise exception 'Organizer can sign only after the sponsor';
    end if;
    update public.contracts c
    set organizer_signed_at = signing_time,
        signature_status = 'signed',
        signed_at = (signing_time at time zone 'Europe/Berlin')::date
    where c.id = target_contract_id;
  end if;

  return query
    select c.signature_status, c.signed_at, c.sponsor_signed_at, c.organizer_signed_at
    from public.contracts c where c.id = target_contract_id;
end;
$$;

revoke all on function public.record_contract_signature(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_contract_signature(uuid, text, timestamptz) to service_role;
