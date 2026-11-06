# Team Bridge union view: rosters grouped by organization, before and after

Frames of the shipped page, captured from the Storybook stories in
`src/renderer/src/features/team-bridge/team-bridge-page.stories.tsx`
(`Team Bridge/Page`), served by `scripts/with-storybook.mjs` and driven through
the harness browser (the desktop app's browser host).

- **After** = this branch at `60ac10d01ab` (remediation round 1: the code fixes and
  the story fixtures they need).
- **Before** = `origin/main` at `0f4871daaaa9`, from a detached worktree.
- Themes: `localOperatorLight` / `localOperatorDark` through `?args=theme:<id>`,
  the preview's own `ThemeFrame` seam.
- Each PNG is the story CANVAS: the canvas iframe at 1280 x 720 CSS px, captured
  2560 x 1440 at 2x DPR. There is no Storybook chrome in the frame and nothing to
  crop, so the whole 2560 x 1440 is the page.

## After (head)

Captured at head `60ac10d01ab` (remediation round 1), canvas only - the story
iframe at 1280 x 720 CSS (2560 x 1440 at 2x DPR), no Storybook chrome to crop.

THE FRAMES ARE WHOLE-RAIL, NOT SCROLLED. The harness browser's scroll action moves
the document, and this page is `overflow: hidden` with the rail as its own scroll
container, so a group below the fold could not be captured at all. The evidence
stories for the group sections therefore carry an empty conversation list and a
shorter roster (`compactConversations`, `compactRoster`, and `directories: []` for
the audit frames), so the sections under review are on screen at 720px with
nothing hidden. The frames are named for the state instead of `-scrolled`.

| Frame (`after-…-{light,dark}.png`) | Story id | What it shows |
| --- | --- | --- |
| `all-organizations-top` | `team-bridge-page--all-organizations` | The general story (full conversation list): All organizations with two orgs, flat rows each naming their organization, and both People groups with their subheaders. |
| `roster-failed` | `team-bridge-page--all-organizations-roster-failed` | D1: Northwind's roster failed. People keeps the line, the reason and ONE Try again; Chiefs draws ONE quiet line with no reason and no button. D2's 8px above a non-first group is visible above both Northwind headers. |
| `empty-roster` | `team-bridge-page--all-organizations-empty-roster` | Northwind's roster answered empty: its subheader plus "No one else has joined this organization yet."; Minerva's rows untouched. |
| `long-org-name` | `team-bridge-page--all-organizations-long-org-name` | D3: a long organization name truncates in both the subheader and the flat row's 11px caption, with `title` recovering the full name on hover. |
| `audit-loading-all-organizations` | `team-bridge-page--all-organizations-audit-loading` | The chief-of-staff audit section after Chiefs of staff, loading under each organization. |
| `audit-populated-all-organizations` | `team-bridge-page--all-organizations-audit-populated` | Audited conversations per organization. The audit's org header is now the shared `RailGroupHeader` (design D5), so it carries the same 12px, `title` and first/non-first spacing as People and Chiefs; the second organization's group sits below the 720px fold, and the group spacing itself is shown by the `roster-failed` and `empty-roster` frames. |
| `audit-loading-single-organization` | `team-bridge-page--single-organization-audit-loading` | The same section for one organization: one loading line, no subheader (predicate unchanged). |
| `audit-populated-single-organization` | `team-bridge-page--single-organization-audit-populated` | One organization's audited conversations, no subheader. |
| `single-organization-roster` | `team-bridge-page--single-organization-roster` | Unchanged by this round: no organization headers, no captions. |

## Before (origin/main)

| Frame (`before-…-{light,dark}.png`) | Story id | What it shows |
| --- | --- | --- |
| `all-organizations-top` | `team-bridge-page--all-organizations` | All organizations on main: People reads "Choose an organization to see its people." and there is no Chiefs of staff section. The whole rail fits (no scroll), so there is no separate scrolled before-frame. |
| `single-organization` | `team-bridge-page--single-organization` | Main's single-organization first paint (story unchanged by this PR). |
| `single-organization-roster` | `team-bridge-page--people` | Main's single-organization roster. `SingleOrganizationRoster` does not exist on main; its doc comment says it must look exactly like `People`, so `People` is the matching before-frame. |

## Rail geometry (light, measured on the story canvas)

The rail is a Radix `ScrollArea`; the numbers are the viewport (`clientHeight`)
against its content (`scrollHeight`), CSS px, at 1280 × 720.

| Story | Rev | Viewport | Content | Scrolls |
| --- | --- | --- | --- | --- |
| `all-organizations` | main | 608 | 350.47 | no |
| `all-organizations` | head | 608 | 798.55 | yes, 190.55 px |
| `all-organizations-audit-loading` | head | 608 | 982.14 | yes |
| `all-organizations-audit-populated` | head | 608 | 1028.75 | yes |
| `single-organization-roster` | head | 608 | 501.38 | no |
| `single-organization-audit-populated` | head | 608 | 653.58 | yes, 45.58 px |

The viewport is 288 px wide at y=112 in every case. The scrolled frames show a
scroll thumb at the rail's right edge, taken just after the scroll. On a freshly
loaded canvas the `[data-radix-scroll-area-scrollbar]` query matched nothing. Why
it is absent there (not mounted until scroll, or another selector) was not
determined.

## What these are not

- The audit stories pass a STATIC `OwnerAuditSlot` built from the exported
  `OwnerAuditSectionHeader` and `OwnerAuditRailView` (mirroring
  `useOwnerAuditSurface`'s structure, with `RailGroupHeader` as the subheader).
  No query cache, transport or hub is involved, so they show placement and the
  loading/populated treatments, not that the audit routes answer or that the
  selection opens a panel.
- The rosters are fixture props; no directory read runs.
