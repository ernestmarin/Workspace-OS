# VOX-REACH-04 — the agent → user reply reader, reachable from the shipped pane

- **Date:** 2026-11-22
- **Branch:** `arena/bb4b35b3-workspace-os`
- **Base:** `9ace1f5d39bbfdf807702a003344415caa6595f0` (`Merge pull request #25`, = `origin/master`)
- **Entry conditions:** `docs/voice-reach-01-checkpoint-2026-11-22.md` §8, items 1–4
- **Acceptance required / demonstrated:** NIVEL 2 / **NIVEL 2** (NIVEL 3 still open)

## 1. The finding, confirmed against the code

`OwnedReplies` — the completed agent→user reply reader, with 10 unit tests and a
full provenance contract — had **no reachable caller**. Verified by import walk,
not by reading documentation:

```
grep -rn "OwnedReplies" src/renderer/src        → only useAgentSession.ts:142
grep -rn "useAgentSession" src/renderer/src     → TerminalSession.tsx (+ its own tests)
grep -rn "AgentTerminal/AgentTerminal" src      → (no matches)
```

`AgentTerminal.tsx` has zero importers, so the whole chain was dead. The
reachability walker reported **449 files reachable from `App.tsx`** with
`components/AgentTerminal/ownedReplies.ts` not among them. A subsystem with
passing tests and no path from the entry point: the same failure mode
VOX-REACH-01 was created to catch, on the half of the conversation it did not
cover.

## 2. Contract of the batch

| | |
| --- | --- |
| **ID / owner** | VOX-REACH-04 — reply reading in the dock's agent pane |
| **Observable outcome** | A person can turn on "read replies" in `TerminalAgentPane`; completed replies of **that tab's own** runs are spoken through main's frozen lease; turning it off, hiding the tab or closing it stops this tab's reading and nothing else |
| **Files touched** | `src/renderer/src/lib/sessions/sessionStore.ts`, `src/renderer/src/components/Terminal/TerminalAgentPane.tsx`, `src/voice-reachability.test.ts`, `src/renderer/src/components/Terminal/TerminalAgentPane.voice.test.tsx` (+2 new test files) |
| **Excluded** | `AgentTerminal/TerminalSession.tsx` (not re-mounted), `AgentTerminal/useAgentSession.ts` (untouched), `src/main/speech/**` (contract unchanged), grants, Safe/Full, HITL |
| **Invariants protected** | one reply source per run; run→session attribution; opt-in consent; per-tab lease; hidden/unmounted tab holds no lease; reading never touches agent execution; one terminal event per run |
| **Level required** | NIVEL 2 (integration really executed, boundaries declared) |

## 3. Design decision, and why it is not a copy of `useAgentSession`

The reader binds to the **run lifecycle `lib/sessions` publishes**, not to agent
IPC. `lib/sessions/sessionStore` is the only engine that starts runs for Chat,
the landscape cards and the terminal's agent tabs, and it already owns
`runId → sessionId` attribution. Re-subscribing per component would have meant
every pane re-deriving ownership from a broadcast channel — the exact mistake
that made the old path plausible-looking and unreachable.

`sessionStore` gains `onReplyEvents(handler) → unsubscribe` publishing
`begin | text | finish | cancel`, each carrying the `sessionId` of the run's
owner. The pane filters by its own id and forwards to `OwnedReplies`. The
consent dialog, the frozen engine/voice snapshot and the per-tab reservation
contract are **untouched**: they stay exactly as `src/main/speech/handlers.ts`
enforces them (`SPEECH_REPLY_OPEN/RESERVE/FINISH/CLOSE`, each behind
`assertOwner(event)`).

### 3.1 The one-source rule (the defect my own first implementation had)

Main emits a claude reply on **both** channels from the same parsed line
(`src/main/agent/launchRun.ts:391-399` feeds `sink.assistantText` and
`sink.assistantResponse`). A reader listening to both speaks every reply twice.
The store therefore claims a `ResponseStreamConsumer` per run and suppresses the
flattened channel for runs whose `responseOwner` main acknowledged, falling back
cleanly when main returns none.

