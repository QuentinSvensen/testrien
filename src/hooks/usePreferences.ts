import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export function usePreferences(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["user_preferences"] });

  useEffect(() => {
    if (!enabled) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        qc.invalidateQueries({ queryKey: ["user_preferences"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [qc, enabled]);

  const { data: preferences = [] } = useQuery({
    queryKey: ["user_preferences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("*");
      if (error) throw error;
      return data as { id: string; key: string; value: any }[];
    },
    retry: 3,
    retryDelay: 500,
    enabled,
  });

  const getPreference = useCallback(<T>(key: string, defaultValue: T): T => {
    const pref = preferences.find(p => p.key === key);
    return pref ? (pref.value as T) : defaultValue;
  }, [preferences]);

  const setPreference = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: any }) => {
      const existing = preferences.find(p => p.key === key);
      if (existing) {
        const { error } = await supabase
          .from("user_preferences")
          .update({ value, updated_at: new Date().toISOString() } as any)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("user_preferences")
          .upsert({ key, value } as any, { onConflict: 'user_id,key' });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
    onError: (error: Error) => {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    },
  });

  return { preferences, getPreference, setPreference };
}
