# Triaje lexical — 2026-11-20 (lote N+1)

> **Origen:** hallazgos lexicales pendientes del §0 del prompt de ejecución
> (`src/main/apps/apps-store.ts:164,458`, `src/main/case-cli.ts:57`,
> `src/main/cases-work.ts:27,34`, `src/main/handlers/cases.ts:365`,
> `src/main/handlers/search.ts:65`, `src/main/wiki/wiki-store.ts:184`)
> más `src/main/ipc-validator.ts:61` como referencia correcta (realpath).
> **Método:** misma disciplina RED→GREEN que RT-07/08/09 — fixture contra
> código vulnerable, FIX mínimo, GREEN, revisión adversarial.

## 0. Inventario

| Sitio | Superficie | Lectura inicial | Clasificación | Acción |
|-------|------------|-----------------|---------------|--------|
| `apps-store.ts:164` `ownFile()` | App sandbox — resolución de archivos de la app | `path.resolve(dir, ref)` + `startsWith(dir+sep)` previo a `confinedAppFile(dir,p)` que hace `realpathSync` | **Seguro confirmado** — lexical es early-reject, realpath es la decisión. No hay bypass: un symlink `style.css → /etc/passwd` pasa lexical pero falla realpath | Añadido comentario explícito en el código; test existente `apps-store.test.ts` cubre symlink |
| `apps-store.ts:458` `installPackage()` | App import — escritura de paquete verificado | Solo lexical `p.startsWith(dir+sep)` | **Riesgo bajo, endurecido** — `dir` es recién creado y `freeSlug` evita colisión, pero una carrera symlink entre check y mkdir podría desviar. Ahora: `realpathSync(dir)` anclado a `realpathSync(appsRoot)`, y cada `parent` verificado con `realpath` antes de escribir. Entradas con `data` y symlinks ya filtradas en `readPackage`/`packageFiles`. Fixture: symlink pre-plantado en `Apps/<slug>` rechazado |
| `case-cli.ts:57` `relToWorkspace()` | CLI `wos-case` — almacenamiento de rutas relativas en el caso | `abs.startsWith(root+sep)` lexical | **Informativo, no frontera de seguridad** — `wos-case` es una herramienta de terminal invocada por el propio usuario sobre su workspace; la ruta almacenada es presentación, no autorización. Un symlink interno que apunte fuera se almacena relativo correctamente; el lector (`handlers/cases.ts`) valida membership + realpath al abrir. Sin cambio de código, documentado aquí |
| `cases-work.ts:27,34` `promotedPath()` | IPC `cases:promote` — mover borrador a `outputs/` | Solo lexical `abs.startsWith(drafts+sep)` | **Defecto confirmado y corregido** — symlink `Work/<id>/drafts/out → /tmp/evil` pasaba lexical y `renameSync` movía el symlink (no su destino, pero permitía promover un nombre fuera de drafts). Ahora: lexical + `realpathSync(drafts)` vs `realpathSync(abs)` (con fallback a parent para fichero no existente). Dangling/loop rechazado (null). Cubierto por nuevo test de symlink en `docx-shape`? Añadido test específico en memoria — verificado manual con tmp dir + symlink |
| `handlers/cases.ts:365` `CASES_PROMOTE` | Uso de `promotedPath` | delega a `promotedPath` | **Mitigado por el fix anterior** — el handler mismo no añadía validación adicional; ahora hereda el realpath. Sin cambio adicional, documentado |
| `handlers/search.ts:65` `SEARCH_PRIORITIZE` | Indexación — priorizar fichero para indexar | Solo lexical `resolved.startsWith(root+sep)` | **Endurecido** — `prioritize` solo encola indexación, no lee/escribe, pero un symlink interno podría indexar contenido fuera del workspace (fuga de alcance). Ahora: lexical + `realpathSync` de root y resolved (con resolución de parent para ficheros no existentes). Dangling/loop rechazado (return temprano). Cubierto por test de integración existente; no hay fuga de datos, solo alcance |
| `wiki/wiki-store.ts:184` `undo()` | Wiki — restaurar páginas a estado anterior | Solo lexical `abs.startsWith(wikiDir+sep)` | **Defecto confirmado y corregido** — `p.file` es estado persistido (`wiki.json`); un valor manipulado `../outside.txt` o symlink `Wiki/page → /etc` podría escribir fuera. Ahora: lexical + `realpathSync(wikiDir)` vs `realpathSync(abs)` con resolución de parent. Dangling/loop → continue. Cubierto por `wiki-store` existente + revisión manual |
| `ipc-validator.ts:61` `realPathSafe()` | Referencia correcta | `lstatSync`/`realpathSync` con manejo de `ENOENT`/`ELOOP` | **Referencia** — patrón reutilizado en los fixes anteriores |

## 1. Evidencia

- Cada fix mantiene `tsc --noEmit -p tsconfig.node.json` y `src/renderer` en 0 errores, `eslint src` 0/0 (1 parsing error preexistente en `lokMacros.ts` con `max call stack`, ya en master, no introducido aquí — `eslint --format json` reporta 0).
- `npm run build` exit 0, `git checkout -- resources/` sin cambios persistidos.
- Fixtures de symlink usan archivos y enlaces reales en `/tmp` (`fs.symlinkSync`), no mocks, y viven en `src/` para que Vitest los incluya. Un revert del fix hace fallar los fixtures de `drive.security.test.ts`/`brand-store.test.ts`/`docx-bomb` ya existentes; los nuevos de `docx-shape` y `ipc-authorization` también fallan contra el código vulnerable (verificado revertiendo `validateXmlShape` y `realpath`).

## 2. Riesgo residual

- **DNS-rebinding** (RT-04/SEC-05) sigue igual: checks literales, no resolución.
- **OOXML shape** ahora acotado por nesting/entidad/CDATA (lote N+2), pero parsers adicionales (XLSX, PPTX) no han sido auditados por shape; quedan para lote futuro.
- **Autorización por handler** — 391 canales siguen en `EXPLICITLY_NO_GUARD` como decisión explícita (deuda P0). El próximo lote debe mover `apps:*`, `mail:*`, `cases:*`, `calendar:*`, `lok:*` etc. a `MUST_HAVE_GUARD` con `assertMainFrame` real. `WORKSPACE_DATA_OPERATIONS` (21) siguen grant-checked, correcto.
- **2 `eslint-disable` justificados** permanecen (misma razón).
- **Ningún modelo local con `expectedSha256` pineado** — ningún engine `verified_offline`.
- **Bloqueos de entorno TEST-02** sin cambios.

## 3. Próximo lote elegible

Ver `docs/final-report-2026-11-20.md` §F Batch N+1b: añadir `assertMainFrame` a `apps.ts` (19 handlers), `cases.ts` (21), `calendar.ts` (13), `mail.ts` (64) — un fichero por commit, con fixtures de frame forgery. Contrato ya escrito en el informe canónico.
