# Voice implementation plan & integration checklist

Last reviewed: **2026-11-20**, end-to-end A1c/A1d provenance, U2/U3 visual command
confirmation, Piper Spanish/multilingual TTS adapter, offline SHA-256 model
verifier, and zero-error TypeScript/test/high-advisory remediation on top of
merged PR #8 (`73e32d4`), retaining the earlier unfinished-work inventory.

This checklist combines the TTS foundations from PR #3 with the newer
experimental dictation, assistant reply, interface command, and playback work. For the detailed
atomic conversation plan, pinned Hugging Face reference review and status, see
[voice-conversation-plan.md](voice-conversation-plan.md).

**Current position: batch text-to-speech (OpenAI, Kokoro EN, Piper ES/multilingual),
end-to-end provenance-owned completed-reply reading, experimental push-to-talk
dictation, and visually confirmed es/en interface commands are implemented in code
and unit/integration-verified; continuous real-time conversation and real-device
Electron E2E are not yet implemented or production-ready.**

Checked items indicate implemented code, not release acceptance. Latest evidence
is in the
[current checkpoint](voice-conversation-plan.md#response-provenance-and-interface-proposals-checkpoint-2026-11-20);
PR #8 ownership, post-PR #6 audit and PR #6 checkpoint totals are historical. No real audio, cloud-provider,
Electron GUI E2E or cross-platform hardware validation is claimed. Full Node/jsdom Vitest
(`329` passed / `0` failed / `3` skipped files; `3,596` passed tests), strict TypeScript
(`0` errors, baseline `0`), and `0` critical / `0` high `npm audit` gates are green
(`35` prod / `40` total moderate advisories remain major-gated).

_Updated 2026-11-20 (b):_ Node/jsdom Vitest is now **341 passed / 3 skipped files,
3,725 passed / 26 skipped tests**; ESLint `src` is **0 errors / 0 warnings**;
A2a and A4c are implemented and verified as described in the increment below.

## Increment 2026-11-20 (b) — A2a backpressure, A4c model integrity

- [x] **A2a — response-owned backpressure and honest accounting.** The reply
      scheduler gained a `backpressure: 'hold' | 'quarantine'` policy (default
      stays `'quarantine'`, so existing callers are unchanged), a held-queue
      bound of `maxQueuedSentences * 2`, `onBackpressure` / `onQuarantine`
      callbacks, and `spokenSentences` / `discardedSentences` counters in
      `state()`. `stop()` discards **queued** sentences only: the in-flight
      fragment is cancelled, and it is never counted as spoken. 12 tests,
      including the case where a stopped reading must not report speech that was
      never heard.
- [x] **A4c — artifact-level model integrity states.** `ready` is true **only**
      for `verified_offline`, which requires a full SHA-256 match on every
      reviewed artifact; presence alone can no longer read as ready, in the data
      or in the UI. States: `verified_offline | unverified_files_present |
      corrupt | missing | invalid_location`, each with a non-destructive recovery
      hint (nothing is downloaded, deleted or modified). Wired end to end:
      `speech:model-diagnostics` (main-frame + owner checked, directories
      resolved in main), preload, renderer type mirror, and a Voice settings
      panel that names the state and shows `verified/artifacts` counts.
- [ ] **Honest limitation, stated in the UI:** every reviewed model currently
      carries `expectedSha256: null`, so **no local engine can reach
      `verified_offline` today**. The panel says "files present, NOT verified —
      local speech stays off". That is the truthful state until real pins land;
      it is not a UI bug.
- [ ] A2b/A2c (live transport + wiring) remain blocked behind A1d's
      main-minted owner term; the completed-run reader stays the default.

## Audit increment — implemented, bounded

- [x] Bind readings/results to their originating workspace document, not a later
      window. Reload/crash/destroy cancel pending speech, STT, grants and setup;
      native approval cannot survive same-URL reload. Reject stale frame objects.
- [x] Correlate Codex text/completion with response-established thread/turn IDs;
      bound/filter startup races, reject terminal item replays/late deltas and
      error-bearing success. Claude terminal results also close its speech source.
- [x] Share filtered child environments, POSIX process-group cleanup, and Windows
      `taskkill.exe /PID <pid> /T` escalation across local synthesis and installers.
      A real Linux Node-child regression covers a SIGTERM-resistant descendant;
      **real Windows host validation stays open**.
- [x] Guard all five nonempty Kokoro prerequisites, constrain default uv with
      no-sync/offline/no-python-downloads and exclude dependency setup from active
      or queued-at-dispatch Kokoro synthesis. Added offline SHA-256 manifest/verifier
      (`modelManifest.ts` / `modelVerifier.ts`); live synthesis readiness still requires real models.
- [x] Add conservative bounded block-stable prose extraction to completed-reply
      buffers, leaving terminal text/manual reading unchanged. Unsupported HTML
      or ambiguous inline markup disables reading rather than guessing.
- [x] Remediate critical/high dependency advisories without blind `--force`:
      `npm audit` reduced from `1 critical, 31 high, 72 moderate` (`19 high, 67 moderate` prod)
      to **`0 critical, 0 high, 40 moderate`** (`35 moderate` prod; remaining moderates in
      `mjml`, `exceljs`, and `electron-builder` require breaking upstream majors).

Historical merged PR #7 evidence: **285 focused tests / 34 files pass**;
that full run had 2,831 passing,
267 failing and 27 skipped tests, with 41 environment-blocked files prior to native Node
rebuild and Electron test-stub isolation. Commands, baseline comparison and limits:
[audit validation](voice-conversation-plan.md#validation-for-the-post-pr-6-audit).

## Response-provenance, Piper/verifier & U2/U3 increment — unit/integration verified

- [x] Shared typed WOS session/run/epoch, provider session/turn/response ID,
      monotonic sequence, separate item/run outcomes and runtime shape guards.
- [x] Bounded response source: 128 IDs including tombstones, 256-unit identities,
      20k per delta/100k cumulative UTF-16. Limits quarantine this voice source;
      they do not cancel agents, truncate terminal output or authorize tools.
- [x] Optional Codex sink path after RPC-established ownership, startup/replay
      filtering and explicit error vs cancellation. Existing exit codes/text stay.
- [x] Claude `stream-json` response-provenance adapter (`claudeResponses.ts`) wired
      in `launchRun.ts`, handling `system`/`init` & `result` `session_id`, pre-session
      queueing, subagent (`parent_tool_use_id`) exclusion, and final-only fallback.
- [x] End-to-end A1d provenance: main-minted per-launch `responseOwner` epoch in
      `AGENT_RUN`, originating-document-bound `AGENT_ASSISTANT_RESPONSE` delivery
      (with reload/navigation/destroy run teardown), schema-validated preload listener,
      and `ResponseStreamConsumer` completed-mode assembly in `useAgentSession.ts`.
- [x] `ResponseSpeechScheduler` (`responseScheduler.ts`) combining conservative prose
      extraction and `SentenceStream` with barge-in epoch fencing (foundation helper;
      completed-run mode remains the default UI behavior).
- [x] Piper Spanish/multilingual local ONNX TTS engine (`engines/piper.ts`) wired
      through dispatch, IPC selection, and reply-consent disclosure, plus offline
      SHA-256 `verifySpeechModelDirectory` (`modelVerifier.ts`).
- [x] U1–U3 reviewed interface commands: explicit `'dictate' | 'commands'` capture
      selector in `VoiceDictation.tsx` (keeping dictation draft-only), one-shot
      `InterfaceCommandController` with 15s TTL and context/tab/epoch invalidation,
      and accessible visual confirmation banner (`Confirm command` / `Dismiss`) in
      `TerminalSession.tsx` invoking reversible navigation/focus callbacks.

Current evidence: **48 focused voice/agent/preload/security files (`420` tests) pass**;
full repository suite **329 passed / 0 failed / 3 skipped files (`3,596` passed / `26` skipped tests)**.
`npm run typecheck` (`0` errors, baseline `0`), `npm run lint` (`0` errors), and `npm run build` pass.
No real audio hardware, live Whisper/Kokoro/Piper weight inference, cloud provider, or real
Electron GUI E2E acceptance is claimed. See [precise scope/limits](voice-conversation-plan.md#response-provenance-and-interface-proposals-checkpoint-2026-11-20).

## Completed-run ownership increment — implemented, not real-device accepted

- [x] Native Cancel-default opt-in freezes engine/voice/config and discloses
      OpenAI text transmission or unsandboxed local-command networking. No mic.
- [x] Narrow typed open/reserve/finish/close IPC, document-owned IDs, 8 sessions /
      8 global reservations and 20k/configured text limit. Replies queue rather
      than interrupt unrelated audio. Rejected completion also frees capacity.
- [x] Existing hook reads only successful owned runs; late consent/reserve/drain
      callbacks cannot revive disabled epochs or use global Speak.
- [x] Disable/tab switch/PTY/hidden/pagehide/unmount stop only owned pending and
      playing replies. Speech-only Stop preserves future consent, not current
      speech; agent Stop retains its separate deliberate agent-cancellation behavior.
- [x] Test UI/native-consent mapping, normal context/Safe-mode/conversation,
      preload endpoints, stale epochs, errors, cancellation and acknowledged drain.
- [ ] A1a/A1b contracts/Codex fixtures now exist, but end-to-end provenance
      through Claude/main/preload/renderer and duration backpressure/live scheduling
      remain A1c/A1d/A2 work, not checked by completed-run ownership.

Historical merged PR #8 evidence: **330 focused tests / 39 files pass**. Full: **2,876 pass /
267 fail / 27 skipped, 3,170 total in 319 files**; same 41 failed files and failed
test identities as the fresh 2,831-pass baseline, **45 new passes**. Typecheck
retains 70 known errors; build passes. Dependency audit remains 19 high / 67
moderate; scanner retry failed at ONNX bootstrap with no source report. No audio,
model, provider or Electron E2E acceptance. Source/tests and precise limits:
[current checkpoint](voice-conversation-plan.md#completed-run-ownership-checkpoint-2026-11-20).

## Implemented foundations

- [x] Shared text sanitization, pagination and caption/alignment helpers, with
      regression tests. Caption helpers are not yet wired to visible word highlighting.
- [x] Batch OpenAI TTS adapter and local command/WAV adapter. Other engines fail
      explicitly in dispatch; an engine type/config entry is not an implementation.
- [x] Batch fragment synthesis/playback, bounded queue/interrupt orchestration,
      per-reading cancellation and provider text limits; optional one-fragment
      lookahead is off by default. Renderer PCM playback includes
      owner acknowledgements, cancellation and timeout handling.
- [x] Voice settings: OpenAI/Kokoro selection, static voice lists, text input,
      Speak, stop-current/stop-all and OpenAI key management.
- [x] Browser **Read page aloud** / Stop action, read-clipboard command and an
      opt-in global clipboard shortcut (disabled by default).
- [x] Atomic configuration persistence, restricted main-window/frame IPC and
      vault-backed OpenAI key storage. Renderer key status does not expose the key.
- [x] Configuration hardening: reject unknown/prototype keys, malformed profiles,
      unsupported HTTP headers/bodies and common embedded credential locations;
      preserve malformed/invalid on-disk config rather than overwrite it.
      Regression tests cover these cases; full migration/recovery is still open.

Evidence: [shared helpers/tests](../src/shared/speech/),
[reading controller/tests](../src/main/speech/reading.test.ts),
[engine adapters/tests](../src/main/speech/engines/),
[playback broker/tests](../src/main/speech/playback.test.ts),
[renderer playback](../src/renderer/src/components/Voice/VoicePlayback.tsx),
[settings](../src/renderer/src/components/Voice/VoiceSettings.tsx),
[browser action](../src/renderer/src/components/Browser/PageAssistant.tsx),
[hotkey tests](../src/main/speech/hotkey.test.ts),
[IPC handlers](../src/main/speech/handlers.ts),
[key storage](../src/main/speech/secrets.ts) and
[config regression tests](../src/main/speech/speech-config.test.ts).

## Kokoro installation — partial

The preparation/dependency steps below are implemented. They do **not** make a
fresh install ready to synthesize; `uv` and model files are still external prerequisites.
See [manual setup](voice.md#kokoro-manual-setup). The bundled Kokoro wrapper accepts
**English voices only**; Spanish/multilingual local output is provided by the separate
local **Piper** ONNX adapter (`src/main/speech/engines/piper.ts`), which still requires
manually provisioned binary/model files and real-audio validation.

- [x] Bundle the CopySpeech Kokoro wrapper/project manifest and stage them without
      overwriting existing user files; include resources in platform package configs.
- [x] Report presence of wrapper, manifest, Python environment, duration model
      and voices. **File presence is not model integrity or synthesis readiness.**
- [x] Explicit, opt-in **Install Python dependencies** action (`uv sync`), with
      single-install locking, busy status, timeout, cancel/shutdown handling and
      filtering of obvious credentials from the installer environment.
      This installs neither `uv` nor model weights.
- [x] Keep dependency installation out of the normal default Kokoro speech path
      (`uv run --no-sync --offline --no-python-downloads`); reject setup/synthesis
      overlap, including a reading that was queued before setup began.
- [ ] Complete the fresh-install prerequisite/model flow: `uv`/Python detection,
      provisioning and integrity checks for `kokoro-v1.0-duration.onnx` and
      `voices-v1.0.bin`, with third-party license/download consent.
- [ ] Add a real synthesis/readiness check and clear recovery guidance; do not
      label existence-only status as **ready**.
- [ ] Integrate a resident engine/daemon lifecycle, warm-up and idle shutdown;
      current dispatch invokes the batch local command adapter.
- [ ] Validate cancellation and descendant-process cleanup on each platform;
      Windows dependency-installer tree cancellation remains best-effort.

Evidence: [setup/tests](../src/main/speech/engines/kokoro-setup.test.ts),
[dependency installer/tests](../src/main/speech/engines/kokoro-install.test.ts),
[engine dispatch](../src/main/speech/engines/index.ts),
[settings](../src/renderer/src/components/Voice/VoiceSettings.tsx),
[bundled assets](../resources/voice-kokoro/) and [packaging config](../package.json).

## Remaining TTS implementation and security

- [ ] Implement the remaining agreed engines and dynamic voice catalogs.
- [ ] Implement incremental TTS streaming through synthesis, IPC and playback;
      current fragments are fully synthesized before playback; optional lookahead
      prepares at most one next fragment.
- [ ] Add pause/resume, other playback controls and effects beyond existing Speak/Stop.
- [ ] Add browser selection reading and synchronized word-level highlighting;
      existing browser reading extracts page text, not a selected range.
- [ ] Add Speak actions in other app surfaces and streaming/PTy agent-reply
      reading. Completed prompt-run replies can already be read with opt-in.
- [ ] Add always-on-top HUD, opt-in tray, history database, WAV export and
      conditional ffmpeg exports.
- [ ] Localize the voice module for the nine agreed languages and support RTL.
- [ ] Complete safe credential/config migration and user-facing, non-destructive
      recovery. Strict rejection/preservation is implemented, not a migration flow.
- [ ] Complete semantic/cross-field validation, remove or disable unsupported
      defaults and fix additional security/reliability findings.

**Do not count schema/default flags as working features.** For example,
`streaming_enabled`, HUD/history/browser-highlight settings and caption/audio
chunk event types exist, but do not establish a wired streaming or UI feature.
Likewise, the queue is controller-level; the current settings UI exposes Speak/Stop,
not a full playback/queue control surface.

## Hugging Face reference and native sentence foundation

- [x] Clone and review `huggingface/speech-to-speech` at
      `7dbbdaff5774ca657deed1900814763e1f6d87d5` as an ignored reference, not a
      shipped dependency or new Python service. Record source-linked adoption,
      licensing, privacy and native-integration decisions in the
      [conversation plan](voice-conversation-plan.md#hugging-face-speech-to-speech-reference-review-2026-11-20).
- [x] Add a bounded, tested native prose sentence assembler with Unicode/source
      spans and terminal success/cancel semantics. **Not wired to assistant
      deltas, TTS or UI**; it does not parse Markdown or authorize any action.
- [x] Add conservative streaming-safe **text** extraction with split-markup,
      limits/failure and sentence-composition tests; use it in completed-reply
      buffers. No incremental TTS or microphone behavior is activated.
- [x] Freeze destination/consent and connect tab/run ownership for completed-run
      reading only; see the current increment above.
- [ ] Extend to response-owned bounded scheduling/backpressure and separate
      incremental-mode opt-in. Review-first dictation remains unchanged.

## Realtime conversation — partial foundations, not implemented

Two-way voice conversation is in scope. A pure turn lifecycle, structured
assistant-text events, an offline-only local STT worker and experimental
push-to-talk dictation for review exist, but are not connected into an
interactive voice session. The optional RMS endpoint is not trained VAD.
No real microphone/model or Electron validation has been completed.

- [ ] Connect captured speech, turn lifecycle and the existing WOS agent session
      while preserving context, grants, approvals and review.
- [ ] Implement streaming STT/TTS, trained local VAD, barge-in, live response/PCM
      ownership, interruption and safe session reconnect/cleanup.
- [x] Implement a separate reviewed voice-interface command mode: typed local
      allowlist → owned final proposal → visible preview/confirmation → existing
      reversible UI callback (`interfaceCommands.ts`, `interfaceCommandController.ts`,
      `VoiceDictation.tsx`, `TerminalSession.tsx`). No arbitrary transcript/menu/tool
      executor or spoken approval bypass; real Electron/mic acoustic validation remains open.
- [ ] Verify model provenance/integrity, offline behavior, supported languages,
      platform packaging and privacy/latency characteristics on real devices.

## Release validation — all still required

- [ ] Real Electron smoke/E2E from fresh install through synthesis, **audible**
      playback, cancellation and window lifecycle.
- [ ] Real Kokoro/Piper model/audio and configured OpenAI integration tests, plus
      operating-system keychain and global-hotkey verification.
- [ ] Windows/macOS/Linux packaging, prerequisites and system-specific behavior;
      accessibility and RTL checks.
- [ ] End-to-end red/blue security audit: IPC authorization, secret/clipboard
      privacy, untrusted input, installer/model integrity, process cancellation,
      fault recovery and performance; fix and repeat.

Targeted regression command (after installing project dependencies):

```sh
npm test -- --maxWorkers=2 src/main/speech src/shared/speech src/preload/speech.test.ts src/renderer/src/components/Voice src/renderer/src/components/AgentTerminal src/main/agent/assistantText.test.ts src/main/agent/assistantResponses.test.ts src/main/agent/claudeResponses.test.ts src/main/agent/providerText.test.ts src/main/agent/providers/codexSession.test.ts src/main/security.redteam.test.ts
```

Unit/fixture tests do not satisfy the real-audio or release gates above.
No `uv`/model installation or provider-credential exercise is claimed.

## Immediate next steps

Follow [atomic gates A1–A9](voice-conversation-plan.md#next-atomic-integration-gates-in-order)
and their [independently testable execution slices](voice-conversation-plan.md#atomic-execution-slices):

1. A1a–A1d (contracts, Codex & Claude adapters, main-minted `responseOwner`,
   document-bound IPC/preload, and renderer completed-mode assembly) and U1–U3
   (one-shot visual command confirmation + explicit command-capture mode) are now
   implemented and unit/integration-verified. Validate them in real Electron GUI/audio E2E.
2. Extend `ResponseSpeechScheduler` (`A2b`/`A2c`) to live transport duration
   backpressure and acknowledged drain, then add separate opt-in incremental-mode
   consent (`A3a`/`A3b`) while keeping completed-run mode as the default.
3. Complete A4c/A4d consented model provisioning/recovery and real offline Whisper,
   Kokoro, and Piper model execution across Linux, macOS, and Windows hosts.
4. Existing-session finalized turns, bounded capture/trained VAD/STT, PCM/AEC and
   barge-in (A5–A7); each CopySpeech UX surface remains an individual A8 change.
5. Real-device multilingual/cross-platform, latency and final security evidence
   before release acceptance (A9). Every unchecked release gate remains open.
