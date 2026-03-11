-- Table to persist the cumulative blocked-IP counter (and any future key-value meta)
CREATE TABLE IF NOT EXISTS public.pin_attempts_meta (
  key   text PRIMARY KEY,
  value text NOT NULL DEFAULT '0'
);

-- Only service-role can touch this table (no RLS bypass needed for anon/users)
ALTER TABLE public.pin_attempts_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access to pin_attempts_meta"
  ON public.pin_attempts_meta
  FOR ALL
  USING (false);
