# Handoff

## Vigente — dos lotes el 2026-11-21: VOX-A2b y IPC-FS-01

1. **[VOX-A2b](voice-a2b-checkpoint-2026-11-21.md)** — transporte de respuesta con ack y duración medida. N2; **sin cablear** (A2c abierto), sin cambio de voz visible.
2. **[IPC-FS-01](ipc-fs-01-checkpoint-2026-11-21.md)** — los ocho handlers del filesystem del workspace verifican al emisor. N2. Inventario medido: **473 = 252 guard + 169 sin guard + 22 grants + 30 push**, más el nuevo `MUST_HAVE_ORIGIN_GUARD` (8). **Quedan 15 canales `MUST_HAVE_GUARD` sin guard de origen** (lista y salvedad metodológica en el checkpoint); siguiente lote natural: `watcher.ts` (`fs:save-copy-dialog` + 8 canales), un módulo por commit.

## Detalle — VOX-A2b: acknowledged response-playback transport · 2026-11-21

Ver [voice-a2b-checkpoint-2026-11-21.md](voice-a2b-checkpoint-2026-11-21.md). Rama `arena/d78637b6-workspace-os`, base `bc643c4` (checkout **grafted**: los SHA históricos del contrato — `863e42e2`, `286e1a6` — no existen en este clon y no se pudieron verificar). Agente local único, autorrevisión Red/Blue **no independiente**. Linux, Node 22.22.3, ABI 127; `npm ci --ignore-scripts` y `rebuild:node` exit 0 sin cambios de lockfile.

- **VOX-A2B-01 (defecto reproducido, corregido).** Un transporte que lanza **sincrónicamente** (el guard de `play` en `handlers.ts` lo hace cuando su documento desaparece) escapaba de `pump()`, se **atribuía falsamente a un desbordamiento de texto**, ponía en cuarentena una respuesta sana y dejaba `inFlight` incrementado para siempre: `whenDrained()` no resolvía nunca. Ahora es un fragmento fallido, contado, sin excepción hacia el llamador.
- **VOX-A2B-02 (defecto reproducido, corregido).** La duración solo se estimaba por longitud de texto; 10 caracteres con 30 s de audio contaban como 400 ms y `maxBufferedDurationMs` no limitaba audio real. Ahora la duración **medida del PCM** sustituye la estimación mientras el audio suena (`hold`, motivo `duration-cap`) y alimenta `spokenDurationMs`.
- **VOX-A2B-03 (frontera inexistente, creada).** `ResponseSpeechScheduler` no tenía ningún transporte productivo ni llamador. Nuevo `src/main/speech/responseTransport.ts`: `finished: true` **solo** con el ack del renderer, un único asentamiento por fragmento, `cancelFragment` con cancelación real y acks tardíos ignorados, `closeAll()` para documento reemplazado y **una sola ranura de playback** (la que tiene `VoicePlayback`). N2 requerido y demostrado contra el `PlaybackBroker` real con PCM sintético.
- **Evidencia:** baseline focal 28/316 exit 0; RED 3 fallos/12 pasan (exit 1); GREEN 16/16; transporte 11/11; matriz de mutación M1–M5 detectada y restaurada; focal final 29/330; ambos tsc 0/0; Vitest completo **352 archivos + 3 omitidos, 4177 tests + 26 omitidos**; build 0; auditorías 35/40 moderate exit 1/1. Delta exacto +1 archivo / +15 tests sobre el baseline heredado (4162+15=4177).
- **Límite honesto:** el comando canónico de ESLint falla aquí en un archivo **preexistente y no modificado** (`lokMacros.ts`, parse error por profundidad de pila del sandbox); con pila ampliada da 0/0 en 1001 archivos. Se registra **FALLIDO — causa entorno**, no como verde.
- **Sin cableado (A2c).** `handlers.ts`/`replies.ts` siguen usando `ReadingController`; el transporte nuevo no es alcanzable desde la app en ejecución: **no hay cambio de comportamiento de voz visible** y no se declara aceptación NIVEL 3, ni audio real, ni dispositivo.
- **Siguiente: A2c** — cablear el transporte al camino de respuestas manteniendo `mode: 'completed'` por defecto, `maxInFlight: RESPONSE_PLAYBACK_SLOTS`, `closeAll()` en `SpeechDocument.invalidate()` y Voice Stop; probar documento reemplazado a mitad de locución, cancelación con asentamiento único y que el camino `ReadingController` no cambie.

