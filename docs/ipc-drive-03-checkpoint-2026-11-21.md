# IPC-DRIVE-03 checkpoint — two Drive files with the same name no longer overwrite each other · 2026-11-21

**Batch:** IPC-DRIVE-03 (P0 data loss). One handler (`drive:open`), one new module,
one shared helper.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/f72b6745-workspace-os` / `19441e0` (merge de PR #22).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **DRIVE-03** | Reproduced defect (silent data loss) | Confirmed | `drive:open` fetched a Drive file into `<workspace>/Drive/` and wrote it at `path.join(dir, path.basename(filename))` — **the remote name decided the local path, and nothing else did**. A Drive folder may hold `report.docx` in two places, and Drive ids are per file while local paths are per name: opening the second silently replaced the first. That is the same class the browser's download path already solved with `uniquePath`, and it is worse here because the canvas and the office engine hold the path. |
| **DRIVE-04** | Design constraint that shapes the fix | Confirmed | "Always suffix" would be a regression: re-opening the **same** Drive file must refresh *that* copy, otherwise every re-open creates `report (2).docx`, `report (3).docx`, … and breaks the tab that has the file open. The two behaviours need the Drive **id**, which the local path alone does not carry. |
| **DRIVE-05** | Trust boundary on the new mapping | Confirmed | The mapping is our own file, but a moved workspace — or an index written by an older build — can hold a path outside `Drive/`. The recorded path is therefore reused **only when its directory resolves to this workspace's `Drive/` folder**; otherwise a fresh copy is allocated inside it. |

## 2. Change

| File | Change |
| --- | --- |
| `src/main/drive/drive-copies.ts` | **new**: `DriveCopyIndex` — id → local path, bounded to `DRIVE_COPIES_MAX = 500` (oldest dropped), atomic `write-then-rename`, and a corrupted or missing index reads as empty instead of failing the open. |
| `src/main/util/unique-path.ts` | **new**: the `report.pdf` → `report (2).pdf` allocator, extracted so downloads and Drive share one rule (`archive.tar.gz` → `archive.tar (2).gz`). |
| `src/main/browser/downloads.ts` | imports the helper from the new module and re-exports it, so every existing caller and test keeps its import. |
| `src/main/handlers/drive.ts` | `drive:open` resolves the copy through the index: same id **and** the path still inside `Drive/` → overwrite in place; otherwise `uniquePath(dir, name)`. The mapping is recorded **before** the write, so two concurrent opens of same-named files cannot both allocate the same path. The returned `name` is now the local basename (`report (2).docx`), not the remote one. |
| `src/main/handlers/drive.local-copies.test.ts` | **new**: 7 tests — collision, refresh-in-place, rename stability, an index entry pointing outside `Drive/`, where the index is written, the bound, and a corrupted index. Real filesystem, real bytes; only the network boundary is mocked. |

The mapping lives in `<workspace>/.workspace-os/drive-copies.json`, **not** in
`Drive/`: that folder is the user's, and a bookkeeping file there would appear as
one of their documents.

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … drive.local-copies.test.ts` | pre-fix | 1 | **RED**: **6 failed / 1 passed** (`report (2).docx` never appeared) — the second file replaced the first (`report.docx` stayed one file), no index existed at all, and the rename case moved the local copy |
| S2 | same | fix | 0 | **GREEN**: 7/7 |
| S3 | mutation M48 (write at `path.join(dir, name)`) | mutated | 1 | 2 failures — the collision test and the index test |
| S4 | mutation M49 (`reusable = false`, always suffix) | mutated | 1 | 2 failures — refresh-in-place and rename stability |
| S5 | mutation M50 (`reusable = mapped !== null`, no containment) | mutated | 1 | 1 failure — the index entry pointing outside `Drive/` |
| S6 | `vitest run … downloads + drive.security + drive.authorization` | final | 0 | 40 tests pass — the shared helper and the existing Drive suites are unaffected |
| S7 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| S8 | ESLint (changed files) | final | 0 | clean |
| S9 | full suite + ESLint + build | final | 0 | 371 files + 3 skipped / 4990 tests + 26 skipped; ESLint 0 over 1022 files; build 0 (+12 tests, the two batches of this session) |

## 4. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| Two Drive files, same name, both survive | NIVEL 2 | NIVEL 2 — two real files with the right bytes; the first is never touched | **APROBADO** |
| Re-opening the same Drive file refreshes it | NIVEL 2 | NIVEL 2 — same path, new content, one file on disk | **APROBADO** |
| A stale/out-of-folder mapping cannot redirect the write | NIVEL 2 | NIVEL 2 — the outside file is untouched and the new copy lands in `Drive/` | **APROBADO** |
| Same behaviour under a real Drive account | NIVEL 3 | none — `getFile`/`downloadFile` mocked at the network boundary | **NO_EJECUTADO** |

## 5. Red / Blue review (self-review, not independent)

**Red:**
1. *"Drive ids are stable; why not name the file after the id?"* Because the
   person opens these files from their own folder; `1a2b3c4d.docx` is unusable.
   The id belongs in the index, the name on the disk.
2. *"Keep both names and delete the old copy on refresh."* That turns a refresh
   into a delete — a failed download would then have destroyed the local copy it
   was refreshing. Overwriting the known copy is the conservative choice.
3. *"The index is a new file inside the workspace."* It is inside
   `.workspace-os/`, the folder the app already owns, and it is bounded to 500
   entries, atomic, and tolerant of corruption. It is not in `Drive/`.
4. *"Concurrent opens still race."* They are narrowed, not eliminated: the
   mapping is written before the bytes, so a second open of a *different* file
   sees the first path taken and allocates the next suffix. Two opens of the
   *same* id remain last-writer-wins, which is the refresh semantics anyway.
5. *"A dropped index costs the user a duplicate."* Yes — and the alternative
   (trusting a path we cannot verify) is a write outside the folder.

**Blue:** RED is the observed loss (one file where two were expected); M48/M49/M50
separate the three properties (no collision, refresh, containment); the shared
helper did not change download behaviour (its suite is untouched and green).

## 6. Residual risk

- The index is keyed by **file id**, so a file *moved* on Drive keeps its local
  copy name — intended (see the rename test), but a user who reorganises in
  Drive keeps the old local filename until they fetch it under a new id.
- `DRIVE_COPIES_MAX = 500` is a working-set bound, not a guarantee: past it, the
  oldest mapping is dropped and the next open of that file allocates a new name
  rather than overwriting (safe direction).
- No NIVEL 3: no real Drive account, no real large-file download.

## 7. Next batch

**IPC-UPLOAD-01** — `chat:upload` had a per-call cap and no workspace-wide
budget (see its checkpoint). Then the remaining backlog: `WORKSPACE-03` (a
capability decision, not a defect), `SEARCH-02`, and the ZIP-index ordering item.
