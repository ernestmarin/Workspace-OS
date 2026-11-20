/** Review-only command proposals. Deliberately no executor, IPC, LLM, microphone or UI imports. */
export type InterfaceCommandId = 'show-agent' | 'focus-agent-input' | 'show-files' | 'show-browser' | 'show-voice-settings'
export type InterfaceCommandLanguage = 'es' | 'en'
export interface InterfaceCommandContext { documentId: string; tabId: string; epoch: number }
export interface InterfaceCommandProposal {
  kind: 'interface-command-proposal'
  command: InterfaceCommandId
  language: InterfaceCommandLanguage
  label: string
  context: InterfaceCommandContext
  transcriptId: string
  heardText: string
  /** Recognition is not confirmation or permission to perform an action. */
  requiresVisualReview: true
}
interface Command { id: InterfaceCommandId; en: readonly string[]; es: readonly string[]; labels: Record<InterfaceCommandLanguage, string> }
const commands: readonly Command[] = [
  { id: 'show-agent', en: ['show agent'], es: ['muestra el agente'], labels: { en: 'Show selected agent', es: 'Mostrar el agente seleccionado' } },
  { id: 'focus-agent-input', en: ['focus agent input'], es: ['enfoca el mensaje'], labels: { en: 'Focus agent input', es: 'Enfocar el mensaje del agente' } },
  { id: 'show-files', en: ['show files', 'open files'], es: ['muestra archivos', 'abre archivos'], labels: { en: 'Show files', es: 'Mostrar archivos' } },
  { id: 'show-browser', en: ['open browser'], es: ['abre el navegador'], labels: { en: 'Show browser', es: 'Mostrar el navegador' } },
  { id: 'show-voice-settings', en: ['open voice settings'], es: ['abre ajustes de voz', 'abre configuración de voz'], labels: { en: 'Show Voice settings', es: 'Mostrar ajustes de voz' } },
]
const MAX_TEXT = 160
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return (proto === Object.prototype || proto === null) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value)
function context(value: unknown): value is InterfaceCommandContext {
  return record(value, ['documentId', 'tabId', 'epoch']) && identity(value.documentId) && identity(value.tabId) && Number.isSafeInteger(value.epoch) && (value.epoch as number) >= 1
}

/**
 * Caller explicitly chooses command mode and supplies the current document/tab
 * snapshot. Exact final speech can only propose a reversible navigation/focus
 * action. U2 must still revalidate context and require visual confirmation.
 * These identities prevent lifecycle mistakes in a trusted renderer, not malicious code.
 */
export function proposeInterfaceCommand(mode: unknown, active: unknown, transcript: unknown, language: unknown): InterfaceCommandProposal | null {
  if (mode !== 'commands' || (language !== 'en' && language !== 'es') || !context(active)) return null
  if (!record(transcript, ['type', 'id', 'context', 'text']) || transcript.type !== 'final' || !identity(transcript.id) || !context(transcript.context)) return null
  const origin = transcript.context
  if (origin.documentId !== active.documentId || origin.tabId !== active.tabId || origin.epoch !== active.epoch) return null
  const text = transcript.text
  // Reject multiline/control/bidi/zero-width text; do not flatten injected lines
  // or use compatibility/fuzzy normalization to manufacture a matching command.
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT || /[\p{Cc}\p{Cf}]/u.test(text)) return null
  const phrase = text.normalize('NFC').trim().toLowerCase().replace(/ +/g, ' ').replace(/\.$/, '')
  const command = commands.find((entry) => entry[language].includes(phrase))
  if (!command) return null
  return { kind: 'interface-command-proposal', command: command.id, language, label: command.labels[language], context: { ...active }, transcriptId: transcript.id, heardText: text, requiresVisualReview: true }
}
