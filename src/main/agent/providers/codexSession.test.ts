import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ instances: [] as any[], startFails: false, onTurnStart: null as null | ((notify: (method: string, params: any) => void) => void), startHangs: null as null | { promise: Promise<any>; reject: (e: Error) => void } }))
vi.mock('./codexRpc', () => ({ CodexRpc: class {
  child = { pid: 42 }; options: any; respond = vi.fn(); reject = vi.fn(); close = vi.fn(); initialize = vi.fn(async () => {})
  request = vi.fn(async (method: string) => {
    if (method === 'turn/start') mock.onTurnStart?.(this.options.onNotification)
    if (method === 'thread/start' && mock.startFails) throw new Error('not signed in')
    if (method === 'thread/start' && mock.startHangs) return mock.startHangs.promise
    return method === 'config/read' ? { config: { mcp_servers: { ambient: {} } } } : method === 'thread/start' || method === 'thread/resume' ? { thread: { id: '00000000-0000-0000-0000-000000000001' } } : { turn: { id: 'turn-1' } }
  })
  constructor(options: any) { this.options = options; mock.instances.push(this); this.close.mockImplementation(() => mock.startHangs?.reject(new Error('Codex session closed'))) }
} }))
import { launchCodexSession, codexThreadConfig, answerCodex, steerCodex, cancelCodex } from './codexSession'
const setup = async (extra = {}) => {
  const sink = { output: vi.fn(), assistantText: vi.fn(), assistantResponse: vi.fn(), meta: vi.fn(), activity: vi.fn(), artifacts: vi.fn(), artifact: vi.fn(), done: vi.fn(), sessionId: vi.fn() }
  const onQuestion = vi.fn(), onFinish = vi.fn()
  await launchCodexSession({ runId: 'test-run', cwd: '/workspace', prompt: 'user', instructions: 'persona', safeMode: true, env: {}, connectors: { mcpServers: {} }, responseOwner: { sessionId: 'wos-conversation', runId: 'test-run', epoch: 'epoch-1' }, sink, onQuestion, onFinish, ...extra })
  return { sink, onQuestion, onFinish, rpc: mock.instances.at(-1) }
}
beforeEach(() => { mock.instances.length = 0; mock.startFails = false; mock.startHangs = null; mock.onTurnStart = null })
afterEach(() => { cancelCodex('test-run'); vi.useRealTimers() })
describe('Codex session and isolation', () => {
  it('disables inherited connectors and uses refreshable authentication helpers', () => {
    const config = codexThreadConfig({ mcp_servers: { ambient: {} } }, { mcpServers: { remote: { url: 'https://example.test/mcp', headersHelper: '/bin/wos-token remote' }, local: { command: 'node', args: ['server'], env: { SECRET: '${SECRET}' } } } })
    expect(config.mcp_servers.ambient.enabled).toBe(false)
    expect(config.mcp_servers.remote.http_headers_helper).toBe('/bin/wos-token remote')
    expect(config.mcp_servers.local.env_vars).toEqual(['SECRET'])
    expect(JSON.stringify(config)).not.toContain('${SECRET}')
    expect(config.mcp_servers.remote.default_tools_approval_mode).toBe('writes') // reads never prompt; writes do
  })
  it('resumes with current instructions, sandbox, model, and effort', async () => {
    const s = await setup({ resumeId: '00000000-0000-0000-0000-000000000002', model: 'test', effort: 'high' })
    expect(s.rpc.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ sandbox: 'read-only', approvalPolicy: 'on-request', developerInstructions: 'persona', model: 'test' }), 60000)
    expect(s.rpc.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ effort: 'high' }))
  })
  it('correlates approvals and never accepts a stale or foreign request', async () => {
    const s = await setup()
    s.rpc.options.onRequest(9, 'item/commandExecution/requestApproval', { command: 'ls' })
    expect(answerCodex('another-run', '9', { allow: true })).toBe(false)
    expect(answerCodex('test-run', '9', { allow: false })).toBe(true)
    expect(s.rpc.respond).toHaveBeenCalledWith(9, { decision: 'decline' })
    expect(answerCodex('test-run', '9', { allow: true })).toBe(false)
    expect(s.onQuestion).toHaveBeenCalledWith({ runId: 'test-run', requestId: '9', resolved: true })
  })
  it('delivers user answers and connector forms without inventing values', async () => {
    const s = await setup()
    s.rpc.options.onRequest(1, 'item/tool/requestUserInput', { questions: [{ id: 'choice' }] })
    expect(() => answerCodex('test-run', '1', {})).toThrow()
    answerCodex('test-run', '1', { answers: { choice: { answers: ['A'] } } })
    expect(s.rpc.respond).toHaveBeenCalledWith(1, { answers: { choice: { answers: ['A'] } } })
    s.rpc.options.onRequest(2, 'mcpServer/elicitation/request', { mode: 'form', requestedSchema: { required: ['name'] } })
    expect(() => answerCodex('test-run', '2', { allow: true, content: {} })).toThrow()
    answerCodex('test-run', '2', { allow: true, content: { name: 'User choice' } })
    expect(s.rpc.respond).toHaveBeenCalledWith(2, { action: 'accept', content: { name: 'User choice' }, _meta: null })
  })
  it('steers the active turn and records interruptions as non-success exactly once', async () => {
    const s = await setup()
    expect(await steerCodex('test-run', 'new input')).toBe(true)
    expect(s.rpc.request).toHaveBeenCalledWith('turn/steer', expect.objectContaining({ expectedTurnId: 'turn-1' }))
    cancelCodex('test-run')
    s.rpc.options.onClose(new Error('closed'))
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(130)
    expect(s.rpc.request).toHaveBeenCalledWith('turn/interrupt', expect.anything(), 2000)
  })
  it('streams an answer once and reports tokens separately from unknown dollar cost', async () => {
    const s = await setup()
    const scope = { threadId: '00000000-0000-0000-0000-000000000001', turnId: 'turn-1' }
    s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'a', delta: 'hello' })
    s.rpc.options.onNotification('item/completed', { ...scope, item: { id: 'a', type: 'agentMessage', text: 'hello' } })
    s.rpc.options.onNotification('thread/tokenUsage/updated', { ...scope, tokenUsage: { last: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 50 } } })
    s.rpc.options.onNotification('turn/completed', { ...scope, turn: { id: 'turn-1', status: 'completed' } })
    expect(s.sink.output.mock.calls.filter(([t]) => t === 'hello')).toHaveLength(1)
    expect(s.sink.assistantText).toHaveBeenCalledExactlyOnceWith('hello')
    expect(s.sink.meta).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex', costKnown: false, inputTokens: 100, outputTokens: 20, cachedInputTokens: 50 }))
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(0)
    s.rpc.options.onNotification('item/agentMessage/delta', { itemId: 'b', delta: 'late' })
    expect(s.sink.assistantText).toHaveBeenCalledTimes(1)
  })
  it('rejects uncorrelated and stale-turn speech and completion notifications', async () => {
    const s = await setup()
    const threadId = '00000000-0000-0000-0000-000000000001'
    for (const scope of [{}, { threadId: 'child-thread', turnId: 'turn-1' }, { threadId, turnId: 'old-turn' }, { threadId }, { turnId: 'turn-1' }]) {
      s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'bad', delta: 'foreign' })
      s.rpc.options.onNotification('item/completed', { ...scope, item: { id: 'bad', type: 'agentMessage', text: 'foreign' } })
      s.rpc.options.onNotification('turn/completed', { ...scope, turn: { id: scope.turnId, status: 'completed' } })
    }
    expect(s.sink.assistantText).not.toHaveBeenCalled()
    expect(s.onFinish).not.toHaveBeenCalled()
    s.rpc.options.onNotification('turn/started', { threadId, turn: { id: 'another-turn' } })
    expect(await steerCodex('test-run', 'still owned')).toBe(true)
    expect(s.rpc.request).toHaveBeenLastCalledWith('turn/steer', expect.objectContaining({ expectedTurnId: 'turn-1' }))
  })
  it('ignores empty deltas and terminal item replays without losing a fallback answer', async () => {
    const s = await setup()
    const scope = { threadId: '00000000-0000-0000-0000-000000000001', turnId: 'turn-1' }
    const completed = { ...scope, item: { id: 'a', type: 'agentMessage', text: 'fallback' } }
    s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'a', delta: '' })
    s.rpc.options.onNotification('item/completed', completed)
    s.rpc.options.onNotification('item/completed', completed)
    s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'a', delta: 'late' })
    expect(s.sink.assistantText).toHaveBeenCalledExactlyOnceWith('fallback')
    expect(s.sink.output.mock.calls.filter(([text]) => text === '\n')).toHaveLength(1)
  })
  it('does not report a completion with an error as speech success', async () => {
    const s = await setup()
    s.rpc.options.onNotification('turn/completed', { threadId: '00000000-0000-0000-0000-000000000001', turn: { id: 'turn-1', status: 'completed', error: { message: 'provider failure' } } })
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(1)
  })
  it('filters notifications racing ahead of turn/start against the returned identity', async () => {
    mock.onTurnStart = (notify) => {
      const threadId = '00000000-0000-0000-0000-000000000001'
      notify('turn/started', { threadId, turn: { id: 'old-turn' } })
      notify('item/agentMessage/delta', { threadId, turnId: 'old-turn', itemId: 'old', delta: 'foreign' })
      notify('turn/completed', { threadId, turn: { id: 'old-turn', status: 'completed' } })
      notify('item/agentMessage/delta', { threadId, turnId: 'turn-1', itemId: 'a', delta: 'owned' })
      notify('turn/completed', { threadId, turn: { id: 'turn-1', status: 'completed' } })
    }
    const s = await setup()
    expect(s.sink.assistantText).toHaveBeenCalledExactlyOnceWith('owned')
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(0)
  })
  it('fails once rather than buffering unlimited startup notifications', async () => {
    mock.onTurnStart = (notify) => {
      const scope = { threadId: '00000000-0000-0000-0000-000000000001', turnId: 'turn-1' }
      for (let i = 0; i < 1025; i++) notify('item/agentMessage/delta', { ...scope, itemId: 'a', delta: 'queued' })
    }
    const s = await setup()
    expect(s.sink.assistantText).not.toHaveBeenCalled()
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(1)
  })
  it('routes structured app actions through the supplied grant handler in unattended Safe mode', async () => {
    const onAction = vi.fn(async () => ({ ok: true, result: { path: '/workspace/report.md' } }))
    const s = await setup({ onAction, unattended: true })
    expect(s.rpc.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({ dynamicTools: expect.arrayContaining([expect.objectContaining({ name: 'workspace_action' })]) }), 60000)
    s.rpc.options.onRequest(3, 'item/tool/call', { tool: 'workspace_action', arguments: { actionId: 'document.generate', args: { format: 'md' } } })
    await Promise.resolve()
    expect(onAction).toHaveBeenCalledWith('document.generate', { format: 'md' })
    expect(s.rpc.respond).toHaveBeenCalledWith(3, expect.objectContaining({ success: true }))
    expect(s.onQuestion).not.toHaveBeenCalled()
  })
  it('ignores child-agent completion and interrupts a turn when its startup signal is aborted', async () => {
    const controller = new AbortController()
    const s = await setup({ signal: controller.signal })
    s.rpc.options.onNotification('turn/completed', { threadId: 'child-thread', turn: { status: 'completed' } })
    expect(s.onFinish).not.toHaveBeenCalled()
    controller.abort()
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(130)
  })
  it('declines unattended approvals, and never stops a quiet run on a clock', async () => {
    vi.useFakeTimers()
    const s = await setup({ unattended: true })
    expect(s.rpc.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({ approvalPolicy: 'never' }), 60000)
    s.rpc.options.onRequest(1, 'item/fileChange/requestApproval', {})
    expect(s.rpc.respond).toHaveBeenCalledWith(1, { decision: 'decline' })
    expect(s.onQuestion).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(s.onFinish).not.toHaveBeenCalled()
  })

  // Review fixes 2026-09-08 (each was a verified defect on the first cut).
  it('offers the workspace tool on a resumed thread, not only on the first turn', async () => {
    const s = await setup({ resumeId: '00000000-0000-0000-0000-000000000002', onAction: vi.fn(async () => ({ ok: true })) })
    expect(s.rpc.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId: '00000000-0000-0000-0000-000000000002', dynamicTools: expect.arrayContaining([expect.objectContaining({ name: 'workspace_action' })]) }), 60000)
  })
  it('keeps outbound network in Full mode and leaves web search to the user config', () => {
    const full = codexThreadConfig({}, { mcpServers: {} }, false)
    const safe = codexThreadConfig({}, { mcpServers: {} }, true)
    expect(full.sandbox_workspace_write).toEqual({ network_access: true })
    expect(safe.sandbox_workspace_write).toEqual({ network_access: false })
    expect('web_search' in full).toBe(false)
  })
  it('a failed start rejects once and reports no completion (the caller reports it)', async () => {
    mock.startFails = true
    const sink = { output: vi.fn(), assistantText: vi.fn(), assistantResponse: vi.fn(), meta: vi.fn(), activity: vi.fn(), artifacts: vi.fn(), artifact: vi.fn(), done: vi.fn(), sessionId: vi.fn() }
    const onFinish = vi.fn()
    await expect(launchCodexSession({ runId: 'test-run', cwd: '/workspace', prompt: 'user', instructions: 'p', safeMode: true, env: {}, connectors: { mcpServers: {} }, sink, onQuestion: vi.fn(), onFinish })).rejects.toThrow('not signed in')
    expect(onFinish).not.toHaveBeenCalled()
    expect(sink.meta).not.toHaveBeenCalled()
    expect(mock.instances.at(-1).close).toHaveBeenCalled()
    expect(cancelCodex('test-run')).toBe(false) // nothing left registered
  })
  it('a cancel during startup completes the run exactly once and does not also reject', async () => {
    let reject!: (e: Error) => void
    mock.startHangs = { promise: new Promise((_, r) => { reject = r }), reject: (e) => reject(e) }
    const controller = new AbortController()
    const sink = { output: vi.fn(), assistantText: vi.fn(), assistantResponse: vi.fn(), meta: vi.fn(), activity: vi.fn(), artifacts: vi.fn(), artifact: vi.fn(), done: vi.fn(), sessionId: vi.fn() }
    const onFinish = vi.fn()
    const launch = launchCodexSession({ runId: 'test-run', cwd: '/workspace', prompt: 'user', instructions: 'p', safeMode: true, env: {}, connectors: { mcpServers: {} }, sink, onQuestion: vi.fn(), onFinish, signal: controller.signal })
    await Promise.resolve(); await Promise.resolve()
    controller.abort()
    await expect(launch).resolves.toBeDefined()
    expect(onFinish).toHaveBeenCalledExactlyOnceWith(130)
  })
})


