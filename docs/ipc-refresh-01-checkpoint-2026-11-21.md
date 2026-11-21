# IPC-REFRESH-01 checkpoint — the auto-refresh hooks verify the caller · 2026-11-21

**Batch:** IPC-REFRESH-01 (P0, IPC authorization). Two handlers: `metric:refreshForFile` (`metrics.ts`), `collection:refreshForFile` (`collections.ts`).
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/e28c7316-workspace-os` / `76b24be` (IPC-OFFICE-01).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-REFRESH-01** | Reproduced defect (control failure) | Confirmed | Both "refresh everything sourced from this file" hooks — called on every save — re-read a source document and **rewrite the derived values back into the workspace** (xlsx cells, docx content controls, pptx shape text). Neither looked at the event. `validateFilePath` kept the path inside the workspace, so a foreign frame could still name *any in-workspace document* and cause writes driven by it. |
| **FIXTURE-01** | Process defect, systemic (three occurrences) | Confirmed | The guard has now exposed **three** pre-existing test files (`links.test.ts`, `metrics.test.ts`, and the count is tracked in §6) that invoked handlers with a fabricated `{}` event and asserted *validation* while actually exercising nothing — or, worse, passing because the handler accepted anything. The suite was green for the wrong reason. |

Severity: workspace writes triggered by an unauthenticated caller, on a hook that
fires automatically.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/metrics.ts` | `assertMainWindowFrame(event)` first in `metric:refreshForFile`. |
| `src/main/handlers/collections.ts` | same in `collection:refreshForFile`. |
| `src/main/handlers/metrics.test.ts` | fixture corrected: `invoke()` now speaks as the registered owner; `invokeAs(event, …)` added; **one test pins the refusal** of an empty event. |
| `src/main/ipc-authorization.test.ts` | `MUST_HAVE_ORIGIN_GUARD` extended to **34** channels. |
| `src/main/handlers/refresh.authorization.test.ts` | **new**: 12 tests — 2 channels × 4 unauthorized callers proving the store was never consulted, the owner path reaching its own store, and the surviving path validation (traversal, escape, non-string). |

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| R1 | `vitest run … refresh.authorization.test.ts` | pre-fix | 1 | **RED**: **8 failed / 4 passed** — every unauthorized call reached the store |
| R2 | same | fix | 0 | **GREEN**: 12/12 |
| R3 | mutation M17 (`collection:refreshForFile` guard removed) | mutated | 1 | 4 failures |
| R4 | full suite, first attempt | — | 1 | **1 failed**: `metrics.test.ts` — its `{}` event was refused (FIXTURE-01) |
| R5 | full suite, after the fixture change | final | 0 | **357 files pass + 3 skipped; 4338 tests pass + 26 skipped; 0 failed** (+13 over IPC-OFFICE-01) |
| R6 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| R7 | `eslint -c config/eslint.config.mjs` (changed files) | final | 0 | clean |

## 4. Inventory after this batch

**473 declared = 268 `MUST_HAVE_GUARD` + 153 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **34**.

Origin-guard coverage: **265 of 268**. **Three remain:** `components:save`,
`drive:save`, `wiki:add`.

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| Both hooks refuse non-owner callers | NIVEL 2 | NIVEL 2 (store-consultation counter stays empty, export and collection refresh never run) | **APROBADO** |
| Legitimate surface intact | NIVEL 2 | NIVEL 2 (both answer `[]` for a source-less file, each reaching only its own store) | **APROBADO** |
| Path validation still independent of the guard | NIVEL 2 | NIVEL 2 (traversal, absolute escape, non-string all throw with no store access) | **APROBADO** |
| Real xlsx/docx/pptx writers | NIVEL 3 | none — the stores are counters here; the writers are exercised by their own suites | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"The hooks are cheap and idempotent, so unauthenticated calls are harmless."* They are cheap, not harmless: they rewrite cells and document content from a source the caller names. Idempotence limits damage per call, not the ability to trigger it.
2. *"Path validation already confines the effect to the workspace."* Confinement is the right property for *where*, and it is intact. The caller's identity is a separate property, and it was absent.
3. *"Mocking the stores proves nothing about refresh."* The claim is the guard, and the observable chosen is the first collaborator. The legitimate control proves both handlers still reach their own store and return a normal answer.
4. *"Fixing `metrics.test.ts` weakens the boring validation test."* It strengthens it: the same assertions now run against a legitimate event instead of a refusal, and a new test asserts the refusal separately.

**Blue:** RED 8/8; M17 shows the guard is load-bearing per handler; the traversal
assertions still pass with the fixture corrected; the full suite caught the third
FIXTURE-01 instance before the commit.

## 7. Residual risk

- Three path-only channels (§4).
- **FIXTURE-01 is systemic.** Each guard batch keeps finding test files that were
  green for the wrong reason; more are expected while the remaining modules are
  guarded. The full suite is the detector, which is why it is part of the gate.
- The refresh machinery itself (writers, plan/coerce logic) is out of scope here
  and covered by its own tests.

## 8. Next batch

`components:save`, `wiki:add` (a commit each, or one if their fixtures stay
small), then `drive:save` — the last one, and the only one that leaves the
machine (an upload to the user's Google Drive).
