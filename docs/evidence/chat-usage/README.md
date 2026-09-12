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
| `loading` | First paint, before the cached report returns. The tally renders nothing rather than an empty strip; the action stays right-aligned. |
| `empty` | No provider publishes quota, or none is signed in. |
| `query-error` | The backend refused. The message shown is the backend's own, never synthesised. |
| `fetching` | Live numbers asked for, request still out: the action reads `Asking providers` and is disabled, with the cached numbers still on screen. No spinner — there is nothing to watch. |
| `stale-report` | A block 40 minutes behind the response stamp, beside a fresh one. The stale block says `Last known 40m ago` and its dots drop to the dim ramp while its bars keep their quota tint; the fresh block is unmarked (rule 10). |
| `unavailable-with-last-known` | A failing probe whose last-known meters keep rendering under the note (`Usage unavailable — last known 2h ago`). |
| `reauth-required` | A dead OAuth grant naming its remedy — `Sign-in expired — run /login xai` — with last-known numbers still under it (rule 11). |
| `not-reported` | Windows carrying no measurable number: outlined dots, dotted rules, `not reported`, no binding window claimed, and `2 not reported` in the tally (rules 4 and 12). |
| `narrow` | The dialog at a 720px viewport. The bar surrenders space first; labels, amounts and countdowns hold. |
| `real-data` | **Not a fixture.** The shipped view against a real `/v1/desktop/usage` response from the local backend: 11 provider reports, 28 windows, 8 exhausted. See below. |

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