**My first implementation got this wrong and my own test caught it.** I cleared
the `structuredRuns` mark inside the terminal reply event, but `run-end` closes
the *reply*, not the *run*: main keeps flattening the same text until the process
exits, so the duplicate arrived right after a clean `run-end`. The mark now lives
as long as the run and is cleared in `onDone` / on failure to start. This is the
batch's central invariant and M1 is its guard.

## 4. Evidence

### 4.1 RED (before the fix)

```
vitest run src/voice-reachability.test.ts \
           src/renderer/src/lib/sessions/sessionStore.replies.test.ts \
           src/renderer/src/components/Terminal/TerminalAgentPane.replies.test.tsx
→ Test Files 3 failed (3) · Tests 19 failed | 2 passed (21) · exit 1
```

Each failure was the invariant, not the harness:

- reachability: `expected [ 'App.tsx', …(449) ] to include 'components/AgentTerminal/ownedReplies…'`
- store: `TypeError: sessionStore.onReplyEvents is not a function`
- pane: `TypeError: Cannot read properties of undefined (reading 'click')` — there was no *Read replies* control

The two passing assertions are the walker's pre-existing sanity controls.

### 4.2 Harness defects found while writing the RED (recorded, not hidden)

Both were my fixture's fault, not the product's, and both would have produced
tests that pass for the wrong reason:

1. **`bus.clear()` per test.** The store's IPC subscriptions are module state
   guarded by a module-level `started` flag; clearing the listener bus left the
   second test with no subscribers while `started` stayed true. Fixed with
   `vi.resetModules()` + a fresh dynamic import per test.
2. **`start()` reads the workspace root asynchronously and `load(null)` resets
   the session list.** A session created immediately after the first `create()`
   was wiped mid-test. Fixed by letting that settle in `beforeEach` before the
   test body creates anything.

### 4.3 GREEN

```
focused: 24 files / 186 tests, exit 0
full:    Test Files 385 passed | 3 skipped (388)
         Tests      5076 passed | 26 skipped (5102) · exit 0
```

Baseline at the same HEAD, reproduced before touching anything: 383 + 3 files,
5055 + 26 tests. **Delta: +2 files, +21 tests, 0 removed, 0 skipped added.**
Compared by test identity, not by count — no assertion was rewritten to match
behaviour.

### 4.4 Mutation matrix — 7/7 detected, files restored (md5 verified identical)

| # | Protection removed | Detected by | Result |
| --- | --- | --- | --- |
| M1 | one-source rule: a structured run also read from the flattened channel | `reads a provenance-checked stream once, never doubling it with the flattened channel` | 1 failed / 27 passed, exit ≠ 0 |
| M2 | run ownership: flattened text accepted for runs this store never started | `ignores agent events for runs this store never started` | 1 failed / 27 passed, exit ≠ 0 |
| M3 | a structured stream that never reached `run-end` finished instead of cancelled | `cancels a structured stream that never reached run-end rather than inventing a reply` | 1 failed / 27 passed, exit ≠ 0 |
| M4 | exit code ignored: a failed run reported as ok | `reports a failed run as not-ok so a half answer is never spoken` | 1 failed / 27 passed, exit ≠ 0 |
| M5 | session filter: the pane reads replies of other tabs | `never reads a reply that belongs to another tab` | 1 failed / 27 passed, exit ≠ 0 |
| M6 | a hidden tab keeps its reply lease | `closes this tab's lease when the tab is hidden, without touching the agent` | 1 failed / 27 passed, exit ≠ 0 |
| M7 | unmount keeps the lease open | `closes the lease on unmount` | 1 failed / 27 passed, exit ≠ 0 |

### 4.5 Legitimate controls (the owner still works)

- A structured run reads its prose **once** and finishes `ok: true`.
- A legacy run (main returns no `responseOwner`) falls back to the flattened
  channel and is read normally.
- Two concurrent sessions stay apart.
- *Stop reply audio* cancels only pending reply audio and leaves consent in
  place: the next completed reply is still read.
- Every assertion that a reply is **not** spoken is paired with one that a reply
  **is** spoken, so a reader that simply never fires cannot pass.

### 4.6 Gates on the final state (after the last product change)

