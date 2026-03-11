import { useState, useRef, useEffect } from "react";
import { useMeals, DAYS, TIMES, type PossibleMeal } from "@/hooks/useMeals";
import { usePreferences } from "@/hooks/usePreferences";
import { Timer, Flame, Weight, Calendar, Lock } from "lucide-react";
import { computeIngredientCalories } from "@/lib/ingredientUtils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { Checkbox } from "@/components/ui/checkbox";

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
function getDateForDayKey(dayKey: string): Date {
  const today = new Date();
  const todayDow = today.getDay(); // 0=Sun
  const todayIdx = todayDow === 0 ? 6 : todayDow - 1; // 0=Mon
  const targetIdx = DAY_KEY_TO_INDEX[dayKey] ?? 0;
  const diff = targetIdx - todayIdx;
  const d = new Date(today);
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

function getCounterDays(startDate: string | null): number | null {
  if (!startDate) return null;
  return Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000);
}

/** Counter days adapted: adds offset based on the difference between target day and today */
function getAdaptedCounterDays(startDate: string | null, dayKey: string | null): number | null {
  if (!startDate) return null;
  const baseDays = Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000);
  if (!dayKey) return baseDays;
  const targetDate = getDateForDayKey(dayKey);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOffset = Math.round((targetDate.getTime() - today.getTime()) / 86400000);
  return baseDays + dayOffset;
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
  return isNaN(n) ? 0 : n;
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
function PlanningMiniCard({ pm, meal, expired, counterDays, counterUrgent, displayCal, isComputedCal, compact, isTouchDevice, touchDragActive, slotDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onRemove, onCalorieChange }: {
  pm: PossibleMeal; meal: any; expired: boolean; counterDays: number | null; counterUrgent: boolean; displayCal: string | null; isComputedCal: boolean; compact: boolean;
  isTouchDevice: boolean; touchDragActive: boolean; slotDragOver: string | null;
  onDragStart: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void; onTouchMove: (e: React.TouchEvent) => void; onTouchEnd: (e: React.TouchEvent) => void; onTouchCancel: () => void;
  onRemove: () => void; onCalorieChange: (val: string | null) => void;
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
      className={`rounded-xl text-white select-none
        ${touchDragActive ? "cursor-grabbing" : "cursor-grab active:cursor-grabbing"}
        transition-transform hover:scale-[1.01]
        ${expired ? "ring-[3px] ring-red-500 shadow-lg shadow-red-500/30" : ""}
        ${slotDragOver === pm.id ? "ring-2 ring-white/60" : ""}
        ${compact ? "px-1.5 py-0.5" : "px-1.5 py-0.5 sm:px-2 sm:py-1.5"}
      `}
      style={{ backgroundColor: meal.color }}
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
                  className={`text-xs font-black text-white px-2 py-0.5 rounded-full flex items-center gap-0.5 ${
                    isComputedCal ? "bg-orange-500/60 hover:bg-orange-500/70" : "bg-black/30 hover:bg-black/40"
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
              {meal.protein && (
                <span className="text-[10px] font-bold text-white bg-black/30 px-1.5 py-0.5 rounded-full mt-0.5 flex items-center justify-center">
                  🍗 {meal.protein}
                </span>
              )}
              {counterDays !== null && (
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
        {!compact && (pm.expiration_date || meal.grams || meal.ingredients) && (
          <div className="mt-auto pt-0.5">
            {meal.grams && (
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-white/60 flex items-center gap-0.5">
                  <Weight className="h-2 w-2" />
                  {meal.grams}
                </span>
              </div>
            )}
            {(meal.ingredients || pm.expiration_date) && (
              <div className={`${meal.grams ? "mt-0.5" : ""} text-[9px] text-white/50 break-words whitespace-normal`}>
                {pm.expiration_date && (
                  <span className={`inline-flex items-center gap-0.5 mr-1 rounded px-1 py-0.5 border align-middle ${expired ? "text-red-200 font-bold border-red-300/40 bg-red-400/10" : "text-white/60 border-white/15 bg-white/5"}`}>
                    <Calendar className="h-2 w-2 inline" />
                    {format(parseISO(pm.expiration_date), "d MMM", { locale: fr })}
                  </span>
                )}
                {meal.ingredients && meal.ingredients
                  .split(/[,\n]+/)
                  .filter(Boolean)
                  .map((s: string) => s.trim().replace(/\{\d+(?:[.,]\d+)?\}\s*$/g, "").trim())
                  .join(" • ")}
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
          {!compact && (pm.expiration_date || meal.grams || meal.ingredients) && (
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
              {meal.ingredients && (
                <div className={`${pm.expiration_date || meal.grams ? "mt-0.5" : ""} text-[9px] text-white/50 flex flex-wrap gap-x-1`}>
                  {meal.ingredients
                    .split(/[,\n]+/)
                    .filter(Boolean)
                    .map((s: string) => s.trim())
                    .map((s: string) => s.replace(/\{\d+(?:[.,]\d+)?\}\s*/g, "").trim())
                    .map((item, i, arr) => (
                      <span key={i} className="whitespace-nowrap">
                        {item}{i < arr.length - 1 ? " •" : ""}
                      </span>
                    ))}
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
                className={`text-xs font-black text-white px-2 py-0.5 rounded-full flex items-center gap-0.5 ${
                  isComputedCal ? "bg-orange-500/60 hover:bg-orange-500/70" : "bg-black/30 hover:bg-black/40"
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
            {meal.protein && (
              <span className="text-[10px] font-bold text-white bg-black/30 px-1.5 py-0.5 rounded-full mt-0.5 flex items-center justify-center">
                🍗 {meal.protein}
              </span>
            )}
            {counterDays !== null && (
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
  const { possibleMeals, updatePlanning, reorderPossibleMeals, getMealsByCategory } = useMeals();
  const { getPreference, setPreference } = usePreferences();

  // Breakfast selections per day
  const breakfastSelections = getPreference<Record<string, string>>('planning_breakfast', {});
  const petitDejMeals = getMealsByCategory('petit_dejeuner');
  const manualCalories = getPreference<Record<string, number>>('planning_manual_calories', {});
  const extraCalories = getPreference<Record<string, number>>('planning_extra_calories', {});
  const calOverrides = getPreference<Record<string, string>>('planning_cal_overrides', {});
  const keepOnReset = getPreference<Record<string, boolean>>('planning_keep_on_reset', {});
  const DAILY_GOAL = getPreference<number>('planning_daily_goal', DEFAULT_DAILY_GOAL);
  const WEEKLY_GOAL = DAILY_GOAL * DEFAULT_WEEKLY_MULTIPLIER;
  const DAILY_PROTEIN_GOAL_PREF = getPreference<number>('planning_protein_goal', DAILY_PROTEIN_GOAL);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [editingProteinGoal, setEditingProteinGoal] = useState(false);
  const [proteinGoalInput, setProteinGoalInput] = useState("");

  const getBreakfastForDay = (day: string) => {
    const mealId = breakfastSelections[day];
    if (!mealId) return null;
    return petitDejMeals.find(m => m.id === mealId) || null;
  };

  const setBreakfastForDay = (day: string, mealId: string | null) => {
    const updated = { ...breakfastSelections };
    if (mealId) updated[day] = mealId;
    else delete updated[day];
    setPreference.mutate({ key: 'planning_breakfast', value: updated });
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

  const breakfastManualCalories = getPreference<Record<string, number>>('planning_breakfast_manual_calories', {});
  const drinkChecks = getPreference<Record<string, boolean>>('planning_drink_checks', {});
  const DRINK_CALORIES = 150;

  const getDayCalories = (day: string): number => {
    const mealCals = TIMES.reduce(
      (total, time) => {
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
      },
      0,
    );
    const breakfast = getBreakfastForDay(day);
    const extra = extraCalories[day] || 0;
    const breakfastCal = breakfast ? parseCalories(breakfast.calories) : (breakfastManualCalories[day] || 0);
    const drinkCal = TIMES.reduce((sum, time) => sum + (drinkChecks[`${day}-${time}`] ? DRINK_CALORIES : 0), 0);
    return mealCals + breakfastCal + extra + drinkCal;
  };

  const getDayProtein = (day: string): number => {
    const mealProt = TIMES.reduce((total, time) => {
      const slotMeals = getMealsForSlot(day, time);
      return total + slotMeals.reduce((s, pm) => s + parseProtein(pm.meals?.protein), 0);
    }, 0);
    const breakfast = getBreakfastForDay(day);
    const breakfastProt = breakfast ? parseProtein(breakfast.protein) : 0;
    return mealProt + breakfastProt;
  };

  const handleDrop = async (e: React.DragEvent, day: string, time: string) => {
    e.preventDefault();
    setDragOverSlot(null);
    const pmId = e.dataTransfer.getData("pmId");
    if (pmId) updatePlanning.mutate({ id: pmId, day_of_week: day, meal_time: time });
  };

  const handleDropOnCard = (e: React.DragEvent, targetPm: PossibleMeal) => {
    e.preventDefault();
    e.stopPropagation();
    setSlotDragOver(null);
    const draggedPmId = e.dataTransfer.getData("pmId");
    if (!draggedPmId || draggedPmId === targetPm.id) return;
    const slot = getMealsForSlot(targetPm.day_of_week!, targetPm.meal_time!);
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
    if (pmId) updatePlanning.mutate({ id: pmId, day_of_week: null, meal_time: null });
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
      updatePlanning.mutate({ id: state.pmId, day_of_week: day, meal_time: time });
    } else if (el?.closest("[data-unplanned]")) {
      updatePlanning.mutate({ id: state.pmId, day_of_week: null, meal_time: null });
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
    updatePlanning.mutate({ id: pm.id, day_of_week: null, meal_time: null });
  };

  const renderMiniCard = (pm: PossibleMeal, compact = false) => {
    const meal = pm.meals;
    if (!meal) return null;
    const expired = isExpiredOnDay(pm.expiration_date, pm.day_of_week);
    const counterDays = getAdaptedCounterDays(pm.counter_start_date, pm.day_of_week);
    const counterUrgent = counterDays !== null && counterDays >= 3;
    const overrideCal = calOverrides[pm.id];
    const ingCal = computeIngredientCalories(meal.ingredients);
    const isComputedCal = !overrideCal && ingCal !== null;
    const displayCal = overrideCal || (ingCal !== null ? String(ingCal) : meal.calories);

    return (
      <PlanningMiniCard
        key={pm.id}
        pm={pm}
        meal={meal}
        expired={expired}
        counterDays={counterDays}
        counterUrgent={counterUrgent}
        displayCal={displayCal}
        isComputedCal={isComputedCal}
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
      />
    );
  };

  const weekTotal = DAYS.reduce((sum, day) => sum + getDayCalories(day), 0);

  return (
    <div className={`max-w-4xl mx-auto space-y-3 overflow-x-hidden ${touchDragActive ? "touch-none" : ""}`}>
      {DAYS.map((day) => {
        const isToday_ = day === todayKey;
        const dayCalories = getDayCalories(day);
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
                    <button className="text-[10px] bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full font-semibold hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors truncate max-w-[120px]">
                      {getBreakfastForDay(day)?.name || '🥐 Petit déj'}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-52 p-2" align="start">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Petit déjeuner</p>
                    <div className="space-y-0.5 max-h-48 overflow-y-auto">
                      <button onClick={() => setBreakfastForDay(day, null)} className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors">
                        — Aucun
                      </button>
                      {petitDejMeals.map(m => (
                        <button key={m.id} onClick={() => setBreakfastForDay(day, m.id)} className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${breakfastSelections[day] === m.id ? 'bg-primary/10 font-bold' : ''}`}>
                          {m.name} {m.calories ? `(${m.calories})` : ''}
                        </button>
                      ))}
                      {petitDejMeals.length === 0 && (
                        <p className="text-[10px] text-muted-foreground italic px-2 py-1">Aucun petit déj dans "Tous"</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {/* Manual calorie input when no breakfast selected */}
                {!getBreakfastForDay(day) && (
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="kcal"
                    key={`breakfast-cal-${day}`}
                    defaultValue={breakfastManualCalories[day] || ''}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const updated = { ...breakfastManualCalories };
                      if (val > 0) updated[day] = val;
                      else delete updated[day];
                      setPreference.mutate({ key: 'planning_breakfast_manual_calories', value: updated });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-14 h-5 text-[10px] bg-transparent border border-dashed border-orange-300/30 rounded px-1 text-orange-500 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40"
                  />
                )}
                <Checkbox
                  checked={!!keepOnReset[`breakfast-${day}`]}
                  onCheckedChange={(checked) => {
                    const updated = { ...keepOnReset };
                    if (checked) updated[`breakfast-${day}`] = true;
                    else delete updated[`breakfast-${day}`];
                    setPreference.mutate({ key: 'planning_keep_on_reset', value: updated });
                  }}
                  className="h-3 w-3 shrink-0"
                  title="Conserver lors du reset"
                />
              </div>
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
                    <div className="flex items-center gap-1 mb-0.5">
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
                        className={`flex items-center gap-0.5 text-[7px] sm:text-[8px] rounded-full px-1 py-px transition-colors ${
                          drinkChecks[`${day}-${time}`]
                            ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold'
                            : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60'
                        }`}
                        title="+ Boisson sucrée (+150 cal)"
                      >
                        🥤 {drinkChecks[`${day}-${time}`] ? '+150' : ''}
                      </button>
                    </div>
                    <div className="mt-0.5 space-y-1">
                      {slotMeals.length === 0 ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            inputMode="numeric"
                            placeholder="kcal"
                            key={`manual-${day}-${time}`}
                            defaultValue={manualCalories[`${day}-${time}`] || ''}
                            onBlur={(e) => {
                              const val = parseInt(e.target.value) || 0;
                              const key = `${day}-${time}`;
                              const updated = { ...manualCalories };
                              if (val > 0) updated[key] = val;
                              else delete updated[key];
                              setPreference.mutate({ key: 'planning_manual_calories', value: updated });
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            className="w-16 h-5 text-[10px] bg-transparent border border-dashed border-muted-foreground/20 rounded px-1 text-muted-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40"
                          />
                          <Checkbox
                            checked={!!keepOnReset[`manual-${day}-${time}`]}
                            onCheckedChange={(checked) => {
                              const updated = { ...keepOnReset };
                              if (checked) updated[`manual-${day}-${time}`] = true;
                              else delete updated[`manual-${day}-${time}`];
                              setPreference.mutate({ key: 'planning_keep_on_reset', value: updated });
                            }}
                            className="h-3 w-3 shrink-0"
                            title="Conserver lors du reset"
                          />
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
                <div className="flex flex-col sm:flex-row items-center gap-0.5 mt-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="kcal"
                    key={`extra-${day}`}
                    defaultValue={extraCalories[day] || ''}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const updated = { ...extraCalories };
                      if (val > 0) updated[day] = val;
                      else delete updated[day];
                      setPreference.mutate({ key: 'planning_extra_calories', value: updated });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full h-5 text-[11px] bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-400 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40 text-center"
                  />
                  <Checkbox
                    checked={!!keepOnReset[`extra-${day}`]}
                    onCheckedChange={(checked) => {
                      const updated = { ...keepOnReset };
                      if (checked) updated[`extra-${day}`] = true;
                      else delete updated[`extra-${day}`];
                      setPreference.mutate({ key: 'planning_keep_on_reset', value: updated });
                    }}
                    className="h-3 w-3 shrink-0"
                    title="Conserver lors du reset"
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Total calorique de la semaine */}
      <div className="rounded-2xl bg-card/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between flex-wrap gap-1">
        <span className="text-sm font-bold text-foreground">Total semaine</span>
        <div className="flex items-center gap-3 flex-wrap ml-auto">
          <span className="text-xs text-muted-foreground font-medium">
            Moy. {Math.round(weekTotal / 7)} kcal/j
          </span>
          <span className="flex items-center gap-1.5 text-sm font-black text-orange-500">
            <Flame className="h-4 w-4" />
            {Math.round(weekTotal)} <span className="text-muted-foreground/50 font-normal text-xs">/ {WEEKLY_GOAL}</span>
          </span>
        </div>
      </div>

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
    </div>
  );
}
