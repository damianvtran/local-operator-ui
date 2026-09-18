# Chat link affordances BEFORE the fix — the ninth shape, and the strip it raised

Five states × twelve themes = **60 frames**: the same story, the same fixtures, the
same entries, the same 1024×720 and 420×900 viewports and the same twelve themes as
`../chat-canonical-links/`, photographed on the head that adds the ninth shape and
NOTHING of the fix — `9c58e7bb754a757555f79626a4d6dfe3002ad34c`, the
story-fixture-only commit. These are the operator's own report in the frames: in
them the sentence he quoted still underlines `/new`, and a hover on it answers
`No file at /new`.

| Directory | Story | Gesture | What the pair shows |
| --- | --- | --- | --- |
| `detected-targets/` | `--detected-targets` | none (resting) | The ninth shape as it was: two `/new` runs (prose and backticks) carry the anchor's green underline, beside the extensionless directory that keeps its link on both heads. |
| `detected-targets-narrow/` | `--detected-targets-narrow` | none (resting) | The same tokens in the 420px column, where the commands wrap with the paragraph. |
| `hover-directory/` | `--detected-targets` | `mouseMoved` | The pointer on the REAL directory in the same paragraph: its strip is identical on both heads, which is what the fix has to leave alone. |
| `hover-file/` | `--detected-targets` | `mouseMoved` | The pointer on the `.xlsx` path above it, same answer. |
| `hover-prose/` | `--detected-targets` | `mouseMoved` at a text run | The pointer on the turn's prose: nothing raised, on both heads. |

## What the pair measures

Every one of the 60 pairs differs, and in every one the difference is confined to
ONE box — the ninth shape's own tokens and nothing else, which is the claim that
makes the pair readable:

| state | theme | differing pixels | bounding box |
| --- | --- | --- | --- |
| `detected-targets` | `localOperatorDark` | 4,253 | `482x36+272+616` |
| `detected-targets` | `neon` (widest ink step) | 53,675 | `482x35+272+617` |
| `detected-targets-narrow` | `localOperatorDark` | 6,484 | `79x59+270+729` |
| `hover-directory` | `localOperatorDark` | 7,128 | `482x36+272+616` |
| `hover-file` | `synth` | 45,788 | `482x36+272+616` |
| `hover-prose` | `localOperatorDark` | 4,253 | `482x36+272+616` |

Measured with `magick compare -metric AE` on the decoded frames and, for the box,
a difference composite thresholded at 8% and trimmed: the whole frame is 737,280
pixels, so the widest case above still moves 7.3% of them and the ordinary case
0.6%. The per-theme spread is the link ink's contrast against its own ground, not
layout: `hover-prose`'s frames are byte-identical to `detected-targets`' in both
halves, because a pointer on prose raises nothing on either head.

## Why five states and not twenty-one

The AFTER half is the whole set, because the ninth shape sits in the story every
state renders. This half is the five the design round actually took at that head,
and the reason is measured rather than asserted: the artifact it handed over
carried twenty-one directories, and SIXTEEN of them are byte-identical — 12 of 12
themes each — to the committed AFTER frames (`magick compare -metric AE` = 0 for
every file, checked directory by directory). A "before" frame that is a copy of the
after frame photographs the fix, not the defect, so those sixteen are not landed
here. The five above are the states where the two halves are genuinely two.

**A second difference the pair had to be taken again for.** These five are also the
only frames in the set — either half — that carry the CURRENT ground palette:
`localOperatorDark`'s canvas is `#22201c` in `palettes/local-operator.ts`, lifted by
`fix(themes): lift every page ground to the legibility floors` (`9a26e2d6f`, an
ancestor of both this head and the before head), while the frames in
`../chat-canonical-links/` as they stood before this pass read `srgb(23,19,14)` —
the pre-lift ground. Re-taking the set (the AFTER half, 264 frames) is therefore
also the first capture of it on the palette the tree ships, and it is what makes
these five comparable to their partners at all.

## How it was taken

```sh
env -u CMUX_* -u LOP_* HOME=/tmp/des357/home \
    node_modules/.bin/storybook dev -p 6031 --no-open --quiet
node scripts/capture-evidence.mjs http://localhost:6031 \
    --only=chat-canonical-links --dirs=detected-targets,detected-targets-narrow,hover-directory,hover-prose,hover-file \
    --allow-backend
```

in a worktree checked out at `9c58e7bb7`, with the frames copied here unchanged
(`cp -Rc`, an APFS clone: ~0 bytes at creation). `--allow-backend` because this
machine has a backend answering on the app's configured port and the rig refuses to
sweep while one does; every story in this set renders fixtures and reaches it for
nothing.

**The one state that CANNOT exist here.** `hover-command-prose` is absent by
construction, and that absence is design round 1's D2 as an assertion: that entry
aims the rig's `hoverText` at a `/new` text run OUTSIDE an anchor, and on this head
every `/new` run in that paragraph IS an anchor, so the aim throws
(`no text run matching "/new" outside a link or a button`) instead of filing a
resting frame under a hover name. The after half carries the frame that entry
produces.

These are **supplementary** frames in `../manifest.json`'s sense: a sweep cannot
re-derive them, because a sweep captures the current tree and the current tree does
not contain this change's absence. `clearSweptFrames` therefore preserves them, and
the swept count excludes them.
