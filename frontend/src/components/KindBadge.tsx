import type { EntryKind } from "@/lib/types";

const STYLES: Record<EntryKind, string> = {
  observation: "bg-leaf-soft text-leaf border-leaf",
  issue: "bg-alert-soft text-alert border-alert",
  action: "bg-sky-soft text-sky border-sky",
  plan: "bg-plum-soft text-plum border-plum",
  measurement: "bg-soil-soft text-soil border-soil",
};

export function KindBadge({ kind }: { kind: EntryKind }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${STYLES[kind]}`}
    >
      {kind}
    </span>
  );
}
