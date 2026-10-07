# FIXTURE_HASHES — FieldTalk

`fixtures/` and `eval/` are owned by the backend agent (AGENTS.md section 6). Their
contents are recorded here so that any change is visible in review. Verify with:

```
sha256sum fixtures/golden_engine.json eval/transcripts.jsonl
```

| File | Bytes | sha256 | Recorded |
|---|---|---|---|
| `fixtures/golden_engine.json` | 1797 | `fd7db75eed1680e7bf9178d14310a37de04fa40040ff7b084dfce3b11a5112e5` | 2026-10-07, before the first commit |
| `eval/transcripts.jsonl` | 3030 | `bc56763051a26720c6d485776946df4f6f518d9c69f677fb3fb82d9b4e11d09f` | 2026-10-07, before the first commit |

Both files are synthetic (`"synthetic": true`), per AGENTS.md rule 7.

## Open issue in `fixtures/golden_engine.json` (NOT edited — reported)

`weekly_cases[0]` names the week **Mon 2026-09-28 … Sun 2026-10-04** and expects
`{"observation": 1, "issue": 2, "action": 1}` (total 4).

Hand-derived from the entries in the same fixture for that week:

| Entry | Date | Kind |
|---|---|---|
| e1 | 2026-09-28 | observation |
| e2 | 2026-09-30 | issue |
| e4 | 2026-10-01 | issue |
| e3 | 2026-10-02 | action |
| e5 | 2026-10-03 | observation |

Derived counts: `{"observation": 2, "issue": 2, "action": 1}` — **total 5, not 4**.

No window convention reconciles the two: e5 (Saturday 2026-10-03) is inside
2026-09-28 … 2026-10-04 whether the end day is treated as inclusive or exclusive, and
the fixture counts e3 on 2026-10-02 from the same week.

The engine implements the hand derivation, `backend/tests/test_engine_golden.py` records
both numbers side by side, and the fixture is left untouched for its owner to correct.
Once `expected_counts` is fixed to 2 observations, `test_fixture_weekly_case_disagrees_with_its_own_entries`
will fail on purpose, which is the signal to delete that note.
