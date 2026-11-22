# IPC-BUG-01 checkpoint — the bug reporter verifies the caller · 2026-11-21

**Batch:** IPC-BUG-01 (P0, IPC authorization). Six handlers in `src/main/handlers/bugs.ts`.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/c34cb1fb-workspace-os` / `86f3c2f` (IPC-DIAG-01).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-BUG-01** | Reproduced defect (control failure) | Confirmed | The in-app bug reporter had no origin check on any of its six channels. `bug:file` **appends a report to `docs/BUGS.md` of the development repo** (a write into the project's own source tree, chosen by a persisted config), `bug:analyze` spends a **model call** and reads repository state, `bug:setRepo` **re-points the reporter at a directory** — deciding where every later report is written — and `bug:context`/`bug:status`/`bug:list` return the repo path, the app version, the commit, the live workspace context (`surface`, `openFile`) and **the last error lines of the main-process log**. |
| **BUG-02** | Triage correction (B → A) | Confirmed | `bug:status` was classified **B** in the triage with the reason *"poller status, no user content"*. It returns `repoRoot` (absolute path), `logPath` and the number of filed reports: the same information class that moved `workspace:recents` to verdict A. Reclassified and guarded here — the second correction of the series, after `drive:connection`. Verdict A becomes 124 / B 20. |
| **BUG-03** | Pre-existing control (not a defect, worth naming) | Confirmed | `bug:setRepo` already validated the target: the folder must contain a `package.json` with `name === 'workspace-os'`, otherwise it refuses. That confines *where* the config may point, not *who* may point it — so the guard goes in front and the validation stays. |

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/bugs.ts` | `assertMainWindowFrame(event)` first in all six handlers (`status`, `setRepo`, `context`, `analyze`, `file`, `list`); `bug:status`/`bug:list` were `() =>` and became `(event) =>`; `bug:context` was an expression body and became a block returning `gatherContext(...)`. |
| `src/main/handlers/bugs.authorization.test.ts` | **new**: 26 tests — 6 channels × 4 unauthorized callers, plus owner controls and the surviving validations. |
| `src/main/ipc-authorization.test.ts` | 6 channels moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **101**. |

The model is mocked (`analyzeBug` becomes a recorded call); the bug log, the repo
validation, the persisted config and the crash-log read are real. A refusal
therefore has to leave two real directories exactly as the fixture made them: the
repo holds only `package.json`, the state dir only `bug-reporter.json`, and the
config still points at the original repo.

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … bugs.authorization.test.ts` | pre-fix | 1 | **RED**: **24 failed / 2 passed** — exactly 6 × 4 refusals missing; the owner controls stayed green |
| S2 | same | fix | 0 | **GREEN**: 26/26 |
| S3 | mutation M34 (`bug:file`) | mutated | 1 | **6 failures**: 4 unauthorized callers + the snippet and origin inventory tests |
| S4 | mutation M35 (`bug:setRepo`) | mutated | 1 | 6 failures, same shape |
| S5 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| S6 | full ESLint JSON over `src` | final | 0 | 1014 files, 0 errors / 0 warnings |
| S7 | full suite (`--maxWorkers=2`) | final | 0 | **365 files pass + 3 skipped; 4649 tests pass + 26 skipped; 0 failed** (+26) |
| S8 | `npm run build` | final | 0 | clean (generated `resources/wos-*` files reverted afterwards) |

## 4. Inventory after this batch

**473 declared = 332 `MUST_HAVE_GUARD` + 89 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **101**;
all sets unique.

`EXPLICITLY_NO_GUARD`: 95 → 89. Of those 89, **20 are verdict B**, so
**verdict-A remaining: 69** — exactly the four clusters `memory:*` (15),
`speech:*` (23), `history:*` (11) and `browser:*` (20).

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| 6 channels refuse non-owner callers | NIVEL 2 | NIVEL 2 — no model call, no context or log read, no report written, config unchanged | **APROBADO** |
| The owner is admitted and the reporter reached | NIVEL 2 | NIVEL 2 — status/context/list answer, `analyzeBug` is invoked, a report lands in `docs/BUGS.md`, `setRepo` rewrites the config | **APROBADO** |
| Validation survives and runs after the guard | NIVEL 2 | NIVEL 2 — a folder without `package.json` is still refused, an empty report still throws | **APROBADO** |
| A real model, a real repository, a real crash log | NIVEL 3 | none — the model is stubbed; the repo is a temp folder with a `package.json` | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"A bug report is the user's own text going to the user's own repo."* It is a
   **write into the source tree of the running app**, at a path chosen by a
   config that `bug:setRepo` can change. A foreign frame could not only file
   reports but silently aim the reporter at another validated checkout.
2. *"`bug:analyze` writes nothing."* It spends a model call and sends along the
   repo's recent errors and the live context — an exfiltration path with a bill
   attached. It is read-only and still verdict A.
3. *"`bug:status` is trivial."* The triage said so and was wrong; it discloses
   the absolute repo path and the log filename. Guarded, and the correction is
   recorded rather than silently absorbed.
4. *"26 tests for 6 channels is padding."* Two questions per channel — refused
   *and not executed*, admitted *and executed* — in the same fixture, so a guard
   that refuses everything fails the controls.

**Blue:** RED equals the missing matrix (24 = 6 × 4); M34/M35 isolate the two
handlers with side effects; the full suite grew by exactly +26; the inventory
invariant covers all six channels including the untriaged one.

## 7. Residual risk

- **69 verdict-A channels** remain: `memory:*` (15), `speech:*` (23),
  `history:*` (11), `browser:*` (20).
- Reclassifying `bug:status` moved a channel *into* A rather than out of it: the
  remaining count went 74 → 69 while the number of guarded channels grew by six,
  which is the arithmetic proof of the correction (74 − 6 + 1 = 69).
- The model half of `analyzeBug` (prompt, provider, cost) is not exercised; only
  that it is *reached* or *not reached*.
- `bug:file` writes into this repository's `docs/BUGS.md` on a real run; the
  fixture never touches the real repo (both repos are temp folders).
- No NIVEL 3.

## 8. Next batch

**IPC-MEM-01** — `memory:*` (15): remember / forget / correct / query / propose,
the personal memory store. Then `history:*` (11), `browser:*` (20) and `speech:*`
(23, including `read-clipboard` and `set-key`).
