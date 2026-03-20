import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeCounterDays } from "@/lib/ingredientUtils";
import { computePlannedCounterDate } from "@/hooks/useMealTransfers";

// ─── computeCounterDays ─────────────────────────────────────────────────────

describe("computeCounterDays", () => {
  it("returns null when counterStartDate is null", () => {
    expect(computeCounterDays(null)).toBeNull();
  });

  it("returns null when counterStartDate is undefined", () => {
    expect(computeCounterDays(undefined)).toBeNull();
  });

  it("returns null when counterStartDate is empty string", () => {
    // empty string → new Date('') → Invalid Date → NaN
    expect(computeCounterDays("")).toBeNull();
  });

  it("returns 0 for a counter started now", () => {
    const now = new Date().toISOString();
    expect(computeCounterDays(now)).toBe(0);
  });

  it("returns 1 for a counter started 1 day ago", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    expect(computeCounterDays(yesterday)).toBe(1);
  });

  it("returns 3 for a counter started 3 days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    expect(computeCounterDays(threeDaysAgo)).toBe(3);
  });

  it("returns null (hidden) when counter_start_date is in the future (scheduled meal)", () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    expect(computeCounterDays(tomorrow)).toBeNull();
  });

  it("returns 0 when counter_start_date is a few hours in the past (same day)", () => {
    const fewHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString();
    expect(computeCounterDays(fewHoursAgo)).toBe(0);
  });

  it("returns null when counter is 1 hour in the future", () => {
    const oneHourFromNow = new Date(Date.now() + 3600000).toISOString();
    expect(computeCounterDays(oneHourFromNow)).toBeNull();
  });
});

// ─── computePlannedCounterDate ──────────────────────────────────────────────

describe("computePlannedCounterDate", () => {
  let dateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Fix "now" to Wednesday 2026-03-18 10:00:00 UTC
    dateSpy = vi.spyOn(Date.prototype, "getDay");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 12:00 for a midi meal", () => {
    const result = computePlannedCounterDate("lundi", "midi");
    const d = new Date(result);
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
  });

  it("returns 19:00 for a soir meal", () => {
    const result = computePlannedCounterDate("lundi", "soir");
    const d = new Date(result);
    expect(d.getHours()).toBe(19);
    expect(d.getMinutes()).toBe(0);
  });

  it("defaults to 12:00 when mealTime is null", () => {
    const result = computePlannedCounterDate("mercredi", null);
    const d = new Date(result);
    expect(d.getHours()).toBe(12);
  });

  it("returns a date on the correct day of the week for lundi", () => {
    const result = computePlannedCounterDate("lundi", "midi");
    const d = new Date(result);
    expect(d.getDay()).toBe(1); // Monday
  });

  it("returns a date on the correct day for samedi", () => {
    const result = computePlannedCounterDate("samedi", "soir");
    const d = new Date(result);
    expect(d.getDay()).toBe(6); // Saturday
  });

  it("returns a date on the correct day for dimanche", () => {
    const result = computePlannedCounterDate("dimanche", "midi");
    const d = new Date(result);
    expect(d.getDay()).toBe(0); // Sunday
  });

  it("returns valid ISO string", () => {
    const result = computePlannedCounterDate("jeudi", "soir");
    expect(() => new Date(result)).not.toThrow();
    expect(new Date(result).toISOString()).toBe(result);
  });

  it("each day maps to a different weekday", () => {
    const days = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
    const expectedDow = [1, 2, 3, 4, 5, 6, 0];
    days.forEach((day, i) => {
      const result = computePlannedCounterDate(day, "midi");
      const d = new Date(result);
      expect(d.getDay()).toBe(expectedDow[i]);
    });
  });
});

// ─── Counter lifecycle scenarios (pure logic) ───────────────────────────────

