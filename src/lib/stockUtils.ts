/**
 * Stock analysis and meal utility functions.
 * Extracted from Index.tsx for reuse and maintainability.
 */

import type { FoodItem } from "@/components/FoodItems";
import type { Meal } from "@/hooks/useMeals";
import {
  normalizeForMatch, normalizeKey, strictNameMatch,
  parseQty, parsePartialQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientLine, parseIngredientLineRaw, parseIngredientGroups,
  extractMetrics, computeIngredientCalories, computeIngredientProtein,
  extractIngredientMacros, applyIngredientMacros,
  computeCounterDays,
  type ParsedIngredient,
} from "@/lib/ingredientUtils";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

// Re-export commonly used functions so consumers can import from one place
export {
  normalizeForMatch, normalizeKey, strictNameMatch,
  parseQty, parsePartialQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientLine, parseIngredientGroups,
};

// ─── Food Item Index ────────────────────────────────────────────────────────

export type FoodItemIndex = Map<string, FoodItem[]>;

/** Build a lookup index from foodItems for O(1) name-based access */
export function buildFoodItemIndex(foodItems: FoodItem[]): FoodItemIndex {
  const index = new Map<string, FoodItem[]>();
  for (const fi of foodItems) {
    const key = normalizeKey(fi.name);
    const arr = index.get(key);
    if (arr) arr.push(fi);
    else index.set(key, [fi]);
  }
  return index;
}

/** O(1) lookup by normalized key, with fuzzy fallback for typo tolerance */
function lookupFoodItems(name: string, foodItems: FoodItem[], index?: FoodItemIndex): FoodItem[] {
  if (index) {
    const exact = index.get(normalizeKey(name));
    if (exact && exact.length > 0) return exact;
    const results: FoodItem[] = [];
    for (const [, items] of index) {
      if (items.length > 0 && strictNameMatch(items[0].name, name)) {
        results.push(...items);
      }
    }
    return results;
  }
  return foodItems.filter(fi => strictNameMatch(fi.name, name));
}

// ─── Stock Map ──────────────────────────────────────────────────────────────

export interface StockInfo { grams: number; count: number; infinite: boolean; indivisibleUnit: number; }

export function buildStockMap(foodItems: FoodItem[]): Map<string, StockInfo> {
  const map = new Map<string, StockInfo>();
  for (const fi of foodItems) {
    const key = normalizeKey(fi.name);
    const prev = map.get(key) ?? { grams: 0, count: 0, infinite: false, indivisibleUnit: 0 };
    if (fi.is_infinite) {
      map.set(key, { ...prev, infinite: true });
    } else {
      const unitGrams = parseQty(fi.grams);
      map.set(key, {
        grams: prev.grams + getFoodItemTotalGrams(fi),
        count: prev.count + (fi.quantity ?? 1),
        infinite: prev.infinite,
        indivisibleUnit: fi.is_indivisible && unitGrams > 0 ? Math.max(prev.indivisibleUnit, unitGrams) : prev.indivisibleUnit,
      });
    }
  }
  return map;
}

export function findStockKey(stockMap: Map<string, StockInfo>, name: string): string | null {
  const key = normalizeKey(name);
  if (stockMap.has(key)) return key;
  for (const k of stockMap.keys()) {
    if (strictNameMatch(k, name)) return k;
  }
  return null;
}

export function pickBestAlternative(
  alts: ParsedIngredient[],
  stockMap: Map<string, StockInfo>
): ParsedIngredient | null {
  for (const alt of alts) {
    const key = findStockKey(stockMap, alt.name);
    if (!key) continue;
    const stock = stockMap.get(key)!;
    if (stock.infinite) return alt;
    if (alt.count > 0 && stock.count >= alt.count) return alt;
    if (alt.qty > 0 && stock.grams >= alt.qty) return alt;
    if (alt.count === 0 && alt.qty === 0) return alt;
  }
  return null;
}

// ─── Meal Availability ──────────────────────────────────────────────────────

