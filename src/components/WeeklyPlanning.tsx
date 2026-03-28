import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useMeals, DAYS, TIMES, type PossibleMeal, type Meal } from "@/hooks/useMeals";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { usePreferences } from "@/hooks/usePreferences";
import { useCalorieBalance, getOverrideScaleRatio, getCardDisplayProtein, getCardDisplayCalories } from "@/hooks/useCalorieBalance";
import { Timer, Flame, Weight, Calendar, Lock, Plus, Thermometer, Sparkles, Zap, Hash } from "lucide-react";
import { computeIngredientCalories, computeIngredientProtein, cleanIngredientText, normalizeKey, hasNegativeMetric, getMealColor, getAdaptedCounterDays, getTargetDate, computeCounterHours } from "@/lib/ingredientUtils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { format, parseISO, differenceInCalendarDays, startOfWeek, addDays as addDaysFns, addWeeks } from "date-fns";
import { fr } from "date-fns/locale";
import { Checkbox } from "@/components/ui/checkbox";
import { useFoodItems, type FoodItem } from "@/hooks/useFoodItems";
import { useSortModes } from "@/hooks/useSortModes";
import { getSortedFoodItems } from "@/lib/foodSortUtils";
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
function PlanningMiniCard({ pm, meal, expired, counterDays, counterHours, counterUrgent, isPast, displayCal, isComputedCal, displayPro, isComputedPro, compact, isTouchDevice, touchDragActive, slotDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onRemove, onCalorieChange, expiredIngredientNames, expiringSoonIngredientNames, onDoubleClick, stockMap }: {
  pm: PossibleMeal; meal: any; expired: boolean; counterDays: number | null; counterHours: number | null; counterUrgent: boolean; isPast: boolean; displayCal: string | null; isComputedCal: boolean; displayPro: string | null; isComputedPro: boolean; compact: boolean;
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
              {counterDays !== null ? (
                <span
                  className={`text-[9px] font-black px-1.5 py-0.5 rounded-full mt-0.5 flex items-center gap-0.5 border
                  ${counterUrgent ? `bg-red-600 text-white border-red-300 shadow-md ${!isPast ? 'animate-pulse' : ''}` : "bg-black/50 text-white border-white/30"}`}
                  title={counterHours !== null ? `${counterHours}h écoulées` : undefined}
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
            {counterDays !== null ? (
              <span
                className={`text-[9px] font-black px-1.5 py-0.5 rounded-full mt-0.5 flex items-center gap-0.5 border
                ${counterUrgent ? "bg-red-600 text-white border-red-300 shadow-md" : "bg-black/50 text-white border-white/30"}`}
                title={counterHours !== null ? `${counterHours}h écoulées` : undefined}
              >
                <Timer className="h-2.5 w-2.5" />
                {counterDays}j
              </span>
            ) : null}
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
  const { foodSortModes, sortDirections } = useSortModes({ enabled: true });
  const stockMap = useMemo(() => buildStockMap(foodItems), [foodItems]);
  const [weekOffset, setWeekOffset] = useState(0);

  const weekDates = useMemo(() => {
    const now = addWeeks(new Date(), weekOffset);
    const monday = startOfWeek(now, { weekStartsOn: 1 });
    return ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].map((key, i) => {
      const date = addDaysFns(monday, i);
      return {
        key,
        iso: format(date, 'yyyy-MM-dd'),
        display: format(date, 'EEEE d/MM', { locale: fr }).toUpperCase()
      };
    });
  }, [weekOffset]);

  const todayISO = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

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
      updateFoodItemCountersForPlanning(ing, day, time, fallbackDate, pm.created_at);
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
          updateFoodItemCountersForPlanning(ing, day, 'matin', pm.created_at, pm.created_at);
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

  const getMealsForSlot = (day: string, time: string, iso?: string): PossibleMeal[] =>
    planningMeals
      .filter((pm) => (pm.day_of_week === day || (iso && pm.day_of_week === iso)) && pm.meal_time === time)
      .sort((a, b) => a.sort_order - b.sort_order);

  const getDisplayDay = (day: string | null | undefined) => {
    if (!day) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      try {
        return format(parseISO(day), 'EEEE d/MM', { locale: fr }).toUpperCase();
      } catch (e) {
        return day;
      }
    }
    return DAY_LABELS[day] || (DAY_KEY_TO_INDEX[day?.toLowerCase()] !== undefined ? DAY_LABELS[day.toLowerCase()] : day);
  };

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
  const NEXT_DAILY_GOAL = getPreference<number>('next_week_daily_goal', DAILY_GOAL);
  const NEXT_PROTEIN_GOAL = getPreference<number>('next_week_protein_goal', DAILY_PROTEIN_GOAL_PREF);
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

  const backupTotals = useMemo(() => {
    if (weekOffset !== -1) return null;
    const backupRaw = getPreference<any>('possible_meals_backup', null);
    if (!backupRaw) return null;
    
    const isNF = backupRaw && !Array.isArray(backupRaw) && backupRaw.cards;
    const cards: any[] = isNF ? backupRaw.cards : (Array.isArray(backupRaw) ? backupRaw : []);
    const bMC = isNF ? (backupRaw.manualCalories || {}) : {};
    const bMP = isNF ? (backupRaw.manualProteins || {}) : {};
    const bEC = isNF ? (backupRaw.extraCalories || {}) : {};
    const bEP = isNF ? (backupRaw.extraProteins || {}) : {};
    const bES = isNF ? (backupRaw.extraSelections || {}) : {};
    const bBC = isNF ? (backupRaw.breakfastManualCalories || {}) : {};
    const bBP = isNF ? (backupRaw.breakfastManualProteins || {}) : {};
    const bBS = isNF ? (backupRaw.breakfastSelections || {}) : {};
    const bDC = isNF ? (backupRaw.drinkChecks || {}) : {};
    const bCO = isNF ? (backupRaw.calOverrides || {}) : {};

    // Restore archived goals if present, otherwise fallback to current goals
    const archivedDailyGoal = isNF && backupRaw.daily_goal ? backupRaw.daily_goal : DAILY_GOAL;
    const archivedProteinGoal = isNF && backupRaw.protein_goal ? backupRaw.protein_goal : DAILY_PROTEIN_GOAL_PREF;

    let totalCal = 0;
    let totalPro = 0;

    const bDates = weekDates;
    bDates.forEach(({ key, iso }) => {
      const isTodayBack = iso === todayISO;
      let dayCal = 0;
      let dayPro = 0;

      // Meals
      cards.filter(c => c.day_of_week === key || c.day_of_week === iso).forEach(c => {
        const m = allMealsById.get(c.meal_id);
        if (m) {
          const overrideCal = bCO[c.id];
          dayCal += overrideCal ? (parseFloat(overrideCal) || 0) : getCardDisplayCalories(c, undefined, isAvailableCb);
          dayPro += getCardDisplayProtein(c, isAvailableCb);
        }
      });

      // Manual
      dayCal += (bMC[iso] || bMC[key] || 0);
      dayPro += (bMP[iso] || bMP[key] || 0);

      // Extra
      const eCal = (bEC[iso] || bEC[key] || 0) + (bES[iso] || bES[key] || []).reduce((s: number, id: string) => s + parseCalories(foodItems.find(fi => fi.id === id)?.calories), 0);
      const ePro = (bEP[iso] || bEP[key] || 0) + (bES[iso] || bES[key] || []).reduce((s: number, id: string) => s + parseProtein(foodItems.find(fi => fi.id === id)?.protein), 0);
      dayCal += eCal;
      dayPro += ePro;

      // Breakfast
      const bfSel = bBS[iso] || bBS[key];
      if (bfSel) {
        if (bfSel.startsWith('pm:')) {
          const pm = cards.find(p => p.id === bfSel.slice(3));
          if (pm) {
            dayCal += getCardDisplayCalories(pm, bCO[pm.id], isAvailableCb);
            dayPro += getCardDisplayProtein(pm, isAvailableCb);
          }
        } else {
          const m = allMealsById.get(bfSel);
          if (m) {
            dayCal += parseCalories(m.calories);
            dayPro += parseProtein(m.protein);
          }
        }
      }
      dayCal += (bBC[iso] || bBC[key] || 0);
      dayPro += (bBP[iso] || bBP[key] || 0);

      // Drinks
      if (bDC[iso] || bDC[key]) {
        dayCal += 150;
      }

      totalCal += dayCal;
      totalPro += dayPro;
    });

    return { totalCal, totalPro, archivedDailyGoal, archivedProteinGoal };
  }, [getPreference, weekOffset, DAILY_GOAL, DAILY_PROTEIN_GOAL_PREF, allMealsById, meals, foodItems, weekDates]);

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

    const effectiveStart = analysis.earliestCounterDate ?? pm.counter_start_date;
    const targetDate = getTargetDate(pm.day_of_week, new Date(), effectiveStart, pm.meal_time);
    const counterDays = getAdaptedCounterDays(effectiveStart, pm.day_of_week, pm.created_at, pm.meal_time);
    const counterHours = computeCounterHours(effectiveStart, targetDate);
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
        counterHours={counterHours}
        counterUrgent={counterUrgent}
        isPast={(() => {
          if (!pm.day_of_week) return false;
          const target = getDateForDayKey(pm.day_of_week, new Date());
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

  const weekTotal = weekDates.reduce((sum, d) => sum + getDayCalories(d.key, d.iso), 0);

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
      if (raw.daily_goal) setPreference.mutate({ key: 'planning_daily_goal', value: raw.daily_goal });
      if (raw.protein_goal) setPreference.mutate({ key: 'planning_protein_goal', value: raw.protein_goal });
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
      daily_goal: DAILY_GOAL,
      protein_goal: DAILY_PROTEIN_GOAL_PREF,
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

    // Migrate next-week goals if they were set
    const nCal = getPreference<number>('next_week_daily_goal', 0);
    const nPro = getPreference<number>('next_week_protein_goal', 0);
    if (nCal > 0) {
      setPreference.mutate({ key: 'planning_daily_goal', value: nCal });
      setPreference.mutate({ key: 'next_week_daily_goal', value: 0 });
    }
    if (nPro > 0) {
      setPreference.mutate({ key: 'planning_protein_goal', value: nPro });
      setPreference.mutate({ key: 'next_week_protein_goal', value: 0 });
    }
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
                defaultValue={weekOffset === 1 ? NEXT_DAILY_GOAL : DAILY_GOAL}
                key={`global-cal-${weekOffset === 1 ? NEXT_DAILY_GOAL : DAILY_GOAL}`}
                onBlur={(e) => {
                  const val = parseInt(e.target.value);
                  if (val && val > 0) setPreference.mutate({ key: weekOffset === 1 ? 'next_week_daily_goal' : 'planning_daily_goal', value: val });
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
                defaultValue={weekOffset === 1 ? NEXT_PROTEIN_GOAL : DAILY_PROTEIN_GOAL_PREF}
                key={`global-prot-${weekOffset === 1 ? NEXT_PROTEIN_GOAL : DAILY_PROTEIN_GOAL_PREF}`}
                onBlur={(e) => {
                  const val = parseInt(e.target.value);
                  if (val && val > 0) setPreference.mutate({ key: weekOffset === 1 ? 'next_week_protein_goal' : 'planning_protein_goal', value: val });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-14 h-6 text-xs bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 focus:outline-none focus:border-blue-400/50 text-center"
              />
              <span className="text-[9px] text-muted-foreground">prot/j</span>
            </div>
          </>
        )}
        {weekOffset === -1 && backupTotals && (
          <>
            <div className="flex items-center gap-1">
              <Flame className="h-3 w-3 text-orange-500" />
              <div className="w-16 h-6 text-xs bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 flex items-center justify-center font-bold">
                {Math.round(backupTotals.archivedDailyGoal)}
              </div>
              <span className="text-[9px] text-muted-foreground">kcal/j</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs">🍗</span>
              <div className="w-14 h-6 text-xs bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 flex items-center justify-center font-bold">
                {Math.round(backupTotals.archivedProteinGoal)}
              </div>
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
        {weekDates.map(({ key, iso, display }) => {
          const isToday_ = iso === todayISO;
          const dayCalories = getDayCalories(key, iso);
          const matinMeals = getMealsForSlot(key, 'matin', iso);
          const matinCals = matinMeals.reduce((s, pm) => s + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailableCb), 0);
          const matinPro = matinMeals.reduce((s, pm) => s + getCardDisplayProtein(pm, isAvailableCb), 0);

          const breakfast = getBreakfastForDay(key, iso);
          let baseBreakfastCals = 0;
          let baseBreakfastPro = 0;
          if (breakfast) {
            const selId = (iso && breakfastSelections[iso]) || breakfastSelections[key];
            if (selId?.startsWith('pm:')) {
              const pmId = selId.slice(3);
              const possiblePdj = possibleMeals.find(pm => pm.id === pmId);
              const isAlsoMatin = possiblePdj && (possiblePdj.day_of_week === key || possiblePdj.day_of_week === iso) && possiblePdj.meal_time === 'matin';
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
            baseBreakfastCals = (iso && breakfastManualCalories[iso]) || breakfastManualCalories[key] || 0;
            baseBreakfastPro = (iso && breakfastManualProteins[iso]) || breakfastManualProteins[key] || 0;
          }

          const breakfastTotalCals = baseBreakfastCals + matinCals;
          const breakfastTotalPro = baseBreakfastPro + matinPro;

          return (
            <div
              key={iso}
              ref={isToday_ ? todayRef : undefined}
              className={`rounded-2xl p-2 sm:p-4 transition-all ${isToday_ ? "bg-primary/10 ring-2 ring-primary/40" : "bg-card/80 backdrop-blur-sm"}`}
            >
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h3
                  className={`text-sm sm:text-base font-bold flex items-center gap-2 ${isToday_ ? "text-primary" : "text-foreground"}`}
                >
                  {display}
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
                          const bm = getBreakfastForDay(key, iso);
                          if (bm) setPopupBreakfast({ meal: bm, day: iso });
                        }}
                      >
                        {(() => {
                          const count = matinMeals.length + (getBreakfastForDay(key, iso) ? 1 : 0);
                          if (count > 1) return 'Plusieurs petits déj';
                          if (count === 1) {
                            if (matinMeals.length === 1) return matinMeals[0].meals?.name || '🥐 Petit déj';
                            return getBreakfastForDay(key, iso)?.name || '🥐 Petit déj';
                          }
                          return '🥐 Petit déj';
                        })()}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-52 p-2" align="start">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Petit déjeuner</p>
                      <div className="space-y-0.5 max-h-48 overflow-y-auto">
                        <button onClick={() => setBreakfastForDay(iso, null)} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors">
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
                              const isMatinSelected = (pm.day_of_week === key || pm.day_of_week === iso) && pm.meal_time === 'matin';
                              const isDropdownSelected = (iso && breakfastSelections[iso] === pmSelId) || breakfastSelections[key] === pmSelId;
                              const isSelected = isMatinSelected || isDropdownSelected;
                              // Find other days where this possible breakfast is selected
                              const otherDays = weekDates.filter(wd => wd.iso !== iso && (breakfastSelections[wd.iso] === pmSelId || breakfastSelections[wd.key] === pmSelId || (pm.day_of_week === wd.iso && pm.meal_time === 'matin') || (pm.day_of_week === wd.key && pm.meal_time === 'matin')));
                              const otherDaysLabel = otherDays.length > 0 ? otherDays.map(d => d.display.slice(0, 3)).join(', ') : null;
                              return (
                                <button key={pm.id} onClick={() => {
                                  if (isDropdownSelected) setBreakfastForDay(iso, null);
                                  if (isSelected) {
                                    updatePlanning.mutate({ id: pm.id, day_of_week: null, meal_time: null });
                                  } else {
                                    updatePlanning.mutate({ id: pm.id, day_of_week: iso, meal_time: 'matin' });
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
                          const isSelected = (iso && breakfastSelections[iso] === mealSelId) || breakfastSelections[key] === mealSelId;
                          const otherDays = weekDates.filter(wd => wd.iso !== iso && (breakfastSelections[wd.iso] === mealSelId || breakfastSelections[wd.key] === mealSelId));
                          const otherDaysLabel = otherDays.length > 0 ? otherDays.map(d => d.display.slice(0, 3)).join(', ') : null;
                          return (
                            <button key={m.id} onClick={() => {
                              if (isSelected) setBreakfastForDay(iso, null);
                              else setBreakfastForDay(iso, mealSelId);
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
                  {!getBreakfastForDay(key, iso) && matinMeals.length === 0 && (
                    <>
                      <PlanningInput
                        storageKey={`breakfast-cal-${iso}`}
                        currentValue={(iso && breakfastManualCalories[iso]) || breakfastManualCalories[key] || 0}
                        onSave={(val) => {
                          const updated = { ...breakfastManualCalories };
                          if (val > 0) updated[iso] = val;
                          else { delete updated[iso]; delete updated[key]; }
                          setPreference.mutate({ key: 'planning_breakfast_manual_calories', value: updated });
                        }}
                        placeholder="kcal"
                        className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40"
                      />
                      <PlanningInput
                        storageKey={`breakfast-prot-${iso}`}
                        currentValue={(iso && breakfastManualProteins[iso]) || breakfastManualProteins[key] || 0}
                        onSave={(val) => {
                          const updated = { ...breakfastManualProteins };
                          if (val > 0) updated[iso] = val;
                          else { delete updated[iso]; delete updated[key]; }
                          setPreference.mutate({ key: 'planning_breakfast_manual_proteins', value: updated });
                        }}
                        placeholder="prot"
                        className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40"
                      />
                    </>
                  )}
                  {/* Auto-consume breakfast toggle */}
                  {getBreakfastForDay(key, iso) && (
                    <button
                      onClick={() => {
                        const updated = { ...autoConsumeBreakfast };
                        if (iso && updated[iso]) delete updated[iso];
                        else if (updated[key]) delete updated[key];
                        else if (iso) updated[iso] = true;
                        else updated[key] = true;
                        setPreference.mutate({ key: 'planning_auto_consume_breakfast', value: updated });
                      }}
                      className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${(iso && autoConsumeBreakfast[iso]) || autoConsumeBreakfast[key]
                        ? 'bg-green-500/20 text-green-400 border border-green-400/50'
                        : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                        }`}
                      title={(iso && autoConsumeBreakfast[iso]) || autoConsumeBreakfast[key] ? 'Auto-consommation activée — sera déduit à 23h59 ou au prochain lancement' : 'Activer la décompte automatique du petit déj'}
                    >🔄</button>
                  )}
                  {!(matinMeals.length > 0 || (iso && breakfastSelections[iso]?.startsWith('pm:')) || breakfastSelections[key]?.startsWith('pm:')) && (
                    <button
                      onClick={() => {
                        const snapKey = `breakfast-${iso}`;
                        const cal = (iso && breakfastManualCalories[iso]) || breakfastManualCalories[key] || 0;
                        const prot = (iso && breakfastManualProteins[iso]) || breakfastManualProteins[key] || 0;
                        const breakfast = getBreakfastForDay(key, iso);
                        const mealId = (iso && breakfastSelections[iso]) || breakfastSelections[key] || undefined;
                        const updated = { ...savedSnapshots, [snapKey]: { cal, prot, name: breakfast?.name, mealId } };
                        setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                        // Unidirectional Sync to Next Week (Current -> Next)
                        if (weekOffset === 0) {
                          if (mealId) {
                            const nxtBf = { ...nextBreakfastSelections };
                            nxtBf[key] = mealId;
                            setPreference.mutate({ key: 'next_week_breakfast', value: nxtBf });
                          }
                          if (cal > 0) {
                            const nxtCal = { ...nextBreakfastManualCalories };
                            nxtCal[key] = cal;
                            setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: nxtCal });
                          }
                          if (prot > 0) {
                            const nxtPro = { ...nextBreakfastManualProteins };
                            nxtPro[key] = prot;
                            setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: nxtPro });
                          }
                        }

                        setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                        setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                      }}
                      onDoubleClick={() => {
                        const snapKey = `breakfast-${iso}`;
                        const updated = { ...savedSnapshots };
                        delete updated[snapKey];
                        const oldSnapKey = `breakfast-${key}`;
                        delete updated[oldSnapKey];
                        setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                        // Cleanup Next Week Sync if forgotten
                        if (weekOffset === 0) {
                          const nxtBf = { ...nextBreakfastSelections }; delete nxtBf[key]; delete nxtBf[iso];
                          setPreference.mutate({ key: 'next_week_breakfast', value: nxtBf });
                          const nxtCal = { ...nextBreakfastManualCalories }; delete nxtCal[key]; delete nxtCal[iso];
                          setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: nxtCal });
                          const nxtPro = { ...nextBreakfastManualProteins }; delete nxtPro[key]; delete nxtPro[iso];
                          setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: nxtPro });
                        }
                      }}
                      className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${flashedKeys[`breakfast-${iso}`]
                        ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                        : savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`]
                          ? 'bg-primary/20 text-primary border border-primary/40'
                          : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                        }`}
                      title={(() => {
                        const snap = (savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`]) as any;
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
                  {getDayProtein(key, iso) > 0 && (
                    <button
                      onClick={() => { setEditingProteinGoal(true); setProteinGoalInput(String(DAILY_PROTEIN_GOAL_PREF)); }}
                      className="flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-500/10 rounded-full px-2 py-0.5 whitespace-nowrap hover:bg-blue-500/20 transition-colors cursor-pointer"
                      title="Cliquer pour modifier l'objectif protéines"
                    >
                      🍗 {Math.round(getDayProtein(key, iso))} <span className="text-blue-400/50 font-normal">/ {DAILY_PROTEIN_GOAL_PREF}</span>
                    </button>
                  )}
                  {!editingProteinGoal && getDayProtein(key, iso) > 0 && (
                    <span className={`text-[10px] font-bold whitespace-nowrap ${DAILY_PROTEIN_GOAL_PREF - getDayProtein(key, iso) > 0 ? 'text-blue-400/60' : 'text-blue-500'}`}>
                      {DAILY_PROTEIN_GOAL_PREF - getDayProtein(key, iso) > 0 ? `reste ${Math.round(DAILY_PROTEIN_GOAL_PREF - getDayProtein(key, iso))}` : `+${Math.round(getDayProtein(key, iso) - DAILY_PROTEIN_GOAL_PREF)}`}
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
                  const slotKey = `${iso}-${time}`;
                  const slotMeals = getMealsForSlot(key, time, iso);
                  const isOver = dragOverSlot === slotKey || touchHighlight === slotKey || dragOverSlot === `${key}-${time}` || touchHighlight === `${key}-${time}`;
                  const slotCals = slotMeals.reduce((s, p) => s + getCardDisplayCalories(p, calOverrides[p.id], isAvailableCb), 0);
                  const slotPro = slotMeals.reduce((s, p) => s + getCardDisplayProtein(p, isAvailableCb), 0);
                  return (
                    <div
                      key={time}
                      data-slot
                      data-day={iso}
                      data-time={time}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverSlot(slotKey);
                      }}
                      onDragLeave={() => setDragOverSlot(null)}
                      onDrop={(e) => handleDrop(e, iso, time)}
                      className={`min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed p-1 sm:p-1.5 transition-colors ${isOver ? "border-primary/60 bg-primary/5" : "border-border/40 hover:border-primary/40"}`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1">
                          <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                            {TIME_LABELS[time]}
                          </span>
                          <button
                            onClick={() => {
                              const updated = { ...drinkChecks };
                              if (updated[`${iso}-${time}`]) delete updated[`${iso}-${time}`];
                              else if (updated[`${key}-${time}`]) delete updated[`${key}-${time}`];
                              else updated[`${iso}-${time}`] = true;
                              setPreference.mutate({ key: 'planning_drink_checks', value: updated });
                            }}
                            className={`flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px transition-colors ${drinkChecks[`${iso}-${time}`] || drinkChecks[`${key}-${time}`]
                              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold'
                              : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60'
                              }`}
                            title="+ Boisson sucrée (+150 cal)"
                          >
                            🥤 {drinkChecks[`${iso}-${time}`] || drinkChecks[`${key}-${time}`] ? '+150' : ''}
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
                              storageKey={`manual-${iso}-${time}`}
                              currentValue={manualCalories[`${iso}-${time}`] || manualCalories[`${key}-${time}`] || 0}
                              onSave={(val) => {
                                const updated = { ...manualCalories };
                                if (val > 0) updated[`${iso}-${time}`] = val;
                                else { delete updated[`${iso}-${time}`]; delete updated[`${key}-${time}`]; }
                                setPreference.mutate({ key: 'planning_manual_calories', value: updated });
                              }}
                              placeholder="kcal"
                              className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 text-center"
                            />
                            <PlanningInput
                              storageKey={`manual-prot-${iso}-${time}`}
                              currentValue={manualProteins[`${iso}-${time}`] || manualProteins[`${key}-${time}`] || 0}
                              onSave={(val) => {
                                const updated = { ...manualProteins };
                                if (val > 0) updated[`${iso}-${time}`] = val;
                                else { delete updated[`${iso}-${time}`]; delete updated[`${key}-${time}`]; }
                                setPreference.mutate({ key: 'planning_manual_proteins', value: updated });
                              }}
                              placeholder="prot"
                              className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center"
                            />
                            <div className="w-14 flex justify-center">
                              <button
                                onClick={() => {
                                  const snapKey = `manual-${iso}-${time}`;
                                  const cal = manualCalories[`${iso}-${time}`] || manualCalories[`${key}-${time}`] || 0;
                                  const prot = manualProteins[`${iso}-${time}`] || manualProteins[`${key}-${time}`] || 0;
                                  const updated = { ...savedSnapshots, [snapKey]: { cal, prot } };
                                  setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                                  // Unidirectional Sync to Next Week (Current -> Next)
                                  if (weekOffset === 0) {
                                    const kKeySlot = `${key}-${time}`;
                                    if (cal > 0) {
                                      const nxtCal = { ...nextManualCalories };
                                      nxtCal[kKeySlot] = cal;
                                      setPreference.mutate({ key: 'next_week_manual_calories', value: nxtCal });
                                    }
                                    if (prot > 0) {
                                      const nxtPro = { ...nextManualProteins };
                                      nxtPro[kKeySlot] = prot;
                                      setPreference.mutate({ key: 'next_week_manual_proteins', value: nxtPro });
                                    }
                                    if (drinkChecks[`${iso}-${time}`] || drinkChecks[`${key}-${time}`]) {
                                      const nxtDrk = { ...nextDrinkChecks };
                                      nxtDrk[kKeySlot] = true;
                                      setPreference.mutate({ key: 'next_week_drink_checks', value: nxtDrk });
                                    }
                                  }

                                  setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                                  setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                                }}
                                onDoubleClick={() => {
                                  const snapKey = `manual-${iso}-${time}`;
                                  const updated = { ...savedSnapshots };
                                  delete updated[snapKey];
                                  delete updated[`manual-${key}-${time}`];
                                  setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                                  // Cleanup Next Week Sync if forgotten
                                  if (weekOffset === 0) {
                                    const kKeySlot = `${key}-${time}`;
                                    const kIsoSlot = `${iso}-${time}`;
                                    const nxtCal = { ...nextManualCalories }; delete nxtCal[kKeySlot]; delete nxtCal[kIsoSlot];
                                    setPreference.mutate({ key: 'next_week_manual_calories', value: nxtCal });
                                    const nxtPro = { ...nextManualProteins }; delete nxtPro[kKeySlot]; delete nxtPro[kIsoSlot];
                                    setPreference.mutate({ key: 'next_week_manual_proteins', value: nxtPro });
                                    const nxtDrk = { ...nextDrinkChecks }; delete nxtDrk[kKeySlot]; delete nxtDrk[kIsoSlot];
                                    setPreference.mutate({ key: 'next_week_drink_checks', value: nxtDrk });
                                  }
                                }}
                                className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${flashedKeys[`manual-${iso}-${time}`]
                                  ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                                  : savedSnapshots[`manual-${iso}-${time}`] || savedSnapshots[`manual-${key}-${time}`]
                                    ? 'bg-primary/20 text-primary border border-primary/40'
                                    : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                                  }`}
                                title={(savedSnapshots[`manual-${iso}-${time}`] || savedSnapshots[`manual-${key}-${time}`]) ? `Sauvegardé: ${((savedSnapshots[`manual-${iso}-${time}`] || savedSnapshots[`manual-${key}-${time}`]) as any).cal || 0} kcal / ${((savedSnapshots[`manual-${iso}-${time}`] || savedSnapshots[`manual-${key}-${time}`]) as any).prot || 0} prot (Double-clic pour oublier)` : 'Sauvegarder les valeurs pour le reset (Double-clic pour oublier)'}
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
                      storageKey={`extra-${iso}`}
                      currentValue={(() => {
                        const manual = extraCalories[iso] || extraCalories[key] || 0;
                        const allExtraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                        const ids = allExtraSels[iso] || allExtraSels[key] || [];
                        const selected = ids.reduce((sum, id) => sum + parseCalories(foodItems.find(fi => fi.id === id)?.calories), 0);
                        return manual + selected;
                      })()}
                      onSave={(val) => {
                        const allExtraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                        const ids = allExtraSels[iso] || allExtraSels[key] || [];
                        const selected = ids.reduce((sum, id) => sum + parseCalories(foodItems.find(fi => fi.id === id)?.calories), 0);
                        const manual = Math.max(0, val - selected);
                        const updated = { ...extraCalories };
                        if (manual > 0) updated[iso] = manual;
                        else { delete updated[iso]; delete updated[key]; }
                        setPreference.mutate({ key: 'planning_extra_calories', value: updated });
                      }}
                      placeholder="kcal"
                      className="w-full h-5 text-[11px] bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-400 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40 text-center"
                    />
                    <PlanningInput
                      storageKey={`extra-prot-${iso}`}
                      currentValue={(() => {
                        const manual = extraProteins[iso] || extraProteins[key] || 0;
                        const allExtraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                        const ids = allExtraSels[iso] || allExtraSels[key] || [];
                        const selected = ids.reduce((sum, id) => sum + parseProtein(foodItems.find(fi => fi.id === id)?.protein), 0);
                        return manual + selected;
                      })()}
                      onSave={(val) => {
                        const allExtraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                        const ids = allExtraSels[iso] || allExtraSels[key] || [];
                        const selected = ids.reduce((sum, id) => sum + parseProtein(foodItems.find(fi => fi.id === id)?.protein), 0);
                        const manual = Math.max(0, val - selected);
                        const updated = { ...extraProteins };
                        if (manual > 0) updated[iso] = manual;
                        else { delete updated[iso]; delete updated[key]; }
                        setPreference.mutate({ key: 'planning_extra_proteins', value: updated });
                      }}
                      placeholder="prot"
                      className="w-full h-5 text-[11px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center"
                    />
                    <div className="flex items-center gap-1 mt-1">
                      <Popover open={openExtrasDay === (iso || key)} onOpenChange={(open) => setOpenExtrasDay(open ? (iso || key) : null)}>
                        <PopoverTrigger asChild>
                          <button
                            className={`h-5 w-5 flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95 ${((getPreference<Record<string, string[]>>('planning_extra_selections', {})[iso || ""]?.length || 0) > 0 || (getPreference<Record<string, string[]>>('planning_extra_selections', {})[key]?.length || 0) > 0) ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20'}`}
                            title="Ajouter un Extra"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-3 bg-card/95 backdrop-blur-md border-orange-200/20 shadow-2xl rounded-2xl" align="center">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Extras disponibles</p>
                            <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
                          </div>
                          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                            {(() => {
                              const sectionItems = foodItems.filter(fi => fi.storage_type === 'extras');
                              const sortedExtras = getSortedFoodItems(
                                sectionItems,
                                foodSortModes['extras'] || "manual",
                                sortDirections['food-extras'] !== false
                              );
                              if (sortedExtras.length === 0) {
                                return (
                                  <div className="text-center py-4 bg-muted/20 rounded-xl">
                                    <p className="text-[10px] text-muted-foreground italic">Aucun aliment "Extra" 🍕</p>
                                    <p className="text-[9px] text-muted-foreground/60 mt-1">Ajoutez-les dans l'onglet Aliments</p>
                                  </div>
                                );
                              }

                              const extraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                              const currentIds = extraSels[iso] || extraSels[key] || [];

                              // Sort selected items to the top
                              const selected = sortedExtras.filter(fi => currentIds.includes(fi.id));
                              const others = sortedExtras.filter(fi => !currentIds.includes(fi.id));

                              return [...selected, ...others].map((fi) => {
                                const count = currentIds.filter(id => id === fi.id).length;
                                return (
                                  <div key={fi.id} className={`w-full p-2 rounded-xl border transition-all group flex items-center gap-3 ${count > 0 ? 'bg-orange-500/20 border-orange-500/40 shadow-inner' : 'bg-muted/30 hover:bg-orange-500/10 border-transparent hover:border-orange-500/20'}`}>
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
                                            onClick={() => {
                                              const updated = { ...extraSels };
                                              const current = updated[iso] || updated[key] || [];
                                              const idx = current.lastIndexOf(fi.id);
                                              if (idx >= 0) {
                                                const next = [...current.slice(0, idx), ...current.slice(idx + 1)];
                                                if (iso) updated[iso] = next; else updated[key] = next;
                                                setPreference.mutate({ key: 'planning_extra_selections', value: updated });
                                              }
                                            }}
                                            className="h-5 w-5 flex items-center justify-center rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-500 text-xs font-bold"
                                            title="Retirer un"
                                          >−</button>
                                          <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{count}</span>
                                        </>
                                      )}
                                      <button
                                        onClick={() => {
                                          const updated = { ...extraSels };
                                          const current = updated[iso] || updated[key] || [];
                                          const next = [...current, fi.id];
                                          if (iso) updated[iso] = next; else updated[key] = next;
                                          setPreference.mutate({ key: 'planning_extra_selections', value: updated });
                                        }}
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
                              });
                            })()}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <button
                        onClick={() => {
                          const snapKey = `extra-${iso}`;
                          const allExtraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                          const currentIds = allExtraSels[iso] || allExtraSels[key] || [];
                          const cal = (iso && extraCalories[iso]) || extraCalories[key] || 0;
                          const prot = (iso && extraProteins[iso]) || extraProteins[key] || 0;
                          const itemIds = currentIds;
                          const updated = { ...savedSnapshots, [snapKey]: { cal, prot, itemIds } };
                          setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                          // Unidirectional Sync to Next Week (Current -> Next)
                          if (weekOffset === 0) {
                            if (itemIds.length > 0) {
                              const nxtSel = { ...nextExtraSelections };
                              nxtSel[key] = itemIds;
                              setPreference.mutate({ key: 'next_week_extra_selections', value: nxtSel });
                            }
                            if (cal > 0) {
                              const nxtCal = { ...nextExtraCalories };
                              nxtCal[key] = cal;
                              setPreference.mutate({ key: 'next_week_extra_calories', value: nxtCal });
                            }
                            if (prot > 0) {
                              const nxtPro = { ...nextExtraProteins };
                              nxtPro[key] = prot;
                              setPreference.mutate({ key: 'next_week_extra_proteins', value: nxtPro });
                            }
                          }

                          setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                          setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                        }}
                        onDoubleClick={() => {
                          const snapKey = `extra-${iso}`;
                          const updated = { ...savedSnapshots };
                          delete updated[snapKey];
                          delete updated[`extra-${key}`];
                          setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                          // Cleanup Next Week Sync if forgotten
                          if (weekOffset === 0) {
                            const nxtSel = { ...nextExtraSelections }; delete nxtSel[key]; delete nxtSel[iso];
                            setPreference.mutate({ key: 'next_week_extra_selections', value: nxtSel });
                            const nxtCal = { ...nextExtraCalories }; delete nxtCal[key]; delete nxtCal[iso];
                            setPreference.mutate({ key: 'next_week_extra_calories', value: nxtCal });
                            const nxtPro = { ...nextExtraProteins }; delete nxtPro[key]; delete nxtPro[iso];
                            setPreference.mutate({ key: 'next_week_extra_proteins', value: nxtPro });
                          }
                        }}
                        className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${flashedKeys[`extra-${iso}`]
                          ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                          : savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]
                            ? 'bg-primary/20 text-primary border border-primary/40'
                            : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                          }`}
                        title={(savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) ? `Sauvegardé: ${((savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any).cal || 0} kcal / ${((savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any).prot || 0} prot, ${((savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any).itemIds?.length || 0} items (Double-clic pour oublier)` : 'Sauvegarder les valeurs pour le reset (Double-clic pour oublier)'}
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
          const todayIndexNum = weekDates.findIndex(d => d.iso === todayISO);
          const datesUpToToday = todayIndexNum >= 0 ? weekDates.slice(0, todayIndexNum + 1) : [];
          const totalUpToToday = datesUpToToday.reduce((sum, d) => sum + getDayCalories(d.key, d.iso), 0);
          const avgCal = datesUpToToday.length > 0 ? Math.round(totalUpToToday / datesUpToToday.length) : 0;
          return (
            <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between flex-wrap gap-1">
              <span className="text-sm font-bold text-foreground">Total semaine</span>
              <div className="flex items-center gap-3 flex-wrap ml-auto">
                <span className="text-xs text-muted-foreground font-medium">
                  Moy. {avgCal} kcal/j <span className="text-muted-foreground/40">({datesUpToToday.length}j)</span>
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
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm sm:text-base font-bold text-foreground">Hors planning</h3>
          </div>
          {unplanned.length === 0 ? (
            <p className={`text-xs italic ${dragOverUnplanned ? "text-foreground/60" : "text-muted-foreground/50"}`}>
              {dragOverUnplanned ? "Relâche pour retirer du planning ↓" : "Tous les repas sont planifiés ✨"}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">{unplanned.map((pm) => renderMiniCard(pm, true))}</div>
          )}
        </div>
      </>) : weekOffset <= -1 ? (
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
          const bBP = isNF ? (backupRaw.breakfastManualProteins || {}) : {};
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

          const dailyTotals: number[] = [];
          const dailyProteins: number[] = [];

          return (
            <div className="space-y-3">
              <div className="rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">📋 Lecture seule — Dernière sauvegarde avant reset</p>
              </div>
              {weekDates.map(({ key, iso, display }) => {
                const dayCards = cards.filter((c: any) => c.day_of_week === iso || c.day_of_week === key);
                const midiCards = dayCards.filter((c: any) => c.meal_time === 'midi');
                const soirCards = dayCards.filter((c: any) => c.meal_time === 'soir');
                const matinCards = dayCards.filter((c: any) => c.meal_time === 'matin');

                // Current totals will be calculated below from slot values

                let bfSlotCal = 0, bfSlotPro = 0;
                let midiSlotCal = 0, midiSlotPro = 0;
                let soirSlotCal = 0, soirSlotPro = 0;

                // Breakfast calculation
                const bfSel = bBS[iso] || bBS[key];
                if (bfSel?.startsWith('meal:')) {
                  const m = allMealsById.get(bfSel.slice(5));
                  if (m) { bfSlotCal += parseCalories(m.calories); bfSlotPro += parseProtein(m.protein); }
                } else if (bfSel?.startsWith('pm:')) {
                  const pm = cards.find(c => c.id === bfSel.slice(3));
                  if (pm) {
                    const m = allMealsById.get(pm.meal_id);
                    const fullPm = m ? { ...pm, meals: m } : pm;
                    bfSlotCal += getCardDisplayCalories(fullPm, undefined, isAvailableCb);
                    bfSlotPro += getCardDisplayProtein(fullPm, isAvailableCb);
                  }
                } else {
                  bfSlotCal += (bBC[iso] || bBC[key] || 0);
                  const bfManualPro = isNF ? (backupRaw.breakfastManualProteins?.[iso] || backupRaw.breakfastManualProteins?.[key] || 0) : 0;
                  bfSlotPro += bfManualPro;
                }

                // Cards & Slot calculations
                const processCards = (slotCards: any[]) => {
                  let cals = 0, pros = 0;
                  for (const c of slotCards) {
                    const m = allMealsById.get(c.meal_id);
                    if (!m) continue;
                    const override = bCO[c.id];
                    const fullPm = { ...c, meals: m };
                    cals += getCardDisplayCalories(fullPm, override, isAvailableCb);
                    pros += getCardDisplayProtein(fullPm, isAvailableCb);
                  }
                  return { cals, pros };
                };

                const resMatin = processCards(matinCards);
                bfSlotCal += resMatin.cals; bfSlotPro += resMatin.pros;

                const resMidi = processCards(midiCards);
                midiSlotCal = resMidi.cals; midiSlotPro = resMidi.pros;
                if (midiCards.length === 0) { midiSlotCal += (bMC[`${iso}-midi`] || bMC[`${key}-midi`] || 0); midiSlotPro += (bMP[`${iso}-midi`] || bMP[`${key}-midi`] || 0); }
                if (bDC[`${iso}-midi`] || bDC[`${key}-midi`]) midiSlotCal += 150;

                const resSoir = processCards(soirCards);
                soirSlotCal = resSoir.cals; soirSlotPro = resSoir.pros;
                if (soirCards.length === 0) { soirSlotCal += (bMC[`${iso}-soir`] || bMC[`${key}-soir`] || 0); soirSlotPro += (bMP[`${iso}-soir`] || bMP[`${key}-soir`] || 0); }
                if (bDC[`${iso}-soir`] || bDC[`${key}-soir`]) soirSlotCal += 150;

                let dayTotal = bfSlotCal + midiSlotCal + soirSlotCal;
                let dayPro = bfSlotPro + midiSlotPro + soirSlotPro;

                // Extras
                dayTotal += (bEC[iso] || bEC[key] || 0);
                dayPro += (bEP[iso] || bEP[key] || 0);
                for (const id of (bES[iso] || bES[key] || [])) {
                  const fi = foodItems.find((f: any) => f.id === id);
                  if (fi) { dayTotal += parseCalories(fi.calories); dayPro += parseProtein(fi.protein); }
                }

                // Drinks
                // Drinks calculation already included in slot totals

                dailyTotals.push(dayTotal);
                dailyProteins.push(dayPro);

                return (
                  <div key={iso} className="rounded-2xl bg-card/80 backdrop-blur-sm p-2 sm:p-4">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="text-sm sm:text-base font-bold text-foreground">{display}</h3>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] bg-muted/60 text-muted-foreground px-2 py-0.5 rounded-full font-semibold">
                          {(() => {
                            const count = matinCards.length + (bfSel ? 1 : 0);
                            if (count > 1) return 'Plusieurs petits déj';
                            if (count === 1) {
                              if (matinCards.length === 1) return allMealsById.get(matinCards[0].meal_id)?.name || '🥐 Petit déj';
                              if (bfSel?.startsWith('meal:')) return allMealsById.get(bfSel.slice(5))?.name || '🥐 Petit déj';
                              if (bfSel?.startsWith('pm:')) return allMealsById.get(cards.find(c => c.id === bfSel.slice(3))?.meal_id)?.name || '🥐 Petit déj';
                            }
                            return '🥐 Petit déj';
                          })()}
                        </span>
                        {(bfSlotCal > 0 || bfSlotPro > 0) && (
                          <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm leading-none h-5">
                            {bfSlotCal > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Flame className="w-2 h-2 text-orange-500/60" />
                                {Math.round(bfSlotCal)}
                              </span>
                            )}
                            {bfSlotCal > 0 && bfSlotPro > 0 && <span className="opacity-30">•</span>}
                            {bfSlotPro > 0 && (
                              <span className="flex items-center gap-0.5">
                                <span className="text-[9px] opacity-60">🍗</span>
                                {Math.round(bfSlotPro)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex-1" />
                      <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap justify-end">
                        <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 whitespace-nowrap">
                          <Flame className="h-2.5 w-2.5 text-orange-500" />
                          {Math.round(dayTotal)} <span className="text-muted-foreground/50 font-normal">/ {backupTotals.archivedDailyGoal}</span>
                        </span>
                        {dayTotal > 0 && (
                          <span className={`text-[10px] font-bold whitespace-nowrap ${backupTotals.archivedDailyGoal - dayTotal > 0 ? 'text-muted-foreground/60' : 'text-orange-500'}`}>
                            {backupTotals.archivedDailyGoal - dayTotal > 0 ? `reste ${Math.round(backupTotals.archivedDailyGoal - dayTotal)}` : `+${Math.round(dayTotal - backupTotals.archivedDailyGoal)}`}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-[1fr_1fr_auto] gap-1 sm:gap-3">
                      {TIMES.filter(t => t !== 'matin').map(time => {
                        const slotCards = dayCards.filter((c: any) => c.meal_time === time);
                        const kIso = `${iso}-${time}`;
                        const kKey = `${key}-${time}`;
                        return (
                          <div key={time} className="min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed border-border/40 p-1 sm:p-1.5">
                            <div className="flex items-center justify-between mb-0.5">
                              <div className="flex items-center gap-1">
                                <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                                {(bDC[kIso] || bDC[kKey]) && (
                                  <span className="flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold">🥤 +150</span>
                                )}
                              </div>
                              {(() => {
                                const sCal = time === 'midi' ? midiSlotCal : soirSlotCal;
                                const sPro = time === 'midi' ? midiSlotPro : soirSlotPro;
                                if (sCal <= 0 && sPro <= 0) return null;
                                return (
                                  <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] font-bold text-muted-foreground bg-muted/30 dark:bg-muted/20 px-2 py-0.5 rounded-full border border-border/40 shadow-sm leading-none h-4 sm:h-5">
                                    {sCal > 0 && (
                                      <span className="flex items-center gap-0.5">
                                        <Flame className="w-2 h-2 text-orange-500/60" />
                                        {Math.round(sCal)}
                                      </span>
                                    )}
                                    {sCal > 0 && sPro > 0 && <span className="opacity-30">•</span>}
                                    {sPro > 0 && (
                                      <span className="flex items-center gap-0.5">
                                        <span className="text-[9px] opacity-60">🍗</span>
                                        {Math.round(sPro)}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                            <div className="mt-0.5 space-y-1">
                              {slotCards.length === 0 ? (
                                <div className="flex flex-col items-start gap-0.5 opacity-60">
                                  <div className="text-[10px] text-muted-foreground px-1">{bMC[kIso] || bMC[kKey] || 0} kcal</div>
                                  <div className="text-[10px] text-blue-400 px-1">{bMP[kIso] || bMP[kKey] || 0} prot</div>
                                </div>
                              ) : (
                                slotCards.map((c: any, i: number) => {
                                  const m = allMealsById.get(c.meal_id);
                                  if (!m) return <div key={i} className="rounded-xl px-2 py-1 bg-muted text-[10px] text-muted-foreground">Repas supprimé</div>;
                                  return (
                                    <div key={i} className="rounded-xl px-2 py-1 text-white text-[9px] sm:text-[10px] font-semibold flex items-center justify-between transition-all" style={{ backgroundColor: getMealColor(c.ingredients_override ?? m.ingredients, m.name) }}>
                                      <span className="truncate">{getCategoryEmoji(m.category)} {m.name}</span>
                                      {bCO[c.id] && <span className="ml-1 opacity-80 shrink-0">🔥{bCO[c.id]}</span>}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {/* Extra column */}
                      <div className="min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed border-orange-300/30 p-1 sm:p-1.5 w-12 sm:w-20 flex flex-col items-center">
                        <span className="text-[7px] sm:text-[8px] font-semibold text-orange-400/60 uppercase tracking-wide">Extra</span>
                        <div className="flex flex-col items-center gap-1 mt-1 w-full opacity-60">
                          <div className="text-[10px] text-orange-400 font-bold">{Math.round((bEC[iso] || bEC[key] || 0) + (bES[iso] || bES[key] || []).reduce((s: number, id: string) => s + parseCalories(foodItems.find(fi => fi.id === id)?.calories), 0))}</div>
                          <div className="text-[10px] text-blue-400 font-bold">{Math.round((bEP[iso] || bEP[key] || 0) + (bES[iso] || bES[key] || []).reduce((s: number, id: string) => s + parseProtein(foodItems.find(fi => fi.id === id)?.protein), 0))}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Total calorique de la semaine (Backup) */}
              {(() => {
                const weekTotalCals = dailyTotals.reduce((a, b) => a + b, 0);
                const processedDays = dailyTotals.length;
                const avgCal = processedDays > 0 ? Math.round(weekTotalCals / processedDays) : 0;

                return (
                  <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between flex-wrap gap-1">
                    <span className="text-sm font-bold text-foreground">Total semaine</span>
                    <div className="flex items-center gap-3 flex-wrap ml-auto">
                      <span className="text-xs text-muted-foreground font-medium">
                        Moy. {avgCal} kcal/j <span className="text-muted-foreground/40">({processedDays}j)</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-sm font-black text-orange-500">
                        <Flame className="h-4 w-4" />
                        {Math.round(weekTotalCals)} <span className="text-muted-foreground/50 font-normal text-xs">/ {backupTotals.archivedDailyGoal * 7}</span>
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })()
      ) : (
        /* ─── Next Week Planning ─── */
        <div className="space-y-3">
          <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 p-2 text-center">
            <p className="text-[10px] text-muted-foreground">📅 Aperçu semaine prochaine — inclut les éléments conservés après reset</p>
          </div>
          {weekDates.map(({ key, iso, display }) => {
            // Post-reset base: saved snapshots only (what survives reset)
            const bfSnap = (savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`]) as any;
            const baseBfMealId = bfSnap?.mealId || undefined;
            const baseBfManualCal = bfSnap?.cal || 0;
            const baseBfManualPro = bfSnap?.prot || 0;
            const extraSnap = (savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any;
            const baseExtraCal = extraSnap?.cal || 0;
            const baseExtraPro = extraSnap?.prot || 0;
            const baseExtraSel: string[] = extraSnap?.itemIds || [];

            // Next week overrides > post-reset base
            const effBfSel = nextBreakfastSelections[iso] ?? nextBreakfastSelections[key] ?? baseBfMealId;
            const effBfMeal = effBfSel?.startsWith('meal:') ? allMealsById.get(effBfSel.slice(5)) : null;
            const effBfManualCal = nextBreakfastManualCalories[iso] ?? nextBreakfastManualCalories[key] ?? baseBfManualCal;
            const effBfManualPro = nextBreakfastManualProteins[iso] ?? nextBreakfastManualProteins[key] ?? baseBfManualPro;
            const effExtraCal = nextExtraCalories[iso] ?? nextExtraCalories[key] ?? baseExtraCal;
            const effExtraPro = nextExtraProteins[iso] ?? nextExtraProteins[key] ?? baseExtraPro;
            const effExtraSel = nextExtraSelections[iso] ?? nextExtraSelections[key] ?? baseExtraSel;

            // Computed macros for breakfast (handles card transfers & ingredient analysis)
            const nxtBfCal = effBfMeal ? (effBfManualCal || getMealCal(effBfMeal)) : effBfManualCal;
            const nxtBfPro = effBfMeal ? (effBfManualPro || getMealPro(effBfMeal)) : effBfManualPro;

            let dayTotal = nxtBfCal;
            for (const time of TIMES) {
              const kIso = `${iso}-${time}`;
              const kKey = `${key}-${time}`;
              const manualSnap = (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`]) as any;
              const baseManualCal = manualSnap?.cal || 0;
              dayTotal += nextManualCalories[kIso] ?? nextManualCalories[kKey] ?? baseManualCal;
              if (nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) dayTotal += 150;
              // Include scheduled cards
              const slotMeals = getMealsForSlot(key, time, iso);
              dayTotal += slotMeals.reduce((s, pm) => s + getCardDisplayCalories(pm, calOverrides[pm.id], isAvailableCb), 0);
            }
            dayTotal += effExtraCal;
            for (const id of effExtraSel) {
              const fi = foodItems.find(f => f.id === id);
              if (fi) dayTotal += parseCalories(fi.calories);
            }

            let nxtDayPro = nxtBfPro;
            for (const time of TIMES) {
              const kIso = `${iso}-${time}`;
              const kKey = `${key}-${time}`;
              const manualSnap = (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`]) as any;
              const baseManualPro = manualSnap?.prot || 0;
              nxtDayPro += nextManualProteins[kIso] ?? nextManualProteins[kKey] ?? baseManualPro;
              // Include scheduled cards
              const slotMeals = getMealsForSlot(key, time, iso);
              nxtDayPro += slotMeals.reduce((s, pm) => s + getCardDisplayProtein(pm, isAvailableCb), 0);
            }
            nxtDayPro += effExtraPro;
            for (const id of effExtraSel) {
              const fi = foodItems.find(f => f.id === id);
              if (fi) nxtDayPro += parseProtein(fi.protein);
            }

            return (
              <div key={iso} className="rounded-2xl bg-card/80 backdrop-blur-sm p-2 sm:p-4">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <h3 className="text-sm sm:text-base font-bold text-foreground">{display}</h3>
                  {/* Petit déj selector */}
                  <div className="flex items-center gap-1">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-[10px] bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full font-semibold hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors truncate max-w-[120px]">
                          {effBfMeal ? effBfMeal.name : '🥐 Petit déj'}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-52 p-2" align="start">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Petit déjeuner</p>
                        <div className="space-y-0.5 max-h-48 overflow-y-auto">
                          <button onClick={() => {
                            const updated = { ...nextBreakfastSelections }; delete updated[iso]; delete updated[key];
                            setPreference.mutate({ key: 'next_week_breakfast', value: updated });
                          }} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors">— Aucun</button>
                          {petitDejMeals.map(m => {
                            const mealSelId = `meal:${m.id}`;
                            const isSelected = nextBreakfastSelections[iso] === mealSelId || nextBreakfastSelections[key] === mealSelId;
                            return (
                              <button key={m.id} onClick={() => {
                                const updated = { ...nextBreakfastSelections };
                                if (isSelected) { delete updated[iso]; delete updated[key]; } else { updated[iso] = mealSelId; }
                                setPreference.mutate({ key: 'next_week_breakfast', value: updated });
                              }} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${isSelected ? 'bg-primary/10 font-bold' : ''} flex items-center justify-between`}>
                                <span className="truncate">{m.name}</span>
                                <span className="inline-flex items-center gap-1.5 ml-1 text-muted-foreground shrink-0 text-[10px]">
                                  <span className="flex items-center gap-0.5">
                                    <Flame className="w-2.5 h-2.5 text-orange-500" />
                                    {getMealCal(m)}
                                  </span>
                                  <span>•</span>
                                  <span className="flex items-center gap-0.5">
                                    <span className="grayscale brightness-125 saturate-50 leading-none">🍗</span>
                                    {getMealPro(m)}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {effBfMeal && (
                      <div className="flex items-center gap-1.5 bg-black/20 dark:bg-black/40 rounded-full px-1.5 py-0.5 border border-white/5 shadow-inner shrink-0 leading-none">
                        <span className="flex items-center gap-0.5 text-[9px] font-black text-white/90">
                          <Flame className="w-2 h-2 text-orange-400" />
                          {nxtBfCal}
                        </span>
                        <span className="text-white/20 text-[8px]">•</span>
                        <span className="flex items-center gap-0.5 text-[9px] font-black text-white/90">
                          <span className="text-[10px] grayscale brightness-125 saturate-50 leading-none">🍗</span>
                          {nxtBfPro}
                        </span>
                      </div>
                    )}
                    {!effBfMeal && (
                      <>
                        <PlanningInput storageKey={`next-bf-cal-${iso}`} currentValue={nextBreakfastManualCalories[iso] ?? nextBreakfastManualCalories[key] ?? baseBfManualCal}
                          onSave={(val) => { const u = { ...nextBreakfastManualCalories }; if (val > 0) u[iso] = val; else { delete u[iso]; delete u[key]; } setPreference.mutate({ key: 'next_week_breakfast_manual_calories', value: u }); }}
                          placeholder="kcal" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40" />
                        <PlanningInput storageKey={`next-bf-prot-${iso}`} currentValue={nextBreakfastManualProteins[iso] ?? nextBreakfastManualProteins[key] ?? baseBfManualPro}
                          onSave={(val) => { const u = { ...nextBreakfastManualProteins }; if (val > 0) u[iso] = val; else { delete u[iso]; delete u[key]; } setPreference.mutate({ key: 'next_week_breakfast_manual_proteins', value: u }); }}
                          placeholder="prot" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40" />
                      </>
                    )}
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap justify-end">
                    <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5 whitespace-nowrap">
                      <Flame className="h-2.5 w-2.5 text-orange-500" />
                      {Math.round(dayTotal)} <span className="text-muted-foreground/50 font-normal">/ {NEXT_DAILY_GOAL}</span>
                    </span>
                    {dayTotal > 0 && (
                      <span className={`text-[10px] font-bold whitespace-nowrap ${NEXT_DAILY_GOAL - dayTotal > 0 ? 'text-muted-foreground/60' : 'text-orange-500'}`}>
                        {NEXT_DAILY_GOAL - dayTotal > 0 ? `reste ${Math.round(NEXT_DAILY_GOAL - dayTotal)}` : `+${Math.round(dayTotal - NEXT_DAILY_GOAL)}`}
                      </span>
                    )}
                    {nxtDayPro > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-blue-400 bg-blue-500/10 rounded-full px-2 py-0.5 whitespace-nowrap">
                        🍗 {Math.round(nxtDayPro)} <span className="text-blue-400/50 font-normal">/ {NEXT_PROTEIN_GOAL}</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-1 sm:gap-3">
                  {TIMES.map(time => {
                    const kIso = `${iso}-${time}`;
                    const kKey = `${key}-${time}`;
                    const slotId = `${key}-${time}`;
                    const isOver = dragOverSlot === slotId;
                    return (
                      <div
                        key={time}
                        data-slot={slotId}
                        data-day={key}
                        data-time={time}
                        onDragOver={(e) => { e.preventDefault(); setDragOverSlot(slotId); }}
                        onDragLeave={() => setDragOverSlot(null)}
                        onDrop={(e) => { e.preventDefault(); handleDrop(e, key, time); }}
                        className={`min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed p-1 sm:p-1.5 transition-all ${isOver ? 'bg-primary/20 border-primary scale-[1.02] shadow-lg ring-2 ring-primary/40' : 'border-border/40'}`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1">
                            <span className="text-[8px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{TIME_LABELS[time]}</span>
                            <button onClick={() => {
                              const u = { ...nextDrinkChecks }; if (nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) { delete u[kIso]; delete u[kKey]; } else { u[kIso] = true; }
                              setPreference.mutate({ key: 'next_week_drink_checks', value: u });
                            }} className={`flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px transition-colors ${(nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold' : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60'}`}>
                              🥤 {(nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) ? '+150' : ''}
                            </button>
                          </div>
                        </div>
                        <div className="mt-0.5 space-y-1">
                          {getMealsForSlot(key, time, iso).map((pm) => renderMiniCard(pm, false))}
                          <div className="flex flex-col items-start gap-0.5">
                            <PlanningInput storageKey={`next-mc-${iso}-${time}`} currentValue={nextManualCalories[kIso] ?? nextManualCalories[kKey] ?? (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`] as any)?.cal ?? 0}
                              onSave={(val) => { const u = { ...nextManualCalories }; if (val > 0) u[kIso] = val; else { delete u[kIso]; delete u[kKey]; } setPreference.mutate({ key: 'next_week_manual_calories', value: u }); }}
                              placeholder="kcal" className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 text-center" />
                            <PlanningInput storageKey={`next-mp-${iso}-${time}`} currentValue={nextManualProteins[kIso] ?? nextManualProteins[kKey] ?? (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`] as any)?.prot ?? 0}
                              onSave={(val) => { const u = { ...nextManualProteins }; if (val > 0) u[kIso] = val; else { delete u[kIso]; delete u[kKey]; } setPreference.mutate({ key: 'next_week_manual_proteins', value: u }); }}
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
                      <PlanningInput storageKey={`next-ec-${iso}`}
                        currentValue={(() => { const m = nextExtraCalories[iso] ?? nextExtraCalories[key] ?? baseExtraCal; const ids = effExtraSel; return m + ids.reduce((s, id) => s + parseCalories(foodItems.find(fi => fi.id === id)?.calories), 0); })()}
                        onSave={(val) => { const ids = effExtraSel; const sel = ids.reduce((s, id) => s + parseCalories(foodItems.find(fi => fi.id === id)?.calories), 0); const m = Math.max(0, val - sel); const u = { ...nextExtraCalories }; if (m > 0) u[iso] = m; else { delete u[iso]; delete u[key]; } setPreference.mutate({ key: 'next_week_extra_calories', value: u }); }}
                        placeholder="kcal" className="w-full h-5 text-[11px] bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-400 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40 text-center" />
                      <PlanningInput storageKey={`next-ep-${iso}`}
                        currentValue={(() => { const m = nextExtraProteins[iso] ?? nextExtraProteins[key] ?? baseExtraPro; const ids = effExtraSel; return m + ids.reduce((s, id) => s + parseProtein(foodItems.find(fi => fi.id === id)?.protein), 0); })()}
                        onSave={(val) => { const ids = effExtraSel; const sel = ids.reduce((s, id) => s + parseProtein(foodItems.find(fi => fi.id === id)?.protein), 0); const m = Math.max(0, val - sel); const u = { ...nextExtraProteins }; if (m > 0) u[iso] = m; else { delete u[iso]; delete u[key]; } setPreference.mutate({ key: 'next_week_extra_proteins', value: u }); }}
                        placeholder="prot" className="w-full h-5 text-[11px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center" />
                      <div className="flex items-center gap-1 mt-1">
                        <Popover open={openExtrasDay === `next-${iso}`} onOpenChange={(open) => setOpenExtrasDay(open ? `next-${iso}` : null)}>
                          <PopoverTrigger asChild>
                            <button className={`h-5 w-5 flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95 ${effExtraSel.length > 0 ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20'}`} title="Ajouter un Extra">
                              <Plus className="h-3 w-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 p-3 bg-card/95 backdrop-blur-md border-orange-200/20 shadow-2xl rounded-2xl" align="center">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1.5"><Sparkles className="w-3 h-3" /> Extras disponibles</p>
                              <Zap className="w-3 h-3 text-amber-400 animate-pulse" />
                            </div>
                            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                              {(() => {
                                const availableExtras = foodItems.filter(fi => fi.storage_type === 'extras');
                                const sortedItems = getSortedFoodItems(
                                  availableExtras,
                                  foodSortModes['extras'] || "manual",
                                  sortDirections['food-extras'] !== false
                                );
                                // Sort selected items to the top
                                const selected = sortedItems.filter(fi => effExtraSel.includes(fi.id));
                                const others = sortedItems.filter(fi => !effExtraSel.includes(fi.id));
                                return [...selected, ...others].map(fi => {
                                  const count = effExtraSel.filter(id => id === fi.id).length;
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
                                          <button onClick={() => { const u = { ...nextExtraSelections }; const c = u[iso] || u[key] || []; const idx = c.lastIndexOf(fi.id); if (idx >= 0) u[iso] = [...c.slice(0, idx), ...c.slice(idx + 1)]; delete u[key]; setPreference.mutate({ key: 'next_week_extra_selections', value: u }); }} className="h-5 w-5 flex items-center justify-center rounded-full bg-red-500/20 hover:bg-red-500/40 text-red-500 text-xs font-bold">−</button>
                                          <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{count}</span>
                                        </>)}
                                        <button onClick={() => { const u = { ...nextExtraSelections }; u[iso] = [...(u[iso] || u[key] || []), fi.id]; delete u[key]; setPreference.mutate({ key: 'next_week_extra_selections', value: u }); }} className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/20 hover:bg-orange-500/40 text-orange-500 text-xs font-bold">+</button>
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
                                });
                              })()}
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
            for (const { key, iso } of weekDates) {
              const bfSnap = (savedSnapshots[`breakfast-${iso}`] || savedSnapshots[`breakfast-${key}`]) as any;
              const eBfSel = nextBreakfastSelections[iso] ?? nextBreakfastSelections[key] ?? bfSnap?.mealId;
              const eBfMeal = eBfSel?.startsWith('meal:') ? allMealsById.get(eBfSel.slice(5)) : null;
              if (eBfMeal) { total += parseCalories(eBfMeal.calories); totalPro += parseProtein(eBfMeal.protein); }
              else { total += nextBreakfastManualCalories[iso] ?? nextBreakfastManualCalories[key] ?? bfSnap?.cal ?? 0; totalPro += nextBreakfastManualProteins[iso] ?? nextBreakfastManualProteins[key] ?? bfSnap?.prot ?? 0; }
              for (const time of TIMES) {
                const kIso = `${iso}-${time}`;
                const kKey = `${key}-${time}`;
                const manualSnap = (savedSnapshots[`manual-${kIso}`] || savedSnapshots[`manual-${kKey}`]) as any;
                total += nextManualCalories[kIso] ?? nextManualCalories[kKey] ?? manualSnap?.cal ?? 0;
                totalPro += nextManualProteins[kIso] ?? nextManualProteins[kKey] ?? manualSnap?.prot ?? 0;
                if (nextDrinkChecks[kIso] || nextDrinkChecks[kKey]) total += 150;
              }
              const extraSnap = (savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]) as any;
              total += nextExtraCalories[iso] ?? nextExtraCalories[key] ?? extraSnap?.cal ?? 0;
              totalPro += nextExtraProteins[iso] ?? nextExtraProteins[key] ?? extraSnap?.prot ?? 0;
              for (const id of (nextExtraSelections[iso] ?? nextExtraSelections[key] ?? extraSnap?.itemIds ?? [])) {
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
            const targetDate = getTargetDate(popupPm.day_of_week, new Date(), effectiveStart, popupPm.meal_time);
            const displayCal = String(getCardDisplayCalories(popupPm, undefined, isAvailableCb));
            const displayPro = String(getCardDisplayProtein(popupPm, isAvailableCb));
            const counterDays = getAdaptedCounterDays(effectiveStart, popupPm.day_of_week, popupPm.created_at, popupPm.meal_time);
            const counterHours = computeCounterHours(effectiveStart, targetDate);
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
                  {counterDays !== null && (
                    <span
                      className={`text-sm font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${counterDays >= 3 ? 'bg-red-600' : 'bg-black/40'}`}
                      title={counterHours !== null ? `${counterHours}h écoulées` : undefined}
                    >
                      <Timer className="h-3.5 w-3.5" /> {counterDays}j
                    </span>
                  )}
                  {counterDays === null && popupPm.counter_start_date && new Date(popupPm.counter_start_date).getTime() > new Date().getTime() && (
                    <span
                      className="text-sm font-bold bg-blue-500/40 px-2.5 py-1 rounded-full flex items-center gap-1 border border-blue-300/30"
                    >
                      <Timer className="h-3.5 w-3.5" /> 📅 Prog.
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
                    {getDisplayDay(popupPm.day_of_week)} — {TIME_LABELS[popupPm.meal_time]}
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
                <p className="text-[10px] text-white/60 mb-2 uppercase font-black tracking-widest">
                  {getDisplayDay(popupBreakfast.day)}
                </p>
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
