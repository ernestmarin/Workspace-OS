# VOX-REACH-01 checkpoint — the voice UI was not mounted · 2026-11-22

**Batch:** VOX-REACH-01/02/03 — make the voice conversation and the voice
interface commands reachable from the shipped app, and add the control that
would have caught it.
**Owner / reviewer:** single local agent (Arena Agent Mode); **self Red/Blue
review, not independent** (§6). No subagents, no parallelism, no external
services, no publication.
**Result:** accepted at **NIVEL 2** (required 2). NIVEL 3 not attempted and not
claimed: no Electron, no real microphone, no real Whisper model, no audio device.
**Publication:** none. No push, no PR, no merge, no release. Commit is local.

## 0. Session anchor reconciliation

| Claim (contract §1.1 / §2) | Observed | Verdict |
| --- | --- | --- |
| Branch `arena/9cc7d9a1-workspace-os` | `arena/8ad6e0c0-workspace-os` | **Discrepancy, reconciled**: the platform branch is authoritative and was not changed; all work stayed on it. |
| Base `863e42e2…` of `master` | `c5ea024024a173796b24eaadbb4ad6e79e6509dd` ("Merge pull request #24") | **Discrepancy, reconciled**: `863e42e2` is not an object in this clone. |
| PR #15 merged, commit `286e1a6` | `git rev-list --count HEAD` → **1**; `.git/shallow` contains HEAD | **NO VERIFICADA**: the clone is **grafted**. There is no history to walk, so nothing here confirms or denies PR #15 or any earlier commit. |
| `src/main/checkpoint.ts` holds 1 literal NUL | NUL count = 1 before and after | Confirmed, preserved. |
| Inherited suite 348 files / 4113 tests | `docs/HANDOFF.md` (IPC-DIALOG-PARENT-01) records **380 files + 3 skipped, 5043 + 26 skipped** | The §2 metrics in the contract are older than the repository's own last checkpoint; the HANDOFF figure was used as the comparison baseline and matched exactly (§4). |

Environment: Linux, Node `v22.22.3`, npm `10.9.8`, ABI 127. `npm ci
--ignore-scripts --no-audit --no-fund` exit 0 (1163 packages, no lockfile
change). `npm_config_nodedir=/usr/local npm run rebuild:node` exit 0 — and it was
**required**, not optional: the first full run before the rebuild failed **268
tests in 15 files**, every one of them a `better-sqlite3` consumer. No separate
model/binary downloads, no credentials, no network beyond npm.

## 1. Scope

**Included:** mounting the existing, already-tested voice input controls in the
agent surface the app actually renders; making an unperformable voice command
impossible to propose; one mechanical reachability control.

**Excluded (deliberate):**
- **The agent → user half stays unreachable.** `OwnedReplies` / `SpokenReplies` /
  the consent-scoped reply reader live in `useAgentSession`, which only
  `TerminalSession.tsx` uses. The production pane runs sessions through
  `lib/sessions` + `PromptBar`. Wiring reply reading into that lifecycle is the
  next batch (§8); nothing here changes it, and no claim is made about it.
- No new IPC channel, no new permission, no change to `speech:*` handlers, no
  change to the microphone grant, STT worker, model verifier or playback broker.
- No A2c/A3/A6/A7 work. The `ResponseSpeechScheduler` / `ResponsePlaybackTransport`
  pair is still unwired (see §7 for why the documented A2c recipe is not
  implementable as written).
- No device, GUI, model or cross-platform acceptance.

## 2. Findings

