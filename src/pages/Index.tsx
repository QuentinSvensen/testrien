import { useState, useEffect, useRef, lazy, Suspense, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Dice5, ArrowUpDown, CalendarDays, ShoppingCart, CalendarRange, UtensilsCrossed, Loader2, ChevronDown, ChevronRight, ShieldAlert, Apple, Infinity as InfinityIcon, Star, List, Flame, Search, Drumstick, Wheat, Timer } from "lucide-react";
import { DevMenu } from "@/components/DevMenu";
import { Chronometer } from "@/components/Chronometer";
import { PinLock } from "@/components/PinLock";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFoodItems, type FoodItem } from "@/hooks/useFoodItems";
import { colorFromName } from "@/lib/foodColors";

import { useMeals, type MealCategory, type Meal, type PossibleMeal } from "@/hooks/useMeals";
import { useShoppingList } from "@/hooks/useShoppingList";
import { usePreferences } from "@/hooks/usePreferences";
import { useSortModes } from "@/hooks/useSortModes";
import { toast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

import {
  normalizeForMatch, normalizeKey, strictNameMatch, accentSafeKeyMatch,
  parseQty, parsePartialQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientGroups, computeIngredientCalories, smartFoodContains,
  extractIngredientMacros,
} from "@/lib/ingredientUtils";
import {
  buildStockMap, buildFoodItemIndex, findStockKey, pickBestAlternative,
  getMealMultiple, getMealFractionalRatio,
  analyzeMealIngredients,
  getMissingIngredients, isFoodUsedInMeals,
  formatExpirationLabel, compareExpirationWithCounter,
  sortStockDeductionPriority, buildScaledMealForRatio, scaleIngredientStringExact,
  getDisplayedCalories, propagateIngredientMacros,
  type FoodItemIndex,
} from "@/lib/stockUtils";
import { useMealTransfers, computePlannedCounterDate } from "@/hooks/useMealTransfers";

// Chargeur en attente (lazy) robuste avec logique de tentative/rafraîchissement
const lazyRetry = (importFn: () => Promise<any>, name: string) => {
  return lazy(async () => {
    try {
      return await importFn();
    } catch (error: any) {
      console.error(`Error loading chunk for ${name}:`, error);

      // S'il s'agit d'une erreur de chargement de fragment (courant lors des redéploiements), rafraîchir la page
      // S'il s'agit d'une erreur de chargement de fragment (courant lors des redéploiements), vider le cache et rafraîchir
      const isChunkError = error.name === 'ChunkLoadError' ||
        error.message?.includes('Failed to fetch dynamically imported module') ||
        error.message?.includes('Failed to load module script');

      if (isChunkError && !sessionStorage.getItem(`retry-${name}`)) {
        sessionStorage.setItem(`retry-${name}`, 'true');
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach(r => r.unregister()));
        }
        if (typeof caches !== "undefined") {
          caches.keys().then((keys) => {
            Promise.all(keys.map(k => caches.delete(k))).then(() => {
              location.reload();
            });
          }).catch(() => location.reload());
        } else {
          location.reload();
        }
      }
      throw error;
    }
  });
};

// Usines de composants lazy (pour le préchargement)
const importShoppingList = () => import("@/components/ShoppingList").then((m) => ({ default: m.ShoppingList }));
const importMealPlanGenerator = () => import("@/components/MealPlanGenerator").then((m) => ({ default: m.MealPlanGenerator }));
const importFoodItems = () => import("@/components/FoodItems").then((m) => ({ default: m.FoodItems }));
const importMaxMealGenerator = () => import("@/components/MaxMealGenerator"); // Maintenant export par défaut
const importWeeklyPlanning = () => import("@/components/WeeklyPlanning").then((m) => ({ default: m.WeeklyPlanning }));
const importMasterList = () => import("@/components/MasterList").then((m) => ({ default: m.MasterList }));
const importPossibleList = () => import("@/components/PossibleList").then((m) => ({ default: m.PossibleList }));
const importAvailableList = () => import("@/components/AvailableList").then((m) => ({ default: m.AvailableList }));
const importUnParUnSection = () => import("@/components/UnParUnSection").then((m) => ({ default: m.UnParUnSection }));

const LazyShoppingList = lazyRetry(importShoppingList, "ShoppingList");
const LazyMealPlanGenerator = lazyRetry(importMealPlanGenerator, "MealPlanGenerator");
const LazyFoodItems = lazyRetry(importFoodItems, "FoodItems");
const LazyMaxMealGenerator = lazyRetry(importMaxMealGenerator, "MaxMealGenerator");
const LazyWeeklyPlanning = lazyRetry(importWeeklyPlanning, "WeeklyPlanning");
const LazyMasterList = lazyRetry(importMasterList, "MasterList");
const LazyPossibleList = lazyRetry(importPossibleList, "PossibleList");
const LazyAvailableList = lazyRetry(importAvailableList, "AvailableList");
const LazyUnParUnSection = lazyRetry(importUnParUnSection, "UnParUnSection");

// ═══════════════════════════════════════════════════════════════════════════════
// Catégories de repas disponibles dans l'application
// ═══════════════════════════════════════════════════════════════════════════════
const CATEGORIES: { value: MealCategory; label: string; emoji: string; }[] = [
  { value: "petit_dejeuner", label: "Petit déj", emoji: "🥐" },
  { value: "entree", label: "Entrées", emoji: "🥗" },
  { value: "plat", label: "Plats", emoji: "🍽️" },
  { value: "dessert", label: "Desserts", emoji: "🍰" },
  { value: "bonus", label: "Bonus", emoji: "⭐" }];

/** Récupère les calories affichées pour un repas (via le helper partagé) */
function getDisplayedMealCalories(meal: Meal): number {
  return getDisplayedCalories(meal) ?? 0;
}

/** Valide le nom d'un repas avant création */
function validateMealName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Le nom est requis";
  if (trimmed.length > 100) return "Nom trop long (100 car. max)";
  return null;
}

import type { SortMode, MasterSortMode, AvailableSortMode, UnParUnSortMode } from "@/hooks/useSortModes";
type MainPage = "aliments" | "repas" | "planning" | "courses";


const ROUTE_TO_PAGE: Record<string, MainPage> = {
  "/aliments": "aliments",
  "/repas": "repas",
  "/planning": "planning",
  "/courses": "courses"
};

