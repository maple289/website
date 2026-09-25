CREATE TABLE public.registration_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.pending_registrations(id) ON DELETE CASCADE,
  operation text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  message_id text,
  http_status integer,
  error_type text,
  error_message text,
  UNIQUE(registration_id, operation, recipient)
);
ALTER TABLE public.registration_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_email_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.registration_email_deliveries TO service_role;
CREATE FUNCTION public.claim_registration_email(delivery_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.registration_email_deliveries
  SET status = 'sending', attempts = attempts + 1, last_attempt_at = now(), first_attempt_at = coalesce(first_attempt_at, now())
  WHERE id = delivery_id AND status <> 'sent' AND attempts < 5
    AND (last_attempt_at IS NULL OR last_attempt_at < now() - interval '1 minute')
    -- Never blindly retry after Resend's 24-hour idempotency window.
    AND (first_attempt_at IS NULL OR first_attempt_at > now() - interval '23 hours');
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_registration_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_registration_email(uuid) TO service_role;
