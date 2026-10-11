# FIXTURE_HASHES — FieldTalk

`fixtures/` and `eval/` are owned by the backend agent (AGENTS.md section 6). Their
contents are recorded here so that any change is visible in review. Verify with:

```
sha256sum fixtures/golden_engine.json eval/transcripts.jsonl
```

| File | Bytes | sha256 | Recorded |
|---|---|---|---|
| `fixtures/golden_engine.json` | 1797 | `42aadf2a2ff9231d098bdbb89dbd9e0a82b8b0ef24735ae036deabbc7e608099` | 2026-10-10, weekly `expected_counts` corrected (see below) |
| `eval/transcripts.jsonl` | 3030 | `bc56763051a26720c6d485776946df4f6f518d9c69f677fb3fb82d9b4e11d09f` | 2026-10-07, before the first commit |

Both files are synthetic (`"synthetic": true`), per AGENTS.md rule 7.

## History: `expected_counts` correction in `fixtures/golden_engine.json`

`weekly_cases[0]` names the week **Mon 2026-09-28 … Sun 2026-10-04** and previously
expected `{"observation": 1, "issue": 2, "action": 1}` (total 4).

Hand-derived from the entries in the same fixture for that week:

| Entry | Date | Kind |
|---|---|---|
| e1 | 2026-09-28 | observation |
| e2 | 2026-09-30 | issue |
| e4 | 2026-10-01 | issue |
| e3 | 2026-10-02 | action |
| e5 | 2026-10-03 | observation |

Derived counts: `{"observation": 2, "issue": 2, "action": 1}` — total 5.

No window convention ever reconciled the two: e5 (Saturday 2026-10-03) is inside
2026-09-28 … 2026-10-04 whether the end day is treated as inclusive or exclusive, and
the fixture counted e3 on 2026-10-02 from the same week. The mismatch was documented
here and the fixture left untouched for its owner (AGENTS.md section 6).

**2026-10-10:** `expected_counts` corrected to `{"observation": 2, "issue": 2, "action": 1}`.
`backend/tests/test_engine_golden.py::test_weekly_case` now derives counts from the engine
output and compares them directly against the fixture, and `test_fixture_weekly_case_disagrees_with_its_own_entries`
(referenced by the earlier version of this note) no longer exists.
