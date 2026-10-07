/**
 * The seed store is what every screen shows in mock mode, so it has to cover each
 * kind, each highlight state and each engine path. These assertions are counted, not
 * sampled: a shrunken seed array fails here instead of quietly weakening the demo.
 */

import { describe, expect, it } from "vitest";

import { daysSinceLastNote, isISODate, openIssues, plantingsByPlot } from "@/lib/engine";
import { SEED_ENTRIES } from "@/lib/mock/seedEntries";
import { ENTRY_KINDS } from "@/lib/types";

describe("seed entries", () => {
  it("has the expected size and is entirely synthetic", () => {
    expect(SEED_ENTRIES).toHaveLength(12);
    expect(SEED_ENTRIES.every((entry) => entry.synthetic)).toBe(true);
  });

  it("covers every kind so the badges can all be seen", () => {
    const kinds = new Set(SEED_ENTRIES.map((entry) => entry.kind));
    expect([...kinds].sort()).toEqual([...ENTRY_KINDS].sort());
  });

  it("stores a valid ISO date for every entry", () => {
    for (const entry of SEED_ENTRIES) {
      expect(isISODate(entry.date), `${entry.id} date`).toBe(true);
      if (entry.planting_date !== null) {
        expect(isISODate(entry.planting_date), `${entry.id} planting date`).toBe(true);
      }
    }
  });

  it("includes ungrounded fields and entries that still need review", () => {
    const ungrounded = SEED_ENTRIES.filter((entry) =>
      Object.values(entry.grounded).some((ok) => !ok),
    );
    // e-1004 (crop), e-1008 (quantity, invented number) and e-1012 (plot guessed).
    expect(ungrounded).toHaveLength(3);
    expect(ungrounded.map((entry) => entry.id).sort()).toEqual(["e-1004", "e-1008", "e-1012"]);
    // e-1007, e-1008, e-1011 and e-1012 are stored as "needs review".
    expect(SEED_ENTRIES.filter((entry) => !entry.confirmed)).toHaveLength(4);
  });

  it("has open issues on two plots and closed ones on another", () => {
    // Open: e-1004 (plot 1, never followed by an action) and e-1007 (beans plot).
    // Closed: e-1002, because e-1003 is a later action on plot 2.
    expect(openIssues(SEED_ENTRIES).map((entry) => entry.id)).toEqual(["e-1004", "e-1007"]);
  });

  it("carries planting dates for four plots", () => {
    const plantings = plantingsByPlot(SEED_ENTRIES, "2026-10-07");
    expect(plantings).toHaveLength(4);
    const byPlot = new Map(plantings.map((row) => [row.plot, row]));
    expect(byPlot.get("plot 2")).toEqual({
      plot: "plot 2",
      planting_date: "2026-07-10",
      // 2026-07-10 -> 2026-10-07.
      days_since_planting: 89,
    });
    expect(byPlot.get("rice plot")?.planting_date).toBe("2026-08-05");
  });

  it("gives the days-since-last-note figures the report shows", () => {
    // plot 2: newest entry e-1012 on 2026-10-07; plot three: e-1006 on 2026-10-05.
    expect(daysSinceLastNote(SEED_ENTRIES, "plot 2", "2026-10-07")).toBe(0);
    expect(daysSinceLastNote(SEED_ENTRIES, "plot three", "2026-10-07")).toBe(2);
    expect(daysSinceLastNote(SEED_ENTRIES, "plot one", "2026-10-07")).toBeNull();
  });
});
