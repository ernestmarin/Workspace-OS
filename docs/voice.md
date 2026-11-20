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

Install [uv](https://docs.astral.sh/uv/) and, from a terminal, run `uv sync`
inside the project folder shown in Settings. This downloads and executes
third-party Python dependencies, including a spaCy model wheel; inspect the
manifest and upstream package terms before proceeding. `uv` must also be
available on the Workspace OS process PATH.

The wrapper additionally requires **both** `models/voices-v1.0.bin` and the
**duration-capable** `models/kokoro-v1.0-duration.onnx`. The ordinary audio-only
Kokoro ONNX model is not sufficient. CopySpeech's upstream Kokoro installer
builds the duration-capable model using its pinned exporter; see
[CopySpeech installation scripts](https://github.com/ernestmarin/CopySpeech/tree/45767410e469ef464a7e07842813399cac9060d5/scripts)
for the relevant platform-specific procedure and third-party downloads. Place
those two files in the project's `models` directory. A complete automatic
installer, model verification, and an in-app real-audio readiness test remain
work to do.

## Privacy

OpenAI synthesis sends requested text to OpenAI. The optional global shortcut
reads clipboard text on each invocation and uses the currently selected engine;
it is disabled by default. API keys are stored in the operating-system vault
when supported. Environment overrides take precedence over stored keys.
