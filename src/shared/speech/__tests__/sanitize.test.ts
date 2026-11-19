/**
 * Ported from CopySpeech's Rust test suite (sanitize/tts_normalize_tests.rs,
 * sanitize/cleanup_tests.rs, sanitize/markdown.rs::tests, pagination_tests.rs).
 * Node vitest environment; pure functions only.
 */
import { describe, expect, it } from 'vitest'
import {
  cleanupArtifacts,
  removeUnpronounceable,
  sanitizeTts,
  sanitizeText,
  stripMarkdown,
} from '../sanitize'
import {
  estimateFragmentCount,
  forceSplitRanges,
  paginateText,
  shouldPaginate,
} from '../paginate'
import type { SanitizationConfig } from '../sanitize'

const defaultMarkdown = {
  enabled: true,
  strip_headers: true,
  strip_code_blocks: true,
  strip_inline_code: true,
  strip_links: true,
  strip_bold_italic: true,
  strip_lists: true,
  strip_blockquotes: true,
}
const defaultSanitization: SanitizationConfig = {
  enabled: true,
  markdown: { ...defaultMarkdown, strip_bold_italic: false, strip_inline_code: false },
  tts_normalization: { enabled: true },
}

describe('markdown stripping', () => {
  it('strips headers with a trailing period unless already punctuated', () => {
    expect(stripMarkdown('# Header', defaultMarkdown)).toBe('Header.')
    expect(stripMarkdown('## Header', defaultMarkdown)).toBe('Header.')
    expect(stripMarkdown('# Already done!', defaultMarkdown)).toBe('Already done!')
    expect(stripMarkdown('# Section:', defaultMarkdown)).toBe('Section:')
    expect(stripMarkdown('# Question?', defaultMarkdown)).toBe('Question?')
  })
  it('strips code blocks and inline code when enabled', () => {
    expect(stripMarkdown('Text\n```code```\nMore', defaultMarkdown)).toBe('Text\n\nMore')
    expect(stripMarkdown('Use `sudo` command', defaultMarkdown)).toBe('Use  command')
  })
  it('replaces links with their label', () => {
    expect(stripMarkdown('Visit [Google](https://google.com)', defaultMarkdown)).toBe('Visit Google')
  })
  it('keeps bold and italic markers by default, strips when enabled', () => {
    expect(stripMarkdown('**bold**, __bold__, *italic*, _italic_', { ...defaultMarkdown, strip_bold_italic: false })).toBe(
      '**bold**, __bold__, *italic*, _italic_',
    )
    expect(stripMarkdown('**bold** and *italic*', defaultMarkdown)).toBe('bold and italic')
  })
  it('turns list items into sentences', () => {
    const input = '## Legend\n\n- **Added**: New features\n- **Changed**: Things changed.'
    const result = stripMarkdown(input, { ...defaultMarkdown, strip_headers: true })
    expect(result).toBe('Legend.\n\nAdded: New features.\nChanged: Things changed.')
  })
  it('strips blockquotes', () => {
    expect(stripMarkdown('> Quote text', defaultMarkdown)).toBe('Quote text')
  })
})

describe('remove_unpronounceable', () => {
  it('strips emoji and pictographs', () => {
    expect(removeUnpronounceable('Hello 😀 world')).toBe('Hello  world')
    expect(removeUnpronounceable('Text ✅ check')).toBe('Text  check')
  })
  it('strips symbol scripts beyond classic emoji', () => {
    expect(removeUnpronounceable('A⭐B★C→D∑E①F■G')).toBe('ABCDEFG')
    expect(removeUnpronounceable('🇺🇸 US flag')).toBe(' US flag')
  })
  it('strips control and invisible characters', () => {
    expect(removeUnpronounceable('xy'.replace('', '\u{E000}'))).toBe('xy')
    expect(removeUnpronounceable('a\u{200B}b')).toBe('ab')
    expect(removeUnpronounceable('\u{FEFF}text')).toBe('text')
    expect(removeUnpronounceable('hy\u{00AD}phen')).toBe('hyphen')
  })
  it('normalizes whitespace controls to spaces', () => {
    expect(removeUnpronounceable('foo\tbar')).toBe('foo bar')
  })
  it('keeps genuine speech content', () => {
    expect(removeUnpronounceable("it's — ok… \"quoted\"")).toBe("it's — ok… \"quoted\"")
    expect(removeUnpronounceable('50% + $5')).toBe('50% + $5')
  })
})

