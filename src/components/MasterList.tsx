import { useState } from "react";
import { Flame, Star, List, ArrowUpDown, Search, ArrowUp, ArrowDown, Drumstick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MealList } from "@/components/MealList";
import { MealCard } from "@/components/MealCard";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/components/FoodItems";
import { buildStockMap, getMissingIngredients } from "@/lib/stockUtils";
import { normalizeForMatch } from "@/lib/ingredientUtils";

export type MasterSortMode = "manual" | "calories" | "protein" | "favorites" | "ingredients";

interface MasterListProps {
  category: { value: string; label: string; emoji: string };
  meals: Meal[];
  foodItems: FoodItem[];
  sortMode: MasterSortMode;
  sortAsc: boolean;
  onToggleSort: () => void;
  onToggleSortDirection: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onMoveToPossible: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onUpdateCalories: (id: string, cal: string | null) => void;
  onUpdateProtein: (id: string, prot: string | null) => void;
  onUpdateGrams: (id: string, g: string | null) => void;
  onUpdateIngredients: (id: string, ing: string | null) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateOvenTemp: (id: string, t: string | null) => void;
  onUpdateOvenMinutes: (id: string, m: string | null) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function MasterList({ category, meals, foodItems, sortMode, sortAsc, onToggleSort, onToggleSortDirection, collapsed, onToggleCollapse, onMoveToPossible, onRename, onDelete, onUpdateCalories, onUpdateProtein, onUpdateGrams, onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes, onReorder }: MasterListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const stockMap = buildStockMap(foodItems);

  const SortIcon = sortMode === "calories" ? Flame : sortMode === "protein" ? Drumstick : sortMode === "favorites" ? Star : sortMode === "ingredients" ? List : ArrowUpDown;
  const sortLabel = sortMode === "calories" ? "Calories" : sortMode === "protein" ? "Protéines" : sortMode === "favorites" ? "Favoris" : sortMode === "ingredients" ? "Ingrédients" : "Manuel";
  const isNumericSort = sortMode === "calories" || sortMode === "protein";

  const filteredMeals = searchQuery.trim()
    ? meals.filter(m => {
        const q = normalizeForMatch(searchQuery);
        if (normalizeForMatch(m.name).includes(q)) return true;
        if (m.ingredients) {
          const groups = m.ingredients.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
          for (const group of groups) {
            const alts = group.split(/\|/).map(s => s.trim()).filter(Boolean);
            for (const alt of alts) {
              if (normalizeForMatch(alt).includes(q)) return true;
            }
          }
        }
        return false;
      })
    : meals;

  return (
    <MealList
      title={`Tous · ${category.label}`}
      emoji="📋"
      count={meals.length}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      headerActions={
        <>
          {!collapsed && (
            <div className="relative mr-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-6 w-24 sm:w-32 pl-6 text-[10px] rounded-xl"
              />
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-6 px-1.5">
            <SortIcon className={`h-3 w-3 ${sortMode === "favorites" ? "text-yellow-400 fill-yellow-400" : ""}`} />
            <span className="hidden sm:inline">{sortLabel}</span>
          </Button>
          {isNumericSort && (
            <Button size="sm" variant="ghost" onClick={onToggleSortDirection} className="h-6 w-6 p-0">
              {sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            </Button>
          )}
        </>
      }>

      {!collapsed &&
        <>
          {filteredMeals.length === 0 && <p className="text-muted-foreground text-sm text-center py-6 italic">{searchQuery ? "Aucun résultat" : "Aucun repas"}</p>}
          {filteredMeals.map((meal, index) => {
            const missingIngs = getMissingIngredients(meal, stockMap);
            return (
              <MealCard key={meal.id} meal={meal}
                onMoveToPossible={() => onMoveToPossible(meal.id)}
                onRename={(name) => onRename(meal.id, name)}
                onDelete={() => onDelete(meal.id)}
                onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)}
                onUpdateProtein={(prot) => onUpdateProtein(meal.id, prot)}
                onUpdateGrams={(g) => onUpdateGrams(meal.id, g)}
                onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
                onToggleFavorite={() => onToggleFavorite(meal.id)}
                onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)}
                onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
                missingIngredientNames={missingIngs.size > 0 ? missingIngs : undefined}
                onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "master"); setDragIndex(index); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragIndex !== null && dragIndex !== index) onReorder(dragIndex, index); setDragIndex(null); }} />
            );
          })}
        </>
      }
    </MealList>
  );
}
