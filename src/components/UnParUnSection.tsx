import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Drumstick, Wheat, ArrowUpDown, CalendarDays, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreferences } from "@/hooks/usePreferences";
import type { Meal } from "@/hooks/useMeals";
import { colorFromName, type FoodItem } from "@/components/FoodItems";
import { buildStockMap, findStockKey, getMealMultiple } from "@/lib/stockUtils";
import { normalizeForMatch, strictNameMatch, parseIngredientGroups, formatNumeric, getFoodItemTotalGrams } from "@/lib/ingredientUtils";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

type UnParUnSortMode = "manual" | "expiration";

interface UnParUnSectionProps {
  category: { value: string; label: string; emoji: string };
  foodItems: FoodItem[];
  allMeals: Meal[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onMoveToPossible: (fi: FoodItem, consumeQty?: number, consumeGrams?: number) => void;
  sortMode: UnParUnSortMode;
  onToggleSort: () => void;
}

export function UnParUnSection({ category, foodItems, allMeals, collapsed, onToggleCollapse, onMoveToPossible, sortMode, onToggleSort }: UnParUnSectionProps) {
  const stockMap = buildStockMap(foodItems);
  const { getPreference, setPreference } = usePreferences();
  const [consumeDialogItem, setConsumeDialogItem] = useState<FoodItem | null>(null);
  const [consumeQty, setConsumeQty] = useState("");
  const [consumeGrams, setConsumeGrams] = useState("");

  const viandeItems = foodItems.filter(fi => fi.food_type === 'viande');
  const feculentItems = foodItems.filter(fi => fi.food_type === 'feculent');

  const globalAvailableMeals = allMeals.filter(meal => {
    if (!meal.ingredients?.trim()) return false;
    const m = getMealMultiple(meal, stockMap);
    return m !== null && m > 0;
  });

  const usedIngredientKeys = new Set<string>();
  for (const meal of globalAvailableMeals) {
    const groups = parseIngredientGroups(meal.ingredients!);
    for (const group of groups) {
      for (const alt of group) {
        const key = findStockKey(stockMap, alt.name);
        if (key) usedIngredientKeys.add(key);
      }
    }
  }
  for (const meal of allMeals) {
    if (meal.ingredients?.trim()) continue;
    if (!meal.is_available) continue;
    for (const fi of foodItems) {
      if (strictNameMatch(meal.name, fi.name)) {
        usedIngredientKeys.add(normalizeForMatch(fi.name));
        break;
      }
    }
  }

  const isUnused = (fi: FoodItem) => {
    const fiKey = normalizeForMatch(fi.name);
    for (const usedKey of usedIngredientKeys) {
      if (strictNameMatch(fiKey, usedKey)) return false;
    }
    return true;
  };

  const storedViandeOrder = getPreference<string[]>('unparun_viande_order', []);
  const storedFeculentOrder = getPreference<string[]>('unparun_feculent_order', []);

  const sortItems = (items: FoodItem[], storedOrder: string[]) => {
    if (sortMode === "manual" && storedOrder.length > 0) {
      const orderMap = new Map(storedOrder.map((id, i) => [id, i]));
      return [...items].sort((a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity));
    }
    return [...items].sort((a, b) => {
      const aUnused = isUnused(a) ? 0 : 1;
      const bUnused = isUnused(b) ? 0 : 1;
      if (aUnused !== bUnused) return aUnused - bUnused;
      if (a.expiration_date && b.expiration_date) return a.expiration_date.localeCompare(b.expiration_date);
      if (a.expiration_date) return -1;
      if (b.expiration_date) return 1;
      return 0;
    });
  };

  const sortedViande = sortItems(viandeItems, storedViandeOrder);
  const sortedFeculent = sortItems(feculentItems, storedFeculentOrder);
  const totalCount = sortedViande.length + sortedFeculent.length;

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragCol, setDragCol] = useState<'viande' | 'feculent' | null>(null);

