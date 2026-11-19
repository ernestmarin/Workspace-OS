import { describe, expect, it } from 'vitest'
import {
  buildCaptions,
  estimateAlignment,
  strippedOfEmoteTags,
  validCaptionAlignment,
  type CaptionAlignment,
} from '../captions'

describe('validCaptionAlignment', () => {
  const good: CaptionAlignment = {
    text: 'Hi',
    words: [
      { text_start: 0, text_end: 1, start_ms: 0, end_ms: 500 },
      { text_start: 1, text_end: 2, start_ms: 500, end_ms: 800 },
    ],
  }
  it('accepts a well-formed alignment', () => expect(validCaptionAlignment(good)).toBe(true))
  it('rejects overlapping or out-of-range words', () => {
    expect(validCaptionAlignment({ text: 'Hi', words: [{ text_start: 0, text_end: 2, start_ms: 0, end_ms: 1 }, { text_start: 1, text_end: 2, start_ms: 2, end_ms: 3 }] })).toBe(false)
    expect(validCaptionAlignment({ text: 'Hi', words: [{ text_start: 0, text_end: 9, start_ms: 0, end_ms: 1 }] })).toBe(false)
  })
  it('rejects non-finite times and split surrogate pairs', () => {
    expect(validCaptionAlignment({ text: 'Hi', words: [{ text_start: 0, text_end: 1, start_ms: NaN, end_ms: 1 }] })).toBe(false)
    expect(validCaptionAlignment({ text: '😀x', words: [{ text_start: 1, text_end: 3, start_ms: 0, end_ms: 1 }] })).toBe(false)
  })
})

describe('buildCaptions', () => {
  it('re-segments character timings into display words', () => {
    const alignment: CaptionAlignment = {
      text: 'Hi there',
      words: [
        { text_start: 0, text_end: 1, start_ms: 0, end_ms: 100 },
        { text_start: 1, text_end: 2, start_ms: 100, end_ms: 200 },
        { text_start: 3, text_end: 4, start_ms: 300, end_ms: 400 },
        { text_start: 4, text_end: 5, start_ms: 400, end_ms: 500 },
        { text_start: 5, text_end: 6, start_ms: 500, end_ms: 600 },
        { text_start: 6, text_end: 7, start_ms: 600, end_ms: 700 },
        { text_start: 7, text_end: 8, start_ms: 700, end_ms: 800 },
      ],
    }
    const words = buildCaptions('Hi there', alignment)
    expect(words.map((w) => w.text)).toEqual(['Hi', 'there'])
    expect(words[0].start).toBe(0)
    expect(words[0].end).toBe(200)
    expect(words[1].start).toBe(300)
    expect(words[1].end).toBe(800)
  })
  it('falls back to untimed words when the alignment is unusable', () => {
    const words = buildCaptions('Hello world', null)
    expect(words.map((w) => w.text)).toEqual(['Hello', 'world'])
    expect(words.every((w) => w.start === null)).toBe(true)
  })
})

describe('estimateAlignment', () => {
  it('spreads timings evenly across the duration', () => {
    const a = estimateAlignment('one two three four', 1000)
    expect(a.words).toHaveLength(4)
    expect(a.words[0].start_ms).toBe(0)
    expect(a.words[3].end_ms).toBe(1000)
    expect(validCaptionAlignment(a)).toBe(true)
  })
})

describe('strippedOfEmoteTags', () => {
  it('drops tag characters and shifts remaining timings left', () => {
    const alignment: CaptionAlignment = {
      text: '[sighs] Hi',
      words: [
        ...Array.from({ length: 7 }, (_, i) => ({ text_start: i, text_end: i + 1, start_ms: i * 10, end_ms: i * 10 + 10 })),
        { text_start: 8, text_end: 9, start_ms: 80, end_ms: 90 },
        { text_start: 9, text_end: 10, start_ms: 90, end_ms: 100 },
      ],
    }
    const stripped = strippedOfEmoteTags(alignment)
    expect(stripped.text).toBe(' Hi')
    // The word "Hi" moved from offsets 8..10 to 1..3
    expect(stripped.words.map((w) => [w.text_start, w.text_end])).toEqual([[1, 2], [2, 3]])
    expect(validCaptionAlignment(stripped)).toBe(true)
  })
})
