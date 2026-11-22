# IPC-DIAG-01 checkpoint — printing, agents, checkpoints and snapshots verify the caller · 2026-11-21

**Batch:** IPC-DIAG-01 (P0, IPC authorization). Twelve handlers across four modules:
`printing.ts` (1), `handlers/agents.ts` (5), `handlers/checkpoint.ts` (3),
`handlers/snapshots.ts` (3).
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/c34cb1fb-workspace-os` / `c6c75af` (merge of IPC-STORE-01).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-DIAG-01** | Reproduced defect (control failure) | Confirmed | Twelve channels over four different subsystems had no origin check: `print:document` **opens a hidden BrowserWindow and sends a document to a printer**, `agents:write/delete` **write and delete agent definition files** (the prompts that drive the agent runtime) in both the workspace and the app state dir, `checkpoint:rollback` **restores files from git history**, `snapshot:save/delete` **writes and deletes workspace snapshots**, and `agents:build` spends a model call. Any frame in the app — including a foreign or nested one — could invoke all of them. |
| **DIAG-02** | Triage gap (documentation defect) | Confirmed | The cluster table in `ipc-class-01-triage.md` accounted for 117 of the 123 verdict-A channels: **`checkpoint:*` and `snapshot:*` (6) were never listed as a cluster**, even though they were counted in the remaining total. They are now cluster 12. |
| **DIAG-03** | Coupling (observed, not a defect) | Confirmed | `print:document` already used `event.sender.id` for **re-entrancy suppression** (`active` set). That is *not* authorization and must not be mistaken for it: the guard is refused before the set is consulted, and the tests assert `print` was never reached. |

## 2. Change

| File | Change |
| --- | --- |
| `src/main/printing.ts` | `assertMainWindowFrame(event)` first in `print:document`, **before** the re-entrancy check and the type validation. |
| `src/main/handlers/agents.ts` | `assertMainWindowFrame(event)` first in `agents:list/read/write/delete/build`; `agents:list` was `() =>` and became `(event) =>`. |
| `src/main/handlers/checkpoint.ts` | `assertMainWindowFrame(event)` first in `checkpoint:list/rollback/diff`; the three expression bodies became blocks returning their value. |
| `src/main/handlers/snapshots.ts` | `assertMainWindowFrame(event)` first in `snapshot:list/save/delete`; `snapshot:list` was `() =>` and became `(event) =>`. |
| `src/main/handlers/diagnostics.authorization.test.ts` | **new**: 50 tests — 12 channels × 4 unauthorized callers, each asserting nothing was printed / stored / restored, plus owner controls and the surviving validation. |
| `src/main/ipc-authorization.test.ts` | 12 channels moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **95**. |

The refusal test looks at three independent things, not just the thrown error:
`state.calls` (no `new-window`, no `loadURL`, no `snapshots.create`, no `checkpoints.rollbackTo`),
`state.printed` (the printer callback never ran) and the two temporary directories
(neither the workspace root nor the app state dir gained a single file).

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … diagnostics.authorization.test.ts` | pre-fix | 1 | **RED**: **48 failed / 2 passed** — exactly 12 × 4 refusals missing; the 2 passing are the owner controls and the validation control |
| S2 | same | fix | 0 | **GREEN**: 50/50 |
| S3 | mutation M30 (`print:document`) | mutated | 1 | **6 failures**: 4 unauthorized callers + the snippet and origin inventory tests |
| S4 | mutation M31 (`snapshot:save`) | mutated | 1 | 6 failures, same shape |
| S5 | mutation M32 (`agents:build`) | mutated | 1 | 6 failures, same shape |
| S6 | mutation M33 (`checkpoint:rollback`) | mutated | 1 | 6 failures, same shape |
| S7 | `vitest run … printing + snapshots + checkpoint + agentFormat + ipc-authorization` | final | 0 | 79 tests pass — the neighbouring suites that exercise these modules directly are unaffected |
| S8 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| S9 | full ESLint JSON over `src` | final | 0 | **1013 files, 0 errors / 0 warnings** |
| S10 | full suite (`--maxWorkers=2`) | final | 0 | **364 files pass + 3 skipped; 4623 tests pass + 26 skipped; 0 failed** (+50) |
| S11 | `npm run build` | final | 0 | clean (the three generated `resources/wos-*` CLI files reverted afterwards) |
| S12 | `npm audit` / `npm audit --omit=dev` | final | 1 / 1 | 40 moderate, 0 high, 0 critical — unchanged for four sessions |