export function getMealMultiple(meal: Meal, stockMap: Map<string, StockInfo>): number | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  if (groups.length === 0) return null;
  let multiple = Infinity;

  for (const group of groups) {
    // Skip optional groups
    if (group[0]?.optional) continue;
    let bestGroupMultiple = 0;
    let anyMatch = false;
    for (const alt of group) {
      const key = findStockKey(stockMap, alt.name);
      if (key === null) continue;
      const stock = stockMap.get(key)!;
      if (stock.infinite) { bestGroupMultiple = Infinity; anyMatch = true; break; }
      let altMultiple = 0;
      if (alt.count > 0) { if (stock.count >= alt.count) { altMultiple = Math.floor(stock.count / alt.count); anyMatch = true; } }
      else if (alt.qty > 0) { if (stock.grams >= alt.qty) { altMultiple = Math.floor(stock.grams / alt.qty); anyMatch = true; } }
      else { altMultiple = Infinity; anyMatch = true; }
      bestGroupMultiple = Math.max(bestGroupMultiple, altMultiple);
    }
    if (!anyMatch) return null;
    multiple = Math.min(multiple, bestGroupMultiple);
  }
  // If all groups are optional, return null (no required ingredients)
  const hasRequired = groups.some(g => !g[0]?.optional);
  if (!hasRequired) return null;
  return multiple === Infinity ? Infinity : multiple;
}

export function getMealFractionalRatio(meal: Meal, stockMap: Map<string, StockInfo>): number | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  if (groups.length === 0) return null;
  let minRatio = Infinity;

  for (const group of groups) {
    // Skip optional groups
    if (group[0]?.optional) continue;
    let bestGroupRatio = 0;
    let anyMatch = false;
    for (const alt of group) {
      const key = findStockKey(stockMap, alt.name);
      if (key === null) continue;
      const stock = stockMap.get(key)!;
      if (stock.infinite) { bestGroupRatio = Infinity; anyMatch = true; break; }
      let altRatio = 0;
      if (alt.count > 0) { altRatio = stock.count / alt.count; if (altRatio > 0) anyMatch = true; }
      else if (alt.qty > 0) { altRatio = stock.grams / alt.qty; if (altRatio > 0) anyMatch = true; }
      else { altRatio = Infinity; anyMatch = true; }
      bestGroupRatio = Math.max(bestGroupRatio, altRatio);
    }
    if (!anyMatch) return null;
    minRatio = Math.min(minRatio, bestGroupRatio);
  }

  // Check if all groups are optional
  const hasRequired = groups.some(g => !g[0]?.optional);
  if (!hasRequired) return null;

  // Snap ratio for indivisible ingredients
  for (const group of groups) {
    if (group[0]?.optional) continue;
    for (const alt of group) {
      const key = findStockKey(stockMap, alt.name);
      if (!key) continue;
      const stock = stockMap.get(key)!;
      if (stock.indivisibleUnit > 0 && alt.qty > 0) {
        const neededAtRatio = alt.qty * minRatio;
        const snapped = Math.floor(neededAtRatio / stock.indivisibleUnit) * stock.indivisibleUnit;
        if (snapped <= 0) return null;
        const snappedRatio = snapped / alt.qty;
        minRatio = Math.min(minRatio, snappedRatio);
      }
    }
  }

  if (minRatio === Infinity || minRatio >= 1 || minRatio < 0.5) return null;
  return minRatio;
}

// ─── Consolidated Meal Analysis (single pass over ingredients) ───────────────

export interface MealAnalysis {
  earliestExpiration: string | null;
  expiringIngredientName: string | null;
  expiredIngredientNames: Set<string>;
  expiringSoonIngredientNames: Set<string>;
  maxIngredientCounter: number | null;
  maxCounterName: string | null;
  earliestCounterDate: string | null;
  counterIngredientNames: Set<string>;
}

/**
 * Perform ALL ingredient analyses in a single traversal of groups × foodItems.
 * Replaces 6+ separate function calls that each re-parsed and re-iterated.
 */
