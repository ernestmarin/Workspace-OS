# IPC-FS-01 checkpoint — the workspace filesystem surface verifies the caller · 2026-11-21

**Batch:** IPC-FS-01 (P0, IPC authorization). One module: `src/main/handlers/fs.ts`.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). No Electron, no GUI, no device.
**Publication:** none. Commit is local.
**Branch / base:** `arena/d78637b6-workspace-os` / `bc643c4` + VOX-A2b commit.

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-FS-01** | Reproduced defect (control failure) | Confirmed | All eight handlers on the workspace filesystem surface took `_event` and **never looked at it**. `sanitize()` / `validateFilePath()` confine a *path* to the workspace root; they say nothing about *who* is asking. Any renderer able to reach the preload bridge — a stale top-level frame after navigation, a child/detached frame, or a webContents that is not the registered owner — could read, overwrite, rename, create or delete files inside the user's workspace. |

Impact is data integrity (overwrite/delete/rename) plus privacy (read/list). Both
directions matter: a read escape is not less serious than a write one.

**Why the inventory missed it.** `ipc-authorization.test.ts` decides "has a
guard" by substring over the handler snippet, and `sanitize(` is one of the
accepted substrings. So these channels were counted as guarded — the heuristic
conflates *confinement* with *authorization*. `fs:list-files` was the only member
of the family in `EXPLICITLY_NO_GUARD`, and only by accident of which helper it
called.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/fs.ts` | `assertMainWindowFrame(event)` first in all eight handlers (`fs:read-dir`, `fs:list-files`, `fs:read-file`, `fs:read-file-bytes`, `fs:write-file`, `fs:delete`, `fs:rename`, `fs:create`); `_event` → `event`. Called by its real name, not a local alias, so the structural inventory recognises the guard. |
| `src/main/ipc-authorization.test.ts` | `fs:list-files` moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; **new invariant** `MUST_HAVE_ORIGIN_GUARD` (the 8 channels) with a dedicated test that fails with `"<channel> (file) confina la ruta pero no verifica el emisor"`. |
| `src/main/handlers/fs.authorization.test.ts` | **new**: 33 tests — 4 mutating and 4 reading channels × {missing frame, child frame, stale top-level frame, foreign window}, each rejection followed by proof the workspace and the recovery store are untouched, plus one end-to-end legitimate control per surface. |
| `src/main/handlers/fs.security.test.ts` | Harness updated from a bare `{ senderFrame: { parent: null } }` — the exact shape that must now be refused — to a registered main window, with **one test added** that the old shape is rejected and the file survives. No assertion was removed, relaxed or skipped. |

This uses the guard `trash.ts` already applied after IPC-TRASH-01
(`assertMainWindowFrame`): the live **registered** owner and its **current** main
frame, not `mainWindow()`'s best-effort delivery fallback.

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| F1 | `vitest run … src/main/handlers/fs.authorization.test.ts` | pre-fix | 1 | **RED**: 32 failed / 1 passed — every unauthorized invocation **succeeded** and mutated the workspace (`promise resolved "undefined" instead of rejecting`) |
| F2 | same, after the guard | fix | 0 | **GREEN**: 33/33 |
| F3 | mutation: guard removed from `fs:write-file` / `fs:list-files` / `fs:delete`, restored in `finally` | mutated | 1 ×3 | each detected (4, 4 and 4 failures respectively); 8 guards restored |
| F4 | mutation: guard removed from `fs:list-files` against the inventory test | mutated | 1 | `sensibles sin guard: fs:list-files (src/main/handlers/fs.ts)` |
| F5 | mutation: guard removed from `fs:write-file` (which still calls `sanitize`) against the inventory test | mutated | 1 | new invariant fires: `fs:write-file … confina la ruta pero no verifica el emisor` |
| F6 | `vitest run … fs.security.test.ts fs.authorization.test.ts ipc-authorization.test.ts ipc-surface.test.ts trash.authorization.test.ts` | final | 0 | 57 + 38 tests pass |
| F7 | `tsc --noEmit -p tsconfig.node.json` / `-p src/renderer/tsconfig.json` | final | 0 / 0 | no diagnostics |
| F8 | `eslint … src --format json` (raised stack, see VOX-A2b §4 E8) | final | 0 | 1002 files, **0 errors, 0 warnings** |
| F9 | `vitest run --config config/vitest.config.ts --maxWorkers=2` (full) | final | 0 | **353 files pass + 3 skipped; 4212 tests pass + 26 skipped; 0 failed** |
| F10 | `npm run build` | final | 0 | no `INEFFECTIVE_DYNAMIC_IMPORT`; regenerated `resources/wos-*/**.cjs` restored |
| F11 | `npm audit --omit=dev --json` / `npm audit --json` | final | 1 / 1 | **35 / 40 moderate, 0 high, 0 critical** — unchanged |

**Delta:** +1 test file, +35 tests over the VOX-A2b checkpoint (4177 → 4212):
33 new authorization tests, 1 added SEC-07 test, 1 inventory invariant.

**Regression found and fixed inside the batch:** the first full-suite run failed
in `fs.security.test.ts` (3 tests) because that fixture passed
`{ senderFrame: { parent: null } }` — an unregistered top-level frame — as an
authorized caller. The resolution was **not** to weaken the guard or the
assertions: the fixture now registers an owner, and a new test pins that the old
shape is refused. Recorded here because it is evidence of the defect, not an
inconvenience to be smoothed over.

## 4. Inventory after this batch

Measured from source, not carried over: **473 declared channels = 252
`MUST_HAVE_GUARD` + 169 `EXPLICITLY_NO_GUARD` + 22 `GRANT_CHECKED` + 30
`PUSH_CHANNELS`**, plus the new **8 `MUST_HAVE_ORIGIN_GUARD`** (a subset of
`MUST_HAVE_GUARD`).

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| Eight fs handlers refuse non-owner callers before touching the fs | NIVEL 2 | NIVEL 2 — real handlers, real temp workspace, real recovery store, simulated Electron window | **APROBADO** |
| Legitimate surface still works after the owner is replaced | NIVEL 2 | NIVEL 2 (create/rename/write/snapshot/delete/restore/read/list) | **APROBADO** |
| The fix cannot silently regress | — | enforced by `MUST_HAVE_ORIGIN_GUARD` (F5) | **APROBADO** |
| Real Electron renderer / GUI acceptance | NIVEL 3 | none | **NO_EJECUTADO** |

Compliance: **cumple** for `fs.ts`; Coverage: **parcial** (see §6); Acceptance:
**aceptado** at NIVEL 2.

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"The guard is in the wrong place — after `sanitize`, a traversal attempt would report the wrong error."* Rejected: the guard is the first statement, and the tests use in-workspace paths so path validation cannot mask the refusal.
2. *"This breaks a legitimate second window."* Checked: only `src/main/index.ts:106` attaches the preload, and `setMainWindow` is called for that window; there is no second renderer with the bridge. The end-to-end control re-registers a *replacement* owner and exercises all eight channels.
3. *"Refusal could still leave a trash snapshot behind."* Asserted explicitly (`trash.list()` empty after each of the 16 mutating refusals).
4. *"The invariant only covers these 8."* True and now stated: **15 `MUST_HAVE_GUARD` channels still have no origin guard** by the same heuristic — `canvas:export-pptx`, `collection:refreshForFile`, `components:save`, `drive:save`, `fs:save-copy-dialog` (in `watcher.ts`), `knowledge:read`, `knowledge:search`, `links:resolve`, `metric:refreshForFile`, `office:export-pdf`, `office:print`, `office:to-pdf`, `search:query`, `search:symbols`, `wiki:add`. **Method caveat:** that list comes from the repository's own snippet heuristic (`assertMainWindowFrame|assertMainFrame(|assertLokSender|assertUpdaterSender|assertOwner(`), not from manual review of each handler; every entry needs per-module triage before being called a defect.
5. *"`GRANT_CHECKED` channels take no event, so what guarantees them?"* The `WORKSPACE_DATA_OPERATIONS` bridge with its grant — unchanged by this batch, not re-audited here.

**Blue:** the RED suite failed for the invariant (unauthorized calls succeeded and
mutated data) and turned green only with the guard; mutations F3–F5 show each
protection is load-bearing; no adjacent contract changed; full suite, both
typechecks, build and audits match the prior checkpoint apart from the intended
delta.

## 7. Residual risk

- 15 channels listed in §6 Red 4 need module-sized triage; `watcher.ts` is the
  natural next batch (it owns `fs:save-copy-dialog`, a write outside the
  workspace that also ignores its event).
- The structural inventory still accepts confinement as a guard for channels not
  in `MUST_HAVE_ORIGIN_GUARD`; the set is the enforcement mechanism, so it must
  grow with each module.
- No Electron/renderer acceptance: the guard is proven against the real guard
  implementation and simulated frames, not Chromium.
- Main-frame identity is only as strong as `setMainWindow` registration; a future
  second bridged window must be given its own authorization story, not this one.
- Dependency advisories unchanged (35/40 moderate).

## 8. Next batch

**IPC-WATCH-01**: `src/main/handlers/watcher.ts` (8 handlers + `fs:save-copy-dialog`),
same shape as this batch — RED suite over unauthorized callers, `assertMainWindowFrame`,
mutation, and an inventory move through `MUST_HAVE_ORIGIN_GUARD`. Then continue
module-by-module down the §6 Red 4 list, one module per commit, triaging before
guarding (a handler that reads no path and writes nothing may legitimately stay
unguarded — with a written reason).
