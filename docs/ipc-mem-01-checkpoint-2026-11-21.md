# IPC-MEM-01 checkpoint — the personal memory store verifies the caller · 2026-11-21

**Batch:** IPC-MEM-01 (P0, IPC authorization). Fifteen handlers in
`src/main/handlers/memory.ts`.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/c34cb1fb-workspace-os` / `efc1118` (IPC-BUG-01).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-MEM-01** | Reproduced defect (control failure) | Confirmed | Fifteen of the sixteen `memory:*` channels had no origin check. The write side (`remember`, `correct`, `confirm`, `forget`) **mutates the person's memory store** — `forget` deletes a memory outright and `correct` keeps the old version as history; the read side (`query`, `recent`, `history`, `similar`, `search`, `list`, `stats`, `lastTidy`) returns everything the app has been told about the user, including the Pulse insight DB scoped to the active workspace; and `propose` reads a **session digest** and calls the person's configured model. Any frame could therefore read, poison or delete the user's memory, or bill them for a model call. |
| **MEM-02** | Pre-existing scoping (not a defect, worth naming) | Confirmed | The store is already scoped to the active workspace root, derived in main (`ctx()`), never named by the caller — so a caller cannot reach *another* workspace's memory. That is *what* is reachable, not *who* may reach it, and is the same distinction as `bug:setRepo`'s repo validation. |
| **MEM-03** | Timer side effect at registration | Confirmed (by reading) | Registration also schedules the background tidy (`setTimeout(2 min)` + hourly) and sets the embedder. Neither is an IPC path, but both explain why the suite must set `WOS_NO_TIDY=1` before import — otherwise the batch would be testing a module that keeps working after the test ends. |

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/memory.ts` | `assertMainWindowFrame(event)` first in all fifteen handlers. Nine expression-bodied handlers (`memory:confirm`, `history`, `similar`, `meaning`, `tidy`, `lastTidy`, `stats`, and the already-block `correct`) became blocks returning their value; `memory:query/recent/remember/search/propose/list/forget` kept their blocks. |
| `src/main/handlers/memory.authorization.test.ts` | **new**: 62 tests — 15 channels × 4 unauthorized callers, an owner control that walks every store operation, and a validation control. |
| `src/main/ipc-authorization.test.ts` | 15 channels moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **116**. |

`memory:status` stays in `EXPLICITLY_NO_GUARD` (verdict B): it reports the Pulse DB
status string, no user content. The mock records **which** store operation was
reached and the refusal asserts the list stayed empty, so "guarded" is not
confused with "returned `[]` because the workspace is empty".

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … memory.authorization.test.ts` | pre-fix | 1 | **RED**: **60 failed / 2 passed** — exactly 15 × 4 refusals missing; both controls green |
| S2 | same | fix | 0 | **GREEN**: 62/62 |
| S3 | mutation M36 (`memory:forget`) | mutated | 1 | **6 failures**: 4 unauthorized callers + the snippet and origin inventory tests |
| S4 | mutation M37 (`memory:remember`) | mutated | 1 | 6 failures, same shape |
| S5 | mutation M38 (`memory:propose`) | mutated | 1 | 6 failures, same shape |
| S6 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| S7 | full ESLint JSON over `src` | final | 0 | 1015 files, 0 errors / 0 warnings |
| S8 | full suite (`--maxWorkers=2`) | final | 0 | **366 files pass + 3 skipped; 4711 tests pass + 26 skipped; 0 failed** (+62) |
| S9 | `npm run build` | final | 0 | clean (generated `resources/wos-*` files reverted afterwards) |

**Own mistakes, recorded:** the first draft asserted the mocked store was called
as `remember:1`, but the handlers pass two arguments (`ctx` + payload) — the
control failed on the mock's own bookkeeping, not on the guard. The second draft
expected `search` for a query with words, but `memory:search` routes any
non-empty query to `recallMeaning` and only falls back to `search` when there are
no words; both paths are now exercised. Neither was fixed by weakening an
assertion.

## 4. Inventory after this batch

**473 declared = 347 `MUST_HAVE_GUARD` + 74 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **116**;
all sets unique.

Of the 74 `EXPLICITLY_NO_GUARD`, **20 are verdict B**, so **verdict-A remaining:
54** — `speech:*` (23), `browser:*` (20), `history:*` (11).

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| 15 channels refuse non-owner callers | NIVEL 2 | NIVEL 2 — no store operation, no model call, both temp directories empty | **APROBADO** |
| The owner is admitted and the store reached | NIVEL 2 | NIVEL 2 — one control walks all fifteen and asserts each operation, including `proposeFromSession` and `tidy` | **APROBADO** |
| Validation survives and runs after the guard | NIVEL 2 | NIVEL 2 — empty text, over-long text and an empty id still throw, with no store call | **APROBADO** |
| A real SQLite store, a real embedder, a real model | NIVEL 3 | none — the service, embedder, proposals and tidy are mocked | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"Memory is the user's own data, and the store is workspace-scoped anyway."*
   Scoping answers *which* workspace; a child or foreign frame would still read
   and **delete** it. `forget` has no undo; `correct` keeps history, but only of
   the versions it was told about.
2. *"`memory:meaning` is a status call."* It reports whether the embedder is
   loaded and which model it is using — infrastructure state that tells a caller
   when the app is downloading a model. `memory:status` (the Pulse DB status) is
   the one this batch leaves as verdict B, and the inventory test still asserts it
   has no guard, so the distinction is visible rather than assumed.
3. *"`memory:tidy` writes entries nobody asked for."* It reorganises and can
   archive; it is a write path with a model-shaped cost, and it also reads Pulse
   decisions for the workspace.
4. *"62 tests for 15 channels is padding."* Two questions per channel — refused
   *and no store touch*, admitted *and store touched* — in the same fixture. A
   guard that refuses everything leaves the control red.

**Blue:** RED equals the missing matrix (60 = 15 × 4); M36–M38 cover the
destructive, creative and model paths; the full suite grew by exactly +62; the
inventory invariant covers all fifteen, and `memory:status` is still asserted to
have **no** guard, which keeps the B decision visible rather than assumed.

## 7. Residual risk

- **54 verdict-A channels** remain: `speech:*` (23), `browser:*` (20),
  `history:*` (11).
- The background tidy (`setTimeout` + hourly) is not exercised here; it is not
  reachable from IPC. `WOS_NO_TIDY=1` is set by the suite so no timer outlives it.
- The real embedder download (`workerEmbedder`) and the SQLite store's migration
  behaviour are not exercised.
- No NIVEL 3.

## 8. Next batch

**IPC-HIST-01** — `history:*` (11): the user's browsing history (recent, search,
star, forget, clear). Then `browser:*` (20) and `speech:*` (23, including
`read-clipboard` and `set-key`).
