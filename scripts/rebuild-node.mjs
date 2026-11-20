#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Rebuilds native Node addons (`better-sqlite3`, `node-pty`) for the active
 * Node.js ABI. Automatically points `node-gyp` at local Node headers when
 * present obok `process.execPath` (e.g. `/usr/local/include/node`), so offline
 * or firewalled CI runners do not fail trying to fetch headers from nodejs.org.
 */
const prefixDir = path.resolve(process.execPath, '..', '..')
const localHeader = path.join(prefixDir, 'include', 'node', 'node.h')
const env = { ...process.env }
if (!env.npm_config_nodedir && fs.existsSync(localHeader)) {
  env.npm_config_nodedir = prefixDir
}

execFileSync('npm', ['rebuild', 'better-sqlite3', 'node-pty'], {
  stdio: 'inherit',
  env,
})
