import { spawn } from 'node:child_process'
import path from 'node:path'
import { kokoroFilesStatus } from './kokoro-setup'

/** Do not hand obvious provider credentials to the dependency installer. */
export function installerEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (/(?:^|_)(?:api_?key|token|secret|password|credential|private_key|access_key)(?:_|$)/i.test(key) || key === 'SSH_AUTH_SOCK') continue
    clean[key] = value
  }
  return clean
}

/** Execute without a shell and without logging dependency output. */
export function runInstallerCommand(command: string, args: string[], signal: AbortSignal, timeoutMs = 20 * 60_000): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('Kokoro dependency setup cancelled'))
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore', env: installerEnvironment(), detached: process.platform !== 'win32' })
    let reason = ''
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const terminate = (force: boolean): void => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
        else child.kill(force ? 'SIGKILL' : 'SIGTERM')
      } catch { /* already exited */ }
    }
    const stop = (message: string): void => {
      if (reason) return
      reason = message
      terminate(false)
      killTimer = setTimeout(() => terminate(true), 2000)
      killTimer.unref()
    }
    const abort = (): void => stop('Kokoro dependency setup cancelled')
    const timer = setTimeout(() => stop('Kokoro dependency setup timed out'), timeoutMs)
    timer.unref()
    signal.addEventListener('abort', abort, { once: true })
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      signal.removeEventListener('abort', abort)
      if (error) reject(error); else resolve()
    }
    child.once('error', () => finish(new Error('Could not start uv. Install uv and make it available on the app PATH.')))
    child.once('close', (code) => {
      if (reason) finish(new Error(reason))
      else if (code !== 0) finish(new Error(`Kokoro dependency setup failed (exit ${code ?? 'unknown'}). Check uv and network access.`))
      else finish()
    })
    if (signal.aborted) abort()
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
