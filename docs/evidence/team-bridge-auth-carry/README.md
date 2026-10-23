# Security-only account-boundary carry-forward

Base: current release/main `39164868fc15bd7971a1df625ef99e53c209e08f` (0.41.1). This is a fresh branch, not a rebase or feature return of #1347. The clean #1347 head `69657c5d618e06959f1b3e144d18cc78ab9923c0` remains separate.

## Boundary and negative control

The independent rollback witness used the real `useRadientUserQuery`, `useRadientAuth`, membership hook, `commissionAccountRead`, API parsers and shipped singleton QueryClient with its **600000 ms** query lifetime. After auth/status both observed B, a committed B frame still contained A's cached body, including the sampled history-refusal state. That proves a controlled-transport application-code failure, not installed Electron or real-JWT exploitation, and not indefinite persistence after the refusal.

The new regression fixture is adapted from that exact retained corrected invocation (reviewer transcript entry `4db25e80537b4f6b8bf1652667d2c7a5` and its original `7cf4626d51` fixture). Auth and membership are not stubbed. The singleton is imported, not approximated by a new test QueryClient. The release-negative control compiles changed source files from exact `39164868...` **in memory**, without modifying another worktree:

```sh
NODE_OPTIONS=--max-old-space-size=1536 \
TEAM_BRIDGE_AUTH_BASELINE=39164868fc15bd7971a1df625ef99e53c209e08f \
node --test --test-concurrency=1 \
  --test-name-pattern='actual auth completion cannot expose' \
  scripts/team-bridge-auth-owner-mount.test.mjs
```

Actual result: **RED**, one assertion failure, **3.106 s**. A was populated first, real auth/status B was observed, and the assertion requiring A's private body to be absent received `true`. The retained failure output is `baseline-red.txt`; it is not counted as passing validation.

## Security-only changes

- Actual auth commissioning revokes private authority **synchronously before its first await**. A small per-QueryClient credential epoch records only ownership/transition metadata, never a credential or body. Only the real account query can settle it; cancelled older account reads cannot restore an old epoch.
- The private page observes this live auth authority, not a stale Team Bridge status alone. An auth-epoch keyed page lifetime fences old callbacks. Resetting the shared QueryClient is not the security mechanism: late reads are independently checked before cache admission and mutation retries/settlements retain their original owner.
- Conversation list, message history, unread, directory, identity/status and the notification watcher's caches are account-qualified. The shared membership hook is account-qualified too, because its cached private rows label/fill the Team Bridge organization selector. Unresolved authority uses a distinct disabled slot, never an unowned-cache fallback.
- The nav uses the actual observed owner and shares the account-wide unread aggregate; the More engine and aggregate policy are unchanged.
- The current **nonoptimistic** composer retains only owner-scoped draft data (body and client reference) and inert created-conversation receipts. A→B→A restores A's text but never displays it as B. No optimistic pending-message feature or former #1334 UI is restored.
- Reviewed mutation-variable capture is reused for create/send/join/read. Notification optimism/rollback is limited to the captured owner's cache and target tenant. Late create receipts can be reused only by a new explicit action by their original owner; stale continuations cannot post or select as B.
- Covered writes require `team_bridge_conversation_owner_guard >= 1`, captured `expected_account_id`, and an explicit target tenant. Missing capability fails closed and uses the existing capability/unavailable cue; **no new product copy** is introduced. The runtime must bind the expected account to the same OAuth access object it sends. No token-default-org equality is imposed on legitimate multi-org targets.

### Exact write scope

Rendered operations: create, non-thread send/retry, join, read acknowledgement, notify. Existing archive/unarchive/leave API helpers also negotiate the guard. Strict optional owner fields and mapper cases cover nine operation names / twelve body-or-query route cases: create, send, join, read, notify, consent, lifecycle (archive/unarchive/join/leave), member add and member remove. Bodyless/list-body/DELETE operations use owner + tenant query parameters; join uses its body.

