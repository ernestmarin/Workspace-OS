# VOX-A2b checkpoint — acknowledged response-playback transport · 2026-11-21

**Batch:** VOX-A2b — isolated duration + acknowledgement contract between
`ResponseSpeechScheduler`, `PlaybackBroker` and the renderer audio sink.
**Owner / reviewer:** single local agent (Arena Agent Mode); **self Red/Blue
review, not independent** (§6). No subagents, no parallelism, no external
services.
**Result:** accepted at **NIVEL 2** (required 2). NIVEL 3 not attempted and not
claimed: no Electron, no real audio device, no real model.
**Publication:** none. No push, no PR, no merge, no release. Commit is local.

## 0. Session anchor reconciliation

| Claim (contract §1.1 / §2) | Observed | Verdict |
| --- | --- | --- |
| Branch `arena/9cc7d9a1-workspace-os` | `arena/d78637b6-workspace-os` | **Discrepancy, reconciled**: the platform branch is authoritative and was not changed; work stayed on it. |
| Base `863e42e2…` of `master` | `bc643c47a91aca8d59e084dadc0bf5f53c8f4ea8` | **Discrepancy, reconciled**: `863e42e2` is not an object in this clone. |
| PR #15 merged, commit `286e1a6` | `git cat-file 286e1a6` → *not a valid object* | **NO VERIFICADA**: the clone is **grafted** (`git log` shows one commit, `bc643c4`, "Merge pull request #17"). No history to walk; nothing here confirms or denies PR #15. |
| `src/main/checkpoint.ts` holds 1 literal NUL | NUL count = 1 before and after | Confirmed, preserved. |

Environment: Linux, Node `v22.22.3`, npm `10.9.8`, ABI 127. `npm ci
--ignore-scripts --no-audit --no-fund` exit 0 (1163 packages, no lockfile
change); `npm_config_nodedir=/usr/local npm run rebuild:node` exit 0. No
separate model/binary downloads, no credentials, no network beyond npm.

## 1. Scope

**Included:** the scheduler↔transport boundary only — one shared module, one new
main module, their tests, and documentation.

**Excluded (deliberate, authorised by §12 P1 ordering):**
- **No production wiring.** `A2c` is untouched: `handlers.ts` / `replies.ts`
  keep using `ReadingController` + `PlaybackBroker` exactly as before. The new
  transport is not reachable from the running app, so **no user-visible voice
  behaviour changed**.
- Incremental mode is not enabled, not surfaced and not defaulted anywhere.
- No consent/disclosure work (A3), no AudioWorklet/STT (A6), no barge-in (A7).
- No device, GUI, model or cross-platform acceptance.

## 2. Findings

| ID | Kind | Certainty | Statement | Evidence |
| --- | --- | --- | --- | --- |
| **VOX-A2B-01** | Reproduced defect | Confirmed | A transport that throws **synchronously** (the main-side `play` guard does exactly this once its document is gone — `handlers.ts:61`) escaped `pump()` into the `run-end` `try` block, was **misattributed as a text overflow**, quarantined a healthy reply, and left `inFlight` permanently incremented — so `whenDrained()` never resolved. | Pre-fix probe: `THREW: null` while `state = {quarantined: true, inFlightCount: 1, playbackDrained: false}` for a completed, healthy reply. |
| **VOX-A2B-02** | Reproduced defect | Confirmed | Duration accounting used only the text-length estimate (`estimateSpeechDurationMs`). A 10-character sentence whose audio runs 30 s was accounted as 400 ms, so `maxBufferedDurationMs` never bound real audio and `state()` could not report how much was actually spoken. | Red test: measured 30 s reported → `bufferedDurationMs` stayed `2668` against a 25 000 cap. |
| **VOX-A2B-03** | Unimplemented boundary | Confirmed by absence | `ResponseSpeechScheduler` had **no production transport at all** and no caller (`grep` for `ResponseSpeechScheduler` outside its own file: zero). Nothing connected "scheduler dispatched a sentence" to "the renderer confirmed it played". | `src/shared/speech/responseScheduler.ts` had no importer; `PlaybackBroker.play()` was reachable only through `ReadingController`. |

