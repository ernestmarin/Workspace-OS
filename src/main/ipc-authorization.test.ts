import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Lote N+1 (P0) — enumeración de autorización por canal IPC (estilo RT-05).
 *
 * Objetivo: todo handler sensible (spawn de procesos, mutación fs, escritura de
 * secretos, habilitación de red) debe llamar a un guard (assertMainFrame /
 * assertWorkspace / validateFilePath). El resto se lista explícitamente como
 * decisión, no por defecto. No se añaden guards a ciegas a handlers sin
 * parámetro de evento (WORKSPACE_DATA_OPERATIONS, cubiertos por el bridge con grant).
 *
 * Esta prueba es estructural, como ipc-surface.test.ts: lee la superficie
 * declarada en ipc-channels.ts y los sitios de registro en src/main, y exige
 * que la clasificación sea exhaustiva y que los sensibles tengan guard.
 *
 * Sensible se define aquí como: cualquier canal cuyo handler deba verificar
 * origen del frame o confinar el filesystem antes de actuar. Tras IPC-TRASH-01 hay 251
 * canales con guard y 170 pendientes de clasificación/autorización adicional;
 * la lista EXPLICITLY_NO_GUARD no demuestra que sean no sensibles.
 * Un nuevo canal que no esté en ninguna lista hace fallar esta
 * prueba — es un recordatorio de clasificar, no un permiso por defecto.
 */

const root = path.resolve(__dirname, '../..')
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8')

// ── Declarados ──────────────────────────────────────────────────────────────
const ipcSource = read('src/main/ipc-channels.ts')
const byName = new Map<string, string>()
const declared = new Map<string, string>()
for (const m of ipcSource.matchAll(/^\s{2}([A-Z_0-9]+):\s*'([^']+)'/gm)) {
  byName.set(m[1], m[2])
  declared.set(m[2], m[1])
}

// ── Registros con snippet ──────────────────────────────────────────────────
function mainSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return mainSources(full)
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return []
    return [full]
  })
}
// Two registration forms reach ipcMain: the `ipcHandle` registry (nearly every
// module) and a bare `ipcMain.handle(IPC.X, …)`. IPC-HIST-01 found `history.ts`
// using the second one for twelve channels, which the first version of this
// scanner never saw — so those channels sat in EXPLICITLY_NO_GUARD and their
// "no guard" was an artefact of the scan, not a decision.
const registrars: RegExp[] = [
  // The registry form, whatever the parameter is called (`ipcMain`, `ipc`, …).
  /ipcHandle\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*IPC\.([A-Z_0-9]+)/g,
  // A bare `ipcMain.handle(IPC.X, …)`.
  /ipcMain\.handle\(\s*\n?\s*IPC\.([A-Z_0-9]+)/g,
]
const channelGuard = new Map<string, boolean>() // channel -> hasGuard in its snippet
// IPC-FS-01: path confinement (`sanitize`, `validateFilePath`) is not an origin
// check, so a channel can be "guarded" and still accept a caller it should have
// refused. This second map records whether the snippet verifies WHO is asking.
const channelOriginGuard = new Map<string, boolean>()
const channelFiles = new Map<string, string[]>()
for (const file of mainSources(path.join(root, 'src/main'))) {
  if (file.endsWith('ipc-surface.test.ts') || file.endsWith('ipc-authorization.test.ts')) continue
  const content = fs.readFileSync(file, 'utf8')
  for (const re of registrars) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const chName = m[1]
      const channel = byName.get(chName) ?? `UNKNOWN:${chName}`
      const start = m.index
      // The snippet ends at the next registration of either form, so one guarded
      // handler cannot make its neighbours look guarded.
      const bounds = [content.indexOf('ipcHandle', start + 10), content.indexOf('ipcMain.handle', start + 10)].filter(
        (i) => i > 0,
      )
      const nextIdx = bounds.length ? Math.min(...bounds) : -1
      const snippet = content.slice(start, nextIdx > 0 ? nextIdx : start + 5000)
      const hasGuard =
        snippet.includes('assertMainFrame') ||
        snippet.includes('assertLokSender') ||
        snippet.includes('assertUpdaterSender') ||
        snippet.includes('assertMainWindowFrame') ||
        snippet.includes('assertWorkspace') ||
        // IPC-SPEECH-02: the speech module's own wrapper. A name is not a guard by
        // itself: `speech/handlers.authorization.test.ts` pins it to
        // `documentFor(assertWorkspace(event))`, and `assertWorkspace` to
        // `assertMainFrame(event)` plus sender/frame identity with `mainWindow()`.
        snippet.includes('assertOwner(') ||
        snippet.includes('validateFilePath') ||
        snippet.includes('validateOpenPath') ||
        snippet.includes('sanitize(') ||
        snippet.includes('sanitizeRead') ||
        snippet.includes('realPathSafe') ||
        snippet.includes('validateSearchQuery') // search scoping counts as guard
      const hasOriginGuard =
        snippet.includes('assertMainWindowFrame') ||
        snippet.includes('assertMainFrame(') ||
        snippet.includes('assertLokSender') ||
        snippet.includes('assertUpdaterSender') ||
        snippet.includes('assertOwner(')
      const prev = channelGuard.get(channel)
      if (prev === undefined) channelGuard.set(channel, hasGuard)
      else channelGuard.set(channel, prev || hasGuard)
      const prevOrigin = channelOriginGuard.get(channel)
      if (prevOrigin === undefined) channelOriginGuard.set(channel, hasOriginGuard)
      else channelOriginGuard.set(channel, prevOrigin || hasOriginGuard)
      const arr = channelFiles.get(channel) ?? []
      arr.push(path.relative(root, file))
      channelFiles.set(channel, arr)
    }
  }
}
// Push channels nunca se registran con ipcHandle (main → renderer)
for (const [ch] of declared) if (!channelGuard.has(ch)) channelGuard.set(ch, false)

