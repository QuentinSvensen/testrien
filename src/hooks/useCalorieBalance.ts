import { useMemo } from 'react';
import { useMeals, DAYS, TIMES } from '@/hooks/useMeals';
import { usePreferences } from '@/hooks/usePreferences';
import { computeIngredientCalories } from '@/lib/ingredientUtils';

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
          const ingCal = computeIngredientCalories(pm.meals?.ingredients);
          if (ingCal !== null) return s + ingCal;
          return s + parseCalories(pm.meals?.calories);
        }, 0);
      }
      return total + (manualCalories[`${day}-${time}`] || 0);
    }, 0);

    const breakfast = getBreakfastForDay(day);
    const extra = extraCalories[day] || 0;
    const breakfastCal = breakfast ? parseCalories(breakfast.calories) : (breakfastManualCalories[day] || 0);
    const drinkCal = TIMES.reduce((sum, time) => sum + (drinkChecks[`${day}-${time}`] ? DRINK_CALORIES : 0), 0);

    return mealCals + breakfastCal + extra + drinkCal;
  };

  const getTargetCalorieThreshold = () => {
    const todayNum = new Date().getDay();
    const todayKey = JS_DAY_TO_KEY[todayNum];
    const todayIndex = DAY_KEY_TO_INDEX[todayKey];

    // Calcul de la moyenne des différences (Lundi inclus - aujourd'hui exclu)
    // On ne compte que les jours où il y a eu une certaine interaction (calories > 0)
    let differencesSum = 0;
    let daysCount = 0;

    for (let i = 0; i < todayIndex; i++) {
        const pastDayKey = DAYS[i];
        const consumed = getDayCalories(pastDayKey);
        
        // Si 0, on considère le jour comme non rempli, on l'ignore de la moyenne.
        if (consumed > 0) {
            differencesSum += (consumed - DAILY_GOAL);
            daysCount++;
        }
    }

    const avgDifference = daysCount > 0 ? (differencesSum / daysCount) : 0;
    const todayConsumed = getDayCalories(todayKey);
    const remainingToday = DAILY_GOAL - todayConsumed;

    // Seuil = Restant aujourd'hui - moyenneDesDiffs
    // Exemple : reste 700, diffMoyenne = -50 (donc on a moins mangé). Seuil => 700 - (-50) = 750
    const threshold = remainingToday - avgDifference;
    return Math.max(0, threshold);
  };

  return { getDayCalories, DAILY_GOAL, getBreakfastForDay, getTargetCalorieThreshold };
}