describe('sanitize_tts', () => {
  it('acceptance example: leading comma + curly apostrophe', () => {
    expect(sanitizeTts(', They didn’t know that they were looking for a better theory.')).toBe(
      "They didn't know that they were looking for a better theory.",
    )
  })
  it('strips newlines', () => {
    expect(sanitizeTts('line one\nline two')).toBe('line one line two')
    expect(sanitizeTts('a\r\nb')).toBe('a b')
  })
  it('removes URLs and citations', () => {
    expect(sanitizeTts('Visit https://example.com for info')).toBe('Visit for info')
    expect(sanitizeTts('Claim [12] holds')).toBe('Claim holds')
  })
  it('expands slash lookups and options', () => {
    expect(sanitizeTts('w/o testing')).toBe('without testing')
    expect(sanitizeTts('n/a here')).toBe('not applicable here')
    expect(sanitizeTts('and/or both')).toBe('and or both')
    expect(sanitizeTts('install/uninstall it')).toBe('install or uninstall it')
    expect(sanitizeTts('100 km/h limit')).toBe('100 kilometers or h limit') // pipeline: slash_options → metric units
  })
  it('expands latin abbreviations and titles', () => {
    expect(sanitizeTts('a, e.g. this')).toBe('a, for example this')
    expect(sanitizeTts('i.e. that')).toBe('that is that')
    expect(sanitizeTts('Docs etc. are done')).toBe('Docs et cetera are done')
    expect(sanitizeTts('vs. other')).toBe('versus other')
    expect(sanitizeTts('Dr. Smith')).toBe('Doctor Smith')
    expect(sanitizeTts('Mr. Doe and Mrs. Doe')).toBe('Mister Doe and Misses Doe')
  })
  it('expands number magnitudes before units', () => {
    expect(sanitizeTts('5m users')).toBe('5 million users')
    expect(sanitizeTts('3bn revenue')).toBe('3 billion revenue')
    expect(sanitizeTts('2k stars')).toBe('2 thousand stars')
  })
  it('expands metric units', () => {
    expect(sanitizeTts('5 km away')).toBe('5 kilometers away')
    expect(sanitizeTts('500 g of flour')).toBe('500 grams of flour')
  })
  it('expands currency symbols and symbols', () => {
    expect(sanitizeTts('$50 today')).toBe('50 dollars today')
    expect(sanitizeTts('€20 please')).toBe('20 euros please')
    expect(sanitizeTts('a & b')).toBe('a and b')
    expect(sanitizeTts('50% off')).toBe('50 percent off')
    expect(sanitizeTts('(parenthetical) note')).toBe('parenthetical, note') // orphan comma stripped at the end
  })
  it('normalizes unicode quotes, dashes and fullwidth forms', () => {
    expect(sanitizeTts('“quote” and ‘single’')).toBe('"quote" and \'single\'')
    expect(sanitizeTts('fullwidth ｈｅｌｌｏ')).toBe('fullwidth hello')
  })
  it('folds cyrillic homoglyphs only inside latin-mixed words', () => {
    expect(sanitizeTts('раyload is ready')).toBe('payload is ready')
    expect(sanitizeTts('Москва')).toBe('Москва')
  })
  it('strips leading orphan punctuation but keeps opening quotes', () => {
    expect(sanitizeTts(', hello world')).toBe('hello world')
    expect(sanitizeTts('— dash start')).toBe('dash start') // em dash → ", " → orphan comma stripped at the end
  })
})

