# IPC-OFFICE-01 checkpoint — the file-producing surface verifies the caller · 2026-11-21

**Batch:** IPC-OFFICE-01 (P0, IPC authorization). Two modules: `src/main/handlers/office.ts` (4 handlers) and `canvas:export-pptx` in `src/main/handlers/canvas.ts`.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/e28c7316-workspace-os` / `18823f7` (merge of PR #19).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-OFFICE-01** | Reproduced defect (control failure) | Confirmed | The four `office:*` handlers and `canvas:export-pptx` never looked at the event. They are the highest-consequence channels left: `office:print` runs LibreOffice over a workspace file, writes the PDF to a temp dir and **hands it to `shell.openPath`** (the OS default viewer launches a program); `office:to-pdf` converts and populates a disk cache; `office:export-pdf` opens a native save dialog and **writes to a destination the caller chooses outside the workspace**; `canvas:export-pptx` builds a deck and writes it into the workspace. A foreign frame could make the machine convert, write and launch. |
| **OFFICE-02** | Unconfirmed risk (inventoried, not fixed) | Hypothesis | `registerOfficeHandlers(ipcMain, win)` captures the window that registered it and parents `office:export-pdf`'s save dialog to that window forever — the same lifecycle concern as `WATCH-02`. Not reproduced; a destroyed parent would misplace the dialog, not widen authorization. |

Severity: external program execution (`shell.openPath`) plus writes chosen by the
caller. This is the group where "validation" was most easily mistaken for a
control, because every handler does call `validateFilePath` — on the *path*.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/office.ts` | `assertMainWindowFrame(event)` first in all four handlers; module doc comment distinguishes path validation from caller identity. `office:available` now has an event parameter. |
| `src/main/handlers/canvas.ts` | same guard in `canvas:export-pptx`, above the payload checks. |
| `src/main/ipc-authorization.test.ts` | `office:available` moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **32** channels. |
| `src/main/handlers/office.authorization.test.ts` | **new**: 23 tests — 5 channels × 4 unauthorized callers, plus the legitimate surface, a cancelled-save case, and the surviving path/payload validation. |

**Why only `office:available` needed reclassification.** The other four channels
already sat in `MUST_HAVE_GUARD` because their bodies call `validateFilePath`
directly and the inventory's snippet heuristic counts that. That is precisely the
misreading this batch corrects: being listed as "guarded" because a path check is
present is not the same as verifying the caller, which is what the new origin set
records.

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| O1 | `vitest run … office.authorization.test.ts` | pre-fix | 1 | **RED**: **20 failed / 3 passed** — every unauthorized call converted the document, opened the viewer, wrote the export or wrote the deck |
| O2 | same | fix | 0 | **GREEN**: 23/23 |
| O3 | mutation M15 (`office:print` guard removed) | mutated | 1 | 4 failures |
| O4 | mutation M16 (`canvas:export-pptx` guard removed) | mutated | 1 | 8 failures |
| O5 | inventory edit attempt with duplicated entries | mutated | 1 | the duplicate invariant from IPC-SEARCH-01 fired on my own edit (`office:available`, `office:export-pdf`, `office:print`, `office:to-pdf`, `canvas:export-pptx`) before it could reach a commit — the control earned its place in one batch |
| O6 | `vitest run … office.authorization + ipc-authorization` | final | 0 | 32 tests pass |
| O7 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| O8 | `eslint -c config/eslint.config.mjs` (changed files) | final | 0 | clean |
| O9 | `vitest run --config config/vitest.config.ts --maxWorkers=2` (full) | final | 0 | **356 files pass + 3 skipped; 4325 tests pass + 26 skipped; 0 failed** (+23) |
| O10 | `npm run build` | final | 0 | regenerated `resources/wos-*/**.cjs` restored |

## 4. Inventory after this batch (measured, all sets unique)

**473 declared = 268 `MUST_HAVE_GUARD` + 153 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **32**.

Origin-guard coverage: **263 of 268**. **Five remain path-only** — the end of the
list is in sight:

`collection:refreshForFile`, `components:save`, `drive:save`,
`metric:refreshForFile`, `wiki:add`.

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| Five handlers refuse non-owner callers | NIVEL 2 | NIVEL 2 — real handlers, real temp workspace and cache, real atomic write; LibreOffice and the deck builder mocked at the boundary | **APROBADO** |
| No conversion/launch/write on refusal | NIVEL 2 | NIVEL 2 (call log empty, `userData` empty, export and deck absent) | **APROBADO** |
| Legitimate surface intact after owner replacement | NIVEL 2 | NIVEL 2 (availability, conversion + cache hit, print via `openPath`, export to the chosen path, deck written with no temp left behind) | **APROBADO** |
| Regression cannot be silent | — | 32-channel origin set + duplicate invariant | **APROBADO** |
| Real LibreOffice / real OS viewer | NIVEL 3 | none — `convertTo` and `openPath` are mocks | **NO_EJECUTADO** |

Compliance: **cumple** for these modules. Coverage: **parcial** (5 channels +
OFFICE-02). Acceptance: **aceptado** at NIVEL 2.

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"`validateFilePath` already stops anything dangerous, so a guard adds nothing."* It stops a path outside the root; it does not stop a foreign frame from converting an in-root document, opening the OS viewer, or saving a PDF wherever the dialog allows. The RED run did all four.
2. *"`office:print` only opens a viewer — that is not execution."* `shell.openPath` delegates to the OS, which launches whatever is registered; and the temp file is produced by a real conversion first. Two side effects, both triggered.
3. *"Mocking LibreOffice hides conversion failures."* The claim is authorization. The legitimate control also exercises the cache path and the atomic write with real `fs`, so the wiring is proven beyond the mock.
4. *"`office:available` is a harmless boolean."* It is — and it is still an unauthenticated probe of the machine's tooling. Guarding it costs one line and removes an inconsistency a reader would trust.

**Blue:** RED failed exactly on the authorization claim; M15/M16 show each guard
is load-bearing; the duplicate invariant (O5) caught a real editing error within
one batch of being introduced; the legitimate control keeps cache, export and
atomic-write behaviour honest.

## 7. Residual risk

- Five path-only channels (§4) and `OFFICE-02` (§1).
- The print/export paths are exercised against mocks, not a real LibreOffice
  install or a real OS viewer: NIVEL 3 stays `NO_EJECUTADO`.
- The save dialog parents to the registering window (OFFICE-02), unchanged.

## 8. Next batch

The five remaining path-only channels, as one small module per commit:
`drive:save`, `components:save`, `wiki:add`, `metric:refreshForFile`,
`collection:refreshForFile`. When they are done, `MUST_HAVE_ORIGIN_GUARD` will
cover the whole sensitive set and the residual list becomes empty for the first
time; that is the moment to re-derive the inventory from source and confirm
nothing new appeared.