// ── Clasificación ──────────────────────────────────────────────────────────
// MUST_HAVE_GUARD: handlers sensibles — proceso, fs mutación, secretos, red.
// Identificados por inspección de la superficie actual: todos los canales cuyo
// snippet contiene un guard hoy. Esta lista es la que la prueba exige que
// MANTENGA el guard; si un nuevo canal sensible aparece, debe añadirse aquí.
const MUST_HAVE_GUARD = new Set<string>([
  // N+1c: owner-bound office handlers
  'canvas:frame-to-slide',
  'lok:animate',
  'lok:available',
  'lok:buildCaptured',
  'lok:capture',
  'lok:close',
  'lok:cmdvalues',
  'lok:dlgevent',
  'lok:docstatus',
  'lok:export',
  'lok:fileinfo',
  'lok:findReplace',
  'lok:getNotes',
  'lok:imageShape',
  'lok:insertImage',
  'lok:key',
  'lok:lastshape',
  'lok:macro',
  'lok:mouse',
  'lok:officeMacro',
  'lok:partinfo',
  'lok:parts',
  'lok:parttile',
  'lok:pickImage',
  'lok:save',
  'lok:selinfo',
  'lok:setNotes',
  'lok:setRangeBlock',
  'lok:setTable',
  'lok:setborder',
  'lok:setpart',
  'lok:setsize',
  'lok:sheetgeometry',
  'lok:slidessvg',
  'lok:tile',
  'lok:tiles',
  'lok:transition',
  'lok:uno',
  'lok:wclose',
  'lok:wkey',
  'lok:wmouse',
  'lok:wpaint',

  // accounts / brand / security
  'accounts:add',
  'accounts:list',
  'accounts:signout',
  'brand:get',
  'brand:set',
  'brand:set-logo',
  // agent / pty / shell / terminal (spawn)
  'agent:cancel',
  'agent:forget-conversation',
  'agent:list-models',
  'agent:pty-input',
  'agent:pty-kill',
  'agent:pty-resize',
  'agent:pty-spawn',
  'agent:run',
  'agent:set-default-model',
  'codex:open-request',
  'codex:respond',
  'codex:set-effort',
  'codex:steer',
  'context:set',
  'shell:input',
  'shell:kill',
  'shell:resize',
  'shell:spawn',
  'terminal:create',
  'terminal:kill',
  'terminal:resize',
  'terminal:write',
  'trash:delete',
  'trash:empty',
  'trash:list',
  'trash:restore',
  'clipboard:read',
  'clipboard:write',
  'updater:check',
  'updater:install',
  // fs (mutación) — confinados vía sanitize/validateFilePath
  // IPC-FS-01: the quick-open walk is a read of every path in the workspace;
  // it now requires the registered main frame like the rest of the surface.
  'fs:list-files',
  'fs:open-folder-dialog',
  'fs:reveal',
  'fs:watch-start',
  'fs:watch-stop',
  'workspace:content-root',
  'workspace:get-root',
  'workspace:write-agent-note',
  'links:backlinks',
  'links:graph',
  'links:outgoing',
  'links:related',
  'links:stubs',
  'office:available',
  'office:export-pdf',
  'office:print',
  'office:to-pdf',
  'search:prioritize',
  'search:start',
  'search:index-status',
  'canvas:export-pptx',
  'fs:create',
  'fs:delete',
  'fs:read-dir',
  'fs:read-file',
  'fs:read-file-bytes',
  'fs:rename',
  'fs:save-copy-dialog',
  'fs:write-file',
  // drive (upload externo)
  'drive:save',
  // lok — file open/create/print (confinados)
  'lok:new',
  'lok:open',
  'lok:print',
  // mcp / secrets / connections (red/secretos)
  'mcp:disable',
  'mcp:enable',
  'mcp:list-connectors',
  'mcp:oauth-connect',
  'mcp:oauth-disconnect',
  'mcp:oauth-status',
  'mcp:status',
  'secret:list',
  'secret:remove',
  'secret:set',
  'secret:status',
  'connections:list',
  'connections:signout',
  // window / notify / routines / runs (privilegio de ventana/notificación)
  'window:is-maximized',
  'window:relaunch',
  'window:set-style',
  'window:style',
  'window:taskbar-settings',
  'notify:prefs',
  'notify:recent',
  'notify:request',
  'notify:set-prefs',
  'routines:delete',
  'routines:describe',
  'routines:list',
  'routines:run-now',
  'routines:save',
  'runs:cancel',
  'runs:enqueue',
  'runs:list',
  'runs:pause',
  'runs:resume',
  // office / canvas
  // search / knowledge (confinados vía validateFilePath/validateSearchQuery)
  'knowledge:read',
  'knowledge:search',
  'links:resolve',
  'search:query',
  'search:symbols',
  // collections / metrics / components / wiki (mutación)
  'collection:refreshForFile',
  'metric:refreshForFile',
  'components:save',
  'wiki:add',
  // speech (mic + engine selection = red + hardware)
  // Nota: la mayoría de speech:* son sensibles pero actualmente solo un subset
  // tiene guard explícito; los que sí lo tienen se listan aquí, el resto está
  // en EXPLICITLY_NO_GUARD como deuda documentada (próximo lote mueve).

  // Lote N+1b — autorización real (assertMainFrame por handler)
  // app
  'app:start-on',
  // apps
  'apps:brief',
  'apps:call',
  'apps:create',
  'apps:duplicate',
  'apps:export',
  'apps:importConfirm',
  'apps:importPick',
  'apps:install',
  'apps:lint',
  'apps:list',
  'apps:load',
  'apps:manifest',
  'apps:reveal',
  'apps:review',
  'apps:templates',
  'apps:test',
  'apps:testsWrite',
  'apps:windowFull',
  // cases
  'cases:add-artifact',
  'cases:add-note',
  'cases:artifact-url',
  'cases:as-context',
  'cases:authorize-artifact',
  'cases:create',
  'cases:delete',
  'cases:get',
  'cases:insights',
  'cases:list',
  'cases:mark-acted',
  'cases:next-status',
  'cases:promote',
  'cases:set-description',
  'cases:set-scope',
  'cases:set-status',
  'cases:statuses',
  'cases:terminal',
  'cases:view',
  'cases:work-folder',
  // calendar
  'calendar:add',
  'calendar:connect-oauth',
  'calendar:create-event',
  'calendar:events',
  'calendar:remove',
  'calendar:remove-event',
  'calendar:set-default-target',
  'calendar:sources',
  'calendar:test',
  'calendar:update',
  'calendar:update-event',
  'calendar:write-targets',
  // mail
  'mail:accounts-add',
  'mail:accounts-add-demo',
  'mail:accounts-list',
  'mail:accounts-remove',
  'mail:accounts-test',
  'mail:attachment-open',
  'mail:attachment-save',
  'mail:autoconfig',
  'mail:cached',
  'mail:classify',
  'mail:contacts',
  'mail:draft-from-file',
  'mail:draft-reply',
  'mail:export-pdf',
  'mail:filing-apply',
  'mail:filing-propose',
  'mail:folder-counts',
  'mail:folder-create',
  'mail:folder-delete',
  'mail:folder-rename',
  'mail:folders',
  'mail:index-stats',
  'mail:live-data',
  'mail:message',
  'mail:messages',
  'mail:move',
  'mail:newsletters:file',
  'mail:newsletters:propose',
  'mail:oauth-configured',
  'mail:oauth-google',
  'mail:oauth-microsoft',
  'mail:oauth-microsoft-configured',
  'mail:oauth-set-client-id',
  'mail:pick-workbook',
  'mail:raw-source',
  'mail:remote-images',
  'mail:rich-assist',
  'mail:rich-build',
  'mail:rich-draft',
  'mail:rules:add',
  'mail:rules:list',
  'mail:rules:remove',
  'mail:rules:reorder',
  'mail:rules:update',
  'mail:save-draft',
  'mail:search',
  'mail:send',
  'mail:send-cancel',
  'mail:send-now',
  'mail:send-queued',
  'mail:set-flagged',
  'mail:set-read',
  'mail:sift',
  'mail:signature-get',
  'mail:signature-set',
  'mail:smtp-test',
  'mail:sync',
  'mail:triage',
  'mail:undo',
  'mail:undo-agent',
  'mail:undoable',
  'mail:watch-start',
  'mail:watch-stop',
  // projects
  'projects:create',
  'projects:list',
  'pdf:annotations:read',
  'pdf:annotations:write',
  'pdf:export',
  'pdf:form:fill',
  'pdf:form:read',
  'pdf:pages:reorder',
  'pdf:pages:rotate',
  'pdf:print',
  'pdf:sign',
  'workspace:close',
  'workspace:open-recent',
  'workspace:recents',
  'drive:connect',
  'drive:connection',
  'drive:disconnect',
  'drive:list',
  'drive:open',
  'drive:search',
  'chat:upload',
  'sessions:load',
  'sessions:save',
  'collection:delete',
  'collection:refreshAll',
  'collectionLink:allLinks',
  'collectionLink:forFile',
  'collectionLink:previewSyncAll',
  'collectionLink:remove',
  'components:delete',
  'components:list',
  'metric:delete',
  'metric:refreshAllFromSource',
  'range:delete',
  'range:refreshAllFromSource',
  'range:refreshForFile',
  'rangeLink:allLinks',
  'rangeLink:forFile',
  'rangeLink:previewSyncAll',
  'rangeLink:remove',
  'transclusion:allLinks',
  'transclusion:forFile',
  'transclusion:previewSyncAll',
  'transclusion:remove',
  'wiki:changes',
  'wiki:check',
  'wiki:sources',
  'wiki:undo',
  // Lote IPC-DIAG-01 — impresión, agentes, checkpoints y snapshots
  'print:document',
  'agents:build',
  'agents:delete',
  'agents:list',
  'agents:read',
  'agents:write',
  'checkpoint:diff',
  'checkpoint:list',
  'checkpoint:rollback',
  'snapshot:delete',
  'snapshot:list',
  'snapshot:save',
  // Lote IPC-BUG-01 — el reporter de bugs lee y escribe el repo de desarrollo
  'bug:analyze',
  'bug:context',
  'bug:file',
  'bug:list',
  'bug:setRepo',
  'bug:status',
  // Lote IPC-MEM-01 — el store de memoria personal del workspace
  'memory:confirm',
  'memory:correct',
  'memory:forget',
  'memory:history',
  'memory:lastTidy',
  'memory:list',
  'memory:meaning',
  'memory:propose',
  'memory:query',
  'memory:recent',
  'memory:remember',
  'memory:search',
  'memory:similar',
  'memory:stats',
  'memory:tidy',
  // Lote IPC-HIST-01 — historial de navegación, marcadores y caché
  'browser:clear-cache',
  'history:record',
  'history:search',
  'history:suggest',
  'history:recent',
  'history:star',
  'history:unstar',
  'history:is-starred',
  'history:bookmarks',
  'history:forget',
  'history:forget-since',
  'history:clear',
  // Lote IPC-BROWSER-02 — drive del navegador invitado y descargas
  'browser:back',
  'browser:clear-consent',
  'browser:click',
  'browser:current',
  'browser:deep-read',
  'browser:dismiss-cookies',
  'browser:downloads',
  'browser:extract',
  'browser:forward',
  'browser:map',
  'browser:navigate',
  'browser:register-tab',
  'browser:screenshot',
  'browser:scroll',
  'browser:set-active-guest',
  'browser:thumbnail',
  'browser:type',
  'browser:unregister-tab',
  'browser:wait-for',
  // Lote IPC-SPEECH-02 — voz, micrófono, STT y secretos. Ya estaban protegidos
  // por assertOwner; este lote lo mide y lo vuelve exigible.
  'speech:cancel-reading',
  'speech:config',
  'speech:key-status',
  'speech:kokoro-install',
  'speech:kokoro-install-cancel',
  'speech:kokoro-install-status',
  'speech:kokoro-prepare',
  'speech:kokoro-status',
  'speech:microphone-authorize',
  'speech:microphone-revoke',
  'speech:model-diagnostics',
  'speech:playback-done',
  'speech:read-clipboard',
  'speech:reply-close',
  'speech:reply-finish',
  'speech:reply-open',
  'speech:reply-reserve',
  'speech:select-engine',
  'speech:set-hotkey',
  'speech:set-key',
  'speech:set-lookahead',
  'speech:speak',
  'speech:status',
  'speech:stt-cancel',
  'speech:stt-status',
  'speech:stt-transcribe',
  'speech:stop',
])

