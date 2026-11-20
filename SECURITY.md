# Workspace OS — Security Posture

This document records how Workspace OS satisfies the
[Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
and the app-specific controls layered on top. Detailed Red Team findings,
regression tests, and residual risks are tracked in
[`docs/technical-debt-audit.md`](docs/technical-debt-audit.md).

## Electron security checklist

| # | Recommendation | Status | Where |
|---|---|---|---|
| 1 | Only load secure content | ✅ | Exact dev origin (`ELECTRON_RENDERER_URL` / `http://localhost:5173`) or renderer bundle `file://` path (`security.ts`) |
| 2 | Disable `nodeIntegration` in renderers | ✅ | `webPreferences.nodeIntegration: false` (`index.ts`, `security.ts`) |
| 3 | Enable `contextIsolation` | ✅ | `contextIsolation: true` |
| 4 | Enable process sandboxing | ✅ | `sandbox: true` on main renderer and attached guest webviews |
| 5 | Handle session permission requests | ✅ | Deny-by-default `setPermissionRequestHandler` (`security.ts`) |
| 6 | Do not disable `webSecurity` | ✅ | `webSecurity: true` |
| 7 | Define a Content-Security-Policy | ✅ | Enforced via response headers (`applySessionSecurity`), plus strict CSP on `wos-app://` pages |
| 8 | Do not set `allowRunningInsecureContent` | ✅ | `allowRunningInsecureContent: false` |
| 9 | Do not enable experimental features | ✅ | `experimentalFeatures: false`; `enableBlinkFeatures: ''` |
| 10 | Do not use `enableBlinkFeatures` | ✅ | Forced empty in `will-attach-webview` |
| 11 | Restrict `<webview>` attachment & guests | ✅ | Permitted only for `persist:browser` (`http`/`https`/`about:blank`) and `wos-app://`, with `preloadURL` stripped, `webviewTag: false`, and guest `will-navigate` scheme allowlist |
| 12 | Verify/limit navigation | ✅ | `will-navigate` verifies exact origin in dev and bundle path confinement in prod; opens `http(s)` externally |
| 13 | Disable or limit new window creation | ✅ | `setWindowOpenHandler` denies popups; `http(s)` opened in system browser or forwarded to Browser tabs |
| 14 | Validate the sender of IPC messages | ✅ | `assertMainFrame` fails closed on subframes and detached (`senderFrame === null`) senders across shell, terminal, and agent channels |

## App-specific controls

- **Workspace-root & symlink confinement.** The main process owns the active
  workspace root. File-system IPC, `wos-app://` protocol handlers, app packaging,
  and browser screenshot writers validate paths lexically and via `lstat`/`realpath`
  (`realPathSafe`), failing closed on dangling symlinks, symlink loops, and
  out-of-root targets. Covered by `src/main/ipc-validator.test.ts`,
  `src/main/apps/apps-store.test.ts`, `src/main/handlers/apps.security.test.ts`,
  and `src/main/browser/browserControl.test.ts`.
- **Overwrite-safe filesystem mutations.** `FS_CREATE` uses exclusive creation
  (`wx`), `FS_RENAME` refuses to clobber existing targets, and `.workspace-os`
  protection checks exact directory boundary (`root/.workspace-os/...`). Covered
  by `src/main/handlers/fs.security.test.ts`.
- **Scoped agent grants across providers.** Both Claude and Codex runs receive
  per-run bearer grants bound to the active workspace root (`launchRun.ts`), so
  switching workspaces invalidates access from earlier runs regardless of CLI
  provider.
- **Process & sidecar isolation.** Agent CLIs, Git checkpoints, and the
  LibreOfficeKit (`lokHost.ts`) sidecar spawn with argument arrays (never a
  shell). `LokHost` scrubs secret-bearing environment variables (`API_KEY`,
  `TOKEN`, `SECRET`, `PASSWORD`, `PRIVATE_KEY`, `CREDENTIAL`) before spawning
  LibreOffice and enforces a `MAX_FRAME_BYTES` ceiling on engine pipe frames.
- **Atomic secret storage.** `VaultStore` (`src/main/secrets/vault.ts`) encrypts
  values via Electron `safeStorage` and writes `secrets.json` via mode-`0o600`
  temp file + atomic `renameSync`.
- **SSRF & IPv6 literal filtering.** Remote mail image proxying (`remote-images.ts`)
  blocks loopback, RFC1918, CGNAT (`100.64.0.0/10`), link-local/cloud-metadata
  (`169.254.0.0/16`), trailing-dot localhost aliases, and IPv4-mapped/compatible,
  NAT64 (`64:ff9b::/96`), and 6to4 (`2002::/16`) IPv6 representations.
- **Bounded package expansion in the engine-free DOCX writers (RT-09).** The
  three in-place DOCX writers (`docx-cards`, `docx-table`, `docx-cc`) read
  `word/document.xml` with `JSZip.loadAsync(...).file(...).async('string')` and
  nothing bounded the expansion. A 199 KB package — under any size gate a user
  or check would apply — expands to 200 MB of XML, measured at ~400 MB of heap
  and ~900 ms before the write failed anyway on its anchor check. `src/main/docx-zip.ts`
  now reads the entry as a counted stream, destroying it the moment it crosses
  32 MiB, so peak memory is the ceiling plus one chunk. The archive's declared
  uncompressed size is used only for a cheap early rejection, never trusted: a
  forged small header still hits the stream bound (tested). Refusals are typed
  (`document-too-large`) and the file on disk is left untouched. Covered by
  `src/main/docx-zip.test.ts` and `src/main/docx-bomb-ends.test.ts`, both using
  real archives and both confirmed to fail against the unbounded read.
- **Brand logo path confinement (RT-08).** The brand `logoPath` is chosen by the
  renderer and rendered by the UI with `fileUrl(logoPath)`, and the store's
  check was lexical — so a symlink inside `userData/brand/` pointing at any file
  main can open turned the logo preview into a reader for it. The path is now
  confirmed with `realpathSync` against the resolved brand directory; a dangling
  link is refused rather than accepted. Covered by the symlink case in
  `src/main/brand/brand-store.test.ts`, which failed against the lexical check.
- **Drive save-back confinement (RT-07).** `drive:save` reads a workspace file
  and uploads it to the connected Drive. Its confinement check was the lexical
  `path.resolve` prefix test that SEC-01 replaced everywhere else — invisible to
  a symlink, so `<workspace>/out -> /home/user/private` passed it and the
  contents of that directory were uploaded to a third party (nothing downstream
  re-checked: the Drive client joins paths with plain `path.join`). It now uses
  the same `validateFilePath` (lstat/readlink, `MAX_SYMLINK_HOPS`, dangling and
  looping symlinks refused) as the filesystem handlers. Covered by
  `src/main/handlers/drive.security.test.ts`, which uses a real directory, a real
  symlink and a real outside file — and was confirmed to fail against the old
  check before the fix was kept.
- **Action-bridge reply provenance and bounded fan-out (RT-06).** The agent's
  `wos-action` socket resolves a pending action with a fire-and-forget
  `agent:action-result` message. That message is the only IPC handler that was
  reached through `ipcMain.on` rather than `ipcHandle`, and it had no frame
  check: an unchecked sender could report an action as successful that never
  ran (the agent then proceeds on a result that does not exist) or report a real
  action as refused. It now goes through the same `assertMainFrame` guard as
  every other sensitive channel. In addition, in-flight renderer round-trips are
  capped at 64 with a typed refusal instead of growing the pending map and open
  sockets without bound. Covered by `src/main/agent/actionBridge.sender.test.ts`
  and `src/main/agent/actionBridge.bound.test.ts`.
- **Remote MCP OAuth endpoint trust (RT-04).** The OAuth endpoints for a remote
  MCP connector come from the server's own RFC 9728/8414 metadata — a party with
  no prior trust relationship — and are then used three ways: `openExternal` for
  the consent URL, the token endpoint for the authorization code and PKCE
  verifier, and the token endpoint again for every unattended refresh. Endpoint
  URLs are therefore required to be absolute `https:` with no user-info and no
  loopback/private/link-local/CGNAT literal (the same `src/main/url-host-guard.ts`
  classification the mail image proxy uses), enforced in the metadata parsers,
  on configured connector endpoints, in `buildAuthUrl`, and again at the token
  sink so a record written before this check cannot reach a cleartext endpoint.
  Credential-shaped fields forwarded to a token endpoint are capped at 4 KiB
  (the authorization code arrives on a loopback listener any local process can
  reach). Errors name the requirement, never the secret. Covered by
  `src/main/mcp/oauth/remote-oauth.security.test.ts` and
  `src/main/mcp/oauth/remote-flow.security.test.ts`.
- **Signed macOS updater verification.** `updater.ts` verifies Apple
  `Developer ID Application:` code-signing authority (rejecting ad-hoc builds)
  before enabling `electron-updater` on macOS, and guards window/webContents
  destruction across async update callbacks.

## Dependency posture

- `npm ci` resolves cleanly without `--legacy-peer-deps` or `--force`.
- `npm audit` reports **0 critical** and **0 high** vulnerabilities across both
  full and production (`--omit=dev`) trees. Remaining moderate transitive
  advisories (`mjml`/`html-minifier`, `exceljs`/`uuid`, `electron-builder`
  build-time `plist`) are documented with reachability analysis in
  [`docs/technical-debt-audit.md`](docs/technical-debt-audit.md).

## Native modules

`better-sqlite3` and `node-pty` are native addons:
- **Node / Vitest:** `npm run rebuild:node` compiles them against the active
  Node ABI (auto-detecting local Node headers for offline environments).
- **Electron dev:** `npm run rebuild:electron` compiles them against Electron's ABI.
- **Packaging:** `electron-builder` rebuilds and unpacks native `.node` binaries
  automatically (`asarUnpack`).

## Residual risks & real-platform gates

- Hostname DNS-rebinding pinning on custom `net.fetch` agents (`remote-images.ts`)
  remains tracked as defense-in-depth (`SEC-05` note in `docs/technical-debt-audit.md`).
- Packaged macOS notarization, Windows SmartScreen/JobObject process-tree kill,
  and real-microphone/device acceptance require validation on native macOS and
  Windows hardware.
