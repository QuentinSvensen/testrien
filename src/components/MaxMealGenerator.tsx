import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { FoodItem } from "@/components/FoodItems";
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

export function MaxMealGenerator({ foodItems, meals }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedMeal[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Restore from sessionStorage on mount
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
        // Deep clone virtual stock
        const virtualStock = new Map<string, any>();
        for (const [key, info] of originalStock.entries()) {
          virtualStock.set(key, { ...info });
        }

        // Exclude "Avant grimpe" and "Pain + Fuet" cards
        const platMeals = meals.filter(m => {
          if (m.category !== "plat" || !m.ingredients?.trim()) return false;
          const n = m.name.toLowerCase().replace(/\s+/g, ' ');
          if (n.includes("avant grimpe")) return false;
          if (n.includes("pain + fuet") || n.includes("pain+fuet")) return false;
          return true;
        });
        const generated: GeneratedMeal[] = [];
        const usedMealIds = new Set<string>();

        // Shuffle meals for different results each time
        const shuffled = [...platMeals].sort(() => Math.random() - 0.5);

        // Greedy sequential: pick feasible meals one by one, deducting from virtual stock
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
                // Add randomness to scoring for variety
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

        // Also list is_meal food items (standalone food items marked as meals)
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

        // Sort by calories desc
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
            <span className="text-[10px] text-muted-foreground">Simule le max de plats réalisables en déduisant séquentiellement le stock</span>
          </div>

          {hasGenerated && results.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4 italic">
              Aucun plat réalisable avec les aliments disponibles.
            </p>
          )}

          {results.length > 0 && (
            <div className="flex flex-col gap-2">
              {results.map((r, i) => (
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
