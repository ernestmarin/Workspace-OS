# Native, local-first voice conversation: atomic implementation plan

Status: in progress. This is not yet a working voice conversation. The existing CopySpeech-derived reading feature is distinct from this work.

También se han portado componentes internos de CopySpeech: sanitización de texto, paginación, estructuras de captions y orquestación de lecturas. Que existan esos componentes **no significa** que todas sus funciones estén conectadas a la interfaz.

## Constraints and architecture
- Electron/TypeScript owns orchestration and permissions. Do not add a Pipecat Python sidecar. Existing optional local TTS child processes remain separate and must not be mistaken for a validated offline conversation.
- Prefer local VAD, STT, TTS and local-capable models. Never silently send audio or text to a remote provider; disclose destinations and require opt-in. Do not promise offline operation until every active component is local and verified.
- The selected WOS agent and conversation remain authoritative. Voice must not replace their context, grants, approvals, MCP connectors or audit/review paths. No extra LLM postprocessing.
- Pipecat/LiveKit features are behavioral goals, not a claim of parity or a requirement to import either. A future optional transport must prove value without changing these constraints.

## Progress
- Turn lifecycle foundation exists as a pure, tested state machine; it is not wired to audio or the UI.
- Agent bridge has typed assistant-text events for Claude and Codex, separate from terminal output. Routing finalized transcripts into the selected conversation and connecting playback remain unimplemented.
- Agent terminal has an opt-in, per-tab completed-reply reader using existing Voice settings. It does not support the PTY broker, streaming speech or microphone input; switching tabs disarms future reply reading. A cloud voice sends reply text to its provider after the user enables the feature.
- Experimental offline-only Whisper STT worker and restricted IPC exist. It expects a manually provisioned compatible quantized Transformers.js model; model compatibility and real transcription have not been validated. No automatic model download.
- Native per-request microphone consent and a time-limited, audio-only main-frame permission gate exist. An experimental push-to-talk UI captures up to 30 seconds in a selected language for offline transcription, then places the result in the input for review; it does not send automatically. Browser guests remain denied. This policy and recording flow have not been validated in real Electron.
- Dictation can optionally stop after local energy-based silence detection; this heuristic is off by default and manual stop remains available. It is not a trained VAD and requires real-device tuning.
- Dictation controls offer English, Arabic, German, Spanish, French, Hebrew, Hindi, Russian and Chinese, with RTL scoped to the control for Arabic/Hebrew. Diagnostic errors and native consent remain English; other Voice panels are not localized yet. Selecting a language does not validate model support.
- Permission prompts/grants and STT cancellation have request identities so stale tab cleanup cannot revoke a newer request. Tabs share a trusted renderer; these identities prevent lifecycle races, not a security boundary against compromised renderer code.
- Dictation discards capture on page hide/visibility loss and microphone track end, detaching listeners, closing its decoding context promptly and cancelling its own transcription. Simulated renderer tests cover these paths; OS/Electron behavior still needs real-device validation.
- Dictation offers per-tab microphone selection and explicit metadata-only refresh. It requests the exact selected device, never silently falls back if it disappears, and ignores stale enumeration/recording callbacks. Device IDs/names are not persisted. Real Electron enumeration/permission behavior remains unvalidated.
- Individual reading IDs can be cancelled through authorized IPC; the Voice settings provide separate stop-current and stop-all controls. A current cancellation leaves queued readings intact and never cancels the agent. Session ownership and automatic interruption remain pending.
- Optional, off-by-default one-fragment TTS lookahead overlaps synthesis with playback and aborts on stop/failure. It does not stream agent tokens or audio, and may send the next fragment early to a selected cloud TTS provider. Real latency and audio behavior are unmeasured.
- No real microphone or end-to-end conversation has been validated.

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

This inventory covers both the CopySpeech port and the conversation work, not
just the last milestone. “Implemented” describes code and focused automated
checks; it does **not** imply real-device or release validation.

### CopySpeech-derived reading foundations
- Shared TypeScript contracts/defaults, deterministic sanitization, text
  pagination, UTF-16-aware fragment spans and caption data models are ported.
  Their presence does not mean the caption UI, word highlighting, or every
  upstream feature is connected.
- Voice configuration is merged with defaults, shape/range checked and
  atomically persisted under `userData/copyspeech`; malformed files are not
  silently overwritten. Keys use the OS vault where available; config rejects
  known credential fields and unsafe HTTP templates. Full migration and a
  comprehensive credential audit remain open.
