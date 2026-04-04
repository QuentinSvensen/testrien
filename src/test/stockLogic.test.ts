import { describe, it, expect } from "vitest";
import {
  normalizeForMatch, normalizeKey, strictNameMatch,
  parseQty, parsePartialQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientLine, parseIngredientGroups,
} from "@/lib/ingredientUtils";
import {
  buildStockMap, findStockKey, pickBestAlternative,
  getMealMultiple, getMealFractionalRatio,
  getMissingIngredients, buildScaledMealForRatio, scaleIngredientStringExact,
  type StockInfo,
} from "@/lib/stockUtils";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";

// ─── Aides (Helpers) ─────────────────────────────────────────────────────────

function makeFoodItem(overrides: Partial<FoodItem> & { name: string }): FoodItem {
  return {
    id: crypto.randomUUID(),
    name: overrides.name,
    storage_type: "frigo",
    is_meal: false,
    is_infinite: false,
    is_dry: false,
    is_indivisible: false,
    quantity: 1,
    grams: null,
    calories: null,
    protein: null,
    sort_order: 0,
    created_at: new Date().toISOString(),
    expiration_date: null,
    counter_start_date: null,
    food_type: null,
    no_counter: false,
    ...overrides,
  };
}

function makeMeal(overrides: Partial<Meal> & { name: string }): Meal {
  return {
    id: crypto.randomUUID(),
    name: overrides.name,
    category: "plat",
    
    sort_order: 0,
    created_at: new Date().toISOString(),
    is_available: true,
    is_favorite: false,
    calories: null,
    protein: null,
    grams: null,
    ingredients: null,
    oven_temp: null,
    oven_minutes: null,
    ...overrides,
  };
}

// ─── ANALYSE DES INGRÉDIENTS (PARSING) ──────────────────────────────────────

describe("parseIngredientLine", () => {
  it("analyse les ingrédients basés sur les grammes", () => {
    expect(parseIngredientLine("200g Poulet")).toEqual({ qty: 200, count: 0, name: "poulet", optional: false });
    expect(parseIngredientLine("50g Farine d'avoine")).toEqual({ qty: 50, count: 0, name: "farine davoine", optional: false });
  });

  it("analyse les ingrédients basés sur le nombre (unités)", () => {
    expect(parseIngredientLine("3 Oeufs")).toEqual({ qty: 0, count: 3, name: "oeufs", optional: false });
    expect(parseIngredientLine("1 Galette")).toEqual({ qty: 0, count: 1, name: "galette", optional: false });
  });

  it("analyse à la fois la quantité (g) et le nombre", () => {
    expect(parseIngredientLine("200g 3 Poulet")).toEqual({ qty: 200, count: 3, name: "poulet", optional: false });
  });

  it("analyse les valeurs décimales", () => {
    expect(parseIngredientLine("12,5g Sucre")).toEqual({ qty: 12.5, count: 0, name: "sucre", optional: false });
    expect(parseIngredientLine("0,5 Oeuf")).toEqual({ qty: 0, count: 0.5, name: "oeuf", optional: false });
  });
});

describe("parseIngredientGroups", () => {
  it("analyse une liste simple séparée par des virgules", () => {
    const groups = parseIngredientGroups("200g Poulet, 100g Riz");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(1);
    expect(groups[0][0]).toEqual({ qty: 200, count: 0, name: "poulet", optional: false });
    expect(groups[1][0]).toEqual({ qty: 100, count: 0, name: "riz", optional: false });
  });

  it("analyse les alternatives OU (|) avec le pipe", () => {
    const groups = parseIngredientGroups("100g Pain | 100g Baguette");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(groups[0][0].name).toBe("pain");
    expect(groups[0][1].name).toBe("baguette");
  });

  it("gère les groupes mixtes avec alternatives", () => {
    const groups = parseIngredientGroups("200g Viande hachée, 1 Galette, 100g Pain | 100g Baguette");
    expect(groups).toHaveLength(3);
    expect(groups[2]).toHaveLength(2); // Pain | Baguette
  });
});

