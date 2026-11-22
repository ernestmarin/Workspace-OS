# IPC-DRIVE-02 checkpoint — the whole Drive surface verifies the caller · 2026-11-21

**Batch:** IPC-DRIVE-02 (P0, IPC authorization). Six handlers in `src/main/handlers/drive.ts`: `drive:connection`, `connect`, `disconnect`, `list`, `search`, `open` (`drive:save` was done in IPC-WRITERS-01).
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/9cd5feee-workspace-os` / `fdf3241` (IPC-WORKSPACE-02).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-DRIVE-02** | Reproduced defect (control failure) | Confirmed | Five channels had no origin check. Together with `drive:save` (done earlier) they are the entire Drive integration: `connect` **runs the OAuth flow in the system browser and stores a refresh token**, `disconnect` drops it, `list`/`search` read the person's Drive, `open` **downloads a remote file into the workspace**. A foreign frame could connect an account, cut the connection, enumerate the drive, or plant files. |
| **CLASS-02** | Triage correction | Confirmed | `drive:connection` was classified **B** in the IPC-CLASS-01 triage as "whether an account is linked, no files". Reading the handler shows it returns the whole connection object — **including the account email**. Corrected to A and guarded in this batch. The triage's limit (§3 of that document) in one concrete instance. |

Severity: the only channel family that both reaches the network with the
person's credentials **and** writes into the workspace.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/handlers/drive.ts` | `assertMainWindowFrame(event)` first in all six; for the three expression-bodied `guard(...)` handlers the guard runs **outside** the wrapper (a refusal must not become an `{ ok: false }` envelope — same rule as `drive:save`). |
| `src/main/handlers/drive.authorization.test.ts` | **new**: 26 tests — 6 channels × 4 unauthorized callers (no OAuth, no token, no account saved, no listing, no file on disk), the legitimate surface end to end, and the surviving validation (access level coerced, no-workspace refusal reported as an envelope). |
| `src/main/ipc-authorization.test.ts` | six channels moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **55**. |
| `docs/ipc-class-01-triage.md` | `drive:connection` moved from B to A; cluster 2 marked done. |

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| D1 | `vitest run … drive.authorization.test.ts` | pre-fix | 1 | **RED**: **24 failed / 2 passed** — every unauthorized call reached Google or wrote a file |
| D2 | same | fix | 0 | **GREEN**: 26/26 |
| D3 | `vitest run … drive.authorization + drive.security` | final | 0 | 31 tests pass (RT-07 symlink suite unaffected) |
| D4 | mutation M24 (`drive:open`) | mutated | 1 | 4 failures |
| D5 | mutation M25 (`drive:connect`) | mutated | 1 | 4 failures |
| D6 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| D7 | `eslint -c config/eslint.config.mjs` (changed files) | final | 0 | clean |
| D8 | full suite | final | 0 | **361 files pass + 3 skipped; 4434 tests pass + 26 skipped; 0 failed** (+26) |

## 4. Inventory after this batch

**473 declared = 286 `MUST_HAVE_GUARD` + 135 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **55**;
all sets unique.

`EXPLICITLY_NO_GUARD`: 153 → 135 (9 pdf + 3 workspace + 6 drive).
**Verdict-A remaining: 114.**

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| Six handlers refuse non-owner callers | NIVEL 2 | NIVEL 2 (no OAuth, no token, no `save`, no `listFolder`/`searchFiles`/`downloadFile`, empty workspace) | **APROBADO** |
| Refusal is not swallowed by `guard()` | NIVEL 2 | NIVEL 2 — unauthorized calls reject; legitimate ones return `{ ok, value }` | **APROBADO** |
| Legitimate surface intact | NIVEL 2 | NIVEL 2 (connection with email, connect + save, list, search, open writing the file into the Drive folder, disconnect) | **APROBADO** |
| Real Google / real system browser | NIVEL 3 | none | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"`drive:list` only lists file names — low value."* It lists the user's files and their ids, and it spends a network call with their token. The same argument would have left `search:*` unguarded, which this session already rejected.
2. *"`drive:connect` needs the user to consent in a browser, so they authorise it."* They authorise *the flow*; a frame they did not initiate should not be able to start one, and the refresh token lands in the app's secret store.
3. *"The guard inside `guard()` would be simpler."* It would turn a refusal into `{ ok: false }`, which the renderer shows as a network error and a test would read as "handled". The test asserts a rejection.
4. *"`drive:connection` is a read-only status call."* It returns the account email. That is why the triage entry was wrong and is now corrected.

**Blue:** RED 24/24 with both controls green; M24/M25 show per-handler guards;
the RT-07 symlink suite still passes, so `drive:save`'s confinement was not
disturbed; the legitimate test checks the fetched file lands **inside** the
workspace Drive folder, not merely somewhere.

## 7. Residual risk

- **114 verdict-A channels** remain (see the triage).
- No NIVEL 3: Google clients, the system browser and the secret store are mocked.
- The Drive folder path comes from Drive's own filename; it is `basename`-ed, but a name collision silently overwrites a previously fetched file — pre-existing, out of scope here, worth its own finding.

## 8. Next batch

**IPC-SESSION-02** — `sessions:load`, `sessions:save`, `chat:upload`: conversation
transcripts and attachments written to disk. Then the largest cluster: the
derived-state stores (25), which can be split metrics/collections + wiki.