Severity framing: A2B-01 is a **control/integrity** defect (a failed audio sink
silently discards the rest of a reply and hangs the drain contract); A2B-02 is a
**correctness/observability** defect; A2B-03 is missing scope, not a regression.

## 3. Changes

| File | Symbol | Change |
| --- | --- | --- |
| `src/shared/speech/responseScheduler.ts` | `ScheduledFragmentResult` | `+ durationMs?: number` (additive). |
| ” | `ResponseSpeechSchedulerOptions` | `+ onFragmentError?`, `speakFragment` gains optional `onMeasuredDuration`. |
| ” | `ResponseSchedulerState` | `+ spokenDurationMs`, `+ failedSentences` (additive). |
| ” | `pump()` | A synchronous transport throw, or a thrown non-promise, becomes **one failed fragment**: no exception escapes to the caller, no quarantine, no in-flight leak. |
| ” | `noteMeasuredDuration()` | Replaces the text estimate with measured audio; idempotent; ignores already-settled fragments; holds dispatch (`reason: 'duration-cap'`) when measured audio exceeds the cap **while it is still playing**; at settle time it only refines accounting. |
| ” | accounting | `spokenSentences`/`spokenDurationMs` advance only on a confirmed `finished: true`; `failedSentences`/`onFragmentError` cover transport failures that are neither a stop nor a quarantine. |
| `src/main/speech/responseTransport.ts` | **new** `ResponsePlaybackTransport`, `measuredDurationMs`, `RESPONSE_PLAYBACK_SLOTS` | Acknowledged transport over `PlaybackBroker`: `finished: true` only after the renderer ack; single settling per fragment; `cancelFragment` sends the transport `cancel` and ignores late acks; `closeAll()` for a replaced document/window; one playback slot, matching the renderer (`VoicePlayback.tsx` holds one `AudioBufferSourceNode` and answers a second concurrent `play` with `ok: false`); measured PCM duration reported before playback ends; unrealisable audio (no measurable duration) is a failure, not a silent success. |

Both `speakFragment` and `cancelFragment` keep their existing shapes, so the
pre-existing tests compile and pass unchanged; `tsc` confirms.

## 4. Evidence

All commands from `/home/user/Workspace-OS`, HEAD `bc643c4` + local delta,
Node 22.22.3 / ABI 127.

| ID | Command / selection | Code state | Exit | Result |
| --- | --- | --- | --- | --- |
| E1 | `vitest run … src/main/speech src/shared/speech src/preload/speech.test.ts src/renderer/src/components/Voice` | pre-edit baseline | 0 | 28 files, **316** tests pass |
| E2 | `vitest run … src/shared/speech/responseScheduler.test.ts` | pre-fix (tests added) | 1 | **RED**: 3 failed / 12 passed — sync-throw leak, measured-duration accounting, measured hold |
| E3 | same | post-fix | 0 | **GREEN**: 16/16 |
| E4 | `vitest run … src/main/speech/responseTransport.test.ts` | new module | 0 | 11/11 against the **real** `PlaybackBroker` and synthetic PCM |
| E5 | mutation matrix, each restored in `finally` (§7.9) | mutated | 1 ×5 | every mutation detected (below) |
| E6 | focal suite as E1 | final | 0 | 29 files, **331** tests pass (+15) |
| E7 | `tsc --noEmit -p tsconfig.node.json` / `-p src/renderer/tsconfig.json` | final | 0 / 0 | no diagnostics |
| E8 | `eslint --config config/eslint.config.mjs src --format json` | final | **1** | 1001 files, **1 error, 0 warnings** — see E8b |
| E8b | same file under a raised stack: `node --stack-size=20000 ./node_modules/eslint/bin/eslint.js … src --format json` | final | 0 | 1001 files, **0 errors, 0 warnings** |
| E9 | `vitest run --config config/vitest.config.ts --maxWorkers=2` (full) | final | 0 | **352 files pass + 3 skipped; 4177 tests pass + 26 skipped; 0 failed** |
| E10 | `npm run build` | final | 0 | main/preload/renderer + 4 CLI bundles; no `INEFFECTIVE_DYNAMIC_IMPORT`; three regenerated `resources/wos-*/**.cjs` restored (tree was clean before) |
| E11 | `npm audit --omit=dev --json` / `npm audit --json` | final | 1 / 1 | **35 / 40 moderate, 0 high, 0 critical** — unchanged; no package changes |

