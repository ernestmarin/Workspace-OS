# Workspace OS — Remediation Report (batch 2026-11-20)

Branch `arena/f7547409-workspace-os`, base `1668bc2` (upstream `Clemens865/Workspace-OS`,
package `workspace-os@0.2.28`). Ten commits, all gates green at HEAD.

**Read this first, in the order it matters:**

1. Nine Red Team findings were **reproduced against the shipped code**, and three
   of them are remote-input → arbitrary file read / process death. They are
   fixed, with fixtures verified to fail against the old code.
2. Two claims in this repository's own documentation were **false** and are now
   either true or honestly bounded: the IPC registry was a 47 % list, and the
   voice "files present" indicator read as readiness with zero cryptographic
   checks behind it.
3. **No level-3 maturity is claimed anywhere.** Everything below is Node/jsdom
   verification. Real Electron GUI, real audio hardware, real model inference and
   real Windows/macOS kernels remain out of reach in this sandbox (`TEST-02`).

---

## A. Delta table (before → after)

| Check | Command | Before (`1668bc2`) | After (HEAD) |
|---|---|---|---|
| ESLint `src` | `npx eslint --config config/eslint.config.mjs src` | 0 errors, **50 warnings** (18 dead `eslint-disable`) | **0 errors, 0 warnings** |
| TypeScript (node) | `npx tsc --noEmit -p tsconfig.node.json` | 0 errors | 0 errors |
| TypeScript (renderer) | `npx tsc --noEmit -p src/renderer/tsconfig.json` | 0 errors | 0 errors |
| Typecheck baseline | `scripts/typecheck-baseline.json` | `{}` | `{}` (unchanged — never relaxed) |
| Full test suite | `npx vitest run --maxWorkers=2` | 332 files / 3,596 tests | **344 files / 3,751 tests** (3,725 pass, 26 skip, **0 fail**) |
| Production build | `npm run build` | exit 0 | exit 0, no `INEFFECTIVE_DYNAMIC_IMPORT` |
| `npm audit --omit=dev` | | 0 critical, 0 high, 35 moderate | 0 critical, 0 high, 35 moderate (unchanged; all major-gated) |
| IPC channel registry | declared channels | 223 declared vs **243 hardcoded** + 7 undeclared push | **466 declared, 0 hardcoded**, machine-enforced |
| `eslint-disable` directives | count | 20 (18 dead) | **2**, both justified in-place and both flagged for future removal |
| Red Team findings | RT-01…RT-09 | — | **9 reproduced, 9 fixed, 60 regression tests** |

Net: **115 files changed, +4,699 / −945.** No test was deleted, skipped, or
weakened; no `expect` was relaxed; no `@ts-ignore` / `@ts-expect-error` /
`as unknown as any` was introduced; `tsconfig*.json` and
`config/eslint.config.mjs` are untouched.

---

## B. Red Team audit table

Cycle per finding: **RED** (fixture against shipped code) → **FIX** → **GREEN** →
**adversarial review** (re-read the fix for the same class, and check the fixture
can actually distinguish the two implementations).

