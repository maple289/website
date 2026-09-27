-- Run after the activation migration in a disposable transaction. All changes roll back.
BEGIN;
CREATE FUNCTION pg_temp.check_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
RAISE NOTICE 'PASS: %',label; END; $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT id FROM public.profiles WHERE role='admin' LIMIT 1),'role','authenticated')::text,true);
INSERT INTO public.pending_registrations(id,email,username,first_name,last_name)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','activation-regression@example.invalid','activation_regression','First','Last');
SELECT public.approve_pending_account('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
SELECT pg_temp.check_true(NOT EXISTS(SELECT 1 FROM public.pending_registrations WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),'pending removed after approval');
SELECT pg_temp.check_true(EXISTS(SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id JOIN public.account_activation a ON a.user_id=u.id WHERE u.email='activation-regression@example.invalid' AND u.encrypted_password IS NULL AND a.must_change_password AND a.active AND p.role='user' AND p.first_name='First' AND p.last_name='Last'),'approved user has names, User role, no password and setup required');
SELECT pg_temp.check_true(public.start_initial_login('activation_regression',repeat('a',64)),'initial blank login allowed');
SELECT pg_temp.check_true(public.resolve_login_email('activation_regression') IS NULL,'normal login unavailable before setup');
SELECT pg_temp.check_true(public.account_access_token_hook(jsonb_build_object('user_id',(SELECT id FROM auth.users WHERE email='activation-regression@example.invalid'),'claims','{}'::jsonb)) ? 'error','alternative token issuance blocked before setup');
SELECT pg_temp.check_true(public.claim_initial_password(repeat('b',64)) IS NULL,'invalid setup token rejected');
SELECT pg_temp.check_true(public.claim_initial_password(repeat('a',64)) IS NOT NULL,'valid setup token claimed');
SELECT pg_temp.check_true(public.claim_initial_password(repeat('a',64)) IS NULL,'concurrent/replayed claim rejected');
SELECT public.release_initial_password(repeat('a',64));
UPDATE public.account_activation SET active=false WHERE registration_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
SELECT pg_temp.check_true(NOT public.start_initial_login('activation_regression',repeat('b',64)) AND public.claim_initial_password(repeat('a',64)) IS NULL,'disabled account cannot log in or set password');
UPDATE public.account_activation SET active=true,setup_expires_at=now()-interval '1 second' WHERE registration_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
SELECT pg_temp.check_true(public.claim_initial_password(repeat('a',64)) IS NULL,'expired setup token rejected');
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE email='activation-regression@example.invalid';
SELECT pg_temp.check_true(NOT public.start_initial_login('activation_regression',repeat('b',64)),'banned account cannot log in');
UPDATE auth.users SET banned_until=NULL,encrypted_password='rollback-only-mock-hash' WHERE email='activation-regression@example.invalid';
SELECT pg_temp.check_true(EXISTS(SELECT 1 FROM public.account_activation WHERE registration_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND NOT must_change_password AND password_set_at IS NOT NULL AND setup_token_hash IS NULL),'password update atomically completes setup and clears token');
SELECT pg_temp.check_true(NOT public.start_initial_login('activation_regression',repeat('b',64)),'blank login rejected permanently after setup');
SELECT pg_temp.check_true(public.resolve_login_email('activation_regression')='activation-regression@example.invalid','normal username login resolves after setup');
SELECT pg_temp.check_true(NOT(public.account_access_token_hook(jsonb_build_object('user_id',(SELECT id FROM auth.users WHERE email='activation-regression@example.invalid'),'claims','{}'::jsonb)) ? 'error'),'normal token issuance available after setup');
INSERT INTO public.pending_registrations(id,email,username) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd','activation-regression@example.invalid','different_username');
DO $$ BEGIN
  BEGIN PERFORM public.approve_pending_account('dddddddd-dddd-4ddd-8ddd-dddddddddddd'); RAISE EXCEPTION 'Duplicate approval unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  PERFORM pg_temp.check_true(EXISTS(SELECT 1 FROM public.pending_registrations WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),'duplicate email preserves pending record');
END $$;
UPDATE public.pending_registrations SET email='different-address@example.invalid',username='activation_regression' WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
DO $$ BEGIN
  BEGIN PERFORM public.approve_pending_account('dddddddd-dddd-4ddd-8ddd-dddddddddddd'); RAISE EXCEPTION 'Duplicate username unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  PERFORM pg_temp.check_true(EXISTS(SELECT 1 FROM public.pending_registrations WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),'duplicate username preserves pending record');
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT id FROM auth.users WHERE email='activation-regression@example.invalid'),'role','authenticated')::text,true);
DO $$ BEGIN
  BEGIN PERFORM public.approve_pending_account('dddddddd-dddd-4ddd-8ddd-dddddddddddd'); RAISE EXCEPTION 'Non-admin approval unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: non-admin approval forbidden'; END;
END $$;
SELECT pg_temp.check_true(NOT has_table_privilege('authenticated','public.account_activation','UPDATE') AND NOT has_table_privilege('anon','public.account_activation','SELECT'),'clients cannot read or manipulate activation state');
SELECT pg_temp.check_true(NOT has_function_privilege('authenticated','public.claim_initial_password(text)','EXECUTE') AND NOT has_function_privilege('anon','public.start_initial_login(text,text)','EXECUTE'),'setup internals are service-only');
SELECT pg_temp.check_true(NOT has_any_column_privilege('anon','public.pending_registrations','INSERT'),'registration cannot bypass backend trigger');
ROLLBACK;
