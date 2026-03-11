import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Sparkles, Loader2, RefreshCw, ChefHat } from "lucide-react";
import type { FoodItem } from "@/components/FoodItems";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

interface AISuggestion {
  name: string;
  ingredients_used: string[];
  difficulty: "facile" | "moyen" | "difficile";
}

const DIFFICULTY_COLORS: Record<string, string> = {
  facile: "bg-green-500/80",
  moyen: "bg-amber-500/80",
  difficile: "bg-red-500/80",
};

const SESSION_KEY = "ai_food_suggestions";

interface Props {
  foodItems: FoodItem[];
  existingMealNames?: string[];
}

export function FoodItemsSuggestions({ foodItems, existingMealNames = [] }: Props) {
  const [open, setOpen] = useState(false); // collapsed by default
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const fetchedRef = useRef(false);

  // Normalize for comparison
  const normalizeForCompare = (name: string) =>
    name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/s$/, "").trim();

  const existingNormalized = new Set(existingMealNames.map(normalizeForCompare));

  // On mount: restore from sessionStorage if available
  useEffect(() => {
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as AISuggestion[];
        setSuggestions(parsed);
        setHasLoaded(true);
        fetchedRef.current = true;
      } catch { /* ignore */ }
    }
  }, []);

  const fetchSuggestions = async () => {
    if (foodItems.length === 0) return;
    setLoading(true);
    try {
      const existingNames = existingMealNames.join(", ");
      const { data, error } = await supabase.functions.invoke("ai-food-suggestions", {
        body: { 
          foodItems: foodItems.map(fi => ({ name: fi.name, grams: fi.grams, is_infinite: fi.is_infinite })),
          existingMealNames: existingNames,
        },
      });
      if (error) {
        toast({ title: "Erreur IA", description: error.message, variant: "destructive" });
        return;
      }
      if (data?.error) {
        toast({ title: "Erreur IA", description: data.error, variant: "destructive" });
        return;
      }
      const result: AISuggestion[] = data?.suggestions || [];
      setSuggestions(result);
      setHasLoaded(true);
      fetchedRef.current = true;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(result));
    } catch (e) {
      toast({ title: "Erreur", description: "Impossible de contacter l'IA.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Auto-generate once per session when food items are loaded and not yet cached
  useEffect(() => {
    if (fetchedRef.current) return;
    if (foodItems.length === 0) return;
    fetchedRef.current = true;
    fetchSuggestions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodItems.length]);

  const handleRefresh = () => {
    sessionStorage.removeItem(SESSION_KEY);
    fetchedRef.current = false;
    fetchSuggestions();
  };

  // Filter out suggestions that already exist in "Tous"
  const filteredSuggestions = suggestions.filter(s => 
    !existingNormalized.has(normalizeForCompare(s.name))
  );

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4 mt-4">
      <div className="flex items-center gap-2 w-full">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-yellow-500" />
            Suggestions IA
          </h2>
          {hasLoaded && <span className="text-sm font-normal text-muted-foreground">{filteredSuggestions.length}</span>}
        </button>

        <Button
          size="sm"
          variant="ghost"
          onClick={handleRefresh}
          disabled={loading}
          className="h-7 px-2 gap-1 text-[11px] shrink-0"
          title="Régénérer les suggestions IA"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">Actualiser</span>
        </Button>
      </div>

      {open && (
        <div className="mt-3">
          {!hasLoaded && !loading && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <ChefHat className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground italic">
                Génération des suggestions en cours…
              </p>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">L'IA réfléchit…</span>
            </div>
          )}

          {hasLoaded && !loading && filteredSuggestions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4 italic">
              Aucune suggestion trouvée pour ces aliments.
            </p>
          )}

          {!loading && filteredSuggestions.length > 0 && (
            <div className="flex flex-col gap-2">
              {filteredSuggestions.map((s, i) => (
                <div
                  key={i}
                  className="flex flex-col rounded-2xl px-3 py-2.5 bg-primary/10 border border-primary/20"
                >
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-foreground flex-1 truncate">{s.name}</p>
                    <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full shrink-0 ${DIFFICULTY_COLORS[s.difficulty] ?? "bg-muted"}`}>
                      {s.difficulty}
                    </span>
                  </div>
                  {s.ingredients_used?.length > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {s.ingredients_used.join(" · ")}
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
