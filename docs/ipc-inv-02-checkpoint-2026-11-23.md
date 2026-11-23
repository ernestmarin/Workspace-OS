# IPC-INV-02 — remediation of the independent Red/Blue follow-up

- **Date:** 2026-11-23
- **Branch:** `arena/266560cc-workspace-os`
- **Base:** `731ba9d41467121c44bc724996cfdb34a7815e2e` (merge of PR #27)
- **Scope:** R-001 through R-004 from the read-only follow-up of IPC-INV-01
- **Required / demonstrated acceptance:** NIVEL 1 / **NIVEL 1**; remote CI execution remains pending publication
- **Review independence:** Red and Blue are a second pass by the same agent, not an independent review.

## 1. Remediation contract

| Field | Contract |
| --- | --- |
| Observable result | Make the delivered delta independently comparable; make the IPC inventory detect duplicate registry declarations and prove both ends of push/response directions; make the required local gates reproducible; add a pull-request gate |
| Allowed files | `src/main/ipc-surface.test.ts`, `package.json`, `.github/workflows/pull-request.yml`, this checkpoint, `docs/HANDOFF.md` |
| Excluded | runtime IPC behavior, channel APIs, handler authorization, dependency upgrades, application features |
| Protected behavior | 473 declarations = 443 invoke + 29 push + 1 fire-and-forget; both registration forms; no unresolved constants, literals, duplicates or preload orphans; all existing handlers and listeners remain unchanged |
| Acceptance | focused RED-by-mutation/GREEN; two TypeScript projects; baseline typecheck; full lint; full Vitest; build; audits; NUL and clean generated bundles |

## 2. Findings and disposition

| ID | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| R-001 | Shallow checkout prevented reconstruction of the delivered delta | **RESOLVED** | `git fetch --unshallow origin`; both parent objects now exist; `a74ce24..729f91a` is exactly the three declared files; source and merge trees are both `56a07f17f107702551071b9d3f4a2fc321d3850e` |
| R-002 | Required controls were not reproducible and canonical lint had no passing project command | **RESOLVED LOCALLY** | dependencies installed and rebuilt for ABI 127; all gates below ran; `npm run lint` now supplies the required parser stack without weakening rules; PR workflow added. Remote workflow execution is pending publication |
| R-003 | `Map` construction hid duplicate registry names/values | **RESOLVED** | raw `declarationEntries` are retained and their length must equal both maps; M2 inserts a duplicate channel value and the new test fails |
| R-004 | Push membership did not prove an emitter, preload listener or cleanup | **RESOLVED STRUCTURALLY** | each of 29 pushes must have a recognized main emission, `ipcRenderer.on`, and matching `removeListener`; fire-and-forget responses must have preload `send` and main `on`; M3–M6 detect each missing edge |

The R-004 control remains deliberately structural. It proves source wiring, not
that Electron delivered an event at runtime. Runtime Electron was outside this
batch and is not claimed.

## 3. Implementation and evaluator integrity

`src/main/ipc-surface.test.ts` now keeps the raw registry extraction instead of
constructing maps directly. The one-to-one assertion therefore sees information
a `Map` would discard. Main source is scanned once for the established emission
forms (`WebContents.send`, `sendToWindow`, and the scoped speech `send`), avoiding
per-channel rescans. Preload must both subscribe and return a matching cleanup.

`package.json` makes the supported lint command explicit:

```
node --stack-size=20000 ./node_modules/eslint/bin/eslint.js --config config/eslint.config.mjs src
```

This changes only process stack capacity. It does not disable a rule, exclude a
file, suppress a diagnostic or change the lint configuration.

`.github/workflows/pull-request.yml` runs on `pull_request` with read-only
contents permission, one cancellable job, Node 22, `npm ci --ignore-scripts`,
Node-native rebuild, both `tsc` projects, baseline typecheck, `npm run lint`, and
full Vitest with two workers. YAML was parsed locally with `js-yaml`; remote
execution cannot exist until the branch is published and a PR is opened.

## 4. RED-by-mutation and restoration

The production tree was green before each mutation. Mutations were temporary and
restored before the next check.

| Mutation | Removed protection | Detection | Result |
| --- | --- | --- | --- |
| M2 | duplicate registry value under a second constant | `keeps registry constant names and channel values one-to-one` | failed; the downstream emitter check also rejected the overwritten alias |
| M3 | main emitter for `agent:action-invoke` | push wiring test: `has no main emitter` | 1 failed / 11 passed |
| M4 | preload `on` listener | push wiring test: `has no preload listener` | 1 failed / 11 passed |
| M5 | returned `removeListener` cleanup | push wiring test: `listener cannot be removed` | 1 failed / 11 passed |
| M6 | main `on` listener for `agent:action-result` | fire-and-forget test: `has no main listener` | 1 failed / 11 passed |

During the first mutation script, two different files named `index.ts` were
backed up to the same scratch basename. The collision was detected before M5;
all four temporary product files were restored explicitly from Git, the focal
suite returned 12/12, and the remaining mutations used unique scratch names.
This was a harness defect, not a product failure, and no mutation survived.

## 5. Final gates

Environment: Node `v22.22.3`, npm `10.9.8`, ABI `127`; native modules rebuilt
with `npm_config_nodedir=/usr/local npm run rebuild:node`.

| Control | Result | Exit | Verdict |
| --- | --- | ---: | --- |
| Focused IPC inventory + authorization | 2 files, 23 tests passed | 0 | PASÓ |
| `tsc --noEmit -p tsconfig.node.json` | 0 diagnostics | 0 | PASÓ |
| `tsc --noEmit -p src/renderer/tsconfig.json` | 0 diagnostics | 0 | PASÓ |
| `npm run typecheck` | clean against baseline 0 | 0 | PASÓ |
| old direct ESLint invocation | 1038 files; stack overflow in untouched `lokMacros.ts` | 1 | environment discriminator |
| `npm run lint` | 1038 files, 0 errors, 0 warnings | 0 | PASÓ |
| Full Vitest | 385 passed + 3 skipped files; **5080 passed + 26 skipped tests** | 0 | PASÓ |
| `npm run build` | success; no `INEFFECTIVE_DYNAMIC_IMPORT` | 0 | PASÓ |
| Production audit | 35 moderate; 0 high/critical | 1 | known debt; security threshold met |
| Full audit | 40 moderate; 0 high/critical | 1 | known debt; security threshold met |
| Integrity | baseline `{}`; NUL in `checkpoint.ts` = 1; generated bundles restored | — | PASÓ |

Delta from IPC-INV-01 by test identity: three named assertions were added to the
existing file (registry one-to-one, push endpoint wiring, response endpoint
wiring). No test was removed, renamed or skipped. Counts move from 5077 to 5080
passed; skips remain 26.

## 6. Red/Blue close and residual limits

- **Red:** R-003 and R-004 were real evaluator blind spots, not current channel
  miswirings. R-001 and R-002 were evidence/reproducibility blockers.
- **Blue:** the complete Git history confirms the original three-file delta and
  identical source/merge trees. Current controls independently reproduce the
  inventory and gates. Mutations prove the new assertions are sensitive.
- **Compliance:** cumple for the remediation contract.
- **Coverage:** complete for static IPC direction inventory and local gates;
  partial for delivery integration until the workflow runs remotely.
- **Acceptance:** NIVEL 1 locally accepted. No Electron runtime or NIVEL 3 claim.

Remaining actions are operational rather than unimplemented code: publication,
opening a PR, and observing the new workflow require explicit external-action
authorization. Dependency moderate advisories remain accepted debt under
`SECURITY.md`'s 0-high/0-critical threshold and were not upgraded in this batch.