export function analyzeMealIngredients(
  meal: Meal,
  foodItems: FoodItem[],
  index?: FoodItemIndex,
  skipIds?: Set<string>
): MealAnalysis {
  const result: MealAnalysis = {
    earliestExpiration: null,
    expiringIngredientName: null,
    expiredIngredientNames: new Set(),
    expiringSoonIngredientNames: new Set(),
    maxIngredientCounter: null,
    maxCounterName: null,
    earliestCounterDate: null,
    counterIngredientNames: new Set(),
  };

  if (!meal.ingredients?.trim()) return result;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMs = today.getTime();
  const soonDate = new Date(today);
  soonDate.setDate(soonDate.getDate() + 7);
  const soonMs = soonDate.getTime();

  const groups = parseIngredientGroups(meal.ingredients);
  let earliestSoonDate: string | null = null;
  let earliestSoonName: string | null = null;

  for (const group of groups) {
    for (const alt of group) {
      for (const fi of lookupFoodItems(alt.name, foodItems, index)) {
        if (skipIds?.has(fi.id)) continue;
        // Expiration analysis
        if (fi.expiration_date) {
          if (!result.earliestExpiration || fi.expiration_date < result.earliestExpiration) {
            result.earliestExpiration = fi.expiration_date;
            result.expiringIngredientName = alt.name;
          }
          const parts = fi.expiration_date.split('-');
          const expMs = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).getTime();
          if (expMs <= todayMs) {
            result.expiredIngredientNames.add(normalizeKey(alt.name));
          } else if (expMs <= soonMs) {
            if (!earliestSoonDate || fi.expiration_date < earliestSoonDate) {
              earliestSoonDate = fi.expiration_date;
              earliestSoonName = normalizeKey(alt.name);
            }
          }
        }
        // Counter analysis
        if (fi.counter_start_date) {
          const days = computeCounterDays(fi.counter_start_date);
          if (days !== null) {
            if (result.maxIngredientCounter === null || days > result.maxIngredientCounter) {
              result.maxIngredientCounter = days;
              result.maxCounterName = fi.name;
            }
            if (!result.earliestCounterDate || fi.counter_start_date < result.earliestCounterDate) {
              result.earliestCounterDate = fi.counter_start_date;
            }
            result.counterIngredientNames.add(normalizeKey(alt.name));
          }
        }
      }
    }
  }

  if (earliestSoonName) result.expiringSoonIngredientNames.add(earliestSoonName);
  return result;
}

// Legacy single-purpose functions removed — all consumers now use analyzeMealIngredients()


export function getMissingIngredients(meal: Meal, stockMap: Map<string, StockInfo>): Set<string> {
  const missing = new Set<string>();
  if (!meal.ingredients?.trim()) return missing;
  const groups = parseIngredientGroups(meal.ingredients);
  for (const group of groups) {
    // Skip optional groups
    if (group[0]?.optional) continue;
    let groupSatisfied = false;
    for (const alt of group) {
      const key = findStockKey(stockMap, alt.name);
      if (key) {
        const stock = stockMap.get(key)!;
        if (stock.infinite || (alt.count > 0 && stock.count >= alt.count) || (alt.qty > 0 && stock.grams >= alt.qty) || (alt.count === 0 && alt.qty === 0)) {
          groupSatisfied = true; break;
        }
      }
    }
    if (!groupSatisfied) for (const alt of group) missing.add(normalizeKey(alt.name));
  }
  return missing;
}

export function isFoodUsedInMeals(fi: FoodItem, mealsToCheck: Meal[]): boolean {
  const fiKey = normalizeForMatch(fi.name);
  return mealsToCheck.some(meal => {
    if (!meal.ingredients) return false;
    return parseIngredientGroups(meal.ingredients).some(group => group.some(alt => strictNameMatch(fiKey, alt.name)));
  });
}

// ─── Inverted Index: ingredient key → meal IDs ──────────────────────────────