## Histórico — post-PR #16: A1d accepted-event boundary + IPC-TRASH-01

Rama `arena/d8da67ce-workspace-os`, base limpia `952775d`. Dos lotes, un agente local, trabajo serial y autorrevisión. Linux Node 22.22.3 / npm 10.9.8 / ABI 127. Dependencias ausentes: ci sin scripts ni audit y rebuild:node con headers locales, exit 0. Sin hardware, GUI, modelos, proveedores ni publicación.

- **IPC-TRASH-01, N2 requerido/demostrado.** TrashView → preload → cuatro handlers. Antes, incluso un emisor ajeno podía vaciar el almacén temporal. Ahora guard compartido de ventana registrada viva + frame actual antes de validar ID o llamar al store. Registro, guard, manifest, snapshots y recuperación reales sobre raíz temporal; identidad Electron y selección de raíz simuladas. 8 rechazos y 1 control de reemplazo/listado/recuperación/borrado/vaciado. Inventario 473 = 251 guard + 170 revisión textual + 22 grants + 30 push. No evalúa concurrencia, autenticidad del manifest, ni renderer principal comprometido.
- **VOX-A1d-EVENT, N1 requerido/demostrado.** El hook reclama run y conversación antes de dispatch. Main crea el epoch por lanzamiento, pasa el owner al adaptador mediante launchRun y lo devuelve en el ack. El sink comprueba frame y vigencia del documento (navegación principal no same-document, crash, destroy); preload filtra esquema y desuscribe. Renderer valida owner/epoch/secuencia desde 1 y limita el buffer pre-ack a 64 eventos/64000 unidades de texto por claim (máximo 8 claims). Antes, el observador opcional recibía el delta sin respuesta abierta o un run-end aparentemente válido antes de comprobar respuestas pendientes. Ahora solo publica transiciones aceptadas; cuarentena notifica onCancel, no al agente. Control válido conserva orden y modo completado. Sin cambio visible de voz: el hook usa OwnedReplies, no conecta onEvent a audio incremental. No se verificó reload en Electron real.
- **Evidencia conjunta:** baseline focal en base 26/26 exit 0. Nuevas pruebas previas al fix + controles: 11 fallos (8 trash, 3 voz), 5 pasan; RED exit 1. GREEN focal 39/39 exit 0. Mutación retrospectiva recuperando solo ambas implementaciones originales: mismos 11 fallos/5 controles, exit 1; restauradas en finally. Estado combinado: ambos tsc, ESLint 0/0, Vitest completo y build exit 0; 351 archivos pasan + 3 omitidos, 4162 tests pasan + 26 omitidos. Auditorías prod/completa exit 1/1 (35/40 moderate, sin high/critical). Tres bundles propios restaurados. Comparación integral previa histórica, no nuevo baseline completo.
- **Siguiente: A2b**, contrato aislado de duración y ack entre scheduler, PlaybackBroker y consumidor VoicePlayback. Encolar no implica entrega y envío no implica reproducción; distinguir ended confirmado de cancel/error. Probar salida lenta, epoch reemplazado, cancelación, ack tardío y drenaje de la última pieza con los componentes de transporte reales y salida sintética; sin conectar aún A2c ni habilitar incremental. Latencia física y consentimiento A3 siguen pendientes.

## Histórico — IPC-SYS-01 · 2026-11-20

**Aceptado: nivel 2 requerido y demostrado**, no nivel 3. Rama `arena/3bd77f1e-workspace-os`, base del lote `a6a0bff`, árbol/índice limpios al iniciar. Agente local único, autorrevisión. `editRouter` usa el bridge de preload; ambos handlers de clipboard antes ignoraban el evento. Ahora comprueban la ventana registrada viva, WebContents exacto y frame principal actual antes de leer, escribir o validar el texto. Sin fallback de entrega, sin excepción para otra ventana principal. Registro y autorización reales, Electron y portapapeles simulados; no se accedió al portapapeles del usuario. No se afirma consentimiento por operación, seguridad de navegación ni cobertura de un renderer comprometido.

