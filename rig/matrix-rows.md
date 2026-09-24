### R18 A/B (head dd589d577 vs prev 486351dbd)

**r7-second-pass**
- `head`: pass 1 `107T=107 110B=110` = 217 | pass 2 `107T=107 110B=110 107B=107` = 324 | settled 58/1/0 | BtxwosfMLe2d=labelled INJOURNAL000=stand-in | streams 1->2
- `prev`: pass 1 `107T=107 110B=110` = 217 | pass 2 `107T=107 110B=110` = 217 | settled 58/1/0 | BtxwosfMLe2d=absent INJOURNAL000=stand-in | streams 1->2

**r7-reattach**
- `head`: pass 1 `107T=107 110B=110` = 217 | pass 2 `107T=107 110B=110 107B=107` = 324 | settled 58/1/0 | BtxwosfMLe2d=labelled INJOURNAL000=stand-in | streams 1->1
- `prev`: pass 1 `107T=107 110B=110` = 217 | pass 2 `107T=107 110B=110` = 217 | settled 58/1/0 | BtxwosfMLe2d=absent INJOURNAL000=stand-in | streams 1->1

**r7-both-ways-end**
- `head`: pass 1 `107T=107 110B=110 107B=107` = 324 | settled 58/1/0 | BtxwosfMLe2d=labelled INJOURNAL000=stand-in
- `prev`: pass 1 `107T=107 110B=110` = 217 | settled 58/1/0 | BtxwosfMLe2d=absent INJOURNAL000=stand-in

**r7-both-ways-verdict**
- `head`: pass 1 `107T=107 110B=110 107B=107` = 324 | settled 58/1/0 | BtxwosfMLe2d=labelled INJOURNAL000=stand-in
- `prev`: pass 1 `107T=107 110B=110` = 217 | settled 58/1/0 | BtxwosfMLe2d=absent INJOURNAL000=stand-in

**r7-both-ways-start**
- `head`: pass 1 `107T=107 110B=110 107B=107` = 324 | settled 58/1/0 | BtxwosfMLe2d=labelled INJOURNAL000=stand-in
- `prev`: pass 1 `107T=107 110B=110` = 217 | settled 58/1/0 | BtxwosfMLe2d=labelled INJOURNAL000=stand-in


### Pinned sweep (head dd589d577)

| `r6-noclock-settled` | `107T=107 110B=110 107B=107` = **324** · settled 58 rows/1 stand-ins/0 blank · BtxwosfMLe2d labelled; INJOURNAL000 stand-in |
| `r6b-notrun-unpresent` | `107T=107 110B=110 107B=107` = **324** · settled 58 rows/1 stand-ins/0 blank · BtxwosfMLe2d labelled; INJOURNAL000 - |
| `r5-lone-pending` | `107T=107 110B=110` = **217** · settled 58 rows/1 stand-ins/0 blank · BtxwosfMLe2d -; INJOURNAL000 stand-in |
| `r6a-boundary104` | `104T=104 107B=107` = **211** · settled 58 rows/1 stand-ins/0 blank · BtxwosfMLe2d -; INJOURNAL000 stand-in |
| `r5-labels-stray-pending` | `325T=325` = **325** · settled 58 rows/0 stand-ins/0 blank · BtxwosfMLe2d -; INJOURNAL000 - |
| `f-noargs` | `107T=107` = **107** · settled 36 rows/2 stand-ins/0 blank |
| `stray-oldest` | `325T=325` = **325** · settled 58 rows/0 stand-ins/0 blank · BtxwosfMLe2d -; INJOURNAL000 - |
| `d-hang` | `321T=-` = **0** · settled 58 rows/26 stand-ins/0 blank |
| `c2-short-running` | `100T=100` = **100** · settled 34 rows/2 stand-ins/0 blank |
| `b-finished` | `` = **0** · settled 30 rows/0 stand-ins/0 blank |
| `a-labels` | `321T=321` = **321** · settled 58 rows/0 stand-ins/0 blank |
| `a-counts` | `328T=328` = **328** · settled 56 rows/0 stand-ins/0 blank |
| `switch-loop-r7` | sampled frames: 1490,58,0,0x2, b0b0,0,0,0x2, b0b0,20,0,0x41, 1490,58,0,0x44, b0b0,20,0,0x45, 1490,58,0,0x44 ... (14 runs, 800 frames) · reads during cycles 1 · settled 58/0/0 |
| `merge-render` | `328T=328` = 328 · edit row collapsed aria-expanded=false h=20 text='edit\nquiyhmsipkrkxxyauhqpvjptrlrkliycqak' · working line 1 '⣟\nthinking\n3s' · after a real click expanded=true h=757.9375 +lines=32 -lines=2 |
