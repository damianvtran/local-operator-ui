# Browser tab client hints (Google "This browser or app may not be secure")

Measured 2026-11-07 on macOS 27.2 arm64. Electron 45.1.0 / Chromium 156.0.8078.49
(live app 0.52.1 and this branch's built tree) against Google Chrome
156.0.8078.81 on the same machine.

## What was measured, and where

Everything below comes from `harness/probe-server.mjs`. It is a loopback page that echoes the
document request's `User-Agent`/`Sec-CH-*` headers, sends `Accept-CH` and
`Critical-CH`, and has the page POST its own `navigator` facts back. The POST
request's headers are recorded too, so subresource hints are visible as well.
Each line of `readings.jsonl` is one load, keyed by `label`.

Shapes: `live-app*` is the operator's installed app, an agent-opened tab through
the harness `browser` tool. `built-before-*` / `built-after-*` are this branch's
tree before and after the fix, on a scratch profile in headless mode, driven by
`scripts/browser-identity-proof.mjs` through the agent path (`/rpc` open) and the
human path (`newTab` + `navigate`). `chrome-*` is real Chrome headless with
`--use-mock-keychain`. The first two `live-app` / `chrome-headless` lines predate
the subresource-header and two-detector columns.

| surface | live 0.52.1 | built before | built after | Chrome 156 |
|---|---|---|---|---|
| UA string | `Chrome/156.0.0.0`, no Electron | same | same | `HeadlessChrome/156.0.0.0` (headless) |
| document `Sec-CH-UA*` | **absent** | **absent** (agent + human) | `"Not:A-Brand";v="8", "Chromium";v="156"`, `?0`, `"macOS"` | GREASE + Chromium + Google Chrome |
| high-entropy after `Accept-CH` | **never sent** | **never sent** | sent on following requests (full-version-list, platform-version 27.2.0, arch arm, bitness 64, …) | sent (Critical-CH retry on the first document) |
| subresource `Sec-CH-UA` | Chromium 2-brand | same | same (unchanged; the renderer's own) | 3-brand |
| `navigator.userAgentData.brands` | Not:A-Brand 8, Chromium 156 | same | same | + Google Chrome 156 |
| `navigator.webdriver` | false | false | false | false |
| Runtime.enable page detectors (Error.stack getter, Proxy trap) | false | false | false | false, **including with a CDP client that enabled Runtime**, so these detectors are inert on 156 |
| `chrome.app` / `csi` / `loadTimes` | undefined | undefined | undefined | object / function / function |
| `Notification.permission` | denied | denied | denied | default |
| WebAuthn UVPA / conditional mediation | true / true | — | — | — |

Codesign (read-only): `/Applications/Local Operator.app` is Developer ID
Radient Inc. (SHA2U6KT7V), with the hardened runtime flag. `spctl` answers
`accepted, source=Notarized Developer ID`. Not a signal.

CDP route (`--experiment-cdp-ua`, labels `*-cdp-metadata`): an extra CDP client
set `Emulation.setUserAgentOverride` with "Google Chrome" metadata. JS brands and
subresource headers gained Google Chrome. Document requests still carried
no `Sec-CH-UA`. That is why the fix is at the session network layer, and why it
presents the engine's own brand list (see `src/main/browser/client-hints.ts`).

## Google identifier arms (identifier only, never a password)

| # | shape | outcome |
|---|---|---|
| 1 | built before, scratch profile, agent path | accepted: password step ("Hi <account name> / Enter your password") |
| 2 | live 0.52.1, operator profile, account chooser click | already signed in: landed in Gmail |
| 3 | built after, scratch profile, agent path | accepted: password step |
| 4 | remediation head + rig with `--use-mock-keychain` (round 1 R1-1), scratch profile, agent path | accepted: `/v3/signin/challenge/pwd` ("Welcome / Enter your password") |

Arms 1 and 3 ran BEFORE the rig passed the mock-keychain switch, so their scratch
cookie store could not encrypt (review round 1, R1-1); arm 4 is the one re-measured
with it. Its outcome is the same.

The refusal did not reproduce on 2026-11-07 in any shape, before or after,
so this evidence does not show that the operator's refusal is fixed. It shows
that the one measured inconsistency is gone and that nothing regressed.

## Accept-CH scoping (round 1 remediation, S1-1 / R1-2 / Q1 / Q2)

Labels `r2c-*` in `readings.jsonl`: two probe instances on ports 47811 and 47812
(two origins). The remediation head (its `src/` built), built, headless, agent path:

```
node docs/evidence/browser-client-hints/harness/probe-server.mjs 47811 out.jsonl &
node docs/evidence/browser-client-hints/harness/probe-server.mjs 47812 out.jsonl &
node scripts/browser-identity-proof.mjs --app-tree . --scratch <s> --mode agent \
  --url "http://127.0.0.1:47811/?xo=http://127.0.0.1:47812#r2c-agent-first" \
  --then "http://127.0.0.1:47812/?second#r2c-agent-second-origin"
```

| request | low entropy | high entropy |
|---|---|---|
| :47811 first document (no opt-in yet; no Critical-CH restart) | yes | 0 |
| :47811 same-origin POST after its document's Accept-CH | yes | 8 |
| :47812 `/subac` + `/echo`, third party under the opted-in :47811 top level | yes | **0** |
| :47812 document after its `/subac` SUBRESOURCE sent Accept-CH | yes | **0**, so the subresource opted nothing in |
| :47812 same-origin POST after its own document's Accept-CH | yes | 8 |

On `1a579a1`, QA measured both leaks: b5 (third party got 8) and b6
(a subresource opt-in carried over to the next document).