This is **not atomic read authorization**. Client-observed auth epochs reject known transitions and delayed admissions; a backend credential/read race not yet observed by the client is not claimed solved by a renderer fence. The paired backend must advertise the covered write contract; a merged runtime commit is not proof that the operator's installed runtime has it.

## Containment stays in force

`TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD` and `TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD` remain **false**, with their source files unchanged. All 17 existing containment tests pass, including direct exports and notification fallbacks. No runtime capability answer reopens either feature. Thread sends/reactions do not acquire the conversation capability's atomic guarantee by implication. Their later return remains a separately reviewed integration.

## Actual validation

All local costly phases checked at least 5 GiB available before launch; existing dependency tree/lockfile was shared, with no installation. Node heap 1536 MB and test process-group budget 2048 MB; serial execution and per-lane time bounds. No full 155-case old-feature matrix.

1. **19/19 passed, 4.417 s**: seven production-auth/owner cases plus twelve strict wire cases in `team-bridge-auth-owner-mount.test.mjs`. Covers populated A, real B auth/status commit, actual B 404 history request, no A-private B commit, stale Team Bridge status, delayed A history, A→B→A draft retention, inherited mutation retry, early transition revocation, old-runtime write refusal, and actual nav A=7 → B=2 with no A=7 B frame. Registered in `test:desktop`.
2. **33/33 passed, 6.195 s** across existing channel, notification, feature-hold and inventory lanes. The notification policy fixture seeds its already-validated auth cache; it is not misrepresented as another real-auth transition test.
3. **Main and renderer TypeScript passed**, serial `pnpm check-types`.

The initial candidate run exposed a fixture that looked for B's rail before admission completed and a cancelled-query GC-finally timer surviving removal. The fixture now waits for the real admitted row and destroys its owned query objects after cancellation settles. A name-filtered legacy desktop-contract invocation failed in its global HTTP fixture before executing wire assertions; the same reviewed wire cases were moved onto the actual-auth fixture's compiled production contract module, then all nineteen cases ran clean. Failed/setup runs are not passed evidence.

The corresponding actual logs are retained alongside this document, with only the local worktree path normalized. Independent code/design review, current-head CI and paired-runtime/real-hub evidence remain separate gates. No merge, release, feature hold removal, production write, credential access or native Electron run is implied by this document.


## Actual browser frames and geometry

One existing Storybook server, one owned browser-tool tab, actual Page/auth hooks,
real `commissionAccountRead` and shipped singleton; controlled preload only.
Nine full source frames (2560×1440) and four explicitly cropped comparison pairs
are retained here. The captures were actually opened and visually inspected.

- `a-populated-draft.png`: observed A, A private history, original A typed draft.
- `b-status-pending-first.png` / `b-status-pending-settled.png`: observed auth B,
  held Team Bridge status, existing checking cue, no A history or draft. Their
  only pixel change is the loading spinner (bbox in `frame-metrics.json`).
- `b-history-refused-first.png`: the B page really committed its conversation
  and history error with an empty composer; no A body. **The later capture,
  `b-history-poll-later.png`, is the next inherited poll's loading state, not a
  stable settled error.** No stability claim is made across that state change.
- `b-populated-first.png` / `b-populated-settled.png`: admitted B history, no A
  text; only a one-pixel difference at the rail decoration.
- `a-return-draft-first.png` / `a-return-draft-settled.png`: actual auth return
  restores A history and the exact A draft; the pair is pixel-identical.

The empty B composer and restored A composer have the same measured CSS rect:
x304/y270.8/w960/h40, opacity1, min-width0, overflow:auto. There is no new
optimistic row or held thread/reaction affordance in these frames. Stills are
not every intermediate commit: the mounted actual-auth Profiler assertions
supply that coverage. No error-level browser console entries were reported.
The tab was closed and the sole Storybook process group (root68979) was reaped
before the normal commit/push phase. No second browser or app engine was used.
