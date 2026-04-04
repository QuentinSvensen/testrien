/**
 * FoodItems — Gestion complète des aliments en stock.
 *
 * Ce fichier contient :
 * 1. Types et interfaces (StorageType, FoodType, FoodItem)
 * 2. Hook useFoodItems() — CRUD complet sur les aliments (ajout, modification,
 *    suppression, duplication, réordonnancement) via la base de données
 * 3. FoodItemCard — Carte individuelle d'aliment avec édition inline de :
 *    nom, grammage (avec reste partiel), calories, protéines, quantité,
 *    péremption, compteur, type (viande/féculent), indivisible, is_meal
 * 4. FoodItems — Composant principal qui organise les aliments par section
 *    de stockage (Frigo, Placard sec, Surgelés, Extras, Toujours présent)
 *    avec formulaire d'ajout, tri, drag & drop, et recherche
 *
 * parseStoredGrams() / encodeStoredGramsFR() : gère le format "unité|reste"
 *   pour les aliments entamés (ex: "500|120" = 500g par unité, 120g restants)
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { z } from "zod";
import { Plus, Copy, Trash2, Timer, Flame, Weight, Calendar, ArrowUpDown, CalendarDays, Infinity as InfinityIcon, UtensilsCrossed, Refrigerator, Package, Snowflake, Hash, ChevronDown, ChevronRight, Minus, Search, Wheat, Drumstick, Lock, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { colorFromName, computeCounterDays, computeCounterHours, isExpiredDate } from "@/lib/ingredientUtils";
import { usePreferences } from "@/hooks/usePreferences";
import { useSortModes, FoodSortMode } from "@/hooks/useSortModes";
import { getSortedFoodItems } from "@/lib/foodSortUtils";
import { useMeals } from "@/hooks/useMeals";
import { useFoodLibrary, type FoodLibraryEntry } from "@/hooks/useFoodLibrary";
import { BarcodeScanner } from "./BarcodeScanner";

export { colorFromName };

// ─── Types ──────────────────────────────────────────────────────────────────
// Source unique de vérité pour les types : @/hooks/useFoodItems
export type { StorageType, FoodType, FoodItem } from "@/hooks/useFoodItems";
import type { StorageType, FoodType, FoodItem } from "@/hooks/useFoodItems";

// ─── Colors ─────────────────────────────────────────────────────────────────
// colorFromName est importé depuis ingredientUtils (→ foodColors) et ré-exporté ci-dessus

/** Formate un nombre pour l'affichage avec virgule décimale (notation FR) */
function formatNumericFR(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return String(Math.trunc(rounded));
  return String(rounded).replace(/\.0$/, "").replace(".", ",");
}

function parseStoredGrams(raw: string | null | undefined): { unit: number | null; remainder: number | null } {
  if (!raw) return { unit: null, remainder: null };
  const [base, partial] = raw.split("|");
  const parse = (v?: string) => {
    if (!v) return null;
    const normalized = v.replace(",", ".");
    const m = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const num = parseFloat(m[0]);
    return isNaN(num) ? null : num;
  };
  const unit = parse(base);
  const remainder = parse(partial);
  if (unit === null) return { unit: null, remainder: null };
  if (remainder === null || remainder <= 0 || remainder >= unit) return { unit, remainder: null };
  return { unit, remainder };
}

function encodeStoredGramsFR(unit: number, remainder: number | null): string {
  const unitText = formatNumericFR(unit);
  if (!remainder || remainder <= 0 || remainder >= unit) return unitText;
  return `${unitText}|${formatNumericFR(remainder)}`;
}