// WORKSPACE_DATA_OPERATIONS — handlers sin evento, cubiertos por bridge con grant
// (src/main/ipc-registry.ts). No requieren assertMainFrame; el bridge valida grant.
const GRANT_CHECKED = new Set<string>([
  'metric:list',
  'metric:create',
  'metric:update',
  'metric:createFromSource',
  'metric:refreshFromSource',
  'transclusion:forMetric',
  'transclusion:add',
  'transclusion:syncAll',
  'range:list',
  'range:createFromSource',
  'range:update',
  'range:refreshFromSource',
  'rangeLink:forRange',
  'rangeLink:add',
  'rangeLink:syncAll',
  'collection:list',
  'collection:createFromSource',
  'collection:update',
  'collection:refresh',
  'collectionLink:forCollection',
  'collectionLink:add',
  'collectionLink:syncAll',
])

// Push channels (main → renderer) — no tienen handler, no invocables
const PUSH_CHANNELS = new Set<string>([
  'agent:activity',
  'agent:artifact',
  'agent:artifacts',
  'agent:assistant-response',
  'agent:assistant-text',
  'agent:done',
  'agent:output',
  'agent:pty-exit',
  'agent:pty-output',
  'agent:run-meta',
  'browser:download',
  'fs:watch-event',
  'mail:new-mail',
  'notify:open',
  'routines:updated',
  'runs:updated',
  'shell:output',
  'speech:event',
  'speech:playback',
  'terminal:data',
  'terminal:exit',
  'apps:test-progress',
  'browser:open-tab',
  'codex:question',
  'lok:callback',
  'updater:update-ready',
  'wiki:changed',
  'workspace:root-changed',
  'agent:action-invoke',
  'agent:action-result',
])

