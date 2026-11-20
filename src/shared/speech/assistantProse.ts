/**
 * Conservative incremental speech representation of already-authorized assistant
 * text. Not a CommonMark renderer, event/tool filter, secret detector or scheduler.
 * Keep complete blocks until a blank line/success: never sanitize arbitrary deltas.
 * Unsupported HTML/ambiguous inline markup fails closed. Tables, quoted/indented
 * blocks, images and code are omitted. The terminal's original text is unchanged.
 */
export interface AssistantProseOptions {
  maxBlockLength?: number
  maxTotalLength?: number
}

function validText(text: string, trailingHigh: boolean): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if ((unit < 32 && ![9, 10, 13].includes(unit)) || unit === 127 || (unit >= 0xdc00 && unit <= 0xdfff)) return false
    if (unit < 0xd800 || unit > 0xdbff) continue
    if (i === text.length - 1) return trailingHigh
    const low = text.charCodeAt(++i)
    if (low < 0xdc00 || low > 0xdfff) return false
  }
  return true
}

const markupError = (): never => { throw new Error('Incomplete or unsupported speech markup') }
const runEnd = (text: string, start: number): number => {
  let end = start + 1
  while (text[end] === text[start]) end++
  return end
}

function codeEnd(text: string, start: number): number {
  const length = runEnd(text, start) - start
  for (let next = start + length; next < text.length;) {
    const candidate = text.indexOf('`', next)
    if (candidate < 0) break
    const end = runEnd(text, candidate)
    if (end - candidate === length) return end
    next = end
  }
  return markupError()
}

/** End of a nested label/destination, including quoted titles and escaped delimiters. */
function balancedEnd(text: string, start: number, open: '[' | '('): number {
  const close = open === '[' ? ']' : ')'
  let depth = 0, quote = '', angle = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (char === '\\') { i++; continue }
    if (quote) { if (char === quote) quote = ''; continue }
    if (angle) { if (char === '>') angle = false; continue }
    if (open === '(' && (char === '"' || char === "'")) { quote = char; continue }
    if (open === '(' && char === '<') { angle = true; continue }
    if (char === open && ++depth > 32) throw new RangeError('Speech markup nesting exceeds limit')
    if (char === close && --depth === 0) return i + 1
  }
  return markupError()
}

function inlineProse(text: string, depth = 0): string {
  if (depth > 16) throw new RangeError('Speech markup nesting exceeds limit')
  let output = ''
  for (let i = 0; i < text.length;) {
    const char = text[i]
    if (char === '\\' && i + 1 < text.length) { output += text[i + 1]; i += 2; continue }
    if (char === '`') { i = codeEnd(text, i); output += ' '; continue }
    const image = char === '!' && text[i + 1] === '['
    if (char === '[' || image) {
      const start = image ? i + 1 : i
      const end = balancedEnd(text, start, '[')
      const label = text.slice(start + 1, end - 1)
      let next = end
      while (/\s/u.test(text[next] ?? '') && next < text.length) next++
      if (text[next] === '(' || text[next] === '[') next = balancedEnd(text, next, text[next] as '(' | '[')
      else next = end
      if (!image && !/^\d+$/.test(label)) output += inlineProse(label, depth + 1)
      else output += ' '
      i = next
      continue
    }
    if (char === '<') {
      const rest = text.slice(i + 1)
      if (/^[a-z][a-z0-9+.-]*:/i.test(rest)) {
        const end = text.indexOf('>', i + 1)
        if (end < 0) return markupError()
        i = end + 1; output += ' '; continue
      }
      if (/^(?:\/?[a-z!]|\?)/i.test(rest)) return markupError()
    }
    const url = text.slice(i).match(/^(?:[a-z][a-z0-9+.-]{1,20}:\/\/|mailto:|data:|javascript:)[^\s<>]*/i)
    if (url) { i += url[0].length; output += ' '; continue }
    if (!'*_~'.includes(char)) output += char
    i++
  }
  return output
}

interface Fence { marker: string; length: number; quotes: number }
const quotePrefix = (line: string): string => line.match(/^(?: {0,3}>[\t ]?)+/)?.[0] ?? ''

export class AssistantProseStream {
  private line = ''
  private skipLineFeed = false
  private block = ''
  private skippedBlock = false
  private fence: Fence | null = null
  private received = 0
  private ended = false
  private readonly maxBlockLength: number
  private readonly maxTotalLength: number

  constructor(options: AssistantProseOptions = {}) {
    this.maxBlockLength = options.maxBlockLength ?? 4096
    this.maxTotalLength = options.maxTotalLength ?? 20_000
    if (!Number.isSafeInteger(this.maxBlockLength) || this.maxBlockLength < 1 ||
        !Number.isSafeInteger(this.maxTotalLength) || this.maxTotalLength < this.maxBlockLength ||
        this.maxTotalLength > 100_000) throw new RangeError('Invalid assistant prose limits')
  }

