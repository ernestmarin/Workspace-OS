# IPC-INV-01 — complete and falsifiable IPC direction inventory

- **Date:** 2026-11-23
- **Branch:** `arena/0b84f054-workspace-os`
- **Entry/base:** `a74ce2496ef83d239813768a5d2dab2a928d63a4` (`origin/master`; shallow checkout)
- **Required / demonstrated acceptance:** NIVEL 1 / **NIVEL 1**
- **Review independence:** Red and Blue were performed by the same agent; this is a non-independent self-review.

## 1. Batch contract (v1, fixed before editing)

| Field | Contract |
| --- | --- |
| ID / owner / observable result | IPC-INV-01 / session agent / every registry channel is classified exactly once as invoke, main→renderer push, or renderer→main fire-and-forget response |
| Allowed files | `src/main/ipc-surface.test.ts`; this checkpoint; `docs/HANDOFF.md` |
| Excluded | handler authorization, runtime IPC behavior, preload API changes, `.github/`, dependencies, voice, Office, releases |
| Dependencies/shared resources | existing source scanner and regexes; serialized dependency rebuild/build; no external service |
| Protected invariants | both registration forms remain scanned; unresolved constants, literals, duplicate registrations and preload orphans stay rejected; a declared channel cannot be absent from or overlap inventory classes |
| Fixture / legitimate control | real repository source; all 443 real invoke handlers and the 29 known push channels remain accepted, not a mocked scanner |
| Gates | focal RED/GREEN/mutation; two `tsc`; baseline typecheck; ESLint canonical plus environment discriminator; full Vitest; build; audits; integrity checks |
| Budget / retries | mission limits and retry maximum remain unspecified placeholders; one hypothesis-driven attempt was sufficient |
| Exit / recovery | exit when the new invariant catches the known gap, the corrected inventory totals 473, and final gates are recorded; restore generated bundles selectively and restore any mutation by saved hash |

The acceptance criterion was intentionally tightened: the prior tests only proved
registered⇒declared and preload-invoked⇒handled/exception. They did not prove
that every declaration had an inventory class.

## 2. REVIEW → INVESTIGATE → PLAN

The inherited scanner still recognizes both `ipcHandle(...)` and
`ipcMain.handle(...)`. Re-derivation at entry reproduced 473 declarations, 443
registration sites / 443 distinct invoke channels, 28 listed push channels and
one fire-and-forget response. `agent:action-invoke` was the sole declaration not
accounted for. Code inspection confirms the direction already recorded in the
previous checkpoint: main sends it and preload listens; it is not invoked.

Plan: first add only the reverse completeness assertion and capture a RED; then
classify the known channel as push; finally prove the assertion is sensitive by
removing that classification temporarily.

## 3. RED → FIX → GREEN → mutation

- **Before:** focal file 8/8 passed, exit 0.
- **RED:** new test `accounts for every declared channel in exactly one IPC direction`
  failed alone, reporting exactly `['agent:action-invoke']`; 8 passed / 1 failed,
  exit 1. This failed on the intended inventory invariant, not the harness.
- **FIX:** added `agent:action-invoke` to `MAIN_PUSH_CHANNELS`. The assertion
  counts memberships rather than testing only union inclusion, so overlap also
  fails.
- **GREEN:** focal file 9/9 passed, exit 0.
- **M1:** temporarily removed only `agent:action-invoke` from the push set. The
  new test failed alone with the same diagnostic; 8 passed / 1 failed, exit 1.
  Restoration SHA-256 before/after:
  `b2b686a33ba03039b83b6ad2210cb26cc379697533c333128e227b32eef2a774`.

Final mechanical inventory:

| Measure | Before | After |
| --- | ---: | ---: |
| Declared | 473 | 473 |
| Registration sites / distinct invoke channels | 443 / 443 | 443 / 443 |
| Listed push channels | 28 | **29** |
| Listed fire-and-forget responses | 1 | 1 |
| Accounted exactly once | 472 | **473** |
| Wrongly accounted / duplicates / unresolved constants | 1 / 0 / 0 | **0 / 0 / 0** |

## 4. Final validation

Environment: Node `v22.22.3`, npm `10.9.8`, ABI `127`; native modules rebuilt
with `npm_config_nodedir=/usr/local npm run rebuild:node` before the suites.

