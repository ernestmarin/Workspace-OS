import { describe, expect, it, vi } from 'vitest'
import { VoiceHotkey } from './hotkey'

describe('Voice global shortcut', () => {
  it('is opt-in, activates on the registered shortcut and disposes only its own registration', () => {
    const activate = vi.fn()
    const register = vi.fn((_accelerator: string, _callback: () => void) => true)
    const unregister = vi.fn()
    const hotkey = new VoiceHotkey({ register, unregister }, activate)
    expect(register).not.toHaveBeenCalled()
    hotkey.set('CommandOrControl+Shift+Y')
    expect(hotkey.shortcut).toBe('CommandOrControl+Shift+Y')
    const callback = register.mock.calls[0][1]
    callback()
    expect(activate).toHaveBeenCalledOnce()
    hotkey.dispose()
    expect(unregister).toHaveBeenCalledExactlyOnceWith('CommandOrControl+Shift+Y')
  })
  it('keeps the existing shortcut on a failed replacement', () => {
    const register = vi.fn((accelerator: string, _callback: () => void) => accelerator !== 'Control+Shift+X')
    const unregister = vi.fn()
    const hotkey = new VoiceHotkey({ register, unregister }, () => {})
    hotkey.set('Control+Shift+Y')
    expect(() => hotkey.set('Control+Shift+X')).toThrow('already in use')
    expect(hotkey.shortcut).toBe('Control+Shift+Y')
    expect(unregister).not.toHaveBeenCalled()
    expect(() => hotkey.set('Y')).toThrow('modifier')
  })
})
