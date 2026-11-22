# IPC-ZIP-INDEX-01/02 checkpoint — the entry budget is checked before the archive is indexed · 2026-11-21

**Batches:** IPC-ZIP-INDEX-01 (xlsx snapshot) and IPC-ZIP-INDEX-02 (the five
docx/pptx writers). One new module, six call sites, one mechanical invariant.
**Owner / reviewer:** single local agent; **self Red/Blue review, not independent**.
**Result:** accepted at **NIVEL 2** (required 2). **Publication:** none.
**Branch / base:** `arena/a1399b23-workspace-os` / `826081c` (merge de PR #23).

## 1. Finding

| ID | Kind | Certainty | Statement |
| --- | --- | --- | --- |
| **ZIP-INDEX-01** | Reproduced defect (ordering) | Confirmed | `loadValidatedXlsx` called `JSZip.loadAsync(buffer)` and only then compared `entries.length` with `MAX_XLSX_ENTRIES`. `loadAsync` indexes the central directory eagerly — one object per record, with names, dates, flags — so the count was checked at the one moment it could no longer prevent anything. The budget bounded *inflation* and left *indexing* unbounded. |
| **ZIP-INDEX-02** | Reproduced defect (missing budget) | Confirmed | The five docx/pptx writers had no entry-count bound at all: a package declaring 60 000 parts was handed straight to `JSZip.loadAsync` and indexed in full. The compressed-file gate (`archiveWithinBudget`) bounds bytes on disk, not records. A 60 000-record directory is roughly three megabytes — comfortably inside every existing gate. |
| **ZIP-INDEX-03** | Why it survived review | Confirmed | The check *looked* present: `if (entries.length > MAX_XLSX_ENTRIES) return … sheet-too-large` reads like a budget and is tested by a real fixture. Its position was the defect, and no test could see position — a test asserting the refusal passes whether it happens before or after the allocation. Only a test that distinguishes *which* check fired can tell them apart. |

## 2. Change

| File | Change |
| --- | --- |
| `src/main/zip-directory.ts` | **new**: `readZipDirectory(buffer)` — finds the End Of Central Directory record and returns the declared entry count, the central-directory size and whether the archive is ZIP64. Refuses (`no-eocd`, `multi-disk`, `zip64-unreadable`) instead of guessing. Locates the EOCD by the rule that matters — its own comment length must reach exactly the end of the buffer — so a comment containing the four signature bytes cannot be mistaken for the record. Resolves saturated 16-bit counters through the ZIP64 record rather than trusting the `0xFFFF` marker. `MAX_OOXML_ENTRIES = 4096`. |
| `src/main/docx-zip.ts` | `loadValidatedXlsx` reads the declared count **before** `JSZip.loadAsync`; over budget → `sheet-too-large`, unreadable directory → `not-valid-xlsx`. The post-load check stays as a second line, not as the only one. |
| the five writers (`docx-cards`, `docx-cc`, `docx-table`, `pptx-shape`, `pptx-table`) | same pre-check on the bytes they already read: unreadable directory → `not-valid-*`, over `MAX_OOXML_ENTRIES` → `document-too-large` / `slide-too-large`. |
| `src/main/zip-directory.test.ts` | **new**: 10 tests — real archive count compared with what the library itself sees, a handcrafted record declaring 60 000 entries, a real archive whose **comment** contains a fake EOCD claiming 60 000, ZIP64 resolution (70 000 and 2), saturated counters with no ZIP64 record, multi-disk, and non-archives. Plus the integration discriminator (below). |
| `src/main/docx-write-conflict.test.ts` | **+2 tests**: a `.docx` over the part ceiling is refused `document-too-large` and left untouched; one just under it still writes. |
| `src/main/doc-write-wiring.test.ts` | **+1 invariant**: every docx/pptx writer contains the declared-count check before loading. |

### The discriminator

`zip-directory.test.ts` writes **a few hundred bytes that declare 60 000
entries** — no central directory, nothing to parse — and asserts
`loadValidatedXlsx` answers `sheet-too-large`. With the check after the library,
the same bytes answer `not-valid-xlsx`, because `loadAsync` fails on them. The
reason is what proves the ordering, not the refusal: both orders refuse.

## 3. Evidence

| ID | Command / selection | State | Exit | Result |
| --- | --- | --- | --- | --- |
| S1 | `vitest run … zip-directory.test.ts` | before the fix | 1 | **RED**: the 60 000-entry file was answered `not-valid-xlsx` (the library ran and failed) instead of `sheet-too-large` |
| S2 | same | fix | 0 | 10/10 |
| S3 | `docx-zip + xlsx-cell-writer + xlsx-range-writer + ooxml-writers-shape` | fix | 0 | 62 tests — the existing xlsx budgets and writers unaffected |
| S4 | mutation M59 (remove the pre-check from `loadValidatedXlsx`) | mutated | 1 | 1 failure — the discriminator |
| S5 | mutation M60 (`if (false)` instead of resolving ZIP64) | mutated | 1 | 3 failures — saturated counters, ZIP64 counts, multi-disk ZIP64 |
| S6 | mutation M61 (drop the comment-length rule, i.e. "last signature wins") | mutated | 1 | 1 failure — the fake EOCD inside a real comment |
| S7 | `docx-write-conflict + doc-write-wiring + zip-directory + docx-cards-writer + xlsx-write-conflict` | fix | 0 | 41/41 |
| S8 | mutation M62 (remove the entry cap from `docx-cards-writer`) | mutated | 1 | 2 failures — the `.docx` ceiling test and the invariant |
| S9 | mutation M63 (remove the whole pre-check from `pptx-table-writer`) | mutated | 1 | 1 failure — the invariant, on a writer with no behavioural fixture of its own |
| S10 | `tsc --noEmit` (node + renderer), full suite, ESLint, build | final | 0 | see `docs/HANDOFF.md` (Vigente) |

## 4. Acceptance

| Dimension | Required | Demonstrated | Verdict |
| --- | --- | --- | --- |
| XLSX: over-budget archive refused **before** indexing | NIVEL 2 | NIVEL 2 — the reason only reachable pre-load, on bytes no parser can read | **APROBADO** |
| DOCX/PPTX: a package over the part ceiling is refused | NIVEL 2 | NIVEL 2 — real 4097-part package refused, file untouched; 4095-part one still writes | **APROBADO** |
| The EOCD is found correctly in the presence of a comment | NIVEL 2 | NIVEL 2 — real archive, real comment carrying a fake record | **APROBADO** |
| ZIP64 counts are resolved, not trusted or ignored | NIVEL 2 | NIVEL 2 — handcrafted ZIP64 record; unreadable ZIP64 refused | **APROBADO** |
| Memory actually not spent on a 65k-record archive | NIVEL 3 | none — the ordering is proven by reason, not by measuring heap. The measurement would need a 3 MB hostile archive and a heap sampler; recorded as the honest gap | **NO_EJECUTADO** |

## 5. Red / Blue review (self-review, not independent)

**Red:**
1. *"A declared count can lie low."* Yes, and that only makes this check weaker,
   never wrong: every later bound (per-entry bytes, total inflated bytes, XML
   shape) still runs, and each entry is still read counted.
2. *"You are parsing a format by hand, badly."* Only the 22-byte record and the
   ZIP64 pair; the library remains the authority on structure. The rule that the
   comment length must reach the end of the buffer is what prevents the classic
   "signature inside a comment" mistake, and M61 proves the rule is load-bearing.
3. *"Why not skip JSZip entirely and read the directory yourself?"* That would
   mean reimplementing inflation and CRC checks — a much larger surface, with no
   acceptance evidence behind it. This batch buys the ordering, which is the
   finding.
4. *"4096 is arbitrary."* It is a documented ceiling, not a measurement: real
   Word/PowerPoint packages are dozens to hundreds of parts. It is recorded with
   its reasoning, and it can only ever be *loosened* by a real document that needs
   more.
5. *"The `.wosapp` importer already had a budget; why not reuse it?"* Because it
   filters during unzip (`fflate`), which is the right shape there and not
   available here — `JSZip` gives no per-record hook before indexing.

**Blue:** RED is the ordering, visible only through the reason; M59/M60/M61 pin
the pre-check, the ZIP64 resolution and the EOCD rule; M62/M63 pin the wiring on
the writer whose fixture would otherwise hide a removal.

## 6. Residual risk

- No heap measurement (NIVEL 3 gap above): the argument is structural.
- The `.wosapp` importer and `search/extract.ts` keep their existing bounds; the
  first filters during unzip, the second never writes, and neither is changed
  here.
- A hostile archive that lies about its directory (declaring 3, containing
  60 000) still reaches the library; the post-load check catches it after the
  allocation. Closing that needs a streaming reader — a different design, not a
  patch.
- `MAX_OOXML_ENTRIES` applies to docx/pptx writes; the LOK (Office) path has its
  own budgets and is not touched.

## 7. Next batch

`SEARCH-02` (lazy DB open), then `WORKSPACE-03` — which stays a capability
decision and needs an explicit call — and the lifecycle items (`WATCH-02`,
`OFFICE-02`).
