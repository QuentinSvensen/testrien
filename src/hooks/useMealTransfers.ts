import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/components/FoodItems";
import { format, parseISO } from "date-fns";
import {
  normalizeForMatch, strictNameMatch,
  parseQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientGroups,
} from "@/lib/ingredientUtils";
import {
  buildStockMap, findStockKey, pickBestAlternative,
  sortStockDeductionPriority,
} from "@/lib/stockUtils";

const DAY_KEY_TO_INDEX: Record<string, number> = {
  lundi: 0, mardi: 1, mercredi: 2, jeudi: 3, vendredi: 4, samedi: 5, dimanche: 6,
};

/** Compute the ISO date string for a planned meal day+time (12h for midi, 19h for soir) */
export function computePlannedCounterDate(dayOfWeek: string, mealTime: string | null): string {
  // If dayOfWeek is already a date (YYYY-MM-DD), use it directly
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayOfWeek)) {
    const d = parseISO(dayOfWeek);
    d.setHours(mealTime === "soir" ? 19 : 12, 0, 0, 0);
    return d.toISOString();
  }

  const today = new Date();
  const todayDow = today.getDay(); // 0=Sun
  const todayIdx = todayDow === 0 ? 6 : todayDow - 1; // 0=Mon
  const targetIdx = DAY_KEY_TO_INDEX[dayOfWeek] ?? 0;

  const diff = targetIdx - todayIdx;

  const d = new Date(today);
  d.setDate(d.getDate() + diff);
  d.setHours(mealTime === "soir" ? 19 : 12, 0, 0, 0);
  return d.toISOString();
}

/**
 * Centralised stock-transfer logic extracted from Index.tsx.
 * Every Supabase call is wrapped in try/catch with a destructive toast on failure.
 */
