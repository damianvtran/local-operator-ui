# Credential-inheritance approval card

## Scope and authority

This is a **read-only UI consumer** of the existing backend disclosure contract (`summary`, `details`, `can_approve_here`, `approve_remedy`). It neither creates requests nor implements a new signing or credential-sharing protocol. Credential and unknown intent never acquire generic desktop Approve, including a malformed record claiming `can_approve_here: true`. A false flag restricts ordinary records too; legacy ordinary records without these optional fields retain their existing controls. Backend authority checks are unchanged.

Pending cards show the plain backend summary, the **request window**, the backend CLI remedy and a disclosure containing all server detail lines. The permission duration remains server text, not a guessed interpretation of the request expiry. Approved records stay in existing history, explicitly waiting to apply; they do not repeat the approval instruction. Their full disclosure retains the server's APPLY command. Connected, denied and expired records stay in history, not the waiting count.

## Capture environment and limits

Harness browser tool, Storybook 8.6.12, existing shared matching-lockfile dependencies; one background surface/server at a time. Each server used normal machine-lease admission, an isolated HOME, Node's 2GiB heap ceiling and a 110-second process-group-reaping bound. No dependency install, alternate browser engine, native Electron, human OAuth, actual signature, real account or backend grant acceptance is claimed. The real MeshPage/query/mutation controller talks to a stateful synthetic desktop bridge; a deny changes the stored fixture and invalidated reads return its new state.

These are source-working-tree captures, not a global palette sweep. The sixteen PNGs are declared supplementary **unjudged** frames, with zero sweep passes. The source blob receipt and actual geometry are in [observations.json](observations.json). Earlier pending/details after-frames precede the focus-only addition; their row presentation was unchanged. Later deny, approved, terminal, malformed and narrow frames include that addition. Some captures include Storybook manager chrome; they are semantic before/after comparisons, not pixel-diff claims across identical canvas sizes.

## Before and after

- [Before pending](credential-before-pending-dark-final.png): the unchanged original normalizer/tray incorrectly treats the same credential fixture as generic onboarding and offers Approve despite its false flag.
- [After pending](credential-after-pending-dark.png): server disclosure and CLI remedy, Deny/Details, no generic Approve or onboarding capability chips.
- [Before approved](credential-before-approved-light.png) → [after approved/details](credential-after-approved-details-light.png): existing history now distinguishes recorded approval from applied permission.
- [Full server APPLY line](credential-after-approved-apply-light.png): the command is plain text, not executed. Clicking its text caused no navigation. Browser `scroll` reported window `(0,0)` even when given the actual auto-overflow container; targeting the final detail brought it into view. **No wheel-scroll acceptance claim** is made from that harness behavior.
- [Expanded pending details](credential-after-details-dark.png): fourteen server lines include duration, request-window distinction, recipient/signer, capability prerequisites, revocation and the APPLY step.

## States and actual interactions

| Surface | Actual observation |
| --- | --- |
| [Deny flow](credential-after-deny-flow-dark.png) | Actual Storybook completion console: `{"denyRequests":1,"approveRequests":0,"disclosureRequests":0,"historyFocused":true,"state":"denied"}`. Details click sends no decision. Normal deny mutation changes fixture state; the removed control hands focus to closed history; an actual history click shows Denied, without a waiting badge. |
| [Terminal history](credential-after-settled-dark.png) | Connected, Denied and Expired; play assertions reject any Approve/Deny/Stop action or waiting count. |
| [Empty](credential-after-none-light.png) | No phantom approval panel/count. |
| [Malformed](credential-after-malformed-light.png) | Mixed-type details and malformed remedy fail closed. A literal `<img src=x onerror=alert(1)>` is text, not an image/handler; extra true cannot expose Approve. |
| [Restricted ordinary/future](credential-after-restricted-dark.png) | Ordinary false-flag and unknown-kind extra-true records both show remedies and no generic Approve. |
| [Multiple](credential-after-multiple-narrow-light.png) | Two requested credentials count as two waiting; one approved record is separate history. |
| [Multiple/history](credential-after-multiple-history-narrow-light.png) | Actual history disclosure click, no count inflation. |
| [Narrow/full details](credential-after-multiple-details-narrow-light.png) | Actual Details click at an **800×600 CSS-pixel** iframe, measured rect `(240,80,800,600)`. Text wraps; long content uses the existing vertical page container. |
| [Read error](credential-after-read-error-dark.png) | Existing approvals-read error, not invented missing approval state. |
| [Loading](credential-after-loading-light.png) | Existing loading state, no premature decision control. |

ApprovedDetails, SettledOpen, malformed and restricted-compatibility plays completed without browser console errors. The normal application scroll content box measured `(24,24,1232,672)`, `overflow-x/y:auto`; its detail list measured `(88,354.28,1144,356.38)` with visible-overflow ancestors. The final text-target capture shows the full APPLY line. These numbers describe the actual rendered boxes, not a native desktop/window claim.

## Tests and failures retained honestly

- Registered existing `scripts/mesh-tab.test.mjs` lane: **83 passed, 0 failed, 365.5ms** on the final affected run.
- Scoped TypeScript check of the touched components/stories/import graph: PASS. The first scratch-only configuration failed because it named a nonexistent `env.d.ts` and inferred scratch as rootDir; the configuration was corrected before browser dispatch. This was not a product failure or a full renderer typecheck claim.
- Affected Biome check: rc0; **40 warnings**, not warning-free. The existing source-shape assertion initially failed after formatting wrapped a conditional `cn(...)`; its whitespace/comma tolerance was corrected while retaining the exact condition and border classes. The next complete 83-case lane passed.
- Discriminating real-flow regression: the initial new DenyFlow **failed** because focus fell off the removed button. The scoped focus handoff fixes it; the same flow then emitted the completion receipt above. A person who moved focus elsewhere while the decision was pending is not pulled back.
- Supplementary ledger suite: **52 passed, 1 skipped** of53 cases, bounded rc0/wall6.4s. Its first run caught the stale declared-set count218; the leading current paragraph was corrected to the actual219 without rewriting historical counts. No global sweep was run.
- Final affected test/type/style cell: bounded rc0, wall2.3s. No full local suite, packaging, native run or global evidence sweep was duplicated; CI owns terminal full coverage.
- Changed-scope classifier reports lint/types/unit/evidence/pack RUN. That plan is **not** a passing `check-changed --run` or a green CI claim. Full gates remain for CI.

A refused machine-lease cell started no Storybook/runtime/browser. The last accepted capture cell reached its intended 110-second bound (rc124/wall110.4s); its owned process group81672 was subsequently absent, and the browser surface was closed. No bound was increased to obtain evidence.

## Reach the change

From the branch worktree, use the repo's normal guarded Storybook command and open `/?path=/story/mesh-tab--credential-pending`. Other exported stories: `credential-details`, `credential-deny-flow`, `credential-approved-details`, `credential-settled-open`, `credential-multiple-narrow`, `credential-malformed`, `credential-restricted-compatibility`, `credential-none`. Actual fixtures are synthetic; do not substitute real credentials.

Independent code, QA, design and UX review are still required. No merge, release, install, desktop signing capability advertisement or backend-policy change is part of this work. Earlier implementation/execution history used temporary `openai/gpt-6.1-sol` fallback; this continuation's session model header is `anthropic/claude-sonnet-5-5`.