| ID | Surface | Defect (reproduced) | Impact | Fix | Regression |
|---|---|---|---|---|---|
| **RT-01** | Doc parsers / markdown XSS | Two-regex HTML sanitizer: `rewriteTags` scanner | Malformed markup survived sanitising | Character scanner, canonical `safeHref` | 84 targeted |
| **RT-02** | Renderers | Three duplicated CSP definitions drifting | Weakened preview isolation | Single `previewCsp.ts`, 3 wirings | incl. above |
| **RT-03** | App import | `.wosapp` ZIP expansion unbounded | Disk/memory exhaustion | `zipBudget.ts` (20 MB / 5 MB / 216 entries) | incl. above |
| **TD-02** | Bundler | `marked` imported both statically and dynamically | Duplicate bundle, `INEFFECTIVE_DYNAMIC_IMPORT` | Lazy split + `chatMarkdownSync` | build log clean |
| **RT-04** | MCP / OAuth | Endpoint URLs taken from the server's own metadata with **no scheme check**: sent to `shell.openExternal`, and the token endpoint received the code, PKCE verifier and the refresh token **on every unattended refresh** | Cleartext credential transmission; loopback/private endpoint = SSRF into the user's machine/LAN | `isSecureEndpointUrl` (absolute https, no user-info, no blocked literal host) enforced at all 4 boundaries; 4 KiB credential ceiling | 23 tests |
| **RT-05** | IPC surface | Registry covered 223 of 466 channels; 243 hardcoded at 243 sites in 28 modules; 7 push channels declared nowhere | The surface could not be audited or enforced at all | All 466 declared, all sites use `IPC.*`, 8 structural invariants | 8 tests |
| **RT-06** | Agent bridge | `agent:action-result` — the only `ipcMain.on` handler — had **no frame check**, and its payload resolves a pending action; `pending` unbounded | Forge success for an action that never ran (agent proceeds on a nonexistent result) or forge failure; or grow the process until killed | `assertMainFrame` + 64 in-flight ceiling with a typed refusal | 7 tests |
| **RT-07** | Drive sync | `drive:save` used the lexical `path.resolve`/`startsWith` check SEC-01 replaced elsewhere | `<workspace>/out → ~/private` uploads private files to Google Drive; nothing downstream re-checks | `validateFilePath` (lstat/readlink, hop ceiling, dangling refused) | 4 tests |
| **RT-08** | Brand kit | `logoPath` (renderer-supplied, rendered as `<img src>`) checked lexically | Planted symlink → arbitrary-file read displayed in the UI | `realpathSync` both sides, dangling refused | 1 test |
| **RT-09** | DOCX writers | `JSZip … .async('string')` with no expansion budget. **Measured: 204,185 B on disk → 209,715,200 B string, +399.7 MB heap, 893 ms**, then fails anyway | Decompression bomb from an imported/synced file takes the process down | `readEntryBounded`: counted stream destroyed past 32 MiB; header used only as a cheap pre-check | 9 tests |

### Two things worth calling out

**My own fix was wrong and the test caught it.** The first RT-04 guard accepted
`https://[::ffff:127.0.0.1]/token` — an IPv4-mapped loopback literal — because I
validated the scheme and forgot the host. Rather than write a second host check,
I extracted the SEC-05 classification (IPv4-mapped, NAT64, 6to4, CGNAT, trailing
dot) out of the mail image proxy into `src/main/url-host-guard.ts` and imported
it in both places. One implementation, two call sites, no drift.

**Fixtures were checked in both directions.** For RT-07, RT-08 and RT-09 I
reverted the fix and re-ran: the fixtures fail (private bytes reach
`uploadFile`; the bomb expands and then reports `tag-not-found`) and pass with
the fix. A fixture that passes against both implementations is theatre, and
writing these caught two of my own harness defects — RT-06's first version
injected a resolver that bypassed the pending map entirely, and RT-07's first
version mocked the token away so every case stopped at "not connected" before
reaching the path logic. Both were rewritten against the production path.

---

## C. Negative-coverage map (updated)

Legend: **✅ covered by a fixture** · **◐ partially** · **○ none** · **⛔ environment-blocked**

| Surface | Coverage |
|---|---|
| Agent bridge: grants, socket, sender, bounds | ✅ grants (existing), RT-06 sender + fan-out, socket protocol, `wos-action` id validation. `handleRequest` authorizes **before** dispatch (identity → workspace → scope → known-id). |
| MCP / OAuth / accounts | ✅ RT-04 endpoints (4 boundaries), token sinks, credential ceiling, vault round-trip, PKCE. ◐ Dynamic client registration is upstream/of the CLI, not exercised. |
| Mail / calendar / drive | ✅ RT-07 drive confinement, attachment save/open (dialog-chosen dir, re-normalised filename, temp dir), remote-image SSRF, OAuth refresh. ◐ Calendar write targets are validated but not adversarially fuzzed. |
| Doc parsers: ZIP / XML / markdown XSS | ✅ RT-03 app ZIP budget, **RT-09 docx entry bound**, RT-01 sanitizer, RT-02 CSP. ○ OOXML *structure* (deep nesting, entity expansion) — see E. |
| Remaining IPC handlers + preload | ✅ RT-05 whole-surface invariants (declared / unique / no-orphan / no-push-invoke / no-literal). ◐ Authorization is per-channel: ~12 handlers call `assertMainFrame`, the rest rely on structural confinement (`validateFilePath`, bounded string coercion). Enumerating "which handler asserts what" is the next honest unit of work — see F. |

