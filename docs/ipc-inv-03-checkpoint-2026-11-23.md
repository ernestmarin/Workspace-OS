# IPC-INV-03 — close Red/Blue reservations R-005 through R-008

- **Date:** 2026-11-23
- **Branch:** `arena/f714c4a4-workspace-os`
- **Base:** `b1137e029662daadc8da928316d8f2f93346b36c` (merge of PR #28)
- **Scope:** R-005, R-006, R-007, R-008 and the CI build reservation from the IPC-INV-02 follow-up
- **Acceptance required / demonstrated:** NIVEL 1 / **NIVEL 1 locally**; remote workflow pending this branch's PR
- **Review independence:** Red and Blue are a second pass by the same agent, not an independent review.

## 1. Contract

| Field | Contract |
| --- | --- |
| Observable result | Remove lexical false positives from IPC direction wiring; make listener cleanup identity-sensitive; run macro and build gates in PR CI; pin the PR runner/toolchain inputs; reconcile stale delivery documentation |
| Allowed files | `src/main/ipc-surface.test.ts`, `.github/workflows/pull-request.yml`, `docs/ipc-inv-02-checkpoint-2026-11-23.md`, this checkpoint, `docs/HANDOFF.md` |
| Excluded | application IPC behavior, channel APIs, handler authorization, dependency upgrades, other workflows |
| Protected behavior | 473 declarations, 443 invoke, 29 push, 1 fire-and-forget; all real emitters/listeners unchanged; existing gates remain mandatory |
| Exit | M7/M8 detected and restored; focused/full suites and gates pass; workflow parses and mirrors the local command sequence; generated bundles remain clean |

## 2. Findings closed

| ID | Finding | Remediation | Status |
| --- | --- | --- | --- |
| R-005 | Handoff/checkpoint still described PR #28 CI as pending | Added a dated post-integration correction to IPC-INV-02 and made this checkpoint current | **RESOLVED** |
| R-006 | Wiring regex accepted comments, arbitrary `.send`, and unrelated cleanup handlers | Replaced lexical matching with the TypeScript AST; emitters are limited to WebContents/scoped wrappers; `on` and returned `removeListener` must share channel and handler identity | **RESOLVED STRUCTURALLY** |
| R-007 | PR workflow bypassed package `pretest` macro validation | Added an explicit `npm run check:macros` step before Vitest | **RESOLVED** |
| R-008 | Runner, Node and action tags floated | Pinned `ubuntu-24.04`, Node `22.22.3`, checkout SHA `11d5960…` and setup-node SHA `49933ea…` with version comments | **RESOLVED** |
| CI-BUILD-01 | Build remained local-only | Added `npm run build` to the ephemeral PR job | **RESOLVED** |

The AST control is still a static control. It rejects comments and unrelated
`.send` methods and correlates listener cleanup, but does not claim Electron event
delivery or runtime reachability.

## 3. Implementation details and legitimate controls

`ipc-surface.test.ts` parses each production TypeScript file with the project
TypeScript compiler. A main emission is accepted only when its first argument is
`IPC.NAME` and the callee is one of:

- `sendToWindow(...)`;
- the scoped speech `send(...)` wrapper;
- `.send(...)` on `contents`, `senderContents`, or an expression ending in
  `.webContents`.

Preload subscriptions are inspected per function. A channel is counted only when
that function calls `ipcRenderer.on(IPC.NAME, handler)` and returns cleanup that
calls `ipcRenderer.removeListener(IPC.NAME, handler)` with the same handler text.
Comments do not enter the AST. Synthetic legitimate controls prove that comment-
only calls, arbitrary `fake.send`, and a mismatched cleanup handler are rejected.
All 29 real push channels and the response pair remain accepted.

The PR workflow retains `contents: read`, cancellation by PR, no install scripts,
explicit Node-native rebuild, two `tsc` projects, baseline typecheck, lint and
full Vitest. Macro validation and build are now first-class steps. The action
SHAs were resolved from the upstream `v4` refs on 2026-11-23.

## 4. RED-by-mutation

| Mutation | Change | Expected detector | Observed |
| --- | --- | --- | --- |
| M7 | replace the real `agent:action-invoke` send with an identical comment | push wiring AST control | `has no main emitter`; 1 failed / 13 passed |
| M8 | cleanup removes `otherHandler` instead of the subscribed `handler` | handler-correlated cleanup control | `has no removable preload listener`; 1 failed / 13 passed |

Both mutated product files were restored from unique scratch paths. SHA-256 was
identical before/after for `actionBridge.ts`
`e812862d2729da585617e032ae3f7f1f4526cf2a73423dbc6a1a44c94a061b47` and
`preload/index.ts`
`769cd6b56a8d0b08e4f5890801e0f12d8eb64eed8e3994334c05fdb540dc595a`.

## 5. Gates

Environment: Node `v22.22.3`, npm `10.9.8`, ABI `127`; native modules rebuilt
with `npm_config_nodedir=/usr/local npm run rebuild:node`.

| Control | Result | Exit | Verdict |
| --- | --- | ---: | --- |
| Focused inventory + authorization | 2 files, 25 tests | 0 | PASÓ |
| `tsc --noEmit -p tsconfig.node.json` | 0 diagnostics | 0 | PASÓ |
| `tsc --noEmit -p src/renderer/tsconfig.json` | 0 diagnostics | 0 | PASÓ |
| `npm run typecheck` | clean against baseline 0 | 0 | PASÓ |
| `npm run check:macros` | Module1 47279; Module2 43903; both below 63000 | 0 | PASÓ |
| `npm run lint` | 1038 files, 0 errors, 0 warnings | 0 | PASÓ |
| Full Vitest | 385 passed + 3 skipped files; **5082 passed + 26 skipped tests** | 0 | PASÓ |
| `npm run build` | success; no `INEFFECTIVE_DYNAMIC_IMPORT` | 0 | PASÓ |
| Workflow parse | PR trigger, read-only permissions, pinned runner/Node/actions, 11 steps | 0 | PASÓ locally |
| Production audit | 35 moderate, 0 high/critical | 1 | known accepted debt |
| Full audit | 40 moderate, 0 high/critical | 1 | known accepted debt |
| Integrity | baseline `{}`; NUL=1; generated bundles restored | — | PASÓ |

Test delta by identity: two tests added (`ignores commented and unrelated…`,
`requires the returned cleanup…`); no removal, rename or skip. Passed tests move
from 5080 to 5082 and skips stay 26.

## 6. Blue close and residual limits

- **Blue:** the synthetic controls distinguish executable AST calls from the
  exact comment/arbitrary-send false positives demonstrated by Red. M7 and M8
  independently prove emitter and cleanup sensitivity.
- **CI:** local execution reproduces every command now listed in the workflow.
  Remote acceptance remains pending until this branch is published and its PR
  runs; no remote success is claimed here.
- **Coverage:** complete for the contracted static wiring and PR gate contents;
  no runtime Electron, cross-platform, event-delivery, NIVEL 2 or NIVEL 3 claim.
- **Acceptance:** NIVEL 1 locally accepted.

No known recommendation from R-005 through R-008 remains unimplemented. External
publication, PR creation and observation of the new workflow are operational
postconditions and require the user's explicit request.
