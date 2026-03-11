import { useState, useCallback, useEffect, useRef } from "react";
import { z } from "zod";
import { Plus, Copy, Trash2, Timer, Flame, Weight, Calendar, ArrowUpDown, CalendarDays, Infinity as InfinityIcon, UtensilsCrossed, Refrigerator, Package, Snowflake, Hash, ChevronDown, ChevronRight, Minus, Search, Wheat, Drumstick, Lock } from "lucide-react";
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

// ─── Types ──────────────────────────────────────────────────────────────────

export type StorageType = 'frigo' | 'sec' | 'surgele' | 'toujours';
export type FoodType = 'feculent' | 'viande' | null;

export interface FoodItem {
  id: string;
  name: string;
  grams: string | null;
  calories: string | null;
  protein: string | null;
  expiration_date: string | null;
  counter_start_date: string | null;
  sort_order: number;
  created_at: string;
  is_meal: boolean;
  is_infinite: boolean;
  is_dry: boolean;
  is_indivisible: boolean;
  storage_type: StorageType;
  quantity: number | null;
  food_type: FoodType;
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const FOOD_COLORS = [
  "hsl(22, 60%, 45%)",   // burnt orange
  "hsl(155, 40%, 38%)",  // forest green
  "hsl(215, 50%, 44%)",  // steel blue
  "hsl(275, 40%, 46%)",  // amethyst
  "hsl(40, 55%, 42%)",   // golden brown
  "hsl(185, 45%, 38%)",  // teal
  "hsl(130, 35%, 38%)",  // emerald
  "hsl(240, 40%, 48%)",  // indigo
  "hsl(315, 35%, 44%)",  // plum
  "hsl(55, 45%, 38%)",   // olive
  "hsl(30, 65%, 38%)",   // rust
  "hsl(90, 40%, 36%)",   // moss
  "hsl(170, 50%, 33%)",  // dark teal
  "hsl(200, 55%, 40%)",  // ocean blue
  "hsl(250, 45%, 43%)",  // deep violet
  "hsl(290, 40%, 40%)",  // grape
  "hsl(330, 50%, 42%)",  // raspberry
  "hsl(48, 50%, 36%)",   // dark gold
  "hsl(110, 35%, 34%)",  // sage
  "hsl(145, 45%, 36%)",  // jade
  "hsl(180, 40%, 36%)",  // dark cyan
  "hsl(220, 45%, 42%)",  // navy blue
  "hsl(260, 35%, 46%)",  // lavender purple
  "hsl(300, 35%, 38%)",  // mauve
  "hsl(70, 45%, 34%)",   // army green
  "hsl(120, 40%, 40%)",  // spring green
  "hsl(160, 35%, 38%)",  // sea green
  "hsl(190, 50%, 34%)",  // deep teal
  "hsl(230, 40%, 42%)",  // cobalt
  "hsl(270, 45%, 40%)",  // purple
  "hsl(345, 45%, 43%)",  // cranberry
  "hsl(28, 55%, 40%)",   // copper
  "hsl(75, 40%, 38%)",   // chartreuse
  "hsl(135, 45%, 34%)",  // pine
  "hsl(195, 50%, 38%)",  // cerulean
  "hsl(255, 40%, 42%)",  // iris
  "hsl(310, 40%, 40%)",  // orchid
  "hsl(45, 60%, 38%)",   // amber
  "hsl(165, 40%, 36%)",  // malachite
  "hsl(205, 45%, 42%)",  // azure
  "hsl(285, 40%, 38%)",  // eggplant
  "hsl(325, 45%, 44%)",  // magenta rose
  // Additional colors for more diversity
  "hsl(10, 55%, 42%)",   // brick red
  "hsl(35, 50%, 35%)",   // chocolate
  "hsl(60, 40%, 32%)",   // dark olive
  "hsl(100, 38%, 32%)",  // hunter green
  "hsl(140, 42%, 30%)",  // deep forest
  "hsl(175, 48%, 30%)",  // dark turquoise
  "hsl(210, 52%, 38%)",  // denim blue
  "hsl(245, 38%, 45%)",  // royal blue
  "hsl(280, 42%, 35%)",  // dark purple
  "hsl(320, 42%, 38%)",  // dark rose
  "hsl(350, 50%, 40%)",  // carmine
  "hsl(15, 52%, 38%)",   // sienna
  "hsl(85, 35%, 30%)",   // olive drab
  "hsl(115, 32%, 36%)",  // fern
  "hsl(150, 38%, 32%)",  // dark jade
  "hsl(225, 48%, 36%)",  // sapphire
  "hsl(265, 42%, 38%)",  // twilight
  "hsl(295, 38%, 42%)",  // violet
  "hsl(335, 48%, 36%)",  // wine
  "hsl(5, 48%, 36%)",    // dark coral
];

/** Deterministic color from any string (id or name) — unique per input, FNV-1a for better distribution */
export function colorFromName(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return FOOD_COLORS[((hash >>> 0) % FOOD_COLORS.length)];
}

function getCounterDays(startDate: string | null): number | null {
  if (!startDate) return null;
  return Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000);
}

