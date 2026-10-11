/**
 * The workflow end to end against one client instance: transcribe → extract → store through
 * the entries API → the stored entry is listed, counted in the weekly report and reachable
 * from Ask. Uses the mock client, which implements the same contract as the HTTP client; the
 * real engine is exercised separately against the Python backend.
 */

import { describe, expect, it } from "vitest";

import { MockFieldTalkClient } from "@/lib/mock/client";

const TODAY = "2026-10-07";
const SPOKEN = "Plot one, cowpea. I weeded this morning and used two hours.";

describe("record → review → store → ask", () => {
  it("stores only the entries the review keeps and makes them queryable", async () => {
    const client = new MockFieldTalkClient({ today: TODAY });
    const before = (await client.listEntries()).length;

    const clip = new Blob(["recorded"], { type: "audio/webm" });
    const stt = await client.transcribe({ file: clip, name: "T03.webm", audioSeconds: 6 });
    expect(stt.transcript).toBe(SPOKEN);
    expect(stt.rtf).toBeNull(); // the mock decodes no audio, so it reports no factor

    const extraction = await client.extract({ transcript: stt.transcript, recorded_at: TODAY, source: "recording" });
    expect(extraction.action).toBe("run");
    expect(extraction.persisted_by_extraction).toBe(false); // the review stores it, not the backend

    for (const entry of extraction.entries) {
      const stored = await client.addEntry({
        plot: entry.plot,
        crop: entry.crop,
        kind: entry.kind,
        text: entry.text,
        date: null,
        date_expr: entry.date_expr,
        planting_date: null,
        planting_date_expr: entry.planting_date_expr,
        quantity: entry.quantity,
        recorded_at: TODAY,
        grounded: { plot: true, crop: true, kind: true, text: true, quantity: true, date: true, planting_date: true },
        source_span: stt.transcript,
        confirmed: false, // a transcript is not a confirmed entry
      });
      expect(stored.confirmed).toBe(false);
      expect(stored.synthetic).toBe(true);
    }

    const after = await client.listEntries();
    expect(after.length).toBe(before + 1);
    const stored = after[after.length - 1];
    expect(stored.plot).toBe("plot one");
    expect(stored.source_span).toBe(SPOKEN); // the transcript it was traced to (V1 evidence)
    expect(stored.date).toBe(TODAY);
    expect(stored.quantity).toEqual({ value: 2, unit: "hours" });

    // It is in the notebook now: the weekly report counts it and the timeline sees it.
    const summary = await client.weeklyReport(TODAY);
    expect(summary.total_entries).toBe(8);
    expect(summary.plots_touched.some((row) => row.plot === "plot one")).toBe(true);

    // And the tools can reach it.
    const stages = [];
    for await (const stage of client.askStream("What happened on plot one?")) stages.push(stage);
    expect(stages.map((stage) => stage.id)).toEqual(["interpret", "tool_call", "validate", "engine", "answer"]);
    const answer = stages.find((stage) => stage.id === "answer");
    expect(answer?.payload).toBeTruthy();
  });

  it("stores nothing when the extraction is a refusal or a clarification", async () => {
    const client = new MockFieldTalkClient({ today: TODAY });
    const before = (await client.listEntries()).length;

    const refusal = await client.extract({
      transcript: "What fertilizer should I put on the maize and how much?",
      recorded_at: TODAY,
      source: "recording",
    });
    const clarify = await client.extract({ transcript: "Something happened today.", recorded_at: TODAY, source: "typed" });

    expect(refusal.action).toBe("refuse");
    expect(clarify.action).toBe("clarify");
    expect(refusal.entries).toEqual([]);
    expect(clarify.entries).toEqual([]);
    expect((await client.listEntries()).length).toBe(before);
  });
});
