# IPC-WORKSPACE-02 checkpoint — the root itself verifies the caller · 2026-11-21

**Batch:** IPC-WORKSPACE-02 (P0, IPC authorization). Three handlers in `src/main/menu.ts`: `workspace:open-recent`, `workspace:close`, `workspace:recents`.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/9cd5feee-workspace-os` / `7ed5297` (IPC-PDF-01).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-WORKSPACE-02** | Reproduced defect (control failure) | Confirmed | `workspace:open-recent` calls `openWorkspacePath(dir)` with a **caller-supplied string**. It checks only that the path is an existing directory, then calls `setWorkspaceRoot(dir)` — the single value **every filesystem validator scopes to** (see the header of `workspace-root.ts`). A foreign frame naming `/home/<user>` (or `/`) would silently widen the boundary for every later operation, without a native dialog in the way. `workspace:close` clears that root and `workspace:recents` returns the user's recent folder paths. None of the three looked at the event. |
| **WORKSPACE-03** | Design gap (recorded, not fixed) | Confirmed | Even for the owner, `open-recent` accepts **any existing directory**, not only the ones in the recent list it is named after. That is a capability question, not an authorization one: narrowing it changes behaviour the empty-state UI relies on. Recorded so the decision is made deliberately rather than inherited. |

Severity: this is the same class as `fs:open-folder-dialog` (guarded in
IPC-WATCH-01) — *the authoritative root* — with a caller-supplied path instead of
a native picker.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/menu.ts` | `assertMainWindowFrame(event)` first in the three handlers; `workspace:close` and `workspace:recents` gain an event parameter; comments name the class and the recorded design gap. |
| `src/main/workspace.authorization.test.ts` | **new**: 15 tests — 3 channels × 4 unauthorized callers, each proving **the root did not move**, plus the legitimate surface (root moves, `workspace:root-changed` reaches the window, menu rebuilt, recents listed, close clears) and the surviving input validation. |
| `src/main/ipc-authorization.test.ts` | three channels moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **49**. |
| `docs/ipc-class-01-triage.md` | cluster 1 marked done. |

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| W1 | `vitest run … workspace.authorization.test.ts` | pre-fix | 1 | **RED**: **12 failed / 3 passed** — every unauthorized call moved the root, closed the folder or listed recents |
| W2 | same | fix | 0 | **GREEN**: 15/15 |
| W3 | mutation M23 (`workspace:open-recent` guard removed) | mutated | 1 | 4 failures |
| W4 | `vitest run … workspace + ipc-authorization` | final | 0 | 24 tests pass |
| W5 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| W6 | `eslint -c config/eslint.config.mjs` (changed files) | final | 0 | clean |
| W7 | full suite | final | 0 | **360 files pass + 3 skipped; 4408 tests pass + 26 skipped; 0 failed** (+15) |

**Fixture note:** the first version of the control test compared promises to
values — `ipcHandle` wraps every handler in an `async`, so even a synchronous
handler returns a promise. The assertions were corrected to await; the handlers
were not touched.

## 4. Inventory after this batch

**473 declared = 280 `MUST_HAVE_GUARD` + 141 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **49**;
all sets unique.

`EXPLICITLY_NO_GUARD` is down from 153 to 141: 9 `pdf:*` + 3 `workspace:*`.
Verdict-A channels remaining: **120**.

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| The root cannot be moved by a non-owner | NIVEL 2 | NIVEL 2 — real `workspace-root`, root compared before/after every refusal | **APROBADO** |
| Legitimate surface intact | NIVEL 2 | NIVEL 2 (open, root-changed event, menu rebuild, recents, close) | **APROBADO** |
| Input validation survives | NIVEL 2 | NIVEL 2 (non-string and non-directory refused) | **APROBADO** |
| Real Electron menu | NIVEL 3 | none — `Menu` mocked | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"It only opens folders that exist — harm is limited."* Limited to every directory on the machine. The check is existence, not permission.
2. *"The renderer only ever shows recents, so it never sends anything else."* That is a property of the current renderer build, not a control; the channel accepts any string from any frame.
3. *"Opening a folder is not destructive."* It is not, but it changes what every destructive operation can touch afterwards — the definition of a privilege boundary.
4. *"Guarding `workspace:recents` breaks the empty state."* The empty state runs in the main frame, which is exactly what the guard admits; the control test asserts it still answers.

**Blue:** RED 12/12 with controls green; M23 shows the guard is load-bearing for
the highest-consequence channel in the batch; the root comparison is done against
the real module, not a mock, so "did it move?" cannot be faked.

## 7. Residual risk

- **WORKSPACE-03** (§1): any existing directory is accepted; the fix is a capability decision.
- **120 verdict-A channels** remain unguarded (see the triage table).
- No NIVEL 3: native menu and the real window are mocked.
- The guard scheme stays single-window (`setMainWindow`).

## 8. Next batch

**IPC-DRIVE-02** — the five remaining `drive:*` channels (`connect`, `disconnect`,
`list`, `open`, `search`): network, OAuth secrets, and `drive:open` writes a
remote file into the workspace. The fixture pattern is already known
(`drive.security.test.ts` mocks the same clients). Then `sessions:*` +
`chat:upload`, then the derived-state stores.
