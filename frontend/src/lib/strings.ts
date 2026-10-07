/**
 * Fixed strings. These are UI copies of constants that live in code on the
 * backend (hard rule 3: the refusal string is fixed in code, the model only
 * ever emits {"action":"refuse"}). Keep both sides in sync.
 */

/**
 * Shown whenever a question asks for advice, a diagnosis, a fertilizer or a
 * price. It is a refusal, not advice: FieldTalk never states agronomic facts.
 */
export const REFUSAL_STRING =
  "I can't answer that. FieldTalk does not give advice, diagnoses, fertilizer or price guidance. It only records and recalls what you told it.";

/** Shown when the question is too vague for a tool to run. */
export const CLARIFY_FALLBACK = "Which plot do you mean, and what detail should I look up?";

/** Banner text when the local model is not reachable: the manual path still works. */
export const MODEL_UNAVAILABLE_TITLE = "Local model unavailable";

export const MODEL_UNAVAILABLE_BODY =
  "Automatic extraction and ask-your-notes are off. You can still type, edit, confirm and delete entries by hand, and the timeline, days-since counts and weekly report keep working.";

export const STT_UNAVAILABLE_TITLE = "Speech-to-text unavailable";

export const STT_UNAVAILABLE_BODY =
  "Recording and transcription are off on this machine. Type your notes by hand and everything else in the app still works.";

/** Every screen that shows demo data says so. */
export const SYNTHETIC_LABEL = "Synthetic demo data";

export const NO_TELEMETRY_NOTE =
  "Runs offline: no accounts, no telemetry, no cloud calls. Recordings and notes stay on this machine.";
