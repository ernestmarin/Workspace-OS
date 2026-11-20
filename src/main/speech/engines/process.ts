/** Batch speech children are trusted executables, not a sandbox or resident daemon. */
import { spawn } from 'node:child_process'

/** Defense in depth only: do not inherit obvious credentials into third-party engines/installers. */
export function speechProcessEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (/(?:^|_)(?:api_?key|token|secret|password|credential|private_key|access_key)(?:_|$)/i.test(key) || /^SSH_(?:AUTH_SOCK|AGENT_PID)$/i.test(key)) continue
    clean[key] = value
  }
  return clean
}

export interface SpeechCommandOptions {
  signal?: AbortSignal
  timeoutMs: number
  label: string
  startError: string
}

/**
 * No shell/output logging. On POSIX own a process group, including wrapper
 * descendants. Always reap that group on close: clearing the escalation timer
 * when just the wrapper exits otherwise leaves SIGTERM-resistant children alive.
 * Windows currently terminates only the direct child; tree cleanup is a release gate.
 */
export function runSpeechCommand(command: string, args: string[], options: SpeechCommandOptions): Promise<void> {
  const { signal, timeoutMs, label, startError } = options
  if (signal?.aborted) return Promise.reject(new Error(`${label} cancelled`))
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30 * 60_000) return Promise.reject(new Error('Invalid speech command timeout'))
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore', env: speechProcessEnvironment(), detached: process.platform !== 'win32' })
    let reason = ''
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const terminate = (force: boolean): void => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
        else child.kill(force ? 'SIGKILL' : 'SIGTERM')
      } catch { /* already gone */ }
    }
    const stop = (message: string): void => {
      if (reason || settled) return
      reason = message
      terminate(false)
      killTimer = setTimeout(() => terminate(true), 2000)
      killTimer.unref()
    }
    const abort = (): void => stop(`${label} cancelled`)
    const timer = setTimeout(() => stop(`${label} timed out`), timeoutMs)
    timer.unref()
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      // Normal batch completion must not leave a background child either.
      terminate(true)
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve()
    }
    child.once('error', () => finish(new Error(startError)))
    child.once('close', (code) => {
      if (reason) finish(new Error(reason))
      else if (code !== 0) finish(new Error(`${label} failed (exit ${code ?? 'unknown'})`))
      else finish()
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