| ID | Kind | Certainty | Statement | Evidence |
| --- | --- | --- | --- | --- |
| **VOX-REACH-01** | Reproduced defect (functional, high priority for the stated goal) | Confirmed | The whole bidirectional voice UI was **unreachable in the shipped app**. `VoiceDictation.tsx` (push-to-talk, local Whisper STT, 9 languages, mic selection, `dictate`/`commands` mode) is imported only by `TerminalSession.tsx`; `TerminalSession.tsx` is imported only by `AgentTerminal.tsx`; `AgentTerminal.tsx` is imported by **nothing**. | `grep -rn "TerminalSession'" src/` → `AgentTerminal.tsx:2` and `TerminalSession.voice.test.tsx:28` only. `grep -rln "from '.*AgentTerminal/AgentTerminal'" src/` → **no results**. `grep -rn "VoiceDictation" src/` → `TerminalSession.tsx:5` + its own test. The new reachability walker traversed **441 renderer files** from `App.tsx` and `VoiceDictation.tsx` was not among them, while the sanity control `Voice/VoicePlayback.tsx` was. |
| **VOX-REACH-02** | Reproduced defect (functional) | Confirmed | Even inside that unreachable component, `interfaceCommandActions` was **never supplied by any production caller** (only by `TerminalSession.voice.test.tsx:33`). So three of the five recognised commands — `show-files`, `show-browser`, `show-voice-settings` — had no bound action. The card still offered **Confirmar comando**, `confirm()` returned `false`, the caller ignored the return value and hid the card: a silent no-op indistinguishable from success. | `grep -rn "interfaceCommandActions" src/renderer` → 4 hits in `TerminalSession.tsx` + 1 in its test, none from a parent. `interfaceCommandController.ts:86-87`: `if (typeof action !== 'function') return false`. `TerminalSession.tsx:135`: the boolean result is discarded. |
| **VOX-REACH-03** | Missing preventive control (lesson) | Confirmed by absence | Nothing distinguished "implemented and unit-tested" from "reachable by a user". Every voice suite mounts its component directly, so all of them stayed green. `docs/technical-debt-audit.md:104` records VOX-U2/U3 as **IMPLEMENTED & RENDERER-VERIFIED**; that claim was true of the component and false of the product. | No importer graph check existed anywhere in `src/`. `docs/landscape/PROGRESS.md:95` (phase 7, 2 Oct 2026) records the cause: the classic layout was removed and "`AgentTerminal`, also only mounted by the classic layout, stays for now … removing it is a separate clean-up" — the consequence for the voice work built on top of it was never reconciled. |
| **VOX-A2C-01** | Plan defect (documented, not implemented) | Confirmed | The A2c recipe in `docs/voice-a2b-checkpoint-2026-11-21.md` §8 — "build the scheduler with `mode: 'completed'` and wire it into the reply path" — **cannot be implemented without regressing long replies**. | `responseScheduler.ts` `push`/`run-end` in completed mode calls `enqueueSentence(full, true)` — the entire accumulated reply becomes **one** fragment. `shared/speech/replies.ts:4` allows `MAX_REPLY_TEXT = 20_000` chars. The production path paginates at `fragment_size: 1200` (`defaults.ts:98`) and splits at the OpenAI 4096 UTF-16 provider limit (`reading.ts:117`). Wiring it as written sends one ≤20 000-char blob to a single synthesis call and produces one unbounded PCM buffer. See §7. |

Severity framing: REACH-01 is a **product-completeness** failure of the exact
capability the mission names (voice conversation and voice commands), not a
security failure — nothing was exposed that should not have been; the opposite.
REACH-02 is a **silent-failure** defect. REACH-03 is the reason both survived
three documented voice increments.

## 3. Changes

| File | Symbol | Change |
| --- | --- | --- |
| `src/renderer/src/components/Terminal/TerminalAgentPane.tsx` | `TerminalAgentPane`, `VOICE_COMMANDS` | **Mounts** `VoiceDictation` (the agent pane the dock really renders) with `active` bound to the visible tab, plus the one-shot confirmation card. Dictation goes to the composer as a draft; a confirmed command performs exactly one reversible action through the shell's existing `wos:open-rail` / composer-focus primitives. `VOICE_COMMANDS` lists only what this surface binds — `show-voice-settings` is deliberately absent because the dock has no path to Settings. Proposals are invalidated on tab hide, `pagehide` and `visibilitychange`. |
| `src/renderer/src/components/Terminal/TerminalDock.tsx` | tab map | Passes `active={active === t.id}` to the agent pane (it already did for the shell pane). Without it a hidden tab could hold a microphone and a pending proposal. |
| `src/renderer/src/components/PromptBar/PromptBar.tsx` | `Props`, two effects | `+ dictatedText`, `+ onDictationConsumed`, `+ focusSignal`. Dictation is **appended to the draft and consumed immediately**; Enter/Send stays the only submission. `focusSignal` focuses the composer on a change only. |
| `src/shared/speech/interfaceCommands.ts` | `proposeInterfaceCommand` | `+ available?: readonly InterfaceCommandId[]` (optional, additive). A recognised phrase whose command the calling surface does not bind is **not proposed at all**. Omitting the argument keeps the previous full-vocabulary behaviour, so every existing caller and test is unchanged. |
| `src/renderer/src/components/AgentTerminal/interfaceCommandController.ts` | `constructor`, `ingestFinalTranscript` | `+ options.available`, forwarded to the grammar. The allow-list is a property of the surface, not of each transcript. |
| `src/voice-reachability.test.ts` | **new** | Mechanical source invariant: walks the static/dynamic import graph from `App.tsx` and fails when `VoiceDictation.tsx` or `interfaceCommandController.ts` is orphaned. Carries its own sanity control (`VoicePlayback.tsx`, known-mounted) so an empty traversal cannot pass. |
| `src/renderer/src/components/Terminal/TerminalAgentPane.voice.test.tsx` | **new** | 5 behavioural tests against the real pane (dictation mocked at its own module boundary, `PromptBar` mocked to record the wiring). |
| `src/renderer/src/components/PromptBar/PromptBar.dictation.test.tsx` | **new** | 3 behavioural tests against the real `PromptBar`: append, consume-once, never submit, focus-on-change. |
| `src/shared/speech/interfaceCommands.test.ts` · `interfaceCommandController.test.ts` | `+1 test each` | The allow-list, at the pure-function and controller level. |

