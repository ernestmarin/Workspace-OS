# IPC-CLASS-01 triage — the 153 `EXPLICITLY_NO_GUARD` channels, re-derived · 2026-11-21

**What this is.** After the origin audit closed at 268/268 (PR #20), the next
honest question was: *are the 153 channels classified as needing no caller check
actually safe to leave unguarded?* This document answers it channel by channel,
from source, and records the verdict.

**Verdict summary — the premise did not hold.**

| Verdict | Count | Meaning |
| --- | --- | --- |
| **A — graduate** | **123** | reaches user content, user state, the filesystem, the network, an external program, a model, or a secret. Needs `assertMainWindowFrame`. |
| **B — keep** | **21** | returns app UI state, a boolean, a static list, or re-emits to the renderer. Written reason per channel below. |
| already fixed | 9 | `pdf:*`, completed in **IPC-PDF-01** (this batch). |

So `EXPLICITLY_NO_GUARD` was **not** a set of decisions; it was mostly an
unexamined default. 123 of 144 remaining channels should have been guarded all
along. That is the finding, and it is worth more than any single guard.

`skills:list` was A by the flags and B on reading it: it returns the skill
catalog (names + descriptions shipped with the app), not user content. Counted
in B. Final: **123 A / 21 B**. One entry was later corrected the other way —
`drive:connection` (B → A) — see §4.

## 1. Verdict B — kept unguarded (21), with reasons

| Channel | Reason |
| --- | --- |
| `agents:capabilities` | static capability list |
| `bug:status` | poller status, no user content |
| `drive:local-name` | pure string transform (name + mime → filename) |
| `memory:status` | store size / timestamps |
| `menu:office-commands` | static command list for a doc type |
| `menu:run-action` | re-emits a validated id to the renderer; no effect in main |
| `menu:set-actions`, `menu:set-agent-menu`, `menu:set-browser-context`, `menu:set-office-context`, `menu:set-office-state` | menu state the renderer already owns |
| `speech:key-status` | whether a key exists (boolean) |
| `speech:kokoro-status`, `speech:status`, `speech:stt-status` | engine state flags |
| `system:status` | app / runtime status |
| `wiki:status` | queue counters |
| `window:close`, `window:maximize`, `window:minimize` | window control, no data |

**Why these stay**: a guard here would not remove any capability the main frame
already has, and each would add a class of confusing "not allowed" failures for a
frame that legitimately drives the UI. If any of them later starts returning user
content, it moves to A — that is what this table is for.

## 2. Verdict A — must graduate (123), by cluster and priority

Ordered by consequence, which is how they should be batched (one module per
commit, same protocol as IPC-WATCH/SEARCH/OFFICE/REFRESH/WRITERS: RED → guard →
inventory → mutation → gates → checkpoint).

| # | Cluster | n | Channels | Why it is A |
| --- | --- | --- | --- | --- |
| 1 | **workspace root** ✅ *done — IPC-WORKSPACE-02* | 3 | `workspace:open-recent`, `workspace:close`, `workspace:recents` | `open-recent` calls `openWorkspacePath(dir)` with an **unvalidated string** — it reassigns the authoritative workspace root, exactly what `fs:open-folder-dialog` does and what IPC-WATCH-01 guarded. `recents` returns the user's recent folder paths. |
| 2 | **drive** ✅ *done — IPC-DRIVE-02* | 6 | `drive:connect`, `drive:disconnect`, `drive:list`, `drive:open`, `drive:search`, **`drive:connection`** | network + OAuth secrets + `drive:open` writes a remote file into the workspace |
| 3 | **chat sessions** | 3 | `sessions:load`, `sessions:save`, `chat:upload` | conversation transcripts and uploaded attachments on disk |
| 4 | **printing** | 1 | `print:document` | builds a hidden window and prints; `event.sender` is used only for re-entrancy, not authorization |
| 5 | **bug reports** | 5 | `bug:analyze`, `bug:context`, `bug:file`, `bug:list`, `bug:setRepo` | `bug:file` writes a report to disk; `analyze` calls a model; `context`/`list` read repo state |
| 6 | **agents** | 5 | `agents:build`, `agents:delete`, `agents:list`, `agents:read`, `agents:write` | agent definitions (prompts) are user content; build/write/delete touch the filesystem |
| 7 | **derived-state stores** | 25 | `collection:*` 2, `collectionLink:*` 4, `components:*` 2, `metric:*` 2, `range:*` 3, `rangeLink:*` 4, `transclusion:*` 4, `wiki:*` 4 (`changes`, `check`, `sources`, `undo`) | deletes, bulk refreshes, syncs and `wiki:undo` (**rewrites pages**); the read-only members list user-authored links and paths |
| 8 | **memory** | 15 | `memory:*` (all but `status`) | the personal memory store: remember / forget / correct / query / propose (model) |
| 9 | **speech** | 23 | `speech:*` (all but four status channels) | `read-clipboard` (**clipboard**), `set-key` (**secret**), `stt-transcribe` (audio to a provider), `kokoro-install` (installs binaries), `speak` |
| 10 | **history** | 11 | `history:*` | the user's browsing history: recent, search, star, forget, clear |
| 11 | **browser control** | 20 | `browser:*` | a foreign frame driving the user's guest browser: navigate, click, type, screenshot, deep-read (page content), downloads |

## 3. Method and its limits

- **How verdicts were made**: for every channel, the handler body was extracted
  from source and screened for filesystem, child-process, dialog, shell, network,
  model, store-write and read operations; ambiguous ones were read by hand
  (`workspace:open-recent`, `menu:run-action`, `print:document`, `skills:list`).
- **This is a triage, not a proof.** A channel marked A may turn out to be
  harmless when someone writes its test; a channel marked B could still be a
  probe. Both directions are expected; the per-batch tests are where a verdict
  gets tested, and a wrong B is only caught by reading the handler.
- **Not covered**: whether a channel should be reachable from the renderer *at
  all*. Several A channels (`speech:set-key`, `history:clear`,
  `workspace:open-recent`) may deserve to move behind a capability instead of a
  frame check — recorded, not decided here.

## 4. Plan

Batches in the order of §2. Each ends with the module guarded, its channels moved
from `EXPLICITLY_NO_GUARD` to `MUST_HAVE_GUARD` and added to
`MUST_HAVE_ORIGIN_GUARD`, plus a table-driven authorization suite and a
checkpoint. Cluster 7 is the largest and lowest-consequence; it can be split into
two commits (metrics/collections + wiki).

**Done so far:**

| Batch | Cluster | n | Checkpoint |
| --- | --- | --- | --- |
| IPC-PDF-01 | pdf | 9 | [ipc-pdf-01-checkpoint-2026-11-21.md](ipc-pdf-01-checkpoint-2026-11-21.md) |
| IPC-WORKSPACE-02 | workspace root | 3 | [ipc-workspace-02-checkpoint-2026-11-21.md](ipc-workspace-02-checkpoint-2026-11-21.md) |
| IPC-DRIVE-02 | drive | 6 | [ipc-drive-02-checkpoint-2026-11-21.md](ipc-drive-02-checkpoint-2026-11-21.md) |

**Correction made while doing it:** `drive:connection` had been triaged B ("whether
an account is linked"). It returns the whole connection object, **email included**.
Moved to A and guarded in IPC-DRIVE-02 — the triage's stated limit, in one
concrete instance.

**Remaining: 114 verdict-A channels.**
