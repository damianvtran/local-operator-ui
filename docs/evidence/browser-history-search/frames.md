# Frames

The PNGs are NOT committed: `.gitignore` ignores `docs/evidence/**/*.png`, and
`scripts/check-evidence-structure.mjs` refuses a force-add. This file is the
tracked record of where they were written and their hashes.

Run scratch directory:
`$LOCAL_OPERATOR_SCRATCHPAD/s4b-r2c-1792649569/frames`
(copied to `docs/evidence/browser-history-search/frames/` for this run; pruned
with the session).

## After (this change)

| Frame | SHA-256 |
| --- | --- |
| owner-history.png | 48307c2d14efe88beb48796df076428a06790628cc867e67a019cc6bd920998f |
| child-history.png | ef20f986b8e126aeb3d743ae850aa2df1533097a9e0e3f76ff016dcd4ff3e1bc |
| owner-search-github.png | 16686ab7e297ddcfa5bb1aced7bdc660fed9510bc50e68a398339a7d82bd512d |
| child-search-github.png | 0db8c54ed823fdf5ae0670f3266bc07e85d614eb28f2ea74f18de4cd06f9554c |
| owner-search-vpn.png | 57ca146ef184e152dd766ac646b619d4c58bf7c330a3772c59894ea36660c580 |
| child-search-vpn.png | 346ca6c41794385792ec8b9ac572c4e8f069d22e6b2355fc3180b54a8bdd714b |
| owner-open-tab.png | 48307c2d14efe88beb48796df076428a06790628cc867e67a019cc6bd920998f |
| child-open-tab.png | e5913ad2f8ce8d5eaa90fedb1899d70acd8447051b703ce19c68882eaa509265 |
| owner-narrow-open-tab.png | 461849f9d40162e91e2abd69e02acb9960d75961c6e42ba55550edb749258e3b |
| child-narrow-open-tab.png | c609ff3e70cbbe36e1b05fe1b12fa86898dd98e5e94b4bf4ce8fdb41fefea6c0 |
| owner-no-match.png | 70e91a6076b7934e75db3450ff868fab5e7fd0b11db1dc2ffc5640c6a94a675c |
| child-no-match.png | b42fddf5e3161a95354391603df1dbe97f5a8915362627230e3387d2ab2b54de |
| owner-rtl-search.png | 225858f414818af096a9b7fe6feb3b5b9a059c4c5316db25c1ab59537d8c7bfd |
| child-rtl-search.png | 1fe5cda748a890b6eb9ee45de5af1abe323c06d1a0c5a1f250f5e7f9d4f0c70f |

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
