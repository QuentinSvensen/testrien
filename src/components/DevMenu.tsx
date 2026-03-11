import { Download, Upload, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { colorFromName } from "@/lib/foodColors";
import type { MealCategory, Meal } from "@/hooks/useMeals";
import type { ShoppingGroup, ShoppingItem } from "@/hooks/useShoppingList";

function validateMealName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Le nom est requis";
  if (trimmed.length > 100) return "Nom trop long (100 car. max)";
  return null;
}

interface DevMenuProps {
  onClose: () => void;
  getMealsByCategory: (cat: MealCategory) => Meal[];
  shoppingGroups: ShoppingGroup[];
  shoppingItems: ShoppingItem[];
  blockedCount: number | null;
  setBlockedCount: (n: number) => void;
}

export function DevMenu({ onClose, getMealsByCategory, shoppingGroups, shoppingItems, blockedCount, setBlockedCount }: DevMenuProps) {
  const handleExportMeals = () => {
    const allCats: MealCategory[] = ["plat", "entree", "dessert", "bonus", "petit_dejeuner"];
    const lines = allCats.flatMap((cat) => getMealsByCategory(cat)).map((m) => {
      const parts: string[] = [`cat=${m.category}`];
      if (m.calories) parts.push(`cal=${m.calories}`);
      if (m.protein) parts.push(`prot=${m.protein}`);
      if (m.grams) parts.push(`grams=${m.grams}`);
      if (m.ingredients) parts.push(`ing=${m.ingredients.replace(/\n/g, ', ')}`);
      if (m.oven_temp) parts.push(`oven_temp=${m.oven_temp}`);
      if (m.oven_minutes) parts.push(`oven_minutes=${m.oven_minutes}`);
      if (m.is_favorite) parts.push(`fav=1`);
      return `${m.name} (${parts.join('; ')})`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'repas.txt'; a.click();
    toast({ title: `✅ ${lines.length} repas exportés` });
    onClose();
  };

  const handleImportMeals = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.txt';
    input.onchange = async (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.type !== 'text/plain' && !file.name.toLowerCase().endsWith('.txt')) {
        toast({ title: '❌ Format invalide', description: 'Seuls les fichiers .txt sont acceptés.', variant: 'destructive' });
        return;
      }
      const text = await file.text();
      const lineParts = text.split('\n').map((l) => l.trim()).filter(Boolean);
      let count = 0, skipped = 0;
      for (const line of lineParts) {
        const match = line.match(/^(.+?)\s*\((.+)\)$/);
        const name = match ? match[1].trim() : line;
        const paramsStr = match ? match[2] : '';
        const params: Record<string, string> = {};
        paramsStr.split(';').forEach((p) => { const [k, ...v] = p.split('='); if (k) params[k.trim()] = v.join('=').trim(); });
        const validationErr = validateMealName(name);
        if (validationErr) { skipped++; continue; }
        const cat = (params.cat as MealCategory) || 'plat';
        const { data: inserted, error: insertErr } = await supabase.from("meals").insert({
          name: name.trim(), category: cat, color: colorFromName(name.trim()), sort_order: count, is_available: true,
          calories: params.cal || null, protein: params.prot || null, grams: params.grams || null, ingredients: params.ing || null,
          oven_temp: params.oven_temp || null, oven_minutes: params.oven_minutes || null, is_favorite: params.fav === '1',
        } as any).select().single();
        if (insertErr) { skipped++; continue; }
        if (inserted) await supabase.from("meals").update({ color: colorFromName(inserted.id) }).eq("id", inserted.id);
        count++;
      }
      toast({ title: skipped > 0 ? `✅ ${count} repas importés (${skipped} ignorés)` : `✅ ${count} repas importés` });
      onClose();
    };
    input.click();
  };

  const handleExportShopping = () => {
    const lines: string[] = [];
    for (const group of shoppingGroups) {
      lines.push(`[${group.name}]`);
      const groupItems = shoppingItems.filter((i) => i.group_id === group.id).sort((a, b) => a.sort_order - b.sort_order);
      for (const item of groupItems) {
        const parts: string[] = [];
        if (item.quantity) parts.push(`qte=${item.quantity}`);
        if (item.brand) parts.push(`marque=${item.brand}`);
        if (item.content_quantity) parts.push(`cqte=${item.content_quantity}`);
        if (item.content_quantity_type) parts.push(`ctype=${item.content_quantity_type}`);
        if (item.checked) parts.push(`coche=1`);
        if (item.secondary_checked) parts.push(`coche2=1`);
        lines.push(parts.length > 0 ? `${item.name} (${parts.join('; ')})` : item.name);
      }
    }
    const ungrouped = shoppingItems.filter((i) => !i.group_id).sort((a, b) => a.sort_order - b.sort_order);
    if (ungrouped.length > 0) {
      lines.push(`[Sans groupe]`);
      for (const item of ungrouped) {
        const parts: string[] = [];
        if (item.quantity) parts.push(`qte=${item.quantity}`);
        if (item.brand) parts.push(`marque=${item.brand}`);
        if (item.content_quantity) parts.push(`cqte=${item.content_quantity}`);
        if (item.content_quantity_type) parts.push(`ctype=${item.content_quantity_type}`);
        if (item.checked) parts.push(`coche=1`);
        if (item.secondary_checked) parts.push(`coche2=1`);
        lines.push(parts.length > 0 ? `${item.name} (${parts.join('; ')})` : item.name);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'courses.txt'; a.click();
    toast({ title: `✅ Liste de courses exportée` });
    onClose();
  };

  const handleImportShopping = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.txt';
    input.onchange = async (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.type !== 'text/plain' && !file.name.toLowerCase().endsWith('.txt')) {
        toast({ title: '❌ Format invalide', description: 'Seuls les fichiers .txt sont acceptés.', variant: 'destructive' });
        return;
      }
      const text = await file.text();
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      let currentGroupId: string | null = null;
      let groupOrder = shoppingGroups.length;
      let itemOrder = 0;
      let count = 0;
      for (const line of lines) {
        if (line.startsWith('[') && line.endsWith(']')) {
          const groupName = line.slice(1, -1);
          if (groupName !== 'Sans groupe') {
            const existing = shoppingGroups.find((g) => g.name === groupName);
            if (existing) { currentGroupId = existing.id; }
            else {
              const { data } = await supabase.from('shopping_groups').insert({ name: groupName, sort_order: groupOrder++ } as any).select().single();
              currentGroupId = data?.id ?? null;
            }
          } else { currentGroupId = null; }
          itemOrder = 0;
        } else {
          const match = line.match(/^(.+?)\s*\((.+)\)$/);
          const rawName = match ? match[1].trim() : line;
          if (!rawName || rawName.length > 100) continue;
          const paramsStr = match ? match[2] : '';
          const params: Record<string, string> = {};
          paramsStr.split(';').forEach((p) => { const [k, ...v] = p.split('='); if (k) params[k.trim()] = v.join('=').trim(); });
          await supabase.from('shopping_items').insert({
            name: rawName, group_id: currentGroupId, quantity: params.qte || null, brand: params.marque || null,
            content_quantity: params.cqte || null, content_quantity_type: params.ctype || null,
            checked: params.coche === '1', secondary_checked: params.coche2 === '1', sort_order: itemOrder++
          } as any);
          count++;
        }
      }
      toast({ title: `✅ ${count} articles importés` });
      onClose();
    };
    input.click();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-card rounded-2xl p-6 space-y-3 w-72 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-foreground">🛠 Outils cachés</h3>
        <p className="text-xs text-muted-foreground">Ces outils permettent d'exporter/importer vos données.</p>
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-1">Catalogue repas</p>
          <button onClick={handleExportMeals} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground"><Download className="h-4 w-4" /> Exporter repas (.txt)</button>
          <button onClick={handleImportMeals} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground"><Upload className="h-4 w-4" /> Importer repas (.txt)</button>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-1">Liste de courses</p>
          <button onClick={handleExportShopping} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground"><Download className="h-4 w-4" /> Exporter courses (.txt)</button>
          <button onClick={handleImportShopping} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground"><Upload className="h-4 w-4" /> Importer courses (.txt)</button>
        </div>
        <p className="text-[10px] text-muted-foreground/50">Format repas: NOM (cat=plat; cal=350kcal; ing=riz, légumes)</p>
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-1">Sécurité</p>
          <button onClick={async () => {
            try {
              const { data } = await supabase.functions.invoke("verify-pin", { body: { reset_blocked: true } });
              if (data?.success) { setBlockedCount(0); toast({ title: "✅ Score PIN réinitialisé" }); }
              else toast({ title: "❌ Erreur", variant: "destructive" });
            } catch { toast({ title: "❌ Erreur", variant: "destructive" }); }
            onClose();
          }} className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-destructive/10 hover:bg-destructive/20 text-destructive">
            <ShieldAlert className="h-4 w-4" /> Réinitialiser score PIN ({blockedCount ?? 0})
          </button>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground w-full text-center hover:text-foreground">Fermer</button>
      </div>
    </div>
  );
}
