# The setup window this branch replaced

Twelve frames of the screen the installer redesign removed, one per theme,
captured from a clean checkout of `origin/main` at `847f750d7` (the base this
branch was cut from) with:

```
node scripts/capture-evidence.mjs --only=installer-installercontent
```

WHY A SEPARATE SURFACE RATHER THAN A `before` DIR INSIDE THE AFTER SET (review
R2-4): the two halves are different screens at different sizes. These are
1380x800 two-pane frames carrying a rotating feature carousel and its dot
pagination; the after set is 640x480 and one column. An evidence table that
listed one path as both halves of a pair therefore showed a reader a frame that
is not the state it was named for - and the sentence above it ("both at the
window's own size") was true of one half. The repo already keeps this shape for
`provider-setup-ux-before/`.

They are kept because the redesign's argument is largely about what was
removed: the carousel, the dots, the second column, and the 700x320 of window
nobody asked for.
