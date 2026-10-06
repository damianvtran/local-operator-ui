# The command palette's legend keys, on unmodified `origin/main`

The before half of the palette's re-shot frames (`command-palette-commandpalette/`),
and nothing else. Same stories, same fixtures, same viewports, same harness, run
in a worktree of this branch's base (`d70f2645599`) with the branch's `src/` and
`scripts/` changes absent:

```sh
node scripts/capture-evidence.mjs --only=command-palette-commandpalette-- http://127.0.0.1:6199
```

A sweep captures the CURRENT tree, so it cannot produce these frames — they are
`origin/main`'s palette under this branch's own story list. Declared as its own
set in `docs/evidence/manifest.json` so `clearSweptFrames` preserves them and the
sweep's own count stays honest.

**THE BASE IS `d70f2645`, AND THE SET WAS RE-SHOT THERE.** The frames this set
first shipped were shot at `96502d5c`, **4557 commits** behind (`git rev-list
--count 96502d5c..origin/main`), while this file and the manifest both called it
"this branch's base". It is neither this branch's base nor `origin/main`:
`git merge-base HEAD origin/main` is
`d70f264559948b549e62caa9d8c7bcfb79706f64`, which is also the PR's base. The
pair differed by an entire Actions row this change does not touch — `Connect a
model provider`, which landed in `7abef3b20b3` (PR #494), an ancestor of the
base — so a reader could not attribute the visible delta to the caps the pair
exists to show (design round 1, D1). The round-1 remediation re-shot all five
stories at the true base, in a detached worktree of it; the frames now carry the
same Actions group as the after half, and only the legend delta remains
(`@ Agents` here, `@ Agents and teams` there).

What the pair is for: every key in the palette's footer and on its active row
(`↑` `↓` `↵` `esc`, and the scope glyphs `>` `#` `@` `,`) was a filled
`bg-sunken` box 15.2 × 21.39px drawn by a third cap implementation local to
`command-palette.tsx`. On this branch every one of them is the app's single cap
(`keyboard-shortcut.tsx`, `CAP`): 20 × 20px minimum, no fill, no border. Both
halves ink the cap `ink-dim`, so what the pair shows is the BOX going, not the
ink changing — a round that once raised the cap to `ink-muted` was undone by a
measurement on the palette (see the set's prose,
`docs/evidence/command-palette/README.md`, which is where these measurements and
the story list live).
