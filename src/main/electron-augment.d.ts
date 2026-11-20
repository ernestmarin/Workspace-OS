import 'electron'

declare global {
  namespace Electron {
    interface WebContents {
      /**
       * Chromium's WebContents::SetUserAgent accepts an optional `acceptLanguages`
       * string; omitting it resets `accept_languages` to empty.
       */
      setUserAgent(userAgent: string, acceptLanguages?: string): void
    }
  }
}
