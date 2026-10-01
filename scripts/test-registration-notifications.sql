-- Actual production RPC regression, with every fixture rolled back.
BEGIN;
CREATE FUNCTION pg_temp.check_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
RAISE NOTICE 'PASS: %',label; END; $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT id FROM public.profiles WHERE role='admin' LIMIT 1),'role','authenticated')::text,true);
INSERT INTO public.pending_registrations(id,email,first_name,last_name)
VALUES('c1111111-1111-4111-8111-111111111111','notification-regression@example.invalid','First','Last');
SELECT public.approve_pending_account('c1111111-1111-4111-8111-111111111111') AS first_approval \gset
SELECT pg_temp.check_true(public.approve_pending_account('c1111111-1111-4111-8111-111111111111')=:'first_approval'::jsonb,'repeat approval returns same verified account');
SELECT pg_temp.check_true(NOT EXISTS(SELECT 1 FROM public.pending_registrations WHERE id='c1111111-1111-4111-8111-111111111111'),'pending removed only after account creation');
SELECT pg_temp.check_true(EXISTS(SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id JOIN public.account_activation a ON a.user_id=u.id WHERE u.email='notification-regression@example.invalid' AND u.encrypted_password IS NULL AND a.must_change_password AND a.active AND p.role='user' AND p.first_name='First'),'names, User role and first-password workflow preserved');
SELECT pg_temp.check_true(public.start_initial_login('notification-regression@example.invalid',repeat('a',64)),'initial login capability still works');
UPDATE auth.users SET encrypted_password='rollback-only-mock-hash' WHERE email='notification-regression@example.invalid';
SELECT pg_temp.check_true(NOT public.start_initial_login('notification-regression@example.invalid',repeat('b',64)),'blank login rejected after setup');
SELECT pg_temp.check_true(NOT(public.approve_pending_account('c1111111-1111-4111-8111-111111111111')->>'must_change_password')::boolean,'approval retry preserves completed password state');
INSERT INTO public.pending_registrations(id,email) VALUES('c2222222-2222-4222-8222-222222222222','notification-regression@example.invalid');
DO $$ BEGIN
 BEGIN PERFORM public.approve_pending_account('c2222222-2222-4222-8222-222222222222'); RAISE EXCEPTION 'Duplicate unexpectedly approved';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM pg_temp.check_true(EXISTS(SELECT 1 FROM public.pending_registrations WHERE id='c2222222-2222-4222-8222-222222222222'),'account conflict retains pending request');
END; $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT id FROM auth.users WHERE email='notification-regression@example.invalid'),'role','authenticated')::text,true);
DO $$ BEGIN
 BEGIN PERFORM public.approve_pending_account('c1111111-1111-4111-8111-111111111111'); RAISE EXCEPTION 'Non-admin unexpectedly approved';
 EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: retry remains admin-only'; END;
END; $$;
SELECT pg_temp.check_true(NOT has_table_privilege('authenticated','public.account_activation','SELECT') AND NOT has_table_privilege('anon','public.registration_email_deliveries','SELECT'),'activation and delivery metadata remain private');
ROLLBACK;
