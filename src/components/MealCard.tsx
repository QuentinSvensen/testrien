import React, { useState, forwardRef } from "react";
import { ArrowRight, MoreVertical, Pencil, Trash2, Flame, Weight, List, Star, Thermometer, Hash, Link2, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IngredientEditor } from "@/components/IngredientEditor";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Meal } from "@/hooks/useMeals";
import {
  type IngLine, parseIngredientLineDisplay, formatQtyDisplay,
  parseIngredientsToLines, serializeIngredients, normalizeKey,
  computeIngredientCalories, computeIngredientProtein, cleanIngredientText,
  hasNegativeMetric, getMealColor, computeCounterHours
} from "@/lib/ingredientUtils";
import { findStockKey, type StockInfo, getDisplayedCalories, getDisplayedProtein } from "@/lib/stockUtils";

interface MealCardProps {
  meal: Meal;
  onMoveToPossible: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUpdateCalories: (calories: string | null) => void;
  onUpdateProtein?: (protein: string | null) => void;
  onUpdateGrams: (grams: string | null) => void;
  onUpdateIngredients: (ingredients: string | null) => void;
  onToggleFavorite?: () => void;
  onUpdateOvenTemp?: (temp: string | null) => void;
  onUpdateOvenMinutes?: (minutes: string | null) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isHighlighted?: boolean;
  hideDelete?: boolean;
  expirationLabel?: string | null;
  expirationDate?: string | null;
  expirationIsToday?: boolean;
  expiringIngredientName?: string | null;
  expiredIngredientNames?: Set<string>;
  maxIngredientCounter?: number | null;
  missingIngredientNames?: Set<string>;
  counterIngredientNames?: Set<string>;
  expiringSoonIngredientNames?: Set<string>;
  stockMap?: Map<string, StockInfo>;
  earliestCounterDate?: string | null;
}

// Ingredient parsing utilities imported from @/lib/ingredientUtils

