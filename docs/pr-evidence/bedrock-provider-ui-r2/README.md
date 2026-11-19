# PR #1987 round-2 remediation frames (not for merge)

Storybook `Providers/Amazon Bedrock`, before = 64b5f623be, after = b9c464107b.
`DialogColumn` / `InvalidRegionHoldsConnect` render the panel in the connect
dialog's geometry: 592 px `overflow-hidden` box, `px-4` (+1 px border) -> 558 px
content box; clip edge x=935.

| locale | before tablist width | before | after tablist | after rows | after max tab right edge |
|---|---|---|---|---|---|
| en | 562.88 px | 4.9 px into padding | 558 px | 2 | 774.91 |
| es | 729.56 px | last tab clipped | 558 px | 2 | 868.96 |
| ru | 701.49 px | last tab clipped | 558 px | 2 | 826.94 |
| vi | 643.64 px | last tab clipped | 558 px | 2 | 797.48 |
| ur (RTL) | 499.09 px | fits | 499.09 px | 1 | 915.00 |

Widths: harness browser `styles` on `[role=tablist]` / `[role=tab]`.
Invalid Region (Q4) and aws-login label (Q6): headless Chrome over CDP,
settled 6 s, probe of `button.disabled` + computed background.