No existing test was renamed, removed, skipped or weakened; no evaluator,
baseline, tsconfig, eslint config or guard was touched. `git diff` confirms it.

## 4. Evidence

All commands from `/home/user/Workspace-OS`, HEAD `c5ea024` + local delta,
Node 22.22.3 / ABI 127.

| ID | Command / selection | Code state | Exit | Result |
| --- | --- | --- | --- | --- |
| E0 | `npm ci --ignore-scripts --no-audit --no-fund` | base, `node_modules` empty | 0 | 1163 packages, no lockfile change |
| E1 | `vitest run … src/main/speech src/shared/speech src/preload/speech.test.ts src/renderer/.../Voice src/renderer/.../AgentTerminal` | pre-edit baseline | 0 | 45 files, **561** tests pass |
| E2 | `vitest run … TerminalAgentPane.voice.test.tsx voice-reachability.test.ts` | pre-fix (tests added) | 1 | **RED**: 6 failed / 1 passed — dictation not mounted, no proposal card, walker found no `VoiceDictation` among 441 reachable files |
| E3 | `vitest run … PromptBar components/Terminal components/AgentTerminal shared/speech voice-reachability` | post-fix | 0 | **GREEN**: 29 files, **330** tests |
| E4 | mutation matrix M1–M6, each restored in `finally` (§7.9) | mutated | 1 ×6 | every mutation detected (below) |
| E5 | `tsc --noEmit -p tsconfig.node.json` / `-p src/renderer/tsconfig.json` | final | 0 / 0 | no diagnostics. The renderer run **caught a real defect in my own change**: a `import type` with one `../` too few (`TS2307`) that vitest could not see because esbuild erases type-only imports. Fixed, re-run to 0/0. |
| E6 | `eslint --config config/eslint.config.mjs src --format json` | final | 0 | **1036 files, 0 errors, 0 warnings** under the canonical command |
| E7 | `vitest run --config config/vitest.config.ts --maxWorkers=2` (full) | **before** `rebuild:node` | 1 | 15 files failed, **268 tests failed** — every failure a `better-sqlite3` consumer. Recorded as **environment**, not product |
| E7b | `npm_config_nodedir=/usr/local npm run rebuild:node` | — | 0 | `rebuilt dependencies successfully` |
| E8 | full suite, same command | final, post-rebuild | 0 | **383 files pass + 3 skipped; 5055 tests pass + 26 skipped; 0 failed** |
| E9 | `npm run build` | final | 0 | main/preload/renderer + 4 CLI bundles; **0** `INEFFECTIVE_DYNAMIC_IMPORT`; three regenerated `resources/wos-*/**.cjs` restored (`resources/` was clean before the build) |
| E10 | `npm audit --omit=dev --json` / `npm audit --json` | final | 1 / 1 | **35 / 40 moderate, 0 high, 0 critical** — unchanged; no package changes |
| E11 | `git diff --check` · NUL count | final | 0 / — | clean; NUL = 1 |

**Delta vs the inherited baseline** (`docs/HANDOFF.md`, IPC-DIALOG-PARENT-01:
380 files + 3 skipped, 5043 passed + 26 skipped): **+3 files, +12 tests** —
exactly 5 (`TerminalAgentPane.voice`) + 2 (`voice-reachability`) + 3
(`PromptBar.dictation`) + 1 (`interfaceCommands`) + 1
(`interfaceCommandController`). 380 + 3 = 383 and 5043 + 12 = 5055. The delta is
fully accounted for; no test disappeared.

