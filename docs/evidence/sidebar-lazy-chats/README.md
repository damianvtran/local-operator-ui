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
| `after/head-page.png` | The first paint: **50** rows of the 120-chat stand-in (`All chats 50`), the pinned row and the running row drawn, every entity row already carrying its census badge (`lopdev 70`, `minervadev 20`, `reviewer 8`, `qa-tester 7`), and the panel's own total — **`Showing 50 of 120 chats`**, from the census the head answer carried. The daemon's log shows the request that produced it: `limit=50&include_archived=true&with_counts=true`. |
| `after/group-open.png` | `lopdev` expanded: its **own** page and nothing else — the store's row count went 50 → 75, i.e. exactly that group's first page. The badge reads **70** (the census, not the 25 rows in hand) and the panel's total reads `Showing 75 of 120 chats`. The control that offers the rest is below the group's own fold in this frame, which is why the next frame exists. |
| `after/group-open-light.png` | The SAME state in the light theme, so D1/D5's claim about the census badge and the sentences is evidenced in both registers rather than asserted (round 2, UX bookkeeping: the set had been dark-only). |
| `after/group-more.png` | **The one this round added, and the reason it exists:** the group's page scrolled to its own end, with **`Show 25 more`** drawn under `Chat 074`. The earlier version of this set CLAIMED a frame showed this control and none did — a press consumes it, so it is only in a frame taken between the scroll and the press. |
| `after/group-tail.png` | After that press: the second page appended below the first (`Chat 089` … `Chat 099` visible, the group draws through `Chat 099`), `All chats` **100**, `Previous chats` 98, and **`Show 20 more`** — the label reads the rows the NEXT press will ADD, not the page size (70 − 50), and the control is in the frame with the rows it will extend. The daemon's log carries both halves: `…scope_name=lopdev -> 200 rows=25 next=off:25`, then `…&cursor=off%3A25 -> 200 rows=25 next=off:50`. |
| `after/group-narrow.png` | The same panel at its own drag floor. The chats region measures **224px** here against **264px** at this run's default — asserted in the run, because the first attempt at this frame changed the WINDOW size instead and left the panel boxed at x 438–955 in both frames: nothing was narrower. The badge, the rows' titles and `Showing 75 of 120 chats` are all drawn at the floor. |
| `after/group-exhausted.png` | After the last press: **70** rows held, `All chats` **120**, `Showing 120 of 120 chats`, and **no control at all** — the daemon answered `limit=20&cursor=off%3A50 -> 200 rows=20 next=-`, so the last press asked for the remainder and the affordance went with the cursor. |
| `before-withdrawn/group-open.png` | The BEFORE half, and the operator's screenshot: `lopdev` expanded reads **"No chats yet"** while the same store holds 70 of that group's conversations, `All chats 50`, and the panel says `Showing up to 500 chats. Older chats remain available in the terminal.` The group's badge is absent because on this path there is no census to draw one from. |
| `before-withdrawn/head-page.png` | The same withdrawn panel at first paint. **Both `before-withdrawn` frames are byte-identical to the ones this set shipped before this round** — the compatibility promise, re-verified rather than restated. |
| `settled/group-open.png` | A **settled** group whose census still says 70 while the page can draw none of them (`--scope-empty` answers every scoped read with no rows): the badge reads 70 and the body says **"They may be archived. Search with Include archived."** — two lines at the panel's default width (281 logical px), and no wait and no emptiness (round 2, U11/D13-D15 shortened it and moved it onto the reader's own word, *archived*, rather than "drawn"). 
| `settled/group-open-narrow.png` | The SAME sentence at the panel's own drag floor (224px against this run's 264px default), which is the width the clamp was most likely to eat: the sentence is whole here — two lines, nothing truncated — and the run asserts that from the element's own `scrollHeight` rather than from the text, because a clamped sentence extracts identically to a whole one (round 3, D17; the first version of this sentence WAS clipped at the floor and the picture is what settled it). |
| `loading/group-open.png` | The same group with its answer **genuinely in flight**: badge 70 and **"Loading chats…"** — the only state in which that sentence is true. Round 2 changed how this arm drives it: the stand-in holds every scoped answer while a hold file is absent (`--scope-hold`), so the state is created and released rather than raced for. `loading/group-loaded.png` is the same run a moment later, after the scene wrote that file: the group draws its 25 rows, which is what proves the wait was real. 
| `empty-group/group-open.png` | A group that really is empty (`--scope-empty --zero-census-team lopdev`): **no badge** and **"No chats yet"**. The pair with `settled/` is the point — the two states used to share one sentence. |
| `flat-tail/flat-tail.png` | The FLAT list's own tail, which has no control by design (one scroller, one scope inside it): a scroll to the bottom of `Previous chats`, and rows that were not there before — `Chat 089` … with their `lopdev` captions. The run asserts the growth rather than photographing a scroll. |
| `refusal/group-error.png` | A group whose read refused (`--scope-error`, HTTP 500): the group draws **the backend's own sentence** (`The stub was asked to refuse scoped reads.`), clamped to two lines, with **Retry on its own line** underneath so the control's position does not depend on the message's length. Round 2, D10 = U9: the round-1 fix landed on the failed-EXTENSION branch while this frame photographed the failed FIRST page, so the treated markup and the photograph disagreed; all three refusal sites - this one, the extension's, and the flat list's tail - now wear it. 
| `refusal/flat-tail-error.png` | The **third** refusal site, and the one with no frame until now: the flat list's own tail refused (`--tail-error` refuses an unscoped request that carries a cursor, so the list paints and then cannot grow). Same treatment, read off the elements: the sentence clamped and the Retry in its own paragraph. D10's history is a fix that landed on one of three sites while the frame photographed another, so the site with no picture was the site to photograph (round 3, D18). |

