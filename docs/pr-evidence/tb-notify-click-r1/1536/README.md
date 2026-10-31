# QA round 1 frames — PR #1536 (head 6f19881667b)

Produced by the round-1 QA rig (controlled transport: the real renderer, hooks,
query client and stylesheet from the worktree under test; only the preload
surface is faked). Rig source and result JSONs live in the QA session's
scratchpad (`tbns/`), not in the repository.

| file | what it shows | how it was taken |
|---|---|---|
| 01-after-cold-loading.png | cold conversation: honest loading spinner, **no stale rows**, nav badge 1 and #announce row 1 already correct | live state held while the history read was delayed 9 s |
| 02-after-cold-message.png | the announced message after the one read | live, post-load |
| 03-after-evicted-loading.png | cached page evicted the target: spinner, no stale page presented as current | live, read held |
| 04-after-badge-nav1-row1.png | nav "Team Bridge (1)" and the Pat person row's badge 1 in one frame | live |
| 05-after-long-transcript-centred.png | 601-message channel scrolled from the bottom pin up to the clicked middle row (history 571–580 on screen) | live |
| 06-before-control-round1-rig.png | BEFORE tree (e44ecc6ecca): the click paints the stale page; the announced message is absent | round-1 rig, same before tree, `hold=12000` |

The 1.5 s accent wash could **not** be photographed: the page removes the
highlight class after 1.6 s and one screenshot round trip is longer than that, so
both attempts produced byte-identical frames. The wash claim in the report is
carried by the live computed-style samples (present at +105 ms as
`rgb(22, 40, 29)` = `--color-accent-wash` `#16281d`, absent at +1702 ms as
`rgba(0, 0, 0, 0)`), not by a still.
