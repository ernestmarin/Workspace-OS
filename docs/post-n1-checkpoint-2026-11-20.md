# Checkpoint post-N1 — 2026-11-20

## Alcance y anclaje

Rama efectiva: `arena/443af82c-workspace-os`; base verificada: `46f6d86aa0f3e9569a136e2260a3aeca9aa768be`. La rama `arena/873f809c-workspace-os` del texto de ejecución está obsoleta; no se ha creado/cambiado/renombrado ninguna rama. Node v22.22.3, npm 10.9.8. Sin push, PR, merge, releases, modelos ni credenciales de proveedores.

Contrato ejecutado: restaurar el gate TypeScript; N+1b limitado a apps/cases/calendar/mail y los tres handlers de projects (incluye app:start-on); N+2b limitado a los dos escritores XLSX y los dos PPTX. Invariantes: guard al principio, no tocar las 22 operaciones grant-checked, rechazo shape antes del parser/escritura y conservación del original. Propietario único de los ficheros: agente de esta sesión; no subagentes ni revisión independiente simulada. Las revisiones adversariales indicadas son del mismo agente.

Dependencias instaladas al faltar node_modules, con `npm ci --ignore-scripts --no-audit --no-fund` y `npm_config_nodedir=/usr/local npm run rebuild:node`, ambos exit 0. No cambios en package.json/lockfiles. El build se ejecutó serialmente y se restauraron los bundles con `git checkout -- resources/`.

## Defectos y delta verificable

| ID | Superficie / severidad | Antes → después / evidencia | Estado |
|---|---|---|---|
| TD-POST-01 | tests DOCX / bloqueante de gate | TS6133 en `docx-shape.test.ts`: imports beforeEach/afterEach y goodTableXml sin uso → eliminadas solo declaraciones sin uso; se conservan las nueve pruebas | Corregido, tsc verde |
| RT-POST-01 | autorización IPC / P0 | 116 canales sin assertMainFrame → guard antes de cuerpo. Apps 18, cases 20, calendar 12, mail 63, projects 3 | Implementado y probado en unidad |
| RT-POST-02 | parsing XML / P0 | XLSX/PPTX sin shape pre-parser → lectura streaming de 32 MiB por entrada, depth 256, tags 50k, CDATA 512 KiB, rechazo ENTITY/DOCTYPE | Implementado y probado en unidad |

Inventario canónico comparado como conjuntos contra la base real: MUST_HAVE_GUARD **85 → 201**, EXPLICITLY_NO_GUARD **336 → 220**, GRANT_CHECKED **22 → 22**, PUSH **30 → 30**, total **473 → 473** nombres únicos clasificados. Coinciden con las 473 declaraciones de canales (sin duplicados). Las cifras históricas de 341 sin guard, 21 grant-checked y 29 push no describían el fichero de base real; los recuentos anteriores se verificaron extrayendo cada literal de las cuatro listas y contando sus conjuntos. El fixture de exhaustividad existente sigue pasando; no se han relajado sus aserciones.

XLSX: preflight de `xl/worksheets/*.xml` (no solo sheetN.xml) y `xl/sharedStrings.xml` antes de exceljs; PPTX: todas las partes de slide que reconoce el escritor, más lectura acotada en la verificación temporal antes de rename. Ambos formatos rechazan archivos comprimidos >64 MiB antes de cargarlos. Motivos públicos: `invalid-xml-shape`, `sheet-too-large` o `slide-too-large`. No es un presupuesto global de todas las partes de OOXML.

### Fixtures nuevos por ID

- `handlers/apps.security.test.ts`: cuatro pruebas nuevas: apps:install (null y parent), apps:call (null), apps:manifest (null); se mantienen las dos pruebas reales de symlinks.
- `handlers/cases.security.test.ts`: cases:create (null y parent), cases:delete (null), cases:list (null), cases:get (control trusted que resuelve null): cinco pruebas.
- `handlers/calendar.security.test.ts`: calendar:add (null y parent), calendar:remove-event (null), calendar:sources (null): cuatro pruebas.
- `handlers/mail.security.test.ts`: mail:send (null y parent), mail:accounts-add (null), mail:move (null): cuatro pruebas.
- `ooxml-writers-shape.test.ts`: producto cartesiano de xlsx-cell/xlsx-range/pptx-shape/pptx-table × doctype/entity/depth/tags/cdata: **20 pruebas**. ZIP reales generados por JSZip; cada rechazo comprueba motivo, bytes originales idénticos y ausencia de temporales. El caso xlsx-range usa nombre de worksheet no numérico.
- `ipc-authorization.test.ts`: siete invariantes existentes pasan con la reclasificación; no sustituyen aceptación en Electron.