**E7 comparability:** the pre-rebuild failure is an ABI mismatch in this fresh
sandbox, not a regression — the same 15 files pass after `rebuild:node` with no
code change. This is why §4 requires the rebuild as part of preflight rather
than as a recovery step.

### Mutation matrix (E4)

| Mutation | Expected failure | Observed |
| --- | --- | --- |
| M1 pane: construct the controller without `available` | "never proposes a command this surface cannot perform" | 1 failed / 4 passed, exit 1 |
| M2 pane: stop invalidating proposals on a hidden tab | "revokes a pending command … when its tab is hidden" | 1 failed / 4 passed, exit 1 |
| M3 grammar: ignore the `available` argument | allow-list tests at three levels | **3 failed / 48 passed**, exit 1 |
| M4 composer: drop `onDictationConsumed?.()` | "consumes it once" | 1 failed / 2 passed, exit 1 |
| M5 composer: `onSubmit(dictatedText, [])` instead of drafting it | "never submits it" + "appends after an existing draft" | 2 failed / 1 passed, exit 1 |
| M6 pane: unmount `VoiceDictation` | reachability + all 5 pane tests | **5 failed / 2 passed**, exit 1 |

All six were restored before E5–E11; the restore is verified by E3 being green,
by E8 passing, and by `git diff` matching the intended patch (no `if (false)`
residue, `grep` clean).

## 5. Acceptance

| Dimension | Required | Demonstrated | Environment | Verdict |
| --- | --- | --- | --- | --- |
| Dictation reachable and draft-only | NIVEL 2 | NIVEL 2 — real pane + real `PromptBar` (wiring and merge tested separately), mocked mic/STT boundary | jsdom, Linux | **APROBADO** |
| Voice command needs one explicit click and performs a real, reversible action | NIVEL 2 | NIVEL 2 (RED→GREEN + M1/M2/M3) | ” | **APROBADO** |
| An unperformable command is never offered | NIVEL 2 | NIVEL 2 (RED→GREEN + M1/M3) | ” | **APROBADO** |
| Orphaned voice UI is caught mechanically | NIVEL 1 (source invariant, stated as such) | NIVEL 1 + M6 | ” | **APROBADO** |
| Real Electron, real microphone, real Whisper transcription, audible playback | NIVEL 3 | none | — | **NO_EJECUTADO** |
| Agent → user reply reading reachable in the production pane | not in this batch | — | — | **NO_APLICABLE** (excluded by plan, §1) |
| Repository gates (E5, E6, E8, E9) | final | final | Linux | **APROBADO** |

Compliance: **cumple** for the contract above. Coverage: **parcial** — the
user→agent and voice→interface halves are wired; the agent→user half is not.
Acceptance: **aceptado** for NIVEL 2, **pendiente** for NIVEL 3.

## 6. Red / Blue review (self-review, not independent)

**Red (adversarial, on the new code):**
1. *"You mounted a microphone in every dock tab."* Checked: the dock keeps all
   panes mounted and hides them with CSS (`TerminalDock.tsx:338`), so `active`
   is now threaded exactly as the shell pane already did. `VoiceDictation`
   discards on `!active`, on `pagehide`/`visibilitychange` and on unmount, and
   main additionally single-flights the native prompt (`microphonePromptOpen`)
   and rejects concurrent transcription (`LocalStt.busy`). Three independent
   guards, one of them pre-existing.
2. *"Dictation could auto-submit."* The composer effect only calls `setText` and
   consumes; M5 shows the tests catch a regression to submission. `PromptBar`'s
   `submit` is reachable only from the textarea's Enter and the Send button.
3. *"The allow-list could be bypassed by passing `undefined`."* True and
   deliberate: `available === undefined` means "grammar decides", which is what
   the two pre-existing callers want. The pane passes an explicit list; M1
   proves that removing it is detected. The risk is a *future* surface forgetting
   the option, which is why the option is documented at both levels.
4. *"`openRail('agents')` may not be a real destination."* Type-checked against
   `RailId` (`shellModel.ts:15-21` includes `agents`), and `wos:open-rail` has
   three pre-existing producers (`agentActions.ts:11`, `ChatSide.tsx:32`,
   `App.tsx:33`) and one consumer (`WorkspaceShell.tsx:444`). **Not verified in a
   running app** — recorded as a NIVEL 3 gap, not as covered.
