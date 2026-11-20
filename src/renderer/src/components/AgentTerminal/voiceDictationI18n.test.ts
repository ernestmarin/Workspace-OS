import { describe, expect, it } from 'vitest'
import { SUPPORTED_VOICE_LANGUAGES, dictationText, isRtlVoiceLanguage } from './voiceDictationI18n'

describe('voice-only dictation labels', () => {
  it('provides every control label and title for all nine locales', () => {
    expect(new Set(SUPPORTED_VOICE_LANGUAGES.map(({ code }) => code)).size).toBe(9)
    for (const { code } of SUPPORTED_VOICE_LANGUAGES) {
      const labels = dictationText(code)
      expect(Object.values(labels).every((text) => typeof text === 'string' && !!text.trim())).toBe(true)
      expect(labels.dictateTitle).toContain('{language}')
      expect(isRtlVoiceLanguage(code)).toBe(code === 'ar' || code === 'he')
    }
  })
})
