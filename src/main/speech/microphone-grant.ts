/** Short-lived, single-request audio permission with an independently cancellable prompt. */
export class MicrophoneGrant {
  private grant: { owner: number; url: string; token: string; expires: number } | null = null
  private pending: string | null = null
  constructor(private readonly now = () => Date.now()) {}

  begin(token: unknown): void {
    if (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) throw new Error('Invalid microphone request identity')
    if (this.pending || (this.grant && this.now() < this.grant.expires)) throw new Error('A microphone permission request is already open')
    this.grant = null
    this.pending = token
  }
  approve(token: string, owner: number, url: string): boolean {
    if (this.pending !== token) return false
    this.pending = null
    if (!Number.isSafeInteger(owner) || owner < 1 || !url) throw new Error('Invalid microphone requester')
    this.grant = { owner, url, token, expires: this.now() + 10_000 }
    return true
  }
  /** Only the originating request can revoke its pending or armed grant. */
  revoke(token: unknown): void {
    if (typeof token !== 'string') return
    if (this.pending === token) this.pending = null
    if (this.grant?.token === token) this.grant = null
  }
  revokePending(token: string): void { if (this.pending === token) this.pending = null }
  clear(): void { this.pending = null; this.grant = null }
  consume(owner: number, currentUrl: string, details: { isMainFrame: boolean; requestingUrl: string; mediaTypes?: readonly string[] }): boolean {
    const grant = this.grant
    // Consume even a mismatched request, to avoid leaving an authorization armed.
    this.grant = null
    return !!grant && this.now() < grant.expires && owner === grant.owner && currentUrl === grant.url &&
      details.isMainFrame === true && details.requestingUrl === grant.url &&
      Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio'
  }
}

export const microphoneGrant = new MicrophoneGrant()
