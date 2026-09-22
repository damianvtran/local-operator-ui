# Agent-opened sidebar row — before/after frames

Frames for the PR that marks a session an agent opened in the sidebar
(`· opened by coder`), taken for the pull request rather than committed into the
swept evidence set: the change is a reading of two rows side by side, and its
story drives the app's own bridge rather than the capture rig.

They live on this branch so the PR body can inline them; they are **not** in the
PR's diff and not on `main`. The mechanism is the one `qa-evidence/pr-90` uses.

| file | tree | state |
| --- | --- | --- |
| `before-named.png` / `after-named.png` | `origin/main` / the PR branch | `opened_by` present, with the requesting agent and conversation named |
| `before-unnamed.png` / `after-unnamed.png` | `origin/main` / the PR branch | `opened_by` present, all three members null |
| `before-absent.png` / `after-absent.png` | `origin/main` / the PR branch | `opened_by` absent (today's list) |

## How they were taken

```sh
# on the PR branch, and again in a worktree of origin/main holding the same new
# story file (node_modules shared by APFS clone of an installed tree at the same
# lockfile)
pnpm storybook --ci --port 6006
```

Then, in the operator's own browser — a background tab, never focus, and no
scripted browser engine — the manager URL that carries Storybook's channel token:

```
http://localhost:6006/?path=/story/chat-sidebar-agent-opened-rows--agent-opened-named&viewMode=story&nav=false&panel=false
…--agent-opened-unnamed, …--not-agent-opened
```

Screenshots at 2560×1440 (1280×720 CSS at devicePixelRatio 2).

The readout in each frame is the caption in this repository's usual idiom: every
conversation row's trailing statement and its `title` attribute, read out of the
DOM — a `title` is the one channel a still cannot paint.

## What the pair shows

`before-absent.png` and `after-absent.png` are **byte-identical**
(`sha256 13f5180e0288…`), which is the inertness claim stated as a measurement:
reading the optional field changes nothing when it is not there. `before-named.png`
and `after-named.png` are the same roster one tree apart, where the base tree's row
ends `· coder` — indistinguishable from the chat the operator opened himself — and
the branch's ends `· opened by coder`.