export type IngredientMealIndex = Map<string, Set<string>>;

/** Build a reverse lookup: normalized ingredient key → set of meal IDs that use it */
export function buildIngredientMealIndex(meals: Meal[]): IngredientMealIndex {
  const idx = new Map<string, Set<string>>();
  for (const meal of meals) {
    if (!meal.ingredients?.trim()) continue;
    const groups = parseIngredientGroups(meal.ingredients);
    for (const group of groups) {
      for (const alt of group) {
        const key = normalizeKey(alt.name);
        let set = idx.get(key);
        if (!set) { set = new Set(); idx.set(key, set); }
        set.add(meal.id);
      }
    }
  }
  return idx;
}

// ─── Shared Display Helpers ──────────────────────────────────────────────────

/** Parse a raw calorie/protein string like "350 kcal" → 350 */
export function parseMacroDisplay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Get displayed calories for a Meal (ingredient-computed takes priority) */
export function getDisplayedCalories(meal: { calories?: string | null; ingredients?: string | null }): number | null {
  const ingCal = computeIngredientCalories(meal.ingredients ?? null);
  if (ingCal !== null && Number.isFinite(ingCal)) return ingCal;
  return parseMacroDisplay(meal.calories);
}

/** Get displayed protein for a Meal (ingredient-computed takes priority) */
export function getDisplayedProtein(meal: { protein?: string | null; ingredients?: string | null }): number | null {
  const ingPro = computeIngredientProtein(meal.ingredients ?? null);
  if (ingPro !== null && Number.isFinite(ingPro)) return ingPro;
  const raw = parseMacroDisplay(meal.protein);
  return raw !== null ? Math.round(raw) : null;
}

/** Get displayed calories for a PossibleMeal (uses ingredients_override if present) */
export function getDisplayedPMCalories(pm: { ingredients_override?: string | null; meals?: { calories?: string | null; ingredients?: string | null } | null }): number | null {
  const ingredients = pm.ingredients_override ?? pm.meals?.ingredients;
  const ingCal = computeIngredientCalories(ingredients ?? null);
  if (ingCal !== null && Number.isFinite(ingCal)) return ingCal;
  return parseMacroDisplay(pm.meals?.calories);
}

// ─── Formatting & Sorting ───────────────────────────────────────────────────

export function formatExpirationLabel(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try { return format(parseISO(dateStr), 'd MMM', { locale: fr }); } catch { return null; }
}

export function compareExpirationWithCounter(
  aDate: string | null, bDate: string | null,
  aCounter: number | null, bCounter: number | null
): number {
  const aEffective = aCounter !== null && aCounter > 0;
  const bEffective = bCounter !== null && bCounter > 0;

  // Groups: 0=active counter, 1=no date & no counter (top), 2=has date, 3=has counter=0 but no date
  const aGroup = aEffective ? 0 : (!aDate && aCounter === null ? 1 : (!!aDate ? 2 : 3));
  const bGroup = bEffective ? 0 : (!bDate && bCounter === null ? 1 : (!!bDate ? 2 : 3));

  if (aGroup !== bGroup) return aGroup - bGroup;
  if (aGroup === 0) {
    if (aCounter !== bCounter) return bCounter! - aCounter!;
    if (aDate && bDate) return aDate.localeCompare(bDate);
    if (aDate) return -1;
    if (bDate) return 1;
    return 0;
  }
  if (aGroup === 2) return aDate!.localeCompare(bDate!);
  return 0;
}

export function sortStockDeductionPriority(a: FoodItem, b: FoodItem): number {
  const aHas = !!a.counter_start_date;
  const bHas = !!b.counter_start_date;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  if (aHas && bHas) {
    const aD = computeCounterDays(a.counter_start_date!) ?? 0;
    const bD = computeCounterDays(b.counter_start_date!) ?? 0;
    if (aD !== bD) return bD - aD;
  }
  if (a.expiration_date && b.expiration_date) return a.expiration_date.localeCompare(b.expiration_date);
  if (a.expiration_date) return -1;
  if (b.expiration_date) return 1;
  return 0;
}

