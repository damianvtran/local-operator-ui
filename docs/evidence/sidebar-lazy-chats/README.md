# The chats sidebar, paged: first paint, a group on expand, and the tail

**What this set is for.** The operator reported "no chats are showing up / taking a
very long time to load chats". Two mechanisms produced that, and both are only
visible against a catalogue LARGER than one page:

1. the panel asked the daemon for the whole catalogue (`limit=500`) on mount, on
   window focus, on a 30 s poll and once per `catalogue` feed frame, and painted
   nothing until that answer landed; and
2. a group's row was drawn from a COUNT OF THE ROWS IN HAND, so a group whose
   conversations sat past the page cap read **"No chats yet"** — the operator's own
   screenshot, and the `before-withdrawn` frame here.

**The pair.** `before-withdrawn/` is the app against a daemon that cannot page (the
same stand-in launched with `--no-page --truncate 50`, i.e. 50 rows of 120 with no
cursor — what a pre-paging `serve` does). `after/` is the app against the same
catalogue with the capability advertised. The launcher's `All chats 50` and the row
of digits beside `lopdev` are the two numbers to compare across them: 50 rows held
and no badge before; 50 rows held, a `70` badge and the group's own page after.

## What each frame shows

| frame | what it shows |
|---|---|
| `after/head-page.png` | The first paint: **50** rows of the 120-chat stand-in (`All chats 50`), the pinned row and the running row drawn, and every entity row already carrying its census badge (`lopdev 70`, `minervadev 20`, `reviewer 8`, `qa-tester 7`). The daemon's log shows the request that produced it: `limit=50&include_archived=true&with_counts=true`. |
| `after/group-open.png` | `lopdev` expanded: its **own** page (Chat 050 … Chat 074) and nothing else — the store's row count went 50 → 75, i.e. exactly that group's first page. The badge still reads 70 (the census, not the 25 rows in hand) and `Show 25 more` sits under them. The daemon's log shows `limit=25&scope_kind=team&scope_name=lopdev -> 200 rows=25 next=off:25`. |
| `after/group-tail.png` | The same list after the tail control was pressed: the second page is appended BELOW the first (the group draws through Chat 077), `All chats` reads **100**, and the group's cursor has advanced to `off:50` rather than resetting. The daemon's log carries both halves of the exchange: `…scope_name=lopdev -> 200 rows=25 next=off:25`, then `…&cursor=off%3A25 -> 200 rows=25 next=off:50`. The numbers behind the frame are in *The tail press* below. |
| `before-withdrawn/group-open.png` | The BEFORE half, and the operator's screenshot: `lopdev` expanded reads **"No chats yet"** while the same store holds 70 of that group's conversations, `All chats 50`, and the panel says `Showing up to 500 chats. Older chats remain available in the terminal.` The group's badge is absent because on this path there is no census to draw one from. |
| `before-withdrawn/head-page.png` | The same withdrawn panel at first paint. |
| `census-waiting/group-open.png` | A group whose page has NOT caught up with the store: the daemon counts 70 (`--scope-empty` answers scoped reads with no rows), so the badge reads 70 and the body says **"Loading chats…"**. Under the old rule this state and true emptiness both drew "No chats yet"; the two sentences are now different because the two states are. |
| `refusal/group-error.png` | A group whose read refused (`--scope-error`, HTTP 500): the group's row carries the daemon's own sentence and a **Retry**, and the row count is unchanged (50). A failure outranks the "not caught up" guess — asked the other way round this state read "Loading chats…" for ever, which is how this frame earned its place: the scene caught it and the order was fixed in `sidebar-scope-paging.ts`. |

## How these frames were taken

