/**
 * VOX-REACH-03 — a voice feature that is not mounted is not a feature.
 *
 * The dictation control, the interface-command card and the reply reader each
 * have thorough unit tests that mount them directly, and every one of them was
 * green while the component hosting them (`AgentTerminal/TerminalSession.tsx`)
 * had no importer: the landscape shell dropped the classic layout that mounted
 * it (docs/landscape/PROGRESS.md, phase 7). Unit coverage proves a component
 * behaves; it cannot prove a user can reach it.
 *
 * This is a SOURCE invariant, not a runtime one: it walks the static import
 * graph from the renderer entry point and fails when a shipped voice surface is
 * orphaned. It says nothing about whether the mounting component renders, which
 * is what the behavioural suites (TerminalAgentPane.voice, VoiceDictation,
 * interfaceCommandController) are for.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER_ROOT = path.resolve(__dirname, 'renderer/src')
const ENTRY = path.join(RENDERER_ROOT, 'App.tsx')
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

const SPECIFIER = /(?:\bimport\b[^'"]*?from\s*|\bexport\b[^'"]*?from\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  for (const candidate of [base, ...EXTENSIONS.map((ext) => base + ext)]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  for (const ext of EXTENSIONS) {
    const index = path.join(base, `index${ext}`)
    if (fs.existsSync(index)) return index
  }
  return null
}

/** Every renderer file reachable from App.tsx through static/dynamic imports. */
function reachableFromEntry(): Set<string> {
  const seen = new Set<string>()
  const queue = [ENTRY]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(SPECIFIER)) {
      const target = resolveSpecifier(file, match[1])
      if (target && !seen.has(target)) queue.push(target)
    }
  }
  return seen
}

const relative = (file: string): string => path.relative(RENDERER_ROOT, file).split(path.sep).join('/')

describe('renderer voice reachability (VOX-REACH-03)', () => {
  it('resolves the renderer entry point', () => {
    expect(fs.existsSync(ENTRY)).toBe(true)
  })

  it('reaches both halves of the voice conversation from App.tsx', () => {
    const reachable = [...reachableFromEntry()].map(relative)
    // The sanity control: without a known-mounted module the walker proves nothing.
    expect(reachable).toContain('components/Voice/VoicePlayback.tsx')
    // User → agent: push-to-talk dictation and its local transcription path.
    expect(reachable).toContain('components/AgentTerminal/VoiceDictation.tsx')
    // Voice → interface: the one-shot confirmation controller.
    expect(reachable).toContain('components/AgentTerminal/interfaceCommandController.ts')
  })

  /**
   * VOX-REACH-04 — the other half of the conversation was still orphaned.
   *
   * `OwnedReplies` (the completed agent→user reply reader) was only ever
   * instantiated by `AgentTerminal/useAgentSession.ts`, which only
   * `AgentTerminal/TerminalSession.tsx` mounts, which only
   * `AgentTerminal/AgentTerminal.tsx` renders — and that component has no
   * importer at all. Its 100+ unit assertions passed while no user could turn
   * the reader on. This asserts the reader and the provenance consumer that
   * feeds it are reachable from the entry point, not merely tested.
   */
  it('reaches the agent→user reply reader from App.tsx', () => {
    const reachable = [...reachableFromEntry()].map(relative)
    expect(reachable).toContain('components/AgentTerminal/ownedReplies.ts')
    expect(reachable).toContain('components/AgentTerminal/spokenReplies.ts')
    expect(reachable).toContain('components/AgentTerminal/responseConsumer.ts')
  })
})
