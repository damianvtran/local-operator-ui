# Muse passive allowance provenance

## Reproduction and root cause

A live installed `local-operator` 0.71.2 daemon returned HTTP 200 for `/v1/desktop/usage?provider=meta-muse&live=true&refresh=true`, with no limits and the **vetted** note `Stale sign-in allowance; current usage unknown; refresh does not query Muse.` The real owning account still held an Oct 12 sign-in observation: core PR #2385's earlier live-wire QA used an isolated copy and did not activate that real account.

One authorized bounded serving request on the installed runtime produced a response allowance of **0% current / 99% weekly**, persisted `source=responses` on the real account, and the same already-running central daemon immediately returned those numbers and matching reset epochs. A separate metadata-store connection confirmed durability. No backend/service change or further inference was needed or performed for this UI fix.

The native view model nevertheless typed `notes: null` and discarded the explanation, rendering generic unavailable/no-windows copy. It also kept a response's meters indefinitely while the pane remained open, unlike the backend's five-minute passive-receipt lifetime. Refresh is not a Muse quota request: the integration has no verified read-only quota endpoint authenticated by its stored inference key.

## Rendered evidence

These are **Storybook presentational captures through the harness browser**, not screenshots of the packaged native desktop or proof of its bridge. Both controls use the same new synthetic account stories and pinned clock. No custom browser engine or Electron rig was launched.

Before source: `2efe5fe3971806a00469fcd1b52110186813b593`, unchanged view/model with only the new story fixtures added. After source blobs:

- `usage-view-model.ts`: `ac81f4a38dd36e9b85db6bfba8a2277f6187ec45`
- `usage-view.tsx`: `b03b9f2f8d70810c9350e92cda65985031fd73af`
- `usage-view.stories.tsx`: `b650745f55315fa706298aff2edb382c2702c691`

All eight captures are 2560×1440 PNGs. They are registered as a zero-`.webp` supplementary set, rather than included in the global matrix's `.webp` count.

| Frame | Observable result |
|---|---|
| `muse-signin-before.png` | Generic unavailable and no-windows despite safe source note. |
| `muse-signin-after.png` | Sign-in allowance is unknown, receipt age retained, refresh limitation explained. No duplicate generic error. |
| `muse-current-after.png` | Legitimate 0% current / 99% weekly meters and last-response provenance. |
| `muse-expired-before.png` | Six-minute-old passive receipt still rendered as meters. |
| `muse-expired-after.png` | Same receipt becomes unknown, no meters/tally, age and passive refresh explanation retained. |
| `muse-empty-after.png` | No observation recorded, not invented zero usage or an invented observation time. |
| `muse-loading-after.png` | Initial loading remains a loading state. |
| `muse-error-after.png` | Query failure remains a failure state, distinct from a passive unknown allowance. |

Reproduce with lock-compatible existing dependencies, isolated `HOME` and telemetry disabled:

```sh
STORYBOOK_DISABLE_TELEMETRY=1 node node_modules/storybook/bin/index.cjs dev --ci --no-open -p 6018
```

Open `/iframe.html?id=chat-usage--muse-sign-in-unknown&viewMode=story`; sibling IDs are `muse-passive-current`, `muse-passive-expired`, `muse-no-observation`, `loading` and `query-error`. Capture with the harness browser and close it; terminate the exact owned server PID/process group. The first bounded baseline server attempt exceeded its 1.8 GB cap and was killed. The successful retry used `NODE_OPTIONS=--max-old-space-size=1400` with a 2.6 GB process-tree bound. Servers ran serially and were reaped; no shared daemon was restarted.

## Verification

- New Muse tests before implementation: 4 FAIL / 1 PASS, discriminating provenance loss, unknown age, local expiry and missing receipt.
- After: `node --test --test-force-exit --test-concurrency=1 scripts/usage-view.test.mjs scripts/usage-container.test.mjs`: **93 PASS, 0 FAIL**, 3.08 seconds.
- `pnpm check-types`: main and renderer PASS.
- Targeted `biome check` for three TS/TSX files: PASS; `pnpm lint:scripts`: PASS.
- The initial plain container test command completed its assertions but retained test-process handles and hit the 60-second outer bound. The explicit Node test-runner force-exit option is disclosed above; it does not change assertion results.
- Scope classifier selects lint/types/unit/pack and, with this evidence set, evidence. The full selected suite is delegated to CI, not duplicated locally.

The safe-note display is limited to the fixed Muse vocabulary. Unknown strings and other providers' notes never render. The same existing clock ages the card and tally after five minutes or either reset; query payloads remain immutable and no refresh, inference, account change or credential write is introduced.
