# Team Bridge ownership remediation — round 2

Scope: the delta from frozen PR #1347 head `7cf4626d51cb6c9ebd2ceaa968021b5a9dc4e036`. This continues the interrupted implementation; it does not rebase onto the separate release-containment candidate.

## Prior evidence, retained rather than reconstructed

- [Code review and SEC-1–4 reproductions](https://github.com/damianvtran/local-operator-ui/pull/1347#issuecomment-6367245149).
- [Atomic-dispatch gap](https://github.com/damianvtran/local-operator-ui/pull/1347#issuecomment-6367273257).
- [Design round 1 and original before/after frames](https://github.com/damianvtran/local-operator-ui/pull/1347#issuecomment-6367047131).
- [Real-account server QA](https://github.com/damianvtran/local-operator-ui/pull/1347#issuecomment-6367355382).
- [Released-baseline provenance](https://github.com/damianvtran/local-operator-ui/pull/1347#issuecomment-6367364256).

The retained implementation had already reproduced 26 passing mounted cases plus four failing SEC regressions with the production 600000 ms cache lifetime and one mutation retry. Recovery kept that fixture and all four regressions. No new backend-authentication evidence is claimed by the renderer fixture.

## Change census

### Private cached reads

Conversations, timeline messages, the account and tenant unread reads, and the single/fan-out directory reads use account-owned shared query keys. Thread pages now use account + tenant + conversation + root. The notification watcher's caches use those same owned keys; it no longer has an independent stale identity cache. Status is the shared authority/control query, not private message data.

`readForBridgeOwner` checks ownership before dispatch and rejects a delayed result before cache admission if the captured status snapshot changed, including A→B→A. Banner delivery also checks the captured status snapshot, current activity, and notification preference before IPC. These are observed-renderer fences, not a claim to atomically authorize backend reads.

### Writes and runtime boundary

The **five conversation write operations currently reached by the rendered page** are:

| Desktop operation | Current UI callers | Guard |
|---|---|---|
| `team_bridge.conversations.create` | first-message DM/group creation; channel dialog | captured owner + explicit target tenant; capability required |
| `team_bridge.messages.send` without a thread root | timeline first send, existing conversation send, explicit retry | same |
| `team_bridge.conversations.join` | preview/invitation action | same; target captured in mutation variables |
| `team_bridge.read` | timeline/read acknowledgement and thread visible-reply acknowledgement | same; target captured in mutation variables |
| `team_bridge.conversations.notify` | notification menu | same; optimistic snapshots/rollback limited to owner cache and target tenant |

`TeamBridgeApi` also guards its existing archive/unarchive/leave helpers. The strict desktop schemas and endpoint mappings carry optional `expected_account_id` for nine operation names: the five above plus lifecycle, consent, members.add, members.remove. Twelve route cases test body/query placement, including the four lifecycle actions. Bodyless lifecycle and list-body/DELETE membership operations use owner + tenant query parameters; join uses its body, even through the legacy lifecycle spelling. There is no conversation-admit UI operation at this frozen UI base; none was invented in this remediation.

The renderer requires `team_bridge_conversation_owner_guard >= 1` before **covered** writes. Missing capability fails closed before the private operation. It supplies the author captured with the data, never the account currently displayed. The explicit tenant is the target tenant, not the OAuth token's default organization; multi-organization use remains valid.

This rollout depends on the runtime companion (PR #2827, parent-reported head `114ced`, not a shipped assertion) comparing the expected owner against the **same OAuth access object sent upstream**. The UI cannot prove that backend property. Thread reply sends and reaction toggles do **not** inherit an atomic guarantee from the conversation capability; their separate runtime features must adopt a scoped guard contract before claiming that guarantee. Their renderer dispatch/settlement fences are covered here, and the independent thread-containment release remains separate.

Mutation variables now capture author, tenant, conversation and lifetime fence at invocation. React Query may replace a pending mutation's options when its observer rerenders; a closure over the current selection is not an adequate retry snapshot. The real MutationObserver regression changes observer options between attempts and confirms the original target is retained.

### Recovery data

Unsent thread body and pending client reference survive only in a page-lifetime journal keyed by account/tenant/conversation/root. Late successful group-create receipts are retained in the original owner's journal without selecting, posting, refreshing or notifying as the next account. A later explicit retry by the original owner reuses the returned group rather than creating a duplicate.

An interrupted in-flight row becomes `unconfirmed`, not a definite failure and not an ongoing send. D1 uses a neutral retained body with the **existing Retry control**, without either misleading status label. No new catalogue key, context change, generated key change or locale ledger change remains. The attempted new-copy route was withdrawn because the sanctioned copy reader does not admit UI catalogues; no independent language audit was fabricated.

## Browser evidence

One capped Storybook server, one owned `browser` tool surface, existing `Team Bridge/Owner boundary proof/Production container` story. Production container/hooks/parser; explicitly labelled preload fixture. Cache TTL 600000 ms; mutation retry 1. No second browser stack, production access, or real credential assertion.

| Frame | Actual observation |
|---|---|
| `a-pending.png` | A owns a deferred message, shown pending. |
| `b-late-a-inert.png` | B after late A settlement; A's private body absent. |
| `a-return-neutral-first.png`, `a-return-neutral-settled.png` | A's private body and Retry restored, with neither failure nor sending verdict. |
| `a-thread-cache-draft.png` | A's admitted private reply and unsent private thread text. |
| `b-thread-refused-first.png`, `b-thread-refused-settled.png` | B's own thread read refused; no A private reply or draft. The shared root is legitimately available to both fixture accounts. |
| `a-thread-draft-restored.png` | A's unsent thread text restored on A's return. |
| `b-thread-retry-fenced.png` | A's held thread POST fails after the switch; receipt display remains A-only (one earlier timeline POST plus one thread POST), no B retry dispatch. |
| `b-late-group-inert.png` | One late group creation, no message POST under B. |
| `a-explicit-retry-one-group.png` | A explicitly retries the restored group message: still one group, POST to `created_acct_a_1`. This fixture deliberately refuses that new POST, so its current failure label is legitimate. |

All PNG sources are 2560×1440 physical pixels. The neutral first/settled pair is pixel-identical. Browser `styles` measured the neutral row at CSS x=288, y=244.8, width=992, height=69.49; opacity=1, overflow=visible. The refused-thread pair differs only in physical rectangle (2460,164)–(2524,228), the close-button focus transition, not private content. These stills do not claim every intermediate frame is safe; the mounted production tests record committed React frames for that assertion. The actual PNGs were opened and visually inspected. Final proof navigation reported no error-level browser console entries.

## Validation

Commands are bounded and use the existing dependency tree, not a new install:

```sh
NODE_OPTIONS=--max-old-space-size=3072 pnpm check-types
NODE_OPTIONS=--max-old-space-size=2048 \
LOCAL_OPERATOR_UI_TEST_CONCURRENCY=1 \
LOCAL_OPERATOR_UI_TEST_MEMORY_BUDGET_MB=3072 \
LOCAL_OPERATOR_UI_LANE_BOUND_MS=90000 \
node scripts/run-desktop-tests.mjs \
  scripts/team-bridge-pending-owner-mount.test.mjs \
  scripts/team-bridge-channels.test.mjs \
  scripts/team-bridge-notifications-mount.test.mjs \
  scripts/team-bridge-threads.test.mjs \
  scripts/team-bridge-reactions-behaviour.test.mjs \
  scripts/desktop-contract.test.mjs \
  scripts/test-inventory.test.mjs
```

The new mounted owner file is now registered in `test:desktop`, not merely run manually. Typecheck passed for main and renderer. The final seven-file scoped matrix passed **155/155**, zero failed/skipped/cancelled, in **58.935 s**. Its actual output is retained in `validation.txt` (only the local worktree path is normalized). The mounted ownership lane contributes 33 cases, including all four original RED reproductions; 12 owner-wire placement cases cover the strict mapper. During validation, legacy thread/reaction fixtures needed the new real status authority; the reaction probe also needed one shared QueryClient context. Explicit mutation/cache teardown fixed retained-GC-timer lane failures. Those failed attempts were not counted as passes.

No full suite, dependency installation, merge, release, flag change or production write was performed. Independent round-2 review, fresh design inspection of the neutral state, real authenticated runtime QA and CI are the parent's remaining gates.
