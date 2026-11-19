/**
 * Text pagination — split long texts into fragments at sentence boundaries.
 * Faithful port of src-tauri/src/pagination.rs (sentence boundaries,
 * intra-token periods, abbreviations, CJK clause delimiters, UTF-16 spans).
 */

export interface TextFragment {
  text: string
  index: number
  total: number
  /** UTF-16 [start, end) of this fragment's text inside the paginated text. */
  source_start: number
  source_end: number
}

export interface PaginationConfig { enabled: boolean; fragment_size: number }

interface SentenceBoundary { position: number; delimiter: string }

const SENTENCE_END = new Set(['.', '!', '?', '。', '！', '？', '।', '॥', '؟', '۔', '։', '።', '။', '។'])
const TOKEN_HARD_CAP = 4096

const isTokenChar = (c: string): boolean => /[\p{L}\p{N}]/u.test(c)

function isIntraTokenPeriod(chars: string[], pos: number): boolean {
  if (chars[pos] !== '.') return false
  const next = chars[pos + 1]
  if (next !== undefined && (next === '.' || next === '/' || next === '\\')) return true
  const prev = chars[pos - 1]
  const prevIsToken = pos > 0 && (isTokenChar(prev) || prev === '_' || prev === '/' || prev === '\\' || prev === '.')
  if (next !== undefined) {
    return prevIsToken && (isTokenChar(next) || next === '_' || next === '/' || next === '\\' || next === '.')
  }
  // Trailing period: only an initialism close (`U.S.A.`), not a sentence end.
  const prevPrev = chars[pos - 2]
  return prevIsToken && /^[A-Z]$/.test(prev) && prevPrev === '.'
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'sr', 'jr', 'prof', 'rev', 'gen', 'gov', 'sgt', 'cpl', 'pvt', 'lt',
  'capt', 'col', 'maj', 'cmdr', 'st', 'ave', 'blvd', 'dept', 'est', 'approx', 'inc', 'ltd',
  'corp', 'no', 'vol', 'fig', 'ed', 'al',
])

function isAbbreviation(chars: string[], pos: number): boolean {
  if (pos < 1) return false
  if (pos >= 3) {
    const four = chars.slice(pos - 3, pos + 1).join('').toLowerCase()
    if (four === 'e.g.' || four === 'i.e.' || four === 'n.b.' || four === 'vs.') return true
  }
  if (pos >= 4) {
    const five = chars.slice(pos - 4, pos + 1).join('').toLowerCase()
    if (five === ' etc.' || five === '.etc.') return true
  }
  let wordStart = pos - 1
  while (wordStart > 0 && /^\p{L}$/u.test(chars[wordStart - 1])) wordStart -= 1
  if (wordStart > 0 && !/\s/.test(chars[wordStart - 1]) && chars[wordStart - 1] !== '.') return false
  const word = chars.slice(wordStart, pos).join('').toLowerCase()
  return ABBREVIATIONS.has(word)
}

export function detectSentenceBoundaries(text: string): SentenceBoundary[] {
  const chars = Array.from(text)
  const boundaries: SentenceBoundary[] = []
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (!SENTENCE_END.has(c)) continue
    // `!`/`?` glued to a following word are token punctuation, not sentence ends.
    if ((c === '!' || c === '?') && chars[i + 1] !== undefined && !/\s/.test(chars[i + 1])) {
      let j = i + 1
      let hasAlnum = false
      while (j < chars.length && !/\s/.test(chars[j])) {
        if (isTokenChar(chars[j])) { hasAlnum = true; break }
        j += 1
      }
      if (hasAlnum) continue
    }
    if (isIntraTokenPeriod(chars, i)) continue
    if (isAbbreviation(chars, i)) continue
    boundaries.push({ position: i, delimiter: c })
  }
  if (boundaries.length === 0 && text.length > 0) {
    boundaries.push({ position: chars.length - 1, delimiter: chars[chars.length - 1] })
  }
  return boundaries
}

/** UTF-16 offsets (index = codepoint index, value = UTF-16 offset). */
function buildCharToUtf16(chars: string[]): number[] {
  const map = [0]
  let acc = 0
  for (const ch of chars) {
    acc += ch.length // surrogate pairs count as 2 UTF-16 units
    map.push(acc)
  }
  return map
}

const isCjkClauseDelimiter = (c: string): boolean =>
  '\u{FF0C}\u{3002}\u{FF01}\u{FF1F}\u{3001}\u{FF1A}\u{FF1B}\u{FF08}\u{FF09}\u{3010}\u{3011}\u{300A}\u{300B}\u{300C}\u{300D}\u{300E}\u{300F}'.includes(c)

