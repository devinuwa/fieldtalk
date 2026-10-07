/**
 * V1 marker. Anything the extraction could not trace back to the transcript is shown
 * highlighted and is never accepted silently (hard rule 2).
 */
export function GroundingNote({ field }: { field: string }) {
  return (
    <p className="mt-0.5 text-xs font-semibold text-alert">
      “{field}” was not found in the transcript — check it or clear it before confirming.
    </p>
  );
}

export function ungroundedClass(grounded: boolean): string {
  return grounded ? "" : "border-alert bg-alert-soft";
}
