# IPC-WATCH-01 checkpoint — the workspace lifecycle surface verifies the caller · 2026-11-21

**Batch:** IPC-WATCH-01 (P0, IPC authorization). One module: `src/main/handlers/watcher.ts`.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/e28c7316-workspace-os` / `8faaf6a` (merge of PR #18).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-WATCH-01** | Reproduced defect (control failure) | Confirmed | None of the eight handlers in `watcher.ts` looked at the event. This module is not only watchers: it **decides the authoritative workspace root** (`fs:open-folder-dialog` → `setWorkspaceRoot`), **writes into the workspace store** (`workspace:write-agent-note`), **copies a workspace file to a destination outside it** (`fs:save-copy-dialog`), and **reveals an arbitrary path in the OS file manager** (`fs:reveal`). A stale, child or foreign frame could trigger all of it. |
| **WATCH-02** | Unconfirmed risk (inventoried, not fixed) | Hypothesis | The module captures the `BrowserWindow` handed to `registerWatcherHandlers` and parents both native dialogs to it forever (`dialog.showOpenDialog(win…)`, `dialog.showSaveDialog(win…)`). After a window replacement (`app.on('activate')` → new window), the dialog would parent to a destroyed window. Not reproduced here; recorded for its own batch — it is a lifecycle concern, not an authorization one, and mixing them would make both harder to accept. |

Severity: root reassignment and out-of-workspace copy are the two operations that
can change what "the workspace" means or where user data lands.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/watcher.ts` | `assertMainWindowFrame(event)` first in all eight handlers; `_event`/no-parameter handlers → `event`. |
| `src/main/ipc-authorization.test.ts` | Seven channels moved from `EXPLICITLY_NO_GUARD` into `MUST_HAVE_GUARD` (`fs:open-folder-dialog`, `fs:reveal`, `fs:watch-start`, `fs:watch-stop`, `workspace:content-root`, `workspace:get-root`, `workspace:write-agent-note`); `MUST_HAVE_ORIGIN_GUARD` extended to **14** channels (the earlier eight fs channels plus these six, `fs:save-copy-dialog`, `fs:reveal`). |
| `src/main/handlers/watcher.authorization.test.ts` | **new**: 34 tests — 8 channels × 4 unauthorized callers with proof that nothing acted, plus a legitimate control that exercises the whole surface after the owner is replaced, plus the surviving input validations. |

**Deliberate non-change — `fs:reveal` is still not confined to the workspace.**
Its callers legitimately pass paths outside it (`ArtifactCards.tsx:43`,
`DownloadsButton.tsx:86`, `fileActions.ts:63`). `shell.showItemInFolder` shows a
location the user already has, reads no content and executes nothing; confining
it would remove capability without removing risk. The decision is written into
the module so a future reader does not "fix" it blindly.

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| W1 | `vitest run … watcher.authorization.test.ts` | pre-fix | 1 | **RED**: 32 failed / 2 passed — every unauthorized call **succeeded** (`promise resolved "undefined" instead of rejecting`) |
| W2 | same | fix | 0 | **GREEN**: 34/34 |
| W3 | mutation M9/M10 (guard removed from `fs:watch-start` / `fs:open-folder-dialog`) | mutated | 1 ×2 | 4 failures each; restored in `finally` |
| W4 | mutation M11 (guard removed from `workspace:write-agent-note`; name/body validation intact) | mutated | 1 | inventory invariant fails: the channel is in `MUST_HAVE_ORIGIN_GUARD` |
| W5 | `vitest run … watcher.authorization + ipc-authorization + ipc-surface + fs.authorization + trash.authorization` | final | 0 | 92 tests pass |
| W6 | `tsc --noEmit -p tsconfig.node.json` / `-p src/renderer/tsconfig.json` | final | 0 / 0 | no diagnostics |
| W7 | `eslint … src --format json` (raised stack) | final | 0 | 1003 files, **0 errors, 0 warnings** |
| W8 | `vitest run --config config/vitest.config.ts --maxWorkers=2` (full) | final | 0 | **354 files pass + 3 skipped; 4246 tests pass + 26 skipped; 0 failed** |
| W9 | `npm run build` | final | 0 | no `INEFFECTIVE_DYNAMIC_IMPORT`; regenerated `resources/wos-*/**.cjs` restored |
| W10 | `npm audit --omit=dev --json` / `npm audit --json` | final | 1 / 1 | **35 / 40 moderate, 0 high, 0 critical** — unchanged |

