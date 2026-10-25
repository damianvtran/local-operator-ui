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