// isExpiredDate est importé depuis @/lib/ingredientUtils

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useFoodItems() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["food_items"] });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        qc.invalidateQueries({ queryKey: ["food_items"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [qc]);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["food_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("food_items")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data as any[]).map(d => ({
        ...d,
        is_meal: d.is_meal ?? false,
        is_infinite: d.is_infinite ?? false,
        is_dry: d.is_dry ?? false,
        is_indivisible: d.is_indivisible ?? false,
        no_counter: d.no_counter ?? (!d.grams),
        storage_type: d.storage_type ?? (d.is_dry ? 'sec' : 'frigo'),
        quantity: d.quantity ?? null,
        food_type: d.food_type ?? null,
        protein: d.protein ?? null,
      })) as FoodItem[];
    },
    retry: 3,
    retryDelay: 500,
  });

  const addItem = useMutation({
    mutationFn: async ({ name, storage_type, quantity, grams, food_type, expiration_date, calories, protein, is_meal, no_counter }: {
      name: string;
      storage_type: StorageType;
      quantity?: number | null;
      grams?: string | null;
      food_type?: FoodType;
      expiration_date?: string | null;
      calories?: string | null;
      protein?: string | null;
      is_meal?: boolean;
      no_counter?: boolean;
    }) => {
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
      const { error } = await supabase
        .from("food_items")
        .insert({
          name,
          sort_order: maxOrder + 1,
          is_dry: storage_type === 'sec',
          storage_type,
          is_meal: is_meal ?? false,
          no_counter: no_counter ?? (storage_type === 'extras' ? true : !grams),
          ...(quantity ? { quantity } : {}),
          ...(grams ? { grams } : {}),
          ...(food_type ? { food_type } : {}),
          ...(expiration_date ? { expiration_date } : {}),
          ...(calories ? { calories } : {}),
          ...(protein ? { protein } : {}),
        } as any);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<FoodItem> & { id: string }) => {
      const { error } = await supabase
        .from("food_items")
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("food_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const duplicateItem = useMutation({
    mutationFn: async (id: string) => {
      const source = items.find(i => i.id === id);
      if (!source) return;
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
      const { data: inserted, error } = await supabase.from("food_items").insert({
        name: source.name,
        grams: source.grams,
        calories: source.calories,
        expiration_date: source.expiration_date,
        counter_start_date: source.counter_start_date,
        is_meal: source.is_meal,
        is_infinite: source.is_infinite,
        is_dry: source.is_dry,
        storage_type: source.storage_type,
        quantity: source.quantity,
        sort_order: maxOrder + 1,
      } as any).select().single();
      if (error) throw error;
      return { newId: inserted.id, sourceId: source.id };
    },
    onSuccess: (result) => {
      if (result) {
        const overrides = JSON.parse(sessionStorage.getItem('color_overrides') || '{}');
        overrides[result.newId] = result.sourceId;
        sessionStorage.setItem('color_overrides', JSON.stringify(overrides));
      }
      invalidate();
    },
  });

  const reorderItems = useMutation({
    mutationFn: async (ordered: { id: string; sort_order: number }[]) => {
      await Promise.all(ordered.map(({ id, sort_order }) =>
        supabase.from("food_items").update({ sort_order } as any).eq("id", id)
      ));
    },
    onSuccess: invalidate,
  });

  return { items, isLoading, addItem, updateItem, deleteItem, duplicateItem, reorderItems };
}

// ─── FoodItemCard ────────────────────────────────────────────────────────────

interface FoodItemCardProps {
  item: FoodItem;
  onUpdate: (updates: Partial<FoodItem>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  draggableEnabled?: boolean;
}

function FoodItemCard({ item, onUpdate, onDelete, onDuplicate, onDragStart, onDragOver, onDrop, draggableEnabled = true }: FoodItemCardProps) {
  const color = colorFromName(item.name);
  const [editing, setEditing] = useState<"name" | "grams" | "calories" | "protein" | "quantity" | "partial" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [calOpen, setCalOpen] = useState(false);

  const isFuture = item.counter_start_date ? new Date(item.counter_start_date) > new Date() : false;
  const counterDays = computeCounterDays(item.counter_start_date);
  const counterHours = computeCounterHours(item.counter_start_date);
  const formattedProgDate = isFuture && item.counter_start_date ? (() => {
    const s = format(parseISO(item.counter_start_date), "eeee d HH'h'", { locale: fr });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })() : null;
  const counterUrgent = counterDays !== null && counterDays >= 3;
  const expired = isExpiredDate(item.expiration_date);
  const expIsToday = item.expiration_date ? (() => {
    const d = new Date(item.expiration_date!);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  })() : false;
  const gramsData = parseStoredGrams(item.grams);
  const displayDefaultGrams = gramsData.unit !== null ? `${formatNumericFR(gramsData.unit)}g` : item.grams;
  const displayPartialGrams = gramsData.remainder !== null ? `${formatNumericFR(gramsData.remainder)}g` : null;
  const effectiveQty = item.quantity === 1 ? null : item.quantity;
  const canEditPartial = !item.is_infinite && gramsData.unit !== null && (effectiveQty ? effectiveQty > 1 : true);
  const showPartialLabel = gramsData.remainder !== null;

  const saveEdit = () => {
    const val = editValue.trim();
    if (editing === "name" && val) onUpdate({ name: val });
    if (editing === "grams") {
      const g = val || null;
      onUpdate({ grams: g, ...(!g ? { no_counter: true } : {}) });
    }
    if (editing === "calories") onUpdate({ calories: val || null });
    if (editing === "protein") onUpdate({ protein: val || null });
    if (editing === "quantity") onUpdate({ quantity: val ? parseInt(val) || null : null });
    if (editing === "partial" && gramsData.unit !== null) {
      if (!val) {
        onUpdate({ grams: formatNumericFR(gramsData.unit) });
      } else {
        const parsed = parseFloat(val.replace(",", "."));
        if (!isNaN(parsed) && parsed > 0) {
          if (parsed >= gramsData.unit) {
            onUpdate({ grams: formatNumericFR(gramsData.unit) });
          } else {
            onUpdate({ grams: encodeStoredGramsFR(gramsData.unit, parsed) });
          }
        }
      }
    }
    setEditing(null);
  };

  const startEdit = (field: "name" | "grams" | "calories" | "protein" | "quantity" | "partial") => {
    if (field === "quantity") {
      setEditValue(item.quantity ? String(item.quantity) : "");
    } else if (field === "grams") {
      setEditValue(gramsData.unit !== null ? formatNumericFR(gramsData.unit) : "");
    } else if (field === "calories") {
      setEditValue(item.calories ?? "");
    } else if (field === "protein") {
      setEditValue(item.protein ?? "");
    } else if (field === "partial") {
      setEditValue(gramsData.remainder !== null ? formatNumericFR(gramsData.remainder) : "");
    } else {
      setEditValue(item.name);
    }
    setEditing(field);
  };

  const selectedDate = item.expiration_date ? parseISO(item.expiration_date) : undefined;

  const handleGramsCycle = () => {
    if (item.is_infinite) {
      onUpdate({ is_infinite: false, grams: null });
    } else {
      startEdit("grams");
    }
  };

  const handleDecrementQuantity = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentQty = item.quantity ?? 1;
    const hasRemainder = gramsData.remainder !== null;

    if (hasRemainder) {
      if (currentQty <= 1) {
        onDelete();
      } else {
        // "Retire le reste": on finit l'unité en cours, donc -1 quantité et on reset le reste
        // On arrête aussi le compteur car l'unité ouverte est terminée.
        onUpdate({
          quantity: currentQty - 1,
          grams: gramsData.unit !== null ? formatNumericFR(gramsData.unit) : item.grams,
          counter_start_date: null
        });
      }
    } else {
      if (currentQty <= 1) {
        onDelete();
      } else {
        onUpdate({ quantity: currentQty - 1 });
      }
    }
  };

  return (
    <div
      draggable={draggableEnabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`flex flex-col rounded-2xl px-3 py-2.5 shadow-md transition-all hover:scale-[1.01] hover:shadow-lg select-none cursor-grab active:cursor-grabbing overflow-hidden ${expired ? 'ring-2 ring-red-500 shadow-red-500/30 shadow-lg' : ''} ${expIsToday ? 'ring-2 ring-red-500 shadow-red-500/30 shadow-lg' : ''}`}
      style={{ backgroundColor: color }}
    >
      {/* Ligne 1 : nom à gauche, les options passent à la ligne 2 si nécessaire */}
      <div className="flex flex-wrap items-start gap-1.5 min-w-0">
        {/* Gauche : nom + saisies de texte */}
        <div className="min-w-0 flex-shrink-0" style={{ maxWidth: '100%' }}>
          {editing === "name" ? (
            <Input
              autoFocus
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={e => e.key === "Enter" && saveEdit()}
              className="h-7 w-full border-white/30 bg-white/20 text-white placeholder:text-white/60 text-sm min-w-0"
            />
          ) : (
            <button
              onClick={() => startEdit("name")}
              className="font-semibold text-white text-sm text-left hover:underline decoration-white/40 min-w-0 break-words whitespace-normal"
            >
              {item.name}
            </button>
          )}
        </div>

        {/* Droite : tous les badges d'options - passent à la ligne suivante si le titre est trop long */}
        <div className="flex items-center gap-1 flex-wrap justify-end ml-auto min-w-0">
          {/* Badge de compteur */}
          {counterDays !== null && (
            <button
              onClick={() => onUpdate({ counter_start_date: null })}
              className={`text-[11px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5 border shrink-0 transition-all ${counterUrgent ? 'bg-red-600 text-white border-red-300 shadow-md animate-pulse' : 'bg-black/40 text-white border-white/30'}`}
              title={`Arrêter le compteur${counterHours !== null ? ` (${counterHours}h écoulées)` : ''}`}
            >
              <Timer className="h-2.5 w-2.5" />{counterDays}j
            </button>
          )}

          {/* Quantité */}
          {editing === "quantity" ? (
            <Input
              autoFocus
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={e => e.key === "Enter" && saveEdit()}
              placeholder="Ex: 3"
              inputMode="numeric"
              className="h-6 w-14 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5"
            />
          ) : item.quantity && item.quantity >= 1 ? (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={handleDecrementQuantity}
                className="h-5 w-5 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/40 text-white/80 hover:text-white transition-all"
                title="Retirer 1"
              >
                <Minus className="h-2.5 w-2.5" />
              </button>
              <button
                onClick={() => startEdit("quantity")}
                className="text-[10px] text-white/90 bg-white/25 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/35 font-bold"
                title="Quantité"
              >
                <Hash className="h-2.5 w-2.5" />{item.quantity}
              </button>
            </div>
          ) : null}

          {/* Grammes / Infini */}
          {item.is_infinite ? (
            <button
              onClick={handleGramsCycle}
              className="text-[10px] text-white/90 bg-white/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/40 shrink-0 font-bold"
              title="Cliquer pour désactiver ∞"
            >
              <InfinityIcon className="h-2.5 w-2.5" />∞
            </button>
          ) : editing === "grams" ? (
            <Input
              autoFocus
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={e => e.key === "Enter" && saveEdit()}
              placeholder="Ex: 500"
              className="h-6 w-20 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5"
            />
          ) : item.grams ? (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={handleGramsCycle}
                className="text-[10px] text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/30"
                title="Modifier les grammes"
              >
                <Weight className="h-2.5 w-2.5" />{displayDefaultGrams}
              </button>
              {/* Reste — en ligne à côté des grammes */}
              {canEditPartial && (
                editing === "partial" ? (
                  <Input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={e => e.key === "Enter" && saveEdit()}
                    placeholder="Reste"
                    inputMode="decimal"
                    className="h-6 w-16 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1"
                  />
                ) : showPartialLabel ? (
                  <button
                    onClick={() => startEdit("partial")}
                    className="text-[10px] text-white bg-yellow-500/40 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-yellow-500/50 font-semibold"
                    title="Modifier le reste de la dernière quantité"
                  >
                    →{displayPartialGrams}
                  </button>
                ) : (
                  <button
                    onClick={() => startEdit("partial")}
                    className="text-[10px] text-white/50 bg-white/10 hover:bg-white/20 px-1 py-0.5 rounded-full"
                    title="Indiquer un reste partiel"
                  >
                    ✎
                  </button>
                )
              )}
            </div>
          ) : null}

          {/* Calories */}
          {editing === "calories" ? (
            <Input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={e => e.key === "Enter" && saveEdit()} placeholder="Ex: 200 kcal" className="h-6 w-24 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5" />
          ) : item.calories ? (
            <button onClick={() => startEdit("calories")} className="text-[10px] text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-white/30 shrink-0">
              <Flame className="h-2.5 w-2.5" />{item.calories}
            </button>
          ) : null}

          {/* Protéines */}
          {editing === "protein" ? (
            <Input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={e => e.key === "Enter" && saveEdit()} placeholder="Ex: 25" inputMode="numeric" className="h-6 w-16 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5" />
          ) : item.protein ? (
            <button onClick={() => startEdit("protein")} className="text-[10px] text-white/70 bg-blue-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-blue-500/40 shrink-0 font-semibold">
              🍗 {Math.round(parseFloat(item.protein!.replace(',', '.')) || 0)}
            </button>
          ) : null}

          {/* Bascule Indivisible */}
          {item.grams && !item.is_infinite && (
            <button
              onClick={() => onUpdate({ is_indivisible: !item.is_indivisible })}
              className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${item.is_indivisible ? 'bg-orange-400/30 text-orange-200 border-orange-400/50 font-bold' : 'bg-white/10 text-white/50 border-white/20'}`}
              title={item.is_indivisible ? "Indivisible (cliquer pour désactiver)" : "Marquer comme indivisible (grammage entier obligatoire)"}
            >
              <Lock className="h-2.5 w-2.5" />{item.is_indivisible ? 'Indiv.' : ''}
            </button>
          )}

          {/* Bascule is_meal */}
          <button
            onClick={() => onUpdate({ is_meal: !item.is_meal })}
            className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${item.is_meal ? 'bg-white/30 text-white border-white/50 font-bold' : 'bg-white/10 text-white/50 border-white/20'}`}
            title={item.is_meal ? "Se mange seul (désactiver)" : "Marquer comme repas à part entière"}
          >
            <UtensilsCrossed className="h-2.5 w-2.5" />
          </button>

          {/* Bascule food_type : cycle null -> féculent -> viande -> null */}
          <button
            onClick={() => {
              const next = item.food_type === null ? 'feculent' : item.food_type === 'feculent' ? 'viande' : null;
              onUpdate({ food_type: next });
            }}
            className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${item.food_type === 'feculent' ? 'bg-amber-400/30 text-amber-200 border-amber-400/50 font-bold'
              : item.food_type === 'viande' ? 'bg-red-400/30 text-red-200 border-red-400/50 font-bold'
                : 'bg-white/10 text-white/50 border-white/20'
              }`}
            title={item.food_type === 'feculent' ? 'Féculent (cliquer: Viande)' : item.food_type === 'viande' ? 'Viande (cliquer: Aucun)' : 'Aucun type (cliquer: Féculent)'}
          >
            {item.food_type === 'viande' ? <Drumstick className="h-2.5 w-2.5" /> : <Wheat className="h-2.5 w-2.5" />}
            {item.food_type === 'feculent' ? 'Féc' : item.food_type === 'viande' ? 'Via' : ''}
          </button>

          <Button size="icon" variant="ghost" onClick={onDuplicate} className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/20" title="Dupliquer">
            <Copy className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete} className="h-6 w-6 shrink-0 text-white/70 hover:text-white hover:bg-white/20" title="Supprimer">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Ligne 2 : ajout rapide + péremption + compteur + reste */}
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {(!item.quantity || item.quantity < 1) && editing !== "quantity" && (
          <button onClick={() => startEdit("quantity")} className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Hash className="h-2.5 w-2.5" />+ quantité
          </button>
        )}
        {!item.grams && !item.is_infinite && editing !== "grams" && (
          <button onClick={handleGramsCycle} className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Weight className="h-2.5 w-2.5" />+ grammes
          </button>
        )}
        {!item.is_infinite && !item.grams && editing !== "grams" && (
          <button
            onClick={() => onUpdate({ is_infinite: true })}
            className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
            title="Disponible en quantité infinie"
          >
            <InfinityIcon className="h-2.5 w-2.5" />∞
          </button>
        )}
        {!item.calories && editing !== "calories" && (
          <button onClick={() => startEdit("calories")} className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            <Flame className="h-2.5 w-2.5" />+ calories
          </button>
        )}
        {!item.protein && editing !== "protein" && (
          <button onClick={() => startEdit("protein")} className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            🍗 + protéines
          </button>
        )}

        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button className={`h-5 min-w-[88px] border bg-white/10 text-white text-[10px] px-1.5 rounded-md flex items-center gap-0.5 hover:bg-white/20 transition-colors ${expIsToday ? 'border-red-500 ring-1 ring-red-500 text-red-200 font-bold' : expired ? 'border-red-500/60 bg-red-500/20 text-red-200 font-bold animate-pulse' : 'border-white/20'
              }`}>
              <Calendar className="h-2.5 w-2.5 shrink-0" />
              {item.expiration_date
                ? (expired ? '⚠️ ' : '') + format(parseISO(item.expiration_date), 'd MMM yy', { locale: fr })
                : <span className="text-white/40">Péremption</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarPicker
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                onUpdate({ expiration_date: date ? format(date, 'yyyy-MM-dd') : null });
                setCalOpen(false);
              }}
              initialFocus
            />
            {item.expiration_date && (
              <div className="p-2 border-t">
                <button onClick={() => { onUpdate({ expiration_date: null }); setCalOpen(false); }} className="text-xs text-muted-foreground hover:text-destructive w-full text-center">
                  Effacer la date
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Bascule du compteur */}
        <button
          onClick={() => onUpdate({ counter_start_date: item.counter_start_date ? null : new Date().toISOString() })}
          className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
          title={item.counter_start_date
            ? (isFuture ? formattedProgDate : `Arrêter compteur${counterHours !== null ? ` (${counterHours}h)` : ''}`)
            : 'Démarrer compteur'}
        >
          <Timer className="h-2.5 w-2.5" />
          {item.counter_start_date ? (isFuture ? 'Prog.' : 'Stop') : 'Compteur'}
        </button>

        {/* Bascule No-counter (logique de compteur automatique) */}
        {(() => {
          const isGrams = !!item.grams;
          const isInfinite = !!item.is_infinite;
          if (isInfinite) return null;

          const counterEffectivelyDisabled = item.no_counter;
          // For quantitative-only items, we "enable" (default is off). 
          // For grams items, we "disable" (default is on).
          const isHighlighted = isGrams ? counterEffectivelyDisabled : !counterEffectivelyDisabled;

          return (
            <button
              onClick={() => onUpdate({ no_counter: !item.no_counter })}
              className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${isHighlighted
                ? 'bg-cyan-400/30 text-cyan-200 border-cyan-400/50 font-bold'
                : 'bg-white/10 text-white/50 border-white/20'
                }`}
              title={isGrams
                ? (counterEffectivelyDisabled ? 'Compteur auto désactivé (cliquer pour activer)' : 'Désactiver le compteur automatique')
                : (counterEffectivelyDisabled ? 'Activer le compteur automatique' : 'Compteur auto activé (cliquer pour désactiver)')
              }
            >
              <Timer className="h-2.5 w-2.5" />
              {isGrams ? '⏱✗' : (counterEffectivelyDisabled ? '⏱' : '⏱✓')}
            </button>
          );
        })()}

      </div>
    </div>
  );
}

