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
| `chat-slash-providers/` | `feat/provider-suggestions-0930` (captured from the branch's `src/`+`scripts/` trees; the branch's later commits fold `origin/main` `95d55c3e9f` and re-stamp the evidence manifest — no frame is re-taken) | 13/13 gestures as the rule requires |
| `chat-slash-providers-baseline/` | `origin/main` `dad1778e14` | 1/13; every list absent, every click "nothing to click" |

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
