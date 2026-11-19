/** OpenAI TTS batch adapter. Credentials and response bodies never enter logs. */
export interface OpenAiSynthesisRequest {
  text: string
  voice: string
  model: string
  instructions?: string
  apiKey: string
  signal?: AbortSignal
}

const ENDPOINT = 'https://api.openai.com/v1/audio/speech'
const MAX_AUDIO_BYTES = 32 * 1024 * 1024
const MAX_TEXT_LENGTH = 4096
const TIMEOUT_MS = 90_000

/** Returns 24 kHz, mono, signed 16-bit little-endian PCM. */
export async function synthesizeOpenAi(request: OpenAiSynthesisRequest): Promise<Buffer> {
  if (!request.apiKey.trim()) throw new Error('OpenAI API key is missing')
  if (!request.text.trim() || request.text.length > MAX_TEXT_LENGTH) throw new Error('OpenAI text must contain 1–4096 characters')
  if (!request.model.trim() || !request.voice.trim()) throw new Error('OpenAI model and voice are required')
  const signal = request.signal
    ? AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)])
    : AbortSignal.timeout(TIMEOUT_MS)
  const body: Record<string, string> = {
    model: request.model, input: request.text, voice: request.voice, response_format: 'pcm',
  }
  if (request.instructions?.trim()) body.instructions = request.instructions.trim()
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal, redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`OpenAI speech request failed (HTTP ${response.status})`)
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (declaredLength > MAX_AUDIO_BYTES) {
    await response.body?.cancel().catch(() => {})
    throw new Error('OpenAI audio response exceeds size limit')
  }
  if (!response.body) throw new Error('OpenAI returned an empty audio response')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_AUDIO_BYTES) {
        await reader.cancel().catch(() => {})
        throw new Error('OpenAI audio response exceeds size limit')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  if (!total || total % 2 !== 0) throw new Error('OpenAI returned invalid PCM audio')
  return Buffer.concat(chunks, total)
}
