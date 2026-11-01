begin;

create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'tiers-a@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'tiers-b@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;
insert into public.organizations (id, name, created_by)
values
  ('92000000-0000-4000-8000-000000000001', 'Tier Test A', '91000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000002', 'Tier Test B', '91000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;
insert into public.organization_members (organization_id, user_id, email, role)
values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'tiers-a@example.test', 'owner'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'tiers-b@example.test', 'owner')
on conflict (organization_id, user_id) do nothing;
insert into public.events (id, owner_id, organization_id, title, start_date, end_date)
values
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Tiered Event', current_date, current_date),
  ('93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Failed Payment Event', current_date, current_date),
  ('93000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', 'Other Tenant Event', current_date, current_date),
  ('93000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', 'Professional Event', current_date, current_date)
on conflict (id) do nothing;
insert into public.event_entitlements (event_id, organization_id, plan_code, entitlement_status, activation_source)
values
  ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'starter', 'active', 'admin'),
  ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'free', 'active', 'free'),
  ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', 'free', 'active', 'free'),
  ('93000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000002', 'professional', 'active', 'admin')
on conflict (event_id) do nothing;
insert into public.benefit_templates (id, owner_id, organization_id, title, description)
values
  ('95000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Starter must not read this library', ''),
  ('95000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', 'Professional library', '')
