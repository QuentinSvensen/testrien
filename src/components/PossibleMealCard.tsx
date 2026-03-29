import { useState } from "react";
import { ArrowLeft, Copy, MoreVertical, Trash2, Calendar, Timer, Flame, Weight, Hash, List, Undo2, Percent, Thermometer, SplitSquareHorizontal, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IngredientEditor } from "@/components/IngredientEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PossibleMeal } from "@/hooks/useMeals";
import { DAYS, TIMES } from "@/hooks/useMeals";
import { format, parseISO } from "date-fns";
import {
  type IngLine, parseIngredientLineDisplay, formatQtyDisplay,
  parseIngredientsToLines, serializeIngredients, computeIngredientCalories,
  computeIngredientProtein, cleanIngredientText, normalizeKey,
  hasNegativeMetric, getMealColor, getAdaptedCounterDays, getDateForDayKey, getTargetDate,
  extractMetrics, parseIngredientLineRaw, computeCounterHours
} from "@/lib/ingredientUtils";
import { scaleIngredientStringExact, findStockKey, getDisplayedPMCalories, getDisplayedPMProtein } from "@/lib/stockUtils";
import type { StockInfo } from "@/lib/stockUtils";
import { fr } from "date-fns/locale";

interface PossibleMealCardProps {
  pm: PossibleMeal;
  onRemove: () => void;
  onReturnWithoutDeduction?: () => void;
  onReturnWithoutDeductionLabel?: string;
  onReturnToMaster?: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdateExpiration: (date: string | null) => void;
  onUpdatePlanning: (day: string | null, time: string | null) => void;
  onUpdateCounter: (date: string | null) => void;
  onUpdateCalories: (cal: string | null) => void;
  onUpdateGrams: (g: string | null) => void;
  onUpdateQuantity?: (qty: number) => void;
  onSplitQuantity?: (ratio: number, baseIngredients: string | null) => void;
  onUpdateIngredients: (ing: string | null) => void;
  onUpdatePossibleIngredients?: (newIngredients: string | null) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isHighlighted?: boolean;
  stockMap?: Map<string, StockInfo>;
  expiredIngredientNames?: Set<string>;
  expiringSoonIngredientNames?: Set<string>;
  onDoubleClick?: () => void;
  realtimeCounterStartDate?: string | null;
}

const DAY_LABELS: Record<string, string> = {
  lundi: 'Lun', mardi: 'Mar', mercredi: 'Mer', jeudi: 'Jeu',
  vendredi: 'Ven', samedi: 'Sam', dimanche: 'Dim',
};

// Ingredient parsing utilities imported from @/lib/ingredientUtils

