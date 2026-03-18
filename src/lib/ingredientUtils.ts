/**
 * Shared ingredient parsing utilities.
 * Used by MealCard, PossibleMealCard, MealPlanGenerator, Index, and stockUtils.
 */

import type { FoodItem } from "@/components/FoodItems";

// ─── Text Normalization (with LRU cache) ────────────────────────────────────

const _normCache = new Map<string, string>();
const _keyCache = new Map<string, string>();
const _lightCache = new Map<string, string>();
const NORM_CACHE_MAX = 600;

export function normalizeForMatch(text: string): string {
  const cached = _normCache.get(text);
  if (cached !== undefined) return cached;
  const result = text.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "").trim();
  if (_normCache.size > NORM_CACHE_MAX) _normCache.clear();
  _normCache.set(text, result);
  return result;
}

/** Lowercase but preserve accents — used to detect accent-different words (pâte vs pâté) */
export function lightNormalize(text: string): string {
  const cached = _lightCache.get(text);
  if (cached !== undefined) return cached;
  const result = text.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[^a-zà-ÿ0-9\s]/g, "").replace(/\s+/g, " ").trim();
  if (_lightCache.size > NORM_CACHE_MAX) _lightCache.clear();
  _lightCache.set(text, result);
  return result;
}

/** Normalize + strip trailing 's' for ingredient key matching */
export function normalizeKey(name: string): string {
  const cached = _keyCache.get(name);
  if (cached !== undefined) return cached;
  const result = normalizeForMatch(name).replace(/s$/, "");
  if (_keyCache.size > NORM_CACHE_MAX) _keyCache.clear();
  _keyCache.set(name, result);
  return result;
}

/**
 * Accent-safe key comparison: normalizeKey equality + verify accented forms don't conflict.
 * Prevents "épicé" matching "épice" while still allowing "epice" == "épice" (case/accent normalization).
 */
