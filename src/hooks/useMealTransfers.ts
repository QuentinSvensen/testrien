/**
 * Hook centralisé pour la logique de transfert de stock entre les listes de repas.
 * 
 * Gère :
 * - Déduction des ingrédients du stock lors du déplacement vers "Possible"
 * - Restauration du stock lors du retour d'un repas
 * - Ajustement delta lors de la modification des ingrédients d'une carte "Possible"
 * - Déduction par correspondance de nom (repas sans ingrédients)
 * - Synchronisation des compteurs d'ouverture avec le planning
 * 
 * Chaque appel Supabase est wrappé dans safeMutate pour gérer les erreurs réseau.
 */

import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
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

/** Table de correspondance jour français → index (0=Lun) */
const DAY_KEY_TO_INDEX: Record<string, number> = {
  lundi: 0, mardi: 1, mercredi: 2, jeudi: 3, vendredi: 4, samedi: 5, dimanche: 6,
};

/**
 * Calcule la date ISO du compteur d'ouverture pour un repas planifié.
 * Midi = 12h, Soir = 19h. Accepte les jours nommés ("lundi") ou les dates ISO.
 */
export function computePlannedCounterDate(dayOfWeek: string, mealTime: string | null): string {
  // Si c'est déjà une date ISO (YYYY-MM-DD), l'utiliser directement
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayOfWeek)) {
    const d = parseISO(dayOfWeek);
    d.setHours(mealTime === "soir" ? 19 : 12, 0, 0, 0);
    return d.toISOString();
  }

  const today = new Date();
  const todayDow = today.getDay(); // 0=Dim
  const todayIdx = todayDow === 0 ? 6 : todayDow - 1; // 0=Lun
  const targetIdx = DAY_KEY_TO_INDEX[dayOfWeek] ?? 0;
  const diff = targetIdx - todayIdx;

  const d = new Date(today);
  d.setDate(d.getDate() + diff);
  d.setHours(mealTime === "soir" ? 19 : 12, 0, 0, 0);
  return d.toISOString();
}

/**
 * Hook principal de transfert de stock.
 * Fournit toutes les opérations de mutation du stock liées aux repas.
 */