// EXPLICITLY_NO_GUARD — decisión explícita de no requerir guard (deuda documentada)
// Todo canal declarado que no esté en los tres conjuntos anteriores debe estar aquí.
// Añadir un canal nuevo sin clasificar hace fallar la prueba.
const EXPLICITLY_NO_GUARD = new Set<string>([

  // app surfaces — sin guard hoy, deuda P1 (añadir assertMainFrame en lote N+1b)
  // browser
  // bugs / calendar / cases / chat / checkpoint
  // collections / components / drive (parte)
  'drive:local-name',
  // fs (parte no sensible hoy: list/reveal/watch)
  // history / knowledge-links / lok (resto)
  // mail — más de 50 canales, todos sin guard hoy (deuda P0, lote N+1b)
  // memory / menu / metric (parte) / office / pdf / projects / range / search...
  'memory:status',
  'menu:office-commands',
  'menu:run-action',
  'menu:set-actions',
  'menu:set-agent-menu',
  'menu:set-browser-context',
  'menu:set-office-context',
  'menu:set-office-state',
  'skills:list',
  'system:status',
  'wiki:status',
  'window:close',
  'window:maximize',
  'window:minimize',
  // agents / misc
  'agents:capabilities',
])

// IPC-FS-01 — the workspace filesystem surface (src/main/handlers/fs.ts).
const MUST_HAVE_ORIGIN_GUARD = new Set<string>([
  'fs:create',
  'fs:delete',
  'fs:list-files',
  'fs:read-dir',
  'fs:read-file',
  'fs:read-file-bytes',
  'fs:rename',
  'fs:save-copy-dialog',
  'fs:watch-start',
  'fs:watch-stop',
  'fs:write-file',
  'collection:refreshForFile',
  'components:save',
  'drive:save',
  'wiki:add',
  'metric:refreshForFile',
  'pdf:annotations:read',
  'pdf:annotations:write',
  'pdf:export',
  'pdf:form:fill',
  'pdf:form:read',
  'pdf:pages:reorder',
  'pdf:pages:rotate',
  'pdf:print',
  'pdf:sign',
  'workspace:close',
  'workspace:open-recent',
  'workspace:recents',
  'drive:connect',
  'drive:connection',
  'drive:disconnect',
  'drive:list',
  'drive:open',
  'drive:search',
  'chat:upload',
  'sessions:load',
  'sessions:save',
  'collection:delete',
  'collection:refreshAll',
  'collectionLink:allLinks',
  'collectionLink:forFile',
  'collectionLink:previewSyncAll',
  'collectionLink:remove',
  'components:delete',
  'components:list',
  'metric:delete',
  'metric:refreshAllFromSource',
  'range:delete',
  'range:refreshAllFromSource',
  'range:refreshForFile',
  'rangeLink:allLinks',
  'rangeLink:forFile',
  'rangeLink:previewSyncAll',
  'rangeLink:remove',
  'transclusion:allLinks',
  'transclusion:forFile',
  'transclusion:previewSyncAll',
  'transclusion:remove',
  'wiki:changes',
  'wiki:check',
  'wiki:sources',
  'wiki:undo',
  'canvas:export-pptx',
  'office:available',
  'office:export-pdf',
  'office:print',
  'office:to-pdf',
  'knowledge:read',
  'knowledge:search',
  'links:backlinks',
  'links:graph',
  'links:outgoing',
  'links:related',
  'links:resolve',
  'links:stubs',
  'search:index-status',
  'search:prioritize',
  'search:query',
  'search:start',
  'search:symbols',
  'workspace:content-root',
  'workspace:get-root',
  'workspace:write-agent-note',
  // Lote IPC-DIAG-01 — impresión, agentes, checkpoints y snapshots
  'print:document',
  'agents:build',
  'agents:delete',
  'agents:list',
  'agents:read',
  'agents:write',
  'checkpoint:diff',
  'checkpoint:list',
  'checkpoint:rollback',
  'snapshot:delete',
  'snapshot:list',
  'snapshot:save',
  // Lote IPC-BUG-01 — el reporter de bugs lee y escribe el repo de desarrollo
  'bug:analyze',
  'bug:context',
  'bug:file',
  'bug:list',
  'bug:setRepo',
  'bug:status',
  // Lote IPC-MEM-01 — el store de memoria personal del workspace
  'memory:confirm',
  'memory:correct',
  'memory:forget',
  'memory:history',
  'memory:lastTidy',
  'memory:list',
  'memory:meaning',
  'memory:propose',
  'memory:query',
  'memory:recent',
  'memory:remember',
  'memory:search',
  'memory:similar',
  'memory:stats',
  'memory:tidy',
  // Lote IPC-HIST-01 — historial de navegación, marcadores y caché
  'browser:clear-cache',
  'history:record',
  'history:search',
  'history:suggest',
  'history:recent',
  'history:star',
  'history:unstar',
  'history:is-starred',
  'history:bookmarks',
  'history:forget',
  'history:forget-since',
  'history:clear',
  // Lote IPC-BROWSER-02 — drive del navegador invitado y descargas
  'browser:back',
  'browser:clear-consent',
  'browser:click',
  'browser:current',
  'browser:deep-read',
  'browser:dismiss-cookies',
  'browser:downloads',
  'browser:extract',
  'browser:forward',
  'browser:map',
  'browser:navigate',
  'browser:register-tab',
  'browser:screenshot',
  'browser:scroll',
  'browser:set-active-guest',
  'browser:thumbnail',
  'browser:type',
  'browser:unregister-tab',
  'browser:wait-for',
  // Lote IPC-SPEECH-02 — voz, micrófono, STT y secretos. Ya estaban protegidos
  // por assertOwner; este lote lo mide y lo vuelve exigible.
  'speech:cancel-reading',
  'speech:config',
  'speech:key-status',
  'speech:kokoro-install',
  'speech:kokoro-install-cancel',
  'speech:kokoro-install-status',
  'speech:kokoro-prepare',
  'speech:kokoro-status',
  'speech:microphone-authorize',
  'speech:microphone-revoke',
  'speech:model-diagnostics',
  'speech:playback-done',
  'speech:read-clipboard',
  'speech:reply-close',
  'speech:reply-finish',
  'speech:reply-open',
  'speech:reply-reserve',
  'speech:select-engine',
  'speech:set-hotkey',
  'speech:set-key',
  'speech:set-lookahead',
  'speech:speak',
  'speech:status',
  'speech:stt-cancel',
  'speech:stt-status',
  'speech:stt-transcribe',
  'speech:stop',
])

