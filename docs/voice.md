# Voice (work in progress)

See the
[Voice implementation plan & integration checklist](voice-integration-checklist.md)
for completed code, partial work, remaining scope and release validation gates.
The [conversation plan and Hugging Face reference review](voice-conversation-plan.md#hugging-face-speech-to-speech-reference-review-2026-11-20)
cover voice control of the WOS interface and conversation with the existing
agents, without replacing their context or approval paths. A pure es/en command
proposal helper now exists, but preview/confirmation, UI actions and microphone
wiring for commands are **not implemented**. Dictation still only fills a draft.

The current integration provides batch text-to-speech with OpenAI and an
experimental local Kokoro path. Each fragment is fully synthesized before
playback, with optional bounded lookahead. Experimental push-to-talk dictation
requires review before sending. Streaming TTS and two-way real-time conversation
are not implemented. Other engines, browser word highlighting, the HUD and history are
not yet implemented. Voice is not production-ready or end-to-end validated.

## Kokoro: manual setup

In Settings → Voice, choose Kokoro and select **Prepare Kokoro project files**.
This copies the bundled CopySpeech wrapper and a pinned project manifest into
`userData/copyspeech/engines/kokoro` without overwriting existing files. It does
not install `uv`, Python packages, or download any models. The status indicators
show file existence only; they do not establish that a model or environment is
valid. The default speech path now refuses missing/empty wrapper, project, Python
interpreter, model or voices files before starting uv. It also passes
`--no-sync --offline --no-python-downloads` to default uv synthesis. The in-app
dependency action is blocked during a Kokoro reading; queued Kokoro synthesis
rechecks the installer lock before dispatch. These are prerequisite/uv guards,
**not** verified model readiness or a network sandbox. External terminal installers
and arbitrary custom local commands are not covered by this in-app lock; do not
modify the engine environment while speech is active.

**The bundled Kokoro wrapper supports English voices only.** Spanish and other
local output languages need a different or extended adapter; choosing a dictation
language does not change this limitation.

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
stop a later reading. Stop-all also discards replies already reserved by current
agent runs, while future runs can still reserve under existing reply consent.
The tab's separate **Stop reply audio** is narrower; neither is automatic barge-in.


### Agent reply speech and lifecycle limits
In a prompt-mode agent tab, choose **Read replies** and approve the native
Cancel-default dialog. It names the engine and voice and discloses whether text
goes to OpenAI or uses a configured local command whose networking is not
sandboxed. It does not enable a microphone. PTY/Interactive mode is unsupported.

Engine, voice and playback settings stay fixed for that consent session; changing
Voice settings does not redirect an enabled reader. Turn it off and on to approve
a new snapshot. Replies queue behind other readings instead of interrupting them.
Only runs started after approval and completed successfully can be read; enabling
mid-run does not read that run. Text already sent to a provider cannot be recalled.

The reader derives conservative prose without changing terminal text: code,
images, link destinations, tables and quoted/indented blocks are omitted;
ambiguous markup or raw HTML can disable reading. Bounds are 8 global sessions,
8 reservations (including normal playback drain), and 20,000 UTF-16 text units
or the approved configured limit, whichever is smaller. It discards oversized,
failed or cancelled replies rather than truncating or changing engines.

- **Stop reply audio** cancels this tab's current reserved/queued/playing replies,
  not the agent or unrelated readings. The reader stays enabled for future runs.
- **Replies on** turns reading off and closes its owned pending/playing work.
  Switching tabs, entering Interactive mode, hiding/leaving the document or
  unmounting also disables it; returning does not automatically re-enable it.
- Clear/model/persona changes discard current reply work. The existing **agent
  Stop** still deliberately cancels agent runs as before; speech-only Stop does not.

Late consent/reservation acknowledgements cannot revive a disabled reader.
Reload/crash/close also cancel document speech, transcription, grants and setup,
and reject late playback into a replacement document. POSIX batch-process groups
are cleaned up; Windows descendant cleanup remains unvalidated/incomplete.

These tab/run ownership paths have simulated hook/control/IPC regressions, not
real Electron/device acceptance. They do **not** provide response-owned streaming,
continuous STT/TTS, trained VAD, heard-context tracking or full-duplex barge-in.
The new response-provenance contract/optional Codex sink is also not connected to
the normal main/preload/renderer path; it does not change the reader above or add
audio streaming. Item generation, run completion and audible drain are distinct.
See the [current checkpoint and atomic next gates](voice-conversation-plan.md#response-provenance-and-interface-proposals-checkpoint-2026-11-20)
and [historical audit/security blockers](voice-conversation-plan.md#red-team-audit-after-pr-6-2026-11-20).
No fully offline, secure/release-ready or real-time conversation claim is made.
