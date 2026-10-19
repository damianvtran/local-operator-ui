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
| `single-organization-{dark,light}.png` | `team-bridge-page--single-organization` | one active membership; trigger names it |
| `multiple-organizations-{dark,light}.png` | `team-bridge-page--multiple-organizations` | two memberships, Minerva selected |
| `all-organizations-{dark,light}.png` | `team-bridge-page--all-organizations` | merged list; every row carries its org chip |
| `org-menu-{dark,light}.png` | `team-bridge-organization-switcher--menu-open` | menu open: All organizations first, then name / role / unread |
| `empty-organization-{dark,light}.png` | `team-bridge-page--empty-organization` | Northwind selected, no conversations |
| `loading-{dark,light}.png` | `team-bridge-page--loading` | list loading, switcher already painted |
| `error-{dark,light}.png` | `team-bridge-page--error-state` | list error and retry |

`team-bridge-overflow-row--*` is unchanged by this slice; its existing frames
remain the evidence for the collapsed/expanded sidebar row.

## What the frames do not prove

The page container reads the account aggregate (`scope=account`) and forwards
`tenant_id` on writes; the desktop route that accepts `scope=account` lives on
`damianvtran/local-operator`'s `feat/team-bridge-multi-org`. These are
presentational frames against that contract, not a live multi-org backend.
