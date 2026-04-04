/**
 * useSortModes — Hook de gestion des modes de tri.
 *
 * Centralise l'état de tri pour toutes les listes (possible, master,
 * available, un-par-un, food items) avec synchronisation en base
 * et debounce pour éviter les écritures trop fréquentes.
 *
 * Types exportés : FoodSortMode
 * Fonctions : toggleSort, toggleSortDirection, resetToManual
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { usePreferences } from "@/hooks/usePreferences";

type SortMode = "manual" | "expiration" | "planning";
type MasterSortMode = "manual" | "calories" | "protein" | "favorites" | "ingredients";
type AvailableSortMode = "manual" | "calories" | "protein" | "expiration";
type UnParUnSortMode = "manual" | "expiration";
type FoodSortMode = "manual" | "expiration" | "name" | "calories" | "protein";

export type { SortMode, MasterSortMode, AvailableSortMode, UnParUnSortMode, FoodSortMode };

interface UseSortModesOptions {
  enabled: boolean;
}

export function useSortModes({ enabled }: UseSortModesOptions) {
  const { getPreference, setPreference } = usePreferences({ enabled });

  // Valeurs de la base de données
  const dbSortModes = getPreference<Record<string, SortMode>>('meal_sort_modes', {});
  const dbMasterSortModes = getPreference<Record<string, MasterSortMode>>('meal_master_sort_modes', {});
  const dbAvailableSortModes = getPreference<Record<string, AvailableSortMode>>('meal_available_sort_modes', {});
  const dbUnParUnSortModes = getPreference<Record<string, UnParUnSortMode>>('meal_unparun_sort_modes', {});
  const dbFoodSortModes = getPreference<Record<string, FoodSortMode>>('food_sort_modes_v2', {});
  const dbSortDirections = getPreference<Record<string, boolean>>('meal_sort_directions', {});

  // État local
  const [sortModes, setSortModes] = useState<Record<string, SortMode>>(() => {
    const saved = localStorage.getItem('meal_sort_modes');
    return saved ? JSON.parse(saved) : {};
  });
  const [masterSortModes, setMasterSortModes] = useState<Record<string, MasterSortMode>>(() => {
    const saved = localStorage.getItem('meal_master_sort_modes');
    return saved ? JSON.parse(saved) : {};
  });
  const [availableSortModes, setAvailableSortModes] = useState<Record<string, AvailableSortMode>>(() => {
    const saved = localStorage.getItem('meal_available_sort_modes');
    return saved ? JSON.parse(saved) : {};
  });
  const [unParUnSortModes, setUnParUnSortModes] = useState<Record<string, UnParUnSortMode>>(() => {
    const saved = localStorage.getItem('meal_unparun_sort_modes');
    return saved ? JSON.parse(saved) : {};
  });
  const [foodSortModes, setFoodSortModes] = useState<Record<string, FoodSortMode>>(() => {
    const saved = localStorage.getItem('food_sort_modes_v2');
    return saved ? JSON.parse(saved) : {};
  });
  const [sortDirections, setSortDirections] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('meal_sort_directions');
    return saved ? JSON.parse(saved) : {};
  });

  // Références de synchronisation
  const dbSyncedRef = useRef(false);
  const dbMasterSyncedRef = useRef(false);
  const dbAvailableSyncedRef = useRef(false);
  const dbUnParUnSyncedRef = useRef(false);
  const dbFoodSyncedRef = useRef(false);
  const dbDirectionsSyncedRef = useRef(false);

  const dbSortModesRef = useRef(dbSortModes);
  dbSortModesRef.current = dbSortModes;
  const dbMasterSortModesRef = useRef(dbMasterSortModes);
  dbMasterSortModesRef.current = dbMasterSortModes;
  const dbAvailableSortModesRef = useRef(dbAvailableSortModes);
  dbAvailableSortModesRef.current = dbAvailableSortModes;
  const dbUnParUnSortModesRef = useRef(dbUnParUnSortModes);
  dbUnParUnSortModesRef.current = dbUnParUnSortModes;
  const dbFoodSortModesRef = useRef(dbFoodSortModes);
  dbFoodSortModesRef.current = dbFoodSortModes;
  const dbSortDirectionsRef = useRef(dbSortDirections);
  dbSortDirectionsRef.current = dbSortDirections;

  useEffect(() => {
    if (dbSyncedRef.current) return;
    const val = dbSortModesRef.current;
    if (val && Object.keys(val).length > 0) { setSortModes(val); dbSyncedRef.current = true; }
  }, [dbSortModes]);
  useEffect(() => {
    if (dbMasterSyncedRef.current) return;
    const val = dbMasterSortModesRef.current;
    if (val && Object.keys(val).length > 0) { setMasterSortModes(val); dbMasterSyncedRef.current = true; }
  }, [dbMasterSortModes]);
  useEffect(() => {
    if (dbAvailableSyncedRef.current) return;
    const val = dbAvailableSortModesRef.current;
    if (val && Object.keys(val).length > 0) { setAvailableSortModes(val); dbAvailableSyncedRef.current = true; }
  }, [dbAvailableSortModes]);
  useEffect(() => {
    if (dbUnParUnSyncedRef.current) return;
    const val = dbUnParUnSortModesRef.current;
    if (val && Object.keys(val).length > 0) { setUnParUnSortModes(val); dbUnParUnSyncedRef.current = true; }
  }, [dbUnParUnSortModes]);
  useEffect(() => {
    if (dbFoodSyncedRef.current) return;
    const val = dbFoodSortModesRef.current;
    if (val && Object.keys(val).length > 0) { setFoodSortModes(val); dbFoodSyncedRef.current = true; }
  }, [dbFoodSortModes]);
  useEffect(() => {
    if (dbDirectionsSyncedRef.current) return;
    const val = dbSortDirectionsRef.current;
    if (val && Object.keys(val).length > 0) { setSortDirections(val); dbDirectionsSyncedRef.current = true; }
  }, [dbSortDirections]);

  // Temporisateurs d'anti-rebond (debounce)
  const availableSortDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const foodSortDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const masterSortDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortDirectionDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSetPreference = useCallback((timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>, key: string, getValue: () => any, delay = 800) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setPreference.mutate({ key, value: getValue() });
      timerRef.current = null;
    }, delay);
  }, [setPreference]);

  const toggleSort = useCallback((cat: string) => {
    setSortModes((prev) => {
      const current = prev[cat] || "manual";
      const next: SortMode = current === "manual" ? "expiration" : current === "expiration" ? "planning" : "manual";
      const updated = { ...prev, [cat]: next };
      localStorage.setItem('meal_sort_modes', JSON.stringify(updated));
      setPreference.mutate({ key: 'meal_sort_modes', value: updated });
      return updated;
    });
  }, [setPreference]);

  const toggleMasterSort = useCallback((cat: string) => {
    setMasterSortModes((prev) => {
      const current = prev[cat] || "manual";
      const next: MasterSortMode = current === "manual" ? "calories" : current === "calories" ? "protein" : current === "protein" ? "favorites" : current === "favorites" ? "ingredients" : "manual";
      const updated = { ...prev, [cat]: next };
      localStorage.setItem('meal_master_sort_modes', JSON.stringify(updated));
      debouncedSetPreference(masterSortDebounce, 'meal_master_sort_modes', () => updated);
      return updated;
    });
  }, [debouncedSetPreference]);

  const toggleAvailableSort = useCallback((cat: string) => {
    setAvailableSortModes(prev => {
      const current = prev[cat] || "manual";
      const next: AvailableSortMode = current === "manual" ? "calories" : current === "calories" ? "protein" : current === "protein" ? "expiration" : "manual";
      const updated = { ...prev, [cat]: next };
      localStorage.setItem('meal_available_sort_modes', JSON.stringify(updated));
      debouncedSetPreference(availableSortDebounce, 'meal_available_sort_modes', () => updated);
      return updated;
    });
  }, [debouncedSetPreference]);

  const toggleFoodSort = useCallback((storageType: string) => {
    setFoodSortModes(prev => {
      const current = prev[storageType] || "manual";
      const next: FoodSortMode = current === "manual" ? "expiration" : current === "expiration" ? "name" : current === "name" ? "calories" : current === "calories" ? "protein" : "manual";
      const updated = { ...prev, [storageType]: next };
      localStorage.setItem('food_sort_modes_v2', JSON.stringify(updated));
      debouncedSetPreference(foodSortDebounce, 'food_sort_modes_v2', () => updated);
      return updated;
    });
  }, [debouncedSetPreference]);

  const toggleSortDirection = useCallback((key: string) => {
    setSortDirections(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      localStorage.setItem('meal_sort_directions', JSON.stringify(updated));
      debouncedSetPreference(sortDirectionDebounce, 'meal_sort_directions', () => updated);
      return updated;
    });
  }, [debouncedSetPreference]);

  const resetSortToManual = useCallback((cat: string) => {
    setSortModes((prev) => {
      const updated = { ...prev, [cat]: "manual" as SortMode };
      setPreference.mutate({ key: 'meal_sort_modes', value: updated });
      return updated;
    });
  }, [setPreference]);

  const resetMasterSortToManual = useCallback((cat: string) => {
    setMasterSortModes((prev) => {
      const updated = { ...prev, [cat]: "manual" as MasterSortMode };
      setPreference.mutate({ key: 'meal_master_sort_modes', value: updated });
      return updated;
    });
  }, [setPreference]);

  const setUnParUnSort = useCallback((cat: string, mode: UnParUnSortMode) => {
    setUnParUnSortModes(prev => {
      const updated = { ...prev, [cat]: mode };
      localStorage.setItem('meal_unparun_sort_modes', JSON.stringify(updated));
      setPreference.mutate({ key: 'meal_unparun_sort_modes', value: updated });
      return updated;
    });
  }, [setPreference]);

  const resetFoodSortToManual = useCallback((storageType: string) => {
    setFoodSortModes(prev => {
      const updated = { ...prev, [storageType]: "manual" as FoodSortMode };
      localStorage.setItem('food_sort_modes_v2', JSON.stringify(updated));
      setPreference.mutate({ key: 'food_sort_modes_v2', value: updated });
      return updated;
    });
  }, [setPreference]);

  return {
    sortModes, masterSortModes, availableSortModes, unParUnSortModes, foodSortModes, sortDirections,
    toggleSort, toggleMasterSort, toggleAvailableSort, toggleFoodSort, toggleSortDirection,
    resetSortToManual, resetMasterSortToManual, setUnParUnSort, resetFoodSortToManual,
  };
}