**Why the mutation result is 6 and not 4:** each removed guard trips the behavioural
matrix *and* the two inventory tests (`todo canal MUST_HAVE_GUARD llama a un guard`,
`el filesystem del workspace verifica el emisor`). Two independent layers notice,
which is the point of keeping the inventory in the same suite.

**Own mistakes, recorded:** the first draft of the snapshot mock invented
`snapshots.save`, but the module exposes `create` — collected at import time, so the
suite failed for a reason unrelated to authorization; and a hand-written script to
move the 12 channels between sets matched the *last* `])` before the marker and
appended the block to `PUSH_CHANNELS` and then into the body of a test. Both were
fixed in the fixture/handler wiring and the inventory file was rebuilt from `git
checkout` rather than patched, not by loosening an assertion.

## 4. Inventory after this batch

**473 declared = 326 `MUST_HAVE_GUARD` + 95 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **95**;
all sets unique.

`EXPLICITLY_NO_GUARD`: 107 → 95. **Verdict-A remaining: 74.**

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| 12 channels refuse non-owner callers | NIVEL 2 | NIVEL 2 — no window created, nothing printed, no file written, no checkpoint or snapshot touched | **APROBADO** |
| The owner is admitted and the subsystem reached | NIVEL 2 | NIVEL 2 — the print callback fires, `snapshots.create`/`remove` and `checkpoints.rollbackTo`/`diffSince` are invoked, `rebuildMenu` runs | **APROBADO** |
| Validation survives and runs *after* the guard | NIVEL 2 | NIVEL 2 — bad title type and malformed checkpoint ids still throw, with no print | **APROBADO** |
| A real printer, a real git history, real snapshots | NIVEL 3 | none — the printer, `checkpoints` and `snapshots` are mocked at their boundaries | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"Printing is just a dialog; the user is at the machine."* It is not a dialog:
   `printDocument` builds an offscreen window and hands the document to the default
   printer silently, and `active` only suppresses double-clicks. A nested frame
   that renders untrusted HTML is one `invoke` away from paper output.
2. *"Agent definitions are markdown in the user's own folder."* They are the
   prompts executed by the agent runtime; `agents:write` also *preserves* foreign
   frontmatter, so a malicious frame could not only add an agent but keep an
   existing one's hidden configuration while swapping its body.
3. *"The guard on `checkpoint:list` is pointless — it is a read."* It returns the
   list of commit messages and ids of the user's workspace history; the same
   argument that moved `workspace:recents` to A.
4. *"50 tests for 12 channels is padding."* Each channel answers two questions —
   refused *and not executed*, admitted *and executed*. A guard that refuses
   everything passes the first half only; the controls catch that.
5. *"Mocking `checkpoints`/`snapshots` hides the rollback."* The claim under test is
   *when* the store is reached. The rollback semantics were not part of this batch
   and are listed as residual risk.

**Blue:** RED is exactly the missing matrix (48 = 12 × 4) with both controls green;
M30–M33 isolate four different modules; the neighbouring suites that use these
modules directly stay green; the inventory invariant covers all 12 new channels;
the full suite grew by exactly +50.

## 7. Residual risk

- **74 verdict-A channels** remain, including the two largest clusters (`speech:*`
  23 and `browser:*` 20).
- `agents:capabilities` stays in `EXPLICITLY_NO_GUARD`: it returns the static
  capability catalog (labels and tool-mode flags), no user content — reviewed here
  and left as verdict B.
- Real printer behaviour (silent print, cancellation, failure reason) is not
  exercised: mocked at `webContents.print`.
- Checkpoint rollback against a real repository, and snapshot restore, are not
  exercised. The guards are in front of the same calls the UI already makes.
- No NIVEL 3.

## 8. Next batch

**IPC-BUG-01** — `bug:*` (5): `bug:file` writes a report to disk, `bug:analyze`
spends a model call, `bug:context`/`bug:list` read repository state, `bug:setRepo`
points the bug reporter at a directory. Then `memory:*` (15), `speech:*` (23),
`history:*` (11) and `browser:*` (20).
