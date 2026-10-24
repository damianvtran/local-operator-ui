# S6c-lite: the approvals dock at 264px

App head: `43dbfdaec21101b85746376e9a3cf1113aab2265` (the built `out/` is from this tree).
Run mode: headless, 264×900 content, the real `/browser` route. The native
approvals card is not involved; the rig removes the S6A opt-in from the launch
env so the product dock is the path under test. The grants/revoke surface is
the shipped one, unchanged.

Command:

```sh
node scripts/browser-approvals-narrow-panel-proof.mjs --out docs/pr-evidence/browser-approvals-narrow-panel
```

The four acceptance points, measured in dark and light. Rects are viewport CSS
pixels at a 264px content width; `scrollIntoView` is applied before each
control probe, and the hit is `document.elementFromPoint` at the control's
centre.

| Acceptance | Dark | Light |
| --- | --- | --- |
| Full-width in flow | panel 264×721 at x=0; content 0×721; row 264; `position: static`; `data-dock-layout="full"` | panel 264×695.6; content 0×695.6; row 264; static |
| Allow / Deny reachable, unclipped | Allow `x45 y521.47 78.75×28`; Deny `x154.47 y521.47 80.53×28`; both inside the panel, hitSelf, enabled | Allow `x45 y534.37 78.75×28`; Deny `x154.47 y534.37 80.53×28`; same |
| Standing-grant Revoke / Revoke-all | Revoke `x176.31 y521.73 59.69×28`; Revoke-all `x12 y535.84 232×28`; both inside, hitSelf, enabled | Revoke `x176.31 y534.43 59.69×28`; Revoke-all `x12 y535.53 232×28`; same |
| Request reason wraps | 106 chars, client 190px, scroll 190px, 7 line rects, widest 172.8px; `overflow-wrap: anywhere` | 106 chars, client 190px, scroll 190px, 7 line rects, widest 172.8px |

Panel height and displacement (same measurement): light client 688px / scroll
1891px; dark client 713px / scroll 1848px; content width 264 → 0 when the dock
opens; row stays 264. The empty panel is 264×794 with content 0×794 and scroll
height 938. All twelve interactive controls in the populated panel pass the
inside-both-axes and centre-hit checks in both themes; there is no footer over
the scroll area.

The loading and error states are **BLOCKED**, not passed: the dock's only
loading cue is the decision spinner and the host answers inside the same paint
(the captured frame is the post-decision panel); the dock has no error surface,
and the browser's error line lives in the page content, which is displaced to
zero at this width. Neither is claimed as a rendered product state.

## Frames

- `populated-{dark,light}.png` — panel top, request reason wrapping.
- `populated-{dark,light}-decisions.png` — Allow once / until-quit / always-site
  / all-of-domain and Deny.
- `populated-{dark,light}-grants.png` — Approved list, Revoke and Revoke all.
- `empty-{dark,light}.png` — no waiting or approved sites.
- `host-error-dark.png` — the panel after the host refused a navigation.
- `post-decision-dark.png` — the panel after a decision; not a loading claim.

The side layout is not re-claimed here: it is unchanged (the helper test pins
`w-80`/`max-w-[calc(100%-15rem)]` above 520), and this slice is the 264px
closure of D11/U17.
