/** Bounded, opt-in per-run buffers. Never interpret terminal output as assistant text. */
export class SpokenReplies {
  private readonly runs = new Map<string, { text: string; overflow: boolean }>()
  constructor(private readonly maxLength = 20_000, private readonly maxRuns = 8) {}

  begin(runId: string): boolean {
    if (!runId || this.runs.has(runId) || this.runs.size >= this.maxRuns) return false
    this.runs.set(runId, { text: '', overflow: false })
    return true
  }

  append(runId: string, text: string): void {
    const run = this.runs.get(runId)
    if (!run || run.overflow || typeof text !== 'string') return
    if (run.text.length + text.length > this.maxLength) {
      run.text = ''
      run.overflow = true
      return
    }
    run.text += text
  }

  finish(runId: string, success: boolean): string | null {
    const run = this.runs.get(runId)
    this.runs.delete(runId)
    if (!success || !run || run.overflow) return null
    return run.text.trim() || null
  }

  clear(): void { this.runs.clear() }
}
