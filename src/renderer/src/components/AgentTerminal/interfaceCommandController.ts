/**
 * One-shot visual confirmation controller for reversible voice interface commands (VOX-U2a & VOX-U2b).
 *
 * Recognition NEVER executes a command, submits an agent prompt, alters grants,
 * toggles Safe/Full mode, or approves HITL dialogs. An exact finalized phrase in
 * explicit `'commands'` mode produces at most one bounded visual confirmation card
 * that expires after `ttlMs`, invalidates on tab/document/epoch switch or hide,
 * and can be confirmed at most once by an explicit user click.
 */
import {
  proposeInterfaceCommand,
  type InterfaceCommandContext,
  type InterfaceCommandId,
  type InterfaceCommandLanguage,
  type InterfaceCommandProposal,
} from '../../../../shared/speech/interfaceCommands'

export type InterfaceCommandCallbacks = Partial<Record<InterfaceCommandId, () => void>>

export interface PendingInterfaceCommand {
  proposalId: string
  proposal: InterfaceCommandProposal
  createdAt: number
  expiresAt: number
}

export class InterfaceCommandController {
  private readonly ttlMs: number
  private pending: PendingInterfaceCommand | null = null
  private consumedProposalIds = new Set<string>()
  private seq = 0

  constructor(options?: { ttlMs?: number }) {
    this.ttlMs = Math.max(1_000, Math.min(options?.ttlMs ?? 15_000, 60_000))
  }

  ingestFinalTranscript(
    mode: 'dictate' | 'commands',
    activeContext: InterfaceCommandContext,
    transcript: { type: 'final'; id: string; context: InterfaceCommandContext; text: string },
    language: InterfaceCommandLanguage | string,
    now = Date.now(),
  ): PendingInterfaceCommand | null {
    this.pending = null
    const proposal = proposeInterfaceCommand(mode, activeContext, transcript, language)
    if (!proposal) return null
    const proposalId = `icmd-${now}-${++this.seq}`
    const entry: PendingInterfaceCommand = {
      proposalId,
      proposal,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    }
    this.pending = entry
    return { ...entry, proposal: { ...entry.proposal, context: { ...entry.proposal.context } } }
  }

  current(now = Date.now()): PendingInterfaceCommand | null {
    if (!this.pending) return null
    if (now > this.pending.expiresAt) {
      this.pending = null
      return null
    }
    return this.pending
  }

  confirm(
    proposalId: string,
    activeContext: InterfaceCommandContext,
    callbacks: InterfaceCommandCallbacks,
    now = Date.now(),
  ): boolean {
    if (!proposalId || this.consumedProposalIds.has(proposalId)) return false
    const entry = this.pending
    if (!entry || entry.proposalId !== proposalId) return false
    this.pending = null
    if (now > entry.expiresAt) return false
    const origin = entry.proposal.context
    if (
      origin.documentId !== activeContext.documentId ||
      origin.tabId !== activeContext.tabId ||
      origin.epoch !== activeContext.epoch
    ) {
      return false
    }
    const action = callbacks[entry.proposal.command]
    if (typeof action !== 'function') return false
    this.consumedProposalIds.add(proposalId)
    if (this.consumedProposalIds.size > 64) {
      const oldest = this.consumedProposalIds.values().next().value
      if (oldest) this.consumedProposalIds.delete(oldest)
    }
    action()
    return true
  }

  invalidate(): void {
    this.pending = null
  }
}