  const handleReorder = (col: 'viande' | 'feculent', fromIdx: number, toIdx: number) => {
    const items = col === 'viande' ? [...sortedViande] : [...sortedFeculent];
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);
    const key = col === 'viande' ? 'unparun_viande_order' : 'unparun_feculent_order';
    setPreference.mutate({ key, value: items.map(i => i.id) });
  };

  // Touch DnD for mobile
  const touchDragRef = useRef<{ col: 'viande' | 'feculent'; idx: number; ghost: HTMLElement; startX: number; startY: number; origTop: number; origLeft: number } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [touchActive, setTouchActive] = useState(false);

  useEffect(() => {
    const onMove = (e: TouchEvent) => {
      if (!touchDragRef.current) {
        if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
        return;
      }
      e.preventDefault();
      const t = e.touches[0];
      const s = touchDragRef.current;
      s.ghost.style.top = `${s.origTop + (t.clientY - s.startY)}px`;
      s.ghost.style.left = `${s.origLeft + (t.clientX - s.startX)}px`;
    };
    const onEnd = (e: TouchEvent) => {
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
      if (!touchDragRef.current) return;
      const t = e.changedTouches[0];
      const s = touchDragRef.current;
      s.ghost.style.visibility = "hidden";
      const el = document.elementFromPoint(t.clientX, t.clientY);
      s.ghost.remove();
      const sCol = s.col;
      const sIdx = s.idx;
      touchDragRef.current = null;
      setTouchActive(false);
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
      const cardEl = el?.closest("[data-upu-idx]");
      if (cardEl) {
        const toIdx = parseInt(cardEl.getAttribute("data-upu-idx") || "-1");
        const toCol = cardEl.getAttribute("data-upu-col") as 'viande' | 'feculent';
        if (toIdx >= 0 && toCol === sCol && toIdx !== sIdx) handleReorder(sCol, sIdx, toIdx);
      }
    };
    const onCancel = () => {
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
      if (touchDragRef.current) { touchDragRef.current.ghost.remove(); touchDragRef.current = null; }
      setTouchActive(false);
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: false });
    window.addEventListener("touchcancel", onCancel);
    return () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [sortedViande, sortedFeculent]);

  const handleTouchStart = (e: React.TouchEvent, col: 'viande' | 'feculent', idx: number) => {
    if (sortMode !== "manual") return;
    const touch = e.touches[0];
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;z-index:9999;pointer-events:none;opacity:0.85;transform:scale(1.05);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.35);transition:none;`;
      document.body.appendChild(ghost);
      touchDragRef.current = { col, idx, ghost, startX: touch.clientX, startY: touch.clientY, origTop: rect.top, origLeft: rect.left };
      setTouchActive(true);
    }, 500);
  };

  const isTouchDevice = typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || "ontouchstart" in window);

  const handleConsumeConfirm = () => {
    if (!consumeDialogItem) return;
    const maxQty = consumeDialogItem.quantity ?? 1;
    const maxGrams = getFoodItemTotalGrams(consumeDialogItem);
    let qtyVal = consumeQty ? parseInt(consumeQty) || undefined : undefined;
    let gramsVal = consumeGrams ? parseFloat(consumeGrams.replace(",", ".")) || undefined : undefined;
    // Enforce maximums
    if (qtyVal !== undefined && qtyVal > maxQty) qtyVal = maxQty;
    if (qtyVal !== undefined && qtyVal < 1) qtyVal = 1;
    if (gramsVal !== undefined && gramsVal > maxGrams) gramsVal = maxGrams;
    if (gramsVal !== undefined && gramsVal < 1) gramsVal = 1;
    onMoveToPossible(consumeDialogItem, qtyVal, gramsVal);
    setConsumeDialogItem(null);
    setConsumeQty("");
    setConsumeGrams("");
  };

  const SortIcon = sortMode === "expiration" ? CalendarDays : ArrowUpDown;
  const sortLabel = sortMode === "expiration" ? "Péremption" : "Manuel";

  const renderFoodCard = (fi: FoodItem, col: 'viande' | 'feculent', idx: number) => {
    const unused = isUnused(fi);
    const expLabel = fi.expiration_date ? format(parseISO(fi.expiration_date), 'd MMM', { locale: fr }) : null;
    const isExpired = fi.expiration_date ? new Date(fi.expiration_date) < new Date(new Date().toDateString()) : false;
    const totalG = getFoodItemTotalGrams(fi);
    const qty = fi.quantity && fi.quantity > 1 ? fi.quantity : null;
    const counterDays = fi.counter_start_date ? Math.floor((Date.now() - new Date(fi.counter_start_date).getTime()) / 86400000) : null;
    const counterUrgent = counterDays !== null && counterDays >= 3;
    const color = colorFromName(fi.id);

    return (
      <div
        key={fi.id}
        data-upu-idx={idx}
        data-upu-col={col}
        draggable={!isTouchDevice && sortMode === "manual"}
        onDragStart={() => { setDragIdx(idx); setDragCol(col); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragCol === col && dragIdx !== null && dragIdx !== idx) handleReorder(col, dragIdx, idx); setDragIdx(null); setDragCol(null); }}
        onTouchStart={(e) => handleTouchStart(e, col, idx)}
        className={`rounded-2xl px-3 py-2 shadow-md transition-all hover:scale-[1.01] flex items-center justify-between gap-2 ${sortMode === "manual" ? "cursor-grab active:cursor-grabbing" : ""} ${isExpired ? 'ring-2 ring-red-500 shadow-red-500/30' : ''} ${unused ? 'ring-1 ring-yellow-400/40' : ''}`}
        style={{ backgroundColor: color }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white break-words whitespace-normal">{fi.name}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {counterDays !== null && (
              <span className={`text-xs font-black px-2 py-0.5 rounded-full flex items-center gap-0.5 ${counterUrgent ? 'bg-red-500/80 text-white animate-pulse' : 'bg-white/25 text-white'}`}>
                <Timer className="h-3 w-3" />{counterDays}j
              </span>
            )}
            {totalG > 0 && <span className="text-xs text-white/80 font-bold">{formatNumeric(totalG)}g</span>}
            {qty && <span className="text-xs text-white/80 font-bold">×{qty}</span>}
            {fi.is_infinite && <span className="text-xs text-white/80 font-bold">∞</span>}
            {expLabel && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${isExpired ? 'bg-red-500/60 text-white' : 'bg-white/20 text-white/90'}`}>
                📅{expLabel}
              </span>
            )}
            {unused && <span className="text-[10px] text-yellow-200 font-bold">⚡inutilisé</span>}
          </div>
        </div>
        <button
          onClick={() => {
            if ((fi.quantity && fi.quantity > 1) || fi.grams) {
              setConsumeDialogItem(fi);
              setConsumeQty(fi.quantity ? "1" : "");
              setConsumeGrams("");
            } else {
              onMoveToPossible(fi);
            }
          }}
          className="shrink-0 h-7 w-7 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white transition-colors"
          title="Ajouter aux possibles"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  };

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4 mt-4">
      <div className="flex items-center gap-2 w-full">
        <div
          role="button"
          tabIndex={0}
          onClick={onToggleCollapse}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapse(); } }}
          className="flex items-center gap-2 flex-1 cursor-pointer select-none"
        >
          {!collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            🔀 Un par un
          </h2>
          <span className="text-sm font-normal text-muted-foreground">{totalCount}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onToggleSort(); }} className="text-[10px] gap-0.5 h-6 px-1.5">
          <SortIcon className="h-3 w-3" />
          <span className="hidden sm:inline">{sortLabel}</span>
        </Button>
      </div>

      {consumeDialogItem && (
        <div className="mt-3 rounded-2xl bg-muted/50 border p-3">
          <p className="text-sm font-semibold text-foreground mb-2">Consommer « {consumeDialogItem.name} »</p>
          <div className="flex gap-2 items-center mb-2">
            {consumeDialogItem.quantity && consumeDialogItem.quantity > 1 && (
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground">Quantité (max {consumeDialogItem.quantity})</label>
                <Input value={consumeQty} onChange={e => setConsumeQty(e.target.value)} placeholder="1" inputMode="numeric" className="h-8 rounded-xl text-sm" autoFocus />
              </div>
            )}
            {consumeDialogItem.grams && (
              <div className="flex-1">
                <label className="text-[10px] text-muted-foreground">Grammes</label>
                <Input value={consumeGrams} onChange={e => setConsumeGrams(e.target.value)} placeholder={`max ${getFoodItemTotalGrams(consumeDialogItem)}g`} inputMode="decimal" className="h-8 rounded-xl text-sm" autoFocus={!consumeDialogItem.quantity || consumeDialogItem.quantity <= 1} />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleConsumeConfirm} className="flex-1 rounded-xl text-xs">Confirmer</Button>
            <Button size="sm" variant="ghost" onClick={() => { setConsumeDialogItem(null); setConsumeQty(""); setConsumeGrams(""); }} className="rounded-xl text-xs">Annuler</Button>
          </div>
        </div>
      )}

      {!collapsed && (
        <div className={`grid grid-cols-2 gap-3 mt-3 ${touchActive ? "touch-none" : ""}`}>
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
              <Drumstick className="h-3 w-3 text-red-400" /> Viande ({sortedViande.length})
            </p>
            {sortedViande.length === 0 && <p className="text-muted-foreground text-xs italic text-center py-4">Aucun</p>}
            {sortedViande.map((fi, idx) => renderFoodCard(fi, 'viande', idx))}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1">
              <Wheat className="h-3 w-3 text-amber-400" /> Féculent ({sortedFeculent.length})
            </p>
            {sortedFeculent.length === 0 && <p className="text-muted-foreground text-xs italic text-center py-4">Aucun</p>}
            {sortedFeculent.map((fi, idx) => renderFoodCard(fi, 'feculent', idx))}
          </div>
        </div>
      )}
    </div>
  );
}
