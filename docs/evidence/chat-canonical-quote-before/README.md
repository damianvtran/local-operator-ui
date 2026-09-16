# The quote strip before the change — hover, at the block's edge

Sixteen frames, eight surfaces, the two brand themes: the SAME entries and the
same story set as `../chat-canonical-quote/`, photographed against the three
files `origin/main` ships under
`src/renderer/src/features/chat/canonical/` (`canonical-transcript.tsx`,
`quote-toolkit.tsx`, `quote-model.ts`).

```
sent-turn-quote/             the transcript at rest
hover-no-highlight/          the pointer ON the turn, nothing highlighted — the strip is up
highlight-mid-turn/          a sentence highlighted — the strip is at the far right edge
highlight-across-turns/      one highlight across two turns — a strip on the turn it began in
highlight-dismissed/         the highlight, then a click into the composer
keyboard-highlight-focused/  a keyboard-made highlight
scrolled-to-oldest-turn/     the tall fixture at rest
selection-at-pane-top/       a highlight on the pane's top edge
```

## Why this set exists

The change is about WHAT RAISES the control and WHERE it floats, and neither half
photographs on its own: a frame of the fixed control says nothing about the strip
that used to be up whenever the pointer was over a turn. These are the operator's
report, reproduced:

| comparison | measurement |
| --- | --- |
| `hover-no-highlight` before vs `sent-turn-quote` before | **5,872 pixels differ** in the dark theme, **2,302** in the light one - the strip, raised by the pointer alone on a turn with nothing highlighted |
| `hover-no-highlight` after vs `sent-turn-quote` after | **0 differing pixels, both themes** - hovering raises nothing now, and the frame is byte-identical to the resting transcript |
| `highlight-mid-turn` before vs after | **15,222** dark / **10,312** light pixels differ - before, the strip is at the far right edge of the whole block while a sentence in the middle of it is highlighted; after, the control is over the highlight's own first line |
| `highlight-across-turns` before vs after | **13,107** dark / **20,232** light - one highlight across two turns raises ONE control after, at the turn it begins in, where before there was a strip on the turn the pointer was over |
| `selection-at-pane-top` before vs after | **13,466** dark / **14,115** light - the same difference where the highlight sits on the pane's top edge, and after the control has flipped below it |
| `sent-turn-quote`, `scrolled-to-oldest-turn` before vs after | **0 differing pixels, both themes** - the two resting surfaces did not move, which is what a control that is absent until a highlight exists has to preserve |
| `highlight-dismissed` before vs after | **0 differing pixels in the dark theme**, both halves byte-identical to their own resting frames; the light-theme after frame is a one-pixel layout residue of the drag (see `../chat-canonical-quote/README.md`), and no control is in either frame |

## How it was taken

1. The change was committed first, so the rig, the story file and the harness are
   the tree under review; only the three files under repair differ between the two
   runs. Both halves were RE-TAKEN on the merged tree after the fold onto
   `2d80b51f9` - `main`'s `#238` had moved the composer beneath these frames, and a
   pair whose two halves are shot on different trees measures the merge as well as
   the change.
2. In that checkout the three files were replaced with
   `git checkout origin/main -- <the three paths>` — a working-tree edit that was
   never committed, and that was restored before the after frames were taken.
   `origin/main` still carries the hover reveal.
3. Storybook from this worktree, on a port no other tree held, then one narrowed
   run:

   ```sh
   pnpm storybook --port 6403 --ci --no-open
   node scripts/capture-evidence.mjs http://127.0.0.1:6403 \
     --only=chat-canonical-quote --themes=localOperatorDark,localOperatorLight --allow-backend
   ```

   `--allow-backend` because this machine has a backend listening on the app's
   configured port and the rig refuses to sweep while one does; the frames come
   from fixtures and reach it for nothing.
4. The frames the rig wrote into `../chat-canonical-quote/` were moved here, and
   the after frames were re-captured into that set from the fixed tree in the
   full twelve-theme sweep.

**One entry is deliberately absent on this side: `highlight-then-press`.**
Its claim is that the press stages the highlight and leaves nothing behind, and
the harness refuses to photograph a state it is not in: on the before tree the
strip is still painted after the press, because the pointer that pressed it is
still over the row it belongs to. That is this change's third ask stated as a
measurement — the check that rejects it is the same one the after frames pass.

**Two brand themes, not twelve.** The claims here are about what raises the
control and where it sits, which no palette changes; the twelve-theme sweep
belongs to the surface a design round judges for contrast and spacing, and that
is `../chat-canonical-quote/`. Every before frame is the same theme as the after
frame it is compared against, so each comparison is like for like.

These are **supplementary** frames in `../manifest.json`'s sense: a sweep cannot
re-derive them, because a sweep captures the current tree and the current tree
has no hover-revealed control. `clearSweptFrames` therefore preserves them, and
the swept count excludes them.