// ─── Validation schema ───────────────────────────────────────────────────────
const foodItemSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(100, "Nom trop long (100 car. max)"),
});

// ─── Main component ──────────────────────────────────────────────────────────

type SortMode = "manual" | "expiration";

const STORAGE_SECTIONS: { type: StorageType; label: string; emoji: React.ReactNode }[] = [
  { type: 'frigo', label: 'Frigo', emoji: <Refrigerator className="h-4 w-4 text-blue-400" /> },
  { type: 'sec', label: 'Placard sec', emoji: <Package className="h-4 w-4 text-amber-500" /> },
  { type: 'surgele', label: 'Surgelés', emoji: <Snowflake className="h-4 w-4 text-cyan-400" /> },
  { type: 'extras', label: 'Extras', emoji: <span className="text-base">✨</span> },
  { type: 'toujours', label: 'Toujours présent', emoji: <span className="text-base">📌</span> },
];

export function FoodItems() {
  const { items, isLoading: itemsLoading, addItem, updateItem, deleteItem, duplicateItem, reorderItems } = useFoodItems();
  const { meals = [] } = useMeals();
  const { searchLibrary, upsertEntry } = useFoodLibrary();
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const {
    foodSortModes, sortDirections, toggleFoodSort, toggleSortDirection, resetFoodSortToManual
  } = useSortModes({ enabled: true });

  const { getPreference, setPreference, isLoading: prefsLoading } = usePreferences();
  const isLoading = itemsLoading || prefsLoading;
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["food_items"] });

  const [newName, setNewName] = useState("");
  const [newQuantity, setNewQuantity] = useState("");
  const [newGrams, setNewGrams] = useState("");
  const [newCalories, setNewCalories] = useState("");
  const [newProtein, setNewProtein] = useState("");
  const [newFoodType, setNewFoodType] = useState<FoodType>(null);
  const [newExpiration, setNewExpiration] = useState<Date | undefined>(undefined);
  const [expCalOpen, setExpCalOpen] = useState(false);
  const [showStoragePrompt, setShowStoragePrompt] = useState(false);

  // Bibliothèque d'aliments — autocomplete
  const [suggestions, setSuggestions] = useState<FoodLibraryEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestedStorageType, setSuggestedStorageType] = useState<string | null>(null);
  const [suggestedIsMeal, setSuggestedIsMeal] = useState<boolean | null>(null);
  const [suggestedNoCounter, setSuggestedNoCounter] = useState<boolean | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Synchroniser les mutations du hook useFoodItems localement
  const [pendingName, setPendingName] = useState("");
  const [pendingQuantity, setPendingQuantity] = useState("");
  const [pendingGrams, setPendingGrams] = useState("");
  const [pendingCalories, setPendingCalories] = useState("");
  const [pendingProtein, setPendingProtein] = useState("");
  const [pendingFoodType, setPendingFoodType] = useState<FoodType>(null);
  const [pendingExpiration, setPendingExpiration] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Mise à jour des suggestions à chaque frappe
  const handleNameChange = useCallback((value: string) => {
    setNewName(value);
    if (value.trim().length >= 1) {
      const results = searchLibrary(value.trim());
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [searchLibrary]);

  // Auto-fill au clic sur une suggestion
  const handleSelectSuggestion = useCallback((entry: FoodLibraryEntry) => {
    setNewName(entry.name);
    setNewFoodType(entry.food_type);
    setSuggestedStorageType(entry.storage_type);
    setSuggestedIsMeal(entry.is_meal);
    setSuggestedNoCounter(entry.no_counter);
    setSuggestions([]);
    setShowSuggestions(false);
    // Focus le champ suivant (quantité) pour fluidité
    setTimeout(() => {
      const qtyInput = document.querySelector<HTMLInputElement>('input[placeholder*="Quantité"]');
      qtyInput?.focus();
    }, 50);
  }, []);

  const handleUpdate = useCallback((id: string, updates: Partial<FoodItem>) => {
    // 1. Mise à jour de l'aliment en stock
    updateItem.mutate({ id, ...updates });

    // 2. Synchronisation avec la bibliothèque (Mémoire globale)
    const item = items.find(i => i.id === id);
    if (item && (
      updates.is_meal !== undefined ||
      updates.no_counter !== undefined ||
      updates.food_type !== undefined ||
      updates.storage_type !== undefined
    )) {
      upsertEntry.mutate({
        name: item.name,
        food_type: updates.food_type !== undefined ? updates.food_type : item.food_type,
        storage_type: updates.storage_type !== undefined ? (updates.storage_type as any) : (item.storage_type as any),
        is_meal: updates.is_meal !== undefined ? updates.is_meal : item.is_meal,
        no_counter: updates.no_counter !== undefined ? updates.no_counter : item.no_counter
      });
    }
  }, [items, updateItem, upsertEntry]);

  // Fermer les suggestions quand on clique ailleurs
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
        nameInputRef.current && !nameInputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const getSortedItems = (storageType: StorageType): FoodItem[] => {
    const sectionItems = items.filter(i => i.storage_type === storageType);
    const mode = foodSortModes[storageType] || "manual";
    const asc = sortDirections[`food-${storageType}`] !== false; // default to true (ascending)

    return getSortedFoodItems(sectionItems, mode, asc, searchQuery);
  };

  const handleAdd = () => {
    const result = foodItemSchema.safeParse({ name: newName });
    if (!result.success) {
      toast({ title: "Données invalides", description: result.error.issues[0].message, variant: "destructive" });
      return;
    }
    setPendingName(result.data.name);
    setPendingQuantity(newQuantity);
    setPendingGrams(newGrams);
    setPendingCalories(newCalories);
    setPendingProtein(newProtein);
    setPendingFoodType(newFoodType);
    setPendingExpiration(newExpiration ? format(newExpiration, 'yyyy-MM-dd') : null);
    setShowStoragePrompt(true);
  };

  const confirmAdd = (storageType: StorageType) => {
    const qty = pendingQuantity ? parseInt(pendingQuantity) || null : null;
    const grams = pendingGrams.trim() || null;
    const calories = pendingCalories.trim() || null;
    const protein = pendingProtein.trim() || null;
    const finalNoCounter = suggestedNoCounter !== null ? suggestedNoCounter : (storageType === 'extras' ? true : !grams);
    const finalIsMeal = suggestedIsMeal !== null ? suggestedIsMeal : false;

    addItem.mutate({
      name: pendingName,
      storage_type: storageType,
      quantity: qty,
      grams,
      food_type: pendingFoodType,
      expiration_date: pendingExpiration,
      calories,
      protein,
      is_meal: finalIsMeal,
      no_counter: finalNoCounter
    }, {
      onSuccess: () => {
        // Sauvegarder dans la bibliothèque pour auto-complétion future
        upsertEntry.mutate({
          name: pendingName,
          food_type: pendingFoodType,
          is_meal: finalIsMeal,
          no_counter: finalNoCounter,
          storage_type: storageType,
        });
        setNewName(""); setNewQuantity(""); setNewGrams(""); setNewCalories(""); setNewProtein(""); setNewFoodType(null); setNewExpiration(undefined);
        setPendingName(""); setPendingQuantity(""); setPendingGrams(""); setPendingCalories(""); setPendingProtein(""); setPendingFoodType(null); setPendingExpiration(null);
        setSuggestedStorageType(null); setSuggestedIsMeal(null); setSuggestedNoCounter(null);
        setShowStoragePrompt(false); toast({ title: "Aliment ajouté 🥕", duration: 800 });
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        toast({ title: "Erreur lors de l'ajout", description: msg, variant: "destructive" });
      },
    });
  };

  const handleReorder = (storageType: StorageType, fromIndex: number, toIndex: number) => {
    const sectionItems = getSortedItems(storageType);
    const reordered = [...sectionItems];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    reorderItems.mutate(reordered.map((item, i) => ({ id: item.id, sort_order: i })));
    resetFoodSortToManual(storageType);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground animate-pulse">Chargement…</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Add form + search */}
      <div className="flex gap-2 mb-2">
        {/* Input Nom avec Autocomplete */}
        <div className="flex-1 relative">
          <Input
            ref={nameInputRef}
            placeholder="Nom de l'aliment (ex : Crème fraîche)"
            value={newName}
            onChange={e => handleNameChange(e.target.value)}
            onFocus={() => { if (newName.trim().length >= 1) { const r = searchLibrary(newName.trim()); setSuggestions(r); setShowSuggestions(true); } }}
            onKeyDown={e => {
              if (e.key === "Enter") {
                setShowSuggestions(false);
                handleAdd();
              }
              if (e.key === "Escape") setShowSuggestions(false);
            }}
            className="w-full rounded-xl"
            autoComplete="off"
          />
          {/* Dropdown de suggestions */}
          {showSuggestions && (
            <div
              ref={suggestionsRef}
              className="absolute z-[100] left-0 right-0 top-full mt-1 rounded-xl border border-white/20 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden"
            >
              <div className="max-h-64 overflow-y-auto custom-scrollbar">
                {suggestions.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-center text-muted-foreground italic">
                    Aucun résultat dans la bibliothèque
                  </div>
                ) : (
                  suggestions.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(entry); }}
                      className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-primary/10 transition-colors group border-b border-white/5 last:border-b-0"
                    >
                      <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate flex-1">
                        {entry.name}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {entry.food_type === 'feculent' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30 font-bold flex items-center gap-0.5">
                            <Wheat className="h-2.5 w-2.5" />Féc
                          </span>
                        )}
                        {entry.food_type === 'viande' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-400/30 font-bold flex items-center gap-0.5">
                            <Drumstick className="h-2.5 w-2.5" />Via
                          </span>
                        )}
                        {entry.is_meal && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/20 text-white/80 border border-white/30 font-bold flex items-center gap-0.5">
                            <UtensilsCrossed className="h-2.5 w-2.5" />
                          </span>
                        )}
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50 border border-white/15 flex items-center gap-0.5">
                          {entry.storage_type === 'frigo' && <Refrigerator className="h-2.5 w-2.5" />}
                          {entry.storage_type === 'sec' && <Package className="h-2.5 w-2.5" />}
                          {entry.storage_type === 'surgele' && <Snowflake className="h-2.5 w-2.5" />}
                          {entry.storage_type === 'extras' && '✨'}
                          {entry.storage_type === 'toujours' && '📌'}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <div className="relative shrink-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Rechercher…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-28 sm:w-36 rounded-xl pl-7 h-10"
          />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            onClick={() => setIsScannerOpen(true)}
            variant="outline"
            className="rounded-full w-10 h-10 p-0 border-primary/20 text-primary hover:bg-primary/10 overflow-hidden relative group"
            title="Scanner un code-barres"
          >
            <div className="absolute inset-0 bg-primary/5 group-hover:bg-primary/10 transition-colors" />
            <Scan className="h-4 w-4 relative z-10" />
          </Button>
          <Button onClick={handleAdd} disabled={!newName.trim()} className="rounded-full gap-1 shrink-0 h-10 px-4">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Ajouter</span>
          </Button>
        </div>
      </div>

      {isScannerOpen && (
        <BarcodeScanner
          onClose={() => setIsScannerOpen(false)}
          onScanSuccess={(data) => {
            setNewName(data.name);
            if (data.grams) setNewGrams(data.grams);
            if (data.calories) setNewCalories(data.calories);
            if (data.protein) setNewProtein(data.protein);
          }}
        />
      )}

      {/* Quantity + Grams + Expiration + Food type inputs */}
      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <Input
          placeholder="Quantité (ex : 3)"
          value={newQuantity}
          onChange={e => setNewQuantity(e.target.value)}
          inputMode="numeric"
          className="flex-1 rounded-xl h-8 text-sm min-w-[100px]"
        />
        <Input
          placeholder="Grammes (ex : 500)"
          value={newGrams}
          onChange={e => setNewGrams(e.target.value)}
          className="flex-1 rounded-xl h-8 text-sm min-w-[100px]"
        />
        <Input
          placeholder="Kcal"
          value={newCalories}
          onChange={e => setNewCalories(e.target.value)}
          className="w-16 rounded-xl h-8 text-sm text-center"
        />
        <Input
          placeholder="Prot"
          value={newProtein}
          onChange={e => setNewProtein(e.target.value)}
          className="w-16 rounded-xl h-8 text-sm text-center"
        />
        <Popover open={expCalOpen} onOpenChange={setExpCalOpen}>
          <PopoverTrigger asChild>
            <button className={`h-8 min-w-[120px] border rounded-xl text-sm px-2 flex items-center gap-1 transition-colors ${newExpiration ? 'bg-muted text-foreground border-border font-medium' : 'bg-muted/50 text-muted-foreground border-border'
              }`}>
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              {newExpiration ? format(newExpiration, 'd MMM yy', { locale: fr }) : 'Péremption'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarPicker
              mode="single"
              selected={newExpiration}
              onSelect={(date) => { setNewExpiration(date || undefined); setExpCalOpen(false); }}
              initialFocus
              className="p-3 pointer-events-auto"
            />
            {newExpiration && (
              <div className="p-2 border-t">
                <button onClick={() => { setNewExpiration(undefined); setExpCalOpen(false); }} className="text-xs text-muted-foreground hover:text-destructive w-full text-center">
                  Effacer la date
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => setNewFoodType(prev => prev === 'feculent' ? null : 'feculent')}
            className={`text-[10px] px-2 py-1 rounded-full flex items-center gap-0.5 border transition-all ${newFoodType === 'feculent' ? 'bg-amber-500/20 text-amber-300 border-amber-400/50 font-bold' : 'bg-muted text-muted-foreground border-border'
              }`}
          >
            <Wheat className="h-3 w-3" />Féc
          </button>
          <button
            onClick={() => setNewFoodType(prev => prev === 'viande' ? null : 'viande')}
            className={`text-[10px] px-2 py-1 rounded-full flex items-center gap-0.5 border transition-all ${newFoodType === 'viande' ? 'bg-red-500/20 text-red-300 border-red-400/50 font-bold' : 'bg-muted text-muted-foreground border-border'
              }`}
          >
            <Drumstick className="h-3 w-3" />Via
          </button>
        </div>
      </div>

      {/* Storage type prompt */}
      {showStoragePrompt && (
        <div className="mb-4 rounded-2xl bg-card border p-4 shadow-lg">
          <p className="text-sm font-semibold text-foreground mb-1">Où ranger « {pendingName} » ?</p>
          {(pendingQuantity || pendingGrams) && (
            <p className="text-xs text-muted-foreground mb-3">
              {pendingQuantity && `Quantité : ${pendingQuantity}`}
              {pendingQuantity && pendingGrams && ' • '}
              {pendingGrams && `Grammes : ${pendingGrams}`}
            </p>
          )}
          {suggestedStorageType && (
            <div className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
              💡 Suggestion :
              <span className="font-bold text-foreground flex items-center gap-1 ml-1">
                {suggestedStorageType === 'frigo' && <><Refrigerator className="h-3 w-3 text-blue-400" /> Frigo</>}
                {suggestedStorageType === 'sec' && <><Package className="h-3 w-3 text-amber-500" /> Sec</>}
                {suggestedStorageType === 'surgele' && <><Snowflake className="h-3 w-3 text-cyan-400" /> Surgelé</>}
                {!['frigo', 'sec', 'surgele'].includes(suggestedStorageType) && suggestedStorageType}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={() => confirmAdd('frigo')} variant="outline" className={`flex-1 gap-1.5 ${suggestedStorageType === 'frigo' ? 'ring-2 ring-primary/50 bg-primary/10' : ''}`}>
              <Refrigerator className="h-4 w-4 text-blue-400" /> Frigo
            </Button>
            <Button onClick={() => confirmAdd('sec')} variant="outline" className={`flex-1 gap-1.5 ${suggestedStorageType === 'sec' ? 'ring-2 ring-primary/50 bg-primary/10' : ''}`}>
              <Package className="h-4 w-4 text-amber-500" /> Sec
            </Button>
            <Button onClick={() => confirmAdd('surgele')} variant="outline" className={`flex-1 gap-1.5 ${suggestedStorageType === 'surgele' ? 'ring-2 ring-primary/50 bg-primary/10' : ''}`}>
              <Snowflake className="h-4 w-4 text-cyan-400" /> Surgelé
            </Button>
          </div>
          <button onClick={() => { setShowStoragePrompt(false); setSuggestedStorageType(null); setSuggestedIsMeal(null); setSuggestedNoCounter(null); }} className="text-xs text-muted-foreground mt-2 w-full text-center hover:text-foreground">
            Annuler
          </button>
        </div>
      )}

      {/* Sections: Frigo + Sec side by side on desktop — FULL WIDTH like meal cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-none">
        {STORAGE_SECTIONS.filter(s => s.type === 'frigo' || s.type === 'sec').map((section) => (
          <FoodSection
            key={section.type}
            emoji={section.emoji}
            title={section.label}
            storageType={section.type}
            items={getSortedItems(section.type)}
            onUpdate={handleUpdate}
            onDelete={(id) => deleteItem.mutate(id)}
            onDuplicate={(id) => duplicateItem.mutate(id)}
            sortMode={foodSortModes[section.type] || "manual"}
            onToggleSort={() => toggleFoodSort(section.type)}
            sortDirection={sortDirections[`food-${section.type}`] !== false}
            onToggleSortDirection={() => toggleSortDirection(`food-${section.type}`)}
            onReorder={(from, to) => handleReorder(section.type, from, to)}
            dragIndex={dragIndex}
            setDragIndex={setDragIndex}
            allItems={items}
            onChangeStorage={(id, st) => handleUpdate(id, { storage_type: st, is_dry: st === 'sec' })}
          />
        ))}
      </div>
      <div className="mt-4 flex justify-center">
        <div className="flex flex-col gap-4 w-full max-w-3xl">
          {STORAGE_SECTIONS.filter(s => s.type === 'surgele' || s.type === 'extras' || s.type === 'toujours').map((section) => (
            <FoodSection
              key={section.type}
              emoji={section.emoji}
              title={section.label}
              storageType={section.type}
              items={getSortedItems(section.type)}
              onUpdate={handleUpdate}
              onDelete={(id) => deleteItem.mutate(id)}
              onDuplicate={(id) => duplicateItem.mutate(id)}
              sortMode={foodSortModes[section.type] || "manual"}
              onToggleSort={() => toggleFoodSort(section.type)}
              sortDirection={sortDirections[`food-${section.type}`] !== false}
              onToggleSortDirection={() => toggleSortDirection(`food-${section.type}`)}
              onReorder={(from, to) => handleReorder(section.type, from, to)}
              dragIndex={dragIndex}
              setDragIndex={setDragIndex}
              allItems={items}
              onChangeStorage={(id, st) => handleUpdate(id, { storage_type: st, is_dry: st === 'sec' })}
            />
          ))}
        </div>
      </div>


    </div>
  );
}

// ─── FoodSection ─────────────────────────────────────────────────────────────

interface FoodSectionProps {
  emoji: React.ReactNode;
  title: string;
  storageType: StorageType;
  items: FoodItem[];
  onUpdate: (id: string, updates: Partial<FoodItem>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  sortMode: FoodSortMode;
  onToggleSort: () => void;
  sortDirection: boolean;
  onToggleSortDirection: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  dragIndex: number | null;
  setDragIndex: (i: number | null) => void;
  allItems: FoodItem[];
  onChangeStorage: (id: string, storageType: StorageType) => void;
}

function FoodSection({ emoji, title, storageType, items, onUpdate, onDelete, onDuplicate, sortMode, onToggleSort, sortDirection, onToggleSortDirection, onReorder, dragIndex, setDragIndex, allItems, onChangeStorage }: FoodSectionProps) {
  const SortIcon = sortMode === "expiration" ? CalendarDays : sortMode === "name" ? ArrowUpDown : sortMode === "calories" ? Flame : sortMode === "protein" ? UtensilsCrossed : ArrowUpDown;
  const sortLabel = sortMode === "expiration" ? "Péremption" : sortMode === "name" ? "Nom" : sortMode === "calories" ? "Calories" : sortMode === "protein" ? "Protéines" : "Manuel";
  const [sectionDragOver, setSectionDragOver] = useState(false);
  const [collapsed, setCollapsed] = useState(storageType === 'toujours' || storageType === 'extras');
  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  // Touch drag & drop for mobile
  const touchDragRef = useRef<{ itemId: string; itemIdx: number; ghost: HTMLElement; startX: number; startY: number; origTop: number; origLeft: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const [touchDragActive, setTouchDragActive] = useState(false);

  useEffect(() => {
    const finishTouchDrag = (touch: Touch) => {
      const s = touchDragRef.current;
      if (!s) return;

      touchDragRef.current = null;
      setTouchDragActive(false);
      document.body.style.overflow = "";
      document.body.style.touchAction = "";

      s.ghost.style.visibility = "hidden";
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      s.ghost.remove();

      const cardEl = el?.closest("[data-food-idx]");
      if (cardEl) {
        const toIdx = parseInt(cardEl.getAttribute("data-food-idx") || "-1");
        if (toIdx >= 0 && toIdx !== s.itemIdx) onReorder(s.itemIdx, toIdx);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchDragRef.current) {
        // Only cancel long press if finger moved more than 10px
        if (longPressTimerRef.current && touchStartPosRef.current) {
          const touch = e.touches[0];
          const dx = touch.clientX - touchStartPosRef.current.x;
          const dy = touch.clientY - touchStartPosRef.current.y;
          if (Math.sqrt(dx * dx + dy * dy) > 10) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
            touchStartPosRef.current = null;
          }
        }
        return;
      }
      e.preventDefault();
      const touch = e.touches[0];
      const s = touchDragRef.current;
      s.ghost.style.top = `${s.origTop + (touch.clientY - s.startY)}px`;
      s.ghost.style.left = `${s.origLeft + (touch.clientX - s.startX)}px`;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (!touchDragRef.current) return;
      const touch = e.changedTouches[0];
      if (touch) finishTouchDrag(touch);
    };

    const onTouchCancel = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (touchDragRef.current) {
        touchDragRef.current.ghost.remove();
        touchDragRef.current = null;
      }
      setTouchDragActive(false);
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    };

    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: false });
    window.addEventListener("touchcancel", onTouchCancel);

    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [onReorder]);

  const handleTouchStart = (e: React.TouchEvent, item: FoodItem, sectionIdx: number) => {
    if (sortMode !== "manual") return;
    const touch = e.touches[0];
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();

    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);

    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";

      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;z-index:9999;pointer-events:none;opacity:0.85;transform:scale(1.05);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.35);transition:none;`;
      document.body.appendChild(ghost);

      touchDragRef.current = {
        itemId: item.id,
        itemIdx: sectionIdx,
        ghost,
        startX: touch.clientX,
        startY: touch.clientY,
        origTop: rect.top,
        origLeft: rect.left,
      };
      setTouchDragActive(true);
    }, 500);
  };

  return (
    <div
      className="rounded-3xl bg-card/80 backdrop-blur-sm p-4"
      onDragOver={(e) => { e.preventDefault(); setSectionDragOver(true); }}
      onDragLeave={() => setSectionDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSectionDragOver(false);
        const itemId = e.dataTransfer.getData("foodItemId");
        const fromStorage = e.dataTransfer.getData("foodItemStorage");
        if (itemId && fromStorage !== storageType) {
          onChangeStorage(itemId, storageType);
          setDragIndex(null);
        }
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setCollapsed(c => !c)} className="flex items-center gap-2 flex-1 text-left">
          {collapsed
            ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          }
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            {emoji} {title}
          </h2>
        </button>
        <span className="text-sm font-normal text-muted-foreground">{items.length}</span>
        <div className="flex items-center gap-1">
          {sortMode !== "manual" && (
            <Button size="sm" variant="ghost" onClick={onToggleSortDirection} className="h-7 w-7 p-0 rounded-full">
              {sortDirection ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5 rotate-180" />}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onToggleSort} className={`text-[10px] gap-0.5 h-7 px-2 rounded-full border transition-all ${sortMode !== "manual" ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/20' : 'border-transparent'}`}>
            <SortIcon className="h-3 w-3" />
            <span className="hidden sm:inline">{sortLabel}</span>
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className={`flex flex-col gap-2 ${touchDragActive ? "touch-none" : ""}`}>
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6 italic">
              Aucun aliment — glisse une carte depuis une autre section
            </p>
          ) : (
            items.map((item, sectionIdx) => (
              <div
                key={item.id}
                data-food-idx={sectionIdx}
                onTouchStart={(e) => handleTouchStart(e, item, sectionIdx)}
              >
                <FoodItemCard
                  item={item}
                  onUpdate={(updates) => onUpdate(item.id, updates)}
                  onDelete={() => onDelete(item.id)}
                  onDuplicate={() => onDuplicate(item.id)}
                  draggableEnabled={!isTouchDevice}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("foodItemIndex", String(sectionIdx));
                    e.dataTransfer.setData("foodItemId", item.id);
                    e.dataTransfer.setData("foodItemStorage", item.storage_type);
                    setDragIndex(sectionIdx);
                  }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const fromId = e.dataTransfer.getData("foodItemId");
                    const fromStorage = e.dataTransfer.getData("foodItemStorage");
                    if (fromStorage === storageType && dragIndex !== null && dragIndex !== sectionIdx) {
                      onReorder(dragIndex, sectionIdx);
                    }
                    if (fromId && fromStorage !== storageType) {
                      onChangeStorage(fromId, storageType);
                    }
                    setDragIndex(null);
                  }}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