export function useMealTransfers(foodItems: FoodItem[]) {
  const qc = useQueryClient();

  const invalidateStock = () => qc.invalidateQueries({ queryKey: ["food_items"] });

  /** Safely run a supabase mutation, catching network errors */
  const safeMutate = async (label: string, fn: () => any): Promise<any> => {
    try {
      const res = await fn();
      // Throw if it's a single response with an error
      if (res && res.error) throw new Error(res.error.message);
      // Throw if it's an array of responses containing an error
      if (Array.isArray(res)) {
        const err = res.find(r => r?.error);
        if (err) throw new Error(err.error.message);
      }
      return res;
    } catch (err: any) {
      console.error(`${label} Error:`, err);
      toast({ title: "Erreur réseau", description: `${label} : ${err?.message ?? "erreur inconnue"}`, variant: "destructive" });
      return null;
    }
  };

  /** Deduct ingredients from stock when moving to Possible. Returns snapshots of old state + IDs of items fully deleted. */
  const deductIngredientsFromStock = async (meal: Meal, forcedCounterDate?: string): Promise<{ snapshots: FoodItem[]; consumedIds: string[]; oldestCounter: string | null }> => {
    if (!meal.ingredients?.trim()) return { snapshots: [], consumedIds: [], oldestCounter: null };
    const groups = parseIngredientGroups(meal.ingredients);
    const stockMap = buildStockMap(foodItems);
    const snapshotsById = new Map<string, FoodItem>();
    const updatesById = new Map<string, { id: string; grams?: string | null; quantity?: number | null; delete?: boolean; counter_start_date?: string | null }>();
    const rememberSnapshot = (fi: FoodItem) => { if (!snapshotsById.has(fi.id)) snapshotsById.set(fi.id, { ...fi }); };
    let oldestCounter: string | null = null;

    for (const group of groups) {
      if (group.every(alt => alt.optional)) continue;
      const alt = pickBestAlternative(group, stockMap);
      if (!alt) continue;
      const { qty: neededGrams, count: neededCount, name } = alt;
      const key = findStockKey(stockMap, name);
      if (!key) continue;
      const stockInfo = stockMap.get(key);
      if (!stockInfo || stockInfo.infinite) continue;

      const matchingItems = foodItems
        .filter((fi) => strictNameMatch(fi.name, name) && !fi.is_infinite)
        .sort(sortStockDeductionPriority);

      if (neededCount > 0) {
        let toDeduct = neededCount;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const fiCount = fi.quantity ?? 1;
          const deduct = Math.min(fiCount, toDeduct);
          const remaining = fiCount - deduct;
          toDeduct -= deduct;
          rememberSnapshot(fi);

          const counterToSet = forcedCounterDate || new Date().toISOString();
          const shouldStart = fi.storage_type !== 'surgele' && !fi.no_counter;

          // Track oldest counter only if it's already running (not in the future)
          if (fi.counter_start_date && new Date(fi.counter_start_date) <= new Date(counterToSet)) {
            if (!oldestCounter || new Date(fi.counter_start_date) < new Date(oldestCounter)) {
              oldestCounter = fi.counter_start_date;
            }
          }

          const isFuture = fi.counter_start_date && new Date(fi.counter_start_date) > new Date(counterToSet);
          const needsCounterUpdate = shouldStart && (!fi.counter_start_date || isFuture || forcedCounterDate);

          if (remaining <= 0) {
            updatesById.set(fi.id, { id: fi.id, delete: true });
          } else {
            updatesById.set(fi.id, { 
              id: fi.id, 
              quantity: Math.ceil(remaining),
              ...(needsCounterUpdate ? { counter_start_date: counterToSet } : {})
            });
          }
        }
      } else if (neededGrams > 0) {
        let toDeduct = neededGrams;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const perUnit = parseQty(fi.grams);
          if (perUnit <= 0) continue;
          const totalAvailable = getFoodItemTotalGrams(fi);
          const deduct = Math.min(totalAvailable, toDeduct);
          const remaining = totalAvailable - deduct;
          toDeduct -= deduct;
          rememberSnapshot(fi);

          const counterToSet = forcedCounterDate || new Date().toISOString();
          const shouldStart = fi.storage_type !== 'surgele' && !fi.no_counter;

          // Track oldest counter only if it's already running (not in the future)
          if (fi.counter_start_date && new Date(fi.counter_start_date) <= new Date(counterToSet)) {
            if (!oldestCounter || new Date(fi.counter_start_date) < new Date(oldestCounter)) {
              oldestCounter = fi.counter_start_date;
            }
          }

          const isFuture = fi.counter_start_date && new Date(fi.counter_start_date) > new Date(counterToSet);
          const needsCounterUpdate = shouldStart && (!fi.counter_start_date || isFuture || forcedCounterDate);

          if (remaining <= 0) { updatesById.set(fi.id, { id: fi.id, delete: true }); continue; }

          if (fi.quantity && fi.quantity >= 1) {
            const fullUnits = Math.floor(remaining / perUnit);
            const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
            if (remainder > 0) {
              // Opening a new unit (remainder > 0): always reset counter if applicable
              updatesById.set(fi.id, { 
                id: fi.id, 
                quantity: Math.max(1, fullUnits + 1), 
                grams: encodeStoredGrams(perUnit, remainder), 
                ...(needsCounterUpdate ? { counter_start_date: counterToSet } : {}) 
              });
            } else if (fullUnits > 0) {
              updatesById.set(fi.id, { id: fi.id, quantity: fullUnits, grams: formatNumeric(perUnit), ...(fi.counter_start_date ? { counter_start_date: null } : {}) });
            } else { updatesById.set(fi.id, { id: fi.id, delete: true }); }
          } else {
            // Opening a new unit logic for items without quantity: if remaining < perUnit, it means we started it
            const isNewUnit = remaining > 0 && remaining < perUnit;
            updatesById.set(fi.id, { 
              id: fi.id, 
              grams: formatNumeric(remaining), 
              ...((needsCounterUpdate && isNewUnit) ? { counter_start_date: counterToSet } : {}) 
            });
          }
        }
      }
    }

    await safeMutate("Déduction du stock", () =>
      Promise.all(Array.from(updatesById.values()).map((u) =>
        u.delete
          ? supabase.from("food_items").delete().eq("id", u.id)
          : supabase.from("food_items").update({
            ...(u.grams !== undefined ? { grams: u.grams } : {}),
            ...(u.quantity !== undefined ? { quantity: u.quantity } : {}),
            ...(u.counter_start_date !== undefined ? { counter_start_date: u.counter_start_date } : {}),
          } as any).eq("id", u.id)
      ))
    );
    invalidateStock();
    return {
      snapshots: Array.from(snapshotsById.values()),
      consumedIds: Array.from(updatesById.values()).filter(u => u.delete).map(u => u.id),
      oldestCounter
    };
  };

  /** Restore ingredients to stock (from snapshots or by re-adding) */
  const restoreIngredientsToStock = async (meal: Meal, snapshots?: FoodItem[]) => {
    if (snapshots && snapshots.length > 0) {
      await safeMutate("Restauration du stock", () =>
        Promise.all(snapshots.map((fi) =>
          (supabase as any).from("food_items").upsert({
            id: fi.id, name: fi.name, grams: fi.grams, calories: fi.calories,
            protein: fi.protein, is_indivisible: fi.is_indivisible,
            expiration_date: fi.expiration_date, counter_start_date: fi.counter_start_date,
            sort_order: fi.sort_order, created_at: fi.created_at, is_meal: fi.is_meal,
            is_infinite: fi.is_infinite, is_dry: fi.is_dry, storage_type: fi.storage_type,
            quantity: fi.quantity, food_type: fi.food_type,
          })
        ))
      );
      invalidateStock();
      return;
    }

    if (!meal.ingredients?.trim()) return;
    const groups = parseIngredientGroups(meal.ingredients);
    for (const group of groups) {
      const liveStockMap = buildStockMap(foodItems);
      const alt = pickBestAlternative(group, liveStockMap) || group[0];
      if (!alt) continue;
      const { qty: neededGrams, count: neededCount, name } = alt;
      const matchingItems = foodItems.filter((fi) => strictNameMatch(fi.name, name) && !fi.is_infinite).sort(sortStockDeductionPriority);
      if (matchingItems.length === 0) continue;
      const fi = matchingItems[0];
      if (neededCount > 0) {
        const newQty = (fi.quantity ?? 1) + neededCount;
        await safeMutate("Restauration stock (count)", () =>
          supabase.from("food_items").update({ quantity: Math.ceil(newQty) } as any).eq("id", fi.id)
        );
      } else if (neededGrams > 0) {
        const fiGrams = parseQty(fi.grams);
        if (fi.quantity && fi.quantity >= 1 && fiGrams > 0) {
          const currentTotal = getFoodItemTotalGrams(fi);
          const newTotal = currentTotal + neededGrams;
          const fullUnits = Math.floor(newTotal / fiGrams);
          const remainder = Math.round((newTotal - fullUnits * fiGrams) * 10) / 10;
          await safeMutate("Restauration stock (grams)", () =>
            supabase.from("food_items").update({ quantity: remainder > 0 ? fullUnits + 1 : fullUnits, grams: encodeStoredGrams(fiGrams, remainder > 0 ? remainder : null) } as any).eq("id", fi.id)
          );
        } else {
          const currentTotal = fiGrams;
          await safeMutate("Restauration stock (simple)", () =>
            supabase.from("food_items").update({ grams: formatNumeric(currentTotal + neededGrams) } as any).eq("id", fi.id)
          );
        }
      }
    }
    const mealGrams = parseQty(meal.grams);
    if (mealGrams > 0) {
      const nameMatch = foodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
      if (nameMatch) {
        const unit = parseQty(nameMatch.grams);
        if (nameMatch.quantity && nameMatch.quantity >= 1 && unit > 0) {
          const currentTotal = getFoodItemTotalGrams(nameMatch);
          const newTotal = currentTotal + mealGrams;
          const fullUnits = Math.floor(newTotal / unit);
          const remainder = Math.round((newTotal - fullUnits * unit) * 10) / 10;
          await safeMutate("Restauration nom", () =>
            supabase.from("food_items").update({ quantity: remainder > 0 ? fullUnits + 1 : fullUnits, grams: encodeStoredGrams(unit, remainder > 0 ? remainder : null) } as any).eq("id", nameMatch.id)
          );
        } else {
          await safeMutate("Restauration nom (simple)", () =>
            supabase.from("food_items").update({ grams: formatNumeric(unit + mealGrams) } as any).eq("id", nameMatch.id)
          );
        }
      }
    }
    invalidateStock();
  };

  /** Adjust stock when possible meal ingredients are edited (delta-based).
   *  Returns snapshots of newly affected items (not already in the passed snapshots). */
  const adjustStockForIngredientChange = async (oldIngredients: string | null, newIngredients: string | null, snapshots?: FoodItem[]): Promise<FoodItem[]> => {
    const newSnapshots: FoodItem[] = [];
    const existingSnapshotIds = new Set(snapshots?.map(s => s.id) ?? []);
    // Refetch fresh food items to avoid stale data after multiple edits
    const { data: freshItems } = await supabase.from("food_items").select("*").order("sort_order", { ascending: true });
    const currentFoodItems: FoodItem[] = (freshItems ?? []).map((d: any) => ({
      ...d,
      is_meal: d.is_meal ?? false,
      is_infinite: d.is_infinite ?? false,
      is_dry: d.is_dry ?? false,
      is_indivisible: d.is_indivisible ?? false,
      no_counter: d.no_counter ?? false,
      storage_type: d.storage_type ?? (d.is_dry ? "sec" : "frigo"),
      quantity: d.quantity ?? null,
      food_type: d.food_type ?? null,
      protein: d.protein ?? null,
    })) as FoodItem[];

    const oldGroups = oldIngredients ? parseIngredientGroups(oldIngredients) : [];
    const newGroups = newIngredients ? parseIngredientGroups(newIngredients) : [];
    const buildUsageMap = (groups: Array<Array<{ qty: number; count: number; name: string; optional?: boolean }>>) => {
      const map = new Map<string, { grams: number; count: number }>();
      for (const group of groups) {
        // Skip optional ingredient groups — they are not consumed
        if (group.every(alt => (alt as any).optional)) continue;
        if (group.length > 0) {
          const alt = group[0];
          const prev = map.get(alt.name) ?? { grams: 0, count: 0 };
          map.set(alt.name, { grams: prev.grams + alt.qty, count: prev.count + alt.count });
        }
      }
      return map;
    };
    const oldUsage = buildUsageMap(oldGroups);
    const newUsage = buildUsageMap(newGroups);
    const allKeys = new Set([...oldUsage.keys(), ...newUsage.keys()]);

    for (const ingName of allKeys) {
      const oldU = oldUsage.get(ingName) ?? { grams: 0, count: 0 };
      const newU = newUsage.get(ingName) ?? { grams: 0, count: 0 };
      const deltaGrams = newU.grams - oldU.grams;
      const deltaCount = newU.count - oldU.count;
      if (deltaGrams === 0 && deltaCount === 0) continue;

      const matchingItems = currentFoodItems.filter(fi => strictNameMatch(fi.name, ingName) && !fi.is_infinite).sort(sortStockDeductionPriority);

      if (deltaGrams > 0) {
        let toDeduct = deltaGrams;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const totalAvail = getFoodItemTotalGrams(fi);
          if (totalAvail <= 0) continue;
          const deduct = Math.min(totalAvail, toDeduct);
          const remaining = totalAvail - deduct;
          toDeduct -= deduct;
          // Snapshot newly affected items for future restoration
          if (!existingSnapshotIds.has(fi.id)) {
            newSnapshots.push({ ...fi });
            existingSnapshotIds.add(fi.id);
          }
          if (remaining <= 0) {
            await safeMutate("Ajustement stock", () => supabase.from("food_items").delete().eq("id", fi.id));
          } else {
            const perUnit = parseQty(fi.grams);
            if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
              const fullUnits = Math.floor(remaining / perUnit);
              const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
              const shouldStartCounter = rem > 0 && !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
              const shouldClearCounter = rem <= 0 && fi.counter_start_date;
              await safeMutate("Ajustement stock", () =>
                supabase.from("food_items").update({ quantity: rem > 0 ? Math.max(1, fullUnits + 1) : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null), ...(shouldStartCounter ? { counter_start_date: new Date().toISOString() } : {}), ...(shouldClearCounter ? { counter_start_date: null } : {}) } as any).eq("id", fi.id)
              );
            } else {
              const shouldStartCounter = remaining > 0 && remaining < parseQty(fi.grams) && !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
              await safeMutate("Ajustement stock", () =>
                supabase.from("food_items").update({ grams: formatNumeric(remaining), ...(shouldStartCounter ? { counter_start_date: new Date().toISOString() } : {}) } as any).eq("id", fi.id)
              );
            }
          }
        }
      } else if (deltaGrams < 0) {
        const toAdd = -deltaGrams;
        // Prefer the exact food item that was originally deducted (from snapshot)
        const snapshotFi = snapshots?.find(s => strictNameMatch(s.name, ingName));
        const fi = snapshotFi ? (currentFoodItems.find(f => f.id === snapshotFi.id) ?? null) : (matchingItems[0] ?? null);

        if (fi) {
          // Item still exists in stock — add grams to it
          const perUnit = parseQty(fi.grams);
          if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
            const currentTotal = getFoodItemTotalGrams(fi);
            const newTotal = currentTotal + toAdd;
            const fullUnits = Math.floor(newTotal / perUnit);
            const rem = Math.round((newTotal - fullUnits * perUnit) * 10) / 10;
            const shouldClearCounter = rem <= 0 && fi.counter_start_date;
            await safeMutate("Ajustement stock", () =>
              supabase.from("food_items").update({ quantity: rem > 0 ? fullUnits + 1 : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null), ...(shouldClearCounter ? { counter_start_date: null } : {}) } as any).eq("id", fi.id)
            );
          } else {
            const current = parseQty(fi.grams);
            await safeMutate("Ajustement stock", () =>
              supabase.from("food_items").update({ grams: formatNumeric(current + toAdd) } as any).eq("id", fi.id)
            );
          }
        } else if (snapshotFi) {
          // Original item was fully consumed and deleted — recreate it from snapshot
          const { created_at, quantity, grams, ...rest } = snapshotFi as Record<string, any>;
          const perUnit = parseQty(snapshotFi.grams);
          if (snapshotFi.quantity !== null && snapshotFi.quantity >= 1 && perUnit > 0) {
            const fullUnits = Math.floor(toAdd / perUnit);
            const rem = Math.round((toAdd - fullUnits * perUnit) * 10) / 10;
            await safeMutate("Ajustement stock (recréation)", () =>
              supabase.from("food_items").insert({
                ...rest,
                quantity: rem > 0 ? fullUnits + 1 : Math.max(1, fullUnits),
                grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null),
                counter_start_date: snapshotFi.counter_start_date,
              } as any)
            );
          } else {
            await safeMutate("Ajustement stock (recréation)", () =>
              supabase.from("food_items").insert({ ...rest, grams: formatNumeric(toAdd), counter_start_date: snapshotFi.counter_start_date } as any)
            );
          }
        }
      }

      if (deltaCount > 0) {
        let toDeduct = deltaCount;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const fiCount = fi.quantity ?? 1;
          const deduct = Math.min(fiCount, toDeduct);
          toDeduct -= deduct;
          const remaining = fiCount - deduct;
          // Snapshot newly affected items for future restoration
          if (!existingSnapshotIds.has(fi.id)) {
            newSnapshots.push({ ...fi });
            existingSnapshotIds.add(fi.id);
          }
          if (remaining <= 0) {
            await safeMutate("Ajustement stock (count)", () => supabase.from("food_items").delete().eq("id", fi.id));
          } else {
            await safeMutate("Ajustement stock (count)", () => supabase.from("food_items").update({ quantity: remaining } as any).eq("id", fi.id));
          }
        }
      } else if (deltaCount < 0) {
        const toAdd = -deltaCount;
        const snapshotFi = snapshots?.find(s => strictNameMatch(s.name, ingName));
        const fi = snapshotFi ? (currentFoodItems.find(f => f.id === snapshotFi.id) ?? null) : (matchingItems[0] ?? null);

        if (fi) {
          await safeMutate("Ajustement stock (count)", () =>
            supabase.from("food_items").update({ quantity: (fi.quantity ?? 1) + toAdd } as any).eq("id", fi.id)
          );
        } else if (snapshotFi) {
          const { created_at, quantity, grams, ...rest } = snapshotFi as Record<string, any>;
          await safeMutate("Ajustement stock (recréation count)", () =>
            supabase.from("food_items").insert({
               ...rest,
               quantity: toAdd,
               grams: grams,
               counter_start_date: snapshotFi.counter_start_date
            } as any)
          );
        }
      }
    }
    invalidateStock();
    return newSnapshots;
  };

  /** Deduct name-match stock (no ingredients, just name match) */
  const deductNameMatchStock = async (meal: Meal, forcedCounterDate?: string) => {
    const mealGrams = parseQty(meal.grams);
    const nameMatch = foodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
    if (!nameMatch) return;

    const counterToSet = forcedCounterDate || new Date().toISOString();
    const shouldStart = nameMatch.storage_type !== 'surgele' && !nameMatch.no_counter;

    if (mealGrams <= 0) {
      const currentQty = nameMatch.quantity ?? 1;
      if (currentQty <= 1) {
        await safeMutate("Déduction nom", () => supabase.from("food_items").delete().eq("id", nameMatch.id));
      } else {
        await safeMutate("Déduction nom", () => supabase.from("food_items").update({ quantity: currentQty - 1, ...(shouldStart && (!nameMatch.counter_start_date || forcedCounterDate) ? { counter_start_date: counterToSet } : {}) } as any).eq("id", nameMatch.id));
      }
      invalidateStock();
      return;
    }
    const perUnit = parseQty(nameMatch.grams);
    if (nameMatch.quantity && nameMatch.quantity >= 1 && perUnit > 0) {
      const totalAvailable = getFoodItemTotalGrams(nameMatch);
      const remaining = totalAvailable - mealGrams;
      if (remaining <= 0) {
        await safeMutate("Déduction nom", () => supabase.from("food_items").delete().eq("id", nameMatch.id));
      } else {
        const fullUnits = Math.floor(remaining / perUnit);
        const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
        if (remainder > 0) {
          await safeMutate("Déduction nom", () => supabase.from("food_items").update({ 
            quantity: Math.max(1, fullUnits + 1), 
            grams: encodeStoredGrams(perUnit, remainder),
            ...(shouldStart ? { counter_start_date: counterToSet } : {})
          } as any).eq("id", nameMatch.id));
        } else if (fullUnits > 0) {
          await safeMutate("Déduction nom", () => supabase.from("food_items").update({ 
            quantity: fullUnits, 
            grams: formatNumeric(perUnit),
            ...(nameMatch.counter_start_date ? { counter_start_date: null } : {})
          } as any).eq("id", nameMatch.id));
        } else {
          await safeMutate("Déduction nom", () => supabase.from("food_items").delete().eq("id", nameMatch.id));
        }
      }
    } else {
      const current = parseQty(nameMatch.grams);
      const remaining = Math.max(0, current - mealGrams);
      if (remaining <= 0) {
        await safeMutate("Déduction nom", () => supabase.from("food_items").delete().eq("id", nameMatch.id));
      } else {
        const isNewUnit = remaining > 0 && remaining < current;
        await safeMutate("Déduction nom", () => supabase.from("food_items").update({ 
          grams: formatNumeric(remaining),
          ...(shouldStart && isNewUnit ? { counter_start_date: counterToSet } : {})
        } as any).eq("id", nameMatch.id));
      }
    }
    invalidateStock();
  };

  /** Update food items' counter_start_date when a possible meal's planning changes */
  const updateFoodItemCountersForPlanning = async (
    pmId: string | null,
    ingredients: string | null,
    dayOfWeek: string | null,
    mealTime: string | null,
    fallbackDate?: string | null,
    createdAt?: string | null,
    allPossibleMeals: any[] = []
  ) => {
    if (!ingredients?.trim()) return;
    const groups = parseIngredientGroups(ingredients);

    for (const group of groups) {
      if (group.every(alt => (alt as any).optional)) continue;
      const alt = group[0];
      if (!alt) continue;
      // Find food items matching this ingredient that have a counter capability
      const matchingItems = foodItems.filter(
        fi => strictNameMatch(fi.name, alt.name) && !fi.is_infinite && fi.storage_type !== 'surgele' && !fi.no_counter
      );
      
      for (const fi of matchingItems) {
        // Find the absolute earliest date across ALL possible meals using this ingredient
        let earliestDateStr: string | null = null;
        let earliestDateMs = Infinity;

        // If the current PM is updating (not deleting), include it in the evaluation
        if (pmId) {
            const targetDate = dayOfWeek ? computePlannedCounterDate(dayOfWeek, mealTime) : null;
            earliestDateStr = targetDate ?? fallbackDate ?? new Date().toISOString();
            earliestDateMs = new Date(earliestDateStr).getTime();
        }

        let hasAnyMatchingMeal = pmId !== null;

        for (const pm of allPossibleMeals) {
            if (pm.id === pmId) continue; // Skip the one being updated currently (it uses its own passed arguments)
            const pmIngs = pm.ingredients_override ?? pm.meals?.ingredients;
            if (!pmIngs?.trim()) continue;
            
            // Performance check: loosely check name first
            if (!pmIngs.toLowerCase().includes(fi.name.toLowerCase())) continue;
            
            // Check if it strictly uses it
            const pmG = parseIngredientGroups(pmIngs);
            const hasMatch = pmG.some(g => g.some(a => !a.optional && strictNameMatch(fi.name, a.name)));
            if (!hasMatch) continue;
            
            hasAnyMatchingMeal = true;
            const pmDate = pm.day_of_week ? computePlannedCounterDate(pm.day_of_week, pm.meal_time) : (pm.created_at || new Date().toISOString());
            const pmMs = new Date(pmDate).getTime();
            if (pmMs < earliestDateMs) {
                earliestDateMs = pmMs;
                earliestDateStr = pmDate;
            }
        }

        // Only update if we found a valid date and there are active meals.
        // If there are no meals using this, we don't automatically nullify it because it might have been manually opened.
        if (hasAnyMatchingMeal && earliestDateStr) {
            // Also protect against overwriting manual past openings unless they were opened BY the evaluated meals.
            if (fi.counter_start_date) {
                const fiStart = new Date(fi.counter_start_date).getTime();
                const nowMs = new Date().getTime();
                const isStartedBeforeNow = fiStart <= nowMs;
                const isManualOrOld = isStartedBeforeNow && !allPossibleMeals.some(pm => pm.created_at && Math.abs(fiStart - new Date(pm.created_at).getTime()) < 60000);
                if (isManualOrOld && (!pmId || (createdAt && Math.abs(fiStart - new Date(createdAt).getTime()) >= 60000))) {
                    // Manual or old opening, respect it.
                    continue;
                }
            }

            await safeMutate("Mise à jour compteur", () =>
                supabase.from("food_items").update({ counter_start_date: earliestDateStr } as any).eq("id", fi.id)
            );
        }
      }
    }
    invalidateStock();
  };

  return {
    deductIngredientsFromStock,
    restoreIngredientsToStock,
    adjustStockForIngredientChange,
    deductNameMatchStock,
    updateFoodItemCountersForPlanning,
  };
}