export function accentSafeKeyMatch(a: string, b: string): boolean {
  if (normalizeKey(a) !== normalizeKey(b)) return false;
  // Check that light-normalized forms (preserving accents) agree
  const la = lightNormalize(a).replace(/s$/, "");
  const lb = lightNormalize(b).replace(/s$/, "");
  if (la === lb) return true;
  // If lengths differ by >1 → different words
  if (Math.abs(la.length - lb.length) > 1) return false;
  // Allow trailing 'e' tolerance (haché/hachée) but reject accent-different endings (épicé/épice)
  const shorter = la.length <= lb.length ? la : lb;
  const longer = la.length <= lb.length ? lb : la;
  // If one is prefix of the other + trailing 'e'/'s' → OK
  if (longer.startsWith(shorter)) return true;
  if (shorter.length === longer.length) {
    // Same length: check char-by-char for accent conflicts
    let diffs = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (shorter[i] !== longer[i]) diffs++;
    }
    return diffs === 0;
  }
  return false;
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
  const [shorter, longer, shorterIsA] = wordsA.length <= wordsB.length
    ? [wordsA, wordsB, true] : [wordsB, wordsA, false];

  // All words of shorter must appear in longer (with fuzzy e-tolerance)
  const matchedPairs: [number, number][] = []; // [shorterIdx, longerIdx]
  const matchedIndices = new Set<number>();
  for (let si = 0; si < shorter.length; si++) {
    const sw = shorter[si];
    let found = false;
    for (let i = 0; i < longer.length; i++) {
      if (matchedIndices.has(i)) continue;
      if (longer[i] === sw || fuzzyWord(longer[i]) === fuzzyWord(sw)) {
        matchedIndices.add(i);
        matchedPairs.push([si, i]);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  // Accent-level check on matched word pairs (prevents "épicée" matching "épice/épices")
  const aLight = lightNormalize(a).split(/\s+/);
  const bLight = lightNormalize(b).split(/\s+/);
  const shorterLight = shorterIsA ? aLight : bLight;
  const longerLight = shorterIsA ? bLight : aLight;
  const singularize = (s: string) => s.replace(/s$/, '');
  for (const [si, li] of matchedPairs) {
    const sWord = shorterLight[si];
    const lWord = longerLight[li];
    if (!sWord || !lWord) continue;
    // Skip accent check if either word is already fully accent-stripped (pre-normalized input)
    if (sWord === normalizeForMatch(sWord) || lWord === normalizeForMatch(lWord)) continue;
    // Both have accent info — compare singularized forms (less aggressive than fuzzyWord)
    // "épice" vs "épicée" → different, "épices" vs "épice" → same after singularize
    const sSing = singularize(sWord);
    const lSing = singularize(lWord);
    if (sSing !== lSing) {
      // Allow trailing 'e' tolerance: "haché" vs "hachée" → same after removing single trailing 'e'
      // But "épice" vs "épicée" → "épic" vs "épicé" → different → reject
      const sBase = sSing.replace(/e$/, '');
      const lBase = lSing.replace(/e$/, '');
      if (sBase !== lBase) return false;
    }
  }

  if (shorter.length === longer.length) {
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
  // Short words (≤3 chars) require exact match to avoid false positives (riz/ris, sel/sol)
  if (na.length <= 3 || nb.length <= 3) return false;
  // Reject if word counts differ (e.g. "speculoos" vs "pate speculoos")
  const wordsA = na.split(/\s+/);
  const wordsB = nb.split(/\s+/);
  if (wordsA.length !== wordsB.length) return false;
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

// Precompiled regex patterns (avoid recompilation per call)
const _RE_METRIC_STRIP = /(?:\{\d+(?:[.,]\d+)?\})?(?:\s*\[\d+(?:[.,]\d+)?\])?\s*$/;
const _UNIT = "(?:g|gr|grammes?|kg|ml|cl|l)";
const _RE_FULL = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${_UNIT}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i");
const _RE_UNIT = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${_UNIT}\\s+(.+)$`, "i");
const _RE_NUM = /^(\d+(?:[.,]\d+)?)\s+(.+)$/;

export function parseIngredientLine(ing: string): ParsedIngredient {
  let trimmed = ing.trim().replace(/\s+/g, " ");
  const optional = trimmed.startsWith("?");
  if (optional) trimmed = trimmed.slice(1).trim();
  trimmed = trimmed.replace(_RE_METRIC_STRIP, "").trim();

  const matchFull = trimmed.match(_RE_FULL);
  if (matchFull) return { qty: parseFloat(matchFull[1].replace(",", ".")), count: parseFloat(matchFull[2].replace(",", ".")), name: normalizeForMatch(matchFull[3]), optional };

  const matchUnit = trimmed.match(_RE_UNIT);
  if (matchUnit) return { qty: parseFloat(matchUnit[1].replace(",", ".")), count: 0, name: normalizeForMatch(matchUnit[2]), optional };

  const matchNum = trimmed.match(_RE_NUM);
  if (matchNum) return { qty: 0, count: parseFloat(matchNum[1].replace(",", ".")), name: normalizeForMatch(matchNum[2]), optional };

  return { qty: 0, count: 0, name: normalizeForMatch(trimmed), optional };
}

/** Same as parseIngredientLine but preserves original name casing in rawName */
export function parseIngredientLineRaw(ing: string): ParsedIngredientRaw {
  let trimmed = ing.trim().replace(/\s+/g, " ");
  const optional = trimmed.startsWith("?");
  if (optional) trimmed = trimmed.slice(1).trim();
  trimmed = trimmed.replace(_RE_METRIC_STRIP, "").trim();

  const matchFull = trimmed.match(_RE_FULL);
  if (matchFull) return { qty: parseFloat(matchFull[1].replace(",", ".")), count: parseFloat(matchFull[2].replace(",", ".")), name: normalizeForMatch(matchFull[3]), rawName: matchFull[3].trim(), optional };

  const matchUnit = trimmed.match(_RE_UNIT);
  if (matchUnit) return { qty: parseFloat(matchUnit[1].replace(",", ".")), count: 0, name: normalizeForMatch(matchUnit[2]), rawName: matchUnit[2].trim(), optional };

  const matchNum = trimmed.match(_RE_NUM);
  if (matchNum) return { qty: 0, count: parseFloat(matchNum[1].replace(",", ".")), name: normalizeForMatch(matchNum[2]), rawName: matchNum[2].trim(), optional };

  return { qty: 0, count: 0, name: normalizeForMatch(trimmed), rawName: trimmed, optional };
}

/**
 * Parse ingredient string into OR groups.
 * "100g poulet | 80g dinde, 50g salade" → [[{poulet}, {dinde}], [{salade}]]
 * Optional ingredients are prefixed with "?" e.g. "?50g parmesan"
 */
const _groupsCache = new Map<string, ParsedIngredient[][]>();
const GROUPS_CACHE_MAX = 300;

export function parseIngredientGroups(raw: string): ParsedIngredient[][] {
  if (!raw?.trim()) return [];
  const cached = _groupsCache.get(raw);
  if (cached) return cached;
  const result = raw.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean)
    .map(group => group.split(/\|/).map(s => s.trim()).filter(Boolean).map(parseIngredientLine));
  if (_groupsCache.size > GROUPS_CACHE_MAX) _groupsCache.clear();
  _groupsCache.set(raw, result);
  return result;
}

// ─── Ingredient Editing (String-based — for UI) ─────────────────────────────

export interface IngLine { qty: string; count: string; name: string; cal: string; pro: string; isOr: boolean; isOptional: boolean; }

/** Extract {cal} and [pro] suffixes from a raw ingredient token */
export function extractMetrics(raw: string): { text: string; cal: string; pro: string } {
  const match = raw.match(/(.*?)(?:\{(\d+(?:[.,]\d+)?)\})?(?:\s*\[(\d+(?:[.,]\d+)?)\])?\s*$/);
  if (match) {
    return {
      text: match[1].trim(),
      cal: match[2] ? match[2].replace(",", ".") : "",
      pro: match[3] ? match[3].replace(",", ".") : ""
    };
  }
  return { text: raw, cal: "", pro: "" };
}

/** Removes {cal} and [pro] strings globally for clean UI display */
export function cleanIngredientText(text: string | null | undefined): string {
  if (!text) return "";
  // Strip {number} cal markers and [number] protein markers — use * to also catch empty {}
  return text.replace(/\{[^}]*\}/g, "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

// Pre-compiled regex for parseIngredientLineDisplay (avoid recompilation per call)
const _DISP_UNIT = "(?:g|gr|gramme?s?|kg|ml|cl|l)";
const _RE_DISP_FULL = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${_DISP_UNIT}\\s+(\\d+(?:[.,]\\d+)?)\\s+(.+)$`, "i");
const _RE_DISP_UNIT = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${_DISP_UNIT}\\s+(.+)$`, "i");
const _RE_DISP_NUM = /^(\d+(?:[.,]\d+)?)\s+(.+)$/;

export function parseIngredientLineDisplay(raw: string): IngLine {
  let trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return { qty: "", count: "", name: "", cal: "", pro: "", isOr: false, isOptional: false };
  const isOptional = trimmed.startsWith("?");
  if (isOptional) trimmed = trimmed.slice(1).trim();
  const { text: withoutMetrics, cal, pro } = extractMetrics(trimmed);
  trimmed = withoutMetrics;

  const matchFull = trimmed.match(_RE_DISP_FULL);
  if (matchFull) return { qty: matchFull[1], count: matchFull[2], name: matchFull[3].trim(), cal, pro, isOr: false, isOptional };

  const matchUnit = trimmed.match(_RE_DISP_UNIT);
  if (matchUnit) return { qty: matchUnit[1], count: "", name: matchUnit[2].trim(), cal, pro, isOr: false, isOptional };

  const matchNum = trimmed.match(_RE_DISP_NUM);
  if (matchNum) return { qty: "", count: matchNum[1], name: matchNum[2].trim(), cal, pro, isOr: false, isOptional };

  return { qty: "", count: "", name: trimmed, cal, pro, isOr: false, isOptional };
}

export function formatQtyDisplay(qty: string): string {
  const trimmed = qty.trim();
  if (!trimmed) return "";
  if (/^\d+([.,]\d+)?$/.test(trimmed)) return trimmed + "g";
  return trimmed;
}

export function parseIngredientsToLines(raw: string | null): IngLine[] {
  if (!raw) return [{ qty: "", count: "", name: "", cal: "", pro: "", isOr: false, isOptional: false }];
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
  if (lines.length < 2) lines.push({ qty: "", count: "", name: "", cal: "", pro: "", isOr: false, isOptional: false });
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
    if (l.cal?.trim()) token += `{${l.cal.trim()}}`;
    if (l.pro?.trim()) token += ` [${l.pro.trim()}]`;
    const finalToken = l.isOptional ? `?${token}` : token;
    if (l.isOr) { currentGroup.push(finalToken); } else { flushGroup(); currentGroup.push(finalToken); }
  }
  flushGroup();
  return result.length ? result.join(", ") : null;
}

/**
 * Shared macro computation — eliminates 90% code duplication between calories and protein.
 * Before: two 55-line functions with identical structure. After: one 30-line core + two 1-line wrappers.
 */
const _calCache = new Map<string, number | null>();
const _proCache = new Map<string, number | null>();
const MACRO_CACHE_MAX = 500;

function _computeMacro(
  ingredientStr: string | null,
  field: 'cal' | 'pro',
  cache: Map<string, number | null>,
  isAvailable?: (name: string) => boolean
): number | null {
  if (!ingredientStr?.trim()) return null;
  if (!isAvailable) {
    const cached = cache.get(ingredientStr);
    if (cached !== undefined) return cached;
  }
  const lines = parseIngredientsToLines(ingredientStr);
  let total = 0;
  let hasValue = false;

  const groups: IngLine[][] = [];
  let currentGroup: IngLine[] = [];
  for (const line of lines) {
    if (line.isOptional) continue;
    if (!line.isOr && currentGroup.length > 0) { groups.push(currentGroup); currentGroup = []; }
    currentGroup.push(line);
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  for (const group of groups) {
    let chosenLine = group[0];
    if (isAvailable) {
      for (const alt of group) {
        if (isAvailable(alt.name)) { chosenLine = alt; break; }
      }
    }
    const rawVal = field === 'cal' ? chosenLine.cal : chosenLine.pro;
    const val = parseFloat(rawVal.replace(",", "."));
    if (!val || isNaN(val)) continue;
    hasValue = true;
    const qty = parseFloat(chosenLine.qty.replace(",", "."));
    const count = parseFloat(chosenLine.count.replace(",", "."));
    if (qty > 0) total += val * qty / 100;
    else if (count > 0) total += val * count;
    else total += val;
  }
  const result = hasValue ? Math.round(total) : null;
  if (!isAvailable) {
    if (cache.size > MACRO_CACHE_MAX) cache.clear();
    cache.set(ingredientStr!, result);
  }
  return result;
}

export function computeIngredientCalories(ingredientStr: string | null, isAvailable?: (name: string) => boolean): number | null {
  return _computeMacro(ingredientStr, 'cal', _calCache, isAvailable);
}

export function computeIngredientProtein(ingredientStr: string | null, isAvailable?: (name: string) => boolean): number | null {
  return _computeMacro(ingredientStr, 'pro', _proCache, isAvailable);
}



/**
 * Extract a map of ingredient name → { cal, pro } from an ingredient string.
 * Only includes ingredients that have at least one of cal or pro set.
 */
export function extractIngredientMacros(ingredientStr: string | null): Map<string, { cal: string; pro: string }> {
  const map = new Map<string, { cal: string; pro: string }>();
  if (!ingredientStr?.trim()) return map;
  const lines = parseIngredientsToLines(ingredientStr);
  for (const line of lines) {
    if (!line.name.trim()) continue;
    const cal = line.cal?.trim() || "";
    const pro = line.pro?.trim() || "";
    if (cal || pro) {
      map.set(normalizeKey(line.name), { cal, pro });
    }
  }
  return map;
}

/**
 * Apply macros from a source map to an ingredient string.
 * For each ingredient with a matching name in the map, overwrite cal/pro.
 * Returns the updated ingredient string, or null if nothing changed.
 */
export function applyIngredientMacros(ingredientStr: string | null, macros: Map<string, { cal: string; pro: string }>): string | null {
  if (!ingredientStr?.trim() || macros.size === 0) return null;
  const lines = parseIngredientsToLines(ingredientStr);
  let changed = false;
  for (const line of lines) {
    if (!line.name.trim()) continue;
    const key = normalizeKey(line.name);
    const macro = macros.get(key);
    if (macro) {
      if (macro.cal && line.cal !== macro.cal) { line.cal = macro.cal; changed = true; }
      if (macro.pro && line.pro !== macro.pro) { line.pro = macro.pro; changed = true; }
    }
  }
  return changed ? serializeIngredients(lines) : null;
}
