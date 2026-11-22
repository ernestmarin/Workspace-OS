# IPC-SEARCH-02 checkpoint — the guard's position, turned into a control · 2026-11-21

**Batch:** IPC-SEARCH-02 (close a hypothesis, add the control the earlier lesson
asked for). One test file; no product change.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** **no defect found**; SEARCH-02 closed with evidence, plus a new
invariant. **Publication:** none.
**Branch / base:** `arena/a1399b23-workspace-os` / `826081c`.

## 1. The note being closed

`docs/ipc-search-01-checkpoint-2026-11-21.md` §1 left this open, as a hypothesis:

> **SEARCH-02** — `ensureIndex()` opens `userData/search-index.db` lazily on the
> **first** call, including pure reads like `search:index-status` and
> `links:graph`. Harmless today (the guard now runs first), but it means an
> unauthenticated path to a database open would have existed through any channel
> that only "reports status". Kept as a note: the guard, not the lazy open, is
> the control.

Re-read against the current code: **the claim holds**. All thirteen channels in
`src/main/handlers/search.ts` call `assertMainWindowFrame(event)` as the first
statement of the handler, before `ensureIndex()`, `getWorkspaceRoot()`,
`validateFilePath()` or any filesystem call. There is no unauthenticated path to
the database open, so there is nothing to fix — the lazy open stays, because
opening a SQLite handle on every app start to answer nothing is worse.

## 2. What the note got right and what it missed

It got the mechanism right (the guard is the control) and missed that **it had
written the control as prose**. "The guard runs first" is a statement about
*order*, and the tests from IPC-SEARCH-01 assert *presence* — they stay green if
somebody moves the guard one line down, because a legitimate caller sees no
difference. That is the same blind spot that let IPC-ZIP-INDEX-01 survive review
this same night: the check existed, the check was in the wrong place, and no test
could see the difference.

So the batch's real product is a test that reads the module's own registration
block:

| Check | What it fails on |
| --- | --- |
| the guard is the first statement of every handler | the guard moved below a validation call, a path resolution or a `console.log` line (M64) |
| the guard precedes every side effect in the body | `ensureIndex(`, `getWorkspaceRoot(`, `fs.`/`fsSync.`, `validateFilePath(` appearing above the guard |
| the parser actually matches the module | a parser that found no handlers would make the cases above vacuous — asserted, with `>= 13` blocks and a named channel |

`src/main/handlers/search.guard-order.test.ts` (4 tests). It is a **source-level
invariant and says so**: order in the registration block, not runtime behaviour.
Behaviour remains with `search.authorization.test.ts` (13 channels × 3 caller
shapes + owner controls).

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … search.guard-order.test.ts` | first version | 1 | 13 offenders — a parser bug of mine (the opening `{` line counted as the first statement), not a product finding; fixed before drawing any conclusion |
| S2 | same | fixed parser | 0 | 4/4 |
| S3 | mutation M64 (move the guard below `validateSearchQuery` in `search:query`) | mutated | 1 | **1 failure, and only this test**: the 13 behaviour scenarios and the owner controls all stayed green — the position is invisible to them |
| S4 | mutation M65 (remove the guard from `links:graph`) | mutated | 1 | 6 failures — 2 behaviour scenarios + 4 in this file |
| S5 | `search.guard-order + search.authorization` | final | 0 | 58 tests |
| S6 | full suite + tsc (node, renderer) + ESLint + build | final | 0 | see `docs/HANDOFF.md` (Vigente) |

S1 is recorded on purpose: my own first attempt at the invariant was wrong, and
the difference between "13 handlers are broken" and "my parser is broken" is the
kind of thing that decides whether a batch reports a defect or a mistake.

## 4. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| Every search channel guards before it touches the index or the disk | NIVEL 2 | NIVEL 2 — 13/13 read from the module text; M64 proves the check bites | **APROBADO** |
| The note's premise ("the guard runs first") is true today | NIVEL 2 | NIVEL 2 — verified by the same invariant | **APROBADO** |
| An unauthenticated caller cannot reach the database open | NIVEL 2 | NIVEL 2 — `search.authorization.test.ts` drives every channel with an absent, child and foreign frame | **APROBADO** |
| Real Electron frames (detached, recreated window) | NIVEL 3 | none — frames are simulated objects | **NO_EJECUTADO** |

## 5. Red / Blue review (self-review, not independent)

**Red:**
1. *"A grep test is brittle against refactors (formatting, `ipcHandle` aliasing)."*
   True, and it fails loudly — the parser asserts it matched ≥13 handlers, so a
   refactor that fools it fails the third case rather than passing silently.
2. *"You proved order in the source, not that the guard runs first at runtime."*
   Correct and stated. Source order plus the behaviour suites is the pair that
   covers it; neither alone does.
3. *"Should the lazy open be removed anyway?"* That would trade a guard-protected
   convenience for a startup cost on every launch. The guard is the control; the
   note said so and the code agrees.

**Blue:** RED is a hypothesis that turned out false, verified rather than assumed;
M64 is the discriminator (position-only breakage, invisible to 57 other tests);
M65 shows the behaviour suites still catch outright removal — the two controls
cover different failures.

## 6. Residual risk

- Formatting-level brittleness of the source invariant (see Red 1).
- The invariant covers `search.ts` only. Other modules with "the guard must run
  first" claims are not asserted the same way; doing that repo-wide over 174
  guarded channels is a separate, larger control and is inventoried as such.
- No NIVEL 3 for frames.

## 7. Next batch

`WORKSPACE-03` — a capability decision that needs an explicit call, not a patch.
After it, the lifecycle items `WATCH-02` / `OFFICE-02`.
