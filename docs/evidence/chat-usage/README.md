# `/usage` — provider usage view: visual evidence

Frames for the view specified in [`SPEC.md`](./SPEC.md), which replaced the
raw-JSON `/usage` picker. Two brand themes each; `localOperatorDark` is the
default palette and `localOperatorLight` is the one where a contrast defect
hides, which is why the documented minimum is both.

Everything here except `real-data/` is a Storybook story rendering the
production `UsageDialog` — the shipped dialog with its query lifted out — over
fixtures. Fixtures because these states cannot be produced on demand: an OAuth
grant has to die, a provider has to go idle past its cache TTL, a weekly window
has to actually run out. `real-data/` answers the question fixtures cannot.

## What each frame shows

| Surface | What it is evidence of |
|---|---|
| `multi-provider` | The main case: 4 providers, 8 windows, every status. The amount and countdown columns form ONE right edge across all four blocks (SPEC rule 9), tier rows are indented and dimmer (rule 8), and Anthropic's binding window is the account-wide 7-day at 88% even though its Opus tier row is at 100% — the binding rule (rule 7) working. |
| `percent-only` | A provider whose report carries no currency anywhere. The binding window is the account-wide `Weekly 37%`, not the 91% reasoning tier. |
| `remaining-balance` | A remaining-only balance (what both balance fetchers report). It prints `519.86 USD left` and draws a DOTTED rule, not a bar at zero (rule 4). Tally reads `1 window`, singular. |
| `loading` | First paint, before the cached report returns. Skeleton rows shaped like the blocks that replace them, so the state reads as deliberate rather than as a bare word in an empty body. The action reads `Asking providers` and is DISABLED, because react-query reports `isLoading` and `isFetching` together on a first load — this frame previously showed it enabled, which the shipped container cannot produce (see "What these frames are not"). |
| `empty` | No provider publishes quota, or none is signed in. |
| `query-error` | The backend refused. The message shown is the backend's own, never synthesised. |
| `fetching` | Live numbers asked for, request still out: the action reads `Asking providers` and is disabled, with the cached numbers still on screen. No spinner — there is nothing to watch. The retained numbers are real behaviour rather than a story prop: `live` is part of the query key, and `placeholderData: keepPreviousData` is what keeps the previous payload rendering while the new key loads. |
| `stale-report` | A block 40 minutes behind THE SET'S NEWEST CONFIRMATION, beside a fresh one. The stale block says `Last known 40m ago` and its dots drop to the dim ramp while its bars keep their quota tint; the fresh block is unmarked (rule 10). The baseline is the newest confirmed `fetched_at` across the reports, not the response's own stamp — measuring against the response stamp marked every block in `real-data`, which is the mark distinguishing nothing. |
| `unavailable-with-last-known` | A failing probe whose last-known meters keep rendering under the note (`Usage unavailable — last known 2h ago`). |
| `reauth-required` | A dead OAuth grant naming its remedy — `Sign-in expired — run /login xai. Last known 2d ago.` — with last-known numbers still under it (rule 11). The vintage is a sentence in the vocabulary its sibling states teach, not a telegraphic `· numbers 2d ago`. |
| `not-reported` | Windows carrying no measurable number: outlined dots, dotted rules, `not reported`, no binding window claimed, and `2 not reported` in the tally (rules 4 and 12). The dotted rule is drawn on the `ink-dim` ramp: it is the entire distinction between "reports nothing" and "at zero", which makes it structural and puts it on the 3:1 floor rather than on floor-exempt `ink-disabled`. |
| `narrow` | The dialog at a 720px viewport. The bar surrenders space first; labels, amounts and countdowns hold. |
| `real-data` | **Not a fixture.** The shipped view against a real `/v1/desktop/usage` response from the local backend: 11 provider reports, 28 windows. See below. |

## What these frames are not

A frame is only evidence if the app can actually reach the state in it, and two
of these could not. Both were caught in review and both are fixed rather than
re-labelled:

- `loading` showed `Ask providers now` **enabled**. react-query sets
  `isLoading` and `isFetching` together on a first load, so the shipped
  container always passes both and the action is always disabled at first
  paint. The story had left `fetching` at its default.
- `fetching` showed cached numbers retained during a live ask, which the
  container could not do: `live` is part of the query key, so the ask started a
  query with no data and the body replaced the table with the word `Loading`.

The states are now reachable, and the agreement is pinned by a test rather than
by this paragraph: `scripts/usage-container.test.mjs` renders the real container
through the live-ask lifecycle and asserts the stories' own args against the
props the container hands over at that moment. A story that drifts back into
depicting an unreachable toolbar fails there.

## Re-capturing the story frames