export const MealCard = React.memo(forwardRef<HTMLDivElement, MealCardProps>(function MealCard({
  meal, onMoveToPossible, onRename, onDelete, onUpdateCalories, onUpdateProtein, onUpdateGrams,
  onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes, onDragStart,
  onDragOver, onDrop, isHighlighted, hideDelete, expirationLabel, expirationDate,
  expirationIsToday, expiringIngredientName, expiredIngredientNames, expiringSoonIngredientNames,
  maxIngredientCounter, missingIngredientNames, counterIngredientNames, stockMap,
  earliestCounterDate
}, _ref) {
  const parseIngredientLine = parseIngredientLineDisplay;
  const formatQty = formatQtyDisplay;
  const [editing, setEditing] = useState<"name" | "calories" | "protein" | "grams" | "oven_temp" | "oven_minutes" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingIngredients, setEditingIngredients] = useState(false);
  const [ingLines, setIngLines] = useState<IngLine[]>([]);

  const handleSave = () => {
    const val = editValue.trim();
    if (editing === "name" && val && val !== meal.name) onRename(val);
    if (editing === "calories") onUpdateCalories(val || null);
    if (editing === "protein") onUpdateProtein?.(val || null);
    if (editing === "grams") onUpdateGrams(val || null);
    if (editing === "oven_temp") onUpdateOvenTemp?.(val || null);
    if (editing === "oven_minutes") onUpdateOvenMinutes?.(val || null);
    setEditing(null);
  };

  const openIngredients = () => {
    const parsed = parseIngredientsToLines(meal.ingredients);
    setIngLines(parsed);
    setEditingIngredients(true);
  };

  const commitIngredients = () => {
    onUpdateIngredients(serializeIngredients(ingLines));
    setEditingIngredients(false);
  };


  // Build isAvailable callback from stockMap for macro computation
  const isAvailableCb = stockMap ? (name: string) => {
    const key = findStockKey(stockMap, name);
    if (!key) return false;
    const stock = stockMap.get(key);
    if (!stock) return false;
    return stock.infinite || stock.grams > 0 || stock.count > 0;
  } : undefined;

  const ovenTemp = (meal as any).oven_temp;
  const ovenMinutes = (meal as any).oven_minutes;
  const hasCuisson = ovenTemp || ovenMinutes;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group flex flex-col rounded-2xl px-4 py-3 shadow-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg ${isHighlighted ? 'ring-4 ring-yellow-400 scale-105' : ''}`}
      style={{ backgroundColor: getMealColor(meal.ingredients, meal.name) }}
    >
      {editing ? (
        <Input
          autoFocus
          placeholder={editing === "name" ? "Nom" : editing === "calories" ? "Ex: 350 kcal" : editing === "grams" ? "Ex: 150g" : editing === "oven_temp" ? "Ex: 180" : "Ex: 25"}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          inputMode={editing === "oven_temp" || editing === "oven_minutes" ? "numeric" : undefined}
          className="h-8 border-white/30 bg-white/20 text-white placeholder:text-white/60 flex-1"
        />
      ) : editingIngredients ? (
        <IngredientEditor lines={ingLines} onUpdate={setIngLines} onCommit={commitIngredients} />
      ) : (
        <>
          {/* Title row */}
          <div className="flex items-start gap-1 flex-wrap">
            <span className="font-semibold text-white text-sm min-w-0 break-words whitespace-normal flex-shrink basis-full sm:basis-auto sm:flex-1">
              {meal.name}
            </span>
            {/* Options row - wraps below title on narrow screens and stays right-aligned */}
            <div className="ml-auto flex w-full sm:w-auto items-center justify-end gap-1 shrink-0 flex-wrap">
              {maxIngredientCounter !== null && maxIngredientCounter !== undefined && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 font-bold ${maxIngredientCounter >= 3 ? 'bg-red-500/50 text-red-100' :
                    maxIngredientCounter >= 1 ? 'bg-amber-400/30 text-amber-100' :
                      'bg-white/25 text-white/80'
                  }`}
                  title={earliestCounterDate ? `${computeCounterHours(earliestCounterDate)}h écoulées` : undefined}
                >
                  <Timer className="h-3 w-3" /> {maxIngredientCounter}j
                </span>
              )}
              {meal.grams && (
                <span className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                  <Weight className="h-3 w-3" />{meal.grams}
                </span>
              )}
              {(() => {
                const displayCal = getDisplayedCalories(meal);
                const isComputed = computeIngredientCalories(meal.ingredients, isAvailableCb) !== null;
                return displayCal ? (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 ${isComputed ? 'bg-orange-500/50 text-white font-bold' : 'text-white/70 bg-white/20'
                    }`}>
                    <Flame className="h-3 w-3" />{displayCal}
                  </span>
                ) : null;
              })()}
              {(() => {
                const displayPro = getDisplayedProtein(meal);
                const isComputedPro = computeIngredientProtein(meal.ingredients, isAvailableCb) !== null;
                return displayPro && displayPro !== 0 ? (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 font-semibold ${isComputedPro ? 'bg-blue-600/60 text-white' : 'text-white/70 bg-blue-500/30'
                    }`}>
                    🍗 {displayPro}
                  </span>
                ) : null;
              })()}
              {hasCuisson && (
                <span className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                  <Thermometer className="h-3 w-3" />
                  {ovenTemp ? `${ovenTemp}°C` : ''}{ovenTemp && ovenMinutes ? ' · ' : ''}{ovenMinutes ? `${ovenMinutes}min` : ''}
                </span>
              )}
              {onToggleFavorite && (
                <button
                  onClick={onToggleFavorite}
                  className={`h-7 w-7 shrink-0 flex items-center justify-center rounded-full transition-all hover:bg-white/20 ${meal.is_favorite ? 'text-yellow-300' : 'text-white/40 hover:text-yellow-200'}`}
                  title={meal.is_favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
                >
                  <Star className={`h-3.5 w-3.5 ${meal.is_favorite ? 'fill-yellow-300' : ''}`} />
                </button>
              )}
              <Button size="icon" variant="ghost" onClick={onMoveToPossible} className="h-8 w-8 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
                <ArrowRight className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { setEditValue(meal.name); setEditing("name"); }}>
                    <Pencil className="mr-2 h-4 w-4" /> Renommer
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }}>
                    <Flame className="mr-2 h-4 w-4" /> Calories
                  </DropdownMenuItem>
                  {onUpdateProtein && (
                    <DropdownMenuItem onClick={() => { setEditValue(meal.protein || ""); setEditing("protein"); }}>
                      <Weight className="mr-2 h-4 w-4" /> Protéines
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }}>
                    <Weight className="mr-2 h-4 w-4" /> Grammes
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openIngredients}>
                    <List className="mr-2 h-4 w-4" /> Ingrédients
                  </DropdownMenuItem>
                  {onUpdateOvenTemp && (
                    <DropdownMenuItem onClick={() => { setEditValue(ovenTemp || ""); setEditing("oven_temp"); }}>
                      <Thermometer className="mr-2 h-4 w-4" /> Température (°C)
                    </DropdownMenuItem>
                  )}
                  {onUpdateOvenMinutes && (
                    <DropdownMenuItem onClick={() => { setEditValue(ovenMinutes || ""); setEditing("oven_minutes"); }}>
                      <Thermometer className="mr-2 h-4 w-4" /> Durée (min)
                    </DropdownMenuItem>
                  )}
                  {!hideDelete && (
                    <DropdownMenuItem onClick={onDelete} className="text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Supprimer
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Expiration + Ingredients display */}
          {(expirationLabel || meal.ingredients) && (
            <div className="flex items-center gap-2 mt-1">
              {expirationLabel && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 font-semibold ${expirationIsToday
                    ? 'text-red-200 bg-red-500/30 ring-2 ring-red-500'
                    : expirationDate && new Date(expirationDate) < new Date(new Date().toDateString())
                      ? 'text-red-200 bg-red-500/30'
                      : 'text-white/70 bg-white/20'
                  }`}>
                  📅 {expirationLabel}
                </span>
              )}
              {meal.ingredients && (
                <p className="text-[11px] text-white/65 leading-tight flex-1 flex flex-wrap gap-x-1">
                  {renderIngredientDisplay(meal.ingredients, expiredIngredientNames, missingIngredientNames, counterIngredientNames, expiringSoonIngredientNames, stockMap)}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}), (prevProps, nextProps) => {
  return prevProps.meal.id === nextProps.meal.id &&
    prevProps.meal.name === nextProps.meal.name &&
    prevProps.meal.calories === nextProps.meal.calories &&
    prevProps.meal.grams === nextProps.meal.grams &&
    prevProps.meal.ingredients === nextProps.meal.ingredients &&
    prevProps.meal.oven_temp === nextProps.meal.oven_temp &&
    prevProps.meal.oven_minutes === nextProps.meal.oven_minutes &&
    prevProps.meal.is_favorite === nextProps.meal.is_favorite &&
    prevProps.isHighlighted === nextProps.isHighlighted &&
    prevProps.hideDelete === nextProps.hideDelete &&
    prevProps.expirationLabel === nextProps.expirationLabel &&
    prevProps.expirationDate === nextProps.expirationDate &&
    prevProps.expirationIsToday === nextProps.expirationIsToday &&
    prevProps.expiringIngredientName === nextProps.expiringIngredientName &&
    prevProps.maxIngredientCounter === nextProps.maxIngredientCounter &&
    (prevProps.expiredIngredientNames?.size ?? 0) === (nextProps.expiredIngredientNames?.size ?? 0) &&
    (prevProps.expiringSoonIngredientNames?.size ?? 0) === (nextProps.expiringSoonIngredientNames?.size ?? 0) &&
    (prevProps.missingIngredientNames?.size ?? 0) === (nextProps.missingIngredientNames?.size ?? 0) &&
    (prevProps.counterIngredientNames?.size ?? 0) === (nextProps.counterIngredientNames?.size ?? 0);
});

/** Render ingredient display with OR groups, expired/missing highlighting */
function renderIngredientDisplay(
  ingredients: string,
  expiredIngredientNames?: Set<string>,
  missingIngredientNames?: Set<string>,
  counterIngredientNames?: Set<string>,
  expiringSoonIngredientNames?: Set<string>,
  stockMap?: Map<string, StockInfo>,
) {
  // Split raw ingredients first, filter out negative-metric groups, then clean for display
  const rawGroups = ingredients.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
  const filteredRaw = rawGroups.filter(g => !g.split(/\|/).some(alt => hasNegativeMetric(alt.trim())));
  const cleaned = cleanIngredientText(filteredRaw.join(", "));
  const groups = cleaned.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
  const elements: React.ReactNode[] = [];

  groups.forEach((group, gi) => {
    const alts = group.split(/\|/).map(s => s.trim()).filter(Boolean);
    const groupIsOptional = alts[0]?.startsWith("?");
    alts.forEach((alt, ai) => {
      const displayAlt = alt.startsWith("?") ? alt.slice(1).trim() : alt;
      const parsed = parseIngredientLineDisplay(displayAlt);
      const normalizedName = normalizeKey(parsed.name);
      const isExpired = expiredIngredientNames?.has(normalizedName);
      const isSoon = expiringSoonIngredientNames?.has(normalizedName);
      const isMissing = missingIngredientNames?.has(normalizedName);
      const hasCounter = counterIngredientNames?.has(normalizedName);

      const stockKey = stockMap ? findStockKey(stockMap, parsed.name) : null;
      const stock = stockKey ? stockMap?.get(stockKey) : undefined;
      const isUnavailableAlt = !!stockMap && (!stock || (!stock.infinite && stock.grams <= 0 && stock.count <= 0));

      const cls = isExpired ? 'bg-red-500/40 text-red-100 px-0.5 rounded font-semibold'
        : isSoon ? 'ring-1 ring-red-500/60 font-semibold px-0.5 rounded'
          : hasCounter ? 'underline decoration-2 underline-offset-2 decoration-white/60 font-semibold'
            : (isMissing || isUnavailableAlt) ? 'bg-white/20 text-white/40 px-0.5 rounded line-through'
              : groupIsOptional ? 'italic text-white/40'
                : '';

      const key = `${gi}-${ai}`;
      if (ai > 0) {
        elements.push(
          <span key={`or-${key}`} className="text-yellow-300/70 text-[9px] font-bold">ou</span>
        );
      }
      elements.push(
        <span key={key} className={cls}>
          {groupIsOptional && ai === 0 ? '?' : ''}{displayAlt}{ai === alts.length - 1 && gi < groups.length - 1 ? ' •' : ''}
        </span>
      );
    });
  });

  return elements;
}
