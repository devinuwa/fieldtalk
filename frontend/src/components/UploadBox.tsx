"use client";

import { useState } from "react";

import { formatSeconds, measureAudioSeconds } from "@/lib/audio";
import type { RecordedClip } from "@/components/Recorder";

/** Pick an audio file from the device. The file is read locally and never uploaded. */
export function UploadBox({ onClip }: { onClip: (clip: RecordedClip) => void }) {
  const [message, setMessage] = useState<string | null>(null);

  async function handleFile(file: File) {
    const seconds = await measureAudioSeconds(file);
    setMessage(
      seconds === null
        ? `${file.name}: the browser could not read the length, so no audio length is reported.`
        : `${file.name}: ${formatSeconds(seconds)} of audio.`,
    );
    onClip({ blob: file, name: file.name, audioSeconds: seconds });
  }

  return (
    <div>
      <label className="field-label" htmlFor="audio-file">
        Upload an audio file
      </label>
      <input
        id="audio-file"
        type="file"
        accept="audio/*"
        className="input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <p className="mt-1 text-xs text-ink-soft">
        The file stays on this machine: it is only sent to the loopback backend.
      </p>
      {message !== null ? <p className="mt-1 text-sm text-ink-soft">{message}</p> : null}
    </div>
  );
}
