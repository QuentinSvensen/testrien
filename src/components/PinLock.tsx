/**
 * PinLock — Écran de verrouillage par code PIN.
 *
 * Affiche un champ de saisie de code à 4 chiffres.
 * Vérifie le PIN via une fonction backend (verify-pin) et crée
 * une session authentifiée en cas de succès.
 *
 * Fonctionnalités :
 * - Vérification de mise à jour de l'app au chargement (via Service Worker)
 * - Gestion des tentatives échouées avec messages d'erreur
 * - Rechargement automatique si une nouvelle version est détectée
 */
import { useState, forwardRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Loader2, RefreshCw } from "lucide-react";

export const PinLock = forwardRef<HTMLDivElement, { onUnlock: () => void }>(function PinLock({ onUnlock }, _ref) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("Code incorrect");
  const [loading, setLoading] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker) return;

    // Force check for app update whenever PIN page appears
    const checkForUpdate = async () => {
      setCheckingUpdate(true);
      try {
        // 1. Ask SW to check for updates in background
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();

        // 2. Active version check: bypass SW cache for manifest.json
        const [remote, local] = await Promise.all([
          fetch("/manifest.json", { cache: "no-store" }).then(r => r.json()).catch(() => null),
          fetch("/manifest.json").then(r => r.json()).catch(() => null)
        ]);

        if (remote?.version && local?.version && remote.version !== local.version) {
          console.log("New version detected:", remote.version, "vs local:", local.version);
          window.location.reload();
          return;
        }
      } catch (err) {
        console.warn("Update check failed:", err);
      } finally {
        setCheckingUpdate(false);
      }
    };

    checkForUpdate();

    // Fast-reload if a new Service Worker activates while we are on this page
    const handleControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
  }, []);

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
        <div className="flex flex-col items-center gap-2">
          <Button onClick={handleSubmit} disabled={pin.length !== 4 || loading} className="w-32 rounded-xl">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrer"}
          </Button>
          {checkingUpdate && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground animate-pulse">
              <RefreshCw className="h-3 w-3 animate-spin" /> Vérification de version...
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
