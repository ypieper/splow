-- Keep historical payment records but allow organizers to delete the linked PDF.
alter table public.contract_signature_payments
  alter column signing_document_id drop not null;

alter table public.contract_signature_payments
  drop constraint if exists contract_signature_payments_signing_document_id_fkey;

alter table public.contract_signature_payments
  add constraint contract_signature_payments_signing_document_id_fkey
  foreign key (signing_document_id) references public.contract_documents(id) on delete set null;
