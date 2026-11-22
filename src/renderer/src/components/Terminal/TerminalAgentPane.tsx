import { useState, useRef, useEffect, useCallback } from 'react'
import { agentActionsHint } from './surfaceActions'
import { RunTrace } from '../AgentTerminal/RunTrace'
import { VoiceDictation, type FinalVoiceCommandCapture } from '../AgentTerminal/VoiceDictation'
import { InterfaceCommandController, type PendingInterfaceCommand } from '../AgentTerminal/interfaceCommandController'
import { PromptBar } from '../PromptBar/PromptBar'
import { openRail } from '../Landscape/agentActions'
import { sessionStore } from '../../lib/sessions/sessionStore'
import { useSessions } from '../Landscape/session/SessionPane'
import type { InterfaceCommandId } from '../../../../shared/speech/interfaceCommands'
import styles from './TerminalDock.module.css'
import { basename as pathBase } from '../../lib/paths'

/**
 * VOX-REACH-01 — what this surface can actually do with a voice command.
 *
 * `show-voice-settings` is deliberately absent: the dock has no path to the
 * Settings panel, and proposing it would put a Confirm button on screen whose
 * click does nothing. An unbindable command is never proposed.
 */
const VOICE_COMMANDS: readonly InterfaceCommandId[] = ['focus-agent-input', 'show-agent', 'show-files', 'show-browser']

interface HarnessContext {
  root: string | null
  surface: string | null
  openFile: string | null
  folder: string | null
}

interface Props {
  sessionId: string
  context: HarnessContext
  /** The persona this tab runs as (passed into agent.run's agentName slot). */
  agentName?: string
  /**
   * Whether this is the dock's visible tab. A hidden tab must not hold a
   * microphone, a pending voice command or a proposed action.
   */
  active?: boolean
  /** Opens a run deliverable in the editor (a trace file chip was clicked). */
  onOpenFile?: (path: string) => void
}

type Msg = { role: 'user' | 'agent' | 'system'; text: string }

/** Build the short harness preamble so the agent knows where the user is. */
function contextPreamble(c: HarnessContext): string {
  const lines = ['[Workspace-OS context]']
  if (c.root) lines.push(`root: ${c.root}`)
  if (c.surface) lines.push(`surface: ${c.surface}`)
  if (c.folder && c.folder !== c.root) lines.push(`folder: ${c.folder}`)
  if (c.openFile) lines.push(`open file: ${c.openFile}`)
  // Enumerate the per-surface capabilities so the agent knows what it can do
  // where the user is (it acts via its existing Bash/file tools for now).
  const hint = agentActionsHint(c)
  if (hint) lines.push(hint)
  return lines.join('\n')
}

/** The dock tab's session id in the shared store (short enough for a conversation key). */
export const dockSessionId = (tabId: string): string => `dock${tabId.replace(/[^a-z0-9]/gi, '').slice(-30)}`

/**
 * An agent tab in the terminal: a session like any other (lib/sessions), so
 * what is started here also stands on the landscape as work, can be kept as a
 * case and continued from its card. Injects the live harness so the agent
 * knows where the person is.
 */
