# Voice band and History inside the composer card

Real renders of the shipped `MessageInput` (working-directory shelf, editor card, voice band) from the
`Voice/Composer band` Storybook stories added in this change. `before-*` is `origin/main` (`cd9d85f30d`)
with the same story file; `after-*` is this change. Same seeded reply in both: a markdown table, bullets,
a "(code block omitted)" line and a long closing sentence; the spoken `text` is the shorter, flattened,
cut version and `full_text` is the whole reply, one table row or bullet per line.

| File suffix | Story | Width |
|---|---|---|
| `open` | `voice-composer-band--history-open` | 900 px column |
| `closed` | `voice-composer-band--closed` | 900 px column |
| `narrow-open` | `voice-composer-band--narrow-history-open` | 393 px column (compact dock) |
| `narrow-closed` | `voice-composer-band--narrow-closed` | 393 px column (compact dock) |
| `cut-open` | `voice-composer-band--cut-history-open` | 900 px column, one truncated reply |

Theme is `?args=theme:localOperatorLight` / `localOperatorDark`.

Reproduce:

```sh
node scripts/with-storybook.mjs -- <command>   # then open $STORYBOOK_ORIGIN/iframe.html?id=<story>&viewMode=story&args=theme:localOperatorLight
```

The stories' `play` functions measure the geometry the operator reported (band inside the editor, below
the shelf; open History bounded and scrolling). With `voice-composer.tsx` reverted to `origin/main` the
`HistoryOpen` play fails with `AssertionError: expected 66 to be greater than or equal to 74` (the band
8 px outside the editor box on the left); with this change it passes.

## Round 1 additions

| File | Story | What it shows |
|---|---|---|
| `before-light-narrow-cut-open.png` | `voice-composer-band--narrow-cut-history-open` | Pre-fix chip (`shrink-0`): the History toggle sits at x 410–436, outside the 57–384 band, clipped. |
| `after-light-narrow-cut-open.png`, `after-dark-narrow-cut-open.png` | same | The cut chip truncates ("Cut short · …", full sentence in its `title`); Pause, Silence and the History toggle (349–375) are inside the band. |
| `after-light-server-shape-open.png` | `voice-composer-band--server-shape-history-open` | `full_text` in the shape the server's `display_text` emits (local-operator#4491): `Name · Qty · Note` rows, `- ` bullets, `(code block omitted)`, blank-line paragraphs. |

The `NarrowCutHistoryOpen` play now checks every control's right edge against the band's. With the chip's
`shrink-0` restored it fails with `expected 436.53125 to be less than or equal to 384`; with this change it
passes (toggle right edge 375). `SERVER_FULL` in the stories file is the real `display_text` output for a
markdown reply, produced by running `speakable.py` from the server PR head `44fe027c5a`.