describe('Codex response provenance before live audio integration', () => {
  const scope = { threadId: '00000000-0000-0000-0000-000000000001', turnId: 'turn-1' }
  it('preserves response boundaries and separates item generation from run completion', async () => {
    const s = await setup()
    s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'a', delta: 'Hello.' })
    s.rpc.options.onNotification('item/completed', { ...scope, item: { id: 'a', type: 'agentMessage', text: 'Hello.' } })
    s.rpc.options.onNotification('item/completed', { ...scope, item: { id: 'b', type: 'agentMessage', text: 'Fallback.' } })
    expect(s.onFinish).not.toHaveBeenCalled()
    s.rpc.options.onNotification('turn/completed', { threadId: scope.threadId, turn: { id: scope.turnId, status: 'completed' } })
    const events = s.sink.assistantResponse.mock.calls.map(([event]) => event)
    expect(events.map((event) => event.type)).toEqual(['response-start', 'text-delta', 'response-end', 'response-start', 'text-delta', 'response-end', 'run-end'])
    expect(events.every((event) => event.owner.sessionId === 'wos-conversation' && event.owner.runId === 'test-run' && event.owner.epoch === 'epoch-1')).toBe(true)
    expect(events.every((event) => event.source.provider === 'codex' && event.source.sessionId === scope.threadId && event.source.turnId === scope.turnId)).toBe(true)
    expect(events.filter((event) => event.type === 'text-delta').map((event) => [event.responseId, event.text])).toEqual([['a', 'Hello.'], ['b', 'Fallback.']])
    expect(events.at(-1)).toMatchObject({ type: 'run-end', outcome: 'completed' })
    expect(s.sink.assistantText.mock.calls).toEqual([['Hello.'], ['Fallback.']])
  })
  it('never emits reasoning/tool, missing-owner, foreign-thread or stale-turn text as responses', async () => {
    const s = await setup()
    for (const extra of [{ threadId: 'child-thread' }, { turnId: 'old-turn' }, { threadId: undefined }, { turnId: undefined }]) {
      s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, ...extra, itemId: 'foreign', delta: 'private' })
    }
    for (const type of ['reasoning', 'mcpToolCall', 'commandExecution']) s.rpc.options.onNotification('item/completed', { ...scope, item: { id: type, type, text: 'private' } })
    expect(s.sink.assistantResponse).not.toHaveBeenCalled()
    s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'a', delta: 'Owned.' })
    expect(s.sink.assistantResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'text-delta', responseId: 'a', text: 'Owned.' }))
  })
  it('closes open response generation on failure/cancel without treating an earlier completed item as run success', async () => {
    const s = await setup()
    s.rpc.options.onNotification('item/completed', { ...scope, item: { id: 'done', type: 'agentMessage', text: 'Earlier.' } })
    s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'live', delta: 'Partial.' })
    s.rpc.options.onNotification('turn/completed', { threadId: scope.threadId, turn: { id: scope.turnId, status: 'completed', error: { message: 'failure' } } })
    expect(s.sink.assistantResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'response-end', responseId: 'live', outcome: 'failed' }))
    expect(s.sink.assistantResponse).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'run-end', outcome: 'failed' }))
    const next = await setup()
    next.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'live', delta: 'Waiting.' })
    cancelCodex('test-run')
    expect(next.sink.assistantResponse).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'run-end', outcome: 'cancelled' }))
    const count = next.sink.assistantResponse.mock.calls.length
    next.rpc.options.onNotification('item/completed', { ...scope, item: { id: 'live', type: 'agentMessage', text: 'late' } })
    expect(next.sink.assistantResponse).toHaveBeenCalledTimes(count)
  })
  it('binds startup races only after RPC establishes thread/turn and seals repeated item events', async () => {
    mock.onTurnStart = (notify) => {
      notify('item/agentMessage/delta', { ...scope, turnId: 'old-turn', itemId: 'bad', delta: 'old' })
      notify('item/agentMessage/delta', { ...scope, itemId: 'a', delta: 'New.' })
      notify('item/completed', { ...scope, item: { id: 'a', type: 'agentMessage', text: 'New.' } })
      notify('item/completed', { ...scope, item: { id: 'a', type: 'agentMessage', text: 'replay' } })
      notify('item/agentMessage/delta', { ...scope, itemId: 'a', delta: 'late' })
    }
    const s = await setup()
    expect(s.sink.assistantResponse.mock.calls.map(([event]) => event.type)).toEqual(['response-start', 'text-delta', 'response-end'])
    expect(s.sink.assistantResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'text-delta', text: 'New.' }))
  })
  it('source limits do not cancel the agent or suppress its existing terminal/completed-run path', async () => {
    const s = await setup()
    const long = 'x'.repeat(20_001)
    s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'a', delta: long })
    expect(s.sink.assistantResponse).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'source-error', reason: 'text-limit' }))
    expect(s.onFinish).not.toHaveBeenCalled()
    expect(s.sink.output).toHaveBeenCalledWith(long)
    expect(s.sink.assistantText).toHaveBeenCalledWith(long)
    s.rpc.options.onNotification('turn/completed', { threadId: scope.threadId, turn: { id: scope.turnId, status: 'completed' } })
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(0)
  })
  it('distinguishes unexpected RPC loss from an explicit user interruption without changing legacy exit codes', async () => {
    const s = await setup()
    s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'a', delta: 'Partial.' })
    s.rpc.options.onClose(new Error('connection lost'))
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(130)
    expect(s.sink.assistantResponse).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'run-end', outcome: 'failed' }))
    expect(s.sink.assistantResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'response-end', responseId: 'a', outcome: 'failed' }))
    const next = await setup()
    next.rpc.options.onNotification('turn/completed', { threadId: scope.threadId, turn: { id: scope.turnId, status: 'interrupted', error: { message: 'provider error' } } })
    expect(next.sink.assistantResponse).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'run-end', outcome: 'failed' }))
  })
  it('snapshots WOS ownership before awaiting provider startup and isolates observer failures', async () => {
    const responseOwner = { sessionId: 'wos-conversation', runId: 'test-run', epoch: 'epoch-1' }
    const pending = setup({ responseOwner })
    responseOwner.epoch = 'mutated-during-startup'
    const s = await pending
    s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'a', delta: 'Snapshot.' })
    expect(s.sink.assistantResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'text-delta', owner: expect.objectContaining({ epoch: 'epoch-1' }) }))
    s.sink.assistantResponse.mockImplementation(() => { throw new Error('observer unavailable') })
    expect(() => s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'a', delta: 'Still running.' })).not.toThrow()
    expect(s.sink.assistantText).toHaveBeenCalledWith('Still running.')
    s.rpc.options.onNotification('turn/completed', { threadId: scope.threadId, turn: { id: scope.turnId, status: 'completed' } })
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(0)
  })
  it('never invents missing/mismatched WOS ownership, even while preserving the existing answer path', async () => {
    for (const responseOwner of [undefined, { sessionId: 'wos-conversation', runId: 'another-run', epoch: 'epoch-1' }]) {
      const s = await setup({ responseOwner })
      s.rpc.options.onNotification('item/agentMessage/delta', { ...scope, itemId: 'a', delta: 'Legacy.' })
      expect(s.sink.assistantResponse).not.toHaveBeenCalled()
      expect(s.sink.assistantText).toHaveBeenCalledExactlyOnceWith('Legacy.')
      cancelCodex('test-run')
    }
  })
})