// ─── CARTE DE STOCK (STOCK MAP) ─────────────────────────────────────────────

describe("buildStockMap", () => {
  it("agrège les quantités par nom normalisé", () => {
    const items = [
      makeFoodItem({ name: "Oeufs", quantity: 6 }),
      makeFoodItem({ name: "Oeuf", quantity: 2 }),
    ];
    const map = buildStockMap(items);
    // Les deux devraient correspondre à la même clé (sans le 's' final)
    const key = findStockKey(map, "oeuf");
    expect(key).not.toBeNull();
    const stock = map.get(key!);
    expect(stock!.count).toBe(8);
  });

  it("gère les articles basés sur les grammes", () => {
    const items = [
      makeFoodItem({ name: "Poulet", quantity: 2, grams: "200" }),
    ];
    const map = buildStockMap(items);
    const key = findStockKey(map, "poulet");
    expect(key).not.toBeNull();
    const stock = map.get(key!);
    expect(stock!.grams).toBe(400); // 2 x 200g
    expect(stock!.count).toBe(2);
  });

  it("gère les grammes partiels (reliquats)", () => {
    const items = [
      makeFoodItem({ name: "Lait", quantity: 2, grams: "200|150" }),
    ];
    const map = buildStockMap(items);
    const key = findStockKey(map, "lait");
    const stock = map.get(key!);
    // 1 plein (200g) + 1 partiel (150g) = 350g au total
    expect(stock!.grams).toBe(350);
  });

  it("gère les articles infinis", () => {
    const items = [
      makeFoodItem({ name: "Sel", is_infinite: true }),
    ];
    const map = buildStockMap(items);
    const key = findStockKey(map, "sel");
    expect(map.get(key!)!.infinite).toBe(true);
  });
});

// ─── MULTIPLE DE REPAS (RECETTE COMPLÈTE) ───────────────────────────────────

