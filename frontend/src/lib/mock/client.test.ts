/**
 * The mock client is both the demo backend and the manual-path harness: with the model
 * off, extraction must fail loudly while add/edit/confirm/delete keep working.
 */

import { describe, expect, it } from "vitest";

import { ModelUnavailableError } from "@/lib/errors";
import { MockFieldTalkClient } from "@/lib/mock/client";
import { SEED_ENTRIES } from "@/lib/mock/seedEntries";

const TODAY = "2026-10-07";

function newClient(modelOffline = false) {
  return new MockFieldTalkClient({ today: TODAY, modelOffline });
}

describe("MockFieldTalkClient", () => {
  it("reports its own status and keeps the seed store", async () => {
    const client = newClient();
    const health = await client.health();
    expect(health.model).toBe("ok");
    expect(health.stt).toBe("ok");
    expect(await client.listEntries()).toHaveLength(SEED_ENTRIES.length);
  });

  it("returns a synthetic transcript and reports no real-time factor", async () => {
    const client = newClient();
    const result = await client.transcribe({
      file: new Blob(["not really audio"]),
      name: "T03.wav",
      audioSeconds: 42.5,
    });
    expect(result.synthetic).toBe(true);
    expect(result.rtf).toBeNull();
    expect(result.audio_seconds).toBe(42.5);
    expect(result.transcript).toContain("Plot one, cowpea");
  });

  it("maps the bundled synthetic transcripts to their gold extractions", async () => {
    const client = newClient();
    const result = await client.extract({
      transcript: "Plot one, cowpea. I weeded this morning and used two hours.",
      recorded_at: TODAY,
      source: "upload",
    });
    expect(result.action).toBe("run");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].plot).toBe("plot one");
    expect(result.entries[0].quantity).toEqual({ value: 2, unit: "hours" });
  });

  it("refuses an advice transcript without extracting anything", async () => {
    const client = newClient();
    const result = await client.extract({
      transcript: "What fertilizer should I put on the maize and how much?",
      recorded_at: TODAY,
      source: "typed",
    });
    expect(result.action).toBe("refuse");
    expect(result.entries).toEqual([]);
  });

  it("resolves date expressions in code when an entry is added", async () => {
    const client = newClient();
    const entry = await client.addEntry({
      plot: "plot 2",
      crop: "maize",
      kind: "observation",
      text: "Yellow leaves at the edge.",
      date: null,
      date_expr: { kind: "days_ago", n: 2 },
      planting_date: null,
      planting_date_expr: { kind: "month_day", month: 7, day: 10 },
      quantity: null,
      recorded_at: TODAY,
      grounded: {
        plot: true,
        crop: true,
        kind: true,
        text: true,
        quantity: true,
        date: true,
        planting_date: true,
      },
      source_span: "Yellow leaves at the edge.",
    });
    // 2026-10-07 minus 2 days, and 10 July 2026 for the planting.
    expect(entry.date).toBe("2026-10-05");
    expect(entry.planting_date).toBe("2026-07-10");
    expect(entry.confirmed).toBe(false);
    expect(entry.synthetic).toBe(true);
  });

  it("edits, confirms and deletes entries with no model involved", async () => {
    const client = newClient(true);
    const listed = await client.listEntries();
    const target = listed.find((entry) => entry.id === "e-1012");
    expect(target?.grounded.plot).toBe(false);

    const edited = await client.updateEntry("e-1012", { text: "Yellow leaves, plot 2 side." });
    expect(edited.text).toBe("Yellow leaves, plot 2 side.");
    // Editing alone does not clear a V1 highlight; confirming (a human review) does.
    expect(edited.grounded.plot).toBe(false);

    const confirmed = await client.confirmEntry("e-1012");
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.grounded.plot).toBe(true);

    await client.deleteEntry("e-1012");
    expect(await client.listEntries()).toHaveLength(SEED_ENTRIES.length - 1);
  });

  it("keeps the manual path open when the model is unavailable", async () => {
    const client = newClient(true);
    const health = await client.health();
    expect(health.model).toBe("unavailable");
    expect(health.stt).toBe("ok");

    await expect(
      client.extract({ transcript: "Plot two. Leaves look the same.", recorded_at: TODAY, source: "typed" }),
    ).rejects.toBeInstanceOf(ModelUnavailableError);

    const added = await client.addEntry({
      plot: "plot 1",
      crop: null,
      kind: "observation",
      text: "Water at the gate.",
      date: TODAY,
      date_expr: null,
      planting_date: null,
      planting_date_expr: null,
      quantity: null,
      recorded_at: TODAY,
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
    });
    expect(added.confirmed).toBe(true);
  });

  it("computes the weekly report for a requested week", async () => {
    const client = newClient();
    const summary = await client.weeklyReport("2026-10-07");
    expect(summary.week_start).toBe("2026-10-05");
    expect(summary.week_end).toBe("2026-10-11");
    expect(summary.total_entries).toBe(7);
    expect(summary.generated_from).toBe("engine");
    expect(summary.synthetic).toBe(true);
    expect(summary.last_note_by_plot.find((row) => row.plot === "plot three")?.days_since).toBe(2);
  });
});
