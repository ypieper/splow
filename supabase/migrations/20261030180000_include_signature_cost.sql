-- Contract signing is included in the event package; no separate payment is required.
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
  update public.contracts set signature_status = 'pending_sponsor'
  where id = target_contract_id and signature_status = 'draft' and signing_document_id = target_document;
  if not found then raise exception 'Contract is not ready for signing'; end if;
end;
$$;
revoke all on function public.start_simple_contract_signing(uuid) from public, anon;
grant execute on function public.start_simple_contract_signing(uuid) to authenticated, service_role;
