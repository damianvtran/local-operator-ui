# S6c-lite: the approvals dock at 264px

App code: `eac97c9b7f0bbe2b39e8d278846a8e448b757ae9` (rebased onto main
`8eb5a0a9ad`; the built `out/` is from this code). This is the proof head; the
final evidence commit is docs-only.
Run mode: headless, 264×900 content, the real `/browser` route. The native
approvals card is not involved; the rig removes the S6A opt-in from the launch
env so the product dock is the path under test. The grants/revoke surface is
the shipped one, unchanged. The dock's floored left edge is kept at full width
(the contrast contract treats it as a structural boundary).

Command:

```sh
node scripts/browser-approvals-narrow-panel-proof.mjs --out docs/pr-evidence/browser-approvals-narrow-panel
```

## The four acceptance points, dark and light

Rects are viewport CSS pixels at a 264px content width; `scrollIntoView` is
applied before each control probe, and the hit is `document.elementFromPoint`
at the control's centre.

| Acceptance | Dark | Light |
| --- | --- | --- |
| Full-width in flow | panel 264×721 at x=0; content 0×721; row 264; `position: static`; `data-dock-layout="full"` | panel 264×695.6; content 0×695.6; row 264; static |
| Allow / Deny reachable, unclipped | Allow `x46 y525.27 78.75×28`; Deny `x154.47 y525.27 80.53×28`; both inside the panel, hitSelf, enabled | Allow `x46 y538.16 78.75×28`; Deny `x154.47 y538.16 80.53×28`; same |
| Standing-grant Revoke / Revoke-all | Revoke `x176.31 y525.53 59.69×28`; Revoke-all `x13 y543.63 231×28`; both inside, hitSelf, enabled | Revoke `x176.31 y538.23 59.69×28`; Revoke-all `x13 y543.33 231×28`; same |
| Request reason wraps | 106 chars, client 189px, scroll 189px, 7 line rects, widest 172.8px; `overflow-wrap: anywhere` | 106 chars, client 189px, scroll 189px, 7 line rects, widest 172.8px |

Panel height and displacement (same measurement): dark client 721px / scroll
1891px; light client 696px / scroll 1934px; content width 264 → 0 when the dock
opens; row stays 264. The empty panel is 264×794 with content 0×794 and scroll
height 938. All twelve interactive controls in the populated panel pass the
inside-both-axes and centre-hit checks in both themes; there is no footer over
the scroll area.

## The waiting row no longer overflows

The row wraps and its expiry anchors at the inline end; the proof reads the
panel and every waiting row's own scroll/client widths.

| Width | Panel | Panel client/scroll | Waiting row client/scroll | Row height | Expiry right |
| --- | --- | --- | --- | --- | --- |
| 264 (full) | 264 | 255 / 255 | 229 / 229 | 72.2 | 235 (inside 255) |
| 521 (side) | 281 | 272 / 272 | 246 / 246 | 50.8 | 752 (inside panel right 781) |
| 640 (side) | 320 | 311 / 311 | 285 / 285 | 50.8 | 871 (inside 900) |
| 1020 (side) | 384 | 375 / 375 | 349 / 349 | 50.8 | 1251 (inside 1280) |

The side widths are driven at the surface row itself (the renderer viewport is
adjusted until the browser-content row measures the requested width); the
responsive 384px form at 1020 is the viewport's `w-96` branch, not a change to
the row. No panel or row has `scrollWidth > clientWidth` at any of the four.

## Context states and the F1 route

The loading and error panel states are **BLOCKED**, not passed: the dock's only
loading cue is the decision spinner and the host answers inside the same paint
(the captured frame is the post-decision panel); the dock has no error surface,
and the error row is the host's open refusal (`ERR_CONNECTION_REFUSED`), not
`chrome.error` or a page `navFailure`; the browser's page-failure line would be
in the content that is displaced to zero at 264.

The cold-start route row entered `#/browser` and set 264 **before** waiting for
the host bridge. The availability screen itself was not observed in this run;
the row-absent → row-present transition is covered deterministically by
`scripts/browser-approvals-dock-width.test.mjs`, which mounts the real hook
with no row, then mounts the row, and asserts the full-width state arrives on
that attach.

## Frames

- `populated-{dark,light}.png` — panel top, request reason wrapping, and the
  wrapped waiting row.
- `populated-{dark,light}-decisions.png` — Allow once / until-quit / always-site
  / all-of-domain and Deny.
- `populated-{dark,light}-grants.png` — Approved list, Revoke and Revoke all.
- `side-{521,640,1020}-dark.png` — the same populated queue at the side widths.
- `empty-{dark,light}.png` — no waiting or approved sites.
- `host-error-dark.png` — the panel after the host refused a navigation.
- `post-decision-dark.png` — the panel after a decision; not a loading claim.

The side layout is not re-claimed as a product change: its classes are unchanged
above 520 (the helper test pins 521/640/1280 as side), and this slice is the
264px closure of D11/U17.