const PAGE_TO_ROUTE: Record<MainPage, string> = {
  aliments: "/aliments",
  repas: "/repas",
  planning: "/planning",
  courses: "/courses"
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL : Index
// ═══════════════════════════════════════════════════════════════════════════════
const Index = () => {
  const qc = useQueryClient();
  const [session, setSession] = useState<import("@supabase/supabase-js").Session | null | undefined>(undefined);
  const [blockedCount, setBlockedCount] = useState<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const mainPage: MainPage = ROUTE_TO_PAGE[location.pathname] ?? "repas";
  const setMainPage = (page: MainPage) => navigate(PAGE_TO_ROUTE[page]);

  const unlocked = !!session;

  // ─── Hooks de données (activés seulement après authentification) ──────────
  const { items: foodItems, deleteItem: deleteFoodItemMutation } = useFoodItems({ enabled: unlocked });
  const deleteFoodItem = (id: string) => deleteFoodItemMutation.mutate(id);

  const {
    isLoading,
    meals, possibleMeals,
    addMeal, addMealToPossibleDirectly, renameMeal, updateCalories, updateGrams, updateProtein, updateIngredients,
    updateOvenTemp, updateOvenMinutes,
    toggleFavorite, deleteMeal, reorderMeals,
    moveToPossible, duplicatePossibleMeal, removeFromPossible,
    updateExpiration, updatePlanning, updateCounter,
    deletePossibleMeal, reorderPossibleMeals, updatePossibleIngredients, updatePossibleQuantity, splitPossibleMealQuantity,
    getMealsByCategory, getPossibleByCategory, sortByExpiration, sortByPlanning, getRandomPossible
  } = useMeals({ enabled: unlocked });

  const { groups: shoppingGroups, items: shoppingItems, toggleSecondaryCheck: toggleShoppingSecondaryCheck, updateItemQuantity: updateShoppingItemQuantity } = useShoppingList({ enabled: unlocked });
  const { getPreference, setPreference, isLoading: isPreferencesLoading } = usePreferences({ enabled: unlocked });

  // ─── Données dérivées (memoized) ────────────────────────────────────────
  const stockMap = useMemo(() => buildStockMap(foodItems), [foodItems]);
  const foodItemIndex = useMemo(() => buildFoodItemIndex(foodItems), [foodItems]);
  const { deductIngredientsFromStock, restoreIngredientsToStock, adjustStockForIngredientChange, deductNameMatchStock, updateFoodItemCountersForPlanning } = useMealTransfers(foodItems);

  // Précharger TOUS les fragments lazy + pré-récupérer TOUTES les données une fois déverrouillé (idle callback)
  const preloadDone = useRef(false);
  useEffect(() => {
    if (!unlocked || preloadDone.current) return;
    preloadDone.current = true;
    const preload = () => {
      // Précharger les fragments JS en parallèle
      importShoppingList();
      importMealPlanGenerator();
      importFoodItems();
      importWeeklyPlanning();
      importMasterList();
      importPossibleList();
      importAvailableList();
      importUnParUnSection();
      importMaxMealGenerator();
    };
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(preload);
    } else {
      setTimeout(preload, 200);
    }
  }, [unlocked]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const TAB_KEY = 'mealcards_open_tabs';
    const count = parseInt(localStorage.getItem(TAB_KEY) || '0');
    localStorage.setItem(TAB_KEY, String(count + 1));
    const handleUnload = () => {
      const current = parseInt(localStorage.getItem(TAB_KEY) || '1');
      if (current <= 1) {
        supabase.auth.signOut();
        localStorage.setItem(TAB_KEY, '0');
      } else {
        localStorage.setItem(TAB_KEY, String(current - 1));
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      const current = parseInt(localStorage.getItem(TAB_KEY) || '1');
      localStorage.setItem(TAB_KEY, String(Math.max(0, current - 1)));
    };
  }, []);

  // "unlocked" calculé ci-dessus pour bloquer les hooks de données avant le déverrouillage par PIN

  useEffect(() => {
    if (!unlocked) return;
    const fetchBlockedCount = async () => {
      try {
        const { data } = await supabase.functions.invoke("verify-pin", { body: { admin_stats: true } });
        if (data?.blocked_count !== undefined) setBlockedCount(data.blocked_count);
      } catch {/* ignore */ }
    };
    fetchBlockedCount();
    const interval = setInterval(fetchBlockedCount, 60_000);
    return () => clearInterval(interval);
  }, [unlocked]);

  // Forcer le filtre "calories restantes" à ON à chaque session pour la plupart des catégories (sauf petit déjeuner comme demandé)
  const calorieFilterForced = useRef(false);
  useEffect(() => {
    if (!unlocked || isPreferencesLoading || calorieFilterForced.current) return;
    calorieFilterForced.current = true;

    for (const cat of CATEGORIES) {
      const key = `available_use_remaining_calories_${cat.value}`;
      if (cat.value === "petit_dejeuner") {
        if (getPreference<boolean>(key, false)) {
          setPreference.mutate({ key, value: false });
        }
      } else {
        if (!getPreference<boolean>(key, true)) {
          setPreference.mutate({ key, value: true });
        }
      }
    }

    // Forcer le tri par "péremption" par défaut pour toutes les catégories "au choix" (AvailableList)
    const availableSortModes = getPreference<Record<string, string>>('meal_available_sort_modes', {});
    const updatedSortModes = { ...availableSortModes };
    let changed = false;
    for (const cat of CATEGORIES) {
      if (updatedSortModes[cat.value] !== 'expiration') {
        updatedSortModes[cat.value] = 'expiration';
        changed = true;
      }
    }
    if (changed) {
      setPreference.mutate({ key: 'meal_available_sort_modes', value: updatedSortModes });
    }
  }, [unlocked, isPreferencesLoading]);

  const macroLookup = useMemo(() => {
    const map = new Map<string, { cal: string; pro: string }>();
    for (const meal of meals) {
      if (!meal.ingredients) continue;
      const macros = extractIngredientMacros(meal.ingredients);
      for (const [key, val] of macros) {
        const existing = map.get(key);
        if (!existing || (!existing.cal && val.cal) || (!existing.pro && val.pro)) {
          map.set(key, { cal: val.cal || existing?.cal || "", pro: val.pro || existing?.pro || "" });
        }
      }
    }
    return map;
  }, [meals]);

  useEffect(() => {
    if (!unlocked) return;
    const channel = supabase
      .channel('global-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'food_items' }, () => { qc.invalidateQueries({ queryKey: ["food_items"] }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meals' }, () => { qc.invalidateQueries({ queryKey: ["meals"] }); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'possible_meals' }, () => { qc.invalidateQueries({ queryKey: ["possible_meals"] }); })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('Sync temps réel : La connexion a échoué. Assurez-vous que le Realtime est activé dans votre tableau de bord Supabase.');
        }
      });
    return () => {
      // Supprimer le canal en toute sécurité pour éviter les avertissements "closed before established" pendant le HMR
      if (channel) {
        supabase.removeChannel(channel).catch(() => { /* silent */ });
      }
    };
  }, [unlocked, qc]);

  // Nettoyage automatique du dimanche — s'exécute UNE FOIS par semaine le dimanche à 23h59 ou lors de la première connexion de la nouvelle semaine
  const lastWeeklyReset = getPreference<string>('last_weekly_reset', '');
  const sundayClearDone = useRef(false);
  useEffect(() => {
    if (!unlocked || sundayClearDone.current || isPreferencesLoading || isLoading) return;
    sundayClearDone.current = true;

    const now = new Date();
    // Trouver le dimanche 23h59 le plus récent
    const mostRecentSunday = new Date(now);
    const day = mostRecentSunday.getDay(); // 0=Dimanche
    // Revenir au dimanche dernier (ou aujourd'hui si on est dimanche)
    mostRecentSunday.setDate(mostRecentSunday.getDate() - day);
    mostRecentSunday.setHours(23, 59, 0, 0);

    // Si nous n'avons pas encore atteint dimanche 23h59 cette semaine, utiliser le dimanche de la semaine DERNIÈRE
    if (now.getTime() < mostRecentSunday.getTime()) {
      mostRecentSunday.setDate(mostRecentSunday.getDate() - 7);
    }

    if (!lastWeeklyReset) {
      // Initialisation de la première fois, on définit juste la valeur sans nettoyer
      setPreference.mutate({ key: 'last_weekly_reset', value: mostRecentSunday.toISOString() });
      return;
    }

    const lastResetDate = new Date(lastWeeklyReset);
    if (lastResetDate.getTime() >= mostRecentSunday.getTime()) {
      // Déjà réinitialisé pour cette semaine
      return;
    }

    if (possibleMeals.length === 0) {
      // Rien à nettoyer, mais mise à jour de l'horodatage de réinitialisation
      setPreference.mutate({ key: 'last_weekly_reset', value: now.toISOString() });
      return;
    }

    const clearAll = async () => {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) return;

      // Vérifier qu'il n'y a pas de double réinitialisation depuis la DB (par utilisateur, évite de prendre la préférence d'un autre utilisateur)
      const { data: freshResetPref } = await supabase
        .from('user_preferences')
        .select('value')
        .eq('key', 'last_weekly_reset')
        .eq('user_id', userId)
        .maybeSingle();
      if (freshResetPref?.value) {
        const freshResetDate = new Date(String(freshResetPref.value));
        if (freshResetDate.getTime() >= mostRecentSunday.getTime()) return;
      }

      // Charger les captures (snapshots) sauvegardées et les valeurs de saisie actuelles (par utilisateur)
      const snapResult = await supabase
        .from('user_preferences')
        .select('value')
        .eq('key', 'planning_saved_snapshots')
        .eq('user_id', userId)
        .maybeSingle();
      const snapshots: Record<string, { cal?: number; prot?: number }> = (snapResult.data?.value as any) ?? {};

      // Charger les valeurs de saisie actuelles pour une sauvegarde complète
      const prefKeys = [
        'planning_manual_calories', 'planning_manual_proteins',
        'planning_extra_calories', 'planning_extra_proteins',
        'planning_breakfast_manual_calories', 'planning_breakfast_manual_proteins',
        'planning_breakfast', 'planning_drink_checks', 'planning_cal_overrides',
        'planning_extra_selections',
        'planning_daily_goal', 'next_week_daily_goal',
        'planning_protein_goal', 'next_week_protein_goal'
      ];
      const { data: prefRows } = await supabase
        .from('user_preferences')
        .select('key, value')
        .eq('user_id', userId)
        .in('key', prefKeys);
      const prefMap: Record<string, any> = {};
      for (const row of (prefRows || [])) { prefMap[row.key] = row.value; }

      // Sauvegarder possible_meals + toutes les valeurs de saisie avant suppression
      const backup = possibleMeals.map(pm => ({
        meal_id: pm.meal_id,
        quantity: pm.quantity,
        expiration_date: pm.expiration_date,
        day_of_week: pm.day_of_week,
        meal_time: pm.meal_time,
        counter_start_date: pm.counter_start_date,
        sort_order: pm.sort_order,
        ingredients_override: pm.ingredients_override,
      }));
      const fullBackup = {
        cards: backup,
        manualCalories: prefMap['planning_manual_calories'] || {},
        manualProteins: prefMap['planning_manual_proteins'] || {},
        extraCalories: prefMap['planning_extra_calories'] || {},
        extraProteins: prefMap['planning_extra_proteins'] || {},
        breakfastManualCalories: prefMap['planning_breakfast_manual_calories'] || {},
        breakfastManualProteins: prefMap['planning_breakfast_manual_proteins'] || {},
        breakfastSelections: prefMap['planning_breakfast'] || {},
        drinkChecks: prefMap['planning_drink_checks'] || {},
        calOverrides: prefMap['planning_cal_overrides'] || {},
      };
      await supabase
        .from('user_preferences')
        .upsert({ key: 'possible_meals_backup', value: fullBackup, user_id: userId } as any, { onConflict: 'user_id,key' });

      // Filtrer les repas à supprimer : on garde ceux dont la date ISO est > mostRecentSunday (Semaine suivante)
      const cutoffISO = mostRecentSunday.toISOString().split('T')[0];
      const mealsToDelete = possibleMeals.filter(pm => {
        if (!pm.day_of_week) return true; // On vide le plateau (shelf)
        if (/^\d{4}-\d{2}-\d{2}$/.test(pm.day_of_week)) {
          return pm.day_of_week <= cutoffISO; // On supprime si c'est le passé ou la semaine qui vient de se finir
        }
        return true; // On vide si c'est un jour "nommé" (lundi, etc.) car c'est la semaine courante par défaut
      });

      await Promise.all(mealsToDelete.map(pm =>
        (supabase as any).from("possible_meals").delete().eq("id", pm.id)
      ));

      // Restaurer les calories et protéines manuelles depuis les captures
      const restoredManualCal: Record<string, number> = {};
      const restoredManualProt: Record<string, number> = {};
      for (const [key, snap] of Object.entries(snapshots)) {
        if (key.startsWith('manual-')) {
          const slotKey = key.replace('manual-', '');
          if (snap.cal) restoredManualCal[slotKey] = snap.cal;
          if (snap.prot) restoredManualProt[slotKey] = snap.prot;
        }
      }
      setPreference.mutate({ key: 'planning_manual_calories', value: restoredManualCal });
      setPreference.mutate({ key: 'planning_manual_proteins', value: restoredManualProt });

      // Restaurer les calories et protéines extra depuis les captures
      const restoredExtraCal: Record<string, number> = {};
      const restoredExtraProt: Record<string, number> = {};
      const restoredExtraSels: Record<string, string[]> = {};
      for (const [key, snap] of Object.entries(snapshots)) {
        if (key.startsWith('extra-')) {
          const dayKey = key.replace('extra-', '');
          const s = snap as any;
          if (s.cal) restoredExtraCal[dayKey] = s.cal;
          if (s.prot) restoredExtraProt[dayKey] = s.prot;
          if (s.itemIds) restoredExtraSels[dayKey] = s.itemIds;
        }
      }
      setPreference.mutate({ key: 'planning_extra_calories', value: restoredExtraCal });
      setPreference.mutate({ key: 'planning_extra_proteins', value: restoredExtraProt });
      setPreference.mutate({ key: 'planning_extra_selections', value: restoredExtraSels });

      // Restaurer le petit déjeuner depuis les captures
      const restoredBreakfastCal: Record<string, number> = {};
      const restoredBreakfastProt: Record<string, number> = {};
      const keptBreakfast: Record<string, string> = {};
      for (const [key, snap] of Object.entries(snapshots)) {
        if (key.startsWith('breakfast-')) {
          const dayKey = key.replace('breakfast-', '');
          if (snap.cal) restoredBreakfastCal[dayKey] = snap.cal;
          if (snap.prot) restoredBreakfastProt[dayKey] = snap.prot;
          if ((snap as any).mealId) keptBreakfast[dayKey] = (snap as any).mealId;
        }
      }
      setPreference.mutate({ key: 'planning_breakfast_manual_calories', value: restoredBreakfastCal });
      setPreference.mutate({ key: 'planning_breakfast_manual_proteins', value: restoredBreakfastProt });
      setPreference.mutate({ key: 'planning_breakfast', value: keptBreakfast });
      setPreference.mutate({ key: 'planning_drink_checks', value: {} });
      
      // Promotion des objectifs de la semaine suivante vers la semaine en cours
      const nCal = prefMap['next_week_daily_goal'];
      const nPro = prefMap['next_week_protein_goal'];
      if (nCal && nCal > 0) {
        setPreference.mutate({ key: 'planning_daily_goal', value: nCal });
        setPreference.mutate({ key: 'next_week_daily_goal', value: 0 });
      }
      if (nPro && nPro > 0) {
        setPreference.mutate({ key: 'planning_protein_goal', value: nPro });
        setPreference.mutate({ key: 'next_week_protein_goal', value: 0 });
      }

      setPreference.mutate({ key: 'last_weekly_reset', value: now.toISOString() });
      qc.invalidateQueries({ queryKey: ["possible_meals"] });
      toast({ title: "🔄 Reset hebdomadaire effectué", description: "Utilisez ↩ Restaurer dans le planning pour récupérer les cartes." });
    };
    clearAll();
  }, [unlocked, possibleMeals, lastWeeklyReset, isPreferencesLoading, isLoading]);

  const [activeCategory, setActiveCategory] = useState<MealCategory>(() => {
    if (location.pathname === '/repas') {
      const hour = new Date().getHours();
      return hour < 11 ? "petit_dejeuner" : "plat";
    }
    return "plat";
  });
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<MealCategory>("plat");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<"all" | "possible">("all");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const SNAPSHOT_PREF_KEY = 'deduction_snapshots_v1';
  const persistedSnapshots = getPreference<Record<string, FoodItem[]>>(SNAPSHOT_PREF_KEY, {});
  const [deductionSnapshots, setDeductionSnapshots] = useState<Record<string, FoodItem[]>>({});
  const snapshotsSynced = useRef(false);
  const snapshotsJsonRef = useRef('');
  useEffect(() => {
    if (snapshotsSynced.current) return;
    if (!persistedSnapshots || Object.keys(persistedSnapshots).length === 0) return;
    const json = JSON.stringify(persistedSnapshots);
    if (json === snapshotsJsonRef.current) return;
    snapshotsJsonRef.current = json;
    setDeductionSnapshots(persistedSnapshots);
    snapshotsSynced.current = true;
  }, [persistedSnapshots]);
  const updateSnapshots = (updater: (prev: Record<string, FoodItem[]>) => Record<string, FoodItem[]>) => {
    setDeductionSnapshots(prev => {
      const next = updater(prev);
      setPreference.mutate({ key: SNAPSHOT_PREF_KEY, value: next });
      return next;
    });
  };
  const [masterSourcePmIds, setMasterSourcePmIds] = useState<Set<string>>(new Set());
  const [unParUnSourcePmIds, setUnParUnSourcePmIds] = useState<Set<string>>(new Set());

  // ═══════════════════════════════════════════════════════════════════════════
  // Transfert d'un repas vers la liste "Possible" (avec déduction de stock)
  // ═══════════════════════════════════════════════════════════════════════════
  const handleMoveToPossibleGeneral = async (mealId: string, source?: string, pmId?: string | null) => {
    if (pmId) {
      updatePlanning.mutate({ id: pmId, day_of_week: null, meal_time: null });
      return;
    }

    const meal = meals.find(m => m.id === mealId);
    if (!meal) return;

    // 1. Analyser le stock avant déduction pour l'expiration
    const anBefore = analyzeMealIngredients(meal, foodItems, foodItemIndex);

    // 2. IMPORTANT : Déduire les ingrédients du stock D'ABORD pour obtenir le compteur le plus ancien EXACT en fonction des alternatives choisies
    const { snapshots, oldestCounter } = await deductIngredientsFromStock(meal, undefined);
    const nameMatch = foodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
    if (nameMatch && !snapshots.find(s => s.id === nameMatch.id)) snapshots.push({ ...nameMatch });

    // 3. Créer la carte avec le compteur le plus ancien provenant des ingrédients (ou de l'analyse s'il n'y a pas d'ingrédients)
    let hasCounterable = anBefore.hasCounterableIngredient;
    if (!meal.ingredients?.trim() && nameMatch) {
      hasCounterable = nameMatch.storage_type !== 'surgele' && !nameMatch.no_counter;
    }

    let finalCounterDate: string | null = null;
    // Les cartes issues de "Tous" ne doivent jamais avoir de compteur d'ouverture
    // car elles ne représentent pas une consommation réelle planifiée
    if (source !== "master") {
      const existingDates = [oldestCounter, anBefore.earliestCounterDate, nameMatch?.counter_start_date].filter(Boolean) as string[];
      if (existingDates.length > 0) {
        existingDates.sort();
        finalCounterDate = existingDates[0];
      }
    }

    const result = await moveToPossible.mutateAsync({
      mealId,
      expiration_date: anBefore.earliestExpiration,
      counter_start_date: finalCounterDate
    });

    if (result?.id) {
      if (snapshots.length > 0) updateSnapshots(prev => ({ ...prev, [result.id]: snapshots }));
      if (source === "master") setMasterSourcePmIds(prev => new Set([...prev, result.id]));
    }
  };

  // Modes de tri — extraits dans un hook dédié
  const {
    sortModes, masterSortModes, availableSortModes, unParUnSortModes, sortDirections,
    toggleSort, toggleMasterSort, toggleAvailableSort, toggleSortDirection,
    resetSortToManual, resetMasterSortToManual, setUnParUnSort,
  } = useSortModes({ enabled: unlocked });


  const [logoClickCount, setLogoClickCount] = useState(0);
  const [showDevMenu, setShowDevMenu] = useState(false);
  const [chronoOpen, setChronoOpen] = useState(false);
  const [coursesTab, setCoursesTab] = useState<"liste" | "menu">("liste");

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {};
    for (const cat of CATEGORIES) {
      defaults[`master-${cat.value}`] = true;
      defaults[`unparun-${cat.value}`] = true;
    }
    return defaults;
  });
  const toggleSectionCollapse = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleLogoClick = () => {
    setLogoClickCount((c) => {
      const next = c + 1;
      if (next >= 3) { setShowDevMenu(true); return 0; }
      return next;
    });
  };

  if (session === undefined) return (
    <div className="fixed inset-0 bg-background flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>);

  if (!unlocked) return <PinLock onUnlock={() => { }} />;

  const openDialog = (target: "all" | "possible" = "all") => {
    setNewCategory(activeCategory);
    setAddTarget(target);
    setDialogOpen(true);
  };

  const handleAdd = (target?: "all" | "possible") => {
    const finalTarget = target || addTarget;
    const validationError = validateMealName(newName);
    if (validationError) {
      toast({ title: "Données invalides", description: validationError, variant: "destructive" });
      return;
    }
    const trimmedName = newName.trim();
    if (finalTarget === "possible") {
      addMealToPossibleDirectly.mutate({ name: trimmedName, category: newCategory }, {
        onSuccess: () => { setNewName(""); setDialogOpen(false); toast({ title: "Repas ajouté aux possibles 🎉" }); }
      });
    } else {
      addMeal.mutate({ name: trimmedName, category: newCategory }, {
        onSuccess: () => {
          setNewName(""); setDialogOpen(false); toast({ title: "Repas ajouté 🎉" });
        }
      });
    }
  };

  const handleRandomPick = (cat: string) => {
    const pick = getRandomPossible(cat);
    if (!pick) { toast({ title: "Aucun repas possible" }); return; }
    setHighlightedId(pick.id);
    toast({ title: `🎲 ${pick.meals.name}` });
    setTimeout(() => setHighlightedId(null), 3000);
  };

  const getSortedPossible = (cat: string): PossibleMeal[] => {
    const items = getPossibleByCategory(cat);
    const mode = sortModes[cat] || "manual";
    if (mode === "expiration") return sortByExpiration(items);
    if (mode === "planning") return sortByPlanning(items);
    return items;
  };

  const handleReorderMeals = (cat: string, fromIndex: number, toIndex: number) => {
    const items = getMealsByCategory(cat);
    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    reorderMeals.mutate(reordered.map((m, i) => ({ id: m.id, sort_order: i })));
    resetMasterSortToManual(cat);
  };

  const getSortedMaster = (cat: string): Meal[] => {
    const items = getMealsByCategory(cat);
    const mode = masterSortModes[cat] || "manual";
    const asc = sortDirections[`master-${cat}`] !== false;
    if (mode === "calories") {
      return [...items].sort((a, b) => {
        const ca = getDisplayedMealCalories(a);
        const cb = getDisplayedMealCalories(b);
        return asc ? ca - cb : cb - ca;
      });
    }
    if (mode === "protein") {
      return [...items].sort((a, b) => {
        const pa = parseFloat((a.protein || "0").replace(/[^0-9.]/g, "")) || 0;
        const pb = parseFloat((b.protein || "0").replace(/[^0-9.]/g, "")) || 0;
        return asc ? pa - pb : pb - pa;
      });
    }
    if (mode === "favorites") return [...items].sort((a, b) => (b.is_favorite ? 1 : 0) - (a.is_favorite ? 1 : 0));
    if (mode === "ingredients") {
      return [...items].sort((a, b) => {
        const aCount = a.ingredients ? a.ingredients.split(/[,\n]+/).filter(Boolean).length : 0;
        const bCount = b.ingredients ? b.ingredients.split(/[,\n]+/).filter(Boolean).length : 0;
        return aCount - bCount;
      });
    }
    return items;
  };

  const handleReorderPossible = (cat: string, fromIndex: number, toIndex: number) => {
    const items = getSortedPossible(cat);
    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    reorderPossibleMeals.mutate(reordered.map((m, i) => ({ id: m.id, sort_order: i })));
    resetSortToManual(cat);
  };

  return (
    <div className="min-h-screen bg-background">
      {showDevMenu && (
        <DevMenu
          onClose={() => setShowDevMenu(false)}
          getMealsByCategory={getMealsByCategory}
          shoppingGroups={shoppingGroups}
          shoppingItems={shoppingItems}
          foodItems={foodItems}
          blockedCount={blockedCount}
          setBlockedCount={setBlockedCount}
        />
      )}

      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-2 py-2 sm:px-4 sm:py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1 shrink-0">
            <h1 className="text-base sm:text-xl font-extrabold text-foreground cursor-pointer select-none" onClick={handleLogoClick} title="">🍽️</h1>
            {blockedCount !== null &&
              <span title={`${blockedCount} tentative${blockedCount > 1 ? 's' : ''} d'accès non autorisée${blockedCount > 1 ? 's' : ''} depuis la création`}
                className="flex items-center gap-0.5 text-[9px] font-bold text-destructive/80 bg-destructive/10 rounded-full px-1 py-0.5 cursor-default shrink-0">
                <ShieldAlert className="h-2 w-2" />{blockedCount}
              </span>
            }
          </div>

          <div className="flex items-center flex-1 min-w-0 justify-center">
            <div className="bg-muted rounded-full p-0.5 w-full max-w-xs md:max-w-md py-[6px] my-0 px-0 flex items-center justify-center gap-[2px]">
              {([
                { page: "aliments" as MainPage, icon: <Apple className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0" />, label: "Aliments", activeColor: "text-lime-600 dark:text-lime-400" },
                { page: "repas" as MainPage, icon: <UtensilsCrossed className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0" />, label: "Repas", activeColor: "text-orange-500" },
                { page: "planning" as MainPage, icon: <CalendarRange className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0" />, label: "Planning", activeColor: "text-blue-500" },
                { page: "courses" as MainPage, icon: <ShoppingCart className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0" />, label: "Courses", activeColor: "text-green-500" },
              ] as const).map(({ page, icon, label, activeColor }) => (
                <button key={page} onClick={() => setMainPage(page)}
                  className={`flex-1 py-1 rounded-full font-medium transition-colors flex items-center justify-center gap-0.5 md:gap-1 min-w-0 px-1 md:px-3 ${mainPage === page ? "bg-background shadow-sm" : ""}`}>
                  {icon}
                  <span className={`text-[9px] md:text-sm truncate leading-tight ${mainPage === page ? `${activeColor} font-bold` : "text-muted-foreground"}`}>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <button onClick={() => setChronoOpen(true)}
            className="text-[10px] sm:text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 shrink-0 bg-muted/60 hover:bg-muted rounded-full px-2.5 py-1">
            <span className="capitalize">{format(new Date(), 'EEE', { locale: fr })}</span>
            <span className="font-black text-foreground">{format(new Date(), 'd')}</span>
          </button>
        </div>
      </header>
      <Chronometer open={chronoOpen} onOpenChange={setChronoOpen} />

      <main className="max-w-6xl mx-auto p-3 sm:p-4">
        <Suspense fallback={<div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
          {mainPage === "aliments" && (
            <ErrorBoundary section="Aliments">
              <LazyFoodItems />
              <LazyMaxMealGenerator foodItems={foodItems} meals={meals} />
            </ErrorBoundary>
          )}
          {mainPage === "courses" && (
            <ErrorBoundary section="Courses">
              <div className="sticky top-[44px] sm:top-[52px] z-10 bg-background/95 backdrop-blur-sm pb-2 pt-1">
                <div className="flex items-center gap-1 bg-muted rounded-full p-0.5 max-w-xs mx-auto">
                  <button onClick={() => setCoursesTab("liste")} className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${coursesTab === "liste" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}>🛒 Liste</button>
                  <button onClick={() => setCoursesTab("menu")} className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${coursesTab === "menu" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"}`}>🎲 Menu</button>
                </div>
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none justify-center mt-1.5">
                  <input
                    type="checkbox"
                    checked={getPreference<boolean>('shopping_show_green_checks', true)}
                    onChange={(e) => {
                      const newChecked = e.target.checked;
                      // Optimistically update the preference cache FIRST to prevent stale reads on tab switch
                      qc.setQueryData<{ id: string; key: string; value: any }[]>(["user_preferences"], old =>
                        old?.map(p => p.key === 'shopping_show_green_checks' ? { ...p, value: newChecked } : p) ?? []
                      );
                      if (!newChecked) {
                        // Désactiver : décocher simplement toutes les coches vertes, préserver les quantités blanches
                        for (const si of shoppingItems) {
                          if (si.secondary_checked) toggleShoppingSecondaryCheck.mutate({ id: si.id, secondary_checked: false });
                        }
                      } else {
                        // Réactiver : ré-appliquer les coches à partir des besoins persistés
                        const pNeeds = getPreference<Record<string, { grams: number; count: number; rawName?: string }>>('menu_generator_needs_v1', {});
                        const entries = Object.entries(pNeeds);
                        if (entries.length > 0) {
                          const tjKeys = new Set(foodItems.filter(fi => fi.storage_type === 'toujours').map(fi => normalizeKey(fi.name)));
                          const tjArr = [...tjKeys];
                          const tjGrpIds = new Set(shoppingGroups.filter(g => { const n = normalizeKey(g.name); return n.includes('toujours present') || n.includes('toujours la'); }).map(g => g.id));
                          const isTJ = (si: { name: string; group_id: string | null }, k: string) =>
                            !!(si.group_id && tjGrpIds.has(si.group_id)) || tjKeys.has(k) || tjArr.some(t => smartFoodContains(si.name, t));
                          const matched = new Set<string>();
                          const dqMap = new Map<string, number>();
                          for (const [nk, need] of entries) {
                            const exact: typeof shoppingItems = [];
                            const partial: typeof shoppingItems = [];
                            const matchName = need.rawName || nk;
                            for (const si of shoppingItems) {
                              const k = normalizeKey(si.name);
                              if (isTJ(si, k)) continue;
                              if (normalizeKey(si.name) === normalizeKey(nk)) exact.push(si);
                              else if (smartFoodContains(si.name, matchName)) partial.push(si);
                            }
                            const tgts = exact.length > 0 ? exact : (partial.length === 1 ? partial : []);
                            for (const si of tgts) {
                              matched.add(si.id);
                              const nbV = si.content_quantity ? parseFloat(si.content_quantity.replace(/[^0-9.,]/g, '').replace(',', '.')) : 0;
                              const isG = si.content_quantity_type === 'g' || (!si.content_quantity_type && /g/i.test(si.content_quantity || ''));
                              let qN = 1;
                              if (isG && nbV > 0 && need.grams > 0) qN = Math.ceil(need.grams / nbV);
                              else if (!isG && nbV > 0 && need.count > 0) qN = Math.ceil(need.count / nbV);
                              else if (need.count > 0) qN = Math.ceil(need.count);
                              dqMap.set(si.id, Math.max(dqMap.get(si.id) || 0, qN));
                            }
                          }
                          for (const si of shoppingItems) {
                            if (matched.has(si.id)) {
                              toggleShoppingSecondaryCheck.mutate({ id: si.id, secondary_checked: true });
                            }
                          }
                        }
                        sessionStorage.setItem('menu_initial_sync_done', 'true');
                      }
                      setPreference.mutate({ key: 'shopping_show_green_checks', value: newChecked });
                    }}
                    className="h-3 w-3 rounded accent-green-500"
                  />
                  Menu semaine
                </label>
              </div>
              {coursesTab === "liste" ? <LazyShoppingList /> : <LazyMealPlanGenerator />}
            </ErrorBoundary>
          )}
          {mainPage === "planning" && (
            <ErrorBoundary section="Planning">
              <LazyWeeklyPlanning 
                masterSourcePmIds={masterSourcePmIds}
                unParUnSourcePmIds={unParUnSourcePmIds}
              />
            </ErrorBoundary>
          )}
          {mainPage === "repas" &&
            <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as MealCategory)}>
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <TabsList className="flex-1 overflow-x-auto rounded-2xl">
                  {CATEGORIES.map((c) =>
                    <TabsTrigger key={c.value} value={c.value} className="text-[9px] sm:text-xs px-1.5 sm:px-3 py-1 rounded-xl">
                      <span className="mr-0.5">{c.emoji}</span>
                      <span className="text-[9px] sm:text-xs leading-tight">{c.label}</span>
                    </TabsTrigger>
                  )}
                </TabsList>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="rounded-full gap-1 text-xs shrink-0" onClick={() => openDialog("all")}>
                      <Plus className="h-3 w-3" /> <span className="hidden sm:inline">Ajouter</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent aria-describedby={undefined}>
                    <DialogHeader><DialogTitle>Nouveau repas</DialogTitle></DialogHeader>
                    <div className="flex flex-col gap-3">
                      <Input autoFocus placeholder="Ex: Pâtes carbonara" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAdd()} className="rounded-xl" />
                      <Select value={newCategory} onValueChange={(v) => setNewCategory(v as MealCategory)}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <div className="flex gap-2">
                        <Button onClick={() => handleAdd("all")} disabled={!newName.trim()} className="flex-1 text-xs rounded-xl">Tous les repas</Button>
                        <Button onClick={() => handleAdd("possible")} disabled={!newName.trim()} variant="secondary" className="flex-1 text-xs rounded-xl">Possibles uniquement</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {CATEGORIES.map((cat) =>
                <TabsContent key={cat.value} value={cat.value}>
                  <ErrorBoundary section={`Repas - ${cat.label}`}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                      <div className="flex flex-col gap-3 sm:gap-4 order-1">
                        <LazyMasterList
                          category={cat}
                          meals={getSortedMaster(cat.value)}
                          foodItems={foodItems}
                          sortMode={(masterSortModes[cat.value] || "manual") as any}
                          sortAsc={sortDirections[`master-${cat.value}`] !== false}
                          onToggleSort={() => toggleMasterSort(cat.value)}
                          onToggleSortDirection={() => toggleSortDirection(`master-${cat.value}`)}
                          collapsed={collapsedSections[`master-${cat.value}`] ?? false}
                          onToggleCollapse={() => toggleSectionCollapse(`master-${cat.value}`)}
                          onMoveToPossible={(id) => handleMoveToPossibleGeneral(id, "master")}
                          onRename={(id, name) => renameMeal.mutate({ id, name })}
                          onDelete={(id) => deleteMeal.mutate(id)}
                          onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                          onUpdateProtein={(id, prot) => updateProtein.mutate({ id, protein: prot })}
                          onUpdateGrams={(id, g) => updateGrams.mutate({ id, grams: g })}
                          onUpdateIngredients={(id, ing) => {
                            if (ing) {
                              const { sourceIngredients, updates } = propagateIngredientMacros(id, ing, meals);
                              updateIngredients.mutate({ id, ingredients: sourceIngredients });
                              for (const u of updates) updateIngredients.mutate({ id: u.id, ingredients: u.ingredients });
                            } else {
                              updateIngredients.mutate({ id, ingredients: ing });
                            }
                          }}
                          onToggleFavorite={(id) => {
                            const meal = meals.find((m) => m.id === id);
                            if (meal) toggleFavorite.mutate({ id, is_favorite: !meal.is_favorite });
                          }}
                          onUpdateOvenTemp={(id, t) => updateOvenTemp.mutate({ id, oven_temp: t })}
                          onUpdateOvenMinutes={(id, m) => updateOvenMinutes.mutate({ id, oven_minutes: m })}
                          onReorder={(from, to) => handleReorderMeals(cat.value, from, to)} />

                        <LazyAvailableList
                          category={cat}
                          meals={getMealsByCategory(cat.value)}
                          foodItems={foodItems}
                          allMeals={meals}
                          stockMap={stockMap}
                          sortMode={availableSortModes[cat.value] || "manual"}
                          sortAsc={sortDirections[`available-${cat.value}`] !== false}
                          onToggleSort={() => toggleAvailableSort(cat.value)}
                          onToggleSortDirection={() => toggleSortDirection(`available-${cat.value}`)}
                          collapsed={collapsedSections[`available-${cat.value}`] ?? false}
                          onToggleCollapse={() => toggleSectionCollapse(`available-${cat.value}`)}
                          onMoveToPossible={(mealId) => handleMoveToPossibleGeneral(mealId, "available")}
                          onMovePartialToPossible={async (meal, ratio) => {
                            const partialMeal = buildScaledMealForRatio(meal, ratio, stockMap);
                            const anBefore = analyzeMealIngredients(meal, foodItems, foodItemIndex);

                            // 1. Deduct FIRST
                            const { snapshots, oldestCounter } = await deductIngredientsFromStock(partialMeal);
                            
                            let finalCounterDate: string | null = null;
                            if (oldestCounter) finalCounterDate = oldestCounter;
                            else if (anBefore.earliestCounterDate) finalCounterDate = anBefore.earliestCounterDate;

                            const result = await addMealToPossibleDirectly.mutateAsync({
                              name: meal.name, category: cat.value,
                              calories: meal.calories, protein: meal.protein, grams: meal.grams, ingredients: meal.ingredients,
                              expiration_date: anBefore.earliestExpiration,
                              counter_start_date: finalCounterDate,
                            });

                            if (result?.id) {
                              updateSnapshots(prev => ({ ...prev, [result.id]: snapshots }));
                              if (partialMeal.ingredients && partialMeal.ingredients !== meal.ingredients) {
                                updatePossibleIngredients.mutate({ id: result.id, ingredients_override: partialMeal.ingredients });
                              }
                            }
                          }}
                          onMoveNameMatchToPossible={async (meal, fi, ratio) => {
                            if (fi.is_infinite && ratio && ratio !== 1) {
                              // Infinite card with multiplier - create with ORIGINAL values, set override for scaling
                              const baseGrams = parseQty(meal.grams);
                              const baseIng = meal.ingredients ? meal.ingredients : (baseGrams > 0 ? `${baseGrams}g ${meal.name}` : null);
                              const scaledIng = baseIng ? scaleIngredientStringExact(baseIng, ratio) : null;
                              const result = await addMealToPossibleDirectly.mutateAsync({
                                name: meal.name, category: cat.value,
                                calories: meal.calories, protein: meal.protein, grams: meal.grams,
                                ingredients: baseIng,
                                expiration_date: fi.expiration_date,
                                counter_start_date: fi.counter_start_date,
                              });
                              if (result?.id && scaledIng) {
                                updatePossibleIngredients.mutate({ id: result.id, ingredients_override: scaledIng });
                              }
                              return;
                            }
                            const snapshot = [{ ...fi }];
                            if (!fi.is_infinite) await deductNameMatchStock(meal);
                            const finalCd = fi.counter_start_date;
                            const result = await moveToPossible.mutateAsync({ mealId: meal.id, expiration_date: fi.expiration_date, counter_start_date: finalCd });
                            if (result?.id) updateSnapshots(prev => ({ ...prev, [result.id]: snapshot }));
                          }}
                          onMoveFoodItemToPossible={async (fi) => {
                            const snapshot = [{ ...fi }];
                            if (!fi.is_infinite) {
                              const currentQty = fi.quantity ?? 1;
                              if (currentQty <= 1) { await supabase.from("food_items").delete().eq("id", fi.id); }
                              else { await supabase.from("food_items").update({ quantity: currentQty - 1 } as any).eq("id", fi.id); }
                              qc.invalidateQueries({ queryKey: ["food_items"] });
                            }
                            const fiKey = normalizeKey(fi.name);
                            const fiMacro = macroLookup.get(fiKey);
                            const calories = fi.calories || fiMacro?.cal || null;
                            const protein = fi.protein || fiMacro?.pro || null;
                            const finalCd = fi.counter_start_date;
                            const pmResult = await addMealToPossibleDirectly.mutateAsync({
                              name: fi.name, category: cat.value,
                              calories, protein, grams: fi.grams,
                              expiration_date: fi.expiration_date,
                              counter_start_date: finalCd
                            });
                            if (pmResult?.id) updateSnapshots(prev => ({ ...prev, [pmResult.id]: snapshot }));
                          }}
                          onDeleteFoodItem={(id) => { deleteFoodItem(id); }}
                          onRename={(id, name) => renameMeal.mutate({ id, name })}
                          onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                          onUpdateGrams={(id, g) => updateGrams.mutate({ id, grams: g })}
                          onUpdateIngredients={(id, ing) => updateIngredients.mutate({ id, ingredients: ing })}
                          onToggleFavorite={(id) => {
                            const meal = meals.find((m) => m.id === id);
                            if (meal) toggleFavorite.mutate({ id, is_favorite: !meal.is_favorite });
                          }}
                          onUpdateOvenTemp={(id, t) => updateOvenTemp.mutate({ id, oven_temp: t })}
                          onUpdateOvenMinutes={(id, m) => updateOvenMinutes.mutate({ id, oven_minutes: m })} />

                      </div>
                      <div className="order-3 md:order-2">
                        <LazyPossibleList
                          category={cat}
                          items={getSortedPossible(cat.value)}
                          sortMode={sortModes[cat.value] || "manual"}
                          stockMap={stockMap}
                          onToggleSort={() => toggleSort(cat.value)}
                          onRandomPick={() => handleRandomPick(cat.value)}
                          onRemove={(id) => { removeFromPossible.mutate(id); }}
                          onReturnWithoutDeduction={async (id) => {
                            const pm = getPossibleByCategory(cat.value).find(p => p.id === id);
                            const snapshots = deductionSnapshots[id];
                            if (snapshots && snapshots.length > 0) {
                              // Restauration exacte depuis les snapshots (état avant déduction)
                              await restoreIngredientsToStock({} as Meal, snapshots);
                            } else if (pm?.meals) {
                              // Sans snapshots : utiliser les ingredients_override (quantités modifiées)
                              // pour restaurer le bon montant, sinon la recette d'origine
                              const mealForRestore = pm.ingredients_override
                                ? { ...pm.meals, ingredients: pm.ingredients_override }
                                : pm.meals;
                              await restoreIngredientsToStock(mealForRestore);
                            }
                            updateSnapshots(prev => { const next = { ...prev }; delete next[id]; return next; });
                            removeFromPossible.mutate(id);
                            setUnParUnSourcePmIds(prev => { const next = new Set(prev); next.delete(id); return next; });

                            if (pm) {
                              const remainingMeals = possibleMeals.filter(p => p.id !== id);
                              const ing = pm.ingredients_override ?? pm.meals?.ingredients;
                              updateFoodItemCountersForPlanning(null, ing, null, null, null, null, remainingMeals);
                            }
                          }}
                          onReturnToMaster={(id) => {
                            const pm = getPossibleByCategory(cat.value).find(p => p.id === id);
                            removeFromPossible.mutate(id);
                            setMasterSourcePmIds(prev => { const next = new Set(prev); next.delete(id); return next; });

                            if (pm) {
                              const remainingMeals = possibleMeals.filter(p => p.id !== id);
                              const ing = pm.ingredients_override ?? pm.meals?.ingredients;
                              updateFoodItemCountersForPlanning(null, ing, null, null, null, null, remainingMeals);
                            }
                          }}
                          onSplitQuantity={(id, ratio, baseIng) => splitPossibleMealQuantity.mutate({ id, ratio, baseIngredients: baseIng })}
                          onDelete={(id) => { 
                            const pm = possibleMeals.find(p => p.id === id);
                            deletePossibleMeal.mutate(id); 

                            if (pm) {
                              const remainingMeals = possibleMeals.filter(p => p.id !== id);
                              const ing = pm.ingredients_override ?? pm.meals?.ingredients;
                              updateFoodItemCountersForPlanning(null, ing, null, null, null, null, remainingMeals);
                            }
                          }}
                          onDuplicate={async (id) => {
                            const pm = possibleMeals.find(p => p.id === id);
                            if (pm?.meals) {
                              // Use the overridden ingredients if present, deduct from stock
                              const ingredientsToDeduce = pm.ingredients_override ?? pm.meals.ingredients;
                              const mealForDeduction = { ...pm.meals, ingredients: ingredientsToDeduce };
                              const { snapshots } = await deductIngredientsFromStock(mealForDeduction);
                              // Create the duplicate and store snapshots under its new ID
                              const newId = await duplicatePossibleMeal.mutateAsync(id);
                              if (newId && snapshots.length > 0) {
                                updateSnapshots(prev => ({ ...prev, [newId]: snapshots }));
                              }
                            } else {
                              duplicatePossibleMeal.mutate(id);
                            }
                          }}
                           onUpdatePlanning={(id, day, time, counter) => {
                             const pm = possibleMeals.find(p => p.id === id);
                             if (pm) {
                               const isOccupied = unParUnSourcePmIds.has(id) || masterSourcePmIds.has(id);
                               const effectiveCounter = isOccupied ? null : counter;
                               updatePlanning.mutate({ id, day_of_week: day, meal_time: time, counter_start_date: effectiveCounter });
                               const fallbackDate = effectiveCounter || pm.counter_start_date || null;
                               const ing = pm.ingredients_override ?? pm.meals?.ingredients;
                               updateFoodItemCountersForPlanning(id, ing, day, time, fallbackDate, pm.created_at, possibleMeals);
                             }
                           }}
                          onUpdateCounter={(id, d) => updateCounter.mutate({ id, counter_start_date: d })}
                          onUpdateCalories={(id, cal) => updateCalories.mutate({ id, calories: cal })}
                          onUpdateGrams={async (id, g, pmId) => {
                            const pm = pmId ? possibleMeals.find(p => p.id === pmId) : possibleMeals.find(p => p.meal_id === id);
                            if (pm && unParUnSourcePmIds.has(pm.id)) {
                              if (pm.meals) {
                                const oldGrams = parseQty(pm.meals.grams);
                                const newGrams = parseQty(g);
                                const delta = oldGrams - newGrams;
                                if (delta !== 0) {
                                  const snapshots = deductionSnapshots[pm.id];
                                  let matchingFi = foodItems.find(fi => snapshots?.[0] ? fi.id === snapshots[0].id : strictNameMatch(fi.name, pm.meals.name) && !fi.is_infinite);
                                  if (matchingFi) {
                                    const perUnit = parseQty(matchingFi.grams);
                                    if (delta > 0) {
                                      if (matchingFi.quantity && matchingFi.quantity >= 1 && perUnit > 0) {
                                        const currentTotal = getFoodItemTotalGrams(matchingFi);
                                        const newTotal = currentTotal + delta;
                                        const fullUnits = Math.floor(newTotal / perUnit);
                                        const rem = Math.round((newTotal - fullUnits * perUnit) * 10) / 10;
                                        await supabase.from("food_items").update({ quantity: rem > 0 ? fullUnits + 1 : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null) } as any).eq("id", matchingFi.id);
                                        if (rem <= 0 && matchingFi.counter_start_date) await supabase.from("food_items").update({ counter_start_date: null } as any).eq("id", matchingFi.id);
                                      } else {
                                        const current = parseQty(matchingFi.grams);
                                        await supabase.from("food_items").update({ grams: formatNumeric(current + delta) } as any).eq("id", matchingFi.id);
                                      }
                                    } else {
                                      const toDeduct = -delta;
                                      const totalAvail = getFoodItemTotalGrams(matchingFi);
                                      const remaining = totalAvail - toDeduct;
                                      if (remaining <= 0) { await supabase.from("food_items").delete().eq("id", matchingFi.id); }
                                      else if (matchingFi.quantity && matchingFi.quantity >= 1 && perUnit > 0) {
                                        const fullUnits = Math.floor(remaining / perUnit);
                                        const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
                                        await supabase.from("food_items").update({ quantity: rem > 0 ? Math.max(1, fullUnits + 1) : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null) } as any).eq("id", matchingFi.id);
                                      } else { await supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", matchingFi.id); }
                                    }
                                    qc.invalidateQueries({ queryKey: ["food_items"] });
                                  } else if (delta > 0 && snapshots?.[0]) {
                                    // Item was deleted entirely. Recreate it with returned delta
                                    const sn = snapshots[0];
                                    const { id: _id, created_at, quantity, grams, ...rest } = sn as Record<string, any>;
                                    const perUnit = parseQty(sn.grams);
                                    if (sn.quantity !== null && sn.quantity >= 1 && perUnit > 0) {
                                      const fullUnits = Math.floor(delta / perUnit);
                                      const rem = Math.round((delta - fullUnits * perUnit) * 10) / 10;
                                      await supabase.from("food_items").insert({
                                        ...rest,
                                        quantity: rem > 0 ? fullUnits + 1 : fullUnits,
                                        grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null)
                                      } as any);
                                    } else {
                                      await supabase.from("food_items").insert({
                                        ...rest,
                                        grams: formatNumeric(delta)
                                      } as any);
                                    }
                                    qc.invalidateQueries({ queryKey: ["food_items"] });
                                  }
                                }
                              }
                            }
                            updateGrams.mutate({ id, grams: g });
                          }}
                          onUpdateIngredients={(id, ing) => updateIngredients.mutate({ id, ingredients: ing })}
                          onUpdatePossibleIngredients={async (pmId, newIngredients) => {
                            const pm = possibleMeals.find(p => p.id === pmId);
                            if (!pm) return;
                            const oldIngredients = pm.ingredients_override ?? pm.meals?.ingredients;
                            if (oldIngredients || newIngredients) {
                              const newSnaps = await adjustStockForIngredientChange(oldIngredients, newIngredients, deductionSnapshots[pmId]);
                              if (newSnaps.length > 0) {
                                updateSnapshots(prev => ({
                                  ...prev,
                                  [pmId]: [...(prev[pmId] ?? []), ...newSnaps],
                                }));
                              }
                            }
                            let finalIngredients = newIngredients;
                            if (newIngredients) {
                              const { sourceIngredients } = propagateIngredientMacros('__pm__', newIngredients, meals);
                              finalIngredients = sourceIngredients;
                            }
                            updatePossibleIngredients.mutate({ id: pmId, ingredients_override: finalIngredients });
                          }}
                          onUpdateQuantity={async (id, qty) => {
                            if (unParUnSourcePmIds.has(id)) {
                              const pm = possibleMeals.find(p => p.id === id);
                              if (pm?.meals) {
                                const oldQty = pm.quantity;
                                const delta = oldQty - qty;
                                if (delta !== 0) {
                                  const snapshots = deductionSnapshots[pm.id];
                                  let matchingFi = foodItems.find(fi => snapshots?.[0] ? fi.id === snapshots[0].id : strictNameMatch(fi.name, pm.meals.name) && !fi.is_infinite);
                                  if (matchingFi) {
                                    if (delta > 0) {
                                      const newStockQty = (matchingFi.quantity ?? 0) + delta;
                                      const perUnit = parseQty(matchingFi.grams);
                                      const partial = parsePartialQty(matchingFi.grams);
                                      const hasPartial = partial > 0 && partial < perUnit;
                                      const updateData: any = { quantity: newStockQty };
                                      if (!hasPartial && matchingFi.counter_start_date) updateData.counter_start_date = null;
                                      await supabase.from("food_items").update(updateData).eq("id", matchingFi.id);
                                    } else {
                                      const toDeduct = -delta;
                                      const currentQty = matchingFi.quantity ?? 1;
                                      if (currentQty <= toDeduct) { await supabase.from("food_items").delete().eq("id", matchingFi.id); }
                                      else { await supabase.from("food_items").update({ quantity: currentQty - toDeduct } as any).eq("id", matchingFi.id); }
                                    }
                                    qc.invalidateQueries({ queryKey: ["food_items"] });
                                  } else if (delta > 0 && snapshots?.[0]) {
                                    // Recreate deleted item
                                    const sn = snapshots[0];
                                    const { id: _id, created_at, quantity, ...rest } = sn as Record<string, any>;
                                    await supabase.from("food_items").insert({
                                      ...rest,
                                      quantity: delta
                                    } as any);
                                    qc.invalidateQueries({ queryKey: ["food_items"] });
                                  } else if (delta < 0) {
                                    toast({ title: "⚠️ Stock insuffisant", description: `Plus de "${pm.meals.name}" en stock.` });
                                  }
                                }
                              }
                            }
                            updatePossibleQuantity.mutate({ id, quantity: qty });
                          }}
                          onReorder={(from, to) => handleReorderPossible(cat.value, from, to)}
                          onExternalDrop={(mealId, source, pmId) => handleMoveToPossibleGeneral(mealId, source, pmId)}
                          highlightedId={highlightedId}
                          foodItems={foodItems}
                          onAddDirectly={() => openDialog("possible")}
                          masterSourcePmIds={masterSourcePmIds}
                          unParUnSourcePmIds={unParUnSourcePmIds} />
                      </div>

                      {cat.value === "plat" && (
                        <div className="order-2 md:order-3 md:col-span-2">
                          <LazyUnParUnSection
                            category={cat}
                            foodItems={foodItems}
                            allMeals={meals}
                            collapsed={collapsedSections[`unparun-${cat.value}`] ?? true}
                            onToggleCollapse={() => toggleSectionCollapse(`unparun-${cat.value}`)}
                            sortMode={unParUnSortModes[cat.value] || "expiration"}
                            onToggleSort={() => {
                              const current = unParUnSortModes[cat.value] || "expiration";
                              const next: UnParUnSortMode = current === "manual" ? "expiration" : "manual";
                              setUnParUnSort(cat.value, next);
                            }}
                            onMoveToPossible={async (fi, consumeQty, consumeGrams) => {
                              const snapshot = [{ ...fi }];
                              if (!fi.is_infinite) {
                                const perUnit = parseQty(fi.grams);
                                if (perUnit > 0) {
                                  const totalDeduct = (consumeQty || 0) * perUnit + (consumeGrams || 0);
                                  if (totalDeduct <= 0 && (consumeQty !== undefined || consumeGrams !== undefined)) return; // Explicitly 0
                                  const actualDeduct = totalDeduct > 0 ? totalDeduct : perUnit;
                                  const totalAvail = getFoodItemTotalGrams(fi);
                                  const remaining = totalAvail - actualDeduct;
                                  if (remaining <= 0) { await supabase.from("food_items").delete().eq("id", fi.id); }
                                  else if (fi.quantity && fi.quantity >= 1) {
                                    const fullUnits = Math.floor(remaining / perUnit);
                                    const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
                                    if (rem > 0) { await supabase.from("food_items").update({ quantity: Math.max(1, fullUnits + 1), grams: encodeStoredGrams(perUnit, rem) } as any).eq("id", fi.id); }
                                    else if (fullUnits > 0) { await supabase.from("food_items").update({ quantity: fullUnits, grams: formatNumeric(perUnit), counter_start_date: null } as any).eq("id", fi.id); }
                                    else { await supabase.from("food_items").delete().eq("id", fi.id); }
                                  } else { await supabase.from("food_items").update({ grams: formatNumeric(remaining) } as any).eq("id", fi.id); }
                                } else {
                                  if (consumeQty === 0) return; // Explicitly 0
                                  const deductQty = consumeQty || 1;
                                  const currentQty = fi.quantity ?? 1;
                                  if (currentQty <= deductQty) { await supabase.from("food_items").delete().eq("id", fi.id); }
                                  else { await supabase.from("food_items").update({ quantity: currentQty - deductQty } as any).eq("id", fi.id); }
                                }
                                qc.invalidateQueries({ queryKey: ["food_items"] });
                              }
                              const unitG = parseQty(fi.grams);
                              const totalMovedG = unitG > 0 ? ((consumeQty || 0) * unitG + (consumeGrams || 0)) : 0;
                              if (totalMovedG <= 0 && (consumeQty !== undefined || consumeGrams !== undefined)) return;
                              const actualMovedG = totalMovedG > 0 ? totalMovedG : (unitG > 0 ? unitG : 0);

                              const displayGrams = actualMovedG > 0 ? String(actualMovedG) : (fi.grams ? String(parseQty(fi.grams)) : null);
                              const displayQty = consumeQty || (consumeGrams ? Math.ceil(consumeGrams / (unitG || 1)) : 1);

                              let ratio = 1;
                              if (unitG > 0) {
                                ratio = actualMovedG / unitG;
                              } else if (consumeQty !== undefined) {
                                ratio = consumeQty || 1;
                              }


                              const fiKey = normalizeKey(fi.name);
                              const fiMacro = macroLookup.get(fiKey);
                              const calFromFi = !!fi.calories;
                              const proFromFi = !!fi.protein;
                              const baseCalStr = fi.calories || fiMacro?.cal || "0";
                              const baseProStr = fi.protein || fiMacro?.pro || "0";

                              const baseCal = parseFloat(String(baseCalStr).replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
                              const basePro = parseFloat(String(baseProStr).replace(',', '.').replace(/[^0-9.]/g, '')) || 0;

                              // fi.calories = per-unit → scale by ratio; fiMacro.cal = per-100g → scale by grams/100
                              const calories = baseCal > 0
                                ? formatNumeric(calFromFi ? baseCal * ratio : (baseCal / 100) * actualMovedG)
                                : null;
                              const protein = basePro > 0
                                ? formatNumeric(proFromFi ? basePro * ratio : (basePro / 100) * actualMovedG)
                                : null;
                              const pmResult = await addMealToPossibleDirectly.mutateAsync({
                                name: fi.name, category: cat.value, calories, protein, grams: displayGrams,
                                expiration_date: fi.expiration_date, possible_quantity: displayQty,
                                counter_start_date: fi.counter_start_date,
                              });
                              if (pmResult?.id) {
                                updateSnapshots(prev => ({ ...prev, [pmResult.id]: snapshot }));
                                setUnParUnSourcePmIds(prev => new Set([...prev, pmResult.id]));
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </ErrorBoundary>
                </TabsContent>
              )}
            </Tabs>
          }
        </Suspense>
      </main>
    </div>);
};

export default Index;