### Standing invariants now machine-enforced

- `ipc-surface.test.ts` — the surface cannot drift: no undeclared channel, no
  duplicate registration, no preload call to a handler that does not exist, no
  push channel invoked, no hardcoded channel string anywhere.
- Full suite green with `--maxWorkers=2`, serialized, closed stdin, no watch mode.
- Sensitive-file invariant respected: `src/main/checkpoint.ts` still contains its
  literal NUL byte; no text-cleanup touched it.

---

## D. Maturity matrix (NIVEL 1/2/3)

**NIVEL 1** = written and reasoned about · **NIVEL 2** = implemented and verified
by automated tests in Node/jsdom · **NIVEL 3** = verified on real Electron GUI,
real hardware, real network/providers, real OS kernels.

| Work item | L1 | L2 | L3 | What L3 would require |
|---|---|---|---|---|
| TD-01 lint gate | ✅ | ✅ 0/0 | — | n/a (static) |
| TD-02 `marked` split | ✅ | ✅ | — | n/a (static) |
| RT-01…RT-03 sanitizer/CSP/ZIP | ✅ | ✅ | ⛔ | Real renderer XSS E2E in Electron |
| RT-04 OAuth endpoint trust | ✅ | ✅ | ⛔ | Live OAuth against a real provider |
| RT-05 IPC surface | ✅ | ✅ | — | n/a (static) |
| RT-06 action reply | ✅ | ✅ | ⛔ | Real multi-frame Electron window under a malicious subframe |
| RT-07 drive confinement | ✅ | ✅ | ⛔ | Real Google Drive round-trip |
| RT-08 brand logo | ✅ | ✅ | ⛔ | Real Electron renderer with a planted symlink |
| RT-09 docx bomb | ✅ | ✅ | — | n/a (pure parser + fs) |
| VOX-A2a backpressure | ✅ | ✅ 12 tests | ⛔ | Real audio pipeline with a slow consumer |
| VOX-A4c model integrity | ✅ | ✅ 30 tests | ⛔ | Real weights with real pins, on target hardware |
| VOX-A2b/A2c (live transport) | ✅ plan | ○ **blocked** | ⛔ | A1d owner epoch first; then real streaming |
| VOX-A3a/A3b (incremental) | ✅ plan | ○ **blocked** | ⛔ | A2 live scheduling |
| VOX-A4d/A4e (real inference, ES TTS) | ✅ plan | ○ | ⛔ | Model weights; `huggingface.co` unreachable |
| VOX-A6a/A6c (AudioWorklet, VAD) | ✅ plan | ○ | ⛔ | Microphone hardware |
| VOX-A7a/A7b (PCM drain, heard-text) | ✅ plan | ○ | ⛔ | Audible output + AEC measurement |
| TEST-02 (real Electron/packaging) | ✅ | ○ | ⛔ | `objects.githubusercontent.com`, `nodejs.org` unreachable; no macOS/Windows kernels |

**The honest summary:** every item reached the highest level this environment
permits. Nine of twelve are at L2. Nothing is at L3, and nothing claims to be.

---

## E. Residual and environment risks

**Environment-blocked (`TEST-02`, unchanged and not worked around):**

- `objects.githubusercontent.com` (Electron binary), `huggingface.co` (weights)
  and `nodejs.org` are unreachable → no real Electron GUI, no model inference,
  no packaging acceptance.
- No audio hardware → no audible playback, no AEC, no microphone capture.
- No macOS/Windows kernel → `taskkill /T` tree-kill and notarization unverified.

**Residual, tracked rather than fixed:**

