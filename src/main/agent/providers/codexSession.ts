import type { ChildProcess } from 'child_process'
import { CodexRpc, type RpcRecord } from './codexRpc'
import type { McpJsonConfig } from './codex'
import type { RunSink } from '../launchRun'
import { parseConversation } from '../modelPick'
import { isAssistantRunOwner, type AssistantRunOwner, type AssistantRunOutcome } from '../../../shared/agentRun'
import { AssistantResponses } from '../assistantResponses'

export interface CodexQuestion { runId: string; requestId: string; method: string; params: RpcRecord }
export interface CodexSessionOptions {
  runId: string; cwd: string; prompt: string; instructions: string; model?: string; effort?: string
  /** Trusted WOS caller supplies the launch epoch; never establish it from a notification. */
  responseOwner?: AssistantRunOwner
  resumeId?: string; safeMode: boolean; env: NodeJS.ProcessEnv; connectors: McpJsonConfig
  unattended?: boolean; sink: RunSink; signal?: AbortSignal
  onQuestion: (question: CodexQuestion | { runId: string; requestId: string; resolved: true }) => void
  onFinish: (code: number) => void
  onAction?: (actionId: string, args: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string }>
  skills?: { name: string; path: string }[]
}
interface Control { rpc: CodexRpc; thread: string; turn: string; cancel: () => void; resolved: (id: string) => void; requests: Map<string, { id: string | number; method: string; params: RpcRecord }> }
const controls = new Map<string, Control>()

/** Config passed only to the WOS thread; never modify the user's Codex configuration. */
export function codexThreadConfig(inherited: RpcRecord, cfg: McpJsonConfig, safeMode = false): RpcRecord {
  const servers: RpcRecord = {}
  for (const id of Object.keys(inherited.mcp_servers ?? {})) servers[id] = { enabled: false }
  for (const [id, server] of Object.entries(cfg.mcpServers)) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid connector id')
    // Enabling a connector in Settings is the consent (the Claude path never
    // prompts per call). Reads flow; a connector WRITE still asks the person in
    // the dock and is auto-declined in an unattended routine.
    const entry: RpcRecord = { enabled: true, required: true, default_tools_approval_mode: 'writes' }
    if (server.url) {
      entry.url = server.url
      if (!server.headersHelper) throw new Error(`Connector ${id} has no authentication helper`)
      entry.http_headers_helper = server.headersHelper
    } else {
      entry.command = server.command
      entry.args = server.args ?? []
      entry.env_vars = Object.keys(server.env ?? {})
    }
    servers[id] = entry
  }
  return {
    mcp_servers: servers,
    features: { apps: false, hooks: false },
    notify: [],
    // Full mode keeps outbound network, as the exec/profile transports do; the
    // sandbox switch is ignored under read-only.
    sandbox_workspace_write: { network_access: !safeMode },
    shell_environment_policy: { inherit: 'all' },
  }
}

/** No terminal scraping: approvals and questions are correlated RPC requests. */
export function answerCodex(runId: string, requestId: string, value: unknown): boolean {
  const c = controls.get(runId), pending = c?.requests.get(requestId)
  if (!c || !pending) return false
  const response = value as { allow?: boolean; answers?: Record<string, { answers: string[] }>; content?: Record<string, unknown> }
  if (pending.method === 'item/tool/requestUserInput') {
    const answers: Record<string, { answers: string[] }> = {}
    for (const q of pending.params.questions ?? []) {
      const a = response?.answers?.[q.id]?.answers
      if (!Array.isArray(a) || !a.length || a.some((v) => typeof v !== 'string' || v.length > 10000)) throw new Error('Answer every Codex question')
      answers[q.id] = { answers: a }
    }
    c.rpc.respond(pending.id, { answers })
  } else if (pending.method === 'item/permissions/requestApproval') {
    c.rpc.respond(pending.id, { permissions: response?.allow === true ? pending.params.permissions : {}, scope: 'turn' })
  } else if (pending.method === 'mcpServer/elicitation/request') {
    const content = response?.content ?? null
    if (response?.allow === true && pending.params.mode !== 'url') {
      if (!content || typeof content !== 'object' || JSON.stringify(content).length > 100000) throw new Error('Invalid connector form')
      for (const key of pending.params.requestedSchema?.required ?? []) if (!(key in content) || content[key] === '') throw new Error('Complete the required connector fields')
    }
    c.rpc.respond(pending.id, { action: response?.allow === true ? 'accept' : 'decline', content: response?.allow === true ? content : null, _meta: null })
  } else c.rpc.respond(pending.id, { decision: response?.allow === true ? 'accept' : 'decline' })
  c.requests.delete(requestId)
  c.resolved(requestId)
  return true
}

