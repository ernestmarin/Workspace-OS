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
- Dictation discards capture on page hide/visibility loss and microphone track end, detaching listeners and cancelling its own transcription. Simulated renderer tests cover these paths; OS/Electron behavior still needs real-device validation.
- Dictation offers per-tab microphone selection and explicit metadata-only refresh. It requests the exact selected device, never silently falls back if it disappears, and ignores stale enumeration/recording callbacks. Device IDs/names are not persisted. Real Electron enumeration/permission behavior remains unvalidated.
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
