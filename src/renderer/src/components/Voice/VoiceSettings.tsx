import { useEffect, useState } from 'react'
import type { SpeechStatus } from '../../../../shared/speech/types'
import styles from '../Settings/SettingsPanel.module.css'

export function VoiceSettings(): JSX.Element {
  const [engine, setEngine] = useState<'kokoro' | 'openai'>('kokoro')
  const [voice, setVoice] = useState('af_heart')
  const [key, setKey] = useState('')
  const [keySet, setKeySet] = useState(false)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<SpeechStatus | null>(null)
  const [notice, setNotice] = useState('')
  const [shortcut, setShortcut] = useState('')
  useEffect(() => {
    let mounted = true
    void window.workspace.speech.config().then((config) => {
      if (!mounted) return
      setShortcut(config.hotkey.enabled ? config.hotkey.shortcut : '')
      const profile = config.tts.profiles.find((item) => item.id === config.tts.active_profile_id)
      if (profile?.engine === 'openai' || profile?.engine === 'kokoro') { setEngine(profile.engine); setVoice(profile.voice) }
    }).catch((error: Error) => { if (mounted) setNotice(error.message) })
    void window.workspace.speech.keyStatus().then((s) => { if (mounted) setKeySet(!!s.SPEECH_OPENAI_API_KEY) }).catch(() => {})
    void window.workspace.speech.status().then((s) => { if (mounted) setStatus(s) }).catch(() => {})
    const unsubscribe = window.workspace.speech.onEvent((event) => {
      if (event.type === 'state') setStatus(event.status)
      else if (event.type === 'error') setNotice(event.message)
      else if (!event.result.finished && event.result.error !== 'Cancelled') setNotice(event.result.error ?? 'Speech failed')
    })
    return () => { mounted = false; unsubscribe() }
  }, [])
  const choose = async (next: 'kokoro' | 'openai'): Promise<void> => {
    const nextVoice = next === 'openai' ? 'alloy' : 'af_heart'
    try { await window.workspace.speech.selectEngine(next, nextVoice); setEngine(next); setVoice(nextVoice); setNotice('') }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not select engine') }
  }
  const saveKey = async (value: string): Promise<void> => {
    try { const s = await window.workspace.speech.setOpenAiKey(value); setKeySet(!!s.SPEECH_OPENAI_API_KEY); setKey(''); setNotice(value.trim() ? 'Key saved in secure storage.' : 'Stored key removed; environment overrides may still apply.') }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save key') }
  }
  const speak = async (): Promise<void> => {
    try { setNotice(''); await window.workspace.speech.speak(text) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not start speech') }
  }
  return <section className={styles.section} data-testid="settings-voice">
    <h3 className={styles.sectionTitle}>Voice</h3>
    <p className={styles.hint}>Read text aloud. OpenAI sends the text to OpenAI; Kokoro requires a separately installed local engine.</p>
    <div className={styles.segmented}>
      <button type="button" className={engine === 'kokoro' ? styles.segOn : styles.segOff} onClick={() => void choose('kokoro')}>Kokoro (local)</button>
      <button type="button" className={engine === 'openai' ? styles.segOn : styles.segOff} onClick={() => void choose('openai')}>OpenAI</button>
    </div>
    <label className={styles.field}>Voice
      <select className={styles.select} value={voice} onChange={(e) => {
        const next = e.target.value
        void window.workspace.speech.selectEngine(engine, next).then(() => setVoice(next)).catch((error: Error) => setNotice(error.message))
      }}>
        {(engine === 'openai' ? ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] : ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'am_adam', 'am_michael', 'bf_emma', 'bm_george']).map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
    {engine === 'openai' && <label className={styles.field}>OpenAI API key ({keySet ? 'configured' : 'not configured'})
      <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
      <button className={styles.btn} type="button" disabled={!key.trim()} onClick={() => void saveKey(key)}>Save key securely</button>
      {keySet && <button className={styles.btn} type="button" onClick={() => void saveKey('')}>Remove stored key</button>}
    </label>}
    <label className={styles.field}>Global read-clipboard shortcut (optional)
      <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="For example CommandOrControl+Shift+Y" />
    </label>
    <p className={styles.hint}>Saving enables a system-wide shortcut. It reads the clipboard on each press; cloud engines send that text to the provider. Clear and save to disable.</p>
    <button type="button" className={styles.btn} onClick={() => void window.workspace.speech.setHotkey(shortcut).then((s) => { setShortcut(s.shortcut); setNotice(s.shortcut ? 'Shortcut enabled.' : 'Shortcut disabled.') }).catch((error: Error) => setNotice(error.message))}>Save shortcut</button>
    <label className={styles.field}>Text to read
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={100000} />
    </label>
    <div className={styles.keyField}>
      <button type="button" className={styles.btn} disabled={!text.trim()} onClick={() => void speak()}>Speak</button>
      <button type="button" className={styles.btn} onClick={() => void window.workspace.speech.readClipboard().catch((error: Error) => setNotice(error.message))}>Read clipboard</button>
      <button type="button" className={styles.btn} disabled={!status?.speaking} onClick={() => void window.workspace.speech.stop()}>Stop</button>
      <span className={styles.hint}>{status?.speaking ? (status.synthesizing ? 'Preparing audio…' : 'Speaking…') : 'Idle'}</span>
    </div>
    {notice && <p role="status" className={styles.errText}>{notice}</p>}
  </section>
}
