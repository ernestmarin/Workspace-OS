# IPC-STORE-01 checkpoint — the derived-state stores verify the caller · 2026-11-21

**Batch:** IPC-STORE-01 (P0, IPC authorization). Twenty-five handlers across five modules: `metrics.ts` (6), `collections.ts` (6), `ranges.ts` (7), `components.ts` (2), `wiki.ts` (4).
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/9cd5feee-workspace-os` / `451c97b` (IPC-SESSION-02).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-STORE-01** | Reproduced defect (control failure) | Confirmed | Twenty-five channels over the derived-state stores had no origin check: delete a metric / collection / range / link / component, refresh **all** sourced metrics or collections at once, read every transclusion or link table, preview a bulk sync, and `wiki:undo` — which **rewrites wiki pages and reindexes them**. Individually the least alarming group in the inventory; together they can empty the derived state of a workspace on request. |
| **STORE-02** | Naming/id coupling (observed, not a defect) | Confirmed | Three id families (`metric-*`, `coll-*`, `range-*`) and two link families (`clink-*`, `rlink-*`) are validated by regex before use, and the ids are what protect the stores from cross-family confusion. Nothing to fix; recorded because a future rename would silently widen three validators at once. |

## 2. Change

| File | Change |
| --- | --- |
| `metrics.ts`, `collections.ts`, `ranges.ts`, `components.ts`, `wiki.ts` | `assertMainWindowFrame(event)` first in all 25 handlers; the four expression-bodied ones (`transclusion:allLinks`, `collectionLink:allLinks`, `rangeLink:allLinks`, `components:list`) became blocks returning their value. |
| `src/main/handlers/stores.authorization.test.ts` | **new**: 50 tests — 25 channels × 4 unauthorized callers (each asserting **the store was never consulted**) plus 25 controls asserting the owner is admitted and the store *is* consulted. |
| `src/main/ipc-authorization.test.ts` | 25 channels moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **83**. |

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … stores.authorization.test.ts` | pre-fix | 1 | **RED**: **100 failed / 25 passed** — exactly 25 × 4 refusals missing, all 25 controls green |
| S2 | same | fix | 0 | **GREEN**: 125/125 |
| S3 | mutation M27 (`wiki:undo`) | mutated | 1 | 4 failures |
| S4 | mutation M28 (`components:list`) | mutated | 1 | 4 failures |
| S5 | mutation M29 (`metric:delete`) | mutated | 1 | 4 failures |
| S6 | `vitest run … stores + refresh + writers` | final | 0 | 153 tests pass (the neighbouring store suites are unaffected) |
| S7 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| S8 | `eslint -c config/eslint.config.mjs` (changed files) | final | 0 | clean |
| S9 | full suite | final | 0 | **363 files pass + 3 skipped; 4573 tests pass + 26 skipped; 0 failed** (+125) |

**Own mistakes, recorded:** the first test draft mocked `transclusions` inside `../metrics`, but the module imports it straight from `../transclusions` (and `collectionLinks` from `../collectionLinks`, `rangeLinks` from `../rangeLinks`), so nine controls failed on "store consulted"; and the first scripted guard pass inserted the call without converting `() =>` parameter lists, which `tsc` caught in four handlers. Both were fixed in the fixture/handler wiring, not by loosening an assertion.

## 4. Inventory after this batch

**473 declared = 314 `MUST_HAVE_GUARD` + 107 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **83**;
all sets unique.

`EXPLICITLY_NO_GUARD`: 153 → 107. **Verdict-A remaining: 86.**

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| 25 channels refuse non-owner callers | NIVEL 2 | NIVEL 2 — store counters stay empty for every refusal | **APROBADO** |
| The owner is admitted and the store reached | NIVEL 2 | NIVEL 2 — 25 controls, each asserting its store *was* consulted or that the answer is not the refusal | **APROBADO** |
| Validation survives | NIVEL 2 | NIVEL 2 — id regexes and path checks unchanged; the tests exercise them with real ids | **APROBADO** |
| Real writers (xlsx/docx/pptx/wiki pages) | NIVEL 3 | none — stores mocked; `syncAll` paths not exercised | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"These only touch derived data that can be regenerated."* `wiki:undo` rewrites pages and reindexes; deletes are not regenerable at all — the store entry is the only copy of the configuration.
2. *"The refresh handlers re-read files that already sit in the workspace."* They also **write** into closed documents (`syncAll`), which is why the preview/apply pair exists; the guard covers both.
3. *"50 tests for 25 channels is padding."* Each half answers a different question: refusal (with no store access) and admission (with store access). A guard that refuses everything would pass only the first half — this is the same trap `links.test.ts` fell into, from the other side.
4. *"Mocking every store means the tests only prove the mocks."* They prove *when* the store is reached, which is exactly the claim; the legitimate half ensures the guard is not simply blocking.

**Blue:** RED is exactly the missing matrix (100 = 25 × 4) with all controls green;
M27–M29 show per-handler guards; neighbouring suites (refresh/writers) stay
green; the inventory invariant covers all 25 new channels.

## 7. Residual risk

- **86 verdict-A channels** remain.
- `syncAll`/`previewSyncAll` semantics (which files may be written) are not re-verified here — they were guarded, not audited.
- No NIVEL 3.

## 8. Next batch

**IPC-PRINT-02 + IPC-AGENTS-02 + IPC-CHECKPOINT-02** — the smaller remaining
clusters: `print:document` (1), `agents:*` (5), `checkpoint:*`/`snapshot:*` (6),
`bug:*` (5). Then `memory:*` (15), `speech:*` (23), `history:*` (11) and
`browser:*` (20), which are the large ones.
