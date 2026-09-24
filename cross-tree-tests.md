# Cross-tree runs of `scripts/seed-label-gap.test.mjs`

One test file, three `src/` trees. The file and the fixture are this branch's; the
tree under test is whatever `src/` the command runs against, so a case that fails
only in one of the three says exactly which change it is about.

Command, in each tree (the file and fixture copied in):

```
env -u NODE_TEST_CONTEXT node --test scripts/seed-label-gap.test.mjs
```

| tree | tests | pass | fail |
|---|---|---|---|
| `origin/main` (`d1402bbaa`) | 13 | 1 | 12 |
| round-0 head (`d2975e6f5`, the head QA reviewed) | 13 | 7 | 6 |
| this branch's head | 13 | 13 | 0 |

The one case that passes everywhere is `the fixture carries structure and no free
text`: it is a property of the fixture file rather than of the tree, and it is in
the file so a later edit cannot quietly put real content back.

## What each tree fails

`origin/main` fails every behaviour case, which is the round-0 evidence
(`cross-main.txt`): 23 of 68 seeded calls still paint their output, 41 are left
unlabelled after a short read, nothing is held on the first frame, the retry reads
182 rows against 236 already read, and the durable `+91 -19` is written over as
`[0, 0]`. It also fails the six round-1 cases.

The round-0 head fails exactly the six ROUND-1 cases (`cross-round0.txt`) and
passes the six it was written for:

- `a join whose targets cannot be durable yet stops at the turn boundary`
- `a call nothing can label does not walk to the bound or raise the retry depth`
- `returning to a conversation does not re-blank rows already painted`
- `a read that never answers releases the hold at its own cap`
- `a route answering with short pages cannot make the walk unbounded`
- `a page that begins on a result labels the call whose start is one row older`

The Q1 case fails there with `rows this window already painted are not held empty
again: 68 !== 0` - the round-0 head re-held all 68 seeded rows on the second mount
of the same conversation, which is the regression QA measured in the app.