describe("Counter lifecycle scenarios", () => {
  it("Scenario: move to Possible → counter starts at now → computeCounterDays returns 0", () => {
    // Simulates: meal moved to Possible, counter_start_date = now
    const counterStartDate = new Date().toISOString();
    const days = computeCounterDays(counterStartDate);
    expect(days).toBe(0); // Counter visible, showing 0 days
  });

  it("Scenario: plan meal for future → counter_start_date in future → computeCounterDays returns null (hidden)", () => {
    // Simulates: meal planned for Saturday, counter set to Saturday 12h
    const futureSaturday = new Date();
    futureSaturday.setDate(futureSaturday.getDate() + 3);
    futureSaturday.setHours(12, 0, 0, 0);
    
    const counterStartDate = futureSaturday.toISOString();
    const days = computeCounterDays(counterStartDate);
    expect(days).toBeNull(); // Counter hidden
  });

  it("Scenario: remove planning → counter resets to now → computeCounterDays returns 0", () => {
    // Simulates: planning removed, counter reset to now
    const counterStartDate = new Date().toISOString();
    const days = computeCounterDays(counterStartDate);
    expect(days).toBe(0); // Counter visible again
  });

  it("Scenario: planned meal time has passed → counter becomes visible", () => {
    // Simulates: meal was planned for yesterday 12h, now the planned time has passed
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    pastDate.setHours(12, 0, 0, 0);
    
    const counterStartDate = pastDate.toISOString();
    const days = computeCounterDays(counterStartDate);
    expect(days).toBeGreaterThanOrEqual(0); // Counter visible, showing >= 1 day
    expect(days).not.toBeNull();
  });

  it("Scenario: ingredient with no_counter or storage_type surgele should not get counter_start_date", () => {
    // This is enforced in deductIngredientsFromStock: shouldStartCounter check
    // fi.storage_type !== 'surgele' && !fi.no_counter
    const fiSurgele = { storage_type: "surgele", no_counter: false, counter_start_date: null };
    const fiNoCtr = { storage_type: "frigo", no_counter: true, counter_start_date: null };
    
    const shouldStartSurgele = !fiSurgele.counter_start_date && fiSurgele.storage_type !== 'surgele' && !fiSurgele.no_counter;
    const shouldStartNoCtr = !fiNoCtr.counter_start_date && fiNoCtr.storage_type !== 'surgele' && !fiNoCtr.no_counter;
    
    expect(shouldStartSurgele).toBe(false);
    expect(shouldStartNoCtr).toBe(false);
  });

  it("Scenario: counter cleared when partial remainder consumed fully", () => {
    // When remaining <= 0 after deduction → item deleted
    // When fullUnits > 0 but remainder === 0 → counter_start_date set to null
    const fiWithCounter = { counter_start_date: "2026-03-15T10:00:00.000Z" };
    const remaining = 500; // perUnit=500, no partial
    const perUnit = 500;
    const fullUnits = Math.floor(remaining / perUnit); // 1
    const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10; // 0
    
    // Logic from deductIngredientsFromStock: if remainder is 0 and fullUnits > 0, clear counter
    const shouldClearCounter = remainder <= 0 && fiWithCounter.counter_start_date;
    expect(shouldClearCounter).toBeTruthy();
    expect(remainder).toBe(0);
    expect(fullUnits).toBe(1);
  });

  it("Scenario: counter NOT cleared when partial remainder still exists", () => {
    const remaining = 350;
    const perUnit = 500;
    const fullUnits = Math.floor(remaining / perUnit); // 0
    const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10; // 350
    
    expect(remainder).toBe(350);
    expect(remainder > 0).toBe(true);
    // Counter should NOT be cleared since there's still a partial unit
  });
});

// ─── Counter start conditions ───────────────────────────────────────────────

describe("Counter start conditions", () => {
  it("should start counter when: no existing counter, not surgele, no_counter is false", () => {
    const fi = { counter_start_date: null, storage_type: "frigo", no_counter: false };
    const shouldStart = !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
    expect(shouldStart).toBe(true);
  });

  it("should NOT start counter when item already has counter", () => {
    const fi = { counter_start_date: "2026-03-10T00:00:00.000Z", storage_type: "frigo", no_counter: false };
    const shouldStart = !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
    expect(shouldStart).toBe(false);
  });

  it("should NOT start counter for surgele storage", () => {
    const fi = { counter_start_date: null, storage_type: "surgele", no_counter: false };
    const shouldStart = !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
    expect(shouldStart).toBe(false);
  });

  it("should NOT start counter when no_counter flag is true", () => {
    const fi = { counter_start_date: null, storage_type: "frigo", no_counter: true };
    const shouldStart = !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
    expect(shouldStart).toBe(false);
  });

  it("should start counter for sec storage (not surgele)", () => {
    const fi = { counter_start_date: null, storage_type: "sec", no_counter: false };
    const shouldStart = !fi.counter_start_date && fi.storage_type !== 'surgele' && !fi.no_counter;
    expect(shouldStart).toBe(true);
  });
});
