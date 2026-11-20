# Voice (work in progress)

The current integration supports OpenAI and an experimental local Kokoro path.
Other engines, browser word highlighting, the HUD and history are not yet
implemented. Voice is not production-ready or end-to-end validated.

## Kokoro: manual setup

In Settings → Voice, choose Kokoro and select **Prepare Kokoro project files**.
This copies the bundled CopySpeech wrapper and a pinned project manifest into
`userData/copyspeech/engines/kokoro` without overwriting existing files. It does
not install `uv`, Python packages, or download any models. The status indicators
show file existence only; they do not establish that a model or environment is
valid.

Install [uv](https://docs.astral.sh/uv/) and select **Install Python dependencies** in Voice settings. Alternatively, run `uv sync` from a terminal inside the project folder shown in Settings. This downloads and executes
third-party Python dependencies, including a spaCy model wheel; inspect the
manifest and upstream package terms before proceeding. `uv` must also be
available on the Workspace OS process PATH.

The wrapper additionally requires **both** `models/voices-v1.0.bin` and the
**duration-capable** `models/kokoro-v1.0-duration.onnx`. The ordinary audio-only
Kokoro ONNX model is not sufficient. CopySpeech's upstream Kokoro installer
builds the duration-capable model using its pinned exporter; see
[CopySpeech installation scripts](https://github.com/ernestmarin/CopySpeech/tree/45767410e469ef464a7e07842813399cac9060d5/scripts)
for the relevant platform-specific procedure and third-party downloads. Place
those two files in the project's `models` directory. Automatic model provisioning, model verification, and an in-app real-audio readiness test remain work to do. On Windows cancellation of uv is best-effort for descendant processes and needs platform validation.

## Privacy

OpenAI synthesis sends requested text to OpenAI. The optional global shortcut
reads clipboard text on each invocation and uses the currently selected engine;
it is disabled by default. API keys are stored in the operating-system vault
when supported. Environment overrides take precedence over stored keys.

## Experimental local speech recognition foundation

An experimental push-to-talk control in an agent terminal captures up to 30 seconds for offline transcription in the selected language and places the result in the input for review. An opt-in energy-based auto-stop is experimental and can misdetect speech or noise; manual stop remains available. It requires explicit microphone consent and does not submit automatically. The transcription worker is offline-only and bounded. It expects a manually provisioned, Transformers.js-compatible quantized multilingual Whisper model under `userData/copyspeech/models/whisper`. It does not download models, and file-presence status is not an integrity or compatibility check. This path, the required model files, native ONNX runtime packaging, languages and real transcription have not yet been validated. No offline-conversation readiness is implied.


Dictation currently offers English, Arabic, German, Spanish, French, Hebrew,
Hindi, Russian and Chinese. Its control labels follow this selection, and
Arabic/Hebrew use a local RTL container without changing Workspace OS layout.
Diagnostic errors and the native consent dialog are still English. This is not
full Voice-module localization and is not a claim of tested model support for
any language. The selected language is locked while a recording/transcription
is active; transcription is never automatically sent to the agent.

Microphone permission revocation and transcription cancellation are keyed to
the originating request. Switching tabs cancels that tab's recording/job and
ignores its late results; it must not revoke another tab's newer request.
These keys address lifecycle races inside the trusted renderer, not isolation
from malicious code executing in that renderer.

Hiding the app document or losing the microphone track discards the current
recording instead of submitting partial audio. This cleanup is covered by
simulated renderer tests, not yet by real Electron/device validation.


### Choosing a microphone
Use **Refresh microphones** in the dictation control to list audio inputs without
starting a recording. Browsers/Electron may conceal names or devices until
permission is granted; refresh again after an approved recording if necessary.
The selection is per-tab and memory-only. A specific selection uses an exact
device constraint: if it disappears the recording fails rather than switching
to another microphone. Select **System default** explicitly to return to the
system's routing. Device changes refresh an already-open list while idle but
never start capture. This flow has simulated tests only, not real-device E2E.


### Fragment lookahead (opt-in)
Voice settings can prepare at most one next text fragment while the current one
plays, potentially reducing gaps. The option is off by default, including for
existing configurations with the older `streaming_enabled` flag. With a cloud
engine, enabling it may send the next fragment before the current fragment
finishes; stopping cancels pending synthesis when possible, but cannot recall
text already sent. A change affects future readings, not one already running.
This is batch-fragment prefetch, not token streaming or a real-time conversation.
It has mocked tests, not a real-device latency benchmark.


### Stopping speech
Voice settings can stop the currently displayed reading by its identity, leaving
other queued readings intact, or stop all readings and clear the queue. Neither
control cancels an agent run or reverses its actions. A stale identity cannot
stop a later reading. This is a shared playback controller, not yet per-tab
voice-conversation ownership or automatic barge-in.
