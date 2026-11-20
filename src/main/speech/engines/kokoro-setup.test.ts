import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { kokoroFilesStatus, prepareKokoro } from './kokoro-setup'

describe('Kokoro file preparation', () => {
  it('copies only bundled project files, reports missing models and never overwrites user files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-kokoro-setup-'))
    try {
      const resources = path.join(root, 'resources')
      await fs.mkdir(resources)
      await fs.writeFile(path.join(resources, 'copyspeech-kokoro.py'), 'wrapper')
      await fs.writeFile(path.join(resources, 'pyproject.toml'), 'project')
      const engines = path.join(root, 'engines')
      let status = await prepareKokoro(engines, resources)
      expect(status).toMatchObject({ wrapper: true, project: true, environment: false, model: false, voices: false })
      await fs.writeFile(path.join(status.projectDir, 'pyproject.toml'), 'user project')
      await prepareKokoro(engines, resources)
      expect(await fs.readFile(path.join(status.projectDir, 'pyproject.toml'), 'utf8')).toBe('user project')
      await fs.writeFile(path.join(status.projectDir, 'models', 'kokoro-v1.0-duration.onnx'), 'model')
      await fs.writeFile(path.join(status.projectDir, 'models', 'voices-v1.0.bin'), 'voices')
      status = await kokoroFilesStatus(engines)
      expect(status).toMatchObject({ model: true, voices: true, environment: false })
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
  it('fails rather than claiming setup if bundled assets are missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-kokoro-setup-'))
    try { await expect(prepareKokoro(path.join(root, 'engines'), path.join(root, 'missing'))).rejects.toThrow() }
    finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})