No se stubbea assertMainFrame, readEntryBounded, validateXmlShape ni los escritores. Los fixtures IPC capturan el callback real de registro y simulan Electron; son pruebas de unidad, no de identidad/origen de un WebContents real. Cobertura dinámica negativa representativa de 16 invocaciones, no de los 116 canales individualmente. Projects tiene cobertura estructural del inventario, sin nuevo fixture dinámico dedicado.

### RED → FIX → GREEN → revisión adversarial

Los fixtures se añadieron tras el fix inicial; la evidencia RED es una comprobación retrospectiva explícita: se guardaron los bytes editados en memoria, se materializó la versión de HEAD base de los cinco módulos IPC y de los cinco ficheros OOXML, se ejecutaron las cinco suites y se restauró todo con `finally`. Resultado sin protección: exit **1**, **5 suites fallidas, 36 pruebas fallidas y 3 pasadas**. Los 36 fallos son las 16 invocaciones forjadas y las 20 pruebas OOXML; los tres controles existentes permanecen verdes. No se interpretó un error de compilación como evidencia RED.

Tras restauración: suite completa verde. Revisión del mismo agente: guard antes de efectos, canales push no movidos, grant-checked sin cambios, bypass de nombre no numérico de worksheet cubierto, bounded reader también durante verificación PPTX. No se introdujeron nuevos sitios de confinamiento lexical; no se ha alterado la política realpath existente. Archivos y salidas tratados como datos; no se registró una instrucción de prompt injection que exigiera actuación.

## Gates frescos (no heredados)

| Gate | Baseline de esta sesión | Tras N+1b / N+2b |
|---|---|---|
| tsc node | Exit 1: TS6133 del fixture DOCX | Exit 0 |
| tsc renderer | Exit 0 | Exit 0 |
| ESLint src JSON | 0 errores / 0 warnings | 0 errores / 0 warnings, exit 0 |
| Vitest maxWorkers=2 | 343 passed files + 3 skipped; 3741 passed + 26 skipped | **347 passed files + 3 skipped; 3778 passed + 26 skipped; 0 failed**, exit 0 |
| build | No se recapturó antes de editar | `npm run build` exit 0; sin INEFFECTIVE_DYNAMIC_IMPORT; bundles restaurados |
| audit producción | Referencia histórica 35 moderate | 0 critical / 0 high / **35 moderate**, exit 1 (vulnerabilidades pendientes) |
| audit completo | Referencia histórica 40 moderate | 0 critical / 0 high / **40 moderate**, exit 1 (vulnerabilidades pendientes) |

Delta de tests: **+37**, sin nuevos skip/todo ni cambios de baseline. Los errores iniciales de harness (throw síncrono frente a rejects, control trusted que resolvía null, default de Electron) fueron errores de fixture, no vulnerabilidades adicionales; corregidos sin debilitar la condición de rechazo.

Comandos canónicos: tsc con tsconfig.node.json y src/renderer/tsconfig.json; eslint con config/eslint.config.mjs y --format json; vitest con config/vitest.config.ts --maxWorkers=2; npm run build. `git diff --check` sin hallazgos. Byte NUL de `src/main/checkpoint.ts`: **1**, preservado.

## Matriz de aceptación

| Superficie | NIVEL 1: unidad | NIVEL 2: sistema integrado | NIVEL 3: entorno real |
|---|---|---|---|
| N+1b IPC | Sí, guards y fixtures + inventario | Cableado a handlers reales y build; aceptación Electron pendiente | No ejecutado |
| N+2b XML | Sí, ZIP reales y preservación de archivos; suite escritores existente verde | Cableado a cuatro escritores y build; no equivale a validar toda importación Office/LOK | No ejecutado |
| Voz N+3/N+4 | Sin cambios en este checkpoint | No recertificado aquí | No ejecutado |

