# Streaming transcript convergence — 2026-10-14

Old reviewed head: `f79bfcef099f55a8c5b7a55d85998958a72fbede`. Original merge-base: `2bfc2eae26f6d47ad774ad1289e57354a94310d4`.
Fetched upstream: `34371562d4e7fe4af160327494d10ed46f314235`. Rebased source head before this documentation-only record: `7de630c73a6fec0319b6914318d7f23b23e353bb`.

## Content compatibility

`git range-diff <original-base>..<old-head> <upstream>..<rebased-head>`:

```
1:  b73fa59b7 = 1:  d27f9a774 fix(chat): keep live rows in arrival order while their journal wakes trail
2:  3ce57f848 ! 2:  33bd58a6a feat(chat): parse the open markdown block while it streams
```

The full range-diff has five `=` pairs; the one `!` is ONLY package.json
`test:desktop`. No source conflict. The manifest conflict was resolved by retaining
upstream's entire test command/order and appending the same three feature tests
(`streaming-live-markdown`, `markdown-remend`, `stream-order-live`). No upstream
inventory entry was removed, and no new dependency/version bump was introduced.

Verification derived from git trees:
- Non-package.json +/- line streams, with headers excluded: **byte-identical**
  for original base..old head and fetched upstream..rebased head.
- New test token set vs each respective base: **identical**, the three above.
- Every package.json field except `scripts.test:desktop`: **identical to upstream**.
- Version on upstream and rebased head: **0.34.40** (inherited release, not a feature bump).
- Only feature/upstream overlapping path: **package.json**.
- Markdown, CSS, story, canonical rendering and ordering modules are byte-identical
  old reviewed head vs rebased head. Design round 2 evidence is unchanged.

This proves source compatibility, not permission to repin the old rounds: one
independent convergence round remains required, checking upstream semantic interactions.

## Old CI failure investigated

Run `38600669083` was head `5ac6b688b`, not the latest reviewed head.
Desktop Tests job `115981705976`, full job log (gh API with allow-escape-sequences):

```
not ok 6506 - an outage is told as a failed check, never as a sign-in (design round 1, D1)
location: scripts/stt-mic-gate-session.test.mjs:994
error: timed out after 15000ms waiting for the account read to fail with the upstream code
```

No ordering/markdown assertion failure is reported. The same file/test and its
speech-gate inputs were not edited by this feature. An isolated origin/main control
passed **23/23**, bounded wall **83.5s**. Rebased head initially hit 90s and 120s
resource bounds (17 and 18 passing subtests, no assertion failures); one bounded
240s retry completed **23/23**, wall **107.4s**, rc0. This is not proof that the CI
flakiness is eliminated: it is a non-reproduced timing failure, not grounds for a
speculative fix or relaxed assertion. Fresh CI is still required.

Targeted convergence checks: test inventory **1/1**, ordering **22/22**, the STT
file **23/23**. Serial node heap cap2048MiB, run_bounded.py process-group cleanup.
No local full suite, no native/browser launch, no backend edits, no shared checkout
changes.
