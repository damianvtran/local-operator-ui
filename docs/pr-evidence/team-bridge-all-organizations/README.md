# Team Bridge union view: rosters grouped by organization, before and after

Frames of the shipped page, captured from the Storybook stories in
`src/renderer/src/features/team-bridge/team-bridge-page.stories.tsx`
(`Team Bridge/Page`), served by `scripts/with-storybook.mjs` and driven through
the harness browser (the desktop app's browser host).

- **After** = this branch at `4dab6553c374` (the story-only commit that adds the
  four `*Audit*` stories on top of `cc4137f3bdd7`; the page code is the same).
- **Before** = `origin/main` at `0f4871daaaa9`, from a detached worktree.
- Themes: `localOperatorLight` / `localOperatorDark` through `?args=theme:<id>`,
  the preview's own `ThemeFrame` seam.
- Each PNG is the story canvas only: the browser host's 2560 × 1440 capture
  (1280 × 720 CSS px at 2× DPR) with the 40 CSS px Storybook toolbar cropped off,
  so 2560 × 1360 (1280 × 680 CSS px).
- `*-scrolled-*` frames have the rail scrolled to its end, by focusing the rail's
  last row (which scrolls it into view) and then moving focus back out to the
  manager, so no focus ring is in the frame.

## After (head)

| Frame (`after-…-{light,dark}.png`) | Story id | What it shows |
| --- | --- | --- |
| `all-organizations-top` | `team-bridge-page--all-organizations` | All organizations, two orgs: Channels, Groups and Direct messages flat, each row naming its organization. |
| `all-organizations-scrolled` | same | The same rail at its end: People and Chiefs of staff, each grouped under a "Minerva" and a "Northwind Collective" subheader; rows carry no org caption inside a group. |
| `single-organization-roster` | `team-bridge-page--single-organization-roster` | One organization: People and Chiefs of staff with NO organization subheaders. |
| `empty-roster-scrolled` | `team-bridge-page--all-organizations-empty-roster` | Northwind's roster answered empty: its subheader plus "No one else has joined this organization yet."; Minerva's rows untouched. |
| `roster-failed-scrolled` | `team-bridge-page--all-organizations-roster-failed` | Northwind's roster read failed: "People could not be loaded.", the reason and Try again under Northwind only, in People and in Chiefs of staff. |
| `audit-loading-all-organizations` | `team-bridge-page--all-organizations-audit-loading` | The chief-of-staff audit section after Chiefs of staff, "Loading audited messages" under each organization subheader. |
| `audit-loading-single-organization` | `team-bridge-page--single-organization-audit-loading` | The same section for one organization: one loading line, no subheader. |
| `audit-populated-all-organizations` | `team-bridge-page--all-organizations-audit-populated` | Audited conversations listed per organization (Minerva: "Ben Okafor, Aida" and #deployments; Northwind: #launch-room). |
| `audit-populated-single-organization` | `team-bridge-page--single-organization-audit-populated` | One organization's audited conversations, no subheader. |

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