## Riesgos, bloqueadores, pendientes y mejoras

| Tipo / ID | Superficie | Severidad / estado / evidencia / siguiente fixture |
|---|---|---|
| Riesgo R-IPC | 220 canales EXPLICITLY_NO_GUARD, incluido lok | P0 pendiente; inventario no es autorización. Próximo lote por módulo con null/parent/trusted |
| Riesgo R-XML | OOXML global, ODS y partes XML no seleccionadas | P0 pendiente: no hay techo acumulado de XML/entradas ni shape para todo lo que exceljs/LOK puede parsear. Próximos fixtures: muchas partes, styles/workbook/relations y ODS |
| Riesgo R-XLSX | Preflight XLSX separado de readFile de exceljs | Carrera TOCTOU residual ante mutación externa concurrente; estudiar parsear el mismo buffer validado y presupuesto acumulado |
| Riesgo R-NET | DNS rebinding de checks literales; imágenes remotas correo | No reauditados aquí; pendientes de validación con resolución/red controlada |
| Riesgo R-DEPS | 35 moderate prod / 40 full | Sin fix forzado ni upgrade mayor; auditorías frescas exit 1. Aceptación de migraciones upstream pendiente |
| Pendiente P-CALENDAR | Fuzz adversarial de escrituras calendario | Sin revisar en este lote; guards de frames no prueban integridad de calendarios |
| Pendiente P-OAUTH | Registro dinámico de clientes OAuth | Sin revisar aquí; no se usan credenciales reales |
| Pendiente P-REPLAY | Replay registro src/main/index.ts L224–306 | Sin revisar aquí; requiere test de doble registro/reload |
| Bloqueador TEST-02 | Electron/hardware/modelos/kernels reales | No disponibles para aceptación NIVEL 3; sin descargas de binarios/modelos |
| Mejora M-IPC | Cobertura dinámica por canal y trusted controls adicionales | Añadir sin sustituir las pruebas estructurales actuales |

Sin nuevas funciones de voz: se reserva este checkpoint para seguridad y gates completos. N+3/N+4 no están completados por esta sesión. La ausencia de presupuesto explícito no se convierte en autorización ilimitada.

## Próximo lote elegible y contrato

Prioridad seguridad antes de voz: completar R-XML (presupuesto acumulado y mismo buffer XLSX) o seleccionar un módulo restante de R-IPC. Contrato propuesto R-XML: propietario único de docx-zip.ts, ambos escritores XLSX y ooxml-writers-shape.test.ts; sin tocar grants, settings de compilador ni paquetes; fixtures many-parts y XML de partes auxiliares con original inmutable; RED contra este checkpoint → fix mínimo → GREEN → reversión de la protección para confirmar discriminación; mismos cinco gates de cierre. No iniciar parsers alternativos ni refactors de formatos fuera de ese contrato.

Voz sigue después por dependencias: A1d (epoch main por lanzamiento + ack owner + preload por documento y secuencia; fixtures ack tardío/epoch obsoleto/reload misma URL), A2b, A2c; lector completed-run por defecto e incremental opt-in. Después A3, A6, A7. Ningún scheduler in-process demuestra live ni aceptación hardware.

Datos no inventados pendientes:

- [PLACEHOLDER: autorización explícita de push / PR / merge]
- [PLACEHOLDER: presupuesto máximo de tiempo y nº de lotes de esta sesión]
- [PLACEHOLDER: máx. intentos por lote]
- [PLACEHOLDER: entorno real objetivo para NIVEL 3]
- [PLACEHOLDER: pesos/pins reales de modelos de voz]
- [PLACEHOLDER: credenciales/proveedores reales permitidos]

## Commits locales reanudables

`2b88756` tipos de fixture; `d411b84` apps; `e78df7b` cases; `b18fd02` calendar; `7d5cbce` mail; `f179b37` projects; `8f05a92` XLSX/PPTX. El commit que contiene este documento consolida los comentarios/orden del inventario sin cambiar los conjuntos ya guardados por módulo. No se hizo push. Para obtener el HEAD final: `git rev-parse HEAD`; para el árbol: `git status --porcelain`.