export function TerminalAgentPane({ sessionId, context, agentName, active = true, onOpenFile }: Props): JSX.Element {
  const id = dockSessionId(sessionId)
  useSessions()
  useEffect(() => {
    if (!sessionStore.get(id)) sessionStore.create({ id, agentName: agentName ?? null })
  }, [id, agentName])
  const s = sessionStore.get(id)
  const live = sessionStore.live(id)
  const busy = live.running
  const messages: Msg[] = (s?.messages ?? []).map((m) => ({ role: m.role, text: m.text }))
  const files = (s?.files ?? []).slice(-6).map((p) => ({ name: pathBase(p) ?? p, path: p }))
  // Discovered skills — the slash menu's commands.
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])
  useEffect(() => {
    window.workspace.skills.list().then(setSkills).catch(() => {})
  }, [])
  const logRef = useRef<HTMLDivElement>(null)
  const ctxRef = useRef(context)
  ctxRef.current = context

  /*
   * VOX-REACH-01 — the voice conversation, mounted where the agent is actually
   * reached. Dictation lands in the composer for review (it never submits); an
   * exact es/en phrase in command mode produces one visual confirmation card
   * that performs a single reversible navigation/focus action on an explicit
   * click. Recognition is never an action, a prompt, a grant or an approval.
   */
  const [dictatedText, setDictatedText] = useState<string | null>(null)
  const consumeDictation = useCallback(() => setDictatedText(null), [])
  const acceptDictation = useCallback((text: string) => setDictatedText(text), [])
  const [focusSignal, setFocusSignal] = useState(0)
  const [pendingVoiceCommand, setPendingVoiceCommand] = useState<PendingInterfaceCommand | null>(null)
  const commandControllerRef = useRef<InterfaceCommandController | null>(null)
  if (!commandControllerRef.current) commandControllerRef.current = new InterfaceCommandController({ available: VOICE_COMMANDS })
  const commandEpochRef = useRef(1)
  const invalidateVoiceCommands = useCallback(() => {
    commandEpochRef.current += 1
    commandControllerRef.current?.invalidate()
    setPendingVoiceCommand(null)
  }, [])

  // Switching dock tabs or hiding the window revokes a proposal the person can
  // no longer see; it never touches a running agent.
  useEffect(() => { if (!active) invalidateVoiceCommands() }, [active, invalidateVoiceCommands])
  useEffect(() => {
    const onVisibility = (): void => { if (document.hidden) invalidateVoiceCommands() }
    window.addEventListener('pagehide', invalidateVoiceCommands)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', invalidateVoiceCommands)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [invalidateVoiceCommands])

  const voiceCommandContext = useCallback(
    () => ({ documentId: 'workspace-main', tabId: id, epoch: commandEpochRef.current }),
    [id],
  )
  const handleFinalVoiceCommand = useCallback((capture: FinalVoiceCommandCapture) => {
    const ctx = voiceCommandContext()
    setPendingVoiceCommand(commandControllerRef.current!.ingestFinalTranscript(
      'commands',
      ctx,
      { type: 'final', id: capture.transcriptId, context: ctx, text: capture.text },
      capture.language,
    ))
  }, [voiceCommandContext])
  const confirmVoiceCommand = useCallback(() => {
    const entry = pendingVoiceCommand
    if (!entry) return
    commandControllerRef.current!.confirm(entry.proposalId, voiceCommandContext(), {
      'focus-agent-input': () => setFocusSignal((n) => n + 1),
      'show-agent': () => openRail('agents'),
      'show-files': () => openRail('files'),
      'show-browser': () => openRail('browser'),
    })
    setPendingVoiceCommand(null)
  }, [pendingVoiceCommand, voiceCommandContext])
  const dismissVoiceCommand = useCallback(() => {
    commandControllerRef.current?.invalidate()
    setPendingVoiceCommand(null)
  }, [])

  // Named: a complex expression in the dep array cannot be statically checked,
  // and "the last message grew" is the actual trigger (streaming text).
  const lastMessageLength = messages.length ? messages[messages.length - 1]?.text.length : -1
  const messageCount = messages.length
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messageCount, lastMessageLength])

  const submit = useCallback(
    (raw: string, mentions: string[]) => {
      let prompt = raw.trim()
      if ((!prompt && mentions.length === 0) || busy) return
      // A leading /skill becomes the skill invocation — the same contract the
      // console session uses, now discoverable from the slash menu.
      const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(prompt)
      if (slash && skills.some((k) => k.name === slash[1])) {
        prompt = `Use the "${slash[1]}" skill.${slash[2] ? ' ' + slash[2] : ''}`
      }
      if (!sessionStore.get(id)) sessionStore.create({ id, agentName: agentName ?? null })
      const c = ctxRef.current
      void sessionStore.send(id, prompt, mentions, { preamble: contextPreamble(c), openFile: c.openFile ?? null })
    },
    [busy, skills, id, agentName],
  )

  return (
    <div className={styles.agent}>
      <div className={styles.log} ref={logRef}>
        {messages.length === 0 && (
          <div className={styles.msgSystem}>
            Agent ready — it knows where you are in the workspace. Ask anything.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user' ? styles.msgUser : m.role === 'agent' ? styles.msgAgent : styles.msgSystem
            }
          >
            {m.role === 'user' ? `› ${m.text}` : m.text}
          </div>
        ))}
      </div>
      <RunTrace steps={live.steps} busy={busy} files={files} onOpenFile={onOpenFile} />
      <div className={styles.composer}>
        {pendingVoiceCommand && (
          <div role="region" aria-label="Voice command confirmation" className={styles.msgSystem}>
            <span>
              {pendingVoiceCommand.proposal.language === 'es' ? 'Comando propuesto:' : 'Proposed command:'}{' '}
              <strong>{pendingVoiceCommand.proposal.label}</strong> («{pendingVoiceCommand.proposal.heardText}»)
            </span>{' '}
            <button type="button" onClick={confirmVoiceCommand}>
              {pendingVoiceCommand.proposal.language === 'es' ? 'Confirmar comando' : 'Confirm command'}
            </button>{' '}
            <button type="button" onClick={dismissVoiceCommand}>
              {pendingVoiceCommand.proposal.language === 'es' ? 'Descartar' : 'Dismiss'}
            </button>
          </div>
        )}
        <VoiceDictation active={active} onTranscript={acceptDictation} onFinalCommand={handleFinalVoiceCommand} />
        <PromptBar
          placeholder="Ask the agent — @ file, / skill…"
          disabled={busy}
          commands={skills.map((k) => ({ name: k.name, hint: k.description }))}
          onSubmit={submit}
          dictatedText={dictatedText}
          onDictationConsumed={consumeDictation}
          focusSignal={focusSignal}
        />
      </div>
    </div>
  )
}
