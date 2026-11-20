/**
 * Versioned manifest of reviewed local speech models, licenses, languages, and
 * required artifact files (VOX-A4b).
 *
 * Pure metadata — never triggers downloads or claims runtime readiness from file
 * existence alone. Where upstream user-supplied quantized variants vary by build,
 * `expectedSha256` is `null` so the verifier reports `'present-unpinned'` rather
 * than falsely claiming cryptographic verification.
 */
export interface SpeechModelArtifactSpec {
  relativePath: string
  expectedSha256: string | null
  minBytes: number
}

export interface SpeechModelManifestEntry {
  id: 'kokoro-v1.0-en' | 'whisper-onnx-local' | 'piper-es-local'
  label: string
  role: 'tts' | 'stt'
  license: 'Apache-2.0' | 'MIT'
  /** ISO-639-1 language codes supported by this specific model/wrapper. */
  languages: readonly string[]
  notes: string
  artifacts: readonly SpeechModelArtifactSpec[]
}

export const SPEECH_MODEL_MANIFEST_VERSION = 1 as const

export const REVIEWED_SPEECH_MODELS: readonly SpeechModelManifestEntry[] = Object.freeze([
  {
    id: 'kokoro-v1.0-en',
    label: 'Kokoro v1.0 ONNX (bundled English wrapper)',
    role: 'tts',
    license: 'Apache-2.0',
    languages: Object.freeze(['en']),
    notes: 'Bundled copyspeech-kokoro.py wrapper accepts English voices only; requires uv, .venv, and non-empty ONNX/voices weights.',
    artifacts: Object.freeze([
      { relativePath: 'kokoro/scripts/copyspeech-kokoro.py', expectedSha256: null, minBytes: 64 },
      { relativePath: 'kokoro/pyproject.toml', expectedSha256: null, minBytes: 32 },
      { relativePath: 'kokoro/models/kokoro-v1.0-duration.onnx', expectedSha256: null, minBytes: 1024 },
      { relativePath: 'kokoro/models/voices-v1.0.bin', expectedSha256: null, minBytes: 1024 },
    ]),
  },
  {
    id: 'whisper-onnx-local',
    label: 'Whisper ONNX Local STT (Transformers.js offline)',
    role: 'stt',
    license: 'MIT',
    languages: Object.freeze(['en', 'es', 'ar', 'de', 'fr', 'he', 'hi', 'ru', 'zh']),
    notes: 'Runs strictly with allowRemoteModels=false in stt-worker.ts; requires manually provisioned tokenizer + quantized encoder/decoder ONNX files.',
    artifacts: Object.freeze([
      { relativePath: 'config.json', expectedSha256: null, minBytes: 16 },
      { relativePath: 'tokenizer.json', expectedSha256: null, minBytes: 64 },
      { relativePath: 'preprocessor_config.json', expectedSha256: null, minBytes: 16 },
      { relativePath: 'onnx/encoder_model_quantized.onnx', expectedSha256: null, minBytes: 1024 },
      { relativePath: 'onnx/decoder_model_merged_quantized.onnx', expectedSha256: null, minBytes: 1024 },
    ]),
  },
  {
    id: 'piper-es-local',
    label: 'Piper ONNX Spanish Local TTS (es_ES / es_MX)',
    role: 'tts',
    license: 'MIT',
    languages: Object.freeze(['es']),
    notes: 'Offline Spanish local TTS via Piper CLI + <voice>.onnx + <voice>.onnx.json in speechEnginesDir()/piper.',
    artifacts: Object.freeze([
      { relativePath: 'piper/es_ES-davefx-medium.onnx', expectedSha256: null, minBytes: 1024 },
      { relativePath: 'piper/es_ES-davefx-medium.onnx.json', expectedSha256: null, minBytes: 32 },
    ]),
  },
])
