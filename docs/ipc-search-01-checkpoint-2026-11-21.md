# IPC-SEARCH-01 checkpoint — the note-reading surface verifies the caller · 2026-11-21

**Batch:** IPC-SEARCH-01 (P0, IPC authorization). One module: `src/main/handlers/search.ts` (13 handlers).
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/e28c7316-workspace-os` / `92f6bf0` (IPC-WATCH-01).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-SEARCH-01** | Reproduced defect (control failure) | Confirmed | None of the thirteen handlers in `search.ts` looked at the event. The module is the read side of the user's own notes: ranked content search (`search:query`), symbol search (`search:symbols`), **extracted text of office/PDF documents** (`knowledge:read`), knowledge search (`knowledge:search`), every backlink/outgoing link/related note, the whole `[[wikilink]]` graph, and link resolution. A stale, child or foreign frame could read the notes of the open workspace. Input validation existed and still works — but it answers *what* is asked, never *who* asks. |
| **SEARCH-02** | Unconfirmed risk (inventoried, not fixed) | Hypothesis | `ensureIndex()` opens `userData/search-index.db` lazily on the **first** call, including pure reads like `search:index-status` and `links:graph`. Harmless today (the guard now runs first), but it means an unauthenticated path to a database open would have existed through any channel that only "reports status". Kept as a note: the guard, not the lazy open, is the control. |

Severity: note content — including text extracted from documents the agent itself
cannot open — is the most direct privacy exposure in the IPC surface.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/search.ts` | `assertMainWindowFrame(event)` first in all thirteen handlers (`_event` → `event`); module doc comment states why (validation ≠ authorization). |
| `src/main/ipc-authorization.test.ts` | Eight channels moved from `EXPLICITLY_NO_GUARD` into `MUST_HAVE_GUARD` (`search:index-status`, `search:prioritize`, `search:start`, `links:backlinks`, `links:graph`, `links:outgoing`, `links:related`, `links:stubs`); `MUST_HAVE_ORIGIN_GUARD` extended to **27** channels (all thirteen of this module); **new invariant**: no category may list the same channel twice. |
| `src/main/handlers/links.test.ts` | **fixture change forced by the guard**: its `invoke()` passed `{}` as the event, so nine coercion tests were reading as "validation" while actually being refused. `invoke()` now speaks as the registered owner (`ownerEvent()`), a raw `invokeAs(event, …)` was added, and one test **pins the refusal** of an empty event. |
| `src/main/handlers/search.authorization.test.ts` | **new**: 54 tests — 13 channels × 4 unauthorized callers, each proving the index was never reached and nothing was written to `userData`, plus a legitimate control that answers every channel after the owner is replaced, plus the surviving input validation. |

