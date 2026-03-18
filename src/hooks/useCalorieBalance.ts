import { useMemo } from 'react';
import { useMeals, DAYS, TIMES } from '@/hooks/useMeals';
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
  const DAILY_PROTEIN_GOAL = getPreference<number>('planning_daily_protein_goal', 150);

  const planningMeals = useMemo(() => possibleMeals.filter((pm) => {
    if (pm.meals?.category === "plat") return true;
    return !!pm.day_of_week && !!pm.meal_time;
  }), [possibleMeals]);

  const getMealsForSlot = (day: string, time: string) =>
    planningMeals.filter((pm) => pm.day_of_week === day && pm.meal_time === time);

  const getBreakfastForDay = (day: string) => {
    const mealId = breakfastSelections[day];
    if (!mealId) return null;
    return petitDejMeals.find((m) => m.id === mealId)
      || allMeals.find(m => m.id === mealId && m.category === 'petit_dejeuner')
      || null;
  };

  const getDayCalories = (day: string): number => {
    const mealCals = TIMES.reduce((total, time) => {
      const slotMeals = getMealsForSlot(day, time);
      if (slotMeals.length > 0) {
        return total + slotMeals.reduce((s, pm) => {
          const override = calOverrides[pm.id];
          if (override) return s + parseCalories(override);
          const displayIngredients = pm.ingredients_override ?? pm.meals?.ingredients;
          const ingCal = computeIngredientCalories(displayIngredients);
          if (ingCal !== null) return s + ingCal;
          return s + parseCalories(pm.meals?.calories);
        }, 0);
      }
      return total + (manualCalories[`${day}-${time}`] || 0);
    }, 0);

    const breakfast = getBreakfastForDay(day);
    const extra = extraCalories[day] || 0;
    // For breakfast calories, check possible meals for ingredient overrides first
    let breakfastCal = 0;
    if (breakfast) {
      const possiblePdj = possibleMeals.find(pm => pm.meal_id === breakfastSelections[day] && pm.meals?.category === 'petit_dejeuner');
      const breakfastIngredients = possiblePdj?.ingredients_override ?? breakfast.ingredients;
      const ingCal = computeIngredientCalories(breakfastIngredients);
      breakfastCal = ingCal !== null ? ingCal : parseCalories(breakfast.calories);
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
          if (ingPro !== null) return s + ingPro;
          return s + parseCalories(pm.meals?.protein);
        }, 0);
      }
      return total + (manualProteins[`${day}-${time}`] || 0);
    }, 0);

    const breakfast = getBreakfastForDay(day);
    const extra = extraProteins[day] || 0;
    let breakfastPro = 0;
    if (breakfast) {
      const possiblePdj = possibleMeals.find(pm => pm.meal_id === breakfastSelections[day] && pm.meals?.category === 'petit_dejeuner');
      const breakfastIngredients = possiblePdj?.ingredients_override ?? breakfast.ingredients;
      const ingPro = computeIngredientProtein(breakfastIngredients);
      breakfastPro = ingPro !== null ? ingPro : parseCalories(breakfast.protein);
    } else {
      breakfastPro = breakfastManualProteins[day] || 0;
    }

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
