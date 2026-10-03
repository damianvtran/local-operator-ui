# In-thread search — `⌘F` over a conversation

The operator's ask: "cmd/ctrl+F to bring up a search UX, should be a floating
search that when you type finds matching user/agent messages with soft match
and semantic/contextual search to be able to find a specific message in the
thread and highlight it, clicking brings you back to that position."

This set is the panel's own states, one frame per state, on the transcript's
`canvas` ground at the corner the panel occupies. It is captured against the
fixture stories in `thread-search-overlay.stories.tsx` — the panel is a
presentational component fed by a hook, so every state below is a resting prop
rather than a clicked path.

**What this set does NOT show, so absence is not read as coverage:**

- The panel composed **over a live transcript**, and a live capture of a
  far-back jump's motion. The pieces are built and wired — the overlay mounts
  with the transcript in the same change, and a click hands the hit to the
  transcript's own near path (`ensureReachable`: load pages, mount the window,
  then `jumpToEntry`'s reveal, centre and flash) — but a headless capture of
  that motion through the real app belongs to the wiring phase's scene, and
  these frames show the panel's own states, not the transcript it floats over.
  The reveal a hit takes: a target inside a collapsed turn opens the bar, the
  fold and the row's own disclosure on the way to it (`revealRecord`), a target
  within the near path's budgets is paged in and centred, and one further back
  than 12 pages / 1200 rows earns the honest sentence rather than silence.
- The chord itself, which is keyboard state rather than a resting render.
  `scripts/thread-search-overlay.test.mjs` drives the real key events
  (`⌘F` opens from the four chat regions only, a dialog keeps its own, Escape
  hands focus back); `scripts/use-thread-search.test.mjs` drives the debounce,
  the stale-answer guard and the one follow-up a `building` index earns.

| state | frame | what it shows |
| --- | --- | --- |
| rest | `rest/<theme>.webp` | the box with its chord cap and the keyboard hints |
| searching | `searching/<theme>.webp` | a query past the debounce, no answer yet |
| results | `results/<theme>.webp` | the ranked list: role labels, matched runs, the active row's bar, the soft tier's `related` hint |
| empty | `empty/<theme>.webp` | a settled answer with no hits |
| building | `building/<theme>.webp` | the cold index: nothing to show yet, and the sentence that says which wait this is |
| building-partial | `building-partial/<theme>.webp` | hits from the previous scan, with the partial sentence |
| unsupported | `unsupported/<theme>.webp` | a peer conversation; no amount of asking moves the bytes |
| error | `error-state/<theme>.webp` | a failed read with the reader's `Try again` |

**Themes.** `localOperatorDark` and `localOperatorLight` are the brand pair; a
third, `obsidian`, is here because it is the palette where the accent wash
collapses onto the panel's own `elevated` ground (ΔE00 0.77) — the collapse
that made the first capture's match marks invisible, and the reason the mark
now carries an accent underline as its second, non-luminance signal. That
first capture is the record of what looking is for: at 900x592 the mismatched
word read as plain text, and the panel sat 4px from the frame's right edge
because the story frame lived inside the iframe body's default margin. Both
were fixed (`ed0c4cf5f`) and the set re-taken whole.

The pin for the mark is in `scripts/contrast-contract.mjs` (`search match mark
in a snippet`), beside the active row's bar (`search result row active mark`)
and the landing wash's stylesheet pair, which
`scripts/thread-search-overlay.test.mjs` holds to the reveal's own timer.

**Capture.** Storybook on a free port, then:

```
node scripts/capture-evidence.mjs http://localhost:6041 \
  --only=chat-in-thread-search \
  --themes=localOperatorDark,localOperatorLight,obsidian \
  --allow-backend --theme-settle-ms=180000
```

`--allow-backend` is this host's own state (the operator's live backend runs
on 1111 and the guard refuses a capture that could be photographing its
replies); every story here renders from fixture props and calls nothing.
`--theme-settle-ms` is the loaded-machine budget the flag exists for.

