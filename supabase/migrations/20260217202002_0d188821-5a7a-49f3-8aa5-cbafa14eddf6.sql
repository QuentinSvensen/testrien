
CREATE TABLE IF NOT EXISTS public.pin_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_pin_attempts_ip_time ON public.pin_attempts(ip, created_at);

-- RLS: only service role can access this table (used only from edge function)
ALTER TABLE public.pin_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to pin_attempts"
  ON public.pin_attempts FOR ALL
  USING (false);