export function PossibleMealCard({
  pm, stockMap, onRemove, onReturnWithoutDeduction, onReturnWithoutDeductionLabel,
  onReturnToMaster, onDelete, onDuplicate, onUpdateExpiration, onUpdatePlanning,
  onUpdateCounter, onUpdateCalories, onUpdateGrams, onUpdateQuantity,
  onUpdateIngredients, onUpdatePossibleIngredients, onDragStart, onDragOver,
  onDrop, isHighlighted, expiredIngredientNames, expiringSoonIngredientNames, onSplitQuantity, onDoubleClick,
  realtimeCounterStartDate
}: PossibleMealCardProps) {
  const parseIngredientLine = parseIngredientLineDisplay;
  const formatQty = formatQtyDisplay;
  const [editing, setEditing] = useState<"calories" | "grams" | "quantity" | "ratio" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [calOpen, setCalOpen] = useState(false);
  const [calMobileOpen, setCalMobileOpen] = useState(false);
  const [editingIngredients, setEditingIngredients] = useState(false);
  const [ingLines, setIngLines] = useState<IngLine[]>([]);

  const meal = pm.meals;
  if (!meal) return null;

  const displayIngredients = pm.ingredients_override ?? meal.ingredients;

  // Build isAvailable callback from stockMap for macro computation
  const isAvailableCb = stockMap ? (name: string) => {
    const key = findStockKey(stockMap, name);
    if (!key) return false;
    const stock = stockMap.get(key);
    if (!stock) return false;
    return stock.infinite || stock.grams > 0 || stock.count > 0;
  } : undefined;

  // Detect scale ratio from override vs original ingredients
  // Returns ratio only if ALL non-optional ingredients have the same ratio
  const detectScaleRatio = (): number | null => {
    if (!pm.ingredients_override) return null;
    // For infinite/simple cards without ingredients, synthesize the same base used during scaling
    const baseIngStr = meal.ingredients
      ? meal.ingredients
      : (() => {
        const baseGrams = parseFloat((meal.grams || "0").replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
        return baseGrams > 0 ? `${baseGrams}g ${meal.name}` : `1 ${meal.name}`;
      })();
    const parseToMap = (str: string) => {
      const map = new Map<string, { qty: number; count: number }>();
      str.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean).forEach(group => {
        const alt = group.split(/\|/)[0].trim();
        const isOptional = alt.startsWith("?");
        const cleanAlt = isOptional ? alt.slice(1).trim() : alt;

        // Use normalized key for matching
        const { text: withoutMetrics } = extractMetrics(cleanAlt);
        const parsed = parseIngredientLineRaw(withoutMetrics);
        if (!parsed.name) return;
        const key = normalizeKey(parsed.name);

        // Only keep the first encounter (or could sum, but usually one line per ingredient)
        if (!map.has(key)) {
          map.set(key, { qty: parsed.qty, count: parsed.count });
        }
      });
      return map;
    };

    const baseMap = parseToMap(baseIngStr);
    const overMap = parseToMap(pm.ingredients_override);

    if (baseMap.size === 0 || overMap.size === 0) return null;

    let detectedRatios: number[] = [];
    let commonCount = 0;

    for (const [key, baseVal] of baseMap.entries()) {
      const overVal = overMap.get(key);
      if (!overVal) continue;

      commonCount++;
      if (baseVal.qty > 0 && overVal.qty > 0) {
        detectedRatios.push(overVal.qty / baseVal.qty);
      } else if (baseVal.count > 0 && overVal.count > 0) {
        detectedRatios.push(overVal.count / baseVal.count);
      } else {
        detectedRatios.push(1);
      }
    }

    if (detectedRatios.length === 0) return null;
    const firstRatio = detectedRatios[0];
    if (Math.abs(firstRatio - 1) <= 0.01) return null;

    const allSame = detectedRatios.every(r => Math.abs(r - firstRatio) / (firstRatio || 1) < 0.05);
    if (!allSame) return null;
    if (commonCount < Math.min(baseMap.size, overMap.size) * 0.5) return null;

    return firstRatio;
  };
  const detectedRatio = detectScaleRatio();

  const isExpired = pm.expiration_date && new Date(pm.expiration_date) < new Date();
  const todayISO = format(new Date(), 'yyyy-MM-dd');
  const effectiveCounterStart = realtimeCounterStartDate ?? pm.counter_start_date;
  const targetDate = getTargetDate(pm.day_of_week, new Date(), effectiveCounterStart, pm.meal_time);
  const counterDays = getAdaptedCounterDays(effectiveCounterStart, pm.day_of_week, pm.created_at, pm.meal_time);
  const counterHours = computeCounterHours(effectiveCounterStart, targetDate);

  // Stop blinking if the meal's day is in the past!
  let isPast = false;
  if (pm.day_of_week) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = getDateForDayKey(pm.day_of_week, new Date());
    isPast = target.getTime() < today.getTime();
  }

  const counterUrgent = counterDays !== null && counterDays >= 3;
  const animateUrgent = counterUrgent && !isPast;

  const handleSaveEdit = () => {
    const val = editValue.trim() || null;
    if (editing === "calories") onUpdateCalories(val);
    if (editing === "grams") onUpdateGrams(val);
    if (editing === "quantity" && onUpdateQuantity) {
      const qty = parseInt(editValue.trim());
      if (!isNaN(qty) && qty >= 1) onUpdateQuantity(qty);
    }
    if (editing === "ratio") {
      const trimmed = editValue.trim().toLowerCase();
      let ratio: number | null = null;
      if (trimmed.startsWith("x")) {
        const mult = parseFloat(trimmed.slice(1));
        if (!isNaN(mult) && mult >= 0.1) ratio = mult;
      } else {
        const pct = parseFloat(trimmed.replace("%", ""));
        if (!isNaN(pct) && pct >= 10) ratio = pct / 100;
      }
      if (ratio !== null && onUpdatePossibleIngredients) {
        const currentIng = pm.ingredients_override
          ? pm.ingredients_override
          : meal.ingredients
            ? meal.ingredients
            : (() => {
              const baseGrams = parseFloat((meal.grams || "0").replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
              return baseGrams > 0 ? `${baseGrams}g ${meal.name}` : `1 ${meal.name}`;
            })();

        // The user input (ratio) is intended to be the absolute multiplier (e.g., "x3" means 3x the original base).
        // If the card is already multiplied by a known ratio (detectedRatio), we calculate the relative 
        // difference needed to reach the target ratio safely from the current ingredients.
        const effectiveRatio = detectedRatio ? (ratio / detectedRatio) : ratio;

        const scaledIngredients = scaleIngredientStringExact(currentIng, effectiveRatio);
        onUpdatePossibleIngredients(scaledIngredients);
      }
      // NOTE: Do NOT call onUpdateGrams or onUpdateCalories here — those modify the MASTER meal.
      // The scaled values are derived from ingredients_override (for ingredient-based calories)
      // and visible via the detectedRatio badge for grams display.
    }
    setEditing(null);
  };

  const openIngredients = () => {
    setIngLines(parseIngredientsToLines(displayIngredients));
    setEditingIngredients(true);
  };

  const commitIngredients = () => {
    const serialized = serializeIngredients(ingLines);
    if (onUpdatePossibleIngredients) {
      onUpdatePossibleIngredients(serialized);
    } else {
      onUpdateIngredients(serialized);
    }
    setEditingIngredients(false);
  };

  const selectedDate = pm.expiration_date ? parseISO(pm.expiration_date) : undefined;
  const expIsToday = pm.expiration_date === todayISO;

  const renderDatesSection = (isMobile: boolean) => {
    const isOpen = isMobile ? calMobileOpen : calOpen;
    const setIsOpen = isMobile ? setCalMobileOpen : setCalOpen;

    return (
      <div className="flex items-center gap-1 flex-wrap shrink-0">
        <Calendar className="h-2.5 w-2.5 text-white/50 shrink-0" />
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className={`h-5 min-w-[88px] border bg-white/10 text-white text-[10px] px-1.5 rounded-md flex items-center hover:bg-white/20 transition-colors ${expIsToday ? 'border-red-500 ring-1 ring-red-500 text-red-200' : isExpired ? 'border-white/20 text-red-200' : 'border-white/20'
                }`}
            >
              {pm.expiration_date
                ? format(parseISO(pm.expiration_date), 'd MMM yy', { locale: fr })
                : <span className="text-white/40">Date péremption</span>
              }
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarPicker
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                onUpdateExpiration(date ? format(date, 'yyyy-MM-dd') : null);
                setIsOpen(false);
              }}
              initialFocus
            />
            {pm.expiration_date && (
              <div className="p-2 border-t">
                <button
                  onClick={() => { onUpdateExpiration(null); setIsOpen(false); }}
                  className="text-xs text-muted-foreground hover:text-destructive w-full text-center"
                >
                  Effacer la date
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {(() => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const monday = new Date(today);
          const dayOf = monday.getDay();
          const diff = monday.getDate() - dayOf + (dayOf === 0 ? -6 : 1);
          monday.setDate(diff);

          const planningDays = Array.from({ length: 14 }).map((_, i) => {
            const d = new Date(monday);
            d.setDate(d.getDate() + i);
            return {
              iso: format(d, 'yyyy-MM-dd'),
              label: format(d, 'EEEE d', { locale: fr }).replace(/^\w/, c => c.toUpperCase())
            };
          });

          return (
            <Select
              value={pm.day_of_week && /^\d{4}-\d{2}-\d{2}$/.test(pm.day_of_week) ? pm.day_of_week : "none"}
              onValueChange={(val) => onUpdatePlanning(val === "none" ? null : val, pm.meal_time)}
            >
              <SelectTrigger
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="h-5 min-w-[58px] w-auto justify-start p-0 px-1.5 border border-white/20 bg-white/10 text-white text-[10px] flex items-center gap-1 hover:bg-white/20 transition-colors [&>svg:last-child]:hidden focus:ring-0 focus:ring-offset-0"
              >
                <Calendar className="h-2.5 w-2.5 opacity-50 shrink-0" />
                {pm.day_of_week ? (
                  /^\d{4}-\d{2}-\d{2}$/.test(pm.day_of_week)
                    ? format(parseISO(pm.day_of_week), 'eee d', { locale: fr })
                    : DAY_LABELS[pm.day_of_week] || pm.day_of_week
                ) : (
                  <span className="opacity-40">Jour</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Nul —</SelectItem>
                {planningDays.map(d => (
                  <SelectItem 
                    key={d.iso} 
                    value={d.iso}
                    className={d.iso === todayISO ? 'bg-primary/15 focus:bg-primary/25 font-bold' : ''}
                  >
                    <div className="flex items-center gap-2">
                      <span>{d.iso === todayISO ? `📅 ${d.label}` : d.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })()}

        <Select value={pm.meal_time || "none"} onValueChange={(val) => onUpdatePlanning(pm.day_of_week, val === "none" ? null : val)}>
          <SelectTrigger
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="h-5 w-[50px] border-white/20 bg-white/10 text-white text-[10px] px-1"
          >
            <SelectValue placeholder="Quand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {meal.category === "petit_dejeuner" && <SelectItem value="matin">Matin</SelectItem>}
            {TIMES.map((t) => (
              <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        onDoubleClick?.();
      }}
      className={`group relative flex flex-col rounded-2xl px-3 py-2.5 shadow-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg ${isHighlighted ? 'ring-4 ring-yellow-400 scale-105' : expIsToday ? 'ring-2 ring-red-500' : isExpired ? 'ring-2 ring-red-500' : ''}`}
      style={{ backgroundColor: getMealColor(displayIngredients, meal.name) }}
    >
      {/* Multiplier badge — pinned to absolute top-right */}
      {detectedRatio !== null && !editing && !editingIngredients && (
        <div className="absolute top-0 right-0 z-10">
          <button onClick={() => { setEditValue(detectedRatio >= 1 ? `x${Math.round(detectedRatio * 10) / 10}` : `${Math.round(detectedRatio * 100)}%`); setEditing("ratio"); }} className="bg-orange-500/80 text-white text-[10px] font-black px-1.5 py-0.5 rounded-tr-2xl rounded-bl-2xl hover:bg-orange-500/90 transition-colors shadow-sm">
            {detectedRatio >= 1 && Number.isInteger(detectedRatio) ? `x${detectedRatio}` : `${Math.round(detectedRatio * 100)}%`}
          </button>
        </div>
      )}

      {/* Row 1: name + actions + desktop dates */}
      <div className="flex items-start justify-between gap-1.5 min-w-0">
        <div className="flex items-start gap-1.5 min-w-0 flex-1">
          <Button size="icon" variant="ghost" onClick={onRemove} className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20 mt-0.5">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="font-semibold text-white text-sm min-w-0 break-words whitespace-normal pt-[2px]">
            {meal.name}
          </span>
        </div>

        {/* Desktop-only dates (top right) */}
        <div className="hidden md:flex items-center shrink-0 mt-0.5">
          {renderDatesSection(false)}
        </div>
      </div>

      {/* Editing overlay */}
      {editing ? (
        <Input autoFocus placeholder={editing === "ratio" ? "75% ou x2" : editing === "calories" ? "Ex: 350 kcal" : "Ex: 150g"} value={editValue}
          onChange={(e) => setEditValue(e.target.value)} onBlur={handleSaveEdit}
          onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
          className="mt-1.5 h-6 border-white/30 bg-white/20 text-white placeholder:text-white/60 text-xs" />
      ) : editingIngredients ? (
        <div className="mt-1.5">
          <IngredientEditor lines={ingLines} onUpdate={setIngLines} onCommit={commitIngredients} />
        </div>
      ) : null}

      {/* Row 2: Dates/Options (Right-aligned) */}
      <div className="flex flex-wrap items-center justify-end gap-y-1.5 gap-x-2 w-full mt-1.5 mt-auto">

        {/* Dates - Mobile only */}
        <div className="md:hidden flex items-center gap-1 flex-wrap shrink-0">
          {renderDatesSection(true)}
        </div>

        {/* Options */}
        <div className="ml-auto flex items-center justify-end gap-1.5 shrink-0 flex-wrap">
          {counterDays !== null ? (
            <button
              onClick={() => onUpdateCounter(null)}
              className={`text-xs font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 transition-all shrink-0 ${counterUrgent
                ? animateUrgent
                  ? 'bg-red-500/80 text-white animate-pulse shadow-lg shadow-red-500/30'
                  : 'bg-red-500/80 text-white shadow-lg shadow-red-500/30' // Frozen past urgent
                : 'bg-white/25 text-white'
                }`}
              title={`Arrêter le compteur${counterHours !== null ? ` (${counterHours}h écoulées)` : ''}`}
            >
              <Timer className="h-3 w-3" /> {counterDays}j
            </button>
          ) : null}

          {(pm.quantity > 1 || onUpdateQuantity) && (
            <button
              onClick={() => { if (onUpdateQuantity) { setEditValue(String(pm.quantity)); setEditing("quantity"); } }}
              className={`text-[10px] text-white/90 bg-black/30 px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 ${onUpdateQuantity ? 'hover:bg-black/40 cursor-pointer' : ''}`}
            >
              <Hash className="h-2.5 w-2.5" />{pm.quantity}
            </button>
          )}
          {meal.grams && (() => {
            const baseG = parseFloat(meal.grams!.replace(/[^0-9.]/g, '')) || 0;
            const displayG = detectedRatio !== null && baseG > 0 ? String(Math.round(baseG * detectedRatio)) : meal.grams;
            return (
              <button onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }} className="text-[10px] text-white/90 bg-black/30 px-1 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-black/40 shrink-0">
                <Weight className="h-2.5 w-2.5" />{displayG}
              </button>
            );
          })()}
          {(meal.oven_temp || meal.oven_minutes) && (
            <span className="text-[10px] text-white/90 bg-black/30 px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0">
              <Thermometer className="h-2.5 w-2.5" /> {meal.oven_temp && `${meal.oven_temp}°C`}{meal.oven_temp && meal.oven_minutes && ' · '}{meal.oven_minutes && `${meal.oven_minutes}min`}
            </span>
          )}
          {/* ratio badge moved to absolute top-right */}
          {(() => {
            const rawDisplayCal = getDisplayedPMCalories(pm, detectedRatio ?? undefined);
            const displayCal = rawDisplayCal ? Math.round(rawDisplayCal) : null;
            const isComputed = computeIngredientCalories(displayIngredients, isAvailableCb) !== null;
            return displayCal ? (
              <button
                onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }}
                className={`text-[10px] text-white px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 ${isComputed ? 'bg-orange-500/50 font-bold hover:bg-orange-500/60' : 'bg-black/30 text-white/90 hover:bg-black/40'
                  }`}
              >
                <Flame className="h-2.5 w-2.5" />{displayCal}
              </button>
            ) : null;
          })()}
          {(() => {
            const rawDisplayPro = getDisplayedPMProtein(pm, detectedRatio ?? undefined);
            const displayPro = rawDisplayPro ? Math.round(rawDisplayPro) : null;
            const isComputedPro = computeIngredientProtein(displayIngredients, isAvailableCb) !== null;
            return displayPro && displayPro !== 0 ? (
              <span className={`text-[10px] px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 font-semibold ${isComputedPro ? 'bg-blue-600/60 text-white' : 'text-white/90 bg-blue-500/40'
                }`}>
                🍗 {displayPro}
              </span>
            ) : null;
          })()}

          <Button size="icon" variant="ghost" onClick={onDuplicate} className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20" title="Dupliquer">
            <Copy className="h-3 w-3" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onReturnToMaster && (
                <DropdownMenuItem onClick={onReturnToMaster}>
                  <Undo2 className="mr-2 h-4 w-4" /> Revenir dans Tous
                </DropdownMenuItem>
              )}
              {onReturnWithoutDeduction && (
                <DropdownMenuItem onClick={onReturnWithoutDeduction}>
                  <Undo2 className="mr-2 h-4 w-4" /> {onReturnWithoutDeductionLabel || 'Remettre au choix (sans déduire)'}
                </DropdownMenuItem>
              )}
              {onSplitQuantity && detectedRatio !== null && detectedRatio >= 2 && Number.isInteger(detectedRatio) && (
                <DropdownMenuItem onClick={() => {
                  const baseIng = pm.ingredients_override ? pm.ingredients_override : meal.ingredients ? meal.ingredients : (() => {
                    const baseGrams = parseFloat((meal.grams || "0").replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
                    return baseGrams > 0 ? `${baseGrams}g ${meal.name}` : `1 ${meal.name}`;
                  })();
                  const baseIngredients = scaleIngredientStringExact(baseIng, 1 / detectedRatio);
                  onSplitQuantity(detectedRatio, baseIngredients);
                }}>
                  <SplitSquareHorizontal className="mr-2 h-4 w-4" /> Diviser les quantités
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => { setEditValue(""); setEditing("ratio"); }}>
                <Percent className="mr-2 h-4 w-4" /> Pourcentage / Multiple
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }}>
                <Flame className="mr-2 h-4 w-4" /> Calories
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }}>
                <Weight className="mr-2 h-4 w-4" /> Grammes
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openIngredients}>
                <List className="mr-2 h-4 w-4" /> Ingrédients
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdateCounter(pm.counter_start_date ? null : new Date().toISOString())}>
                <Timer className="mr-2 h-4 w-4" /> {pm.counter_start_date ? (new Date(pm.counter_start_date) > new Date() ? 'Prog.' : 'Arrêter compteur') : 'Démarrer compteur'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" /> Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Row 3: ingredients (click to edit) — show if base or override has ingredients */}
      {!editing && !editingIngredients && displayIngredients && (
        <button onClick={openIngredients} className="mt-1 text-[10px] text-white/60 flex flex-wrap gap-x-1 text-left hover:text-white/80 transition-colors">
          {renderIngredientDisplayCompact(displayIngredients, expiredIngredientNames, expiringSoonIngredientNames, stockMap)}
        </button>
      )}
    </div>
  );
}

