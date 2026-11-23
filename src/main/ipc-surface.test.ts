import fs from 'node:fs'
import path from 'node:path'
import * as ts from 'typescript'
import { describe, it, expect } from 'vitest'

/**
 * RT-05 — the IPC surface, audited structurally.
 *
 * There are ~440 channels across ~50 registering modules. Auditing that by
 * reading files is a snapshot, not a guarantee: nothing today stops the next
 * commit from pointing preload at a channel nobody registers (a renderer promise
 * that never settles, with no error anywhere) or from declaring a channel and
 * forgetting to wire it. Three invariants make the map falsifiable:
 *
 *   1. every channel main registers is declared in the IPC registry,
 *   2. every channel preload can invoke is registered by main, and
 *   3. every declared channel is accounted for as invoke, push, or response.
 *
 * Push channels are the documented exception and are listed by hand below: those
 * flow main → renderer, so "no invoke handler" is correct, and the list is short
 * enough that adding one is a visible decision rather than an accident.
 *
 * This reads source text on purpose. `ipcHandle` mutates a process-global set and
 * importing 50 modules with their Electron dependencies would test the harness,
 * not the surface.
 */

const MAIN_PUSH_CHANNELS = new Set([
  'agent:action-invoke', 'agent:activity', 'agent:artifact', 'agent:artifacts',
  'agent:assistant-response', 'agent:assistant-text', 'agent:done', 'agent:output', 'agent:pty-exit',
  'agent:pty-output', 'agent:run-meta', 'browser:download', 'fs:watch-event',
  'mail:new-mail', 'notify:open', 'routines:updated', 'runs:updated',
  'shell:output', 'speech:event', 'speech:playback', 'terminal:data', 'terminal:exit',
  // Push channels that were previously hardcoded at BOTH ends and are now in the
  // registry; grouped here by origin so the list reads as a decision.
  'apps:test-progress', 'browser:open-tab', 'codex:question', 'lok:callback',
  'updater:update-ready', 'wiki:changed', 'workspace:root-changed',
])

/**
 * `agent:action-invoke` is pushed by main and answered with a fire-and-forget
 * `send` on `agent:action-result` (reqId-correlated in main), so it has an
 * `ipcMain.on` listener rather than an invoke handler.
 */
const FIRE_AND_FORGET_RESPONSES = new Set(['agent:action-result'])

const root = path.resolve(__dirname, '../..')
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8')

const ipcSource = read('src/main/ipc-channels.ts')
const declarationEntries = [...ipcSource.matchAll(/^\s{2}([A-Z_0-9]+):\s*'([^']+)'/gm)]
  .map((match) => ({ name: match[1], channel: match[2] }))
/** const name → channel value. */
const byName = new Map(declarationEntries.map(({ name, channel }) => [name, channel]))
/** channel value → const name. */
const declared = new Map(declarationEntries.map(({ name, channel }) => [channel, name]))

/** Every `.ts` under src/main except its own tests. */
function mainSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return mainSources(full)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
    return [full]
  })
}

function ipcConstant(call: ts.CallExpression): string | undefined {
  const arg = call.arguments[0]
  return arg && ts.isPropertyAccessExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === 'IPC'
    ? arg.name.text
    : undefined
}

function visitCalls(node: ts.Node, visit: (call: ts.CallExpression) => void): void {
  if (ts.isCallExpression(node)) visit(node)
  ts.forEachChild(node, (child) => visitCalls(child, visit))
}

function isMainEmitter(call: ts.CallExpression, file: string): boolean {
  const callee = call.expression
  if (ts.isIdentifier(callee)) {
    if (callee.text === 'sendToWindow') return true
    if (callee.text === 'send') return file.replaceAll('\\', '/').endsWith('src/main/speech/handlers.ts')
    return false
  }
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'send') return false
  const receiver = callee.expression.getText()
  return receiver === 'contents' || receiver === 'senderContents' || receiver.endsWith('.webContents')
}

function isCall(call: ts.CallExpression, receiver: string, method: string): boolean {
  const callee = call.expression
  return ts.isPropertyAccessExpression(callee) && callee.expression.getText() === receiver && callee.name.text === method
}