  get bufferedLength(): number { return this.line.length + this.block.length }

  /** Each returned string is a complete prose block; join blocks with whitespace. */
  push(delta: string): string[] {
    if (this.ended) return []
    try {
      if (typeof delta !== 'string') throw new TypeError('Assistant speech delta must be text')
      if (delta.length > this.maxTotalLength - this.received) throw new RangeError('Assistant speech exceeds raw text budget')
      this.received += delta.length
      // CR is already a line ending. Remember only whether its optional LF
      // needs skipping, rather than retaining a delimiter against the text cap.
      if (this.skipLineFeed && delta.length) {
        if (delta[0] === '\n') delta = delta.slice(1)
        this.skipLineFeed = false
      }
      this.line += delta
      if (!validText(this.line, true)) throw new TypeError('Invalid Unicode or control in assistant speech')
      const output: string[] = []
      let next: number
      while ((next = this.line.search(/[\r\n]/)) >= 0) {
        this.skipLineFeed = this.line[next] === '\r' && next === this.line.length - 1
        const line = this.line.slice(0, next)
        const width = this.line.slice(next, next + 2) === '\r\n' ? 2 : 1
        this.line = this.line.slice(next + width)
        output.push(...this.consumeLine(line))
      }
      this.assertBuffer()
      return output
    } catch (error) { this.cancel(); throw error }
  }

  finish(success: boolean): string[] {
    if (this.ended) return []
    if (success !== true) { this.cancel(); return [] }
    try {
      if (!validText(this.line, false)) throw new TypeError('Incomplete Unicode in assistant speech')
      const output = this.consumeLine(this.line)
      this.line = ''
      output.push(...this.flushBlock())
      return output
    } finally { this.cancel() }
  }

  cancel(): void { this.ended = true; this.line = ''; this.block = ''; this.fence = null; this.skippedBlock = false; this.skipLineFeed = false }

  private assertBuffer(): void {
    if (this.bufferedLength > this.maxBlockLength) throw new RangeError('Assistant speech exceeds block buffer limit')
  }

  private consumeLine(line: string): string[] {
    // Check before a completed line can discard/reclassify the preceding block.
    // The same prefix must exceed the cap for batch and one-code-unit deltas.
    if (this.block.length + line.length > this.maxBlockLength) throw new RangeError('Assistant speech exceeds block buffer limit')
    const prefix = quotePrefix(line)
    const quotes = prefix.split('>').length - 1
    const unquoted = line.slice(prefix.length)
    if (this.fence) {
      const match = unquoted.match(/^ {0,3}(`+|~+)[\t ]*$/)
      if (quotes === this.fence.quotes && match?.[1][0] === this.fence.marker && match[1].length >= this.fence.length) this.fence = null
      return []
    }
    const opening = unquoted.replace(/^ {0,3}(?:[-+*]|\d{1,9}[.)])[\t ]+/, '').match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (opening) {
      const output = this.flushBlock()
      this.fence = { marker: opening[1][0], length: opening[1].length, quotes }
      return output
    }
    if (!line.trim()) return this.flushBlock()
    // Deliberately omit unsupported non-prose blocks, including lazy continuations.
    if (/^(?: {4}|\t| {0,3}>| {0,3}\[[^\]]+\]:)/.test(line) || line.includes('|')) this.skippedBlock = true
    if (this.skippedBlock) { this.block = ''; return [] }
    // Setext headings and rules carry no spoken text of their own.
    if (/^ {0,3}(?:=+|-+|(?:\*\s*){3,}|(?:_\s*){3,})\s*$/.test(line)) return []
    const heading = /^ {0,3}#{1,6}\s+/.test(line) ? line.replace(/^ {0,3}#{1,6}\s+/, '').replace(/\s+#+\s*$/, '') : line
    const prose = heading.replace(/^ {0,3}(?:[-+*]|\d{1,9}[.)])\s+/, '')
    this.block += (this.block ? '\n' : '') + prose
    // `line` may still contain later blocks from this same delta. Bound that
    // remainder only after consuming its line endings, independent of chunking.
    if (this.block.length > this.maxBlockLength) throw new RangeError('Assistant speech exceeds block buffer limit')
    return []
  }

  private flushBlock(): string[] {
    const block = this.block
    this.block = ''
    const skip = this.skippedBlock
    this.skippedBlock = false
    if (!block || skip) return []
    const text = inlineProse(block).replace(/\s+/gu, ' ').replace(/ +([,.!?;:。，！？؟])/gu, '$1').trim()
    return text && /[\p{L}\p{N}]/u.test(text) ? [text] : []
  }
}