**Why the eight channels were under-classified.** The inventory's snippet
heuristic looks for `validateFilePath` inside the handler body; `links:backlinks`,
`links:outgoing` and `links:related` call the local `requireWorkspacePath()`
wrapper, which contains it. This is the heuristic's known blind spot, not a
change in the code's behaviour, and it is why the per-module tests — not the
inventory — are the real evidence.

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … search.authorization.test.ts` | pre-fix | 1 | **RED**: **52 failed / 2 passed** — every unauthorized call **succeeded**, returning note paths and extracted note text |
| S2 | same | fix | 0 | **GREEN**: 54/54 |
| S3 | mutation M13 (`knowledge:read` guard removed) | mutated | 1 | 4 failures (one per unauthorized caller) |
| S4 | mutation M14 (`search:start` guard removed) | mutated | 1 | 4 failures |
| S5 | mutation M12 (duplicate `'fs:create'` entry in `MUST_HAVE_GUARD`) | mutated | 1 | new duplicate invariant fires: `MUST_HAVE_GUARD repite: fs:create` |
| S6 | `vitest run … search.authorization + ipc-authorization + ipc-surface` | final | 0 | 70 tests pass |
| S7 | `tsc --noEmit -p tsconfig.node.json` / `-p src/renderer/tsconfig.json` | final | 0 / 0 | no diagnostics |
| S8 | `eslint -c config/eslint.config.mjs src --format json` | final | 0 | **1004 files, 0 errors, 0 warnings** |
| S9 | `vitest run --config config/vitest.config.ts --maxWorkers=2` (full) | first attempt | **1** | **4 failed**, all in `src/main/handlers/links.test.ts`: the guard refused its `{}` event (see S9b) |
| S9b | same, after the fixture change | final | 0 | **355 files pass + 3 skipped; 4302 tests pass + 26 skipped; 0 failed** |
| S10 | `npm run build` | final | 0 | regenerated `resources/wos-*/**.cjs` restored |
| S11 | `npm audit --omit=dev --json` / `npm audit --json` | final | 1 / 1 | **35 / 40 moderate** — unchanged |

## 4. Inventory after this batch (measured from source, all sets unique)

**473 declared = 267 `MUST_HAVE_GUARD` + 154 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **27**.

Origin-guard coverage of the sensitive set: **258 of 267**. **Nine remain
path-only:**

`canvas:export-pptx`, `collection:refreshForFile`, `components:save`,
`drive:save`, `metric:refreshForFile`, `office:export-pdf`, `office:print`,
`office:to-pdf`, `wiki:add`.

**Bookkeeping error caught during this batch (recorded, not hidden):** the first
edit inserted the thirteen origin-set entries into `MUST_HAVE_GUARD` instead of
`MUST_HAVE_ORIGIN_GUARD`, and the earlier batch had left `fs:open-folder-dialog`
and `fs:reveal` listed twice. No test failed: a `Set` hides its own duplicates
and the origin invariant was still satisfied by the entries that were there. The
error was found by measuring the sets against `473` and by counting literals, not
by the suite — which is why the duplicate invariant (S5) now exists.

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| Thirteen handlers refuse non-owner callers | NIVEL 2 | NIVEL 2 — real handlers, real temp workspace file, real guard and real scoping; SQLite/indexer mocked at the boundary | **APROBADO** |
| Legitimate surface intact after owner replacement | NIVEL 2 | NIVEL 2 (all 13 channels answer; `search:start` starts on the root; `knowledge:read` returns real extracted text) | **APROBADO** |
| Out-of-workspace paths still refused independently of the guard | NIVEL 2 | NIVEL 2 (`search:prioritize` outside root dropped; traversal in `links:*` / `knowledge:read` throws) | **APROBADO** |
| Regression cannot be silent | — | `MUST_HAVE_ORIGIN_GUARD` = 27 + duplicate invariant | **APROBADO** |
| Real SQLite index / real Electron | NIVEL 3 | none | **NO_EJECUTADO** |

Compliance: **cumple** for this module. Coverage: **parcial** (9 channels +
SEARCH-02). Acceptance: **aceptado** at NIVEL 2.

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"Search results were already scoped to the open workspace, so there was no exposure."* Scoping cuts results down to a root; it does not require a root to exist, and `links:graph` / `search:index-status` / `search:start` had no scoping at all. The RED run returned real paths and text to a foreign frame.
2. *"`knowledge:read` already validated the path."* It did — and it read a workspace file for a foreign frame. Authorization and path validation are different questions; the control test keeps both.
3. *"Mocking SQLite means the test proves nothing about the real index."* The claim is about who reaches the index; the mock records that it was *not* reached (counter assertions and an empty `userData`), and the legitimate control proves the wiring still produces answers end to end.
4. *"`search:start` has no data to leak."* It starts a full scan of the workspace on demand and opens the database; an unauthorized caller could trigger both. M14 shows the guard is what stops it.

5. *"The full suite will confirm nothing else depended on the old behaviour."* It did the opposite: `links.test.ts` was green only because its fabricated event used to be accepted. The fixture was corrected and the refusal pinned (S9/S9b) — the guard was not weakened and no assertion was relaxed.

**Blue:** RED failed exactly on the authorization claim and turned green only with
the guard; M13/M14 show one guard per handler is load-bearing (4 failures each);
M12 shows the new inventory invariant works; adjacent suites (surface, inventory)
stay green; the delta is the 54 new tests plus 1 inventory test.

## 7. Residual risk

- Nine path-only channels (§4) and `SEARCH-02` (§1).
- Any other test that fabricates an IPC event will now be refused; the full
  suite is the detector for that, so it must stay part of the gate.
- The index mock means no evidence about FTS ranking or extraction under adversarial input — out of scope here.
- The guard scheme remains single-window: `setMainWindow` is the only source of truth.
- Dependency advisories unchanged.

## 8. Next batch

**IPC-OFFICE-01** — `office:*` (`office:export-pdf`, `office:print`, `office:to-pdf`)
plus `canvas:export-pptx`: these write files and drive external programs, so they
are the highest-consequence group left in §4. Alternative, if the goal is to
finish the read side first: `drive:save`, `components:save`, `wiki:add`,
`metric:refreshForFile`, `collection:refreshForFile` are each small and can be
done one module per commit.
