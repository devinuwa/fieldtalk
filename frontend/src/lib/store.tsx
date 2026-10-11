"use client";

/**
 * In-memory application store.
 *
 * Notes are held in React state for the current session only: nothing is written to
 * browser storage (no web storage, no cookies, no IndexedDB) - hard rule 5. The
 * backend store is the place notes persist; until it exists, mock mode keeps them for
 * the life of the tab.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { summarizeStages } from "@/lib/ask";
import { getClient, isMockMode, todayISO } from "@/lib/contract";
import { ModelUnavailableError, SttUnavailableError } from "@/lib/errors";
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
import type { AskRun, AskStage } from "@/lib/types";

interface AppState {
  entries: StoredEntry[];
  health: Health | null;
  loading: boolean;
  error: string | null;
  /** True while the UI runs on the bundled fixtures instead of the backend. */
  mock: boolean;
  /** True when the local model cannot be reached: the manual path stays open. */
  modelUnavailable: boolean;
  refresh: () => Promise<void>;
  setModelAvailable: (available: boolean) => Promise<void>;
  /** Audio -> transcript. The transcript is shown back before anything is stored. */
  transcribe: (input: SttInput) => Promise<SttResult>;
  /** Transcript -> closed-schema extractions for review. */
  extract: (request: ExtractionRequest) => Promise<ExtractionResult>;
  addEntry: (input: EntryInput) => Promise<StoredEntry>;
  updateEntry: (id: string, patch: StoredEntryPatch) => Promise<StoredEntry>;
  confirmEntry: (id: string) => Promise<StoredEntry>;
  deleteEntry: (id: string) => Promise<void>;
  weeklyReport: (weekOfISO: string) => Promise<WeeklySummary>;
  runAsk: (question: string, onStage?: (stage: AskStage) => void) => Promise<AskRun>;
  /** A question handed over from the record screen, picked up by the Ask screen. */
  pendingQuestion: string | null;
  setPendingQuestion: (question: string | null) => void;
  today: string;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<FieldTalkClient | null>(null);
  const [entries, setEntries] = useState<StoredEntry[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Handed from the record screen to the Ask screen through the store: no query strings,
  // so the static export keeps working without a Suspense boundary.
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const today = useMemo(() => todayISO(), []);
  const mock = useMemo(() => isMockMode(), []);

  const client = useCallback(() => {
    if (clientRef.current === null) clientRef.current = getClient();
    return clientRef.current;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const api = client();
      const [nextEntries, nextHealth] = await Promise.all([api.listEntries(), api.health()]);
      setEntries(nextEntries);
      setHealth(nextHealth);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setModelAvailable = useCallback(
    async (available: boolean) => {
      const api = client();
      if (api instanceof MockFieldTalkClient) {
        api.setModelAvailable(available);
        await refresh();
      }
    },
    [client, refresh],
  );

  const transcribe = useCallback((input: SttInput) => client().transcribe(input), [client]);

  const extract = useCallback(
    (request: ExtractionRequest) => client().extract(request),
    [client],
  );

  const addEntry = useCallback(
    async (input: EntryInput) => {
      const created = await client().addEntry(input);
      setEntries((current) => [...current, created]);
      return created;
    },
    [client],
  );

  const updateEntry = useCallback(
    async (id: string, patch: StoredEntryPatch) => {
      const updated = await client().updateEntry(id, patch);
      setEntries((current) => current.map((entry) => (entry.id === id ? updated : entry)));
      return updated;
    },
    [client],
  );

  const confirmEntry = useCallback(
    async (id: string) => {
      const updated = await client().confirmEntry(id);
      setEntries((current) => current.map((entry) => (entry.id === id ? updated : entry)));
      return updated;
    },
    [client],
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      await client().deleteEntry(id);
      setEntries((current) => current.filter((entry) => entry.id !== id));
    },
    [client],
  );

  const weeklyReport = useCallback(
    (weekOfISO: string) => client().weeklyReport(weekOfISO),
    [client],
  );

  const runAsk = useCallback(
    async (question: string, onStage?: (stage: AskStage) => void) => {
      const stages: AskStage[] = [];
      for await (const stage of client().askStream(question)) {
        stages.push(stage);
        onStage?.(stage);
      }
      return summarizeStages(question, stages);
    },
    [client],
  );

  const value: AppState = {
    entries,
    health,
    loading,
    error,
    mock,
    modelUnavailable: health?.model === "unavailable",
    refresh,
    setModelAvailable,
    transcribe,
    extract,
    addEntry,
    updateEntry,
    confirmEntry,
    deleteEntry,
    weeklyReport,
    runAsk,
    pendingQuestion,
    setPendingQuestion,
    today,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (context === null) throw new Error("useApp must be used inside AppProvider");
  return context;
}

function describe(cause: unknown): string {
  if (cause instanceof ModelUnavailableError) return "The local model could not be reached.";
  if (cause instanceof SttUnavailableError) return "Speech-to-text is not available on this machine.";
  return cause instanceof Error ? cause.message : String(cause);
}
