# Onboarding value clarity — implementation evidence

Source commit: `c6869d8d800518f547da5efa7c6b99620b80dd21`.
Base: `8d2a113b250d5977c67ea2fc963ff6b94a76202e`.

## Scope and status

The request was to make Radient's current benefits and bring-your-own account/model choices equally clear, while making Team-gated surfaces explain the plan and offer a quiet route to it. No banners, onboarding Team promotion, price/version change, or trial activation was added.

Paths below are relative to `src/renderer/src/` unless otherwise stated.

| Finding | Status | Change site / reason |
|---|---|---|
| U1 | Implemented | `src/i18n/catalogues/en/ui.onboarding.json:2` and `ui.providers.json` key `provider_catalog.one_browser_sign_in_nothing_to_paste`: short, factual benefits; conditional credit; Claude/ChatGPT subscriptions, API key and computer-hosted models remain explicit. All eight locales updated. |
| U2 | Implemented | `features/team-bridge/team-bridge-page.tsx:530-636`; account-level reason works without an organization; secondary plan action opens pinned `subscribeUrlFor(null)`. `teamBridgeGateAction` in the trial model withholds it when trial starts are enabled. The release constant itself remains off. |
| U3 | Implemented | `features/team-bridge/team-bridge-page.tsx:609-619`; secondary “Sign in to Radient” router link goes to `/settings?section=radient`, where the existing sign-in control is owned. |
| U4 | Implemented | `features/agent-hub/agent-hub-page.tsx:1403`, `components/org-teams-list.tsx:373`; `features/agents/utils/publication-failure.ts:561-586`; upload dialog `:1093`. Plan-only console actions retain Retry, target the relevant organization, and use the generic console destination when several blocked organizations exist. Org pull treatment honors the new action too. |
| U5 | Implemented | `features/chat/components/composer-suggestions.ts:97-131`: pinned head is create team, review repo/open PR, schedule mornings, wake with summary. Existing tail retained. |
| U6 | Skipped by its verification condition | Targeted core reads of `local_operator/web_search/providers.py`, `service.py` and registration/native-tool neighbors did not establish that Radient sign-in supplies setup-free search. No Radient-specific search claim was added. This is not a claim that search is unavailable: credential-free search is already the onboarding default. |
| U7 | Implemented | `features/providers/provider-catalog.ts:382`, `provider-grid.tsx:581,1139`: only featured onboarding rows use account names (Claude/ChatGPT), including tile and accessible action name. Other provider surfaces retain company brands. |
| U8 | Implemented with verified items only | Catalogue plan references normalized to “Radient Team plan”; generic agent Teams labels unchanged. Settings account line at `features/settings/components/radient-account-section.tsx:197` lists Team Bridge and organization-shared agents/teams, with a plan link. Pooled credits omitted: not verified in this product slice. |
| U9 | Implemented | `src/i18n/catalogues/en/ui.onboarding.json` key `search.mode.free_detail`, and seven translations: describes free shared search, no key and busy-time slowness, without vendor names. |

## Claim verification

| Candidate claim | Proving source / disposition |
|---|---|
| One browser sign-in, no existing subscription/API key needed; many models | Core `README.md:138-148` at `b42471d3935`; UI provider method definitions and existing Radient auth flow. Used “many”, not “hundreds”. |
| Hundreds of models | CUT: existing UI copy says it (`ui.chat.json:105`) but no current count was derived. |
| Conditional free credit | Radient site immutable `49bbd5b:src/components/home/credit-offer.tsx:126-129,140-142`: eligible new accounts, after email verification **and a security check**. No amount or unconditional offer. |
| Dictation | Core `local_operator/clients/stt.py:23,109-113,268` at `b42471d3935` names the shipped Radient adapter; UI `ui.common.errors.json:36-37` distinguishes Radient credit and sign-in refusals. Used. |
| Voice/speech aloud | UI `ui.common.errors.json:46-51` has the Radient sign-in/credit path. CUT from intro for brevity; only dictation named. |
| Web search included with Radient sign-in | NOT PROVED by bounded search; CUT from U1 and U6 skipped. A legacy tour sentence was not treated as sufficient backend proof. |
| Phone access | UI `ui.providers.json:4,14`: paid monthly tunnel subscription. CUT from intro rather than imply it is free. |
| Agent sharing / Agent hub | UI `ui.hub.pages.json:42-43` explains the Radient credential gate; `ui.hub.links.sign_in_to_publish` in `ui.hub.json`; upload dialog offers public and organization targets. Used generic “agent sharing”, not a claim that organization sharing is free. |
| Team Bridge + organization-shared agents/teams | `ui.teamBridge.plan.title`; `publication-failure.ts:561-573` and `ui.hub.teams.org.plan_body` explicitly gate these on the plan. Used in Settings. |
| Pooled credits | CUT: not verified in this UI/product slice. |

## Targeted checks (actual execution)

Every command was scoped to changed code; no whole suite or check-changed run. Final commands used `NODE_OPTIONS=--max-old-space-size=768`; typechecks were serial.

`node --test --test-concurrency=1 scripts/<name>.test.mjs`:

| name | tests | pass | fail | skipped |
|---|---:|---:|---:|---:|
| composer-suggestions | 9 | 9 | 0 | 0 |
| provider-catalog | 16 | 16 | 0 | 0 |
| provider-grid-pin | 18 | 18 | 0 | 0 |
| team-bridge-trial | 29 | 29 | 0 | 0 |
| team-bridge-directory | 51 | 51 | 0 | 0 |
| agent-hub-org-sharing | 37 | 36 | 0 | 1 |
| onboarding-i18n-contract | 17 | 17 | 0 | 0 |
| onboarding-search-step | 7 | 7 | 0 | 0 |
| agents-publication | 18 | 18 | 0 | 0 |