| Evidencia (Linux, Node 22.22.3 ABI 127, npm 10.9.8) | Código / exit | Resultado |
|---|---|---|
| Vitest focal `ipc-authorization.test.ts` | base / 0 | 7 pasan; no baseline completo nuevo |
| `handlers/system.clipboard.test.ts` | RED antes del fix / 1 | 17 resoluciones indebidas: 8 emisores por canal y escritura no-texto no autorizada; 1 control pasa |
| Vitest clipboard + inventario + `editRouter` + `officeClipboard` | fix / 0 | 59/59; lectura, escritura Unicode/vacía y negativa no-texto preservadas tras recrear owner |
| Mutación retrospectiva quitando las dos llamadas; restauración en finally | mutado / 1 | mismos 17 fallos, control verde |
| tsc main + renderer; ESLint completo (comandos canónicos) | final restaurado / 0,0,0 | sin diagnósticos, lint 0/0 |
| Vitest completo con 2 workers; npm run build | final / 0,0 | 350 archivos pasan + 3 omitidos; **4149 pasan + 26 omitidos**. +18 pruebas sobre el checkpoint anterior; tres bundles propios restaurados |
| npm audit --omit=dev --json; npm audit --json | final / 1,1 | fallidos, 35/40 moderate; sin high/critical. Sin cambios de paquetes |

Solo `clipboard:read` y `clipboard:write` cambian de conjunto: **473 = 247 guard + 174 pendientes en clasificación textual + 22 grants + 30 push**. `speech:read-clipboard` llama a un `assertOwner` propio: no inferir falta de autorización de su clasificación estructural; revisar aparte. `system:status` no se cambió. Sin instalación/rebuild, push ni servicios persistentes. El resto del inventario y riesgos del checkpoint N+1c y el lifecycle del updater siguen abiertos.

**Próximo candidato IPC-TRASH-01 (P0 integridad):** `handlers/trash.ts`, especialmente `trash:empty` que llama directamente a `trash.empty()` sin evento. Agente local: revisar callers de lista/restauración/borrado/vaciado y contratos de persistencia antes de editar. Exigir fixtures sintéticas, rechazo sin pérdida ni modificación y control legítimo de recuperación; nivel 2, mutación, inventario y gates completos. No tocar papelera real. Parada al completar el ciclo acordado; verificar HEAD, árbol y ABI antes del siguiente lote.

## Histórico — IPC-UPD-01 · 2026-11-20

Base `863e42e` limpia, rama efectiva `arena/3bd77f1e-workspace-os` (no la de la ficha). Checkout shallow: el objeto HEAD identifica `286e1a680dc12afb70433a4196027250a0e15dbe` como segundo padre; no hay objeto padre para recorrerlo. Propietario/único revisor: agente local. Sin subagentes ni mutex global. Un lote por presupuesto conservador; ejecución serial, sin servicios persistentes. Los checkpoints siguientes son históricos.

**Aceptado NIVEL 2 (requerido 2):** `updater:install` podía llegar al reinicio y `updater:check` al chequeo/diálogo sin verificar emisor. Ambos validan primero ventana registrada viva, WebContents exacto y frame principal actual. No se cambió menú, política de instalación, callbacks ni push. `updater.authorization.test.ts` ejecuta registro y autoridad reales con Electron/updater simulados. Por canal: evento ausente, frame null/hijo/obsoleto, owner ajeno/reemplazado, ventana/WebContents destruidos; rechazo sin instalación ni diálogo, control positivo tras reemplazo. RED previo 16 fallos (promesa resuelta) + 2 controles verdes; GREEN focalizado 27/27 incluyendo updater previo e inventario; mutación retrospectiva quitando ambas llamadas 16/2, restaurada en finally y revalidada en suite completa. Inventario 473 = 245 guard + 176 sin guard + 22 grants + 30 push; solo los dos updater cambiaron de conjunto.

| Gate (Linux Node 22.22.3 ABI 127, npm 10.9.8) | Estado de código / exit | Resultado |
|---|---|---|
| npm ci --ignore-scripts --no-audit --no-fund; rebuild:node con nodedir=/usr/local | base / 0,0 | dependencias ausentes; sin cambios de lockfile |
| Vitest focal baseline: ipc-authorization, updater.test | base / 0 | 7 + 2 tests; no baseline completo nuevo |
| tsc --noEmit -p tsconfig.node.json y src/renderer/tsconfig.json | delta final / 0,0 | sin diagnósticos |
| eslint --config config/eslint.config.mjs src --format json | final / 0 | 0 errores, 0 warnings |
| vitest run --config config/vitest.config.ts --maxWorkers=2 | final / 0 | 349 archivos pasan, 3 omitidos; 4131 pasan, 26 omitidos |
| npm run build | final / 0 | tres bundles propios restaurados, no incluidos |
| npm audit --omit=dev --json; npm audit --json | final / 1,1 | 35/40 moderate, sin high/critical; fallidos, no corregidos |

