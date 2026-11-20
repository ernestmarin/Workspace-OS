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

An experimental push-to-talk control in an agent terminal captures up to 30 seconds for offline Spanish transcription and places the result in the input for review. It requires explicit microphone consent and does not submit automatically. The transcription worker is offline-only and bounded. It expects a manually provisioned, Transformers.js-compatible quantized multilingual Whisper model under `userData/copyspeech/models/whisper`. It does not download models, and file-presence status is not an integrity or compatibility check. This path, the required model files, native ONNX runtime packaging, languages and real transcription have not yet been validated. No offline-conversation readiness is implied.
