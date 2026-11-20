import { describe, expect, it } from 'vitest'
import { AssistantProseStream } from './assistantProse'
import { SentenceStream } from './sentenceStream'

function extract(deltas: string[]): string[] {
  const stream = new AssistantProseStream()
  return [...deltas.flatMap((delta) => stream.push(delta)), ...stream.finish(true)]
}

const fixture = '# Hola **mundo**.\n\nConsulta [la guía](https://example.test/private?token=hidden "title").\n\n```ts\nsecret();\n\nnotProse();\n```\n\nDespués `private()` seguimos.\n'
const expected = ['Hola mundo.', 'Consulta la guía.', 'Después seguimos.']

describe('bounded assistant prose extraction (not event authorization)', () => {
  it('holds a paragraph until its Markdown block is stable, or explicit success', () => {
    const stream = new AssistantProseStream()
    expect(stream.push('Hello. ')).toEqual([])
    expect(stream.push('**Next**.\n')).toEqual([])
    expect(stream.push('\nLast')).toEqual(['Hello. Next.'])
    expect(stream.finish(true)).toEqual(['Last'])
    expect(stream.finish(true)).toEqual([])
    expect(stream.push('late')).toEqual([])
  })
  it('is invariant to every two-way split and one-code-unit deltas, including split delimiters', () => {
    expect(extract([fixture])).toEqual(expected)
    for (let i = 0; i <= fixture.length; i++) expect(extract([fixture.slice(0, i), fixture.slice(i)])).toEqual(expected)
    expect(extract(fixture.split(''))).toEqual(expected)
  })
  it.each([
    ['```\nprivate\n\nmore\n```\n\nAfter.', ['After.']],
    ['~~~~lang\nprivate\n~~~\nstill private\n~~~~~\n\nAfter.', ['After.']],
    ['Safe.\n\n```\nprivate with no close', ['Safe.']],
    ['- ```js\n  private\n  ```\n\nAfter.', ['After.']],
    ['> ```js\n> private\n> ```\n\nAfter.', ['After.']],
    ['    private\n    code\n\nAfter.', ['After.']],
    ['\tprivate\n\nAfter.', ['After.']],
    ['a | b\n---|---\nprivate | cell\n\nAfter.', ['After.']],
    ['> quoted tool log\nlazy continuation\n\nAfter.', ['After.']],
    ['[id]: https://example.test/private\n  "private title"\n\nAfter.', ['After.']],
    ['Heading\n=======\n\n- Uno.\n2. Dos.', ['Heading', 'Uno. Dos.']],
  ])('excludes conservative non-prose blocks: %s', (source, result) => {
    expect(extract(source.split(''))).toEqual(result)
  })
  it('bounds retained blocks rather than depending on the size of incoming deltas', () => {
    const source = 'Hello.\n\n'.repeat(700)
    const whole = extract([source])
    expect(whole).toHaveLength(700)
    expect(extract(source.split(''))).toEqual(whole)
  })
  it('never mistakes list-prefixed or over-indented code for a closing top-level fence', () => {
    expect(extract(['```\nprivate\n- ```\nstill private\n    ```\nstill private\n```\n\nAfter.'])).toEqual(['After.'])
  })
  it('keeps link labels but never destinations, image alt text, reference ids or raw URLs', () => {
    const source = 'Read [the **guide**](https://host/a(b) "a ) private title"), [label][private-id] and [7]. ![secret alt](file:///private) Visit https://host/private?key=hidden or <https://host/private>.'
    expect(extract([source])).toEqual(['Read the guide, label and. Visit or.'])
  })
  it('handles exact-length backtick runs and does not leak their embedded punctuation', () => {
    expect(extract(['Before ``one ` private.\nmore`` after `private` done.'])).toEqual(['Before after done.'])
  })
  it.each(['prefix `private', 'prefix [private', 'prefix [label](https://host/private', 'prefix <script>private</script>', '<!-- private\n\ncontinued -->'])('fails closed on incomplete/unsupported markup: %s', (source) => {
    const stream = new AssistantProseStream()
    expect(() => { stream.push(source); stream.finish(true) }).toThrow(/markup/i)
    expect(stream.push('late')).toEqual([])
    expect(stream.finish(true)).toEqual([])
    expect(stream.bufferedLength).toBe(0)
  })
  it('never restarts code-like content after an ambiguous inline span crosses a blank line', () => {
    const stream = new AssistantProseStream()
    expect(() => stream.push('Before `private\n\n')).toThrow('markup')
    expect(stream.push('private tail`\n\nAfter.')).toEqual([])
  })
  it('drops pending text on failure/cancel and does not affect another response', () => {
    const first = new AssistantProseStream(), second = new AssistantProseStream()
    first.push('private tail'); second.push('owned')
    expect(first.finish(false)).toEqual([])
    expect(first.push('late')).toEqual([])
    expect(second.finish(true)).toEqual(['owned'])
  })
  it('counts skipped source against the raw text budget and fails without truncation', () => {
    const stream = new AssistantProseStream({ maxBlockLength: 20, maxTotalLength: 30 })
    stream.push('```\n' + 'x\n'.repeat(10))
    expect(() => stream.push('x'.repeat(7))).toThrow('budget')
    expect(stream.finish(true)).toEqual([])
    const block = new AssistantProseStream({ maxBlockLength: 4, maxTotalLength: 20 })
    expect(() => block.push('12345')).toThrow('buffer')
  })
  it('applies buffer limits before a later completed line can reclassify a block', () => {
    const source = 'abcdefgh\n    hi\n\nAfter.'
    for (const chunks of [[source], source.split('')]) {
      const stream = new AssistantProseStream({ maxBlockLength: 10, maxTotalLength: 100 })
      expect(() => { chunks.forEach((chunk) => stream.push(chunk)); stream.finish(true) }).toThrow('buffer')
      expect(stream.finish(true)).toEqual([])
    }
  })
  it('treats a split CRLF as a line ending, not an extra buffered text unit', () => {
    const source = 'Hello.\r\n\r\nAfter.'
    for (let i = 0; i <= source.length; i++) {
      const stream = new AssistantProseStream({ maxBlockLength: 6, maxTotalLength: 100 })
      expect([...stream.push(source.slice(0, i)), ...stream.push(source.slice(i)), ...stream.finish(true)]).toEqual(['Hello.', 'After.'])
    }
    const stream = new AssistantProseStream({ maxBlockLength: 6, maxTotalLength: 100 })
    expect([...source.split('').flatMap((unit) => stream.push(unit)), ...stream.finish(true)]).toEqual(['Hello.', 'After.'])
  })
  it('bounds nesting and rejects invalid options, types, controls and Unicode', () => {
    for (const options of [{ maxBlockLength: 0 }, { maxTotalLength: Infinity }, { maxTotalLength: 100_001 }, { maxBlockLength: 10, maxTotalLength: 9 }]) expect(() => new AssistantProseStream(options)).toThrow()
    for (const value of [null, '\udc00', '\ud800x', '\u001b[31mprivate']) {
      const stream = new AssistantProseStream()
      expect(() => stream.push(value as string)).toThrow()
      expect(stream.finish(true)).toEqual([])
    }
    expect(() => extract(['['.repeat(40) + 'private' + ']'.repeat(40)])).toThrow('nesting')
  })
  it('preserves split surrogate pairs, CRLF and the nine locale samples without English rewrites', () => {
    const source = 'Hello. مرحباً؟ Hallo! Hola. Bonjour. שלום! नमस्ते। Привет! 你好。 🦊'
    expect(extract((source + '\r\n\r\n').split(''))).toEqual([source])
    const stream = new AssistantProseStream()
    stream.push('\ud800')
    expect(() => stream.finish(true)).toThrow('Unicode')
  })
  it('composes with sentence assembly, whose spans refer to extracted prose, not raw Markdown', () => {
    const prose = new AssistantProseStream(), sentences = new SentenceStream()
    const spoken: string[] = []
    for (const delta of fixture.split('')) for (const block of prose.push(delta)) spoken.push(...sentences.push(block + '\n\n').map((part) => part.text))
    for (const block of prose.finish(true)) spoken.push(...sentences.push(block + '\n\n').map((part) => part.text))
    spoken.push(...sentences.finish(true).map((part) => part.text))
    expect(spoken.join(' ')).toBe(expected.join(' '))
  })
})
