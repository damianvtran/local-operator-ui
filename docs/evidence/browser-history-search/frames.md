# Frames

The PNGs are NOT committed: `.gitignore` ignores `docs/evidence/**/*.png`, and
`scripts/check-evidence-structure.mjs` refuses a force-add. This file is the
tracked record of where they were written and their hashes.

Run scratch directory:
`$LOCAL_OPERATOR_SCRATCHPAD/s4b-history-evidence-1792644111/frames`
(copied to `docs/evidence/browser-history-search/frames/` for this run; pruned
with the session).

## After (this change)

| Frame | SHA-256 |
| --- | --- |
| owner-history.png | aafe14e00b72587d88e327b28c109725466c146a878037af8e42f78146e28d6c |
| child-history.png | 71080df8a24ecce23202168894437b087a82c2fb31ac0ba93ce68345494060d7 |
| owner-search-github.png | 5b182624ada99941a80fea0d4ac4e282e6b98ffd81a77b53775864578585699e |
| child-search-github.png | 6a9401ac14cadd4411452b75c7f5efbc9d171340d2c09e1aa2f7c683bf4413d3 |
| owner-search-vpn.png | 57ca146ef184e152dd766ac646b619d4c58bf7c330a3772c59894ea36660c580 |
| child-search-vpn.png | 451a04cabc1159e4c4f8c0692399bee150af98de1d35f80fab061d4dec31fa0f |

`owner-*` are screenshots of the owner renderer (the field row). The native
overlay child cannot appear in the owner's screenshot, so `child-*` are
separate screenshots of the child document — together they are the before/after
pair for this change.

## Before (S4b round 3, copied, not rebuilt)

Source: `$LOCAL_OPERATOR_SCRATCHPAD/s4b-r3-fix/frames` in the S4b review
session.

| Frame | SHA-256 |
| --- | --- |
| before/owner-popout.png | 6a18daa1ead7560c582c9ea74a39272b6745f7b1dc09d198941422fb79cc5349 |
| before/child-rows.png | b27a4f0135c1bb1ea0896bcc89498344ba607da7df19f9de42657f00043b8273 |