on conflict (id) do nothing;
insert into public.sponsors (id, organization_id, name, initials)
select ('94000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       case when n <= 5 then '92000000-0000-4000-8000-000000000001'::uuid else '92000000-0000-4000-8000-000000000002'::uuid end,
       'Tier Sponsor ' || n, 'T' || n
from generate_series(1, 6) n
on conflict (id) do nothing;

select is((select price_cents from public.event_plans where code = 'starter'), 4900::bigint, 'Starter is 49 euros per event');
select is((select price_cents from public.event_plans where code = 'professional'), 9900::bigint, 'Professional is 99 euros per event');
select is((select price_cents from public.event_plans where code = 'business'), 14900::bigint, 'Business is 149 euros per event');
select is((select included_sponsors from public.event_plans where code = 'business'), 3, 'Every paid tier includes three sponsors');
select is(public.sponsor_slot_price_cents(3, 1), 600, 'Sponsor four costs six euros');
select is(public.sponsor_slot_price_cents(9, 2), 1000, 'Progressive pricing crosses from six to four euros');
select is(public.sponsor_slot_price_cents(19, 2), 700, 'Progressive pricing crosses from four to three euros');
select ok(not has_table_privilege('authenticated', 'public.event_product_payments', 'INSERT'), 'Clients cannot create payment records directly');
select ok(not has_function_privilege('authenticated', 'public.record_event_product_payment(uuid,text,text,integer,text,text)', 'EXECUTE'), 'Only trusted payment service can activate products');

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select ok(public.event_feature_enabled('93000000-0000-4000-8000-000000000001', 'manual_benefits'), 'Starter permits manual benefits');
select ok(not public.event_feature_enabled('93000000-0000-4000-8000-000000000001', 'benefit_library'), 'Starter cannot use the benefit library');
select is((select count(*)::integer from public.benefit_templates where id = '95000000-0000-4000-8000-000000000001'), 0, 'Starter cannot read its organization library');
select ok(not public.event_feature_enabled('93000000-0000-4000-8000-000000000001', 'reports_tab'), 'Starter cannot view Reports');
select ok(not public.event_feature_enabled('93000000-0000-4000-8000-000000000001', 'sponsor_task_evidence'), 'Starter cannot enable sponsor task evidence');
select lives_ok($$select public.add_sponsor_to_event('93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', null)$$, 'Starter accepts sponsor one');
select lives_ok($$select public.add_sponsor_to_event('93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000002', null)$$, 'Starter accepts sponsor two');
select lives_ok($$select public.add_sponsor_to_event('93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000003', null)$$, 'Starter accepts sponsor three');
select throws_ok($$select public.add_sponsor_to_event('93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000004', null)$$, 'P0001', 'SPONSOR_LIMIT_REACHED', 'Sponsor four is blocked before an extra slot is paid');
select lives_ok($$select * from public.reserve_event_product_payment('93000000-0000-4000-8000-000000000001', 'sponsor_slots', null, 1)$$, 'Additional sponsor slot payment can be reserved');
select is((select amount_cents from public.event_product_payments where event_id = '93000000-0000-4000-8000-000000000001'), 600, 'Server calculates the slot payment amount');

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok($$select public.save_event_product_checkout((select id from public.event_product_payments where event_id = '93000000-0000-4000-8000-000000000001'), 'cs_test_slot_001')$$, 'Trusted payment service saves the Checkout Session');
select lives_ok($$select public.record_event_product_payment((select id from public.event_product_payments where event_id = '93000000-0000-4000-8000-000000000001'), 'cs_test_slot_001', 'pi_slot_001', 600, 'eur', 'evt_slot_001')$$, 'Confirmed slot payment is recorded');
select lives_ok($$select public.record_event_product_payment((select id from public.event_product_payments where event_id = '93000000-0000-4000-8000-000000000001'), 'cs_test_slot_001', 'pi_slot_001', 600, 'eur', 'evt_slot_001')$$, 'Duplicate confirmation is idempotent');
select is((select count(*)::integer from public.event_product_payments where event_id = '93000000-0000-4000-8000-000000000001' and payment_status = 'paid'), 1, 'Payment confirmation is stored once');
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select lives_ok($$select public.add_sponsor_to_event('93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000004', null)$$, 'Paid slot unlocks sponsor four');
select is((select available_sponsors from public.get_event_product_state('93000000-0000-4000-8000-000000000001')), 0, 'Product state reports the exhausted quota');
select lives_ok($$select * from public.reserve_event_product_payment('93000000-0000-4000-8000-000000000001', 'upgrade', 'business', 0)$$, 'Business upgrade can be reserved');
select is((select amount_cents from public.event_product_payments where event_id = '93000000-0000-4000-8000-000000000001' and payment_status = 'pending'), 12000, 'Upgrade price includes price difference plus 20 euros');

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok($$select public.save_event_product_checkout((select id from public.event_product_payments where event_id = '93000000-0000-4000-8000-000000000001' and payment_status = 'pending'), 'cs_test_upgrade_001')$$, 'Upgrade Checkout Session is saved');
select lives_ok($$select public.record_event_product_payment((select id from public.event_product_payments where event_id = '93000000-0000-4000-8000-000000000001' and payment_status = 'pending'), 'cs_test_upgrade_001', 'pi_upgrade_001', 12000, 'eur', 'evt_upgrade_001')$$, 'Confirmed upgrade is recorded');
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select ok(public.event_feature_enabled('93000000-0000-4000-8000-000000000001', 'reports_tab'), 'Business enables the Reports tab');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select ok(not public.event_feature_enabled('93000000-0000-4000-8000-000000000001', 'reports_tab'), 'Another organization cannot read this event entitlement');
select ok(public.event_feature_enabled('93000000-0000-4000-8000-000000000004', 'sponsor_portal'), 'Professional enables the sponsor portal for its own event');
select ok(not public.event_feature_enabled('93000000-0000-4000-8000-000000000004', 'reports_tab'), 'Professional cannot view the Business-only Reports tab');
select is((select count(*)::integer from public.benefit_templates where id = '95000000-0000-4000-8000-000000000002'), 1, 'Professional can read its organization library');
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.benefit_templates where id = '95000000-0000-4000-8000-000000000002'), 0, 'A different tenant cannot read the Professional library');
select lives_ok($$select * from public.reserve_event_product_payment('93000000-0000-4000-8000-000000000002', 'initial', 'starter', 0)$$, 'Initial Free-to-Starter payment can be reserved');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok($$select public.save_event_product_checkout((select id from public.event_product_payments where event_id = '93000000-0000-4000-8000-000000000002'), 'cs_test_failed_001')$$, 'Pending initial Checkout Session is saved');
select lives_ok($$select public.fail_event_product_payment('cs_test_failed_001')$$, 'Failed payment releases the pending reservation');
select is((select payment_status from public.event_product_payments where event_id = '93000000-0000-4000-8000-000000000002'), 'failed', 'Failed payment remains failed');
select is((select plan_code from public.event_entitlements where event_id = '93000000-0000-4000-8000-000000000002'), 'free', 'Failed payment does not activate the paid package');
select is((select count(*)::integer from public.event_product_payments where event_id = '93000000-0000-4000-8000-000000000002' and payment_status = 'pending'), 0, 'Failed payment no longer blocks retry');

select * from finish();
rollback;