function formatNumeric(n: number): string {
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

function encodeStoredGrams(unit: number, remainder: number | null): string {
  const unitText = formatNumeric(unit);
  if (!remainder || remainder <= 0 || remainder >= unit) return unitText;
  return `${unitText}|${formatNumeric(remainder)}`;
}

function isExpiredDate(d: string | null) {
  if (!d) return false;
  return new Date(d) < new Date(new Date().toDateString());
}

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
    mutationFn: async ({ name, storage_type, quantity, grams, food_type, expiration_date }: { name: string; storage_type: StorageType; quantity?: number | null; grams?: string | null; food_type?: FoodType; expiration_date?: string | null }) => {
      const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), -1);
      const { error } = await supabase
        .from("food_items")
        .insert({
          name,
          sort_order: maxOrder + 1,
          is_dry: storage_type === 'sec',
          storage_type,
          ...(quantity ? { quantity } : {}),
          ...(grams ? { grams } : {}),
          ...(food_type ? { food_type } : {}),
          ...(expiration_date ? { expiration_date } : {}),
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
  color: string;
  onUpdate: (updates: Partial<FoodItem>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  draggableEnabled?: boolean;
}

function FoodItemCard({ item, color, onUpdate, onDelete, onDuplicate, onDragStart, onDragOver, onDrop, draggableEnabled = true }: FoodItemCardProps) {
  const [editing, setEditing] = useState<"name" | "grams" | "calories" | "protein" | "quantity" | "partial" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [calOpen, setCalOpen] = useState(false);

  const expired = isExpiredDate(item.expiration_date);
  const expIsToday = item.expiration_date ? (() => {
    const d = new Date(item.expiration_date!);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  })() : false;
  const counterDays = getCounterDays(item.counter_start_date);
  const counterUrgent = counterDays !== null && counterDays >= 3;
  const gramsData = parseStoredGrams(item.grams);
  const displayDefaultGrams = gramsData.unit !== null ? `${formatNumeric(gramsData.unit)}g` : item.grams;
  const displayPartialGrams = gramsData.remainder !== null ? `${formatNumeric(gramsData.remainder)}g` : null;
  const effectiveQty = item.quantity === 1 ? null : item.quantity;
  const canEditPartial = !item.is_infinite && gramsData.unit !== null && (effectiveQty ? effectiveQty > 1 : true);
  const showPartialLabel = gramsData.remainder !== null;

  const saveEdit = () => {
    const val = editValue.trim();
    if (editing === "name" && val) onUpdate({ name: val });
    if (editing === "grams") onUpdate({ grams: val || null });
    if (editing === "calories") onUpdate({ calories: val || null });
    if (editing === "protein") onUpdate({ protein: val || null });
    if (editing === "quantity") onUpdate({ quantity: val ? parseInt(val) || null : null });
    if (editing === "partial" && gramsData.unit !== null) {
      if (!val) {
        onUpdate({ grams: formatNumeric(gramsData.unit) });
      } else {
        const parsed = parseFloat(val.replace(",", "."));
        if (!isNaN(parsed) && parsed > 0) {
          if (parsed >= gramsData.unit) {
            onUpdate({ grams: formatNumeric(gramsData.unit) });
          } else {
            onUpdate({ grams: encodeStoredGrams(gramsData.unit, parsed) });
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
      setEditValue(gramsData.unit !== null ? formatNumeric(gramsData.unit) : "");
    } else if (field === "calories") {
      setEditValue(item.calories ?? "");
    } else if (field === "protein") {
      setEditValue(item.protein ?? "");
    } else if (field === "partial") {
      setEditValue(gramsData.remainder !== null ? formatNumeric(gramsData.remainder) : "");
    } else {
      setEditValue(item.name);
    }
    setEditing(field);
  };

  const selectedDate = item.expiration_date ? parseISO(item.expiration_date) : undefined;

  const handleGramsCycle = () => {
    if (item.is_infinite) {
      onUpdate({ is_infinite: false, grams: null });
    } else if (item.grams) {
      onUpdate({ is_infinite: true, grams: null });
    } else {
      startEdit("grams");
    }
  };

  const handleDecrementQuantity = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentQty = item.quantity ?? 1;
    if (currentQty <= 1) {
      onDelete();
    } else {
      onUpdate({ quantity: currentQty - 1 });
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
      {/* Row 1: name on left, options wrap to row 2 if needed */}
      <div className="flex flex-wrap items-start gap-1.5 min-w-0">
        {/* Left: name + text inputs */}
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

        {/* Right: all option badges - wraps to next line if title is too long */}
        <div className="flex items-center gap-1 flex-wrap justify-end ml-auto min-w-0">
          {/* Counter badge */}
          {counterDays !== null && (
            <button
              onClick={() => onUpdate({ counter_start_date: null })}
              className={`text-[11px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5 border shrink-0 transition-all ${counterUrgent ? 'bg-red-600 text-white border-red-300 shadow-md animate-pulse' : 'bg-black/40 text-white border-white/30'}`}
              title="Cliquer pour arrêter le compteur"
            >
              <Timer className="h-2.5 w-2.5" />{counterDays}j
            </button>
          )}

          {/* Quantity */}
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

          {/* Grams / Infinite */}
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
                title="Cliquer pour rendre infini"
              >
                <Weight className="h-2.5 w-2.5" />{displayDefaultGrams}
              </button>
              {/* Reste — inline next to grams */}
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

          {/* Protein */}
          {editing === "protein" ? (
            <Input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={saveEdit} onKeyDown={e => e.key === "Enter" && saveEdit()} placeholder="Ex: 25" inputMode="numeric" className="h-6 w-16 border-white/30 bg-white/20 text-white placeholder:text-white/50 text-[10px] px-1.5" />
          ) : item.protein ? (
            <button onClick={() => startEdit("protein")} className="text-[10px] text-white/70 bg-blue-500/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-blue-500/40 shrink-0 font-semibold">
              🍗 {item.protein}
            </button>
          ) : null}

          {/* Indivisible toggle */}
          {item.grams && !item.is_infinite && (
            <button
              onClick={() => onUpdate({ is_indivisible: !item.is_indivisible })}
              className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${item.is_indivisible ? 'bg-orange-400/30 text-orange-200 border-orange-400/50 font-bold' : 'bg-white/10 text-white/50 border-white/20'}`}
              title={item.is_indivisible ? "Indivisible (cliquer pour désactiver)" : "Marquer comme indivisible (grammage entier obligatoire)"}
            >
              <Lock className="h-2.5 w-2.5" />{item.is_indivisible ? 'Indiv.' : ''}
            </button>
          )}

          {/* is_meal toggle */}
          <button
            onClick={() => onUpdate({ is_meal: !item.is_meal })}
            className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${item.is_meal ? 'bg-white/30 text-white border-white/50 font-bold' : 'bg-white/10 text-white/50 border-white/20'}`}
            title={item.is_meal ? "Se mange seul (désactiver)" : "Marquer comme repas à part entière"}
          >
            <UtensilsCrossed className="h-2.5 w-2.5" />
          </button>

          {/* food_type toggle: cycle null -> feculent -> viande -> null */}
          <button
            onClick={() => {
              const next = item.food_type === null ? 'feculent' : item.food_type === 'feculent' ? 'viande' : null;
              onUpdate({ food_type: next });
            }}
            className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 border transition-all ${
              item.food_type === 'feculent' ? 'bg-amber-400/30 text-amber-200 border-amber-400/50 font-bold'
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

      {/* Row 2: quick-add + expiration + counter + reste */}
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
            P + protéines
          </button>
        )}

        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button className={`h-5 min-w-[88px] border bg-white/10 text-white text-[10px] px-1.5 rounded-md flex items-center gap-0.5 hover:bg-white/20 transition-colors ${
              expIsToday ? 'border-red-500 ring-1 ring-red-500 text-red-200 font-bold' : expired ? 'border-red-500/60 bg-red-500/20 text-red-200 font-bold animate-pulse' : 'border-white/20'
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

        {/* Counter toggle */}
        <button
          onClick={() => onUpdate({ counter_start_date: item.counter_start_date ? null : new Date().toISOString() })}
          className="text-[10px] text-white/40 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
          title={item.counter_start_date ? 'Arrêter compteur' : 'Démarrer compteur'}
        >
          <Timer className="h-2.5 w-2.5" />
          {item.counter_start_date ? 'Stop' : 'Compteur'}
        </button>

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
  { type: 'toujours', label: 'Toujours présent', emoji: <span className="text-base">📌</span> },
];

export function FoodItems() {
  const { items, isLoading, addItem, updateItem, deleteItem, duplicateItem, reorderItems } = useFoodItems();
  const [newName, setNewName] = useState("");
  const [newQuantity, setNewQuantity] = useState("");
  const [newGrams, setNewGrams] = useState("");
  const [newFoodType, setNewFoodType] = useState<FoodType>(null);
  const [newExpiration, setNewExpiration] = useState<Date | undefined>(undefined);
  const [expCalOpen, setExpCalOpen] = useState(false);
  const [showStoragePrompt, setShowStoragePrompt] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [pendingQuantity, setPendingQuantity] = useState("");
  const [pendingGrams, setPendingGrams] = useState("");
  const [pendingFoodType, setPendingFoodType] = useState<FoodType>(null);
  const [pendingExpiration, setPendingExpiration] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Independent sort per section
  const [sortModes, setSortModes] = useState<Record<StorageType, SortMode>>(() => {
    const saved = localStorage.getItem('food_sort_modes');
    return saved ? JSON.parse(saved) : { frigo: 'manual', sec: 'manual', surgele: 'manual', toujours: 'manual' };
  });

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Persist sort modes
  useEffect(() => {
    localStorage.setItem('food_sort_modes', JSON.stringify(sortModes));
  }, [sortModes]);

  // Use item.id for color; if a duplicate, use source's id for same color
  const colorMap = useCallback((item: FoodItem) => {
    const overrides = JSON.parse(sessionStorage.getItem('color_overrides') || '{}') as Record<string, string>;
    let seedId = item.id;
    let visited = new Set<string>();
    while (overrides[seedId] && !visited.has(seedId)) {
      visited.add(seedId);
      seedId = overrides[seedId];
    }
    return colorFromName(seedId);
  }, []);

  const normalizeSearch = (text: string) =>
    text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/s$/g, "");

  const filterBySearch = (itemsList: FoodItem[]): FoodItem[] => {
    if (!searchQuery.trim()) return itemsList;
    const q = normalizeSearch(searchQuery);
    return itemsList.filter(item => normalizeSearch(item.name).includes(q));
  };

  const getSortedItems = (storageType: StorageType): FoodItem[] => {
    const sectionItems = items.filter(i => i.storage_type === storageType);
    let sorted: FoodItem[];
    if (sortModes[storageType] === "expiration") {
      sorted = [...sectionItems].sort((a, b) => {
        if (a.is_meal && !a.expiration_date && !(b.is_meal && !b.expiration_date)) return -1;
        if (b.is_meal && !b.expiration_date && !(a.is_meal && !a.expiration_date)) return 1;

        const aExpired = isExpiredDate(a.expiration_date);
        const bExpired = isExpiredDate(b.expiration_date);
        const aCounter = getCounterDays(a.counter_start_date);
        const bCounter = getCounterDays(b.counter_start_date);

        const parseCal = (fi: FoodItem): number => {
          if (!fi.calories) return 0;
          const m = fi.calories.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
          return m ? parseFloat(m[0]) || 0 : 0;
        };

        const aG1 = aExpired && aCounter !== null;
        const bG1 = bExpired && bCounter !== null;
        if (aG1 && !bG1) return -1;
        if (!aG1 && bG1) return 1;
        if (aG1 && bG1) {
          if (aCounter !== bCounter) return (bCounter ?? 0) - (aCounter ?? 0);
          const dateCmp = (a.expiration_date ?? '').localeCompare(b.expiration_date ?? '');
          if (dateCmp !== 0) return dateCmp;
          return parseCal(a) - parseCal(b);
        }

        const aG2 = !aExpired && aCounter !== null;
        const bG2 = !bExpired && bCounter !== null;
        if (aG2 && !bG2) return -1;
        if (!aG2 && bG2) return 1;
        if (aG2 && bG2) {
          if ((bCounter ?? 0) !== (aCounter ?? 0)) return (bCounter ?? 0) - (aCounter ?? 0);
          const dateCmp = (a.expiration_date ?? '').localeCompare(b.expiration_date ?? '');
          if (dateCmp !== 0) return dateCmp;
          return parseCal(a) - parseCal(b);
        }

        const aG3 = aExpired && aCounter === null;
        const bG3 = bExpired && bCounter === null;
        if (aG3 && !bG3) return -1;
        if (!aG3 && bG3) return 1;
        if (aG3 && bG3) {
          const dateCmp = (a.expiration_date ?? '').localeCompare(b.expiration_date ?? '');
          if (dateCmp !== 0) return dateCmp;
          return parseCal(a) - parseCal(b);
        }

        if (!a.expiration_date && !b.expiration_date) return 0;
        if (!a.expiration_date) return 1;
        if (!b.expiration_date) return -1;
        const dateCmp = a.expiration_date.localeCompare(b.expiration_date);
        if (dateCmp !== 0) return dateCmp;
        return parseCal(a) - parseCal(b);
      });
    } else {
      sorted = sectionItems;
    }
    return filterBySearch(sorted);
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
    setPendingFoodType(newFoodType);
    setPendingExpiration(newExpiration ? format(newExpiration, 'yyyy-MM-dd') : null);
    setShowStoragePrompt(true);
  };

  const confirmAdd = (storageType: StorageType) => {
    const qty = pendingQuantity ? parseInt(pendingQuantity) || null : null;
    const grams = pendingGrams.trim() || null;
    addItem.mutate({ name: pendingName, storage_type: storageType, quantity: qty, grams, food_type: pendingFoodType, expiration_date: pendingExpiration }, {
      onSuccess: () => { setNewName(""); setNewQuantity(""); setNewGrams(""); setNewFoodType(null); setNewExpiration(undefined); setPendingName(""); setPendingQuantity(""); setPendingGrams(""); setPendingFoodType(null); setPendingExpiration(null); setShowStoragePrompt(false); toast({ title: "Aliment ajouté 🥕", duration: 800 }); },
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
    setSortModes(prev => ({ ...prev, [storageType]: "manual" }));
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
        <Input
          placeholder="Nom de l'aliment (ex : Crème fraîche)"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          className="flex-1 rounded-xl"
        />
        <div className="relative shrink-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Rechercher…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-28 sm:w-36 rounded-xl pl-7 h-10"
          />
        </div>
        <Button onClick={handleAdd} disabled={!newName.trim()} className="rounded-full gap-1 shrink-0">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Ajouter</span>
        </Button>
      </div>

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
        <Popover open={expCalOpen} onOpenChange={setExpCalOpen}>
          <PopoverTrigger asChild>
            <button className={`h-8 min-w-[120px] border rounded-xl text-sm px-2 flex items-center gap-1 transition-colors ${
              newExpiration ? 'bg-muted text-foreground border-border font-medium' : 'bg-muted/50 text-muted-foreground border-border'
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
            className={`text-[10px] px-2 py-1 rounded-full flex items-center gap-0.5 border transition-all ${
              newFoodType === 'feculent' ? 'bg-amber-500/20 text-amber-300 border-amber-400/50 font-bold' : 'bg-muted text-muted-foreground border-border'
            }`}
          >
            <Wheat className="h-3 w-3" />Féc
          </button>
          <button
            onClick={() => setNewFoodType(prev => prev === 'viande' ? null : 'viande')}
            className={`text-[10px] px-2 py-1 rounded-full flex items-center gap-0.5 border transition-all ${
              newFoodType === 'viande' ? 'bg-red-500/20 text-red-300 border-red-400/50 font-bold' : 'bg-muted text-muted-foreground border-border'
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
          <div className="flex gap-2">
            <Button onClick={() => confirmAdd('frigo')} variant="outline" className="flex-1 gap-1.5">
              <Refrigerator className="h-4 w-4 text-blue-400" /> Frigo
            </Button>
            <Button onClick={() => confirmAdd('sec')} variant="outline" className="flex-1 gap-1.5">
              <Package className="h-4 w-4 text-amber-500" /> Sec
            </Button>
            <Button onClick={() => confirmAdd('surgele')} variant="outline" className="flex-1 gap-1.5">
              <Snowflake className="h-4 w-4 text-cyan-400" /> Surgelé
            </Button>
          </div>
          <button onClick={() => setShowStoragePrompt(false)} className="text-xs text-muted-foreground mt-2 w-full text-center hover:text-foreground">
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
            colorMap={colorMap}
            onUpdate={(id, updates) => updateItem.mutate({ id, ...updates })}
            onDelete={(id) => deleteItem.mutate(id)}
            onDuplicate={(id) => duplicateItem.mutate(id)}
            sortMode={sortModes[section.type]}
            onToggleSort={() => setSortModes(prev => ({ ...prev, [section.type]: prev[section.type] === "manual" ? "expiration" : "manual" }))}
            onReorder={(from, to) => handleReorder(section.type, from, to)}
            dragIndex={dragIndex}
            setDragIndex={setDragIndex}
            allItems={items}
            onChangeStorage={(id, st) => updateItem.mutate({ id, storage_type: st, is_dry: st === 'sec' })}
          />
        ))}
      </div>
      <div className="mt-4 flex justify-center">
        <div className="flex flex-col gap-4 w-full max-w-3xl">
          {STORAGE_SECTIONS.filter(s => s.type === 'surgele' || s.type === 'toujours').map((section) => (
            <FoodSection
              key={section.type}
              emoji={section.emoji}
              title={section.label}
              storageType={section.type}
              items={getSortedItems(section.type)}
              colorMap={colorMap}
              onUpdate={(id, updates) => updateItem.mutate({ id, ...updates })}
              onDelete={(id) => deleteItem.mutate(id)}
              onDuplicate={(id) => duplicateItem.mutate(id)}
              sortMode={sortModes[section.type]}
              onToggleSort={() => setSortModes(prev => ({ ...prev, [section.type]: prev[section.type] === "manual" ? "expiration" : "manual" }))}
              onReorder={(from, to) => handleReorder(section.type, from, to)}
              dragIndex={dragIndex}
              setDragIndex={setDragIndex}
              allItems={items}
              onChangeStorage={(id, st) => updateItem.mutate({ id, storage_type: st, is_dry: st === 'sec' })}
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
  colorMap: (item: FoodItem) => string;
  onUpdate: (id: string, updates: Partial<FoodItem>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  sortMode: SortMode;
  onToggleSort: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  dragIndex: number | null;
  setDragIndex: (i: number | null) => void;
  allItems: FoodItem[];
  onChangeStorage: (id: string, storageType: StorageType) => void;
}

function FoodSection({ emoji, title, storageType, items, colorMap, onUpdate, onDelete, onDuplicate, sortMode, onToggleSort, onReorder, dragIndex, setDragIndex, allItems, onChangeStorage }: FoodSectionProps) {
  const SortIcon = sortMode === "expiration" ? CalendarDays : ArrowUpDown;
  const sortLabel = sortMode === "expiration" ? "Péremption" : "Manuel";
  const [sectionDragOver, setSectionDragOver] = useState(false);
  const [collapsed, setCollapsed] = useState(storageType === 'toujours');
  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  // Touch drag & drop for mobile
  const touchDragRef = useRef<{ itemId: string; itemIdx: number; ghost: HTMLElement; startX: number; startY: number; origTop: number; origLeft: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
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
        <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-7 px-2">
          <SortIcon className="h-3 w-3" />
          <span className="hidden sm:inline">{sortLabel}</span>
        </Button>
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
                  color={colorMap(item)}
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
