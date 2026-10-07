import { SYNTHETIC_LABEL } from "@/lib/strings";

/** Synthetic data is always labelled, never presented as a real field note. */
export function SyntheticBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="inline-block rounded border border-soil px-1.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-soil"
      title="Generated for the demo, not recorded in a field"
    >
      {compact ? "synthetic" : SYNTHETIC_LABEL}
    </span>
  );
}