function parse(source: string, file: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function mainWiring(source: string, file = 'main.ts'): { emissions: Set<string>; listeners: Set<string> } {
  const emissions = new Set<string>()
  const listeners = new Set<string>()
  visitCalls(parse(source, file), (call) => {
    const name = ipcConstant(call)
    if (!name) return
    if (isMainEmitter(call, file)) emissions.add(name)
    if (isCall(call, 'ipcMain', 'on')) listeners.add(name)
  })
  return { emissions, listeners }
}

function preloadWiring(source: string, file = 'preload.ts'): {
  sends: Set<string>
  subscriptions: Set<string>
} {
  const sourceFile = parse(source, file)
  const sends = new Set<string>()
  const subscriptions = new Set<string>()

  visitCalls(sourceFile, (call) => {
    const name = ipcConstant(call)
    if (name && isCall(call, 'ipcRenderer', 'send')) sends.add(name)
  })

  const inspectFunction = (fn: ts.FunctionLikeDeclaration): void => {
    const listeners: { channel: string; handler: string }[] = []
    const cleanups: { channel: string; handler: string }[] = []
    const walkBody = (node: ts.Node): void => {
      if (node !== fn && ts.isFunctionLike(node)) return
      if (ts.isCallExpression(node)) {
        const channel = ipcConstant(node)
        const handler = node.arguments[1]?.getText(sourceFile)
        if (channel && handler && isCall(node, 'ipcRenderer', 'on')) listeners.push({ channel, handler })
      }
      if (ts.isReturnStatement(node) && node.expression) {
        visitCalls(node.expression, (call) => {
          const channel = ipcConstant(call)
          const handler = call.arguments[1]?.getText(sourceFile)
          if (channel && handler && isCall(call, 'ipcRenderer', 'removeListener')) cleanups.push({ channel, handler })
        })
      }
      ts.forEachChild(node, walkBody)
    }
    if (fn.body) walkBody(fn.body)
    for (const listener of listeners) {
      if (cleanups.some((cleanup) => cleanup.channel === listener.channel && cleanup.handler === listener.handler)) {
        subscriptions.add(listener.channel)
      }
    }
  }

  const walkFunctions = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) inspectFunction(node as ts.FunctionLikeDeclaration)
    ts.forEachChild(node, walkFunctions)
  }
  walkFunctions(sourceFile)
  return { sends, subscriptions }
}

const mainWire = { emissions: new Set<string>(), listeners: new Set<string>() }
for (const file of mainSources(path.join(root, 'src/main'))) {
  const wiring = mainWiring(fs.readFileSync(file, 'utf8'), file)
  for (const channel of wiring.emissions) mainWire.emissions.add(channel)
  for (const channel of wiring.listeners) mainWire.listeners.add(channel)
}
const preloadWire = preloadWiring(read('src/preload/index.ts'), 'src/preload/index.ts')

/** Resolves `IPC.FOO` and `'literal:channel'` registrations, wherever registered. */
function registeredHandlers(): { channel: string; file: string; literal: boolean }[] {
  const found: { channel: string; file: string; literal: boolean }[] = []
  const re = /ipc(?:Handle|Main\.handle)\(\s*(?:[A-Za-z_$][\w$.]*\s*,\s*)?(?:IPC\.([A-Z_0-9]+)|'([^']+)')/g
  for (const file of mainSources(path.join(root, 'src/main'))) {
    if (file.endsWith('ipc-surface.test.ts')) continue
    const source = fs.readFileSync(file, 'utf8')
    for (const m of source.matchAll(re)) {
      const channel = m[2] ?? byName.get(m[1]) ?? `UNKNOWN_CONST:${m[1]}`
      found.push({ channel, file: path.relative(root, file), literal: m[2] !== undefined })
    }
  }
  return found
}

const handlers = registeredHandlers()
const handlerChannels = new Set(handlers.map((h) => h.channel))

