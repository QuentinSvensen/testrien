import React, { useMemo, useState } from "react";
import { Plus, Dice5, ArrowUpDown, CalendarDays, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MealList } from "@/components/MealList";
import { PossibleMealCard } from "@/components/PossibleMealCard";
import type { PossibleMeal } from "@/hooks/useMeals";
import { computeIngredientCalories } from "@/lib/ingredientUtils";
import { buildStockMap, analyzeMealIngredients, getDisplayedPMCalories } from "@/lib/stockUtils";
import type { StockInfo } from "@/lib/stockUtils";
import type { FoodItem } from "@/components/FoodItems";

const MemoizedPossibleMealCard = React.memo(
  PossibleMealCard,
  (prevProps: any, nextProps: any) => {
    return (
      prevProps.pm === nextProps.pm &&
      prevProps.isHighlighted === nextProps.isHighlighted &&
      prevProps.stockMap === nextProps.stockMap &&
      prevProps.onReturnWithoutDeductionLabel === nextProps.onReturnWithoutDeductionLabel &&
      !!prevProps.onReturnToMaster === !!nextProps.onReturnToMaster &&
      !!prevProps.onReturnWithoutDeduction === !!nextProps.onReturnWithoutDeduction &&
      !!prevProps.onUpdateQuantity === !!nextProps.onUpdateQuantity &&
      (prevProps.expiredIngredientNames?.size ?? 0) === (nextProps.expiredIngredientNames?.size ?? 0) &&
      (prevProps.expiringSoonIngredientNames?.size ?? 0) === (nextProps.expiringSoonIngredientNames?.size ?? 0)
    );
  }
);

type SortMode = "manual" | "expiration" | "planning";