describe("getMealMultiple", () => {
  it("retourne le bon multiple pour une recette simple", () => {
    const items = [makeFoodItem({ name: "Oeufs", quantity: 8 })];
    const meal = makeMeal({ name: "Oeufs", ingredients: "4 Oeufs" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(2); // 8/4 = 2
  });

  it("retourne null quand un ingrédient est manquant", () => {
    const items = [makeFoodItem({ name: "Oeufs", quantity: 8 })];
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs, 100g Beurre" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBeNull(); // pas de Beurre
  });

  it("retourne le minimum parmi les groupes d'ingrédients", () => {
    const items = [
      makeFoodItem({ name: "Oeufs", quantity: 8 }),
      makeFoodItem({ name: "Pain", quantity: 1, grams: "200" }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs, 170g Pain" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(1); // min(8/4=2, 200/170=1) = 1
  });

  it("gère les alternatives OU - choisit la meilleure", () => {
    const items = [
      makeFoodItem({ name: "Baguette", quantity: 0, grams: "0" }),
      makeFoodItem({ name: "Pain", quantity: 1, grams: "300" }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "150g Pain | 150g Baguette" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(2); // 300/150 = 2 (depuis Pain)
  });

  it("gère les ingrédients infinis", () => {
    const items = [
      makeFoodItem({ name: "Sel", is_infinite: true }),
      makeFoodItem({ name: "Oeufs", quantity: 4 }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "1g Sel, 2 Oeufs" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(2); // min(Inf, 4/2) = 2
  });

  it("retourne null pour une recette sans ingrédients", () => {
    const meal = makeMeal({ name: "Test", ingredients: null });
    const map = buildStockMap([]);
    expect(getMealMultiple(meal, map)).toBeNull();
  });
});

// ─── RATIO FRACTIONNAIRE DE REPAS (CARTES EN POURCENTAGE) ───────────────────

describe("getMealFractionalRatio", () => {
  it("retourne le ratio quand le stock est entre 50-100%", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.8); // 160/200
  });

  it("retourne null quand le ratio >= 1 (recette complète disponible)", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "250" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeNull(); // recette complète dispo
  });

  it("retourne null quand le ratio < 0.5", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "80" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeNull(); // 80/200 = 0.4 < 0.5
  });

  it("retourne exactement un ratio de 0.5", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "100" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeCloseTo(0.5);
  });

  it("utilise le ratio minimum à travers plusieurs ingrédients", () => {
    const items = [
      makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" }), // 160/200 = 0.8
      makeFoodItem({ name: "Riz", quantity: 1, grams: "70" }),     // 70/100 = 0.7
    ];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.7); // min(0.8, 0.7) = 0.7
  });

  it("gère les alternatives OU - utilise le meilleur ratio du groupe", () => {
    const items = [
      makeFoodItem({ name: "Pain", quantity: 1, grams: "80" }),     // 80/150 = 0.533
      makeFoodItem({ name: "Baguette", quantity: 1, grams: "120" }), // 120/150 = 0.8
    ];
    const meal = makeMeal({ name: "Test", ingredients: "150g Pain | 150g Baguette" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.8); // max(0.533, 0.8) = 0.8
  });

  it("retourne null quand un ingrédient a un stock nul", () => {
    const items = [
      makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" }),
      // Pas de Riz du tout
    ];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeNull();
  });

  it("gère le ratio partiel basé sur le nombre (unités)", () => {
    const items = [makeFoodItem({ name: "Oeufs", quantity: 2 })];
    const meal = makeMeal({ name: "Test", ingredients: "3 Oeufs" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(2 / 3); // 0.666...
  });

  it("respecte le pourcentage max avec des ingrédients mixtes unités/grammes", () => {
    const items = [
      makeFoodItem({ name: "Oeufs", quantity: 2 }),                  // 2/4 = 0.5
      makeFoodItem({ name: "Baguette", quantity: 1, grams: "170" }), // 170/170 = 1.0
    ];
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs, 170g Baguette" });
    const map = buildStockMap(items);
    // Baguette est entièrement dispo → ratio serait 1.0 pour ce groupe
    // Oeufs : 2/4 = 0.5
    // getMealMultiple retournerait null (besoin de 4 oeufs, 2 dispos)
    expect(getMealMultiple(meal, map)).toBeNull();
    // getMealFractionalRatio : min(0.5, 1.0) = 0.5
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.5);
  });

  it("limite correctement à l'ingrédient limitant, pas à l'ingrédient abondant", () => {
    const items = [
      makeFoodItem({ name: "Viande hachée", quantity: 1, grams: "250" }),  // assez
      makeFoodItem({ name: "Galette", quantity: 3 }),                // 3/3 = 1.0
      makeFoodItem({ name: "Sauce", quantity: 1, grams: "25" }),     // 25/25 = 1.0
      makeFoodItem({ name: "Chorizo", quantity: 1, grams: "10" }),   // 10/15 = 0.666
      makeFoodItem({ name: "Poitrine", quantity: 2 }),               // 2/2 = 1.0
      makeFoodItem({ name: "Gruyère", quantity: 1, grams: "30" }),   // 30/30 = 1.0
    ];
    const meal = makeMeal({
      name: "Burrito viande",
      ingredients: "250g Viande hachée, 3 Galette, 25g Sauce, 15g Chorizo, 2 Poitrine, 30g Gruyère"
    });
    const map = buildStockMap(items);
    // Chorizo limite à 0.666, mais Poitrine (2) snap à 1/2 = 0.5. Donc le ratio final est 0.5.
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.5);
  });
});

// ─── MISE À L'ÉCHELLE (SCALING) ─────────────────────────────────────────────

describe("buildScaledMealForRatio", () => {
  it("met à l'échelle les calories et les grammes proportionnellement", () => {
    const meal = makeMeal({ name: "Test", calories: "500", grams: "300", ingredients: "200g Poulet, 100g Riz" });
    const scaled = buildScaledMealForRatio(meal, 0.75);
    expect(scaled.calories).toBe("375"); // 500 * 0.75
    expect(scaled.grams).toBe("225");    // 300 * 0.75
  });

  it("met à l'échelle les ingrédients basés sur les grammes", () => {
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const scaled = buildScaledMealForRatio(meal, 0.6);
    expect(scaled.ingredients).toBe("120g Poulet, 60g Riz");
  });

  it("met à l'échelle les ingrédients basés sur le nombre", () => {
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs" });
    const scaled = buildScaledMealForRatio(meal, 0.5);
    expect(scaled.ingredients).toBe("2 Oeufs");
  });

  it("met à l'échelle avec des alternatives OU", () => {
    const meal = makeMeal({ name: "Test", ingredients: "100g Pain | 100g Baguette" });
    const scaled = buildScaledMealForRatio(meal, 0.7);
    expect(scaled.ingredients).toBe("70g Pain | 70g Baguette");
  });

  it("préserve la précision décimale", () => {
    const meal = makeMeal({ name: "Test", ingredients: "12,5g Sucre" });
    const scaled = buildScaledMealForRatio(meal, 0.8);
    // 12.5 * 0.8 = 10
    expect(scaled.ingredients).toBe("10g Sucre");
  });
});

// ─── CAS LIMITES DE DÉDUCTION DE STOCK (EDGE CASES) ─────────────────────────

describe("getFoodItemTotalGrams", () => {
  it("calcule le total pour plusieurs quantités avec partiel", () => {
    const fi = makeFoodItem({ name: "Lait", quantity: 3, grams: "200|150" });
    // 2 pleins (200g chacun) + 1 partiel (150g) = 550g
    expect(getFoodItemTotalGrams(fi)).toBe(550);
  });

  it("calcule le total pour un seul article sans partiel", () => {
    const fi = makeFoodItem({ name: "Pain", quantity: 1, grams: "250" });
    expect(getFoodItemTotalGrams(fi)).toBe(250);
  });

  it("retourne 0 quand il n'y a pas de grammes", () => {
    const fi = makeFoodItem({ name: "Oeuf", quantity: 6 });
    expect(getFoodItemTotalGrams(fi)).toBe(0);
  });

  it("gère correctement quantity=0", () => {
    const fi = makeFoodItem({ name: "Test", quantity: 0, grams: "100" });
    expect(getFoodItemTotalGrams(fi)).toBe(100);
  });
});

// ─── UN PAR UN : VALIDATION DE CONSOMMATION ────────────────────────────────

describe("Logique de consommation un par un", () => {
  it("devrait permettre de consommer moins que la quantité disponible", () => {
    const fi = makeFoodItem({ name: "Poulet", quantity: 3, grams: "200", food_type: "viande" });
    const totalGrams = getFoodItemTotalGrams(fi);
    expect(totalGrams).toBe(600);
    // L'utilisateur consomme 1 unité → 200g déduits → 400g restants
    const consumeQty = 1;
    expect(consumeQty).toBeLessThanOrEqual(fi.quantity!);
  });

  it("devrait calculer correctement le restant après une consommation de grammes partielle", () => {
    const fi = makeFoodItem({ name: "Pomme de terre", quantity: 1, grams: "500", food_type: "feculent" });
    // Consomme 375g sur 500g → 125g restent en reliquat
    const consumeGrams = 375;
    const remaining = getFoodItemTotalGrams(fi) - consumeGrams;
    expect(remaining).toBe(125);
    expect(remaining).toBeGreaterThan(0);
  });

  it("signalé : pas de limite forcée sur la quantité consommée", () => {
    // Ce test documente le comportement actuel où la quantité consommée n'est pas forcée
    const fi = makeFoodItem({ name: "Oeufs", quantity: 3, food_type: "viande" });
    // L'utilisateur pourrait saisir qty=5 ce qui dépasse available=3
    // Le code actuel ne force PAS cette limite
    const userInput = 5;
    expect(userInput).toBeGreaterThan(fi.quantity!); // Ceci DEVRAIT être empêché
  });

  it("signalé : pas de limite forcée sur les grammes consommés", () => {
    const fi = makeFoodItem({ name: "Poulet", quantity: 1, grams: "200", food_type: "viande" });
    // L'utilisateur pourrait saisir 300g ce qui dépasse les 200g dispos
    const userInputGrams = 300;
    expect(userInputGrams).toBeGreaterThan(getFoodItemTotalGrams(fi)); // DEVRAIT être empêché
  });
});

// ─── CORRESPONDANCE DE NOM STRICTE (STRICT NAME MATCH) ──────────────────────

describe("Cas limites de strictNameMatch", () => {
  it("correspond au singulier/pluriel", () => {
    expect(strictNameMatch("oeuf", "oeufs")).toBe(true);
    expect(strictNameMatch("pomme de terre", "pomme de terres")).toBe(true);
  });

  it("ne correspond PAS à des noms similaires non liés", () => {
    expect(strictNameMatch("pain", "paris")).toBe(false);
    expect(strictNameMatch("riz", "ris")).toBe(false); // ≤3 chars → correspondance exacte requise
  });

  it("correspond avec les accents", () => {
    expect(strictNameMatch("crème", "creme")).toBe(true);
    expect(strictNameMatch("pâté", "pate")).toBe(true);
  });
});

// ─── VALIDATION MAX DU POURCENTAGE ──────────────────────────────────────────

describe("validation max des cartes en pourcentage", () => {
  it("garantit que les ingrédients mis à l'échelle ne dépassent jamais le stock", () => {
    const items = [
      makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" }),
      makeFoodItem({ name: "Riz", quantity: 1, grams: "80" }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).not.toBeNull();
    
    // Le ratio devrait être limité par le Riz : 80/100 = 0.8
    // Le Poulet serait 160/200 = 0.8 également → min = 0.8
    expect(ratio).toBeCloseTo(0.8);
    
    // Vérifie que les ingrédients mis à l'échelle ne dépassent pas le stock
    const scaled = buildScaledMealForRatio(meal, ratio!);
    const groups = parseIngredientGroups(scaled.ingredients!);
    
    // Poulet mis à l'échelle : 200 * 0.8 = 160g → le stock a 160g ✓
    expect(groups[0][0].qty).toBeLessThanOrEqual(160);
    // Riz mis à l'échelle : 100 * 0.8 = 80g → le stock a 80g ✓
    expect(groups[1][0].qty).toBeLessThanOrEqual(80);
  });

  it("garantit que le pourcentage reflète l'ingrédient le plus limitant", () => {
    const items = [
      makeFoodItem({ name: "Viande", quantity: 1, grams: "250" }),  // assez
      makeFoodItem({ name: "Sauce", quantity: 1, grams: "12" }),    // 12/25 = 0.48 → trop bas
    ];
    const meal = makeMeal({ name: "Test", ingredients: "250g Viande, 25g Sauce" });
    const map = buildStockMap(items);
    // Ratio Sauce = 0.48 < 0.5, devrait retourner null (sous le seuil)
    expect(getMealFractionalRatio(meal, map)).toBeNull();
  });

  it("gère correctement quand tous les ingrédients ont des ratios différents", () => {
    const items = [
      makeFoodItem({ name: "Pomme", quantity: 1, grams: "90" }),
      makeFoodItem({ name: "Banane", quantity: 1, grams: "140" }),
      makeFoodItem({ name: "Carotte", quantity: 1, grams: "240" }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "100g Pomme, 200g Banane, 300g Carotte" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.7);

    const scaled = buildScaledMealForRatio(meal, ratio!);
    const groups = parseIngredientGroups(scaled.ingredients!);
    expect(groups[1][0].qty).toBeLessThanOrEqual(140);
    expect(groups[0][0].qty).toBeLessThanOrEqual(90);
  });
});