`pnpm run check-types:main` and `pnpm run check-types:renderer`: exit 0, actual tails `$ tsc --noEmit -p tsconfig.node.json` and `$ tsc --noEmit -p tsconfig.app.json`.

Touched-path `node node_modules/@biomejs/biome/bin/biome check --write <20 touched code/test paths>`: exit 0, `Checked 20 files in 367ms. Fixed 3 files. Found 90 warnings.` Those formatting fixes are in the source commit; warnings are existing whole-file lint debt, not hidden failures.

Final read-only i18n gates before receipt integration: generator byte-identical; duplicates `1392 file(s), 0 duplicate key(s)`; strings `1629 file(s), 0 literal(s) at or below baseline`; context `129 allowed gaps in 4 namespaces`; added strings `PASS ... 12 changed files`; coverage `7 gated languages,154 namespaces,0 missing allowed keys`. Each exit 0. Ledger was intentionally stale pending independent audits (`192 findings across1078 entries`); integration and its terminal result are recorded in the separate ledger commit.

## Rendered evidence and limitations

`after/` contains all twelve inspected browser-tool screenshots: `step1`, `step2`, `step3`, `radient-row`, `signed-out`, `plan-required`, each in light and dark. Native screenshot dimensions are 2560×1440; browser body geometry was 1280×720 CSS pixels. No browser engine was installed or scripted. These are real Storybook component renders with synthetic transports/data, **not** a live backend, billing purchase, auth hand-off or trial activation test.

Story IDs: `onboarding-providersetup--in-dialog` (Radient detail reached by clicking its row); `provider-sign-in-onboarding--onboarding-step-2-applied`; `provider-sign-in-onboarding--onboarding-step-3`; `team-bridge-page--signed-out`; `team-bridge-page--plan-required`. Theme URL argument: `theme:localOperatorLight` / `theme:localOperatorDark`.

Before matrix: **BLOCKED, no valid baseline frames**. A full archive hit the session scratchpad cap; the replacement source-only archive omitted `scripts/entry-point.mjs`, then `i18n/languages.json`. Both prerequisites were restored from the immutable base. Before a valid baseline frame could render, the parent machine-memory guard killed the before server allocation (PGID33018, child33057), and navigation returned `ERR_CONNECTION_REFUSED`. The bounded lane was stopped rather than retried. The blank scratch `before/step1-light.png` is not evidence and is not included here. Consequently this report does not claim before/after comparison or native app proof.

The after server97985 and before child33057 were confirmed absent by `kill -0`; the active session-owned browser tab was closed. Prior allocation's tab was not adopted/closed after ownership refusal. One server at a time; isolated HOME, inherited CMUX variables stripped, no keychain-capable browser rig.

## Independent translation audit integration

Nine namespaces × seven non-English locales =63 rows: `{es,fr,hi,ru,ur,vi,zh-CN}` × `{ui.agents.publication,ui.agents.upload,ui.hub.pages,ui.hub.teams,ui.onboarding,ui.providers,ui.settings.account,ui.teamBridge,ui.teamBridgeTrial}`. Both independent auditors cover all nine; source/target/context bytes remain frozen at the source commit. Fourteen immutable receipts are copied by the assembler under `i18n/receipts/`.

Audit1 reviewer session909a2c50a0bd/model `anthropic/claude-fable-5-2`; audit2 UX-reviewer session4342cfd05d3c/model `anthropic/claude-opus-5-5` (actual identities/models declared in each receipt). Translator: coder session4d5802c5f0fc, `anthropic/claude-fable-5-2` drafts and `openai/gpt-6.1-sol` final intro after fallback. Resumed capture work served `anthropic/claude-fable-5-2`. No role/profile/config pins changed.

Minor/nit IDs deliberately deferred by manager after clean audits (no catalogue churn): ES-1, ES-2, RU-1, RU-2, RU-3, VI-1; A2-es-1, A2-ru-1, A2-ru-2, A2-ru-3, A2-zh-CN-1 (last is pre-existing). Exact wording/suggestions and counts remain in receipts. No blockers/majors were reported by either translation audit. This is translation sign-off, not the independent code/QA/design/UX PR gate.

### Receipt assembly and terminal check

The assembler was run serially for each namespace in each of the fourteen receipts (126 audit assemblies). It copies receipt bytes unchanged and derives hashes/counts from the actual source, target and receipt files. Per row, use the receipt's own locale, instance, model and namespace result:

```sh
NODE_OPTIONS=--max-old-space-size=768 node scripts/i18n/ledger-assemble.mjs \
  --locale <locale> --file src/i18n/catalogues/<locale>/<namespace>.json \
  --auditor-instance <receipt-file-stem> --auditor-model <receipt-auditor-model> \
  --result <namespaces.namespace.result> --receipt <immutable-receipt-path> \
  --date 2026-11-09 --scope '8d2a113b250..c6869d8d800 changed keys; unchanged translations retained'
```

After the first audit was recorded on each of the 63 now-fresh rows, the same command was run with `--update-translator --translator-agent coder --translator-model 'anthropic/claude-fable-5-2 drafts; openai/gpt-6.1-sol final intro (fallback)'` and a translator-session note. The assembler refuses this correction on stale rows or without the existing immutable audit anchor. The second independent audit was then assembled. All fourteen copied receipt files were compared byte-for-byte with their originals.

Actual terminal output:

```text
ledger-check: ok — 1078 entr(ies) complete, fresh and independently audited
.../src/i18n/keys.gen.ts is byte-identical to a fresh generation.
```

Both commands exited 0. Catalogue source/target/context files and generated keys stayed byte-identical to `c6869d8d800`. There are no remaining stale rows in this slice.