export function useMealTransfers(foodItems: FoodItem[]) {
  const qc = useQueryClient();

  /** Invalide le cache des aliments pour forcer un rafraîchissement */
  const invalidateStock = () => qc.invalidateQueries({ queryKey: ["food_items"] });

  /** Exécute une mutation Supabase avec gestion d'erreur centralisée */
  const safeMutate = async (label: string, fn: () => any): Promise<any> => {
    try {
      const res = await fn();
      if (res && res.error) throw new Error(res.error.message);
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

  // ─── Helpers internes pour la gestion des compteurs ──────────────────────

  /**
   * Détermine si un aliment doit recevoir un compteur d'ouverture.
   * Conditions : non surgelé ET pas marqué no_counter.
   */
  const shouldStartCounter = (fi: FoodItem) => fi.storage_type !== 'surgele' && !fi.no_counter;

  /**
   * Vérifie si le compteur doit être mis à jour (pas déjà en cours ou forcé).
   * Protège les compteurs manuels existants qui sont déjà dans le passé.
   */
  const needsCounterUpdate = (fi: FoodItem, counterToSet: string, forcedCounterDate?: string) => {
    if (!shouldStartCounter(fi)) return false;
    if (!fi.counter_start_date) return true;
    const isFuture = new Date(fi.counter_start_date) > new Date(counterToSet);
    return isFuture || !!forcedCounterDate;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // DÉDUCTION DU STOCK (déplacement vers "Possible")
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Déduit les ingrédients du stock lors du déplacement d'un repas vers "Possible".
   * 
   * Pour chaque ingrédient requis :
   * 1. Choisit la meilleure alternative en stock
   * 2. Déduit la quantité nécessaire (grammes ou unités)
   * 3. Démarre un compteur d'ouverture si applicable
   * 4. Sauvegarde un snapshot de l'état avant déduction (pour restauration)
   * 
   * @returns snapshots (état avant déduction), consumedIds (items supprimés), oldestCounter (compteur le plus ancien)
   */
  const deductIngredientsFromStock = async (meal: Meal, forcedCounterDate?: string): Promise<{ snapshots: FoodItem[]; consumedIds: string[]; oldestCounter: string | null }> => {
    if (!meal.ingredients?.trim()) return { snapshots: [], consumedIds: [], oldestCounter: null };
    const groups = parseIngredientGroups(meal.ingredients);
    const stockMap = buildStockMap(foodItems);
    const snapshotsById = new Map<string, FoodItem>();
    const updatesById = new Map<string, { id: string; grams?: string | null; quantity?: number | null; delete?: boolean; counter_start_date?: string | null }>();
    const rememberSnapshot = (fi: FoodItem) => { if (!snapshotsById.has(fi.id)) snapshotsById.set(fi.id, { ...fi }); };
    let oldestCounter: string | null = null;

    /**
     * Collecte le compteur le plus ancien parmi les items déjà ouverts.
     * Ne prend en compte que les compteurs déjà actifs (pas dans le futur).
     */
    const trackOldestCounter = (fi: FoodItem, counterToSet: string) => {
      if (fi.counter_start_date && new Date(fi.counter_start_date) <= new Date(counterToSet)) {
        if (!oldestCounter || new Date(fi.counter_start_date) < new Date(oldestCounter)) {
          oldestCounter = fi.counter_start_date;
        }
      }
    };

    for (const group of groups) {
      // Ignorer les groupes entièrement optionnels
      if (group.every(alt => alt.optional)) continue;
      const alt = pickBestAlternative(group, stockMap);
      if (!alt) continue;
      const { qty: neededGrams, count: neededCount, name } = alt;
      const key = findStockKey(stockMap, name);
      if (!key) continue;
      const stockInfo = stockMap.get(key);
      if (!stockInfo || stockInfo.infinite) continue;

      // Trier pour consommer en priorité les items déjà ouverts
      const matchingItems = foodItems
        .filter((fi) => strictNameMatch(fi.name, name) && !fi.is_infinite)
        .sort(sortStockDeductionPriority);

      if (neededCount > 0) {
        // --- Déduction par comptage (ex: "2 oeufs") ---
        let toDeduct = neededCount;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const fiCount = fi.quantity ?? 1;
          const deduct = Math.min(fiCount, toDeduct);
          const remaining = fiCount - deduct;
          toDeduct -= deduct;
          rememberSnapshot(fi);

          const counterToSet = forcedCounterDate || new Date().toISOString();
          trackOldestCounter(fi, counterToSet);

          if (remaining <= 0) {
            updatesById.set(fi.id, { id: fi.id, delete: true });
          } else {
            updatesById.set(fi.id, { 
              id: fi.id, 
              quantity: Math.ceil(remaining),
              ...(needsCounterUpdate(fi, counterToSet, forcedCounterDate) ? { counter_start_date: counterToSet } : {})
            });
          }
        }
      } else if (neededGrams > 0) {
        // --- Déduction par grammes (ex: "150g poulet") ---
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
          trackOldestCounter(fi, counterToSet);

          if (remaining <= 0) { updatesById.set(fi.id, { id: fi.id, delete: true }); continue; }

          if (fi.quantity && fi.quantity >= 1) {
            // Item multi-unités : recalculer unités complètes + reliquat
            const fullUnits = Math.floor(remaining / perUnit);
            const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
            if (remainder > 0) {
              // Ouverture d'une nouvelle unité (reliquat > 0)
              updatesById.set(fi.id, { 
                id: fi.id, 
                quantity: Math.max(1, fullUnits + 1), 
                grams: encodeStoredGrams(perUnit, remainder), 
                ...(needsCounterUpdate(fi, counterToSet, forcedCounterDate) ? { counter_start_date: counterToSet } : {}) 
              });
            } else if (fullUnits > 0) {
              // Unités complètes restantes → pas d'ouverture, reset du compteur
              updatesById.set(fi.id, { id: fi.id, quantity: fullUnits, grams: formatNumeric(perUnit), ...(fi.counter_start_date ? { counter_start_date: null } : {}) });
            } else { updatesById.set(fi.id, { id: fi.id, delete: true }); }
          } else {
            // Item simple (sans multi-unités)
            const isNewUnit = remaining > 0 && remaining < perUnit;
            updatesById.set(fi.id, { 
              id: fi.id, 
              grams: formatNumeric(remaining), 
              ...(needsCounterUpdate(fi, counterToSet, forcedCounterDate) && isNewUnit ? { counter_start_date: counterToSet } : {}) 
            });
          }
        }
      }
    }

    // Appliquer toutes les mises à jour en parallèle
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

  // ═════════════════════════════════════════════════════════════════════════
  // RESTAURATION DU STOCK (retour d'un repas)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Restaure les ingrédients dans le stock.
   * 
   * Deux modes :
   * 1. Avec snapshots → upsert exact de l'état sauvegardé (préféré, précis)
   * 2. Sans snapshots → estimation en ajoutant les quantités de la recette
   */
  const restoreIngredientsToStock = async (meal: Meal, snapshots?: FoodItem[]) => {
    // Mode 1 : restauration depuis les snapshots (état exact)
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

    // Mode 2 : restauration estimée depuis la recette
    if (!meal.ingredients?.trim()) return;
    
    // IMPORTANT : Récupérer les données fraîches de Supabase pour éviter les erreurs dues au cache React périmé
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
    
    const groups = parseIngredientGroups(meal.ingredients);
    for (const group of groups) {
      const liveStockMap = buildStockMap(currentFoodItems);
      const alt = pickBestAlternative(group, liveStockMap) || group[0];
      if (!alt) continue;
      const { qty: neededGrams, count: neededCount, name } = alt;
      const matchingItems = currentFoodItems.filter((fi) => strictNameMatch(fi.name, name) && !fi.is_infinite).sort(sortStockDeductionPriority);
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
    // Restauration par correspondance de nom (repas sans ingrédients)
    const mealGrams = parseQty(meal.grams);
    if (mealGrams > 0) {
      const nameMatch = currentFoodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
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

  // ═════════════════════════════════════════════════════════════════════════
  // AJUSTEMENT DELTA (modification des ingrédients d'une carte Possible)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Ajuste le stock quand les ingrédients d'un repas "Possible" sont modifiés.
   * 
   * Calcule le delta entre ancien et nouveau pour chaque ingrédient :
   * - Delta positif → déduire plus du stock
   * - Delta négatif → rendre au stock
   * 
   * Récupère les données fraîches de Supabase pour éviter les erreurs de concurrence.
   * Retourne les nouveaux snapshots créés pour les items nouvellement affectés.
   */
  const adjustStockForIngredientChange = async (oldIngredients: string | null, newIngredients: string | null, snapshots?: FoodItem[]): Promise<FoodItem[]> => {
    const newSnapshots: FoodItem[] = [];
    const existingSnapshotIds = new Set(snapshots?.map(s => s.id) ?? []);
    
    // Récupérer les données fraîches pour éviter les doubles déductions
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

    // Construire les maps d'utilisation ancien vs nouveau
    const oldGroups = oldIngredients ? parseIngredientGroups(oldIngredients) : [];
    const newGroups = newIngredients ? parseIngredientGroups(newIngredients) : [];
    
    /** Construit une map nom → { grams, count } des quantités utilisées */
    const buildUsageMap = (groups: Array<Array<{ qty: number; count: number; name: string; optional?: boolean }>>) => {
      const map = new Map<string, { grams: number; count: number }>();
      for (const group of groups) {
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

      // --- Delta grammes positif : déduire plus ---
      if (deltaGrams > 0) {
        let toDeduct = deltaGrams;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const totalAvail = getFoodItemTotalGrams(fi);
          if (totalAvail <= 0) continue;
          const deduct = Math.min(totalAvail, toDeduct);
          const remaining = totalAvail - deduct;
          toDeduct -= deduct;
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
              const shouldStart = rem > 0 && !fi.counter_start_date && shouldStartCounter(fi);
              const shouldClear = rem <= 0 && fi.counter_start_date;
              await safeMutate("Ajustement stock", () =>
                supabase.from("food_items").update({ quantity: rem > 0 ? Math.max(1, fullUnits + 1) : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null), ...(shouldStart ? { counter_start_date: new Date().toISOString() } : {}), ...(shouldClear ? { counter_start_date: null } : {}) } as any).eq("id", fi.id)
              );
            } else {
              const shouldStart = remaining > 0 && remaining < parseQty(fi.grams) && !fi.counter_start_date && shouldStartCounter(fi);
              await safeMutate("Ajustement stock", () =>
                supabase.from("food_items").update({ grams: formatNumeric(remaining), ...(shouldStart ? { counter_start_date: new Date().toISOString() } : {}) } as any).eq("id", fi.id)
              );
            }
          }
        }
      }
      // --- Delta grammes négatif : rendre au stock ---
      else if (deltaGrams < 0) {
        const toAdd = -deltaGrams;
        const snapshotFi = snapshots?.find(s => strictNameMatch(s.name, ingName));
        const fi = snapshotFi ? (currentFoodItems.find(f => f.id === snapshotFi.id) ?? null) : (matchingItems[0] ?? null);

        if (fi) {
          const perUnit = parseQty(fi.grams);
          if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
            const currentTotal = getFoodItemTotalGrams(fi);
            const newTotal = currentTotal + toAdd;
            const fullUnits = Math.floor(newTotal / perUnit);
            const rem = Math.round((newTotal - fullUnits * perUnit) * 10) / 10;
            const shouldClear = rem <= 0 && fi.counter_start_date;
            await safeMutate("Ajustement stock", () =>
              supabase.from("food_items").update({ quantity: rem > 0 ? fullUnits + 1 : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null), ...(shouldClear ? { counter_start_date: null } : {}) } as any).eq("id", fi.id)
            );
          } else {
            const current = parseQty(fi.grams);
            await safeMutate("Ajustement stock", () =>
              supabase.from("food_items").update({ grams: formatNumeric(current + toAdd) } as any).eq("id", fi.id)
            );
          }
        } else if (snapshotFi) {
          // Item entièrement consommé et supprimé → le recréer depuis le snapshot
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

      // --- Delta comptage positif : déduire plus ---
      if (deltaCount > 0) {
        let toDeduct = deltaCount;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const fiCount = fi.quantity ?? 1;
          const deduct = Math.min(fiCount, toDeduct);
          toDeduct -= deduct;
          const remaining = fiCount - deduct;
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
      }
      // --- Delta comptage négatif : rendre au stock ---
      else if (deltaCount < 0) {
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

  // ═════════════════════════════════════════════════════════════════════════
  // DÉDUCTION PAR NOM (repas sans ingrédients détaillés)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Déduit du stock par correspondance de nom (pour les repas sans liste d'ingrédients).
   * Cherche un aliment portant le même nom que le repas et déduit les grammes ou 1 unité.
   */
  const deductNameMatchStock = async (meal: Meal, forcedCounterDate?: string) => {
    const mealGrams = parseQty(meal.grams);
    const nameMatch = foodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
    if (!nameMatch) return;

    const counterToSet = forcedCounterDate || new Date().toISOString();
    const canStartCounter = shouldStartCounter(nameMatch);

    if (mealGrams <= 0) {
      // Pas de grammes spécifiés → déduire 1 unité
      const currentQty = nameMatch.quantity ?? 1;
      if (currentQty <= 1) {
        await safeMutate("Déduction nom", () => supabase.from("food_items").delete().eq("id", nameMatch.id));
      } else {
        await safeMutate("Déduction nom", () => supabase.from("food_items").update({ quantity: currentQty - 1, ...(canStartCounter && (!nameMatch.counter_start_date || forcedCounterDate) ? { counter_start_date: counterToSet } : {}) } as any).eq("id", nameMatch.id));
      }
      invalidateStock();
      return;
    }

    // Déduction par grammes
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
            ...(canStartCounter ? { counter_start_date: counterToSet } : {})
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
          ...(canStartCounter && isNewUnit ? { counter_start_date: counterToSet } : {})
        } as any).eq("id", nameMatch.id));
      }
    }
    invalidateStock();
  };

  // ═════════════════════════════════════════════════════════════════════════
  // SYNCHRONISATION DES COMPTEURS AVEC LE PLANNING
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Met à jour les counter_start_date des aliments quand le planning d'un repas change.
   * 
   * Pour chaque ingrédient affecté :
   * 1. Collecte toutes les dates de planification des repas utilisant cet ingrédient
   * 2. Détermine la date la plus ancienne
   * 3. Met à jour le compteur de l'aliment en conséquence
   * 
   * Protège les compteurs manuels (ouverts manuellement avant toute planification).
   */
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

      // Trouver les aliments en stock correspondant à cet ingrédient
      const matchingItems = foodItems.filter(
        fi => strictNameMatch(fi.name, alt.name) && !fi.is_infinite && shouldStartCounter(fi)
      );
      
      for (const fi of matchingItems) {
        // Trouver la date la plus ancienne parmi TOUS les repas planifiés utilisant cet ingrédient
        let earliestDateStr: string | null = null;
        let earliestDateMs = Infinity;

        // Inclure le repas en cours de mise à jour
        if (pmId) {
          const targetDate = dayOfWeek ? computePlannedCounterDate(dayOfWeek, mealTime) : null;
          const candidateDate = targetDate ?? fallbackDate ?? new Date().toISOString();
          
          // CRITIQUE : Si on a déjà un fallback (date d'ouverture réelle) et qu'il est PLUS ANCIEN
          // que la date planifiée, on garde la date d'ouverture !
          if (fallbackDate && targetDate && new Date(fallbackDate) < new Date(targetDate)) {
            earliestDateStr = fallbackDate;
          } else {
            earliestDateStr = candidateDate;
          }
          earliestDateMs = new Date(earliestDateStr).getTime();
        }

        let hasAnyMatchingMeal = pmId !== null;

        // Parcourir tous les autres repas possibles
        for (const pm of allPossibleMeals) {
          if (pm.id === pmId) continue;
          const pmIngs = pm.ingredients_override ?? pm.meals?.ingredients;
          if (!pmIngs?.trim()) continue;
          
          // Vérification rapide par nom avant le parsing complet
          if (!pmIngs.toLowerCase().includes(fi.name.toLowerCase())) continue;
          
          const pmG = parseIngredientGroups(pmIngs);
          const hasMatch = pmG.some(g => g.some(a => !a.optional && strictNameMatch(fi.name, a.name)));
          if (!hasMatch) continue;
          
          hasAnyMatchingMeal = true;
          // De même ici : préférer pm.counter_start_date s'il est plus ancien que la date planifiée du repas
          const targetDate = pm.day_of_week ? computePlannedCounterDate(pm.day_of_week, pm.meal_time) : null;
          const fallback = pm.counter_start_date || (pm.created_at || new Date().toISOString());
          let pmDate = targetDate ?? fallback;
          
          if (pm.day_of_week && pm.counter_start_date && new Date(pm.counter_start_date) < new Date(pmDate)) {
            pmDate = pm.counter_start_date;
          }

          const pmMs = new Date(pmDate).getTime();
          if (pmMs < earliestDateMs) {
            earliestDateMs = pmMs;
            earliestDateStr = pmDate;
          }
        }

        // Mettre à jour seulement si on a trouvé une date valide
        if (hasAnyMatchingMeal && earliestDateStr) {
          // Protéger les compteurs manuels (ouverts avant toute planification)
          if (fi.counter_start_date) {
            const fiStart = new Date(fi.counter_start_date).getTime();
            const nowMs = new Date().getTime();
            const isStartedBeforeNow = fiStart <= nowMs;
            const isManualOrOld = isStartedBeforeNow && !allPossibleMeals.some(pm => pm.created_at && Math.abs(fiStart - new Date(pm.created_at).getTime()) < 60000);
            if (isManualOrOld && (!pmId || (createdAt && Math.abs(fiStart - new Date(createdAt).getTime()) >= 60000))) {
              continue; // Compteur manuel → ne pas écraser
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
