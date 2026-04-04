/**
 * MaxMealGenerator — Générateur de plats maximum réalisables.
 *
 * Simule un algorithme glouton (greedy) : sélectionne séquentiellement
 * les plats faisables en déduisant le stock virtuel à chaque itération.
 * Résultat : la liste maximale de plats qu'on peut préparer avec le stock actuel.
 *
 * Fonctionnalités :
 * - Génération aléatoire (shuffle + scoring) pour varier les résultats
 * - Tri par calories (ascendant/descendant)
 * - Persistance des résultats en sessionStorage
 * - Inclut les aliments marqués "is_meal" (repas autonomes)
 *
 * deductMealFromVirtualStock() : déduit les ingrédients d'un repas du stock virtuel
 */
import { useState, useEffect, useRef } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { ChevronDown, ChevronRight, Loader2, Zap, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";
import { buildStockMap, getMealMultiple, findStockKey, buildScaledMealForRatio } from "@/lib/stockUtils";
import { computeIngredientCalories, computeIngredientProtein, cleanIngredientText, parseIngredientGroups } from "@/lib/ingredientUtils";

interface Props {
  foodItems: FoodItem[];
  meals: Meal[];
}

interface GeneratedMeal {
  name: string;
  calories: number | null;
  protein: number | null;
  ingredients: string;
  ratio: number;
}

const SESSION_KEY = "max_meal_generator_results";

function deductMealFromVirtualStock(
  meal: Meal,
  ratio: number,
  virtualStock: Map<string, any>
) {
  if (!meal.ingredients) return;
  const groups = parseIngredientGroups(meal.ingredients);
  for (const group of groups) {
    for (const alt of group) {
      const key = findStockKey(virtualStock, alt.name);
      if (key) {
        const info = virtualStock.get(key)!;
        if (info.infinite) break;
        if (alt.qty > 0) info.grams = Math.max(0, info.grams - alt.qty * ratio);
        else if (alt.count > 0) info.count = Math.max(0, info.count - alt.count * ratio);
        else info.count = Math.max(0, info.count - ratio);
        break;
      }
    }
  }
}

export default function MaxMealGenerator({ foodItems, meals }: Props) {
  const { getPreference, setPreference } = usePreferences();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedMeal[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [sortBy, setSortBy] = useState<'none' | 'asc' | 'desc'>('desc');

  // Synchroniser le mode de tri de la DB avec l'état local
  useEffect(() => {
    const dbSort = getPreference<'none' | 'asc' | 'desc'>('max_meal_sort_by', null as any);
    if (dbSort) setSortBy(dbSort);
  }, [getPreference]);

  // Persister dans la DB
  const dbSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (dbSyncRef.current) clearTimeout(dbSyncRef.current);
    dbSyncRef.current = setTimeout(() => {
      setPreference.mutate({ key: 'max_meal_sort_by', value: sortBy });
    }, 1000);
  }, [sortBy, setPreference]);

  // Restaurer depuis sessionStorage au montage
  useEffect(() => {
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as GeneratedMeal[];
        setResults(parsed);
        setHasGenerated(true);
      } catch { /* ignore */ }
    }
  }, []);

  const generate = () => {
    setLoading(true);
    setTimeout(() => {
      try {
        const originalStock = buildStockMap(foodItems);
        // Clonage profond du stock virtuel
        const virtualStock = new Map<string, any>();
        for (const [key, info] of originalStock.entries()) {
          virtualStock.set(key, { ...info });
        }

        // Exclure les cartes "Avant grimpe" et "Pain + Fuet"
        const platMeals = meals.filter(m => {
          if (m.category !== "plat" || !m.ingredients?.trim()) return false;
          const n = m.name.toLowerCase().replace(/\s+/g, ' ');
          if (n.includes("avant grimpe")) return false;
          if (n.includes("pain + fuet") || n.includes("pain+fuet")) return false;
          return true;
        });
        const generated: GeneratedMeal[] = [];
        const usedMealIds = new Set<string>();

        // Mélanger les repas pour obtenir des résultats différents à chaque fois
        const shuffled = [...platMeals].sort(() => Math.random() - 0.5);

        // Glouton séquentiel : choisir les repas faisables un par un, en déduisant du stock virtuel
        let changed = true;
        while (changed) {
          changed = false;
          let bestMeal: Meal | null = null;
          let bestRatio = 0;
          let bestScore = -Infinity;

          for (const meal of shuffled) {
            if (usedMealIds.has(meal.id)) continue;
            const multiple = getMealMultiple(meal, virtualStock);
            if (multiple !== null && multiple > 0 && multiple !== Infinity) {
              const ratio = Math.min(multiple, 1);
              if (ratio >= 0.5) {
                // Ajouter de l'aléatoire au score pour la variété
                const score = ratio + Math.random() * 0.3;
                if (score > bestScore) {
                  bestMeal = meal;
                  bestRatio = ratio;
                  bestScore = score;
                }
              }
            }
          }

          if (bestMeal) {
            const scaledMeal = bestRatio !== 1 ? buildScaledMealForRatio(bestMeal, bestRatio, virtualStock) : bestMeal;
            deductMealFromVirtualStock(bestMeal, bestRatio, virtualStock);
            usedMealIds.add(bestMeal.id);

            const cal = computeIngredientCalories(scaledMeal.ingredients);
            const pro = computeIngredientProtein(scaledMeal.ingredients);
            generated.push({
              name: bestMeal.name,
              calories: cal,
              protein: pro,
              ingredients: cleanIngredientText(scaledMeal.ingredients || ""),
              ratio: bestRatio,
            });
            changed = true;
          }
        }

        // Lister également les articles marqués "is_meal" (aliments autonomes considérés comme repas)
        const isMealItems = foodItems.filter(fi => fi.is_meal);
        for (const fi of isMealItems) {
          const calVal = fi.calories ? parseFloat(fi.calories.replace(/[^0-9.]/g, '')) || null : null;
          const proVal = fi.protein ? parseFloat(fi.protein.replace(/[^0-9.]/g, '')) || null : null;
          generated.push({
            name: `🍱 ${fi.name}`,
            calories: calVal ? Math.round(calVal) : null,
            protein: proVal ? Math.round(proVal) : null,
            ingredients: '',
            ratio: 1,
          });
        }

        // Tri par défaut par calories descendant pour le stockage interne de session
        generated.sort((a, b) => (b.calories ?? 0) - (a.calories ?? 0));
        setResults(generated);
        setHasGenerated(true);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(generated));
      } catch {
        toast({ title: "Erreur", description: "Impossible de générer les plats.", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  const sortedResults = [...results].sort((a, b) => {
    if (sortBy === 'none') return 0;
    const valA = a.calories ?? 0;
    const valB = b.calories ?? 0;
    return sortBy === 'desc' ? valB - valA : valA - valB;
  });

  const toggleSort = () => {
    setSortBy(prev => {
      if (prev === 'desc') return 'asc';
      if (prev === 'asc') return 'none';
      return 'desc';
    });
  };

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4 mt-4">
      <div className="flex items-center gap-2 w-full">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 flex-1 text-left">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Plats max faisables
          </h2>
          {hasGenerated && <span className="text-sm font-normal text-muted-foreground">{results.length}</span>}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" onClick={generate} disabled={loading} className="gap-1 text-xs rounded-xl">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Générer
            </Button>
            {results.length > 0 && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={toggleSort} 
                className={`gap-1.5 text-[10px] h-8 rounded-xl border-dashed ${sortBy !== 'none' ? 'bg-orange-500/10 border-orange-500/30 text-orange-600' : ''}`}
              >
                {sortBy === 'none' && <ArrowUpDown className="h-3 w-3" />}
                {sortBy === 'asc' && <ArrowUp className="h-3 w-3" />}
                {sortBy === 'desc' && <ArrowDown className="h-3 w-3" />}
                Calories
              </Button>
            )}
            <span className="text-[10px] text-muted-foreground ml-1">Simule le max de plats réalisables en déduisant séquentiellement le stock</span>
          </div>

          {hasGenerated && results.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4 italic">
              Aucun plat réalisable avec les aliments disponibles.
            </p>
          )}

          {sortedResults.length > 0 && (
            <div className="flex flex-col gap-2">
              {sortedResults.map((r, i) => (
                <div key={i} className="flex flex-col rounded-2xl px-3 py-2.5 bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-foreground flex-1 truncate">{r.name}</p>
                    <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded-full shrink-0">
                      {r.ratio >= 1 && Number.isInteger(r.ratio) ? `x${r.ratio}` : `${Math.round(r.ratio * 100)}%`}
                    </span>
                    {r.calories !== null && (
                      <span className="text-[10px] font-bold text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                        🔥 {r.calories}
                      </span>
                    )}
                    {r.protein !== null && (
                      <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                        🍗 {r.protein}
                      </span>
                    )}
                  </div>
                  {r.ingredients && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {r.ingredients}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
