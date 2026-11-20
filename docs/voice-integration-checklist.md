# Voice integration checklist

Status: **incomplete; not production-ready**. Checkboxes mean implemented and
validated for the stated scope, not that real audio or cross-platform E2E passed.

## Implemented foundations
- [x] Shared sanitization, pagination, caption models and regression tests.
- [x] Configuration persistence, restricted renderer IPC, vault-backed OpenAI key.
- [x] Batch OpenAI and local command adapters, queue/interrupt orchestration, renderer PCM playback.
- [x] Voice settings, page text read action, clipboard command and opt-in global shortcut.
- [x] Stage Kokoro wrapper/project files without overwriting existing files; show file-presence status.

## Implementation and security still required
- [ ] Complete Kokoro installation/model provisioning, integrity checks, daemon lifecycle and real audio readiness.
- [ ] Remaining agreed engines, voice catalogs, streaming, playback controls and effects.
- [ ] Browser selection and word-level highlighting; in-app Speak actions; opt-in agent replies.
- [ ] Always-on-top HUD, opt-in tray, history database, WAV and conditional ffmpeg exports.
- [ ] Voice-module localization for the nine agreed languages and RTL support.
- [ ] Safe credential/config migration, comprehensive validation and non-destructive recovery.
- [ ] Eliminate unsupported default settings and fix any additional security/reliability findings.

## Release validation still required
- [ ] Real Electron smoke/E2E from fresh install, through synthesis, audible playback, cancellation and window lifecycle.
- [ ] Real Kokoro audio, configured cloud-provider integration, keychain and hotkey tests.
- [ ] Windows/macOS/Linux packaging and system-specific behavior; accessibility and RTL.
- [ ] End-to-end red/blue security audit: IPC authorization, secret/clipboard privacy, untrusted input,
      installer integrity, process cancellation, fault recovery and performance; fix and repeat.

Current sandbox lacks the Electron binary/display, uv/model weights and credentials;
mocked or fixture tests do not satisfy these release checks. See `docs/voice.md`.