```
pnpm build-storybook
npx http-server storybook-static -p 6031 --silent      # any free port
node scripts/capture-evidence.mjs http://localhost:6031 \
  --only=chat-usage --themes=localOperatorDark,localOperatorLight
```

Drop `--allow-backend` unless a Local Operator backend is listening on the
configured port; the guard exists because a capture taken against a live server
silently photographs that server's replies. These stories render fixtures and
never call out, which is what the flag asserts.

### Evidence accounting

A narrowed (`--only`) run does **not** update `manifest.json`'s `frames` /
`surfaces` totals — it records what it refreshed under `partialCapture` instead
— while `check-evidence` asserts that `manifest.frames` equals the number of
frames on disk outside every declared `supplementary` set. Adding stories under
`--only` therefore breaks `pnpm check-evidence` until the totals are corrected.

They were corrected by hand here rather than by running the ~14-minute
twelve-theme sweep over 45 unrelated surfaces:

- `frames` 474 → **498**: the 12 new `chat-usage` stories × 2 themes = 24 frames,
  which ARE sweep output (they are registered in `STORIES` in
  `scripts/capture-evidence.mjs`) and so belong in the sweep's own count.
- `surfaces` 45 → **57**: the same 12 stories.
- `real-data` is declared in `supplementary` with its own provenance, because it
  is **not** sweep output and a full sweep cannot re-derive it.

`node scripts/check-evidence.mjs` passes over all 522 frames on disk.

## Re-capturing the real-data frames

These exist because a port can agree with its own fixtures and still be wrong
about the wire. They render the shipped `UsageDialog` against a response the
backend genuinely produced.

```
pnpm vite --config scripts/usage-real-evidence.vite.mjs   # one shell
node scripts/usage-real-evidence.mjs                      # another
```

The capture reads the desktop bearer from the running server process's own
environment (`ps eww`), uses it for exactly one request, and never prints,
logs, or writes it. Account identities — real emails and key fragments — are
replaced with shape-preserving stand-ins before the payload reaches the page,
because the identity shares the heading row and a shorter redaction would
photograph a layout no user has. **Nothing else is altered:** every number,
window, tier, unit, ordering and staleness value is the backend's own.

The committed frames were taken with `--payload=<file>`, which replays a
response saved from an earlier run of this same script against this machine's
backend. That path exists because the backend's usage cache is emptied when it
restarts, and refilling it means probing every signed-in provider's
rate-limited endpoint; the backend restarted mid-session here. The payload is
a real response either way — the flag only decides whether it is read from the
socket now or from a response that came off it an hour earlier. It is never
written into the repository.

What the real data surfaced that fixtures had not: **one provider can hold
several signed-in accounts.** The live report carries five `anthropic` reports,
which collided in the view's React `key` and collapsed them into one block. The
key is now `provider:identity`, and the frame shows all five rendering.

It surfaced two more in review, which is the strongest argument for keeping this
frame in the set. The committed pair read `Cached report, just now.` above blocks
the same frame dated `1h ago`, and marked **all eleven** blocks stale — a mark
that fires on everything distinguishes nothing. Both came from measuring against
the response's own `fetched_at`, which the route stamps with the server clock at
response time. The baseline is now the newest confirmed `fetched_at` across the
set, and the re-captured frame reads `Cached report, 34m ago.` and marks 10 of
11: `openrouter`, the one account actually confirmed at that newest stamp, is
unmarked. A fixture would not have caught either, because a fixture's stamps are
whatever the fixture says they are.

## Round 2 (remediation): what these frames do and do not show

The story frames were re-captured for the scroll-fold change. The rule under a
scrolling body is no longer drawn from the picker's `bodyScrolls` flag alone —
it is measured per state from the scroll container — so the six states whose
content ends above the fold (`empty`, `query-error`, `fetching`,
`percent-only`, `remaining-balance`, `narrow`) no longer carry a boundary under
nothing, and an overflowing body gets a `border-control` rule plus a 20px
bottom fade that retracts once the list is scrolled to its end. `loading` also
changed copy: a first paint reads `Reading cached usage`, because opening the
view reads the backend's cache rather than asking the providers.

**`real-data/` is stale with respect to that change** and still shows the
round-1 clip. It cannot be re-derived right now: this machine's backend returns
zero provider reports, and the `--payload` file that replayed the 11-report
response is deliberately never committed, so neither the live path nor the
replay path can reproduce it. Everything else the frame is evidence for — the
staleness baseline, the description line, the per-account multi-login keying —
is untouched by this round.

The fold was instead verified at that same density in
`scripts/usage-interaction.html`: 11 provider blocks and 22 windows, 1217px of
content in a 520px box, measuring a 1px `border-control` rule and a gradient
mask at the top of the scroll, and the mask gone with the rule still present at
the bottom, in both brand themes. Re-capture `real-data/` on a machine whose
backend holds a populated usage cache.
