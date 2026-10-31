begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('61000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'workspace-owner@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('61000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'workspace-member@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('61000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'account-owner@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('61000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'account-owner-2@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('61000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'organization-owner@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.organizations (id, name, created_by)
values
  ('71000000-0000-4000-8000-000000000001', 'Team Security Test', '61000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-000000000002', 'Account Deletion Test', '61000000-0000-4000-8000-000000000003'),
  ('71000000-0000-4000-8000-000000000003', 'Organization Deletion Test', '61000000-0000-4000-8000-000000000005')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, email, role)
values
  ('71000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'workspace-owner@example.test', 'owner'),
  ('71000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000002', 'workspace-member@example.test', 'member'),
  ('71000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000003', 'account-owner@example.test', 'owner'),
  ('71000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-000000000005', 'organization-owner@example.test', 'owner')
on conflict (organization_id, user_id) do nothing;

insert into public.events (id, owner_id, organization_id, title)
values
  ('72000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Team Security Event'),
  ('72000000-0000-4000-8000-000000000003', '61000000-0000-4000-8000-000000000005', '71000000-0000-4000-8000-000000000003', 'Other Organization Event')
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('sponsorproof-files', 'sponsorproof-files', false)
on conflict (id) do nothing;
insert into storage.objects (bucket_id, name)
values
  ('sponsorproof-files', '71000000-0000-4000-8000-000000000001/events/72000000-0000-4000-8000-000000000001/evidence/team-test.jpg'),
  ('sponsorproof-files', '71000000-0000-4000-8000-000000000003/events/72000000-0000-4000-8000-000000000003/evidence/delete-test.jpg');

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok($$select public.set_organization_member_role('61000000-0000-4000-8000-000000000001', 'member')$$, 'P0001', 'Only the workspace owner can manage members', 'Members cannot change team roles');
select throws_ok($$select public.remove_organization_member('61000000-0000-4000-8000-000000000001')$$, 'P0001', 'Only the workspace owner can manage members', 'Members cannot remove workspace members');
reset role;

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*)::integer from public.events where id = '72000000-0000-4000-8000-000000000001'), 1, 'A workspace member can read their own event');
select is((select count(*)::integer from public.events where id = '72000000-0000-4000-8000-000000000003'), 0, 'A workspace member cannot read another organization event');
select is((select count(*)::integer from storage.objects where bucket_id = 'sponsorproof-files' and name = '71000000-0000-4000-8000-000000000001/events/72000000-0000-4000-8000-000000000001/evidence/team-test.jpg'), 1, 'A workspace member can read their own stored file');
select is((select count(*)::integer from storage.objects where bucket_id = 'sponsorproof-files' and name = '71000000-0000-4000-8000-000000000003/events/72000000-0000-4000-8000-000000000003/evidence/delete-test.jpg'), 0, 'A workspace member cannot read another organization file');
select lives_ok($$select public.set_organization_member_role('61000000-0000-4000-8000-000000000002', 'owner')$$, 'An owner can promote a team member');
select lives_ok($$select public.set_organization_member_role('61000000-0000-4000-8000-000000000002', 'member')$$, 'An owner can change a member role back');
select throws_ok($$select public.set_organization_member_role('61000000-0000-4000-8000-000000000001', 'member')$$, 'P0001', 'At least one workspace owner must remain', 'The last owner cannot demote themselves');
-- The Storage API sets this transaction-local flag before deleting metadata.
-- Keep the RLS check while allowing the same metadata deletion in this SQL test.
set local storage.allow_delete_query = 'true';
select lives_ok($$delete from storage.objects where bucket_id = 'sponsorproof-files' and name = '71000000-0000-4000-8000-000000000001/events/72000000-0000-4000-8000-000000000001/evidence/team-test.jpg'$$, 'A workspace member can delete a stored file');
reset role;
select is((select count(*)::integer from storage.objects where bucket_id = 'sponsorproof-files' and name = '71000000-0000-4000-8000-000000000001/events/72000000-0000-4000-8000-000000000001/evidence/team-test.jpg'), 0, 'Deleted workspace file is removed from storage');

create temporary table account_deletion_result (payload jsonb);
grant insert on account_deletion_result to service_role;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select throws_ok($$select public.prepare_account_deletion('61000000-0000-4000-8000-000000000003')$$, 'P0001', 'LAST_WORKSPACE_OWNER', 'An account with the only owner cannot be deleted alone');
reset role;
insert into public.organization_members (organization_id, user_id, email, role)
values ('71000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000004', 'account-owner-2@example.test', 'owner');
set local role service_role;
select lives_ok($$insert into account_deletion_result select public.prepare_account_deletion('61000000-0000-4000-8000-000000000003')$$, 'Account deletion can proceed when another owner remains');
reset role;
select is((select payload ->> 'previous_role' from account_deletion_result), 'owner', 'Account deletion records the previous owner role');
select is((select count(*)::integer from public.organization_members where organization_id = '71000000-0000-4000-8000-000000000002' and role = 'owner'), 1, 'Another owner remains during account deletion');
select lives_ok($$delete from auth.users where id = '61000000-0000-4000-8000-000000000003'$$, 'The user account can be deleted after preparation');
select ok(exists(select 1 from public.organizations where id = '71000000-0000-4000-8000-000000000002'), 'Account deletion preserves the shared workspace');
select is((select count(*)::integer from public.organization_members where organization_id = '71000000-0000-4000-8000-000000000002' and user_id = '61000000-0000-4000-8000-000000000003'), 0, 'Deleted account is removed from workspace membership');

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select throws_ok($$select public.delete_organization_for_owner('61000000-0000-4000-8000-000000000005', 'wrong phrase')$$, 'P0001', 'CONFIRMATION_REQUIRED', 'Organization deletion requires the exact confirmation phrase');
select lives_ok($$select public.delete_organization_for_owner('61000000-0000-4000-8000-000000000005', 'VERANSTALTERBEREICH LÖSCHEN')$$, 'An owner can delete the organization');
reset role;
select ok(not exists(select 1 from public.organizations where id = '71000000-0000-4000-8000-000000000003'), 'Organization deletion removes the workspace record');
select is((select count(*)::integer from public.account_deletion_storage_queue where organization_id = '71000000-0000-4000-8000-000000000003' and object_name = '71000000-0000-4000-8000-000000000003/events/72000000-0000-4000-8000-000000000003/evidence/delete-test.jpg'), 1, 'Organization deletion queues every stored file for cleanup');

select * from finish();
rollback;