/** Fallback: force-split into max_size-bounded ranges, cutting on whitespace where possible. */
export function forceSplitRanges(text: string, maxSize: number): Array<[number, number]> {
  const chars = Array.from(text)
  const len = chars.length
  if (maxSize === 0) return len === 0 ? [] : [[0, len]]

  const ranges: Array<[number, number]> = []
  let start = 0
  while (start < len) {
    while (start < len && /\s/.test(chars[start])) start += 1
    if (start >= len) break
    const limit = Math.min(start + maxSize, len)
    if (limit >= len) { ranges.push([start, len]); break }

    let end: number | undefined
    for (let i = limit - 1; i >= start; i--) {
      if (/\s/.test(chars[i])) {
        end = i + 1
        while (end < limit && /\s/.test(chars[end])) end += 1
        break
      }
    }
    if (end === undefined) {
      for (let i = limit - 1; i > start; i--) {
        if (isCjkClauseDelimiter(chars[i])) { end = i + 1; break }
      }
    }
    if (end === undefined) {
      let tokenEnd = start
      while (tokenEnd < len && !/\s/.test(chars[tokenEnd])) tokenEnd += 1
      end = tokenEnd > start + TOKEN_HARD_CAP ? start + TOKEN_HARD_CAP : tokenEnd
    }
    if (end <= start) { ranges.push([start, limit]); start = limit } else { ranges.push([start, end]); start = end }
  }
  return ranges
}

function buildFragments(_text: string, chars: string[], pieces: Array<[number, number]>): TextFragment[] {
  const charToU16 = buildCharToUtf16(chars)
  const total = pieces.length
  return pieces.map(([start, end], index) => {
    const sliceChars = chars.slice(start, end)
    const slice = sliceChars.join('')
    const trimmedStr = slice.trim()
    // Leading/trailing whitespace in CODEPOINTS (mirrors Rust's chars().count() of the trim).
    let lead = 0
    while (lead < sliceChars.length && /\s/.test(sliceChars[lead])) lead += 1
    let trail = 0
    while (trail < sliceChars.length - lead && /\s/.test(sliceChars[sliceChars.length - 1 - trail])) trail += 1
    return {
      text: trimmedStr,
      index,
      total,
      source_start: charToU16[start + lead] ?? 0,
      source_end: charToU16[end - trail] ?? charToU16[end],
    }
  })
}

/** Split text into fragments at sentence boundaries, respecting the maximum fragment size. */
export function paginateText(text: string, config: PaginationConfig): TextFragment[] {
  if (!config.enabled || text.length === 0) {
    return [{ text, index: 0, total: 1, source_start: 0, source_end: text.length }]
  }
  const maxSize = Math.max(1, Math.floor(config.fragment_size))
  const chars = Array.from(text)
  if (chars.length <= maxSize) {
    return [{ text, index: 0, total: 1, source_start: 0, source_end: text.length }]
  }

  const boundaries = detectSentenceBoundaries(text)
  if (boundaries.length === 0) {
    return buildFragments(text, chars, forceSplitRanges(text, maxSize))
  }

  const pieces: Array<[number, number]> = []
  let fragmentStart = 0
  for (let idx = 0; idx < boundaries.length; idx++) {
    const sentenceEnd = boundaries[idx].position + 1
    const currentLen = sentenceEnd - fragmentStart
    if (currentLen > maxSize) {
      if (idx > 0) {
        const prevEnd = boundaries[idx - 1].position + 1
        if (prevEnd > fragmentStart) {
          const fragment = chars.slice(fragmentStart, prevEnd).join('')
          if (fragment.trim().length > 0) pieces.push([fragmentStart, prevEnd])
          fragmentStart = prevEnd
        }
      }
      const loneLen = sentenceEnd - fragmentStart
      if (loneLen > maxSize) {
        const loneText = chars.slice(fragmentStart, sentenceEnd).join('')
        for (const [s, e] of forceSplitRanges(loneText, maxSize)) pieces.push([fragmentStart + s, fragmentStart + e])
        fragmentStart = sentenceEnd
      }
    }
  }

  if (fragmentStart < chars.length) {
    const finalText = chars.slice(fragmentStart).join('')
    if (finalText.trim().length > 0) {
      if (chars.length - fragmentStart > maxSize) {
        for (const [s, e] of forceSplitRanges(finalText, maxSize)) pieces.push([fragmentStart + s, fragmentStart + e])
      } else {
        pieces.push([fragmentStart, chars.length])
      }
    }
  }

  if (pieces.length === 0) {
    return [{ text, index: 0, total: 1, source_start: 0, source_end: text.length }]
  }
  return buildFragments(text, chars, pieces)
}

export function shouldPaginate(text: string, config: PaginationConfig): boolean {
  return config.enabled && Array.from(text).length > Math.floor(config.fragment_size)
}

/** Number of fragments a text would produce (mirrors paginateText). */
export function estimateFragmentCount(text: string, config: PaginationConfig): number {
  if (!config.enabled || text.length === 0) return 1
  const maxSize = Math.max(1, Math.floor(config.fragment_size))
  const chars = Array.from(text)
  if (chars.length <= maxSize) return 1
  const boundaries = detectSentenceBoundaries(text)
  if (boundaries.length === 0) return Math.ceil(chars.length / maxSize)

  let count = 1
  let fragmentStart = 0
  for (let idx = 0; idx < boundaries.length; idx++) {
    const sentenceEnd = boundaries[idx].position + 1
    const currentLen = sentenceEnd - fragmentStart
    if (currentLen > maxSize) {
      if (idx > 0) {
        const prevEnd = boundaries[idx - 1].position + 1
        if (prevEnd > fragmentStart) { count += 1; fragmentStart = prevEnd }
      }
      const loneLen = sentenceEnd - fragmentStart
      if (loneLen > maxSize) {
        count += Math.ceil(loneLen / maxSize) - 1
        fragmentStart = sentenceEnd
      }
    }
  }
  return count
}
