# IPC-SESSION-02 checkpoint — the conversation surface verifies the caller · 2026-11-21

**Batch:** IPC-SESSION-02 (P0, IPC authorization). Three handlers in `src/main/handlers/chat.ts`: `sessions:load`, `sessions:save`, `chat:upload`.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/9cd5feee-workspace-os` / `68396d2` (IPC-DRIVE-02).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-SESSION-02** | Reproduced defect (control failure) | Confirmed | `sessions:load` returns the **entire chat transcript** of the workspace as a JSON string, `sessions:save` writes up to 40 MB of it atomically, and `chat:upload` writes dropped file bytes into `.workspace-os/uploads/<day>/`. None looked at the event. A foreign frame could read every conversation in the workspace, or fill the disk with uploads. |
| **SESSION-03** | Control that existed and was not an authorization | Confirmed | `sessions:save` already refused any root the app had not opened in this run (a good control — it bounds *which workspace*). It says nothing about *who* asks, which is the same distinction the whole series keeps finding. The guard now runs **before** it, so a refusal is distinguishable from `{ ok: false }`. |

Severity: conversation transcripts are the most personal text the app holds.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/chat.ts` | `assertMainWindowFrame(event)` first in all three handlers. |
| `src/main/handlers/chat.authorization.test.ts` | **new**: 14 tests — 3 channels × 4 unauthorized callers (no `.workspace-os` created, workspace empty), the legitimate round trip (transcript saved/loaded, upload with a traversal name reduced to a bare file name and written inside the uploads folder), and the surviving validation. |
| `src/main/ipc-authorization.test.ts` | three channels moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **58**. |
| `docs/ipc-class-01-triage.md` | cluster 3 marked done. |

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … chat.authorization.test.ts` | pre-fix | 1 | **RED**: **12 failed / 2 passed** |
| S2 | same | fix | 0 | **GREEN**: 14/14 |
| S3 | mutation M26 (`sessions:load` guard removed) | mutated | 1 | 4 failures |
| S4 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| S5 | `eslint -c config/eslint.config.mjs` (changed files) | final | 0 | clean |
| S6 | full suite | final | 0 | **362 files pass + 3 skipped; 4448 tests pass + 26 skipped; 0 failed** (+14) |

## 4. Inventory after this batch

**473 declared = 289 `MUST_HAVE_GUARD` + 132 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **58**;
all sets unique.

`EXPLICITLY_NO_GUARD`: 153 → 132. **Verdict-A remaining: 111.**

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| Three handlers refuse non-owner callers | NIVEL 2 | NIVEL 2 (app state never created; workspace stays empty) | **APROBADO** |
| Legitimate surface intact | NIVEL 2 | NIVEL 2 (save → load round trip; upload sanitised and confined) | **APROBADO** |
| Refusal distinguishable from the not-opened-workspace answer | NIVEL 2 | NIVEL 2 — refusal rejects; `{ ok: false }` is reserved for the root check | **APROBADO** |
| Upload sanitising | NIVEL 2 | NIVEL 2 (`../../etc/passwd` → `passwd` inside the uploads folder) | **APROBADO** |
| Real 40 MB limit / real disk | NIVEL 2 | size cap is exercised by value, not by a 40 MB write | **NO_EJECUTADO** (cost) |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"Sessions live in the workspace the user opened, so the root already scopes them."* Scoping answers *which files*; it does not answer *which frame*. Any frame could read any workspace's chat.
2. *"`sessions:save` already refuses unopened roots."* It refuses a *root*, not a *caller* — and the refusal returns `{ ok: false }`, which is why the guard had to go above it rather than inside.
3. *"`chat:upload` sanitises the name, so it cannot escape."* True and asserted; it still writes attacker-chosen bytes to disk on demand, up to 25 MB per call.
4. *"Tests could not create 40 MB, so the cap is unproven."* Correct, and stated as `NO_EJECUTADO` rather than implied — the cap is a pre-existing single comparison, reviewed by reading, not by execution.

**Blue:** RED 12/12 with both controls green; M26 shows each guard is
load-bearing; the round-trip test proves the surface still works for the owner
after the owner was replaced (the exact case that used to break delivery).

## 7. Residual risk

- **111 verdict-A channels** remain.
- Uploads have no total-size bound across calls (only per-upload 25 MB) — pre-existing, worth its own finding.
- No NIVEL 3: no real Electron window, no real 40 MB transcript.

## 8. Next batch

**IPC-STORE-01** — the derived-state stores (25 channels), the largest cluster and
the lowest consequence per channel: `collection:*`, `collectionLink:*`,
`range:*`, `rangeLink:*`, `components:*`, `metric:*`, `transclusion:*` and
`wiki:*`. Split as metrics/collections/ranges (one commit) and wiki (another).
