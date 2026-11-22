# IPC-DIALOG-PARENT-01 checkpoint — dialogs parent to the live window · 2026-11-21

**Batch:** IPC-DIALOG-PARENT-01 (closes `WATCH-02` and `OFFICE-02`, plus the
same defect found in two more modules while fixing them). Four modules, four
call sites fixed, one helper, two behavioural suites, one sweep.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (the dialog itself is the OS's; the property
under test is the argument). **Publication:** none.
**Branch / base:** `arena/a1399b23-workspace-os` / `826081c`.

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **DIALOG-PARENT-01** | Reproduced defect (lifecycle) | Confirmed | `registerWatcherHandlers(ipcMain, win)` and `registerOfficeHandlers(ipcMain, win)` kept the window they were registered with and parented their native dialogs to it forever: `dialog.showOpenDialog(win, …)`, `dialog.showSaveDialog(win, …)`. After a window replacement — macOS `activate` → `createWindow()`, or any reopen — the parent is destroyed, Electron throws `Object has been destroyed`, and the picker the person asked for never appears. |
| **DIALOG-PARENT-02** | Same defect, two more modules | Confirmed | `lok.ts` had three `showOpenDialog(win, …)` sites with the identical shape, and `apps.ts` resolved the parent by hand at each site (`BrowserWindow.getFocusedWindow() ?? getAllWindows()[0]`), which happened to be right but was a second, unstated rule. Both now go through the helper. |
| **DIALOG-PARENT-03** | Why it survived | Confirmed | The app had already solved this for *sends*: `main-window.ts` resolves the live window at send time and documents exactly this failure. The dialogs were left behind — a fix applied to one call shape and not its sibling. Nothing tested dialog arguments, so five call sites kept the captured window with every suite green. |

## 2. Change

| File | Change |
| --- | --- |
| `src/main/main-window.ts` | `dialogParent(): BrowserWindow | null` — `mainWindow()`, named for the purpose so the rule has one spelling. |
| `src/main/handlers/watcher.ts` | both dialogs parent to `dialogParent()` when there is one, and open unparented otherwise. `win` still registers the owner (authorization needs an explicit one) and is documented as never used for dialogs. |
| `src/main/handlers/office.ts` | same for the export save dialog; the parameter became `_win?` with the reason written down. |
| `src/main/handlers/lok.ts` | the three image pickers go through a local `openWithLiveParent()`. |
| `src/main/handlers/apps.ts` | all four dialogs (save/open file, export/import `.wosapp`) use the helper instead of the hand-rolled resolution. |
| `src/main/handlers/watcher.dialog-parent.test.ts` | **new**: registers with window A, makes B live, asserts the dialog's first argument is B and not A; and that with no live window the call is **refused before any dialog** (authorization never inherits the delivery fallback). |
| `src/main/handlers/office.dialog-parent.test.ts` | **new**: same property for `office:export-pdf`, plus the temp PDF is discarded after the cancelled save. |
| `src/main/handlers/dialog-parent-wiring.test.ts` | **new**: sweeps every `dialog.show(Open|Save)Dialog(` in `src/main` and fails if the first argument is a captured identifier rather than a live-resolved parent or an options object; asserts the four owning modules use the helper; asserts the sweep actually sees ≥10 sites including an unparented one (mail.ts). |

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … watcher.dialog-parent.test.ts` | before the fix | 1 | **RED**: 3/3 — both dialogs received the registration window, and the "no live window" case failed on the guard (which corrected my own assumption: the unparented branch is defensive, not reachable through IPC) |
| S2 | same, after the fix and that correction | fix | 0 | 3/3 |
| S3 | `vitest run … office.dialog-parent.test.ts` | fix | 0 | 2/2 |
| S4 | mutation M66 (office: capture the registration window again — the original code) | mutated | 1 | 1 failure — the behavioural case |
| S5 | `watcher.dialog-parent + watcher.authorization + office.* + lok.authorization` | fix | 0 | 66 tests |
| S6 | mutation M67 (a new captured-window call site in `lok.ts`) | mutated | 1 | 1 failure — the sweep, on the module with no behavioural dialog test |
| S7 | mutation M68 (`watcher.ts` reverted to the captured window) | mutated | 1 | 1 failure — the behavioural case |
| S8 | full suite + tsc (node, renderer) + ESLint + build | final | 0 | see `docs/HANDOFF.md` (Vigente) |

S1's third case is worth keeping in the record: I wrote a test asserting the
unparented path was reachable, and the guard showed it is not. The design is
right; my expectation was wrong.

## 4. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| After a window replacement, the dialog uses the new window | NIVEL 2 | NIVEL 2 — both suites drive registration → replacement → dialog | **APROBADO** |
| No call site keeps the old shape | NIVEL 2 | NIVEL 2 — sweep over `src/main`; M67 proves it catches a fresh one | **APROBADO** |
| With no live window nothing is shown | NIVEL 2 | NIVEL 2 — the guard rejects first; no dialog opens | **APROBADO** |
| A real reopened Electron window and a real native picker | NIVEL 3 | none — windows are simulated objects and the dialog is mocked | **NO_EJECUTADO** |

## 5. Red / Blue review (self-review, not independent)

**Red:**
1. *"The dialog is mocked, so you have proven the argument, not the behaviour."*
   Stated plainly: the property is the parent argument, which is exactly what
   Electron rejects when destroyed. Whether the OS shows a well-placed sheet is
   NIVEL 3 and is recorded as not run.
2. *"`apps.ts` was already resolving a live window; why touch it?"* Because it was
   a second, undocumented rule that could drift — and the sweep would otherwise
   need an exception it could not justify.
3. *"Should the dialogs be *modal* (`BrowserWindow.fromWebContents(event.sender)`)
   instead of the tracked window?"* For the sequencer and the office export the
   sender is the main frame by construction (the guard just proved it), so
   `dialogParent()` and `fromWebContents` name the same window today. The helper
   is the one place to change if that ever stops being true; recorded rather than
   pre-emptively rewritten.
4. *"A sweep can be fooled by an alias (`const d = dialog`)."* It can; it fails
   loudly on the shapes that exist and is paired with two behavioural suites. The
   alternative (runtime instrumentation of every dialog) is disproportionate.

**Blue:** RED is the destroyed-parent path; M66 reproduces the original code and
breaks the behaviour suite; M67 proves the sweep bites where no behaviour test
exists; M68 proves the behaviour suite still guards the module it covers.

## 6. Residual risk

- No real Electron window replacement, no real native dialog (NIVEL 3).
- The sweep matches direct `dialog.show*Dialog(` calls; an aliased import would
  escape it (see Red 4).
- On Linux/Windows the destroyed-parent failure mode differs in symptom (dialog
  may appear unparented rather than throw); the fix is the same and only the
  macOS symptom was reasoned from documentation, not observed.

## 7. Next batch

**WORKSPACE-03** — the one remaining open item that is a capability decision, not
a defect: `workspace:open-recent` accepts any existing directory, even for the
owner. After it: the remaining voice roadmap (A2c / A3a), which needs an explicit
product call on live incremental speech.