describe('N+1 IPC authorization — exhaustividad y guard', () => {
  it('conoce todos los canales declarados (ninguno por defecto)', () => {
    const allKnown = new Set([...MUST_HAVE_GUARD, ...GRANT_CHECKED, ...PUSH_CHANNELS, ...EXPLICITLY_NO_GUARD])
    expect(allKnown.size).toBe(declared.size)
    const missing = [...declared.keys()].filter((c) => !allKnown.has(c))
    expect(missing, `no clasificados: ${missing.join(', ')}`).toEqual([])
    const extra = [...allKnown].filter((c) => !declared.has(c))
    expect(extra, `clasificados pero no declarados: ${extra.join(', ')}`).toEqual([])
  })

  it('no admite duplicados entre categorías', () => {
    const sets = [MUST_HAVE_GUARD, GRANT_CHECKED, PUSH_CHANNELS, EXPLICITLY_NO_GUARD]
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
      const overlap = [...sets[i]].filter((c) => sets[j].has(c))
      expect(overlap, `solapamiento entre categorías ${i} y ${j}: ${overlap.join(', ')}`).toEqual([])
    }
  })

  it('ninguna categoría repite un canal en su propia lista', () => {
    // Un `Set` oculta sus propios duplicados, así que un canal insertado dos veces
    // por error no cambia el tamaño ni rompe la exhaustividad: el inventario
    // mentiría en silencio. Esta comprobación lee la lista literal de este archivo
    // porque el duplicado sólo existe en el texto.
    const self = read('src/main/ipc-authorization.test.ts')
    for (const name of ['MUST_HAVE_GUARD', 'GRANT_CHECKED', 'PUSH_CHANNELS', 'EXPLICITLY_NO_GUARD', 'MUST_HAVE_ORIGIN_GUARD']) {
      const block = self.slice(self.indexOf(`const ${name} = new Set<string>([`))
      const body = block.slice(0, block.indexOf('])'))
      const entries = [...body.matchAll(/^  '([^']+)',$/gm)].map((m) => m[1])
      const repeated = entries.filter((entry, index) => entries.indexOf(entry) !== index)
      expect(repeated, `${name} repite: ${repeated.join(', ')}`).toEqual([])
    }
  })

  it('extrae los guards por snippet correctamente', () => {
    // Guarda que la extracción no falla en vacío (paridad con ipc-surface.test.ts)
    expect(channelGuard.size).toBeGreaterThan(400)
    expect(declared.size).toBeGreaterThan(400)
  })

  it('todo canal MUST_HAVE_GUARD llama a un guard en su snippet', () => {
    const missing: string[] = []
    for (const ch of MUST_HAVE_GUARD) {
      if (!channelGuard.get(ch)) missing.push(`${ch} (${(channelFiles.get(ch) ?? []).join(', ')})`)
    }
    expect(missing, `sensibles sin guard: ${missing.join('; ')}`).toEqual([])
  })

  it('el filesystem del workspace verifica el emisor, no solo la ruta', () => {
    // These handlers take a renderer-supplied path. Confining the path stops
    // traversal; it does not stop a stale, child or foreign frame from asking.
    // Every one of them must also refuse a caller that is not the registered
    // main window's current main frame.
    for (const ch of MUST_HAVE_ORIGIN_GUARD) {
      expect(declared.has(ch), `${ch} no está declarado`).toBe(true)
      expect(MUST_HAVE_GUARD.has(ch), `${ch} debe seguir en MUST_HAVE_GUARD`).toBe(true)
      expect(
        channelOriginGuard.get(ch),
        `${ch} (${(channelFiles.get(ch) ?? []).join(', ')}) confina la ruta pero no verifica el emisor`,
      ).toBe(true)
    }
  })

  it('GRANT_CHECKED son exactamente WORKSPACE_DATA_OPERATIONS', async () => {
    const { WORKSPACE_DATA_OPERATIONS } = await import('./ipc-registry')
    expect([...GRANT_CHECKED].sort()).toEqual([...WORKSPACE_DATA_OPERATIONS].sort())
  })

  it('PUSH_CHANNELS no tienen handler ipcHandle (son main→renderer)', () => {
    for (const ch of PUSH_CHANNELS) expect(channelGuard.get(ch)).toBe(false)
  })

  it('el escáner ve las dos formas de registro de ipcMain', () => {
    // IPC-HIST-01: `handlers/history.ts` registers with `ipcMain.handle(IPC.X, …)`
    // instead of the `ipcHandle` registry. Until the scanner knew that form, its
    // twelve channels were invisible here and looked unguarded because nobody
    // looked — the difference between a decision and a blind spot.
    for (const ch of ['browser:clear-cache', 'history:clear', 'history:record', 'history:search']) {
      expect(channelFiles.get(ch) ?? [], `${ch} no fue escaneado`).toContain('src/main/handlers/history.ts')
    }
    // And the registry form with a parameter that is not called `ipcMain`
    // (`ipcHandle(ipc, IPC.SPEECH_X, …)` in speech/handlers.ts).
    for (const ch of ['speech:set-key', 'speech:read-clipboard', 'speech:stop']) {
      expect(channelFiles.get(ch) ?? [], `${ch} no fue escaneado`).toContain('src/main/speech/handlers.ts')
    }
    // And every channel that claims a guard must have been seen by the scanner.
    const unseen = [...MUST_HAVE_GUARD].filter((c) => !channelFiles.has(c))
    expect(unseen, `MUST_HAVE_GUARD sin snippet: ${unseen.join(', ')}`).toEqual([])
  })

  it('EXPLICITLY_NO_GUARD no tiene guard — es decisión explícita, no olvido', () => {
    // No exigimos que NO tengan guard, solo que estén listados. Pero si alguno
    // ganara guard en un lote futuro, debe moverse a MUST_HAVE_GUARD.
    // Aquí verificamos que la lista actual refleja la realidad (ninguno tiene guard por snippet).
    const unexpectedGuard = [...EXPLICITLY_NO_GUARD].filter((c) => channelGuard.get(c))
    // Hoy ningún EXPLICITLY_NO_GUARD tiene guard por snippet — si lo ganara,
    // la prueba avisa para reclasificar.
    expect(unexpectedGuard, `ahora con guard, mover a MUST_HAVE_GUARD: ${unexpectedGuard.join(', ')}`).toEqual([])
  })
})
