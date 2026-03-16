import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { FoodItem } from "@/components/FoodItems";
import type { Meal } from "@/hooks/useMeals";
import { buildStockMap, getMealMultiple, getMealFractionalRatio, buildScaledMealForRatio } from "@/lib/stockUtils";
import { computeIngredientCalories, computeIngredientProtein, cleanIngredientText } from "@/lib/ingredientUtils";

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

export function MaxMealGenerator({ foodItems, meals }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedMeal[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);

  const generate = () => {
    setLoading(true);
    setTimeout(() => {
      try {
        const stockMap = buildStockMap(foodItems);
        const generated: GeneratedMeal[] = [];

        // Find all plat meals that can be made
        const platMeals = meals.filter(m => m.category === "plat" && m.ingredients?.trim());

        for (const meal of platMeals) {
          const multiple = getMealMultiple(meal, stockMap);
          if (multiple !== null && multiple > 0 && multiple !== Infinity) {
            // Full recipe available
            const scaledMeal = multiple > 1 ? buildScaledMealForRatio(meal, multiple, stockMap) : meal;
            const cal = computeIngredientCalories(scaledMeal.ingredients);
            const pro = computeIngredientProtein(scaledMeal.ingredients);
            generated.push({
              name: meal.name,
              calories: cal,
              protein: pro,
              ingredients: cleanIngredientText(scaledMeal.ingredients || ""),
              ratio: multiple,
            });
          } else if (multiple === null || multiple <= 0) {
            // Try fractional
            const ratio = getMealFractionalRatio(meal, stockMap);
            if (ratio !== null && ratio >= 0.5) {
              const scaledMeal = buildScaledMealForRatio(meal, ratio, stockMap);
              const cal = computeIngredientCalories(scaledMeal.ingredients);
              const pro = computeIngredientProtein(scaledMeal.ingredients);
              generated.push({
                name: meal.name,
                calories: cal,
                protein: pro,
                ingredients: cleanIngredientText(scaledMeal.ingredients || ""),
                ratio,
              });
            }
          }
        }

        // Sort by calories desc
        generated.sort((a, b) => (b.calories ?? 0) - (a.calories ?? 0));
        setResults(generated);
        setHasGenerated(true);
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
            <span className="text-[10px] text-muted-foreground">Calcule tous les plats réalisables avec le stock actuel</span>
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
