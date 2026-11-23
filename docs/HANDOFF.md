# Handoff

## Vigente — IPC-INV-01 · 2026-11-23

Ver [ipc-inv-01-checkpoint-2026-11-23.md](ipc-inv-01-checkpoint-2026-11-23.md). Rama `arena/0b84f054-workspace-os`, base `a74ce24` (= `origin/master`; checkout **shallow**, 1 commit visible al entrar).

- El inventario IPC ya es bidireccionalmente falsable: cada uno de los **473** canales declarados debe estar clasificado exactamente una vez como 443 invoke, **29 push** o 1 respuesta fire-and-forget.
- RED confirmó que `agent:action-invoke` era el único hueco; GREEN y M1 prueban que el nuevo control lo detecta. Suite completa: 385+3 ficheros, **5077+26 tests**.
- Aceptación NIVEL 1 para inventario estático. No se auditó runtime IPC. La cifra heredada de 178 canales sin guard está obsoleta: el código vigente fija **405 guarded + 16 no-guard deliberados + 22 grants + 30 push = 473**, y los 16 tienen decisión B documentada; A3 no tiene hoy un módulo pendiente demostrado.
- Sin autorización para push/PR/merge/release ni para `.github/`; A4 sigue bloqueado. B1 sigue bloqueado por la decisión de modo por defecto. El siguiente lote debe seleccionarse entre B3/B4 o A6 tras contrato propio.

## Anterior — VOX-REACH-04 · 2026-11-22

