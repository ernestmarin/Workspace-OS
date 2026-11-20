# Voice implementation plan & integration checklist

Last reviewed: **2026-11-20**, post-PR #6 red-team source/regression audit
from `cef73ff8` (including the PR #5 unfinished-work inventory).

This checklist combines the TTS foundations from PR #3 with the newer
experimental dictation, assistant reply and playback work. For the detailed
atomic conversation plan, pinned Hugging Face reference review and status, see
[voice-conversation-plan.md](voice-conversation-plan.md).

**Current position: partial batch text-to-speech and experimental push-to-talk;
continuous real-time conversation is not implemented or production-ready.**

Checked items indicate implemented code, not release acceptance. Latest evidence
and the PR #5 reconciliation are in the
[post-PR #6 audit](voice-conversation-plan.md#red-team-audit-after-pr-6-2026-11-20),
not the historical 208-test PR #6 checkpoint. No real audio, cloud-provider,
Electron E2E or cross-platform validation is claimed. The full suite and
production dependency audit are **not green**.

## Audit increment — implemented, bounded

- [x] Bind readings/results to their originating workspace document, not a later
      window. Reload/crash/destroy cancel pending speech, STT, grants and setup;
      native approval cannot survive same-URL reload. Reject stale frame objects.
- [x] Correlate Codex text/completion with response-established thread/turn IDs;
      bound/filter startup races, reject terminal item replays/late deltas and
      error-bearing success. Claude terminal results also close its speech source.
- [x] Share filtered child environments and POSIX process-group cleanup between
      batch local synthesis and the installer. A real Linux Node-child regression
      covers a SIGTERM-resistant descendant; **Windows tree cleanup stays open**.
- [x] Guard all five nonempty Kokoro prerequisites, constrain default uv with
      no-sync/offline/no-python-downloads and exclude dependency setup from active
      or queued-at-dispatch Kokoro synthesis. No hash/readiness claim.
- [x] Add conservative bounded block-stable prose extraction to completed-reply
      buffers, leaving terminal text/manual reading unchanged. Unsupported HTML
      or ambiguous inline markup disables reading rather than guessing.
- [ ] Remediate the dependency audit: npm reported **19 high + 67 moderate**
      entries, including Transformers → sharp. Reachability is not proven;
      forced major native-runtime upgrades without model/packaging tests are not
      a fix. This blocks security/release acceptance.

Evidence: **285 focused tests / 34 files pass**; final full run has 2,831 passing,
267 failing and 27 skipped tests, with the same 41 environment-blocked files as
before edits. Typecheck passes the unchanged 70-error baseline; build passes.
The additional CLI security scanner failed during installation, producing no scan.
Commands, baseline comparison and limits: [audit validation](voice-conversation-plan.md#validation-for-the-post-pr-6-audit).

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
See [manual setup](voice.md#kokoro-manual-setup). The bundled wrapper accepts
**English voices only**; a Spanish-capable local output adapter is still required.

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
- [ ] Add response-owned bounded scheduling, frozen destination/consent and
      explicit incremental-mode opt-in. Review-first dictation remains unchanged.

## Realtime conversation — partial foundations, not implemented

Two-way voice conversation is in scope. A pure turn lifecycle, structured
assistant-text events, an offline-only local STT worker and experimental
push-to-talk dictation for review exist, but are not connected into an
interactive voice session. The optional RMS endpoint is not trained VAD.
No real microphone/model or Electron validation has been completed.

- [ ] Connect captured speech, turn lifecycle and the existing WOS agent session
      while preserving context, grants, approvals and review.
- [ ] Implement streaming STT and TTS, trained local VAD, barge-in, playback/run
      ownership, interruption and safe session reconnect/cleanup.
- [ ] Verify model provenance/integrity, offline behavior, supported languages,
      platform packaging and privacy/latency characteristics on real devices.

## Release validation — all still required

- [ ] Real Electron smoke/E2E from fresh install through synthesis, **audible**
      playback, cancellation and window lifecycle.
- [ ] Real Kokoro model/audio and configured OpenAI integration tests, plus
      operating-system keychain and global-hotkey verification.
- [ ] Windows/macOS/Linux packaging, prerequisites and system-specific behavior;
      accessibility and RTL checks.
- [ ] End-to-end red/blue security audit: IPC authorization, secret/clipboard
      privacy, untrusted input, installer/model integrity, process cancellation,
      fault recovery and performance; fix and repeat.

Targeted regression command (after installing project dependencies):

```sh
npm test -- --maxWorkers=2 src/main/speech src/shared/speech src/renderer/src/components/Voice src/renderer/src/components/AgentTerminal src/main/agent/assistantText.test.ts src/main/agent/providerText.test.ts src/main/agent/providers/codexSession.test.ts
```

Unit/fixture tests do not satisfy the real-audio or release gates above.
No `uv`/model installation or provider-credential exercise is claimed.

## Immediate next steps

Follow [atomic gates A1–A9](voice-conversation-plan.md#next-atomic-integration-gates-in-order)
and their [independently testable execution slices](voice-conversation-plan.md#atomic-execution-slices),
without the previous conflict between “Kokoro first” and “scheduler first”:

1. Response/session/epoch contracts, then bounded response-owned scheduling and
   delayed-IPC/config/consent cancellation tests (A1/A2).
2. Explicit incremental reply opt-in with failure/drain handling (A3); never loop
   global interrupting Speak for every sentence or claim token/audio streaming yet.
3. In parallel, remediate native dependencies and prove model integrity, actual
   offline Whisper and Spanish local TTS readiness (A4). This blocks release and
   automatic voice turns, even if fixture-only orchestration tests pass.
4. Existing-session finalized turns, bounded streaming capture/STT, PCM/AEC and
   barge-in (A5–A7), while shipping the individual UX backlog safely (A8).
5. Real-device multilingual/cross-platform, latency and final security evidence
   before release acceptance (A9). Every unchecked release gate above remains open.
