import { describe, expect, it } from 'vitest'
import { SentenceStream, type SpeechSentence } from './sentenceStream'

function collect(text: string, size: number): SpeechSentence[] {
  const stream = new SentenceStream()
  const result: SpeechSentence[] = []
  for (let start = 0; start < text.length; start += size) result.push(...stream.push(text.slice(start, start + size)))
  return [...result, ...stream.finish(true)]
}

const texts = (segments: SpeechSentence[]): string[] => segments.map((segment) => segment.text)

describe('incremental speech sentence foundation (not a TTS or agent runner)', () => {
  it('holds an ambiguous tail and emits a sentence before the response ends', () => {
    const stream = new SentenceStream()
    expect(stream.push('Hola')).toEqual([])
    expect(stream.push('. ')).toEqual([])
    expect(texts(stream.push('Otra frase'))).toEqual(['Hola.'])
    expect(stream.bufferedLength).toBe(' Otra frase'.length)
    expect(texts(stream.finish(true))).toEqual(['Otra frase'])
    expect(stream.finish(true)).toEqual([])
    expect(stream.push('late output. Next')).toEqual([])
  })

  it.each([
    ['en', 'Hello. Another sentence! Last', ['Hello.', 'Another sentence!', 'Last']],
    ['es', '¿Listo? ¡Vamos! Al final', ['¿Listo?', '¡Vamos!', 'Al final']],
    ['de', 'Hallo. Weiter! Ende', ['Hallo.', 'Weiter!', 'Ende']],
    ['fr', 'Bonjour. À bientôt ! Fin', ['Bonjour.', 'À bientôt !', 'Fin']],
    ['ru', 'Привет. Пока! Конец', ['Привет.', 'Пока!', 'Конец']],
    ['he', 'שלום. להתראות! סוף', ['שלום.', 'להתראות!', 'סוף']],
    ['ar', 'مرحبا؟ نعم۔ النهاية', ['مرحبا؟', 'نعم۔', 'النهاية']],
    ['hi', 'नमस्ते। फिर मिलेंगे॥ अंत', ['नमस्ते।', 'फिर मिलेंगे॥', 'अंत']],
    ['zh', '你好。再见！最后？', ['你好。', '再见！', '最后？']],
  ])('recognizes %s prose punctuation across single-code-unit deltas', (_locale, text, expected) => {
    expect(texts(collect(text as string, 1))).toEqual(expected)
  })

  it('keeps punctuation clusters and closing quotes/brackets with the sentence', () => {
    const text = '“Really?!” Yes!!! 「你好。」然后。 Last'
    expect(texts(collect(text, 1))).toEqual(['“Really?!”', 'Yes!!!', '「你好。」', '然后。', 'Last'])
  })

  it('does not mistake decimals, paths, domains or known abbreviations for sentences', () => {
    const text = 'Dr. Smith reads report.txt at example.org for 3.14 seconds. Next'
    expect(texts(collect(text, 1))).toEqual([
      'Dr. Smith reads report.txt at example.org for 3.14 seconds.', 'Next',
    ])
  })

  it('retains ASCII punctuation glued to a token rather than prematurely speaking it', () => {
    const stream = new SentenceStream()
    expect(stream.push('file.')).toEqual([])
    expect(stream.push('txt is here')).toEqual([])
    expect(texts(stream.finish(true))).toEqual(['file.txt is here'])
  })

  it('preserves exact UTF-16 source spans for any input chunk size', () => {
    const input = '  Hola 😀.  「你好。」ثم نعم؟ आखिर।  último  '
    const expected = ['Hola 😀.', '「你好。」', 'ثم نعم؟', 'आखिर।', 'último']
    for (let size = 1; size <= input.length; size++) {
      const segments = collect(input, size)
      expect(texts(segments), `chunk size ${size}`).toEqual(expected)
      let end = 0
      for (const segment of segments) {
        expect(input.slice(segment.source_start, segment.source_end)).toBe(segment.text)
        expect(segment.source_start).toBeGreaterThanOrEqual(end)
        end = segment.source_end
      }
    }
  })

  it('is invariant for every two-part split including inside an emoji surrogate pair', () => {
    const input = 'Hi 😀. Bye! 尾巴。最后'
    for (let cut = 0; cut <= input.length; cut++) {
      const stream = new SentenceStream()
      const result = [...stream.push(input.slice(0, cut)), ...stream.push(input.slice(cut)), ...stream.finish(true)]
      expect(texts(result)).toEqual(['Hi 😀.', 'Bye!', '尾巴。', '最后'])
    }
  })

  it('discards buffered text on failure/cancel and ignores all late deltas', () => {
    const failed = new SentenceStream()
    failed.push('Failed partial reply')
    expect(failed.finish(false)).toEqual([])
    expect(failed.push(' must never resume. Next')).toEqual([])
    const cancelled = new SentenceStream()
    cancelled.push('Pending')
    cancelled.cancel()
    cancelled.cancel()
    expect(cancelled.bufferedLength).toBe(0)
    expect(cancelled.finish(true)).toEqual([])
    expect(cancelled.push('Late. Next')).toEqual([])
  })

  it('keeps streams independent; cancel cannot silence or flush another response', () => {
    const a = new SentenceStream()
    const b = new SentenceStream()
    a.push('Private unfinished')
    b.push('Other response')
    a.cancel()
    expect(texts(b.finish(true))).toEqual(['Other response'])
  })

  it('bounds the pending sentence without cutting words or silently truncating text', () => {
    const stream = new SentenceStream({ maxSentenceLength: 8, maxTotalLength: 30 })
    expect(() => stream.push('unbrokenword')).toThrow(RangeError)
    expect(stream.bufferedLength).toBe(0)
    expect(stream.push('Next. Tail')).toEqual([])
    expect(stream.finish(true)).toEqual([])
  })

  it('bounds completed sentences too, including a large single incoming delta', () => {
    const stream = new SentenceStream({ maxSentenceLength: 8, maxTotalLength: 40 })
    expect(() => stream.push('Ok. This sentence is too long. Next')).toThrow(RangeError)
    expect(stream.finish(true)).toEqual([])
    expect(stream.bufferedLength).toBe(0)
  })

  it('enforces a cumulative budget even after previously emitted text is released', () => {
    const stream = new SentenceStream({ maxSentenceLength: 8, maxTotalLength: 12 })
    expect(texts(stream.push('One. Two'))).toEqual(['One.'])
    expect(() => stream.push('. Three')).toThrow(RangeError)
    expect(stream.finish(true)).toEqual([])
  })

  it('allows many bounded sentences in one delta rather than capping the whole delta as a tail', () => {
    const stream = new SentenceStream({ maxSentenceLength: 8, maxTotalLength: 40 })
    expect(texts(stream.push('One. Two. Three. Tail'))).toEqual(['One.', 'Two.', 'Three.'])
    expect(texts(stream.finish(true))).toEqual(['Tail'])
  })

  it('does not emit empty/whitespace segments', () => {
    const stream = new SentenceStream()
    expect(stream.push(' \n\t')).toEqual([])
    expect(stream.finish(true)).toEqual([])
  })

  it.each([['\udc00'], ['a\ud800b']])('rejects malformed Unicode and clears the stream', (input) => {
    const stream = new SentenceStream()
    expect(() => stream.push(input)).toThrow('Unicode')
    expect(stream.finish(true)).toEqual([])
    expect(stream.bufferedLength).toBe(0)
  })

  it('allows a split Unicode pair while streaming but rejects an incomplete final pair', () => {
    const stream = new SentenceStream()
    expect(stream.push('Hi \ud83d')).toEqual([])
    expect(() => stream.finish(true)).toThrow('Unicode')
    expect(stream.bufferedLength).toBe(0)
  })

  it('fails closed on non-string input at the runtime boundary', () => {
    const stream = new SentenceStream()
    stream.push('Pending')
    expect(() => stream.push(null as unknown as string)).toThrow(TypeError)
    expect(stream.finish(true)).toEqual([])
  })

  it.each([
    { maxSentenceLength: 0 }, { maxSentenceLength: 1.5 }, { maxTotalLength: Infinity },
    { maxSentenceLength: 20, maxTotalLength: 10 }, { maxTotalLength: 100_001 },
  ])('rejects invalid limits: %j', (options) => {
    expect(() => new SentenceStream(options)).toThrow(RangeError)
  })
})
