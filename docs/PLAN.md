# PLAN — FieldTalk (publish Saturday Oct 10 evening WAT)

## Entry schema (closed; the LLM fills it, code validates)
```json
{"entries":[{"plot":"string|null","crop":"string|null",
  "kind":"observation|issue|action|plan|measurement",
  "text":"short phrase copied or lightly trimmed from the transcript",
  "date_expr":{"kind":"today|days_ago|month_day|null","n":"int|null","month":"int|null","day":"int|null"}|null,
  "planting_date_expr":{"kind":"month_day|days_ago|null","n":"int|null","month":"int|null","day":"int|null"}|null,
  "quantity":{"value":"number","unit":"string"}|null}],
 "action":"run|clarify|refuse","clarify_question":"string|null"}
```
Code resolves `date_expr` against the recording date (`days_ago`: today minus n; `month_day`: that month/day in the current year, or previous year if it would be in the future; invalid dates rejected). The model never outputs resolved dates or arithmetic.

## Engine (pure Python)
`resolve_date`, `days_since(planting, on)`, `days_since_last_note(plot, as_of)`, `plot_timeline(plot)`, `open_issues(plot)` (issue entries with no later action entry on the same plot), `weekly_summary(as_of)` (counts by kind, plots touched, issues opened/closed). Golden cases: `fixtures/golden_engine.json` (synthetic, hand-checkable).

## Tools for ask-your-notes
`plot_timeline(plot)`, `days_since_planting(plot)`, `days_since_last_note(plot)`, `open_issues(plot|null)`, `weekly_summary(week_of)`, `search_notes(keyword)` (plain substring over stored entries, no embeddings). Model emits `{"action":"run","tool":...,"plot_text":...,"date_expr":...}`; code matches plot text against known plots; unknown -> clarify. Answers are templates over tool results; V3 checks every number/date appears in tool output.

## Evaluation (cheap)
1. **STT:** record 3 clips (own voice, outdoors, wind/birds, 30-60 s). Hand-correct transcripts. Report word error rate for faster-whisper `base` and `small` (and the CPU real-time factor). Report as measured, on this machine, with conditions.
2. **LLM extraction:** `eval/transcripts.jsonl` (12 synthetic transcripts + gold). Run Gemma 3 4B and two other small instruct models, same prompts, temperature 0. Metrics: field-level accuracy (crop, plot, kind set, date_expr, quantity), ungrounded-field count (must be 0 accepted), invalid JSON rate, latency p50/p95. Gemma category only if Gemma ships AND the comparison ran.

## Schedule and gates
| Day | Work | Gate |
|---|---|---|
| Mon | repo; faster-whisper smoke test on a 60 s clip of your own voice (kill: unusable speed -> pivot Listening Walk); engine + tests start | **G0** STT works |
| Tue | engine + store + extraction + V1 + tests; record 3 outdoor clips, hand-correct | **G1** engine tests green |
| Wed | ask-your-notes + V2/V3; **field visit #1**; article skeleton | **G2** ask works end to end with stubs and live Gemma |
| Thu | UI (record/upload, entries list with edit, ask box, weekly report), model comparison | **G3** whole flow in browser |
| Fri | failure cases, fresh-clone test on another machine, README; **freeze 6 PM** | **G4** README steps verified |
| Sat | field visit #2, video, screenshots, article, JUDGE ME, **publish by evening** | published |
| Sun/Mon AM | buffer only | |

## Scope
MUST: P0 list in AGENTS.md. SHOULD: comparison, WER. DO NOT BUILD: advice, other languages, hosting the model, accounts, mobile app.

## Deliverables
Public repo (README with PowerShell setup, honest status table, model licences, credits, post-deadline commits), working local app, demo video, screenshots from the real walks, DEV post in the Touch Grass template (confirm tags from the template link), eval results, notes from the field visits with verbatim approved quotes only. Remove Prize Categories unless a category is genuinely used and evidenced.
