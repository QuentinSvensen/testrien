import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useMeals, DAYS, TIMES, type PossibleMeal, type Meal } from "@/hooks/useMeals";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { usePreferences } from "@/hooks/usePreferences";
import { useCalorieBalance, getOverrideScaleRatio, getCardDisplayProtein, getCardDisplayCalories } from "@/hooks/useCalorieBalance";
import { Timer, Flame, Weight, Calendar, Lock, Plus, Thermometer, Sparkles, Zap, Hash } from "lucide-react";
import { computeIngredientCalories, computeIngredientProtein, cleanIngredientText, normalizeKey, hasNegativeMetric, getMealColor, getAdaptedCounterDays } from "@/lib/ingredientUtils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { format, parseISO, differenceInCalendarDays } from "date-fns";
import { fr } from "date-fns/locale";
import { Checkbox } from "@/components/ui/checkbox";
import { useFoodItems, type FoodItem } from "@/hooks/useFoodItems";
import { analyzeMealIngredients, buildStockMap, findStockKey, type StockInfo, getDisplayedCalories as getMealCal, getDisplayedProtein as getMealPro } from "@/lib/stockUtils";
import { useMealTransfers } from "@/hooks/useMealTransfers";

/** Additive planning input: click "+" to enter a value that gets added to current */
function PlanningInput({ storageKey, currentValue, onSave, placeholder, className }: {
  storageKey: string;
  currentValue: number;
  onSave: (val: number) => void;
  placeholder?: string;
  className?: string;
}) {
  const [addMode, setAddMode] = useState(false);
  const [tempVal, setTempVal] = useState("");
  const [editVal, setEditVal] = useState(String(currentValue || ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!addMode) setEditVal(String(currentValue || ""));
  }, [currentValue, addMode]);

  const commitAdd = () => {
    const raw = parseInt(tempVal) || 0;
    if (raw !== 0) onSave(currentValue + raw);
    setAddMode(false);
    setTempVal("");
  };

  const commitEdit = () => {
    const raw = parseInt(editVal) || 0;
    onSave(raw);
  };

  if (addMode) {
    return (
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="number"
          value={tempVal}
          onChange={(e) => setTempVal(e.target.value)}
          onBlur={commitAdd}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitAdd(); } }}
          placeholder={`+${placeholder || ""}`}
          className={className}
          autoFocus
        />
      </div>
    );
  }

  return (
    <div className="relative flex items-center">
      <input
        type="number"
        value={editVal}
        onChange={(e) => setEditVal(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } }}
        placeholder={placeholder}
        className={className}
      />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setAddMode(true); }}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-[9px] font-bold text-primary/60 hover:text-primary rounded"
        title="Ajouter"
      >+</button>
    </div>
  );
}

const DAY_LABELS: Record<string, string> = {
  lundi: "Lundi",
  mardi: "Mardi",
  mercredi: "Mercredi",
  jeudi: "Jeudi",
  vendredi: "Vendredi",
  samedi: "Samedi",
  dimanche: "Dimanche",
};

const TIME_LABELS: Record<string, string> = { midi: "Midi", soir: "Soir" };

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

