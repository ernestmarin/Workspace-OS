/** One short-lived permission for a specific trusted main-frame audio request. */
export class MicrophoneGrant {
  private grant: { owner: number; url: string; expires: number } | null = null
  constructor(private readonly now = () => Date.now()) {}
  arm(owner: number, url: string): void {
    if (!Number.isSafeInteger(owner) || owner < 1 || !url) throw new Error('Invalid microphone requester')
    this.grant = { owner, url, expires: this.now() + 10_000 }
  }
  clear(): void { this.grant = null }
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
