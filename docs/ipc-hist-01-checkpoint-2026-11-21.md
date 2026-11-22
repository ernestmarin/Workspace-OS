# IPC-HIST-01 checkpoint — browsing history verifies the caller, and the inventory stops missing a registration form · 2026-11-21

**Batch:** IPC-HIST-01 (P0, IPC authorization). Twelve handlers in
`src/main/handlers/history.ts`, plus a repair to the inventory scanner itself.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/c34cb1fb-workspace-os` / `00dc7b6` (IPC-MEM-01).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-HIST-01** | Reproduced defect (control failure) | Confirmed | None of the twelve handlers in `history.ts` verified the caller. `history:search` is full-text **over page content**; `history:recent`, `bookmarks`, `suggest` and `is-starred` are a record of everything the person has read; `record` writes to it; `forget`, `forget-since` and `clear` **delete it permanently** (the index removes the FTS rows too, so a forgotten page is gone, not hidden); and `browser:clear-cache` empties the browser's HTTP cache. Any frame could read or erase the user's reading history. |
| **HIST-02** | Blind spot in the audit tooling | **Confirmed and repaired** | `history.ts` registers with **`ipcMain.handle(IPC.X, …)`**, not with the `ipcHandle` registry every other module uses. The IPC-CLASS-01 inventory (`ipc-authorization.test.ts`) only scanned `ipcHandle(ipcMain, IPC.X, …)`. Twelve channels were therefore **never scanned at all** — they fell through to `EXPLICITLY_NO_GUARD` and their "no guard" passed every test because no snippet existed to fail. The scanner now recognises both forms, ends each snippet at the next registration *of either kind*, and a new test asserts that the scanner sees `handlers/history.ts` and that **every** `MUST_HAVE_GUARD` channel has a scanned snippet. |
| **HIST-03** | Lazy open (observed, now covered) | Confirmed | The index is opened on first use so a session that never browses leaves no database on disk. The tests now pin that behaviour from both sides: a refusal never opens it, and the first owner use opens it exactly once. |

**Why HIST-02 matters more than the twelve guards:** every count in the triage
(`473 declared = …`, "86 verdict-A remaining") rests on the inventory being able
to *see* a registration. A blind spot means the numbers were right about the
channel list (`ipc-channels.ts` is parsed independently) and wrong about which of
them had been examined. This was found by reading the module, not by a failing
test — the same way `drive:connection` was found.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/history.ts` | `assertMainWindowFrame(event)` first in all twelve handlers. Six expression-bodied ones (`search`, `suggest`, `recent`, `is-starred`, `bookmarks`, `forget-since`) became blocks returning their value; `browser:clear-cache` and `history:record` took the event parameter they previously ignored. |
| `src/main/handlers/history.authorization.test.ts` | **new**: 50 tests — 12 channels × 4 unauthorized callers plus two controls. Because these handlers are registered synchronously, refusals are thrown synchronously; the fixture wraps the call in a promise so the assertion still sees a rejection rather than an exception at the call site. |
| `src/main/ipc-authorization.test.ts` | Scanner generalised to both registration forms; snippet bound now the nearest registration of either form; new `el escáner ve las dos formas de registro de ipcMain` test. Twelve channels moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **128**. |

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … history.authorization.test.ts` | pre-fix | 1 | **RED**: **49 failed / 1 passed** — the 48 refusals plus the control that asserts the index is opened *only* by the owner (pre-fix it was already opened by a "refusal" that had executed) |
| S2 | same | fix | 0 | **GREEN**: 50/50 |
| S3 | mutation M39 (remove the `ipcMain.handle` form from the scanner) | mutated | 1 | **3 failures** — `browser:clear-cache no fue escaneado`, and two inventory tests that depend on the twelve channels being seen |
| S4 | mutation M40 (`history:forget`) | mutated | 1 | **7 failures**: 4 unauthorized callers + 3 inventory tests |
| S5 | mutation M41 (`history:search`) | mutated | 1 | 7 failures, same shape |
| S6 | `vitest run … history-index + history.authorization` | final | 0 | 77 tests pass — the real index module is unaffected |
| S7 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| S8 | full ESLint JSON over `src` | final | 0 | 1016 files, 0 errors / 0 warnings |
| S9 | full suite (`--maxWorkers=2`) | final | 0 | **367 files pass + 3 skipped; 4762 tests pass + 26 skipped; 0 failed** (+51: the 50 of the new suite plus the inventory test that pins the scanner) |
| S10 | `npm run build` | final | 0 | clean (generated `resources/wos-*` files reverted afterwards) |

**Own mistakes, recorded:** the first fixture gave the module a *new* `ipcMain`
object in `beforeAll`, but `history.ts` captures the mocked module's `ipcMain` at
import — registration silently went nowhere; the module-level index is also
cached across tests, so "was it opened" has to be asserted against a live map
rather than a per-test array. Both were fixed in the fixture, not by relaxing the
assertion. The scanner's own bug (HIST-02) was *found* by this batch, not
introduced by it.

## 4. Inventory after this batch

**473 declared = 359 `MUST_HAVE_GUARD` + 62 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **128**;
all sets unique.

Of the 62 `EXPLICITLY_NO_GUARD`, **20 are verdict B**, so **verdict-A remaining:
42** — `speech:*` (23) and `browser:*` (19, since `browser:clear-cache` was
guarded here).

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| 12 channels refuse non-owner callers | NIVEL 2 | NIVEL 2 — no index opened, no query, no delete, no cache clear | **APROBADO** |
| The owner is admitted and the store reached | NIVEL 2 | NIVEL 2 — one control walks all twelve and asserts each index operation, the FTS search, the deletes and `clearCache` | **APROBADO** |
| The inventory can no longer miss this registration form | NIVEL 2 | NIVEL 2 — M39 removes the form from the scanner and three tests fail; a positive test asserts the file is scanned | **APROBADO** |
| A real SQLite FTS index, a real Chromium cache | NIVEL 3 | none — the index and `session.fromPartition` are mocked | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"History is local, and the store already lives in userData."* Location is not
   authorization: `clear` and `forget` are irreversible and a foreign frame could
   wipe the record of what the user read before deciding what to do next.
2. *"`history:record` comes from our own webview."* It comes from whatever calls
   it; the *caller* is a frame, and the guard is the only thing that asks which.
3. *"The scanner fix is tooling, not security."* It is the security *measurement*.
   A claim of "no unexamined channels" that cannot see a registration form is
   worth nothing; this batch is the proof, and it was found by reading source.
4. *"50 tests for 12 channels is padding."* Two questions per channel, plus the
   lazy-open property from both sides.

**Blue:** RED is the full matrix plus the lazy-open control; M39 shows the scanner
change is load-bearing; M40/M41 show per-handler guards; the real index suite and
the rest of the full suite are green; the inventory is now *harder* to satisfy
than before (every `MUST_HAVE_GUARD` channel must have a scanned snippet).

## 7. Residual risk

- **42 verdict-A channels** remain: `speech:*` (23) and `browser:*` (19).
- `browser:clear-cache` was guarded with its module; the other nineteen
  `browser:*` channels live in `browserControl.ts` (navigate, click, type,
  screenshot, deep-read, downloads) and are the last large batch.
- Real Chromium cache and real SQLite FTS behaviour are not exercised.
- No NIVEL 3, and no self-review substitutes for the independent review the
  contract asks for.

## 8. Next batch

**IPC-BROWSER-02** — the nineteen remaining `browser:*` channels: a foreign frame
driving the user's guest browser (navigate, click, type, screenshot, deep-read of
page content, downloads). Then `speech:*` (23, including `read-clipboard` and
`set-key`).
