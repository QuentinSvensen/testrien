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
  for (const key of stockMap.keys()) {
    if (strictNameMatch(key, name)) return key;
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

// ─── Ingredient Analysis ────────────────────────────────────────────────────

export function getEarliestIngredientExpiration(meal: Meal, foodItems: FoodItem[]): string | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  let earliest: string | null = null;
  for (const group of groups) for (const alt of group) for (const fi of foodItems) {
    if (strictNameMatch(fi.name, alt.name) && fi.expiration_date && (!earliest || fi.expiration_date < earliest))
      earliest = fi.expiration_date;
  }
  return earliest;
}

export function getExpiringIngredientName(meal: Meal, foodItems: FoodItem[]): string | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  let earliest: string | null = null;
  let name: string | null = null;
  for (const group of groups) for (const alt of group) for (const fi of foodItems) {
    if (strictNameMatch(fi.name, alt.name) && fi.expiration_date && (!earliest || fi.expiration_date < earliest)) {
      earliest = fi.expiration_date;
      name = alt.name;
    }
  }
  return name;
}

export function getExpiredIngredientNames(meal: Meal, foodItems: FoodItem[]): Set<string> {
  const expired = new Set<string>();
  if (!meal.ingredients?.trim()) return expired;
  const today = new Date(new Date().toDateString());
  const groups = parseIngredientGroups(meal.ingredients);
  for (const group of groups) for (const alt of group) for (const fi of foodItems) {
    if (strictNameMatch(fi.name, alt.name) && fi.expiration_date && new Date(fi.expiration_date) < today)
      expired.add(normalizeKey(alt.name));
  }
  return expired;
}

export function getMaxIngredientCounter(meal: Meal, foodItems: FoodItem[]): number | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  let maxDays: number | null = null;
  for (const group of groups) for (const alt of group) for (const fi of foodItems) {
    if (strictNameMatch(fi.name, alt.name) && fi.counter_start_date) {
      const days = Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000);
      if (maxDays === null || days > maxDays) maxDays = days;
    }
  }
  return maxDays;
}

export function getEarliestIngredientCounterDate(meal: Meal, foodItems: FoodItem[]): string | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  let earliest: string | null = null;
  for (const group of groups) for (const alt of group) for (const fi of foodItems) {
    if (strictNameMatch(fi.name, alt.name) && fi.counter_start_date) {
      if (!earliest || fi.counter_start_date < earliest) earliest = fi.counter_start_date;
    }
  }
  return earliest;
}

export function getMaxIngredientCounterName(meal: Meal, foodItems: FoodItem[]): string | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  let maxDays: number | null = null;
  let maxName: string | null = null;
  for (const group of groups) for (const alt of group) for (const fi of foodItems) {
    if (strictNameMatch(fi.name, alt.name) && fi.counter_start_date) {
      const days = Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000);
      if (maxDays === null || days > maxDays) { maxDays = days; maxName = fi.name; }
    }
  }
  return maxName;
}

export function getCounterIngredientNames(meal: Meal, foodItems: FoodItem[]): Set<string> {
  const result = new Set<string>();
  if (!meal.ingredients?.trim()) return result;
  const groups = parseIngredientGroups(meal.ingredients);
  for (const group of groups) for (const alt of group) for (const fi of foodItems) {
    if (strictNameMatch(fi.name, alt.name) && fi.counter_start_date) result.add(normalizeKey(alt.name));
  }
  return result;
}

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

  const aGroup = aEffective ? 0 : (!!aDate ? 1 : (aCounter !== null && aCounter === 0 ? 2 : 3));
  const bGroup = bEffective ? 0 : (!!bDate ? 1 : (bCounter !== null && bCounter === 0 ? 2 : 3));

  if (aGroup !== bGroup) return aGroup - bGroup;
  if (aGroup === 0) {
    if (aCounter !== bCounter) return bCounter! - aCounter!;
    if (aDate && bDate) return aDate.localeCompare(bDate);
    if (aDate) return -1;
    if (bDate) return 1;
    return 0;
  }
  if (aGroup === 1) return aDate!.localeCompare(bDate!);
  return 0;
}

export function sortStockDeductionPriority(a: FoodItem, b: FoodItem): number {
  const aHas = !!a.counter_start_date;
  const bHas = !!b.counter_start_date;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  if (aHas && bHas) {
    const aD = Math.floor((Date.now() - new Date(a.counter_start_date!).getTime()) / 86400000);
    const bD = Math.floor((Date.now() - new Date(b.counter_start_date!).getTime()) / 86400000);
    if (aD !== bD) return bD - aD;
  }
  if (a.expiration_date && b.expiration_date) return a.expiration_date.localeCompare(b.expiration_date);
  if (a.expiration_date) return -1;
  if (b.expiration_date) return 1;
  return 0;
}

// ─── Meal Scaling ───────────────────────────────────────────────────────────

export function buildScaledMealForRatio(meal: Meal, ratio: number): Meal {
  const mealCal = meal.calories ? parseFloat(meal.calories.replace(/[^0-9.]/g, "")) : 0;
  const mealProt = meal.protein ? parseFloat(meal.protein.replace(/[^0-9.]/g, "")) : 0;
  const mealGrams = parseQty(meal.grams);
  return {
    ...meal,
    calories: meal.calories ? String(Math.round(mealCal * ratio)) : null,
    protein: meal.protein ? String(Math.round(mealProt * ratio)) : null,
    grams: meal.grams ? formatNumeric(Math.round(mealGrams * ratio * 10) / 10) : null,
    ingredients: scaleIngredientStringExact(meal.ingredients, ratio),
  };
}

export function scaleIngredientStringExact(rawIngredients: string | null, ratio: number): string | null {
  if (!rawIngredients?.trim()) return null;
  return rawIngredients.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean)
    .map(group => {
      return group.split(/\|/).map(s => s.trim()).filter(Boolean)
        .map(alt => {
          const isOptional = alt.startsWith("?");
          const cleanAlt = isOptional ? alt.slice(1).trim() : alt;
          // Extract {cal} suffix before parsing
          const calMatch = cleanAlt.match(/\{(\d+(?:[.,]\d+)?)\}\s*$/);
          const calSuffix = calMatch ? `{${calMatch[1]}}` : "";
          const withoutCal = calMatch ? cleanAlt.slice(0, calMatch.index!).trim() : cleanAlt;
          const parsed = parseIngredientLineRaw(withoutCal);
          const scaledQty = parsed.qty > 0 ? formatNumeric(Math.round(parsed.qty * ratio * 10) / 10) : "";
          const scaledCount = parsed.count > 0 ? formatNumeric(Math.round(parsed.count * ratio * 10) / 10) : "";
          let token = [scaledQty ? `${scaledQty}g` : "", scaledCount, parsed.rawName].filter(Boolean).join(" ");
          if (calSuffix) token += calSuffix;
          return isOptional ? `?${token}` : token;
        }).join(" | ");
    }).join(", ");
}
