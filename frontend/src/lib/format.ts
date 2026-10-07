import type { DateExprOrNull, Quantity } from "@/lib/types";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** How the UI shows what the model emitted: the expression, never a resolved date. */
export function describeDateExpr(expr: DateExprOrNull): string {
  if (expr === null) return "not stated (recording date is used)";
  if (expr.kind === "today") return "today";
  if (expr.kind === "days_ago") return `${expr.n ?? "?"} day(s) ago`;
  const month = expr.month ?? 0;
  return `on ${expr.day ?? "?"} ${MONTHS[month - 1] ?? `month ${month}`}`;
}

export function describeQuantity(quantity: Quantity | null): string {
  if (quantity === null) return "none";
  return `${quantity.value} ${quantity.unit}`;
}