/** Render ingredient display with expired/soon highlighting (Compact version for Possible) */
function renderIngredientDisplayCompact(
  ingredients: string,
  expiredIngredientNames?: Set<string>,
  expiringSoonIngredientNames?: Set<string>,
  stockMap?: Map<string, StockInfo>,
) {
  // Split raw ingredients first, filter out negative-metric groups, then clean for display
  const rawGroups = ingredients.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  const filteredRaw = rawGroups.filter(g => !g.split(/\|/).some(alt => hasNegativeMetric(alt.trim())));
  const cleaned = cleanIngredientText(filteredRaw.join(", "));
  const groups = cleaned.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  const elements: React.ReactNode[] = [];

  groups.forEach((group, gi) => {
    const isOpt = group.startsWith("?");
    const display = isOpt ? group.slice(1).trim() : group;

    // Handle OR alternatives (|): strike-through unavailable alternatives
    const alternatives = display.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
    if (alternatives.length > 1) {
      const altElements = alternatives.map((alt, ai) => {
        const strippedAlt = alt.replace(/^\d+(?:[.,]\d+)?(?:g|ml|kg|cl|l|x| unit)?\s+/i, "").trim();
        const stockKey = stockMap ? findStockKey(stockMap, strippedAlt) : null;
        const stock = stockKey ? stockMap?.get(stockKey) : undefined;
        const available = !!stock && (stock.infinite || stock.grams > 0 || stock.count > 0);

        return (
          <span key={ai} className={available ? '' : 'line-through opacity-40'}>
            {alt}
            {ai < alternatives.length - 1 ? <span className="opacity-70"> ou </span> : null}
          </span>
        );
      });

      elements.push(
        <span key={gi} className={isOpt ? 'italic text-white/40' : ''}>
          {isOpt ? '?' : ''}{altElements}{gi < groups.length - 1 ? ' •' : ''}
        </span>
      );
      return;
    }

    // Normalize name for matching (strip lead quantity)
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
