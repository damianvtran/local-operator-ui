# Notifications page: PR evidence frames

These frames come from Storybook stories (`Notifications/Page`, in
`src/renderer/src/features/notifications/components/notifications.stories.tsx`).
A local `storybook dev` was opened through the manager URL in the harness
`browser` tool (one reused tab), stepped by hand one story per navigation, and
cropped to the preview. The stories answer `window.api.desktop.request`
through a scripted bridge, so the shipped hooks, query keys and request schema
are what render. The palettes are `localOperatorDark` and `localOperatorLight`.

| Frame | State (design.md) |
|---|---|
| `populated-{dark,light}` | § 5 populated: Waiting on you pinned, time groups, ×6 repeat, Seen live / Seen in conversation |
| `by-conversation-dark` | § 3 grouping by conversation, with "Dismiss all n" on each header |
| `detail-dark` | § 2 detail: markdown body (a table), history, related project, From card, and the read that opening applies |
| `ask-detail-dark` | an open ask's detail, answerable through the existing `AskPanel` |
| `multiselect-dark` | § 6 four selected, one of them a live ask: "Dismiss 3" plus "1 ask stays until it's answered" |
| `empty-dark` | § 5 "All caught up" on the Unread filter; Mark all read is disabled |
| `loading-dark` / `load-error-dark` | § 5 first read in flight / first read failed |
| `refresh-failed-dark` | § 5 refresh failed with the list kept: stale notice, writes paused |
| `high-volume-dark` | 60 rows over 6 conversations |
| `drawer-updates-{dark,light}`, `drawer-empty-dark` | § 18 / D9: the asks drawer's Updates tab |
| `flag-lines-{dark,light}` | § 17.2: the in-transcript "Flagged for you" line, Unread and Seen |
| `sidebar-before-dark` / `sidebar-after-{dark,light}` | § 1 / D10: no capability vs `features.notifications` (row under Aida, Schedules folded into More) |
| `sidebar-rail-before-after-dark` | the rail alone, before and after, side by side |
| `badge-{dark,light}` | D5: the quiet pill (left) vs the `emphasis` pill (right) on the four rail grounds |

The badge numbers are measured over the 59 shipped palettes with the WCAG
relative-luminance formula, and asserted in `scripts/contrast-contract.mjs` as
"rail notifications badge (emphasis)":

| Pair | Worst over 59 palettes | localOperatorDark | localOperatorLight |
|---|---|---|---|
| `accent` fill vs ground (≥ 3:1) | 4.24 (tokyoNight, `rowSelected`) | 6.10–7.54 | 4.53–5.14 |
| `onAccent` digit vs `accent` fill (≥ 4.5:1) | 4.97 (tokyoNightDay) | 8.58 | 5.33 |

## Round 1 remediation captures (2026-10-25)

These are the states the review round asked to see again, from the *same* build
that carries the fixes. Everything about the harness is unchanged: Storybook
served the stories, one reused browser tab stepped through them, the frames were
cropped to the preview, and nothing was retouched.

| Frame | What it answers |
|---|---|
| `round1-populated-dark.webp` | the page still renders the pinned "Waiting on you" group and time groups after the toolbar layout change |
| `round1-narrow-980-en-dark.webp` / `-fr-dark` | **U1/Q6**: the same 980x380 box in both languages. The toolbar wraps to a natural height (`min-h-11`, `py-2`) instead of clipping, and "Tout marquer comme lu" is fully visible and hit-testable — the English frame is the same-size control, not a second viewport |
| `round1-drawer-404-ru-dark.webp` | **D1**: the REAL `AskDrawer` + rail at 404 px (360 px drawer). Russian "Обновления / Непрочитанных: 1" wraps inside its tab; the scope selector owns its own full-width row, so no label is squeezed or hidden |
| `round1-drawer-404-ur-rtl-dark.webp` | **D2**: the same drawer in Urdu through the real `LocaleDirectionProvider`/`useDocumentDirection`; `html` computes `direction: rtl` and the panel, rail and rows mirror |

Measured, not eyeballed: `[data-notifications-mark-all]` is `visible, in view`
at 980x380 in French (rect 845.44,109.29 110.56x28), and the Urdu document root
reports `direction: rtl`. The blue boxes behind some Urdu labels in that frame
are the inspection overlay the harness draws over an element I had just
measured — the button's own computed `background-color` is `rgba(0, 0, 0, 0)`.

The drawer's width is pinned by the story (`w-[404px]`: 360 px drawer + the
44 px rail), because a proof of "long labels fit" is worthless if the host
happened to be wide.

## Round 2: the drawer direction fix and the story pins (2026-10-25)

Three fixture defects from the design round are fixed in the stories, and the
frames below are re-captures from that build. The only product-code change here
is extracting the partial-result line into `operation-progress-line.tsx` so D4's
seeded stories render the page's own component and catalogue key; its markup is
identical to what the page drew inline. The round-1 Urdu drawer and the two
round-1 narrow frames are deleted rather than kept as history: they are the
frames D2 and D3 identify as misleading, and an archive of a known-wrong picture
is how a reviewer re-reviews the wrong thing.

| Frame | What it answers |
|---|---|
| `round2-drawer-404-ur-rtl-dark.webp` | **D2 corrected**: the Drawer story mounts `useDocumentDirection` + `LocaleDirectionProvider` and no longer sets `dir="auto"`, so direction comes from the locale store the way the product resolves it. Measured on this frame: `html` is `direction: rtl` and the tab element inside the drawer is `direction: rtl`; the rail sits at the leading right edge, rows and their priority glyphs mirror, the scope row is start-aligned. This supersedes the round-1 Urdu drawer frame |
| `round2-narrow-980-en-dark.webp` / `-fr-dark` | **D3 answered**: `parameters.locale` is not a channel this Storybook reads (the preview pins through `context.args.locale`), so the "French" story rendered in the host language. Each narrow story now declares its own `locale` arg, so opening it by id alone is a real frame in that language. The box is measured, not assumed: `[data-narrow-capture]` is `rect 0,0 980x380` with `overflow: hidden` — the content is laid out at the window size under review; the surrounding canvas is Storybook's own frame |
| `round2-operation-status-partial-dark.webp` / `-not-confirmed-dark` | **D4 answered**: the partial-result line is now a component with seeded stories, so the state that only appears after a racing write or a dropped response can be signed off without summoning one. Seeded counts 118/2/3 and 40/0/60; the component and catalogue key are the page's own |

Measured with the story opened by its own id, no query arguments:
`[data-notifications-mark-all]` in the ENGLISH frame is
`rect 845.44,109.29 110.56x28` ("Mark all read"); in the FRENCH frame it is
`rect 24,147.29 172.59x28` ("Tout marquer comme lu"), two natural lanes inside
the same 980x380 box. Both are visible and inside the pinned panel.

**Correction to the previous section:** the rect quoted there as French
(845.29 region) was the ENGLISH control — the narrow story had not set the
locale, so both frames rendered English. The French figure above is measured
from the corrected frame.
