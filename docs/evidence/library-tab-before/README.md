# Library asset details — the BEFORE arm

This directory is the before half of PR #1259's evidence pair. It is a
**declared supplementary set** in `docs/evidence/manifest.json` (18 frames),
because it cannot be produced by the PR branch's sweep: the stories and capture
tuples that render it are uncommitted scratch on base `c9bbfe25f0`, saved here
as two patches.

| file | what it is |
| --- | --- |
| `harness/before-stories.patch` | the `PreviewInline*` stories added to the base `library.stories.tsx` (same ids as the after arm's states that existed) plus `PreviewMediaInertPage` and the one branch that serves a real SVG for the before picture |
| `harness/before-capture-entries.patch` | the matching `STORIES` tuples in the base `scripts/capture-evidence.mjs` |
| `preview-inline-*/` | the 440px docked preview at 640x900, `localOperatorDark` and `localOperatorLight` |
| `preview-media-inert-page/` | the page's 440px dock with the inert picture, 1280x900 |

The frames are NOT committed: they live under the ignored
`docs/evidence-frames/library-tab-before/` tree, in the same `<state>/<theme>`
shape as `../library-tab/`, and the capture command in
[`../library-tab/README.md`](../library-tab/README.md) writes there. The two
patches and this README are the tracked part of the set.

The full capture procedure, the panel measurements and the findings are in
[`../library-tab/README.md`](../library-tab/README.md). What this set is for, in
one line: the labelled/bordered `EditableField` and `TagsInputChips` surface and
the inert image viewer, so the design round has the shipped before state on the
same fixture and the same 440px column as the borderless rewrite.
