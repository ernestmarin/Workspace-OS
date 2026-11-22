# IPC-DOC-WRITE-02 checkpoint — the same guard for the five docx/pptx writers · 2026-11-21

**Batch:** IPC-DOC-WRITE-02 (P0 data loss, closes `DATA-04`). Five writers, one
primitive, one mechanical invariant.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/f72b6745-workspace-os` / `19441e0`.

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **DOC-WRITE-05** | Reproduced defect (silent data loss) | Confirmed | The five docx/pptx writers (`docx-cards`, `docx-cc`, `docx-table`, `pptx-shape`, `pptx-table`) replace documents with the same read → edit → verify-temp → `rename` sequence the XLSX writers had, so they had the same blind spot: a save by Excel/LibreOffice/a sync client between the read and the rename was destroyed and reported as `{ ok: true }`. |
| **DOC-WRITE-06** | Structural cause | Confirmed | The guard from IPC-DOC-WRITE-01 was written **inline in each writer**. Copying it five more times would guarantee the next writer forgets it — the same class of mistake this whole series exists to remove. The check had to become a primitive: one function, and a mechanical test that every writer goes through it. |
| **DOC-WRITE-07** | Two-lookup bug, avoided | Confirmed | These writers did `statSync(path)` for the "missing / not-a-file" reason and then `readFileSync(path)` for the bytes — two lookups of one name. A replacement between them would give the identity of one file and the bytes of another, i.e. a guard that compares the wrong thing. `readWithIdentity` opens once and `fstat`s that descriptor. |

## 2. Change

| File | Change |
| --- | --- |
| `src/main/doc-identity.ts` | `readWithIdentity(path, maxBytes)` — bytes + identity from one descriptor, bounded, refusing a file that grew while being read; `commitTemp(tmp, filePath, identity)` — the single place a document is replaced: refuses on change (removing the temp file), reports `write-failed` if the rename fails, never throws. |
| `src/main/xlsx-cell-writer.ts`, `src/main/xlsx-range-writer.ts` | their inline check + `renameSync` replaced by `commitTemp`, so there is exactly one implementation of the guard. Behaviour identical; the IPC-DOC-WRITE-01 suites still pass unchanged. |
| `src/main/docx-cards-writer.ts`, `docx-cc-writer.ts`, `docx-table-writer.ts`, `pptx-shape-writer.ts`, `pptx-table-writer.ts` | bytes and identity from `readWithIdentity`; the verified temp file goes into place through `commitTemp`. |
| `src/main/xlsx-write-conflict.test.ts` | **rewritten with a real seam**, no stubbed detector: the identity is captured synchronously before the writer's first `await`, so starting the write and immediately replacing the file reproduces "another application saved". |
| `src/main/docx-write-conflict.test.ts` | **new**: the same real seam against `setDocCards` — refusal with the file byte-identical, no temp leftover, and the quiet path still writing. |
| `src/main/doc-identity.test.ts` | **+8 tests**: `readWithIdentity` (bytes+identity, missing, folder, over the bound) and `commitTemp` (renames when unchanged, refuses and cleans up when changed, `write-failed` when the rename cannot happen). |
| `src/main/doc-write-wiring.test.ts` | **new**: every one of the seven writers contains `commitTemp(` and **no** `fs.renameSync(`; the five docx/pptx ones use `readWithIdentity(`; the primitive itself still contains the check. A future writer that renames directly fails here. |

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … xlsx-write-conflict` against the first version of the guard (detector stubbed) | refactor | 1 | **2 failed** — `commitTemp` calls the module-internal `changedSince`, which a module mock cannot reach. The stubbed-detector design stopped being valid; hence the real seam in S2 |
| S2 | rewritten with the real seam | final | 0 | 4/4 — refusal, refusal on range, no temp, and the quiet path |
| S3 | `vitest run … docx-write-conflict` | final | 0 | 3/3 — a real `.docx` refused byte-identical, no temp, quiet path writes |
| S4 | `vitest run … doc-identity + docx-write-conflict + doc-write-wiring + xlsx-write-conflict` | final | 0 | **27/27** |
| S5 | the nine writer suites + `ooxml-writers-shape` + `docx-shape` | final | 0 | 109/111 → after the rewrite of S1/S2, all green (see S9 for the whole-suite number) |
| S6 | mutation M56 (`docx-cards-writer`: `renameSync` instead of `commitTemp`) | mutated | 1 | 2 failures — the docx conflict test and the wiring invariant |
| S7 | mutation M57 (`commitTemp`: `if (false)`) | mutated | 1 | **5 failures** — three `commitTemp` tests, the docx refusal, the xlsx refusal |
| S8 | mutation M58 (`pptx-table-writer`: bypass `commitTemp`) | mutated | 1 | 1 failure — the wiring invariant catches a writer with no behavioural test |
| S9 | `tsc --noEmit` (node + renderer), full suite, ESLint, build | final | 0 | see `docs/HANDOFF.md` (Vigente) |

## 4. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| A docx replaced under the writer is not overwritten | NIVEL 2 | NIVEL 2 — `changed-on-disk`, bytes identical, inode unchanged | **APROBADO** |
| The same for xlsx (regression of IPC-DOC-WRITE-01 after the refactor) | NIVEL 2 | NIVEL 2 — the rewritten suite drives the real guard | **APROBADO** |
| No writer can bypass the primitive | NIVEL 2 | NIVEL 2 — mechanical invariant over the seven files; M58 proves it fails when one bypasses | **APROBADO** |
| The quiet path still writes | NIVEL 2 | NIVEL 2 — asserted for xlsx and docx; the other six suites unchanged | **APROBADO** |
| A real office application racing the writer | NIVEL 3 | none — no real Excel/LibreOffice; the race is real in ordering but simulated in the actor | **NO_EJECUTADO** |

## 5. Red / Blue review (self-review, not independent)

**Red:**
1. *"A source-grep test is not a behaviour test."* Correct, and it is not claimed
   as one: behaviour is proven for the xlsx pair and one docx writer with the real
   seam; the invariant exists for the five whose fixtures are expensive and for
   the writer somebody adds next. M58 shows it fails on a bypass that no
   behavioural test covers.
2. *"`readWithIdentity` re-implements a bounded read that `loadValidatedXlsx`
   already had."* They ask different things: the xlsx one validates ZIP shape and
   budgets, this one only reads bytes + identity. Both are bounded at 64 MiB, and
   the duplication is a hundred lines of `open/read` glue, recorded rather than
   abstracted into a third layer.
3. *"The identity is still checked at one instant."* Yes — the same honest limit
   as IPC-DOC-WRITE-01, documented in the primitive.
4. *"Why not lock the file?"* There is no portable lock that Word and LibreOffice
   respect; a lock file of our own would protect us from ourselves and nobody
   else.

**Blue:** RED is the five writers losing a concurrent save; M56/M57/M58 split the
writer wiring, the primitive's check, and a writer with no behavioural test;
S1 records an approach that did not work (stubbing the detector after the guard
became a primitive) instead of quietly deleting the test.

## 6. Residual risk

- Same check-to-rename window as IPC-DOC-WRITE-01: narrowed, not closed.
- The docx/pptx fixtures in the conflict test are synthetic packages; a real
  Word-produced document with the same anchors is not exercised (NIVEL 3).
- `pptx-shape` and `pptx-table` have wiring coverage only — the cards writer
  stands in behaviourally for the family, and that is stated rather than implied.
- `search/extract.ts` also reads ZIPs but never replaces them: out of scope.

## 7. Next batch

`DATA-04` is closed. Remaining backlog: **WORKSPACE-03** (a capability decision
that needs an explicit call), **SEARCH-02** (lazy DB open), the ZIP-index
ordering item, and the lifecycle items (`WATCH-02`, `OFFICE-02`).
