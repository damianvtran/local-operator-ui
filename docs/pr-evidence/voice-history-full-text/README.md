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
