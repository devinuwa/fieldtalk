/**
 * The typed client contract the UI talks to, plus the mock/HTTP switch.
 *
 * The backend does not exist yet, so with NEXT_PUBLIC_MOCK=1 (the default until
 * backend/ lands) every call is served by the mock layer from mock/from-fixtures.
 * The HTTP client implements the same methods against the endpoints listed in
 * frontend/README.md; switching is one env var, no UI changes.
 */

import { HttpFieldTalkClient } from "@/lib/http/client";
import { MockFieldTalkClient } from "@/lib/mock/client";
import type {
  EntryInput,
  ExtractionRequest,
  ExtractionResult,
  FieldTalkClient,
  Health,
  SttInput,
  SttResult,
  StoredEntry,
  StoredEntryPatch,
  WeeklySummary,
} from "@/lib/client-types";

export type {
  EntryInput,
  ExtractionRequest,
  ExtractionResult,
  FieldTalkClient,
  Health,
  SttInput,
  SttResult,
  StoredEntry,
  StoredEntryPatch,
  WeeklySummary,
};

/** Mock mode is on unless it is explicitly switched off. */
export function isMockMode(): boolean {
  const raw = process.env.NEXT_PUBLIC_MOCK;
  if (raw === undefined || raw === "") return true;
  return raw !== "0" && raw.toLowerCase() !== "false";
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";
}

let cached: FieldTalkClient | null = null;

export function getClient(): FieldTalkClient {
  if (cached === null) {
    cached = isMockMode()
      ? new MockFieldTalkClient({ today: todayISO() })
      : new HttpFieldTalkClient(apiBaseUrl());
  }
  return cached;
}

/** Local date, not UTC: "today" for the user standing in the field. */
export function todayISO(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
