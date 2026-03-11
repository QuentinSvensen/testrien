import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles, Flame, CalendarDays, ArrowUpDown, Infinity as InfinityIcon, ArrowUp, ArrowDown, Drumstick, UtensilsCrossed } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MealCard } from "@/components/MealCard";
import type { Meal } from "@/hooks/useMeals";
import { colorFromName, type FoodItem } from "@/components/FoodItems";
import { usePreferences } from "@/hooks/usePreferences";
import {
  buildStockMap, findStockKey, getMealMultiple, getMealFractionalRatio,
  getEarliestIngredientExpiration, getExpiringIngredientName, getExpiredIngredientNames,
  getMaxIngredientCounter, getCounterIngredientNames, getMissingIngredients,
  formatExpirationLabel, compareExpirationWithCounter, buildScaledMealForRatio,
} from "@/lib/stockUtils";
import {
  normalizeForMatch, strictNameMatch, parseQty, formatNumeric, getFoodItemTotalGrams, parseIngredientGroups, computeIngredientCalories,
} from "@/lib/ingredientUtils";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

type AvailableSortMode = "manual" | "calories" | "protein" | "expiration";

interface AvailableListProps {
  category: { value: string; label: string; emoji: string };
  meals: Meal[];
  foodItems: FoodItem[];
  allMeals: Meal[];
  sortMode: AvailableSortMode;
  sortAsc: boolean;
  onToggleSort: () => void;
  onToggleSortDirection: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onMoveToPossible: (id: string) => void;
  onMovePartialToPossible: (meal: Meal, ratio: number) => void;
  onMoveFoodItemToPossible: (fi: FoodItem) => void;
  onDeleteFoodItem: (id: string) => void;
  onMoveNameMatchToPossible: (meal: Meal, fi: FoodItem) => void;
  onRename: (id: string, name: string) => void;
  onUpdateCalories: (id: string, cal: string | null) => void;
  onUpdateGrams: (id: string, g: string | null) => void;
  onUpdateIngredients: (id: string, ing: string | null) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateOvenTemp: (id: string, t: string | null) => void;
  onUpdateOvenMinutes: (id: string, m: string | null) => void;
}

