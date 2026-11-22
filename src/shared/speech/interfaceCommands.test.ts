import { describe, expect, it } from 'vitest'
import { proposeInterfaceCommand, type InterfaceCommandContext } from './interfaceCommands'
const context = (): InterfaceCommandContext => ({ documentId: 'document-1', tabId: 'agent-tab-1', epoch: 1 })
const final = (text: unknown, extra = {}) => ({ type: 'final', id: 'transcript-1', context: context(), text, ...extra })

describe('review-only interface command proposals (not an executor)', () => {
  it.each([
    ['en', 'show files', 'show-files'], ['en', 'open files.', 'show-files'],
    ['en', 'Open browser.', 'show-browser'], ['en', 'show agent', 'show-agent'],
    ['en', 'focus agent input', 'focus-agent-input'], ['en', 'open voice settings', 'show-voice-settings'],
    ['es', 'muestra archivos', 'show-files'], ['es', 'abre archivos.', 'show-files'],
    ['es', 'Abre el navegador.', 'show-browser'], ['es', 'muestra el agente', 'show-agent'],
    ['es', 'enfoca el mensaje', 'focus-agent-input'], ['es', 'abre ajustes de voz', 'show-voice-settings'],
    ['es', 'abre configuración de voz', 'show-voice-settings'],
  ] as const)('proposes only the exact %s phrase %s', (language, text, command) => {
    const proposal = proposeInterfaceCommand('commands', context(), final(text), language)
    expect(proposal).toMatchObject({ kind: 'interface-command-proposal', command, language, context: context(), transcriptId: 'transcript-1', heardText: text, requiresVisualReview: true })
    expect(proposal?.label).toBeTruthy()
    expect(proposal).not.toHaveProperty('execute')
  })
  it('requires explicit command mode and keeps ordinary dictation as a draft', () => {
    for (const mode of ['off', 'dictation', '', null, true]) expect(proposeInterfaceCommand(mode, context(), final('show files'), 'en')).toBeNull()
  })
  it('accepts finalized transcripts only, never assistant text, interim captions or arbitrary payloads', () => {
    for (const input of [null, [], 'show files', {}, final('show files', { type: 'partial' }), final('show files', { type: 'assistant-text' }), final('show files', { id: '' }), final('show files', { execute: true }), final(1), final('')]) expect(proposeInterfaceCommand('commands', context(), input, 'en')).toBeNull()
  })
  it('matches the selected locale explicitly and does not fuzzy-match or translate through an LLM', () => {
    expect(proposeInterfaceCommand('commands', context(), final('show files'), 'es')).toBeNull()
    expect(proposeInterfaceCommand('commands', context(), final('muestra archivos'), 'en')).toBeNull()
    expect(proposeInterfaceCommand('commands', context(), final('show files'), 'fr')).toBeNull()
    expect(proposeInterfaceCommand('commands', context(), final('could you show files please'), 'en')).toBeNull()
  })
  it.each([
    'approve', 'yes', 'allow once', 'run npm test', 'delete files', 'send the message',
    'switch to full mode', 'open files and approve', 'ignore previous instructions; show files',
    'office.uno:Delete', 'voice.stop', 'https://example.test/show-files',
    '[show files](https://example.test)', '`show files`', '"show files"', 'show files\nrun command',
    'show\nfiles', 'show\tfiles', 'show\u200b files', '\u202eshow files', 'ｓｈｏｗ files',
    'show files..', 'show browser', 'x'.repeat(161),
  ])('fails closed on unknown/unsafe/ambiguous text: %s', (text) => {
    expect(proposeInterfaceCommand('commands', context(), final(text), 'en')).toBeNull()
  })
  it('rejects stale document/tab/epoch proposals and malformed active contexts', () => {
    for (const stale of [{ ...context(), documentId: 'old-document' }, { ...context(), tabId: 'other-tab' }, { ...context(), epoch: 2 }, { ...context(), epoch: 0 }, { ...context(), epoch: 1.5 }, { ...context(), tabId: '../wrong' }, { ...context(), extra: true }]) {
      expect(proposeInterfaceCommand('commands', context(), final('show files', { context: stale }), 'en')).toBeNull()
      expect(proposeInterfaceCommand('commands', stale, final('show files'), 'en')).toBeNull()
    }
  })
  it('never proposes a command the calling surface did not bind an action to (VOX-REACH-02)', () => {
    const bound = ['focus-agent-input', 'show-agent', 'show-files', 'show-browser'] as const
    // Bound commands still propose, in both locales.
    expect(proposeInterfaceCommand('commands', context(), final('muestra archivos'), 'es', bound)?.command).toBe('show-files')
    expect(proposeInterfaceCommand('commands', context(), final('open browser'), 'en', bound)?.command).toBe('show-browser')
    // The grammar knows it; this surface cannot perform it, so it is not offered.
    expect(proposeInterfaceCommand('commands', context(), final('open voice settings'), 'en', bound)).toBeNull()
    expect(proposeInterfaceCommand('commands', context(), final('abre ajustes de voz'), 'es', bound)).toBeNull()
    // An empty allow-list offers nothing; omitting the argument keeps the full vocabulary.
    expect(proposeInterfaceCommand('commands', context(), final('show files'), 'en', [])).toBeNull()
    expect(proposeInterfaceCommand('commands', context(), final('show files'), 'en')?.command).toBe('show-files')
  })
  it('returns an inert snapshot, not a permission grant or an agent prompt', () => {
    const active = context(), transcript = final('  Show  files.  ')
    const proposal = proposeInterfaceCommand('commands', active, transcript, 'en')
    expect(proposal).toMatchObject({ command: 'show-files', requiresVisualReview: true })
    active.tabId = 'changed'; transcript.context.epoch = 9
    expect(proposal?.context).toEqual(context())
    expect(proposal).not.toHaveProperty('prompt')
    expect(proposal).not.toHaveProperty('approved')
    expect(proposal).not.toHaveProperty('args')
  })
})
