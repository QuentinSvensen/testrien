import { useMemo } from 'react';
import { useMeals, DAYS, TIMES, type PossibleMeal, type Meal } from '@/hooks/useMeals';
import { usePreferences } from '@/hooks/usePreferences';
import { computeIngredientCalories, computeIngredientProtein } from '@/lib/ingredientUtils';

const DEFAULT_DAILY_GOAL = 2750;
const DRINK_CALORIES = 150;

const JS_DAY_TO_KEY: Record<number, string> = {
  1: "lundi",
  2: "mardi",
  3: "mercredi",
  4: "jeudi",
  5: "vendredi",
  6: "samedi",
  0: "dimanche",
};

const DAY_KEY_TO_INDEX: Record<string, number> = {
  lundi: 0, mardi: 1, mercredi: 2, jeudi: 3, vendredi: 4, samedi: 5, dimanche: 6,
};

function parseCalories(cal: string | null | undefined): number {
  if (!cal) return 0;
  const n = parseFloat(cal.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

/**
 * Detect the scale ratio between a meal's base ingredients/grams and its override.
 * Returns null if no meaningful ratio detected.
 */
export function getOverrideScaleRatio(
  meal: { ingredients: string | null; grams: string | null; name: string } | null | undefined,
  ingredientsOverride: string | null | undefined,
): number | null {
  if (!meal || !ingredientsOverride) return null;

  const baseIngStr = meal.ingredients
    ? meal.ingredients
    : (() => {
        const bg = parseFloat((meal.grams || "0").replace(/[^0-9.,]/g, "").replace(",", ".")) || 0;
        return bg > 0 ? `${bg}g ${meal.name}` : `1 ${meal.name}`;
      })();

  const origGroups = baseIngStr.split(/(?:\n|,(?!\d))/).map((s) => s.trim()).filter(Boolean);
  const overGroups = ingredientsOverride.split(/(?:\n|,(?!\d))/).map((s) => s.trim()).filter(Boolean);
  if (origGroups.length === 0) return null;

  const ratios: number[] = [];
  for (let i = 0; i < Math.min(origGroups.length, overGroups.length); i++) {
    const origAlt = origGroups[i].split(/\|/)[0].trim();
    const overAlt = overGroups[i].split(/\|/)[0].trim();
    if (origAlt.startsWith("?")) continue;

    const origMatch = origAlt.match(/^(\d+(?:[.,]\d+)?)\s*(?:g|gr|grammes?|kg|ml|cl|l)\s/i);
    const overMatch = overAlt.match(/^(\d+(?:[.,]\d+)?)\s*(?:g|gr|grammes?|kg|ml|cl|l)\s/i);
    if (origMatch && overMatch) {
      const oq = parseFloat(origMatch[1].replace(",", "."));
      const nq = parseFloat(overMatch[1].replace(",", "."));
      if (oq > 0 && nq > 0) { ratios.push(nq / oq); continue; }
    }

    const origC = origAlt.match(/^(\d+(?:[.,]\d+)?)\s+\S/);
    const overC = overAlt.match(/^(\d+(?:[.,]\d+)?)\s+\S/);
    if (origC && overC && !origMatch && !overMatch) {
      const oc = parseFloat(origC[1].replace(",", "."));
      const nc = parseFloat(overC[1].replace(",", "."));
      if (oc > 0 && nc > 0) { ratios.push(nc / oc); continue; }
    }

    ratios.push(1);
  }

  if (ratios.length === 0) return null;
  const first = ratios[0];
  if (Math.abs(first - 1) <= 0.01) return null;
  if (!ratios.every((r) => Math.abs(r - first) / first < 0.05)) return null;
  return first;
}

/**
 * Compute the displayed calories for a single planning card.
 * This is the single source of truth — used by both WeeklyPlanning display and calorie totals.
 */
export function getCardDisplayCalories(
  pm: PossibleMeal,
  calOverride?: string | null,
  isAvailable?: (name: string) => boolean,
): number {
  const meal = pm.meals;
  if (!meal) return 0;
  const qty = pm.quantity ?? 1;

  // 1. Manual override on the planning card
  if (calOverride) return parseCalories(calOverride) * qty;

  // 2. Ingredient-computed calories (from ingredients_override or base ingredients)
  const displayIngredients = pm.ingredients_override ?? meal.ingredients;
  const ingCal = computeIngredientCalories(displayIngredients, isAvailable);
  if (ingCal !== null) return ingCal * qty;

  // 3. Base calories scaled by ratio
  const ratio = getOverrideScaleRatio(meal, pm.ingredients_override);
  const baseCal = parseCalories(meal.calories);
  const scaledCal = ratio !== null && baseCal > 0 ? Math.round(baseCal * ratio) : baseCal;
  return scaledCal * qty;
}

/**
 * Compute the displayed protein for a single planning card.
 */
export function getCardDisplayProtein(pm: PossibleMeal, isAvailable?: (name: string) => boolean): number {
  const meal = pm.meals;
  if (!meal) return 0;
  const qty = pm.quantity ?? 1;

  const displayIngredients = pm.ingredients_override ?? meal.ingredients;
  const ingPro = computeIngredientProtein(displayIngredients, isAvailable);
  if (ingPro !== null) return ingPro * qty;

  const ratio = getOverrideScaleRatio(meal, pm.ingredients_override);
  const basePro = parseCalories(meal.protein);
  const scaledPro = ratio !== null && basePro > 0 ? Math.round(basePro * ratio) : basePro;
  return scaledPro * qty;
}

export function useCalorieBalance() {
  const { meals: allMeals, possibleMeals, getMealsByCategory } = useMeals();
  const { getPreference } = usePreferences();

  const petitDejMeals = getMealsByCategory('petit_dejeuner');
  const breakfastSelections = getPreference<Record<string, string>>('planning_breakfast', {});
  const manualCalories = getPreference<Record<string, number>>('planning_manual_calories', {});
  const extraCalories = getPreference<Record<string, number>>('planning_extra_calories', {});
  const breakfastManualCalories = getPreference<Record<string, number>>('planning_breakfast_manual_calories', {});
  const drinkChecks = getPreference<Record<string, boolean>>('planning_drink_checks', {});
  const calOverrides = getPreference<Record<string, string>>('planning_cal_overrides', {});
  const DAILY_GOAL = getPreference<number>('planning_daily_goal', DEFAULT_DAILY_GOAL);
  const manualProteins = getPreference<Record<string, number>>('planning_manual_proteins', {});
  const extraProteins = getPreference<Record<string, number>>('planning_extra_proteins', {});
  const breakfastManualProteins = getPreference<Record<string, number>>('planning_breakfast_manual_proteins', {});
  const DAILY_PROTEIN_GOAL = getPreference<number>('planning_protein_goal', getPreference<number>('planning_daily_protein_goal', 150));

  const planningMeals = useMemo(() => possibleMeals.filter((pm) => {
    if (pm.meals?.category === "plat") return true;
    return !!pm.day_of_week && !!pm.meal_time;
  }), [possibleMeals]);

  const getMealsForSlot = (day: string, time: string) =>
    planningMeals.filter((pm) => pm.day_of_week === day && pm.meal_time === time);

  /** Resolve a breakfast selection ID to a Meal-like object.
   *  Supports both prefixed format (pm:xxx / meal:xxx) and legacy plain IDs. */
  const getBreakfastForDay = (day: string): Meal | null => {
    const selId = breakfastSelections[day];
    if (!selId) return null;

    // Prefixed format
    if (selId.startsWith('pm:')) {
      const pmId = selId.slice(3);
      const pm = possibleMeals.find(p => p.id === pmId);
      if (!pm?.meals) return null;
      // Return a meal-like object with overridden ingredients baked in
      const m = pm.meals;
      return { ...m, ingredients: pm.ingredients_override ?? m.ingredients } as Meal;
    }
    if (selId.startsWith('meal:')) {
      const mealId = selId.slice(5);
      return petitDejMeals.find(m => m.id === mealId)
        || allMeals.find(m => m.id === mealId && m.category === 'petit_dejeuner')
        || null;
    }

    // Legacy: plain meal ID (backwards compat)
    return petitDejMeals.find((m) => m.id === selId)
      || allMeals.find(m => m.id === selId && m.category === 'petit_dejeuner')
      || null;
  };

  const getDayCalories = (day: string): number => {
    // Sum displayed card calories for each slot
    const mealCals = TIMES.reduce((total, time) => {
      const slotMeals = getMealsForSlot(day, time);
      if (slotMeals.length > 0) {
        return total + slotMeals.reduce((s, pm) =>
          s + getCardDisplayCalories(pm, calOverrides[pm.id])
        , 0);
      }
      return total + (manualCalories[`${day}-${time}`] || 0);
    }, 0);

    const breakfast = getBreakfastForDay(day);
    const extra = extraCalories[day] || 0;
    let breakfastCal = 0;
    if (breakfast) {
      const selId = breakfastSelections[day];
      // If it's a possible meal selection, use card display calories (respects overrides)
      if (selId?.startsWith('pm:')) {
        const pmId = selId.slice(3);
        const possiblePdj = possibleMeals.find(pm => pm.id === pmId);
        breakfastCal = possiblePdj ? getCardDisplayCalories(possiblePdj) : parseCalories(breakfast.calories);
      } else {
        // Use ingredient-computed calories (consistent with picker display), fallback to meal.calories
        const ingCal = computeIngredientCalories(breakfast.ingredients);
        breakfastCal = ingCal !== null ? ingCal : parseCalories(breakfast.calories);
      }
    } else {
      breakfastCal = breakfastManualCalories[day] || 0;
    }
    const drinkCal = TIMES.reduce((sum, time) => sum + (drinkChecks[`${day}-${time}`] ? DRINK_CALORIES : 0), 0);

    return mealCals + breakfastCal + extra + drinkCal;
  };

  const getDayProtein = (day: string): number => {
    const mealPro = TIMES.reduce((total, time) => {
      const slotMeals = getMealsForSlot(day, time);
      if (slotMeals.length > 0) {
        return total + slotMeals.reduce((s, pm) => {
          const displayIngredients = pm.ingredients_override ?? pm.meals?.ingredients;
          const ingPro = computeIngredientProtein(displayIngredients);
          return s + (ingPro !== null ? ingPro : parseCalories(pm.meals?.protein));
        }, 0);
      }
      return total + (manualProteins[`${day}-${time}`] || 0);
    }, 0);

    const breakfast = getBreakfastForDay(day);
    let breakfastPro = 0;
    if (breakfast) {
      const selId = breakfastSelections[day];
      if (selId?.startsWith('pm:')) {
        const pmId = selId.slice(3);
        const possiblePdj = possibleMeals.find(pm => pm.id === pmId);
        breakfastPro = possiblePdj ? getCardDisplayProtein(possiblePdj) : parseCalories(breakfast.protein);
      } else {
        const ingPro = computeIngredientProtein(breakfast.ingredients);
        breakfastPro = ingPro !== null ? ingPro : parseCalories(breakfast.protein);
      }
    } else {
      breakfastPro = breakfastManualProteins[day] || 0;
    }
    const extra = extraProteins[day] || 0;

    return mealPro + breakfastPro + extra;
  };

  const getTargetCalorieThreshold = () => {
    const todayNum = new Date().getDay();
    const todayKey = JS_DAY_TO_KEY[todayNum];
    const todayIndex = DAY_KEY_TO_INDEX[todayKey];

    let differencesSum = 0;
    let daysCount = 0;

    for (let i = 0; i < todayIndex; i++) {
        const pastDayKey = DAYS[i];
        const consumed = getDayCalories(pastDayKey);
        if (consumed > 0) {
            differencesSum += (consumed - DAILY_GOAL);
            daysCount++;
        }
    }

    const avgDifference = daysCount > 0 ? (differencesSum / daysCount) : 0;
    const todayConsumed = getDayCalories(todayKey);
    const remainingToday = DAILY_GOAL - todayConsumed;
    const threshold = remainingToday - avgDifference;
    return Math.max(0, threshold);
  };

  const getRemainingProtein = () => {
    const todayNum = new Date().getDay();
    const todayKey = JS_DAY_TO_KEY[todayNum];
    const todayConsumed = getDayProtein(todayKey);
    return Math.max(0, DAILY_PROTEIN_GOAL - todayConsumed);
  };

  return { getDayCalories, getDayProtein, DAILY_GOAL, DAILY_PROTEIN_GOAL, getBreakfastForDay, getTargetCalorieThreshold, getRemainingProtein };
}