**Delta:** +1 test file, +34 tests over `8faaf6a` (4212 → 4246).

## 4. Inventory after this batch (measured from source)

**473 declared = 259 `MUST_HAVE_GUARD` + 162 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **14**.

Origin-guard coverage of the sensitive set: **245 of 259** verified by the same
snippet heuristic. **14 remain path-only:**

`canvas:export-pptx`, `collection:refreshForFile`, `components:save`,
`drive:save`, `knowledge:read`, `knowledge:search`, `links:resolve`,
`metric:refreshForFile`, `office:export-pdf`, `office:print`, `office:to-pdf`,
`search:query`, `search:symbols`, `wiki:add`.

**Method caveat (unchanged):** that list comes from the repository's own
substring heuristic, not from manual review of each handler. Several are
plausibly legitimate (an export that only reads its own resolved path), but
"plausible" is not a decision — each needs per-module triage.

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| Eight lifecycle handlers refuse non-owner callers | NIVEL 2 | NIVEL 2 — real handlers, real temp workspace, simulated Electron dialog/shell, real guard | **APROBADO** |
| Legitimate surface intact after owner replacement | NIVEL 2 | NIVEL 2 (watch start/stop, root read, note write, reveal, save-copy, folder picker) | **APROBADO** |
| Regression cannot be silent | — | `MUST_HAVE_ORIGIN_GUARD` = 14 (W4) | **APROBADO** |
| Real Electron dialogs / OS file manager | NIVEL 3 | none | **NO_EJECUTADO** |

Compliance: **cumple** for this module. Coverage: **parcial** (14 channels +
WATCH-02 open). Acceptance: **aceptado** at NIVEL 2.

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"The folder picker is harmless because the user chooses the folder."* They choose a folder, but an unauthorized caller still gets a native modal and a root change; the picker is the mechanism, not the authorization.
2. *"Guarding `workspace:get-root` breaks early renderer bootstrap."* `assertMainWindowFrame` requires the registered window, which `registerWatcherHandlers` sets itself (`setMainWindow(win)` at registration) — before any renderer can call. The control test replaces the owner and still reads the root.
3. *"The legitimate control might pass because the mock watcher is trivially permissive."* `watchTree` is mocked at an external boundary (fs watching) but the handler logic, guard, root resolution and dialog plumbing are real; the assertion pins `depth: 3` and the exact root.
4. *"Refusal could still open a dialog before rejecting."* Each unauthorized case asserts `showOpenDialog`/`showSaveDialog` were **not** called, and that no note file exists.
5. *"The guard is now the only check on `write-agent-note` input."* Falsified by the surviving-validation test (name regex, 2 MiB body cap).

**Blue:** RED failed for the auth invariant and only turned green with the guard;
M9–M11 show the guard and the inventory are both load-bearing; adjacent suites
(fs, trash, surface, inventory) stay green; delta is exactly the 34 new tests.

## 7. Residual risk

- 14 path-only channels (§4) and `WATCH-02` (§1).
- No Electron/OS acceptance: dialogs and the file manager are simulated.
- The invariant enforces the 14 listed channels; it does not audit the other 245
  origin-guarded ones on every commit beyond "a guard call is present".
- Dependency advisories unchanged.

## 8. Next batch

**IPC-SEARCH-01** — `src/main/handlers/search.ts` is one module covering
`search:*`, `knowledge:*` and `links:*` (13 handlers, 5 of them in the §4 list:
`search:query`, `search:symbols`, `knowledge:read`, `knowledge:search`,
`links:resolve`). Reading the user's notes is a privacy path, so this is the next
highest-value module. Same shape: RED, guard, inventory, mutation, gates.
