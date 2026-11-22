# IPC-SPEECH-02 checkpoint — the last verdict-A cluster was already guarded; the inventory could not see it · 2026-11-21

**Batch:** IPC-SPEECH-02 (P0, IPC authorization). Twenty-seven handlers in
`src/main/speech/handlers.ts`, plus two further repairs to the inventory scanner.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/c34cb1fb-workspace-os` / `653cd0f` (IPC-BROWSER-02).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **SPEECH-01** | Audit false positive — **the expected finding of the batch is that there was nothing to fix** | Confirmed | All twenty-seven `speech:*` handlers **already verify the caller**. Each starts with the module's own `assertOwner(event)`, which is `documentFor(assertWorkspace(event))`; `assertWorkspace` calls `assertMainFrame(event)` and then requires `event.sender === mainWindow().webContents` **and** `event.senderFrame === mainWindow().webContents.mainFrame`. The IPC-CLASS-01 triage listed these channels as verdict A ("no origin check") because the inventory's snippet heuristic recognised `assertWorkspace(` but **not the wrapper name the handlers actually call**. Twenty-seven guarded channels were therefore tracked as unguarded debt. |
| **SPEECH-02** | Second scanner blind spot | **Confirmed and repaired** | The scanner's registry pattern required the `IpcMain` parameter to be named `ipcMain`: `/ipcHandle\(\s*ipcMain\s*,\s*IPC\./`. `speech/handlers.ts` registers as `ipcHandle(ipc, IPC.SPEECH_X, …)`, so its handlers had **no snippet at all** and were indistinguishable from `PUSH_CHANNELS`. The pattern now accepts any identifier as the parameter, and a test asserts the speech file is scanned. |
| **SPEECH-03** | Naming is not a guard | Confirmed | Accepting `assertOwner(` in the inventory is only legitimate because a test **pins the definition**: `assertOwner` must be `documentFor(assertWorkspace(event))`, and `assertWorkspace` must contain `assertMainFrame(event)` and both identity comparisons. Without that pin the name would be a promise, not a mechanism — the reason the fix ships with a source-level test rather than a string in an allowlist. |

**What this batch changes about every earlier number:** the remaining-verdict-A
count was never 23. It was **0**. The twelve batches of this series each ended
with a count derived from `EXPLICITLY_NO_GUARD` minus the B labels, and that set
was inflated by two scanner blind spots (SPEECH-02 here, HIST-02 in
IPC-HIST-01). The **channel list** was always right — `ipc-channels.ts` is parsed
independently and the exhaustiveness test held throughout — but "which channels
had been examined" was wrong, and the triage inherited it.

## 2. Change

| File | Change |
| --- | --- |
| `src/main/speech/handlers.ts` | **No production change.** Twenty-seven handlers already call `assertOwner` first. |
| `src/main/speech/handlers.authorization.test.ts` | **new**: 137 tests — 27 channels × 4 unauthorized callers (missing frame, child frame, foreign sender, foreign top-level frame), 27 owner controls asserting the store/engine was reached and the advertised result, plus three source-level invariant tests (the wrapper definition, `assertWorkspace`'s body, and that all 27 handlers call it). |
| `src/main/ipc-authorization.test.ts` | `assertOwner(` recognised as an origin guard **with the pinning test named in a comment**; registry regex generalised to any parameter name; the scanner test extended to assert `speech/handlers.ts` is scanned. 27 channels moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **174**. |

The suite is behavioural first: the four refusal rows are the *measurement*, and
the source-level tests exist to keep the name `assertOwner` honest.

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … speech/handlers.authorization.test.ts` (first draft, guard family unchecked) | draft | 1 | 135 failed — the fixture's own faults, recorded below |
| S2 | same | final | 0 | **GREEN**: 137/137, including 27 refusal rows × 4 and 27 controls |
| S3 | mutation M45 (remove `assertOwner` from `speech:set-key`) | mutated | 1 | **7 failures**: 4 refusals + the source invariant + the two inventory tests |
| S4 | mutation M46 (revert the registry regex to a literal `ipcMain`) | mutated | 1 | **3 failures** — the inventory can no longer see twenty-seven channels |
| S5 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| S6 | full ESLint JSON over `src` | final | 0 | 1018 files, 0 errors / 0 warnings |
| S7 | full suite (`--maxWorkers=2`) | final | 0 | **369 files pass + 3 skipped; 4977 tests pass + 26 skipped; 0 failed** (+137, the new suite; the two scanner assertions live inside existing tests) |
| S8 | `npm run build` | final | 0 | clean (generated `resources/wos-*` files reverted afterwards) |

**Own mistakes, recorded (three, all in the fixture):** the first registration
used a no-op `handle`, so nothing was captured (the same mistake as the browser
batch); the security mock replaced `assertMainFrame` with a weaker stub, which
hid the child-frame and foreign-frame cases until the real function was used; and
`speech:config` returns a *trimmed* config, so the expected value had to be the
trimmed shape. None was fixed by relaxing an assertion — S2 is stricter than the
draft.

## 4. Inventory after this batch

**473 declared = 405 `MUST_HAVE_GUARD` + 16 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **174**;
all sets unique.

**Verdict-A remaining: 0.** The sixteen channels still in `EXPLICITLY_NO_GUARD`
are the verdict-B list that survives (`agents:capabilities`, `drive:local-name`,
`memory:status`, six `menu:*`, `skills:list`, `system:status`, `wiki:status`,
`window:close|maximize|minimize`). Four labels that used to sit in that B table —
`speech:status`, `speech:stt-status`, `speech:kokoro-status`, `speech:key-status`
— were **already guarded**, so they are recorded as guarded rather than as
"unguarded by decision"; the decision was moot.

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| 27 channels refuse non-owner callers | NIVEL 2 | NIVEL 2 — four distinct unauthorized shapes; clipboard never read, secret never written, engine never reached | **APROBADO** |
| The owner is admitted and the engine reached | NIVEL 2 | NIVEL 2 — 27 controls assert the returned value and that the engine/store was called | **APROBADO** |
| The guard name used is the real mechanism | NIVEL 2 | NIVEL 2 — three source-level invariants pin `assertOwner` → `assertWorkspace` → `assertMainFrame` + identity; M45 breaks them | **APROBADO** |
| The inventory sees every registration form | NIVEL 2 | NIVEL 2 — M46 (literal `ipcMain`) fails three tests; the scanner test asserts the speech file is visible | **APROBADO** |
| Real microphone, real TTS, real clipboard, real keychain | NIVEL 3 | none — clipboard, engines, STT, installer, hotkey and the key store are mocked | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"You are claiming a batch found nothing. That is the easiest claim to fake."*
   Which is why it is measured rather than asserted: 108 refusal rows and 27
   admission rows, plus M45 showing the mechanism is load-bearing. The honest
   summary is that the *guard* existed and the *evidence* did not.
2. *"`read-clipboard` was called out as the worst channel in the triage."* It is
   the worst channel, and it was already guarded: `startClipboard(assertOwner(event))`
   evaluates the guard before `clipboard.readText()`. The test's first refusal row
   proves the clipboard is never read (`state.calls` excludes it).
3. *"`set-key` writes a secret."* `assertOwner(event)` precedes `setSpeechKey`, and
   the refusal rows assert no `setSpeechKey` call.
4. *"Accepting a local alias in the allowlist weakens the rule."* It would, which
   is exactly why the alias is pinned by a source test in the same suite and the
   comment in the inventory names that test.
5. *"Then every earlier 'remaining' number is suspect."* Yes — that is the finding
   of the batch, stated plainly in §1 and carried into the triage and handoff.

**Blue:** RED here is the fixture's own mistakes (S1), not the product's — recorded
rather than hidden; the affirmative evidence is S2's 137 green rows, M45/M46, and
the source-level pins. Two blind spots found in one series of twelve batches is
the reason the scanner is now tested by positive assertions instead of by
absence.

## 7. Residual risk

- **Verdict-A: 0**, but that is a statement about the *inventory*, and this batch
  is the proof that the inventory can be wrong in the optimistic direction. Any
  future registration form or guard alias re-opens the gap; the scanner tests are
  the tripwire, not a proof.
- **No NIVEL 3 anywhere in the series.** Electron real, microphone real, TTS
  real, Google Drive real, LibreOffice real and a real Drive account were never
  exercised. Every batch's acceptance is NIVEL 2 with mocked boundaries.
- **Self-review only.** No independent Red/Blue review has been performed on any
  batch; the contract asks for one.
- `speech:reply-open` and `speech:microphone-authorize` open native dialogs; the
  suite exercises the cancel path and asserts the post-dialog re-authorisation,
  but not the approval path.

## 8. Next steps (not a batch)

1. **Full-series re-audit of the scanner** — the two blind spots were found by
   hand. A mechanical sweep (every `ipc*.handle`/registry call shape in `src/main`,
   compared against the scanned set) would turn "we think we see everything" into
   a check.
2. **An independent review** of the twelve batches, starting with the three
   batches whose findings *changed* the triage (`drive:connection`,
   `bug:status`, `speech`).
3. **NIVEL 3 plan** — the largest honest gap in the series: one end-to-end run
   under real Electron with real files, a real microphone and a real Drive
   account, since every accumulated acceptance is NIVEL 2.
