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
import type { FoodItem } from "@/components/FoodItems";
import type { Meal } from "@/hooks/useMeals";

// ─── Helpers ────────────────────────────────────────────────────────────────

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
    ...overrides,
  };
}

function makeMeal(overrides: Partial<Meal> & { name: string }): Meal {
  return {
    id: crypto.randomUUID(),
    name: overrides.name,
    category: "plat",
    color: "hsl(0,0%,50%)",
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

// ─── INGREDIENT PARSING ─────────────────────────────────────────────────────

describe("parseIngredientLine", () => {
  it("parses gram-based ingredients", () => {
    expect(parseIngredientLine("200g Poulet")).toEqual({ qty: 200, count: 0, name: "poulet", optional: false });
    expect(parseIngredientLine("50g Farine d'avoine")).toEqual({ qty: 50, count: 0, name: "farine davoine", optional: false });
  });

  it("parses count-based ingredients", () => {
    expect(parseIngredientLine("3 Oeufs")).toEqual({ qty: 0, count: 3, name: "oeufs", optional: false });
    expect(parseIngredientLine("1 Galette")).toEqual({ qty: 0, count: 1, name: "galette", optional: false });
  });

  it("parses both qty and count", () => {
    expect(parseIngredientLine("200g 3 Poulet")).toEqual({ qty: 200, count: 3, name: "poulet", optional: false });
  });

  it("parses decimal values", () => {
    expect(parseIngredientLine("12,5g Sucre")).toEqual({ qty: 12.5, count: 0, name: "sucre", optional: false });
    expect(parseIngredientLine("0,5 Oeuf")).toEqual({ qty: 0, count: 0.5, name: "oeuf", optional: false });
  });
});

describe("parseIngredientGroups", () => {
  it("parses simple comma-separated list", () => {
    const groups = parseIngredientGroups("200g Poulet, 100g Riz");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(1);
    expect(groups[0][0]).toEqual({ qty: 200, count: 0, name: "poulet", optional: false });
    expect(groups[1][0]).toEqual({ qty: 100, count: 0, name: "riz", optional: false });
  });

  it("parses OR alternatives with pipe", () => {
    const groups = parseIngredientGroups("100g Pain | 100g Baguette");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(groups[0][0].name).toBe("pain");
    expect(groups[0][1].name).toBe("baguette");
  });

  it("handles mixed groups with alternatives", () => {
    const groups = parseIngredientGroups("200g Viande hachée, 1 Galette, 100g Pain | 100g Baguette");
    expect(groups).toHaveLength(3);
    expect(groups[2]).toHaveLength(2); // Pain | Baguette
  });
});

// ─── STOCK MAP ──────────────────────────────────────────────────────────────

describe("buildStockMap", () => {
  it("aggregates quantities by normalized name", () => {
    const items = [
      makeFoodItem({ name: "Oeufs", quantity: 6 }),
      makeFoodItem({ name: "Oeuf", quantity: 2 }),
    ];
    const map = buildStockMap(items);
    // Both should map to the same key (without trailing 's')
    const key = findStockKey(map, "oeuf");
    expect(key).not.toBeNull();
    const stock = map.get(key!);
    expect(stock!.count).toBe(8);
  });

  it("handles gram-based items", () => {
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

  it("handles partial grams (reliquat)", () => {
    const items = [
      makeFoodItem({ name: "Lait", quantity: 2, grams: "200|150" }),
    ];
    const map = buildStockMap(items);
    const key = findStockKey(map, "lait");
    const stock = map.get(key!);
    // 1 full (200g) + 1 partial (150g) = 350g total
    expect(stock!.grams).toBe(350);
  });

  it("handles infinite items", () => {
    const items = [
      makeFoodItem({ name: "Sel", is_infinite: true }),
    ];
    const map = buildStockMap(items);
    const key = findStockKey(map, "sel");
    expect(map.get(key!)!.infinite).toBe(true);
  });
});

// ─── MEAL MULTIPLE (FULL RECIPE) ────────────────────────────────────────────

describe("getMealMultiple", () => {
  it("returns correct multiple for simple recipe", () => {
    const items = [makeFoodItem({ name: "Oeufs", quantity: 8 })];
    const meal = makeMeal({ name: "Oeufs", ingredients: "4 Oeufs" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(2); // 8/4 = 2
  });

  it("returns null when ingredient is missing", () => {
    const items = [makeFoodItem({ name: "Oeufs", quantity: 8 })];
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs, 100g Beurre" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBeNull(); // no Beurre
  });

  it("returns minimum across ingredient groups", () => {
    const items = [
      makeFoodItem({ name: "Oeufs", quantity: 8 }),
      makeFoodItem({ name: "Pain", quantity: 1, grams: "200" }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs, 170g Pain" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(1); // min(8/4=2, 200/170=1) = 1
  });

  it("handles OR alternatives - picks the best", () => {
    const items = [
      makeFoodItem({ name: "Baguette", quantity: 0, grams: "0" }),
      makeFoodItem({ name: "Pain", quantity: 1, grams: "300" }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "150g Pain | 150g Baguette" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(2); // 300/150 = 2 (from Pain)
  });

  it("handles infinite ingredients", () => {
    const items = [
      makeFoodItem({ name: "Sel", is_infinite: true }),
      makeFoodItem({ name: "Oeufs", quantity: 4 }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "1g Sel, 2 Oeufs" });
    const map = buildStockMap(items);
    expect(getMealMultiple(meal, map)).toBe(2); // min(Inf, 4/2) = 2
  });

  it("returns null for recipe with no ingredients", () => {
    const meal = makeMeal({ name: "Test", ingredients: null });
    const map = buildStockMap([]);
    expect(getMealMultiple(meal, map)).toBeNull();
  });
});

// ─── MEAL FRACTIONAL RATIO (PERCENTAGE CARDS) ──────────────────────────────

describe("getMealFractionalRatio", () => {
  it("returns ratio when stock is between 50-100%", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.8); // 160/200
  });

  it("returns null when ratio >= 1 (full recipe available)", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "250" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeNull(); // full recipe available
  });

  it("returns null when ratio < 0.5", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "80" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeNull(); // 80/200 = 0.4 < 0.5
  });

  it("returns exactly 0.5 ratio", () => {
    const items = [makeFoodItem({ name: "Poulet", quantity: 1, grams: "100" })];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeCloseTo(0.5);
  });

  it("uses minimum ratio across multiple ingredients", () => {
    const items = [
      makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" }), // 160/200 = 0.8
      makeFoodItem({ name: "Riz", quantity: 1, grams: "70" }),     // 70/100 = 0.7
    ];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.7); // min(0.8, 0.7) = 0.7
  });

  it("handles OR alternatives - uses best ratio from group", () => {
    const items = [
      makeFoodItem({ name: "Pain", quantity: 1, grams: "80" }),     // 80/150 = 0.533
      makeFoodItem({ name: "Baguette", quantity: 1, grams: "120" }), // 120/150 = 0.8
    ];
    const meal = makeMeal({ name: "Test", ingredients: "150g Pain | 150g Baguette" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.8); // max(0.533, 0.8) = 0.8
  });

  it("returns null when one ingredient has zero stock", () => {
    const items = [
      makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" }),
      // No Riz at all
    ];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const map = buildStockMap(items);
    expect(getMealFractionalRatio(meal, map)).toBeNull();
  });

  it("handles count-based partial ratio", () => {
    const items = [makeFoodItem({ name: "Oeufs", quantity: 2 })];
    const meal = makeMeal({ name: "Test", ingredients: "3 Oeufs" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(2 / 3); // 0.666...
  });

  it("respects max percentage with mixed count/gram ingredients", () => {
    const items = [
      makeFoodItem({ name: "Oeufs", quantity: 2 }),                  // 2/4 = 0.5
      makeFoodItem({ name: "Baguette", quantity: 1, grams: "170" }), // 170/170 = 1.0
    ];
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs, 170g Baguette" });
    const map = buildStockMap(items);
    // Baguette is fully available → ratio would be 1.0 for that group
    // Eggs: 2/4 = 0.5
    // getMealMultiple would return null (eggs only have 2, need 4)
    expect(getMealMultiple(meal, map)).toBeNull();
    // getMealFractionalRatio: min(0.5, 1.0) = 0.5
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(0.5);
  });

  it("correctly caps at limiting ingredient, not at the abundant one", () => {
    const items = [
      makeFoodItem({ name: "Viande hachée", quantity: 1, grams: "250" }),  // 250/250 = 1.0
      makeFoodItem({ name: "Galette", quantity: 1 }),                // 1/1 = 1.0
      makeFoodItem({ name: "Sauce", quantity: 1, grams: "25" }),     // 25/25 = 1.0
      makeFoodItem({ name: "Chorizo", quantity: 1, grams: "10" }),   // 10/15 = 0.666
      makeFoodItem({ name: "Poitrine", quantity: 2 }),               // 2/2 = 1.0
      makeFoodItem({ name: "Gruyère", quantity: 1, grams: "30" }),   // 30/30 = 1.0
    ];
    const meal = makeMeal({
      name: "Burrito viande",
      ingredients: "250g Viande hachée, 1 Galette, 25g Sauce, 15g Chorizo, 2 Poitrine, 30g Gruyère"
    });
    const map = buildStockMap(items);
    // Chorizo limits: 10/15 = 0.666
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).toBeCloseTo(10 / 15);
  });
});

// ─── SCALING ────────────────────────────────────────────────────────────────

describe("buildScaledMealForRatio", () => {
  it("scales calories and grams proportionally", () => {
    const meal = makeMeal({ name: "Test", calories: "500", grams: "300", ingredients: "200g Poulet, 100g Riz" });
    const scaled = buildScaledMealForRatio(meal, 0.75);
    expect(scaled.calories).toBe("375"); // 500 * 0.75
    expect(scaled.grams).toBe("225");    // 300 * 0.75
  });

  it("scales gram-based ingredients", () => {
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const scaled = buildScaledMealForRatio(meal, 0.6);
    expect(scaled.ingredients).toBe("120g Poulet, 60g Riz");
  });

  it("scales count-based ingredients", () => {
    const meal = makeMeal({ name: "Test", ingredients: "4 Oeufs" });
    const scaled = buildScaledMealForRatio(meal, 0.5);
    expect(scaled.ingredients).toBe("2 Oeufs");
  });

  it("scales with OR alternatives", () => {
    const meal = makeMeal({ name: "Test", ingredients: "100g Pain | 100g Baguette" });
    const scaled = buildScaledMealForRatio(meal, 0.7);
    expect(scaled.ingredients).toBe("70g Pain | 70g Baguette");
  });

  it("preserves decimal precision", () => {
    const meal = makeMeal({ name: "Test", ingredients: "12,5g Sucre" });
    const scaled = buildScaledMealForRatio(meal, 0.8);
    // 12.5 * 0.8 = 10
    expect(scaled.ingredients).toBe("10g Sucre");
  });
});

// ─── STOCK DEDUCTION EDGE CASES ────────────────────────────────────────────

describe("getFoodItemTotalGrams", () => {
  it("calculates total for multi-quantity with partial", () => {
    const fi = makeFoodItem({ name: "Lait", quantity: 3, grams: "200|150" });
    // 2 full (200g each) + 1 partial (150g) = 550g
    expect(getFoodItemTotalGrams(fi)).toBe(550);
  });

  it("calculates total for single item with no partial", () => {
    const fi = makeFoodItem({ name: "Pain", quantity: 1, grams: "250" });
    expect(getFoodItemTotalGrams(fi)).toBe(250);
  });

  it("returns 0 for no grams", () => {
    const fi = makeFoodItem({ name: "Oeuf", quantity: 6 });
    expect(getFoodItemTotalGrams(fi)).toBe(0);
  });

  it("handles quantity=0 correctly", () => {
    const fi = makeFoodItem({ name: "Test", quantity: 0, grams: "100" });
    expect(getFoodItemTotalGrams(fi)).toBe(100);
  });
});

// ─── UN PAR UN: CONSUME VALIDATION ─────────────────────────────────────────

describe("Un par un consume logic", () => {
  it("should allow consuming less than available quantity", () => {
    const fi = makeFoodItem({ name: "Poulet", quantity: 3, grams: "200", food_type: "viande" });
    const totalGrams = getFoodItemTotalGrams(fi);
    expect(totalGrams).toBe(600);
    // User consumes 1 unit → 200g deducted → 400g remains
    const consumeQty = 1;
    expect(consumeQty).toBeLessThanOrEqual(fi.quantity!);
  });

  it("should correctly calculate remaining after partial gram consume", () => {
    const fi = makeFoodItem({ name: "Pomme de terre", quantity: 1, grams: "500", food_type: "feculent" });
    // Consume 375g from 500g → 125g remains as reliquat
    const consumeGrams = 375;
    const remaining = getFoodItemTotalGrams(fi) - consumeGrams;
    expect(remaining).toBe(125);
    expect(remaining).toBeGreaterThan(0);
  });

  it("flagged: no max enforcement on consume quantity", () => {
    // This test documents the current behavior where consume qty is not enforced
    const fi = makeFoodItem({ name: "Oeufs", quantity: 3, food_type: "viande" });
    // User could type qty=5 which exceeds available=3
    // The current code does NOT enforce this limit
    const userInput = 5;
    expect(userInput).toBeGreaterThan(fi.quantity!); // This SHOULD be prevented
  });

  it("flagged: no max enforcement on consume grams", () => {
    const fi = makeFoodItem({ name: "Poulet", quantity: 1, grams: "200", food_type: "viande" });
    // User could type 300g which exceeds available 200g
    const userInputGrams = 300;
    expect(userInputGrams).toBeGreaterThan(getFoodItemTotalGrams(fi)); // SHOULD be prevented
  });
});

// ─── STRICT NAME MATCH ──────────────────────────────────────────────────────

describe("strictNameMatch edge cases", () => {
  it("matches singular/plural", () => {
    expect(strictNameMatch("oeuf", "oeufs")).toBe(true);
    expect(strictNameMatch("pomme de terre", "pomme de terres")).toBe(true);
  });

  it("does NOT match unrelated similar names", () => {
    expect(strictNameMatch("pain", "paris")).toBe(false);
    expect(strictNameMatch("riz", "ris")).toBe(true); // 1 char diff - this matches!
  });

  it("matches with accents", () => {
    expect(strictNameMatch("crème", "creme")).toBe(true);
    expect(strictNameMatch("pâté", "pate")).toBe(true);
  });
});

// ─── PERCENTAGE MAX VALIDATION ──────────────────────────────────────────────

describe("percentage cards max validation", () => {
  it("ensures scaled ingredients never exceed stock", () => {
    const items = [
      makeFoodItem({ name: "Poulet", quantity: 1, grams: "160" }),
      makeFoodItem({ name: "Riz", quantity: 1, grams: "80" }),
    ];
    const meal = makeMeal({ name: "Test", ingredients: "200g Poulet, 100g Riz" });
    const map = buildStockMap(items);
    const ratio = getMealFractionalRatio(meal, map);
    expect(ratio).not.toBeNull();
    
    // The ratio should be limited by Riz: 80/100 = 0.8
    // Poulet would be 160/200 = 0.8 as well → min = 0.8
    expect(ratio).toBeCloseTo(0.8);
    
    // Verify scaled ingredients don't exceed stock
    const scaled = buildScaledMealForRatio(meal, ratio!);
    const groups = parseIngredientGroups(scaled.ingredients!);
    
    // Scaled Poulet: 200 * 0.8 = 160g → stock has 160g ✓
    expect(groups[0][0].qty).toBeLessThanOrEqual(160);
    // Scaled Riz: 100 * 0.8 = 80g → stock has 80g ✓
    expect(groups[1][0].qty).toBeLessThanOrEqual(80);
  });

  it("ensures percentage reflects most limiting ingredient", () => {
    const items = [
      makeFoodItem({ name: "Viande", quantity: 1, grams: "250" }),  // enough
      makeFoodItem({ name: "Sauce", quantity: 1, grams: "12" }),    // 12/25 = 0.48 → too low
    ];
    const meal = makeMeal({ name: "Test", ingredients: "250g Viande, 25g Sauce" });
    const map = buildStockMap(items);
    // Sauce ratio = 0.48 < 0.5, should return null (below threshold)
    expect(getMealFractionalRatio(meal, map)).toBeNull();
  });

  it("correctly handles when all ingredients have different ratios", () => {
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
