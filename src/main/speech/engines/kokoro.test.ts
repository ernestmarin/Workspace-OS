import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { assertKokoroInstalled } from './kokoro'

it('requires all default local prerequisites before launching uv; presence is not readiness', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-kokoro-'))
  try {
    expect(() => assertKokoroInstalled(dir)).toThrow('Kokoro is not installed')
    const files = ['scripts/copyspeech-kokoro.py', 'pyproject.toml', `.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`, 'models/kokoro-v1.0-duration.onnx', 'models/voices-v1.0.bin']
    for (const file of files) {
      expect(() => assertKokoroInstalled(dir)).toThrow()
      const target = path.join(dir, 'kokoro', file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, '')
      expect(() => assertKokoroInstalled(dir)).toThrow()
      fs.writeFileSync(target, 'fixture-not-a-real-model-or-runtime')
    }
    // Deliberately only a prerequisite guard. No model validity/readiness claim.
    expect(() => assertKokoroInstalled(dir)).not.toThrow()
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
