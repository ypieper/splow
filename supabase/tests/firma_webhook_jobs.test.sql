begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

create temporary table firma_webhook_test_job (id uuid primary key, event_id text not null);
grant select, insert, update on firma_webhook_test_job to service_role;

select ok(not has_table_privilege('authenticated', 'public.firma_webhook_jobs', 'SELECT'), 'Browser users cannot read Firma webhook payloads');
select ok(not has_function_privilege('authenticated', 'public.enqueue_firma_webhook_job(text,text,text,jsonb)', 'EXECUTE'), 'Browser users cannot enqueue Firma webhook jobs');

set local role service_role;
select lives_ok($$insert into firma_webhook_test_job select job_id, 'evt_test_1' from public.enqueue_firma_webhook_job('evt_test_1', 'firma_request_1', 'signing_request.completed', '{"id":"evt_test_1","type":"signing_request.completed"}'::jsonb)$$, 'Service code can durably enqueue a Firma webhook');
select is((select count(*)::integer from public.firma_webhook_jobs where provider_event_id = 'evt_test_1'), 1, 'The provider event ID is unique');
select is((select job_status from public.enqueue_firma_webhook_job('evt_test_1', 'firma_request_1', 'signing_request.completed', '{"id":"evt_test_1","type":"signing_request.completed","retry":true}'::jsonb)), 'pending', 'Duplicate deliveries reuse the pending job');
select is((select count(*)::integer from public.firma_webhook_jobs where provider_event_id = 'evt_test_1'), 1, 'Duplicate deliveries do not create a second job');
select is((select count(*)::integer from public.claim_firma_webhook_jobs(1, null)), 1, 'The worker can claim a due job');
select is((select status from public.firma_webhook_jobs where provider_event_id = 'evt_test_1'), 'processing', 'A claimed job is marked processing');
select is((select attempts from public.firma_webhook_jobs where provider_event_id = 'evt_test_1'), 1, 'Claiming records the processing attempt');
select is((select count(*)::integer from public.claim_firma_webhook_jobs(1, null)), 0, 'A live lease prevents a second worker from claiming the same job');
select is(public.fail_firma_webhook_job((select id from firma_webhook_test_job), 'temporary failure'), 'pending', 'A temporary failure returns the job to the retry queue');
select ok((select next_attempt_at > now() from public.firma_webhook_jobs where provider_event_id = 'evt_test_1'), 'Retry backoff postpones the next attempt');
update public.firma_webhook_jobs set status = 'pending', attempts = 4, next_attempt_at = now() where provider_event_id = 'evt_test_1';
select is((select attempts from public.claim_firma_webhook_jobs(1, null)), 5, 'The fifth attempt is counted');
select is(public.fail_firma_webhook_job((select id from firma_webhook_test_job), 'persistent failure'), 'failed', 'Jobs stop retrying after five failed attempts');
select is((select event_payload from public.firma_webhook_jobs where provider_event_id = 'evt_test_1'), '{}'::jsonb, 'Terminal jobs clear their payload');
select is((select job_status from public.enqueue_firma_webhook_job('evt_test_1', 'firma_request_1', 'signing_request.completed', '{"id":"evt_test_1","type":"signing_request.completed"}'::jsonb)), 'pending', 'A redelivery reopens a failed job');
select is((select attempts from public.firma_webhook_jobs where provider_event_id = 'evt_test_1'), 0, 'A redelivery resets the failed attempt counter');
select is((select count(*)::integer from public.claim_firma_webhook_jobs(1, null)), 1, 'The reopened job can be claimed');
select is(public.complete_firma_webhook_job((select id from firma_webhook_test_job)), true, 'A processed job can be completed');
select is((select status from public.firma_webhook_jobs where provider_event_id = 'evt_test_1'), 'completed', 'Completed jobs cannot be claimed again');
select is((select event_payload from public.firma_webhook_jobs where provider_event_id = 'evt_test_1'), '{}'::jsonb, 'Completed payloads are cleared after processing');
reset role;

select * from finish();
rollback;
