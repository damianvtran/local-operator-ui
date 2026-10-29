# Frames

The PNGs are NOT committed: `.gitignore` ignores `docs/evidence/**/*.png`, and
`scripts/check-evidence-structure.mjs` refuses a force-add. This file is the
tracked record of where they were written and their hashes.

Run scratch directory:
`$LOCAL_OPERATOR_SCRATCHPAD/s4b-r3b-1792653343/frames`
(copied to `docs/evidence/browser-history-search/frames/` for this run; pruned
with the session).

## After (this change)

| Frame | SHA-256 |
| --- | --- |
| owner-history.png | 416bb3d33d0608b83e947e05e77f44c5620dee27c09c5ee1d5475ee462039ca8 |
| child-history.png | bcfc1469120df6409dcfbeb9a1d2e178b746db08abab2f5709fc1866689c1b69 |
| owner-search-github.png | b890e98e2a3d724345dad143b514328b7b68bd9bcbc024ddfe506af6fc4eb269 |
| child-search-github.png | 0db8c54ed823fdf5ae0670f3266bc07e85d614eb28f2ea74f18de4cd06f9554c |
| owner-search-vpn.png | 57ca146ef184e152dd766ac646b619d4c58bf7c330a3772c59894ea36660c580 |
| child-search-vpn.png | 346ca6c41794385792ec8b9ac572c4e8f069d22e6b2355fc3180b54a8bdd714b |
| owner-open-tab.png | 416bb3d33d0608b83e947e05e77f44c5620dee27c09c5ee1d5475ee462039ca8 |
| child-open-tab.png | 76db164d58dbd42538752ed29a71ae2eac89b4fb6d5f14a4329247a9525a1fd7 |
| owner-narrow-open-tab.png | 461849f9d40162e91e2abd69e02acb9960d75961c6e42ba55550edb749258e3b |
| child-narrow-open-tab.png | 899e5988bfaf048e9d4d4e96bcef423fc493aba2c5b7316efca531dc68e752cd |
| owner-no-match.png | 1a28cf975204b7261175b67cbdf86d7c8b51e4720e16b189f8de04b35183d646 |
| child-no-match.png | b42fddf5e3161a95354391603df1dbe97f5a8915362627230e3387d2ab2b54de |
| owner-rtl-search.png | 225858f414818af096a9b7fe6feb3b5b9a059c4c5316db25c1ab59537d8c7bfd |
| child-rtl-search.png | 1fe5cda748a890b6eb9ee45de5af1abe323c06d1a0c5a1f250f5e7f9d4f0c70f |
| owner-boundary.png | 1e38eff4ae34da7a8d470b3b084becb6dc55903a72f53e5c79f6991c9cc5a228 |
| child-boundary.png | 95eeed6c440a6ca53f533f3efc8f5fcbf28f9961e61f1808639b7c4bd062147b |

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
