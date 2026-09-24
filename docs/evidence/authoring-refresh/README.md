# The authoring lists, refreshed by a frame rather than by a refresh

A write the app did not make — an agent creating a team or a profile on the
backend — and whether the sidebar's Agents/Teams lists notice it with nobody
touching the window.

Produced by `scripts/renderer-driver.mjs --scene authoring-refresh` on this
branch's built app (headless, scratch profile, isolated `HOME`,
`LOCAL_OPERATOR_CONFIG_DIR` and `LOCAL_OPERATOR_LOG_DIR`, every `CMUX_*`/`LOP_*`
stripped, `--use-mock-keychain` on the launch). The write is an HTTP request from
the run's own Node process to the backend's authoring route — never through
`window.api` and never through a press — so the app's only possible source for
it is the machine-wide feed.

## The two runs, and why both are here

The same app, the same scene and the same write against two backends. One
variable differs, and it is the frame:

| Set | Backend | What it is |
| --- | --- | --- |
| `with-frame-*` | a worktree of `local-operator` carrying the `authoring` frame (`feat/authoring-catalogue-feed`) | the fixed behaviour, and the subject of this change |
| `no-frame-*` | the installed runtime `lop v0.61.10`, whose feed publishes no such frame | the base-commit behaviour — the defect |

Measured rather than assumed: a raw subscription to each backend's
`GET /v1/desktop/events` while a team was created over its own API received
`{"type":"authoring","payload":{"revision":1}}` from the first and only
`{"type":"open"}` from the second.

## What each frame is

| Frame | State |
| --- | --- |
| `with-frame-before.png` | the sidebar before the write: Agents empty ("No agents yet"), Teams holding one row left by this set's own feed probe |
| `with-frame-after.png` | **after the write, with no interaction at all**: the new agent row under Agents and the new team row under Teams |
| `no-frame-before.png` | the same list before the same write |
| `no-frame-after.png` | **after the write, with no interaction**: byte-identical to `no-frame-before.png` (sha256 `473d59de…`), so nothing on screen moved |
| `no-frame-after-tab-switch.png` | after leaving `/chat` and returning — the tab switch the operator had to make — where both rows finally appear |

The pair is the evidence: a run that only ever showed the row appearing cannot
tell a frame-driven refresh from a mount, a poll or a stray re-render, and the
`no-frame` half is what makes the `with-frame` half causal.

## The readings behind the frames

Both from the app's own query layer (`queryFetches`, the patched
`Query.prototype.fetch`, and `queries`, the cache's `dataUpdatedAt`), with the
fetch trap armed and self-validated before the first list read:

| Reading | `with-frame` | `no-frame` |
| --- | --- | --- |
| `["desktop","teams"]` fetches, before → after the write | 0 → 1 | 0 → 0 |
| `["desktop","profiles"]` fetches, before → after | 0 → 1 | 0 → 0 |
| both keys' `dataUpdatedAt` | moved (…452304 → …455812 / …455815) | unchanged (…546971 / …546966) |
| team row on screen after the write | 112 ms, still on `/chat` | never, within 8027 ms |
| agent row on screen after the write | 2 ms | never, within 8044 ms |
| after a tab switch | — | both rows present |

The route never left `/chat` between the write and the row in the `with-frame`
run, and the scene performs no press or navigation in either run, so the refetch
cannot be a mount or a navigation. The latency is the backend's own authoring
probe cadence (its change detector publishes the frame on a one-second tick)
plus one invalidation.

## Reproducing it

```bash
# The backend for the `with-frame` half: a `local-operator` worktree carrying
# the frame, serving an isolated config root with the token the app is paired
# with. `--backend-records` is that backend's own <config>/run/serve.
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene authoring-refresh --authoring-expect refresh \
  --backend http://127.0.0.1:18762 --backend-records <config>/run/serve \
  --seed-onboarding-complete --out <dir>

# The `no-frame` half: the same command against the installed runtime on the
# same port, with `--authoring-expect stale`.
```

The renderer must have been built against the same URL
(`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18762 pnpm build`) — the run
asserts it. Five frames, five PNGs of the app's own `capturePage()`; no browser
was installed, scripted or photographed, and no story renders these states,
because the subject is an arrival from another process rather than a screen.
