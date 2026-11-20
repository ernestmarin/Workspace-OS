import { AssistantProseStream } from '../../../../shared/speech/assistantProse'

/** Bounded, opt-in per-run prose buffers. Never interpret terminal output as assistant text. */
export class SpokenReplies {
  private readonly runs = new Map<string, { stream: AssistantProseStream; blocks: string[]; failed: boolean }>()
  constructor(private readonly maxLength = 20_000, private readonly maxRuns = 8) {}

  begin(runId: string): boolean {
    if (!runId || this.runs.has(runId) || this.runs.size >= this.maxRuns) return false
    this.runs.set(runId, { stream: new AssistantProseStream({ maxTotalLength: this.maxLength, maxBlockLength: Math.min(4096, this.maxLength) }), blocks: [], failed: false })
    return true
  }

  append(runId: string, text: string): void {
    const run = this.runs.get(runId)
    if (!run || run.failed || typeof text !== 'string') return
    try { run.blocks.push(...run.stream.push(text)) }
    catch { run.blocks.length = 0; run.failed = true }
  }

  finish(runId: string, success: boolean): string | null {
    const run = this.runs.get(runId)
    this.runs.delete(runId)
    if (!run) return null
    if (!success || run.failed) { run.stream.cancel(); return null }
    try {
      run.blocks.push(...run.stream.finish(true))
      return run.blocks.join('\n\n').trim() || null
    } catch { return null }
  }

  clear(): void {
    for (const run of this.runs.values()) run.stream.cancel()
    this.runs.clear()
  }
}
