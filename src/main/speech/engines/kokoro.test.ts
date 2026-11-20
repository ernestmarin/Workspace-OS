import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { assertKokoroInstalled } from './kokoro'

it('reports missing wrapper before launching the default local engine', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-kokoro-'))
  try {
    expect(() => assertKokoroInstalled(dir)).toThrow('Kokoro is not installed')
    const script = path.join(dir, 'kokoro', 'scripts', 'copyspeech-kokoro.py')
    fs.mkdirSync(path.dirname(script), { recursive: true })
    fs.writeFileSync(script, '')
    expect(() => assertKokoroInstalled(dir)).not.toThrow()
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
