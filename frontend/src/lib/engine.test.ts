/**
 * Golden cases from fixtures/golden_engine.json (synthetic, hand-checkable).
 *
 * The fixture is read through the read-only copy made by scripts/sync-fixtures.mjs,
 * so these tests never touch fixtures/ itself. Case counts are asserted first so a
 * shrunken fixture cannot make the suite pass vacuously.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  daysSinceLastNote,
  daysSincePlanting,
  openIssues,
  summarizeWindow,
  weekOf,
} from "@/lib/engine";
import type { StoredEntry } from "@/lib/types";

interface GoldenEntry {
  id: string;
  plot: string;
  kind: StoredEntry["kind"];
  date: string;
}

interface Golden {
  synthetic: boolean;
  days_since_cases: { planting: string; on: string; expected: number }[];
  entries: GoldenEntry[];
  last_note_cases: { plot: string; as_of: string; expected: number | null }[];
  open_issue_cases: { plot: string; expected: string[] }[];
  weekly_cases: {
    week_start: string;
    week_end: string;
    expected_counts: Partial<Record<StoredEntry["kind"], number>>;
  }[];
}

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../mock/from-fixtures/golden_engine.json", import.meta.url)), "utf8"),
) as Golden;

/** The fixture only carries what the engine needs; fill in the rest. */
function asStored(entry: GoldenEntry): StoredEntry {
  return {
    id: entry.id,
    plot: entry.plot,
    crop: null,
    kind: entry.kind,
    text: `${entry.id} text`,
    date: entry.date,
    date_expr: null,
    planting_date: null,
    planting_date_expr: null,
    quantity: null,
    grounded: {
      plot: true,
      crop: true,
      kind: true,
      text: true,
      quantity: true,
      date: true,
      planting_date: true,
    },
    source_span: null,
    confirmed: true,
    synthetic: true,
    created_at: `${entry.date}T07:00:00Z`,
  };
}

const stored = golden.entries.map(asStored);

describe("golden_engine.json", () => {
  it("carries the expected number of hand-checkable cases", () => {
    expect(golden.synthetic).toBe(true);
    expect(golden.days_since_cases).toHaveLength(5);
    expect(golden.last_note_cases).toHaveLength(3);
    expect(golden.open_issue_cases).toHaveLength(2);
    expect(golden.weekly_cases).toHaveLength(1);
    expect(golden.entries).toHaveLength(5);
    expect(stored).toHaveLength(5);
  });

  it("computes days since planting for every case", () => {
    expect(golden.days_since_cases.length).toBeGreaterThan(0);
    for (const testCase of golden.days_since_cases) {
      expect(
        daysSincePlanting(testCase.planting, testCase.on),
        `${testCase.planting} -> ${testCase.on}`,
      ).toBe(testCase.expected);
    }
  });

  it("computes days since the last note for every case", () => {
    expect(golden.last_note_cases.length).toBeGreaterThan(0);
    for (const testCase of golden.last_note_cases) {
      expect(
        daysSinceLastNote(stored, testCase.plot, testCase.as_of),
        `${testCase.plot} as of ${testCase.as_of}`,
      ).toBe(testCase.expected);
    }
  });

  it("finds open issues (issue entries with no later action on the plot)", () => {
    expect(golden.open_issue_cases.length).toBeGreaterThan(0);
    for (const testCase of golden.open_issue_cases) {
      expect(
        openIssues(stored, testCase.plot).map((entry) => entry.id),
        testCase.plot,
      ).toEqual(testCase.expected);
    }
  });

  it("computes the week the fixture names, derived by hand from the fixture entries", () => {
    // 2026-09-28 is a Monday and 2026-10-04 is a Sunday.
    // Entries inside that week, read off fixtures/golden_engine.json:
    //   e1 09-28 observation, e2 09-30 issue, e4 10-01 issue, e3 10-02 action,
    //   e5 10-03 observation.
    // Hand-derived counts: observation 2, issue 2, action 1, plan 0, measurement 0.
    const week = weekOf("2026-10-01");
    expect(week).toEqual({
      week_start: "2026-09-28",
      week_end: "2026-10-04",
      week_end_exclusive: "2026-10-05",
    });

    const summary = summarizeWindow(stored, week.week_start, week.week_end_exclusive, "2026-10-05");
    expect(summary.counts_by_kind).toEqual({
      observation: 2,
      issue: 2,
      action: 1,
      plan: 0,
      measurement: 0,
    });
    expect(summary.total_entries).toBe(5);
    expect(summary.plots_touched.map((touch) => touch.plot)).toEqual(["plot 1", "plot 2"]);
    expect(summary.issues_closed.map((issue) => issue.id)).toEqual(["e2"]);
    expect(summary.open_issues.map((issue) => issue.id)).toEqual(["e4"]);
  });

  it("records that fixtures/golden_engine.json weekly_cases disagrees with its own entries", () => {
    // NOT fixed here: fixtures/ is owned by the backend agent (AGENTS.md section 6).
    // Fixture expectation: {observation 1, issue 2, action 1} (total 4).
    // Hand-derived from the fixture's own entries: {observation 2, issue 2, action 1}
    // (total 5) - e5, an observation dated Saturday 2026-10-03, sits inside the week
    // the fixture names (Mon 09-28 .. Sun 10-04) and is missing from its counts.
    // No interval convention explains the fixture: it includes e3 on 10-02 and drops
    // e5 on 10-03, which are both inside 09-28..10-04.
    const testCase = golden.weekly_cases[0];
    expect(testCase.expected_counts).toEqual({ observation: 1, issue: 2, action: 1 });

    const summary = summarizeWindow(stored, testCase.week_start, "2026-10-05", "2026-10-05");
    expect(summary.counts_by_kind.observation).toBe(2);
    expect(summary.total_entries).toBe(5);

    // Both numbers are reported side by side so the difference cannot go unnoticed.
    expect({
      fixture_observation: testCase.expected_counts.observation,
      derived_observation: summary.counts_by_kind.observation,
    }).toEqual({ fixture_observation: 1, derived_observation: 2 });
  });
});
