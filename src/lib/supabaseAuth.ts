import { supabase } from "@/integrations/supabase/client";

// The template's @supabase/supabase-js types may be stale.
// This wrapper provides properly typed auth methods.
const auth = supabase.auth as any;

export const supabaseAuth = {
  getSession: () => auth.getSession() as Promise<{ data: { session: any }; error: any }>,
  onAuthStateChange: (cb: (event: string, session: any) => void) => auth.onAuthStateChange(cb) as { data: { subscription: { unsubscribe: () => void } } },
  signOut: () => auth.signOut() as Promise<{ error: any }>,
  getUser: () => auth.getUser() as Promise<{ data: { user: any }; error: any }>,
  setSession: (opts: any) => auth.setSession(opts) as Promise<{ data: { session: any }; error: any }>,
  signInWithPassword: (opts: any) => auth.signInWithPassword(opts),
};

export type Session = {
  access_token: string;
  refresh_token: string;
  user: any;
  expires_at?: number;
  expires_in?: number;
};
