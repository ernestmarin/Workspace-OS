# N+2c — snapshot XLSX y presupuesto acumulado — 2026-11-20

## Anclaje y contrato

Rama `arena/ac9dd6a7-workspace-os`; HEAD inicial/base `859f7772e31668db73be7b773c4adc7c24d36d94` (merge PR #13 verificado en log local). Árbol inicial limpio. Node v22.22.3, npm 10.9.8, checkpoint.ts NUL=1. Sin subagentes; propietario único: agente de esta sesión. Sin push, PR, merge, proveedores, modelos ni binarios descargados. Dependencias npm ausentes: npm ci --ignore-scripts --no-audit --no-fund y rebuild:node con npm_config_nodedir=/usr/local, ambos exit 0. ABI activa Node.

Contrato anunciado antes de editar: cerrar el TOCTOU validación→parseo XLSX, cubrir entradas auxiliares y limitar inflación acumulada; propietarios docx-zip.ts, xlsx-cell-writer.ts, xlsx-range-writer.ts, ooxml-writers-shape.test.ts y esta documentación. No modificar paquetes, IPC, PPTX, ODS ni voz. Invariantes: mismo snapshot para validar/parsear; rechazo antes de escritura; conservar contrato público readEntryBounded y controles existentes. Hecho: fixtures discriminantes, controles legítimos y cinco gates completos verdes. Este lote es avance de seguridad, no ejecución de todo el roadmap.

## Inventario canónico del lote

| Tipo / ID | Superficie | Severidad / evidencia / estado / fixture |
|---|---|---|
| Defecto XLSX-01 | TOCTOU preflight/parseo | P0 corregido para ambos escritores: loadValidatedXlsx abre un descriptor, lee bytes acotados y entrega el mismo snapshot a exceljs.load. Dos fixtures de reemplazo de pathname con ZIP real y reapertura del resultado |
| Defecto XLSX-02 | XML auxiliar sin validar | P0 corregido en alcance XLSX: shape para nombres que contienen extensión xml/rels/vml, incluidos sufijos aceptados por regex no ancladas de exceljs; diez pruebas auxiliares entre ambos escritores |
| Defecto XLSX-03 | Inflación acumulada/entradas | P0 corregido en alcance XLSX: 2048 entradas incluyendo directorios, 64 MiB acumulados de todas las entradas, 32 MiB por entrada. Dos fixtures de exceso de entradas y uno acumulado de binarios |
| Riesgo MEM-01 | Memoria/CPU | Límites finitos, no prueba de RSS máximo: validación y exceljs descomprimen dos veces; conversión Uint8Array añade copia acotada; modelo exceljs puede amplificar memoria respecto a bytes. No benchmark industrial ejecutado |
| Riesgo WRITE-01 | Actualización externa concurrente | El snapshot evita parsear bytes distintos de los validados; NO hace compare-and-swap de destino ni impide perder una edición externa al rename. El fixture de carrera prueba identidad de entrada, no resolución de conflictos |
| Riesgo XML-01 | Shape scanner/encoding | Se conserva el validador textual existente; no es un parser de well-formedness ni prueba de equivalencia para todas las codificaciones XML. Auditoría de codificaciones y normalización pendiente |
| Riesgo ZIP-01 | Índice ZIP | JSZip carga directorio antes del límite de 2048; input comprimido acotado a 64 MiB pero sin lector incremental del directorio ZIP. El tope de entradas es posterior a loadAsync |
| Riesgo COMPAT-01 | Workbooks grandes | Nuevos límites pueden rechazar archivos legítimos muy grandes; no se afirma aceptación con corpus real de clientes. No ampliar límites sin medición/contrato |
| Riesgo DEPS-01 | Dependencias | Auditoría prod 35 moderate / full 40 moderate; exit 1 ambas, sin high/critical. Sin upgrades en este lote |
| Pendiente IPC-01 | Autorización restante | 220 EXPLICITLY_NO_GUARD según checkpoint anterior; archivo inventario sin cambios. No reauditado dinámicamente aquí |
| Bloqueador ENV-01 | Aceptación real | Sin aceptación Electron/hardware/proveedores/kernels, sin pesos/pins reales ni autorización de descargas |
| Mejora TEST-01 | Robustez adicional | Boundaries exactos 2048/64 MiB, truncado/growth concurrente y datos multibyte merecen fixtures adicionales; streaming sigue contando bytes reales, no metadatos declarados |

## Inspección y cambios

Se inspeccionó node_modules/exceljs/lib/xlsx/xlsx.js: el lector carga todas las entradas, incluso desconocidas, como string o buffer antes de seleccionar el parser. Procesa workbook, shared strings, styles, propiedades, relaciones, sheets, dibujos, comentarios, tablas y VML; algunas regex de selección no están ancladas al final. Por eso no basta seleccionar worksheets/sharedStrings ni limitar únicamente XML.

loadValidatedXlsx:
- Abre descriptor, fstat, comprueba archivo y tamaño <=64 MiB; lee como máximo tamaño observado+1 y rechaza crecimiento detectado. Cierra descriptor en finally.
- Valida el snapshot JSZip, cuenta entradas y procesa secuencialmente todas las no-directorio.
- Usa contador real de bytes descomprimidos con presupuesto restante; media/entradas desconocidas también cuentan. XML/rels/vml pasan shape. Conserva depth 256, tags 50k, CDATA 512 KiB, ENTITY/DOCTYPE y 32 MiB por entrada.
- Retorna buffer solo tras validación; errores tipados sheet-too-large, invalid-xml-shape o not-valid-xlsx.
- Ambos escritores usan exceljs.load sobre ArrayBuffer derivado exclusivamente del snapshot. La conversión se ajusta a los tipos reales de exceljs sin casts que silencien tipos.

readEntryBounded conserva exactamente su resultado público; contador adicional es interno. El primer full run encontró una regresión introducida al añadir bytes al objeto público: `docx-zip.test.ts > RT-09 readEntryBounded > returns ordinary text unchanged`. Clasificación producto, corregida mediante wrapper compatible; el test existente no fue cambiado ni debilitado.

## Fixtures, RED/FIX/GREEN y revisión

Archivo ooxml-writers-shape.test.ts: 20 pruebas existentes →35 (+15).

- Por cada escritor XLSX: rechazo de xl/styles.xml, xl/worksheets/sheet1.xml.extra, xl/workbook.xml, xl/_rels/workbook.xml.rels, xl/drawings/vmlDrawing1.vml: 10 pruebas.
- Por cada escritor: 2049 entradas pequeñas, rechazo sheet-too-large y bytes originales: 2 pruebas.
- Acumulado: 65 entradas binarias de 1 MiB, cada una bajo el techo individual, ZIP comprimido pequeño; rechazo del loader sin modificar original: 1 prueba. No ejecuta parser con carga rechazada.
- Por cada escritor: workbook real ExcelJS; seam determinista ejecuta JSZip.loadAsync real y sustituye pathname después de cargar el snapshot. Ambos escritores terminan y resultado reabre con A1=42: 2 pruebas. No se stubbea guard, parser ni validación; spy solo induce la intercalación y se restaura en finally.

RED previo al fix: diez fixtures iniciales fallaron, veinte controles pasaron (exit 1). Los cinco adicionales se añadieron durante revisión; su RED es retrospectivo.

Revisión adversarial del mismo agente, no independiente: desactivar límite de entradas, acumulado y selección XML ampliada, y volver a readFile en ambos escritores, manteniendo helper para que no haya fallos de importación. Resultado: 15 fallos, 20 controles verdes (exit 1). Fuentes propias guardadas en memoria y restauradas byte a byte en finally. La suite completa posterior valida las fuentes restauradas, incluido el wrapper compatible.

No nuevos sitios de confinamiento lexical: el path sigue siendo el autorizado por el llamador. No se afirma que snapshot otorgue autorización de ruta ni que prevenga toda mutación concurrente. Sin instrucciones de prompt injection detectadas que requirieran actuación; documentos/logs tratados como datos.

## Gates frescos y delta

| Gate | Baseline antes de editar | Final tras último cambio de producto |
|---|---|---|
| tsc node | exit 0 | exit 0 |
| tsc renderer | exit 0 | exit 0 |
| ESLint src JSON | exit 0 | exit 0, 0 errores/0 warnings |
| Vitest --maxWorkers=2 | 347 archivos passed, 3 skipped; 3778 passed, 26 skipped | 347 archivos passed, 3 skipped; **3793 passed, 26 skipped, 0 failed**, exit 0 |
| npm run build | exit 0 | exit 0; sin INEFFECTIVE_DYNAMIC_IMPORT; resources restaurados |
| npm audit --omit=dev --json | histórico 35 moderate | fresco: exit 1, 35 moderate, 0 high/critical |
| npm audit --json | histórico 40 moderate | fresco: exit 1, 40 moderate, 0 high/critical |

Comandos: ./node_modules/.bin/tsc --noEmit -p tsconfig.node.json; equivalente renderer con src/renderer/tsconfig.json; ESLint con config/eslint.config.mjs src --format json; Vitest con config/vitest.config.ts --maxWorkers=2; npm run build. Salidas filtradas, códigos reales preservados. Sin cambios en tsconfig/eslint/baselines/paquetes, sin nuevos skips/supresiones. Sin procesos persistentes iniciados. NUL=1 antes del commit; diff --check limpio.

Delta de producto: cuatro archivos; docx-zip.ts, ambos escritores XLSX y fixture OOXML. Documentación: este checkpoint y enlace HANDOFF. Clasificación IPC sin cambios: 201/220/22/30 =473 según inventario anterior, no nueva auditoría de esos handlers.

## Aceptación y continuación

| Superficie | NIVEL 1 | NIVEL 2 | NIVEL 3 |
|---|---|---|---|
| XLSX N+2c | Validación, límites y fixtures discriminantes verdes | Escritores reales+ZIP/ExcelJS filesystem y reapertura probados; no aceptación UI/Electron/LOK | No ejecutado |
| PPTX/IPC/voz | Sin cambios; no recertificados por auditoría específica | Suite existente ejecutada; no afirmar nueva aceptación de sistema | No ejecutado |

Áreas aún sin revisar: presupuesto acumulado PPTX/DOCX y ODS; encoding XML; importación Office/LOK fuera de escritores cerrados; 220 canales IPC; projects dinámico/trusted controls; calendario fuzz; clientes OAuth dinámicos; replay index.ts; imágenes correo/SSRF; DNS rebinding; PTY/updater/Drive. Hallazgos anteriores cerrados no se reabren sin regresión.

Próximo contrato elegible P0: autorización de un módulo restante, preferentemente lok tras inspección de callers/privilegios, con propietario único de lok.ts, inventario IPC y fixture dedicado; null/parent/trusted, grants intactos, RED→FIX→GREEN→mutación y cinco gates completos. Alternativa de integridad: encoding y presupuesto acumulado PPTX en lote separado. No ampliar alcance silenciosamente.

Roadmap funcional no ejecutado: A1d→A2b→A2c (epoch main por lanzamiento, ack owner, preload por documento/secuencia y buffer acotado; ack tardío, stale epoch y reload misma URL), luego A3a/b→A6a/c→A7a/b. Completed-run por defecto; incremental/cloud opt-in. Sin scheduler in-process como evidencia live; ningún engine verified_offline sin pins/SHA-256 reales.

Placeholders pendientes: [PLACEHOLDER: autorización explícita de push / PR / merge en esta sesión]; [PLACEHOLDER: presupuesto máximo de tiempo y número de lotes]; [PLACEHOLDER: máximo de intentos por lote]; [PLACEHOLDER: entorno real objetivo para NIVEL 3]; [PLACEHOLDER: pesos/pins/SHA-256 reales de modelos de voz]; [PLACEHOLDER: credenciales y proveedores reales permitidos]; [PLACEHOLDER: autorización para descargas de binarios/modelos y efectos externos]. Se cerró un único lote seguro sin asumir permisos ilimitados.

HEAD final se obtiene con git rev-parse HEAD (commit que contiene este documento); comprobar árbol con git status --porcelain. Sin push.
