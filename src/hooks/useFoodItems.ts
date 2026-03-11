import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export type StorageType = "frigo" | "sec" | "surgele" | "toujours";
export type FoodType = "feculent" | "viande" | null;

export interface FoodItem {
  id: string;
  name: string;
  grams: string | null;
  calories: string | null;
  protein: string | null;
  expiration_date: string | null;
  counter_start_date: string | null;
  sort_order: number;
  created_at: string;
  is_meal: boolean;
  is_infinite: boolean;
  is_dry: boolean;
  is_indivisible: boolean;
  storage_type: StorageType;
  quantity: number | null;
  food_type: FoodType;
}

const onMutationError = (error: Error) => {
  toast({ title: "Erreur", description: error.message, variant: "destructive" });
};

export function useFoodItems(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const qc = useQueryClient();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["food_items"] });

  useEffect(() => {
    if (!enabled) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        qc.invalidateQueries({ queryKey: ["food_items"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [qc, enabled]);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["food_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_items")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data as any[]).map((d) => ({
        ...d,
        is_meal: d.is_meal ?? false,
        is_infinite: d.is_infinite ?? false,
        is_dry: d.is_dry ?? false,
        is_indivisible: d.is_indivisible ?? false,
        storage_type: d.storage_type ?? (d.is_dry ? "sec" : "frigo"),
        quantity: d.quantity ?? null,
        food_type: d.food_type ?? null,
        protein: d.protein ?? null,
      })) as FoodItem[];
    },
    retry: 3,
    retryDelay: 500,
    enabled,
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("food_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: onMutationError,
  });

  return { items, isLoading, deleteItem };
}
