# Chat link affordances BEFORE the fix — the ninth shape, and the strip it raised

Five states × twelve themes = **60 frames**: the same story, the same fixtures, the
same entries, the same 1024×720 and 420×900 viewports and the same twelve themes as
`../chat-canonical-links/`, photographed on the head that adds the ninth shape and
NOTHING of the fix — `b4d12e7a854a757555f79626a4d6dfe3002ad34c`, rebased as
`b4d12e7a82157768d86114e3d67a3331eacb1834`, the
story-fixture-only commit. These are the operator's own report in the frames: in
them the sentence he quoted still underlines `/new`. The other half of that
report, the strip the hover raised reading `No file at /new`, is a gesture rather
than a resting state, and the state that would carry it is the one this head
cannot take (below).

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
0.6%. **The AE column is fuzz 0 over the WHOLE frame, so it carries a
sub-threshold rasterisation tail as well as the token's own register** — these are
two independent captures of the same content, and the box is where the change is,
not the only place the pixels move. Split at the boxes above, the darkest pair's
4,253 is 2,540 in the box and 1,713 outside it, where 163 pixels differ by more
than 4/255 and the peak is 14/255; the shape repeats on the other rows
(`detected-targets-narrow` 2,655 in / 3,829 out, 192 above 4/255, peak 17/255;
`hover-file`/`synth` 5,707 in / 40,081 out, 2,267 above 4/255, peak 14/255). The
one row whose tail crosses 19/255 is `neon`, whose ink step is the widest: 22
pixels peaking at 42/255, and they sit in rows 616 and 652 — one row past EACH
edge of the box, which is why the difference box printed here is `263x37+274+616`
against the token's own `482x35+272+617` — the ink at the
boundary the 8% threshold drew, rather than a second change. So "nothing else" is
what the 8% threshold measures, and a reader quoting the AE column should read it
as the token plus capture jitter of at most that order.

The per-theme spread is the link ink's contrast against its own ground, not
layout: `hover-prose`'s frames are byte-identical to `detected-targets`' in both
halves, because a pointer on prose raises nothing on either head.

## Why five states and not twenty-one

The AFTER half is the whole set, because the ninth shape sits in the story every
state renders. This half is the five the design round actually took at that head,
and the reason is measured rather than asserted: the artifact it handed over
carried twenty-one directories, and SIXTEEN of them are byte-identical — 12 of 12
themes each — to the AFTER frames as committed at `2b3ac8a2b` (rebased as
`2b3ac8a2b`), which this pass
then replaced (`magick compare -metric AE` = 0 for every file, checked directory
by directory). A "before" frame that is a copy of the after frame photographs the
fix, not the defect, so those sixteen are not landed here. The five above are the
states where the two halves are genuinely two.

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

in a worktree checked out at `b4d12e7a8`, rebased as `b4d12e7a8`, with the frames
copied here unchanged
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
produces, and the strip the defect raised — `No file at /new` — is therefore in
neither landed half: it is photographed in the design round's own instrument PNG
`hover-command-before-9c58e7bb7.png` (the prose token green and underlined with the
strip at `[532,638,688,670]`), which is not in the repository, and QA round 1's
anchor inventory in the PR thread names the same two `/new` anchors independently.

These are **supplementary** frames in `../manifest.json`'s sense: a sweep cannot
re-derive them, because a sweep captures the current tree and the current tree does
not contain this change's absence. `clearSweptFrames` therefore preserves them, and
the swept count excludes them.
