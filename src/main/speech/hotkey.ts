/** Owns only the Voice shortcut; never unregisters another feature's shortcuts. */
export interface ShortcutBackend {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export class VoiceHotkey {
  private current = ''
  constructor(private readonly backend: ShortcutBackend, private readonly onActivate: () => void) {}

  get shortcut(): string { return this.current }

  /** Register first, so an invalid/conflicting replacement cannot remove the working shortcut. */
  set(shortcut: string): void {
    const next = shortcut.trim()
    if (next === this.current) return
    if (next && !/^(?=.{1,128}$)(?=.*\+)(?=.*(?:CommandOrControl|Command|Control|Ctrl|Alt|Option|Shift|Super|Meta))/i.test(next)) {
      throw new Error('Shortcut must include a modifier and key')
    }
    if (next) {
      let registered = false
      try { registered = this.backend.register(next, this.onActivate) } catch { /* invalid accelerator */ }
      if (!registered) throw new Error('Could not register shortcut; it may be invalid or already in use')
    }
    const previous = this.current
    this.current = next
    if (previous) this.backend.unregister(previous)
  }

  dispose(): void { this.set('') }
}