export function AvailableList({ category, meals, foodItems, allMeals, sortMode, sortAsc, onToggleSort, onToggleSortDirection, collapsed, onToggleCollapse, onMoveToPossible, onMovePartialToPossible, onMoveFoodItemToPossible, onDeleteFoodItem, onMoveNameMatchToPossible, onRename, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes }: AvailableListProps) {
  const isPlat = category.value === "plat";
  const stockMap = buildStockMap(foodItems);
  const { getPreference: getAvailPref, setPreference: setAvailPref } = usePreferences();
  const storedOrder = getAvailPref<string[]>(`available_order_${category.value}`, []);
  const [avDragIndex, setAvDragIndex] = useState<number | null>(null);
  const [customRatios, setCustomRatios] = useState<Record<string, number>>({});
  const [editingRatioId, setEditingRatioId] = useState<string | null>(null);
  const [ratioInput, setRatioInput] = useState("");

  const parseRatioInput = (input: string, maxRatio: number): number | null => {
    const trimmed = input.trim().toLowerCase();
    if (trimmed.startsWith("x")) {
      const mult = parseFloat(trimmed.slice(1));
      if (isNaN(mult) || mult < 0.5) return null;
      return Math.min(mult, maxRatio);
    }
    const pct = parseFloat(trimmed.replace("%", ""));
    if (isNaN(pct) || pct < 50) return null;
    return Math.min(pct / 100, maxRatio);
  };

  const formatRatioBadge = (ratio: number): string => {
    if (ratio >= 1 && Number.isInteger(ratio)) return `x${ratio}`;
    return `${Math.round(ratio * 100)}%`;
  };

  const commitRatio = (mealId: string, maxRatio: number) => {
    const parsed = parseRatioInput(ratioInput, maxRatio);
    if (parsed !== null && parsed >= 0.5) {
      if (parsed === 1) {
        setCustomRatios(prev => { const next = { ...prev }; delete next[mealId]; return next; });
      } else {
        setCustomRatios(prev => ({ ...prev, [mealId]: parsed }));
      }
    }
    setEditingRatioId(null);
  };

  const getDisplayedCalories = (meal: Meal): number | null => {
    const ingCal = computeIngredientCalories(meal.ingredients);
    if (ingCal !== null && Number.isFinite(ingCal)) return ingCal;
    if (!meal.calories) return null;
    const match = meal.calories.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const parseMacroValue = (value: string | null | undefined): number => {
    if (!value) return 0;
    const match = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (!match) return 0;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getUnifiedItemName = (u: {
    type: 'isMeal' | 'nameMatch' | 'available' | 'partial';
    fi?: FoodItem;
    nm?: NameMatch;
    item?: { meal: Meal };
  }): string => {
    if (u.type === 'isMeal') return u.fi?.name ?? '';
    if (u.type === 'nameMatch') return u.nm?.meal.name ?? '';
    return u.item?.meal.name ?? '';
  };

  // 1. Meals realizable via ingredient matching
  const available: { meal: Meal; multiple: number | null }[] = meals
    .filter(meal => meal.ingredients?.trim())
    .map((meal) => {
      const rawMultiple = getMealMultiple(meal, stockMap);
      if (rawMultiple === null) return { meal, multiple: null };
      return { meal, multiple: rawMultiple };
    })
    .filter(({ multiple }) => multiple !== null && (multiple === Infinity || (multiple as number) > 0));
  const availableMealIds = new Set(available.map(a => a.meal.id));

  // 1b. Partial recipes (50-100%)
  const partialAvailable: { meal: Meal; ratio: number }[] = meals
    .filter(meal => meal.ingredients?.trim() && !availableMealIds.has(meal.id))
    .map(meal => {
      const ratio = getMealFractionalRatio(meal, stockMap);
      if (ratio === null) return null;
      return { meal, ratio };
    })
    .filter(Boolean) as { meal: Meal; ratio: number }[];
  const partialMealIds = new Set(partialAvailable.map(p => p.meal.id));

  // 2. Name-match
  type NameMatch = { meal: Meal; fi: FoodItem; portionsAvailable: number | null };
  const nameMatches: NameMatch[] = [];
  const nameMatchedFiIds = new Set<string>();

  for (const meal of meals) {
    if (availableMealIds.has(meal.id) || partialMealIds.has(meal.id)) continue;
    if (meal.ingredients?.trim()) continue;
    for (const fi of foodItems) {
      if (strictNameMatch(meal.name, fi.name)) {
        const mealGrams = parseQty(meal.grams);
        const stockGrams = fi.is_infinite ? Infinity : getFoodItemTotalGrams(fi);
        if (!fi.is_infinite && stockGrams <= 0) continue;
        let portions: number | null = null;
        if (!fi.is_infinite && mealGrams > 0) {
          portions = Math.floor(stockGrams / mealGrams);
          if (portions < 1) continue;
        } else if (!fi.is_infinite) {
          portions = fi.quantity ?? 1;
          if (portions < 1) continue;
        }
        nameMatches.push({ meal, fi, portionsAvailable: fi.is_infinite ? null : portions });
        nameMatchedFiIds.add(fi.id);
        break;
      }
    }
  }

  // 3. is_meal food items
  const isMealItems = foodItems.filter((fi) => {
    if (!fi.is_meal) return false;
    if (nameMatchedFiIds.has(fi.id)) return false;
    const hasRecipeMatch = meals.some(m => strictNameMatch(m.name, fi.name));
    if (hasRecipeMatch) return false;
    return true;
  });

  // 4. Unused food items
  const unusedFoodItems = (() => {
    const nonToujoursItems = foodItems.filter(fi => fi.storage_type !== 'toujours');
    const globalAvailableMeals: Meal[] = allMeals.filter(meal => {
      if (!meal.ingredients?.trim()) return false;
      const m = getMealMultiple(meal, stockMap);
      return m !== null && m > 0;
    });
    const nameMatchMealNames = new Set<string>();
    for (const meal of allMeals) {
      if (meal.ingredients?.trim()) continue;
      for (const fi of foodItems) {
        if (strictNameMatch(meal.name, fi.name)) {
          nameMatchMealNames.add(normalizeForMatch(fi.name));
          break;
        }
      }
    }
    const usedIngredientKeys = new Set<string>();
    for (const meal of globalAvailableMeals) {
      const groups = parseIngredientGroups(meal.ingredients!);
      for (const group of groups) {
        for (const alt of group) {
          const key = findStockKey(stockMap, alt.name);
          if (key !== null) {
            const stock = stockMap.get(key)!;
            if (stock.infinite || stock.grams > 0 || stock.count > 0) {
              usedIngredientKeys.add(key);
            }
          }
        }
      }
    }
    for (const nmKey of nameMatchMealNames) usedIngredientKeys.add(nmKey);

    return nonToujoursItems.filter(fi => {
      if (fi.is_meal) return false;
      const fiKey = normalizeForMatch(fi.name);
      for (const usedKey of usedIngredientKeys) {
        if (strictNameMatch(fiKey, usedKey)) return false;
      }
      return true;
    });
  })();

  // Sort
  let sortedAvailable = [...available];
  let sortedNameMatches = [...nameMatches];
  let sortedIsMealItems = [...isMealItems];

  if (sortMode === "calories" || sortMode === "protein") {
    const dir = sortAsc ? 1 : -1;

    if (sortMode === "calories") {
      sortedAvailable.sort((a, b) => dir * ((getDisplayedCalories(a.meal) ?? 0) - (getDisplayedCalories(b.meal) ?? 0)));
      sortedNameMatches.sort((a, b) => dir * ((getDisplayedCalories(a.meal) ?? 0) - (getDisplayedCalories(b.meal) ?? 0)));
      sortedIsMealItems.sort((a, b) => dir * (parseMacroValue(a.calories) - parseMacroValue(b.calories)));
    } else {
      sortedAvailable.sort((a, b) => dir * (parseMacroValue(a.meal.protein) - parseMacroValue(b.meal.protein)));
      sortedNameMatches.sort((a, b) => dir * (parseMacroValue(a.meal.protein) - parseMacroValue(b.meal.protein)));
      sortedIsMealItems.sort((a, b) => dir * (parseMacroValue(a.protein) - parseMacroValue(b.protein)));
    }
  } else if (sortMode === "expiration") {
    sortedAvailable.sort((a, b) => {
      const aExp = getEarliestIngredientExpiration(a.meal, foodItems);
      const bExp = getEarliestIngredientExpiration(b.meal, foodItems);
      const aCounter = getMaxIngredientCounter(a.meal, foodItems);
      const bCounter = getMaxIngredientCounter(b.meal, foodItems);
      return compareExpirationWithCounter(aExp, bExp, aCounter, bCounter);
    });
    sortedNameMatches.sort((a, b) => {
      const ac = a.fi.counter_start_date ? Math.floor((Date.now() - new Date(a.fi.counter_start_date).getTime()) / 86400000) : null;
      const bc = b.fi.counter_start_date ? Math.floor((Date.now() - new Date(b.fi.counter_start_date).getTime()) / 86400000) : null;
      return compareExpirationWithCounter(a.fi.expiration_date, b.fi.expiration_date, ac, bc);
    });
    sortedIsMealItems.sort((a, b) => {
      const ac = a.counter_start_date ? Math.floor((Date.now() - new Date(a.counter_start_date).getTime()) / 86400000) : null;
      const bc = b.counter_start_date ? Math.floor((Date.now() - new Date(b.counter_start_date).getTime()) / 86400000) : null;
      return compareExpirationWithCounter(a.expiration_date, b.expiration_date, ac, bc);
    });
    const isMealNoDate = sortedIsMealItems.filter(fi => !fi.expiration_date);
    const isMealWithDate = sortedIsMealItems.filter(fi => !!fi.expiration_date);
    sortedIsMealItems = isMealNoDate;
    (sortedIsMealItems as any).__withDate = isMealWithDate;
  }

  const totalCount = sortedAvailable.length + sortedNameMatches.length + sortedIsMealItems.length + partialAvailable.length;
  const isNumericSort = sortMode === "calories" || sortMode === "protein";
  const SortIcon = sortMode === "calories" ? Flame : sortMode === "protein" ? Drumstick : sortMode === "expiration" ? CalendarDays : ArrowUpDown;
  const sortLabel = sortMode === "calories" ? "Calories" : sortMode === "protein" ? "Protéines" : sortMode === "expiration" ? "Péremption" : "Manuel";

  const isToday = (dateStr: string | null) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  };

  // Render helpers
  const renderIsMealCard = (fi: FoodItem, unifiedIdx?: number) => {
    const expLabel = formatExpirationLabel(fi.expiration_date);
    const isExpiredFi = fi.expiration_date && new Date(fi.expiration_date) < new Date(new Date().toDateString());
    const expIsTodayFi = isToday(fi.expiration_date);
    const displayGrams = fi.quantity && fi.quantity > 1 && fi.grams
      ? `${parseQty(fi.grams) * fi.quantity}g`
      : (fi.is_infinite ? "∞" : fi.grams ?? null);
    const counterDays = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
    const fakeMeal: Meal = {
      id: `fi-${fi.id}`, name: fi.name, category: "plat", calories: fi.calories,
      protein: fi.protein ?? null,
      grams: displayGrams, ingredients: null, color: colorFromName(fi.id),
      sort_order: 0, created_at: fi.created_at, is_available: true, is_favorite: false,
      oven_temp: null, oven_minutes: null,
    };
    return (
      <div key={fi.id} className="relative">
        <MealCard meal={fakeMeal}
          onMoveToPossible={() => onMoveFoodItemToPossible(fi)}
          onRename={() => {}} onDelete={() => onDeleteFoodItem(fi.id)} onUpdateCalories={() => {}} onUpdateGrams={() => {}} onUpdateIngredients={() => {}}
          onDragStart={(e) => { e.dataTransfer.setData("mealId", fi.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
          expirationLabel={expLabel} expirationDate={fi.expiration_date} expirationIsToday={expIsTodayFi} maxIngredientCounter={counterDays} />
        {fi.quantity && fi.quantity > 1 && (
          <div className="absolute top-1 right-2 z-10 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5">
            x{fi.quantity}
          </div>
        )}
      </div>
    );
  };

  const renderNameMatchCard = (nm: NameMatch, idx: number, unifiedIdx?: number) => {
    const { meal, fi, portionsAvailable } = nm;
    const expLabel = formatExpirationLabel(fi.expiration_date);
    const counterDays = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
    const displayGrams = fi.quantity && fi.quantity > 1 && fi.grams
      ? `${parseQty(fi.grams) * fi.quantity}g`
      : (meal.grams ?? (fi.is_infinite ? "∞" : fi.grams ?? null));
    const expIsTodayNm = isToday(fi.expiration_date);
    const fakeMeal: Meal = { ...meal, id: `nm-${meal.id}-${fi.id}`, grams: displayGrams, color: meal.color };
    return (
      <div key={`nm-${idx}`} className="relative">
        <MealCard meal={fakeMeal}
          onMoveToPossible={() => onMoveNameMatchToPossible(meal, fi)}
          onRename={(name) => onRename(meal.id, name)} onDelete={() => {}} onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)} onUpdateGrams={(g) => onUpdateGrams(meal.id, g)} onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
          onToggleFavorite={() => onToggleFavorite(meal.id)}
          onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)} onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
          onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
          hideDelete expirationLabel={expLabel} expirationDate={fi.expiration_date} expirationIsToday={expIsTodayNm} maxIngredientCounter={counterDays} />
          <div className="absolute top-1 right-2 z-10 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5">
          {fi.is_infinite ? <InfinityIcon className="inline h-[15px] w-[15px]" /> : portionsAvailable !== null ? `x${portionsAvailable}` : `x${fi.quantity ?? 1}`}
          </div>
      </div>
    );
  };

  const renderAvailableCard = (item: typeof available[0], unifiedIdx?: number) => {
    const { meal, multiple } = item;
    const maxRatio = multiple === Infinity ? 99 : (multiple ?? 1);
    const customRatio = customRatios[meal.id];
    const effectiveRatio = customRatio ?? 1;
    const displayMeal = effectiveRatio !== 1 ? buildScaledMealForRatio(meal, effectiveRatio) : meal;
    const expDate = getEarliestIngredientExpiration(meal, foodItems);
    const expLabel = formatExpirationLabel(expDate);
    const expiringIng = getExpiringIngredientName(meal, foodItems);
    const expiredIngs = getExpiredIngredientNames(meal, foodItems);
    const maxCounter = getMaxIngredientCounter(meal, foodItems);
    const counterIngs = getCounterIngredientNames(meal, foodItems);
    const expIsTodayAv = isToday(expDate);
    return (
      <div key={meal.id} className="relative">
        <MealCard meal={displayMeal}
          onMoveToPossible={() => {
            const cr = customRatios[meal.id];
            if (cr && cr !== 1) {
              onMovePartialToPossible(meal, cr);
            } else {
              onMoveToPossible(meal.id);
            }
            setCustomRatios(prev => { const next = { ...prev }; delete next[meal.id]; return next; });
          }}
          onRename={(name) => onRename(meal.id, name)} onDelete={() => {}} onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)} onUpdateGrams={(g) => onUpdateGrams(meal.id, g)} onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
          onToggleFavorite={() => onToggleFavorite(meal.id)}
          onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)} onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
          onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
          hideDelete expirationLabel={expLabel} expirationDate={expDate} expirationIsToday={expIsTodayAv}
          expiringIngredientName={expiringIng} expiredIngredientNames={expiredIngs} counterIngredientNames={counterIngs} maxIngredientCounter={maxCounter} />
        {multiple !== null && (
          editingRatioId === meal.id ? (
            <div className="absolute top-0 right-2 z-20">
              <Input autoFocus value={ratioInput}
                onChange={(e) => setRatioInput(e.target.value)}
                onBlur={() => commitRatio(meal.id, maxRatio)}
                onKeyDown={(e) => { if (e.key === "Enter") commitRatio(meal.id, maxRatio); if (e.key === "Escape") setEditingRatioId(null); }}
                placeholder="75% ou x2"
                className="w-20 h-6 text-[10px] bg-black/80 text-white border-white/30 placeholder:text-white/40 px-1.5 rounded-full"
              />
            </div>
          ) : (
            <button
              onClick={() => { setEditingRatioId(meal.id); setRatioInput(customRatio ? formatRatioBadge(customRatio) : ""); }}
              className={`absolute top-1 right-2 z-10 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5 hover:ring-2 hover:ring-white/50 transition-all ${customRatio ? 'bg-orange-500/80' : 'bg-black/60'}`}
            >
              {customRatio ? formatRatioBadge(customRatio) : (
                <>x{multiple === Infinity ? <InfinityIcon className="inline h-[15px] w-[15px]" /> : multiple}</>
              )}
            </button>
          )
        )}
      </div>
    );
  };

  const renderPartialCard = (item: typeof partialAvailable[0], unifiedIdx?: number) => {
    const { meal, ratio: defaultRatio } = item;
    const customRatio = customRatios[`partial-${meal.id}`];
    const effectiveRatio = customRatio ?? defaultRatio;
    const pct = Math.round(effectiveRatio * 100);
    const expDate = getEarliestIngredientExpiration(meal, foodItems);
    const expLabel = formatExpirationLabel(expDate);
    const expIsTodayPa = isToday(expDate);
    const maxCounter = getMaxIngredientCounter(meal, foodItems);
    const counterIngs = getCounterIngredientNames(meal, foodItems);
    const partialMeal = buildScaledMealForRatio(meal, effectiveRatio);
    const partialKey = `partial-${meal.id}`;
    return (
      <div key={partialKey} className="relative">
        <MealCard meal={partialMeal}
          onMoveToPossible={() => {
            onMovePartialToPossible(meal, effectiveRatio);
            setCustomRatios(prev => { const next = { ...prev }; delete next[partialKey]; return next; });
          }}
          onRename={(name) => onRename(meal.id, name)} onDelete={() => {}} onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)} onUpdateGrams={(g) => onUpdateGrams(meal.id, g)} onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
          onToggleFavorite={() => onToggleFavorite(meal.id)}
          onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)} onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
          onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
          hideDelete expirationLabel={expLabel} expirationDate={expDate} expirationIsToday={expIsTodayPa} counterIngredientNames={counterIngs} maxIngredientCounter={maxCounter} />
        {editingRatioId === partialKey ? (
          <div className="absolute top-0 right-2 z-20">
            <Input autoFocus value={ratioInput}
              onChange={(e) => setRatioInput(e.target.value)}
              onBlur={() => commitRatio(partialKey, defaultRatio)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRatio(partialKey, defaultRatio); if (e.key === "Escape") setEditingRatioId(null); }}
              placeholder="50-100%"
              className="w-20 h-6 text-[10px] bg-black/80 text-white border-white/30 placeholder:text-white/40 px-1.5 rounded-full"
            />
          </div>
        ) : (
          <button
            onClick={() => { setEditingRatioId(partialKey); setRatioInput(`${pct}%`); }}
            className="absolute top-1 right-2 z-10 bg-orange-500/80 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5 hover:ring-2 hover:ring-white/50 transition-all"
          >
            {pct}%
          </button>
        )}
      </div>
    );
  };

  // Build unified array for DnD reorder
  type UnifiedAvail =
    | { type: 'isMeal'; fi: FoodItem; key: string }
    | { type: 'nm'; nm: NameMatch; nmIdx: number; key: string }
    | { type: 'av'; item: typeof available[0]; key: string }
    | { type: 'partial'; item: typeof partialAvailable[0]; key: string };

  const buildUnifiedItems = (): UnifiedAvail[] => {
    const items: UnifiedAvail[] = [
      ...sortedIsMealItems.map(fi => ({ type: 'isMeal' as const, fi, key: `fi-${fi.id}` })),
      ...sortedNameMatches.map((nm, idx) => ({ type: 'nm' as const, nm, nmIdx: idx, key: `nm-${nm.meal.id}` })),
      ...sortedAvailable.map(item => ({ type: 'av' as const, item, key: `av-${item.meal.id}` })),
      ...partialAvailable.map(item => ({ type: 'partial' as const, item, key: `pa-${item.meal.id}` })),
    ];
    if (sortMode === "manual" && storedOrder.length > 0) {
      const orderMap = new Map(storedOrder.map((k: string, i: number) => [k, i]));
      items.sort((a, b) => (orderMap.get(a.key) ?? Infinity) - (orderMap.get(b.key) ?? Infinity));
    }
    if (sortMode === "calories" || sortMode === "protein") {
      const dir = sortAsc ? 1 : -1;
      const getVal = (u: UnifiedAvail): number => {
        if (sortMode === "calories") {
          if (u.type === 'isMeal') {
            const fakeMeal: Meal = { ...u.fi as unknown as Meal, calories: u.fi.calories, ingredients: null };
            return getDisplayedCalories(fakeMeal) ?? 0;
          }
          if (u.type === 'nm') return getDisplayedCalories(u.nm.meal) ?? 0;
          if (u.type === 'av') {
            const ratio = customRatios[u.item.meal.id] ?? 1;
            const displayMeal = ratio !== 1 ? buildScaledMealForRatio(u.item.meal, ratio) : u.item.meal;
            return getDisplayedCalories(displayMeal) ?? 0;
          }
          if (u.type === 'partial') {
            const ratio = customRatios[`partial-${u.item.meal.id}`] ?? u.item.ratio;
            const displayMeal = buildScaledMealForRatio(u.item.meal, ratio);
            return getDisplayedCalories(displayMeal) ?? 0;
          }
          return 0;
        }

        if (u.type === 'isMeal') return parseMacroValue(u.fi.protein);
        if (u.type === 'nm') return parseMacroValue(u.nm.meal.protein);
        if (u.type === 'av') return parseMacroValue(u.item.meal.protein);
        if (u.type === 'partial') return parseMacroValue(u.item.meal.protein);
        return 0;
      };
      items.sort((a, b) => {
        // is_meal items always at bottom (except for Plat)
        if (!isPlat) {
          const aIsMeal = a.type === 'isMeal' ? 1 : 0;
          const bIsMeal = b.type === 'isMeal' ? 1 : 0;
          if (aIsMeal !== bIsMeal) return aIsMeal - bIsMeal;
        }
        return dir * (getVal(a) - getVal(b));
      });
    } else if (sortMode === "manual") {
      // For manual sort, also push is_meal to bottom when no stored order (except for Plat)
      if (storedOrder.length === 0 && !isPlat) {
        items.sort((a, b) => {
          const aIsMeal = a.type === 'isMeal' ? 1 : 0;
          const bIsMeal = b.type === 'isMeal' ? 1 : 0;
          return aIsMeal - bIsMeal;
        });
      }
    }
    return items;
  };

  const handleAvReorder = (fromIdx: number, toIdx: number) => {
    const items = buildUnifiedItems();
    const reordered = [...items];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setAvailPref.mutate({ key: `available_order_${category.value}`, value: reordered.map(u => u.key) });
  };

  const renderUnusedItems = (items: FoodItem[]) => (
    <div className={`${isPlat ? 'mb-2' : 'mt-4'} rounded-2xl bg-muted/30 border border-border/20 p-3`}>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">🧊 Aliments inutilisés ({items.length})</p>
      <div className="flex flex-wrap gap-1.5">
        {[...items].sort((a, b) => {
          const today = new Date(new Date().toDateString());
          const aCounter = a.counter_start_date ? Math.floor((Date.now() - new Date(a.counter_start_date).getTime()) / 86400000) : null;
          const bCounter = b.counter_start_date ? Math.floor((Date.now() - new Date(b.counter_start_date).getTime()) / 86400000) : null;
          if (aCounter !== null && bCounter === null) return -1;
          if (aCounter === null && bCounter !== null) return 1;
          if (aCounter !== null && bCounter !== null && aCounter !== bCounter) return bCounter - aCounter;
          const aExpired = a.expiration_date ? new Date(a.expiration_date) < today : false;
          const bExpired = b.expiration_date ? new Date(b.expiration_date) < today : false;
          if (aExpired && !bExpired) return -1;
          if (!aExpired && bExpired) return 1;
          if (a.expiration_date && b.expiration_date) return a.expiration_date.localeCompare(b.expiration_date);
          if (a.expiration_date && !b.expiration_date) return -1;
          if (!a.expiration_date && b.expiration_date) return 1;
          return 0;
        }).map(fi => {
          const totalG = getFoodItemTotalGrams(fi);
          const qty = fi.quantity && fi.quantity > 1 ? fi.quantity : null;
          const isExpired = fi.expiration_date ? new Date(fi.expiration_date) < new Date(new Date().toDateString()) : false;
          const expLabel = fi.expiration_date ? format(parseISO(fi.expiration_date), 'd MMM', { locale: fr }) : null;
          const counterDays = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
          const counterUrgent = counterDays !== null && counterDays >= 3;
          return (
            <span key={fi.id} className={`text-[11px] px-2.5 py-1.5 rounded-full font-medium transition-colors inline-flex items-center gap-1 ${isExpired ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/40' : 'bg-muted/80 text-muted-foreground hover:bg-muted'}`}>
              {fi.name}
              {counterDays !== null && (
                <span className={`text-[9px] font-black px-1 py-0 rounded-full flex items-center gap-0.5 ${counterUrgent ? 'bg-red-500/60 text-white' : 'opacity-70'}`}>
                  ⏱{counterDays}j
                </span>
              )}
              {totalG > 0 && <span className="opacity-60">{formatNumeric(totalG)}g</span>}
              {qty && <span className="opacity-60">×{qty}</span>}
              {fi.is_infinite && <span className="opacity-60">∞</span>}
              {expLabel && <span className={`text-[9px] ${isExpired ? 'text-red-300' : 'opacity-50'}`}>📅{expLabel}</span>}
              <button onClick={() => onDeleteFoodItem(fi.id)} className="ml-0.5 opacity-40 hover:opacity-100 hover:text-destructive transition-opacity" title="Supprimer cet aliment">✕</button>
            </span>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4">
      <div className="flex items-center gap-2 w-full">
        <button onClick={onToggleCollapse} className="flex items-center gap-2 flex-1 text-left">
          {!collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-yellow-500" />
            {category.label} au choix
          </h2>
          <span className="text-sm font-normal text-muted-foreground">{totalCount}</span>
        </button>
        <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-6 px-1.5">
          <SortIcon className="h-3 w-3" />
          <span className="hidden sm:inline">{sortLabel}</span>
        </Button>
        {isNumericSort && (
          <Button size="sm" variant="ghost" onClick={onToggleSortDirection} className="h-6 w-6 p-0">
            {sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          </Button>
        )}
      </div>

      {!collapsed &&
        <div className="flex flex-col gap-2 mt-3">
          {isPlat && unusedFoodItems.length > 0 && renderUnusedItems(unusedFoodItems)}

          {(() => {
            const isMealWithDate: FoodItem[] = (sortedIsMealItems as any).__withDate || [];

            if (sortMode === "expiration") {
              type UnifiedItem =
                | { type: 'isMeal'; fi: FoodItem; sortDate: string | null; sortCounter: number | null; sortCalories: number | null }
                | { type: 'nameMatch'; nm: NameMatch; idx: number; sortDate: string | null; sortCounter: number | null; sortCalories: number | null }
                | { type: 'available'; item: typeof available[0]; sortDate: string | null; sortCounter: number | null; sortCalories: number | null }
                | { type: 'partial'; item: typeof partialAvailable[0]; sortDate: string | null; sortCounter: number | null; sortCalories: number | null };

              const unified: UnifiedItem[] = [];
              for (const fi of [...sortedIsMealItems, ...isMealWithDate]) {
                const counter = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
                const fakeMeal: Meal = { ...fi as unknown as Meal, calories: fi.calories, ingredients: null };
                unified.push({ type: 'isMeal', fi, sortDate: fi.expiration_date, sortCounter: counter, sortCalories: getDisplayedCalories(fakeMeal) });
              }
              for (let i = 0; i < sortedNameMatches.length; i++) {
                const nm = sortedNameMatches[i];
                const counter = nm.fi.counter_start_date ? Math.floor((Date.now() - new Date(nm.fi.counter_start_date).getTime()) / 86400000) : null;
                unified.push({ type: 'nameMatch', nm, idx: i, sortDate: nm.fi.expiration_date, sortCounter: counter, sortCalories: getDisplayedCalories(nm.meal) });
              }
              for (const item of sortedAvailable) {
                const expDate = getEarliestIngredientExpiration(item.meal, foodItems);
                const maxCounter = getMaxIngredientCounter(item.meal, foodItems);
                const ratio = customRatios[item.meal.id] ?? 1;
                const displayMeal = ratio !== 1 ? buildScaledMealForRatio(item.meal, ratio) : item.meal;
                unified.push({ type: 'available', item, sortDate: expDate, sortCounter: maxCounter, sortCalories: getDisplayedCalories(displayMeal) });
              }
              for (const item of partialAvailable) {
                const expDate = getEarliestIngredientExpiration(item.meal, foodItems);
                const maxCounter = getMaxIngredientCounter(item.meal, foodItems);
                const ratio = customRatios[`partial-${item.meal.id}`] ?? item.ratio;
                const displayMeal = buildScaledMealForRatio(item.meal, ratio);
                unified.push({ type: 'partial', item, sortDate: expDate, sortCounter: maxCounter, sortCalories: getDisplayedCalories(displayMeal) });
              }

              unified.sort((a, b) => {
                // is_meal items always at bottom (except for Plat)
                if (!isPlat) {
                  const aIsMeal = a.type === 'isMeal' ? 1 : 0;
                  const bIsMeal = b.type === 'isMeal' ? 1 : 0;
                  if (aIsMeal !== bIsMeal) return aIsMeal - bIsMeal;
                }

                const baseCmp = compareExpirationWithCounter(a.sortDate, b.sortDate, a.sortCounter, b.sortCounter);
                if (baseCmp !== 0) return baseCmp;

                // Same group + same date => calories ascending as tiebreaker
                if (a.sortCalories !== null && b.sortCalories !== null && a.sortCalories !== b.sortCalories) return a.sortCalories - b.sortCalories;
                if (a.sortCalories !== null && b.sortCalories === null) return -1;
                if (a.sortCalories === null && b.sortCalories !== null) return 1;

                return getUnifiedItemName(a).localeCompare(getUnifiedItemName(b));
              });

              const firstIsMealIdx = !isPlat ? unified.findIndex(u => u.type === 'isMeal') : -1;
              return unified.map((u, idx) => {
                const sep = (idx === firstIsMealIdx && firstIsMealIdx > 0) ? (
                  <div key={`sep-ismeal`} className="flex items-center gap-2 my-2">
                    <Separator className="flex-1" />
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1"><UtensilsCrossed className="h-3 w-3" />Repas seuls</span>
                    <Separator className="flex-1" />
                  </div>
                ) : null;
                const card = u.type === 'isMeal' ? renderIsMealCard(u.fi, idx)
                  : u.type === 'nameMatch' ? renderNameMatchCard(u.nm, u.idx, idx)
                  : u.type === 'partial' ? renderPartialCard(u.item, idx)
                  : renderAvailableCard(u.item, idx);
                return sep ? <>{sep}{card}</> : card;
              });
            }

            // manual or calories: use unified items
            const unifiedItems = buildUnifiedItems();
            const firstIsMealIdx2 = !isPlat ? unifiedItems.findIndex(u => u.type === 'isMeal') : -1;
            return unifiedItems.map((u, idx) => {
              const sep = (idx === firstIsMealIdx2 && firstIsMealIdx2 > 0) ? (
                <div key={`sep-ismeal-m`} className="flex items-center gap-2 my-2">
                  <Separator className="flex-1" />
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1"><UtensilsCrossed className="h-3 w-3" />Repas seuls</span>
                  <Separator className="flex-1" />
                </div>
              ) : null;
              const card = u.type === 'isMeal' ? renderIsMealCard(u.fi, idx)
                : u.type === 'nm' ? renderNameMatchCard(u.nm, u.nmIdx, idx)
                : u.type === 'partial' ? renderPartialCard(u.item, idx)
                : renderAvailableCard(u.item, idx);
              return sep ? <>{sep}{card}</> : card;
            });
          })()}

          {totalCount === 0 &&
            <p className="text-muted-foreground text-sm text-center py-4 italic">
              Aucun repas réalisable avec les aliments disponibles
            </p>
          }

          {!isPlat && unusedFoodItems.length > 0 && renderUnusedItems(unusedFoodItems)}
        </div>
      }
    </div>
  );
}