| Gate | Command | Result | Exit |
| --- | --- | --- | --- |
| tsc (main/preload/shared) | `tsc --noEmit -p tsconfig.node.json` | 0 errors | 0 |
| tsc (renderer) | `tsc --noEmit -p src/renderer/tsconfig.json` | 0 errors | 0 |
| typecheck vs baseline | `npm run typecheck` | `clean against the baseline (0 known errors, baseline 0)` | 0 |
| ESLint, canonical | `eslint --config config/eslint.config.mjs src --format json` | 1038 files, **1 error** — `src/main/office/lokMacros.ts: Parsing error: Maximum call stack size exceeded` | 1 |
| ESLint, deep stack | `node --stack-size=20000 ./node_modules/eslint/bin/eslint.js --config config/eslint.config.mjs src --format json` | **1038 files, 0 errors, 0 warnings** | 0 |
| ESLint, files touched by this batch, canonical | `eslint --config config/eslint.config.mjs <6 files>` | 0 errors, 0 warnings | 0 |
| Vitest, full | `vitest run --config config/vitest.config.ts --maxWorkers=2` | 385 + 3 files, 5076 + 26 tests, 0 failed | 0 |
| Build | `npm run build` | ok, no `INEFFECTIVE_DYNAMIC_IMPORT` | 0 |
| Integrity | NUL bytes in `src/main/checkpoint.ts` = **1**; `git diff --check` clean | — | 0 |

**The ESLint result is an environment failure, not a product one.**
`src/main/office/lokMacros.ts` (~187 KB) is untouched by this batch
(`git status --porcelain src/main/office/lokMacros.ts` → empty) and overflows the
canonical process's stack in this sandbox. Under a sufficient stack the same
config reports 0/0 over all 1038 files. Classified **FALLIDO — CAUSA ENTORNO**,
with the alternative command as evidence; **not** counted as green.

The three regenerated `resources/wos-*/**.cjs` bundles produced by `npm run build`
were restored selectively (they were clean before this batch) and are not
committed.

## 5. Dimensions, reported separately

- **Cumplimiento:** cumple. The four entry conditions of VOX-REACH-01 §8 are
  met: bound to `lib/sessions` + `sessionStore.send` (not `useAgentSession`,
  `TerminalSession` not re-mounted); consent per tab and revocable; hidden or
  closed tab stops only its own replies; a failed, cancelled or never-closed run
  is never read; nothing in the reader can cancel an agent.
- **Cobertura:** completa para el alcance del lote. Declarado **no revisado**:
  real Electron window lifecycle, real microphone/audio, the main-side reply
  registry under concurrent leases from several tabs, and the classic
  `AgentTerminal` path (still orphaned, now provably so).
- **Aceptación:** NIVEL 2. No Electron, no audio device, no TTS engine executed.
  **NIVEL 3 sigue abierto.**

## 6. Residual risk and honest gaps

- **Nothing has been heard.** No synthesis engine ran; no latency, no audible
  playback, no real window teardown. The lease lifecycle is proved against the
  preload contract, not against a running Electron.
- **`AgentTerminal.tsx` is still orphaned.** Its reply path is now duplicated in
  spirit by the shipped one. Deleting the classic tree is a separate, deliberate
  clean-up — not folded into this batch.
- **The reachability test walks imports, not rendering.** It proves the modules
  are reachable from `App.tsx`; that the pane renders and that a person can click
  the control is what `TerminalAgentPane.replies.test.tsx` covers, in jsdom.
- Untouched and still open: A3a/A3b (incremental consent + transport), A5a/A5b,
  A6a/A6c, A7a/A7b, the 178 unguarded IPC channels at the inherited count, Office
  residual, LOK lifecycle, dependency advisories (35 prod / 40 total moderate,
  0 high/critical, reproduced this batch), and the absence of CI on push/PR.

## 7. Next eligible batch

**VOX-A3a** — incremental reply consent, off by default, with explicit disclosure
that text leaves early to a cloud provider. Entry condition: a product decision
on the default. **Exit condition:** consent recorded per tab, transport wired
only after it, generation and drain tested separately.

Alternative with no product decision needed: **a `pull_request` CI workflow**
(`tsc` ×2 + `eslint` + `vitest`) — the highest-yield preventive control available,
since every gate in §4.6 is local execution and nothing re-runs it on a branch.
It requires explicit authorisation to modify `.github/`, which is still an
unfilled `[PLACEHOLDER]`.
