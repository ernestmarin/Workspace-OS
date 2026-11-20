import { describe, expect, it } from 'vitest'
import { grants } from './grants'
import { isValidModelAlias, issueRunGrant, missingGitWarning, modelArgs, modelsUsed } from './launchRun'

describe('launchRun — model selection', () => {
  it('accepts aliases and first-party ids, rejects anything else', () => {
    expect(isValidModelAlias('fable')).toBe(true)
    expect(isValidModelAlias('claude-opus-5')).toBe(true)
    expect(isValidModelAlias('')).toBe(true) // '' = the default model
    expect(isValidModelAlias('--dangerously-skip')).toBe(false)
    expect(isValidModelAlias('a b')).toBe(false)
    expect(isValidModelAlias(42)).toBe(false)
  })

  it('emits the flag pair only for a valid alias', () => {
    expect(modelArgs('haiku')).toEqual(['--model', 'haiku'])
    expect(modelArgs('')).toEqual([])
    expect(modelArgs(undefined)).toEqual([])
    expect(modelArgs('x y')).toEqual([])
  })

  it('reads the models a result line used, without the context-window suffix', () => {
    expect(modelsUsed({ modelUsage: { 'claude-opus-5[1m]': {}, 'claude-haiku-4-5': {} } })).toBe('claude-opus-5 + claude-haiku-4-5')
    expect(modelsUsed({})).toBe('')
  })
})

describe('launchRun — checkpoints without Git', () => {
  it('names the install command for the platform', () => {
    expect(missingGitWarning('win32')).toContain('winget install --id Git.Git --exact')
    expect(missingGitWarning('darwin')).toContain('xcode-select --install')
    expect(missingGitWarning('linux')).toMatch(/^\[warning\] Git was not found, so this run has no revert checkpoint/)
  })
})

describe('launchRun — workspace-bound grants across providers (SEC-06)', () => {
  it('binds issued run grants to the active workspace root regardless of provider', () => {
    const tok = issueRunGrant('claude-run-sec06', 'all', 'dock', '/ws/alpha')
    try {
      const g = grants.lookup(tok)
      expect(g?.root).toBe('/ws/alpha')
    } finally {
      grants.revoke('claude-run-sec06')
    }
  })
})
