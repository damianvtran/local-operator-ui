# Team Bridge — multi-organization evidence

Frames for the multi-organization slice (organization switcher, merged
conversation list, per-org counts).

## How they were taken

- Real Storybook dev server from this branch (`storybook dev`, the shipped
  `.storybook` config, theme provider and i18n catalogue).
- Driven in the operator's own browser (the `browser` tool) at 1024×576 CSS px,
  2× device pixels (source frames 2560×1440).
- Themes: `localOperatorDark` and `localOperatorLight`, through Storybook's
  `theme` arg (`?args=theme:<id>`).
- Fresh reload between themes, so no previous palette's variables survive.

## Frames

| file | story | state |
| --- | --- | --- |
| `single-organization-{dark,light}.png` | `team-bridge-page--single-organization` | the container's first paint for one active membership: its only org, not All |
| `multiple-organizations-{dark,light}.png` | `team-bridge-page--multiple-organizations` | two memberships, Minerva selected |
| `all-organizations-{dark,light}.png` | `team-bridge-page--all-organizations` | merged list; every row carries its org chip; create is disabled with its visible reason |
| `empty-all-organizations-{dark,light}.png` | `team-bridge-page--empty-all-organizations` | account-wide scope with nothing in it; create disabled and the reason is the pane copy |
| `org-menu-{dark,light}.png` | `team-bridge-organization-switcher--menu-open` | menu open: All organizations first, then name / role / unread |
| `org-menu-error-{dark,light}.png` | `team-bridge-organization-switcher--memberships-failed` | memberships read failed; the menu carries `Try again` |
| `empty-organization-{dark,light}.png` | `team-bridge-page--empty-organization` | Northwind selected, no conversations |
| `loading-{dark,light}.png` | `team-bridge-page--loading` | list loading, switcher already painted |
| `error-{dark,light}.png` | `team-bridge-page--error-state` | list error and retry |
| `loading-all-organizations-{dark,light}.png` | `team-bridge-page--loading-all-organizations` | merged list loading; the disabled-create reason stays visible |
| `organizations-unavailable-{dark,light}.png` | `team-bridge-page--organizations-unavailable` | merged list error and retry; the disabled-create reason stays visible |

The sidebar integration is captured from the **production** component, not the
stand-in board:

| file | story | state |
| --- | --- | --- |
| `nav-more-collapsed.png` | `shell-app-shell--nav-more-collapsed` | expanded rail, group closed: the More row carries the count |
| `nav-more-expanded.png` | `shell-app-shell--nav-more-expanded` | group open: the Team Bridge row carries the same count |
| `nav-more-strip.png` | `shell-app-shell--nav-more-strip-expanded` | 56px strip, group open |
| `nav-more-strip-collapsed.png` | `shell-app-shell--nav-more-strip-collapsed` | 56px strip, group closed: the More glyph alone carries the corner badge |

`team-bridge-overflow-row--*` is a design board for the row's own states, not
the sidebar's evidence; the shell stories above are the sidebar.

## Round-1 remediation

The account-scoped reads now carry `scope=account` through the desktop op
contract (they were refused as 422 before HTTP), so the default All view and
the account badge can load. The create action in All is `aria-disabled` with a
visible, `aria-describedby`-linked reason; the page keeps an `sr-only` `h1`; a
single-membership account adopts its only organization; and the memberships
failure menu offers `Try again`.

## What the frames do not prove

The page container reads the account aggregate (`scope=account`) and forwards
`tenant_id` on writes; the desktop route that accepts `scope=account` lives on
`damianvtran/local-operator`'s `feat/team-bridge-multi-org`. These are
presentational frames against that contract, not a live multi-org backend.
