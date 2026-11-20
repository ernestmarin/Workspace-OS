import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { KokoroDependencyInstaller, installerEnvironment, runInstallerCommand } from './kokoro-install'

describe('Kokoro dependency installer', () => {
  it('requires prepared files, and does not run concurrent installs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-kokoro-install-'))
    try {
      const run = vi.fn(async (_command: string, _args: string[], signal: AbortSignal) => {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      })
      const installer = new KokoroDependencyInstaller(run)
      await expect(installer.install(dir)).rejects.toThrow('Prepare')
      const project = path.join(dir, 'kokoro')
      await fs.mkdir(path.join(project, 'scripts'), { recursive: true })
      await fs.writeFile(path.join(project, 'scripts', 'copyspeech-kokoro.py'), 'x')
      await fs.writeFile(path.join(project, 'pyproject.toml'), 'x')
      const active = installer.install(dir)
      await expect(installer.install(dir)).rejects.toThrow('already running')
      // Allow asynchronous file checks to complete before cancellation.
      await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
      expect(run.mock.calls[0][0]).toBe('uv')
      expect(run.mock.calls[0][1]).toEqual(['sync', '--project', project])
      installer.cancel()
      await active
      expect(installer.busy).toBe(false)
    } finally { await fs.rm(dir, { recursive: true, force: true }) }
  })
  it('does not pass obvious credentials to installer subprocesses', () => {
    expect(installerEnvironment({ PATH: '/bin', WOS_OPENAI_API_KEY: 'private', AWS_ACCESS_KEY_ID: 'private', GITHUB_TOKEN: 'private', SSH_AUTH_SOCK: '/private' })).toEqual({ PATH: '/bin' })
  })
  it('runs without a shell and reports failures', async () => {
    await expect(runInstallerCommand(process.execPath, ['-e', 'process.exit(2)'], new AbortController().signal)).rejects.toThrow('exit 2')
    await expect(runInstallerCommand(process.execPath, ['-e', 'process.exit(0)'], new AbortController().signal)).resolves.toBeUndefined()
  })
  it('terminates on cancellation', async () => {
    const controller = new AbortController()
    const running = runInstallerCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], controller.signal)
    controller.abort()
    await expect(running).rejects.toThrow('cancelled')
  })
})
