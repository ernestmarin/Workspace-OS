/**
 * Single source of truth for all IPC channel names.
 * Imported by both main process and preload — never hardcode channel strings elsewhere.
 */
export const IPC = {
  SPEECH_SPEAK: 'speech:speak',
  SPEECH_REPLY_OPEN: 'speech:reply-open',
  SPEECH_REPLY_RESERVE: 'speech:reply-reserve',
  SPEECH_REPLY_FINISH: 'speech:reply-finish',
  SPEECH_REPLY_CLOSE: 'speech:reply-close',
  SPEECH_MICROPHONE_AUTHORIZE: 'speech:microphone-authorize',
  SPEECH_MICROPHONE_REVOKE: 'speech:microphone-revoke',
  SPEECH_STT_STATUS: 'speech:stt-status',
  SPEECH_STT_TRANSCRIBE: 'speech:stt-transcribe',
  SPEECH_STT_CANCEL: 'speech:stt-cancel',
  SPEECH_STOP: 'speech:stop',
  SPEECH_CANCEL_READING: 'speech:cancel-reading',
  SPEECH_SET_HOTKEY: 'speech:set-hotkey',
  SPEECH_SET_LOOKAHEAD: 'speech:set-lookahead',
  SPEECH_READ_CLIPBOARD: 'speech:read-clipboard',
  SPEECH_STATUS: 'speech:status',
  SPEECH_KOKORO_STATUS: 'speech:kokoro-status',
  // VOX-A4c: artifact-level model integrity (verified vs merely present).
  SPEECH_MODEL_DIAGNOSTICS: 'speech:model-diagnostics',
  SPEECH_KOKORO_PREPARE: 'speech:kokoro-prepare',
  SPEECH_KOKORO_INSTALL: 'speech:kokoro-install',
  SPEECH_KOKORO_INSTALL_STATUS: 'speech:kokoro-install-status',
  SPEECH_KOKORO_INSTALL_CANCEL: 'speech:kokoro-install-cancel',
  SPEECH_CONFIG: 'speech:config',
  SPEECH_SELECT_ENGINE: 'speech:select-engine',
  SPEECH_SET_KEY: 'speech:set-key',
  SPEECH_KEY_STATUS: 'speech:key-status',
  SPEECH_PLAYBACK_DONE: 'speech:playback-done',
  SPEECH_PLAYBACK: 'speech:playback',
  SPEECH_EVENT: 'speech:event',

  // File system
  FS_READ_DIR: 'fs:read-dir',
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_DELETE: 'fs:delete',
  FS_RENAME: 'fs:rename',
  FS_CREATE: 'fs:create',
  FS_WATCH_START: 'fs:watch-start',
  FS_WATCH_STOP: 'fs:watch-stop',
  FS_WATCH_EVENT: 'fs:watch-event',

  // Shell / Agent Terminal
  SHELL_SPAWN: 'shell:spawn',
  SHELL_INPUT: 'shell:input',
  SHELL_OUTPUT: 'shell:output',
  SHELL_RESIZE: 'shell:resize',
  SHELL_KILL: 'shell:kill',

  // Agent (Claude CLI bridge — `-p`/stream-json pipeline)
  AGENT_RUN: 'agent:run',
  AGENT_OUTPUT: 'agent:output',
  AGENT_ASSISTANT_TEXT: 'agent:assistant-text',
  AGENT_ASSISTANT_RESPONSE: 'agent:assistant-response',
  AGENT_DONE: 'agent:done',
  AGENT_CANCEL: 'agent:cancel',
  // Drop a closed tab's conversation → claude-session-id mapping so the LRU map
  // (and its persisted file) don't accrete resume-ids for tabs that no longer exist.
  AGENT_FORGET_CONVERSATION: 'agent:forget-conversation',
  AGENT_ARTIFACT: 'agent:artifact',
  // Classified list of every file a run produced/touched — surfaced as openable
  // artifact cards in the agent session (superset of the single AGENT_ARTIFACT
  // office auto-open above).
  AGENT_ARTIFACTS: 'agent:artifacts',
  // Structured per-run cost/turn metadata parsed from the stream-json `result`
  // event — feeds the session budget ledger without changing the -p console.
  AGENT_RUN_META: 'agent:run-meta',
  // Compact "what the agent is DOING" signal parsed from `tool_use` events in
  // the SAME stream-json — drives the working indicator + steps trail. Free:
  // pure parsing of output we already receive, no extra tokens, no new runs.
  AGENT_ACTIVITY: 'agent:activity',

  // Agent broker v2 — interactive PTY `claude` session (native permission
  // prompts). Additive to the -p pipeline above; chosen per session by a toggle.
  AGENT_PTY_SPAWN: 'agent:pty-spawn',
  AGENT_PTY_INPUT: 'agent:pty-input',
  AGENT_PTY_OUTPUT: 'agent:pty-output',
  AGENT_PTY_RESIZE: 'agent:pty-resize',
  AGENT_PTY_KILL: 'agent:pty-kill',
  AGENT_PTY_EXIT: 'agent:pty-exit',

  // Integrated Terminal Dock — PTY host (separate from the legacy SHELL_* pair;
  // this one is lazy-native + emits an explicit EXIT event and lives only in the
  // new shell). See main/terminal/ptyHost.ts.
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',

  // Live workspace harness/context — the shared context every terminal + agent
  // session carries (root / surface / folder / open file / capabilities).
  CONTEXT_SET: 'context:set',

  // AGENT→ACTION bridge — the in-app `claude -p` agent EXECUTES per-surface
  // actions by running the `wos-action` CLI, which reaches main over a local
  // unix socket. Main forwards `run <id>` to the focused window's renderer
  // executor (INVOKE) and awaits its reqId-correlated reply (RESULT). The
  // renderer runs the SAME surfaceActions registry a dock chip runs — the
  // agent drives the live UI. Only NON-DESTRUCTIVE, registered ids are allowed.
  AGENT_ACTION_INVOKE: 'agent:action-invoke',
  AGENT_ACTION_RESULT: 'agent:action-result',

  // Browser drive — the agent DRIVES the visible in-app Browser surface's
  // sandboxed <webview> (navigate / screenshot / extract / read current URL).
  // Main captures the guest webContents from `did-attach-webview` (security.ts)
  // and reaches it here. http(s) only; extraction is a FIXED script with a mode
  // enum (no arbitrary agent JS); screenshots write only under a caller path.
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_SCREENSHOT: 'browser:screenshot',
  BROWSER_THUMBNAIL: 'browser:thumbnail',
  /** The in-app browser's downloads in flight or just finished (ADOPTION.md B5). */
  BROWSER_DOWNLOADS: 'browser:downloads',
  /** main → renderer: one download changed (started, progressed, finished). */
  BROWSER_DOWNLOAD_EVENT: 'browser:download',
  BROWSER_EXTRACT: 'browser:extract',
  // Structured page perception (links-by-category, interactives, headings,
  // consent hint) via a FIXED read-only script. Deep-read builds on this.
  BROWSER_MAP: 'browser:map',
  BROWSER_CURRENT: 'browser:current',
  // Interaction — FIXED, param'd scripts (a selector / visible-text / direction /
  // timeout is DATA, never agent JS): dismiss cookie banners, click, scroll,
  // wait-for, history nav, and type-into-input. Same sandbox + http(s)-only guest.
  BROWSER_DISMISS_COOKIES: 'browser:dismiss-cookies',
  // Hardened consent: overlay + consent-wall pages + same-origin iframes.
  BROWSER_CLEAR_CONSENT: 'browser:clear-consent',
  // One-shot deep read: navigate → clearConsent → map → visit top subpages →
  // extract → assemble a company/site PROFILE. Bounded by maxPages + time.
  BROWSER_DEEP_READ: 'browser:deep-read',
  BROWSER_CLICK: 'browser:click',
  BROWSER_SCROLL: 'browser:scroll',
  BROWSER_WAIT_FOR: 'browser:wait-for',
  BROWSER_BACK: 'browser:back',
  BROWSER_FORWARD: 'browser:forward',
  BROWSER_TYPE: 'browser:type',
  // Multi-tab: the renderer tells main which tab's guest is ACTIVE (by its
  // getWebContentsId()), so the drive (navigate/deepRead/…) + wos:browser-navigate
  // act on the VISIBLE tab. Falls back to the latest attached guest.
  BROWSER_SET_ACTIVE_GUEST: 'browser:set-active-guest',
  // Multi-tab (Stage 2): the renderer maps a TAB ID → its guest (by
  // getWebContentsId()) on the tab's dom-ready, and unmaps it on tab close, so a
  // drive call carrying a `tab` id acts on that exact tab's guest (create/register
  // must already have happened). Omitting `tab` keeps today's active-tab behavior.
  BROWSER_REGISTER_TAB: 'browser:register-tab',
  BROWSER_UNREGISTER_TAB: 'browser:unregister-tab',

  // Browsing history + bookmarks. ONE store: a bookmark is a starred history
  // row, so bookmarks are full-text searchable and cannot drift out of sync.
  // HISTORY_SEARCH is full-text over page CONTENT; HISTORY_SUGGEST is the
  // omnibox's url/title match, which deliberately does NOT search body text.
  HISTORY_RECORD: 'history:record',
  HISTORY_SEARCH: 'history:search',
  HISTORY_SUGGEST: 'history:suggest',
  HISTORY_RECENT: 'history:recent',
  HISTORY_STAR: 'history:star',
  HISTORY_UNSTAR: 'history:unstar',
  HISTORY_IS_STARRED: 'history:is-starred',
  HISTORY_BOOKMARKS: 'history:bookmarks',
  HISTORY_FORGET: 'history:forget',
  HISTORY_FORGET_SINCE: 'history:forget-since',
  HISTORY_CLEAR: 'history:clear',
  /** Empties the browser's HTTP cache. Never touches cookies — see the handler. */
  BROWSER_CLEAR_CACHE: 'browser:clear-cache',

  // Skills (Claude skills discovery)
  SKILLS_LIST: 'skills:list',

  // Agents (user-defined personas)
  AGENTS_LIST: 'agents:list',
  AGENTS_READ: 'agents:read',
  AGENTS_WRITE: 'agents:write',
  AGENTS_DELETE: 'agents:delete',
  // Agent Foundry — the capability catalog (single source of truth for what a
  // specialist can be granted) + the meta-agent that AUTHORS a spec from a
  // plain-language description. BUILD returns a PROPOSAL; the UI previews and
  // the user approves, then calls AGENTS_WRITE.
  AGENTS_CAPABILITIES: 'agents:capabilities',
  AGENTS_BUILD: 'agents:build',

  // System status (engine/python/claude health)
  SYSTEM_STATUS: 'system:status',

  // System pasteboard. WOS-008: the renderer CANNOT use navigator.clipboard —
  // applySessionSecurity denies every permission request, which includes
  // `clipboard-read`, so readText() rejects. Rather than punch a hole in a
  // deliberate deny-all policy, clipboard access goes through Electron's own
  // module in main: no permission gate, no transient-activation requirement,
  // and testable without a browser clipboard mock.
  CLIPBOARD_READ: 'clipboard:read',
  CLIPBOARD_WRITE: 'clipboard:write',

  // Secret vault (OS-keychain-encrypted) — key NAMES + metadata cross IPC,
  // NEVER values. `secret:set` takes a value that leaves the renderer at once.
  SECRET_LIST: 'secret:list',
  SECRET_SET: 'secret:set',
  SECRET_REMOVE: 'secret:remove',
  SECRET_STATUS: 'secret:status',

  // MCP connectors — catalog, enable/disable, and per-connector readiness.
  MCP_LIST_CONNECTORS: 'mcp:list-connectors',
  MCP_ENABLE: 'mcp:enable',
  MCP_DISABLE: 'mcp:disable',
  MCP_STATUS: 'mcp:status',
  // Remote OAuth connectors (Path B) — run the PKCE loopback flow against the
  // server's own auth server and store the refresh token in the vault; report
  // connected state; disconnect (remove the stored record).
  MCP_OAUTH_CONNECT: 'mcp:oauth-connect',
  MCP_OAUTH_STATUS: 'mcp:oauth-status',
  MCP_OAUTH_DISCONNECT: 'mcp:oauth-disconnect',

  // Search index
  SEARCH_QUERY: 'search:query',
  SEARCH_SYMBOLS: 'search:symbols',
  SEARCH_INDEX_STATUS: 'search:index-status',

  // Knowledge base — [[wikilink]] backlinks graph over the workspace notes.
  LINKS_BACKLINKS: 'links:backlinks',
  LINKS_OUTGOING: 'links:outgoing',
  LINKS_STUBS: 'links:stubs',
  LINKS_RESOLVE: 'links:resolve',
  LINKS_GRAPH: 'links:graph',
  LINKS_RELATED: 'links:related',

  // Workspace memory (read-only Pulse cross-project insights)
  MEMORY_QUERY: 'memory:query',
  MEMORY_RECENT: 'memory:recent',
  MEMORY_STATUS: 'memory:status',

  // Mail (native IMAP client — read-only inbox, Phase 1)
  MAIL_ACCOUNTS_LIST: 'mail:accounts-list',
  MAIL_ACCOUNTS_ADD: 'mail:accounts-add',
  // Add the built-in demo mailbox (one click, no credentials, no network).
  MAIL_ACCOUNTS_ADD_DEMO: 'mail:accounts-add-demo',
  MAIL_ACCOUNTS_REMOVE: 'mail:accounts-remove',
  MAIL_ACCOUNTS_TEST: 'mail:accounts-test',
  MAIL_FOLDERS: 'mail:folders',
  MAIL_MESSAGES: 'mail:messages',
  MAIL_MESSAGE: 'mail:message',
  /** Fetch a message's remote images in MAIN and return them as data: URIs. */
  MAIL_REMOTE_IMAGES: 'mail:remote-images',
  // Mail (Phase 2: compose / reply / forward / send via SMTP)
  MAIL_SEND: 'mail:send',
  MAIL_SMTP_TEST: 'mail:smtp-test',
  // Mail (Phase 3: fuse inbound mail into the Agent Review / Living Feed)
  //  - triage a folder → the messages that plausibly need a human reply
  //  - draft a reply for one message (agent-drafted body; NEVER sends)
  // Local index: cache-first list, real full-text search, background sync.
  // Mutating verbs. Every one is journalled and undoable; there is no delete
  // (that is a move to Trash) and no expunge.
  MAIL_MOVE: 'mail:move',
  MAIL_SET_READ: 'mail:set-read',
  MAIL_SET_FLAGGED: 'mail:set-flagged',
  MAIL_UNDO: 'mail:undo',
  MAIL_UNDOABLE: 'mail:undoable',
  MAIL_UNDO_AGENT: 'mail:undo-agent',
  MAIL_FILING_PROPOSE: 'mail:filing-propose',
  MAIL_FILING_APPLY: 'mail:filing-apply',
  MAIL_WATCH_START: 'mail:watch-start',
  MAIL_WATCH_STOP: 'mail:watch-stop',
  MAIL_NEW_MAIL: 'mail:new-mail',
  MAIL_FOLDER_COUNTS: 'mail:folder-counts',
  MAIL_FOLDER_CREATE: 'mail:folder-create',
  MAIL_FOLDER_RENAME: 'mail:folder-rename',
  MAIL_FOLDER_DELETE: 'mail:folder-delete',
  MAIL_ATTACHMENT_SAVE: 'mail:attachment-save',
  MAIL_ATTACHMENT_OPEN: 'mail:attachment-open',
  MAIL_EXPORT_PDF: 'mail:export-pdf',
  MAIL_RAW_SOURCE: 'mail:raw-source',
  MAIL_CACHED: 'mail:cached',
  MAIL_CONTACTS: 'mail:contacts',
  MAIL_SAVE_DRAFT: 'mail:save-draft',
  MAIL_SEND_QUEUED: 'mail:send-queued',
  MAIL_SEND_CANCEL: 'mail:send-cancel',
  MAIL_SEND_NOW: 'mail:send-now',
  MAIL_SIGNATURE_GET: 'mail:signature-get',
  MAIL_SIGNATURE_SET: 'mail:signature-set',
  MAIL_SEARCH: 'mail:search',
  MAIL_SYNC: 'mail:sync',
  MAIL_INDEX_STATS: 'mail:index-stats',
  MAIL_TRIAGE: 'mail:triage',
  MAIL_SIFT: 'mail:sift',
  MAIL_DRAFT_REPLY: 'mail:draft-reply',
  // Mail (advanced 1:1 email): the everyday compose/reply, richer than a plain
  // box. All NEVER send — sending reuses MAIL_SEND with the compiled html + text.
  //  - RICH_BUILD: assemble a chosen theme + structured blocks → responsive HTML
  //    + plain-text fallback, with live {{metric:<id>}} tokens resolved true.
  //  - RICH_DRAFT: a one-line brief → agent-authored MJML → responsive HTML.
  //  - RICH_ASSIST: current draft + an action (tighten/clearer/warmer/…) → revised body.
  //  - LIVE_DATA: list the workspace metrics + ranges for the "insert live data" picker.
  MAIL_RICH_BUILD: 'mail:rich-build',
  MAIL_RICH_DRAFT: 'mail:rich-draft',
  MAIL_RICH_ASSIST: 'mail:rich-assist',
  MAIL_LIVE_DATA: 'mail:live-data',
  /** Spreadsheet + intent → agent-authored email blocks. */
  MAIL_DRAFT_FROM_FILE: 'mail:draft-from-file',
  /** Native picker for the spreadsheet the email is built from. */
  MAIL_PICK_WORKBOOK: 'mail:pick-workbook',
  // Mail (OAuth): is Google sign-in configured?; run the loopback OAuth flow and
  // create an xoauth2 account (stored secret = refresh token, never a password).
  MAIL_OAUTH_CONFIGURED: 'mail:oauth-configured',
  MAIL_OAUTH_GOOGLE: 'mail:oauth-google',
  // Mail (OAuth, Microsoft): consumer Outlook/Hotmail/Live/MSN require OAuth since
  // Microsoft disabled basic auth in 2024. Same shape as the Google pair.
  MAIL_OAUTH_MICROSOFT_CONFIGURED: 'mail:oauth-microsoft-configured',
  MAIL_OAUTH_MICROSOFT: 'mail:oauth-microsoft',
  MAIL_OAUTH_SET_CLIENT_ID: 'mail:oauth-set-client-id',
  // Mail (autoconfig): email address → resolved IMAP/SMTP settings (curated
  // provider table → Mozilla ISPDB → heuristic guess). Fills the Add Account
  // dialog's server fields with one lookup. No secrets involved.
  MAIL_AUTOCONFIG: 'mail:autoconfig',

  // Brand kit — the user's brand (palette/fonts/logo/voice), codified once and
  // flowed into agent-generated output. NOT secret — plain app data in userData.
  //  - BRAND_GET: read the current brand (a sensible default when unset).
  //  - BRAND_SET: apply a validated partial patch (name/palette/fonts/voice…).
  //  - BRAND_SET_LOGO: copy logo bytes into userData/brand/ and point the brand at it.
  BRAND_GET: 'brand:get',
  BRAND_SET: 'brand:set',
  BRAND_SET_LOGO: 'brand:set-logo',

  // Connected Accounts — the user signs into a website ONCE by hand in the
  // in-app browser (persistent partition); we manage the SESSION lifecycle + a
  // non-secret record per site. NO credential ever crosses this boundary.
  //  - LIST: recorded entries + a live `hasSession` flag (cookies exist? bool only).
  //  - ADD:  record intent for a domain (does NOT log in). The UI opens a login tab.
  //  - SIGNOUT: clear that site's session data from the partition + drop the entry.
  ACCOUNTS_LIST: 'accounts:list',
  ACCOUNTS_ADD: 'accounts:add',
  ACCOUNTS_SIGNOUT: 'accounts:signout',

  // Connections — ONE roster over the MCP vault, Connected Accounts and the
  // mail / calendar / drive stores, with a COMPUTED status (probe verdicts,
  // cached ten minutes). LIST returns presence booleans only; SIGNOUT routes
  // by id prefix to the owning store. No secret value ever crosses here.
  CONNECTIONS_LIST: 'connections:list',
  CONNECTIONS_SIGNOUT: 'connections:signout',

  // Background runs — main-owned agent runs that survive the window (routines,
  // unattended work). Safe mode only, no time limit. Their stream rides the
  // agent:* channels keyed by job id; UPDATED carries the persisted job record.
  RUNS_ENQUEUE: 'runs:enqueue',
  RUNS_LIST: 'runs:list',
  RUNS_PAUSE: 'runs:pause',
  RUNS_RESUME: 'runs:resume',
  RUNS_CANCEL: 'runs:cancel',
  RUNS_UPDATED: 'runs:updated',

  // Routines — agents on the app's own clock. Each fire is a background run
  // with the routine's id, label and exactly its capabilities.
  ROUTINES_LIST: 'routines:list',
  ROUTINES_SAVE: 'routines:save',
  ROUTINES_DELETE: 'routines:delete',
  ROUTINES_RUN_NOW: 'routines:run-now',
  ROUTINES_DESCRIBE: 'routines:describe',
  ROUTINES_UPDATED: 'routines:updated',

  // Needs-you notifications (local, Electron Notification). REQUEST is how
  // the renderer's sources (approvals) ask; OPEN is main → renderer after a
  // click, naming the rail to show.
  NOTIFY_PREFS: 'notify:prefs',
  NOTIFY_SET_PREFS: 'notify:set-prefs',
  NOTIFY_REQUEST: 'notify:request',
  NOTIFY_RECENT: 'notify:recent',
  NOTIFY_OPEN: 'notify:open',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_STYLE: 'window:style',
  WINDOW_SET_STYLE: 'window:set-style',
  WINDOW_RELAUNCH: 'window:relaunch',
  WINDOW_TASKBAR_SETTINGS: 'window:taskbar-settings',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  // ── Declared surface (RT-05) ───────────────────────────────────────────────
  // Every channel main registers lives here. These were previously hardcoded
  // string literals at 243 registration sites in 28 modules, which made the
  // registry a partial list: nothing could tell whether a name was a typo, an
  // orphan, or correct. No value changed.
  //
  AGENT_LIST_MODELS: 'agent:list-models',
  AGENT_SET_DEFAULT_MODEL: 'agent:set-default-model',
  APP_START_ON: 'app:start-on',
  APPS_BRIEF: 'apps:brief',
  APPS_CALL: 'apps:call',
  APPS_CREATE: 'apps:create',
  APPS_DUPLICATE: 'apps:duplicate',
  APPS_EXPORT: 'apps:export',
  APPS_IMPORTCONFIRM: 'apps:importConfirm',
  APPS_IMPORTPICK: 'apps:importPick',
  APPS_INSTALL: 'apps:install',
  APPS_LINT: 'apps:lint',
  APPS_LIST: 'apps:list',
  APPS_LOAD: 'apps:load',
  APPS_MANIFEST: 'apps:manifest',
  APPS_REVEAL: 'apps:reveal',
  APPS_REVIEW: 'apps:review',
  APPS_TEMPLATES: 'apps:templates',
  APPS_TEST: 'apps:test',
  APPS_TESTSWRITE: 'apps:testsWrite',
  APPS_WINDOWFULL: 'apps:windowFull',
  BUG_ANALYZE: 'bug:analyze',
  BUG_CONTEXT: 'bug:context',
  BUG_FILE: 'bug:file',
  BUG_LIST: 'bug:list',
  BUG_SETREPO: 'bug:setRepo',
  BUG_STATUS: 'bug:status',
  CALENDAR_ADD: 'calendar:add',
  CALENDAR_CONNECT_OAUTH: 'calendar:connect-oauth',
  CALENDAR_CREATE_EVENT: 'calendar:create-event',
  CALENDAR_EVENTS: 'calendar:events',
  CALENDAR_REMOVE: 'calendar:remove',
  CALENDAR_REMOVE_EVENT: 'calendar:remove-event',
  CALENDAR_SET_DEFAULT_TARGET: 'calendar:set-default-target',
  CALENDAR_SOURCES: 'calendar:sources',
  CALENDAR_TEST: 'calendar:test',
  CALENDAR_UPDATE: 'calendar:update',
  CALENDAR_UPDATE_EVENT: 'calendar:update-event',
  CALENDAR_WRITE_TARGETS: 'calendar:write-targets',
  CANVAS_EXPORT_PPTX: 'canvas:export-pptx',
  CANVAS_FRAME_TO_SLIDE: 'canvas:frame-to-slide',
  CASES_ADD_ARTIFACT: 'cases:add-artifact',
  CASES_ADD_NOTE: 'cases:add-note',
  CASES_ARTIFACT_URL: 'cases:artifact-url',
  CASES_AS_CONTEXT: 'cases:as-context',
  CASES_AUTHORIZE_ARTIFACT: 'cases:authorize-artifact',
  CASES_CREATE: 'cases:create',
  CASES_DELETE: 'cases:delete',
  CASES_GET: 'cases:get',
  CASES_INSIGHTS: 'cases:insights',
  CASES_LIST: 'cases:list',
  CASES_MARK_ACTED: 'cases:mark-acted',
  CASES_NEXT_STATUS: 'cases:next-status',
  CASES_PROMOTE: 'cases:promote',
  CASES_SET_DESCRIPTION: 'cases:set-description',
  CASES_SET_SCOPE: 'cases:set-scope',
  CASES_SET_STATUS: 'cases:set-status',
  CASES_STATUSES: 'cases:statuses',
  CASES_TERMINAL: 'cases:terminal',
  CASES_VIEW: 'cases:view',
  CASES_WORK_FOLDER: 'cases:work-folder',
  CHAT_UPLOAD: 'chat:upload',
  CHECKPOINT_DIFF: 'checkpoint:diff',
  CHECKPOINT_LIST: 'checkpoint:list',
  CHECKPOINT_ROLLBACK: 'checkpoint:rollback',
  CODEX_OPEN_REQUEST: 'codex:open-request',
  CODEX_RESPOND: 'codex:respond',
  CODEX_SET_EFFORT: 'codex:set-effort',
  CODEX_STEER: 'codex:steer',
  COLLECTION_CREATEFROMSOURCE: 'collection:createFromSource',
  COLLECTION_DELETE: 'collection:delete',
  COLLECTION_LIST: 'collection:list',
  COLLECTION_REFRESH: 'collection:refresh',
  COLLECTION_REFRESHALL: 'collection:refreshAll',
  COLLECTION_REFRESHFORFILE: 'collection:refreshForFile',
  COLLECTION_UPDATE: 'collection:update',
  COLLECTIONLINK_ADD: 'collectionLink:add',
  COLLECTIONLINK_ALLLINKS: 'collectionLink:allLinks',
  COLLECTIONLINK_FORCOLLECTION: 'collectionLink:forCollection',
  COLLECTIONLINK_FORFILE: 'collectionLink:forFile',
  COLLECTIONLINK_PREVIEWSYNCALL: 'collectionLink:previewSyncAll',
  COLLECTIONLINK_REMOVE: 'collectionLink:remove',
  COLLECTIONLINK_SYNCALL: 'collectionLink:syncAll',
  COMPONENTS_DELETE: 'components:delete',
  COMPONENTS_LIST: 'components:list',
  COMPONENTS_SAVE: 'components:save',
  DRIVE_CONNECT: 'drive:connect',
  DRIVE_CONNECTION: 'drive:connection',
  DRIVE_DISCONNECT: 'drive:disconnect',
  DRIVE_LIST: 'drive:list',
  DRIVE_LOCAL_NAME: 'drive:local-name',
  DRIVE_OPEN: 'drive:open',
  DRIVE_SAVE: 'drive:save',
  DRIVE_SEARCH: 'drive:search',
  FS_LIST_FILES: 'fs:list-files',
  FS_OPEN_FOLDER_DIALOG: 'fs:open-folder-dialog',
  FS_READ_FILE_BYTES: 'fs:read-file-bytes',
  FS_REVEAL: 'fs:reveal',
  FS_SAVE_COPY_DIALOG: 'fs:save-copy-dialog',
  KNOWLEDGE_READ: 'knowledge:read',
  KNOWLEDGE_SEARCH: 'knowledge:search',
  LOK_ANIMATE: 'lok:animate',
  LOK_AVAILABLE: 'lok:available',
  LOK_BUILDCAPTURED: 'lok:buildCaptured',
  LOK_CAPTURE: 'lok:capture',
  LOK_CLOSE: 'lok:close',
  LOK_CMDVALUES: 'lok:cmdvalues',
  LOK_DLGEVENT: 'lok:dlgevent',
  LOK_DOCSTATUS: 'lok:docstatus',
  LOK_EXPORT: 'lok:export',
  LOK_FILEINFO: 'lok:fileinfo',
  LOK_FINDREPLACE: 'lok:findReplace',
  LOK_GETNOTES: 'lok:getNotes',
  LOK_IMAGESHAPE: 'lok:imageShape',
  LOK_INSERTIMAGE: 'lok:insertImage',
  LOK_KEY: 'lok:key',
  LOK_LASTSHAPE: 'lok:lastshape',
  LOK_MACRO: 'lok:macro',
  LOK_MOUSE: 'lok:mouse',
  LOK_NEW: 'lok:new',
  LOK_OFFICEMACRO: 'lok:officeMacro',
  LOK_OPEN: 'lok:open',
  LOK_PARTINFO: 'lok:partinfo',
  LOK_PARTS: 'lok:parts',
  LOK_PARTTILE: 'lok:parttile',
  LOK_PICKIMAGE: 'lok:pickImage',
  LOK_PRINT: 'lok:print',
  LOK_SAVE: 'lok:save',
  LOK_SELINFO: 'lok:selinfo',
  LOK_SETNOTES: 'lok:setNotes',
  LOK_SETRANGEBLOCK: 'lok:setRangeBlock',
  LOK_SETTABLE: 'lok:setTable',
  LOK_SETBORDER: 'lok:setborder',
  LOK_SETPART: 'lok:setpart',
  LOK_SETSIZE: 'lok:setsize',
  LOK_SHEETGEOMETRY: 'lok:sheetgeometry',
  LOK_SLIDESSVG: 'lok:slidessvg',
  LOK_TILE: 'lok:tile',
  LOK_TILES: 'lok:tiles',
  LOK_TRANSITION: 'lok:transition',
  LOK_UNO: 'lok:uno',
  LOK_WCLOSE: 'lok:wclose',
  LOK_WKEY: 'lok:wkey',
  LOK_WMOUSE: 'lok:wmouse',
  LOK_WPAINT: 'lok:wpaint',
  MAIL_CLASSIFY: 'mail:classify',
  MAIL_NEWSLETTERS_FILE: 'mail:newsletters:file',
  MAIL_NEWSLETTERS_PROPOSE: 'mail:newsletters:propose',
  MAIL_RULES_ADD: 'mail:rules:add',
  MAIL_RULES_LIST: 'mail:rules:list',
  MAIL_RULES_REMOVE: 'mail:rules:remove',
  MAIL_RULES_REORDER: 'mail:rules:reorder',
  MAIL_RULES_UPDATE: 'mail:rules:update',
  MEMORY_CONFIRM: 'memory:confirm',
  MEMORY_CORRECT: 'memory:correct',
  MEMORY_FORGET: 'memory:forget',
  MEMORY_HISTORY: 'memory:history',
  MEMORY_LASTTIDY: 'memory:lastTidy',
  MEMORY_LIST: 'memory:list',
  MEMORY_MEANING: 'memory:meaning',
  MEMORY_PROPOSE: 'memory:propose',
  MEMORY_REMEMBER: 'memory:remember',
  MEMORY_SEARCH: 'memory:search',
  MEMORY_SIMILAR: 'memory:similar',
  MEMORY_STATS: 'memory:stats',
  MEMORY_TIDY: 'memory:tidy',
  MENU_OFFICE_COMMANDS: 'menu:office-commands',
  MENU_RUN_ACTION: 'menu:run-action',
  MENU_SET_ACTIONS: 'menu:set-actions',
  MENU_SET_AGENT_MENU: 'menu:set-agent-menu',
  MENU_SET_BROWSER_CONTEXT: 'menu:set-browser-context',
  MENU_SET_OFFICE_CONTEXT: 'menu:set-office-context',
  MENU_SET_OFFICE_STATE: 'menu:set-office-state',
  METRIC_CREATE: 'metric:create',
  METRIC_CREATEFROMSOURCE: 'metric:createFromSource',
  METRIC_DELETE: 'metric:delete',
  METRIC_LIST: 'metric:list',
  METRIC_REFRESHALLFROMSOURCE: 'metric:refreshAllFromSource',
  METRIC_REFRESHFORFILE: 'metric:refreshForFile',
  METRIC_REFRESHFROMSOURCE: 'metric:refreshFromSource',
  METRIC_UPDATE: 'metric:update',
  OFFICE_AVAILABLE: 'office:available',
  OFFICE_EXPORT_PDF: 'office:export-pdf',
  OFFICE_PRINT: 'office:print',
  OFFICE_TO_PDF: 'office:to-pdf',
  PDF_ANNOTATIONS_READ: 'pdf:annotations:read',
  PDF_ANNOTATIONS_WRITE: 'pdf:annotations:write',
  PDF_EXPORT: 'pdf:export',
  PDF_FORM_FILL: 'pdf:form:fill',
  PDF_FORM_READ: 'pdf:form:read',
  PDF_PAGES_REORDER: 'pdf:pages:reorder',
  PDF_PAGES_ROTATE: 'pdf:pages:rotate',
  PDF_PRINT: 'pdf:print',
  PDF_SIGN: 'pdf:sign',
  PRINT_DOCUMENT: 'print:document',
  PROJECTS_CREATE: 'projects:create',
  PROJECTS_LIST: 'projects:list',
  RANGE_CREATEFROMSOURCE: 'range:createFromSource',
  RANGE_DELETE: 'range:delete',
  RANGE_LIST: 'range:list',
  RANGE_REFRESHALLFROMSOURCE: 'range:refreshAllFromSource',
  RANGE_REFRESHFORFILE: 'range:refreshForFile',
  RANGE_REFRESHFROMSOURCE: 'range:refreshFromSource',
  RANGE_UPDATE: 'range:update',
  RANGELINK_ADD: 'rangeLink:add',
  RANGELINK_ALLLINKS: 'rangeLink:allLinks',
  RANGELINK_FORFILE: 'rangeLink:forFile',
  RANGELINK_FORRANGE: 'rangeLink:forRange',
  RANGELINK_PREVIEWSYNCALL: 'rangeLink:previewSyncAll',
  RANGELINK_REMOVE: 'rangeLink:remove',
  RANGELINK_SYNCALL: 'rangeLink:syncAll',
  SEARCH_PRIORITIZE: 'search:prioritize',
  SEARCH_START: 'search:start',
  SESSIONS_LOAD: 'sessions:load',
  SESSIONS_SAVE: 'sessions:save',
  SNAPSHOT_DELETE: 'snapshot:delete',
  SNAPSHOT_LIST: 'snapshot:list',
  SNAPSHOT_SAVE: 'snapshot:save',
  TRANSCLUSION_ADD: 'transclusion:add',
  TRANSCLUSION_ALLLINKS: 'transclusion:allLinks',
  TRANSCLUSION_FORFILE: 'transclusion:forFile',
  TRANSCLUSION_FORMETRIC: 'transclusion:forMetric',
  TRANSCLUSION_PREVIEWSYNCALL: 'transclusion:previewSyncAll',
  TRANSCLUSION_REMOVE: 'transclusion:remove',
  TRANSCLUSION_SYNCALL: 'transclusion:syncAll',
  TRASH_DELETE: 'trash:delete',
  TRASH_EMPTY: 'trash:empty',
  TRASH_LIST: 'trash:list',
  TRASH_RESTORE: 'trash:restore',
  UPDATER_CHECK: 'updater:check',
  UPDATER_INSTALL: 'updater:install',
  WIKI_ADD: 'wiki:add',
  WIKI_CHANGES: 'wiki:changes',
  WIKI_CHECK: 'wiki:check',
  WIKI_SOURCES: 'wiki:sources',
  WIKI_STATUS: 'wiki:status',
  WIKI_UNDO: 'wiki:undo',
  WORKSPACE_CLOSE: 'workspace:close',
  WORKSPACE_CONTENT_ROOT: 'workspace:content-root',
  WORKSPACE_GET_ROOT: 'workspace:get-root',
  WORKSPACE_OPEN_RECENT: 'workspace:open-recent',
  WORKSPACE_RECENTS: 'workspace:recents',
  WORKSPACE_WRITE_AGENT_NOTE: 'workspace:write-agent-note',

  // main → renderer push channels found undeclared by the RT-05 surface audit.
  APPS_TEST_PROGRESS: 'apps:test-progress',
  BROWSER_OPEN_TAB: 'browser:open-tab',
  CODEX_QUESTION: 'codex:question',
  LOK_CALLBACK: 'lok:callback',
  UPDATER_UPDATE_READY: 'updater:update-ready',
  WIKI_CHANGED: 'wiki:changed',
  WORKSPACE_ROOT_CHANGED: 'workspace:root-changed',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