Skips por archivo: recall.eval 1, case-insights 2, platform-tools 6, wiki.live 4, treeWatcher 1, proposals.live 6, chat.live 2, libreoffice.convert 2, lokTemp 2. Comparación integral solo histórica (+18 tests de identidad). Auditorías incluyen cadenas de ExcelJS/uuid, MJML/formatter y tooling de empaquetado; sin migración ni evaluación de compatibilidad nueva. Sin push, PR, descargas separadas, feed, dispositivo ni release. No aceptación NIVEL 3. El registro de autoridad sigue a createWindow; el destino de diálogos/push del updater aún usa la ventana de initUpdater: pendiente de lifecycle, no demostrado por el control de autorización. Navegación/origen y renderer comprometido fuera de alcance.

**Siguiente candidato IPC-SYS-01:** agente local, inspeccionar callers de `handlers/system.ts` empezando por lectura/escritura de clipboard; delimitar antes de editar. Sin datos reales: clipboard simulado, owner/frame reales en registro, rechazo sin lectura/mutación, controles tras recreación; exigir nivel 2, inventario exacto, mutación y mismos gates. Mantener inventario residual del checkpoint N+1c (Office, IPC, voz y demás áreas sin revisar); sin adelantar voz ni sustituir dispositivo por mocks. Reanudar verificando rama, HEAD, árbol y ABI. Misión abierta.

## Checkpoint N+1c — 2026-11-20 (posterior a PR #14)

Ver [lok-authorization-checkpoint-2026-11-20.md](lok-authorization-checkpoint-2026-11-20.md). Rama `arena/d4868d3a-workspace-os`, base `8a9cc7a`. Los 45 handlers de lok.ts exigen owner registrado vivo y su main frame actual; fallback de entrega no concede autoridad. Inventario: 243 con guard, 178 sin guard, 22 grant-checked, 30 push. Gates frescos: tsc main/renderer exit 0, ESLint 0/0, Vitest **4113 passed / 26 skipped**, build exit 0. Auditorías 35/40 moderate (exit 1). Sin aceptación Electron/LOK real ni NIVEL 3, sin push. Ver riesgos de lifecycle/Office, próximos contratos y evidencia RED/GREEN en el checkpoint.

## Checkpoint N+2c — 2026-11-20 (posterior al checkpoint post-N1)

Ver [xlsx-snapshot-checkpoint-2026-11-20.md](xlsx-snapshot-checkpoint-2026-11-20.md). Rama `arena/ac9dd6a7-workspace-os`, base `859f777`. Ambos escritores XLSX validan/parsean el mismo snapshot, con límites acumulados y XML auxiliar cubierto. Gates frescos: tsc main/renderer exit 0, ESLint 0/0, Vitest **3793 passed / 26 skipped**, build exit 0. Auditorías siguen en 35/40 moderate (exit 1). No aceptación NIVEL 3, no push. IPC restante, presupuesto PPTX/ODS y voz siguen pendientes; ver límites y siguiente contrato en el checkpoint.

## Checkpoint actual — 2026-11-20

Ver [post-n1-checkpoint-2026-11-20.md](post-n1-checkpoint-2026-11-20.md) para N+1b/N+2b, evidencia RED/GREEN, commits locales y riesgos abiertos. Rama de esta sesión: `arena/443af82c-workspace-os`; sin push. Gates frescos: tsc node/renderer exit 0, ESLint 0/0, Vitest 3778 passed / 26 skipped, build exit 0. Inventario real: 201 con guard, 220 sin guard, 22 grant-checked, 30 push. No aceptación NIVEL 3. Próxima prioridad: presupuesto global/mismo buffer XLSX o autorización IPC restante; voz sigue pendiente por dependencias. El resto de este documento es histórico.

**Written 2026-08-18 · v0.1.49 · master clean, 0 unpushed · 2373 unit tests green · SSD EJECTED**

---

## Read this first: the typecheck was lying

`npm run typecheck` ran `tsc -p tsconfig.json`, and that config has `files: []`
with only project references — **it checked nothing and exited 0**. It passed on
a codebase with 78 type errors, and it passed on a handler calling a method that
does not exist (`mail:classify` → `readMessage`), which then shipped.

