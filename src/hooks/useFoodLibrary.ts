/**
 * useFoodLibrary — Hook pour la bibliothèque d'aliments mémorisés.
 *
 * Fournit :
 * - Chargement de toute la bibliothèque au montage (cache long)
 * - Recherche locale en mémoire avec normalisation diacritique
 * - Upsert (création ou mise à jour) d'une entrée après ajout d'un aliment
 *
 * La bibliothèque retient les préférences utilisateur (food_type, is_meal,
 * no_counter, storage_type) pour chaque nom d'aliment déjà saisi.
 */
import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FoodType, StorageType } from "@/hooks/useFoodItems";

export interface FoodLibraryEntry {
  id: string;
  name: string;
  food_type: FoodType;
  is_meal: boolean;
  no_counter: boolean;
  storage_type: StorageType;
}

/** Normalise un texte pour la recherche : minuscule, sans accents */
function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function useFoodLibrary() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["food_library"] });

  // ─── Chargement de toute la bibliothèque ────────────────────────────
  const { data: library = [], isLoading } = useQuery({
    queryKey: ["food_library"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_library" as any)
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data as any[]).map((d) => ({
        id: d.id,
        name: d.name,
        food_type: (d.food_type as FoodType) ?? null,
        is_meal: d.is_meal ?? false,
        no_counter: d.no_counter ?? false,
        storage_type: (d.storage_type as StorageType) ?? "frigo",
      })) as FoodLibraryEntry[];
    },
    staleTime: 0, // Désactivé temporairement pour le debug
    retry: 2,
  });

  // ─── Index de recherche normalisé (recalculé quand la lib change) ───
  const searchIndex = useMemo(() => {
    return library.map((entry) => ({
      ...entry,
      _normalized: normalizeSearch(entry.name),
    }));
  }, [library]);

  // ─── Recherche locale (en mémoire, pas de requête serveur) ──────────
  const searchLibrary = useCallback(
    (query: string, limit = 8): FoodLibraryEntry[] => {
      const q = normalizeSearch(query);
      if (!q) return [];
      
      return searchIndex
        .filter((e) => e._normalized.startsWith(q))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, limit);
    },
    [searchIndex]
  );

  // ─── Upsert : créer ou mettre à jour une entrée ────────────────────
  const upsertEntry = useMutation({
    mutationFn: async ({
      name,
      food_type,
      is_meal,
      no_counter,
      storage_type,
    }: {
      name: string;
      food_type: FoodType;
      is_meal: boolean;
      no_counter: boolean;
      storage_type: StorageType;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Utilisateur non connecté");

      const { error } = await (supabase as any)
        .from("food_library")
        .upsert(
          {
            user_id: user.id,
            name,
            food_type,
            is_meal,
            no_counter,
            storage_type,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,name" }
        );
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (err: Error) => {
      console.error("FoodLibrary upsert error:", err);
      // Silencieux — ne pas bloquer l'UX si l'upsert échoue
    },
  });

  return {
    library,
    isLoading,
    searchLibrary,
    upsertEntry,
  };
}
