import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INITIAL_MAX_ATTEMPTS = 3;
const INITIAL_LOCK_MINUTES = 15;
const ATTEMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const APP_USER_EMAIL = "app@internal.local";
const BLOCKED_COUNT_KEY = "cumulative_blocked_count";
const LOCKOUT_KEY_PREFIX = "lockout:";

interface LockoutState {
  failed_attempts: number;
  lock_count: number;
  current_lock_minutes: number;
  lock_until: string | null;
}

const DEFAULT_LOCKOUT_STATE: LockoutState = {
  failed_attempts: 0,
  lock_count: 0,
  current_lock_minutes: INITIAL_LOCK_MINUTES,
  lock_until: null,
};

const sanitizeLockoutState = (value: string | undefined): LockoutState => {
  if (!value) return { ...DEFAULT_LOCKOUT_STATE };
  try {
    const parsed = JSON.parse(value) as Partial<LockoutState>;
    return {
      failed_attempts: Number.isFinite(parsed.failed_attempts) ? Math.max(0, Number(parsed.failed_attempts)) : 0,
      lock_count: Number.isFinite(parsed.lock_count) ? Math.max(0, Number(parsed.lock_count)) : 0,
      current_lock_minutes: Number.isFinite(parsed.current_lock_minutes)
        ? Math.max(INITIAL_LOCK_MINUTES, Number(parsed.current_lock_minutes))
        : INITIAL_LOCK_MINUTES,
      lock_until: typeof parsed.lock_until === "string" ? parsed.lock_until : null,
    };
  } catch {
    return { ...DEFAULT_LOCKOUT_STATE };
  }
};

const lockoutKeyForIp = (ip: string) => `${LOCKOUT_KEY_PREFIX}${ip}`;

const getRemainingMinutes = (lockUntil: string | null): number => {
  if (!lockUntil) return 0;
  const lockUntilMs = new Date(lockUntil).getTime();
  if (!Number.isFinite(lockUntilMs)) return 0;
  const diffMs = lockUntilMs - Date.now();
  if (diffMs <= 0) return 0;
  return Math.max(1, Math.ceil(diffMs / 60000));
};

const verifyAuth = async (authHeader: string | null) => {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.replace("Bearer ", "");

  const supabaseAnon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const { data, error } = await supabaseAnon.auth.getClaims(token);
  return !error && !!data?.claims;
};

const getMetaValue = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  key: string,
): Promise<string | null> => {
  const { data, error } = await supabaseAdmin
    .from("pin_attempts_meta")
    .select("value")
    .eq("key", key)
    .limit(1);

  if (error) throw error;
  return data?.[0]?.value ?? null;
};