It now runs `scripts/typecheck.mjs`, which checks the real projects
(`tsconfig.node.json` + `src/renderer/tsconfig.json`) and **fails only on
regressions** against `scripts/typecheck-baseline.json`. Printing 75 known
errors on every run would be noise, and noise gets ignored exactly as
thoroughly as a green tick that means nothing.

```bash
npm run typecheck              # fails only on NEW errors
npm run typecheck -- --accept  # ratchet the baseline (should only go DOWN)
```

The 75 are real and worth chipping at — mostly test files with untyped `vi.fn`
mocks. **Do not run `--accept` to make a red run go green.**

## Second: the SSD

The LibreOffice engine lives on an external SSD, **ejected at the end of this
session** — both the disk image and the physical drive. The installed app
bundles its own engine (656 MB), so documents open and edit with no SSD
attached; `npm run ship`, `dist:mac`, and every `e2e:office` / `e2e:lok*` suite
need it back.

```bash
hdiutil attach "/Volumes/Extreme SSD/LOBuild.sparseimage"
ls /Volumes/LOBuild/core/instdir/LibreOffice.app/Contents   # sanity check
```

**Native ABI is on NODE.** `npm test` works as-is; `npm run rebuild:electron`
before any Playwright probe, then `npm run rebuild:node` after.

---

## What landed this session (v0.1.39 → v0.1.49)

| | |
|---|---|
| **Cases** | A description, a stage row, and an **Ask** box that hands the whole case to an agent with any instruction |
| **Calendar** | Events go to **iCloud**, and iCloud sends the invitations |
| **Cockpit** | The **Head-of** altitude runs on real cases — no longer mock |
| **Mail** | Mail is sorted by what it **is**; newsletters stop reaching the cockpit |
| **Fix** | A workspace-relative path resolved against `process.cwd()` — PDFs would not open |
| **Browser** | Google sign-in is refused BY POLICY; the browser now explains it instead of looking broken |
| **Drive** | Google Drive over the API, connected through the system browser — engine + IPC, no UI yet |

---

## Google sign-in, and what it means for platform integrations

Google refuses sign-in for browsers "in eine andere Anwendung eingebettet" and
ones "durch Software-Automatisierung ... gesteuert" — both describe this app and
the agent driving it. Their instruction to developers is to move to
browser-based OAuth.

A Chrome identity was built, measured working (header AND
`navigator.userAgentData`, via a CDP override) and then **removed** — a feature
that works until Google decides otherwise is not a feature. `brandList` is now
the one place the identity is defined, with tests pinning it honest.

**This does not block Workspace / SharePoint integrations.** Those need a
TOKEN, not a browser cookie, and the sanctioned flow — system browser, loopback,
PKCE — already existed here for mail and calendar. `src/main/handlers/drive.ts`
calls the same `runGoogleOAuthFlow` with Drive scopes.

### Drive: what is done, and the one thing blocking it

Done: the REST client (list/search/get/download/export/update), the account
store (token in the keychain, never on disk), and the IPC. Files are fetched
into `<workspace>/Drive` so the canvas, office engine and agent see ordinary
files.

**BLOCKED: no Google client id is configured, and none is shipped**, so no
Google OAuth path can run — including the existing mail one. Register a Desktop
app client at console.cloud.google.com, enable the Drive API, paste the id.
Until then the Drive code is unverified against a real account.

**`drive.file` cannot browse** — only files the app created, or ones from
Google's Picker, which needs a signed-in Google session in a browser. Browsing
needs `drive.readonly`, a sensitive scope whose refresh token expires ~weekly
until the app passes Google review. The scope is a parameter, not a constant.

No UI yet: nothing in Settings or the Files panel calls any of it.

---

## Mail: classification, rules, and the sweep

The cockpit was full of newsletters because "is this bulk?" was one bit off
`List-Unsubscribe`, which is wrong in both directions at once: GitHub sends that
header on every notification, and plenty of marketing mail carries neither
header and puts the link in the body.

Now: **personal / notification / newsletter**, from list headers, a body
unsubscribe link, a machine sender, and whether the subject reads like a
campaign. Triage gates on "a person wrote it". Three categories on purpose —
every extra one is another folder that is sometimes wrong.

- **Rules override everything** (`mail-rules.json` in userData). They ASSIGN a
  category rather than forbidding one; first match wins, so order is the
  person's. A rule with nothing to match on is refused.
