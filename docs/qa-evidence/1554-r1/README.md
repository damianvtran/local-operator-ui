# QA evidence — local-operator-ui #1554, round 1

PR head under test: `6cbfe9f05e5276bbe74f08d1fe2563dd45b8ed3b` (branch `fix/legacy-inline-receipts`).
Captured 2026-11-02 with the harness `browser` tool (Local Operator desktop app's browser host), against source Storybook
booted by `scripts/with-storybook.mjs` from a throwaway worktree at that head, opened through the manager URL
(`?path=/story/...&nav=false&panel=false`). Viewport 1280x720 CSS px at DPR 2 (frames are 2560x1440). Dark theme (default).

Synthetic bytes only. The `qa1554-*.stories.tsx` files are the QA-only stories used for the variant and control
frames; they were never committed to the PR branch. `scanner-probe.mjs` drives the PR's exported `inlineImageSpans`.

| Frame | What |
| --- | --- |
| 01 | Thread repro (`Team Bridge/Attachments › BubbleLegacyInlineDataReceipt`), collapsed |
| 02 / 03 | Thread repro expanded, Part 1 / Part 2 of 293 |
| 04 | Owner audit repro (`OperatorReproReceipt`), both rows collapsed |
| 05 | Owner audit, rejected-row receipt paged to Part 293 of 293 (Next disabled, tail `...AB==`) |
| 06 | Owner audit `Populated` with URL args: Not screened / Rejected / Status unknown rows inline under badges, no disclosure |
| 07 | `Team Bridge/Message mentions › Dark`: prose + @mention chips unchanged |
| 08, 10-12 | Variant rows (svg+xml, uppercase, short, non-base64 tail, code, base64url, wrapped) |
| 13-18 | Keyboard: summary focus ring, pre, Next/Previous rings, activation |
| 19 | CONTROL: main's renderer (whole body to TeamBridgeMarkdown) vs PR head for a fenced code block holding a small data URI (Q1) |
| 20 | PR head: a fenced code block holding a 20 KB data URI (Q1) |
| 21 / 22 | Owner audit keyboard: Tab / Shift+Tab between the two receipts, focus ring on each |

SHA-256:
    7e1ce0f9579a19a1fbea5698913d81d8505cd91e34d989ef2465f21c7b966f8b  01-thread-collapsed.png
    2e08e97a1e160e12db4d5681f6b46fe195a5b02264b52dba7d67347eebb27208  02-thread-expanded-p1.png
    cf10007c3b89706de149ddc6af28b07371748e29735e88b5137da4cfe5a938fb  03-thread-expanded-p2.png
    6729511b49fafd66250cf96c1b56497ebe92a19ca6bb445f3415a89c96fad2bb  04-audit-repro-collapsed.png
    b77411550d4730053de811854790bed92b67fc166a70c1647c3b84c33e1f218e  05-audit-expanded-last-part.png
    d0d6ac26c7038910f0a5a53ea95bb3d9845279adad93be9d9a3f08db0809cd63  06-audit-verdicts-inline.png
    2c9cf631357c9bbe582f2cf56022b75670ff76045f56a986227769dcf94350b1  07-mentions-prose-unchanged.png
    fafebaaafea9b7b0d4c01bab3fc1edaa3b55fee415c8649e1fd3fa5e75f07e96  08-variants.png
    cb849200d15a46a993fb66745c99466581edb20f7f440bf59886d8898a59493d  10-variants-svg-upper-short-tail.png
    8f9e65b6c64934e10d2b4304e4bc64b6dcd02b826556487bc5c7129787c6af0b  11-variants-code-b64url.png
    cb33a71113a5b67db15a275ba7d5e44213e36a53694a3d09348f7b2e066ccca3  12-variants-wrapped.png
    69654d6876e8d357ed6b00270894d169ed359a71216179c2774efcf626f58d46  13-kbd-summary-focus-open.png
    bc7f2986aa31494b436dbec9251833a9b44969da19454b8030590d0c083a7f9f  14-kbd-tab1.png
    b41bef78b66d2e72ae300d7cf30bbce1e4dfac7cb79403743e356a3fdf832e64  15-kbd-tab2.png
    c26e5c228059e05781d6a685a85d7201a198574729c980911209b50ffcf54a58  16-kbd-next-activated.png
    95d7a933351939969b218bfd0d5860349b5bca32c1514ac8199d112c44439688  17-kbd-prev-focus.png
    38909c75e159116d235efdb38beddd97b7cade030696791b95d32ea220a4b539  18-kbd-prev-activated.png
    fdfb55299fff9efc718f00703ce85c5b9870d2d578aaa7a982c803bd1fa49ec2  19-control-vs-pr-code-fence.png
    145a1ad5aa99fe6fc21be89be5d50a04682dd393b3bcc5bed50c9cc135572a7c  20-pr-big-data-in-code-fence.png
    fd24511844ee034e72cad7a6bd4dc4356e9d12cd804fb3a7832846f7215fc6bb  21-kbd-audit-tab-to-second-summary.png
    d43bcee96725428b304772df23966c8ac81d5903e28e3541ae7e8d389c58f772  22-kbd-audit-shifttab-first-summary.png
