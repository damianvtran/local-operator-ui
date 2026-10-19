# Team Bridge — conversation surface frames

Captured from the REAL Storybook build of the branch (stylesheet, fonts, theme
provider and i18n catalogue all loaded), not from a bare test host.

- `populated-dm.png` — a human↔agent DM in the default dark palette: agent badge,
  own messages on the accent wash, short history anchored to the bottom, and the
  rail/content split carried by the two grounds (no rules).
- `populated-dm-light.png` — the same state in a light palette (`alucard`).
- `empty.png` — an account with no conversations, one statement and one action.
- `error.png` — the list read failed; the pane keeps its own empty state.
- `overflow-expanded.png` — the Team Bridge row inside the sidebar's More group,
  unread badge at the row's trailing edge.
- `overflow-collapsed.png` — the same count while the group is collapsed: ONE
  More row, badge and ellipsis on it, no extra Team Bridge row.

Viewport: 1024 × 576 CSS px (the Storybook window), 2× device pixels.

**Borderless chrome.** There is no rule between the rail and the thread, under
the thread header, or above the composer. The rail keeps the page canvas and
the thread carries `surface`; every palette puts `surface` off `canvas`, so the
split survives light, dark and glass without a line. The only borders left are
on controls (the composer field, the dialog's inputs), which is the one place a
boundary is information rather than decoration.

The badge is the `attentionQuiet` register: borderless, `ink-dim` numeral, no
accent wash. Measured contrast from the design round: 5.25:1 dark, 6.14:1
light — above the 3:1 floor for a meaningful UI mark.

Reproduce:

```sh
node_modules/.bin/storybook dev -p 6017 --no-open
# then open
#   /iframe.html?id=team-bridge-page--populated-direct-message&viewMode=story
#   /iframe.html?id=team-bridge-page--empty-account&viewMode=story
#   /iframe.html?id=team-bridge-page--error-state&viewMode=story
#   /iframe.html?id=team-bridge-overflow-row--expanded-group&viewMode=story
#   /iframe.html?id=team-bridge-overflow-row--collapsed-group&viewMode=story
```
