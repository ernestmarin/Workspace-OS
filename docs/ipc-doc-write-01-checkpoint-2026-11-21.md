# IPC-DOC-WRITE-01 checkpoint — a save no longer overwrites a file that changed under it · 2026-11-21

**Batch:** IPC-DOC-WRITE-01 (P0 data loss, "the app ate my edit" class). Two
writers, one new module, one snapshot contract change.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/f72b6745-workspace-os` / `19441e0` (merge de PR #22).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **DOC-WRITE-01** | Reproduced defect (silent data loss) | Confirmed | The engine-free `.xlsx` writers (`setCellValue`, `setRangeValues`) read the whole workbook, edit it in memory, write a verified temp file and `rename` it over the original. That sequence is crash-safe and **write-conflict-blind**: anything that saved to the same path between our read and our rename — Excel, LibreOffice, a sync client, another window — was replaced by our stale copy, and the call reported `{ ok: true }`. The identity of the file we read was never compared with the file we were about to destroy. |
| **DOC-WRITE-02** | Design constraint | Confirmed | The check has to be the **identity**, not the content: comparing bytes would mean a second full read per save (the files reach 64 MiB) and would still be wrong for a file replaced by a same-size, same-mtime copy. Device + inode (a replace-by-rename changes the inode) plus size + mtime (an in-place save keeps it) cover both shapes with one `stat`. |
| **DOC-WRITE-03** | Honest limit | Confirmed | This narrows the window to the microseconds between the check and the rename; it cannot close it portably. Stated rather than papered over. |
| **DOC-WRITE-04** | Coverage gap, recorded | Confirmed | The same read → rename shape is shared by the five docx/pptx writers (`docx-cards-writer`, `docx-table-writer`, `docx-cc-writer`, `pptx-shape-writer`, `pptx-table-writer`), which read through `loadArchive` (JSZip) and therefore have no identity to compare yet. They are the immediate follow-on batch; the helper in this one is what they need. |

## 2. Change

| File | Change |
| --- | --- |
| `src/main/doc-identity.ts` | **new**: `FileIdentity {dev, ino, size, mtimeMs}`, `fileIdentity()` (regular files only), `sameIdentity()`, `changedSince()` — a vanished file counts as changed, because re-creating a file somebody else removed is a guess dressed as a save. |
| `src/main/docx-zip.ts` | `loadValidatedXlsx` now returns the `identity` taken from the **descriptor that read the bytes** (`fstat`), not from a later `stat` of the path: the identity belongs to the exact bytes that were validated. |
| `src/main/xlsx-cell-writer.ts`, `src/main/xlsx-range-writer.ts` | immediately before `renameSync`, `changedSince(snapshot.identity, filePath)` → remove the temp file and return `skip('changed-on-disk')`. The original is never touched. |
| `src/main/doc-identity.test.ts` | **new**: 6 real-filesystem tests — stable identity, size change, same-size edit (mtime), replace-by-rename with identical size and mtime (**inode**), vanished file, non-files. |
| `src/main/xlsx-write-conflict.test.ts` | **new**: 3 tests with the detector forced to "changed" — both writers refuse with the reason, the file keeps its bytes **and its inode**, and no temp file is left behind. |
| `src/main/ooxml-writers-shape.test.ts` | **one expectation tightened, deliberately**: see §5. |

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … xlsx-cell-writer + xlsx-range-writer + docx-zip` (before the guard) | pre-fix | 0 | green — **and that is the finding**: no suite exercised a file that changed under the writer, so the defect was invisible to the whole suite |
| S2 | `vitest run … xlsx-cell-writer + xlsx-range-writer + docx-zip + ooxml-writers-shape`, after the guard | fix | 1 | **2 failures, and they are the finding**: `ooxml-writers-shape` asserted `{ ok: true }` for "pathname is replaced" — the old suite *encoded* the overwrite as correct |
| S3 | after tightening that expectation (§5) | fix | 0 | GREEN 44/44 across the four files |
| S4 | `vitest run … xlsx-write-conflict + xlsx-cell-writer + xlsx-range-writer` | fix | 0 | 14/14 |
| S5 | mutation M54 (delete the identity check from `xlsx-cell-writer`) | mutated | 1 | 1 failure — the cell-writer refusal |
| S6 | mutation M54 (same, `xlsx-range-writer`) | mutated | 1 | 1 failure — the range-writer refusal |
| S7 | mutation M55 (`changedSince` always `false`) | mutated | 1 | **4 failures in `doc-identity.test.ts`** — the detector half is covered separately, which is why the guard tests could mock it |
| S8 | `tsc --noEmit` (node + renderer) | final | 0 | no diagnostics |
| S9 | full suite + ESLint + build | final | 0 | see `docs/HANDOFF.md` (Vigente) |

