import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/components/FoodItems";
import {
  normalizeForMatch, strictNameMatch,
  parseQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientGroups,
} from "@/lib/ingredientUtils";
import {
  buildStockMap, findStockKey, pickBestAlternative,
  sortStockDeductionPriority,
} from "@/lib/stockUtils";

/**
 * Centralised stock-transfer logic extracted from Index.tsx.
 * Every Supabase call is wrapped in try/catch with a destructive toast on failure.
 */
export function useMealTransfers(foodItems: FoodItem[]) {
  const qc = useQueryClient();

  const invalidateStock = () => qc.invalidateQueries({ queryKey: ["food_items"] });

  /** Safely run a supabase mutation, catching network errors */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safeMutate = async (label: string, fn: () => any): Promise<any> => {
    try {
      return await fn();
    } catch (err: any) {
      toast({ title: "Erreur réseau", description: `${label} : ${err?.message ?? "erreur inconnue"}`, variant: "destructive" });
      return null;
    }
  };

  /** Deduct ingredients from stock when moving to Possible */
  const deductIngredientsFromStock = async (meal: Meal): Promise<FoodItem[]> => {
    if (!meal.ingredients?.trim()) return [];
    const groups = parseIngredientGroups(meal.ingredients);
    const stockMap = buildStockMap(foodItems);
    const snapshotsById = new Map<string, FoodItem>();
    const updatesById = new Map<string, { id: string; grams?: string | null; quantity?: number | null; delete?: boolean; counter_start_date?: string | null }>();
    const rememberSnapshot = (fi: FoodItem) => { if (!snapshotsById.has(fi.id)) snapshotsById.set(fi.id, { ...fi }); };

    for (const group of groups) {
      const alt = pickBestAlternative(group, stockMap);
      if (!alt) continue;
      const { qty: neededGrams, count: neededCount, name } = alt;
      const key = findStockKey(stockMap, name);
      if (!key) continue;
      const stockInfo = stockMap.get(key);
      if (!stockInfo || stockInfo.infinite) continue;

      const matchingItems = foodItems
        .filter((fi) => strictNameMatch(fi.name, key) && !fi.is_infinite)
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
          if (remaining <= 0) updatesById.set(fi.id, { id: fi.id, delete: true });
          else updatesById.set(fi.id, { id: fi.id, quantity: Math.ceil(remaining) });
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
          if (remaining <= 0) { updatesById.set(fi.id, { id: fi.id, delete: true }); continue; }
          if (fi.quantity && fi.quantity >= 1) {
            const fullUnits = Math.floor(remaining / perUnit);
            const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
            if (remainder > 0) {
              const shouldStartCounter = !fi.counter_start_date && fi.storage_type !== 'surgele';
              updatesById.set(fi.id, { id: fi.id, quantity: Math.max(1, fullUnits + 1), grams: encodeStoredGrams(perUnit, remainder), ...(shouldStartCounter ? { counter_start_date: new Date().toISOString() } : {}) });
            } else if (fullUnits > 0) {
              updatesById.set(fi.id, { id: fi.id, quantity: fullUnits, grams: formatNumeric(perUnit), ...(fi.counter_start_date ? { counter_start_date: null } : {}) });
            } else { updatesById.set(fi.id, { id: fi.id, delete: true }); }
          } else {
            const shouldStartCounter = !fi.counter_start_date && fi.storage_type !== 'surgele';
            updatesById.set(fi.id, { id: fi.id, grams: formatNumeric(remaining), ...(shouldStartCounter ? { counter_start_date: new Date().toISOString() } : {}) });
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
    return Array.from(snapshotsById.values());
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

  /** Adjust stock when possible meal ingredients are edited (delta-based) */
  const adjustStockForIngredientChange = async (oldIngredients: string | null, newIngredients: string | null) => {
    const oldGroups = oldIngredients ? parseIngredientGroups(oldIngredients) : [];
    const newGroups = newIngredients ? parseIngredientGroups(newIngredients) : [];
    const buildUsageMap = (groups: Array<Array<{qty: number; count: number; name: string}>>) => {
      const map = new Map<string, {grams: number; count: number}>();
      for (const group of groups) {
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

      const matchingItems = foodItems.filter(fi => strictNameMatch(fi.name, ingName) && !fi.is_infinite).sort(sortStockDeductionPriority);
      if (matchingItems.length === 0) continue;

      if (deltaGrams > 0) {
        let toDeduct = deltaGrams;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const totalAvail = getFoodItemTotalGrams(fi);
          if (totalAvail <= 0) continue;
          const deduct = Math.min(totalAvail, toDeduct);
          const remaining = totalAvail - deduct;
          toDeduct -= deduct;
          if (remaining <= 0) {
            await safeMutate("Ajustement stock", () => supabase.from("food_items").delete().eq("id", fi.id));
          } else {
            const perUnit = parseQty(fi.grams);
            if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
              const fullUnits = Math.floor(remaining / perUnit);
              const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
              await safeMutate("Ajustement stock", () =>
                supabase.from("food_items").update({ quantity: rem > 0 ? Math.max(1, fullUnits + 1) : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null) } as any).eq("id", fi.id)
              );
            } else {
              await safeMutate("Ajustement stock", () =>
                supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", fi.id)
              );
            }
          }
        }
      } else if (deltaGrams < 0) {
        const toAdd = -deltaGrams;
        const fi = matchingItems[0];
        const perUnit = parseQty(fi.grams);
        if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
          const currentTotal = getFoodItemTotalGrams(fi);
          const newTotal = currentTotal + toAdd;
          const fullUnits = Math.floor(newTotal / perUnit);
          const rem = Math.round((newTotal - fullUnits * perUnit) * 10) / 10;
          await safeMutate("Ajustement stock", () =>
            supabase.from("food_items").update({ quantity: rem > 0 ? fullUnits + 1 : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null) } as any).eq("id", fi.id)
          );
        } else {
          const current = parseQty(fi.grams);
          await safeMutate("Ajustement stock", () =>
            supabase.from("food_items").update({ grams: formatNumeric(current + toAdd) } as any).eq("id", fi.id)
          );
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
          if (remaining <= 0) {
            await safeMutate("Ajustement stock (count)", () => supabase.from("food_items").delete().eq("id", fi.id));
          } else {
            await safeMutate("Ajustement stock (count)", () => supabase.from("food_items").update({ quantity: remaining } as any).eq("id", fi.id));
          }
        }
      } else if (deltaCount < 0) {
        const toAdd = -deltaCount;
        const fi = matchingItems[0];
        await safeMutate("Ajustement stock (count)", () =>
          supabase.from("food_items").update({ quantity: (fi.quantity ?? 1) + toAdd } as any).eq("id", fi.id)
        );
      }
    }
    invalidateStock();
  };

  /** Deduct name-match stock (no ingredients, just name match) */
  const deductNameMatchStock = async (meal: Meal) => {
    const mealGrams = parseQty(meal.grams);
    const nameMatch = foodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
    if (!nameMatch) return;
    if (mealGrams <= 0) {
      const currentQty = nameMatch.quantity ?? 1;
      if (currentQty <= 1) {
        await safeMutate("Déduction nom", () => supabase.from("food_items").delete().eq("id", nameMatch.id));
      } else {
        await safeMutate("Déduction nom", () => supabase.from("food_items").update({ quantity: currentQty - 1 } as any).eq("id", nameMatch.id));
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
          await safeMutate("Déduction nom", () => supabase.from("food_items").update({ quantity: Math.max(1, fullUnits + 1), grams: encodeStoredGrams(perUnit, remainder) } as any).eq("id", nameMatch.id));
        } else if (fullUnits > 0) {
          await safeMutate("Déduction nom", () => supabase.from("food_items").update({ quantity: fullUnits, grams: formatNumeric(perUnit) } as any).eq("id", nameMatch.id));
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
        await safeMutate("Déduction nom", () => supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", nameMatch.id));
      }
    }
    invalidateStock();
  };

  return {
    deductIngredientsFromStock,
    restoreIngredientsToStock,
    adjustStockForIngredientChange,
    deductNameMatchStock,
  };
}