- **Correct it where you read it** — the reader shows the verdict and why, with
  one button that writes a rule on the sender's *domain*.
- **The sweep proposes, never moves** — the Newsletters button in the mail
  toolbar. It refuses to touch notifications, and counts what the index has not
  looked at rather than quietly proposing less.
- The index stores the three **signals**, not the verdict: a verdict computed
  under old rules would be wrong the moment a rule is written.

### NOT verified — do this first

**No newsletter has been observed actually moving.** `createFolder` has no demo
branch and dials IMAP, so the demo mailbox cannot exercise filing at all. This
hole **predates this session** and the existing agentic-filing feature has it
too. Note that pressing Newsletters on the real account first reads up to 150
messages per press — with a large mailbox it takes a few presses before a
proposal appears at all. Two ways forward:

1. Click "File them" on the real account once — 30 seconds, and it settles it.
2. Give `DemoBackend` `createFolder` + `moveMessage` and branch the service to
   them. Worth doing regardless: it makes both filing features testable without
   credentials, which is the whole point of the demo mailbox.

**The banner and the reader verdict have never been rendered.** A Playwright
probe has no secure credential storage, so the panel never loads a folder. They
typecheck and mirror the existing proposal panel — but nobody has seen them.

---

## Cases

`<workspace>/Cases/<slug>.md`. New this session:

- **A description** — a title says what something is *called*, a status says
  where it *stands*; neither says what it was. Agents are told to write one.
- **Offers live on the case**, derived from its notes minus an `acted` list, so
  they survive a restart and appear for notes an *agent* wrote. They were React
  state, which is why a case could sit there asking for nothing.
- **An Ask box** — any instruction, carrying the whole case. The three fixed
  offers are shortcuts to it.
- **`system` notes** — the app's own bookkeeping ("Status → interview") is no
  longer read as a request. It was firing the prep offer on the *name of a
  stage*.
- Dates parse the way they are written here: `25.08.2026 at 14:00`, `um 14 Uhr`,
  am/pm. A day with no time gets 09:00 and says so.

**Your workspace has no cases.** `<workspace>/Cases/` does not exist —
the cockpit is empty because nothing has opened one, not because it is broken.

---

## Calendar

Events go to a connected CalDAV calendar and **the server sends the
invitations** — iCloud already renders properly in Outlook and Gmail, collects
RSVPs and handles reschedules.

- The organizer address is **fetched** from `calendar-user-address-set`, never
  guessed from the username. A guessed organizer is *accepted* and then invites
  nobody, which is indistinguishable from success. With attendees and no
  discoverable address, the write is refused.
- One writable calendar → used and remembered silently. Several → asked inline
  before anything is written. **Clemens has 8 enabled**, so he will be asked
  once.
- Read-only collections never appear; a remembered calendar that has gone asks
  again rather than silently writing elsewhere.

**Open:** nothing supplies attendee addresses yet. The plumbing carries them,
but a note saying "meeting with Anna Weber" has no address, and I deliberately
did not scrape addresses out of note text — sending an invitation is outward and
irreversible.

---

## Cockpit

**Head-of is real.** Cases laid out as a river through their own status
vocabulary, with **exactly one warm stage** — earned by an unanswered offer or
ten days of silence, never by a stage's name. Clicking a case flies down to
Team-lead with it open.

**CEO is still mock** and keeps its Preview pill. Decided: keep the role labels,
feed them real data. Order agreed for the rest:

1. **Stream** — the merged timeline (case notes, runs, mail, calendar, file
   changes). The only view that survives your absence, and it works today
   without needing cases to pile up.
2. **CEO / Everything** — all cases by area, stalled ones warm. Needs volume.
3. **Map** — case-centred; real edges exist (`links:graph`, transclusion). Last,
   and the highest risk of being decoration.

---

## The lesson this session kept teaching

Every bug found today was found by **looking at the artefact, not the screen**:

- The case card looked right; the *file* said `subject: status: drafted` — an
  empty frontmatter field was eating the next line, because `\s` matches a
  newline.
- The flow view looked right; ALPLA claimed to have "asked for something", and
  the note was the app's own `Status → interview`.
- Triage looked right; the classifier had one bit where it needed four.
- `typecheck` said ok; it was checking nothing.

Two probes passed against deliberately broken builds before I trusted them.
Keep doing that — see `wos-run-the-negative-case`.