## 4. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| A changed file is not replaced | NIVEL 2 | NIVEL 2 — bytes and inode identical after the refusal; `changed-on-disk` reported | **APROBADO** |
| The temp file is cleaned up on refusal | NIVEL 2 | NIVEL 2 — no `*.tmp` in the folder | **APROBADO** |
| The detector sees size, mtime and replace-by-rename | NIVEL 2 | NIVEL 2 — four real-file cases, one per signal | **APROBADO** |
| A quiet file still saves exactly as before | NIVEL 2 | NIVEL 2 — the existing writer suites (47 tests across the family) unchanged and green | **APROBADO** |
| A real Excel/LibreOffice save racing the writer | NIVEL 3 | none — no real office application; the race is simulated at the detector boundary | **NO_EJECUTADO** |

## 5. The expectation that was tightened (and why it is not a weakened guard)

`ooxml-writers-shape.test.ts` contained, per XLSX writer:

> *"parses validated snapshot when pathname is replaced"* → `expect(write(file)).toEqual({ ok: true })`

Its purpose was N+2c: prove the writer parses the **validated snapshot** and
never re-reads the path (so a TOCTOU cannot feed unvalidated XML to exceljs).
The *mechanism* it asserted — replace the file under the writer, still write —
is precisely the defect found here: overwriting whatever is now at that path.

It now asserts `{ ok: false, reason: 'changed-on-disk' }`, and the original
property comes out **stronger**: reaching the identity check proves the workbook
was parsed from the validated buffer, because a re-read of the path would have
failed earlier with `not-valid-xlsx` (the replacement is not a ZIP). The test also
asserts the replacement is still on disk byte for byte.

No guard was loosened to make a test pass; a test that blessed the overwrite was
corrected, and the section is here so the change is reviewable rather than
invisible.

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"This is a TOCTOU check; the race is still there."* Yes, microseconds wide
   instead of an exceljs round-trip wide. A lock that Excel respects does not
   exist portably; refusing on any change is the conservative half.
2. *"Why not compare the file's hash?"* A second full read of up to 64 MiB per
   save, and identical bytes in a *new* inode would still be a different file we
   no longer own. Identity answers the question the write asks; content does not.
3. *"mtime granularity can be 1 s on some filesystems."* That is why inode and
   size are in the tuple: a coarse mtime cannot hide a rename, and an in-place
   edit almost always changes the size. Recorded, not solved.
4. *"Refusing annoys the user mid-flow."* It reports a reason and leaves their
   file alone; re-running the operation after the other editor is done is one
   click. Silent loss is not recoverable.
5. *"Five more writers still have the window."* True, and recorded as
   DOC-WRITE-04 rather than fixed blind: they read through JSZip and need the
   identity plumbed through `loadArchive` first.

**Blue:** RED is the missing test class; S2 is the pre-existing suite asserting
the overwrite; M54/M55 split the guard from the detector, each failing on its own
suite; the quiet-file path keeps its original suites green.

## 7. Residual risk

- The check-to-rename window is unrecoverable by design; documented in the module.
- Only the two XLSX writers are covered so far (DOC-WRITE-04 lists the rest).
- `mtimeMs` is filesystem-dependent; on a filesystem with 1-second resolution an
  in-place, same-size save within the same second is invisible. Inode still
  catches replace-by-rename, which is what cloud sync clients do.
- No NIVEL 3: no real office application competing for the file.

## 8. Next batch

**IPC-DOC-WRITE-02** — carry the same identity through `loadArchive` for the five
docx/pptx writers (one module, one batch). Then `WORKSPACE-03` (a capability
decision, needs an explicit call), `SEARCH-02`, and the ZIP-index ordering item.
