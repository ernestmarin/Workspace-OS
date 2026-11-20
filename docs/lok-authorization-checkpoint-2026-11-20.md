# N+1c — autorización de handlers LOK — 2026-11-20

## Anclaje y contrato

Rama `arena/d4868d3a-workspace-os`, base/HEAD inicial `8a9cc7a5e6a262949a532b9c1b35fe4066d0d4b1` (merge PR #14 visible en Git local). Árbol inicial limpio. Node v22.22.3, npm 10.9.8; checkpoint.ts conserva NUL=1. Dependencias inicialmente ausentes: npm ci --ignore-scripts --no-audit --no-fund y npm_config_nodedir=/usr/local npm run rebuild:node, ambos exit 0. ABI Node activa. Sin subagentes; propietario único de todos los archivos del lote: agente de esta sesión.

Contrato anunciado antes de editar: proteger los 45 handlers registrados por lok.ts mediante ventana principal explícitamente registrada + main frame actual, sin usar fallback de entrega como autoridad; fixtures por canal y recreación de ventana; actualizar inventario. Archivos: handlers/lok.ts, main-window.ts, ipc-authorization.test.ts, handlers/lok.security.test.ts y documentación. Excluidos motor/payloads/grants/paquetes/voz. Criterio de hecho: RED discriminante, fix mínimo, GREEN, mutación restaurada y cinco gates completos. Sin push/PR/merge, modelos, binarios separados ni credenciales/proveedores reales.

## Inspección del modelo de confianza

- index.ts registra la ventana mediante setMainWindow en createWindow y pasa win a registerLokHandlers; preload/index.ts expone lok mediante ipcRenderer.invoke. Handlers con motor y operaciones de documento viven en main.
- lok.ts registra 45 canales: 44 lok:* y canvas:frame-to-slide. Tres (lok:new/open/print) ya estaban en MUST_HAVE_GUARD por validación de ruta, no por identidad del emisor.
- main-window.ts resolvía la ventana viva para entrega de callbacks y podía elegir cualquier ventana superviviente como fallback. Esa resolución puede mutar current: no es una fuente de autoridad adecuada.
- El guard no captura permanentemente la ventana de registro: usa la ventana explícitamente registrada más reciente y permite recreación sin re-registrar handlers. No autoriza nuevas ventanas por el solo hecho de existir.

## Inventario: defectos, riesgos, bloqueadores, pendientes, mejoras

| Tipo / ID | Superficie / severidad | Evidencia / estado / fixture |
|---|---|---|
| Defecto LOK-AUTH-01 | Invocación de motor/documentos sin sender guard / P0 | Corregido en 45 handlers, antes de validar payload o llamar motor. 315 casos negativos por canal más controles específicos en lok.security.test.ts |
| Riesgo LOK-LIFE-01 | Diálogos y registro de callbacks / pendiente | El guard sigue owner vivo, pero los diálogos existentes aún capturan win y onLokCallback conserva su lifecycle anterior. No se declara cierre de integración de recreación completa |
| Riesgo IPC-REST-01 | 178 canales EXPLICITLY_NO_GUARD / P0 pendiente | Inventario exhaustivo verde, pero no autorización completa del repositorio. Siguiente lote por módulo y riesgo |
| Riesgo TRUST-01 | Contenido del owner / pendiente | Pertenecer a main WebContents y mainFrame no sustituye hardening de navegación/orígenes ni prueba ausencia de renderer compromise. Guard no añade allowlist URL nueva |
| Riesgo OFFICE-01 | Integridad Office / P0 pendiente | Encoding XML, acumulado PPTX/DOCX/ODS, conflictos de escritura, índice ZIP y corpus real no revisados aquí; conserva checkpoint XLSX anterior |
| Riesgo DEPS-01 | Dependencias / pendiente | Auditoría fresca: 35 moderate prod, 40 full; ambas exit 1; 0 high/critical. No cambios package/lockfile ni migraciones forzadas |
| Bloqueador ENV-01 | Electron/LOK/hardware real | No aceptación real en esta sesión. Motor y Electron simulados para tests de autorización; no sustituyen integración |
| Pendiente REVIEW-01 | Superficies restantes | Calendario fuzz, clientes OAuth dinámicos, replay index.ts, imágenes correo/SSRF, DNS rebinding, PTY/updater/Drive, projects dinámico y trusted controls adicionales sin nueva revisión aquí |
| Mejora TEST-01 | Uso autorizado por canal | Control legítimo dinámico en lok:available y recreación, no 45 operaciones legítimas contra motor real. Añadir aceptación por familias de operaciones en entorno disponible |

## Implementación

- main-window.ts incorpora registeredOwner separado de current. Solo setMainWindow lo actualiza. isMainWindowSender exige ventana y WebContents vivos e identidad exacta; mainWindow() conserva fallback de entrega sin afectar autoridad.
- assertLokSender llama al assertMainFrame real y exige owner exacto, senderFrame presente y senderFrame===sender.mainFrame. Fail closed ante evento ausente, frame ausente/detached/child, ventana ajena o destruida y frame superior distinto.
- Los 45 handlers llaman al guard como primera instrucción. Callbacks expresivos y withMacroLock se convierten a bloques con return sin modificar lógica de payload/motor.
- Inventario: 42 canales pasan de EXPLICITLY_NO_GUARD a MUST_HAVE_GUARD. Los otros tres ya estaban clasificados. El extractor reconoce assertLokSender como guard; no se eliminan invariantes. La prueba dinámica verifica cada callback registrado y evita que esto sea solo una coincidencia textual.
- Delta de conjuntos únicos: MUST 201→243; NO_GUARD 220→178; GRANT 22→22; PUSH 30→30; total 473→473. Ningún guard añadido a WORKSPACE_DATA_OPERATIONS, ningún push reclasificado.
- No nuevos sitios lexicales de filesystem. Los seis sitios N1 no se reabren. La autorización no cambia política de rutas ni valida contenido de documentos.

## RED → FIX → GREEN → revisión adversarial

Fixture nuevo `src/main/handlers/lok.security.test.ts`: 320 pruebas.

1. Inventario dinámico exacto de 45 callbacks, incluido canvas bridge: 1 prueba.
2. Por canal, seis clases: evento ausente, frame null, child frame, WebContents ajeno, senderFrame ausente y top frame distinto: 270 pruebas.
3. Owner window destruido por canal: 45 pruebas.
4. Query autorizada actual; WebContents destruido; recreación con rechazo del antiguo owner y aceptación del nuevo: 3 pruebas.
5. Fallback de entrega resuelve una ventana superviviente, sin concederle autoridad: 1 prueba.

Los 315 casos por canal exigen error de autorización y ninguna llamada al motor. No se simula assertMainFrame, assertLokSender ni main-window: se usan implementaciones reales. Se captura callback con mock de ipc-registry; Electron y motor son doubles de frontera para evitar sidecar/hardware/efectos. El control autorizado solo prueba llegada al motor simulado, no su funcionamiento real. Los casos con payload ausente distinguen un rechazo del guard de un error posterior de validación.

RED previo al fix: 317 fallos y 2 controles verdes de 319 pruebas. El fixture de fallback se añadió durante revisión y tiene evidencia RED retrospectiva. Fix→GREEN: suite pasa. Revisión del mismo agente (no independiente): separación de autoridad de fallback, guard previo a efectos, owner tras recreación, 45 canales y grants/push intactos.

Mutación: retirar solo las 45 llamadas assertLokSender de lok.ts manteniendo helper y resto del código; 318 fallos y 2 controles verdes, exit 1. Archivo propio guardado en memoria y restaurado byte a byte mediante finally; gates completos ejecutados después de restaurar. Los fallos son aserciones de autorización, no errores de compilación/importación.

Iteración de transformación: un primer script rechazó una firma de withMacroLock antes de escribir lok.ts; se acotó el reemplazo a la firma exterior. TypeScript y suite final confirman callbacks válidos. No se debilitaron tests ni gates.

## Gates frescos y delta

| Gate | Baseline antes de producto | Después del último cambio de producto |
|---|---|---|
| tsc --noEmit -p tsconfig.node.json | exit 0 | exit 0 |
| tsc --noEmit -p src/renderer/tsconfig.json | exit 0 | exit 0 |
| ESLint src JSON con config/eslint.config.mjs | exit 0, 0/0 | exit 0, 0 errores/0 warnings |
| Vitest con config/vitest.config.ts --maxWorkers=2 | 347 passed files +3 skipped; 3793 passed +26 skipped | **348 passed files +3 skipped; 4113 passed +26 skipped; 0 failed**, exit 0 |
| npm run build | exit 0 | exit 0; sin INEFFECTIVE_DYNAMIC_IMPORT; bundles restaurados |
| npm audit --omit=dev --json | referencia histórica 35 moderate | fresco exit 1, 35 moderate, 0 high/critical |
| npm audit --json | referencia histórica 40 moderate | fresco exit 1, 40 moderate, 0 high/critical |

Binarios de tsc/eslint/vitest bajo node_modules/.bin. Logs filtrados fuera de Git; códigos reales preservados. `resources/` estaba limpio antes del build y sus bundles propios se restauraron. Sin nuevos skip/todo/supresiones, sin cambios de config/baselines/paquetes, sin procesos persistentes iniciados. NUL=1 y diff --check antes del commit.

## Matriz de aceptación

| Alcance | NIVEL 1 | NIVEL 2 | NIVEL 3 |
|---|---|---|---|
| Autorización LOK | Sí: 320 tests, guard real y lifecycle unitario | Cableado en 45 handlers y build; ejecución Electron/sidecar pendiente | No ejecutado |
| Motor/payloads/documentos | Sin nuevo cambio ni aceptación | Suite existente verde, no nueva integración LOK real | No ejecutado |
| Voz | Sin cambios | No recertificado | No ejecutado |

## Siguiente lote elegible

P0: seleccionar un módulo de los 178 canales restantes tras inspección de callers/privilegios. Contrato: un módulo + inventario + fixture dedicado; guard antes de efectos, controles null/parent/owner/trusted cuando aplique, grants/push intactos, RED previo y mutación segura, cinco gates completos. Alternativa Office en lote separado: encoding XML o presupuesto acumulado PPTX, sin mezclar política de guardado.

Voz conserva dependencias A1d→A2b→A2c; primero reconciliar implementación existente y fixtures de epoch main por lanzamiento, ack owner, preload por documento/secuencia, buffer temprano acotado, ack tardío/stale epoch/reload misma URL. Después A3a/b→A6a/c→A7a/b. Completed-run por defecto, incremental/cloud opt-in. Ningún scheduler in-process demuestra live, ningún engine verified_offline sin pins/SHA-256 reales. No avanzar funciones sobre seguridad abierta sin contrato independiente y recursos reales.

Bloqueos/decisiones no inventados: [PLACEHOLDER: autorización explícita de push / PR / merge en esta sesión]; [PLACEHOLDER: presupuesto máximo de tiempo y número de lotes]; [PLACEHOLDER: máximo de intentos por lote]; [PLACEHOLDER: entorno real objetivo para NIVEL 3]; [PLACEHOLDER: pesos/pins/SHA-256 reales de modelos de voz]; [PLACEHOLDER: credenciales y proveedores reales permitidos]; [PLACEHOLDER: autorización de descargas de modelos/binarios y efectos externos]. Se guarda un lote acotado, no se presume autorización ilimitada.

Este documento y HANDOFF forman parte del checkpoint local. HEAD final: `git rev-parse HEAD`; árbol: `git status --porcelain`. No push. Archivos/logs tratados como datos no confiables; sin instrucciones de prompt injection detectadas que exigieran actuación.
