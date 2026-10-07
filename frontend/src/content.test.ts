/**
 * Content and privacy scan over the UI source (hard rules 3 and 5).
 *
 *  - no client-side note storage (no localStorage / sessionStorage / IndexedDB)
 *  - no analytics, telemetry or CDN references anywhere in the UI
 *  - no advice, diagnosis or dose text: FieldTalk records, it does not advise
 *
 * The scan asserts how many files it read, so an empty walk fails instead of passing.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL(".", import.meta.url));

function sources(): { file: string; text: string }[] {
  const files = readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.replace(/\\/g, "/"))
    .filter((entry) => /\.(ts|tsx|css)$/.test(entry))
    .filter((entry) => !entry.endsWith(".test.ts"))
    .sort();
  return files.map((file) => ({
    file,
    text: readFileSync(path.join(srcRoot, file), "utf8"),
  }));
}

const sourcesUnderTest = sources();

describe("UI source content", () => {
  it("scans the whole source tree", () => {
    expect(sourcesUnderTest.length).toBeGreaterThanOrEqual(20);
    expect(sourcesUnderTest.some((entry) => entry.file.endsWith("app/page.tsx"))).toBe(true);
  });

  it("never stores notes in the browser", () => {
    const banned = ["localStorage", "sessionStorage", "indexedDB", "document.cookie"];
    const offenders = sourcesUnderTest.filter((entry) =>
      banned.some((token) => entry.text.includes(token)),
    );
    expect(offenders.map((entry) => entry.file)).toEqual([]);
  });

  it("makes no analytics, telemetry or CDN calls", () => {
    const banned = [
      "gtag(",
      "googletagmanager",
      "google-analytics",
      "fonts.googleapis",
      "cdn.jsdelivr",
      "cdnjs.cloudflare.com",
      "unpkg.com",
      "@vercel/analytics",
      "posthog",
      "mixpanel",
      "NEXT_TELEMETRY",
    ];
    const offenders = sourcesUnderTest.filter((entry) =>
      banned.some((token) => entry.text.includes(token)),
    );
    expect(offenders.map((entry) => entry.file)).toEqual([]);
  });

  it("only ever points at the loopback backend", () => {
    const allowed = ["http://127.0.0.1", "http://localhost"];
    const offenders: string[] = [];
    for (const entry of sourcesUnderTest) {
      for (const match of entry.text.match(/https?:\/\/[^\s"'`)]+/g) ?? []) {
        if (!allowed.some((prefix) => match.startsWith(prefix))) {
          offenders.push(`${entry.file}: ${match}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("contains no advice, diagnosis or dose text", () => {
    const advice = [
      /you should (apply|spray|use|plant)/i,
      /we recommend/i,
      /recommended (rate|dose|dosage|amount)/i,
      /\d+\s?kg\s?(per\s)?(ha|hectare)/i,
      /\d+\s?(litres?|liters?)\s?(per\s)?(ha|hectare)/i,
      /apply (fertilis|fertiliz|urea|npk|pesticide|herbicide)/i,
      /this (disease|crop|plant) (is|has)/i,
    ];
    const offenders: string[] = [];
    for (const entry of sourcesUnderTest) {
      for (const pattern of advice) {
        const match = entry.text.match(pattern);
        if (match) offenders.push(`${entry.file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the fixed refusal string in one place", () => {
    const withRefusal = sourcesUnderTest.filter((entry) =>
      entry.text.includes("REFUSAL_STRING ="),
    );
    expect(withRefusal.map((entry) => entry.file)).toEqual(["lib/strings.ts"]);
  });
});
