# IPC-BROWSER-02 checkpoint — the guest browser drive verifies the caller · 2026-11-21

**Batch:** IPC-BROWSER-02 (P0, IPC authorization). Nineteen handlers:
eighteen in `src/main/browser/browserControl.ts`, one in
`src/main/browser/downloads.ts`.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/c34cb1fb-workspace-os` / `b1dca61` (IPC-HIST-01).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **IPC-BROWSER-02** | Reproduced defect (control failure) | Confirmed | None of the browser-drive handlers verified the caller. Any frame could `navigate` the user's visible guest to any http(s) URL, `click` buttons **on the user's own logged-in session**, `type` into inputs (the module's own comment says agent text goes into `.value`, which is exactly what makes typing into a payment form possible), `scroll`, read the page (`current`, `map`, `extract`, `deep-read` — page content, links, harvested e-mails/phones/socials), take a `screenshot` written into the workspace, and `downloads` lists the files the user fetched. `set-active-guest`/`register-tab` also let a caller choose which tab an agent drives. |
| **BROWSER-03** | Existing confinement (not a defect, worth naming) | Confirmed | Two controls already existed and both stay, *behind* the guard: `requireHttpUrl` rejects non-http(s) schemes (a `file://` navigate fails), and screenshots are confined to `realPathSafe` roots. They answer *what may be reached*, not *who is asking* — the recurring distinction of this series. |
| **BROWSER-04** | Registry seam | Confirmed | `guestRegistry` exposes `captureBrowserGuest`/`resetBrowserGuest` as an explicit test seam, so the suite drives the **real** registry and the **real** handlers with a recording fake guest. A refusal is proven by the recorder staying empty — not even the `isDestroyed()` probe the registry does on entry. |

## 2. Change

| File | Change |
| --- | --- |
| `src/main/browser/browserControl.ts` | `assertMainWindowFrame(event)` first in all eighteen handlers; `_e` renamed to `event`. |
| `src/main/browser/downloads.ts` | `assertMainWindowFrame(event)` first in `browser:downloads` (was `() => listDownloads()`); the `will-download` listener that places files in the workspace is untouched — it is a Chromium event, not IPC. |
| `src/main/browser/browser.authorization.test.ts` | **new**: 78 tests — 19 channels × 4 unauthorized callers against a captured recording guest, plus an owner control that walks fifteen channels and two controls for the surviving validation. |
| `src/main/ipc-authorization.test.ts` | 19 channels moved from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD`; `MUST_HAVE_ORIGIN_GUARD` extended to **147**. |

The recording guest is a `Proxy`: every property access and every call is logged,
`executeJavaScript`/`capturePage`/`loadURL` included. That is what makes "the
handler did not run" a measurement rather than an inference from an error message.

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … browser.authorization.test.ts` | pre-fix | 1 | **RED**: **77 failed / 1 passed** of 78 — the 76 refusals plus both controls; the 40 s runtime was `back`/`forward` waiting for a `did-finish-load` that never came, which the guard removes |
| S2 | same | fix | 0 | **GREEN**: 78/78 |
| S3 | mutation M42 (`browser:navigate`) | mutated | 1 | **6 failures**: 4 unauthorized callers + the snippet and origin inventory tests |
| S4 | mutation M43 (`browser:type`) | mutated | 1 | 6 failures, same shape |
| S5 | mutation M44 (`browser:downloads`) | mutated | 1 | 6 failures, same shape — the second module is covered |
| S6 | `vitest run … browserControl + browser + ipc-authorization` | final | 0 | 119 tests pass — the existing drive suite is unaffected |
| S7 | `tsc --noEmit -p tsconfig.node.json` | final | 0 | no diagnostics |
| S8 | full ESLint JSON over `src` | final | 0 | 1018 files, 0 errors / 0 warnings |
| S9 | full suite (`--maxWorkers=2`) | final | 0 | **368 files pass + 3 skipped; 4840 tests pass + 26 skipped; 0 failed** (+78) |
| S10 | `npm run build` | final | 0 | clean (generated `resources/wos-*` files reverted afterwards) |
| S11 | `npm audit` | final | 1 | 40 moderate, 0 high, 0 critical — unchanged |

**Own mistakes, recorded:** the first fixture passed a no-op `handle` to
`registerBrowserHandlers`, so the registry registered nothing and every test
"passed" the refusal half for the wrong reason — caught because the owner control
also failed; and the refusal test first counted the `once()` that
`captureBrowserGuest` itself performs while registering the fixture guest, so the
recorder is cleared after capture. Both fixed in the fixture.

## 4. Inventory after this batch

**473 declared = 378 `MUST_HAVE_GUARD` + 43 `EXPLICITLY_NO_GUARD` + 22
`GRANT_CHECKED` + 30 `PUSH_CHANNELS`**; `MUST_HAVE_ORIGIN_GUARD` = **147**;
all sets unique.

Of the 43 `EXPLICITLY_NO_GUARD`, **20 are verdict B**, so **verdict-A remaining:
23** — `speech:*` only.

## 5. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| 19 channels refuse non-owner callers | NIVEL 2 | NIVEL 2 — the captured guest is never probed, no script runs, no capture, no navigation, nothing written to workspace or state dir | **APROBADO** |
| The owner is admitted and the browser reached | NIVEL 2 | NIVEL 2 — one control walks fifteen channels through the real registry and asserts `executeJavaScript`, `getURL` and the registry entry points | **APROBADO** |
| Existing confinement survives | NIVEL 2 | NIVEL 2 — `file:///etc/passwd` is still refused, unknown tabs still raise, `wait-for`/`type` still demand a selector or text | **APROBADO** |
| A real Chromium guest, a real download, a real screenshot | NIVEL 3 | none — the guest is a recording fake; no page is loaded and no file is captured | **NO_EJECUTADO** |

## 6. Red / Blue review (self-review, not independent)

**Red:**
1. *"The browser is a visible surface; the user is watching."* Watching a click is
   not consenting to it. `click` acts inside the user's authenticated session and
   `type` writes into whatever input a selector names; the browser-drive surface
   is the one place where reading and acting are the same authority.
2. *"`browser:current` is a read."* It returns the URL and title of the page the
   user is on — their bank, their inbox — and `map`/`extract`/`deep-read` return
   the content and the links.
3. *"`screenshot` is confined to a path."* Confinement says *where* a file lands;
   it does not say who may capture the page. Both are needed.
4. *"`browser:downloads` only lists files."* It lists filenames and target paths
   of everything the user downloaded — the same information class as
   `workspace:recents`.
5. *"78 tests for 19 channels is padding."* Two questions per channel, and the
   recording guest makes "did not run" checkable in four independent ways.

**Blue:** RED is the whole matrix plus both controls; M42–M44 span two modules;
the existing drive suite stays green; the full suite grew by exactly +78; the
inventory invariant now covers 378 channels.

## 7. Residual risk

- **23 verdict-A channels** remain, all `speech:*`.
- `navigate`, `deep-read`, `screenshot` and `thumbnail` are covered by the refusal
  matrix but not by the owner control (they need a real page, a real paint and a
  real file write); their *paths* are unchanged by this batch.
- No NIVEL 3: no real Chromium guest, no real download, no real capture.

## 8. Next batch

**IPC-SPEECH-02** — the last verdict-A cluster, 23 `speech:*` channels, including
`read-clipboard` (**the system clipboard**) and `set-key` (**a secret**),
`stt-transcribe` (audio to a provider), `kokoro-install` (installs a binary).
