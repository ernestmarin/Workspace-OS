/**
 * Caption alignment model — shared between the main process (engines that
 * report timings produce these) and the renderer (karaoke rendering).
 *
 * `words` entries are per-character timings as APIs deliver them (one entry
 * per character); display code re-segments them into words. UTF-16 offsets
 * everywhere, matching JavaScript string indexing.
 *
 * Ported from CopySpeech src-tauri/src/tts/captions.rs +
 * src/lib/models/captions.ts, including emote-tag stripping (the APIs echo
 * interpreted [tags] back inside the alignment stream).
 */

export interface WordTiming {
  text_start: number
  text_end: number
  start_ms: number
  end_ms: number
}
export interface CaptionAlignment {
  text: string
  words: WordTiming[]
}

export interface TagSpan {
  start_utf16: number
  end_utf16: number
  text: string
}

/** [bracketed] emote tags: single-line, no nesting. */
export function findTagSpans(text: string): TagSpan[] {
  const spans: TagSpan[] = []
  const re = /\[[A-Za-z][^\]\n]{0,63}\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    spans.push({ start_utf16: m.index, end_utf16: m.index + m[0].length, text: m[0] })
  }
  return spans
}

/** <angle> tags: the xAI dialect; interpreted, never spoken. */
export function findAngleTagSpans(text: string): TagSpan[] {
  const spans: TagSpan[] = []
  const re = /<[A-Za-z/][^>\n]{0,63}>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    spans.push({ start_utf16: m.index, end_utf16: m.index + m[0].length, text: m[0] })
  }
  return spans
}

function strippedOfSpans(alignment: CaptionAlignment, spans: TagSpan[]): CaptionAlignment {
  if (spans.length === 0) return { ...alignment, words: alignment.words.map((w) => ({ ...w })) }
  const removedBefore = (offset: number): number =>
    spans.filter((s) => s.end_utf16 <= offset).reduce((sum, s) => sum + (s.end_utf16 - s.start_utf16), 0)
  const insideTag = (offset: number): boolean =>
    spans.some((s) => s.start_utf16 <= offset && offset < s.end_utf16)
  let text = ''
  let last = 0
  for (const span of spans) {
    text += alignment.text.slice(last, span.start_utf16)
    last = span.end_utf16
  }
  text += alignment.text.slice(last)
  const words = alignment.words
    .filter((w) => !insideTag(w.text_start) && w.text_end > 0 && !insideTag(w.text_end - 1))
    .map((w) => {
      const shift = removedBefore(w.text_start)
      return { ...w, text_start: w.text_start - shift, text_end: w.text_end - shift }
    })
  return { text, words }
}

/** Remove `[...]` emote-tag characters and their timings. */
export function strippedOfEmoteTags(alignment: CaptionAlignment): CaptionAlignment {
  return strippedOfSpans(alignment, findTagSpans(alignment.text))
}
/** Same, plus `<...>` wraps (xAI dialect). */
export function strippedOfAllEmoteTags(alignment: CaptionAlignment): CaptionAlignment {
  const spans = [...findTagSpans(alignment.text), ...findAngleTagSpans(alignment.text)]
    .sort((a, b) => a.start_utf16 - b.start_utf16)
  return strippedOfSpans(alignment, spans)
}

const boundaryOk = (text: string, offset: number): boolean => {
  const previous = text.charCodeAt(offset - 1)
  const next = text.charCodeAt(offset)
  // Reject splitting a surrogate pair.
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
}

/** Untrusted data (IPC, history) must pass this before rendering; never invent a highlight. */
export function validCaptionAlignment(value: CaptionAlignment | null | undefined): value is CaptionAlignment {
  if (!value || typeof value.text !== 'string' || !Array.isArray(value.words)) return false
  let textEnd = 0
  let audioEnd = 0
  for (const word of value.words) {
    if (
      !word ||
      !Number.isInteger(word.text_start) || !Number.isInteger(word.text_end) ||
      word.text_start < textEnd || word.text_end <= word.text_start ||
      word.text_end > value.text.length ||
      !boundaryOk(value.text, word.text_start) || !boundaryOk(value.text, word.text_end) ||
      !Number.isFinite(word.start_ms) || !Number.isFinite(word.end_ms) ||
      word.start_ms < audioEnd || word.end_ms < word.start_ms
    ) return false
    textEnd = word.text_end
    audioEnd = word.end_ms
  }
  return true
}

export interface CaptionWord {
  text: string
  offset: number
  start: number | null
  end: number | null
  phrase: number
}

/** Segment presentation only. Times are native audio milliseconds, never duration weights. */
export function buildCaptions(text: string, alignment?: CaptionAlignment | null): CaptionWord[] {
  const timings = validCaptionAlignment(alignment) && alignment.text === text ? alignment.words : []
  const words: CaptionWord[] = []
  let timingIndex = 0
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  for (const segment of segmenter.segment(text)) {
    if (!segment.isWordLike) continue
    const index = segment.index
    const end = index + segment.segment.length
    while (timingIndex < timings.length && timings[timingIndex].text_end <= index) timingIndex++
    const first = timings[timingIndex]
    if (!first) {
      words.push({ text: segment.segment, offset: index, start: null, end: null, phrase: 0 })
      continue
    }
    let last = first
    for (let i = timingIndex + 1; i < timings.length && timings[i].text_start < end; i++) last = timings[i]
    words.push({ text: segment.segment, offset: index, start: first.start_ms, end: last.end_ms, phrase: 0 })
  }
  return words
}

/** Even-spaced word timings across a measured duration — the fallback when an engine reports no timings. */
export function estimateAlignment(text: string, durationMs: number): CaptionAlignment {
  const words = buildCaptions(text)
  if (words.length === 0) return { text, words: [] }
  const total = words.length
  return {
    text,
    words: words.map((w, i) => ({
      text_start: w.offset,
      text_end: w.offset + w.text.length,
      start_ms: (durationMs * i) / total,
      end_ms: (durationMs * (i + 1)) / total,
    })),
  }
}