/** Get the date for a given day key in the current week (Mon-Sun) */
function getDateForDayKey(dayKey: string, refDate: Date = new Date()): Date {
  const todayDow = refDate.getDay(); // 0=Sun
  const todayIdx = todayDow === 0 ? 6 : todayDow - 1; // 0=Mon
  const targetIdx = DAY_KEY_TO_INDEX[dayKey] ?? 0;
  const diff = targetIdx - todayIdx;
  const d = new Date(refDate);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

const DEFAULT_DAILY_GOAL = 2750;
const DEFAULT_WEEKLY_MULTIPLIER = 7;

// Calorie override key for planning cards
function calOverrideKey(pmId: string) { return `planning_cal_override_${pmId}`; }

function getCategoryEmoji(cat?: string) {
  switch (cat) {
    case "entree":
      return "🥗";
    case "plat":
      return "🍽️";
    case "dessert":
      return "🍰";
    case "bonus":
      return "⭐";
    default:
      return "🍴";
  }
}

function isExpiredDate(d: string | null) {
  if (!d) return false;
  return new Date(d) < new Date(new Date().toDateString());
}

/** Check if expired relative to target day */
function isExpiredOnDay(d: string | null, dayKey: string | null) {
  if (!d) return false;
  if (!dayKey) return isExpiredDate(d);
  const targetDate = getDateForDayKey(dayKey);
  return new Date(d) < targetDate;
}

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

const DAILY_PROTEIN_GOAL = 110;

interface TouchDragState {
  pmId: string;
  ghost: HTMLElement;
  startX: number;
  startY: number;
  origTop: number;
  origLeft: number;
}

// ─── PlanningMiniCard ────────────────────────────────────────────────────────
function PlanningMiniCard({ pm, meal, expired, counterDays, counterUrgent, isPast, displayCal, isComputedCal, displayPro, isComputedPro, compact, isTouchDevice, touchDragActive, slotDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onRemove, onCalorieChange, expiredIngredientNames, expiringSoonIngredientNames, onDoubleClick, stockMap }: {
  pm: PossibleMeal; meal: any; expired: boolean; counterDays: number | null; counterUrgent: boolean; isPast: boolean; displayCal: string | null; isComputedCal: boolean; displayPro: string | null; isComputedPro: boolean; compact: boolean;
  isTouchDevice: boolean; touchDragActive: boolean; slotDragOver: string | null;
  onDragStart: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void; onTouchMove: (e: React.TouchEvent) => void; onTouchEnd: (e: React.TouchEvent) => void; onTouchCancel: () => void;
  onRemove: () => void; onCalorieChange: (val: string | null) => void;
  expiredIngredientNames?: Set<string>;
  expiringSoonIngredientNames?: Set<string>;
  onDoubleClick?: () => void;
  stockMap?: Map<string, StockInfo>;
}) {
  const [editingCal, setEditingCal] = useState(false);
  const [calValue, setCalValue] = useState("");

  return (
    <div
      draggable={!isTouchDevice}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onDoubleClick={onDoubleClick}
      className={`rounded-xl text-white select-none
        ${touchDragActive ? "cursor-grabbing" : "cursor-grab active:cursor-grabbing"}
        transition-transform hover:scale-[1.01]
        ${expired ? "ring-[3px] ring-red-500 shadow-lg shadow-red-500/30" : ""}
        ${slotDragOver === pm.id ? "ring-2 ring-white/60" : ""}
        ${compact ? "px-1.5 py-0.5" : "px-1.5 py-0.5 sm:px-2 sm:py-1.5"}
      `}
      style={{ backgroundColor: getMealColor(meal.ingredients, meal.name) }}
    >
      {/* Mobile: vertical layout */}
      <div className="flex flex-col sm:hidden">
        <div className="flex items-start gap-1 min-w-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-[9px] opacity-70 shrink-0">{getCategoryEmoji(meal.category)}</span>
              <span className="font-semibold text-[10px] min-w-0 break-words leading-tight">{meal.name}</span>
            </div>
          </div>
          {!compact && (
            <div className="flex flex-col items-center shrink-0">
              {editingCal ? (
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  value={calValue}
                  onChange={(e) => setCalValue(e.target.value)}
                  onBlur={() => {
                    const trimmed = calValue.trim();
                    onCalorieChange(trimmed || null);
                    setEditingCal(false);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className="w-16 h-5 text-[11px] bg-white/20 border border-white/40 rounded px-1 text-white placeholder:text-white/40 focus:outline-none"
                  placeholder="kcal"
                />
              ) : displayCal ? (
                <button
                  onClick={() => { setCalValue(displayCal); setEditingCal(true); }}
                  className={`text-xs font-black text-white px-2 py-0.5 rounded-full flex items-center gap-0.5 ${isComputedCal ? "bg-orange-500/60 hover:bg-orange-500/70" : "bg-black/30 hover:bg-black/40"
                    }`}
                  title="Modifier les calories (temporaire)"
                >
                  <Flame className="h-3 w-3" />
                  {displayCal}
                </button>
              ) : (
                <button
                  onClick={() => { setCalValue(""); setEditingCal(true); }}
                  className="text-[10px] text-white/40 hover:text-white/60"
                  title="Ajouter des calories"
                >
                  <Flame className="h-3 w-3" />
                </button>
              )}
              {displayPro && (
                <span className={`text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full mt-0.5 flex items-center justify-center ${isComputedPro ? 'bg-blue-600/70' : 'bg-black/30'}`}>
                  🍗 {displayPro}
                </span>
              )}
              {counterDays !== null && counterDays >= 1 ? (
                <span
                  className={`text-[9px] font-black px-1.5 py-0.5 rounded-full mt-0.5 flex items-center gap-0.5 border
                  ${counterUrgent ? `bg-red-600 text-white border-red-300 shadow-md ${!isPast ? 'animate-pulse' : ''}` : "bg-black/50 text-white border-white/30"}`}
                >
                  <Timer className="h-2.5 w-2.5" />
                  {counterDays}j
                </span>
              ) : null}
            </div>
          )}
        </div>
        {!compact && (pm.expiration_date || meal.grams || pm.ingredients_override || meal.ingredients) && (
          <div className="mt-auto pt-0.5">
            {meal.grams && (
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-white/60 flex items-center gap-0.5">
                  <Weight className="h-2 w-2" />
                  {meal.grams}
                </span>
              </div>
            )}
            {(pm.ingredients_override || meal.ingredients || pm.expiration_date) && (
              <div className={`${meal.grams ? "mt-0.5" : ""} text-[9px] text-white/50 break-words whitespace-normal`}>
                {pm.expiration_date && (
                  <span className={`inline-flex items-center gap-0.5 mr-1 rounded px-1 py-0.5 border align-middle ${expired ? "text-red-200 font-bold border-red-300/40 bg-red-400/10" : "text-white/60 border-white/15 bg-white/5"}`}>
                    <Calendar className="h-2 w-2 inline" />
                    {format(parseISO(pm.expiration_date), "d MMM", { locale: fr })}
                  </span>
                )}
                {(pm.ingredients_override || meal.ingredients) && renderIngredientDisplayPlanning(pm.ingredients_override ?? meal.ingredients, expiredIngredientNames, expiringSoonIngredientNames, stockMap)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop: two-column layout — left (title + date at bottom), right (badges) */}
      <div className="hidden sm:flex items-stretch gap-1 min-w-0">
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-[11px] opacity-70 shrink-0">{getCategoryEmoji(meal.category)}</span>
            <span className="font-semibold text-xs min-w-0 break-words leading-tight">{meal.name}</span>
          </div>
          {!compact && (pm.expiration_date || meal.grams || pm.ingredients_override || meal.ingredients) && (
            <div className="pt-0.5">
              {meal.grams && (
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-white/60 flex items-center gap-0.5">
                    <Weight className="h-2 w-2" />
                    {meal.grams}
                  </span>
                </div>
              )}
              {pm.expiration_date && (
                <div className={`${meal.grams ? "mt-0.5" : ""} text-[9px]`}>
                  <span className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 border ${expired ? "text-red-300 font-bold border-red-400/50 bg-red-500/20" : "text-white/60 border-white/15 bg-white/5"}`}>
                    <Calendar className="h-2 w-2 inline" />
                    {format(parseISO(pm.expiration_date), "d MMM", { locale: fr })}
                  </span>
                </div>
              )}
              {(pm.ingredients_override || meal.ingredients) && (
                <div className={`${pm.expiration_date || meal.grams ? "mt-0.5" : ""} text-[9px] text-white/50 flex flex-wrap gap-x-1`}>
                  {renderIngredientDisplayPlanning(pm.ingredients_override ?? meal.ingredients, expiredIngredientNames, expiringSoonIngredientNames, stockMap)}
                </div>
              )}
            </div>
          )}
        </div>
        {!compact && (
          <div className="flex flex-col items-center shrink-0">
            {editingCal ? (
              <input
                autoFocus
                type="text"
                inputMode="numeric"
                value={calValue}
                onChange={(e) => setCalValue(e.target.value)}
                onBlur={() => {
                  const trimmed = calValue.trim();
                  onCalorieChange(trimmed || null);
                  setEditingCal(false);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="w-16 h-5 text-[11px] bg-white/20 border border-white/40 rounded px-1 text-white placeholder:text-white/40 focus:outline-none"
                placeholder="kcal"
              />
            ) : displayCal ? (
              <button
                onClick={() => { setCalValue(displayCal); setEditingCal(true); }}
                className={`text-xs font-black text-white px-2 py-0.5 rounded-full flex items-center gap-0.5 ${isComputedCal ? "bg-orange-500/60 hover:bg-orange-500/70" : "bg-black/30 hover:bg-black/40"
                  }`}
                title="Modifier les calories (temporaire)"
              >
                <Flame className="h-3 w-3" />
                {displayCal}
              </button>
            ) : (
              <button
                onClick={() => { setCalValue(""); setEditingCal(true); }}
                className="text-[10px] text-white/40 hover:text-white/60"
                title="Ajouter des calories"
              >
                <Flame className="h-3 w-3" />
              </button>
            )}
            {displayPro && (
              <span className={`text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full mt-0.5 flex items-center justify-center ${isComputedPro ? 'bg-blue-600/70' : 'bg-black/30'}`}>
                🍗 {displayPro}
              </span>
            )}
            {counterDays !== null && counterDays >= 1 && (
              <span
                className={`text-[9px] font-black px-1.5 py-0.5 rounded-full mt-0.5 flex items-center gap-0.5 border
                ${counterUrgent ? "bg-red-600 text-white border-red-300 shadow-md" : "bg-black/50 text-white border-white/30"}`}
              >
                <Timer className="h-2.5 w-2.5" />
                {counterDays}j
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function WeeklyPlanning() {
  const { possibleMeals, meals, updatePlanning, reorderPossibleMeals, getMealsByCategory } = useMeals();
  const qc = useQueryClient();
  const { getPreference, setPreference, isLoading: prefsLoading } = usePreferences();
  const { items: foodItems } = useFoodItems();
  const stockMap = useMemo(() => buildStockMap(foodItems), [foodItems]);
  const isAvailableCb = useCallback((name: string) => {
    const key = findStockKey(stockMap, name);
    if (!key) return false;
    const stock = stockMap.get(key);
    if (!stock) return false;
    return stock.infinite || stock.grams > 0 || stock.count > 0;
  }, [stockMap]);
  const { updateFoodItemCountersForPlanning, deductIngredientsFromStock, deductNameMatchStock } = useMealTransfers(foodItems);

  const updatePlanningWithCounters = (pmId: string, day: string | null, time: string | null) => {
    updatePlanning.mutate({ id: pmId, day_of_week: day, meal_time: time });
    const pm = possibleMeals.find(p => p.id === pmId);
    if (pm) {
      const ing = pm.ingredients_override ?? pm.meals?.ingredients;
      const fallbackDate = pm.created_at;
      updateFoodItemCountersForPlanning(ing, day, time, fallbackDate);
    }
  };

  // Force refetch possible_meals on mount to ensure planning always shows latest data
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["possible_meals"] });
  }, []);

  // Breakfast selections per day
  const breakfastSelections = getPreference<Record<string, string>>('planning_breakfast', {});
  const { getDayCalories, getDayProtein, DAILY_GOAL, getBreakfastForDay } = useCalorieBalance(isAvailableCb);
  const petitDejMeals = getMealsByCategory('petit_dejeuner');
  const possiblePetitDej = possibleMeals.filter(pm => pm.meals?.category === 'petit_dejeuner');

  const setBreakfastForDay = (day: string, selId: string | null) => {
    const updated = { ...breakfastSelections };
    const oldSelId = breakfastSelections[day];

    // Clear old planning if it was a PossibleMeal
    if (oldSelId?.startsWith('pm:')) {
      const oldPmId = oldSelId.slice(3);
      // Only clear if the new selection is different
      if (selId !== oldSelId) {
        updatePlanning.mutate({ id: oldPmId, day_of_week: null, meal_time: null });
      }
    }

    if (selId) {
      updated[day] = selId;
      // Update DB if it's a PossibleMeal
      if (selId.startsWith('pm:')) {
        const pmId = selId.slice(3);
        const pm = possiblePetitDej.find(p => p.id === pmId);
        updatePlanning.mutate({ id: pmId, day_of_week: day, meal_time: 'matin' });
        if (pm) {
          const ing = pm.ingredients_override ?? pm.meals?.ingredients;
          updateFoodItemCountersForPlanning(ing, day, 'matin', pm.created_at);
        }
      }
    } else {
      delete updated[day];
    }
    setPreference.mutate({ key: 'planning_breakfast', value: updated });

    // Auto-enable auto-consume for "Dèj choco", disable on other changes
    const selectedMeal = getBreakfastMealFromSelId(selId);
    const isDejeChoco = selectedMeal?.name?.toLowerCase().includes('dèj choco') || selectedMeal?.name?.toLowerCase().includes('dej choco');
    if (isDejeChoco) {
      const updatedAC = { ...autoConsumeBreakfast, [day]: true };
      setPreference.mutate({ key: 'planning_auto_consume_breakfast', value: updatedAC });
    } else if (autoConsumeBreakfast[day]) {
      const updatedAC = { ...autoConsumeBreakfast };
      delete updatedAC[day];
      setPreference.mutate({ key: 'planning_auto_consume_breakfast', value: updatedAC });
    }
  };

  /** Resolve a selection ID to a Meal object (for internal use) */
  const getBreakfastMealFromSelId = (selId: string | null | undefined) => {
    if (!selId) return null;
    if (selId.startsWith('pm:')) {
      const pmId = selId.slice(3);
      return possiblePetitDej.find(pm => pm.id === pmId)?.meals || null;
    }
    if (selId.startsWith('meal:')) {
      const mealId = selId.slice(5);
      return petitDejMeals.find(m => m.id === mealId) || null;
    }
    // Legacy
    return petitDejMeals.find(m => m.id === selId) || possiblePetitDej.find(pm => pm.meal_id === selId)?.meals || null;
  };
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const [dragOverUnplanned, setDragOverUnplanned] = useState(false);

  const slotDragRef = useRef<{ pmId: string; slotKey: string } | null>(null);
  const [slotDragOver, setSlotDragOver] = useState<string | null>(null);

  const touchDrag = useRef<TouchDragState | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [touchDragActive, setTouchDragActive] = useState(false);
  const [touchHighlight, setTouchHighlight] = useState<string | null>(null);

  const todayRef = useRef<HTMLDivElement | null>(null);
  const todayKey = JS_DAY_TO_KEY[new Date().getDay()];
  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  const [popupPm, setPopupPm] = useState<PossibleMeal | null>(null);
  const [popupBreakfast, setPopupBreakfast] = useState<{ meal: any; day: string } | null>(null);
  const [additiveModes, setAdditiveModes] = useState<Record<string, { active: boolean; value: string }>>({});
  const [openExtrasDay, setOpenExtrasDay] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    if (todayRef.current) {
      setTimeout(() => {
        const el = todayRef.current;
        if (!el) return;
        const headerHeight = 112;
        const top = el.getBoundingClientRect().top + window.scrollY - headerHeight;
        window.scrollTo({ top, behavior: "smooth" });
      }, 200);
    }
  }, []);

  // Auto-consume breakfast for past days
  const autoConsumedDays = getPreference<Record<string, boolean>>('planning_auto_consumed_days', {});
  const autoConsumeChecked = useRef(false);
  useEffect(() => {
    if (autoConsumeChecked.current) return;
    if (prefsLoading) return; // Wait for preferences to load
    if (foodItems.length === 0) return; // Wait for food items to load
    if (possibleMeals === undefined) return; // Wait for possible meals
    autoConsumeChecked.current = true;

    const runAutoConsume = async () => {
      // Verify from DB to prevent duplicate consumption
      const { data: freshConsumedData } = await supabase.from('user_preferences')
        .select('value').eq('key', 'planning_auto_consumed_days').maybeSingle();
      const freshConsumed = (freshConsumedData?.value as Record<string, boolean>) ?? {};

      const todayIdx = DAY_KEY_TO_INDEX[todayKey];
      const pastDays = DAYS.filter((_, i) => i < todayIdx);

      const toConsume: string[] = [];
      for (const day of pastDays) {
        if (autoConsumeBreakfast[day] && breakfastSelections[day] && !freshConsumed[day]) {
          toConsume.push(day);
        }
      }

      if (toConsume.length > 0) {
        const updatedConsumed = { ...freshConsumed };
        for (const day of toConsume) {
          updatedConsumed[day] = true;
          const selId = breakfastSelections[day];
          // Resolve prefixed selection ID
          let breakfast: any = null;
          if (selId.startsWith('pm:')) {
            const pmId = selId.slice(3);
            const pm = possibleMeals.find(p => p.id === pmId);
            if (pm?.meals) breakfast = { ...pm.meals, ingredients: pm.ingredients_override ?? pm.meals.ingredients };
          } else if (selId.startsWith('meal:')) {
            const mId = selId.slice(5);
            breakfast = petitDejMeals.find(m => m.id === mId);
          } else {
            // Legacy plain ID
            breakfast = petitDejMeals.find(m => m.id === selId) || possibleMeals.find(pm => pm.meal_id === selId)?.meals;
          }
          if (breakfast) {
            // Build a Meal-like object for the transfer functions
            const mealObj = {
              id: breakfast.id,
              name: breakfast.name,
              category: breakfast.category || 'petit_dejeuner',
              calories: breakfast.calories,
              protein: breakfast.protein,
              grams: breakfast.grams,
              ingredients: breakfast.ingredients,
              sort_order: breakfast.sort_order,
              created_at: breakfast.created_at,
              is_available: (breakfast as any).is_available ?? false,
              is_favorite: (breakfast as any).is_favorite ?? false,
              oven_temp: breakfast.oven_temp ?? null,
              oven_minutes: breakfast.oven_minutes ?? null,
            } as Meal;

            if (mealObj.ingredients?.trim()) {
              // Use ingredient-based deduction
              await deductIngredientsFromStock(mealObj);
            } else {
              // Use name-match deduction
              await deductNameMatchStock(mealObj);
            }
            qc.invalidateQueries({ queryKey: ["food_items"] });
          }
        }
        setPreference.mutate({ key: 'planning_auto_consumed_days', value: updatedConsumed });
      }
    };
    runAutoConsume();
  }, [foodItems.length, prefsLoading, possibleMeals]);

  const planningMeals = possibleMeals.filter((pm) => {
    if (pm.meals?.category === "plat") return true;
    // Non-plat categories: only show if they have a planning date assigned
    return !!pm.day_of_week && !!pm.meal_time;
  });

  const getMealsForSlot = (day: string, time: string): PossibleMeal[] =>
    planningMeals
      .filter((pm) => pm.day_of_week === day && pm.meal_time === time)
      .sort((a, b) => a.sort_order - b.sort_order);

  const unplanned = planningMeals.filter((pm) => !pm.day_of_week || !pm.meal_time);

  const calOverrides = getPreference<Record<string, string>>('planning_cal_overrides', {});
  const drinkChecks = getPreference<Record<string, boolean>>('planning_drink_checks', {});
  const manualCalories = getPreference<Record<string, number>>('planning_manual_calories', {});
  const extraCalories = getPreference<Record<string, number>>('planning_extra_calories', {});
  const manualProteins = getPreference<Record<string, number>>('planning_manual_proteins', {});
  const breakfastManualProteins = getPreference<Record<string, number>>('planning_breakfast_manual_proteins', {});
  const extraProteins = getPreference<Record<string, number>>('planning_extra_proteins', {});
  const extraSelections = getPreference<Record<string, string[]>>('planning_extra_selections', {});

  const savedSnapshots = getPreference<Record<string, { cal?: number; prot?: number; itemIds?: string[] }>>('planning_saved_snapshots', {});
  const [flashedKeys, setFlashedKeys] = useState<Record<string, boolean>>({});
  const WEEKLY_GOAL = DAILY_GOAL * DEFAULT_WEEKLY_MULTIPLIER;
  const DAILY_PROTEIN_GOAL_PREF = getPreference<number>('planning_protein_goal', DAILY_PROTEIN_GOAL);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [editingProteinGoal, setEditingProteinGoal] = useState(false);
  const [proteinGoalInput, setProteinGoalInput] = useState("");
  const breakfastManualCalories = getPreference<Record<string, number>>('planning_breakfast_manual_calories', {});
  const autoConsumeBreakfast = getPreference<Record<string, boolean>>('planning_auto_consume_breakfast', {});

  // Next week preferences (survive reset)
  const nextBreakfastSelections = getPreference<Record<string, string>>('next_week_breakfast', {});
  const nextManualCalories = getPreference<Record<string, number>>('next_week_manual_calories', {});
  const nextManualProteins = getPreference<Record<string, number>>('next_week_manual_proteins', {});
  const nextExtraCalories = getPreference<Record<string, number>>('next_week_extra_calories', {});
  const nextExtraProteins = getPreference<Record<string, number>>('next_week_extra_proteins', {});
  const nextExtraSelections = getPreference<Record<string, string[]>>('next_week_extra_selections', {});
  const nextBreakfastManualCalories = getPreference<Record<string, number>>('next_week_breakfast_manual_calories', {});
  const nextBreakfastManualProteins = getPreference<Record<string, number>>('next_week_breakfast_manual_proteins', {});
  const nextDrinkChecks = getPreference<Record<string, boolean>>('next_week_drink_checks', {});

  // Meal lookup for backup view
  const allMealsById = useMemo(() => {
    const map = new Map<string, Meal>();
    for (const m of meals) map.set(m.id, m);
    return map;
  }, [meals]);

  const handleAddExtraItem = (day: string, item: FoodItem, remove = false) => {
    const updated = { ...extraSelections };
    const current = updated[day] || [];
    if (remove) {
      // Remove one instance
      const idx = current.lastIndexOf(item.id);
      if (idx >= 0) {
        updated[day] = [...current.slice(0, idx), ...current.slice(idx + 1)];
      }
    } else {
      // Always add (allow duplicates)
      updated[day] = [...current, item.id];
    }
    setPreference.mutate({ key: 'planning_extra_selections', value: updated });
  };

  const handleDrop = async (e: React.DragEvent, day: string, time: string) => {
    e.preventDefault();
    setDragOverSlot(null);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) updatePlanningWithCounters(pmId, day, time);
  };

  const handleDropOnCard = (e: React.DragEvent, targetPm: PossibleMeal) => {
    e.preventDefault();
    e.stopPropagation();
    setSlotDragOver(null);
    const draggedPmId = e.dataTransfer.getData("pmId");
    if (!draggedPmId || draggedPmId === targetPm.id) return;

    const targetDay = targetPm.day_of_week!;
    const targetTime = targetPm.meal_time!;
    const draggedPm = possibleMeals.find(p => p.id === draggedPmId);

    // If card comes from another slot or is unplanned, update its planning first
    if (!draggedPm || draggedPm.day_of_week !== targetDay || draggedPm.meal_time !== targetTime) {
      updatePlanningWithCounters(draggedPmId, targetDay, targetTime);
    }

    const slot = getMealsForSlot(targetDay, targetTime);
    const filtered = slot.filter((p) => p.id !== draggedPmId);
    const targetIdx = filtered.findIndex((p) => p.id === targetPm.id);
    const insertAt = targetIdx === -1 ? filtered.length : targetIdx;
    filtered.splice(insertAt, 0, { id: draggedPmId } as PossibleMeal);
    reorderPossibleMeals.mutate(filtered.map((p, i) => ({ id: p.id, sort_order: i })));
  };

  const handleDropUnplanned = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverUnplanned(false);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) updatePlanningWithCounters(pmId, null, null);
  };

  const handleTouchStart = (e: React.TouchEvent, pm: PossibleMeal) => {
    const touch = e.touches[0];
    const origEl = e.currentTarget as HTMLElement;
    const rect = origEl.getBoundingClientRect();

    if (longPressTimer.current) clearTimeout(longPressTimer.current);

    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";

      const ghost = origEl.cloneNode(true) as HTMLElement;
      ghost.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        z-index: 9999;
        pointer-events: none;
        opacity: 0.85;
        transform: scale(1.05);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.35);
        transition: none;
      `;
      document.body.appendChild(ghost);

      touchDrag.current = {
        pmId: pm.id,
        ghost,
        startX: touch.clientX,
        startY: touch.clientY,
        origTop: rect.top,
        origLeft: rect.left,
      };
      setTouchDragActive(true);
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchDrag.current) {
      e.preventDefault();
    } else if (!longPressTimer.current) {
      return;
    } else {
      return;
    }

    e.preventDefault();
    const touch = e.touches[0];
    const state = touchDrag.current;
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;

    state.ghost.style.top = `${state.origTop + dy}px`;
    state.ghost.style.left = `${state.origLeft + dx}px`;

    state.ghost.style.visibility = "hidden";
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    state.ghost.style.visibility = "visible";

    const slotEl = el?.closest("[data-slot]");
    if (slotEl) {
      const day = slotEl.getAttribute("data-day")!;
      const time = slotEl.getAttribute("data-time")!;
      setTouchHighlight(`${day}-${time}`);
    } else if (el?.closest("[data-unplanned]")) {
      setTouchHighlight("unplanned");
    } else {
      setTouchHighlight(null);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    const state = touchDrag.current;
    if (!state) return;

    touchDrag.current = null;
    setTouchDragActive(false);
    setTouchHighlight(null);
    document.body.style.overflow = "";
    document.body.style.touchAction = "";

    const touch = e.changedTouches[0];
    state.ghost.style.visibility = "hidden";
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    state.ghost.remove();

    const slotEl = el?.closest("[data-slot]");
    if (slotEl) {
      const day = slotEl.getAttribute("data-day")!;
      const time = slotEl.getAttribute("data-time")!;
      updatePlanningWithCounters(state.pmId, day, time);
    } else if (el?.closest("[data-unplanned]")) {
      updatePlanningWithCounters(state.pmId, null, null);
    }
  };

  const handleTouchCancel = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (touchDrag.current) {
      touchDrag.current.ghost.remove();
      touchDrag.current = null;
    }
    setTouchDragActive(false);
    setTouchHighlight(null);
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
  };

  const handleRemoveFromSlot = (pm: PossibleMeal) => {
    updatePlanningWithCounters(pm.id, null, null);
  };

  const renderMiniCard = (pm: PossibleMeal, compact = false) => {
    const meal = pm.meals;
    if (!meal) return null;
    const displayIngredients = pm.ingredients_override ?? meal.ingredients;
    const mealForAnalysis = { ...meal, ingredients: displayIngredients };
    const analysis = analyzeMealIngredients(mealForAnalysis, foodItems);

    const effectiveStart = analysis.earliestCounterDate !== undefined ? analysis.earliestCounterDate : pm.counter_start_date;
    const counterDays = getAdaptedCounterDays(effectiveStart, pm.day_of_week, pm.created_at, pm.meal_time);
    const counterUrgent = counterDays !== null && counterDays >= 3;

    const expiredIngs = analysis.expiredIngredientNames;
    const soonIngs = analysis.expiringSoonIngredientNames;

    const overrideCal = calOverrides[pm.id];
    const expired = isExpiredOnDay(pm.expiration_date, pm.day_of_week);

    // Use shared ratio detection
    let displayMeal = meal;
    const detectedRatio = getOverrideScaleRatio(meal, pm.ingredients_override);
    if (detectedRatio !== null && meal.grams) {
      const baseG = parseFloat(meal.grams.replace(/[^0-9.]/g, '')) || 0;
      if (baseG > 0) {
        displayMeal = { ...meal, grams: String(Math.round(baseG * detectedRatio)) };
      }
    }

    // Use centralized macro logic — always round to integers (no decimals)
    const rawCalNum = overrideCal ? (parseFloat(overrideCal) || 0) : getCardDisplayCalories(pm, undefined, isAvailableCb);
    const displayCal = rawCalNum ? String(Math.round(rawCalNum)) : null;
    const rawProNum = getCardDisplayProtein(pm, isAvailableCb);
    const displayPro = rawProNum ? String(Math.round(rawProNum)) : null;

    const isComputedCal = !overrideCal && computeIngredientCalories(displayIngredients, isAvailableCb) !== null;
    const isComputedPro = computeIngredientProtein(displayIngredients, isAvailableCb) !== null;

    return (
      <PlanningMiniCard
        key={pm.id}
        pm={pm}
        meal={displayMeal}
        expired={expired}
        expiredIngredientNames={expiredIngs}
        expiringSoonIngredientNames={soonIngs}
        counterDays={counterDays}
        counterUrgent={counterUrgent}
        isPast={(() => {
          if (!pm.day_of_week) return false;
          const target = getDateForDayKey(pm.day_of_week, parseISO(pm.created_at));
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return target.getTime() < today.getTime();
        })()}
        displayCal={displayCal}
        isComputedCal={isComputedCal}
        displayPro={displayPro}
        isComputedPro={isComputedPro}
        compact={compact}
        isTouchDevice={isTouchDevice}
        touchDragActive={touchDragActive}
        slotDragOver={slotDragOver}
        onDragStart={(e) => {
          e.dataTransfer.setData("pmId", pm.id);
          e.dataTransfer.setData("mealId", pm.meal_id);
          e.dataTransfer.setData("source", "planning-slot");
          slotDragRef.current = { pmId: pm.id, slotKey: `${pm.day_of_week}-${pm.meal_time}` };
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSlotDragOver(pm.id);
        }}
        onDragLeave={() => setSlotDragOver(null)}
        onDrop={(e) => handleDropOnCard(e, pm)}
        onTouchStart={(e) => handleTouchStart(e, pm)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onRemove={() => handleRemoveFromSlot(pm)}
        onCalorieChange={(val) => {
          const updated = { ...calOverrides };
          if (val) updated[pm.id] = val;
          else delete updated[pm.id];
          setPreference.mutate({ key: 'planning_cal_overrides', value: updated });
        }}
        onDoubleClick={() => setPopupPm(pm)}
        stockMap={stockMap}
      />
    );
  };

  const weekTotal = DAYS.reduce((sum, day) => sum + getDayCalories(day), 0);

  const handleRestoreBackup = async () => {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) { alert('Utilisateur non connecté.'); return; }

    const { data } = await supabase
      .from('user_preferences')
      .select('value')
      .eq('key', 'possible_meals_backup')
      .eq('user_id', userId)
      .maybeSingle();

    const raw = data?.value as any;
    // Support both old format (array of cards) and new format (object with cards + inputs)
    const isNewFormat = raw && !Array.isArray(raw) && raw.cards;
    const backup: any[] = isNewFormat ? raw.cards : (Array.isArray(raw) ? raw : []);
    if (backup.length === 0) { alert('Aucune sauvegarde trouvée.'); return; }
    if (!confirm(`Restaurer ${backup.length} carte(s) possible(s) ?`)) return;

    // Restore cards
    await Promise.all(backup.map((pm: any) =>
      (supabase as any).from("possible_meals").insert({
        meal_id: pm.meal_id,
        quantity: pm.quantity,
        expiration_date: pm.expiration_date,
        day_of_week: pm.day_of_week,
        meal_time: pm.meal_time,
        counter_start_date: pm.counter_start_date,
        sort_order: pm.sort_order,
        ingredients_override: pm.ingredients_override,
      })
    ));

    // Restore input values if available
    if (isNewFormat) {
      if (raw.manualCalories) setPreference.mutate({ key: 'planning_manual_calories', value: raw.manualCalories });
      if (raw.manualProteins) setPreference.mutate({ key: 'planning_manual_proteins', value: raw.manualProteins });
      if (raw.extraCalories) setPreference.mutate({ key: 'planning_extra_calories', value: raw.extraCalories });
      if (raw.extraProteins) setPreference.mutate({ key: 'planning_extra_proteins', value: raw.extraProteins });
      if (raw.extraSelections) setPreference.mutate({ key: 'planning_extra_selections', value: raw.extraSelections });
      if (raw.breakfastManualCalories) setPreference.mutate({ key: 'planning_breakfast_manual_calories', value: raw.breakfastManualCalories });
      if (raw.breakfastManualProteins) setPreference.mutate({ key: 'planning_breakfast_manual_proteins', value: raw.breakfastManualProteins });
      if (raw.breakfastSelections) setPreference.mutate({ key: 'planning_breakfast', value: raw.breakfastSelections });
      if (raw.drinkChecks) setPreference.mutate({ key: 'planning_drink_checks', value: raw.drinkChecks });
      if (raw.calOverrides) setPreference.mutate({ key: 'planning_cal_overrides', value: raw.calOverrides });
    }

    qc.invalidateQueries({ queryKey: ["possible_meals"] });
  };

  const handleManualReset = async () => {
    if (!confirm('Réinitialiser le planning ? Les cartes seront supprimées et les valeurs sauvegardées (💾) seront restaurées.')) return;
    const snaps = savedSnapshots;

    // Backup possible_meals + all input values before deletion
    const backup = possibleMeals.map(pm => ({
      meal_id: pm.meal_id,
      quantity: pm.quantity,
      expiration_date: pm.expiration_date,
      day_of_week: pm.day_of_week,
      meal_time: pm.meal_time,
      counter_start_date: pm.counter_start_date,
      sort_order: pm.sort_order,
      ingredients_override: pm.ingredients_override,
    }));
    const fullBackup = {
      cards: backup,
      manualCalories,
      manualProteins,
      extraCalories,
      extraProteins,
      extraSelections,
      breakfastManualCalories,
      breakfastManualProteins,
      breakfastSelections,
      drinkChecks,
      calOverrides,
    };
    const userId = (await supabase.auth.getUser()).data.user?.id;
    await supabase.from('user_preferences').upsert({ key: 'possible_meals_backup', value: fullBackup, user_id: userId } as any, { onConflict: 'user_id,key' });

    await Promise.all(possibleMeals.map(pm => {
      // If it's a breakfast card, only delete if it was planned
      if (pm.meals?.category === 'petit_dejeuner' && !pm.day_of_week) {
        return Promise.resolve();
      }
      return (supabase as any).from("possible_meals").delete().eq("id", pm.id);
    }));
    const rMC: Record<string, number> = {}, rMP: Record<string, number> = {};
    const rEC: Record<string, number> = {}, rEP: Record<string, number> = {};
    const rES: Record<string, string[]> = {};
    const rBC: Record<string, number> = {}, rBP: Record<string, number> = {};
    const keptBreakfast: Record<string, string> = {};
    for (const [key, snap] of Object.entries(snaps)) {
      const s = snap as any;
      if (key.startsWith('manual-')) { const k = key.replace('manual-', ''); if (s.cal) rMC[k] = s.cal; if (s.prot) rMP[k] = s.prot; }
      else if (key.startsWith('extra-')) {
        const k = key.replace('extra-', '');
        if (s.cal) rEC[k] = s.cal;
        if (s.prot) rEP[k] = s.prot;
        if (s.itemIds) rES[k] = s.itemIds;
      }
      else if (key.startsWith('breakfast-')) { const k = key.replace('breakfast-', ''); if (s.cal) rBC[k] = s.cal; if (s.prot) rBP[k] = s.prot; if (s.mealId) keptBreakfast[k] = s.mealId; }
    }
    // Merge next_week values for days without snapshots
    for (const day of DAYS) {
      for (const time of TIMES) {
        const k = `${day}-${time}`;
        if (!rMC[k] && nextManualCalories[k]) rMC[k] = nextManualCalories[k];
        if (!rMP[k] && nextManualProteins[k]) rMP[k] = nextManualProteins[k];
      }
      if (!rEC[day] && nextExtraCalories[day]) rEC[day] = nextExtraCalories[day];
      if (!rEP[day] && nextExtraProteins[day]) rEP[day] = nextExtraProteins[day];
      if (!rES[day] && nextExtraSelections[day]?.length > 0) rES[day] = nextExtraSelections[day];
      if (!rBC[day] && nextBreakfastManualCalories[day]) rBC[day] = nextBreakfastManualCalories[day];
      if (!rBP[day] && nextBreakfastManualProteins[day]) rBP[day] = nextBreakfastManualProteins[day];
      if (!keptBreakfast[day] && nextBreakfastSelections[day]) keptBreakfast[day] = nextBreakfastSelections[day];
    }
    // Merge next week drink checks
    const mergedDrinks: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(nextDrinkChecks)) {
      if (v) mergedDrinks[k] = true;
    }

    setPreference.mutate({ key: 'planning_manual_calories', value: rMC });
    setPreference.mutate({ key: 'planning_manual_proteins', value: rMP });
    setPreference.mutate({ key: 'planning_extra_calories', value: rEC });
    setPreference.mutate({ key: 'planning_extra_proteins', value: rEP });
    setPreference.mutate({ key: 'planning_extra_selections', value: rES });
    setPreference.mutate({ key: 'planning_breakfast_manual_calories', value: rBC });
    setPreference.mutate({ key: 'planning_breakfast_manual_proteins', value: rBP });
    setPreference.mutate({ key: 'planning_breakfast', value: keptBreakfast });
    setPreference.mutate({ key: 'planning_drink_checks', value: mergedDrinks });
    setPreference.mutate({ key: 'planning_auto_consumed_days', value: {} });
    setPreference.mutate({ key: 'last_weekly_reset', value: new Date().toISOString() });
    // Clear next_week preferences after migration
    setPreference.mutate({ key: 'next_week_breakfast', value: {} });
    setPreference.mutate({ key: 'next_week_manual_calories', value: {} });
    setPreference.mutate({ key: 'next_week_manual_proteins', value: {} });
    setPreference.mutate({ key: 'next_week_extra_calories', value: {} });
    setPreference.mutate({ key: 'next_week_extra_proteins', value: {} });
    setPreference.mutate({ key: 'next_week_extra_selections', value: {} });
    setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: {} });
    setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: {} });
    setPreference.mutate({ key: 'next_week_drink_checks', value: {} });
    qc.invalidateQueries({ queryKey: ["possible_meals"] });
  };

  return (
    <div className={`max-w-4xl mx-auto space-y-3 overflow-x-hidden planning-responsive ${touchDragActive ? "touch-none" : ""}`}>
      {/* Global planning header */}
      <div className="rounded-2xl bg-card/80 backdrop-blur-sm p-3 flex items-center gap-3 flex-wrap">
      {weekOffset === 0 && (
          <>
            <button onClick={handleManualReset} className="text-xs font-semibold bg-destructive/10 hover:bg-destructive/20 text-destructive rounded-lg px-3 py-1.5 transition-colors">🔄 Reset</button>
            <button onClick={handleRestoreBackup} className="text-xs font-semibold bg-primary/10 hover:bg-primary/20 text-primary rounded-lg px-3 py-1.5 transition-colors">↩ Restaurer</button>
          </>
        )}
        {(weekOffset === 0 || weekOffset === 1) && (
          <>
            <div className="flex items-center gap-1">
              <Flame className="h-3 w-3 text-orange-500" />
              <input
                type="number"
                inputMode="numeric"
                defaultValue={DAILY_GOAL}
                key={`global-cal-${DAILY_GOAL}`}
                onBlur={(e) => {
                  const val = parseInt(e.target.value);
                  if (val && val > 0) setPreference.mutate({ key: 'planning_daily_goal', value: val });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-16 h-6 text-xs bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 focus:outline-none focus:border-orange-400/50 text-center"
              />
              <span className="text-[9px] text-muted-foreground">kcal/j</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs">🍗</span>
              <input
                type="number"
                inputMode="numeric"
                defaultValue={DAILY_PROTEIN_GOAL_PREF}
                key={`global-prot-${DAILY_PROTEIN_GOAL_PREF}`}
                onBlur={(e) => {
                  const val = parseInt(e.target.value);
                  if (val && val > 0) setPreference.mutate({ key: 'planning_protein_goal', value: val });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-14 h-6 text-xs bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 focus:outline-none focus:border-blue-400/50 text-center"
              />
              <span className="text-[9px] text-muted-foreground">prot/j</span>
            </div>
          </>
        )}
        {/* Spacer to push nav to right */}
        <div className="flex-1" />
        {/* Week navigation — right aligned, segmented pill */}
        <div className="flex items-center bg-muted/50 rounded-full p-0.5 gap-0.5">
          <button
            onClick={() => setWeekOffset(-1)}
            className={`h-7 px-2.5 flex items-center justify-center rounded-full text-[10px] font-bold transition-all ${weekOffset === -1 ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'}`}
          >◀ Préc.</button>
          <button
            onClick={() => setWeekOffset(0)}
            className={`h-7 px-3 flex items-center justify-center rounded-full text-[10px] font-bold transition-all ${weekOffset === 0 ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'}`}
          >Actuelle</button>
          <button
            onClick={() => setWeekOffset(1)}
            className={`h-7 px-2.5 flex items-center justify-center rounded-full text-[10px] font-bold transition-all ${weekOffset === 1 ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'}`}
          >Suiv. ▶</button>
        </div>
      </div>

      {weekOffset === 0 ? (<>
      {DAYS.map((day) => {
        const isToday_ = day === todayKey;
        const dayCalories = getDayCalories(day);
        const matinMeals = getMealsForSlot(day, 'matin');
        const matinCals = matinMeals.reduce((s, pm) => s + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailableCb), 0);
        const matinPro = matinMeals.reduce((s, pm) => s + getCardDisplayProtein(pm, isAvailableCb), 0);

        const breakfast = getBreakfastForDay(day);
        let baseBreakfastCals = 0;
        let baseBreakfastPro = 0;
        if (breakfast) {
          const selId = breakfastSelections[day];
          if (selId?.startsWith('pm:')) {
            const pmId = selId.slice(3);
            const possiblePdj = possibleMeals.find(pm => pm.id === pmId);
            const isAlsoMatin = possiblePdj && possiblePdj.day_of_week === day && possiblePdj.meal_time === 'matin';
            if (isAlsoMatin) {
              baseBreakfastCals = 0;
              baseBreakfastPro = 0;
            } else {
              baseBreakfastCals = possiblePdj ? getCardDisplayCalories(possiblePdj, undefined, isAvailableCb) : parseCalories(breakfast.calories);
              baseBreakfastPro = possiblePdj ? getCardDisplayProtein(possiblePdj, isAvailableCb) : parseProtein(breakfast.protein);
            }
          } else {
            baseBreakfastCals = getMealCal(breakfast);
            baseBreakfastPro = getMealPro(breakfast);
          }
        } else {
          baseBreakfastCals = breakfastManualCalories[day] || 0;
          baseBreakfastPro = breakfastManualProteins[day] || 0;
        }

        const breakfastTotalCals = baseBreakfastCals + matinCals;
        const breakfastTotalPro = baseBreakfastPro + matinPro;

        return (
          <div
            key={day}
            ref={isToday_ ? todayRef : undefined}
            className={`rounded-2xl p-2 sm:p-4 transition-all ${isToday_ ? "bg-primary/10 ring-2 ring-primary/40" : "bg-card/80 backdrop-blur-sm"}`}
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h3
                className={`text-sm sm:text-base font-bold flex items-center gap-2 ${isToday_ ? "text-primary" : "text-foreground"}`}
              >
                {DAY_LABELS[day]}
                {isToday_ && (
                  <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-semibold">
                    Aujourd'hui
                  </span>
                )}
              </h3>
              {/* Petit déj selector */}
              <div className="flex items-center gap-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      className="text-[10px] bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full font-semibold hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors truncate max-w-[120px]"
                      onDoubleClick={() => {
                        const bm = getBreakfastForDay(day);
                        if (bm) setPopupBreakfast({ meal: bm, day });
                      }}
                    >
                      {(() => {
                        const count = matinMeals.length + (getBreakfastForDay(day) ? 1 : 0);
                        if (count > 1) return 'Plusieurs petits déj';
                        if (count === 1) {
                          if (matinMeals.length === 1) return matinMeals[0].meals?.name || '🥐 Petit déj';
                          return getBreakfastForDay(day)?.name || '🥐 Petit déj';
                        }
                        return '🥐 Petit déj';
                      })()}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-2" align="start">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Petit déjeuner</p>
                    <div className="space-y-0.5 max-h-48 overflow-y-auto">
                      <button onClick={() => setBreakfastForDay(day, null)} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors">
                        — Aucun
                      </button>
                      {possiblePetitDej.length > 0 && (
                        <>
                          <p className="text-[9px] text-muted-foreground/60 px-2 font-semibold uppercase tracking-wide">Possible</p>
                          {possiblePetitDej.map(pm => {
                            const displayIng = pm.ingredients_override ?? pm.meals?.ingredients;
                            const calDisplay = getMealCal(pm.meals || {}, pm.ingredients_override);
                            const proDisplay = getMealPro(pm.meals || {}, pm.ingredients_override);
                            const pmSelId = `pm:${pm.id}`;
                            const isMatinSelected = pm.day_of_week === day && pm.meal_time === 'matin';
                            const isDropdownSelected = breakfastSelections[day] === pmSelId;
                            const isSelected = isMatinSelected || isDropdownSelected;
                            // Find other days where this possible breakfast is selected
                            const otherDays = DAYS.filter(d => d !== day && (breakfastSelections[d] === pmSelId || (pm.day_of_week === d && pm.meal_time === 'matin')));
                            const otherDaysLabel = otherDays.length > 0 ? otherDays.map(d => DAY_LABELS[d]?.slice(0, 3)).join(', ') : null;
                            return (
                              <button key={pm.id} onClick={() => {
                                if (isDropdownSelected) setBreakfastForDay(day, null);
                                if (isSelected) {
                                  updatePlanning.mutate({ id: pm.id, day_of_week: null, meal_time: null });
                                } else {
                                  updatePlanning.mutate({ id: pm.id, day_of_week: day, meal_time: 'matin' });
                                }
                              }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : otherDaysLabel ? 'bg-amber-100/40 text-amber-900 dark:text-amber-100' : ''}`}>
                                {pm.meals?.name} {pm.ingredients_override ? '✏️' : ''} {(calDisplay || proDisplay) ? <span className="inline-flex items-center gap-0.5 ml-1 text-muted-foreground">({calDisplay ? <><Flame className="w-2.5 h-2.5 text-orange-500" />{calDisplay}</> : ''}{calDisplay && proDisplay ? ' · ' : ''}{proDisplay ? `🍗${proDisplay}` : ''})</span> : ''}
                                {otherDaysLabel && <span className="ml-1 text-[9px] text-amber-600 dark:text-amber-400 font-bold">📅 {otherDaysLabel}</span>}
                              </button>
                            );
                          })}
                          <div className="border-t border-border/40 my-1" />
                        </>
                      )}
                      <p className="text-[9px] text-muted-foreground/60 px-2 font-semibold uppercase tracking-wide">Tous</p>
                      {petitDejMeals.map(m => {
                        const calDisplay = getMealCal(m);
                        const proDisplay = getMealPro(m);
                        const mealSelId = `meal:${m.id}`;
                        const isSelected = breakfastSelections[day] === mealSelId;
                        const otherDays = DAYS.filter(d => d !== day && breakfastSelections[d] === mealSelId);
                        const otherDaysLabel = otherDays.length > 0 ? otherDays.map(d => DAY_LABELS[d]?.slice(0, 3)).join(', ') : null;
                        return (
                          <button key={m.id} onClick={() => {
                            if (isSelected) setBreakfastForDay(day, null);
                            else setBreakfastForDay(day, mealSelId);
                          }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : otherDaysLabel ? 'bg-amber-100/40 text-amber-900 dark:text-amber-100' : ''}`}>
                            {m.name} {(calDisplay || proDisplay) ? <span className="inline-flex items-center gap-0.5 ml-1 text-muted-foreground">({calDisplay ? <><Flame className="w-2.5 h-2.5 text-orange-500" />{calDisplay}</> : ''}{calDisplay && proDisplay ? ' · ' : ''}{proDisplay ? `🍗${proDisplay}` : ''})</span> : ''}
                            {otherDaysLabel && <span className="ml-1 text-[9px] text-amber-600 dark:text-amber-400 font-bold">📅 {otherDaysLabel}</span>}
                          </button>
                        );
                      })}
                      {petitDejMeals.length === 0 && possiblePetitDej.length === 0 && (
                        <p className="text-[10px] text-muted-foreground italic px-2 py-1">Aucun petit déj</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {/* Manual calorie input when no breakfast selected */}
                {!getBreakfastForDay(day) && matinMeals.length === 0 && (
                  <>
                    <PlanningInput
                      storageKey={`breakfast-cal-${day}`}
                      currentValue={breakfastManualCalories[day] || 0}
                      onSave={(val) => {
                        const updated = { ...breakfastManualCalories };
                        if (val > 0) updated[day] = val;
                        else delete updated[day];
                        setPreference.mutate({ key: 'planning_breakfast_manual_calories', value: updated });
                      }}
                      placeholder="kcal"
                      className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40"
                    />
                    <PlanningInput
                      storageKey={`breakfast-prot-${day}`}
                      currentValue={breakfastManualProteins[day] || 0}
                      onSave={(val) => {
                        const updated = { ...breakfastManualProteins };
                        if (val > 0) updated[day] = val;
                        else delete updated[day];
                        setPreference.mutate({ key: 'planning_breakfast_manual_proteins', value: updated });
                      }}
                      placeholder="prot"
                      className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40"
                    />
                  </>
                )}
                {/* Auto-consume breakfast toggle */}
                {getBreakfastForDay(day) && (
                  <button
                    onClick={() => {
                      const updated = { ...autoConsumeBreakfast };
                      if (updated[day]) delete updated[day];
                      else updated[day] = true;
                      setPreference.mutate({ key: 'planning_auto_consume_breakfast', value: updated });
                    }}
                    className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${autoConsumeBreakfast[day]
                      ? 'bg-green-500/20 text-green-400 border border-green-400/50'
                      : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                      }`}
                    title={autoConsumeBreakfast[day] ? 'Auto-consommation activée — sera déduit à 23h59 ou au prochain lancement' : 'Activer la décompte automatique du petit déj'}
                  >🔄</button>
                )}
                {!(matinMeals.length > 0 || breakfastSelections[day]?.startsWith('pm:')) && (
                  <button
                    onClick={() => {
                      const snapKey = `breakfast-${day}`;
                      const cal = breakfastManualCalories[day] || 0;
                      const prot = breakfastManualProteins[day] || 0;
                      const breakfast = getBreakfastForDay(day);
                      const mealId = breakfastSelections[day] || undefined;
                      const updated = { ...savedSnapshots, [snapKey]: { cal, prot, name: breakfast?.name, mealId } };
                      setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });
                      setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                      setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                    }}
                    onDoubleClick={() => {
                      const snapKey = `breakfast-${day}`;
                      const updated = { ...savedSnapshots };
                      delete updated[snapKey];
                      setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });
                    }}
                    className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${flashedKeys[`breakfast-${day}`]
                      ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                      : savedSnapshots[`breakfast-${day}`]
                        ? 'bg-primary/20 text-primary border border-primary/40'
                        : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                      }`}
                    title={(() => {
                      const snap = savedSnapshots[`breakfast-${day}`] as any;
                      if (!snap) return 'Sauvegarder les valeurs pour le reset (Double-clic pour oublier)';
                      if (snap.name) return `Sauvegardé: ${snap.name} (Double-clic pour oublier)`;
                      return `Sauvegardé: ${snap.cal || 0} kcal / ${snap.prot || 0} prot (Double-clic pour oublier)`;
                    })()}
                  >💾</button>
                )}
              </div>
              {(breakfastTotalCals > 0 || breakfastTotalPro > 0) && (
                <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full ml-2 border border-border/40 shadow-sm">
                  {breakfastTotalCals > 0 && (
                    <span className="flex items-center gap-1">
                      <Flame className="w-2.5 h-2.5 text-orange-500/60" />
                      {Math.round(breakfastTotalCals)}
                    </span>
                  )}
                  {breakfastTotalCals > 0 && breakfastTotalPro > 0 && <span className="opacity-30">•</span>}
                  {breakfastTotalPro > 0 && (
                    <span className="flex items-center gap-0.5">
                      <span className="text-[10px] opacity-60">🍗</span>
                      {Math.round(breakfastTotalPro)}
                    </span>
                  )}
                </div>
              )}
              <div className="flex-1" />
              <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap justify-end">
                <button
                  onClick={() => { setEditingGoal(true); setGoalInput(String(DAILY_GOAL)); }}
                  className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 whitespace-nowrap hover:bg-muted/80 transition-colors cursor-pointer"
                  title="Cliquer pour modifier l'objectif"
                >
                  <Flame className="h-2.5 w-2.5 text-orange-500" />
                  {Math.round(dayCalories)} <span className="text-muted-foreground/50 font-normal">/ {DAILY_GOAL}</span>
                </button>
                {editingGoal && (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="number"
                      inputMode="numeric"
                      value={goalInput}
                      onChange={(e) => setGoalInput(e.target.value)}
                      onBlur={() => {
                        const val = parseInt(goalInput);
                        if (val && val > 0) setPreference.mutate({ key: 'planning_daily_goal', value: val });
                        setEditingGoal(false);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingGoal(false); }}
                      className="w-16 h-5 text-[10px] bg-muted border border-border rounded px-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <span className="text-[9px] text-muted-foreground">kcal/j</span>
                  </div>
                )}
                {!editingGoal && dayCalories > 0 && (
                  <span className={`text-[10px] font-bold whitespace-nowrap ${DAILY_GOAL - dayCalories > 0 ? 'text-muted-foreground/60' : 'text-orange-500'}`}>
                    {DAILY_GOAL - dayCalories > 0 ? `reste ${Math.round(DAILY_GOAL - dayCalories)}` : `+${Math.round(dayCalories - DAILY_GOAL)}`}
                  </span>
                )}
                {getDayProtein(day) > 0 && (
                  <button
                    onClick={() => { setEditingProteinGoal(true); setProteinGoalInput(String(DAILY_PROTEIN_GOAL_PREF)); }}
                    className="flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-500/10 rounded-full px-2 py-0.5 whitespace-nowrap hover:bg-blue-500/20 transition-colors cursor-pointer"
                    title="Cliquer pour modifier l'objectif protéines"
                  >
                    🍗 {Math.round(getDayProtein(day))} <span className="text-blue-400/50 font-normal">/ {DAILY_PROTEIN_GOAL_PREF}</span>
                  </button>
                )}
                {!editingProteinGoal && getDayProtein(day) > 0 && (
                  <span className={`text-[10px] font-bold whitespace-nowrap ${DAILY_PROTEIN_GOAL_PREF - getDayProtein(day) > 0 ? 'text-blue-400/60' : 'text-blue-500'}`}>
                    {DAILY_PROTEIN_GOAL_PREF - getDayProtein(day) > 0 ? `reste ${Math.round(DAILY_PROTEIN_GOAL_PREF - getDayProtein(day))}` : `+${Math.round(getDayProtein(day) - DAILY_PROTEIN_GOAL_PREF)}`}
                  </span>
                )}
                {editingProteinGoal && (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="number"
                      value={proteinGoalInput}
                      onChange={(e) => setProteinGoalInput(e.target.value)}
                      onBlur={() => {
                        const val = parseInt(proteinGoalInput);
                        if (val && val > 0) setPreference.mutate({ key: 'planning_protein_goal', value: val });
                        setEditingProteinGoal(false);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingProteinGoal(false); }}
                      className="w-16 h-5 text-[10px] bg-muted border border-border rounded px-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <span className="text-[9px] text-muted-foreground">🍗/j</span>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-1 sm:gap-3">
              {TIMES.map((time) => {
                const slotKey = `${day}-${time}`;
                const slotMeals = getMealsForSlot(day, time);
                const isOver = dragOverSlot === slotKey || touchHighlight === slotKey;
                const slotCals = slotMeals.reduce((s, p) => s + getCardDisplayCalories(p, calOverrides[p.id], isAvailableCb), 0);
                const slotPro = slotMeals.reduce((s, p) => s + getCardDisplayProtein(p, isAvailableCb), 0);
                return (
                  <div
                    key={time}
                    data-slot
                    data-day={day}
                    data-time={time}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverSlot(slotKey);
                    }}
                    onDragLeave={() => setDragOverSlot(null)}
                    onDrop={(e) => handleDrop(e, day, time)}
                    className={`min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed p-1 sm:p-1.5 transition-colors ${isOver ? "border-primary/60 bg-primary/5" : "border-border/40 hover:border-primary/40"}`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                          {TIME_LABELS[time]}
                        </span>
                        <button
                          onClick={() => {
                            const key = `${day}-${time}`;
                            const updated = { ...drinkChecks };
                            if (updated[key]) delete updated[key];
                            else updated[key] = true;
                            setPreference.mutate({ key: 'planning_drink_checks', value: updated });
                          }}
                          className={`flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px transition-colors ${drinkChecks[`${day}-${time}`]
                            ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold'
                            : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60'
                            }`}
                          title="+ Boisson sucrée (+150 cal)"
                        >
                          🥤 {drinkChecks[`${day}-${time}`] ? '+150' : ''}
                        </button>
                      </div>
                      {(slotCals > 0 || slotPro > 0) && (
                        <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm">
                          {slotCals > 0 && (
                            <span className="flex items-center gap-0.5">
                              <Flame className="w-2 h-2 text-orange-500/60" />
                              {Math.round(slotCals)}
                            </span>
                          )}
                          {slotCals > 0 && slotPro > 0 && <span className="opacity-30">•</span>}
                          {slotPro > 0 && (
                            <span className="flex items-center gap-0.5">
                              <span className="text-[9px] opacity-60">🍗</span>
                              {Math.round(slotPro)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="mt-0.5 space-y-1">
                      {slotMeals.length === 0 ? (
                        <div className="flex flex-col items-start gap-0.5">
                          <PlanningInput
                            storageKey={`manual-${day}-${time}`}
                            currentValue={manualCalories[`${day}-${time}`] || 0}
                            onSave={(val) => {
                              const key = `${day}-${time}`;
                              const updated = { ...manualCalories };
                              if (val > 0) updated[key] = val;
                              else delete updated[key];
                              setPreference.mutate({ key: 'planning_manual_calories', value: updated });
                            }}
                            placeholder="kcal"
                            className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 text-center"
                          />
                          <PlanningInput
                            storageKey={`manual-prot-${day}-${time}`}
                            currentValue={manualProteins[`${day}-${time}`] || 0}
                            onSave={(val) => {
                              const key = `${day}-${time}`;
                              const updated = { ...manualProteins };
                              if (val > 0) updated[key] = val;
                              else delete updated[key];
                              setPreference.mutate({ key: 'planning_manual_proteins', value: updated });
                            }}
                            placeholder="prot"
                            className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center"
                          />
                          <div className="w-14 flex justify-center">
                            <button
                              onClick={() => {
                                const snapKey = `manual-${day}-${time}`;
                                const cal = manualCalories[`${day}-${time}`] || 0;
                                const prot = manualProteins[`${day}-${time}`] || 0;
                                const updated = { ...savedSnapshots, [snapKey]: { cal, prot } };
                                setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });
                                setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                                setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                              }}
                              onDoubleClick={() => {
                                const snapKey = `manual-${day}-${time}`;
                                const updated = { ...savedSnapshots };
                                delete updated[snapKey];
                                setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });
                              }}
                              className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${flashedKeys[`manual-${day}-${time}`]
                                ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                                : savedSnapshots[`manual-${day}-${time}`]
                                  ? 'bg-primary/20 text-primary border border-primary/40'
                                  : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                                }`}
                              title={savedSnapshots[`manual-${day}-${time}`] ? `Sauvegardé: ${savedSnapshots[`manual-${day}-${time}`].cal || 0} kcal / ${savedSnapshots[`manual-${day}-${time}`].prot || 0} prot (Double-clic pour oublier)` : 'Sauvegarder les valeurs pour le reset (Double-clic pour oublier)'}
                            >💾</button>
                          </div>
                        </div>
                      ) : (
                        slotMeals.map((pm) => renderMiniCard(pm, false))
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Extra column */}
              <div className="min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed border-orange-300/30 p-1 sm:p-1.5 w-12 sm:w-20 flex flex-col items-center">
                <span className="text-[7px] sm:text-[8px] font-semibold text-orange-400/60 uppercase tracking-wide">Extra</span>
                <div className="flex flex-col items-center gap-0.5 mt-1 w-full">
                  <PlanningInput
                    storageKey={`extra-${day}`}
                    currentValue={(() => {
                      const manual = extraCalories[day] || 0;
                      const ids = extraSelections[day] || [];
                      const selected = ids.reduce((sum, id) => sum + parseCalories(foodItems.find(fi => fi.id === id)?.calories), 0);
                      return manual + selected;
                    })()}
                    onSave={(val) => {
                      const ids = extraSelections[day] || [];
                      const selected = ids.reduce((sum, id) => sum + parseCalories(foodItems.find(fi => fi.id === id)?.calories), 0);
                      const manual = Math.max(0, val - selected);
                      const updated = { ...extraCalories };
                      if (manual > 0) updated[day] = manual;
                      else delete updated[day];
                      setPreference.mutate({ key: 'planning_extra_calories', value: updated });
                    }}
                    placeholder="kcal"
                    className="w-full h-5 text-[11px] bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-400 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40 text-center"
                  />
                  <PlanningInput
                    storageKey={`extra-prot-${day}`}
                    currentValue={(() => {
                      const manual = extraProteins[day] || 0;
                      const ids = extraSelections[day] || [];
                      const selected = ids.reduce((sum, id) => sum + parseProtein(foodItems.find(fi => fi.id === id)?.protein), 0);
                      return manual + selected;
                    })()}
                    onSave={(val) => {
                      const ids = extraSelections[day] || [];
                      const selected = ids.reduce((sum, id) => sum + parseProtein(foodItems.find(fi => fi.id === id)?.protein), 0);
                      const manual = Math.max(0, val - selected);
                      const updated = { ...extraProteins };
                      if (manual > 0) updated[day] = manual;
                      else delete updated[day];
                      setPreference.mutate({ key: 'planning_extra_proteins', value: updated });
                    }}
                    placeholder="prot"
                    className="w-full h-5 text-[11px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center"
                  />
                  <div className="flex items-center gap-1 mt-1">
                    <Popover open={openExtrasDay === day} onOpenChange={(open) => setOpenExtrasDay(open ? day : null)}>
                      <PopoverTrigger asChild>
                        <button className={`h-5 w-5 flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95 ${extraSelections[day]?.length > 0 ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20'}`} title="Ajouter un aliment Extra">
                          <Plus className="h-3 w-3" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-3 bg-card/95 backdrop-blur-md border-orange-200/20 shadow-2xl rounded-2xl" align="center">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3" /> Extras disponibles
                          </p>
                          <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
                        </div>
                        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                          {foodItems.filter(fi => fi.storage_type === 'extras').sort((a, b) => a.sort_order - b.sort_order).length === 0 ? (
                            <div className="text-center py-4 bg-muted/20 rounded-xl">
                              <p className="text-[10px] text-muted-foreground italic">Aucun aliment "Extra" 🍕</p>
                              <p className="text-[9px] text-muted-foreground/60 mt-1">Ajoutez-les dans l'onglet Aliments</p>
                            </div>
                          ) : (
                            foodItems.filter(fi => fi.storage_type === 'extras').sort((a, b) => a.sort_order - b.sort_order).map(fi => {
                              const count = (extraSelections[day] || []).filter(id => id === fi.id).length;
                              return (
                                <div
                                  key={fi.id}
                                  className={`w-full p-2 rounded-xl border transition-all group flex items-center gap-3 ${count > 0
                                      ? 'bg-orange-500/20 border-orange-500/40 shadow-inner'
                                      : 'bg-muted/30 hover:bg-orange-500/10 border-transparent hover:border-orange-500/20'
                                    }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-[11px] font-bold transition-colors truncate ${count > 0 ? 'text-orange-600' : 'text-foreground group-hover:text-orange-600'}`}>{fi.name}</p>
                                    {(fi.grams || fi.quantity) && (
                                      <p className="text-[9px] text-muted-foreground/60">{fi.grams ? `${fi.grams}` : ''}{fi.grams && fi.quantity ? ' · ' : ''}{fi.quantity ? `x${fi.quantity}` : ''}</p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {count > 0 && (
                                      <>
                                        <button
                                          onClick={() => handleAddExtraItem(day, fi, true)}
                                          className="h-5 w-5 flex items-center justify-center rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-500 text-xs font-bold"
                                          title="Retirer un"
                                        >−</button>
                                        <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{count}</span>
                                      </>
                                    )}
                                    <button
                                      onClick={() => handleAddExtraItem(day, fi)}
                                      className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/20 hover:bg-orange-500/40 text-orange-500 text-xs font-bold"
                                      title="Ajouter un"
                                    >+</button>
                                    {fi.protein && (
                                      <div className="flex items-center gap-1 bg-blue-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-blue-500 border border-blue-500/10">
                                        🍗 {fi.protein}
                                      </div>
                                    )}
                                    {fi.calories && (
                                      <div className="flex items-center gap-1 bg-orange-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-orange-500">
                                        <Flame className="w-2.5 h-2.5" />
                                        {fi.calories}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <button
                      onClick={() => {
                        const snapKey = `extra-${day}`;
                        const cal = extraCalories[day] || 0;
                        const prot = extraProteins[day] || 0;
                        const itemIds = extraSelections[day] || [];
                        const updated = { ...savedSnapshots, [snapKey]: { cal, prot, itemIds } };
                        setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });
                        setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                        setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                      }}
                      onDoubleClick={() => {
                        const snapKey = `extra-${day}`;
                        const updated = { ...savedSnapshots };
                        delete updated[snapKey];
                        setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });
                      }}
                      className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${flashedKeys[`extra-${day}`]
                        ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                        : savedSnapshots[`extra-${day}`]
                          ? 'bg-primary/20 text-primary border border-primary/40'
                          : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                        }`}
                      title={savedSnapshots[`extra-${day}`] ? `Sauvegardé: ${savedSnapshots[`extra-${day}`].cal || 0} kcal / ${savedSnapshots[`extra-${day}`].prot || 0} prot, ${savedSnapshots[`extra-${day}`].itemIds?.length || 0} items (Double-clic pour oublier)` : 'Sauvegarder les valeurs pour le reset (Double-clic pour oublier)'}
                    >💾</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Total calorique de la semaine */}
      {(() => {
        const todayIndex = DAY_KEY_TO_INDEX[todayKey];
        const daysUpToToday = DAYS.slice(0, todayIndex + 1);
        const totalUpToToday = daysUpToToday.reduce((sum, d) => sum + getDayCalories(d), 0);
        const avgCal = daysUpToToday.length > 0 ? Math.round(totalUpToToday / daysUpToToday.length) : 0;
        return (
          <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between flex-wrap gap-1">
            <span className="text-sm font-bold text-foreground">Total semaine</span>
            <div className="flex items-center gap-3 flex-wrap ml-auto">
              <span className="text-xs text-muted-foreground font-medium">
                Moy. {avgCal} kcal/j <span className="text-muted-foreground/40">({daysUpToToday.length}j)</span>
              </span>
              <span className="flex items-center gap-1.5 text-sm font-black text-orange-500">
                <Flame className="h-4 w-4" />
                {Math.round(weekTotal)} <span className="text-muted-foreground/50 font-normal text-xs">/ {WEEKLY_GOAL}</span>
              </span>
            </div>
          </div>
        );
      })()}

      {/* Hors planning — drop zone to unplan */}
      <div
        data-unplanned
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverUnplanned(true);
        }}
        onDragLeave={() => setDragOverUnplanned(false)}
        onDrop={handleDropUnplanned}
        className={`rounded-2xl p-3 sm:p-4 transition-all ${dragOverUnplanned || touchHighlight === "unplanned" ? "bg-muted/60 ring-2 ring-border" : "bg-card/80 backdrop-blur-sm"}`}
      >
        <h3 className="text-sm sm:text-base font-bold text-foreground mb-2">Hors planning</h3>
        {unplanned.length === 0 ? (
          <p className={`text-xs italic ${dragOverUnplanned ? "text-foreground/60" : "text-muted-foreground/50"}`}>
            {dragOverUnplanned ? "Relâche pour retirer du planning ↓" : "Tous les repas sont planifiés ✨"}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">{unplanned.map((pm) => renderMiniCard(pm, true))}</div>
        )}
      </div>

      </>) : weekOffset === -1 ? (
        /* ─── Previous Week (Backup View) ─── */
        (() => {
          const backupRaw = getPreference<any>('possible_meals_backup', null);
          if (!backupRaw) return (
            <div className="rounded-2xl bg-card/80 backdrop-blur-sm p-6 text-center">
              <p className="text-sm text-muted-foreground italic">Aucune sauvegarde disponible</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Une sauvegarde est créée automatiquement lors du reset</p>
            </div>
          );
          const isNF = backupRaw && !Array.isArray(backupRaw) && backupRaw.cards;
          const cards: any[] = isNF ? backupRaw.cards : (Array.isArray(backupRaw) ? backupRaw : []);
          const bMC = isNF ? (backupRaw.manualCalories || {}) : {};
          const bMP = isNF ? (backupRaw.manualProteins || {}) : {};
          const bEC = isNF ? (backupRaw.extraCalories || {}) : {};
          const bEP = isNF ? (backupRaw.extraProteins || {}) : {};
          const bES = isNF ? (backupRaw.extraSelections || {}) : {};
          const bBC = isNF ? (backupRaw.breakfastManualCalories || {}) : {};
          const bBS = isNF ? (backupRaw.breakfastSelections || {}) : {};
          const bDC = isNF ? (backupRaw.drinkChecks || {}) : {};
          const bCO = isNF ? (backupRaw.calOverrides || {}) : {};

          const renderBackupCards = (slotCards: any[]) => slotCards.map((c: any, i: number) => {
            const m = allMealsById.get(c.meal_id);
            if (!m) return <div key={i} className="rounded-xl px-2 py-1 bg-muted text-[10px] text-muted-foreground">Repas supprimé</div>;
            return (
              <div key={i} className="rounded-xl px-2 py-1 text-white text-[10px] font-semibold" style={{ backgroundColor: getMealColor(c.ingredients_override ?? m.ingredients, m.name) }}>
                {getCategoryEmoji(m.category)} {m.name}
                {bCO[c.id] && <span className="ml-1 opacity-80">🔥{bCO[c.id]}</span>}
              </div>
            );
          });

          return (
            <div className="space-y-3">
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">📋 Lecture seule — Dernière sauvegarde avant reset</p>
              </div>
              {DAYS.map(day => {
                const dayCards = cards.filter((c: any) => c.day_of_week === day);
                const midiCards = dayCards.filter((c: any) => c.meal_time === 'midi');
                const soirCards = dayCards.filter((c: any) => c.meal_time === 'soir');
                const matinCards = dayCards.filter((c: any) => c.meal_time === 'matin');

                let dayTotal = 0;
                const bfSel = bBS[day];
                if (bfSel?.startsWith('meal:')) {
                  const m = allMealsById.get(bfSel.slice(5));
                  if (m) dayTotal += parseCalories(m.calories);
                } else { dayTotal += bBC[day] || 0; }
                for (const c of [...matinCards, ...midiCards, ...soirCards]) {
                  const override = bCO[c.id];
                  if (override) { dayTotal += parseFloat(override) || 0; continue; }
                  const m = allMealsById.get(c.meal_id);
                  if (m) dayTotal += parseCalories(m.calories);
                }
                if (midiCards.length === 0) dayTotal += bMC[`${day}-midi`] || 0;
                if (soirCards.length === 0) dayTotal += bMC[`${day}-soir`] || 0;
                dayTotal += bEC[day] || 0;
                for (const id of (bES[day] || [])) {
                  const fi = foodItems.find((f: any) => f.id === id);
                  if (fi) dayTotal += parseCalories(fi.calories);
                }
                for (const time of TIMES) { if (bDC[`${day}-${time}`]) dayTotal += 150; }

                return (
                  <div key={day} className="rounded-2xl bg-card/80 backdrop-blur-sm p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-bold text-foreground">{DAY_LABELS[day]}</h3>
                      {dayTotal > 0 && (
                        <span className="flex items-center gap-1 text-[11px] font-bold text-orange-500">
                          <Flame className="h-3 w-3" /> {Math.round(dayTotal)}
                        </span>
                      )}
                    </div>
                    {(() => {
                      const bfMeal = bfSel?.startsWith('meal:') ? allMealsById.get(bfSel.slice(5)) : null;
                      if (bfMeal) return <p className="text-[10px] text-orange-400 mb-1">🥐 {bfMeal.name}</p>;
                      if ((bBC[day] || 0) > 0) return <p className="text-[10px] text-orange-400 mb-1">🥐 {bBC[day]} kcal</p>;
                      return null;
                    })()}
                    {matinCards.length > 0 && (
                      <div className="mb-1">
                        <p className="text-[9px] font-semibold text-muted-foreground uppercase mb-0.5">Matin</p>
                        <div className="flex flex-wrap gap-1">{renderBackupCards(matinCards)}</div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[9px] font-semibold text-muted-foreground uppercase mb-0.5">Midi</p>
                        <div className="space-y-1">{renderBackupCards(midiCards)}</div>
                        {midiCards.length === 0 && (bMC[`${day}-midi`] || 0) > 0 && (
                          <p className="text-[10px] text-muted-foreground italic">✏️ {bMC[`${day}-midi`]} kcal</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[9px] font-semibold text-muted-foreground uppercase mb-0.5">Soir</p>
                        <div className="space-y-1">{renderBackupCards(soirCards)}</div>
                        {soirCards.length === 0 && (bMC[`${day}-soir`] || 0) > 0 && (
                          <p className="text-[10px] text-muted-foreground italic">✏️ {bMC[`${day}-soir`]} kcal</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()
      ) : (
        /* ─── Next Week Planning ─── */
        <div className="space-y-3">
          <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 p-3 text-center">
            <p className="text-xs font-bold text-blue-600 dark:text-blue-400">📅 Planification semaine prochaine</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Petits déj, extras et calories — conservés après le reset</p>
          </div>
          {DAYS.map(day => {
            const nBfSel = nextBreakfastSelections[day];
            const nBfMeal = nBfSel?.startsWith('meal:') ? allMealsById.get(nBfSel.slice(5)) : null;
            let dayTotal = 0;
            if (nBfMeal) dayTotal += parseCalories(nBfMeal.calories);
            else dayTotal += nextBreakfastManualCalories[day] || 0;
            for (const time of TIMES) {
              dayTotal += nextManualCalories[`${day}-${time}`] || 0;
              if (nextDrinkChecks[`${day}-${time}`]) dayTotal += 150;
            }
            dayTotal += nextExtraCalories[day] || 0;
            for (const id of (nextExtraSelections[day] || [])) {
              const fi = foodItems.find(f => f.id === id);
              if (fi) dayTotal += parseCalories(fi.calories);
            }
            let nxtDayPro = nBfMeal ? parseProtein(nBfMeal.protein) : (nextBreakfastManualProteins[day] || 0);
            for (const time of TIMES) nxtDayPro += nextManualProteins[`${day}-${time}`] || 0;
            nxtDayPro += nextExtraProteins[day] || 0;
            for (const id of (nextExtraSelections[day] || [])) {
              const fi = foodItems.find(f => f.id === id);
              if (fi) nxtDayPro += parseProtein(fi.protein);
            }

            return (
              <div key={day} className="rounded-2xl bg-card/80 backdrop-blur-sm p-2 sm:p-4">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <h3 className="text-sm sm:text-base font-bold text-foreground">{DAY_LABELS[day]}</h3>
                  {/* Petit déj selector */}
                  <div className="flex items-center gap-1">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-[10px] bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full font-semibold hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors truncate max-w-[120px]">
                          {nBfMeal ? nBfMeal.name : '🥐 Petit déj'}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-52 p-2" align="start">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Petit déjeuner</p>
                        <div className="space-y-0.5 max-h-48 overflow-y-auto">
                          <button onClick={() => {
                            const updated = { ...nextBreakfastSelections }; delete updated[day];
                            setPreference.mutate({ key: 'next_week_breakfast', value: updated });
                          }} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors">— Aucun</button>
                          {petitDejMeals.map(m => {
                            const mealSelId = `meal:${m.id}`;
                            const isSelected = nextBreakfastSelections[day] === mealSelId;
                            return (
                              <button key={m.id} onClick={() => {
                                const updated = { ...nextBreakfastSelections };
                                if (isSelected) delete updated[day]; else updated[day] = mealSelId;
                                setPreference.mutate({ key: 'next_week_breakfast', value: updated });
                              }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : ''}`}>
                                {m.name} {m.calories && <span className="text-muted-foreground text-[10px]">🔥{m.calories}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                    {!nBfMeal && (
                      <>
                        <PlanningInput storageKey={`next-bf-cal-${day}`} currentValue={nextBreakfastManualCalories[day] || 0}
                          onSave={(val) => { const u = { ...nextBreakfastManualCalories }; if (val > 0) u[day] = val; else delete u[day]; setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: u }); }}
                          placeholder="kcal" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40" />
                        <PlanningInput storageKey={`next-bf-prot-${day}`} currentValue={nextBreakfastManualProteins[day] || 0}
                          onSave={(val) => { const u = { ...nextBreakfastManualProteins }; if (val > 0) u[day] = val; else delete u[day]; setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: u }); }}
                          placeholder="prot" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40" />
                      </>
                    )}
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap justify-end">
                    <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 whitespace-nowrap">
                      <Flame className="h-2.5 w-2.5 text-orange-500" />
                      {Math.round(dayTotal)} <span className="text-muted-foreground/50 font-normal">/ {DAILY_GOAL}</span>
                    </span>
                    {dayTotal > 0 && (
                      <span className={`text-[10px] font-bold whitespace-nowrap ${DAILY_GOAL - dayTotal > 0 ? 'text-muted-foreground/60' : 'text-orange-500'}`}>
                        {DAILY_GOAL - dayTotal > 0 ? `reste ${Math.round(DAILY_GOAL - dayTotal)}` : `+${Math.round(dayTotal - DAILY_GOAL)}`}
                      </span>
                    )}
                    {nxtDayPro > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-500/10 rounded-full px-2 py-0.5 whitespace-nowrap">
                        🍗 {Math.round(nxtDayPro)} <span className="text-blue-400/50 font-normal">/ {DAILY_PROTEIN_GOAL_PREF}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-1 sm:gap-3">
                  {TIMES.map(time => {
                    const k = `${day}-${time}`;
                    return (
                      <div key={time} className="min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed border-border/40 p-1 sm:p-1.5">
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1">
                            <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                            <button onClick={() => {
                              const u = { ...nextDrinkChecks }; if (u[k]) delete u[k]; else u[k] = true;
                              setPreference.mutate({ key: 'next_week_drink_checks', value: u });
                            }} className={`flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px transition-colors ${nextDrinkChecks[k] ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold' : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60'}`}>
                              🥤 {nextDrinkChecks[k] ? '+150' : ''}
                            </button>
                          </div>
                        </div>
                        <div className="mt-0.5 space-y-1">
                          <div className="flex flex-col items-start gap-0.5">
                            <PlanningInput storageKey={`next-mc-${k}`} currentValue={nextManualCalories[k] || 0}
                              onSave={(val) => { const u = { ...nextManualCalories }; if (val > 0) u[k] = val; else delete u[k]; setPreference.mutate({ key: 'next_week_manual_calories', value: u }); }}
                              placeholder="kcal" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 text-center" />
                            <PlanningInput storageKey={`next-mp-${k}`} currentValue={nextManualProteins[k] || 0}
                              onSave={(val) => { const u = { ...nextManualProteins }; if (val > 0) u[k] = val; else delete u[k]; setPreference.mutate({ key: 'next_week_manual_proteins', value: u }); }}
                              placeholder="prot" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {/* Extra column */}
                  <div className="min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed border-orange-300/30 p-1 sm:p-1.5 w-12 sm:w-20 flex flex-col items-center">
                    <span className="text-[7px] sm:text-[8px] font-semibold text-orange-400/60 uppercase tracking-wide">Extra</span>
                    <div className="flex flex-col items-center gap-0.5 mt-1 w-full">
                      <PlanningInput storageKey={`next-ec-${day}`}
                        currentValue={(() => { const m = nextExtraCalories[day] || 0; const ids = nextExtraSelections[day] || []; return m + ids.reduce((s, id) => s + parseCalories(foodItems.find(fi => fi.id === id)?.calories), 0); })()}
                        onSave={(val) => { const ids = nextExtraSelections[day] || []; const sel = ids.reduce((s, id) => s + parseCalories(foodItems.find(fi => fi.id === id)?.calories), 0); const m = Math.max(0, val - sel); const u = { ...nextExtraCalories }; if (m > 0) u[day] = m; else delete u[day]; setPreference.mutate({ key: 'next_week_extra_calories', value: u }); }}
                        placeholder="kcal" className="w-full h-5 text-[11px] bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-400 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40 text-center" />
                      <PlanningInput storageKey={`next-ep-${day}`}
                        currentValue={(() => { const m = nextExtraProteins[day] || 0; const ids = nextExtraSelections[day] || []; return m + ids.reduce((s, id) => s + parseProtein(foodItems.find(fi => fi.id === id)?.protein), 0); })()}
                        onSave={(val) => { const ids = nextExtraSelections[day] || []; const sel = ids.reduce((s, id) => s + parseProtein(foodItems.find(fi => fi.id === id)?.protein), 0); const m = Math.max(0, val - sel); const u = { ...nextExtraProteins }; if (m > 0) u[day] = m; else delete u[day]; setPreference.mutate({ key: 'next_week_extra_proteins', value: u }); }}
                        placeholder="prot" className="w-full h-5 text-[11px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center" />
                      <div className="flex items-center gap-1 mt-1">
                        <Popover open={openExtrasDay === `next-${day}`} onOpenChange={(open) => setOpenExtrasDay(open ? `next-${day}` : null)}>
                          <PopoverTrigger asChild>
                            <button className={`h-5 w-5 flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95 ${(nextExtraSelections[day]?.length || 0) > 0 ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20'}`} title="Ajouter un Extra">
                              <Plus className="h-3 w-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 p-3 bg-card/95 backdrop-blur-md border-orange-200/20 shadow-2xl rounded-2xl" align="center">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Extras disponibles</p>
                              <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
                            </div>
                            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                              {foodItems.filter(fi => fi.storage_type === 'extras').sort((a, b) => a.sort_order - b.sort_order).map(fi => {
                                const count = (nextExtraSelections[day] || []).filter(id => id === fi.id).length;
                                return (
                                  <div key={fi.id} className={`w-full p-2 rounded-xl border transition-all group flex items-center gap-3 ${count > 0 ? 'bg-orange-500/20 border-orange-500/40 shadow-inner' : 'bg-muted/30 hover:bg-orange-500/10 border-transparent hover:border-orange-500/20'}`}>
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-[11px] font-bold transition-colors truncate ${count > 0 ? 'text-orange-600' : 'text-foreground group-hover:text-orange-600'}`}>{fi.name}</p>
                                      {(fi.grams || fi.quantity) && (
                                        <p className="text-[9px] text-muted-foreground/60">{fi.grams ? `${fi.grams}` : ''}{fi.grams && fi.quantity ? ' · ' : ''}{fi.quantity ? `x${fi.quantity}` : ''}</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {count > 0 && (<>
                                        <button onClick={() => { const u = { ...nextExtraSelections }; const c = u[day] || []; const idx = c.lastIndexOf(fi.id); if (idx >= 0) u[day] = [...c.slice(0, idx), ...c.slice(idx + 1)]; setPreference.mutate({ key: 'next_week_extra_selections', value: u }); }} className="h-5 w-5 flex items-center justify-center rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-500 text-xs font-bold">−</button>
                                        <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{count}</span>
                                      </>)}
                                      <button onClick={() => { const u = { ...nextExtraSelections }; u[day] = [...(u[day] || []), fi.id]; setPreference.mutate({ key: 'next_week_extra_selections', value: u }); }} className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/20 hover:bg-orange-500/40 text-orange-500 text-xs font-bold">+</button>
                                      {fi.protein && (
                                        <div className="flex items-center gap-1 bg-blue-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-blue-500 border border-blue-500/10">
                                          🍗 {fi.protein}
                                        </div>
                                      )}
                                      {fi.calories && (
                                        <div className="flex items-center gap-1 bg-orange-500/10 px-1.5 py-0.5 rounded-lg text-[9px] font-black text-orange-500">
                                          <Flame className="w-2.5 h-2.5" />
                                          {fi.calories}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {/* Next week total */}
          {(() => {
            let total = 0;
            let totalPro = 0;
            for (const day of DAYS) {
              const nBfSel = nextBreakfastSelections[day];
              const nBfMeal = nBfSel?.startsWith('meal:') ? allMealsById.get(nBfSel.slice(5)) : null;
              if (nBfMeal) { total += parseCalories(nBfMeal.calories); totalPro += parseProtein(nBfMeal.protein); }
              else { total += nextBreakfastManualCalories[day] || 0; totalPro += nextBreakfastManualProteins[day] || 0; }
              for (const time of TIMES) {
                total += nextManualCalories[`${day}-${time}`] || 0;
                totalPro += nextManualProteins[`${day}-${time}`] || 0;
                if (nextDrinkChecks[`${day}-${time}`]) total += 150;
              }
              total += nextExtraCalories[day] || 0;
              totalPro += nextExtraProteins[day] || 0;
              for (const id of (nextExtraSelections[day] || [])) {
                const fi = foodItems.find(f => f.id === id);
                if (fi) { total += parseCalories(fi.calories); totalPro += parseProtein(fi.protein); }
              }
            }
            const avgCal = Math.round(total / 7);
            return (
              <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between flex-wrap gap-1">
                <span className="text-sm font-bold text-foreground">Total prévu</span>
                <div className="flex items-center gap-3 flex-wrap ml-auto">
                  <span className="text-xs text-muted-foreground font-medium">Moy. {avgCal} kcal/j</span>
                  <span className="flex items-center gap-1.5 text-sm font-black text-orange-500">
                    <Flame className="h-4 w-4" /> {Math.round(total)} <span className="text-muted-foreground/50 font-normal text-xs">/ {WEEKLY_GOAL}</span>
                  </span>
                  {totalPro > 0 && (
                    <span className="flex items-center gap-1 text-sm font-bold text-blue-400">🍗 {Math.round(totalPro)}</span>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <Dialog open={!!popupPm} onOpenChange={(open) => { if (!open) setPopupPm(null); }}>
        <DialogContent className="max-w-md p-0 overflow-hidden" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Détails du repas</DialogTitle>
          {popupPm && popupPm.meals && (() => {
            const meal = popupPm.meals;
            const displayIngredients = popupPm.ingredients_override ?? meal.ingredients;
            const mealForAnalysis = { ...meal, ingredients: displayIngredients };
            const analysis = analyzeMealIngredients(mealForAnalysis, foodItems);
            const effectiveStart = analysis.earliestCounterDate || popupPm.counter_start_date;
            const displayCal = String(getCardDisplayCalories(popupPm, undefined, isAvailableCb));
            const displayPro = String(getCardDisplayProtein(popupPm, isAvailableCb));
            const counterDays = getAdaptedCounterDays(effectiveStart, popupPm.day_of_week, popupPm.created_at, popupPm.meal_time);
            const expired = isExpiredOnDay(popupPm.expiration_date, popupPm.day_of_week);
            return (
              <div className="rounded-2xl p-5 text-white" style={{ backgroundColor: getMealColor(meal.ingredients, meal.name) }}>
                <h3 className="text-lg font-bold mb-2">{getCategoryEmoji(meal.category)} {meal.name}</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {displayCal && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Flame className="h-3.5 w-3.5" /> {displayCal} kcal
                    </span>
                  )}
                  {displayPro && (
                    <span className="text-sm font-bold bg-blue-600/50 px-2.5 py-1 rounded-full flex items-center gap-1">
                      🍗 {displayPro}g
                    </span>
                  )}
                  {meal.grams && (
                    <span className="text-sm bg-white/20 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Weight className="h-3.5 w-3.5" /> {meal.grams}
                    </span>
                  )}
                  {counterDays !== null && counterDays >= 1 && (
                    <span className={`text-sm font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${counterDays >= 3 ? 'bg-red-600' : 'bg-black/40'}`}>
                      <Timer className="h-3.5 w-3.5" /> {counterDays}j
                    </span>
                  )}
                  {counterDays === null && popupPm.counter_start_date && (
                    <span className="text-sm font-bold bg-blue-500/40 px-2.5 py-1 rounded-full flex items-center gap-1 border border-blue-300/30">
                      <Timer className="h-3.5 w-3.5" /> 📅 Programmé
                    </span>
                  )}
                </div>
                {popupPm.expiration_date && (
                  <p className={`text-sm mb-2 ${expired ? 'text-red-200 font-bold' : 'text-white/70'}`}>
                    📅 {format(parseISO(popupPm.expiration_date), "d MMMM yyyy", { locale: fr })}
                  </p>
                )}
                {displayIngredients && (
                  <div className="bg-black/20 rounded-xl p-3 mt-1">
                    <p className="text-xs font-semibold text-white/60 mb-1 uppercase tracking-wide">Ingrédients</p>
                    <div className="text-sm text-white/90 space-y-0.5">
                      {renderIngredientDisplayPlanning(displayIngredients, undefined, undefined, stockMap, true).map((el, i) => (
                        <p key={i}>{el}</p>
                      ))}
                    </div>
                  </div>
                )}
                {(meal.oven_temp || meal.oven_minutes) && (
                  <p className="text-sm text-white/80 mt-2 flex items-center gap-1"><Thermometer className="h-3.5 w-3.5" /> {meal.oven_temp && `${meal.oven_temp}°C`}{meal.oven_temp && meal.oven_minutes && ' · '}{meal.oven_minutes && `${meal.oven_minutes} min`}</p>
                )}
                {popupPm.day_of_week && popupPm.meal_time && (
                  <p className="text-xs text-white/50 mt-3">
                    {DAY_LABELS[popupPm.day_of_week]} — {TIME_LABELS[popupPm.meal_time]}
                  </p>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Breakfast double-click popup */}
      <Dialog open={!!popupBreakfast} onOpenChange={(open) => { if (!open) setPopupBreakfast(null); }}>
        <DialogContent className="max-w-md p-0 overflow-hidden" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Détails du petit déjeuner</DialogTitle>
          {popupBreakfast && (() => {
            const meal = popupBreakfast.meal;
            const displayCal = getMealCal(meal);
            const displayPro = getMealPro(meal);
            return (
              <div className="rounded-2xl p-5 text-white" style={{ backgroundColor: getMealColor(meal.ingredients, meal.name) }}>
                <h3 className="text-lg font-bold mb-2">🥐 {meal.name}</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {displayCal && (
                    <span className="text-sm font-bold bg-black/30 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Flame className="h-3.5 w-3.5" /> {displayCal} kcal
                    </span>
                  )}
                  {displayPro && (
                    <span className="text-sm font-bold bg-blue-600/50 px-2.5 py-1 rounded-full flex items-center gap-1">
                      🍗 {displayPro}g
                    </span>
                  )}
                  {meal.grams && (
                    <span className="text-sm bg-white/20 px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Weight className="h-3.5 w-3.5" /> {meal.grams}
                    </span>
                  )}
                </div>
                {meal.ingredients && (
                  <div className="bg-black/20 rounded-xl p-3 mt-1">
                    <p className="text-xs font-semibold text-white/60 mb-1 uppercase tracking-wide">Ingrédients</p>
                    <div className="text-sm text-white/90 space-y-0.5">
                      {meal.ingredients.split(/[,\n]+/).map((g: string, i: number) => (
                        <p key={i}>{cleanIngredientText(g.trim())}</p>
                      ))}
                    </div>
                  </div>
                )}
                {(meal.oven_temp || meal.oven_minutes) && (
                  <p className="text-sm text-white/80 mt-2 flex items-center gap-1"><Thermometer className="h-3.5 w-3.5" /> {meal.oven_temp && `${meal.oven_temp}°C`}{meal.oven_temp && meal.oven_minutes && ' · '}{meal.oven_minutes && `${meal.oven_minutes} min`}</p>
                )}
                <p className="text-xs text-white/50 mt-3">
                  {DAY_LABELS[popupBreakfast.day]}
                </p>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Render ingredient display with expired/soon highlighting (Compact version for Planning) */
function renderIngredientDisplayPlanning(
  ingredients: string,
  expiredIngredientNames?: Set<string>,
  expiringSoonIngredientNames?: Set<string>,
  stockMap?: Map<string, StockInfo>,
  noStrikeThrough?: boolean,
) {
  // Split raw ingredients first, filter out negative-metric groups, then clean for display
  const rawGroups = ingredients.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  const filteredRaw = rawGroups.filter(g => !g.split(/\|/).some(alt => hasNegativeMetric(alt.trim())));
  const cleaned = cleanIngredientText(filteredRaw.join(", "));
  const groups = cleaned.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  const elements: React.ReactNode[] = [];

  const isAvailable = (name: string) => {
    if (!stockMap) return false;
    const stripped = name.replace(/^\d+(?:[.,]\d+)?(?:g|ml|kg|cl|l|x| unit)?\s+/i, "").trim();
    if (!stripped) return false;
    const stockKey = findStockKey(stockMap, stripped);
    if (!stockKey) return false;
    const stock = stockMap.get(stockKey);
    if (!stock) return false;
    return stock.infinite || stock.grams > 0 || stock.count > 0;
  };

  groups.forEach((group, gi) => {
    const isOpt = group.startsWith("?");
    const display = isOpt ? group.slice(1).trim() : group;

    // Handle OR alternatives (|)
    const alternatives = display.split(/\s*\|\s*/);
    if (alternatives.length > 1 && stockMap) {
      const altElements = alternatives.map((alt, ai) => {
        const available = isAvailable(alt);
        return (
          <span key={ai} className={available ? '' : (noStrikeThrough ? 'opacity-40' : 'line-through opacity-40')}>
            {alt}{ai < alternatives.length - 1 ? <span className="opacity-60"> ou </span> : ''}
          </span>
        );
      });
      elements.push(
        <span key={gi}>
          {isOpt ? '?' : ''}{altElements}{gi < groups.length - 1 ? ' •' : ''}
        </span>
      );
      return;
    }

    const normalizedName = normalizeKey(display.replace(/^\d+(?:\.\d+)?(?:g|ml|x| unit)?\s+/i, ""));
    const isExpired = expiredIngredientNames?.has(normalizedName);
    const isSoon = expiringSoonIngredientNames?.has(normalizedName);

    const cls = isExpired ? 'bg-red-500/40 text-red-100 px-0.5 rounded font-semibold'
      : isSoon ? 'ring-1 ring-red-500/60 font-semibold px-0.5 rounded'
        : isOpt ? 'italic text-white/40'
          : '';

    elements.push(
      <span key={gi} className={cls}>
        {isOpt ? '?' : ''}{display}{gi < groups.length - 1 ? ' •' : ''}
      </span>
    );
  });

  return elements;
}
