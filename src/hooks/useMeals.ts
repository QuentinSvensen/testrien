import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { computeIngredientCalories, getTargetDate } from "@/lib/ingredientUtils";
import { getDisplayedPMCalories } from "@/lib/stockUtils";
import { toast } from "@/hooks/use-toast";
import { computePlannedCounterDate } from "@/hooks/useMealTransfers";
import { parseISO } from "date-fns";

export type MealCategory = 'petit_dejeuner' | 'entree' | 'plat' | 'dessert' | 'bonus';

export interface Meal {
  id: string;
  name: string;
  category: string;
  calories: string | null;
  protein: string | null;
  grams: string | null;
  ingredients: string | null;
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
  const invalidateMeals = () => qc.invalidateQueries({ queryKey: ["meals"] });
  const invalidatePM = () => qc.invalidateQueries({ queryKey: ["possible_meals"] });

  // Optimistic helpers for possible_meals
  const withPMOptimistic = (field: string) => ({
    onMutate: async (vars: { id: string;[key: string]: any }) => {
      await qc.cancelQueries({ queryKey: ["possible_meals"] });
      const prev = qc.getQueryData<PossibleMeal[]>(["possible_meals"]);
      qc.setQueryData<PossibleMeal[]>(["possible_meals"], old =>
        old?.map(pm => pm.id === vars.id ? { ...pm, [field]: vars[field] } : pm) ?? []
      );
      return { prev };
    },
    onError: (_err: Error, _vars: any, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["possible_meals"], ctx.prev);
      onMutationError(_err);
    },
    onSettled: invalidatePM,
  });

  // Optimistic update helpers
  const optimisticMealUpdate = (id: string, update: Partial<Meal>) => {
    qc.setQueryData<Meal[]>(["meals"], old => old?.map(m => m.id === id ? { ...m, ...update } : m) ?? []);
    qc.setQueryData<PossibleMeal[]>(["possible_meals"], old =>
      old?.map(pm => pm.meal_id === id ? { ...pm, meals: { ...pm.meals, ...update } as Meal } : pm) ?? []
    );
  };

  const withMealOptimistic = (field: string) => ({
    onMutate: async (vars: { id: string;[key: string]: any }) => {
      await qc.cancelQueries({ queryKey: ["meals"] });
      await qc.cancelQueries({ queryKey: ["possible_meals"] });
      const prevMeals = qc.getQueryData<Meal[]>(["meals"]);
      const prevPM = qc.getQueryData<PossibleMeal[]>(["possible_meals"]);
      optimisticMealUpdate(vars.id, { [field]: vars[field] });
      return { prevMeals, prevPM };
    },
    onError: (_err: Error, _vars: any, ctx: any) => {
      if (ctx?.prevMeals) qc.setQueryData(["meals"], ctx.prevMeals);
      if (ctx?.prevPM) qc.setQueryData(["possible_meals"], ctx.prevPM);
      onMutationError(_err);
    },
    onSettled: invalidateAll,
  });

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
    staleTime: 2 * 60 * 1000, // 2 min — avoid refetching on every mount
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
    staleTime: 2 * 60 * 1000,
    enabled,
  });

  const isLoading = ml || pl;

  // --- Master meal mutations ---

  const addMeal = useMutation({
    mutationFn: async ({ name, category }: { name: string; category: string }) => {
      const maxOrder = meals.filter(m => m.category === category).reduce((max, m) => Math.max(max, m.sort_order), -1);
      const { error } = await supabase
        .from("meals")
        .insert({ name, category, sort_order: maxOrder + 1, is_available: true });
      if (error) throw error;
    },
    onSuccess: invalidateMeals,
    onError: onMutationError,
  });

  const addMealToPossibleDirectly = useMutation({
    mutationFn: async ({ name, category, calories, protein, grams, ingredients, expiration_date, possible_quantity, counter_start_date }: { name: string; category: string; calories?: string | null; protein?: string | null; grams?: string | null; ingredients?: string | null; expiration_date?: string | null; possible_quantity?: number; counter_start_date?: string | null }) => {
      const { data: mealData, error: mealError } = await supabase
        .from("meals")
        .insert({
          name,
          category,
          sort_order: 0,
          is_available: false,
          ...(calories !== undefined ? { calories } : {}),
          ...(protein !== undefined ? { protein } : {}),
          ...(grams !== undefined ? { grams } : {}),
          ...(ingredients !== undefined ? { ingredients } : {}),
        })
        .select()
        .single();
      if (mealError) throw mealError;
      const maxOrder = possibleMeals.length;
      const normalizedQuantity = Math.max(1, Math.round(possible_quantity ?? 1));
      const { data: insertedPm, error } = await supabase
        .from("possible_meals")
        .insert({
          meal_id: mealData.id,
          sort_order: maxOrder,
          quantity: normalizedQuantity,
          ...(expiration_date ? { expiration_date } : {}),
          counter_start_date: counter_start_date ?? null,
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
    ...withMealOptimistic('name'),
  });

  const updateCalories = useMutation({
    mutationFn: async ({ id, calories }: { id: string; calories: string | null }) => {
      const { error } = await supabase.from("meals").update({ calories }).eq("id", id);
      if (error) throw error;
    },
    ...withMealOptimistic('calories'),
  });

  const updateGrams = useMutation({
    mutationFn: async ({ id, grams }: { id: string; grams: string | null }) => {
      const { error } = await supabase.from("meals").update({ grams }).eq("id", id);
      if (error) throw error;
    },
    ...withMealOptimistic('grams'),
  });

  const updateProtein = useMutation({
    mutationFn: async ({ id, protein }: { id: string; protein: string | null }) => {
      const { error } = await supabase.from("meals").update({ protein } as any).eq("id", id);
      if (error) throw error;
    },
    ...withMealOptimistic('protein'),
  });

  const updateIngredients = useMutation({
    mutationFn: async ({ id, ingredients }: { id: string; ingredients: string | null }) => {
      const { error } = await supabase.from("meals").update({ ingredients }).eq("id", id);
      if (error) throw error;
    },
    ...withMealOptimistic('ingredients'),
  });

  const updateOvenTemp = useMutation({
    mutationFn: async ({ id, oven_temp }: { id: string; oven_temp: string | null }) => {
      const { error } = await supabase.from("meals").update({ oven_temp }).eq("id", id);
      if (error) throw error;
    },
    ...withMealOptimistic('oven_temp'),
  });

  const updateOvenMinutes = useMutation({
    mutationFn: async ({ id, oven_minutes }: { id: string; oven_minutes: string | null }) => {
      const { error } = await supabase.from("meals").update({ oven_minutes }).eq("id", id);
      if (error) throw error;
    },
    ...withMealOptimistic('oven_minutes'),
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["meals"] });
      await qc.cancelQueries({ queryKey: ["possible_meals"] });
      const prevMeals = qc.getQueryData<Meal[]>(["meals"]);
      const prevPM = qc.getQueryData<PossibleMeal[]>(["possible_meals"]);
      qc.setQueryData<Meal[]>(["meals"], old => old?.filter(m => m.id !== id) ?? []);
      qc.setQueryData<PossibleMeal[]>(["possible_meals"], old => old?.filter(pm => pm.meal_id !== id) ?? []);
      return { prevMeals, prevPM };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevMeals) qc.setQueryData(["meals"], ctx.prevMeals);
      if (ctx?.prevPM) qc.setQueryData(["possible_meals"], ctx.prevPM);
      onMutationError(_err);
    },
    onSettled: invalidateAll,
  });

  const reorderMeals = useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      const { error } = await (supabase.rpc as any)('batch_reorder_meals', { items });
      if (error) {
        await Promise.all(items.map((item) =>
          supabase.from("meals").update({ sort_order: item.sort_order }).eq("id", item.id)
        ));
      }
    },
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: ["meals"] });
      const prev = qc.getQueryData<Meal[]>(["meals"]);
      const orderMap = new Map(items.map(i => [i.id, i.sort_order]));
      qc.setQueryData<Meal[]>(["meals"], old =>
        old?.map(m => orderMap.has(m.id) ? { ...m, sort_order: orderMap.get(m.id)! } : m) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["meals"], ctx.prev);
      onMutationError(_err);
    },
    onSettled: invalidateMeals,
  });

  // --- Possible meal mutations ---

  const moveToPossible = useMutation({
    mutationFn: async ({ mealId, expiration_date, counter_start_date }: { mealId: string; expiration_date?: string | null; counter_start_date?: string | null }) => {
      const maxOrder = possibleMeals.length;
      const insertData: Record<string, unknown> = { 
        meal_id: mealId, 
        sort_order: maxOrder,
        counter_start_date: counter_start_date ?? null
      };
      if (expiration_date) insertData.expiration_date = expiration_date;
      const { data, error } = await supabase
        .from("possible_meals")
        .insert(insertData as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as { id: string };
    },
    onSuccess: invalidatePM,
    onError: onMutationError,
  });

  const splitPossibleMealQuantity = useMutation({
    mutationFn: async ({ id, ratio, baseIngredients }: { id: string; ratio: number; baseIngredients: string | null }) => {
      const pm = possibleMeals.find(p => p.id === id);
      if (!pm) throw new Error("Possible meal not found");

      const { error: updateError } = await supabase
        .from("possible_meals")
        .update({ ingredients_override: baseIngredients })
        .eq("id", id);
      if (updateError) throw updateError;

      const copiesToInsert = [];
      for (let i = 1; i < ratio; i++) {
        copiesToInsert.push({
          meal_id: pm.meal_id,
          sort_order: possibleMeals.length + i, // Append at the end
          expiration_date: pm.expiration_date,
          counter_start_date: pm.counter_start_date,
          ingredients_override: baseIngredients,
          quantity: pm.quantity,
          day_of_week: pm.day_of_week,
          meal_time: pm.meal_time,
        });
      }

      if (copiesToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from("possible_meals")
          .insert(copiesToInsert);
        if (insertError) throw insertError;
      }
    },
    onSuccess: invalidatePM,
    onError: onMutationError,
  });

  const duplicatePossibleMeal = useMutation({
    mutationFn: async (sourcePmId: string): Promise<string | undefined> => {
      const source = possibleMeals.find(pm => pm.id === sourcePmId);
      if (!source) return undefined;
      const maxOrder = possibleMeals.length;
      const { data, error } = await supabase
        .from("possible_meals")
        .insert({
          meal_id: source.meal_id,
          sort_order: maxOrder,
          expiration_date: source.expiration_date,
          counter_start_date: source.counter_start_date,
          ingredients_override: source.ingredients_override,
          quantity: source.quantity,
          day_of_week: source.day_of_week,
          meal_time: source.meal_time,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data?.id;
    },
    onSuccess: invalidatePM,
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
    onMutate: async (possibleMealId) => {
      await qc.cancelQueries({ queryKey: ["possible_meals"] });
      const prev = qc.getQueryData<PossibleMeal[]>(["possible_meals"]);
      qc.setQueryData<PossibleMeal[]>(["possible_meals"], old => old?.filter(pm => pm.id !== possibleMealId) ?? []);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["possible_meals"], ctx.prev);
      onMutationError(_err);
    },
    onSettled: invalidateAll, // May also delete orphan meal
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
    onMutate: async ({ id, expiration_date }) => {
      await qc.cancelQueries({ queryKey: ["possible_meals"] });
      const prev = qc.getQueryData<PossibleMeal[]>(["possible_meals"]);
      const pm = prev?.find(p => p.id === id);
      if (pm) {
        qc.setQueryData<PossibleMeal[]>(["possible_meals"], old =>
          old?.map(p => p.meal_id === pm.meal_id ? { ...p, expiration_date } : p) ?? []
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["possible_meals"], ctx.prev);
      onMutationError(_err);
    },
    onSettled: invalidatePM,
  });

  const updatePlanning = useMutation({
    mutationFn: async ({ id, day_of_week, meal_time }: { id: string; day_of_week: string | null; meal_time: string | null }) => {
      const pm = possibleMeals.find(p => p.id === id);
      const existing = pm?.counter_start_date;
      
      let counter_start_date = existing || null;
      
      if (day_of_week) {
        // If it's a fresh meal (no existing counter), program it for the planning date.
        // If it already had a counter (running), we KEEP it (age calculated relative to target).
        if (!existing) {
          counter_start_date = computePlannedCounterDate(day_of_week, meal_time);
        }
      } else {
        // Unplanning: if it was a future-scheduled one (not started yet), 
        // start it NOW since it's back in "Possible"
        if (existing && new Date(existing) > new Date()) {
          counter_start_date = new Date().toISOString();
        }
      }

      const { error } = await supabase
        .from("possible_meals")
        .update({ day_of_week, meal_time, counter_start_date })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, day_of_week, meal_time }) => {
      await qc.cancelQueries({ queryKey: ["possible_meals"] });
      const prev = qc.getQueryData<PossibleMeal[]>(["possible_meals"]);
      const pm = prev?.find(p => p.id === id);
      const existing = pm?.counter_start_date;
      
      let counter_start_date = existing || null;
      if (day_of_week) {
        if (!existing) {
          const target = getTargetDate(day_of_week, new Date(), null, meal_time);
          counter_start_date = target.toISOString();
        }
      } else {
        if (existing && new Date(existing) > new Date()) {
          counter_start_date = new Date().toISOString();
        }
      }

      qc.setQueryData<PossibleMeal[]>(["possible_meals"], old =>
        old?.map(p => p.id === id ? { ...p, day_of_week, meal_time, counter_start_date } : p) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["possible_meals"], ctx.prev);
      onMutationError(_err);
    },
    onSettled: invalidatePM,
  });

  const updateCounter = useMutation({
    mutationFn: async ({ id, counter_start_date }: { id: string; counter_start_date: string | null }) => {
      const { error } = await supabase
        .from("possible_meals")
        .update({ counter_start_date })
        .eq("id", id);
      if (error) throw error;
    },
    ...withPMOptimistic('counter_start_date'),
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["possible_meals"] });
      const prev = qc.getQueryData<PossibleMeal[]>(["possible_meals"]);
      qc.setQueryData<PossibleMeal[]>(["possible_meals"], old => old?.filter(pm => pm.id !== id) ?? []);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["possible_meals"], ctx.prev);
      onMutationError(_err);
    },
    onSettled: invalidateAll, // May also delete orphan meal
  });

  const reorderPossibleMeals = useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      const { error } = await (supabase.rpc as any)('batch_reorder_possible_meals', { items });
      if (error) {
        await Promise.all(items.map((item) =>
          supabase.from("possible_meals").update({ sort_order: item.sort_order }).eq("id", item.id)
        ));
      }
    },
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: ["possible_meals"] });
      const prev = qc.getQueryData<PossibleMeal[]>(["possible_meals"]);
      const orderMap = new Map(items.map(i => [i.id, i.sort_order]));
      qc.setQueryData<PossibleMeal[]>(["possible_meals"], old =>
        old?.map(pm => orderMap.has(pm.id) ? { ...pm, sort_order: orderMap.get(pm.id)! } : pm) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["possible_meals"], ctx.prev);
      onMutationError(_err);
    },
    onSettled: invalidatePM,
  });

  const updatePossibleIngredients = useMutation({
    mutationFn: async ({ id, ingredients_override }: { id: string; ingredients_override: string | null }) => {
      const { error } = await supabase
        .from("possible_meals")
        .update({ ingredients_override })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, ingredients_override }) => {
      await qc.cancelQueries({ queryKey: ["possible_meals"] });
      const prev = qc.getQueryData<PossibleMeal[]>(["possible_meals"]);
      qc.setQueryData<PossibleMeal[]>(["possible_meals"], old =>
        old?.map(pm => pm.id === id ? { ...pm, ingredients_override } : pm) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["possible_meals"], ctx.prev);
      onMutationError(_err);
    },
    onSettled: invalidatePM,
  });

  const updatePossibleQuantity = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      const { error } = await supabase
        .from("possible_meals")
        .update({ quantity: Math.max(1, Math.round(quantity)) })
        .eq("id", id);
      if (error) throw error;
    },
    ...withPMOptimistic('quantity'),
  });

  const getMealsByCategory = (cat: string) =>
    meals.filter((m) => m.category === cat && m.is_available).sort((a, b) => a.sort_order - b.sort_order);

  const getPossibleByCategory = (cat: string) =>
    possibleMeals.filter((pm) => pm.meals?.category === cat).sort((a, b) => a.sort_order - b.sort_order);

  const extractSortableCalories = (pm: PossibleMeal): number | null => {
    return getDisplayedPMCalories(pm);
  };

  const sortByExpiration = (items: PossibleMeal[]) => {
    const fixedNow = new Date();
    return [...items].sort((a, b) => {
      const getStableCounter = (pm: PossibleMeal) => {
        if (!pm.counter_start_date) return null;
        const start = parseISO(pm.counter_start_date);
        
        // Match the logic in ingredientUtils.getAdaptedCounterDays
        if (start.getTime() > fixedNow.getTime()) return null;
        
        const target = getTargetDate(pm.day_of_week, fixedNow, pm.counter_start_date, pm.meal_time);
        const diffMs = target.getTime() - start.getTime();
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        return Math.max(0, days);
      };

      const rawAC = getStableCounter(a);
      const rawBC = getStableCounter(b);
      
      // RULE: counter < 1.0j is strictly seen as "null" (no counter) for the sort group.
      const ac = (rawAC !== null && rawAC >= 1) ? rawAC : null;
      const bc = (rawBC !== null && rawBC >= 1) ? rawBC : null;

      const aHasDate = !!a.expiration_date;
      const bHasDate = !!b.expiration_date;
      const aHasC = ac !== null;
      const bHasC = bc !== null;

      const aG = aHasC ? 0 : aHasDate ? 1 : 2;
      const bG = bHasC ? 0 : bHasDate ? 1 : 2;

      if (aG !== bG) return aG - bG;

      if (aG === 0) {
        if (ac !== bc) return bc! - ac!;
        if (aHasDate && bHasDate) return a.expiration_date!.localeCompare(b.expiration_date!);
        if (aHasDate) return -1;
        if (bHasDate) return 1;
      } else if (aG === 1) {
        const dateCmp = a.expiration_date!.localeCompare(b.expiration_date!);
        if (dateCmp !== 0) return dateCmp;
      }

      // Tie-breakers: calories then name
      const aCal = extractSortableCalories(a);
      const bCal = extractSortableCalories(b);
      if (aCal !== null && bCal !== null && aCal !== bCal) return aCal - bCal;
      if (aCal !== null && bCal === null) return -1;
      if (aCal === null && bCal !== null) return 1;

      return (a.sort_order - b.sort_order) || (a.meals?.name ?? '').localeCompare(b.meals?.name ?? '');
    });
  };

  const sortByPlanning = (items: PossibleMeal[]) => {
    const fixedNow = new Date();
    return [...items].sort((a, b) => {
      const aHasPlan = !!a.day_of_week;
      const bHasPlan = !!b.day_of_week;

      if (aHasPlan || bHasPlan) {
        if (aHasPlan && bHasPlan) {
          const dateA = getTargetDate(a.day_of_week, fixedNow, a.counter_start_date, a.meal_time);
          const dateB = getTargetDate(b.day_of_week, fixedNow, b.counter_start_date, b.meal_time);
          if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime();
        } else if (aHasPlan) {
          return -1;
        } else if (bHasPlan) {
          return 1;
        }
      } else {
        const dateA = getTargetDate(null, fixedNow, null, a.meal_time);
        const dateB = getTargetDate(null, fixedNow, null, b.meal_time);
        if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime();
      }

      return (a.sort_order - b.sort_order) || (a.meals?.name ?? '').localeCompare(b.meals?.name ?? '');
    });
  };

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
    moveToPossible, duplicatePossibleMeal, splitPossibleMealQuantity, removeFromPossible,
    updateExpiration, updatePlanning, updateCounter,
    deletePossibleMeal, reorderPossibleMeals, updatePossibleIngredients, updatePossibleQuantity,
    getMealsByCategory, getPossibleByCategory, sortByExpiration, sortByPlanning, getRandomPossible,
  };
}
