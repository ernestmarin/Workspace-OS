import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe.skipIf(process.platform === 'win32')('typecheck regression gate', () => {
  it('fails when the compiler command fails without diagnostics', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-typecheck-'))
    try {
      fs.writeFileSync(path.join(dir, 'npx'), '#!/bin/sh\necho compiler-unavailable >&2\nexit 127\n', { mode: 0o755 })
      const result = spawnSync(process.execPath, ['scripts/typecheck.mjs'], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, PATH: dir } })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('TypeScript failed to run')
      expect(result.stderr).toContain('compiler-unavailable')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
  it('finds the real typecheck script', () => {
    expect(execFileSync(process.execPath, ['-e', "require('fs').accessSync('scripts/typecheck.mjs')"], { cwd: process.cwd() }).toString()).toBe('')
  })
})
