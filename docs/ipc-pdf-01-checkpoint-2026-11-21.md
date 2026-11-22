# IPC-PDF-01 checkpoint — the PDF editing surface verifies the caller · 2026-11-21

**Batch:** IPC-PDF-01 (P0, IPC authorization). One module: `src/main/handlers/pdf.ts` (9 handlers).
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/9cd5feee-workspace-os` / `54189d8` (merge of PR #20).
**Why this module first:** it is the top verdict-A cluster of
[IPC-CLASS-01](ipc-class-01-triage.md).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-PDF-01** | Reproduced defect (control failure) | Confirmed | Nine channels that **rewrite the user's documents in place** — page reorder, rotate, form fill, signature stamp — keep their annotation sidecar, export copies, and hand a temporary PDF to `shell.openPath`. None looked at the event. Every path *is* validated, but behind `resolveInWorkspace()`, which is exactly why the inventory's snippet heuristic listed all nine as needing no caller check: the path check was mistaken for a caller check, at scale. |
| **CLASS-01** | Process defect (the audit's premise) | Confirmed | Re-deriving the 153 `EXPLICITLY_NO_GUARD` channels from source found **123 that reach user content, user state, the filesystem, the network, an external program, a model or a secret**, and only 21 that are genuinely UI state. The set was an unexamined default, not a body of decisions. Full table: [ipc-class-01-triage.md](ipc-class-01-triage.md). |

Severity: irreversible edits to documents that may be the only copy, plus
launching the OS viewer on a converted file.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/pdf.ts` | `assertMainWindowFrame(event)` first in all nine handlers (`_e` → `event`); module doc comment states that path confinement is not authorization. |
| `src/main/ipc-authorization.test.ts` | nine channels moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **46**. |
| `src/main/handlers/pdf.authorization.test.ts` | **new**: 38 tests — 9 channels × 4 unauthorized callers, each proving the document is byte-identical afterwards (no write, no trash, no sidecar, no new file), plus the full legitimate surface and the surviving validation. |
| `docs/ipc-class-01-triage.md` | **new**: the 153-channel re-derivation and the batch plan. |

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| P1 | `vitest run … pdf.authorization.test.ts` | pre-fix | 1 | **RED**: **36 failed / 2 passed** — 9 × 4 unauthorized calls all rewrote, trashed, exported or printed |
| P2 | same | fix | 0 | **GREEN**: 38/38 |
| P3 | mutation M21 (`pdf:print` guard removed) | mutated | 1 | 4 failures |
| P4 | mutation M22 (`pdf:sign` guard removed) | mutated | 1 | 4 failures |
| P5 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| P6 | `eslint -c config/eslint.config.mjs` (changed files) | final | 0 | clean |
| P7 | full suite | final | 0 | **359 files pass + 3 skipped; 4393 tests pass + 26 skipped; 0 failed** (+38) |
| P8 | `npm run build` | final | 0 | regenerated `resources/wos-*/**.cjs` restored |

**Own mistake, recorded:** the first attempt at the nine guards used a regex that
rewrote `async (_e, a, b) => {` by inserting the guard **inside the parameter
list**, producing a file that did not parse (124 tsc errors). It was caught by
`tsc` immediately, the file was restored with `git checkout --` and the
replacement was written to match `… ) => {` instead. No test ever ran against
the broken file.

## 4. Inventory after this batch

**473 declared = 277 `MUST_HAVE_GUARD` + 144 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **46**;
all sets unique. Origin coverage **277/277** — the invariant still holds for
every channel it covers; what changed is that nine more channels are inside it.

**`EXPLICITLY_NO_GUARD` is no longer a resting state**: 123 of its 144 members
are verdict-A in the triage and will move, cluster by cluster, until it contains
only the 21 documented B channels.

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| Nine handlers refuse non-owner callers | NIVEL 2 | NIVEL 2 — byte-identical document, no trash entry, no sidecar, no export, no `openPath` | **APROBADO** |
| Legitimate surface intact | NIVEL 2 | NIVEL 2 (sidecar round trip, export + in-place export with prior version trashed, page ops, forms, signature, print) | **APROBADO** |
| Path and payload validation independent of the guard | NIVEL 2 | NIVEL 2 (outside-workspace paths, non-PDF target, bad page order, bad signature) | **APROBADO** |
| Real pdf-lib against a real PDF | NIVEL 3 | none — `annotation-writer` is mocked | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"The paths are validated, so nothing outside the workspace can be touched."* True, and it is why this looked safe. It still lets any frame rewrite **any document inside** the workspace, with the prior version only in the trash.
2. *"Annotations are a sidecar — non-destructive."* The sidecar is; `pdf:export` with `inPlace: true`, `pages:reorder`, `pages:rotate`, `form:fill` and `sign` are not. The test asserts the document is unchanged after every refusal.
3. *"Mocking pdf-lib means the test proves nothing about PDFs."* The claim is who may reach the writer. The control test proves the wiring: sidecar path, export naming, trash-before-write order and print target are all asserted from real code.
4. *"The trash makes it safe."* Trash is user-recoverable, not authorized: the test asserts `trash` is never even consulted.

**Blue:** RED 36/36 with two controls green (so the red is the guard, not a broken
fixture); M21/M22 show per-handler guards; the legitimate test pins the undo path
(three trash entries for three destructive ops) so a future refactor cannot drop
it silently.

## 7. Residual risk

- The other **123** verdict-A channels (§2 of the triage) are still unguarded; this batch closes 9.
- No NIVEL 3: pdf-lib, `shell.openPath` and the trash layer are mocked.
- A verdict is a judgement until its test exists — `bug:file`, `bug:analyze` and `print:document` were read by hand; the rest were screened mechanically.

## 8. Next batch

**IPC-WORKSPACE-02** — `workspace:open-recent` / `workspace:close` /
`workspace:recents`: `open-recent` reassigns the authoritative root from an
**unvalidated string**, which is the highest-consequence verdict-A item left.
Then `drive:*` (5), then `sessions:*` + `chat:upload`.