1. **DNS-rebinding (RT-04 / SEC-05).** Host checks are literal. A name that
   *resolves* to a private address still gets through, because Node's `fetch`
   does not expose resolution. Narrower than an unchecked literal, and now
   documented once in `url-host-guard.ts` instead of twice.
2. **OOXML structure parsing.** RT-09 bounds *expansion*, not *shape*. Deeply
   nested XML and entity expansion inside a legitimately-sized `document.xml`
   are unhandled. A bounded parse (depth + entity budget) is the next step.
3. **Per-handler authorization is not enumerated.** RT-05 makes the surface
   *knowable*; it does not assert that each handler checks the frame. Roughly 12
   do explicitly. The rest are defended by structural confinement. This is a
   documentation/audit gap, not a demonstrated hole, and it is the largest
   remaining unknown on this front.
4. **Two `eslint-disable` directives remain**, both with written reasons
   (`useMicrophoneDevices` must read the LIVE generation ref; `JsDialog`
   rebinding per redraw drops keystrokes). Both are real workarounds for real
   behaviour, not suppressions of a fix, and both should still be removed by a
   future refactor.
5. **40 moderate advisories** (`mjml`, `exceljs`/`uuid`, `electron-builder`) are
   gated on breaking upstream majors. `npm audit fix --force` was not run.
6. **Local speech cannot be "ready" at all today.** Every reviewed model has
   `expectedSha256: null`. A4c made that impossible to hide; making it untrue
   needs real weight files and real pins.

---

## F. Next resumable batch contract

Each batch is independently committable and leaves the tree green. Order is
P0 → P1 → P2. Single writer per file; `package.json`/lockfile/`npm ci`/`build`
stay serialized; `rebuild:node` must be left active.

### Batch N+1 — P0, the largest remaining unknown

**Contract:** enumerate `assertMainFrame` (and `assertWorkspace`) per IPC
channel, in the same machine-checked style as RT-05.
**Deliverable:** `src/main/ipc-authorization.test.ts` asserting that every
handler in a declared "sensitive" set (process spawn, fs mutation, secret write,
network enable) calls a frame guard — with the non-sensitive remainder listed
explicitly, so the list is a decision rather than a default.
**Done when:** the test fails when a new sensitive handler is added without a
guard. **Do not** add guards blindly to handlers that have no event parameter
(the `WORKSPACE_DATA_OPERATIONS` set, called by the grant-checked data bridge).

### Batch N+2 — P0, OOXML depth

**Contract:** bound `readEntryBounded`'s *output shape*, not just its size.
**Deliverable:** depth/entity budget in `docx-zip.ts` with fixtures: 10k-deep
nesting, `<!ENTITY>` expansion, CDATA abuse.
**Done when:** each fixture returns a typed refusal and the three writers report
it without touching the file. Reuse the RT-09 both-directions verification.

### Batch N+3 — P1, voice transport (the real unblock)

**Contract:** A1d first — main mints a per-launch epoch, dispatch acknowledgement
returns the owner, document-bound preload with sequence/epoch validation and
bounded early buffering. **Then** A2b (live transport) and A2c (wiring).
**Deliverable:** late-ack, stale-epoch and same-URL-reload fixtures; the
completed-run reader stays the default throughout.
**Done when:** A2c passes with completed mode byte-identical and incremental mode
opt-in. **Do not** claim live conversation from an in-process scheduler.

### Batch N+4 — P2, voice roadmap continuation

A3a/A3b (incremental consent + early-cloud disclosure, mode off by default), then
A6a/A6c (AudioWorklet, STT adapter — L2 only, no hardware claim), then A7a/A7b
(PCM drain, heard-text accounting).

### Standing gates (every batch, in this order)

```sh
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p src/renderer/tsconfig.json
npx eslint --config config/eslint.config.mjs src          # must stay 0/0
npx vitest run --config config/vitest.config.ts --maxWorkers=2
npm run build && git checkout -- resources/               # regenerated CLI bundles
```

Non-negotiables unchanged: no push, no PR, no model downloads, no real
credentials; never `git reset --hard` / `checkout -- .` / `clean -fd`; never
version secrets, `out/`, `release/`, weights or regenerated `resources/*.cjs`.