## The panel's width in these frames

Every frame is taken with the sidebar at THIS run's default width (264 logical px,
measured in the run) with two exceptions, and the exception is now declared rather
than left to be discovered:

* `after/group-narrow.png` and `settled/group-open-narrow.png` are at the app's own
  drag floor (224px, the `chatSidebarWidth` clamp's lower bound), which is what makes
  them evidence about the narrow column at all.
* The two post-press frames used to be a third width — 361px, the clamp's ceiling,
  because the scene widened the panel to keep the control on screen for the press —
  and a set that mixes undeclared widths cannot be compared frame to frame (round 3,
  D16). The width is restored to this run's default before those captures now, and the
  press still lands because the control is scrolled into view rather than the panel
  widened around it.

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

The other six cases are the same command with a different stand-in and
`--scoped-case`. Each arm names one state, and the flags are the state:

| arm | stand-in flags | what it photographs |
|---|---|---|
| `paged` | (none) | the feature: the head page, a group's own page on expand, its tail, the drag floor, exhaustion |
| `withdrawn` | `--no-page --truncate 50` | today's behaviour against a daemon that cannot page |
| `empty` | `--scope-empty` | a settled page the census still outruns |
| `loading` | `--scope-hold <file>` | a wait that is really happening |
| `empty-group` | `--scope-empty --zero-census-team lopdev` | a genuinely empty group |
| `flat-tail` | (none) | the flat list's own tail: a scroll, then rows |
| `error` | `--scope-error` | a refused scoped read |

**The scene asserts what it photographs.** Each arm checks its own state, including
the two numbers above (the store's row count is the head page, not the catalogue;
expanding one group adds exactly its own page), the label's arithmetic (`Show 20
more` with 50 of 70 drawn), the drag floor's own width, and the sentences — the
`--stub-log` clauses read the requests the daemon actually received, because the DOM
cannot say which page a control asked for. Two arms were added in round 1 because
the set CLAIMED frames it did not have: `group-more` (the control, before a press
consumes it) and `flat-tail` (the list that extends without a control at all).

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
| the control's label | `Show 25 more` | **`Show 20 more`** (70 − 50: the rows the next press ADDS) |
| the daemon's own log | `…scope_name=lopdev -> 200 rows=25 next=off:25` | `…&cursor=off%3A25 -> 200 rows=25 next=off:50` |

The frame shows the appended rows beneath the first page's, with the control that
offers the rest in the same frame, and the cursor advancing rather than being reset
is what the merged-scope state above asserts.

**And the LAST press is exact.** A third press at 50 of 70 read `Show 20 more` and
asked the daemon for exactly that:

```
stub GET …sessions?limit=20&scope_kind=team&scope_name=lopdev&cursor=off%3A50 -> 200 rows=20 next=-
```

70 ids held, cursor `null`, no control — `after/group-exhausted.png`. The label used
to be the PAGE SIZE, so 65 of 70 read `Show 25 more` and the press fetched 25 for a
remainder of 5.

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
  `--scope-delay-ms`, `--zero-census-team`, and the paged/`with_counts` list route).

## What this stand-in cannot drive, said here rather than discovered later

The paged fixtures are the large catalogue (`--catalogue 120`), and the stand-in's
OTHER routes are still the six-row fixture's. That is a limit of the rig, and it
bounds what these frames can show:

- **Its pin route answers 404 for a catalogue row.** `sessions.pin` is served for
  the six fixtures only, so the app's own rule withholds the pin control on the 120
  rows this set photographs. The pinned row visible in `after/*.png` is `Chat 001`, a row of the LARGE fixture that the stand-in marks pinned, so the section is
  photographed from a state the fixture set rather than from a press: the stand-in's own pin route answers only its six small
  conversations. **The pinned-section behaviour under paging is
  therefore not exercised here** — it is covered by `chat-sidebar-pins.test.mjs`.
- **Its search answers only from the six rows, and omits `pinned`.** A query in
  this rig therefore returns matches that are mostly outside the catalogue page, and
  the rows it returns carry no pin state, so the search path's interaction with
  paging (a hit the client does not hold, `chat-search.ts`'s synthesised row) is
  exercised by `palette-search.test.mjs` and `chat-search.test.mjs` rather than by a
  frame. The synthesised row's binding caption is derived client-side from the
  loaded scopes, which those suites assert.
- **Nothing here drives the real daemon.** The capability, the cursor's opacity and
  the census are the stand-in's answers, so a frame proves the PANEL's behaviour
  given those answers; the daemon's own half is the peer branch's evidence (the
  `session_catalogue_page` route, its cost test and its cursor walk).
- Window: 1380x900 at `deviceScaleFactor: 2` (2760x1736 frames), one launch per
  case, every launch `--window-mode=headless`, no window shown and none focused
  (asserted in each run), and no process left behind (asserted in each run).
- Theme: `localOperatorDark`.