// ─── Meal Scaling ───────────────────────────────────────────────────────────

export function getValidDiscreteRatios(meal: Meal, stockMap?: Map<string, StockInfo>): number[] | null {
  if (!meal.ingredients?.trim()) return null;
  
  let validRatios: number[] | null = null;
  const EPSILON = 0.001;

  meal.ingredients.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean)
    .forEach(group => {
      const alt = group.split(/\|/).map(s => s.trim()).filter(Boolean)[0];
      if (!alt || alt.startsWith("?")) return;
      
      const { text: withoutMetrics } = extractMetrics(alt);
      const parsed = parseIngredientLineRaw(withoutMetrics);
      
      let isIndivisible = false;
      let myRatios: number[] = [];

      if (parsed.count > 0 && parsed.qty === 0) {
        isIndivisible = true;
        for (let k = 1; (k / parsed.count) <= 10; k++) {
          myRatios.push(k / parsed.count);
        }
      } else if (stockMap) {
        const key = findStockKey(stockMap, parsed.name);
        if (key) {
           const stock = stockMap.get(key)!;
           if (stock.indivisibleUnit > 0 && parsed.qty > 0) {
              isIndivisible = true;
              for (let k = 1; ((k * stock.indivisibleUnit) / parsed.qty) <= 10; k++) {
                myRatios.push((k * stock.indivisibleUnit) / parsed.qty);
              }
           }
        }
      }

      if (isIndivisible) {
        if (!myRatios.some(r => Math.abs(r - 1.0) < EPSILON)) myRatios.push(1.0);
        
        if (validRatios === null) {
          validRatios = myRatios;
        } else {
          validRatios = validRatios.filter(vr => myRatios.some(mr => Math.abs(vr - mr) < EPSILON));
        }
      }
    });

  if (validRatios !== null && validRatios.length === 0) {
    return [1.0];
  }

  return validRatios;
}

export function getIndivisibleConstrainedRatio(meal: Meal, requestedRatio: number, stockMap?: Map<string, StockInfo>): number {
  if (requestedRatio === 1) return 1;
  const validRatios = getValidDiscreteRatios(meal, stockMap);
  if (!validRatios) return requestedRatio;

  let best = validRatios[0];
  let minDiff = Math.abs(best - requestedRatio);
  for (const r of validRatios) {
    const diff = Math.abs(r - requestedRatio);
    if (diff < minDiff) {
      minDiff = diff;
      best = r;
    }
  }
  return best;
}

export function buildScaledMealForRatio(meal: Meal, ratio: number, stockMap?: Map<string, StockInfo>): Meal {
  const mealCal = meal.calories ? parseFloat(meal.calories.replace(/[^0-9.]/g, "")) : 0;
  const mealProt = meal.protein ? parseFloat(meal.protein.replace(/[^0-9.]/g, "")) : 0;
  const mealGrams = parseQty(meal.grams);
  return {
    ...meal,
    calories: meal.calories ? String(Math.round(mealCal * ratio)) : null,
    protein: meal.protein ? String(Math.round(mealProt * ratio)) : null,
    grams: meal.grams ? formatNumeric(Math.round(mealGrams * ratio * 10) / 10) : null,
    ingredients: scaleIngredientStringExact(meal.ingredients, ratio, stockMap),
  };
}

