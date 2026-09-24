# The hosting picker's empty-state sentence, before and after

The rendered proof for the copy change in PR #441's remediation round 1
(design D1/U1/U2).

## What it shows

The same surface — `HostingSelect`, the provider picker in **Settings → Model
settings** — in its **empty-credentials** state, with the component's own default
`emptyHelperText` and no credentials configured.

| Half | Sentence rendered |
| --- | --- |
| `before/` | "No hosting providers available. Sign in to a provider, or add a key by telling the agent, for example: `/credential <your key>`." |
| `after/` | "No hosting providers available. Sign in to a provider, or add a provider's API key in Settings, under Providers." |

The `before` half is the string the branch shipped at `395e6d066` (its reviewed
head); the `after` half is this round's. Two independent review rounds proved the
old sentence teaches a gesture that does not do what a reader expects — the
composer's `/credential` writes a **session** secret (`LOP_SECRET_*`), which the
provider census does not read, so the picker is byte-identical afterwards — and
that the working in-app door (Providers, whose rows read "Sign in or API key") was
omitted. The new sentence names that door and nothing else.

## What produced these frames

The **shipped** `HostingSelect`, mounted against a real desktop bridge
(`window.api.desktop`) with the Settings page's own props and NO `emptyHelperText`
override, so both halves render the component's own default rather than a string
restated in the harness. The census is seeded (under the app's own query keys) with
every provider present and none configured — the state that empties the list and
shows the sentence — and `local`/`credential_optional` rows are cleared, because a
local server is selectable without a key and would keep the list non-empty.

Each half is a private headless Chrome driven over raw CDP (`--use-mock-keychain`,
a scratch `--user-data-dir`, exact-pid teardown), with `Page.captureScreenshot` at
`format: webp, quality: 88` — the same encoder settings `scripts/capture-evidence.mjs`
uses. The `before` half mounts the component **from a worktree of `395e6d066`**, so
the sentence in that frame is that tree's own default and not a copy of it.

Not a committed harness: the two halves were taken by a scratch rig and only the
frames are committed, as `AGENTS.md` requires. The harness and its config are
reproduced here for the next reader:

```sh
# after half — this branch's tree
vite --config <scratch>/harness/vite.config.mjs   # root: <scratch>, aliases -> ~/local-operator-ui-cred/src/renderer/src
# before half — a worktree of 395e6d066, same harness files, aliases -> that worktree
vite --config <scratch>/harness-before/vite.config.mjs
# then, for each half, one command that launches Chrome, shoots both themes and reaps:
node <scratch>/shoot.mjs --url http://127.0.0.1:<port>/empty-state.html --out <dir> \
  --themes localOperatorDark,localOperatorLight --width 700 --height 280
```

## What these frames do not prove

- Anything about the **Providers section itself** — only the picker's own sentence
  and the door it names. The destination's rendering is the Providers set's
  business (`docs/evidence/settings-backend/`, `onboarding-providersetup/`).
- The **Settings page's** own copy and the model-settings **alert** (both repointed
  in the same commit) — the same change, and neither needs a second frame: the
  alert and the picker's Settings call-site string are the same sentence, and the
  frames above are the picker's.
- The chat **`Invalid API key`** error block, which this round repoints off the
  `/credential` gesture to the Providers section. It renders inside a transcript
  error card; its string is asserted in the round's own review, not photographed.
