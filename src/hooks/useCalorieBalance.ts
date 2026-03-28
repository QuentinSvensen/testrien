import { useMemo } from 'react';
import { format, startOfWeek, addDays } from 'date-fns';
import { useMeals, DAYS, TIMES, type PossibleMeal, type Meal } from '@/hooks/useMeals';
import { usePreferences } from '@/hooks/usePreferences';
import { computeIngredientCalories, computeIngredientProtein } from '@/lib/ingredientUtils';
import { getDisplayedPMCalories, getDisplayedPMProtein, getDisplayedCalories, getDisplayedProtein } from '@/lib/stockUtils';

import { useFoodItems } from "@/hooks/useFoodItems";

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

function parseProtein(prot: string | null | undefined): number {
  if (!prot) return 0;
  const n = parseFloat(prot.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : Math.round(n);
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

  // 2. Use centralized macro display function (handles additive total & scaling)
  const displayCal = getDisplayedPMCalories(pm, getOverrideScaleRatio(meal, pm.ingredients_override) ?? undefined);
  return (displayCal || 0) * qty;
}

/**
 * Compute the displayed protein for a single planning card.
 */
export function getCardDisplayProtein(pm: PossibleMeal, isAvailable?: (name: string) => boolean): number {
  const meal = pm.meals;
  if (!meal) return 0;
  const qty = pm.quantity ?? 1;

  // Use centralized macro display function (handles additive total & scaling)
  const displayPro = getDisplayedPMProtein(pm, getOverrideScaleRatio(meal, pm.ingredients_override) ?? undefined);
  return (displayPro || 0) * qty;
}

export function useCalorieBalance(isAvailable?: (name: string) => boolean) {
  const { meals: allMeals, possibleMeals, getMealsByCategory } = useMeals();
  const { getPreference } = usePreferences();
  const { items: foodItems } = useFoodItems();

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
  const DAILY_PROTEIN_GOAL = getPreference<number>('planning_protein_goal', getPreference<number>('planning_daily_protein_goal', 110));

  const planningMeals = useMemo(() => possibleMeals.filter((pm) => {
    if (pm.meals?.category === "plat") return true;
    return !!pm.day_of_week && !!pm.meal_time;
  }), [possibleMeals]);

  const getMealsForSlot = (dayKey: string, time: string, isoDate?: string) =>
    planningMeals.filter((pm) => 
      (pm.day_of_week === dayKey || (isoDate && pm.day_of_week === isoDate)) && 
      pm.meal_time === time
    );

  /** Resolve a breakfast selection ID to a Meal-like object.
   *  Supports both prefixed format (pm:xxx / meal:xxx) and legacy plain IDs. */
  const getBreakfastForDay = (dayKey: string, isoDate?: string): Meal | null => {
    const selId = (isoDate && breakfastSelections[isoDate]) || breakfastSelections[dayKey];
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

  const getDayCalories = (dayKey: string, isoDate?: string): number => {
    const mealCals = (['matin', ...TIMES] as string[]).reduce((total, time) => {
      const slotMeals = getMealsForSlot(dayKey, time, isoDate);
      if (slotMeals.length > 0) {
        return total + slotMeals.reduce((s, pm) =>
          s + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailable)
          , 0);
      }
      const manualKey = (isoDate && manualCalories[`${isoDate}-${time}`] !== undefined) ? `${isoDate}-${time}` : `${dayKey}-${time}`;
      return total + (manualCalories[manualKey] || 0);
    }, 0);

    const breakfast = getBreakfastForDay(dayKey, isoDate);
    let breakfastCal = 0;
    if (breakfast) {
      const selId = (isoDate && breakfastSelections[isoDate]) || breakfastSelections[dayKey];
      // If it's a possible meal selection, use card display calories (respects overrides)
      if (selId?.startsWith('pm:')) {
        const pmId = selId.slice(3);
        const possiblePdj = possibleMeals.find(pm => pm.id === pmId);
        if (possiblePdj && (possiblePdj.day_of_week === dayKey || (isoDate && possiblePdj.day_of_week === isoDate)) && possiblePdj.meal_time === 'matin') {
          // Already counted in mealCals via 'matin' slot calculations!
          breakfastCal = 0;
        } else {
          breakfastCal = possiblePdj ? getCardDisplayCalories(possiblePdj, undefined, isAvailable) : parseCalories(breakfast.calories);
        }
      } else {
        // Use ingredient-computed calories (consistent with picker display), fallback to meal.calories
        breakfastCal = getDisplayedCalories(breakfast, null, undefined, isAvailable) || 0;
      }
    } else {
      const manualKey = (isoDate && breakfastManualCalories[isoDate] !== undefined) ? isoDate : dayKey;
      breakfastCal = breakfastManualCalories[manualKey] || 0;
    }

    const manualExtraKey = (isoDate && extraCalories[isoDate] !== undefined) ? isoDate : dayKey;
    const extraManual = extraCalories[manualExtraKey] || 0;
    
    const extraSelections = getPreference<Record<string, string[]>>('planning_extra_selections', {});
    const selectionKey = (isoDate && extraSelections[isoDate] !== undefined) ? isoDate : dayKey;
    const selectedExtraIds = extraSelections[selectionKey] || [];
    const extraSelectedCal = selectedExtraIds.reduce((sum, id) => {
      const item = foodItems.find(fi => fi.id === id);
      return sum + parseCalories(item?.calories);
    }, 0);

    const drinkCal = TIMES.reduce((sum, time) => {
      const drinkKey = (isoDate && drinkChecks[`${isoDate}-${time}`] !== undefined) ? `${isoDate}-${time}` : `${dayKey}-${time}`;
      return sum + (drinkChecks[drinkKey] ? DRINK_CALORIES : 0);
    }, 0);

    return mealCals + breakfastCal + extraManual + extraSelectedCal + drinkCal;
  };

  const getDayProtein = (dayKey: string, isoDate?: string): number => {
    const mealPro = (['matin', ...TIMES] as string[]).reduce((total, time) => {
      const slotMeals = getMealsForSlot(dayKey, time, isoDate);
      if (slotMeals.length > 0) {
        return total + slotMeals.reduce((s, pm) => s + getCardDisplayProtein(pm, isAvailable), 0);
      }
      const manualKey = (isoDate && manualProteins[`${isoDate}-${time}`] !== undefined) ? `${isoDate}-${time}` : `${dayKey}-${time}`;
      return total + (manualProteins[manualKey] || 0);
    }, 0);

    const breakfast = getBreakfastForDay(dayKey, isoDate);
    let breakfastPro = 0;
    if (breakfast) {
      const selId = (isoDate && breakfastSelections[isoDate]) || breakfastSelections[dayKey];
      if (selId?.startsWith('pm:')) {
        const pmId = selId.slice(3);
        const possiblePdj = possibleMeals.find(pm => pm.id === pmId);
        if (possiblePdj && (possiblePdj.day_of_week === dayKey || (isoDate && possiblePdj.day_of_week === isoDate)) && possiblePdj.meal_time === 'matin') {
          // Already counted in mealPro via 'matin' slot calculations!
          breakfastPro = 0;
        } else {
          breakfastPro = possiblePdj ? getCardDisplayProtein(possiblePdj, isAvailable) : parseProtein(breakfast.protein);
        }
      } else {
        // Use ingredient-computed protein
        breakfastPro = getDisplayedProtein(breakfast, null, undefined, isAvailable) || 0;
      }
    } else {
      const manualKey = (isoDate && breakfastManualProteins[isoDate] !== undefined) ? isoDate : dayKey;
      breakfastPro = breakfastManualProteins[manualKey] || 0;
    }

    const manualExtraKey = (isoDate && extraProteins[isoDate] !== undefined) ? isoDate : dayKey;
    const extraManual = extraProteins[manualExtraKey] || 0;
    
    const extraSelections = getPreference<Record<string, string[]>>('planning_extra_selections', {});
    const selectionKey = (isoDate && extraSelections[isoDate] !== undefined) ? isoDate : dayKey;
    const selectedExtraIds = extraSelections[selectionKey] || [];
    const extraSelectedPro = selectedExtraIds.reduce((sum, id) => {
      const item = foodItems.find(fi => fi.id === id);
      return sum + parseProtein(item?.protein);
    }, 0);

    return mealPro + breakfastPro + extraManual + extraSelectedPro;
  };

  const getTargetCalorieThreshold = () => {
    const todayNum = new Date().getDay();
    const todayKey = JS_DAY_TO_KEY[todayNum];
    const todayIndex = DAY_KEY_TO_INDEX[todayKey];
    const currentStart = startOfWeek(new Date(), { weekStartsOn: 1 });

    let differencesSum = 0;
    let daysCount = 0;

    for (let i = 0; i < todayIndex; i++) {
      const pastDayKey = DAYS[i];
      const pastIso = format(addDays(currentStart, i), 'yyyy-MM-dd');
      const consumed = getDayCalories(pastDayKey, pastIso);
      if (consumed > 0) {
        differencesSum += (consumed - DAILY_GOAL);
        daysCount++;
      }
    }

    const avgDifference = daysCount > 0 ? (differencesSum / daysCount) : 0;
    const todayIso = format(new Date(), 'yyyy-MM-dd');
    const todayConsumed = getDayCalories(todayKey, todayIso);
    const remainingToday = DAILY_GOAL - todayConsumed;
    const threshold = remainingToday - avgDifference;
    return Math.max(0, threshold);
  };

  const getRemainingProtein = () => {
    const todayNum = new Date().getDay();
    const todayKey = JS_DAY_TO_KEY[todayNum];
    const todayIso = format(new Date(), 'yyyy-MM-dd');
    const todayConsumed = getDayProtein(todayKey, todayIso);
    return Math.max(0, DAILY_PROTEIN_GOAL - todayConsumed);
  };

  return { getDayCalories, getDayProtein, DAILY_GOAL, DAILY_PROTEIN_GOAL, getRecordSelectedExtraIds: (day: string) => (getPreference<Record<string, string[]>>('planning_extra_selections', {})[day] || []), getBreakfastForDay, getTargetCalorieThreshold, getRemainingProtein };
}
