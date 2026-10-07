/**
 * Date resolution for the mock layer.
 *
 * In the real system this lives in the backend engine (PLAN.md: "Code resolves
 * `date_expr` against the recording date"). The mock needs the same rule so a
 * confirmed preview gets a real ISO date instead of a model-supplied one.
 */

import { addDays, daysSincePlanting, parseISODate, toISODate } from "@/lib/engine";
import type { DateExprOrNull } from "@/lib/types";

export interface ResolvedDate {
  /** null when the expression is invalid and must be reviewed by hand. */
  date: string | null;
  /** How the code resolved it, for the review UI. */
  note: string;
}

export function resolveDateExpr(expr: DateExprOrNull, recordedAtISO: string): ResolvedDate {
  if (expr === null || expr === undefined) {
    return { date: recordedAtISO, note: "no date in the note: recording date used" };
  }
  if (expr.kind === "today") {
    return { date: recordedAtISO, note: '"today": recording date used' };
  }
  if (expr.kind === "days_ago") {
    const n = Number(expr.n);
    if (!Number.isInteger(n) || n < 0) return { date: null, note: "days_ago needs a whole number" };
    return { date: addDays(recordedAtISO, -n), note: `${n} days before the recording date` };
  }
  const month = Number(expr.month);
  const day = Number(expr.day);
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    return { date: null, note: "month_day needs both a month and a day" };
  }
  const year = parseISODate(recordedAtISO).getUTCFullYear();
  for (const candidate of [`${year}-${pad(month)}-${pad(day)}`, `${year - 1}-${pad(month)}-${pad(day)}`]) {
    const valid = isValidCalendarDate(candidate);
    if (!valid) return { date: null, note: `${month}/${day} is not a calendar date` };
    if (candidate <= recordedAtISO) {
      return {
        date: candidate,
        note:
          candidate.startsWith(String(year))
            ? `${month}/${day} in ${year}`
            : `${month}/${day} was still ahead this year, so last year used`,
      };
    }
  }
  return { date: null, note: "could not resolve month_day" };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isValidCalendarDate(iso: string): boolean {
  try {
    return toISODate(parseISODate(iso)) === iso;
  } catch {
    return false;
  }
}

/** Days between a planting date and the recording date, or null when unknown. */
export function daysSincePlantingOrNull(
  plantingISO: string | null,
  recordedAtISO: string,
): number | null {
  if (plantingISO === null) return null;
  return daysSincePlanting(plantingISO, recordedAtISO);
}
