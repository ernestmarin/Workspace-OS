# Voice implementation plan & integration checklist

Last reviewed: **2026-11-20**, against merged code at `6354988` (PR #3).
This checkpoint is a documentation update, not a new voice implementation.

**Current position: batch text-to-speech foundations implemented; Kokoro setup
partial; streaming/realtime voice not implemented; not production-ready.**

Checked items mean implemented in the reviewed code, not release acceptance.
Regression test sources are linked below where present; tests were **not rerun**
for this documentation-only review. No real-audio, cloud-provider, Electron E2E
or cross-platform validation is claimed. Unchecked items remain open, including
validation of features whose code already exists.

## Implemented foundations

- [x] Shared text sanitization, pagination and caption/alignment helpers, with
      regression tests. Caption helpers are not yet wired to visible word highlighting.
- [x] Batch OpenAI TTS adapter and local command/WAV adapter. Other engines fail
      explicitly in dispatch; an engine type/config entry is not an implementation.
- [x] Serial fragment synthesis/playback, bounded queue/interrupt orchestration,
      cancellation and provider text limits. Renderer PCM playback includes
      owner acknowledgements, cancellation and timeout handling.
- [x] Voice settings: OpenAI/Kokoro selection, static voice lists, text input,
      Speak/Stop and OpenAI key management.
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
See [manual setup](voice.md#kokoro-manual-setup).

- [x] Bundle the CopySpeech Kokoro wrapper/project manifest and stage them without
      overwriting existing user files; include resources in platform package configs.
- [x] Report presence of wrapper, manifest, Python environment, duration model
      and voices. **File presence is not model integrity or synthesis readiness.**
- [x] Explicit, opt-in **Install Python dependencies** action (`uv sync`), with
      single-install locking, busy status, timeout, cancel/shutdown handling and
      filtering of obvious credentials from the installer environment.
      This installs neither `uv` nor model weights.
- [x] Keep dependency installation out of the normal default Kokoro speech path
      (`uv run --no-sync`); reject Kokoro speech while dependency setup is busy.
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
      current fragments are fully synthesized before playback, sequentially.
- [ ] Add pause/resume, other playback controls and effects beyond existing Speak/Stop.
- [ ] Add browser selection reading and synchronized word-level highlighting;
      existing browser reading extracts page text, not a selected range.
- [ ] Add Speak actions in other app surfaces and opt-in agent-reply reading.
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

## Realtime conversation — not implemented; scope to confirm

Streaming TTS output and two-way voice conversation are separate milestones.
The current integration is text-in/audio-out via batch TTS, not a microphone or
speech-to-speech session. The following is a planning gate, not completed work
or an assumed extension of the agreed TTS scope:

- [ ] Confirm whether “realtime voice” means streaming TTS only or also two-way
      conversation; document provider/transport, privacy and latency criteria.
- [ ] If two-way conversation is in scope, plan microphone permission/capture,
      STT or speech-to-speech, voice activity/turn detection, barge-in/interruption,
      agent/context integration and session reconnect/cleanup before implementation.

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
npm test -- src/main/speech src/shared/speech/__tests__
```

Unit/fixture tests do not satisfy the real-audio or release gates above. This
review did not run tests, install `uv`/models or exercise provider credentials.

## Immediate next steps

1. Finish verified Kokoro setup/readiness, without confusing staged files or
   installed dependencies with a working model.
2. Exercise real OpenAI/Kokoro TTS, audible playback and cancellation in Electron;
   record platform-specific evidence before checking off release gates.
3. Confirm and scope the streaming/realtime milestone separately; keep the
   remaining TTS UX/security backlog visible until it is implemented and validated.
