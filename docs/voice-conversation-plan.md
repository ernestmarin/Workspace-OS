# Native, local-first voice conversation: atomic implementation plan

Post-PR #16 decision: the renderer observer now receives only accepted response transitions. Next validate A2b at the playback acknowledgement boundary before A2c; no live audio acceptance. [Current checkpoint](HANDOFF.md).

Last reviewed: **2026-11-20**, response-provenance/U1 foundations from WOS
`73e32d4` (merged PR #8; earlier checkpoints below remain historical).
**Product goal: a fully real-time voice-managed WOS interface and voice
conversation with the selected existing agents, preserving their conversation,
context, grants, Safe/Full mode, MCP, review and visual action approvals.**

Status: in progress. This is not yet a working voice conversation. The existing CopySpeech-derived reading feature is distinct from this work.

The [Hugging Face reference review](#hugging-face-speech-to-speech-reference-review-2026-11-20)
records the pinned upstream checkout, adoption decisions and next atomic gates.
The native sentence assembler is still **unwired to incremental audio**. A new
conservative prose extractor protects completed-reply reading, now connected to
consent-scoped tab/run ownership. See the [current checkpoint](#response-provenance-and-interface-proposals-checkpoint-2026-11-20)
for implementation and validation; PR #8 ownership and post-PR #6 audit evidence below are historical.
Neither continuous listening nor voice-interface command execution is enabled.

También se han portado componentes internos de CopySpeech: sanitización de texto, paginación, estructuras de captions y orquestación de lecturas. Que existan esos componentes **no significa** que todas sus funciones estén conectadas a la interfaz.

## Constraints and architecture
- Electron/TypeScript owns orchestration and permissions. Do not add a Pipecat Python sidecar. Existing optional local TTS child processes remain separate and must not be mistaken for a validated offline conversation.
- Prefer local VAD, STT, TTS and local-capable models. Never silently send audio or text to a remote provider; disclose destinations and require opt-in. Do not promise offline operation until every active component is local and verified.
- The selected WOS agent and conversation remain authoritative. Voice must not replace their context, grants, approvals, MCP connectors or audit/review paths. No extra LLM postprocessing.
- Pipecat/LiveKit features are behavioral goals, not a claim of parity or a requirement to import either. A future optional transport must prove value without changing these constraints.

## Progress
- Turn lifecycle foundation exists as a pure, tested state machine; it is not wired to audio or the UI.
- Agent bridge has typed assistant-text events for Claude and Codex, separate from terminal output. Reviewed dictation uses the normal existing submission path after the user presses Send; automatic finalized-turn submission and continuous playback integration remain unimplemented.
- Agent terminal has a native-consent, per-tab completed-run reader with a frozen engine/voice/config snapshot. Disable, tab switch, PTY mode, hidden document and unmount revoke its pending/playing replies, not agent actions or unrelated readings. Speech-only Stop preserves consent for future runs. OpenAI text transmission is disclosed; no PTY reading, streaming or microphone is enabled.
- Experimental offline-only Whisper STT worker and restricted IPC exist. It expects a manually provisioned compatible quantized Transformers.js model; model compatibility and real transcription have not been validated. No automatic model download.
- Native per-request microphone consent and a time-limited, audio-only main-frame permission gate exist. An experimental push-to-talk UI captures up to 30 seconds in a selected language for offline transcription, then places the result in the input for review; it does not send automatically. Browser guests remain denied. This policy and recording flow have not been validated in real Electron.
- Dictation can optionally stop after local energy-based silence detection; this heuristic is off by default and manual stop remains available. It is not a trained VAD and requires real-device tuning.
- Dictation controls offer English, Arabic, German, Spanish, French, Hebrew, Hindi, Russian and Chinese, with RTL scoped to the control for Arabic/Hebrew. Diagnostic errors and native consent remain English; other Voice panels are not localized yet. Selecting a language does not validate model support.
- Permission prompts/grants and STT cancellation have request identities so stale tab cleanup cannot revoke a newer request. Tabs share a trusted renderer; these identities prevent lifecycle races, not a security boundary against compromised renderer code.
- Dictation discards capture on page hide/visibility loss and microphone track end, detaching listeners, closing its decoding context promptly and cancelling its own transcription. Simulated renderer tests cover these paths; OS/Electron behavior still needs real-device validation.
- Dictation offers per-tab microphone selection and explicit metadata-only refresh. It requests the exact selected device, never silently falls back if it disappears, and ignores stale enumeration/recording callbacks. Device IDs/names are not persisted. Real Electron enumeration/permission behavior remains unvalidated.
- Renderer playback now cleans up on cancel, failure and unmount, tolerates already-stopped/closed resources and ignores stale audio callbacks. These are simulated Web Audio tests, not real-device verification.
- Individual reading IDs can be cancelled through authorized IPC; Voice settings provide stop-current and stop-all. Completed-run reservations now own cancellation through playback drain; response-level incremental scheduling and automatic interruption remain pending. Audio Stop never cancels the agent.
- Optional, off-by-default one-fragment TTS lookahead overlaps synthesis with playback and aborts on stop/failure. It does not stream agent tokens or audio, and may send the next fragment early to a selected cloud TTS provider. Real latency and audio behavior are unmeasured.
- A1a response event contracts and A1b's optional Codex sink path now exist, with bounded generation/run outcomes. Main IPC, preload, renderer ownership consumption and Claude's new adapter are still open; the normal reader still uses completed-run flattened text.
- U1 can propose five reversible navigation/focus IDs from exact finalized es/en text in explicit command mode. It is a pure helper, not a wired interface-control feature or action permission.
- No real microphone or end-to-end conversation has been validated.

## Response provenance and interface proposals checkpoint (2026-11-20)

**End-to-end A1c/A1d completed-mode provenance, Piper/verifier foundations, and U1–U3 visually confirmed interface commands implemented and unit/integration-verified; no real-device/Electron GUI acceptance claimed.**

- A1a: [shared discriminated events](../src/shared/agentRun.ts) carry WOS session /
  run / launch epoch, provider session/turn, response ID, sequence and outcomes.
  Runtime guards check shape, not authorization or chronological acceptance.
- [AssistantResponses](../src/main/agent/assistantResponses.ts) separates item
  generation from run completion; neither means playback drain or heard text.
  Bounds: 256-unit identities, 128 response IDs including completed tombstones,
  20k UTF-16 per delta and 100k cumulative text. Overflow seals this voice source
  without truncating a chunk; consumers must discard/cancel only its owned speech,
  never the agent or its actions. An unclosed item stays `incomplete` on run success.
- A1b/Codex & A1c/Claude: Codex `RunSink.assistantResponse` binds after RPC
  responses establish thread/turn; [ClaudeAssistantResponses](../src/main/agent/claudeResponses.ts)
  wires Claude `stream-json` lifecycles (`system`/`init` & `result` `session_id`,
  pre-`session_id` bounded queue, `content_block_*` prose deltas, `parent_tool_use_id`
  subagent exclusion, and final-only `result` fallback) in [launchRun.ts](../src/main/agent/launchRun.ts).
- A1d.1–A1d.3 end-to-end provenance: [handlers/agent.ts](../src/main/handlers/agent.ts)
  mints a per-launch `responseOwner` epoch returned in `AGENT_RUN` acknowledgement,
  binds `AGENT_ASSISTANT_RESPONSE` strictly to the originating `sender.id` +
  `senderFrame.routingId` (cancelling in-flight runs on reload/navigation/destroy),
  validates payloads via `isAssistantResponseEvent` in [preload](../src/preload/index.ts),
  and consumes owned responses in [responseConsumer.ts](../src/renderer/src/components/AgentTerminal/responseConsumer.ts)
  and [useAgentSession.ts](../src/renderer/src/components/AgentTerminal/useAgentSession.ts)
  while preserving legacy fallback when `responseOwner` is absent.
- A2/A3 helper & A4 foundations: [ResponseSpeechScheduler](../src/shared/speech/responseScheduler.ts)
  combines `AssistantProseCollector` + `SentenceStream` with barge-in epoch fencing
  (completed-run mode remains the default UI reader); [modelManifest.ts](../src/shared/speech/modelManifest.ts)
  and [modelVerifier.ts](../src/main/speech/modelVerifier.ts) enforce offline SHA-256
  model verification; [engines/piper.ts](../src/main/speech/engines/piper.ts) adds
  Spanish/multilingual local ONNX TTS; [engines/process.ts](../src/main/speech/engines/process.ts)
  adds Windows `taskkill.exe /PID <pid> /T` escalation.
- U1–U3 reviewed interface commands: [proposal helper](../src/shared/speech/interfaceCommands.ts),
  one-shot [InterfaceCommandController](../src/renderer/src/components/AgentTerminal/interfaceCommandController.ts)
  (15s TTL, context/tab/epoch invalidation), explicit `'dictate' | 'commands'` selector in
  [VoiceDictation.tsx](../src/renderer/src/components/AgentTerminal/VoiceDictation.tsx),
  and accessible visual confirmation banner (`Confirm command` / `Dismiss`) in
  [TerminalSession.tsx](../src/renderer/src/components/AgentTerminal/TerminalSession.tsx).
  Ordinary dictation remains draft-only; commands never auto-execute without visual confirmation.
- Validation evidence: **48 focused voice/agent/preload/security files (`420` tests) pass**;
  full repository suite **329 passed / 0 failed / 3 skipped files (`3,596` passed / `26` skipped tests)**.
  `npm run typecheck` passes with **0 known errors (baseline 0)**; `npm run lint` (`0` errors)
  and `npm run build` pass. `npm audit` has **0 critical and 0 high** vulnerabilities
  (`35` prod / `40` total moderate advisories gated on upstream majors). Real Electron GUI,
  microphone/speaker hardware, and live Whisper/Kokoro/Piper weight inference remain unvalidated in this sandbox.

## Completed-run ownership checkpoint (2026-11-20)

Historical merged PR #8 evidence; implementation remains, latest validation is above.
**Implemented and wired, not real-device accepted.** This is a bounded A2
prerequisite brought forward for the existing completed-run mode, not completion
of A1/A2 response-owned realtime scheduling or the product goal.

- The narrow [shared contract](../src/shared/speech/replies.ts) and typed preload
  expose open/reserve/finish/close only, not executable/config/key payloads.
  [Main sessions](../src/main/speech/replies.ts) bind opaque IDs to a document;
  these are lifecycle guards within a trusted renderer, not tab security isolation.
- Cancel-default native consent names the approved engine/voice and OpenAI text
  transmission or unsandboxed local-command networking. Engine, voice and config
  are frozen until off/on; future settings changes cannot silently redirect replies.
  Replies queue behind unrelated speech; there is no engine fallback.
- Limits: 8 sessions, 8 global reservations including normal playback drain,
  20,000 UTF-16 text units and the approved trigger limit. Text completion is
  single-use; validation/enqueue failure also releases its reservation.
- [OwnedReplies](../src/renderer/src/components/AgentTerminal/ownedReplies.ts)
  guards opt-in epochs, delayed consent/reservation acknowledgements and stale
  results. The [existing hook](../src/renderer/src/components/AgentTerminal/useAgentSession.ts)
  reads only successful owned runs, never via global Speak. Failure, cancel,
  overflow or ambiguous prose discards speech; terminal/context/grants stay intact.
- Disable/tab deactivation/PTY/hidden/pagehide/unmount close owned pending and
  playing replies. Clear/model/persona changes discard current reply work.
  **Stop reply audio** stops only current owned work, keeping future consent;
  the existing **agent Stop** still deliberately cancels agent runs.
- New [session tests](../src/main/speech/replies.test.ts),
  [renderer races](../src/renderer/src/components/AgentTerminal/ownedReplies.test.ts),
  [hook integration](../src/renderer/src/components/AgentTerminal/useAgentSession.voice.test.tsx),
  [tab controls](../src/renderer/src/components/AgentTerminal/TerminalSession.voice.test.tsx),
  [preload mapping](../src/preload/speech.test.ts) and expanded IPC tests cover these
  paths. Behavioral RED: 7 failed/9 passed before integration/epoch fixes; a
  separate rejected-completion regression failed before the reservation-leak fix.
- Final focused run: **330 passed / 39 files**. Full comparison: **3,170 total;
  2,876 passed / 267 failed / 27 skipped; 319 files, 41 failed**. Baseline was
  2,831 passed / 267 failed / 27 skipped in 314 files: **45 new passing tests**,
  no new failed test identities/files; same 26 Electron and 15 native-binding
  unavailable files. The full suite is still not green.
- Typecheck passes the unchanged **70-known-error baseline**; build and diff
  checks pass. No dependency/model changes. Production audit still reports
  **19 high + 67 moderate** entries. CLI security scan was reattempted (3.79.1,
  exit 1 at ONNX 1.30.0 bootstrap); **no source report**, not security approval.
- No real microphone, speaker, model, provider, Electron or platform acceptance.
  `launchRun` still flattens response/item identity: A1 remains next. No trained
  VAD, streaming STT/TTS, duration backpressure, continuous conversation,
  rendered-progress/heard-context accounting or full-duplex barge-in is claimed.

## Red-team audit after PR #6 (2026-11-20)

Historical merged PR #7 checkpoint; superseded by the completed-run increment above.

**Verdict: useful experimental foundations, not “fully audio managed” or real-time
conversation. No security/release acceptance.** Scope: source tracing plus
adversarial regressions across IPC/document lifetime, microphone grants, local
STT, subprocesses/config/secrets, synthesis/PCM playback, assistant provenance,
reply buffering and capture/device cleanup. No real audio/model/provider/Electron
execution was available. Severity below is engineering triage, not a CVSS claim.

### Reconciliation with the unfinished PR #5 inventory

| PR #5 remaining item | Actual post-audit position |
| --- | --- |
| Continuous conversation in the selected WOS session | Still open. Manual review-first dictation reaches the existing input/submit path; no parallel LLM/history or action executor was added. The pure turn machine remains unwired. |
| Streaming STT/TTS, trained VAD, barge-in, per-session playback | Still open. PR #6 added sentence assembly; this increment adds conservative incremental **text** extraction. Batch lookahead is not streaming. Document-scoped teardown now exists, but per-tab/run/response audio scheduling and cancellation do not. |
| Whisper/Kokoro verification and readiness | Still open. Kokoro now refuses missing/empty default prerequisites before spawn and constrains default uv downloads. Hashes, licenses, actual loading/inference and offline behavior remain unverified. The bundled Kokoro wrapper is **English-only**, not a Spanish local TTS solution. |
| CopySpeech selection/highlights, HUD/tray, history/exports/controls/engines | Still open except already implemented page/clipboard/manual reading, opt-in hotkey, Speak/Stop, lookahead and reading-ID cancellation. Config flags/caption types do not implement the other surfaces. |
| Localization/RTL, real audio/Electron/platform/security validation | Nine dictation control locales and scoped ar/he RTL only. Diagnostics/native consent/other panels remain incomplete. No device, language-quality, duplex, latency or release evidence. Dependency findings below also block security acceptance. |

### Reproduced defects and bounded fixes

Tests were added and observed failing before the corresponding fixes; the current
regressions are linked below. These fixes do not complete the open features.

| ID / priority | Before → now; evidence and limits |
| --- | --- |
| R1 / high: document ownership | Pending synthesis survived reload/crash/close and playback resolved the **new** current window. Same-URL native approval could survive reload. [Handlers](../src/main/speech/handlers.ts) now capture document context per reading, reject stale main-frame objects and cancel synthesis/queued readings/PCM/STT/grants/setup on document loss; late results are not forwarded to replacement windows. [Lifecycle tests](../src/main/speech/handlers.test.ts) simulate reload/crash/destroy, delayed synthesis/consent and stale acknowledgements. Not per-tab ownership or native Electron proof. |
| R2 / high: event provenance/success | Codex accepted missing thread IDs and stale same-thread turn completion, could change the steer target from a notification, suppress fallback on an empty delta and accept late item deltas. [Session code/tests](../src/main/agent/providers/codexSession.test.ts) now require response-established thread/turn IDs, bound/filter early notifications, close completed items and treat an error-bearing completion as failure. [Claude tests](../src/main/agent/assistantText.test.ts) verify terminal results also close its speech source. No heuristic deduplication of identical live deltas. |
| R3 / medium: orphaned children | Killing only the local wrapper left its descendant running; installer escalation was also cleared when the wrapper closed. Shared [batch process lifecycle](../src/main/speech/engines/process.ts) owns/reaps a POSIX group on close/cancel/timeout. A [real Linux Node-process regression](../src/main/speech/engines/local.test.ts) includes a SIGTERM-resistant descendant. Windows still kills only the direct child; self-detaching/malicious executables are not sandboxed. |
| R4 / medium: credential inheritance | Local synthesis inherited obvious provider keys even though the installer filtered them. Both now use the same filtered child environment; a real child-process regression verifies a fixture OpenAI key is absent. This is defense in depth, not exhaustive secret isolation or a filesystem/network sandbox. |
| R5 / medium: setup policy/races | A wrapper alone passed the Kokoro guard; no-sync alone did not prohibit Python downloads, and setup could overlap synthesis or a queued reading. [Guard tests](../src/main/speech/engines/kokoro.test.ts), [dispatch tests](../src/main/speech/engines/index.test.ts) and [IPC tests](../src/main/speech/handlers.test.ts) now check all five nonempty prerequisites, default uv no-sync/offline/no-python-downloads and mutual exclusion at actual synthesis time. Flags constrain uv, not arbitrary library networking. Still not integrity/readiness. |
| R6 / medium: spoken representation | Reply buffers previously forwarded raw Markdown, including unterminated code, to the reading sanitizer. [AssistantProseStream](../src/shared/speech/assistantProse.ts) now buffers stable blocks, removes supported code/images/link destinations and fails closed on ambiguous inline markup/HTML. [Reply buffers](../src/renderer/src/components/AgentTerminal/spokenReplies.ts) use it but still speak **only after successful completion**. No streaming audio activated. |

Codex identity fields were cross-checked against commit
[`9f2b8749` protocol definitions](https://github.com/openai/codex/tree/9f2b87495bf979f6c1953cf00c98143981664914/codex-rs/app-server-protocol/src/protocol/v2)
(`item.rs`, `turn.rs`, `thread.rs`); actual installed CLI/provider integration is
still an untested compatibility gate. No upstream runtime code was copied.

### Text increment and remaining limitations

- [30 extractor regressions](../src/shared/speech/assistantProse.test.ts) cover
  every two-way split of a mixed fixture, code-unit deltas, split delimiters and
  surrogate pairs, CRLF at exact buffer limits, chunk-invariant overflow, nested
  link destinations/titles, fences/false closers,
  failure/cancel/late data, limits and composition with `SentenceStream`.
- Extraction waits for a blank line or explicit success; it is deliberately not
  token-latency speech or a complete CommonMark parser. It omits tables,
  quoted/indented blocks and images; ambiguous inline syntax/raw HTML disables
  that reply's reading rather than guessing. Manual text/page reading is unchanged.
- Defaults: 4,096 retained UTF-16 units and 20,000 cumulative raw units (including
  skipped code), hard configurable total cap 100,000. No silent truncation.
  Terminal text is untouched. Sentence spans after composition address extracted
  prose, **not original Markdown**; source-aligned highlighting remains open.
- Earlier emitted text cannot be recalled. Any future live consumer must cancel
  its owned downstream synthesis/playback on failure; do not wire this helper to
  repeated global `speak()` calls. Config/remote-consent snapshots, delayed IPC,
  tab switching, playback drain and heard-vs-generated accounting remain gates.

### Validation for the post-PR #6 audit

- Focused voice/agent regressions: **285 tests passed in 34 files**. This
  includes text/IPC fixtures, simulated Web Audio and real Linux Node subprocesses,
  not microphone/speaker/model or provider tests. Reproduce with the
  [checklist command](voice-integration-checklist.md#release-validation--all-still-required).
- Final repository-wide run: **3,125 tests; 2,831 passed, 267 failed, 27 skipped**;
  **273/314 files passed**, the same **41 failing files** as before edits:
  26 Electron-unavailable and 15 native-binding-unavailable. The pre-edit baseline
  was 2,780 passed / 267 failed / 27 skipped in 313 files. No new failed files
  or changed failure categories; **51 additional passing tests**, not a green
  full suite. Full command: `npm test -- --maxWorkers=2`.
- Final `npm run typecheck` passed with the unchanged **70-error baseline**;
  `npm run build` passed with Vite/plugin deprecation and marked chunking warnings.
  Build artifacts/dependencies were not added to this change. `git diff --check`
  passed and **45 local documentation targets/anchors** resolved.
- `npm audit --omit=dev --json` reported **86 dependency entries: 19 high,
  67 moderate, zero critical**. In the voice dependency chain,
  `@huggingface/transformers@3.8.1 → sharp@0.34.5` is flagged high
  ([registry advisory example](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)).
  Reachability through PCM-only STT was not established. The suggested
  Transformers 4.3.2 change is major; do not blindly force-upgrade a native/model
  runtime. Dependency remediation/packaging regression is an explicit release
  blocker. This report is neither a clean security scan nor 86 proven exploits.
- The required `npx @claude-flow/cli@latest security scan` was attempted
  (resolved CLI **3.79.1**, exit 1). Its npm bootstrap failed at
  `onnxruntime-node@1.30.0` postinstall after native optional-dependency failures;
  **no source scan report was produced**. Re-run it in a suitable environment;
  neither this failed attempt nor npm audit satisfies the final security gate.
- Dependencies used the existing legacy-peer/ignore-scripts installation path.
  Full-suite imports attempted Electron binary setup and failed; native modules
  remain unavailable. No uv execution, model installation, credentials or real
  recording/provider exercise. The source audit does not substitute for a
  penetration test, trained-VAD/AEC validation or fresh-install OS/Electron E2E.

## Stages and gates
1. **Turn lifecycle foundation.** Define a framework-independent, bounded, testable state machine for opt-in sessions, finalized transcripts, run ownership, output, interruption, stop, stale events and errors. No microphone, network, tools, or audio capture in this stage. Test race cases and fail-closed behavior.
2. **Agent bridge.** Extract structured assistant-only events across supported providers, connect finalized transcripts to the selected existing WOS conversation, preserve context/grants/review/approval, and define cancellation vs stopping playback. Do not speak terminal warnings, tool payloads or stale runs. Test concurrent sessions and provider failures.
3. **Audio permissions and UI.** Narrowly authorize microphone for the trusted app frame after explicit user action; deny webview access. Add accessible listening/muted/error indicators and device selection. Stop tracks on mute, window close and errors. Test Electron permission and lifecycle paths.
4. **Local-first VAD and STT.** Evaluate and select supported TypeScript/native local models and runtimes, license/size/language/platform requirements and model provenance, integrity and installation consent. Implement bounded audio streaming, interim/final events, endpointing, configurable push-to-talk fallback, resource limits, offline behavior and cleanup. Cloud providers only with explicit opt-in.
5. **Speech output and barge-in.** Connect assistant-only text to current speech controller; incremental sentence aggregation, bounded queues, cancellation/flush, playback synchronization and audible-spoken vs generated context. Evaluate low-latency local TTS, preserve existing voices; no implicit downloads.
6. **Full conversation and commands.** Unify session controls, context and existing MCP/actions; per-operation permissions and explicit visual approval for high-risk actions. Handle background progress, long runs, switching agents, reconnection, errors and interruption without repeating side effects.
7. **Measurements and product integration.** Benchmark Spanish and supported languages on target devices: STT final, agent first token, first audible audio, barge-in, false activation, resource use. Test actual microphone/speaker and offline paths; update HUD, accessibility and privacy settings.
8. **Release gate.** Cross-platform fresh-install Electron E2E with actual models and audio, permissions, sleep/restart, recovery and security red/blue review; fix and repeat. Record unavailable environments and never claim tests passed when mocked.

Each stage: implement, review adversarially, add regression tests, run relevant checks, commit a logically bounded change. Do not treat a completed foundation as production readiness.

## Implementation inventory (2026-11-19)

Consolidated historical inventory; use the [current checkpoint](#response-provenance-and-interface-proposals-checkpoint-2026-11-20)
and [full checklist](voice-integration-checklist.md) for current evidence/open work.
Implemented helpers are not release acceptance.

### CopySpeech-derived reading foundations
- Ported contracts/defaults, sanitization, pagination, UTF-16 spans and caption
  data; visible captions/highlights and other flags are not working features.
- Config is validated/atomically persisted under `userData/copyspeech`, malformed
  files preserved, known credential/template risks rejected, keys vault-backed.
  Full credential/config migration and non-destructive recovery remain open.
- Batch OpenAI/local WAV, bounded queue, acknowledged PCM, manual/page/clipboard
  Speak/Stop and opt-in shortcut exist. Lookahead prepares at most one fragment,
  off by default; cloud text can be sent early. Not measured token/audio streaming.
- Kokoro wrapper/project can be staged without overwrites and dependencies set
  up with explicit opt-in uv; weights/manual prerequisites, integrity, licensing,
  actual inference/offline behavior and platform packaging remain unverified.

### Agent and capture work
- Existing selected agent/context/grants/review are retained. PR #8 added owned
  completed-run reading; pure turn lifecycle and sentence helpers are not realtime.
- Offline-only Whisper worker, scoped IPC and review-first push-to-talk capture
  up to 30 seconds at 16 kHz exist. Presence checks do not establish compatibility.
- Request-owned cleanup covers tab/hidden/pagehide/track/disconnect/error paths;
  RMS silence is optional, not trained VAD. No background listening or auto-submit.
- Nine dictation control locales (en/ar/de/es/fr/he/hi/ru/zh), scoped ar/he RTL,
  exact per-tab microphone selection and refresh exist; no silent fallback or
  device-ID persistence. Other panels/errors/native consent remain incompletely localized.

### Validation and unresolved work
- Historical inventory evidence was 170 tests/26 files, baseline-70 typecheck and
  build; not devices/models/providers/Electron. Current evidence is linked above.
- All unchecked streaming, trained VAD, barge-in/heard-context, local-model,
  CopySpeech UX/engines, localization, platform and security gates remain open.
- Exclusions: no added Python sidecar, browser extension/native host, extra LLM,
  telemetry, CopySpeech updater, Windows ducking, edge-tts or landing/web routes.
- Hotkey/tray are opt-in; macOS tray must use a speaking/paused template icon;
  speaking HUD stays above windows. WAV export, conditional system-ffmpeg MP3/OGG
  and existing Electron updater only. Each surface needs its own implementation.
- Final real Electron/device/platform and red/blue security acceptance must be
  repeated after integration. No Pipecat/LiveKit parity claim without measurements.

## Hugging Face speech-to-speech reference review (2026-11-20)

### Provenance and scope

- Repository: [huggingface/speech-to-speech][hf-root]. Reviewed revision:
  **`7dbbdaff5774ca657deed1900814763e1f6d87d5`**, dated 2026-11-19.
- Cloned into `.cache/reference-repos/speech-to-speech` as an ignored, disposable
  reference checkout, not a WOS dependency, submodule or shipped asset. WOS's
  test command excludes this cache so upstream demo tests are not accidentally
  collected as WOS tests. No upstream installers, servers or model downloads ran.
- The upstream code is [Apache-2.0][hf-license]; WOS is MIT. This checkpoint
  studies architecture, not a source-code port. Any future copied/adapted source
  needs the appropriate license/attribution notices; model weights, runtimes and
  extras require their own provenance, redistribution and hardware review.
- Upstream's quickstart is a Python cascade with its own LLM and model downloads.
  Installing it wholesale would conflict with WOS's native orchestration and
  selected-agent authority. **No new Python sidecar or second agent conversation.**

To recreate a missing cache at the reviewed revision (all `-C` operations below
are inside the reference repository, not the WOS working branch):

```sh
git clone --depth 1 --no-checkout https://github.com/huggingface/speech-to-speech.git .cache/reference-repos/speech-to-speech
git -C .cache/reference-repos/speech-to-speech fetch --depth 1 origin 7dbbdaff5774ca657deed1900814763e1f6d87d5
git -C .cache/reference-repos/speech-to-speech checkout --detach 7dbbdaff5774ca657deed1900814763e1f6d87d5
```

Pinned links below remain the review authority if upstream HEAD changes. A
reference clone is not evidence that its runtime or models work in WOS.

### What to adopt, adapt or leave out

| Upstream evidence | WOS decision and remaining gate |
| --- | --- |
| [Typed pipeline/session ownership][hf-pipeline] | Adopt the separation of capture/VAD → STT → agent → TTS → playback. Use bounded TS/worker adapters, existing `TurnTicket` epochs and explicit run/reading identities, not upstream's Python thread/server architecture. |
| [Sentence batching][hf-sentences] and [multilingual/Markdown handling][hf-text] | Assemble selected assistant prose before TTS, keeping the ambiguous tail. A native prose-only helper now exists (below). Incremental Markdown safety and typed assistant/tool separation must be integrated before any raw stream is spoken. |
| [Generation-scoped cancellation][hf-cancel] | Reject stale text/audio/completions end to end. In WOS, barge-in stops owned speech first; it must not automatically cancel agent tools or repeat their side effects. A generation counter is a lifecycle guard, not authorization. |
| [VAD and turn detection][hf-vad] | Evaluate a licensed local trained VAD with pre-roll, hysteresis, endpointing and distinct interruption thresholds. WOS's optional RMS heuristic is not equivalent. Speech detection alone does not establish user intent or grant permission. |
| [Progressive transcription][hf-stt] | Distinguish revisable partial captions from an explicitly finalized transcript; only a final, owned turn can reach the existing agent submission path. WOS currently transcribes a bounded completed clip, not continuous STT. |
| [PCM framing][hf-pcm] and [playback worklet][hf-playback] | Evaluate bounded transferable PCM queues, negotiated sample rates, resampling, underrun behavior and clear acknowledgements. Record rendered progress separately from generated text/audio; never infer what was heard from bytes received. |
| [Echo cancellation limits][hf-aec] | Test existing browser capture constraints on real Electron/devices; do not assume that requesting echo cancellation prevents self-triggering. Start with push-to-talk/headphones. Do not transplant the Python audio process. |
| [Response latency definitions][hf-latency] | Measure monotonic stage timings locally, without transcript/audio telemetry: end of speech, final STT, agent first text, first speakable sentence, first PCM, renderer playback start and interruption-to-silence. Unavailable timings stay unavailable; generated audio is not audible latency. |
| [Realtime protocol and tool/interruption behavior][hf-realtime] | Treat OpenAI Realtime/WebRTC compatibility as an optional future adapter, not an immediate dependency or proof of WOS-agent compatibility. Do not launch a new listener or reuse upstream's direct tool executor. WOS's existing context, grants, MCP, Safe/Full mode and approval/review remain authoritative. |

The native target remains:

```text
explicit voice-session consent → bounded local capture/VAD → local STT
  → finalized transcript for the selected existing WOS conversation
  → existing agent run / grants / approval / review
  → assistant-only prose → bounded sentence queue → selected TTS → owned playback
```

Separate consent is needed for automatic submission and each remote destination;
local STT does not make a cloud agent/TTS local. Keep transcript review as the
current default, never auto-submit partial recognition or interpret it as shell
commands, and do not add a spoken shortcut around high-risk visual approvals.

### First native increment: prose sentence assembly, not wired

- [x] Add [SentenceStream](../src/shared/speech/sentenceStream.ts), an independent
      TypeScript helper reusing WOS's existing sentence-boundary detector, not a
      translation of upstream Python. One instance belongs to one response.
- [x] Retain an ambiguous final sentence; emit earlier prose when right context
      arrives; keep adjacent closing quotes/punctuation and exact UTF-16 source spans.
- [x] Bound each sentence/tail to 4,096 UTF-16 units and the response to 20,000
      by default. Invalid data/overflow closes the stream without silent
      truncation. Explicit success flushes once; failure/cancel discards the
      tail and late deltas cannot restart it. Previously emitted text cannot be
      recalled, so future integration must cancel owned downstream work too.
- [x] Add [regression tests](../src/shared/speech/sentenceStream.test.ts) for the
      nine requested languages' punctuation, arbitrary delta boundaries,
      surrogate pairs/source spans, limits, cancellation and independent streams.
      These test text structure, not speech-model language quality.
- [x] Add conservative block-stable Markdown/code/link extraction and split
      delimiter tests in the post-PR #6 audit. The completed-reply buffer uses
      it; live sentence/TTS wiring remains open. It is not a complete Markdown
      renderer, provider/tool filter, scheduler or transport.
- [ ] Wire sentence output to authorized TTS/playback with bounded queues and
      per-session/run/response ownership; preserve existing completed-reply mode.
      No new microphone capture, remote calls, agent submission or audio playback
      is activated by this helper, and no latency improvement is claimed yet.

### Next atomic integration gates (in order)

Rows are dependency gates, not permission to enable unvalidated runtime behavior.
R1–R6, conservative extraction, completed-run A2, A1a/A1b adapter fixtures and U1
proposals exist. A1c/A1d remain open; live scheduling must not skip them. Model/
dependency work is a parallel **release blocker**. U is a separate interface-control
track, never a second agent executor. Use the independently testable slices below.

| Gate / state | Bounded change and exit evidence |
| --- | --- |
| A1 — partial: A1c/A1d next | Typed session/run/response/epoch/outcome contract and optional Codex adapter are implemented/tested. Still required: Claude adapter, main-minted owner/dispatch acknowledgement, document-bound IPC/preload and renderer consumption. The current reader still uses flattened completed-run text; no new live audio. |
| A2 — partial; live scheduler blocked by A1 | Completed-run open/reserve/finish/close, native frozen consent, bounded reservations and scoped Stop are wired. Still required: response/epoch-owned scheduling, bounded audio duration, producer backpressure and concurrency. Use only an explicitly consented destination snapshot, never a silent response-start config change. Test late acknowledgements, drain and stale cancellation; never cancel agent tools as an audio control. |
| A3 — blocked by A2: opt-in incremental replies | Connect extracted blocks → sentences → scheduler. Disclose partial speech before run failure and early cloud transmission. Keep completed-reply mode/default and manual Stop. Prove generation completion and audio drain are distinct; a failed turn cannot resume audio. |
| A4 — release blocker: dependencies and local readiness | Triage/patch the audited native dependency chain with packaging tests; pin reviewed model manifests, licenses and hashes, explicit install consent and recovery. Verify actual local Whisper inference and a Spanish-capable TTS adapter (current Kokoro wrapper is English-only). Network-blocked runtime tests, not file flags, establish offline readiness. Test Windows descendant cleanup. |
| A5 — blocked by A1/A2/A4: existing-session turns | Wire finalized, owned transcripts through the current selected-session submission path and turn lifecycle, with separate auto-submit consent and review-first fallback. Preserve context, grants, Safe/Full mode, MCP, review and visual high-risk approvals. No direct transcript-to-shell, new LLM history or spoken approval bypass. |
| A6 — bounded capture/STT | Add AudioWorklet framing/resampling, bounded transfer/backpressure, a reviewed trained local VAD with pre-roll/hysteresis and revisable partial/final STT contracts. Test cancel, disconnect, sleep and permission loss. Only owned final transcripts can reach A5. Push-to-talk remains the fallback. |
| A7 — PCM and interruption | Implement owned bounded PCM queues, clear/drain and rendered-progress acknowledgements; separate generated from heard text. Measure AEC/self-triggering on real speakers/headphones before enabling speech-triggered barge-in. Stopping audio never silently repeats or cancels irreversible agent actions. No full-duplex claim from mic muting. |
| A8 — individual CopySpeech UX increments | Separate changes for browser selection/highlighting, pause/resume/effects, HUD, opt-in tray, history, WAV/conditional-ffmpeg exports and each remaining engine. Each needs tests, cleanup/privacy and user-visible evidence; flags are insufficient. Keep this backlog visible while conversation work advances. |
| U — partial: pure U1 proposals only | Exact es/en grammar and five typed navigation/focus proposals are tested, not wired. U2 visible confirmation/current-context callbacks and U3 finalized capture remain open. No arbitrary menu IDs, shell/tools, LLM routing or spoken approval bypass. Microphone integration also needs A4/A6. |
| A9 — release gate, not yet accepted | Complete nine-locale Voice/RTL/accessibility work and fresh-install Windows/macOS/Linux Electron E2E with actual microphones/models/audible playback. Record Spanish/language quality, STT final/first audible/barge-in timings, resource use and fault recovery. Repeat end-to-end red/blue security review and dependency triage; unavailable platforms remain unchecked. |

#### Atomic execution slices

Keep each slice independently reviewable; a checked pure helper does not check
its later runtime/UI integration. Do not bundle all local-model or capture work
into one change just because it shares a gate.

- **A1a/A1b — implemented at contract/Codex-adapter level only**: bounded source,
  response/run outcomes, replay sealing and RED fixtures. No new dock transport.
- **A1c — next**: pin/verify Claude stream schema; adapt message/block lifecycles
  and final-only compatibility separately, without inventing missing identities.
- **A1d.1**: main mints a per-launch epoch tied to the existing WOS conversation
  and returns the owner in dispatch acknowledgement, not unsolicited push data.
  **A1d.2**: document-bound IPC/preload, bounded early-event buffering, schema /
  sequence / epoch validation and teardown; test same-URL reload and late acks.
  **A1d.3**: owned renderer response assembly in completed mode first; failure,
  incomplete/source-error or stale events discard/cancel only owned speech.
  Prove context/grants/review/terminal unchanged before A2 live scheduling.
- **A2-completed — implemented**: native frozen consent, narrow main/preload,
  delayed-ack lifecycle and completed-reader UI wiring, including scoped Stop.
  **A2a — open after A1**: response-owned bounded queue/duration/backpressure.
  **A2b**: extend the narrow transport for live responses and acknowledged drain;
  **A2c**: wire it without regressing the default completed-run mode.
- **A3a**: add incremental-mode consent and early-cloud/partial-failure disclosure
  with mode off by default. **A3b**: wire prose/sentences through A2, testing
  generation completion separately from drain; retain completed-reply mode.
- **A4a**: dependency advisory reachability/remediation and native packaging tests.
  **A4b**: versioned model/license/hash manifest and verifier tests without downloads.
  **A4c**: explicit, cancellable provisioning/recovery. **A4d**: real local Whisper
  readiness/offline fixture on one OS; repeat each additional OS separately.
  **A4e**: Spanish-capable local TTS adapter plus actual synthesis/language evidence.
  **A4f**: Windows process-tree cancellation with a real descendant regression.
- **A5a**: bridge owned final transcripts to the existing reviewed submission path.
  **A5b**: explicit auto-submit consent/turn-machine wiring only after A1/A2/A4;
  regression-test grants, approvals, failure and session switching.
- **A6a**: bounded AudioWorklet capture/resampling with push-to-talk unchanged.
  **A6b**: reviewed local trained VAD and tests. **A6c**: STT partial/final adapter,
  backpressure and stale discard; partials never submit to the agent.
- **A7a**: bounded owned PCM enqueue/flush/drain protocol and renderer cleanup.
  **A7b**: rendered-progress/heard-text accounting. **A7c**: real AEC/barge-in
  measurements, then separately gated interruption UI; never tool cancellation.
- **A8/A9**: one listed UX surface, engine, locale or platform acceptance run per
  change, each with evidence and its own unchecked remainder. Security and real
  device/model acceptance must pass again after the final integration.

#### Voice-interface command route (separate from agent turns)

- **U1 — implemented, pure only**: finite es/en grammar, finalized/current-context
  proposal, strict limits and rejection tests. No capture, UI or execution wiring.
- **U2a — next, parallel with A1c/A4a**: one-shot visual confirmation controller;
  bound proposal IDs/context/expiry and invalidate on switch/hide/stop. Tests must
  prove no replay, stale confirmation or recognition-as-approval.
- **U2b**: visible preview and existing reversible navigation/focus callbacks in
  the selected WOS context, not arbitrary `menu.runAction`. Recognition never
  executes tools, submits prompts, changes grants/Safe mode or confirms high-risk dialogs.
- **U3 — after U2/A4/A6**: wire owned finalized capture into command proposals;
  verify real Electron/device/es-en behavior and accessibility. Hands-free
  low-risk execution would require separate consent and tests; it is not enabled.

### Validation for the 2026-11-20 reference checkpoint

Historical PR #6 evidence; the post-PR #6 audit above supersedes these totals.

- New text-only sentence-stream suite: **31 tests passed**. The focused suite
  covering shared/main speech, Voice UI, dictation, reply buffers, energy
  endpoint/monitor, voice-language controls, Codex steering/session and provider
  assistant-text extraction passed **208 tests in 29 files**. These totals cover
  that selected suite, not the full repository or the upstream Python tests.
- `npm run typecheck` passes the regression gate with the unchanged **70 known
  baseline errors**; this does not mean the whole repository is type-error free.
- `npm run build` succeeds, with existing Vite/plugin deprecation and chunking
  warnings. No generated build artifacts or reference source are included in
  this change. No dependency versions or model weights were changed.
- Local documentation links/anchors and pinned upstream file references were
  checked. WOS test discovery finds **313 files** with the reference excluded;
  discovering them is not a claim that all those tests ran or passed.
- Installation used `npm ci --ignore-scripts --legacy-peer-deps --no-audit
  --no-fund`: plain `npm ci` hits the existing Vite 8 / React-plugin 4 peer
  conflict. That dependency issue is not fixed here. Npm lifecycle scripts were
  skipped; Electron/native speech-runtime readiness was not validated. No
  upstream Python install, model download or provider-credential exercise ran.
- Real microphone, audible output, models/language quality, cloud providers,
  native packaging, latency, full security audit and Electron/platform E2E
  remain unvalidated. No live or production-ready conversation is claimed.

Re-run the new foundation checks with:

```sh
npm test -- src/shared/speech/sentenceStream.test.ts
npm run typecheck
npm run build
```

## Checkpoint 2026-11-20 (b) — A2a and A4c

**A2a — response-owned backpressure (implemented, 12 tests).** The scheduler now
carries an explicit `BackpressurePolicy`:

| Field | Behaviour |
| --- | --- |
| `backpressure: 'hold' \| 'quarantine'` | `'quarantine'` (default, unchanged for existing callers) discards overflow; `'hold'` parks it under a bound of `maxQueuedSentences * 2` so a slow consumer cannot grow the queue without limit. |
| `onBackpressure` / `onQuarantine` | The caller learns which happened, instead of inferring it. |
| `spokenSentences` / `discardedSentences` | Honest accounting in `state()`. `stop()` discards **queued** sentences only; the in-flight fragment is cancelled and is never counted as spoken. |

**A4c — model integrity states (implemented end to end, 23 + 4 + 4 tests).**
`classifyModelReadiness` / `recoveryHints` / `buildModelDiagnostic` /
`verifyReviewedSpeechModels` reuse the previously uncalled
`verifyModelArtifacts`. States: `verified_offline | unverified_files_present |
corrupt | missing | invalid_location`. `ready` is true only for
`verified_offline`, so no caller can infer readiness from file existence. Wired
through `speech:model-diagnostics` (main-frame and owner checked; directories
resolved in main, never in the renderer), preload, renderer type mirror, and a
Voice settings panel with explicit Verify, per-state recovery hints and a
`checkedAt` stamp. Recovery never downloads, deletes or modifies.

**The limitation this exposes, kept visible.** Every `REVIEWED_SPEECH_MODELS`
entry has `expectedSha256: null`, so **no local engine can reach
`verified_offline` today**; the truthful state is `unverified_files_present` and
the UI says "files present, NOT verified — local speech stays off". Writing the
UI test found a real defect on the way: the mount-time fetch swallowed its error,
so an unreadable model folder looked like "nothing to report". Fixed in the
component.

**Still blocked, unchanged:** A1c (Claude adapter) → A1d (main-minted owner
epoch, document-bound transport) → **A2b/A2c** (live transport and wiring). An
in-process scheduler with a backpressure policy is not a live transport, and the
completed-run reader remains the default.

[hf-root]: https://github.com/huggingface/speech-to-speech/tree/7dbbdaff5774ca657deed1900814763e1f6d87d5
[hf-license]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/LICENSE
[hf-pipeline]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/src/speech_to_speech/api/openai_realtime/pipeline_unit.py
[hf-sentences]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/src/speech_to_speech/LLM/language_model.py
[hf-text]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/src/speech_to_speech/LLM/utils.py
[hf-cancel]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/src/speech_to_speech/pipeline/cancel_scope.py
[hf-vad]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/src/speech_to_speech/VAD/README.md
[hf-stt]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/src/speech_to_speech/STT/smart_progressive_streaming.py
[hf-pcm]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/src/speech_to_speech/TTS/pcm_blocks.py
[hf-playback]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/demo/worklets/audio-playback.js
[hf-aec]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/docs/echo-cancellation.md
[hf-latency]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/docs/response-latency.md
[hf-realtime]: https://github.com/huggingface/speech-to-speech/blob/7dbbdaff5774ca657deed1900814763e1f6d87d5/src/speech_to_speech/api/openai_realtime/README.md
