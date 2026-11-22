# IPC-UPLOAD-01 checkpoint — a workspace-wide budget for chat uploads · 2026-11-21

**Batch:** IPC-UPLOAD-01 (P2, resource exhaustion inside the user's workspace).
One handler (`chat:upload`).
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/f72b6745-workspace-os` / `19441e0` (merge de PR #22).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **UPLOAD-01** | Reproduced defect (resource exhaustion) | Confirmed | `chat:upload` refused any **single** file over 25 MB and had **no budget across calls**. Every accepted drop landed in `<workspace>/.workspace-os/uploads/<day>/`, so a repeated paste, a stuck retry loop or a hostile frame could fill the disk of a workspace the person is working in — one accepted 25 MB file at a time. A per-call cap is a property of the call, not of the folder. |
| **UPLOAD-02** | Boundary that shapes the fix | Confirmed | The new accounting must not follow symlinks: the uploads folder is ours, and a link inside it must neither inflate the total with a file that lives elsewhere nor make the walk escape the workspace. `readdirSync` with `withFileTypes` counts `isFile()` only, so links contribute zero. |
| **UPLOAD-03** | Ordering | Confirmed | The budget is checked **before** `mkdirSync`, so a refusal leaves nothing behind — not even the day folder the write would have created. (The existing `chat:upload` tests that assert a refusal writes nothing still hold.) |

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/chat.ts` | `MAX_UPLOADS_BYTES = 512 MiB` (the default), `uploadsBudgetBytes()` (reads `WOS_MAX_UPLOADS_BYTES`, falls back on nonsense), `uploadsBytes(dir)` (recursive, regular files only, tolerant of a vanished entry), and a check in `writeUpload` before the day folder is created. Error text names the budget so the person knows what to delete. |
| `src/main/handlers/chat.uploads.test.ts` | **new**: 5 tests — refusal without writing, exact-budget acceptance, symlink not followed/counted, nonsense override falls back to the default, and the existing per-call cap plus free-name suffixing preserved. |

The per-call cap stays: a single 25 MB file is its own problem, and the two
limits answer different questions. `WOS_MAX_UPLOADS_BYTES` exists so the
behaviour can be exercised without writing half a gigabyte — the same shape as
the other workspace toggles (`WOS_NO_MEANING`, `WOS_WINDOWS_DRIVE_STATE`).

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … chat.uploads.test.ts` | pre-fix | 1 | **RED**: **4 failed / 1 passed** — `uploadsBytes`/budget did not exist; the third drop was accepted |
| S2 | same | fix | 0 | **GREEN**: 5/5 |
| S3 | mutation M51 (`if (false)`, no budget check) | mutated | 1 | 2 failures — over-budget refusal and the exact-budget boundary |
| S4 | mutation M52 (`else {` instead of `else if (isFile())`, following links) | mutated | 1 | 1 failure — the symlink case |
| S5 | mutation M53 (`used = 0`) | mutated | 1 | 2 failures, same as M51 |
| S6 | `vitest run … chat.uploads + chat.authorization` | final | 0 | 19 tests pass — the IPC-SESSION-02 guards are unaffected |
| S7 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| S8 | full suite + ESLint + build | final | 0 | 371 files + 3 skipped / 4990 tests + 26 skipped; ESLint 0 over 1022 files; build 0 |

## 4. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| A drop over the budget is refused and writes nothing | NIVEL 2 | NIVEL 2 — file count and byte total unchanged after the refusal | **APROBADO** |
| A drop landing exactly on the budget is accepted | NIVEL 2 | NIVEL 2 — 20 + 5 bytes at a 25-byte budget; the next byte is refused | **APROBADO** |
| Symlinks neither counted nor followed | NIVEL 2 | NIVEL 2 — a 1 MiB outside file linked inside `uploads/` contributes 0 | **APROBADO** |
| The shipped default is 512 MiB | NIVEL 2 | NIVEL 2 — asserted with a nonsense override in place | **APROBADO** |
| Behaviour on a full real disk | NIVEL 3 | none — no disk is actually filled; `ENOSPC` on `writeFileSync` still surfaces as an error | **NO_EJECUTADO** |

## 5. Red / Blue review (self-review, not independent)

**Red:**
1. *"25 MB per drop is already a bound."* It bounds a drop, not the folder: 100
   drops are 2.5 GB. The person's workspace is where this lands.
2. *"Walking the tree on every upload is O(folder)."* It is, and the folder is
   bounded by the same budget; a cache would introduce a stale-number bug in the
   one place where the number is the protection. Measured cost at the default
   (512 MiB across day folders) is a `readdir` of a few hundred entries.
3. *"An env override is a bypass."* It is read-only configuration, not an IPC
   path, and an invalid value falls back to the shipped default. A renderer
   cannot set the main process's environment.
4. *"Why not delete the oldest uploads automatically?"* That destroys user data
   to make room, silently. Refusing and naming the limit keeps the decision with
   the person.

**Blue:** RED is the missing API plus the accepted third drop; M51/M52/M53 isolate
the check, the link handling and the accounting; the existing upload behaviour
(per-call cap, free-name suffix) is asserted unchanged.

## 6. Residual risk

- The budget counts bytes only; a folder with tens of thousands of tiny files is
  bounded by bytes but not by inode count. Low consequence at 512 MiB, recorded
  rather than over-engineered.
- Nothing prunes old uploads: the folder grows to the budget and then refuses.
  A "clear uploads" action is a product decision, not a defect fix.
- No NIVEL 3: `ENOSPC` is not exercised.

## 7. Next batch

Remaining backlog, in order of consequence: **WORKSPACE-03** (a capability
decision — `open-recent` accepts any existing directory even for the owner),
**SEARCH-02** (lazy DB open), the ZIP-index ordering item, and the lifecycle
items (`WATCH-02`, `OFFICE-02`).
