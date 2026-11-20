import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../main/ipc-channels'
import { isAssistantResponseEvent, type AgentRunFailure, type AssistantResponseEvent } from '../shared/agentRun'
import type { PlaybackMessage, SpeechUiEvent } from '../shared/speech/playback'
import type { ReplySpeechApi } from '../shared/speech/replies'

const replySpeech: ReplySpeechApi = {
  openReplySession: (tabId) => ipcRenderer.invoke(IPC.SPEECH_REPLY_OPEN, tabId),
  reserveReply: (sessionId, runId) => ipcRenderer.invoke(IPC.SPEECH_REPLY_RESERVE, sessionId, runId),
  finishReply: (sessionId, replyId, text) => ipcRenderer.invoke(IPC.SPEECH_REPLY_FINISH, sessionId, replyId, text),
  closeReplySession: (sessionId) => ipcRenderer.invoke(IPC.SPEECH_REPLY_CLOSE, sessionId),
}

/**
 * Exposes a strictly-typed, minimal API to the renderer.
 * The renderer has zero Node.js access — everything goes through these validated channels.
 */
contextBridge.exposeInMainWorld('workspace', {
  speech: {
    ...replySpeech,
    speak: (text: string) => ipcRenderer.invoke(IPC.SPEECH_SPEAK, text),
    authorizeMicrophone: (token: string) => ipcRenderer.invoke(IPC.SPEECH_MICROPHONE_AUTHORIZE, token),
    revokeMicrophone: (token: string) => ipcRenderer.invoke(IPC.SPEECH_MICROPHONE_REVOKE, token),
    sttStatus: () => ipcRenderer.invoke(IPC.SPEECH_STT_STATUS),
    transcribeLocal: (samples: Float32Array, language: string, id: string) => ipcRenderer.invoke(IPC.SPEECH_STT_TRANSCRIBE, samples, language, id),
    cancelTranscription: (id: string) => ipcRenderer.invoke(IPC.SPEECH_STT_CANCEL, id),
    stop: () => ipcRenderer.invoke(IPC.SPEECH_STOP),
    cancelReading: (readingId: number) => ipcRenderer.invoke(IPC.SPEECH_CANCEL_READING, readingId),
    readClipboard: () => ipcRenderer.invoke(IPC.SPEECH_READ_CLIPBOARD),
    setHotkey: (shortcut: string) => ipcRenderer.invoke(IPC.SPEECH_SET_HOTKEY, shortcut),
    setLookahead: (enabled: boolean) => ipcRenderer.invoke(IPC.SPEECH_SET_LOOKAHEAD, enabled),
    status: () => ipcRenderer.invoke(IPC.SPEECH_STATUS),
    kokoroStatus: () => ipcRenderer.invoke(IPC.SPEECH_KOKORO_STATUS),
    modelDiagnostics: () => ipcRenderer.invoke(IPC.SPEECH_MODEL_DIAGNOSTICS),
    installKokoroDependencies: () => ipcRenderer.invoke(IPC.SPEECH_KOKORO_INSTALL),
    kokoroInstallStatus: () => ipcRenderer.invoke(IPC.SPEECH_KOKORO_INSTALL_STATUS),
    cancelKokoroInstall: () => ipcRenderer.invoke(IPC.SPEECH_KOKORO_INSTALL_CANCEL),
    prepareKokoro: () => ipcRenderer.invoke(IPC.SPEECH_KOKORO_PREPARE),
    config: () => ipcRenderer.invoke(IPC.SPEECH_CONFIG),
    selectEngine: (engine: 'kokoro' | 'openai' | 'piper', voice: string) => ipcRenderer.invoke(IPC.SPEECH_SELECT_ENGINE, engine, voice),
    setOpenAiKey: (value: string) => ipcRenderer.invoke(IPC.SPEECH_SET_KEY, value),
    keyStatus: () => ipcRenderer.invoke(IPC.SPEECH_KEY_STATUS),
    playbackDone: (id: string, ok: boolean) => ipcRenderer.invoke(IPC.SPEECH_PLAYBACK_DONE, id, ok),
    onPlayback: (callback: (message: PlaybackMessage) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, message: PlaybackMessage): void => callback(message)
      ipcRenderer.on(IPC.SPEECH_PLAYBACK, handler)
      return () => ipcRenderer.removeListener(IPC.SPEECH_PLAYBACK, handler)
    },
    onEvent: (callback: (event: SpeechUiEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]): void => callback(value)
      ipcRenderer.on(IPC.SPEECH_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.SPEECH_EVENT, handler)
    },
  },
  print: {
    document: (title: string, html: string) => ipcRenderer.invoke(IPC.PRINT_DOCUMENT, title, html),
  },
  pdf: {
    print: (filePath: string, annotations: unknown) => ipcRenderer.invoke(IPC.PDF_PRINT, filePath, annotations),
    readAnnotations: (filePath: string) => ipcRenderer.invoke(IPC.PDF_ANNOTATIONS_READ, filePath),
    writeAnnotations: (filePath: string, doc: unknown) => ipcRenderer.invoke(IPC.PDF_ANNOTATIONS_WRITE, filePath, doc),
    exportAnnotated: (filePath: string, annotations: unknown, inPlace?: boolean) =>
      ipcRenderer.invoke(IPC.PDF_EXPORT, filePath, annotations, inPlace === true),
    reorderPages: (filePath: string, order: number[]) => ipcRenderer.invoke(IPC.PDF_PAGES_REORDER, filePath, order),
    rotatePage: (filePath: string, page: number, delta: number) => ipcRenderer.invoke(IPC.PDF_PAGES_ROTATE, filePath, page, delta),
    readForm: (filePath: string) => ipcRenderer.invoke(IPC.PDF_FORM_READ, filePath),
    fillForm: (filePath: string, values: Record<string, string>) => ipcRenderer.invoke(IPC.PDF_FORM_FILL, filePath, values),
    sign: (filePath: string, pngBase64: string, page: number, rect: { x: number; y: number; w: number; h: number }) =>
      ipcRenderer.invoke(IPC.PDF_SIGN, filePath, pngBase64, page, rect),
  },
  /**
   * Google Drive, over the API. The in-app browser cannot sign into Google —
   * this connects through the SYSTEM browser instead, which is what Google
   * asks desktop apps to do.
   */
  drive: {
    connection: () => ipcRenderer.invoke(IPC.DRIVE_CONNECTION),
    connect: (access: 'readOnly' | 'full' | 'appFiles') => ipcRenderer.invoke(IPC.DRIVE_CONNECT, access),
    disconnect: () => ipcRenderer.invoke(IPC.DRIVE_DISCONNECT),
    list: (folderId?: string, pageToken?: string) => ipcRenderer.invoke(IPC.DRIVE_LIST, folderId, pageToken),
    search: (query: string) => ipcRenderer.invoke(IPC.DRIVE_SEARCH, query),
    /** Fetches into <workspace>/Drive and returns the local path. */
    open: (fileId: string) => ipcRenderer.invoke(IPC.DRIVE_OPEN, fileId),
    save: (fileId: string, localPath: string) => ipcRenderer.invoke(IPC.DRIVE_SAVE, fileId, localPath),
  },
  calendar: {
    sources: () => ipcRenderer.invoke(IPC.CALENDAR_SOURCES),
    test: (input: unknown) => ipcRenderer.invoke(IPC.CALENDAR_TEST, input),
    add: (input: unknown) => ipcRenderer.invoke(IPC.CALENDAR_ADD, input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.CALENDAR_UPDATE, id, patch),
    remove: (id: string) => ipcRenderer.invoke(IPC.CALENDAR_REMOVE, id),
    events: (from: number, to: number) => ipcRenderer.invoke(IPC.CALENDAR_EVENTS, from, to),
    /** Create an event. Lands in the app's own local calendar, never a feed. */
    writeTargets: () => ipcRenderer.invoke(IPC.CALENDAR_WRITE_TARGETS),
    setDefaultTarget: (id: string | null) => ipcRenderer.invoke(IPC.CALENDAR_SET_DEFAULT_TARGET, id),
    createEvent: (input: {
      summary: string
      start: number
      end?: number
      allDay?: boolean
      location?: string
      description?: string
      /** Which calendar; omitted means the remembered one. */
      target?: string
      /** People the SERVER should invite. */
      attendees?: { email: string; name?: string }[]
    }) =>
      ipcRenderer.invoke(IPC.CALENDAR_CREATE_EVENT, input),
    /** Edit an event where it lives — local file by uid, server event by its href.
     * For a recurring event, `scope` says which slice: one occurrence or the series. */
    updateEvent: (
      ref: { uid: string; sourceId?: string; href?: string; scope?: 'occurrence' | 'series'; occurrence?: number },
      changes: {
        summary: string; start: number; end: number; allDay?: boolean; location?: string; description?: string
        attendees?: { email: string; name?: string }[]
      },
    ) => ipcRenderer.invoke(IPC.CALENDAR_UPDATE_EVENT, ref, changes),
    removeEvent: (
      ref: string | { uid: string; sourceId?: string; href?: string; scope?: 'occurrence'; occurrence?: number },
    ) => ipcRenderer.invoke(IPC.CALENDAR_REMOVE_EVENT, ref),
    connectOAuth: (provider: 'google' | 'microsoft', displayName: string) =>
      ipcRenderer.invoke(IPC.CALENDAR_CONNECT_OAUTH, provider, displayName),
  },
  fs: {
    readDir: (dirPath: string) => ipcRenderer.invoke(IPC.FS_READ_DIR, dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke(IPC.FS_READ_FILE, filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke(IPC.FS_WRITE_FILE, filePath, content),
    delete: (filePath: string) => ipcRenderer.invoke(IPC.FS_DELETE, filePath),
    rename: (oldPath: string, newName: string) => ipcRenderer.invoke(IPC.FS_RENAME, oldPath, newName),
    create: (dirPath: string, name: string, isDirectory: boolean) =>
      ipcRenderer.invoke(IPC.FS_CREATE, dirPath, name, isDirectory),
    readFileBytes: (filePath: string) => ipcRenderer.invoke(IPC.FS_READ_FILE_BYTES, filePath),
    openFolderDialog: () => ipcRenderer.invoke(IPC.FS_OPEN_FOLDER_DIALOG),
    saveCopyDialog: (srcPath: string) => ipcRenderer.invoke(IPC.FS_SAVE_COPY_DIALOG, srcPath),
    getWorkspaceRoot: () => ipcRenderer.invoke(IPC.WORKSPACE_GET_ROOT),
    writeAgentNote: (name: string, body: string) => ipcRenderer.invoke(IPC.WORKSPACE_WRITE_AGENT_NOTE, name, body),
    getContentRoot: () => ipcRenderer.invoke(IPC.WORKSPACE_CONTENT_ROOT),
    closeWorkspace: () => ipcRenderer.invoke(IPC.WORKSPACE_CLOSE),
    listFiles: () => ipcRenderer.invoke(IPC.FS_LIST_FILES),
    recentWorkspaces: () => ipcRenderer.invoke(IPC.WORKSPACE_RECENTS),
    openWorkspace: (dir: string) => ipcRenderer.invoke(IPC.WORKSPACE_OPEN_RECENT, dir),
    onRootChanged: (callback: (root: string | null) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, root: string | null) => callback(root)
      ipcRenderer.on(IPC.WORKSPACE_ROOT_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.WORKSPACE_ROOT_CHANGED, handler)
    },
    reveal: (filePath: string) => ipcRenderer.invoke(IPC.FS_REVEAL, filePath),
    watchStart: () => ipcRenderer.invoke(IPC.FS_WATCH_START),
    watchStop: () => ipcRenderer.invoke(IPC.FS_WATCH_STOP),
    onWatchEvent: (callback: (event: { event: string; path: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { event: string; path: string }) => callback(data)
      ipcRenderer.on(IPC.FS_WATCH_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.FS_WATCH_EVENT, handler)
    },
  },

  shell: {
    spawn: (sessionId: string) => ipcRenderer.invoke(IPC.SHELL_SPAWN, sessionId),
    input: (sessionId: string, data: string) => ipcRenderer.invoke(IPC.SHELL_INPUT, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.SHELL_RESIZE, sessionId, cols, rows),
    kill: (sessionId: string) => ipcRenderer.invoke(IPC.SHELL_KILL, sessionId),
    onOutput: (callback: (sessionId: string, data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sessionId: string, data: string) =>
        callback(sessionId, data)
      ipcRenderer.on(IPC.SHELL_OUTPUT, handler)
      return () => ipcRenderer.removeListener(IPC.SHELL_OUTPUT, handler)
    },
  },

  // Integrated Terminal Dock — PTY host for the new shell (lazy-native, emits
  // an explicit exit). Separate from `shell` above so the legacy layout is
  // untouched. See main/terminal/ptyHost.ts + main/handlers/terminal.ts.
  terminal: {
    create: (sessionId: string) => ipcRenderer.invoke(IPC.TERMINAL_CREATE, sessionId),
    write: (sessionId: string, data: string) => ipcRenderer.invoke(IPC.TERMINAL_WRITE, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.TERMINAL_RESIZE, sessionId, cols, rows),
    kill: (sessionId: string) => ipcRenderer.invoke(IPC.TERMINAL_KILL, sessionId),
    onData: (callback: (sessionId: string, data: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, data: string) =>
        callback(sessionId, data)
      ipcRenderer.on(IPC.TERMINAL_DATA, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_DATA, handler)
    },
    onExit: (callback: (sessionId: string, code: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, code: number) =>
        callback(sessionId, code)
      ipcRenderer.on(IPC.TERMINAL_EXIT, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_EXIT, handler)
    },
  },

  // Live workspace harness — the renderer pushes root/surface/folder/open-file
  // as the user navigates; main merges it into the shared context.
  context: {
    set: (ctx: {
      root?: string | null
      surface?: string | null
      folder?: string | null
      openFile?: string | null
      browserUrl?: string | null
      browserTitle?: string | null
      actions?: { id: string; agentHint: string }[]
      allActionIds?: string[]
    }) => ipcRenderer.invoke(IPC.CONTEXT_SET, ctx),
  },

  // AGENT→ACTION bridge (renderer executor side). Main forwards an agent's
  // `wos-action run <id>` here (INVOKE); the app runs the SAME surfaceActions
  // registry a dock chip runs, then replies reqId-correlated (RESULT).
  agentActions: {
    onInvoke: (callback: (payload: { reqId: string; actionId: string; args?: unknown; runId?: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { reqId: string; actionId: string; args?: unknown; runId?: string }) =>
        callback(payload)
      ipcRenderer.on(IPC.AGENT_ACTION_INVOKE, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_ACTION_INVOKE, handler)
    },
    result: (payload: { reqId: string; ok: boolean; result?: unknown; error?: string }) =>
      ipcRenderer.send(IPC.AGENT_ACTION_RESULT, payload),
  },

  search: {
    query: (q: string) => ipcRenderer.invoke(IPC.SEARCH_QUERY, q),
    symbols: (q: string) => ipcRenderer.invoke(IPC.SEARCH_SYMBOLS, q),
    indexStatus: () => ipcRenderer.invoke(IPC.SEARCH_INDEX_STATUS),
    start: () => ipcRenderer.invoke(IPC.SEARCH_START),
    prioritize: (filePath: string) => ipcRenderer.invoke(IPC.SEARCH_PRIORITIZE, filePath),
  },

  // Knowledge base — [[wikilink]] backlinks graph over the workspace notes.
  links: {
    backlinks: (filePath: string) => ipcRenderer.invoke(IPC.LINKS_BACKLINKS, filePath),
    outgoing: (filePath: string) => ipcRenderer.invoke(IPC.LINKS_OUTGOING, filePath),
    stubs: () => ipcRenderer.invoke(IPC.LINKS_STUBS),
    resolve: (name: string) => ipcRenderer.invoke(IPC.LINKS_RESOLVE, name),
    graph: () => ipcRenderer.invoke(IPC.LINKS_GRAPH),
    related: (filePath: string) => ipcRenderer.invoke(IPC.LINKS_RELATED, filePath),
  },

  // Workspace memory — read-only prior insights from the local Pulse DB,
  // scoped in the main process to the active workspace project.
  memory: {
    remember: (input: unknown) => ipcRenderer.invoke(IPC.MEMORY_REMEMBER, input),
    search: (query: string, limit?: number) => ipcRenderer.invoke(IPC.MEMORY_SEARCH, query, limit),
    listMemories: (opts?: unknown) => ipcRenderer.invoke(IPC.MEMORY_LIST, opts),
    forget: (id: string) => ipcRenderer.invoke(IPC.MEMORY_FORGET, id),
    memStats: () => ipcRenderer.invoke(IPC.MEMORY_STATS),
    meaning: () => ipcRenderer.invoke(IPC.MEMORY_MEANING),
    propose: (digest: unknown, model?: string) => ipcRenderer.invoke(IPC.MEMORY_PROPOSE, digest, model),
    tidy: () => ipcRenderer.invoke(IPC.MEMORY_TIDY),
    lastTidy: () => ipcRenderer.invoke(IPC.MEMORY_LASTTIDY),
    correct: (id: string, text: string, author: 'you' | 'agent', source?: string) => ipcRenderer.invoke(IPC.MEMORY_CORRECT, id, text, author, source),
    confirm: (id: string) => ipcRenderer.invoke(IPC.MEMORY_CONFIRM, id),
    history: (id: string) => ipcRenderer.invoke(IPC.MEMORY_HISTORY, id),
    similar: (text: string, scope?: 'workspace' | 'global') => ipcRenderer.invoke(IPC.MEMORY_SIMILAR, text, scope),

    query: (opts?: { types?: string[]; search?: string; limit?: number }) =>
      ipcRenderer.invoke(IPC.MEMORY_QUERY, opts ?? {}),
    recent: (limit?: number) => ipcRenderer.invoke(IPC.MEMORY_RECENT, limit),
    status: () => ipcRenderer.invoke(IPC.MEMORY_STATUS),
  },

  codex: {
    openRequest: (runId: string, requestId: string) => ipcRenderer.invoke(IPC.CODEX_OPEN_REQUEST, runId, requestId),
    setEffort: (effort: string) => ipcRenderer.invoke(IPC.CODEX_SET_EFFORT, effort),
    respond: (runId: string, requestId: string, response: unknown) => ipcRenderer.invoke(IPC.CODEX_RESPOND, runId, requestId, response),
    steer: (runId: string, text: string) => ipcRenderer.invoke(IPC.CODEX_STEER, runId, text),
    onQuestion: (callback: (question: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, question: unknown) => callback(question)
      ipcRenderer.on(IPC.CODEX_QUESTION, handler)
      return () => ipcRenderer.removeListener(IPC.CODEX_QUESTION, handler)
    },
  },
  agent: {
    run: (runId: string, prompt: string, contextFiles: string[], activeFile?: string | null, mode?: 'full' | 'safe', agentName?: string | null, conversationId?: string, model?: string | null, resumeOnly?: boolean, profile?: 'work' | 'chat' | 'app', app?: string) =>
      ipcRenderer.invoke(IPC.AGENT_RUN, { runId, prompt, contextFiles, activeFile, mode, agentName, conversationId, model, resumeOnly, profile, app }),
    setDefaultModel: (model: string) => ipcRenderer.invoke(IPC.AGENT_SET_DEFAULT_MODEL, model),
    listModels: () => ipcRenderer.invoke(IPC.AGENT_LIST_MODELS),
    cancel: (runId: string) => ipcRenderer.invoke(IPC.AGENT_CANCEL, runId),
    // Forget a closed tab's conversation → claude-session-id mapping in main.
    forgetConversation: (conversationId: string) =>
      ipcRenderer.invoke(IPC.AGENT_FORGET_CONVERSATION, conversationId),
    onOutput: (callback: (runId: string, chunk: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, chunk: string) =>
        callback(runId, chunk)
      ipcRenderer.on(IPC.AGENT_OUTPUT, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_OUTPUT, handler)
    },
    onAssistantText: (callback: (runId: string, text: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, text: string) => callback(runId, text)
      ipcRenderer.on(IPC.AGENT_ASSISTANT_TEXT, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_ASSISTANT_TEXT, handler)
    },
    onAssistantResponse: (callback: (event: AssistantResponseEvent) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, event: unknown) => {
        if (isAssistantResponseEvent(event)) callback(event)
      }
      ipcRenderer.on(IPC.AGENT_ASSISTANT_RESPONSE, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_ASSISTANT_RESPONSE, handler)
    },
    onDone: (callback: (runId: string, code: number, checkpointId: string | null, failure?: AgentRunFailure) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, code: number, checkpointId: string | null, failure?: AgentRunFailure) =>
        callback(runId, code, checkpointId, failure)
      ipcRenderer.on(IPC.AGENT_DONE, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_DONE, handler)
    },
    onArtifact: (callback: (runId: string, path: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, p: string) => callback(runId, p)
      ipcRenderer.on(IPC.AGENT_ARTIFACT, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_ARTIFACT, handler)
    },
    // Classified list of a run's output files → the artifact cards strip.
    onArtifacts: (callback: (runId: string, artifacts: { path: string; name: string; type: string }[]) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, artifacts: { path: string; name: string; type: string }[]) =>
        callback(runId, artifacts)
      ipcRenderer.on(IPC.AGENT_ARTIFACTS, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_ARTIFACTS, handler)
    },
    // Structured per-run cost/turn metadata for the session budget ledger.
    onRunMeta: (callback: (runId: string, meta: { costUsd: number; turns: number; durationMs: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, meta: { costUsd: number; turns: number; durationMs: number }) =>
        callback(runId, meta)
      ipcRenderer.on(IPC.AGENT_RUN_META, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_RUN_META, handler)
    },
    // Live "what the agent is DOING" — a friendly label per tool_use, parsed
    // from the same stream (no extra tokens). Drives the working indicator.
    onActivity: (callback: (runId: string, activity: { tool: string; label: string; kind?: string; chip?: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, activity: { tool: string; label: string }) =>
        callback(runId, activity)
      ipcRenderer.on(IPC.AGENT_ACTIVITY, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_ACTIVITY, handler)
    },
  },

  // Agent broker v2 — interactive PTY `claude` session (native permission prompts).
  agentPty: {
    spawn: (sessionId: string, options?: { model?: string; agentName?: string | null; mode?: string; activeFile?: string | null }) => ipcRenderer.invoke(IPC.AGENT_PTY_SPAWN, sessionId, options),
    input: (sessionId: string, data: string) => ipcRenderer.invoke(IPC.AGENT_PTY_INPUT, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.AGENT_PTY_RESIZE, sessionId, cols, rows),
    kill: (sessionId: string) => ipcRenderer.invoke(IPC.AGENT_PTY_KILL, sessionId),
    onOutput: (callback: (sessionId: string, data: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, data: string) => callback(sessionId, data)
      ipcRenderer.on(IPC.AGENT_PTY_OUTPUT, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_PTY_OUTPUT, handler)
    },
    onExit: (callback: (sessionId: string, code: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, code: number) => callback(sessionId, code)
      ipcRenderer.on(IPC.AGENT_PTY_EXIT, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_PTY_EXIT, handler)
    },
  },

  skills: {
    list: (model?: string) => ipcRenderer.invoke(IPC.SKILLS_LIST, model),
  },

  // Browser drive — the agent drives the VISIBLE in-app Browser <webview>.
  // Extraction is a fixed script chosen by `mode` (no arbitrary JS); navigation
  // is http(s) only; screenshots write under userData / the workspace.
  // Every drive method takes an OPTIONAL `tab` id: when given, act on that tab's
  // registered guest; when omitted, act on the ACTIVE tab (backward-compatible).
  browser: {
    navigate: (url: string, tab?: string) => ipcRenderer.invoke(IPC.BROWSER_NAVIGATE, { url, tab }),
    screenshot: (destPath?: string, tab?: string) =>
      ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT, { destPath, tab }),
    thumbnail: (width?: number, tab?: string) => ipcRenderer.invoke(IPC.BROWSER_THUMBNAIL, { width, tab }),
    downloads: () => ipcRenderer.invoke(IPC.BROWSER_DOWNLOADS),
    onDownload: (callback: (d: unknown) => void) => {
      const h = (_e: Electron.IpcRendererEvent, d: unknown): void => callback(d)
      ipcRenderer.on(IPC.BROWSER_DOWNLOAD_EVENT, h)
      return () => ipcRenderer.removeListener(IPC.BROWSER_DOWNLOAD_EVENT, h)
    },
    extract: (mode?: 'text' | 'links' | 'tables' | 'meta', tab?: string) =>
      ipcRenderer.invoke(IPC.BROWSER_EXTRACT, { mode, tab }),
    // Structured page perception (links-by-category, interactives, headings,
    // consent hint) — a FIXED read-only script; no arbitrary JS.
    map: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_MAP, { tab }),
    current: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_CURRENT, { tab }),
    // Interaction — FIXED, param'd scripts (selector/text/direction/timeout are
    // DATA, never agent JS): dismiss cookie banners, click, scroll, wait, nav.
    dismissCookies: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_DISMISS_COOKIES, { tab }),
    // Hardened consent: overlay + consent-wall + same-origin iframes.
    clearConsent: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_CLEAR_CONSENT, { tab }),
    /** Empties the HTTP cache. Logins are cookies and are left alone. */
    clearCache: () => ipcRenderer.invoke(IPC.BROWSER_CLEAR_CACHE),
    // One-shot deep read → a clean {name,homepage,pages,emails,phones,socials}.
    deepRead: (arg: { url: string; maxPages?: number; focus?: string; tab?: string }) =>
      ipcRenderer.invoke(IPC.BROWSER_DEEP_READ, arg),
    click: (arg?: { selector?: string; text?: string; tab?: string }) =>
      ipcRenderer.invoke(IPC.BROWSER_CLICK, arg ?? {}),
    scroll: (arg?: { to?: 'top' | 'bottom'; by?: number; tab?: string }) =>
      ipcRenderer.invoke(IPC.BROWSER_SCROLL, arg ?? {}),
    waitFor: (arg?: { selector?: string; text?: string; timeoutMs?: number; tab?: string }) =>
      ipcRenderer.invoke(IPC.BROWSER_WAIT_FOR, arg ?? {}),
    back: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_BACK, { tab }),
    forward: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_FORWARD, { tab }),
    type: (arg?: { selector?: string; text?: string; tab?: string }) =>
      ipcRenderer.invoke(IPC.BROWSER_TYPE, arg ?? {}),
    // Multi-tab: mark a tab's guest (by getWebContentsId()) as the active drive
    // target, so navigate/deepRead/… + wos:browser-navigate act on the visible tab.
    setActiveGuest: (id: number) => ipcRenderer.invoke(IPC.BROWSER_SET_ACTIVE_GUEST, { id }),
    // Tab-scoped drive: map a renderer TAB ID → its guest (on dom-ready) so a
    // `tab`-carrying drive call targets that exact tab; unmap it on tab close.
    registerTab: (tabId: string, webContentsId: number) =>
      ipcRenderer.invoke(IPC.BROWSER_REGISTER_TAB, { tabId, webContentsId }),
    unregisterTab: (tabId: string) => ipcRenderer.invoke(IPC.BROWSER_UNREGISTER_TAB, { tabId }),
  },

  components: {
    list: () => ipcRenderer.invoke(IPC.COMPONENTS_LIST),
    save: (c: unknown) => ipcRenderer.invoke(IPC.COMPONENTS_SAVE, c),
    delete: (id: string) => ipcRenderer.invoke(IPC.COMPONENTS_DELETE, id),
  },

  // Live-transclusion: source-of-truth metrics + their links into real cells.
  metrics: {
    list: () => ipcRenderer.invoke(IPC.METRIC_LIST),
    create: (name: string, value: number) => ipcRenderer.invoke(IPC.METRIC_CREATE, name, value),
    update: (id: string, patch: { name?: string; value?: number; source?: unknown }) =>
      ipcRenderer.invoke(IPC.METRIC_UPDATE, id, patch),
    delete: (id: string) => ipcRenderer.invoke(IPC.METRIC_DELETE, id),
    // Source-linked metrics: read a value LIVE from a real spreadsheet cell.
    createFromSource: (
      name: string,
      source: { kind: 'xlsx-cell'; filePath: string; sheet: string; cell: string },
    ) => ipcRenderer.invoke(IPC.METRIC_CREATEFROMSOURCE, name, source),
    refreshFromSource: (id: string) => ipcRenderer.invoke(IPC.METRIC_REFRESHFROMSOURCE, id),
    refreshAllFromSource: () => ipcRenderer.invoke(IPC.METRIC_REFRESHALLFROMSOURCE),
    refreshForFile: (filePath: string) => ipcRenderer.invoke(IPC.METRIC_REFRESHFORFILE, filePath),
  },
  transclusions: {
    forFile: (filePath: string) => ipcRenderer.invoke(IPC.TRANSCLUSION_FORFILE, filePath),
    // Read-only "where is this linked": every link for a metric across ALL files.
    forMetric: (metricId: string) => ipcRenderer.invoke(IPC.TRANSCLUSION_FORMETRIC, metricId),
    // Read-only: every link (for per-metric link-count badges).
    allLinks: () => ipcRenderer.invoke(IPC.TRANSCLUSION_ALLLINKS),
    // Anchor is either a flat {sheet, cell} (xlsx), a {tag} (docx), or a
    // discriminated `target` (xlsx-cell / docx-cc / pptx-shape) — all resolved
    // by the main-process validator.
    add: (input: {
      metricId: string
      filePath: string
      lastValue: number
      sheet?: string
      cell?: string
      tag?: string
      target?:
        | { kind: 'xlsx-cell'; sheet: string; cell: string }
        | { kind: 'docx-cc'; tag: string }
        | { kind: 'pptx-shape'; tag: string; slide?: number }
    }) => ipcRenderer.invoke(IPC.TRANSCLUSION_ADD, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.TRANSCLUSION_REMOVE, id),
    previewSyncAll: (metricId: string, openFilePath: string | null) =>
      ipcRenderer.invoke(IPC.TRANSCLUSION_PREVIEWSYNCALL, metricId, openFilePath),
    syncAll: (metricId: string, openFilePath: string | null) =>
      ipcRenderer.invoke(IPC.TRANSCLUSION_SYNCALL, metricId, openFilePath),
  },
  // Live ranges: source-of-truth GRIDS (the range-sized sibling of metrics) +
  // their block links into real files. A range's values only ever come from its
  // source (create/refresh) — the renderer never sets grids directly.
  ranges: {
    list: () => ipcRenderer.invoke(IPC.RANGE_LIST),
    createFromSource: (
      name: string,
      source: { kind: 'xlsx-range'; filePath: string; sheet: string; ref: string },
    ) => ipcRenderer.invoke(IPC.RANGE_CREATEFROMSOURCE, name, source),
    update: (id: string, patch: { name?: string; source?: unknown }) =>
      ipcRenderer.invoke(IPC.RANGE_UPDATE, id, patch),
    refreshFromSource: (id: string) => ipcRenderer.invoke(IPC.RANGE_REFRESHFROMSOURCE, id),
    refreshAllFromSource: () => ipcRenderer.invoke(IPC.RANGE_REFRESHALLFROMSOURCE),
    refreshForFile: (filePath: string) => ipcRenderer.invoke(IPC.RANGE_REFRESHFORFILE, filePath),
    delete: (id: string) => ipcRenderer.invoke(IPC.RANGE_DELETE, id),
  },
  rangeLinks: {
    forFile: (filePath: string) => ipcRenderer.invoke(IPC.RANGELINK_FORFILE, filePath),
    forRange: (rangeId: string) => ipcRenderer.invoke(IPC.RANGELINK_FORRANGE, rangeId),
    allLinks: () => ipcRenderer.invoke(IPC.RANGELINK_ALLLINKS),
    add: (input: {
      rangeId: string
      filePath: string
      target:
        | { kind: 'xlsx-block'; sheet: string; cell: string }
        | { kind: 'docx-table'; tag: string }
        | { kind: 'pptx-table'; tag: string; slide?: number }
      lastValues: (number | string | null)[][]
    }) => ipcRenderer.invoke(IPC.RANGELINK_ADD, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.RANGELINK_REMOVE, id),
    previewSyncAll: (rangeId: string, openFilePath: string | null) =>
      ipcRenderer.invoke(IPC.RANGELINK_PREVIEWSYNCALL, rangeId, openFilePath),
    syncAll: (rangeId: string, openFilePath: string | null) =>
      ipcRenderer.invoke(IPC.RANGELINK_SYNCALL, rangeId, openFilePath),
  },
  // Collections: source-of-truth typed RECORD SETS (records→layout, the leap
  // above ranges) + their field-mapped layout links into real files. A
  // collection's records only ever come from its source (create/refresh); the
  // renderer never sets records directly.
  collections: {
    list: () => ipcRenderer.invoke(IPC.COLLECTION_LIST),
    createFromSource: (
      name: string,
      source: { kind: 'xlsx-range'; filePath: string; sheet: string; ref: string },
    ) => ipcRenderer.invoke(IPC.COLLECTION_CREATEFROMSOURCE, name, source),
    update: (id: string, patch: { name?: string; source?: unknown }) =>
      ipcRenderer.invoke(IPC.COLLECTION_UPDATE, id, patch),
    refresh: (id: string) => ipcRenderer.invoke(IPC.COLLECTION_REFRESH, id),
    refreshAll: () => ipcRenderer.invoke(IPC.COLLECTION_REFRESHALL),
    refreshForFile: (filePath: string) => ipcRenderer.invoke(IPC.COLLECTION_REFRESHFORFILE, filePath),
    delete: (id: string) => ipcRenderer.invoke(IPC.COLLECTION_DELETE, id),
  },
  collectionLinks: {
    forFile: (filePath: string) => ipcRenderer.invoke(IPC.COLLECTIONLINK_FORFILE, filePath),
    forCollection: (collectionId: string) =>
      ipcRenderer.invoke(IPC.COLLECTIONLINK_FORCOLLECTION, collectionId),
    allLinks: () => ipcRenderer.invoke(IPC.COLLECTIONLINK_ALLLINKS),
    add: (input: {
      collectionId: string
      filePath: string
      target:
        | { kind: 'xlsx-block'; sheet: string; cell: string }
        | { kind: 'docx-table'; tag: string }
        | { kind: 'pptx-table'; tag: string; slide?: number }
      columns: { field: string; header: string }[]
      lastGrid: (number | string | null)[][]
    }) => ipcRenderer.invoke(IPC.COLLECTIONLINK_ADD, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.COLLECTIONLINK_REMOVE, id),
    previewSyncAll: (collectionId: string, openFilePath: string | null) =>
      ipcRenderer.invoke(IPC.COLLECTIONLINK_PREVIEWSYNCALL, collectionId, openFilePath),
    syncAll: (collectionId: string, openFilePath: string | null) =>
      ipcRenderer.invoke(IPC.COLLECTIONLINK_SYNCALL, collectionId, openFilePath),
  },

  system: {
    status: () => ipcRenderer.invoke(IPC.SYSTEM_STATUS),
  },

  // WOS-008: the system pasteboard. navigator.clipboard is unusable here —
  // every permission request is denied by design, so `clipboard-read` fails.
  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke(IPC.CLIPBOARD_READ),
    writeText: (text: string): Promise<boolean> => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, text),
  },

  // Secret vault — key NAMES cross IPC, never values. `set` sends the value once
  // (encrypted + persisted in main immediately; never kept renderer-side).
  secrets: {
    list: () => ipcRenderer.invoke(IPC.SECRET_LIST),
    status: () => ipcRenderer.invoke(IPC.SECRET_STATUS),
    set: (name: string, value: string) => ipcRenderer.invoke(IPC.SECRET_SET, name, value),
    remove: (name: string) => ipcRenderer.invoke(IPC.SECRET_REMOVE, name),
  },

  // MCP connectors — catalog + enable/disable + readiness (no secret values).
  mcp: {
    listConnectors: () => ipcRenderer.invoke(IPC.MCP_LIST_CONNECTORS),
    enable: (id: string) => ipcRenderer.invoke(IPC.MCP_ENABLE, id),
    disable: (id: string) => ipcRenderer.invoke(IPC.MCP_DISABLE, id),
    status: () => ipcRenderer.invoke(IPC.MCP_STATUS),
    // Remote OAuth (Path B) — run the loopback flow / query connected state /
    // disconnect. No token ever crosses this boundary.
    oauthConnect: (id: string) => ipcRenderer.invoke(IPC.MCP_OAUTH_CONNECT, id),
    oauthStatus: (id: string) => ipcRenderer.invoke(IPC.MCP_OAUTH_STATUS, id),
    oauthDisconnect: (id: string) => ipcRenderer.invoke(IPC.MCP_OAUTH_DISCONNECT, id),
  },

  // Native mail client (Phase 1: read-only inbox). The password crosses only on
  // add/test; it is never returned, cached in the renderer, or logged.
  mail: {
    accounts: {
      list: () => ipcRenderer.invoke(IPC.MAIL_ACCOUNTS_LIST),
      add: (
        payload: {
          displayName: string
          user: string
          imap: { host: string; port: number; tls: boolean }
          smtp?: { host: string; port: number; tls: boolean } | null
        },
        secret: string,
      ) => ipcRenderer.invoke(IPC.MAIL_ACCOUNTS_ADD, payload, secret),
      remove: (id: string) => ipcRenderer.invoke(IPC.MAIL_ACCOUNTS_REMOVE, id),
      // One-click built-in demo mailbox — no credentials, no network.
      addDemo: () => ipcRenderer.invoke(IPC.MAIL_ACCOUNTS_ADD_DEMO),
      test: (
        payload: {
          displayName: string
          user: string
          imap: { host: string; port: number; tls: boolean }
          smtp?: { host: string; port: number; tls: boolean } | null
        },
        secret: string,
      ) => ipcRenderer.invoke(IPC.MAIL_ACCOUNTS_TEST, payload, secret),
    },
    folders: (accountId: string) => ipcRenderer.invoke(IPC.MAIL_FOLDERS, accountId),
    messages: (accountId: string, folder: string, opts?: { limit?: number; beforeUid?: number; offset?: number }) =>
      ipcRenderer.invoke(IPC.MAIL_MESSAGES, accountId, folder, opts ?? {}),
    /** Move a message (Archive, filing, or delete-as-move-to-Trash). Undoable. */
    move: (accountId: string, folder: string, uid: number, messageId: string, toFolder: string, label?: string) =>
      ipcRenderer.invoke(IPC.MAIL_MOVE, accountId, folder, uid, messageId, toFolder, label),
    setRead: (accountId: string, folder: string, uid: number, messageId: string, read: boolean, label?: string) =>
      ipcRenderer.invoke(IPC.MAIL_SET_READ, accountId, folder, uid, messageId, read, label),
    setFlagged: (accountId: string, folder: string, uid: number, messageId: string, flagged: boolean, label?: string) =>
      ipcRenderer.invoke(IPC.MAIL_SET_FLAGGED, accountId, folder, uid, messageId, flagged, label),
    /** Take back a journalled action. */
    undo: (accountId: string, actionId: number) => ipcRenderer.invoke(IPC.MAIL_UNDO, accountId, actionId),
    /** Propose a filing plan for recent mail. Moves nothing. */
    proposeFiling: (accountId: string, folder: string, days: 7 | 30 | 90) =>
      ipcRenderer.invoke(IPC.MAIL_FILING_PROPOSE, accountId, folder, days),
    /** Apply an APPROVED filing plan. Recorded as agent actions, so undoable in one go. */
    applyFiling: (accountId: string, plan: unknown) =>
      ipcRenderer.invoke(IPC.MAIL_FILING_APPLY, accountId, plan),
    /** Undo everything the AGENT did since a moment (ms epoch). */
    undoAgentSince: (accountId: string, sinceMs: number) =>
      ipcRenderer.invoke(IPC.MAIL_UNDO_AGENT, accountId, sinceMs),
    /** The undo stack, newest first. */
    undoable: (accountId: string) => ipcRenderer.invoke(IPC.MAIL_UNDOABLE, accountId),
    /** Save an attachment to a location the user picks. */
    saveAttachment: (accountId: string, folder: string, uid: number, index: number) =>
      ipcRenderer.invoke(IPC.MAIL_ATTACHMENT_SAVE, accountId, folder, uid, index),
    /** Open an attachment with the OS default app, from a temp copy. */
    openAttachment: (accountId: string, folder: string, uid: number, index: number) =>
      ipcRenderer.invoke(IPC.MAIL_ATTACHMENT_OPEN, accountId, folder, uid, index),
    /** Export a rendered message to PDF. */
    exportPdf: (html: string, subject: string) => ipcRenderer.invoke(IPC.MAIL_EXPORT_PDF, html, subject),
    /** Raw RFC822 source — "show original". */
    rawSource: (accountId: string, folder: string, uid: number) =>
      ipcRenderer.invoke(IPC.MAIL_RAW_SOURCE, accountId, folder, uid),
    createFolder: (accountId: string, folderPath: string) =>
      ipcRenderer.invoke(IPC.MAIL_FOLDER_CREATE, accountId, folderPath),
    renameFolder: (accountId: string, from: string, to: string) =>
      ipcRenderer.invoke(IPC.MAIL_FOLDER_RENAME, accountId, from, to),
    deleteFolder: (accountId: string, folderPath: string) =>
      ipcRenderer.invoke(IPC.MAIL_FOLDER_DELETE, accountId, folderPath),
    /** Start/stop watching a folder for new mail. */
    watchStart: (accountId: string, folder: string) =>
      ipcRenderer.invoke(IPC.MAIL_WATCH_START, accountId, folder),
    watchStop: (accountId: string) => ipcRenderer.invoke(IPC.MAIL_WATCH_STOP, accountId),
    /** Subscribe to new-mail events. Returns an unsubscribe function. */
    onNewMail: (cb: (e: { accountId: string; folder: string; count: number; latest: { subject: string; from: string } | null }) => void) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: { accountId: string; folder: string; count: number; latest: { subject: string; from: string } | null },
      ): void => cb(payload)
      ipcRenderer.on(IPC.MAIL_NEW_MAIL, handler)
      return () => ipcRenderer.removeListener(IPC.MAIL_NEW_MAIL, handler)
    },
    /** Unread + total per folder, for the rail badges. */
    folderCounts: (accountId: string, folders: string[]) =>
      ipcRenderer.invoke(IPC.MAIL_FOLDER_COUNTS, accountId, folders),
    /** Send behind an undo window — returns immediately with a queue id. */
    sendQueued: (accountId: string, draft: unknown, context: unknown) =>
      ipcRenderer.invoke(IPC.MAIL_SEND_QUEUED, accountId, draft, context),
    /** Cancel a held send. Only possible before the window expires. */
    cancelSend: (id: string) => ipcRenderer.invoke(IPC.MAIL_SEND_CANCEL, id),
    /** Skip the remaining hold and send now. */
    sendNow: (id: string) => ipcRenderer.invoke(IPC.MAIL_SEND_NOW, id),
    /** Save a compose draft to the server's Drafts folder. */
    saveDraft: (accountId: string, draft: unknown, context: unknown, replaceUid?: number) =>
      ipcRenderer.invoke(IPC.MAIL_SAVE_DRAFT, accountId, draft, context, replaceUid),
    /** Per-account signature. */
    getSignature: (accountId: string) => ipcRenderer.invoke(IPC.MAIL_SIGNATURE_GET, accountId),
    setSignature: (accountId: string, signature: string) =>
      ipcRenderer.invoke(IPC.MAIL_SIGNATURE_SET, accountId, signature),
    /** Recipient suggestions from real correspondence. */
    contacts: (query: string, limit?: number) => ipcRenderer.invoke(IPC.MAIL_CONTACTS, query, limit),
    /** The folder as the local index knows it — instant, no network. */
    cached: (accountId: string, folder: string, limit?: number) =>
      ipcRenderer.invoke(IPC.MAIL_CACHED, accountId, folder, limit),
    /** Full-text search over the LOCAL index (subject, sender, body). */
    search: (query: string, opts?: { accountId?: string; folder?: string; limit?: number; sort?: string }) =>
      ipcRenderer.invoke(IPC.MAIL_SEARCH, query, opts),
    /** Refresh the local index for a folder; deepens bodies in the background. */
    sync: (accountId: string, folder: string) => ipcRenderer.invoke(IPC.MAIL_SYNC, accountId, folder),
    indexStats: () => ipcRenderer.invoke(IPC.MAIL_INDEX_STATS),
    message: (accountId: string, folder: string, uid: number) =>
      ipcRenderer.invoke(IPC.MAIL_MESSAGE, accountId, folder, uid),
    // Opt-in remote images: main fetches them without cookies or referrer and
    // hands back data: URIs, so the reader iframe never needs network access.
    remoteImages: (urls: string[]) => ipcRenderer.invoke(IPC.MAIL_REMOTE_IMAGES, urls),
    // A spreadsheet + an intent → agent-authored, validated email blocks.
    draftFromFile: (payload: { filePath: string; intent: string; instruction?: string }) =>
      ipcRenderer.invoke(IPC.MAIL_DRAFT_FROM_FILE, payload),
    pickWorkbook: () => ipcRenderer.invoke(IPC.MAIL_PICK_WORKBOOK),
    // Phase 2 — SMTP-side "Test connection" (no save) and send.
    smtpTest: (
      payload: {
        displayName: string
        user: string
        imap: { host: string; port: number; tls: boolean }
        smtp?: { host: string; port: number; tls: boolean } | null
      },
      secret: string,
    ) => ipcRenderer.invoke(IPC.MAIL_SMTP_TEST, payload, secret),
    send: (accountId: string, draft: unknown, context?: unknown) =>
      ipcRenderer.invoke(IPC.MAIL_SEND, accountId, draft, context ?? { kind: 'new' }),
    // Phase 3 — triage a folder → ranked "needs a reply" list; draft one reply
    // (agent-suggested body; never sends). Send stays the MAIL_SEND path above.
    rules: {
      list: () => ipcRenderer.invoke(IPC.MAIL_RULES_LIST),
      add: (rule: unknown) => ipcRenderer.invoke(IPC.MAIL_RULES_ADD, rule),
      update: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.MAIL_RULES_UPDATE, id, patch),
      remove: (id: string) => ipcRenderer.invoke(IPC.MAIL_RULES_REMOVE, id),
      reorder: (id: string, delta: number) => ipcRenderer.invoke(IPC.MAIL_RULES_REORDER, id, delta),
    },
    newsletters: {
      propose: (accountId: string, folder: string, days?: number) =>
        ipcRenderer.invoke(IPC.MAIL_NEWSLETTERS_PROPOSE, accountId, folder, days),
      file: (accountId: string, sweep: unknown) => ipcRenderer.invoke(IPC.MAIL_NEWSLETTERS_FILE, accountId, sweep),
    },
    classify: (accountId: string, folder: string, uid: number) =>
      ipcRenderer.invoke(IPC.MAIL_CLASSIFY, accountId, folder, uid),
    triage: (accountId: string, folder: string, opts?: { limit?: number; maxCandidates?: number }) =>
      ipcRenderer.invoke(IPC.MAIL_TRIAGE, accountId, folder, opts ?? {}),
    // The Morning Sift: one batched light-model pass over what's new →
    // zone + priority + one-line summary per mail. Model comes from settings.
    sift: (accountId: string, folder: string, opts?: { model?: string; caseTitles?: string[]; excludeUids?: number[] }) =>
      ipcRenderer.invoke(IPC.MAIL_SIFT, accountId, folder, opts ?? {}),
    draftReply: (
      accountId: string,
      payload: { folder: string; uid: number; replyAll?: boolean; instruction?: string; stance?: 'positive' | 'neutral' | 'negative' },
    ) => ipcRenderer.invoke(IPC.MAIL_DRAFT_REPLY, accountId, payload),
    // OAuth (Google XOAUTH2) — alternative to app-password. `oauthConfigured`
    // tells the UI whether a client id is set; `oauthGoogle` runs the loopback
    // flow and returns the created xoauth2 account (secret = refresh token).
    oauthConfigured: () => ipcRenderer.invoke(IPC.MAIL_OAUTH_CONFIGURED),
    oauthGoogle: (payload: {
      displayName?: string
      user: string
      imap?: { host: string; port: number; tls: boolean }
      smtp?: { host: string; port: number; tls: boolean } | null
    }) => ipcRenderer.invoke(IPC.MAIL_OAUTH_GOOGLE, payload),
    // OAuth (Microsoft XOAUTH2) — required for Outlook/Hotmail/Live/MSN since
    // Microsoft disabled basic auth in 2024. Same shape as the Google pair.
    oauthMicrosoftConfigured: () => ipcRenderer.invoke(IPC.MAIL_OAUTH_MICROSOFT_CONFIGURED),
    // Save an OAuth client id from the UI instead of hand-creating a JSON file.
    oauthSetClientId: (provider: 'google' | 'microsoft', clientId: string) =>
      ipcRenderer.invoke(IPC.MAIL_OAUTH_SET_CLIENT_ID, provider, clientId),
    oauthMicrosoft: (payload: {
      displayName?: string
      user: string
      imap?: { host: string; port: number; tls: boolean }
      smtp?: { host: string; port: number; tls: boolean } | null
    }) => ipcRenderer.invoke(IPC.MAIL_OAUTH_MICROSOFT, payload),
    // Autoconfig — email address → resolved IMAP/SMTP settings (table/ISPDB/guess).
    autoconfig: (email: string) => ipcRenderer.invoke(IPC.MAIL_AUTOCONFIG, email),
    // Advanced 1:1 email — richer than a plain-text box. All NEVER send; the
    // renderer previews, then reuses `send` above with the compiled html + text.
    //  - richBuild: theme + structured blocks → responsive HTML + text fallback
    //    (live {{metric:<id>}} tokens resolved true at build time).
    //  - richDraft: a one-line brief → agent-authored MJML → responsive HTML.
    //  - richAssist: current draft + an action → a revised body.
    //  - liveData: list metrics/ranges, or (with an id) get a drop-in block.
    richBuild: (payload: { themeId?: string; blocks: unknown[] }) =>
      ipcRenderer.invoke(IPC.MAIL_RICH_BUILD, payload),
    richDraft: (payload: { brief: string; brand?: string }) =>
      ipcRenderer.invoke(IPC.MAIL_RICH_DRAFT, payload),
    richAssist: (payload: { action: string; draft: string; instruction?: string }) =>
      ipcRenderer.invoke(IPC.MAIL_RICH_ASSIST, payload),
    liveData: (payload?: { metricId?: string; rangeId?: string }) =>
      ipcRenderer.invoke(IPC.MAIL_LIVE_DATA, payload ?? {}),
  },

  // Brand kit — the user's brand (palette/fonts/logo/voice), codified once and
  // flowed into agent output. NOT secret — plain app data. `setLogo` sends the
  // logo bytes base64-encoded; main copies them into userData/brand/.
  brand: {
    get: () => ipcRenderer.invoke(IPC.BRAND_GET),
    set: (patch: unknown) => ipcRenderer.invoke(IPC.BRAND_SET, patch),
    setLogo: (payload: { filename: string; content: string }) =>
      ipcRenderer.invoke(IPC.BRAND_SET_LOGO, payload),
  },

  // Connected Accounts — the user signs into a website ONCE by hand in the in-app
  // browser; we manage the SESSION lifecycle + a non-secret record per site. NO
  // credential crosses this boundary. `list` returns entries + a live hasSession
  // flag; `add` records intent (does NOT log in); `signout` clears the session.
  accounts: {
    list: () => ipcRenderer.invoke(IPC.ACCOUNTS_LIST),
    add: (url: string) => ipcRenderer.invoke(IPC.ACCOUNTS_ADD, url),
    signout: (domain: string) => ipcRenderer.invoke(IPC.ACCOUNTS_SIGNOUT, domain),
  },

  // Connections — one roster over every store, with a computed status. No
  // secret value crosses this boundary (presence booleans + probe verdicts).
  connections: {
    list: (opts?: { force?: boolean }) => ipcRenderer.invoke(IPC.CONNECTIONS_LIST, opts ?? {}),
    signout: (id: string) => ipcRenderer.invoke(IPC.CONNECTIONS_SIGNOUT, id),
  },

  // Needs-you notifications.
  notify: {
    prefs: () => ipcRenderer.invoke(IPC.NOTIFY_PREFS),
    setPrefs: (next: { approvals?: boolean; routines?: boolean; cases?: boolean; connectors?: boolean }) =>
      ipcRenderer.invoke(IPC.NOTIFY_SET_PREFS, next),
    request: (event: { source: string; key: string; title: string; body?: string; rail?: string }) =>
      ipcRenderer.invoke(IPC.NOTIFY_REQUEST, event),
    recent: () => ipcRenderer.invoke(IPC.NOTIFY_RECENT),
    onOpen: (callback: (target: { rail: string; key: string; source: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, target: { rail: string; key: string; source: string }) => callback(target)
      ipcRenderer.on(IPC.NOTIFY_OPEN, handler)
      return () => ipcRenderer.removeListener(IPC.NOTIFY_OPEN, handler)
    },
  },

  // Routines — agents on the app's clock.
  routines: {
    list: () => ipcRenderer.invoke(IPC.ROUTINES_LIST),
    save: (input: { id?: string; name: string; prompt: string; schedule: string; agentName?: string | null; enabled?: boolean; capabilities?: string[] }) =>
      ipcRenderer.invoke(IPC.ROUTINES_SAVE, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.ROUTINES_DELETE, id),
    runNow: (id: string) => ipcRenderer.invoke(IPC.ROUTINES_RUN_NOW, id),
    describe: (schedule: string) => ipcRenderer.invoke(IPC.ROUTINES_DESCRIBE, schedule),
    onUpdated: (callback: (routines: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, routines: unknown) => callback(routines)
      ipcRenderer.on(IPC.ROUTINES_UPDATED, handler)
      return () => ipcRenderer.removeListener(IPC.ROUTINES_UPDATED, handler)
    },
  },

  // Background runs — owned by main, streamed on the agent:* channels by job id.
  runs: {
    enqueue: (input: { prompt: string; label?: string; agentName?: string | null; origin?: 'routine' | 'background'; contextFiles?: string[] }) =>
      ipcRenderer.invoke(IPC.RUNS_ENQUEUE, input),
    list: () => ipcRenderer.invoke(IPC.RUNS_LIST),
    cancel: (id: string) => ipcRenderer.invoke(IPC.RUNS_CANCEL, id),
    pause: (id: string) => ipcRenderer.invoke(IPC.RUNS_PAUSE, id),
    resume: (id: string) => ipcRenderer.invoke(IPC.RUNS_RESUME, id),
    onUpdated: (callback: (job: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, job: unknown) => callback(job)
      ipcRenderer.on(IPC.RUNS_UPDATED, handler)
      return () => ipcRenderer.removeListener(IPC.RUNS_UPDATED, handler)
    },
  },

  knowledge: {
    search: (query: string, limit?: number) => ipcRenderer.invoke(IPC.KNOWLEDGE_SEARCH, query, limit),
    read: (filePath: string, offset?: number) => ipcRenderer.invoke(IPC.KNOWLEDGE_READ, filePath, offset),
  },

  chat: {
    /** A dropped or pasted file, as bytes: written into the workspace's uploads. */
    upload: (name: string, data: Uint8Array) => ipcRenderer.invoke(IPC.CHAT_UPLOAD, name, data),
  },
  apps: {
    list: () => ipcRenderer.invoke(IPC.APPS_LIST),
    templates: () => ipcRenderer.invoke(IPC.APPS_TEMPLATES),
    install: (id: string) => ipcRenderer.invoke(IPC.APPS_INSTALL, id),
    create: (name: string, description?: string) => ipcRenderer.invoke(IPC.APPS_CREATE, name, description),
    duplicate: (slug: string) => ipcRenderer.invoke(IPC.APPS_DUPLICATE, slug),
    reveal: (slug: string) => ipcRenderer.invoke(IPC.APPS_REVEAL, slug),
    load: (slug: string, theme: 'light' | 'dark') => ipcRenderer.invoke(IPC.APPS_LOAD, slug, theme),
    manifest: (slug: string) => ipcRenderer.invoke(IPC.APPS_MANIFEST, slug),
    lint: (slug: string) => ipcRenderer.invoke(IPC.APPS_LINT, slug),
    brief: (slug: string, idea: string) => ipcRenderer.invoke(IPC.APPS_BRIEF, slug, idea),
    review: (slug: string, rect: { x: number; y: number; width: number; height: number } | null, tests?: string) => ipcRenderer.invoke(IPC.APPS_REVIEW, slug, rect, tests),
    testsWrite: (slug: string, request: string) => ipcRenderer.invoke(IPC.APPS_TESTSWRITE, slug, request),
    windowFull: () => ipcRenderer.invoke(IPC.APPS_WINDOWFULL),
    test: (slug: string) => ipcRenderer.invoke(IPC.APPS_TEST, slug),
    onTestProgress: (cb: (p: { slug: string; i: number; total: number; name: string }) => void) => {
      const handler = (_e: unknown, p: { slug: string; i: number; total: number; name: string }): void => cb(p)
      ipcRenderer.on(IPC.APPS_TEST_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC.APPS_TEST_PROGRESS, handler)
    },
    export: (slug: string) => ipcRenderer.invoke(IPC.APPS_EXPORT, slug),
    importPick: () => ipcRenderer.invoke(IPC.APPS_IMPORTPICK),
    importConfirm: (token: string) => ipcRenderer.invoke(IPC.APPS_IMPORTCONFIRM, token),
    call: (slug: string, method: string, args: unknown) => ipcRenderer.invoke(IPC.APPS_CALL, slug, method, args),
  },
  sessions: {
    load: () => ipcRenderer.invoke(IPC.SESSIONS_LOAD),
    save: (root: string, json: string) => ipcRenderer.invoke(IPC.SESSIONS_SAVE, root, json),
  },

  wiki: {
    add: (paths: string[], opts?: { wait?: boolean; again?: boolean }) => ipcRenderer.invoke(IPC.WIKI_ADD, paths, opts),
    status: () => ipcRenderer.invoke(IPC.WIKI_STATUS),
    changes: (limit?: number) => ipcRenderer.invoke(IPC.WIKI_CHANGES, limit),
    sources: () => ipcRenderer.invoke(IPC.WIKI_SOURCES),
    undo: (id: string) => ipcRenderer.invoke(IPC.WIKI_UNDO, id),
    check: () => ipcRenderer.invoke(IPC.WIKI_CHECK),
    onChanged: (cb: () => void) => {
      const handler = (): void => cb()
      ipcRenderer.on(IPC.WIKI_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.WIKI_CHANGED, handler)
    },
  },

  agents: {
    list: () => ipcRenderer.invoke(IPC.AGENTS_LIST),
    read: (name: string, scope?: 'global' | 'project') => ipcRenderer.invoke(IPC.AGENTS_READ, name, scope),
    write: (payload: { name: string; model?: string; description?: string; persona?: string; mode?: 'full' | 'safe'; skills?: string[]; capabilities?: string[]; surface?: string; scope?: 'global' | 'project' }) =>
      ipcRenderer.invoke(IPC.AGENTS_WRITE, payload),
    delete: (name: string, scope?: 'global' | 'project') => ipcRenderer.invoke(IPC.AGENTS_DELETE, name, scope),
    // Agent Foundry: the capability palette + the meta-agent that authors a spec.
    capabilities: () => ipcRenderer.invoke(IPC.AGENTS_CAPABILITIES),
    build: (description: string) => ipcRenderer.invoke(IPC.AGENTS_BUILD, description),
  },

  checkpoint: {
    list: () => ipcRenderer.invoke(IPC.CHECKPOINT_LIST),
    rollback: (id: string) => ipcRenderer.invoke(IPC.CHECKPOINT_ROLLBACK, id),
    diff: (id: string) => ipcRenderer.invoke(IPC.CHECKPOINT_DIFF, id),
  },

  snapshots: {
    list: () => ipcRenderer.invoke(IPC.SNAPSHOT_LIST),
    save: (name: string, state: unknown) => ipcRenderer.invoke(IPC.SNAPSHOT_SAVE, name, state),
    delete: (id: string) => ipcRenderer.invoke(IPC.SNAPSHOT_DELETE, id),
  },

  trash: {
    list: () => ipcRenderer.invoke(IPC.TRASH_LIST),
    restore: (id: string) => ipcRenderer.invoke(IPC.TRASH_RESTORE, id),
    delete: (id: string) => ipcRenderer.invoke(IPC.TRASH_DELETE, id),
    empty: () => ipcRenderer.invoke(IPC.TRASH_EMPTY),
  },

  office: {
    print: (filePath: string) => ipcRenderer.invoke(IPC.OFFICE_PRINT, filePath),
    available: () => ipcRenderer.invoke(IPC.OFFICE_AVAILABLE),
    toPdf: (filePath: string) => ipcRenderer.invoke(IPC.OFFICE_TO_PDF, filePath),
    exportPdf: (filePath: string) => ipcRenderer.invoke(IPC.OFFICE_EXPORT_PDF, filePath),
  },

  // Native LibreOfficeKit rendering + editing (Phase 3a).
  lok: {
    available: () => ipcRenderer.invoke(IPC.LOK_AVAILABLE),
    open: (filePath: string) => ipcRenderer.invoke(IPC.LOK_OPEN, filePath),
    newDoc: (ext: string, fileName: string) => ipcRenderer.invoke(IPC.LOK_NEW, ext, fileName),
    tile: (args: { cw: number; ch: number; tx: number; ty: number; tw: number; th: number }) =>
      ipcRenderer.invoke(IPC.LOK_TILE, args),
    tiles: (args: { cw: number; ch: number; tx: number; ty: number; tw: number; th: number }[]) =>
      ipcRenderer.invoke(IPC.LOK_TILES, args),
    partTile: (args: { part: number; cw: number; ch: number; tx: number; ty: number; tw: number; th: number }) =>
      ipcRenderer.invoke(IPC.LOK_PARTTILE, args),
    key: (type: number, charCode: number, keyCode: number) => ipcRenderer.invoke(IPC.LOK_KEY, type, charCode, keyCode),
    mouse: (args: { type: number; x: number; y: number; count: number; buttons: number; modifier: number }) =>
      ipcRenderer.invoke(IPC.LOK_MOUSE, args),
    uno: (command: string) => ipcRenderer.invoke(IPC.LOK_UNO, command),
    insertImage: () => ipcRenderer.invoke(IPC.LOK_INSERTIMAGE),
    imageShape: () => ipcRenderer.invoke(IPC.LOK_IMAGESHAPE),
    pickImage: () => ipcRenderer.invoke(IPC.LOK_PICKIMAGE),
    setBorder: (preset: string, color: number, width: number) => ipcRenderer.invoke(IPC.LOK_SETBORDER, preset, color, width),
    sheetGeometry: () => ipcRenderer.invoke(IPC.LOK_SHEETGEOMETRY),
    setSize: (kind: 'col' | 'row', index: number, size: number) => ipcRenderer.invoke(IPC.LOK_SETSIZE, kind, index, size),
    macro: (name: string, args: string) => ipcRenderer.invoke(IPC.LOK_MACRO, name, args),
    findReplace: (args: {
      mode: 'findnext' | 'findprev' | 'replaceall'
      find: string
      replace?: string
      caseSensitive?: boolean
      wholeWord?: boolean
      regex?: boolean
    }) => ipcRenderer.invoke(IPC.LOK_FINDREPLACE, args),
    setRangeBlock: (args: { sheet: string; cell: string; values: (number | string | null)[][] }) =>
      ipcRenderer.invoke(IPC.LOK_SETRANGEBLOCK, args),
    setTable: (args: {
      macro: 'WosInsertDocTable' | 'WosSetDocTable' | 'WosInsertSlideTable' | 'WosSetSlideTable'
      tag: string
      values: (number | string | null)[][]
    }) => ipcRenderer.invoke(IPC.LOK_SETTABLE, args),
    selInfo: () => ipcRenderer.invoke(IPC.LOK_SELINFO),
    partInfo: () => ipcRenderer.invoke(IPC.LOK_PARTINFO),
    commandValues: (command: string) => ipcRenderer.invoke(IPC.LOK_CMDVALUES, command),
    docStatus: () => ipcRenderer.invoke(IPC.LOK_DOCSTATUS),
    lastShape: () => ipcRenderer.invoke(IPC.LOK_LASTSHAPE),
    transition: (args: string) => ipcRenderer.invoke(IPC.LOK_TRANSITION, args),
    animate: (args: string) => ipcRenderer.invoke(IPC.LOK_ANIMATE, args),
    officeMacro: (name: string, args: string) => ipcRenderer.invoke(IPC.LOK_OFFICEMACRO, name, args),
    getNotes: (index?: number) => ipcRenderer.invoke(IPC.LOK_GETNOTES, { index }),
    setNotes: (index: number, text: string) => ipcRenderer.invoke(IPC.LOK_SETNOTES, { index, text }),
    capture: () => ipcRenderer.invoke(IPC.LOK_CAPTURE),
    buildCaptured: (elements: string[]) => ipcRenderer.invoke(IPC.LOK_BUILDCAPTURED, elements),
    setPart: (n: number) => ipcRenderer.invoke(IPC.LOK_SETPART, n),
    parts: () => ipcRenderer.invoke(IPC.LOK_PARTS),
    save: () => ipcRenderer.invoke(IPC.LOK_SAVE),
    exportAs: (format: string) => ipcRenderer.invoke(IPC.LOK_EXPORT, format),
    slidesSvg: () => ipcRenderer.invoke(IPC.LOK_SLIDESSVG),
    print: (filePath: string) => ipcRenderer.invoke(IPC.LOK_PRINT, filePath),
    fileInfo: () => ipcRenderer.invoke(IPC.LOK_FILEINFO),
    windowPaint: (args: { id: number; w: number; h: number }) => ipcRenderer.invoke(IPC.LOK_WPAINT, args),
    windowMouse: (args: { id: number; type: number; x: number; y: number; count: number; buttons: number; modifier: number }) => ipcRenderer.invoke(IPC.LOK_WMOUSE, args),
    windowKey: (args: { id: number; type: number; charCode: number; keyCode: number }) => ipcRenderer.invoke(IPC.LOK_WKEY, args),
    dialogEvent: (args: { id: number; control: string; cmd: string; type: string; data?: string }) => ipcRenderer.invoke(IPC.LOK_DLGEVENT, args),
    windowClose: (id: number) => ipcRenderer.invoke(IPC.LOK_WCLOSE, id),
    close: () => ipcRenderer.invoke(IPC.LOK_CLOSE),
    onCallback: (callback: (cb: { type: number; payload: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, cb: { type: number; payload: string }) => callback(cb)
      ipcRenderer.on(IPC.LOK_CALLBACK, handler)
      return () => ipcRenderer.removeListener(IPC.LOK_CALLBACK, handler)
    },
  },

  canvas: {
    // Frame→slide bridge v1: ordered PNG buffers → a real .pptx written beside
    // the .wcanvas (image-based, one-way).
    exportPptx: (arg: { targetPath: string; images: { png: Uint8Array; title?: string }[] }) =>
      ipcRenderer.invoke(IPC.CANVAS_EXPORT_PPTX, arg),
    // Frame→live-slide bridge v1: append a NATIVE, editable slide to the OPEN
    // Impress deck from a serialized SlideSpec payload (+ image fallbacks). One-way.
    frameToSlide: (arg: { payload: string; fallbackImages: { png: Uint8Array }[] }) =>
      ipcRenderer.invoke(IPC.CANVAS_FRAME_TO_SLIDE, arg),
  },

  menu: {
    setActions: (items: { id: string; label: string }[]) => ipcRenderer.invoke(IPC.MENU_SET_ACTIONS, items),
    setAgentMenu: (data: { agents: { id: string; label: string }[]; skills: { id: string; label: string }[]; mode: 'full' | 'safe'; activeAgent: string | null }) =>
      ipcRenderer.invoke(IPC.MENU_SET_AGENT_MENU, data),
    setOfficeContext: (data: { type: number | null; parts?: string[] }) => ipcRenderer.invoke(IPC.MENU_SET_OFFICE_CONTEXT, data),
    setOfficeState: (data: { checked: Record<string, boolean>; disabled: string[] }) => ipcRenderer.invoke(IPC.MENU_SET_OFFICE_STATE, data),
    officeCommands: () => ipcRenderer.invoke(IPC.MENU_OFFICE_COMMANDS),
    runAction: (id: string) => ipcRenderer.invoke(IPC.MENU_RUN_ACTION, id),
    // The browser pushes the actions its own panel is showing, so the native
    // menu is the same data rather than a second list. null = left the surface.
    setBrowserContext: (
      data: {
        actions: { id: string; label: string; shortcut?: string; relevance: number }[]
        canGoBack: boolean
        canGoForward: boolean
      } | null,
    ) => ipcRenderer.invoke(IPC.MENU_SET_BROWSER_CONTEXT, data),
    onRunAction: (callback: (actionId: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, actionId: string) => callback(actionId)
      ipcRenderer.on(IPC.MENU_RUN_ACTION, handler)
      return () => ipcRenderer.removeListener(IPC.MENU_RUN_ACTION, handler)
    },
  },

  window: {
    minimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
    style: () => ipcRenderer.invoke(IPC.WINDOW_STYLE),
    setStyle: (style: 'standard' | 'clean') => ipcRenderer.invoke(IPC.WINDOW_SET_STYLE, style),
    relaunch: () => ipcRenderer.invoke(IPC.WINDOW_RELAUNCH),
    openTaskbarSettings: () => ipcRenderer.invoke(IPC.WINDOW_TASKBAR_SETTINGS),
    isMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),
  },

  // Browsing history + bookmarks — ONE store. `search` is full-text over page
  // CONTENT (the reason the index exists); `suggest` is the omnibox's url/title
  // match, which deliberately does NOT search body text, so typing three
  // letters cannot surface every page that mentions the word.
  history: {
    record: (arg: { url: string; title?: string; favicon?: string; text?: string }) =>
      ipcRenderer.invoke(IPC.HISTORY_RECORD, arg),
    search: (query: string, limit?: number) => ipcRenderer.invoke(IPC.HISTORY_SEARCH, { query, limit }),
    suggest: (prefix: string, limit?: number) => ipcRenderer.invoke(IPC.HISTORY_SUGGEST, { prefix, limit }),
    recent: (limit?: number) => ipcRenderer.invoke(IPC.HISTORY_RECENT, { limit }),
    star: (url: string, title?: string, favicon?: string) =>
      ipcRenderer.invoke(IPC.HISTORY_STAR, { url, title, favicon }),
    unstar: (url: string) => ipcRenderer.invoke(IPC.HISTORY_UNSTAR, { url }),
    isStarred: (url: string) => ipcRenderer.invoke(IPC.HISTORY_IS_STARRED, { url }),
    bookmarks: (limit?: number) => ipcRenderer.invoke(IPC.HISTORY_BOOKMARKS, { limit }),
    // Deletion removes the indexed TEXT too, not just the listing.
    forget: (url: string) => ipcRenderer.invoke(IPC.HISTORY_FORGET, { url }),
    forgetSince: (since: number) => ipcRenderer.invoke(IPC.HISTORY_FORGET_SINCE, { since }),
    clear: () => ipcRenderer.invoke(IPC.HISTORY_CLEAR),
  },

  /**
   * Cases — a thread of work that outlives any one agent run: the subject, the
   * documents produced for it, the status, and the notes.
   */
  /** Where the app opens when a test asks for it (WOS_START_ON); null = the person's own setting. */
  startOn: (): Promise<'stage' | null> => ipcRenderer.invoke(IPC.APP_START_ON),
  /** Sub-projects: marked subfolders of the workspace (docs/landscape/PLAN.md §5a). */
  projects: {
    list: (home?: string) => ipcRenderer.invoke(IPC.PROJECTS_LIST, home),
    create: (home: string | undefined, name: string, color?: string) => ipcRenderer.invoke(IPC.PROJECTS_CREATE, home, name, color),
  },
  cases: {
    list: () => ipcRenderer.invoke(IPC.CASES_LIST),
    get: (id: string) => ipcRenderer.invoke(IPC.CASES_GET, id),
    workFolder: (id: string) => ipcRenderer.invoke(IPC.CASES_WORK_FOLDER, id),
    delete: (id: string) => ipcRenderer.invoke(IPC.CASES_DELETE, id),
    promote: (id: string, filePath: string) => ipcRenderer.invoke(IPC.CASES_PROMOTE, id, filePath),
    statuses: (type?: string) => ipcRenderer.invoke(IPC.CASES_STATUSES, type),
    create: (payload: { title: string; type?: string; description?: string; subject?: string; artifacts?: string[] }) =>
      ipcRenderer.invoke(IPC.CASES_CREATE, payload),
    setStatus: (id: string, status: string) => ipcRenderer.invoke(IPC.CASES_SET_STATUS, id, status),
    addNote: (id: string, text: string, author?: 'you' | 'agent') =>
      ipcRenderer.invoke(IPC.CASES_ADD_NOTE, id, text, author),
    addArtifact: (id: string, filePath: string) => ipcRenderer.invoke(IPC.CASES_ADD_ARTIFACT, id, filePath),
    setDescription: (id: string, description: string) => ipcRenderer.invoke(IPC.CASES_SET_DESCRIPTION, id, description),
    markActed: (id: string, signal: unknown) => ipcRenderer.invoke(IPC.CASES_MARK_ACTED, id, signal),
    /** Move a case between "this workspace" and "everywhere" (a file move). */
    setScope: (id: string, scope: 'workspace' | 'global') => ipcRenderer.invoke(IPC.CASES_SET_SCOPE, id, scope),
    terminalStatuses: () => ipcRenderer.invoke(IPC.CASES_TERMINAL),
    /** The whole case as markdown — what an agent is given as context. */
    asContext: (id: string) => ipcRenderer.invoke(IPC.CASES_AS_CONTEXT, id),
    nextStatus: (type: string, current: string) => ipcRenderer.invoke(IPC.CASES_NEXT_STATUS, type, current),
    /** KPIs / chart / table computed from the case's CSV artifacts. */
    insights: (id: string) => ipcRenderer.invoke(IPC.CASES_INSIGHTS, id),
    /** The case's declared curated view (Layer 2), or null. */
    view: (id: string) => ipcRenderer.invoke(IPC.CASES_VIEW, id),
    /** A file:// URL for an artifact (for image thumbnails). */
    artifactUrl: (rel: string) => ipcRenderer.invoke(IPC.CASES_ARTIFACT_URL, rel),
    /** Authorize+resolve a case artifact to an absolute path (opens across workspaces). */
    authorizeArtifact: (id: string, rel: string) => ipcRenderer.invoke(IPC.CASES_AUTHORIZE_ARTIFACT, id, rel),
  },

  browserTabs: {
    /** Main asks the Browser surface to open a url in a NEW tab (WOS-007). */
    onOpenTab: (callback: (payload: { url: string; referrer?: string }) => void) => {
      // Older payload shape was a bare string; normalise so a stale listener
      // and a new sender can never disagree about the argument.
      const handler = (_e: Electron.IpcRendererEvent, payload: unknown) =>
        callback(typeof payload === 'string' ? { url: payload } : (payload as { url: string; referrer?: string })) 
      ipcRenderer.on(IPC.BROWSER_OPEN_TAB, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_OPEN_TAB, handler)
    },
  },

  bugs: {
    status: () => ipcRenderer.invoke(IPC.BUG_STATUS),
    setRepo: (dir: string) => ipcRenderer.invoke(IPC.BUG_SETREPO, dir),
    context: (surface: string | null, openFile: string | null) =>
      ipcRenderer.invoke(IPC.BUG_CONTEXT, surface, openFile),
    analyze: (text: string, surface: string | null, openFile: string | null, kind?: 'bug' | 'idea') =>
      ipcRenderer.invoke(IPC.BUG_ANALYZE, text, surface, openFile, kind),
    file: (text: string, analysis: unknown, context: unknown, kind?: 'bug' | 'idea') =>
      ipcRenderer.invoke(IPC.BUG_FILE, text, analysis, context, kind),
    list: () => ipcRenderer.invoke(IPC.BUG_LIST),
  },

  updater: {
    check: () => ipcRenderer.invoke(IPC.UPDATER_CHECK),
    install: () => ipcRenderer.invoke(IPC.UPDATER_INSTALL),
    onUpdateReady: (callback: (info: { version: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, info: { version: string }) => callback(info)
      ipcRenderer.on(IPC.UPDATER_UPDATE_READY, handler)
      return () => ipcRenderer.removeListener(IPC.UPDATER_UPDATE_READY, handler)
    },
  },
})