describe('cleanupArtifacts', () => {
  it('collapses repeated spaces and fixes space-before-punct', () => {
    expect(cleanupArtifacts('a  b  , c')).toBe('a b, c')
  })
  it('collapses repeated commas and comma-before-period', () => {
    expect(cleanupArtifacts('a,, b, . c')).toBe('a, b. c')
  })
  it('ensures space after comma/colon/semicolon before letters', () => {
    expect(cleanupArtifacts('a,b')).toBe('a, b')
  })
})

describe('sanitizeText pipeline', () => {
  it('returns verbatim text when disabled', () => {
    expect(sanitizeText('**not stripped**', { ...defaultSanitization, enabled: false })).toBe('**not stripped**')
  })
  it('strips markdown then normalizes', () => {
    expect(sanitizeText('# Title\nSome $5 item', defaultSanitization)).toBe('Title. Some 5 dollars item')
  })
})

describe('pagination', () => {
  const cfg = { enabled: true, fragment_size: 100 }
  it('returns a single fragment when disabled or short', () => {
    expect(paginateText('hello world', { enabled: false, fragment_size: 10 })).toHaveLength(1)
    expect(paginateText('short', cfg)).toHaveLength(1)
    expect(paginateText('', cfg)).toHaveLength(1)
  })
  it('splits at sentence boundaries', () => {
    const text = 'This is a fairly long first sentence that carries on for a while now. This is the second sentence and it is also reasonably long indeed yes. And a third sentence to push it over the edge for sure.'
    const fragments = paginateText(text, { enabled: true, fragment_size: 80 })
    expect(fragments.length).toBeGreaterThan(1)
    for (const f of fragments) expect(f.text.trim().length).toBeGreaterThan(0)
    expect(fragments.map((f) => f.index)).toEqual(fragments.map((_, i) => i))
    expect(fragments.every((f) => f.total === fragments.length)).toBe(true)
  })
  it('does not split intra-token periods', () => {
    const text = 'Upgrade to v0.2.10 now. It fixes pi at 3.14 and example.com too.'
    const fragments = paginateText(text, { enabled: true, fragment_size: 100 })
    expect(fragments).toHaveLength(1)
  })
  it('force-splits on whitespace, never inside a word', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    for (const [start, end] of forceSplitRanges(words, 50)) {
      const piece = words.slice(start, end)
      expect(piece).not.toMatch(/^\S*$/) // never a partial word at boundaries…
    }
    // and every piece boundary lands on whitespace or the string edge
    for (const [start, end] of forceSplitRanges(words, 50)) {
      if (end < words.length) expect(/\s/.test(words[end]) || words[end - 1] === ' ').toBe(true)
    }
  })
  it('keeps unbreakable tokens whole (bounded by the hard cap)', () => {
    const token = 'x'.repeat(200)
    const [start, end] = forceSplitRanges(token, 50)[0]
    expect(end - start).toBe(200)
    expect(start).toBe(0)
  })
  it('estimateFragmentCount and shouldPaginate agree with paginateText', () => {
    const text = 'One sentence here. Another one follows it. And a third one now. A fourth appears.'
    const c = { enabled: true, fragment_size: 30 }
    expect(estimateFragmentCount(text, c)).toBe(paginateText(text, c).length)
    expect(shouldPaginate(text, c)).toBe(true)
    expect(shouldPaginate('tiny', c)).toBe(false)
  })
  it('fragments carry UTF-16 source spans', () => {
    const text = 'Short one. A much longer second sentence that has to be paginated onto its own fragment please.'
    const fragments = paginateText(text, { enabled: true, fragment_size: 60 })
    for (const f of fragments) {
      expect(text.slice(f.source_start, f.source_end)).toBe(f.text)
    }
  })
})