export function scaleIngredientStringExact(rawIngredients: string | null, ratio: number, stockMap?: Map<string, StockInfo>): string | null {
  if (!rawIngredients?.trim()) return null;
  
  // First pass: determine the effective ratio considering count-based rounding
  // If any count-based ingredient rounds up, all ingredients should use that rounded ratio
  let effectiveRatio = ratio;
  const groups = rawIngredients.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
  
  for (const group of groups) {
    const alt = group.split(/\|/).map(s => s.trim()).filter(Boolean)[0];
    if (!alt) continue;
    const isOptional = alt.startsWith("?");
    const cleanAlt = isOptional ? alt.slice(1).trim() : alt;
    const { text: withoutMetrics } = extractMetrics(cleanAlt);
    const parsed = parseIngredientLineRaw(withoutMetrics);
    
    if (parsed.count > 0 && parsed.qty === 0) {
      const scaledCount = Math.round(parsed.count * ratio);
      const actualRatio = scaledCount / parsed.count;
      if (Math.abs(actualRatio - ratio) > 0.001) {
        effectiveRatio = actualRatio;
      }
    }
  }
  
  return groups.map(group => {
      return group.split(/\|/).map(s => s.trim()).filter(Boolean)
        .map(alt => {
          const isOptional = alt.startsWith("?");
          const cleanAlt = isOptional ? alt.slice(1).trim() : alt;
          
          const { text: withoutMetrics, cal, pro } = extractMetrics(cleanAlt);
          const parsed = parseIngredientLineRaw(withoutMetrics);
          
          let scaledQtyRaw = parsed.qty > 0 ? parsed.qty * effectiveRatio : 0;
          let scaledCountRaw = parsed.count > 0 ? parsed.count * effectiveRatio : 0;

          if (parsed.count > 0 && parsed.qty === 0) {
            scaledCountRaw = Math.round(scaledCountRaw);
          }

          if (stockMap) {
            const key = findStockKey(stockMap, parsed.name);
            if (key) {
               const stock = stockMap.get(key)!;
               if (stock.indivisibleUnit > 0 && parsed.qty > 0) {
                  scaledQtyRaw = Math.round(scaledQtyRaw / stock.indivisibleUnit) * stock.indivisibleUnit;
               }
            }
          }

          const scaledQty = scaledQtyRaw > 0 ? formatNumeric(Math.round(scaledQtyRaw * 10) / 10) : "";
          const scaledCount = scaledCountRaw > 0 ? formatNumeric(Math.round(scaledCountRaw * 10) / 10) : "";
          
          let token = [scaledQty ? `${scaledQty}g` : "", scaledCount, parsed.rawName].filter(Boolean).join(" ");
          
          if (cal) token += ` {${cal}}`;
          if (pro) token += ` [${pro}]`;
          
          return isOptional ? `?${token}` : token;
        }).join(" | ");
    }).join(", ");
}

// ─── Macro Propagation Helper ───────────────────────────────────────────────

/**
 * Propagate ingredient macros (cal/pro) across all meals that share the same ingredients.
 * Returns an array of { id, ingredients } updates to apply via mutations.
 * Also returns the final ingredients for the source meal (auto-filled from others).
 */
export function propagateIngredientMacros(
  sourceMealId: string,
  newIngredients: string | null,
  allMeals: { id: string; ingredients: string | null }[]
): { sourceIngredients: string | null; updates: { id: string; ingredients: string }[] } {
  if (!newIngredients) return { sourceIngredients: newIngredients, updates: [] };

  const globalMacros = new Map<string, { cal: string; pro: string }>();
  for (const m of allMeals) {
    const ingStr = m.id === sourceMealId ? newIngredients : m.ingredients;
    if (!ingStr) continue;
    const mMacros = extractIngredientMacros(ingStr);
    for (const [key, val] of mMacros) {
      const existing = globalMacros.get(key);
      globalMacros.set(key, {
        cal: val.cal || existing?.cal || "",
        pro: val.pro || existing?.pro || "",
      });
    }
  }

  if (globalMacros.size === 0) return { sourceIngredients: newIngredients, updates: [] };

  const selfApplied = applyIngredientMacros(newIngredients, globalMacros);
  const sourceIngredients = selfApplied || newIngredients;

  const updates: { id: string; ingredients: string }[] = [];
  for (const m of allMeals) {
    if (m.id === sourceMealId || !m.ingredients) continue;
    const updated = applyIngredientMacros(m.ingredients, globalMacros);
    if (updated) updates.push({ id: m.id, ingredients: updated });
  }

  return { sourceIngredients, updates };
}