5. *"The confirmation card borrows `.msgSystem`."* Cosmetic. The class exists in
   `TerminalDock.module.css:388`, so no undefined CSS-module class; the region is
   labelled and its buttons are real `<button>`s. Restyling is out of scope.
6. *"The reachability walker is a source check and can be fooled."* Correct, and
   it says so in its own header: a module reachable only through a `vi.mock`
   factory or a string-built path would be misjudged. It is a cheap tripwire for
   the exact failure that happened here, not a proof of rendering — that is what
   E3's behavioural tests and NIVEL 3 are for.

**Blue (evidence for the change):** every claimed invariant above is backed by a
named test in E2–E4 or a mutation in E4; the change is additive at every shared
boundary (`available` optional, three optional `PromptBar` props, one optional
pane prop), so no pre-existing caller changes behaviour; the full suite, both
typechecks, lint and the build are green with a fully accounted +3/+12 delta.

**Discrepancies:** none unresolved. One honest **coverage** discrepancy stands:
the batch makes two of the three voice paths reachable and does not touch the
third.

## 7. Recommendations re-examined (contract §3)

| Item | Classification | Reason |
| --- | --- | --- |
| **A2c** — "wire `ResponsePlaybackTransport` into the reply path with `mode: 'completed'`" | **Rechazada tal como está escrita; pendiente de decisión** | VOX-A2C-01 (§2): completed mode emits one fragment per reply, which breaks the 4096-char provider split and the 1200-char pagination the production path depends on. The transport's remaining advantages over the path that already runs are small: `ReadingController` is already strictly serial (`startNext` guards on `this.active`), already awaits the acknowledged `PlaybackBroker.play`, and already cancels per reading id. Its unique contribution is **measured-duration accounting**. |
| The scheduler + transport pair itself | **Vigente, but for A3b, not A2c** | In *incremental* mode each dispatch is a bounded `SentenceStream` sentence, so provider limits and the single playback slot are exactly right. That is where the pair belongs, behind A3a consent. |
| VOX-U2/U3 marked "IMPLEMENTED & RENDERER-VERIFIED" in `docs/technical-debt-audit.md:104` | **Obsoleta con evidencia** | True of the component, false of the product (VOX-REACH-01). The claim is corrected by this checkpoint and by the reachability control. |
| `docs/landscape/PROGRESS.md:95` — "`AgentTerminal` … stays for now … removing it is a separate clean-up" | **Vigente, consequence now recorded** | The clean-up was never the risk; building new features on the orphan was. `TerminalSession.tsx` and `AgentTerminal.tsx` remain in the tree with their tests and are still the home of the reply reader. |
| A3a/A3b, A5a, A6a/A6c, A7a/A7b | **Pendientes** | Untouched by this batch; A5a is now materially closer (dictation reaches the reviewed submission path in the real surface). |

## 8. Residual risk and next batch

**Not covered / still open:**
- **The agent → user half is still unreachable.** `OwnedReplies` is driven by
  `useAgentSession`, which only the orphaned `TerminalSession` uses.
- No Electron, no microphone, no real Whisper model, no audible playback, no
  latency measurement, no cross-platform evidence. `wos:open-rail` navigation
  from a confirmed voice command has never been observed in a running app.
- Dictation is still **push-to-talk with whole-utterance transcription**; there
  are no partials (A6c), no AudioWorklet capture (A6a), no barge-in (A7).
- Voice commands remain navigation/focus only. Nothing reaches an agent, changes
  a grant, toggles Safe/Full or confirms an HITL dialog — by design, unchanged.
- 178 unguarded IPC channels at the inherited count, Office residual, LOK
  lifecycle, dependency advisories (35/40 moderate): untouched.

**Next batch (VOX-REACH-04) — entry conditions:** make the completed-reply
reader reachable from the production pane, without re-mounting
`TerminalSession`:
1. Bind `OwnedReplies` to the `lib/sessions` run lifecycle used by
   `sessionStore.send`, not to `useAgentSession`; the consent dialog, the frozen
   config snapshot and the per-tab reservation contract must stay exactly as
   `speech/handlers.ts` enforces them.
2. Prove: consent is per tab and revocable; a hidden or closed tab stops its own
   pending/playing replies and nothing else; a failed or cancelled run is never
   read; Voice Stop never cancels the agent.
3. Extend `src/voice-reachability.test.ts` with the reply-reader modules so the
   third path cannot be orphaned the same way.
4. RED → FIX → GREEN, mutation, all gates; NIVEL 2 required, NIVEL 3 still open
   for a device session.
