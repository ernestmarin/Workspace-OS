/**
 * Incremental sentence assembly for a future assistant-only speech path.
 * One instance per response/generation; no microphone, IPC, TTS or agent effects.
 *
 * Input must already be selected assistant prose. This is NOT a Markdown/tool
 * parser or sanitizer. Do not connect raw agent deltas straight to TTS through
 * this helper: extraction, Markdown safety, ownership and backpressure are
 * separate integration gates. Existing completed-reply reading is unchanged.
 */
import { detectSentenceBoundaries } from './paginate'

export interface SpeechSentence {
  text: string
  /** UTF-16 [start, end) in the concatenation of this response's accepted deltas. */
  source_start: number
  source_end: number
}

export interface SentenceStreamOptions {
  /** Hard UTF-16 bound on each sentence and the retained tail; no silent truncation. */
  maxSentenceLength?: number
  /** Includes already emitted text so a response cannot stream forever. */
  maxTotalLength?: number
}

const CLOSING_PUNCTUATION = new Set(Array.from('.!?…。！？؟۔।॥։።။។"\'”’»›)]}」』）］】》〉'))

/** Deltas may end halfway through a surrogate pair, but emitted/final text may not. */
function validUnicode(text: string, allowTrailingHigh: boolean): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit >= 0xdc00 && unit <= 0xdfff) return false
    if (unit < 0xd800 || unit > 0xdbff) continue
    if (i === text.length - 1) return allowTrailingHigh
    const low = text.charCodeAt(++i)
    if (low < 0xdc00 || low > 0xdfff) return false
  }
  return true
}

export class SentenceStream {
  private pending = ''
  private sourceOffset = 0
  private receivedLength = 0
  private ended = false
  private readonly maxSentenceLength: number
  private readonly maxTotalLength: number

  constructor(options: SentenceStreamOptions = {}) {
    this.maxSentenceLength = options.maxSentenceLength ?? 4096
    this.maxTotalLength = options.maxTotalLength ?? 20_000
    if (!Number.isSafeInteger(this.maxSentenceLength) || this.maxSentenceLength < 2 ||
        !Number.isSafeInteger(this.maxTotalLength) || this.maxTotalLength > 100_000 ||
        this.maxTotalLength < this.maxSentenceLength) throw new RangeError('Invalid sentence stream limits')
  }

  get bufferedLength(): number { return this.pending.length }

  /**
   * Retain the ambiguous final sentence until right context or explicit success.
   * Overflow/invalid data closes this stream and returns no partial batch from
   * this call. Previously emitted text cannot be recalled; the caller must also
   * cancel its owned synthesis/playback when a response fails or is superseded.
   */
  push(delta: string): SpeechSentence[] {
    if (this.ended) return []
    if (typeof delta !== 'string') return this.fail(new TypeError('Speech delta must be text'))
    if (delta.length > this.maxTotalLength - this.receivedLength) return this.fail(new RangeError('Speech response exceeds text budget'))
    this.receivedLength += delta.length
    this.pending += delta
    if (!validUnicode(this.pending, true)) return this.fail(new TypeError('Invalid Unicode in speech response'))

    const chars = Array.from(this.pending)
    const offsets = [0]
    for (const char of chars) offsets.push(offsets[offsets.length - 1] + char.length)
    const output: SpeechSentence[] = []
    let consumed = 0
    for (const boundary of detectSentenceBoundaries(this.pending)) {
      if (offsets[boundary.position] < consumed) continue
      let end = boundary.position + 1
      while (end < chars.length && CLOSING_PUNCTUATION.has(chars[end])) end++
      let next = end
      while (next < chars.length && /\s/u.test(chars[next])) next++
      // Also excludes paginate's fallback boundary at the unfinished tail.
      if (next === chars.length) continue
      // ASCII punctuation glued to a token may be a filename, URL or identifier.
      // Non-Latin sentence punctuation does not require intervening whitespace.
      if ('.!?'.includes(boundary.delimiter) && next === end) continue
      const endOffset = offsets[end]
      const segment = this.segment(consumed, endOffset)
      if (segment) output.push(segment)
      consumed = endOffset
    }
    if (this.pending.length - consumed > this.maxSentenceLength) return this.fail(new RangeError('Speech sentence exceeds buffer limit'))
    this.pending = this.pending.slice(consumed)
    this.sourceOffset += consumed
    return output
  }

  /** Explicit success only. On failure use false/cancel; never flush stale text. */
  finish(success: boolean): SpeechSentence[] {
    if (this.ended) return []
    if (success !== true) { this.cancel(); return [] }
    try {
      if (!validUnicode(this.pending, false)) return this.fail(new TypeError('Incomplete Unicode in speech response'))
      const segment = this.segment(0, this.pending.length)
      return segment ? [segment] : []
    } finally { this.cancel() }
  }

  /** Terminal/idempotent: late deltas cannot restart this response. */
  cancel(): void { this.ended = true; this.pending = '' }

  private segment(start: number, end: number): SpeechSentence | null {
    const raw = this.pending.slice(start, end)
    const text = raw.trim()
    if (!text) return null
    if (text.length > this.maxSentenceLength) return this.fail(new RangeError('Speech sentence exceeds buffer limit'))
    const source_start = this.sourceOffset + start + raw.length - raw.trimStart().length
    return { text, source_start, source_end: source_start + text.length }
  }

  private fail(error: Error): never { this.cancel(); throw error }
}