export function codexRequestUrl(runId: string, requestId: string): string {
  const pending = controls.get(runId)?.requests.get(requestId)
  if (pending?.method !== 'mcpServer/elicitation/request' || pending.params.mode !== 'url') throw new Error('This connector request is no longer active')
  const url = new URL(pending.params.url)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported connector URL')
  return url.href
}

export function cancelCodex(runId: string): boolean {
  const c = controls.get(runId)
  if (!c) return false
  c.cancel()
  return true
}

export async function steerCodex(runId: string, text: string): Promise<boolean> {
  const c = controls.get(runId)
  if (!c?.turn) return false
  await c.rpc.request('turn/steer', { threadId: c.thread, expectedTurnId: c.turn, input: [{ type: 'text', text, text_elements: [] }] })
  return true
}

export async function launchCodexSession(o: CodexSessionOptions): Promise<ChildProcess> {
  o.signal?.throwIfAborted()
  if (o.resumeId && !parseConversation('codex:' + o.resumeId)) throw new Error('Invalid Codex thread id')
  const start = Date.now()
  const responseOwner = isAssistantRunOwner(o.responseOwner) && o.responseOwner.runId === o.runId ? { ...o.responseOwner } : undefined
  let responses: AssistantResponses | undefined
  let resolvedModel = o.model
  let finished = false
  let baseline: Record<string, number> | undefined
  let usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }
  let control: Control
  const delivered = new Set<string>()
  const completed = new Set<string>()
  let startingTurn = false
  let earlyBytes = 0
  const early: { method: string; params: RpcRecord }[] = []
  /** Release everything without reporting a completion (a failed start is reported by the caller). */
  const teardown = (): void => {
    finished = true
    early.length = 0
    o.signal?.removeEventListener('abort', abort)
    for (const id of control?.requests.keys() ?? []) o.onQuestion({ runId: o.runId, requestId: id, resolved: true })
    controls.delete(o.runId)
    rpc.close()
  }
  const finish = (code: number, outcome: AssistantRunOutcome = code === 0 ? 'completed' : code === 130 ? 'cancelled' : 'failed'): void => {
    if (finished) return
    teardown()
    responses?.endRun(outcome)
    const label = resolvedModel ? `codex ${resolvedModel}` : 'codex'
    o.sink.meta({ costUsd: 0, costKnown: false, provider: 'codex', turns: 1, durationMs: Date.now() - start, model: label, ...usage })
    o.sink.output(`\n\x1b[2m${label} · ${usage.inputTokens.toLocaleString('en-US')} in / ${usage.outputTokens.toLocaleString('en-US')} out\x1b[0m\n`)
    o.onFinish(code)
  }
  const notification = (method: string, p: RpcRecord): void => {
    if (finished) return
    if (method === 'serverRequest/resolved') {
      if (p.threadId && p.threadId !== control.thread) return
      const requestId = String(p.requestId)
      if (!control.requests.delete(requestId)) return
      o.onQuestion({ runId: o.runId, requestId, resolved: true })
      return
    }
    // Only RPC responses establish thread/turn ownership. Missing identities,
    // replayed history and child-agent notifications cannot speak or finish it.
    if (!control.thread || p.threadId !== control.thread) return
    if (!control.turn) {
      // Notifications can arrive before turn/start's response. Retain bounded
      // candidates, then filter them against the response-owned turn below.
      if (startingTurn) {
        earlyBytes += JSON.stringify(p).length
        if (early.length >= 1024 || earlyBytes > 1_000_000) {
          o.sink.output('\n[error] Codex startup notifications exceeded the safety limit.\n')
          finish(1)
          return
        }
        early.push({ method, params: p })
      }
      return
    }
    const turnId = method === 'turn/started' || method === 'turn/completed' ? p.turn?.id : p.turnId
    if (turnId !== control.turn) return
    if (method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
      if (!p.delta || typeof p.itemId !== 'string' || !p.itemId || completed.has(p.itemId)) return
      delivered.add(p.itemId)
      responses?.text(p.itemId, p.delta)
      o.sink.output(p.delta)
      o.sink.assistantText?.(p.delta)
    } else if (method === 'item/completed' && p.item?.type === 'agentMessage') {
      if (typeof p.item.id !== 'string' || !p.item.id || completed.has(p.item.id)) return
      completed.add(p.item.id)
      if (!delivered.has(p.item.id) && typeof p.item.text === 'string') {
        o.sink.output(p.item.text)
        if (p.item.text) { responses?.text(p.item.id, p.item.text); o.sink.assistantText?.(p.item.text) }
        delivered.add(p.item.id)
      }
      responses?.complete(p.item.id)
      o.sink.output('\n')
    } else if (method === 'item/started') {
      const item = p.item ?? {}
      const labels: Record<string, string> = { commandExecution: 'Running a command', mcpToolCall: `Calling ${item.server ?? 'connector'}.${item.tool ?? 'tool'}`, fileChange: 'Editing a file', webSearch: 'Searching', reasoning: 'Thinking' }
      if (labels[item.type]) o.sink.activity({ tool: item.type === 'mcpToolCall' ? `${item.server}.${item.tool}` : item.type, label: labels[item.type], kind: item.type === 'mcpToolCall' ? 'app' : item.type === 'fileChange' ? 'write' : 'run' })
    } else if (method === 'thread/tokenUsage/updated') {
      if (!control.turn) return
      const last = p.tokenUsage?.last ?? {}, total = p.tokenUsage?.total
      const keys = ['inputTokens', 'outputTokens', 'cachedInputTokens'] as const
      if (total && keys.every((key) => Number.isSafeInteger(total[key]) && Number.isSafeInteger(last[key]) && total[key] >= last[key] && last[key] >= 0)) {
        // The first event's total includes earlier resumed turns. Subtract that
        // history once, then include every model call in this turn, without
        // double-counting repeated notifications.
        baseline ??= Object.fromEntries(keys.map((key) => [key, total[key] - last[key]]))
        for (const key of keys) usage[key] = Math.max(0, total[key] - baseline[key])
      } else for (const key of keys) if (Number.isSafeInteger(last[key]) && last[key] >= 0) usage[key] = last[key]
    } else if (method === 'turn/completed') {
      if (p.turn?.error?.message) o.sink.output(`\n[error] ${p.turn.error.message}\n`)
      const outcome: AssistantRunOutcome = p.turn?.error ? 'failed' : p.turn?.status === 'completed' ? 'completed' : p.turn?.status === 'interrupted' ? 'cancelled' : 'failed'
      finish(p.turn?.status === 'completed' && !p.turn.error ? 0 : p.turn?.status === 'interrupted' ? 130 : 1, outcome)
    }
  }
  const rpc = new CodexRpc({
    cwd: o.cwd, env: o.env,
    onDiagnostic: (text) => o.sink.output(text),
    onClose: (error) => { if (!finished) { o.sink.output(`\n[error] ${error.message}\n`); finish(130, 'failed') } },
    onRequest: (id, method, params) => {
      if (finished) return
      if (method === 'item/tool/call' && params.tool === 'workspace_action' && o.onAction) {
        const input = params.arguments
        if (!input || typeof input.actionId !== 'string' || JSON.stringify(input).length > 2_000_000) { rpc.reject(id, 'Invalid Workspace action'); return }
        o.sink.activity({ tool: input.actionId, label: `Workspace: ${input.actionId}`, kind: 'app' })
        void o.onAction(input.actionId, input.args).then((reply) => {
          if (!finished) rpc.respond(id, { success: reply.ok, contentItems: [{ type: 'inputText', text: JSON.stringify(reply) }] })
        }).catch((error) => {
          if (!finished) rpc.respond(id, { success: false, contentItems: [{ type: 'inputText', text: (error as Error).message }] })
        })
        return
      }
      if (o.unattended) {
        if (method.endsWith('/requestApproval')) rpc.respond(id, method === 'item/permissions/requestApproval' ? { permissions: {}, scope: 'turn' } : { decision: 'decline' })
        else if (method === 'mcpServer/elicitation/request') rpc.respond(id, { action: 'decline', content: null })
        else rpc.reject(id, 'This unattended routine cannot ask a user; report the missing input.')
        return
      }
      const allowed = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput', 'mcpServer/elicitation/request']
      if (!allowed.includes(method)) { rpc.reject(id, `Unsupported Codex request: ${method}`); return }
      const requestId = String(id)
      control.requests.set(requestId, { id, method, params })
      o.onQuestion({ runId: o.runId, requestId, method, params })
    },
    onNotification: notification,
  })
  control = { rpc, thread: '', turn: '', requests: new Map(), resolved: (requestId) => o.onQuestion({ runId: o.runId, requestId, resolved: true }), cancel: () => {
    if (control.turn) void rpc.request('turn/interrupt', { threadId: control.thread, turnId: control.turn }, 2000).catch(() => {})
    finish(130)
  } }
  const abort = (): void => control.cancel()
  o.signal?.addEventListener('abort', abort, { once: true })
  controls.set(o.runId, control)
  try {
    await rpc.initialize()
    const { config } = await rpc.request('config/read', { includeLayers: false, cwd: o.cwd })
    const threadConfig = codexThreadConfig(config ?? {}, o.connectors, o.safeMode)
    const params = { cwd: o.cwd, model: o.model || null, sandbox: o.safeMode ? 'read-only' : 'workspace-write', approvalPolicy: o.unattended ? 'never' : 'on-request', approvalsReviewer: 'user', developerInstructions: o.instructions, config: threadConfig }
    const tools = o.onAction ? { dynamicTools: [{ type: 'function', name: 'workspace_action', description: 'Run an authorized Workspace app action. Documents: document.generate with format, name, spec (Office) or content (Markdown/HTML). Live data: document.data with operation and args. The app enforces your run grant.', inputSchema: { type: 'object', properties: { actionId: { type: 'string' }, args: { type: 'object', additionalProperties: true } }, required: ['actionId', 'args'], additionalProperties: false } }] } : {}
    // Registered on resume too: a follow-up turn must keep the app tool the guidance promises.
    const result = await rpc.request(o.resumeId ? 'thread/resume' : 'thread/start', { ...params, ...tools, ...(o.resumeId ? { threadId: o.resumeId } : {}) }, 60000)
    resolvedModel = result.model || o.model
    if (finished) return rpc.child
    if (typeof result.thread?.id !== 'string' || !result.thread.id) throw new Error('Codex returned no thread identity')
    control.thread = result.thread.id
    o.sink.sessionId?.(control.thread)
    startingTurn = true
    const turn = await rpc.request('turn/start', { threadId: control.thread, effort: o.effort || null, input: [{ type: 'text', text: o.prompt, text_elements: [] }, ...(o.skills ?? []).map((s) => ({ type: 'skill', ...s }))] })
    if (finished) return rpc.child
    if (typeof turn.turn?.id !== 'string' || !turn.turn.id) throw new Error('Codex returned no turn identity')
    control.turn = turn.turn.id
    if (responseOwner && o.sink.assistantResponse) {
      try {
        responses = new AssistantResponses(responseOwner, { provider: 'codex', sessionId: control.thread, turnId: control.turn }, (event) => o.sink.assistantResponse?.(event))
      } catch { /* Invalid auxiliary voice metadata must not cancel the actual agent/tools. */ }
    }
    startingTurn = false
    for (const entry of early.splice(0)) notification(entry.method, entry.params)
    return rpc.child
  } catch (err) {
    // Cancelled while starting: finish(130) already reported the run once.
    if (finished) return rpc.child
    // Otherwise the caller reports the failure exactly once; no completion here.
    teardown()
    throw err
  }
}
