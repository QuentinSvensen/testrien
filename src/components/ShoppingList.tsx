import { useState, useRef, useEffect, useMemo, forwardRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { z } from "zod";
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, Search, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useShoppingList, type ShoppingItem } from "@/hooks/useShoppingList";
import { usePreferences } from "@/hooks/usePreferences";
import { toast } from "@/hooks/use-toast";
import { normalizeForMatch, normalizeKey, smartFoodContains } from "@/lib/ingredientUtils";
import { useFoodItems } from "@/hooks/useFoodItems";

// ─── Validation schemas ───────────────────────────────────────────────────────
const shoppingItemSchema = z.object({
  name: z.string().trim().min(1, "Le nom est requis").max(100, "Nom trop long (100 car. max)"),
});

const shoppingGroupSchema = z.object({
  name: z.string().trim().min(1, "Le nom du groupe est requis").max(60, "Nom trop long (60 car. max)"),
});

// ─── drag state stored as module-level ref to avoid stale closures ───────────
type DragPayload =
  | { kind: "item"; id: string; groupId: string | null }
  | { kind: "group"; id: string };

export const ShoppingList = forwardRef<HTMLDivElement>(function ShoppingList(_props, ref) {
  const {
    groups, ungroupedItems, items,
    addGroup, renameGroup, deleteGroup,
    addItem, toggleItem, updateItemQuantity, updateItemBrand, updateItemContentQuantity, toggleSecondaryCheck, updateItemContentQuantityType, renameItem, deleteItem,
    getItemsByGroup, reorderItems, reorderGroups,
  } = useShoppingList();
  const isMobile = useIsMobile();
  const { getPreference, setPreference } = usePreferences();

  const { items: foodItems } = useFoodItems();

  // Color palette for paired ambiguous groups
  const ambiguousColors = [
    { bg: 'bg-blue-500', border: 'border-blue-500', borderLight: 'border-blue-500/50', text: 'text-blue-500', hover: 'hover:bg-blue-500/10', checkedText: 'text-white' },
    { bg: 'bg-purple-500', border: 'border-purple-500', borderLight: 'border-purple-500/50', text: 'text-purple-500', hover: 'hover:bg-purple-500/10', checkedText: 'text-white' },
    { bg: 'bg-pink-500', border: 'border-pink-500', borderLight: 'border-pink-500/50', text: 'text-pink-500', hover: 'hover:bg-pink-500/10', checkedText: 'text-white' },
    { bg: 'bg-cyan-500', border: 'border-cyan-500', borderLight: 'border-cyan-500/50', text: 'text-cyan-500', hover: 'hover:bg-cyan-500/10', checkedText: 'text-white' },
    { bg: 'bg-teal-500', border: 'border-teal-500', borderLight: 'border-teal-500/50', text: 'text-teal-500', hover: 'hover:bg-teal-500/10', checkedText: 'text-white' },
    { bg: 'bg-indigo-500', border: 'border-indigo-500', borderLight: 'border-indigo-500/50', text: 'text-indigo-500', hover: 'hover:bg-indigo-500/10', checkedText: 'text-white' },
    { bg: 'bg-rose-500', border: 'border-rose-500', borderLight: 'border-rose-500/50', text: 'text-rose-500', hover: 'hover:bg-rose-500/10', checkedText: 'text-white' },
    { bg: 'bg-sky-500', border: 'border-sky-500', borderLight: 'border-sky-500/50', text: 'text-sky-500', hover: 'hover:bg-sky-500/10', checkedText: 'text-white' },
  ];

  // Build set of "Toujours présent" food item keys
  const toujoursFoodKeys = useMemo(() => {
    return new Set(
      foodItems.filter(fi => fi.storage_type === 'toujours').map(fi => normalizeKey(fi.name))
    );
  }, [foodItems]);

  // Check if a shopping item matches a "Toujours présent" food item (smart matching)
  const isToujoursPresent = useMemo(() => {
    const result = new Set<string>();
    if (toujoursFoodKeys.size === 0) return result;
    for (const si of items) {
      const siKey = normalizeKey(si.name);
      for (const tjKey of toujoursFoodKeys) {
        if (siKey === tjKey || smartFoodContains(si.name, tjKey)) {
          result.add(si.id);
          break;
        }
      }
    }
    return result;
  }, [items, toujoursFoodKeys]);

  // Compute which items have ambiguous partial matches with menu ingredients (ONLY multi-match)
  // Returns ALL items in ambiguous groups, plus tracks which needKey has a confirmed item
  const needsRaw = getPreference<Record<string, { grams: number; count: number }>>('menu_generator_needs_v1', {});
  const needsJson = JSON.stringify(needsRaw);

  const { ambiguousItemData, confirmedAmbiguous } = useMemo(() => {
    const needs: Record<string, { grams: number; count: number }> = JSON.parse(needsJson);
    const ingredientKeys = Object.keys(needs);
    const itemToGroup = new Map<string, { colorIndex: number; needKey: string }>();
    const confirmed = new Map<string, string>(); // needKey → confirmed itemId
    if (ingredientKeys.length === 0) return { ambiguousItemData: itemToGroup, confirmedAmbiguous: confirmed };

    let colorIndex = 0;

    for (const ingKey of ingredientKeys) {
      const matchingItems: string[] = [];
      let hasExactMatch = false;

      for (const si of items) {
        if (isToujoursPresent.has(si.id)) continue;
        const siKey = normalizeKey(si.name);
        const ingKeyNorm = normalizeKey(ingKey);
        if (siKey === ingKeyNorm) {
          hasExactMatch = true;
        } else if (smartFoodContains(si.name, ingKey)) {
          matchingItems.push(si.id);
        }
      }

      if (!hasExactMatch && matchingItems.length > 1) {
        const groupColor = colorIndex % ambiguousColors.length;
        matchingItems.forEach(id => itemToGroup.set(id, { colorIndex: groupColor, needKey: ingKey }));
        colorIndex++;
        // Track if one is already confirmed
        const confirmedItem = matchingItems.find(id => items.find(i => i.id === id)?.secondary_checked);
        if (confirmedItem) {
          confirmed.set(ingKey, confirmedItem);
        }
      }
    }

    return { ambiguousItemData: itemToGroup, confirmedAmbiguous: confirmed };
  }, [items, needsJson, isToujoursPresent]);

  // Track dismissed ambiguous groups (user double-clicked to fully dismiss)
  const [dismissedAmbiguous, setDismissedAmbiguous] = useState<Set<string>>(new Set());
  // Reset dismissed state when menu is regenerated (needs change)
  const prevNeedsJson = useRef(needsJson);
  useEffect(() => {
    if (needsJson !== prevNeedsJson.current) {
      prevNeedsJson.current = needsJson;
      setDismissedAmbiguous(new Set());
    }
  }, [needsJson]);

  // An item shows the colored ❓ if it's in an ambiguous group AND either:
  // - no item in the group is confirmed yet, OR
  // - this item IS the confirmed one (shows as green ✓ but still handled by ambiguous logic)
  const ambiguousItemIds = useMemo(() => {
    const visibleSet = new Set<string>();
    for (const [itemId, data] of ambiguousItemData) {
      if (dismissedAmbiguous.has(data.needKey)) continue;
      const confirmedId = confirmedAmbiguous.get(data.needKey);
      if (!confirmedId || confirmedId === itemId) {
        visibleSet.add(itemId);
      }
    }
    return visibleSet;
  }, [ambiguousItemData, confirmedAmbiguous, dismissedAmbiguous]);
  const [newGroupName, setNewGroupName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [newItemTexts, setNewItemTexts] = useState<Record<string, string>>({});
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");

  // Session defaults: mobile=collapsed, desktop=expanded — always applied fresh each session
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    if (isMobile) {
      return new Set(["__ungrouped"]);
    }
    return new Set();
  });
  // Apply after groups load
  const sessionDefaultApplied = useRef(false);
  useEffect(() => {
    if (sessionDefaultApplied.current || groups.length === 0) return;
    sessionDefaultApplied.current = true;
    if (isMobile) {
      const allIds = ["__ungrouped", ...groups.map(g => g.id)];
      setCollapsedGroups(new Set(allIds));
    } else {
      setCollapsedGroups(new Set());
    }
  }, [isMobile, groups]);

  // per-item editing state: "brand" | "qty" | "nb" | null
  const [editingField, setEditingField] = useState<Record<string, "brand" | "qty" | "nb" | null>>({});

  // Debounce timers
  const nameTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const brandTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const quantityTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const nbTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Local state for controlled inputs
  const [localNames, setLocalNames] = useState<Record<string, string>>({});
  const [localBrands, setLocalBrands] = useState<Record<string, string>>({});
  const [localQuantities, setLocalQuantities] = useState<Record<string, string>>({});
  const [localNbs, setLocalNbs] = useState<Record<string, string>>({});

  // Track last ambiguous uncheck time per needKey for double-click detection
  const lastAmbiguousUncheck = useRef<Record<string, number>>({});

  // Drag state
  const dragPayload = useRef<DragPayload | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const normalizeSearch = (text: string) =>
    text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/s$/, "").trim();

  const matchesSearch = (item: ShoppingItem) => {
    if (!searchQuery.trim()) return true;
    const q = normalizeSearch(searchQuery);
    const inName = normalizeSearch(item.name).includes(q);
    const inBrand = item.brand ? normalizeSearch(item.brand).includes(q) : false;
    return inName || inBrand;
  };

  const getLocalName = (item: ShoppingItem) => localNames[item.id] ?? item.name;
  const getLocalBrand = (item: ShoppingItem) => localBrands[item.id] ?? (item.brand || "");
  const getLocalQuantity = (item: ShoppingItem) => localQuantities[item.id] ?? (item.quantity || "");
  const getLocalNb = (item: ShoppingItem) => localNbs[item.id] ?? (item.content_quantity || "");

  const handleNbChange = (item: ShoppingItem, value: string) => {
    setLocalNbs(prev => ({ ...prev, [item.id]: value }));
    clearTimeout(nbTimers.current[item.id]);
    nbTimers.current[item.id] = setTimeout(() => {
      updateItemContentQuantity.mutate({ id: item.id, content_quantity: value || null });
    }, 600);
  };

  const commitNb = (item: ShoppingItem) => {
    const val = getLocalNb(item);
    updateItemContentQuantity.mutate({ id: item.id, content_quantity: val || null });
    setEditingField(prev => ({ ...prev, [item.id]: null }));
  };

  const handleNameChange = (item: ShoppingItem, value: string) => {
    setLocalNames(prev => ({ ...prev, [item.id]: value }));
    clearTimeout(nameTimers.current[item.id]);
    nameTimers.current[item.id] = setTimeout(() => {
      if (value.trim()) renameItem.mutate({ id: item.id, name: value.trim() });
    }, 600);
  };

  const handleBrandChange = (item: ShoppingItem, value: string) => {
    setLocalBrands(prev => ({ ...prev, [item.id]: value }));
    clearTimeout(brandTimers.current[item.id]);
    brandTimers.current[item.id] = setTimeout(() => {
      updateItemBrand.mutate({ id: item.id, brand: value || null });
    }, 600);
  };

  const handleQuantityChange = (item: ShoppingItem, value: string) => {
    setLocalQuantities(prev => ({ ...prev, [item.id]: value }));
    clearTimeout(quantityTimers.current[item.id]);
    quantityTimers.current[item.id] = setTimeout(() => {
      updateItemQuantity.mutate({ id: item.id, quantity: value || null });
    }, 600);
  };

  const commitBrand = (item: ShoppingItem) => {
    const val = getLocalBrand(item);
    updateItemBrand.mutate({ id: item.id, brand: val || null });
    setEditingField(prev => ({ ...prev, [item.id]: null }));
  };

  const commitQty = (item: ShoppingItem) => {
    const val = getLocalQuantity(item);
    updateItemQuantity.mutate({ id: item.id, quantity: val || null });
    // Always close editing on commit (whether empty or not)
    setEditingField(prev => ({ ...prev, [item.id]: null }));
  };

  const toggleCollapse = (id: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      setPreference.mutate({ key: 'shopping_collapsed_groups', value: Array.from(next) });
      return next;
    });
  };

  const handleAddGroup = () => {
    const result = shoppingGroupSchema.safeParse({ name: newGroupName });
    if (!result.success) {
      toast({ title: "Données invalides", description: result.error.issues[0].message, variant: "destructive" });
      return;
    }
    addGroup.mutate(result.data.name);
    setNewGroupName("");
  };

  const handleAddItem = (groupId: string | null) => {
    const key = groupId || "__ungrouped";
    const result = shoppingItemSchema.safeParse({ name: newItemTexts[key] || "" });
    if (!result.success) return; // silent: empty field, user hasn't typed yet
    addItem.mutate({ name: result.data.name, group_id: groupId });
    setNewItemTexts(prev => ({ ...prev, [key]: "" }));
  };

  // ── Drag & Drop ────────────────────────────────────────────────────────────

  const handleItemDragStart = (e: React.DragEvent, item: ShoppingItem) => {
    e.stopPropagation();
    dragPayload.current = { kind: "item", id: item.id, groupId: item.group_id };
    e.dataTransfer.effectAllowed = "move";
  };

  const handleGroupDragStart = (e: React.DragEvent, groupId: string) => {
    dragPayload.current = { kind: "group", id: groupId };
    e.dataTransfer.effectAllowed = "move";
  };

  // Drop ON an item → insert before that item in its group
  const handleDropOnItem = (e: React.DragEvent, targetItem: ShoppingItem) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverKey(null);
    const payload = dragPayload.current;
    if (!payload || payload.kind !== "item") return;

    const targetGroupId = targetItem.group_id;
    const targetGroupItems = (targetGroupId
      ? getItemsByGroup(targetGroupId)
      : ungroupedItems
    ).filter(i => i.id !== payload.id);

    const targetIdx = targetGroupItems.findIndex(i => i.id === targetItem.id);
    const insertAt = targetIdx === -1 ? targetGroupItems.length : targetIdx;

    targetGroupItems.splice(insertAt, 0, { id: payload.id } as ShoppingItem);
    const updates = targetGroupItems.map((i, idx) => ({
      id: i.id,
      sort_order: idx,
      group_id: targetGroupId,
    }));
    reorderItems.mutate(updates);
    dragPayload.current = null;
  };

  // Drop on group header / container → append to end of that group
  const handleDropOnGroup = (e: React.DragEvent, targetGroupId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverKey(null);
    const payload = dragPayload.current;
    if (!payload) return;

    if (payload.kind === "item") {
      const groupItems = (targetGroupId ? getItemsByGroup(targetGroupId) : ungroupedItems)
        .filter(i => i.id !== payload.id);
      const updates = [...groupItems, { id: payload.id } as ShoppingItem].map((i, idx) => ({
        id: i.id,
        sort_order: idx,
        group_id: targetGroupId,
      }));
      reorderItems.mutate(updates);
    } else if (payload.kind === "group" && targetGroupId && payload.id !== targetGroupId) {
      const fromIdx = groups.findIndex(g => g.id === payload.id);
      const toIdx = groups.findIndex(g => g.id === targetGroupId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const reordered = [...groups];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);
        reorderGroups.mutate(reordered.map((g, i) => ({ id: g.id, sort_order: i })));
      }
    }
    dragPayload.current = null;
  };

  // ── Render item ────────────────────────────────────────────────────────────

  const renderItem = (item: ShoppingItem) => {
    const fieldEditing = editingField[item.id] ?? null;
    const brand = getLocalBrand(item);
    const qty = getLocalQuantity(item);
    const nb = getLocalNb(item);
    const isBrandEditing = fieldEditing === "brand";
    const isQtyEditing = fieldEditing === "qty";
    const isNbEditing = fieldEditing === "nb";
    const isOver = dragOverKey === `item:${item.id}`;
    const isAmbiguous = ambiguousItemIds.has(item.id);

    return (
      <div key={item.id}
        draggable
        onDragStart={(e) => handleItemDragStart(e, item)}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverKey(`item:${item.id}`); }}
        onDragLeave={() => setDragOverKey(null)}
        onDrop={(e) => handleDropOnItem(e, item)}
        className={`flex items-center gap-0.5 py-1.5 pl-0.5 pr-1 rounded-lg transition-colors cursor-grab active:cursor-grabbing ${isOver ? 'ring-2 ring-primary/60 bg-primary/5' : ''} ${!item.checked ? 'opacity-40' : ''}`}
      >
        {/* Secondary checkbox OR ambiguous indicator (clickable with group color) */}
        {isAmbiguous ? (() => {
          const ambData = ambiguousItemData.get(item.id);
          const colorIdx = ambData?.colorIndex ?? 0;
          const color = ambiguousColors[colorIdx % ambiguousColors.length];
          const needKey = ambData?.needKey;

          // Compute suggested quantity from menu needs
          const computeSuggestedQty = () => {
            if (!needKey) return 1;
            const needsRaw = getPreference<Record<string, { grams: number; count: number }>>('menu_generator_needs_v1', {});
            const need = needsRaw[needKey];
            if (!need) return 1;
            const nb = item.content_quantity ? parseFloat(item.content_quantity.replace(/[^0-9.,]/g, '').replace(',', '.')) : 0;
            const nbType = (item as any).content_quantity_type;
            if (nb > 0 && (nbType === 'g' || (!nbType && /g/i.test(item.content_quantity || ''))) && need.grams > 0) return Math.ceil(need.grams / nb);
            if (nb > 0 && need.count > 0) return Math.ceil(need.count / nb);
            if (need.count > 0) return Math.ceil(need.count);
            return 1;
          };

          return (
            <button
              onClick={() => {
                const now = Date.now();
                const lastUncheck = needKey ? (lastAmbiguousUncheck.current[needKey] || 0) : 0;
                const isQuickReclick = now - lastUncheck < 800;

                if (!item.secondary_checked && !isQuickReclick) {
                  // Check this item (confirm choice)
                  toggleSecondaryCheck.mutate({ id: item.id, secondary_checked: true });
                  const qty = computeSuggestedQty();
                  updateItemQuantity.mutate({ id: item.id, quantity: String(qty) });
                  setLocalQuantities(prev => ({ ...prev, [item.id]: String(qty) }));
                  // Uncheck siblings in same ambiguous group
                  if (needKey) {
                    for (const [sibId, sibData] of ambiguousItemData) {
                      if (sibId !== item.id && sibData.needKey === needKey) {
                        const sibItem = items.find(i => i.id === sibId);
                        if (sibItem?.secondary_checked) {
                          toggleSecondaryCheck.mutate({ id: sibId, secondary_checked: false });
                          updateItemQuantity.mutate({ id: sibId, quantity: null });
                          setLocalQuantities(prev => { const next = { ...prev }; delete next[sibId]; return next; });
                        }
                      }
                    }
                  }
                } else if (item.secondary_checked) {
                  // Uncheck from green ✓ → siblings will reappear as ❓
                  toggleSecondaryCheck.mutate({ id: item.id, secondary_checked: false });
                  updateItemQuantity.mutate({ id: item.id, quantity: null });
                  setLocalQuantities(prev => { const next = { ...prev }; delete next[item.id]; return next; });
                  if (needKey) {
                    lastAmbiguousUncheck.current[needKey] = now;
                  }
                } else if (isQuickReclick) {
                  // Quick re-click on ❓ after uncheck → dismiss the whole ambiguous group
                  if (needKey) {
                    setDismissedAmbiguous(prev => new Set([...prev, needKey]));
                  }
                } else {
                  // Normal click on unchecked ❓ that was already unchecked → just uncheck
                  toggleSecondaryCheck.mutate({ id: item.id, secondary_checked: false });
                  updateItemQuantity.mutate({ id: item.id, quantity: null });
                  setLocalQuantities(prev => { const next = { ...prev }; delete next[item.id]; return next; });
                }
              }}
              className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold transition-colors ${
                item.secondary_checked 
                  ? `bg-green-400 border-green-400 text-white` 
                  : `${color.borderLight} ${color.text} ${color.hover}`
              }`}
              title="Plusieurs articles correspondent à un ingrédient du menu"
            >
              {item.secondary_checked ? '✓' : '?'}
            </button>
          );
        })() : (
          <Checkbox
            checked={item.secondary_checked}
            onCheckedChange={(checked) => {
              toggleSecondaryCheck.mutate({ id: item.id, secondary_checked: !!checked });
              if (!checked) {
                updateItemQuantity.mutate({ id: item.id, quantity: null });
                setLocalQuantities(prev => { const next = { ...prev }; delete next[item.id]; return next; });
              } else {
                // Re-checking green: restore the needed quantity from persisted menu needs
                const needsRaw = getPreference<Record<string, { grams: number; count: number }>>('menu_generator_needs_v1', {});
                const normalizeKey = (name: string) => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").replace(/s$/, "").trim();
                const itemKey = normalizeKey(item.name);
                for (const [needKey, need] of Object.entries(needsRaw)) {
                  if (itemKey === needKey || normalizeKey(needKey) === itemKey) {
                    const nb = item.content_quantity ? parseFloat(item.content_quantity.replace(/[^0-9.,]/g, '').replace(',', '.')) : 0;
                    const nbType = (item as any).content_quantity_type;
                    let qtyNeeded = 1;
                    if (nb > 0 && (nbType === 'g' || (!nbType && /g/i.test(item.content_quantity || ''))) && need.grams > 0) {
                      qtyNeeded = Math.ceil(need.grams / nb);
                    } else if (nb > 0 && need.count > 0) {
                      qtyNeeded = Math.ceil(need.count / nb);
                    } else if (need.count > 0) {
                      qtyNeeded = Math.ceil(need.count);
                    }
                    updateItemQuantity.mutate({ id: item.id, quantity: String(qtyNeeded) });
                    setLocalQuantities(prev => ({ ...prev, [item.id]: String(qtyNeeded) }));
                    break;
                  }
                }
              }
            }}
            className="shrink-0 opacity-100 data-[state=checked]:bg-green-400 data-[state=checked]:border-green-400 data-[state=checked]:text-white"
          />
        )}

        {/* Primary checkbox */}
        <Checkbox
          checked={item.checked}
          onCheckedChange={(checked) => {
            toggleItem.mutate({ id: item.id, checked: !!checked });
            if (!checked) {
              // Unchecking yellow also unchecks green
              if (item.secondary_checked) {
                toggleSecondaryCheck.mutate({ id: item.id, secondary_checked: false });
              }
              updateItemQuantity.mutate({ id: item.id, quantity: null });
              setLocalQuantities(prev => { const next = { ...prev }; delete next[item.id]; return next; });
            }
          }}
          className={`shrink-0 opacity-100 ${item.checked ? 'border-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black' : ''}`}
        />

        {/* Nb (content quantity) — small cell before name */}
        {isNbEditing ? (
          <div className="flex items-center gap-0 shrink-0">
            <Input
              autoFocus
              placeholder="Nb"
              value={nb}
              onChange={(e) => handleNbChange(item, e.target.value)}
              onBlur={() => commitNb(item)}
              onKeyDown={(e) => { if (e.key === "Enter") commitNb(item); }}
              className="h-6 w-12 text-[10px] border-border bg-background px-1"
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                const cur = (item as any).content_quantity_type;
                const next = cur === 'g' ? 'qty' : 'g';
                updateItemContentQuantityType.mutate({ id: item.id, content_quantity_type: next });
              }}
              className="text-[8px] font-bold text-muted-foreground/60 hover:text-muted-foreground px-0.5 h-6 flex items-center"
              title="Basculer grammes/quantité"
            >
              {(item as any).content_quantity_type === 'g' ? 'g' : '#'}
            </button>
          </div>
        ) : (
          nb ? (
            <div className="flex items-center gap-0 shrink-0">
              <button
                onClick={() => setEditingField(prev => ({ ...prev, [item.id]: "nb" }))}
                className="text-[10px] px-0.5 rounded hover:bg-muted/60 transition-colors text-muted-foreground font-medium"
              >
                {nb}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const cur = (item as any).content_quantity_type;
                  const next = cur === 'g' ? 'qty' : 'g';
                  updateItemContentQuantityType.mutate({ id: item.id, content_quantity_type: next });
                }}
                className="text-[8px] font-bold text-muted-foreground/40 hover:text-muted-foreground px-0.5"
                title="Basculer grammes/quantité"
              >
                {(item as any).content_quantity_type === 'g' ? 'g' : '#'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingField(prev => ({ ...prev, [item.id]: "nb" }))}
              className="text-[9px] shrink-0 px-0.5 rounded hover:bg-muted/60 transition-colors text-muted-foreground/20"
            >
              Nb
            </button>
          )
        )}

        {/* Name — auto-width */}
        <input
          value={getLocalName(item)}
          onChange={(e) => handleNameChange(item, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          size={Math.max(1, getLocalName(item).length)}
          className={`h-6 text-sm bg-transparent px-0.5 font-medium min-w-[2ch] outline-none focus:ring-1 focus:ring-ring rounded ${!item.checked ? 'line-through text-muted-foreground' : 'text-foreground'}`}
        />

        {/* Brand — inline right after name */}
        {isBrandEditing ? (
          <Input
            autoFocus
            placeholder="Marque"
            value={brand}
            onChange={(e) => handleBrandChange(item, e.target.value)}
            onBlur={() => commitBrand(item)}
            onKeyDown={(e) => { if (e.key === "Enter") commitBrand(item); }}
            className="h-6 w-20 text-xs italic border-border bg-background px-1 shrink-0"
          />
        ) : (
          brand ? (
            <button
              onClick={() => setEditingField(prev => ({ ...prev, [item.id]: "brand" }))}
              className="text-xs italic shrink-0 px-0.5 rounded hover:bg-muted/60 transition-colors text-muted-foreground"
            >
              {brand}
            </button>
          ) : (
            <button
              onClick={() => setEditingField(prev => ({ ...prev, [item.id]: "brand" }))}
              className="text-[9px] shrink-0 px-0.5 rounded hover:bg-muted/60 transition-colors text-muted-foreground/20"
            >
              Mq
            </button>
          )
        )}

        {/* Quantity — inline right after brand */}
        {isQtyEditing ? (
          <div className="flex items-baseline gap-0.5 shrink-0">
            <span className="text-sm font-bold text-foreground">×</span>
            <Input
              autoFocus
              placeholder="Qté"
              value={qty}
              onChange={(e) => handleQuantityChange(item, e.target.value)}
              onBlur={() => commitQty(item)}
              onKeyDown={(e) => { if (e.key === "Enter") commitQty(item); }}
              className="h-6 w-12 text-sm font-bold border-border bg-background px-1 shrink-0"
            />
          </div>
        ) : (
          qty ? (
            <button
              onClick={() => setEditingField(prev => ({ ...prev, [item.id]: "qty" }))}
              className="shrink-0 px-0.5 rounded hover:bg-muted/60 transition-colors"
            >
              <span className={`text-sm font-bold ${item.secondary_checked ? 'text-green-500' : 'text-foreground'}`}>×{qty}</span>
            </button>
          ) : (
            <button
              onClick={() => setEditingField(prev => ({ ...prev, [item.id]: "qty" }))}
              className="shrink-0 px-0.5 rounded hover:bg-muted/60 transition-colors text-[9px] text-muted-foreground/20"
            >
              Qté
            </button>
          )
        )}

        <div className="flex-1" />
        <Button size="icon" variant="ghost" onClick={() => deleteItem.mutate(item.id)} className="h-5 w-5 text-muted-foreground hover:text-destructive shrink-0">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  const renderAddInput = (groupId: string | null) => {
    const key = groupId || "__ungrouped";
    return (
      <div className="flex gap-1 mt-1.5 opacity-25 hover:opacity-70 transition-opacity focus-within:opacity-100">
        <Input
          placeholder="Ajouter un article…"
          value={newItemTexts[key] || ""}
          onChange={(e) => setNewItemTexts(prev => ({ ...prev, [key]: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && handleAddItem(groupId)}
          className="h-6 text-xs border-dashed border-border/40 bg-transparent focus:bg-background"
        />
        <Button size="sm" variant="ghost" onClick={() => handleAddItem(groupId)} className="h-6 shrink-0 px-1.5 opacity-60">
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Rechercher dans les courses…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 rounded-xl pl-7"
        />
      </div>
      {/* Ungrouped items */}
      <div
        draggable
        className={`bg-card/80 backdrop-blur-sm rounded-2xl p-3 cursor-grab active:cursor-grabbing ${dragOverKey === 'ungrouped' ? 'ring-2 ring-primary/60' : ''}`}
        onDragStart={(e) => { dragPayload.current = { kind: "group", id: "__ungrouped" }; e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => { e.preventDefault(); setDragOverKey('ungrouped'); }}
        onDragLeave={() => setDragOverKey(null)}
        onDrop={(e) => handleDropOnGroup(e, null)}
      >
        <button onClick={() => toggleCollapse("__ungrouped")} className="flex items-center gap-2 w-full text-left mb-1.5">
          {collapsedGroups.has("__ungrouped") ? <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
          <h3 className="text-xs font-extrabold text-foreground/60 uppercase tracking-widest">Articles</h3>
          <span className="text-[10px] font-bold text-foreground bg-foreground/10 rounded-full px-2 py-0.5 shrink-0">{ungroupedItems.filter(matchesSearch).length}</span>
        </button>
        {collapsedGroups.has("__ungrouped")
          ? ungroupedItems.filter(matchesSearch).filter(i => i.checked).map(renderItem)
          : ungroupedItems.filter(matchesSearch).map(renderItem)
        }
        {!collapsedGroups.has("__ungrouped") && renderAddInput(null)}
      </div>

      {/* Groups */}
      {groups.map((group) => {
        const groupItems = getItemsByGroup(group.id).filter(matchesSearch);
        const isCollapsed = collapsedGroups.has(group.id);
        const isGroupOver = dragOverKey === `group:${group.id}`;
        return (
          <div key={group.id}
            draggable
            onDragStart={(e) => handleGroupDragStart(e, group.id)}
            onDragOver={(e) => { e.preventDefault(); setDragOverKey(`group:${group.id}`); }}
            onDragLeave={() => setDragOverKey(null)}
            onDrop={(e) => handleDropOnGroup(e, group.id)}
            className={`bg-card/80 backdrop-blur-sm rounded-2xl p-3 cursor-grab active:cursor-grabbing ${isGroupOver ? 'ring-2 ring-primary/60' : ''}`}>
            {/* Group header */}
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleCollapse(group.id)} className="text-muted-foreground shrink-0">
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {editingGroup === group.id ? (
                <Input autoFocus value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  onBlur={() => { if (editGroupName.trim()) renameGroup.mutate({ id: group.id, name: editGroupName.trim() }); setEditingGroup(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { if (editGroupName.trim()) renameGroup.mutate({ id: group.id, name: editGroupName.trim() }); setEditingGroup(null); } }}
                  className="h-7 text-sm font-bold flex-1" />
              ) : (
                <h3 className="text-base font-black text-foreground flex-1 tracking-wider uppercase">{group.name}</h3>
              )}
              <span className="text-[10px] font-bold text-foreground bg-foreground/10 rounded-full px-2 py-0.5 shrink-0">{groupItems.length}</span>
              <Button size="icon" variant="ghost" onClick={() => { setEditGroupName(group.name); setEditingGroup(group.id); }} className="h-6 w-6 text-muted-foreground/50 hover:text-muted-foreground">
                <Pencil className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => deleteGroup.mutate(group.id)} className="h-6 w-6 text-muted-foreground/50 hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {isCollapsed
              ? groupItems.filter(i => i.checked).map(renderItem)
              : (
              <>
                {groupItems.map(renderItem)}
                {renderAddInput(group.id)}
              </>
            )}
          </div>
        );
      })}

      {/* Add group — more discreet */}
      <div className="flex gap-2 opacity-15 hover:opacity-50 transition-opacity focus-within:opacity-100">
        <Input
          placeholder="Nouveau groupe…"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddGroup()}
          className="h-6 text-xs border-dashed border-border/30 bg-transparent focus:bg-background"
        />
        <Button variant="ghost" onClick={handleAddGroup} disabled={!newGroupName.trim()} className="shrink-0 gap-1 text-xs h-6 border border-dashed border-border/30 px-2">
          <Plus className="h-3 w-3" /> Groupe
        </Button>
      </div>
    </div>
  );
});
