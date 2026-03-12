import { useState, forwardRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Loader2 } from "lucide-react";

export const PinLock = forwardRef<HTMLDivElement, { onUnlock: () => void }>(function PinLock({ onUnlock }, _ref) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("Code incorrect");
  const [loading, setLoading] = useState(false);

  const showError = (msg = "Code incorrect") => {
    setErrorMsg(msg);
    setError(true);
    setPin("");
    setTimeout(() => setError(false), 2000);
  };

  const handleSubmit = async () => {
    if (pin.length !== 4 || loading) return;
    setLoading(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/verify-pin`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": anonKey, "Authorization": `Bearer ${anonKey}` },
          body: JSON.stringify({ pin }),
        }
      );
      let data: Record<string, unknown> = {};
      try { data = await res.json(); } catch { /* ignore */ }

      if (data.success && data.access_token && data.refresh_token) {
        await supabase.auth.setSession({
          access_token: data.access_token as string,
          refresh_token: data.refresh_token as string,
        });
        onUnlock();
      } else if (res.status === 401 && data.error?.toString().includes("Accès refusé")) {
        showError((data.error as string) || "Accès refusé");
      } else {
        showError((data.error as string) || "Code incorrect");
      }
    } catch {
      showError("Service indisponible, réessaie");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 p-8">
        <Lock className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-bold text-foreground">Code d'accès</h2>
        <Input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="••••"
          className={`w-32 text-center text-2xl tracking-[0.5em] font-mono rounded-xl ${error ? 'border-destructive animate-shake' : ''}`}
          autoFocus
          disabled={loading}
        />
        <Button onClick={handleSubmit} disabled={pin.length !== 4 || loading} className="w-32 rounded-xl">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrer"}
        </Button>
      </div>
    </div>
  );
});
