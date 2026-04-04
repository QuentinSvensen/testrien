/**
 * Fonctions d'analyse de stock et utilitaires pour les repas.
 * 
 * Ce module centralise :
 * - Construction de la carte des stocks (buildStockMap) pour un accès O(1)
 * - Index inversé aliment → repas (buildFoodItemIndex, buildIngredientMealIndex)
 * - Analyse complète des ingrédients d'un repas (expiration, compteurs, disponibilité)
 * - Calcul des macros affichées (calories, protéines) avec logique additive
 * - Tri et mise à l'échelle (scaling) des ingrédients
 * - Propagation des macros entre repas partageant les mêmes ingrédients
 * 
 * Extrait de Index.tsx pour la réutilisabilité et la maintenabilité.
 */

import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";
import {
  normalizeForMatch, normalizeKey, strictNameMatch,
  parseQty, parsePartialQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientLine, parseIngredientLineRaw, parseIngredientGroups,
  extractMetrics, computeIngredientCalories, computeIngredientProtein,
  extractIngredientMacros, applyIngredientMacros,
  computeCounterDays, isActiveFoodItem,
  type ParsedIngredient,
} from "@/lib/ingredientUtils";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

// Réexporter les fonctions fréquemment utilisées pour un import centralisé
export {
  normalizeForMatch, normalizeKey, strictNameMatch,
  parseQty, parsePartialQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientLine, parseIngredientGroups,
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 : Index des aliments (accès O(1) par nom normalisé)
// ═══════════════════════════════════════════════════════════════════════════════

export type FoodItemIndex = Map<string, FoodItem[]>;

/** Construit un index par nom normalisé pour un accès O(1) aux aliments */
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

/**
 * Recherche d'aliments par nom normalisé : d'abord exact O(1), puis fuzzy en fallback.
 * Utilisé en interne par analyzeMealIngredients.
 */
function lookupFoodItems(name: string, foodItems: FoodItem[], index?: FoodItemIndex): FoodItem[] {
  if (index) {
    const exact = index.get(normalizeKey(name));
    if (exact && exact.length > 0) return exact;
    // Fallback fuzzy pour tolérer les typos
    const results: FoodItem[] = [];
    for (const [, items] of index) {
      if (items.length > 0 && strictNameMatch(items[0].name, name)) {
        results.push(...items);
      }
    }
    return results.filter(isActiveFoodItem);
  }
  return foodItems.filter(fi => strictNameMatch(fi.name, name) && isActiveFoodItem(fi));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 : Carte des stocks (StockMap)
// ═══════════════════════════════════════════════════════════════════════════════

/** Informations de stock agrégées pour un aliment donné */
export interface StockInfo { grams: number; count: number; infinite: boolean; indivisibleUnit: number; }

/**
 * Construit une Map nom_normalisé → StockInfo à partir de la liste des aliments.
 * Agrège les grammes, quantités et flags de tous les items portant le même nom.
 */
export function buildStockMap(foodItems: FoodItem[]): Map<string, StockInfo> {
  const map = new Map<string, StockInfo>();
  for (const fi of foodItems) {
    if (!isActiveFoodItem(fi)) continue;
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

/** Trouve la clé normalisée dans la stockMap pour un nom d'ingrédient donné */
export function findStockKey(stockMap: Map<string, StockInfo>, name: string): string | null {
  const key = normalizeKey(name);
  if (stockMap.has(key)) return key;
  for (const k of stockMap.keys()) {
    if (strictNameMatch(k, name)) return k;
  }
  return null;
}

/**
 * Choisit la meilleure alternative parmi un groupe d'ingrédients OR.
 * Priorise l'alternative qui est en stock suffisant.
 */
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 : Disponibilité des repas
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcule le nombre de fois qu'un repas peut être préparé avec le stock actuel.
 * Retourne null si aucun ingrédient requis n'est trouvé, Infinity si tout est infini.
 */
export function getMealMultiple(meal: Meal, stockMap: Map<string, StockInfo>): number | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  if (groups.length === 0) return null;
  let multiple = Infinity;

  for (const group of groups) {
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
  const hasRequired = groups.some(g => !g[0]?.optional);
  if (!hasRequired) return null;
  return multiple === Infinity ? Infinity : multiple;
}

/**
 * Calcule le ratio fractionnaire maximal (entre 0.5 et 1.0) pour une portion partielle.
 * Utilisé quand un repas n'est pas faisable à 100% mais qu'une portion réduite l'est.
 * Tient compte des ingrédients indivisibles pour arrondir le ratio.
 */
export function getMealFractionalRatio(meal: Meal, stockMap: Map<string, StockInfo>): number | null {
  if (!meal.ingredients?.trim()) return null;
  const groups = parseIngredientGroups(meal.ingredients);
  if (groups.length === 0) return null;
  let minRatio = Infinity;

  for (const group of groups) {
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

  const hasRequired = groups.some(g => !g[0]?.optional);
  if (!hasRequired) return null;

  // Arrondir le ratio pour les ingrédients indivisibles
  for (const group of groups) {
    if (group[0]?.optional) continue;
    for (const alt of group) {
      const key = findStockKey(stockMap, alt.name);
      if (!key) continue;
      const stock = stockMap.get(key)!;

      // Cas 1 : Ingrédients pesés marqués comme indivisibles (ex: steaks 150g)
      if (stock.indivisibleUnit > 0 && alt.qty > 0) {
        const neededAtRatio = alt.qty * minRatio;
        const snapped = Math.floor(neededAtRatio / stock.indivisibleUnit + 0.01) * stock.indivisibleUnit;
        if (snapped <= 0) return null;
        const snappedRatio = snapped / alt.qty;
        minRatio = Math.min(minRatio, snappedRatio);
      }

      // Cas 2 : Ingrédients comptés par unité (ex: œufs)
      if (alt.count > 0 && alt.qty === 0) {
        const neededAtRatio = alt.count * minRatio;
        // On exige que le résultat soit un entier (ex: pas de 0.5 oeuf)
        const snappedCount = Math.floor(neededAtRatio + 0.01);
        if (snappedCount <= 0) return null;
        const snappedRatio = snappedCount / alt.count;
        minRatio = Math.min(minRatio, snappedRatio);
      }
    }
  }

  if (minRatio === Infinity || minRatio >= 1 || minRatio < 0.5) return null;
  return minRatio;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 : Analyse consolidée d'un repas (single pass)
// ═══════════════════════════════════════════════════════════════════════════════

/** Résultat de l'analyse complète des ingrédients d'un repas */
export interface MealAnalysis {
  /** Date de péremption la plus proche parmi les ingrédients */
  earliestExpiration: string | null;
  /** Nom de l'ingrédient ayant la péremption la plus proche */
  expiringIngredientName: string | null;
  /** Noms des ingrédients déjà périmés */
  expiredIngredientNames: Set<string>;
  /** Noms des ingrédients périssant sous 7 jours */
  expiringSoonIngredientNames: Set<string>;
  /** Nombre max de jours d'ouverture parmi les ingrédients */
  maxIngredientCounter: number | null;
  /** Nom de l'ingrédient avec le compteur le plus élevé */
  maxCounterName: string | null;
  /** Date de début du compteur le plus ancien */
  earliestCounterDate: string | null;
  /** Noms des ingrédients ayant un compteur actif */
  counterIngredientNames: Set<string>;
  /** Vrai si au moins un ingrédient peut avoir un compteur (non surgelé, non no_counter) */
  hasCounterableIngredient: boolean;
}

/**
 * Analyse TOUS les aspects des ingrédients d'un repas en une seule traversée.
 * Remplace 6+ appels séparés qui re-parsaient et re-itéraient chacun.
 * 
 * Vérifie pour chaque ingrédient :
 * 1. Péremption : date la plus proche, périmé ou bientôt périmé
 * 2. Compteur d'ouverture : date la plus ancienne, jours max
 * 3. Capacité compteur : au moins un ingrédient peut-il être "ouvert"
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
    hasCounterableIngredient: false,
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

        // Ignorer les items vides/finis
        const count = fi.quantity ?? 1;
        const grams = getFoodItemTotalGrams(fi);
        const isFinished = !fi.is_infinite && grams <= 0 && count <= 0;
        if (isFinished) continue;

        // --- Analyse de péremption ---
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

        // --- Analyse du compteur d'ouverture ---
        if (fi.counter_start_date) {
          const days = computeCounterDays(fi.counter_start_date);
          if (days !== null) {
            if (result.maxIngredientCounter === null || days > result.maxIngredientCounter) {
              result.maxIngredientCounter = days;
              result.maxCounterName = fi.name;
            }
            result.counterIngredientNames.add(normalizeKey(alt.name));
          }
          // Toujours collecter la date la plus ancienne pour le calcul d'offset dans le planning
          if (!result.earliestCounterDate || fi.counter_start_date < result.earliestCounterDate) {
            result.earliestCounterDate = fi.counter_start_date;
          }
        }

        // --- Vérifier si l'aliment peut avoir un compteur ---
        if (fi.storage_type !== 'surgele' && !fi.no_counter) {
          result.hasCounterableIngredient = true;
        }
      }
    }
  }

  if (earliestSoonName) result.expiringSoonIngredientNames.add(earliestSoonName);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 : Ingrédients manquants et utilisation
// ═══════════════════════════════════════════════════════════════════════════════

/** Retourne l'ensemble des noms d'ingrédients manquants en stock pour un repas */
export function getMissingIngredients(meal: Meal, stockMap: Map<string, StockInfo>): Set<string> {
  const missing = new Set<string>();
  if (!meal.ingredients?.trim()) return missing;
  const groups = parseIngredientGroups(meal.ingredients);
  for (const group of groups) {
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

/** Vérifie si un aliment est utilisé dans au moins un des repas spécifiés */
export function isFoodUsedInMeals(fi: FoodItem, mealsToCheck: Meal[]): boolean {
  const fiKey = normalizeForMatch(fi.name);
  return mealsToCheck.some(meal => {
    if (!meal.ingredients) return false;
    return parseIngredientGroups(meal.ingredients).some(group => group.some(alt => strictNameMatch(fiKey, alt.name)));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 : Index inversé ingrédient → repas
// ═══════════════════════════════════════════════════════════════════════════════

export type IngredientMealIndex = Map<string, Set<string>>;

/** Construit un index inversé : clé_ingrédient_normalisée → ensemble des IDs de repas l'utilisant */
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 : Calcul des macros affichées
// ═══════════════════════════════════════════════════════════════════════════════

/** Parse une valeur brute de calories/protéines (ex: "350 kcal" → 350) */
export function parseMacroDisplay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Calcule les calories affichées pour un repas.
 * 
 * Logique de priorité :
 * 1. Si les ingrédients ont des macros → les utiliser (computeIngredientCalories)
 * 2. Sinon → utiliser la valeur de base du repas (meal.calories)
 * 3. Mode additif : si le repas de base n'a PAS d'ingrédients mais A des macros,
 *    et qu'on a un override d'ingrédients → additionner les deux
 */
export function getDisplayedCalories(meal: { calories?: string | null; ingredients?: string | null }, ingredientsOverride?: string | null, ratio?: number, isAvailable?: (name: string) => boolean): number | null {
  const baseCal = parseMacroDisplay(meal.calories);
  const scaledBaseCal = (baseCal !== null && ratio) ? baseCal * ratio : baseCal;

  const ingredients = ingredientsOverride ?? meal.ingredients;
  const ingCal = computeIngredientCalories(ingredients ?? null, isAvailable);

  // Mode additif : override d'ingrédients + repas de base sans ingrédients mais avec macros
  if (ingredientsOverride && !meal.ingredients && baseCal !== null) {
    return (scaledBaseCal || 0) + (ingCal || 0);
  }

  if (ingCal !== null && Number.isFinite(ingCal)) return ingCal;
  return scaledBaseCal;
}

/** Calcule les protéines affichées pour un repas (même logique que getDisplayedCalories) */
export function getDisplayedProtein(meal: { protein?: string | null; ingredients?: string | null }, ingredientsOverride?: string | null, ratio?: number, isAvailable?: (name: string) => boolean): number | null {
  const basePro = parseMacroDisplay(meal.protein);
  const scaledBasePro = (basePro !== null && ratio) ? basePro * ratio : basePro;

  const ingredients = ingredientsOverride ?? meal.ingredients;
  const ingPro = computeIngredientProtein(ingredients ?? null, isAvailable);

  if (ingredientsOverride && !meal.ingredients && basePro !== null) {
    const total = (scaledBasePro || 0) + (ingPro || 0);
    return Math.round(total);
  }

  if (ingPro !== null && Number.isFinite(ingPro)) return Math.round(ingPro);
  return scaledBasePro !== null ? Math.round(scaledBasePro) : null;
}

/** Calories affichées pour une instance PossibleMeal (utilise ingredients_override si présent) */
export function getDisplayedPMCalories(pm: { ingredients_override?: string | null; meals?: { calories?: string | null; ingredients?: string | null } | null }, ratio?: number): number | null {
  return getDisplayedCalories(pm.meals || {}, pm.ingredients_override, ratio);
}

/** Protéines affichées pour une instance PossibleMeal (utilise ingredients_override si présent) */
export function getDisplayedPMProtein(pm: { ingredients_override?: string | null; meals?: { protein?: string | null; ingredients?: string | null } | null }, ratio?: number): number | null {
  return getDisplayedProtein(pm.meals || {}, pm.ingredients_override, ratio);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 : Formatage et tri
// ═══════════════════════════════════════════════════════════════════════════════

/** Formate une date d'expiration en label court (ex: "15 mars") */
export function formatExpirationLabel(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try { return format(parseISO(dateStr), 'd MMM', { locale: fr }); } catch { return null; }
}

/**
 * Compare deux items pour le tri par expiration+compteur.
 * Groupes de priorité : 0=compteur actif, 1=sans date ni compteur, 2=avec date
 */
export function compareExpirationWithCounter(
  aDate: string | null, bDate: string | null,
  aCounter: number | null, bCounter: number | null
): number {
  const aEffective = aCounter !== null && aCounter > 0;
  const bEffective = bCounter !== null && bCounter > 0;

  const aGroup = aEffective ? 0 : (!aDate && (aCounter === null || aCounter === 0) ? 1 : 2);
  const bGroup = bEffective ? 0 : (!bDate && (bCounter === null || bCounter === 0) ? 1 : 2);

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

/**
 * Tri de priorité pour la déduction de stock : les items déjà ouverts (avec compteur)
 * sont consommés en premier, puis ceux avec la date de péremption la plus proche.
 */
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9 : Mise à l'échelle (scaling) des repas
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calcule les ratios de scaling valides pour un repas avec des ingrédients indivisibles.
 * Ex: si une recette demande 2 œufs, les ratios valides sont 0.5, 1, 1.5, 2, etc.
 * Retourne null si aucun ingrédient indivisible n'est trouvé.
 */
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

      // Ingrédient compté (ex: "2 oeufs") → ratios = multiples de 1/count
      if (parsed.count > 0 && parsed.qty === 0) {
        isIndivisible = true;
        for (let k = 1; (k / parsed.count) <= 10; k++) {
          myRatios.push(k / parsed.count);
        }
      } else if (stockMap) {
        // Ingrédient indivisible en stock (marqué is_indivisible)
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
          // Intersection des ratios valides entre tous les ingrédients indivisibles
          validRatios = validRatios.filter(vr => myRatios.some(mr => Math.abs(vr - mr) < EPSILON));
        }
      }
    });

  if (validRatios !== null && validRatios.length === 0) return [1.0];
  return validRatios;
}

/** Arrondit un ratio demandé au ratio discret valide le plus proche */
export function getIndivisibleConstrainedRatio(meal: Meal, requestedRatio: number, stockMap?: Map<string, StockInfo>): number {
  if (requestedRatio === 1) return 1;
  const validRatios = getValidDiscreteRatios(meal, stockMap);
  if (!validRatios) return requestedRatio;

  let best = validRatios[0];
  let minDiff = Math.abs(best - requestedRatio);
  for (const r of validRatios) {
    const diff = Math.abs(r - requestedRatio);
    if (diff < minDiff) { minDiff = diff; best = r; }
  }
  return best;
}

/** Construit un repas mis à l'échelle (calories, protéines, grammes, ingrédients multipliés par ratio) */
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

/**
 * Multiplie toutes les quantités d'une chaîne d'ingrédients par un ratio.
 * 
 * Gère :
 * - Les alternatives (A | B) : chaque alternative est scalée
 * - Les ingrédients optionnels (?) : scalés aussi
 * - Les comptages arrondis : "2 oeufs" × 1.5 → "3 oeufs"
 * - Les ingrédients indivisibles : arrondis au multiple de l'unité
 * - Les macros {cal} et [pro] : préservées telles quelles
 */
export function scaleIngredientStringExact(rawIngredients: string | null, ratio: number, stockMap?: Map<string, StockInfo>): string | null {
  if (!rawIngredients?.trim()) return null;

  // Première passe : déterminer le ratio effectif en tenant compte des arrondis de comptage
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

  // Deuxième passe : appliquer le ratio effectif à tous les ingrédients
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

        // Arrondir au multiple de l'unité indivisible si applicable
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

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10 : Propagation des macros entre repas
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Propage les macros d'ingrédients (cal/pro) entre tous les repas partageant les mêmes ingrédients.
 * 
 * Quand l'utilisateur met à jour les macros d'un ingrédient dans un repas,
 * cette fonction :
 * 1. Collecte toutes les macros de tous les repas dans un dictionnaire global
 * 2. Applique ce dictionnaire au repas source (auto-complète les macros manquantes)
 * 3. Applique ce dictionnaire à tous les autres repas partageant les mêmes ingrédients
 * 
 * Retourne les mises à jour à appliquer via mutations.
 */
export function propagateIngredientMacros(
  sourceMealId: string,
  newIngredients: string | null,
  allMeals: { id: string; ingredients: string | null }[]
): { sourceIngredients: string | null; updates: { id: string; ingredients: string }[] } {
  if (!newIngredients) return { sourceIngredients: newIngredients, updates: [] };

  // Construire le dictionnaire global de macros depuis tous les repas
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

  // Appliquer au repas source
  const selfApplied = applyIngredientMacros(newIngredients, globalMacros);
  const sourceIngredients = selfApplied || newIngredients;

  // Appliquer aux autres repas
  const updates: { id: string; ingredients: string }[] = [];
  for (const m of allMeals) {
    if (m.id === sourceMealId || !m.ingredients) continue;
    const updated = applyIngredientMacros(m.ingredients, globalMacros);
    if (updated) updates.push({ id: m.id, ingredients: updated });
  }

  return { sourceIngredients, updates };
}
