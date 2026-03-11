import { useState, useRef, forwardRef } from "react";
import { ArrowRight, MoreVertical, Pencil, Trash2, Flame, Weight, List, Star, Thermometer, Hash, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Meal } from "@/hooks/useMeals";
import {
  type IngLine, parseIngredientLineDisplay, formatQtyDisplay,
  parseIngredientsToLines, serializeIngredients, normalizeKey,
  computeIngredientCalories,
} from "@/lib/ingredientUtils";

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
}

// Ingredient parsing utilities imported from @/lib/ingredientUtils

export const MealCard = forwardRef<HTMLDivElement, MealCardProps>(function MealCard({ meal, onMoveToPossible, onRename, onDelete, onUpdateCalories, onUpdateProtein, onUpdateGrams, onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes, onDragStart, onDragOver, onDrop, isHighlighted, hideDelete, expirationLabel, expirationDate, expirationIsToday, expiringIngredientName, expiredIngredientNames, maxIngredientCounter, missingIngredientNames, counterIngredientNames }, _ref) {
  const parseIngredientLine = parseIngredientLineDisplay;
  const formatQty = formatQtyDisplay;
  const [editing, setEditing] = useState<"name" | "calories" | "protein" | "grams" | "oven_temp" | "oven_minutes" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingIngredients, setEditingIngredients] = useState(false);
  const [ingLines, setIngLines] = useState<IngLine[]>([]);
  const qtyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const countRefs = useRef<(HTMLInputElement | null)[]>([]);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);

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

  const updateLine = (idx: number, field: "qty" | "count" | "name" | "cal", value: string) => {
    setIngLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "name" && idx === next.length - 1 && value.trim()) {
        next.push({ qty: "", count: "", name: "", cal: "", isOr: false, isOptional: false });
      }
      return next;
    });
  };

  const toggleOr = (idx: number) => {
    if (idx === 0) return;
    setIngLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], isOr: !next[idx].isOr };
      return next;
    });
  };

  const handleIngKeyDown = (idx: number, field: "qty" | "count" | "name", e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (field === "qty") {
        countRefs.current[idx]?.focus();
      } else if (field === "count") {
        nameRefs.current[idx]?.focus();
      } else if (idx < ingLines.length - 1) {
        qtyRefs.current[idx + 1]?.focus();
      } else if (ingLines[idx].name.trim()) {
        setTimeout(() => qtyRefs.current[idx + 1]?.focus(), 0);
      } else {
        commitIngredients();
      }
    }
    if (e.key === "Escape") commitIngredients();
  };

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
      style={{ backgroundColor: meal.color }}
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
        <div
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) commitIngredients();
          }}
          className="flex flex-col gap-1"
        >
          <div className="grid grid-cols-[1.5rem_1rem_3.5rem_2.5rem_1fr_3rem] gap-1 mb-0.5">
            <span className="text-[9px] text-white/50 text-center">Ou</span>
            <span className="text-[9px] text-white/50 text-center">?</span>
            <span className="text-[9px] text-white/50 text-center">Grammes</span>
            <span className="text-[9px] text-white/50 text-center">Qté</span>
            <span className="text-[9px] text-white/50">Nom</span>
            <span className="text-[9px] text-white/50 text-center">Cal</span>
          </div>
          {ingLines.map((line, idx) => (
            <div key={idx} className="grid grid-cols-[1.5rem_1rem_3.5rem_2.5rem_1fr_3rem] gap-1">
              <button
                type="button"
                onClick={() => toggleOr(idx)}
                className={`h-7 flex items-center justify-center rounded text-[9px] font-bold transition-all ${
                  idx === 0
                    ? 'text-white/15 cursor-default'
                    : line.isOr
                      ? 'bg-yellow-400/30 text-yellow-200 border border-yellow-400/50'
                      : 'text-white/30 hover:text-white/60 hover:bg-white/10'
                }`}
                disabled={idx === 0}
                title={idx === 0 ? "" : line.isOr ? "Cet ingrédient est un OU du précédent" : "Marquer comme alternative (OU)"}
              >
                {line.isOr ? "ou" : idx > 0 ? "+" : ""}
              </button>
              <button
                type="button"
                onClick={() => setIngLines(prev => {
                  const next = [...prev];
                  next[idx] = { ...next[idx], isOptional: !next[idx].isOptional };
                  return next;
                })}
                className={`h-7 flex items-center justify-center rounded text-[9px] font-bold transition-all ${
                  line.isOptional
                    ? 'bg-purple-400/30 text-purple-200 border border-purple-400/50'
                    : 'text-white/20 hover:text-white/50 hover:bg-white/10'
                }`}
                title="Ingrédient optionnel"
              >
                ?
              </button>
              <Input
                ref={el => { qtyRefs.current[idx] = el; }}
                autoFocus={idx === 0}
                placeholder="g"
                inputMode="decimal"
                value={line.qty}
                onChange={e => updateLine(idx, "qty", e.target.value)}
                onKeyDown={e => handleIngKeyDown(idx, "qty", e)}
                className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-1.5"
              />
              <Input
                ref={el => { countRefs.current[idx] = el; }}
                placeholder="#"
                inputMode="numeric"
                value={line.count}
                onChange={e => updateLine(idx, "count", e.target.value)}
                onKeyDown={e => handleIngKeyDown(idx, "count", e)}
                className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-1"
              />
              <Input
                ref={el => { nameRefs.current[idx] = el; }}
                placeholder={`Ingrédient ${idx + 1}`}
                value={line.name}
                onChange={e => updateLine(idx, "name", e.target.value)}
                onKeyDown={e => handleIngKeyDown(idx, "name", e)}
                className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-2"
              />
              <Input
                placeholder="cal"
                inputMode="decimal"
                value={line.cal}
                onChange={e => updateLine(idx, "cal", e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") commitIngredients(); if (e.key === "Escape") commitIngredients(); }}
                className="h-7 border-white/30 bg-white/20 text-white placeholder:text-white/40 text-xs px-1"
              />
            </div>
          ))}
          <button onClick={commitIngredients} className="text-[10px] text-white/60 hover:text-white text-left mt-0.5">✓ Valider</button>
        </div>
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
                <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 font-bold ${
                  maxIngredientCounter >= 3 ? 'bg-red-500/50 text-red-100' :
                  maxIngredientCounter >= 1 ? 'bg-amber-400/30 text-amber-100' :
                  'bg-white/25 text-white/80'
                }`}>
                  ⏱ {maxIngredientCounter}j
                </span>
              )}
              {meal.grams && (
                <span className="text-xs text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                  <Weight className="h-3 w-3" />{meal.grams}
                </span>
              )}
              {(() => {
                const ingCal = computeIngredientCalories(meal.ingredients);
                const displayCal = ingCal !== null ? String(ingCal) : meal.calories;
                const isComputed = ingCal !== null;
                return displayCal ? (
                  <span className={`text-xs text-white/70 px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 ${
                    isComputed ? 'bg-orange-500/50 font-bold' : 'bg-white/20'
                  }`}>
                    <Flame className="h-3 w-3" />{displayCal}
                  </span>
                ) : null;
              })()}
              {meal.protein && (
                <span className="text-xs text-white/70 bg-blue-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 font-semibold">
                  🍗 {meal.protein}
                </span>
              )}
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
                <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 font-semibold ${
                  expirationIsToday
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
                  {renderIngredientDisplay(meal.ingredients, expiredIngredientNames, missingIngredientNames, counterIngredientNames)}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});

/** Render ingredient display with OR groups, expired/missing highlighting */
function renderIngredientDisplay(
  ingredients: string,
  expiredIngredientNames?: Set<string>,
  missingIngredientNames?: Set<string>,
  counterIngredientNames?: Set<string>,
) {
  const groups = ingredients.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
  const elements: React.ReactNode[] = [];
  
  groups.forEach((group, gi) => {
    const alts = group.split(/\|/).map(s => s.trim()).filter(Boolean);
    const groupIsOptional = alts[0]?.startsWith("?");
    alts.forEach((alt, ai) => {
      const cleanAlt = alt.startsWith("?") ? alt.slice(1).trim() : alt;
      // Strip {cal} suffix from display
      const displayAlt = cleanAlt.replace(/\{\d+(?:[.,]\d+)?\}\s*$/, "").trim();
      const parsed = parseIngredientLineDisplay(cleanAlt);
      const normalizedName = normalizeKey(parsed.name);
      const isExpired = expiredIngredientNames?.has(normalizedName);
      const isMissing = missingIngredientNames?.has(normalizedName);
      const hasCounter = counterIngredientNames?.has(normalizedName);
      const cls = isExpired ? 'bg-red-500/40 text-red-100 px-0.5 rounded font-semibold'
        : hasCounter ? 'underline decoration-2 underline-offset-2 decoration-white/60 font-semibold'
        : isMissing ? 'bg-white/20 text-white/40 px-0.5 rounded line-through'
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
