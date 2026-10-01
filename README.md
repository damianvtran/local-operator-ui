# `/login`, `/logout` and `/mcp` suggestions — before/after frames

The operator's report: typing `/login ope…` in the composer offered nothing,
and no provider/MCP list existed anywhere in the popup. This branch gives the
three commands their sessionless argument lists, read from the same backend
registry the dialogs read. These frames are the PAIR, produced by ONE rig
(`scripts/slash-enter-proof.mjs` on the feature branch) against two trees:

```sh
SLASH_PROOF_CASES=login,logout,mcp \
  node scripts/slash-enter-proof.mjs http://localhost:<storybook-port> <out-dir>
```

| Directory | Tree | Result |
| --- | --- | --- |
| `chat-slash-providers/` | `feat/provider-suggestions-0930`, **re-captured in remediation round 1 after the fixes** (its frames are from the branch's `src/`+`scripts/` trees at that head; a later fold re-stamps the evidence manifest without re-taking them) | 19/19 gestures as the rule requires |
| `chat-slash-providers-520/` | the same branch and case set at **520×900** — the narrow-width re-capture the design round asked for (D2's compound rows, U5's shed detail column) | 19/19 |
| `chat-slash-providers-baseline/` | `origin/main` `dad1778e14`, the original 13-case set | 1/13; every list absent, every click "nothing to click". The six cases added in round 1 have no baseline pair: on that tree none of their states exist — no list opens at all. |

Each directory carries `result.json` (every case's before/after readings and
its expectation) and `run.log` (the full transcript).

## What produced them, and what they are not

- Both runs drive the app's **own story fixture bridge**
  (`message-input.stories.tsx`) through Storybook — the renderer, its real
  popup, its real key handling — with a single private `--headless=new`
  Chromium per run (argv through `scripts/chrome-keychain.mjs` with
  `withMockKeychain`), no window, no focus theft.
- **FIXTURE-staged, marked as such**: the census rows, the stored accounts and
  the MCP catalog are the bridge's documents, not a live daemon. The live
  pair (the core lane's `feat/provider-registry-0930` backend + this branch)
  is a QA step once that branch is pushed; the frames here are the renderer
  half and say so.
- The before directory is the SAME rig and the SAME bytes against `main`, so
  a difference between the directories is a difference the branch made.
- Round 1 re-captured the after directories after the remediation commit
  (`85584e1dbf`) because the affected rows, labels and copy changed: the
  detail column now keeps its right edge, `/mcp` compound rows keep a 12ch
  name floor, the danger cue sits on the row NAME, `/logout` rows carry the
  census brands, and the `/mcp` verb label reads "Commands". The rig's `empty`
  probe reads the empty-state sentence directly, so the copy findings
  ("No servers to choose…", "No stored credential to remove.") are asserted
  values in `result.json`, not just pixels.

## The pairs, named

- `login-suggest-on-ope` — `/login ope` (a subsequence of `openai`): no list →
  the Providers list with OpenAI first and OpenRouter beside it (so one Enter
  fills, the second runs — `login-enter-fills-the-top-match`,
  `login-second-enter-runs`).
- `login-space-lists-every-provider` — `/login `: no list → every loginable
  provider, logged-in rows annotated in the detail column and still offered.
- `login-one-click-runs` — one CLICK on the OpenAI row dispatches
  `/login openai` (nothing on the base tree, there is no row).
- `logout-space-lists-stored-accounts` — `/logout `: no list → one row per
  provider holding stored credentials, the removal digest and the single
  account's identity (`remove oauth · damian@example.com`).
- `logout-enter-fills-never-runs` / `logout-click-completes-never-runs` — the
  destructive gate: the row fills the box and dispatches NOTHING.
- `logout-typed-full-then-enter-submits` — the deviation's escape hatch: with
  the full command typed, the popup holds the first Enter and the next one
  submits (base: one Enter, because no popup ever opened).
- `mcp-space-lists-the-verbs` — `/mcp `: no list → the document's six verbs,
  `remove`/`logout`/`reauth` in the danger ink.
- `mcp-logout-lists-signed-in-servers` — `/mcp logout `: the `signed_in` slot,
  detail `stored credential · connected` (what is removed, not the connection).
- `mcp-logout-enter-fills-never-runs` / `mcp-remove-click-completes-never-runs`
  — the MCP destructive gate, both gestures.
- `mcp-verb-click-opens-the-server-slot` / `mcp-verb-enter-opens-the-server-slot`
  — the round-1 handoff: choosing a verb leaves `/mcp login ` (the value's own
  trailing space) and the popup reopens in the server slot; the paired
  `mcp-verb-pick-then-enter-fills-a-server` shows the two-turn crank ending in
  a filled server name with nothing dispatched.
- `mcp-add-space-hints-instead-of-blame` / `logout-names-a-census-provider-with-nothing-stored`
  — the honest empty states ("No servers to choose. Enter runs the command.",
  "No stored credential to remove.") read from the region itself.
- `logout-alias-reaches-a-stored-provider` — `/logout gpt` reaches the OpenAI
  row through the same census aliases `/login` honours, and the row is named
  "OpenAI" while the id it writes stays `openai`.

## Narrow width (520×900)

`chat-slash-providers-520/` runs the same 19 cases at 520 px, where the popup
is the ordinary composer's ~423 px. It is the frame set for design D2 (`remove
postgres_…` keeps its name floor while the 35-character path ellipsises
first), U5 (the danger cue on the NAME survives as the detail column sheds),
and D1 (the right-aligned detail edge holds).
