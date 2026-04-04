/**
 * foodSortUtils — Logique de tri partagée pour les aliments.
 *
 * getSortedFoodItems() : trie les aliments selon le mode sélectionné :
 * - manual : ordre personnalisé via sort_order
 * - expiration : périmés d'abord, puis par date croissante
 * - name : tri alphabétique
 * - calories / protein : tri numérique ascendant ou descendant
 */
import { FoodItem } from "@/hooks/useFoodItems";
import { FoodSortMode } from "@/hooks/useSortModes";
import { computeCounterDays, isExpiredDate } from "@/lib/ingredientUtils";
export const getSortedFoodItems = (
  items: FoodItem[],
  mode: FoodSortMode,
  asc: boolean,
  searchQuery: string = ""
): FoodItem[] => {
  const normalizeSearch = (text: string) =>
    text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/s$/g, "");

  const filterBySearch = (itemsList: FoodItem[]): FoodItem[] => {
    if (!searchQuery.trim()) return itemsList;
    const q = normalizeSearch(searchQuery);
    return itemsList.filter(item => normalizeSearch(item.name).includes(q));
  };

  if (mode === "manual") return filterBySearch([...items].sort((a, b) => a.sort_order - b.sort_order));

  let sorted = [...items];

  if (mode === "expiration") {
    sorted.sort((a, b) => {
      // Règle spéciale pour les repas sans dates — les garder en haut si demandé (comportement hérité)
      if (a.is_meal && !a.expiration_date && !(b.is_meal && !b.expiration_date)) return -1;
      if (b.is_meal && !b.expiration_date && !(a.is_meal && !a.expiration_date)) return 1;

      const getActiveCounter = (fi: FoodItem) => {
        if (!fi.counter_start_date) return null;
        const c = computeCounterDays(fi.counter_start_date);
        return (c !== null && c >= 1) ? c : null;
      };

      const ac = getActiveCounter(a);
      const bc = getActiveCounter(b);
      const aExp = a.expiration_date;
      const bExp = b.expiration_date;

      // Groupes : 0=Compteur Actif (>=1j), 1=A une date d'expiration, 2=Autre
      const aG = (ac !== null) ? 0 : (aExp !== null) ? 1 : 2;
      const bG = (bc !== null) ? 0 : (bExp !== null) ? 1 : 2;

      if (aG !== bG) return asc ? aG - bG : bG - aG;

      if (aG === 0) {
        // Les deux ont des compteurs actifs >= 1j
        if (ac !== bc) return asc ? bc! - ac! : ac! - bc!;
        // Même jour de compteur : vérifier la date d'expiration comme sous-priorité
        if (aExp && bExp) {
          const cmp = aExp.localeCompare(bExp);
          if (cmp !== 0) return asc ? cmp : -cmp;
        } else if (aExp) return asc ? -1 : 1;
        else if (bExp) return asc ? 1 : -1;
      } else if (aG === 1) {
        // Les deux ont des dates d'expiration (et pas de compteur actif >= 1j)
        const cmp = aExp!.localeCompare(bExp!);
        if (cmp !== 0) return asc ? cmp : -cmp;
      }

      // Départage final au sein des groupes : Calories, puis sort_order manuel
      const parseCal = (fi: FoodItem): number => {
        if (!fi.calories) return 0;
        const m = fi.calories.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
        return m ? parseFloat(m[0]) || 0 : 0;
      };
      const cA = parseCal(a);
      const cB = parseCal(b);
      if (cA !== cB) return asc ? cA - cB : cB - cA;

      return (asc ? (a.sort_order - b.sort_order) : (b.sort_order - a.sort_order)) 
             || a.name.localeCompare(b.name);
    });
  } else if (mode === "name") {
    sorted.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
      return asc ? cmp : -cmp;
    });
  } else if (mode === "calories") {
    sorted.sort((a, b) => {
      const parseCal = (fi: FoodItem) => parseFloat((fi.calories || "0").replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
      const diff = parseCal(a) - parseCal(b);
      return asc ? diff : -diff;
    });
  } else if (mode === "protein") {
    sorted.sort((a, b) => {
      const parsePro = (fi: FoodItem) => parseFloat((fi.protein || "0").replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
      const diff = parsePro(a) - parsePro(b);
      return asc ? diff : -diff;
    });
  }

  return filterBySearch(sorted);
};