One scene, `sidebar-lazy-chats`, in `scripts/renderer-driver.mjs`, in a headless
launch (`AGENTS.md` § *Running the app without taking the operator's focus*). The
stand-in is the repository's own
`docs/evidence/sidebar-row-space/harness/stub-daemon.mjs`, extended rather than
duplicated, and the extension is INERT without `--catalogue`: with no flag it
answers exactly what it answered before, so the `sidebar-row-space` frames are
photographed over an unchanged daemon.

```
set -a; . ~/local-operator-ui/.env; set +a
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18391 pnpm build

# one stand-in per case; --catalogue 120 swaps the six-chat fixture for 120 chats
# spread across two teams, two agents and the unbound population, of which the
# first FIFTY are every chat that is not in `lopdev` (so the head page and the
# group's own page are disjoint, as the operator's store is).
node docs/evidence/sidebar-row-space/harness/stub-daemon.mjs \
  --port 18391 --catalogue 120 --records "$SCRATCH/lz-rec-paged" \
  > "$SCRATCH/lz-stub-paged.log" 2>&1 &

LOCAL_OPERATOR_DESKTOP_TOKEN=$(openssl rand -hex 32) node scripts/renderer-driver.mjs \
  --scene sidebar-lazy-chats --scoped-case paged \
  --backend http://127.0.0.1:18391 --backend-records "$SCRATCH/lz-rec-paged" \
  --seed-onboarding-complete --stub-log "$SCRATCH/lz-stub-paged.log" \
  --theme localOperatorDark --out "$SCRATCH/lz-paged" --window-size 1380x900
```

The other three cases are the same command with a different stand-in and
`--scoped-case`: `--no-page --truncate 50` + `withdrawn`, `--scope-empty` +
`empty`, `--scope-error` + `error`. `--scoped-case` names which arm of the scene
this run is photographing, and each arm's assertions are listed in the scene.

**The scene asserts what it photographs.** Seven checks per run, including the two
numbers above (the store's row count is the head page, not the catalogue; expanding
one group adds exactly its own page) and the three sentences (`Loading chats…`,
`No chats yet` only on the withdrawn path, and the refusal with its Retry). The
`--stub-log` clauses read the requests the daemon actually received, because the
DOM cannot say which page a control asked for.

## The tail press: what it is now proven to do, and by what

`after/group-tail.png` is the frame AFTER the tail control was pressed, and the
claim is now asserted rather than described. The scene presses
`[data-scope-more="team:lopdev"]`, then **polls the store's own scope every 100 ms
for up to 10 s** and fails loudly on timeout with the state it last saw and the
daemon's lines for that scope. On this tree the wait returns, and the numbers are:

| what | before the press | after it |
|---|---|---|
| the scope's ids | 25 | **50** |
| the scope's cursor | `off:25` | **`off:50`** (the page after it, not the end) |
| the store's rows (`state.sessionCount`) | 75 | **100** — `All chats 100` in the frame |
| the daemon's own log | `…scope_name=lopdev -> 200 rows=25 next=off:25` | `…&cursor=off%3A25 -> 200 rows=25 next=off:50` |

The frame shows the appended rows (the group now draws through Chat 077) beneath
the first page's, and the cursor advancing rather than being reset is what the
merged-scope state above asserts.

**Why the assert is a bounded poll and not a read-back, recorded because the first
version of this scene got it wrong.** `state.sessionCount` is a PROXY: a page whose
rows the client already holds grows it by nothing, so a merged answer and a dropped
one are indistinguishable through it. The scope's own `ids`/`nextCursor` are the
claim itself, and a single sample cannot separate "merged" from "not merged yet" —
which is precisely the reading this set reported for several runs.

**And the discrepancy itself is withdrawn: it was this harness, not the app.** The
stand-in computed a page offset with `cursor.slice(3)` against a four-character
prefix (`off:`), so `"off:25".slice(3)` was `":25"`, `Number(":25")` was `NaN`, and
`NaN || 0` served **page one again** for every cursor the app sent. The app did the
correct thing with a repeated page — it collapsed the ids it already held, which is
exactly what its merge is specified to do across a cursor walk (design §2.2) — and
the panel showed no growth. `rows=` on the daemon's log line is what made the
answer visible (`rows=25 next=off:25` for BOTH pages); the offset is now read from
the prefix's own length, and the walk is verified end to end:

```
cursor=none    rows 25  first p050  last p074  next off:25
cursor=off:25  rows 25  first p075  last p099  next off:50
cursor=off:50  rows 20  first p100  last p119  next null      (the group's 70, exhausted)
```

The strict assertion is what caught it: with the old lenient version this set would
have shipped a README explaining an app defect that did not exist.

## Provenance

- Driver scene: `sidebar-lazy-chats` in `scripts/renderer-driver.mjs`.
- Stand-in: `docs/evidence/sidebar-row-space/harness/stub-daemon.mjs`
  (`--catalogue`, `--no-page`, `--truncate`, `--scope-empty`, `--scope-error`,
  and the paged/`with_counts` list route).
- Window: 1380x900 at `deviceScaleFactor: 2` (2760x1736 frames), one launch per
  case, every launch `--window-mode=headless`, no window shown and none focused
  (asserted in each run), and no process left behind (asserted in each run).
- Theme: `localOperatorDark`.
