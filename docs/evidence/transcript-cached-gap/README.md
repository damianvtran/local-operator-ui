# Reopening a long conversation: the cached block behind the tail page (#876)

Issue #876: reopening a long session whose paint-cached block sat behind a newer
journal-tail page silently dropped a range of the transcript. The fix is
`0fbca40d410` (a reconcile reaches the rows the pane held) and `fb35bca4114` (a
walk that ends short seals the hole instead of painting it). The hook-level
cases in `scripts/reconnect-page-gap.test.mjs` drive the shipped hook against a
STUBBED backend contract. This directory is the run the stub cannot be: a real
backend, the app's own renderer, a real journal file, the rows the pane holds
counted off the pane.

- `transcript-before.md` - raw output on the base tree (`src/` from `c14e07d95b0`).
- `transcript-after.md` - raw output on the fixed tree. Same harness, same journals.

Reproduce either with `node scripts/transcript-gap-live.mjs --label=<name>`
(add `--frames=<dir>` for the seam frame at N=600). The script's header says
what is real and what is not.

## The scenario

A SYNTHETIC journal of 400 entries (the real entry shape, filler text such as
`User row 17`, four entries to a turn) in a scratch `LOCAL_OPERATOR_CONFIG_DIR`,
served by a real `lop serve`:

1. open the session in the app's renderer with the paint cache kept; the pane
   paints the tail page (100 rows);
2. go back to the landing (`/chat`);
3. while away, APPEND N entries to `transcript.jsonl` with strictly later
   timestamps - the backend is not restarted, so it serves an append it did not
   make (its page cache is keyed by file identity, `session/page_cache.py`);
4. reopen from the landing, wait until the pane has been still for two seconds
   with no request in flight;
5. read the pane's own record ids and compare them with the journal; then drive
   the real affordance (`Load earlier messages` click, or a real wheel notch up,
   which the scroll pump turns into the same read) until the pane says `Start of
   conversation`, and compare again.

## The table

N = rows appended while away. Journal = 400 + N entries. Verbatim from the two
files, one run each:

| N | tree | painted at settle | one contiguous suffix to the tail? | painted journal rows | hole (journal rows between painted blocks) | `load earlier` resumes from row | unreachable after paging to the start | `sessions.history` requests during the reopen |
|---:|---|---:|:---:|---|---:|---:|---:|---|
| 300 | before | 200 / 700 | **false** | 301..400, 601..700 | 200 | 601 | 0 | 0 |
| 300 | after | 400 / 700 | true | 301..700 | 0 | 301 | 0 | 4: `100t 100b 100b 100b` |
| 600 | before | 200 / 1000 | **false** | 301..400, 901..1000 | 500 | 901 | 0 | 0 |
| 600 | after | 500 / 1000 | true | 501..1000 | 0 | 501 | 0 | 5: `100t 100b 100b 100b 100b` |
| 1400 | before | 200 / 1800 | **false** | 301..400, 1701..1800 | 1300 | 1701 | 0 | 0 |
| 1400 | after | 500 / 1800 | true | 1301..1800 | 0 | 1301 | 0 | 5: `100t 100b 100b 100b 100b` |

`t` is the tail read, `b` a `before_id` page, the number is the rows returned.
The reopen's history cost, from the harness's per-cell JSON: 90,808 B (N=300),
113,631 B (N=600) and 114,005 B (N=1400) on the fixed tree, none on the base
tree. Paging to the start afterwards took 6 / 9 / 17 `sessions.history`
requests on the base tree and 3 / 5 / 13 on the fixed one.

## What this shows, and what it does not

- **The defect reproduces against the real backend, at every N.** On the base
  tree the pane settles on the cached block (rows 301..400) beside the new tail
  (the last 100 rows) with N-100 journal rows between them painted nowhere
  (200 / 500 / 1300 at N = 300 / 600 / 1400; the harness's `hole` column is
  exactly N - 100 here). Nothing on the pane says so: the affordance reads
  `Earlier history above`, and `load earlier` resumes from the tail block's
  oldest row, so the seam reads as one continuous transcript.
  `transcript-before.md` per-cell JSON has the pane's cursor and the paging
  cursors.
- **The fixed tree paints one contiguous journal suffix ending at the tail at
  every N**, never a hole. For N <= 480-ish the walk reaches the cached block and
  the pane holds it too (N=300: 301..700, so the cached rows 301..400 are
  there); for N >= 600 the walk's 500-row bound ends it short, the block behind
  the hole is sealed off, and the pane holds the newest 500 rows with `Load
  earlier messages` / `Earlier history above` present (N=600: 501..1000, N=1400:
  1301..1800). Paging with the real affordance reaches the whole journal
  (`unreachable` 0, final affordance `Start of conversation`, the final record set
  one contiguous suffix equal to the full journal - per-cell `finalContiguous`).
- **On the base tree the rows were not destroyed**, and the table says so rather
  than overclaiming: `unreachable` is 0 there too, because `load earlier` pages
  down from the tail block and eventually re-reads the hole. The loss is that the
  reopened transcript silently omits N-100 rows until the reader pages, while
  reading as continuous. An early iteration of this harness (a paging driver that
  scrolled by writing `scrollTop`, which the scroll pump ignores, so it never
  paged) reported 300-400 "unreachable" rows on base; that was the driver, not the
  product, and is why the paging step is a real wheel/click. It is not in the
  runs above.
- **The fixed tree is not free.** The reopen pays 4-5 `sessions.history` reads
  (~91-114 KB) that the base tree skipped; that is the walk reaching for the held
  block. The stubbed suite pins that a page that already connects to the cached
  block still costs no read; this run shows the cost when it does not.
- **A frame at the seam, N=600, is deliberately not committed.** The harness
  writes `base-600-away.webp` / `head-600-away.webp` (with `--frames`), and they
  show it: base reads `... Assistant row 400` directly followed by `User row 901`;
  the fixed tree's top is `Load earlier messages` over `User row 501`, with the
  rows 501.. contiguous. Adding PNG/WebP frames here would also mean editing
  `docs/evidence/manifest.json` (frames whose name claims no theme are counted in
  `unjudgedFrames`), which this change does not touch, so the evidence is the two
  transcripts and the harness.
- **Not real:** the dev bundle in headless Chrome rather than the packaged app (no
  Electron IPC hop; the same on both trees), and the synthetic journal (real
  shape, filler text, no tool arguments beyond a one-line command). The "painted"
  count is the pane's own `transcript` model read off its React fiber over CDP,
  with the mounted DOM ids reported beside it (`dom`: the render window mounts 60
  rows from the tail, so the DOM alone cannot be the count).
