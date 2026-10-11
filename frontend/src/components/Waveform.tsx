"use client";

import { isSilentFrame } from "@/lib/audio";

interface Props {
  /** Live values in 0..1 from the microphone analyser. Empty means "no samples yet". */
  levels: number[];
  /** True while the microphone is open: the bars glow and the label says so. */
  live: boolean;
  className?: string;
}

/**
 * The microphone waveform. Every bar height comes from `levels`, which the recorder reads
 * from a Web Audio `AnalyserNode`; when the input is silent the bars are flat and the
 * label says nothing was captured. Nothing here is a canned animation.
 */
export function Waveform({ levels, live, className = "" }: Props) {
  const bars = levels.length > 0 ? levels : new Array(32).fill(0);
  const silent = isSilentFrame(bars);
  return (
    <div className={className}>
      <div
        className="flex h-16 items-end justify-center gap-[3px] rounded-xl border border-slate-line bg-surface-2 px-3 py-2"
        role="img"
        aria-label={live ? "Live microphone level" : "Microphone level, not recording"}
        data-testid="waveform"
        data-live={live ? "true" : "false"}
        data-silent={silent ? "true" : "false"}
      >
        {bars.map((level, index) => {
          const height = Math.max(3, Math.round(Math.min(1, level) * 100));
          return (
            <span
              key={index}
              className={`w-[6px] flex-1 rounded-full transition-[height] duration-75 ease-out ${
                live ? "bg-leaf" : silent ? "bg-slate-line" : "bg-leaf/50"
              }`}
              style={{ height: `${height}%` }}
            />
          );
        })}
      </div>
      <p className="mt-1 text-xs text-ink-soft" data-testid="waveform-caption">
        {live
          ? silent
            ? "Listening — no sound captured yet."
            : "Live waveform from your microphone."
          : "The waveform shows the microphone signal while recording."}
      </p>
    </div>
  );
}
