import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { colorFromName } from "@/lib/foodColors";
import { computeIngredientCalories } from "@/lib/ingredientUtils";
import { toast } from "@/hooks/use-toast";

export type MealCategory = 'petit_dejeuner' | 'entree' | 'plat' | 'dessert' | 'bonus';

export interface Meal {
  id: string;
  name: string;
  category: string;
  calories: string | null;
  protein: string | null;
  grams: string | null;
  ingredients: string | null;
  color: string;
  sort_order: number;
  created_at: string;
  is_available: boolean;
  is_favorite: boolean;
  oven_temp: string | null;
  oven_minutes: string | null;
}

export interface PossibleMeal {
  id: string;
  meal_id: string;
  quantity: number;
  expiration_date: string | null;
  day_of_week: string | null;
  meal_time: string | null;
  counter_start_date: string | null;
  sort_order: number;
  created_at: string;
  meals: Meal;
  ingredients_override: string | null;
}

export const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
export const TIMES = ['midi', 'soir'] as const;

const DAY_INDEX: Record<string, number> = {};
DAYS.forEach((d, i) => { DAY_INDEX[d] = i; });

const onMutationError = (error: Error) => {
  toast({ title: "Erreur", description: error.message, variant: "destructive" });
};

export function useMeals(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const qc = useQueryClient();
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["meals"] });
    qc.invalidateQueries({ queryKey: ["possible_meals"] });
  };

  useEffect(() => {
    if (!enabled) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        qc.invalidateQueries({ queryKey: ["meals"] });
        qc.invalidateQueries({ queryKey: ["possible_meals"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [qc, enabled]);

  const { data: meals = [], isLoading: ml } = useQuery({
    queryKey: ["meals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meals")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as Meal[];
    },
    retry: 3,
    retryDelay: 500,
    enabled,
  });

  const { data: possibleMeals = [], isLoading: pl } = useQuery({
    queryKey: ["possible_meals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("possible_meals")
        .select("*, meals(*)")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as unknown as PossibleMeal[];
    },
    retry: 3,
    retryDelay: 500,
    enabled,
  });

  const isLoading = ml || pl;

  // --- Master meal mutations ---

  const addMeal = useMutation({
    mutationFn: async ({ name, category }: { name: string; category: string }) => {
      const maxOrder = meals.filter(m => m.category === category).reduce((max, m) => Math.max(max, m.sort_order), -1);
      const { data: inserted, error: insertErr } = await supabase
        .from("meals")
        .insert({ name, category, color: colorFromName(name), sort_order: maxOrder + 1, is_available: true })
        .select()
        .single();
      if (insertErr) throw insertErr;
      const { error } = await supabase.from("meals").update({ color: colorFromName(inserted.id) }).eq("id", inserted.id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const addMealToPossibleDirectly = useMutation({
    mutationFn: async ({ name, category, colorSeed, calories, grams, ingredients, expiration_date, possible_quantity, counter_start_date }: { name: string; category: string; colorSeed?: string; calories?: string | null; grams?: string | null; ingredients?: string | null; expiration_date?: string | null; possible_quantity?: number; counter_start_date?: string | null }) => {
      const finalColor = colorFromName(colorSeed ?? name);
      const { data: mealData, error: mealError } = await supabase
        .from("meals")
        .insert({
          name,
          category,
          color: finalColor,
          sort_order: 0,
          is_available: false,
          ...(calories !== undefined ? { calories } : {}),
          ...(grams !== undefined ? { grams } : {}),
          ...(ingredients !== undefined ? { ingredients } : {}),
        })
        .select()
        .single();
      if (mealError) throw mealError;
      // Update color with final seed (id-based) if no colorSeed was provided
      if (!colorSeed) {
        await supabase.from("meals").update({ color: colorFromName(mealData.id) }).eq("id", mealData.id);
      }
      const maxOrder = possibleMeals.length;
      const normalizedQuantity = Math.max(1, Math.round(possible_quantity ?? 1));
      const { data: insertedPm, error } = await supabase
        .from("possible_meals")
        .insert({
          meal_id: mealData.id,
          sort_order: maxOrder,
          quantity: normalizedQuantity,
          ...(expiration_date ? { expiration_date } : {}),
          ...(counter_start_date ? { counter_start_date } : {}),
        })
        .select()
        .single();
      if (error) throw error;
      return insertedPm as { id: string };
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const renameMeal = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("meals").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const updateCalories = useMutation({
    mutationFn: async ({ id, calories }: { id: string; calories: string | null }) => {
      const { error } = await supabase.from("meals").update({ calories }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const updateGrams = useMutation({
    mutationFn: async ({ id, grams }: { id: string; grams: string | null }) => {
      const { error } = await supabase.from("meals").update({ grams }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const updateProtein = useMutation({
    mutationFn: async ({ id, protein }: { id: string; protein: string | null }) => {
      const { error } = await supabase.from("meals").update({ protein } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const updateIngredients = useMutation({
    mutationFn: async ({ id, ingredients }: { id: string; ingredients: string | null }) => {
      const { error } = await supabase.from("meals").update({ ingredients }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const updateOvenTemp = useMutation({
    mutationFn: async ({ id, oven_temp }: { id: string; oven_temp: string | null }) => {
      const { error } = await supabase.from("meals").update({ oven_temp }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const updateOvenMinutes = useMutation({
    mutationFn: async ({ id, oven_minutes }: { id: string; oven_minutes: string | null }) => {
      const { error } = await supabase.from("meals").update({ oven_minutes }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const toggleFavorite = useMutation({
    mutationFn: async ({ id, is_favorite }: { id: string; is_favorite: boolean }) => {
      const { error } = await supabase.from("meals").update({ is_favorite }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, is_favorite }) => {
      await qc.cancelQueries({ queryKey: ["meals"] });
      const prev = qc.getQueryData<Meal[]>(["meals"]);
      qc.setQueryData<Meal[]>(["meals"], old =>
        old?.map(m => m.id === id ? { ...m, is_favorite } : m) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["meals"], ctx.prev);
      onMutationError(_err);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["meals"] }),
  });

  const deleteMeal = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("meals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const reorderMeals = useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      await Promise.all(items.map((item) =>
        supabase.from("meals").update({ sort_order: item.sort_order }).eq("id", item.id)
      ));
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  // --- Possible meal mutations ---

  const moveToPossible = useMutation({
    mutationFn: async ({ mealId, expiration_date, counter_start_date }: { mealId: string; expiration_date?: string | null; counter_start_date?: string | null }) => {
      const maxOrder = possibleMeals.length;
      const insertData: Record<string, unknown> = { meal_id: mealId, sort_order: maxOrder };
      if (expiration_date) insertData.expiration_date = expiration_date;
      if (counter_start_date) insertData.counter_start_date = counter_start_date;
      const { data, error } = await supabase
        .from("possible_meals")
        .insert(insertData as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as { id: string };
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const duplicatePossibleMeal = useMutation({
    mutationFn: async (sourcePmId: string) => {
      const source = possibleMeals.find(pm => pm.id === sourcePmId);
      if (!source) return;
      const maxOrder = possibleMeals.length;
      const { error } = await supabase
        .from("possible_meals")
        .insert({
          meal_id: source.meal_id,
          sort_order: maxOrder,
          expiration_date: source.expiration_date,
          counter_start_date: source.counter_start_date,
        });
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const removeFromPossible = useMutation({
    mutationFn: async (possibleMealId: string) => {
      const pm = possibleMeals.find(p => p.id === possibleMealId);
      const { error } = await supabase
        .from("possible_meals")
        .delete()
        .eq("id", possibleMealId);
      if (error) throw error;
      if (pm && !pm.meals?.is_available) {
        const otherRefs = possibleMeals.filter(p => p.meal_id === pm.meal_id && p.id !== possibleMealId);
        if (otherRefs.length === 0) {
          await supabase.from("meals").delete().eq("id", pm.meal_id);
        }
      }
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const updateExpiration = useMutation({
    mutationFn: async ({ id, expiration_date }: { id: string; expiration_date: string | null }) => {
      const pm = possibleMeals.find(p => p.id === id);
      if (!pm) return;
      const { error } = await supabase
        .from("possible_meals")
        .update({ expiration_date })
        .eq("meal_id", pm.meal_id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const updatePlanning = useMutation({
    mutationFn: async ({ id, day_of_week, meal_time }: { id: string; day_of_week: string | null; meal_time: string | null }) => {
      const { error } = await supabase
        .from("possible_meals")
        .update({ day_of_week, meal_time })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const updateCounter = useMutation({
    mutationFn: async ({ id, counter_start_date }: { id: string; counter_start_date: string | null }) => {
      const { error } = await supabase
        .from("possible_meals")
        .update({ counter_start_date })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const deletePossibleMeal = useMutation({
    mutationFn: async (id: string) => {
      const pm = possibleMeals.find(p => p.id === id);
      const { error } = await supabase.from("possible_meals").delete().eq("id", id);
      if (error) throw error;
      if (pm && !pm.meals?.is_available) {
        const otherRefs = possibleMeals.filter(p => p.meal_id === pm.meal_id && p.id !== id);
        if (otherRefs.length === 0) {
          await supabase.from("meals").delete().eq("id", pm.meal_id);
        }
      }
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const reorderPossibleMeals = useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      await Promise.all(items.map((item) =>
        supabase.from("possible_meals").update({ sort_order: item.sort_order }).eq("id", item.id)
      ));
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const updatePossibleIngredients = useMutation({
    mutationFn: async ({ id, ingredients_override }: { id: string; ingredients_override: string | null }) => {
      const { error } = await supabase
        .from("possible_meals")
        .update({ ingredients_override })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const updatePossibleQuantity = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      const { error } = await supabase
        .from("possible_meals")
        .update({ quantity: Math.max(1, Math.round(quantity)) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
    onError: onMutationError,
  });

  const getMealsByCategory = (cat: string) =>
    meals.filter((m) => m.category === cat && m.is_available).sort((a, b) => a.sort_order - b.sort_order);

  const getPossibleByCategory = (cat: string) =>
    possibleMeals.filter((pm) => pm.meals?.category === cat).sort((a, b) => a.sort_order - b.sort_order);

  const extractSortableCalories = (pm: PossibleMeal): number | null => {
    const ingredients = pm.ingredients_override ?? pm.meals?.ingredients;
    const ingCal = computeIngredientCalories(ingredients);
    if (ingCal !== null && Number.isFinite(ingCal)) return ingCal;

    const raw = pm.meals?.calories;
    if (!raw) return null;

    const match = raw.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;

    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const sortByExpiration = (items: PossibleMeal[]) =>
    [...items].sort((a, b) => {
      const aCounter = a.counter_start_date ? Math.floor((Date.now() - new Date(a.counter_start_date).getTime()) / 86400000) : null;
      const bCounter = b.counter_start_date ? Math.floor((Date.now() - new Date(b.counter_start_date).getTime()) / 86400000) : null;
      const aHasDate = !!a.expiration_date;
      const bHasDate = !!b.expiration_date;
      const aHasCounter = aCounter !== null;
      const bHasCounter = bCounter !== null;

      const aGroup = aHasCounter ? 0 : aHasDate ? 1 : 2;
      const bGroup = bHasCounter ? 0 : bHasDate ? 1 : 2;

      if (aGroup !== bGroup) return aGroup - bGroup;

      if (aGroup === 0) {
        if (aCounter !== bCounter) return bCounter! - aCounter!;

        // Same counter days (non-zero): sort by expiration date first
        if (aCounter !== 0) {
          if (aHasDate && bHasDate) {
            const dateCmp = a.expiration_date!.localeCompare(b.expiration_date!);
            if (dateCmp !== 0) return dateCmp;
          }
          if (aHasDate && !bHasDate) return -1;
          if (!aHasDate && bHasDate) return 1;
        }

        // Same counter + same date (or counter=0): sort by calories ascending
        const aCal = extractSortableCalories(a);
        const bCal = extractSortableCalories(b);
        if (aCal !== null && bCal !== null && aCal !== bCal) return aCal - bCal;
        if (aCal !== null && bCal === null) return -1;
        if (aCal === null && bCal !== null) return 1;

        // Fallback for counter=0: date then name
        if (aHasDate && bHasDate) return a.expiration_date!.localeCompare(b.expiration_date!);
        if (aHasDate) return -1;
        if (bHasDate) return 1;

        return (a.meals?.name ?? '').localeCompare(b.meals?.name ?? '');
      }

      if (aGroup === 1) {
        const dateCmp = a.expiration_date!.localeCompare(b.expiration_date!);
        if (dateCmp !== 0) return dateCmp;
        // Same date without counter: sort by calories ascending
        const aCal = extractSortableCalories(a);
        const bCal = extractSortableCalories(b);
        if (aCal !== null && bCal !== null && aCal !== bCal) return aCal - bCal;
        if (aCal !== null && bCal === null) return -1;
        if (aCal === null && bCal !== null) return 1;
        return (a.meals?.name ?? '').localeCompare(b.meals?.name ?? '');
      }

      return 0;
    });

  const sortByPlanning = (items: PossibleMeal[]) =>
    [...items].sort((a, b) => {
      const dayA = a.day_of_week ? (DAY_INDEX[a.day_of_week] ?? 99) : 99;
      const dayB = b.day_of_week ? (DAY_INDEX[b.day_of_week] ?? 99) : 99;
      if (dayA !== dayB) return dayA - dayB;
      const timeA = a.meal_time === 'midi' ? 0 : a.meal_time === 'soir' ? 1 : 2;
      const timeB = b.meal_time === 'midi' ? 0 : b.meal_time === 'soir' ? 1 : 2;
      return timeA - timeB;
    });

  const getRandomPossible = (cat: string): PossibleMeal | null => {
    const items = getPossibleByCategory(cat);
    if (items.length === 0) return null;
    return items[Math.floor(Math.random() * items.length)];
  };

  return {
    meals, possibleMeals, isLoading,
    addMeal, addMealToPossibleDirectly, renameMeal, updateCalories, updateGrams, updateProtein, updateIngredients,
    updateOvenTemp, updateOvenMinutes,
    toggleFavorite, deleteMeal, reorderMeals,
    moveToPossible, duplicatePossibleMeal, removeFromPossible,
    updateExpiration, updatePlanning, updateCounter,
    deletePossibleMeal, reorderPossibleMeals, updatePossibleIngredients, updatePossibleQuantity,
    getMealsByCategory, getPossibleByCategory, sortByExpiration, sortByPlanning, getRandomPossible,
  };
}
