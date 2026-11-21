# IPC-WRITERS-01 checkpoint — the last three channels, and the end of the path-only list · 2026-11-21

**Batch:** IPC-WRITERS-01 (P0, IPC authorization). Three handlers: `components:save` (`components.ts`), `wiki:add` (`wiki.ts`), `drive:save` (`drive.ts`).
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/e28c7316-workspace-os` / `7fba5b2` (IPC-REFRESH-01).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-WRITERS-01** | Reproduced defect (control failure) | Confirmed | The last three sensitive channels without an origin check. `components:save` **writes the shared component store**; `wiki:add` **rewrites pages in the workspace and calls a language model** (it spends the person's tokens and produces content attributed to them); `drive:save` **uploads a local file into the user's Google Drive** — the only channel in the whole inventory whose effect leaves the machine. None looked at the event. |
| **FIXTURE-02** | Test-design lesson | Confirmed | The guard in `drive:save` throws **synchronously**, before the `guard()` wrapper, so a test that calls the handler directly sees a throw while the renderer sees a rejection (`ipcMain.handle` converts it). Pinned by making `invokeAs` async. Writing the legitimate control also exposed two facts about `drive:*` that were not documented: `guard()` answers with a **result envelope** (`{ ok, value }` / `{ ok: false, error }`) instead of throwing, and `wiki:add` reads its known-sources list *before* validating each path. Neither is a defect; both are now pinned by tests so a future change cannot quietly alter the contract. |

Severity: `drive:save` is the highest blast radius in the inventory — data leaves
the device and lands in an external account.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/components.ts` | `assertMainWindowFrame(event)` first in `components:save`. |
| `src/main/handlers/wiki.ts` | same in `wiki:add`, above root resolution. |
| `src/main/handlers/drive.ts` | `drive:save` converted from an expression-bodied `guard(...)` call to a block body that guards **before** the wrapper runs, so a refusal cannot be swallowed into an `{ ok: false }` envelope. |
| `src/main/ipc-authorization.test.ts` | `MUST_HAVE_ORIGIN_GUARD` extended to **37** — the full sensitive set. |
| `src/main/handlers/drive.security.test.ts` | fixture corrected (**FIXTURE-01, fourth instance**): `invoke()` passed `{ senderFrame: { parent: null } }` with no sender, so the RT-07 symlink assertions would have become rejections. It now speaks as the owner, `invokeAs()` is async on purpose, and **one test pins the refusal**. |
| `src/main/handlers/writers.authorization.test.ts` | **new**: 16 tests — 3 channels × 4 unauthorized callers (proving no store file, no model call, no token, no upload), the legitimate surface for each, and the surviving validation. |

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| W1 | `vitest run … writers.authorization.test.ts` | pre-fix | 1 | **RED**: **14 failed / 3 passed** — component written, wiki fed, Drive upload attempted |
| W2 | same | fix | 0 | **GREEN**: 16/16 |
| W3 | mutation M18 (`components:save`) | mutated | 1 | 4 failures |
| W4 | mutation M19 (`wiki:add`) | mutated | 1 | 4 failures |
| W5 | mutation M20 (`drive:save`) | mutated | 1 | 4 failures |
| W6 | `vitest run … writers + ipc-authorization` | final | 0 | 25 tests pass |
| W7 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics (after fixing my own fixture's wrong `registerWikiHandlers` arity) |
| W8 | `eslint -c config/eslint.config.mjs` (changed files) | final | 0 | clean |
| W9 | full suite, first attempt | — | 1 | **4 failed**: `drive.security.test.ts` — its fabricated event was refused (FIXTURE-01 #4) |
| W9b | full suite, after the fixture change | final | 0 | **358 files pass + 3 skipped; 4355 tests pass + 26 skipped; 0 failed** |

## 4. Inventory — the path-only list is empty

**473 declared = **268 `MUST_HAVE_GUARD` + 153 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **37**;
every set unique.

Origin-guard coverage of the sensitive set: **268 of 268 — zero path-only
channels** for the first time in this audit.

**What "zero" does and does not mean.** It means every channel the inventory
classes as needing a caller check now has one *and* is listed in the invariant
that enforces it. It does **not** mean every IPC channel is authorized against
every threat:

- **153 `EXPLICITLY_NO_GUARD`** remain decisions, not proofs. They were
  classified by earlier batches; nobody has re-derived that list channel by
  channel in this session. Reading them is the next audit (call it
  **IPC-CLASS-01**).
- **22 `GRANT_CHECKED`** are `WORKSPACE_DATA_OPERATIONS`: covered by the bridge's
  grant validation, a different mechanism, asserted equal by a test.
- **30 `PUSH_CHANNELS`** are main → renderer sends, not invocable from a frame.
- Coverage is measured by the repository's own snippet heuristic. Path-only
  detection found true gaps (this batch's three were among them), but a guard
  present is not the same as a guard correct — that is what the eleven
  per-module authorization suites are for.

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| Three handlers refuse non-owner callers | NIVEL 2 | NIVEL 2 (no `components.json`, no model call, no token request, no `updateFile`) | **APROBADO** |
| Legitimate surface intact | NIVEL 2 | NIVEL 2 (component persisted, wiki answer, drive envelope `{ ok: true, value }`) | **APROBADO** |
| Refusal cannot be swallowed by `guard()` | NIVEL 2 | NIVEL 2 — guard runs **outside** the wrapper; unauthorized calls reject, they do not return `{ ok: false }` | **APROBADO** |
| Real Drive upload / real model call | NIVEL 3 | none — both mocked | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"`guard()` already reports errors, so the envelope is a control."* It reports errors that happen *inside* it. A frame check placed inside would have become `{ ok: false }` — indistinguishable from a network failure and invisible to a test that only checks "did not throw". It is outside for that reason.
2. *"`wiki:add` only schedules work; nothing happens synchronously."* It rewrites pages and spends model tokens asynchronously, and it accepts up to 200 paths per call.
3. *"`components:save` stores UI assets — low value."* It is a persistent store the renderer reads back; unauthenticated writers are still unauthenticated writers.
4. *"Mocking Drive proves nothing about uploads."* It proves the upload was never reached on refusal — which is the claim — and the legitimate control proves the path still runs to `updateFile` with the right file.

**Blue:** RED 14/14; M18–M20 show one guard per handler is load-bearing; FIXTURE-01 reached its fourth occurrence here (`drive.security.test.ts`), which is the strongest argument yet that the full suite — not the focal set — is the real gate for authorization work; the
envelope semantics and the wiki ordering are pinned by tests instead of left
implicit; the inventory invariant covers all 268.

## 7. Residual risk

- **`EXPLICITLY_NO_GUARD` (153) is an unverified classification** — the honest
  next step (IPC-CLASS-01).
- The guard scheme is single-window (`setMainWindow`).
- Lifecycle findings `WATCH-02` / `OFFICE-02` (dialogs parented to the
  registering window) remain open.
- No NIVEL 3 acceptance anywhere in this series: real Electron, real dialogs, a
  real Drive account and a real LibreOffice install are all still unexercised.

## 8. Next batch

**IPC-CLASS-01** — re-derive the 153 `EXPLICITLY_NO_GUARD` channels from source
and check the decisions still hold, one module at a time. Start with the largest
clusters (`mail:*` 60+, `case*:*`, `lok:*`), since a wrong classification there
means a whole family was waved through. If a channel should not be reachable
from a renderer at all, the right fix may be removing it from the preload, not
adding a guard.