**Round 2.** Two pixel-level fixes and one sentence: the story replica that
frames the panel drifted at `right-3` while the app floats at `right-6`, so
this set is the first whose frames show design D1's inset (the panel's right
edge reads 875 against the old 886 — review B measured the 12px); and a
PAGE-LEADING jump target now fetches one more page so its mount has rows above
it to centre against (QA Q-2: `ReachOptions.hasHeadroom`, the load loop's stop
condition). The model's state docstring also stopped calling `loading` the
debounce window (review A).

**Round 1's re-shoot.** The review round moved the panel to `right-6` (24px; at
12px it covered the rail's ticks for 13 of 26 positions at three results) and
carried new copy through the states: a tier-aware count line with the cut as
its suffix ("1 exact · 99 related (first 100 shown)"), a soft-tier mark that
reads "related match", a retained list that says it is the previous search's,
and a far seek that reports itself while it runs. Every frame here is from
that re-shoot.

**Fold and re-stamp.** The branch now folds `origin/main` = `bc09a6d698`
(#630, the checkpoint-rail merge; the rail's files and its jump are upstream
rather than sibling), and the reveal rides that lane's `reveal-record.ts` —
`jumpToEntry` for the reveal/centre/flash leg and `ensureReachable` for the
transcript's paging — rather than any copy of its own. The manifest is re-derived
at the rebased code head (`head`, and `frames`/`surfaces`/`themes` with the
`countsMean` readings from the walk), and this file rides the `docs/`-only commit
that follows it — a commit that moves neither tree, so the counts keep describing
the tree they ship in.

## The endpoint, measured against the real backend

The renderer talks to `GET /v1/desktop/sessions/{id}/find` (the backend half
is damianvtran/local-operator#1717). The numbers below are from that route,
served **locally** from the sibling worktree that carries it, over loopback
HTTP with an **isolated config root** — a synthetic conversation written
through the real journal writer, nothing from the operator's store.

Setup: `HOME` and `LOCAL_OPERATOR_CONFIG_DIR` pointed at a scratch root, the
server started as `python -c 'from local_operator.cli import main; main()'
serve --port <p>`, the probe client timing 20 iterations per case.

**A 12-message conversation** (first query 74 ms, then):

| query | state | hits | tiers | p50 | p95 |
| --- | --- | --- | --- | --- | --- |
| `ledger` | ready | 5 | exact | 23.5 ms | 117.1 ms |
| `retention` | ready | 2 | exact | 15.0 ms | 75.3 ms |
| `classifer` (a typo) | ready | 1 | **soft** | 17.9 ms | 134.4 ms |
| `z` (one character) | ready | 3 | exact | 14.3 ms | 68.0 ms |
| a whole sentence | ready | 1 | exact | 19.7 ms | 119.3 ms |
| `a&b #c` | ready | 3 | soft | 14.7 ms | 192.8 ms |
| `limit=1` / `limit=200` | ready | 1 / 5 | exact | 17.1 / 16.1 ms | 107.6 / 94.1 ms |

**A 20,000-message conversation (6.1 MB journal)** — the cold path the
overlay's `building` state exists for:

- first call: `state=building`, `partial=true`, `hits=[]` in **1121 ms**
  (the route's own first-paint budget is 200 ms; the rest is first-touch cost);
- the first follow-up, 300 ms later: `state=ready`, 100 hits, that call
  answering in **2172 ms** — so a cold 6.1 MB journal is searchable about
  **3.6 s** after the first keystroke;
- warm queries on the same session: p50 **0.5–1.1 s** per query (20 iterations
  per case, exact and soft tiers alike).

Two consequences are why the hook is shaped the way it is: the **200 ms
debounce** is what keeps a fast typist from queueing one of those scans per
keystroke, and the **one 1500 ms follow-up** is a polite single re-ask for the
small journals that finish fast — a 6 MB journal is not ready in 1.5 s, and
the panel then says the index is still catching up and leaves the retry to a
gesture rather than polling.

**The client half, in the harness (not the live app).** A jsdom harness on
this host, React in development mode, load average ~90 — indicative, not a
product figure: mounting the panel with a full 100-row page of hits took
457 ms; a keystroke's re-render 36 ms; an answer replacing 100 rows 248 ms;
and a keystroke through the hook to a settled answer 220 ms, i.e. the 200 ms
debounce plus about 20 ms of work. The end-to-end typing-to-paint figure in
the real renderer lands with the wiring phase, where the app can be driven.