describe('RT-05 IPC surface completeness', () => {
  it('extracts the registry and the handler registrations at all', () => {
    // Guards the extraction itself: a silent parse failure would make every
    // assertion below vacuously pass.
    expect(declared.size).toBeGreaterThan(200)
    expect(handlers.length).toBeGreaterThan(200)
  })

  it('keeps registry constant names and channel values one-to-one', () => {
    // Maps overwrite duplicate keys. Compare the raw extraction with both maps
    // so neither a repeated constant name nor a repeated channel can disappear.
    expect(byName.size).toBe(declarationEntries.length)
    expect(declared.size).toBe(declarationEntries.length)
  })

  it('never registers a channel that is missing from the IPC registry', () => {
    const undeclared = handlers
      .filter((h) => !declared.has(h.channel))
      .map((h) => `${h.channel} (${h.file})`)
    expect(undeclared).toEqual([])
  })

  it('resolves every IPC constant used by a handler', () => {
    expect(handlers.filter((h) => h.channel.startsWith('UNKNOWN_CONST'))).toEqual([])
  })

  it('registers each channel exactly once (a duplicate throws at startup)', () => {
    const counts = new Map<string, number>()
    for (const h of handlers) counts.set(h.channel, (counts.get(h.channel) ?? 0) + 1)
    expect([...counts].filter(([, n]) => n > 1)).toEqual([])
  })

  it('registers, in main, every channel preload can invoke', () => {
    const preload = read('src/preload/index.ts')
    const invoked = new Set<string>()
    const re = /ipcRenderer\.(?:invoke|send)\(\s*(?:IPC\.([A-Z_0-9]+)|'([^']+)')/g
    for (const m of preload.matchAll(re)) invoked.add(m[2] ?? byName.get(m[1]) ?? `UNKNOWN_CONST:${m[1]}`)
    expect(invoked.size).toBeGreaterThan(200)
    const orphans = [...invoked].filter(
      (c) => !handlerChannels.has(c) && !MAIN_PUSH_CHANNELS.has(c) && !FIRE_AND_FORGET_RESPONSES.has(c),
    )
    expect(orphans).toEqual([])
  })

  it('accounts for every declared channel in exactly one IPC direction', () => {
    const wronglyAccounted = [...declared.keys()].filter((channel) => {
      const classifications = [
        handlerChannels.has(channel),
        MAIN_PUSH_CHANNELS.has(channel),
        FIRE_AND_FORGET_RESPONSES.has(channel),
      ]
      return classifications.filter(Boolean).length !== 1
    })
    expect(wronglyAccounted).toEqual([])
  })

  it('keeps every push channel out of the invoke surface', () => {
    const preload = read('src/preload/index.ts')
    // A push channel must never be invoked from preload: it has no handler, so
    // the promise would never settle. `on` is the only correct use.
    // Exact call matching, not substring: `IPC.SPEECH_PLAYBACK` is a prefix of
    // `IPC.SPEECH_PLAYBACK_DONE`, which IS invoked.
    for (const channel of MAIN_PUSH_CHANNELS) {
      const name = declared.get(channel)
      expect(new RegExp(`ipcRenderer\\.invoke\\(IPC\\.${name}[,)]`).test(preload), channel).toBe(false)
    }
  })

  it('ignores commented and unrelated send-like text when finding IPC wiring', () => {
    const fakeMain = mainWiring(`
      // win.webContents.send(IPC.AGENT_ACTION_INVOKE, payload)
      fake.send(IPC.AGENT_ACTION_INVOKE, payload)
    `)
    const fakePreload = preloadWiring(`
      // ipcRenderer.on(IPC.AGENT_ACTION_INVOKE, handler)
      // return () => ipcRenderer.removeListener(IPC.AGENT_ACTION_INVOKE, handler)
    `)
    expect(fakeMain.emissions).toEqual(new Set())
    expect(fakePreload.subscriptions).toEqual(new Set())
  })

  it('requires the returned cleanup to remove the same listener handler', () => {
    const mismatched = preloadWiring(`
      const subscribe = () => {
        ipcRenderer.on(IPC.AGENT_ACTION_INVOKE, handler)
        return () => ipcRenderer.removeListener(IPC.AGENT_ACTION_INVOKE, otherHandler)
      }
    `)
    expect(mismatched.subscriptions).toEqual(new Set())
  })

  it('wires every push channel to a main emitter and a removable preload listener', () => {
    for (const channel of MAIN_PUSH_CHANNELS) {
      const name = declared.get(channel)
      expect(name, channel).toBeDefined()
      // Known main emission forms: WebContents.send and the scoped wrappers used
      // by agent/speech handlers. A new wrapper is a visible contract change.
      expect(mainWire.emissions.has(name ?? ''), `${channel} has no main emitter`).toBe(true)
      expect(preloadWire.subscriptions.has(name ?? ''), `${channel} has no removable preload listener`).toBe(true)
    }
  })

  it('wires every fire-and-forget response at both ends', () => {
    for (const channel of FIRE_AND_FORGET_RESPONSES) {
      const name = declared.get(channel)
      expect(name, channel).toBeDefined()
      expect(preloadWire.sends.has(name ?? ''), `${channel} has no preload sender`).toBe(true)
      expect(mainWire.listeners.has(name ?? ''), `${channel} has no main listener`).toBe(true)
    }
  })

  it('hardcodes no channel string in preload or in a registration site', () => {
    const preload = read('src/preload/index.ts')
    expect(preload.match(/ipcRenderer\.(?:invoke|send|on|removeListener)\(\s*'/g) ?? []).toEqual([])
    const literal = handlers.filter((h) => h.literal).map((h) => `${h.channel} (${h.file})`)
    expect(literal).toEqual([])
  })

  it('declares a channel for every one of them, including the push set', () => {
    for (const channel of MAIN_PUSH_CHANNELS) expect(declared.has(channel), channel).toBe(true)
    for (const channel of FIRE_AND_FORGET_RESPONSES) expect(declared.has(channel), channel).toBe(true)
  })
})