- OpenAI batch synthesis and a managed local command/WAV adapter are wired to
  a bounded reading queue and acknowledged PCM renderer playback. Stop-all and cancel-by-reading-ID are supported; the Voice settings can stop
  the current reading without clearing other queued readings. Per-session
  ownership and pause, resume, captions and effects remain incomplete. OpenAI sends text remotely.
- Settings support Kokoro/OpenAI choice, a limited voice list, vault-backed
  OpenAI key, reading text/clipboard, stop and an optional global clipboard
  shortcut (disabled by default). Browser page text can be read. Selection and
  word highlighting within WOS Browser remain pending; external browser
  extensions and native-messaging hosts are out of scope for v1.
- CopySpeech's MIT Kokoro wrapper/project manifest can be staged without
  overwriting user files. Optional cancellable dependency setup uses `uv`; model
  weights are manually supplied. Presence checks are not integrity/readiness
  checks, and no real Kokoro audio or cross-platform process-tree behavior is
  validated. This existing optional child process is not permission to add a
  new Python Pipecat sidecar.
- Optional one-fragment lookahead is disabled by default, separately from the
  old `streaming_enabled` config field. It synthesizes at most one fragment in
  advance, cancels on failure/stop and warns that a cloud provider may receive
  text early. This is not token streaming or a benchmarked latency improvement.

### Agent and capture work
- Assistant-only structured text events for Claude/Codex are separated from
  terminal/tool output. Completed-reply reading is per-tab and opt-in, limited
  to successful owned prompt runs, with bounded buffers; switching tabs disarms
  future reading. It is not live streaming, PTY support or voice conversation.
- The pure turn state machine and regression tests define tickets, stale-event
  rejection, stop/interrupt effects and bounded transcripts. It is not wired
  to the existing agent session, microphone or playback; in particular it does
  not yet implement full-duplex barge-in or overlapping turns.
- Offline-only Transformers.js Whisper worker and restricted main-frame IPC
  accept bounded audio, support UUID-scoped cancellation and use a manually
  installed compatible multilingual model. Four file-presence checks do not
  verify ONNX files, model provenance, integrity or runtime readiness; actual
  recognition, language quality and native packaging are untested.
- Push-to-talk captures at most 30 seconds after per-request native consent;
  it resamples locally to 16 kHz, transcribes and inserts text for user review
  without submitting. Browser guest capture is denied. A time-limited audio-only
  grant and request identities protect against ordinary stale lifecycle cleanup,
  not a compromised trusted renderer.
- Capture discards on tab deactivation, hidden document, pagehide, disconnect,
  cancellation and recording error, and cleans tracks, monitor, timers,
  decoding context and its own STT request. An optional, off-by-default RMS
  silence heuristic is not trained VAD; no automatic background listening.
- Dictation supports the nine requested language controls and scoped Arabic/
  Hebrew RTL, plus per-tab in-memory microphone selection and explicit device
  refresh. Selected devices use exact constraints and do not silently fall back.
  Errors/native consent and other Voice surfaces remain incompletely localized;
  selected languages and device behavior are not yet tested on real models or
  real Electron.

### Validation and unresolved work
- Latest focused simulated/unit suite at this inventory: **162 tests in 25
  files passed**. Typecheck passes against an existing **70-error baseline**;
  production build succeeds. These are not real microphone, speaker, model,
  network-provider or Electron end-to-end tests. Historical full-suite failures
  and unavailable Electron/native binaries remain separate unresolved issues.
- Still required: real turn integration with existing WOS sessions and
  approvals; incremental assistant-only speech; per-session audio/run ownership
  and interruption wiring; trained local VAD and streaming/local STT with audited model
  install; reliable barge-in and spoken-context tracking; native Browser
  selection and word highlighting; HUD/tray/history/exports and the remaining
  in-scope CopySpeech features; full Voice-module localization; performance,
  security and cross-platform validation.
- User exclusions continue to apply: no added Python sidecar, no external
  browser extension/native-messaging host, no LLM postprocessing, telemetry,
  CopySpeech updater, Windows ducking, retired edge-tts or landing/web routes.
  Global hotkey and tray must be opt-in; tray on macOS must use a template icon
  reflecting speaking/paused, and the HUD must remain above windows while
  speaking. WAV export is always available once implemented; MP3/OGG require a
  system ffmpeg. The existing Electron updater remains authoritative.
- Final red/blue audit and real Electron E2E are release gates, not deferred
  claims of success. Check relevant code throughout implementation, then repeat
  the full audit and E2E when the complete feature is ready. No parity with
  Pipecat or LiveKit is claimed without measurements.