Ver [voice-reach-04-checkpoint-2026-11-22.md](voice-reach-04-checkpoint-2026-11-22.md). Rama `arena/bb4b35b3-workspace-os`, base `9ace1f5` (merge de PR #25; checkout **shallow**, 1 commit visible).

- **La mitad agente → usuario ya es alcanzable.** `OwnedReplies` sólo la instanciaba `useAgentSession.ts:142`, que sólo usa el `TerminalSession` huérfano, que sólo renderiza `AgentTerminal.tsx`, al que **no importa nadie**. El recorrido de imports lo confirma: 449 ficheros alcanzables desde `App.tsx` y `ownedReplies.ts` fuera. Ahora el panel real (`TerminalAgentPane`) aloja el lector con un control **Read replies** / **■ Stop reply audio**, opt-in por pestaña.
- **Se ata al ciclo de vida de runs de `lib/sessions`, no a `useAgentSession`.** `sessionStore` es el único motor que arranca runs para Chat, las tarjetas del landscape y las pestañas del terminal, y ya posee la atribución `runId → sessionId`; por eso publica `onReplyEvents` (`begin | text | finish | cancel`, cada uno con el `sessionId` dueño) y el panel filtra por el suyo. El diálogo de consentimiento, el snapshot congelado y la reserva por pestaña quedan **exactamente** como los impone `src/main/speech/handlers.ts`.
- **Regla de fuente única — y el defecto que mi primera implementación tenía.** Main emite la respuesta claude por **dos** canales desde la misma línea parseada (`launchRun.ts:391-399`), así que escuchar los dos la lee dos veces. El store reclama un `ResponseStreamConsumer` por run y suprime el canal aplanado en los runs con `responseOwner` reconocido, con fallback limpio si main no lo devuelve. **Mi primera versión borraba la marca en el evento terminal y mi propio test la cazó:** `run-end` cierra la *respuesta*, no el *run*, así que el duplicado llegaba justo después. La marca ahora vive lo que vive el run (M1).
- Evidencia: RED 19/2 con las tres razones correctas (módulo inalcanzable, `onReplyEvents` inexistente, control ausente); GREEN 24 ficheros/186 tests; suite completa **385 + 3 ficheros, 5076 + 26 tests, 0 fallos** (delta exacto **+2 ficheros / +21 tests** sobre los 383/5055 reproducidos antes de tocar nada); **M1–M7 detectadas**, cada una por su propio test (1 failed / 27 passed) y restauradas con md5 verificado; tsc 0/0; `npm run typecheck` limpio contra baseline 0; build 0 sin `INEFFECTIVE_DYNAMIC_IMPORT`; NUL = 1; tres bundles `resources/wos-*/**.cjs` restaurados.
- **Dos defectos de mi propio harness, registrados:** limpiar el bus de listeners entre tests dejaba al segundo sin suscriptores (el flag `started` es estado de módulo) → `vi.resetModules()` + import fresco; y `start()` lee el root asíncrono y `load(null)` resetea la lista de sesiones, así que una sesión creada demasiado pronto se borraba a mitad del test → se deja asentar en `beforeEach`. Ambos habrían producido tests verdes por la razón equivocada.
- **ESLint canónico: FALLIDO — CAUSA ENTORNO, no verde.** `src/main/office/lokMacros.ts` (~187 KB, sin tocar: `git status --porcelain` vacío) desborda la pila del proceso en este sandbox. Con `node --stack-size=20000 ./node_modules/eslint/bin/eslint.js …` el mismo config da **1038 ficheros, 0 errores, 0 warnings**; los 6 ficheros de este lote pasan limpios también con el comando canónico.
- **Gap honesto:** nada se ha **oído** — sin Electron, sin micrófono, sin motor TTS ejecutado, sin latencia medida. El ciclo de vida del lease se prueba contra el contrato del preload, no contra una ventana real. `AgentTerminal.tsx` sigue huérfano (borrarlo es una limpieza aparte y deliberada). El test de alcanzabilidad recorre imports, no renderizado. **NIVEL 2**, sin NIVEL 3.
- Pendiente: **A3a/A3b** (consentimiento incremental, requiere decisión de producto), **A5a/A5b**, **A6a/A6c**, **A7a/A7b**, un workflow de CI en `pull_request` (requiere autorización explícita para `.github/`), **revisión independiente** y **NIVEL 3**.

## Anterior — VOX-REACH-01 · 2026-11-22

Ver [voice-reach-01-checkpoint-2026-11-22.md](voice-reach-01-checkpoint-2026-11-22.md). Rama `arena/8ad6e0c0-workspace-os`, base `c5ea024` (merge de PR #24; checkout **grafted**, sin historial que recorrer).

- **La conversación por voz no existía en la app enviada.** `VoiceDictation.tsx` (push-to-talk, Whisper local, 9 idiomas, modo dictado/comando) sólo la importa `TerminalSession.tsx`; a `TerminalSession.tsx` sólo la importa `AgentTerminal.tsx`; y a `AgentTerminal.tsx` **no la importa nadie**. El shell landscape eliminó el layout clásico que la montaba (2 oct 2026, `docs/landscape/PROGRESS.md:95`: "AgentTerminal … stays for now … removing it is a separate clean-up") y nadie reconcilió la consecuencia con los tres incrementos de voz construidos encima. El recorrido que sí se renderiza es `TerminalDock` → `TerminalAgentPane` → `lib/sessions` + `PromptBar`, y no mencionaba la voz.
- **Todos los tests de voz estaban verdes y no probaban eso.** Cada suite monta su componente directamente. `docs/technical-debt-audit.md:104` dice de VOX-U2/U3 **IMPLEMENTED & RENDERER-VERIFIED**: cierto del componente, falso del producto. El nuevo `src/voice-reachability.test.ts` recorre el grafo de imports desde `App.tsx` (441 ficheros) y falla si una superficie de voz queda huérfana; lleva su propio control de cordura (`VoicePlayback.tsx`) para que un recorrido vacío no pase.
- **Segundo defecto, dentro del componente inalcanzable:** `interfaceCommandActions` nunca lo pasaba ningún llamador real, así que 3 de los 5 comandos reconocidos (`show-files`, `show-browser`, `show-voice-settings`) no tenían acción. La tarjeta ofrecía **Confirmar comando**, `confirm()` devolvía `false`, el llamador descartaba el retorno y ocultaba la tarjeta: un no-op silencioso idéntico a un éxito. Ahora un comando que la superficie no puede ejecutar **no se propone** (`available` opcional en la gramática y en el controlador); `show-voice-settings` queda fuera porque el dock no llega a Ajustes.
- **Lo montado:** `VoiceDictation` + la tarjeta de confirmación en `TerminalAgentPane`, con `active` enhebrado como ya hacía el panel de shell (sin él, una pestaña oculta podía retener micrófono y propuesta). El dictado cae en el borrador del `PromptBar` y se consume de inmediato: Enter/Enviar sigue siendo la única vía al agente. Un comando confirmado ejecuta una acción reversible por los primitivos existentes (`wos:open-rail`, foco del composer); el reconocimiento no es acción, ni prompt, ni grant, ni aprobación.
- **Plan corregido con evidencia (VOX-A2C-01):** la receta A2c del checkpoint A2b ("scheduler con `mode: 'completed'` cableado al camino de respuestas") **no es implementable sin regresión**. El modo completado emite la respuesta entera como **un** fragmento (`responseScheduler.ts` → `enqueueSentence(full, true)`), y el contrato admite 20 000 caracteres (`shared/speech/replies.ts:4`) que la vía productiva pagina a 1200 y parte en el límite OpenAI de 4096 UTF-16 (`reading.ts:117`). Además `ReadingController` ya es estrictamente serial y ya espera el ack del `PlaybackBroker`; lo único que el transporte aporta de verdad es la **duración medida**. El par scheduler+transporte sigue vigente, pero para **A3b** (incremental, con consentimiento A3a), donde cada envío es una frase acotada.
- Evidencia: RED 6/1; GREEN 29 ficheros/330 tests; M1–M6 detectadas y restauradas; tsc 0/0 (el de renderer cazó un `TS2307` de mi propio cambio que vitest no veía: los `import type` se borran); ESLint **0/0 sobre 1036 ficheros** con el comando canónico; suite completa **383 ficheros + 3 omitidos, 5055 tests + 26 omitidos** (delta exacto +3 ficheros / +12 tests sobre los 380/5043 del checkpoint anterior); build 0 sin `INEFFECTIVE_DYNAMIC_IMPORT`, tres bundles propios restaurados; auditorías 35/40 moderate, 0 high/critical. `rebuild:node` era **necesario**, no opcional: antes de él fallaban **268 tests en 15 ficheros**, todos consumidores de `better-sqlite3`.
- **Gap honesto:** la mitad **agente → usuario** sigue sin montarse — `OwnedReplies` vive en `useAgentSession`, que sólo usa el `TerminalSession` huérfano. Y nada de esto se ha visto en un Electron real: sin micrófono, sin modelo Whisper, sin audio, y la navegación por `wos:open-rail` desde un comando de voz nunca se ha observado en la app corriendo. **NIVEL 2**, sin NIVEL 3.
- Pendiente: **VOX-REACH-04** (lector de respuestas alcanzable desde el panel real, condiciones de entrada en el checkpoint), **A3a/A3b**, **A5a**, **A6a/A6c**, **A7a/A7b**, **revisión independiente** y **NIVEL 3**.

## Anterior — IPC-DIALOG-PARENT-01 · 2026-11-21

Ver [ipc-dialog-parent-01-checkpoint-2026-11-21.md](ipc-dialog-parent-01-checkpoint-2026-11-21.md). Rama `arena/a1399b23-workspace-os`, base `826081c` (merge de PR #23).

- **WATCH-02 y OFFICE-02 no eran hipótesis: eran el mismo defecto.** `registerWatcherHandlers(ipcMain, win)` y `registerOfficeHandlers(ipcMain, win)` guardaban la ventana del registro y parentaban sus diálogos nativos a ella para siempre. Tras un reemplazo de ventana (macOS `activate` → `createWindow()`), el padre está destruido, Electron lanza "Object has been destroyed" y el selector que el usuario pidió nunca aparece. La app ya había resuelto esto para los **envíos** (`main-window.ts` resuelve la ventana viva en el momento del envío y documenta exactamente este fallo); los diálogos se quedaron atrás — un arreglo aplicado a una forma de llamada y no a su hermana.
- **Dos módulos más tenían la misma forma:** `lok.ts` (tres selectores de imagen con `showOpenDialog(win, …)`) y `apps.ts` (cuatro diálogos, con una resolución manual `getFocusedWindow() ?? getAllWindows()[0]` que era correcta pero una segunda regla no escrita). Los cuatro módulos pasan ahora por `dialogParent()` de `main-window.ts`.
- **Cuando no hay ventana viva, el guard rechaza antes de abrir nada**: la autorización no hereda el fallback de entrega, así que la rama sin padre es defensiva, no alcanzable por IPC. Lo escribí al revés en el primer test y el guard me corrigió — queda registrado.
- **El control es mecánico, no recordado:** `dialog-parent-wiring.test.ts` barre cada `dialog.show(Open|Save)Dialog(` de `src/main` y falla si el primer argumento es un identificador capturado; comprueba también que ve ≥10 sitios y que el helper nunca devuelve una ventana destruida. M67 (un sitio capturado nuevo en `lok.ts`, módulo sin test de comportamiento de diálogo) lo caza.
- Evidencia: RED 3/3 en watcher (dos por el padre capturado, uno por mi expectativa errónea), GREEN 3/3 y 2/2; M66 (reintroducir el código original en office), M67 y M68 (revertir watcher) detectadas; 66 tests entre los ficheros tocados; suite completa **380 archivos + 3 omitidos, 5043 tests + 26 omitidos**; tsc 0 (nodo y renderer); ESLint 0 sobre 1033 ficheros; build 0.
- **Gap honesto:** el diálogo está mockeado y la ventana es un objeto simulado — se prueba el argumento (que es lo que Electron rechaza cuando está destruido), no que el sistema muestre un sheet bien colocado. **NIVEL 2**, sin NIVEL 3.
- Pendiente: **WORKSPACE-03** (decisión de capacidad, requiere llamada explícita), el resto del roadmap de voz (A2c/A3a, requiere decisión de producto), **revisión independiente** y **NIVEL 3**.

## Anterior — IPC-SEARCH-02 · 2026-11-21

Ver [ipc-search-02-checkpoint-2026-11-21.md](ipc-search-02-checkpoint-2026-11-21.md). Rama `arena/a1399b23-workspace-os`, base `826081c` (merge de PR #23).

- **SEARCH-02 se cierra sin defecto, con evidencia.** La nota de IPC-SEARCH-01 decía que la apertura perezosa de `search-index.db` era inocua "porque el guard corre antes". Verificado contra el código: los **trece** canales de `search.ts` llaman a `assertMainWindowFrame(event)` como primera sentencia, antes de `ensureIndex()`, `getWorkspaceRoot()`, `validateFilePath()` o cualquier llamada al sistema de ficheros. No hay camino no autenticado a la base de datos, así que no hay nada que arreglar y la apertura perezosa se queda.
- **Lo que la nota no vio: había escrito el control en prosa.** "El guard corre antes" es una afirmación de **orden**, y los tests de IPC-SEARCH-01 afirman **presencia**: siguen verdes si alguien baja el guard una línea, porque un llamador legítimo no nota nada. Es el mismo punto ciego que dejó pasar IPC-ZIP-INDEX-01 esa misma noche.
- Por eso el producto del lote es `search.guard-order.test.ts` (4 tests): el guard es la primera sentencia de cada handler, precede a todo efecto lateral (`ensureIndex(`, `getWorkspaceRoot(`, `fs.`/`fsSync.`, `validateFilePath(`), y el parser comprueba que de verdad ha casado ≥13 bloques. **M64 (bajar el guard una línea) rompe sólo este test**: los 13 escenarios de comportamiento y los controles del owner siguen verdes.
- Es un invariante **de fuente y lo dice**: prueba el orden en el bloque de registro, no el comportamiento en ejecución. El comportamiento sigue en `search.authorization.test.ts` (58 tests entre los dos ficheros).
- Registrado también el primer intento fallido (13 "infractores" que eran un error de mi parser, no del producto): la diferencia entre "13 handlers roto" y "mi parser roto" decide si un lote reporta un defecto o un error propio.
- Evidencia: GREEN 4/4 y 58/58, M64/M65 detectadas; suite completa **377 archivos + 3 omitidos, 5034 tests + 26 omitidos**; tsc 0 (nodo y renderer); ESLint 0 sobre 1030 ficheros; build 0.
- Pendiente: **WORKSPACE-03** (decisión de capacidad, requiere llamada explícita), los ciclos de vida `WATCH-02`/`OFFICE-02`, **revisión independiente** y **NIVEL 3**.

## Anterior — IPC-ZIP-INDEX-01/02 · 2026-11-21

Ver [ipc-zip-index-checkpoint-2026-11-21.md](ipc-zip-index-checkpoint-2026-11-21.md). Rama `arena/a1399b23-workspace-os`, base `826081c` (merge de PR #23).

- **El riesgo del índice ZIP era una cuestión de orden, no de umbral.** `loadValidatedXlsx` llamaba a `JSZip.loadAsync` y **después** comparaba `entries.length`: la librería ya había construido un objeto por registro, así que el recuento se comprobaba cuando ya no prevenía nada. El presupuesto acotaba la inflación y dejaba libre la indexación. Nuevo `src/main/zip-directory.ts` (`readZipDirectory`): lee el End Of Central Directory antes de entregar los bytes a ninguna librería, localiza el registro por la regla de la longitud de comentario (no por "la última firma", que un comentario puede falsificar), resuelve los contadores saturados por el registro ZIP64 y rechaza multi-disco en vez de adivinar.
- **El test que lo demuestra discrimina la razón, no el rechazo:** unos cientos de bytes que declaran 60 000 entradas responden `not-valid-xlsx` si la librería corre primero y `sheet-too-large` si el chequeo va antes. Un test que sólo afirme "se rechaza" pasa en los dos órdenes — así sobrevivió el defecto a la revisión anterior.
- **La misma falta en docx/pptx, esta vez sin umbral ninguno:** los cinco writers entregaban el paquete a `JSZip.loadAsync` sin límite de entradas (60 000 registros son ~3 MB, dentro de todas las puertas existentes). Ahora comprueban `MAX_OOXML_ENTRIES` (4096) antes de cargar, con `document-too-large` / `slide-too-large` y el fichero intacto.
- Evidencia: RED en el discriminador y en el caso docx; GREEN 10/10 y 41/41 en los ficheros tocados; M59/M60/M61 (orden, ZIP64, regla del comentario) y M62/M63 (quitar el tope en docx-cards y el pre-check en pptx-table) detectadas; suite completa **376 archivos + 3 omitidos, 5030 tests + 26 omitidos**; tsc 0 (nodo y renderer); ESLint 0 sobre 1029 ficheros; build 0; `npm audit` 40 moderadas / 0 altas / 0 críticas.
- **Gap honesto de este lote:** el orden se prueba por la razón de rechazo, no midiendo heap (NIVEL 2). Un archivo que mienta a la baja (declare 3, contenga 60 000) sigue llegando a la librería y lo caza el chequeo posterior, ya después de la reserva: cerrarlo exige un lector en streaming, no un parche.
- Pendiente, por orden: **revisión independiente** de la serie, **NIVEL 3**, **WORKSPACE-03** (decisión de capacidad, no defecto) y los ciclos de vida `WATCH-02`/`OFFICE-02`.

## Anterior — IPC-DRIVE-03 · IPC-UPLOAD-01 · IPC-DOC-WRITE-01 · IPC-DOC-WRITE-02 · 2026-11-21

Ver [ipc-drive-03-checkpoint-2026-11-21.md](ipc-drive-03-checkpoint-2026-11-21.md), [ipc-upload-01-checkpoint-2026-11-21.md](ipc-upload-01-checkpoint-2026-11-21.md) e [ipc-doc-write-01-checkpoint-2026-11-21.md](ipc-doc-write-01-checkpoint-2026-11-21.md). Plan en [ipc-class-01-triage.md](ipc-class-01-triage.md). Rama `arena/f72b6745-workspace-os`, base `19441e0` (merge de PR #22).

Tres lotes del backlog de datos/recursos, cada uno con su RED, su GREEN y sus mutaciones. La serie de guards de emisor está cerrada (`MUST_HAVE_ORIGIN_GUARD` = 174, verdict-A = 0); lo que quedaba eran fallos que **no son de autorización** y por eso ninguna de las trece tandas anteriores los había tocado.

- **IPC-DRIVE-03 · pérdida de datos silenciosa.** `drive:open` escribía en `path.join(dir, path.basename(filename))`: el nombre remoto decidía la ruta local y nada más. Un Drive con `report.docx` en dos carpetas dejaba **un** fichero, y el canvas/office tenían esa ruta abierta. "Siempre sufijo" habría sido regresión (reabrir el mismo fichero debe refrescar *esa* copia), así que hacía falta el id: nuevo `DriveCopyIndex` (`<workspace>/.workspace-os/drive-copies.json`, 500 entradas, escritura atómica, índice corrupto = vacío) y reutilización sólo si la ruta sigue dentro del `Drive/` de este workspace. `uniquePath` extraído a `src/main/util/unique-path.ts` y compartido con las descargas del navegador. RED 6/1, GREEN 7/7, M48/M49/M50.
- **IPC-UPLOAD-01 · el tope era de la llamada, no de la carpeta.** `chat:upload` rechazaba ficheros de más de 25 MB y no tenía límite acumulado: 25 MB aceptados indefinidamente dentro del workspace. Presupuesto de 512 MiB (`WOS_MAX_UPLOADS_BYTES` para poder probarlo), contado sólo sobre ficheros regulares — un symlink no infla el total ni saca el recorrido del workspace — y comprobado **antes** de crear la carpeta del día. RED 4/1, GREEN 5/5, M51/M52/M53.
- **IPC-DOC-WRITE-01 · el guardado se comía el guardado de otro.** Los dos writers `.xlsx` leían, editaban en memoria, verificaban un temporal y `rename` sobre el original: crash-safe y **ciego a conflictos**. Cualquier guardado de Excel/LibreOffice/sync entre la lectura y el rename se destruía y la llamada devolvía `{ ok: true }`. Nuevo `src/main/doc-identity.ts` (dev+ino+tamaño+mtime, porque el rename cambia el ino y el guardado en sitio cambia el resto) y `loadValidatedXlsx` devuelve la identidad del **descriptor que leyó los bytes**. RED: la suite existente **afirmaba el overwrite** (`ooxml-writers-shape`, "pathname is replaced" → `{ ok: true }`) y se endureció a `changed-on-disk`, con la propiedad N+2c resultando más fuerte. M54/M55.
- **IPC-DOC-WRITE-02 · el guard estaba dentro de cada writer.** Los cinco writers docx/pptx tenían la misma forma leer→rename y por tanto la misma ventana. Copiar la comprobación cinco veces habría garantizado que el siguiente writer la olvide, así que se convirtió en primitiva: `readWithIdentity` (bytes e identidad del **mismo** descriptor — el `statSync` + `readFileSync` anterior eran dos búsquedas de un mismo nombre) y `commitTemp` (el único sitio donde se reemplaza un documento: rechaza si cambió, limpia el temporal, `write-failed` si el rename falla). Los dos writers xlsx pasaron también por la primitiva: una sola implementación del guard. RED con **carrera real**, sin stub: la identidad se captura de forma síncrona antes del primer `await`, así que lanzar la escritura y reemplazar el fichero inmediatamente reproduce "otra aplicación guardó". M56/M57/M58; M58 la detecta el invariante mecánico de `doc-write-wiring.test.ts`, que exige `commitTemp(` y prohíbe `fs.renameSync(` en los siete.
- **Decisión de test, a la vista:** no se debilitó ningún guard para pasar un test; se corrigió un test que bendecía la pérdida de datos, y la sección 5 del checkpoint lo explica para que sea revisable.
- Evidencia: suite completo **375 archivos + 3 omitidos, 5017 tests + 26 omitidos**; tsc 0 (nodo y renderer); ESLint 0 sobre 1027 ficheros; build 0; `npm audit` 40 moderadas / 0 altas / 0 críticas.
- **DOC-WRITE-04 CERRADO** con IPC-DOC-WRITE-02; ver [ipc-doc-write-02-checkpoint-2026-11-21.md](ipc-doc-write-02-checkpoint-2026-11-21.md).
- Pendiente, por orden: **revisión independiente** de la serie, **NIVEL 3** (sigue sin haber ni un Electron real, micrófono, LibreOffice ni cuenta de Drive), **WORKSPACE-03** (decisión de capacidad, no defecto), SEARCH-02 y el orden del índice ZIP.

## Anterior — IPC-SPEECH-02 · 2026-11-21

Ver [ipc-speech-02-checkpoint-2026-11-21.md](ipc-speech-02-checkpoint-2026-11-21.md) y el plan en [ipc-class-01-triage.md](ipc-class-01-triage.md). Rama `arena/c34cb1fb-workspace-os`, base `653cd0f` (IPC-BROWSER-02).

- **El hallazgo del lote es que no había nada que arreglar:** los veintisiete handlers `speech:*` ya verificaban el emisor con el `assertOwner(event)` del propio módulo, que es `documentFor(assertWorkspace(event))` y, por dentro, `assertMainFrame` + identidad de sender y frame con `mainWindow()`. El triage los daba como verdict A porque el inventario conocía `assertWorkspace(` pero no el nombre del wrapper, y porque su patrón exigía que el parámetro se llamara `ipcMain` — `speech/handlers.ts` registra con `ipcHandle(ipc, …)` y no tenía snippet. **Dos puntos ciegos, un número: los verdict-A restantes nunca fueron 23, eran 0.**
- Lo que sí faltaba era la **evidencia**: 137 tests nuevos (27 × 4 formas de llamador no autorizado, 27 controles del owner, y tres invariantes de fuente que fijan que `assertOwner` es de verdad el mecanismo y no un nombre). M45 (quitar `assertOwner` de `speech:set-key`) rompe 7 tests; M46 (volver al `ipcMain` literal) rompe 3.
- Inventario: **473 = 405 + 16 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **174**. Los 16 que quedan en `EXPLICITLY_NO_GUARD` son la lista B.
- Barrido mecánico añadido: los canales que el escáner no ve tienen que ser **exactamente** `PUSH_CHANNELS`; M47 (estrechar el patrón) rompe 4 tests. Ya no hace falta descubrir el siguiente punto ciego a mano.
- Evidencia: GREEN 137/137; M45/M46/M47 detectadas; suite completo **369 archivos + 3 omitidos, 4978 tests + 26 omitidos**; ESLint 0 sobre 1018 ficheros; build 0.
- Pendiente, por orden: **revisión independiente** de la serie, y **NIVEL 3** — el hueco honesto más grande: doce lotes aceptados en NIVEL 2, ninguno con Electron real, micrófono real, LibreOffice real ni una cuenta de Drive real.

## Anterior — IPC-BROWSER-02 · 2026-11-21

Ver [ipc-browser-02-checkpoint-2026-11-21.md](ipc-browser-02-checkpoint-2026-11-21.md) y el plan en [ipc-class-01-triage.md](ipc-class-01-triage.md). Rama `arena/c34cb1fb-workspace-os`, base `b1dca61` (IPC-HIST-01).

- Diecinueve handlers del drive del navegador invitado no miraban el evento: cualquier frame podía `navigate` la pestaña visible, `click` dentro de la **sesión autenticada del usuario**, `type` en inputs, leer la página (`current`/`map`/`extract`/`deep-read`), `screenshot` al workspace y listar `downloads`. RED 77/78.
- La suite conduce el **registro real** de guests con un fake que graba cada acceso y cada llamada (Proxy): un rechazo deja el grabador vacío — ni siquiera el `isDestroyed()` que hace el registro al entrar. Eso convierte "no se ejecutó" en una medida, no en una deducción del mensaje de error.
- Los dos controles que ya existían siguen detrás del guard: `requireHttpUrl` (un `navigate` a `file:///etc/passwd` falla) y la confinación de capturas por `realPathSafe`. Acotan *qué*, no *quién*.
- Inventario: **473 = 378 + 43 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **147**. De los 43, 20 son B: quedan **23 canales verdict-A**, todos `speech:*`.
- Evidencia: RED 77/1; GREEN 78/78; M42–M44 detectadas (6 fallos cada una, dos módulos); suite completo **368 archivos + 3 omitidos, 4840 tests + 26 omitidos**; ESLint 0 sobre 1017 ficheros; build 0; audit 40 moderadas.

## Anterior — IPC-HIST-01 · 2026-11-21

Ver [ipc-hist-01-checkpoint-2026-11-21.md](ipc-hist-01-checkpoint-2026-11-21.md) y el plan en [ipc-class-01-triage.md](ipc-class-01-triage.md). Rama `arena/c34cb1fb-workspace-os`, base `00dc7b6` (IPC-MEM-01).

- Doce handlers de `history.ts` no miraban el evento: `history:search` es **full-text sobre el contenido de las páginas**, `recent`/`bookmarks`/`suggest`/`is-starred` son el registro de todo lo leído, `forget`/`forget-since`/`clear` **borran de verdad** (el índice elimina también las filas FTS) y `browser:clear-cache` vacía la caché HTTP. RED 49/50.
- **HIST-02 — el hallazgo grande:** `history.ts` registra con `ipcMain.handle(IPC.X, …)`, no con el registro `ipcHandle`, y el inventario sólo escaneaba la segunda forma. Los doce canales **nunca se examinaron**: su entrada en `EXPLICITLY_NO_GUARD` pasaba porque no había snippet que fallara. El escáner ya lee ambas formas, corta cada snippet en el siguiente registro de cualquiera de las dos, y un test nuevo exige que el fichero se escanee y que **todo** `MUST_HAVE_GUARD` tenga snippet. M39 (quitar la forma del escáner) hace fallar 3 tests.
- Apertura perezosa del índice fijada desde los dos lados: un rechazo nunca lo abre, el primer uso del owner lo abre exactamente una vez.
- Inventario: **473 = 359 + 62 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **128**. De los 62, 20 son B: quedan **42 canales verdict-A** (`speech:*` 23, `browser:*` 19).
- Evidencia: RED 49/1; GREEN 50/50; M39–M41 detectadas; suite completo **367 archivos + 3 omitidos, 4762 tests + 26 omitidos**; ESLint 0 sobre 1016 ficheros; build 0.

## Anterior — IPC-MEM-01 · 2026-11-21

Ver [ipc-mem-01-checkpoint-2026-11-21.md](ipc-mem-01-checkpoint-2026-11-21.md) y el plan en [ipc-class-01-triage.md](ipc-class-01-triage.md). Rama `arena/c34cb1fb-workspace-os`, base `efc1118` (IPC-BUG-01).

- Quince de los dieciséis canales `memory:*` no miraban el evento. El lado de escritura (`remember`, `correct`, `confirm`, `forget`) **muta el store de memoria personal** — `forget` borra sin deshacer y `correct` guarda la versión anterior como historial; el lado de lectura devuelve todo lo que la app sabe del usuario (incluido el DB de insights Pulse del workspace); y `propose` **lee un digest de sesión y llama al modelo de la persona**. RED 60/62 (15 × 4).
- El store ya estaba **acotado al workspace activo** (derivado en main, nunca nombrado por el llamador): eso responde *qué* es alcanzable, no *quién* puede alcanzarlo. El mock registra **qué** operación se toca, así que "protegido" no se confunde con "devolvió `[]` porque el workspace estaba vacío".
- `memory:status` sigue en `EXPLICITLY_NO_GUARD` (verdict B, estado del DB Pulse) y el test de inventario **sigue exigiendo que no tenga guard**: la decisión B queda visible, no supuesta.
- Inventario: **473 = 347 + 74 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **116**. De los 74, 20 son B: quedan **54 canales verdict-A** (`speech:*` 23, `browser:*` 20, `history:*` 11).
- Evidencia: RED 60/2; GREEN 62/62; M36–M38 detectadas (6 fallos cada una); suite completo **366 archivos + 3 omitidos, 4711 tests + 26 omitidos**; ESLint 0 sobre 1015 ficheros; build 0.

## Anterior — IPC-BUG-01 · 2026-11-21

Ver [ipc-bug-01-checkpoint-2026-11-21.md](ipc-bug-01-checkpoint-2026-11-21.md) y el plan en [ipc-class-01-triage.md](ipc-class-01-triage.md). Rama `arena/c34cb1fb-workspace-os`, base `86f3c2f` (IPC-DIAG-01).

- Los seis canales del bug reporter no miraban el evento: `bug:file` **añade un informe a `docs/BUGS.md` del repo de desarrollo**, `bug:analyze` gasta una llamada al modelo y manda el contexto vivo y la cola de errores, `bug:setRepo` **re-apunta dónde caen los informes** y `status`/`context`/`list` devuelven la ruta absoluta del repo, el commit, el contexto vivo y los últimos errores del log. RED 24/26 (6 × 4).
- **`bug:status` estaba triado B** (“poller status, no user content”) y devuelve ruta + log + número de informes: pasa a A, como `drive:connection`. Verdict A 123 → **124**, B 21 → **20**.
- `bug:setRepo` ya validaba que el destino fuera este repo (`package.json` con `name: workspace-os`): acota **dónde**, no **quién**. El guard va delante y la validación se queda; el test la ejerce con una carpeta que no es el repo.
- Inventario: **473 = 332 + 89 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **101**. De los 89, 20 son B: quedan **69 canales verdict-A** (`memory:*` 15, `speech:*` 23, `history:*` 11, `browser:*` 20).
- Evidencia: RED 24/2; GREEN 26/26; M34/M35 detectadas (6 fallos cada una); suite completo **365 archivos + 3 omitidos, 4649 tests + 26 omitidos**; ESLint 0 sobre 1014 ficheros; build 0.

## Anterior — IPC-DIAG-01 · 2026-11-21

Ver [ipc-diag-01-checkpoint-2026-11-21.md](ipc-diag-01-checkpoint-2026-11-21.md) y el plan en [ipc-class-01-triage.md](ipc-class-01-triage.md). Rama `arena/c34cb1fb-workspace-os`, base `c6c75af` (merge de IPC-STORE-01).

- Doce canales de cuatro subsistemas no miraban el evento: `print:document` **abre una ventana oculta e imprime**, `agents:write/delete` **escriben y borran los ficheros de definición de agentes** (los prompts que ejecuta el runtime) en workspace y en el state dir, `checkpoint:rollback` **restaura ficheros desde el historial de git**, `snapshot:save/delete` escribe y borra snapshots del workspace y `agents:build` gasta una llamada al modelo. RED 48/50 (12 × 4).
- La aserción de rechazo mira tres cosas: las llamadas al store (`new-window`, `loadURL`, `snapshots.create`, `checkpoints.rollbackTo`), el callback de impresión y los dos directorios temporales — **ningún fichero escrito**.
- `print:document` ya usaba `event.sender.id` para **suprimir re-entradas**; eso no es autorización y no se confunde: el guard va antes y el test comprueba que `print` no llegó a ejecutarse.
- Hueco del triage corregido (**DIAG-02**): la tabla de clusters sumaba 117 de los 123 verdict-A; **`checkpoint:*` y `snapshot:*` (6) no tenían fila**. Ahora son el cluster 12.
- Inventario: **473 = 326 + 95 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **95**. `EXPLICITLY_NO_GUARD` 107 → 95; quedan **74 canales verdict-A**.
- Evidencia: RED 48/2; GREEN 50/50; M30–M33 detectadas (6 fallos cada una: 4 conductuales + 2 de inventario); suite completo **364 archivos + 3 omitidos, 4623 tests + 26 omitidos**; ESLint 0 sobre 1013 ficheros; build 0; audit 40 moderadas, 0 altas.

## Anterior — IPC-STORE-01 · 2026-11-21

Ver [ipc-store-01-checkpoint-2026-11-21.md](ipc-store-01-checkpoint-2026-11-21.md) y el plan en [ipc-class-01-triage.md](ipc-class-01-triage.md). Rama `arena/9cd5feee-workspace-os`, base `451c97b` (IPC-SESSION-02).

- Veinticinco canales de los stores derivados (metrics, collections, ranges, componentes, wiki) no miraban el evento: borrar métricas/colecciones/rangos/enlaces/componentes, refrescar **todo** de golpe, leer las tablas de enlaces y `wiki:undo`, que **reescribe páginas de la wiki y las reindexa**. RED 100/100 (25 × 4) con los 25 controles en verde.
- Fixture nuevo con doble aserción por canal: rechazo **sin consultar el store** y admisión del owner **consultándolo**. Un guard que rechazara todo pasaría la primera mitad y fallaría la segunda — el mismo error de `links.test.ts` visto desde el otro lado.
- Inventario: **473 = 314 + 107 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **83**. `EXPLICITLY_NO_GUARD` 153 → 107; quedan **86 canales verdict-A**.
- Evidencia: RED 100/25; GREEN 125/125; M27–M29 detectadas; suite completo **363 archivos + 3 omitidos, 4573 tests + 26 omitidos**; tsc 0; ESLint 0 en los archivos tocados; build 0.

## Anterior — IPC-SESSION-02 · 2026-11-21

Ver [ipc-session-02-checkpoint-2026-11-21.md](ipc-session-02-checkpoint-2026-11-21.md) y el plan en [ipc-class-01-triage.md](ipc-class-01-triage.md). Rama `arena/9cd5feee-workspace-os`, base `68396d2` (IPC-DRIVE-02).

- `sessions:load` devuelve **la transcripción entera** de la conversación del workspace, `sessions:save` escribe hasta 40 MB y `chat:upload` escribe los bytes de un archivo soltado en `.workspace-os/uploads/`. Ninguno miraba el evento: un frame ajeno podía leer todas las conversaciones o llenar el disco. RED 12/12; ahora los tres verifican el frame.
- `sessions:save` ya tenía un control real — sólo acepta una raíz abierta en esta ejecución — pero acota **qué workspace**, no **quién pregunta**. El guard va **antes**, para que un rechazo no se confunda con el `{ ok: false }` de raíz no abierta.
- Inventario: **473 = 289 + 132 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **58**. `EXPLICITLY_NO_GUARD` 153 → 132; quedan **111 canales verdict-A**.
- Evidencia: RED 12/2; GREEN 14/14; M26 detectada; suite completo **362 archivos + 3 omitidos, 4448 tests + 26 omitidos**; tsc 0; ESLint 0 en los archivos tocados; build 0.

## Anterior — IPC-DRIVE-02 · 2026-11-21

Ver [ipc-drive-02-checkpoint-2026-11-21.md](ipc-drive-02-checkpoint-2026-11-21.md) y el plan en [ipc-class-01-triage.md](ipc-class-01-triage.md). Rama `arena/9cd5feee-workspace-os`, base `fdf3241` (IPC-WORKSPACE-02).

- Los seis handlers de Drive que faltaban (`connection`, `connect`, `disconnect`, `list`, `search`, `open`) no miraban el evento: podían iniciar el flujo OAuth en el navegador del sistema y guardar un refresh token, cortar la conexión, enumerar el Drive y **descargar un archivo remoto dentro del workspace**. RED 24/24. Ahora los seis verifican el frame, con el guard **fuera** de `guard()` para que un rechazo no se convierta en `{ ok: false }`.
- **Corrección del triage**: `drive:connection` estaba en B ("si hay cuenta vinculada") pero devuelve el objeto de conexión completo, **email incluido**. Pasa a A y se guarda aquí — el límite declarado del triage, en un caso concreto.
- Inventario: **473 = 286 + 135 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **55**. `EXPLICITLY_NO_GUARD` 153 → 135; quedan **114 canales verdict-A**.
- Evidencia: RED 24/2; GREEN 26/26; M24/M25 detectadas; RT-07 (symlink de `drive:save`) sigue verde; suite completo **361 archivos + 3 omitidos, 4434 tests + 26 omitidos**; tsc 0; ESLint 0 en los archivos tocados; build 0.

## Anterior — IPC-WORKSPACE-02 · 2026-11-21

Ver [ipc-workspace-02-checkpoint-2026-11-21.md](ipc-workspace-02-checkpoint-2026-11-21.md) y el plan en [ipc-class-01-triage.md](ipc-class-01-triage.md). Rama `arena/9cd5feee-workspace-os`, base `7ed5297` (IPC-PDF-01).

- `workspace:open-recent` llamaba a `openWorkspacePath(dir)` con un **string del que llama** y sólo comprobaba que fuese un directorio existente, para después fijar `setWorkspaceRoot(dir)` — el valor al que se acotan **todos** los validadores de ruta. Es la misma clase que `fs:open-folder-dialog` (guardado en IPC-WATCH-01), pero con la ruta elegida por el emisor. También `workspace:close` y `workspace:recents`. RED 12/12; ahora los tres verifican el frame.
- **WORKSPACE-03 (registrado, sin cerrar)**: incluso para el owner, `open-recent` acepta cualquier directorio existente, no sólo los de la lista de recientes. Es una decisión de capacidad, no de autorización; se deja anotada para tomarla a propósito.
- Inventario: **473 = 280 + 141 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **49**. `EXPLICITLY_NO_GUARD` bajó de 153 a 141; quedan **120 canales verdict-A** del triage.
- Evidencia: RED 12/3; GREEN 15/15; M23 detectada; suite completo **360 archivos + 3 omitidos, 4408 tests + 26 omitidos**; tsc 0; ESLint 0 en los archivos tocados; build 0.

## Anterior — IPC-CLASS-01 (triage) + IPC-PDF-01 · 2026-11-21

Ver [ipc-class-01-triage.md](ipc-class-01-triage.md) e [ipc-pdf-01-checkpoint-2026-11-21.md](ipc-pdf-01-checkpoint-2026-11-21.md). Rama `arena/9cd5feee-workspace-os`, base `54189d8` (merge de PR #20). Agente local único, autorrevisión no independiente.

- **La premisa de la auditoría no se sostenía.** Re-derivados desde el código los 153 canales `EXPLICITLY_NO_GUARD`: **123 llegan a contenido del usuario, estado, disco, red, programa externo, modelo o secreto**; sólo **21** son realmente estado de UI. No era un conjunto de decisiones, era un default sin examinar.
- **IPC-PDF-01**: los nueve handlers de `pdf.ts` reescriben documentos en sitio (reordenar, rotar, rellenar formularios, firmar), guardan el sidecar de anotaciones, exportan copias y entregan un PDF temporal a `shell.openPath`; ninguno miraba el evento. RED 36/36. Ahora los nueve verifican el frame; `MUST_HAVE_ORIGIN_GUARD` = 46; inventario 473 = 277 + 144 + 22 + 30, todo único y sin duplicados.
- Por qué el inventario los tenía por seguros: validan la ruta **dentro** de `resolveInWorkspace()`, así que la heurística de snippets sólo veía "sin guard". El chequeo de ruta se confundió con el de emisor, a escala.
- Plan por clusters en la tabla del triage: workspace root (3, `open-recent` reasigna la raíz con un string sin validar), drive (5), sesiones (3), impresión (1), bugs (5), agents (5), stores derivados (25), memory (15), speech (23), history (11), browser (20).
- Evidencia: RED 36/2; GREEN 38/38; M21/M22 detectadas; suite completo **359 archivos + 3 omitidos, 4393 tests + 26 omitidos**; tsc 0; ESLint 0 en los archivos tocados; build 0.

## Anterior — IPC-WRITERS-01: la lista path-only queda VACÍA · 2026-11-21

Ver [ipc-writers-01-checkpoint-2026-11-21.md](ipc-writers-01-checkpoint-2026-11-21.md). Rama `arena/e28c7316-workspace-os`, base `7fba5b2` (IPC-REFRESH-01). Agente local único, autorrevisión no independiente.

- Últimos tres canales sensibles sin guard de origen: `components:save` (escribe el store de componentes), `wiki:add` (reescribe páginas y **gasta tokens del modelo**) y `drive:save` (**sube un archivo local a Google Drive** — el único canal cuyo efecto sale de la máquina). RED: 14 de 17.
- **`MUST_HAVE_ORIGIN_GUARD` = 37 y la cobertura es 268/268: cero canales path-only por primera vez.** En `drive:save` el guard va **fuera** del envoltorio `guard()`; dentro se habría convertido en `{ ok: false }`, indistinguible de un fallo de red.
- Cierre de la auditoría de origen, no de la autorización: **los 153 `EXPLICITLY_NO_GUARD` siguen siendo una clasificación sin verificar** en esta sesión. Siguiente auditoría propuesta: **IPC-CLASS-01**, un módulo a la vez, empezando por los clusters grandes (`mail:*`, `case*:*`, `lok:*`). Si un canal no debería ser alcanzable desde un renderer, el arreglo correcto puede ser sacarlo del preload, no ponerle guard.
- **FIXTURE-01 llegó a su cuarta ocurrencia** (`drive.security.test.ts`, tras `links.test.ts`, `metrics.test.ts` y el propio inventario): tests que pasaban por la razón equivocada. Reforzado en el fixture y con un test de rechazo; el suite completo sigue siendo el gate real.
- Evidencia: RED 14/17; GREEN 16/16; M18–M20 detectadas; suite completo 1er intento 4 fallos, final **358 archivos + 3 omitidos, 4355 tests + 26 omitidos**; tsc 0; ESLint 0 en los archivos tocados; build 0.

## Anterior — IPC-REFRESH-01 (`metric|collection:refreshForFile`) · 2026-11-21

Ver [ipc-refresh-01-checkpoint-2026-11-21.md](ipc-refresh-01-checkpoint-2026-11-21.md). Rama `arena/e28c7316-workspace-os`, base `76b24be` (IPC-OFFICE-01). Agente local único, autorrevisión no independiente.

- Los dos hooks de auto-refresco (se llaman en cada guardado) releen un documento fuente y **reescriben los valores derivados en el workspace** (celdas xlsx, content controls docx, textos pptx). Ninguno miraba el evento: `validateFilePath` acotaba la ruta, no al emisor. RED: 8 de 8 invocaciones no autorizadas consultaban el store.
- **FIXTURE-01 (sistémico, tercera ocurrencia)**: cada lote descubre tests que pasaban por la razón equivocada. `metrics.test.ts` invocaba con `{}`; ahora habla como el owner y un test fija el rechazo. Ya ocurrió en `links.test.ts`, `metrics.test.ts` y en el propio inventario. El suite completo es el detector y por eso es parte del gate.
- Inventario: **473 = 268 + 153 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **34**; cobertura **265/268**; quedan **3**: `components:save`, `wiki:add`, `drive:save`.
- Evidencia: RED 8/4; GREEN 12/12; M17 detectada; suite completo 1er intento 1 fallo (`metrics.test.ts`), final **357 archivos + 3 omitidos, 4338 tests + 26 omitidos**; tsc 0; ESLint 0 en los archivos tocados; build 0.

## Anterior — IPC-OFFICE-01 (`office.ts` + `canvas:export-pptx`) · 2026-11-21

Ver [ipc-office-01-checkpoint-2026-11-21.md](ipc-office-01-checkpoint-2026-11-21.md). Rama `arena/e28c7316-workspace-os`, base `18823f7` (merge de PR #19). Agente local único, autorrevisión no independiente.

- Los cuatro handlers de `office.ts` y `canvas:export-pptx` ignoraban el evento. Son los de mayor consecuencia: `office:print` convierte con LibreOffice, escribe un PDF temporal y lo entrega a `shell.openPath` (el SO lanza el visor); `office:export-pdf` abre un diálogo nativo y **escribe en el destino que elige quien llama, fuera del workspace**; `canvas:export-pptx` construye un deck en disco. RED: 20 de 20 invocaciones no autorizadas convertían, abrían, exportaban o escribían.
- Los cuatro ya figuraban en `MUST_HAVE_GUARD` sólo porque su cuerpo llama `validateFilePath`: estar contado como "con guard" no es verificar al emisor. Por eso existe `MUST_HAVE_ORIGIN_GUARD`.
- Inventario: **473 = 268 + 153 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **32**; cobertura **263/268**; quedan **5 path-only**: `drive:save`, `components:save`, `wiki:add`, `metric:refreshForFile`, `collection:refreshForFile`.
- La invariante de duplicados de IPC-SEARCH-01 se ganó el sitio en el lote siguiente: saltó sobre mi propia edición antes de llegar al commit.
- Evidencia: RED 20/3 exit 1; GREEN 23/23; M15/M16 detectadas; Vitest completo **356 archivos + 3 omitidos, 4325 tests + 26 omitidos**; tsc 0; ESLint 0 en los archivos tocados; build 0.

## Anterior — IPC-SEARCH-01 (`search.ts`) · 2026-11-21

Ver [ipc-search-01-checkpoint-2026-11-21.md](ipc-search-01-checkpoint-2026-11-21.md). Rama `arena/e28c7316-workspace-os`, base `92f6bf0` (IPC-WATCH-01). Agente local único, autorrevisión no independiente.

- Los trece handlers de `search.ts` ignoraban el evento y son la cara de **lectura** de las notas: búsqueda, símbolos, **texto extraído de .docx/.xlsx/.pptx/.pdf** (`knowledge:read`), knowledge search, backlinks/outgoing/relacionadas, el grafo entero y la resolución de enlaces. RED: 52 de 52 invocaciones no autorizadas devolvían rutas y texto de notas.
- Ahora `assertMainWindowFrame` en los trece. Inventario: **473 = 267 + 154 + 22 + 30**, `MUST_HAVE_ORIGIN_GUARD` = **27**; cobertura **258/267**; quedan **9 path-only** (`office:*`, `canvas:export-pptx`, `drive:save`, `components:save`, `wiki:add`, `metric|collection:refreshForFile`).
- Nueva invariante: ninguna categoría puede repetir un canal en su propia lista. Nació de un error real de esta sesión (trece entradas insertadas en el set equivocado, dos duplicados heredados): el `Set` los ocultaba y ningún test fallaba. Medir el inventario contra 473 lo descubrió.
- El guard destapó un falso positivo del suite completo: `links.test.ts` invocaba los handlers con `{}` como evento, así que sus nueve tests de "validación" pasaban por rechazo. Fixture corregido (`ownerEvent()`) y rechazo fijado con un test propio; no se debilitó ningún guard ni aserción.
- Evidencia: RED 52/2 exit 1; GREEN 54/54; mutaciones M12 (duplicado), M13 (`knowledge:read`), M14 (`search:start`) detectadas; Vitest completo **355 archivos + 3 omitidos, 4302 tests + 26 omitidos**; tsc 0/0; ESLint 0/0 en 1004 archivos; build 0; auditorías 35/40 sin cambios.

## Anterior — IPC-WATCH-01 (`watcher.ts`) · 2026-11-21

Ver [ipc-watch-01-checkpoint-2026-11-22.md](ipc-watch-01-checkpoint-2026-11-22.md). Rama `arena/e28c7316-workspace-os`, base `8faaf6a` (merge de PR #18). Agente local único, autorrevisión no independiente.

- Los ocho handlers de `watcher.ts` ignoraban el evento, incluidos tres que van más allá de vigilar: `fs:open-folder-dialog` **decide la raíz autoritativa**, `workspace:write-agent-note` escribe en el store, `fs:save-copy-dialog` copia fuera del workspace y `fs:reveal` muestra rutas arbitrarias en el gestor de archivos del SO. RED: 32 de 32 invocaciones no autorizadas actuaban. Ahora `assertMainWindowFrame` en todos.
- Inventario: **473 = 259 guard + 162 sin guard + 22 grants + 30 push**; `MUST_HAVE_ORIGIN_GUARD` = **14**. Cobertura de origen 245/259; **quedan 14 canales path-only** (lista y salvedad en el checkpoint), siguiente objetivo `search.ts`.
- `fs:reveal` **no** se confina al workspace a propósito (callers legítimos fuera de él; `showItemInFolder` no lee contenido ni ejecuta nada): decisión escrita en el módulo.
- Evidencia: RED 32/2 exit 1; GREEN 34/34; mutaciones M9–M11 detectadas; Vitest completo **354 archivos + 3 omitidos, 4246 tests + 26 omitidos**; tsc 0/0; ESLint 0/0 en 1003 archivos; build 0; auditorías 35/40 sin cambios.

## Histórico — dos lotes el 2026-11-21: VOX-A2b y IPC-FS-01

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
