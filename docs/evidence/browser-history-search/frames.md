# Frames

The PNGs are NOT committed: `.gitignore` ignores `docs/evidence/**/*.png`, and
`scripts/check-evidence-structure.mjs` refuses a force-add. This file is the
tracked record of where they were written and their hashes.

Run scratch directory:
`$LOCAL_OPERATOR_SCRATCHPAD/s4b-history-8f9-1792645397/frames`
(copied to `docs/evidence/browser-history-search/frames/` for this run; pruned
with the session).

## After (this change)

| Frame | SHA-256 |
| --- | --- |
| owner-history.png | a5931f6f977ee0500c4d5f938d3d8c63272c9d296d11ff64a059eb9b40df4927 |
| child-history.png | ba79dc366a0f0b1560d09d97b78ac4a98026ca8a8519df55c34abe5d96c1eae3 |
| owner-search-github.png | 5b182624ada99941a80fea0d4ac4e282e6b98ffd81a77b53775864578585699e |
| child-search-github.png | 6a9401ac14cadd4411452b75c7f5efbc9d171340d2c09e1aa2f7c683bf4413d3 |
| owner-search-vpn.png | c7c1f4ba537ec1c4017d0b825a8a561f6f6fc05b51fd1ff69f59a398c12a3caa |
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
