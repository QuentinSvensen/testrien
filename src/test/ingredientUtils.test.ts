import { describe, it, expect } from "vitest";
import {
  computeIngredientCalories, computeIngredientProtein,
  smartFoodContains, cleanIngredientText,
  parseIngredientsToLines, serializeIngredients,
  extractIngredientMacros, applyIngredientMacros,
  normalizeForMatch, normalizeKey,
} from "@/lib/ingredientUtils";

// ─── CALORIE COMPUTATION ────────────────────────────────────────────────────

describe("computeIngredientCalories", () => {
  it("computes calories from gram-based ingredient", () => {
    // 200g poulet {165} → 165 * 200/100 = 330
    expect(computeIngredientCalories("200g Poulet{165}")).toBe(330);
  });

  it("computes calories from count-based ingredient", () => {
    // 2 Oeufs{78} → 78 * 2 = 156
    expect(computeIngredientCalories("2 Oeufs{78}")).toBe(156);
  });

  it("sums multiple ingredients", () => {
    // 200g Poulet{165}, 100g Riz{130} → 330 + 130 = 460
    expect(computeIngredientCalories("200g Poulet{165}, 100g Riz{130}")).toBe(460);
  });

  it("returns null when no cal data", () => {
    expect(computeIngredientCalories("200g Poulet, 100g Riz")).toBeNull();
  });

  it("returns null for empty/null input", () => {
    expect(computeIngredientCalories(null)).toBeNull();
    expect(computeIngredientCalories("")).toBeNull();
  });

  it("skips optional ingredients", () => {
    // Only non-optional should count
    expect(computeIngredientCalories("200g Poulet{165}, ?50g Parmesan{431}")).toBe(330);
  });

  it("handles OR groups — picks first by default", () => {
    expect(computeIngredientCalories("100g Pain{265} | 100g Baguette{289}")).toBe(265);
  });

  it("handles OR groups with isAvailable callback", () => {
    const isAvailable = (name: string) => normalizeForMatch(name).includes("baguette");
    expect(computeIngredientCalories("100g Pain{265} | 100g Baguette{289}", isAvailable)).toBe(289);
  });

  it("handles ingredient with cal but no qty (raw cal value)", () => {
    expect(computeIngredientCalories("Sauce{50}")).toBe(50);
  });
});

// ─── PROTEIN COMPUTATION ────────────────────────────────────────────────────

describe("computeIngredientProtein", () => {
  it("computes protein from gram-based ingredient", () => {
    // 200g Poulet [31] → 31 * 200/100 = 62
    expect(computeIngredientProtein("200g Poulet [31]")).toBe(62);
  });

  it("computes protein from count-based", () => {
    // 3 Oeufs [6] → 6 * 3 = 18
    expect(computeIngredientProtein("3 Oeufs [6]")).toBe(18);
  });

  it("returns null when no protein data", () => {
    expect(computeIngredientProtein("200g Poulet")).toBeNull();
  });
});

// ─── SMART FOOD CONTAINS ────────────────────────────────────────────────────

describe("smartFoodContains", () => {
  it("matches same food", () => {
    expect(smartFoodContains("poulet", "poulet")).toBe(true);
  });

  it("accepts adjective additions", () => {
    expect(smartFoodContains("pâte intégrale", "pâte")).toBe(true);
    expect(smartFoodContains("poulet fumé", "poulet")).toBe(true);
  });

  it("rejects compound food names with prepositions", () => {
    expect(smartFoodContains("pain de mie", "pain")).toBe(false);
  });

  it("rejects accent-different words", () => {
    expect(smartFoodContains("pâté", "pâte")).toBe(false);
  });

  it("handles trailing 'e' tolerance", () => {
    expect(smartFoodContains("hachée", "haché")).toBe(true);
  });

  it("returns false for empty strings", () => {
    expect(smartFoodContains("", "poulet")).toBe(false);
    expect(smartFoodContains("poulet", "")).toBe(false);
  });
});

// ─── CLEAN INGREDIENT TEXT ──────────────────────────────────────────────────

describe("cleanIngredientText", () => {
  it("strips cal and pro markers", () => {
    expect(cleanIngredientText("200g Poulet{165} [31]")).toBe("200g Poulet");
  });

  it("handles null/undefined", () => {
    expect(cleanIngredientText(null)).toBe("");
    expect(cleanIngredientText(undefined)).toBe("");
  });

  it("strips multiple markers", () => {
    expect(cleanIngredientText("100g Riz{130}, 2 Oeufs{78} [6]")).toBe("100g Riz, 2 Oeufs");
  });
});

// ─── MACRO EXTRACTION/APPLICATION ───────────────────────────────────────────

describe("extractIngredientMacros", () => {
  it("extracts cal and pro from ingredients", () => {
    const macros = extractIngredientMacros("200g Poulet{165} [31], 100g Riz{130}");
    expect(macros.get(normalizeKey("Poulet"))).toEqual({ cal: "165", pro: "31" });
    expect(macros.get(normalizeKey("Riz"))).toEqual({ cal: "130", pro: "" });
  });

  it("returns empty map for null input", () => {
    expect(extractIngredientMacros(null).size).toBe(0);
  });
});

describe("applyIngredientMacros", () => {
  it("applies macros to matching ingredients", () => {
    const macros = new Map([
      [normalizeKey("Poulet"), { cal: "165", pro: "31" }],
    ]);
    const result = applyIngredientMacros("200g Poulet, 100g Riz", macros);
    expect(result).toContain("{165}");
    expect(result).toContain("[31]");
  });

  it("returns null when nothing changes", () => {
    const macros = new Map([
      [normalizeKey("Beurre"), { cal: "717", pro: "" }],
    ]);
    expect(applyIngredientMacros("200g Poulet", macros)).toBeNull();
  });
});

// ─── SERIALIZE ROUNDTRIP ────────────────────────────────────────────────────

describe("parseIngredientsToLines / serializeIngredients roundtrip", () => {
  it("roundtrips simple ingredients", () => {
    const raw = "200g Poulet, 100g Riz";
    const lines = parseIngredientsToLines(raw);
    const serialized = serializeIngredients(lines);
    expect(serialized).toBe("200g Poulet, 100g Riz");
  });

  it("roundtrips OR alternatives", () => {
    const raw = "100g Pain | 100g Baguette, 2 Oeufs";
    const lines = parseIngredientsToLines(raw);
    const serialized = serializeIngredients(lines);
    expect(serialized).toBe("100g Pain | 100g Baguette, 2 Oeufs");
  });

  it("preserves optional markers", () => {
    const raw = "200g Poulet, ?50g Parmesan";
    const lines = parseIngredientsToLines(raw);
    const serialized = serializeIngredients(lines);
    expect(serialized).toBe("200g Poulet, ?50g Parmesan");
  });

  it("preserves cal/pro markers", () => {
    const raw = "200g Poulet{165} [31]";
    const lines = parseIngredientsToLines(raw);
    const serialized = serializeIngredients(lines);
    expect(serialized).toContain("{165}");
    expect(serialized).toContain("[31]");
  });
});
