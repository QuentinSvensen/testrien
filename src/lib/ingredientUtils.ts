/**
 * Shared ingredient parsing utilities.
 * Used by MealCard, PossibleMealCard, MealPlanGenerator, Index, and stockUtils.
 */

import type { FoodItem } from "@/components/FoodItems";

// ─── Text Normalization ─────────────────────────────────────────────────────

export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim();
}

/** Lowercase but preserve accents — used to detect accent-different words (pâte vs pâté) */
export function lightNormalize(text: string): string {
  return text.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[^a-zà-ÿ0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/** Normalize + strip trailing 's' for ingredient key matching */
export function normalizeKey(name: string): string {
  return normalizeForMatch(name).replace(/s$/, "");
}

// ─── Smart Food Matching ────────────────────────────────────────────────────

/** French prepositions/articles that signal a compound food name */
const FOOD_PREPOSITIONS = new Set(['de', 'du', 'au', 'aux', 'a', 'la', 'le', 'les', 'des']);

const stripTrailingE = (s: string) => s.replace(/e+$/, '');
const fuzzyWord = (s: string) => s.replace(/[es]+$/i, '');

/**
 * Smart "contains" match for food items:
 * - Accepts adjective additions: "pâte intégrale" matches "pâte" ✓
 * - Rejects compound food names: "pain de mie" does NOT match "pain" ✗
 * - Rejects accent-different words: "pâté" does NOT match "pâte" ✗
 * - Handles trailing 'e' tolerance: "hachée" matches "haché" ✓
 */
export function smartFoodContains(a: string, b: string): boolean {
  const aNorm = normalizeForMatch(a);
  const bNorm = normalizeForMatch(b);
  if (!aNorm || !bNorm) return false;

  const wordsA = aNorm.split(/\s+/);
  const wordsB = bNorm.split(/\s+/);
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];

  // All words of shorter must appear in longer (with fuzzy e-tolerance)
  const matchedIndices = new Set<number>();
  for (const sw of shorter) {
    let found = false;
    for (let i = 0; i < longer.length; i++) {
      if (matchedIndices.has(i)) continue;
      if (longer[i] === sw || fuzzyWord(longer[i]) === fuzzyWord(sw)) {
        matchedIndices.add(i);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  // Same word count → check accent-level differences
  if (shorter.length === longer.length) {
    const aLight = lightNormalize(a).split(/\s+/);
    const bLight = lightNormalize(b).split(/\s+/);
    for (let i = 0; i < Math.min(aLight.length, bLight.length); i++) {
      // If normalized (no-accent) forms match but accented forms differ → different food (pâte vs pâté)
      if (fuzzyWord(normalizeForMatch(aLight[i])) === fuzzyWord(normalizeForMatch(bLight[i]))
          && aLight[i] !== bLight[i]
          && fuzzyWord(aLight[i]) !== fuzzyWord(bLight[i])) {
        return false;
      }
    }
    return true;
  }

  // Extra words in longer: reject if they contain prepositions (compound food name)
  const extraWords = longer.filter((_, i) => !matchedIndices.has(i));
  if (extraWords.some(w => FOOD_PREPOSITIONS.has(w))) return false;

  return true;
}

/**
 * Strict name matching: handles singular/plural ('s'), case, diacritics,
 * and a maximum distance of 1 typo.
 */
export function strictNameMatch(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (na === nb) return true;
  if (!na || !nb) return false;
  if (Math.abs(na.length - nb.length) > 1) return false;

  if (na.length === nb.length) {
    let mismatches = 0;
    for (let i = 0; i < na.length; i++) {
      if (na[i] !== nb[i]) { mismatches++; if (mismatches > 1) return false; }
    }
    return true;
  }

  const [shorter, longer] = na.length < nb.length ? [na, nb] : [nb, na];
  let si = 0, li = 0, diff = 0;
  while (si < shorter.length && li < longer.length) {
    if (shorter[si] === longer[li]) { si++; li++; } else { diff++; if (diff > 1) return false; li++; }
  }
  return true;
}

// ─── Numeric Parsing ────────────────────────────────────────────────────────

export function parseQty(qty: string | null | undefined): number {
  if (!qty) return 0;
  const [base] = qty.split("|");
  const match = base.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) || 0 : 0;
}

export function parsePartialQty(qty: string | null | undefined): number {
  if (!qty || !qty.includes("|")) return 0;
  const [, partial] = qty.split("|");
  const match = (partial || "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) || 0 : 0;
}

export function formatNumeric(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(Math.trunc(rounded)) : String(rounded).replace(/\.0$/, "");
}

export function encodeStoredGrams(unit: number, partial: number | null): string {
  const unitPart = formatNumeric(unit);
  if (!partial || partial <= 0 || partial >= unit) return unitPart;
  return `${unitPart}|${formatNumeric(partial)}`;
}

export function getFoodItemTotalGrams(fi: FoodItem): number {
  const unit = parseQty(fi.grams);
  if (unit <= 0) return 0;
  if (!fi.quantity || fi.quantity < 1) return unit;
  const partial = parsePartialQty(fi.grams);
  if (partial > 0 && partial < unit) return unit * Math.max(0, fi.quantity - 1) + partial;
  return unit * fi.quantity;
}

// ─── Ingredient Parsing (Numeric — for computation) ─────────────────────────

export interface ParsedIngredient { qty: number; count: number; name: string; optional: boolean; }
export interface ParsedIngredientRaw { qty: number; count: number; name: string; rawName: string; optional: boolean; }

export function parseIngredientLine(ing: string): ParsedIngredient {
  let trimmed = ing.trim().replace(/\s+/g, " ");
  const optional = trimmed.startsWith("?");
  if (optional) trimmed = trimmed.slice(1).trim();
  // Strip {cal} suffix
  trimmed = trimmed.replace(/\{\d+(?:[.,]\d+)?\}\s*$/, "").trim();
  const unitRegex = "(?:g|gr|grammes?|kg|ml|cl|l)";

  const matchFull = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i"));
  if (matchFull) return { qty: parseFloat(matchFull[1].replace(",", ".")), count: parseFloat(matchFull[2].replace(",", ".")), name: normalizeForMatch(matchFull[3]), optional };

  const matchUnit = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(.+)$`, "i"));
  if (matchUnit) return { qty: parseFloat(matchUnit[1].replace(",", ".")), count: 0, name: normalizeForMatch(matchUnit[2]), optional };

  const matchNum = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (matchNum) return { qty: 0, count: parseFloat(matchNum[1].replace(",", ".")), name: normalizeForMatch(matchNum[2]), optional };

  return { qty: 0, count: 0, name: normalizeForMatch(trimmed), optional };
}

/** Same as parseIngredientLine but preserves original name casing in rawName */
export function parseIngredientLineRaw(ing: string): ParsedIngredientRaw {
  let trimmed = ing.trim().replace(/\s+/g, " ");
  const optional = trimmed.startsWith("?");
  if (optional) trimmed = trimmed.slice(1).trim();
  // Strip {cal} suffix
  trimmed = trimmed.replace(/\{\d+(?:[.,]\d+)?\}\s*$/, "").trim();
  const unitRegex = "(?:g|gr|grammes?|kg|ml|cl|l)";

  const matchFull = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i"));
  if (matchFull) return { qty: parseFloat(matchFull[1].replace(",", ".")), count: parseFloat(matchFull[2].replace(",", ".")), name: normalizeForMatch(matchFull[3]), rawName: matchFull[3].trim(), optional };

  const matchUnit = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(.+)$`, "i"));
  if (matchUnit) return { qty: parseFloat(matchUnit[1].replace(",", ".")), count: 0, name: normalizeForMatch(matchUnit[2]), rawName: matchUnit[2].trim(), optional };

  const matchNum = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (matchNum) return { qty: 0, count: parseFloat(matchNum[1].replace(",", ".")), name: normalizeForMatch(matchNum[2]), rawName: matchNum[2].trim(), optional };

  return { qty: 0, count: 0, name: normalizeForMatch(trimmed), rawName: trimmed, optional };
}

/**
 * Parse ingredient string into OR groups.
 * "100g poulet | 80g dinde, 50g salade" → [[{poulet}, {dinde}], [{salade}]]
 * Optional ingredients are prefixed with "?" e.g. "?50g parmesan"
 */
export function parseIngredientGroups(raw: string): ParsedIngredient[][] {
  if (!raw?.trim()) return [];
  return raw.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean)
    .map(group => group.split(/\|/).map(s => s.trim()).filter(Boolean).map(parseIngredientLine));
}

// ─── Ingredient Editing (String-based — for UI) ─────────────────────────────

export interface IngLine { qty: string; count: string; name: string; cal: string; isOr: boolean; isOptional: boolean; }

/** Extract {cal} suffix from a raw ingredient token */
function extractCal(raw: string): { text: string; cal: string } {
  const m = raw.match(/\{(\d+(?:[.,]\d+)?)\}\s*$/);
  if (m) return { text: raw.slice(0, m.index!).trim(), cal: m[1].replace(",", ".") };
  return { text: raw, cal: "" };
}

export function parseIngredientLineDisplay(raw: string): IngLine {
  let trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return { qty: "", count: "", name: "", cal: "", isOr: false, isOptional: false };
  const isOptional = trimmed.startsWith("?");
  if (isOptional) trimmed = trimmed.slice(1).trim();
  const { text: withoutCal, cal } = extractCal(trimmed);
  trimmed = withoutCal;
  const unitRegex = "(?:g|gr|gramme?s?|kg|ml|cl|l)";

  const matchFull = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i"));
  if (matchFull) return { qty: matchFull[1], count: matchFull[2], name: matchFull[3].trim(), cal, isOr: false, isOptional };

  const matchUnit = trimmed.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${unitRegex}\\s+(.+)$`, "i"));
  if (matchUnit) return { qty: matchUnit[1], count: "", name: matchUnit[2].trim(), cal, isOr: false, isOptional };

  const matchNum = trimmed.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (matchNum) return { qty: "", count: matchNum[1], name: matchNum[2].trim(), cal, isOr: false, isOptional };

  return { qty: "", count: "", name: trimmed, cal, isOr: false, isOptional };
}

export function formatQtyDisplay(qty: string): string {
  const trimmed = qty.trim();
  if (!trimmed) return "";
  if (/^\d+([.,]\d+)?$/.test(trimmed)) return trimmed + "g";
  return trimmed;
}

export function parseIngredientsToLines(raw: string | null): IngLine[] {
  if (!raw) return [{ qty: "", count: "", name: "", cal: "", isOr: false, isOptional: false }];
  const groups = raw.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
  const lines: IngLine[] = [];
  for (const group of groups) {
    const alts = group.split(/\|/).map(s => s.trim()).filter(Boolean);
    alts.forEach((alt, i) => {
      const parsed = parseIngredientLineDisplay(alt);
      parsed.isOr = i > 0;
      lines.push(parsed);
    });
  }
  if (lines.length < 2) lines.push({ qty: "", count: "", name: "", cal: "", isOr: false, isOptional: false });
  return lines;
}

export function serializeIngredients(lines: IngLine[]): string | null {
  const result: string[] = [];
  let currentGroup: string[] = [];
  const flushGroup = () => { if (currentGroup.length > 0) { result.push(currentGroup.join(" | ")); currentGroup = []; } };
  for (const l of lines) {
    const qtyStr = formatQtyDisplay(l.qty);
    const countStr = l.count.trim();
    const nameStr = l.name.trim();
    if (!qtyStr && !countStr && !nameStr) continue;
    let token = [qtyStr, countStr, nameStr].filter(Boolean).join(" ");
    if (l.cal.trim()) token += `{${l.cal.trim()}}`;
    const finalToken = l.isOptional ? `?${token}` : token;
    if (l.isOr) { currentGroup.push(finalToken); } else { flushGroup(); currentGroup.push(finalToken); }
  }
  flushGroup();
  return result.length ? result.join(", ") : null;
}

/**
 * Compute total calories from ingredient string.
 * For each ingredient with {cal}: if qty (grams) present → cal * qty / 100. If count present → cal * count.
 * Returns null if no ingredient has cal data.
 */
export function computeIngredientCalories(ingredientStr: string | null): number | null {
  if (!ingredientStr?.trim()) return null;
  const lines = parseIngredientsToLines(ingredientStr);
  let total = 0;
  let hasCal = false;
  for (const line of lines) {
    const calVal = parseFloat(line.cal.replace(",", "."));
    if (!calVal || isNaN(calVal)) continue;
    hasCal = true;
    const qty = parseFloat(line.qty.replace(",", "."));
    const count = parseFloat(line.count.replace(",", "."));
    if (qty > 0) {
      // cal is per 100g, qty is grams
      total += calVal * qty / 100;
    } else if (count > 0) {
      // cal is per 1 unit
      total += calVal * count;
    } else {
      // Just the cal value itself (1 unit assumed)
      total += calVal;
    }
  }
  return hasCal ? Math.round(total) : null;
}
