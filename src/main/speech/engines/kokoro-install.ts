import path from 'node:path'
import { kokoroFilesStatus } from './kokoro-setup'

import { runSpeechCommand } from './process'

// Preserve the existing test/public helper name; synthesis uses the same policy.
export { speechProcessEnvironment as installerEnvironment } from './process'

/** Explicit dependency installation only; synthesis must never call this. */
export function runInstallerCommand(command: string, args: string[], signal: AbortSignal, timeoutMs = 20 * 60_000): Promise<void> {
  return runSpeechCommand(command, args, {
    signal, timeoutMs, label: 'Kokoro dependency setup',
    startError: 'Could not start uv. Install uv and make it available on the app PATH.',
  })
}

export class KokoroDependencyInstaller {
  private current: { abort: AbortController; promise: Promise<void> } | null = null
  constructor(private readonly run = runInstallerCommand) {}
  get busy(): boolean { return this.current !== null }

  async install(engineRoot: string): Promise<void> {
    if (this.current) throw new Error('Kokoro dependency setup is already running')
    const abort = new AbortController()
    // Reserve before awaiting filesystem checks so concurrent invocations cannot race.
    const run = async (): Promise<void> => {
      const status = await kokoroFilesStatus(engineRoot)
      if (abort.signal.aborted) throw new Error('Kokoro dependency setup cancelled')
      if (!status.wrapper || !status.project) throw new Error('Prepare the Kokoro project files first')
      await this.run('uv', ['sync', '--project', path.join(engineRoot, 'kokoro')], abort.signal)
    }
    const promise = run()
    this.current = { abort, promise }
    try { await promise } finally { this.current = null }
  }

  cancel(): void { this.current?.abort.abort() }
  async shutdown(): Promise<void> {
    const pending = this.current?.promise
    this.cancel()
    if (pending) await pending.catch(() => {})
  }
}