| Gate | Result | Exit | State |
| --- | --- | ---: | --- |
| `tsc --noEmit -p tsconfig.node.json` | 0 diagnostics | 0 | APROBADO |
| `tsc --noEmit -p src/renderer/tsconfig.json` | 0 diagnostics | 0 | APROBADO |
| `npm run typecheck` | clean against baseline 0 | 0 | APROBADO |
| canonical ESLint, 1038 files | one fatal parser stack overflow in untouched `src/main/office/lokMacros.ts` | 1 | FALLIDO — CAUSA ENTORNO |
| ESLint with `node --stack-size=20000`, same 1038 files/config | 0 errors, 0 warnings | 0 | diagnostic evidence, not a replacement green |
| canonical ESLint, touched test | 1 file, 0 errors, 0 warnings | 0 | APROBADO |
| full Vitest | 385 passed + 3 skipped files; **5077 passed + 26 skipped tests** | 0 | APROBADO |
| `npm run build` | success; no `INEFFECTIVE_DYNAMIC_IMPORT` | 0 | APROBADO |
| `npm audit --omit=dev --json` | 35 moderate; 0 high/critical | 1 | FALLIDO — deuda conocida |
| `npm audit --json` | 40 moderate; 0 high/critical | 1 | FALLIDO — deuda conocida |

Vitest delta by identity: one new named assertion in the existing file; no test
removed, skipped or renamed. Baseline was 385+3 files and 5076+26 tests; final is
385+3 and 5077+26. Build-regenerated `resources/wos-{collection,mcp-token,metric}`
bundles were restored selectively.

## 5. RED / BLUE verdict and acceptance

- **Red:** the old one-way invariants allowed a declared main→renderer channel to
  disappear from the hand inventory while the suite stayed green. Confirmed by
  prospective RED and M1.
- **Blue:** the reverse assertion closes that exact blind spot and also rejects
  overlapping classifications. Existing legitimate registrations remain green.
- **Discrepancy:** no unresolved discrepancy inside this batch. Review is not
  independent and no runtime Electron IPC was executed.
- **Compliance:** cumple for IPC-INV-01.
- **Coverage:** complete for static inventory direction classification; partial
  for IPC overall.
- **Acceptance:** NIVEL 1 accepted. NIVEL 2 runtime integration was not required;
  NIVEL 3 remains pending for the product.

## 6. Mandatory coverage matrix and unreviewed areas

| Area | Requirement / review | Evidence / simulated boundary | Pending acceptance |
| --- | --- | --- | --- |
| IPC/preload/owner/origin | Direction inventory plus reconciliation of current auth inventory; handler semantics not re-audited | real source scanner; authorization suite 11/11 | 16 documented verdict-B no-guard channels remain by decision; variants need evidence before reopening |
| Electron/window lifecycle | Not reviewed | none | runtime Electron/NIVEL 3 |
| Filesystem/symlinks/concurrency | Not reviewed | none | separate batches |
| ZIP/XML/Office/LOK | Not reviewed | none | residual A6 batches |
| Mail/HTML/Markdown/SSRF | Not reviewed | none | separate audit |
| OAuth/MCP/tokens | Not reviewed | none | real provider configuration and separate audit |
| Agent bridge/Drive/PTY/updater | Only `agent:action-invoke` direction classified | static source | runtime behavior and external binaries/providers |
| Voice/privacy | Not reviewed | none | roadmap and real device acceptance |
| Dependencies/packaging/CI/platforms | audits/build rerun; no migration or CI edit | local Linux build | advisories, authorized CI, multiplatform acceptance |
| Persistence/cancellation/idempotence/cleanup/recovery | Not reviewed | mutation recovery hash only | separate batches |
| Reachability from `App.tsx` | Not reviewed; no renderer feature changed | none | existing reachability controls remain, broader graph audit pending |

## 7. Residual risk and next safe action

IPC-INV-01 is resolved with evidence. It is not an authorization fix. During
checkpoint review, the mission's inherited **243 guarded / 178 no-guard / 22
grant** figure was disproved by the current authoritative test and code:
`src/main/ipc-authorization.test.ts` contains **405 MUST_HAVE_GUARD + 16
EXPLICITLY_NO_GUARD + 22 GRANT_CHECKED + 30 PUSH_CHANNELS = 473**, with 174
origin guards; its 11 tests pass. `docs/ipc-class-01-triage.md` records all 16 as
verdict B and zero verdict-A channels remaining. Therefore A3 has no currently
demonstrated module to modify; reopening one requires new code evidence, not the
stale count. The next eligible batch without new permission must be contracted
from B3/B4 or one A6 Office residual. A4 remains blocked on authorization to
modify `.github/`; B1 remains blocked on the product default decision. Push, PR,
merge and release were not authorized and were not attempted.