const setMetaValue = async (
  supabaseAdmin: ReturnType<typeof createClient>,
  key: string,
  value: string,
) => {
  const { data: existingRows, error: readError } = await supabaseAdmin
    .from("pin_attempts_meta")
    .select("key")
    .eq("key", key)
    .limit(1);

  if (readError) throw readError;

  if (existingRows && existingRows.length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from("pin_attempts_meta")
      .update({ value })
      .eq("key", key);
    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await supabaseAdmin
    .from("pin_attempts_meta")
    .insert({ key, value });
  if (insertError) throw insertError;
};

const incrementBlockedCount = async (supabaseAdmin: ReturnType<typeof createClient>) => {
  const currentRaw = await getMetaValue(supabaseAdmin, BLOCKED_COUNT_KEY);
  const current = Number.parseInt(currentRaw ?? "0", 10);
  const next = (Number.isFinite(current) ? current : 0) + 1;
  await setMetaValue(supabaseAdmin, BLOCKED_COUNT_KEY, String(next));
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // no body
    }

    if (body.reset_blocked) {
      const authed = await verifyAuth(req.headers.get("authorization"));
      if (!authed) {
        return new Response(JSON.stringify({ success: false, error: "Non autorisé" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await setMetaValue(supabaseAdmin, BLOCKED_COUNT_KEY, "0");

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.admin_stats) {
      const authed = await verifyAuth(req.headers.get("authorization"));
      if (!authed) {
        return new Response(JSON.stringify({ success: false, error: "Non autorisé" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const blockedRaw = await getMetaValue(supabaseAdmin, BLOCKED_COUNT_KEY);
      const blocked_count = Number.parseInt(blockedRaw ?? "0", 10) || 0;
      return new Response(JSON.stringify({ blocked_count }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lockoutKey = lockoutKeyForIp(clientIp);
    const lockoutRaw = await getMetaValue(supabaseAdmin, lockoutKey);

    let lockoutState = sanitizeLockoutState(lockoutRaw ?? undefined);

    const remainingMinutes = getRemainingMinutes(lockoutState.lock_until);
    if (remainingMinutes > 0) {
      return new Response(
        JSON.stringify({ success: false, error: `Accès refusé. Réessaie dans ${remainingMinutes} min` }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (lockoutState.lock_until) {
      lockoutState = { ...lockoutState, lock_until: null };
      await setMetaValue(supabaseAdmin, lockoutKey, JSON.stringify(lockoutState));
    }

    const { pin } = body as { pin?: string };
    if (!pin || typeof pin !== "string") {
      return new Response(JSON.stringify({ success: false, error: "PIN requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serverPin = Deno.env.get("VITE_APP_PIN");
    if (!serverPin) {
      return new Response(JSON.stringify({ success: false, error: "PIN non configuré" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isValid = pin === serverPin;

    await supabaseAdmin.from("pin_attempts").insert({ ip: clientIp, success: isValid });

    if (!isValid) {
      let blockedForMinutes: number | null = null;

      if (lockoutState.lock_count === 0) {
        const attempts = lockoutState.failed_attempts + 1;
        if (attempts >= INITIAL_MAX_ATTEMPTS) {
          blockedForMinutes = INITIAL_LOCK_MINUTES;
          lockoutState = {
            failed_attempts: 0,
            lock_count: 1,
            current_lock_minutes: INITIAL_LOCK_MINUTES,
            lock_until: new Date(Date.now() + INITIAL_LOCK_MINUTES * 60000).toISOString(),
          };
        } else {
          lockoutState = { ...lockoutState, failed_attempts: attempts };
        }
      } else {
        const nextLockMinutes = Math.max(INITIAL_LOCK_MINUTES, lockoutState.current_lock_minutes * 2);
        blockedForMinutes = nextLockMinutes;
        lockoutState = {
          ...lockoutState,
          failed_attempts: 0,
          lock_count: lockoutState.lock_count + 1,
          current_lock_minutes: nextLockMinutes,
          lock_until: new Date(Date.now() + nextLockMinutes * 60000).toISOString(),
        };
      }

      await setMetaValue(supabaseAdmin, lockoutKey, JSON.stringify(lockoutState));

      if (blockedForMinutes !== null) {
        await incrementBlockedCount(supabaseAdmin);
        return new Response(
          JSON.stringify({ success: false, error: `Accès refusé. Réessaie dans ${blockedForMinutes} min` }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ success: false, error: "Code incorrect" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (lockoutState.failed_attempts !== 0 || lockoutState.lock_until) {
      await setMetaValue(
        supabaseAdmin,
        lockoutKey,
        JSON.stringify({ ...lockoutState, failed_attempts: 0, lock_until: null }),
      );
    }

    await supabaseAdmin
      .from("pin_attempts")
      .delete()
      .lt("created_at", new Date(Date.now() - ATTEMPT_RETENTION_MS).toISOString());

    const appUserPassword = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!.slice(0, 32);

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    let signInResult = await supabaseAnon.auth.signInWithPassword({
      email: APP_USER_EMAIL,
      password: appUserPassword,
    });

    if (signInResult.error) {
      const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: APP_USER_EMAIL,
        password: appUserPassword,
        email_confirm: true,
      });

      if (createError && !createError.message.includes("already been registered")) {
        console.error("Failed to create app user:", createError);
        return new Response(JSON.stringify({ success: false, error: "Erreur interne" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      signInResult = await supabaseAnon.auth.signInWithPassword({
        email: APP_USER_EMAIL,
        password: appUserPassword,
      });
    }

    if (signInResult.error || !signInResult.data?.session) {
      console.error("Sign-in failed:", signInResult.error);
      return new Response(JSON.stringify({ success: false, error: "Erreur de session" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { access_token, refresh_token } = signInResult.data.session;

    return new Response(JSON.stringify({ success: true, access_token, refresh_token }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("verify-pin error:", e);
    return new Response(JSON.stringify({ success: false, error: "Requête invalide" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