**Delta vs inherited baseline (post-PR #16: 351 files + 3 skipped, 4162 + 26):**
`+1` file and `+15` tests — exactly the 11 transport tests and 4 scheduler tests
added here (4162 + 15 = 4177). No existing test was renamed, removed, skipped or
weakened; `git diff` touches no evaluator, baseline or config file.

**E8 comparability (honest limitation, not a pass):** the canonical lint command
fails in *this* sandbox on **one pre-existing file I did not modify**,
`src/main/office/lokMacros.ts` (187 244 B, 4144 lines): `Parsing error: Maximum
call stack size exceeded`. The file is unmodified (`git status` clean for it),
lints clean with a larger V8 stack (E8b), and its sibling gates are green. This
is an **environment/stack-depth difference** versus the inherited "ESLint 0/0"
checkpoint, so E8 is recorded as **FALLIDO — causa entorno**, and repository lint
health as `0/0` **inferred** from E8b rather than observed under the canonical
command.

### Mutation matrix (E5)

| Mutation | Expected failure | Observed |
| --- | --- | --- |
| M1 scheduler: let the synchronous throw escape again | sync-throw contract test | 1 failed / 14 passed, exit 1 |
| M2 scheduler: ignore `onMeasuredDuration` | measured-duration hold test | 1 failed / 14 passed, exit 1 |
| M3 transport: resolve `finished: true` on send, ack ignored | ack-gated tests | 4 failed (confirms-it-played, replaced document, single slot, drain-until-ack), exit 1 |
| M4 transport: remove single-slot serialisation | overlap/drain tests | 2 failed, exit 1 |
| M5 transport: report a fabricated duration | duration assertions | 2 failed, exit 1 |

All five were restored before E6–E11; the restore is verified by E6 being green
and by `git diff` matching the intended patch.

## 5. Acceptance

| Dimension | Required | Demonstrated | Environment | Verdict |
| --- | --- | --- | --- | --- |
| Acknowledged drain / duration contract | NIVEL 2 | NIVEL 2 — scheduler + **real** `PlaybackBroker` + synthetic PCM + simulated Chromium sink | unit/integration, Linux | **APROBADO** |
| Scheduler survives a dead transport | NIVEL 2 | NIVEL 2 (RED→GREEN + mutation M1) | ” | **APROBADO** |
| Real Electron audible playback / renderer ack under Chromium | NIVEL 3 | none | — | **NO_EJECUTADO** |
| Production wiring of the transport (A2c) | not in this batch | — | — | **NO_APLICABLE** (excluded by plan) |
| Repository gates (E7, E9, E10) | final | final | Linux | **APROBADO** |
| Lint via canonical command (E8) | final | 1 pre-existing parse error | sandbox stack depth | **FALLIDO — causa entorno** |

Compliance: **cumple** for the contract above; Coverage: **parcial** (the
boundary is covered, the product path is not wired); Acceptance: **aceptado**
for NIVEL 2, **pendiente** for NIVEL 3.

## 6. Red / Blue review (self-review, not independent)

**Red (adversarial, on the new code):**
1. *"A send is not a play" could still be violated if the broker resolved on
   send.* Checked: `PlaybackBroker.play()` resolves only on
   `complete(owner, id, ok)`/abort/timeout, and the transport forwards that
   promise unchanged. M3 confirms the tests catch a regression here.
2. *A late ack could resurrect a cancelled fragment.* The broker drops unknown
   ids (`complete` returns `false`), the transport settles once, and the test
   asserts `complete(...) === false` after cancellation.
3. *Slot leak on cancel between grant and play.* Path traced: `acqure` sets
   `holdsSlot` before granting, `finally` releases it, cancelled waiters are
   skipped by `grantNext`. No test forces the exact interleaving — recorded as
   residual gap rather than claimed covered.
4. *A measured duration arriving after settle could corrupt `bufferedDurationMs`.*
   Guarded by `item.done`; not separately tested (the scheduler-level tests
   cover the live path only). Recorded as a gap.
5. *Ids are per-transport, not global.* Cancelling a foreign id is a no-op
   (tested), but two transports could use the same numeric ids — safe only
   because each scheduler holds the transport that minted its ids. Must be
   preserved at A2c wiring time.

**Blue (evidence for the change):** every claimed invariant above is backed by a
named test in E2–E4 or a mutation in E5; the fix narrows rather than widens
behaviour (a failure path stops quarantining healthy replies); no adjacent
contract changed shape; the full suite, both typechecks and the build are green
with `+15` tests and no weakened assertion.

**Discrepancies:** none unresolved. One **coverage** discrepancy is recorded
deliberately: `settle-once` is enforced by a guard that the tests cannot
distinguish, because `Promise` resolution is already idempotent — it is
defence-in-depth, not proven behaviour.

## 7. Residual risk and what is *not* covered

- **The transport is not wired.** Until A2c, this batch cannot improve any user
  experience; it only fixes a latent defect in a scheduler that no caller uses
  yet. Do not read this checkpoint as "reply audio is now acknowledged in the
  app".
- No Electron, no real audio, no audible playback, no device, no timing/latency
  evidence, no cross-platform evidence.
- No concurrent-cancel interleaving test at the slot boundary (§6 Red 3), no
  post-settle measurement test (§6 Red 4).
- `maxInFlight` is **not** forced to `RESPONSE_PLAYBACK_SLOTS` by the code: a
  scheduler built with `maxInFlight > 1` loses nothing (the transport queues),
  but the scheduler's own in-flight count then overstates playback concurrency.
  Enforce or assert this at A2c.
- The renderer remains a single-slot sink that rejects a second concurrent
  `play` with `ok: false`; that behaviour is unchanged and is now *documented*
  at the boundary rather than discovered at runtime.
- Playback timeout is still the broker's `max(30 s, duration + 30 s)`; a hung
  renderer delays a reply rather than losing it.
- Dependency advisories unchanged (35/40 moderate). Inherited open items (178
  unguarded IPC channels at the earlier count, Office residual, LOK lifecycle,
  voice A1c-onward, model pins) are untouched by this batch.

## 8. Next batch (A2c) — entry conditions

Wire `ResponsePlaybackTransport` into the reply path **without** changing the
default completed-run mode:

1. Build the scheduler with `maxInFlight: RESPONSE_PLAYBACK_SLOTS`, `backpressure:
   'hold'`, `mode: 'completed'` and the document's config snapshot; pass
   `onDuration` into whatever status surface needs it.
2. Bind `closeAll()` to the existing `SpeechDocument.invalidate()` (navigation,
   `destroyed`, `render-process-gone`) and to global Voice Stop.
3. Prove: a reply whose document is replaced mid-utterance stops, settles once,
   and never resumes; `stopWork()` cancels queued and playing fragments but not
   agent actions; the pre-existing `ReadingController` path is unaffected.
4. RED → FIX → GREEN, mutation, inventory and all gates; NIVEL 2 required.
   NIVEL 3 (real Electron + audible playback) stays open for a device session.