interface PossibleListProps {
  category: { value: string; label: string; emoji: string };
  items: PossibleMeal[];
  sortMode: SortMode;
  stockMap: Map<string, StockInfo>;
  onToggleSort: () => void;
  onRandomPick: () => void;
  onRemove: (id: string) => void;
  onReturnWithoutDeduction: (id: string) => void;
  onReturnToMaster: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onUpdateExpiration: (id: string, d: string | null) => void;
  onUpdatePlanning: (id: string, day: string | null, time: string | null) => void;
  onUpdateCounter: (id: string, d: string | null) => void;
  onUpdateCalories: (id: string, cal: string | null) => void;
  onUpdateGrams: (id: string, g: string | null, pmId?: string) => void;
  onUpdateIngredients: (id: string, ing: string | null) => void;
  onUpdatePossibleIngredients: (pmId: string, newIngredients: string | null) => void;
  onUpdateQuantity: (id: string, qty: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onExternalDrop: (mealId: string, source: string) => void;
  highlightedId: string | null;
  foodItems: FoodItem[];
  onAddDirectly: () => void;
  masterSourcePmIds: Set<string>;
  unParUnSourcePmIds: Set<string>;
}

export function PossibleList({ category, items, sortMode, onToggleSort, onRandomPick, onRemove, onReturnWithoutDeduction, onReturnToMaster, onDelete, onDuplicate, onUpdateExpiration, onUpdatePlanning, onUpdateCounter, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onUpdatePossibleIngredients, onUpdateQuantity, onReorder, onExternalDrop, highlightedId, foodItems, onAddDirectly, masterSourcePmIds, unParUnSourcePmIds }: PossibleListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const sortLabel = sortMode === "manual" ? "Manuel" : sortMode === "expiration" ? "Péremption" : "Planning";
  const SortIcon = sortMode === "expiration" ? CalendarDays : sortMode === "planning" ? CalendarClock : ArrowUpDown;

  const stockMap = useMemo(() => buildStockMap(foodItems), [foodItems]);

  const getCounterDays = (startDate: string | null, pm?: PossibleMeal): number | null => {
    if (!startDate) return null;
    // Freeze counter at the value it had when moved to possible (use created_at as reference)
    const refTime = pm?.created_at ? new Date(pm.created_at).getTime() : Date.now();
    return Math.floor((refTime - new Date(startDate).getTime()) / 86400000);
  };

  const getDisplayedCalories = (pm: PossibleMeal): number | null => {
    const ingredients = pm.ingredients_override ?? pm.meals?.ingredients;
    const ingCal = computeIngredientCalories(ingredients);
    if (ingCal !== null && Number.isFinite(ingCal)) return ingCal;

    const raw = pm.meals?.calories;
    if (!raw) return null;

    const match = raw.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;

    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const displayItems = useMemo(() => {
    if (sortMode !== "expiration") return items;

    return [...items].sort((a, b) => {
      const aCounter = getCounterDays(a.counter_start_date, a);
      const bCounter = getCounterDays(b.counter_start_date, b);
      // Only re-sort items with same non-null, non-zero counter
      if (aCounter === null || bCounter === null || aCounter !== bCounter) return 0;

      // Same counter (non-zero): sort by date first
      if (aCounter !== 0) {
        const aDate = a.expiration_date;
        const bDate = b.expiration_date;
        if (aDate && bDate) {
          const dateCmp = aDate.localeCompare(bDate);
          if (dateCmp !== 0) return dateCmp;
        }
        if (aDate && !bDate) return -1;
        if (!aDate && bDate) return 1;
      }

      // Same counter + same date: sort by calories ascending
      const aCal = getDisplayedCalories(a);
      const bCal = getDisplayedCalories(b);
      if (aCal !== null && bCal !== null && aCal !== bCal) return aCal - bCal;
      if (aCal !== null && bCal === null) return -1;
      if (aCal === null && bCal !== null) return 1;

      return (a.meals?.name ?? "").localeCompare(b.meals?.name ?? "");
    });
  }, [items, sortMode]);
  return (
    <MealList title={`${category.label} possibles`} emoji={category.emoji} count={displayItems.length} onExternalDrop={onExternalDrop}
      headerActions={<>
        <Button size="sm" variant="ghost" onClick={onAddDirectly} className="h-6 w-6 p-0" title="Ajouter"><Plus className="h-3 w-3" /></Button>
        <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-6 px-1.5"><SortIcon className="h-3 w-3" /><span>{sortLabel}</span></Button>
        <Button size="sm" variant="ghost" onClick={onRandomPick} className="h-6 w-6 p-0"><Dice5 className="h-3.5 w-3.5" /></Button>
      </>}>
      {displayItems.length === 0 && <p className="text-muted-foreground text-sm text-center py-6 italic">Glisse des repas ici →</p>}
      {displayItems.map((pm, index) => {
        const meal = pm.meals;
        if (!meal) return null;
        const currentIngredients = pm.ingredients_override ?? meal.ingredients;
        const mealForAnalysis = { ...meal, ingredients: currentIngredients };
        const analysis = analyzeMealIngredients(mealForAnalysis, foodItems);
        const expiredIngs = analysis.expiredIngredientNames;
        const soonIngs = analysis.expiringSoonIngredientNames;

        return (
          <MemoizedPossibleMealCard key={pm.id} pm={pm} stockMap={stockMap}
            expiredIngredientNames={expiredIngs}
            expiringSoonIngredientNames={soonIngs}
            onRemove={() => onRemove(pm.id)}
            onReturnWithoutDeduction={masterSourcePmIds.has(pm.id) ? undefined : () => onReturnWithoutDeduction(pm.id)}
            onReturnWithoutDeductionLabel={unParUnSourcePmIds.has(pm.id) ? "Revenir dans Un par un" : undefined}
            onReturnToMaster={masterSourcePmIds.has(pm.id) ? () => onReturnToMaster(pm.id) : undefined}
            onDelete={() => onDelete(pm.id)}
            onDuplicate={() => onDuplicate(pm.id)}
            onUpdateExpiration={(d) => onUpdateExpiration(pm.id, d)}
            onUpdatePlanning={(day, time) => onUpdatePlanning(pm.id, day, time)}
            onUpdateCounter={(d) => onUpdateCounter(pm.id, d)}
            onUpdateCalories={(cal) => onUpdateCalories(pm.meal_id, cal)}
            onUpdateGrams={(g) => onUpdateGrams(pm.meal_id, g, pm.id)}
            onUpdateIngredients={(ing) => onUpdateIngredients(pm.meal_id, ing)}
            onUpdatePossibleIngredients={(newIng) => onUpdatePossibleIngredients(pm.id, newIng)}
            onUpdateQuantity={unParUnSourcePmIds.has(pm.id) ? (qty) => onUpdateQuantity(pm.id, qty) : undefined}
            onDragStart={(e) => { e.dataTransfer.setData("mealId", pm.meal_id); e.dataTransfer.setData("pmId", pm.id); e.dataTransfer.setData("source", "possible"); setDragIndex(index); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragIndex !== null && dragIndex !== index) {
                onReorder(dragIndex, index);
              }
              setDragIndex(null);
            }}
            isHighlighted={highlightedId === pm.id} />
        );
      })}
    </MealList>
  );
}
