# `/usage` — provider usage view

Specification and design record for replacing the raw-JSON `/usage` picker with
a real provider-usage view. Written before implementation so the port from the
TUI is a checklist rather than a reconstruction, and so the review rounds have
one artifact to judge against.

## Why

`/usage` in the desktop app renders each provider report as a card containing
`JSON.stringify(report, null, 2)`. The data the backend already returns —
per-window quota, reset countdowns, a binding window, account staleness — is
information a user asked a question to get, and it is currently something they
have to parse. The TUI (`local_operator/tui/widgets/usage_panel.py`) answers
the same question properly; the desktop view should carry the same information,
in the app's idiom.

## Source of truth for the port

| Reference | Path |
|---|---|
| TUI panel (content + copy rules) | `~/local-operator/local_operator/tui/widgets/usage_panel.py` |
| TUI report/limit/amount model | `~/local-operator/local_operator/providers/usage.py` |
| Backend route that serves the view | `~/local-operator/local_operator/server/routes/desktop_catalogues.py` (`/v1/desktop/usage`) |
| App data contract | `src/shared/desktop-contract.ts` (`usage.get`), `src/renderer/src/shared/api/local-operator/desktop-api.ts` |
| Design contract | `docs/branding.md` |

## Data contract (what the renderer actually receives)

`usage.get` → `{ reports: UsageReport[], source: "cached" | "live", fetched_at: number }`
where `fetched_at` is the server clock in epoch ms at response time.

The backend sends `dataclasses.asdict(UsageReport)` plus two derived fields, so
every field below is present. Nothing is filtered.

```ts
type UsageUnit = "usd" | "percent" | "tokens" | "requests" | "unknown";

type UsageAmount = {
  used: number | null;
  limit: number | null;
  remaining: number | null;
  used_fraction: number | null; // explicit 0..1, precedence over derived
  unit: UsageUnit;
};

type UsageLimit = {
  id: string;
  label: string;
  amount: UsageAmount;
  window: string;          // free-form window name from the vendor
  status: string | null;   // ok | warning | exhausted | unknown, else null
  resets_at: string | null;      // vendor string, may be unparseable
  resets_at_ms: number | null;   // epoch ms, parsed when understood
  tier: string;            // model family for a per-model cap; "" when account-wide
  shared: boolean;         // true for the account-wide umbrella windows
};

type UsageReport = {
  provider: string;
  fetched_at: number;            // epoch ms
  limits: UsageLimit[];
  notes: null;                   // always nulled by the route
  identity: string | null;       // account label (e.g. an email)
  consecutive_failures: number;
  usage_unavailable: boolean;
  next_probe_at_ms: number | null;
  credential_invalid: boolean;
  age_ms: number;                // server now - report.fetched_at
  state: "available" | "partial" | "unavailable" | "reauth_required";
};
```

`state` is derived server-side and is authoritative; do not re-derive it from
counters. It means: `reauth_required` (credential_invalid), `unavailable`
(probe failing or no limits at all), `partial` (a failure streak, numbers still
present), `available`.

## Rules ported from the TUI (each one is a test)

1. **Effective status.** `limit.status` wins; otherwise derive from the
   consumed fraction: `>= 1.0` exhausted, `>= 0.85` warning, `< 0.85` ok,
   unmeasurable unknown.
2. **Fraction.** `used_fraction` if present; else `used / limit` when
   `limit > 0`; else `used / (used + remaining)` when that sum is positive;
   else null. Never guess a fraction.
3. **Amount text.** Percent is an integer with a `%` suffix. USD keeps two
   decimals. Other units use `%g` with the unit label (`tokens`, `req`). A
   used/limit pair in real units prints both (`12.00 USD / 40.00 USD`); a
   percent does not repeat its denominator. Remaining-only → `N left`.
   Limit-only → `N limit`. Explicit fraction with no numbers → `N% used`.
   Nothing at all → `not reported`.
4. **Unknown is not zero.** A window with no measurable fraction renders NO
   fill in its bar and the words `not reported`; it does not render an empty
   bar, which is a claim that nothing has been spent.
5. **Countdown.** Two units at most, largest first, smaller dropped when zero:
   `45m`, `3h24m`, `3h`, `2d11h`, `2d`. Empty when the reset is unknown or has
   passed.
6. **Age.** `just now` under a minute, then `40s ago` is deliberately absent —
   the ladder is `just now`, `Nm ago`, `Nh ago`, `Nd ago`.
7. **Binding window.** The account-wide window closest to its cap wins; a
   per-model cap only leads when no account-wide window has a measurable
   fraction. Stated on the block's first row, because "can I keep working" is
   the question the view answers.
8. **Tier rows are subordinate.** A per-model cap (`tier !== ""`) is indented
   and dimmer than the shared rows, so a 100% family cap never reads as a dead
   account.
9. **One table, not one per provider.** Numeric columns share a width across
   every report, so the blocks scan as one table.
10. **Stale is a fact about the title, not about a failure count.** A report
    materially older than the response stamp (`age_ms >= 6.25 min`, which is
    `USAGE_REPORT_TTL_MS * 1.25`) says so on its own block. A
    `consecutive_failures > 0` on a fresh report says nothing and must NOT
    produce a note.
11. **A dead grant names its remedy.** `credential_invalid` → the block's note
    names `/login <provider>`, and the last-known numbers keep rendering under
    it.
12. **Footer tally counts windows, not providers**: `6 windows · 1 exhausted ·
    1 near limit`, worst state first, with `N not reported` when some window
    carries no number.

## Design (app idiom)

Roles, never colours (`docs/branding.md` § 1). Every `className` through `cn`.

- The picker frame is unchanged: `PickerHost` `wide`, title `Provider usage`,
  description naming the source and its age.
- Provider block: `rounded-md border border-hairline bg-surface px-3 py-2.5`.
  The dialog sits on `elevated`, so `surface` is the step down that reads as a
  card, and the bar track's `sunken` is a third, clearly recessed step.
- Heading row: provider name `text-body-sm font-medium text-ink`, identity
  `text-ink-muted text-meta`, then the binding window tinted by its own status
  with the countdown in `text-ink-dim`.
- One grid row per window:
  `dot | label | bar | amount | resets in …`, the bar absorbing all the slack —
  it is a redundant picture of a number already on the row, so it is what a
  narrow frame takes cells from first.
- Status dot is `size-1.5 rounded-full`: `bg-success` / `bg-warning` /
  `bg-danger`, and an outlined empty circle for unmeasurable. Tint is a second
  channel, never the only one — the words and the fill carry it too.
- Amount `font-mono text-mono-sm tabular-nums text-ink-muted`; countdown
  `font-mono text-mono-sm text-ink-dim`. Monospace is machine voice; these are
  counts and timestamps.
- Radius 6 for the card, spacing off the 4px ramp, no shadow (nothing here
  leaves the flow), no hover motion.
- Copy is sentence case, no emoji, and says what happened, in the user's terms.
