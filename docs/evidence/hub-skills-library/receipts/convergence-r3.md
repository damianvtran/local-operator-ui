# R3: SHA-preserving convergence after #1101

Implementer: coder lineage, actual served model `anthropic/claude-sonnet-5-5`.
Old head: `0a8ea9d440ab09188c80f35254b490d82cbd4886`.
Fetched main: `422df121756df2f5e7348e4289a04256661edb9f`.
Merge base: `b179da8e2198beffa37195d84111206ea60ea6f0`.

## Resolution and retained task content

- Only overlapping paths: `package.json` and `docs/evidence/manifest.json`. Real merge conflict resolution, no rebase, history rewrite, product fix or version bump.
- Package is exact upstream text with precisely our two added registration tokens: `scripts/hub-skills-capability.test.mjs` and `scripts/hub-mutation-safety.test.mjs`. All456 upstream command tokens retained;458 merged; no duplicates/removals. See `convergence-r3-package.json`.
- The manifest merge driver resolved its field conflict; `node scripts/evidence-fold.mjs` re-derived the actual merged tree, exit0. Counts:13999 sweep frames /1728 surfaces /12 themes,597 inside and874 outside supplementary sets. Incoming browser evidence accounts for the33 extra outside frames. Citation ancestry stood down for the shallow clone: no ancestry pass claimed.
- All274 other pre-existing PR file patches, including their exact added/removed lines and hunk headers, match old `b179..0a8` versus merged-index `422df..index`. See `convergence-r3-patch-proof.json`; both resolved exceptions have their full old/new +/-line sets in `convergence-r3-resolved-line-sets.json`.
- Old commits remain reachable verbatim through the merge's first parent. The final-head `git range-diff --no-color b179da8e..0a8ea9d4 b179da8e..HEAD` and normal-hook push output are recorded after this single commit in `$LOCAL_OPERATOR_SCRATCHPAD/convergence-r3-range-diff.log` and `convergence-r3-push.log`; their observed outcomes accompany the handoff, not an invented pre-commit result.

## Captured surface and semantic compatibility

`convergence-r3-painted.json` compares all143 named painted dependencies against **0a8**, not an obsolete earlier fixture:143/143 identical. This covers Hub/Agents page, library, detail/publication, hooks, policy/consent primitives, layout, CSS/themes and consumed Hub locale. All five remediation product paths are unchanged, including generated keys. `convergence-r3-frames.json` independently proves all80 committed own PNGs byte-identical. These are retained file hashes, not claims of deterministic re-rendering.

The broader existing1157-file import overapproximation is NOT byte-identical:14 paths changed. `convergence-r3-closure.json` records every before/after hash; `convergence-r3-summary.json` records the complete114 incoming paths. All17 incoming `src/` paths and hashes, including the two new browser modules, appear in `convergence-r3-upstream-src.json`. No Hub API, desktop backend-status contract, Hub/shared mutation/query module or locale namespace changed.

Semantic boundaries, verified from the actual incoming source:
- `src/main/index.ts` and `src/main/browser/{browser-chord,electron-types,host,index,ipc,page-controls}.ts`: browser find/zoom plumbing. `routeBrowserZoomInput` requires a classified `zoom-*` primary-key intent; the router requires owned chrome/page focus. Space/Tab/Enter used by our consent/focus scenes are not those intents. Existing fresh-MAIN mutation, push-wins and identity guard code remains untouched.
- `src/preload/index.ts` and `index.d.ts`: additive browser-only `pageControl` IPC exposure; no replacement of the local-operator API contract or Hub payloads.
- Browser surface, URL bar, find row and chrome/chord hooks: find is browser-projected state; the new focus effect returns when no find `tabId` exists. Our isolated scenes navigate Hub/Agents and do not open browser find or zoom. No general Hub/dialog focus handler was added.
- `src/shared/browser-chord.ts` and shared `keymap-{chord,registry}.ts`: primary+F/zoom routing/reservations, including retained dormant primary+0 custom bindings. The capture driver uses scratch HOME/user-data profiles, not the user's custom bindings; captured interactions do not send primary+0/zoom. Keymap retention/dispatch and browser input neighbors were exercised below. This is scoped fixture compatibility, not a blanket claim that arbitrary browser/custom-binding workflows are unchanged.

No captured product invalidator was found. No build, new native run or recapture was performed. The existing compiled artifact is still the old-head artifact; it is not presented as a new merge-head binary.

## Gates and limits

- Node22.13.1, one serial targeted group with4096MiB heap/6144MiB watchdog:442 tests,441PASS,0FAIL,0CANCEL,1SKIP,37.74s. Included mutation safety, Hub scene/capability/view/updates, incoming browser host/chrome/chord/find/page controls, keymap grammar/registry/dispatch/retention and evidence-manifest guards. See `convergence-r3-targeted.log`.
- `node scripts/i18n/generate.mjs --check`: byte-identical; no regeneration. `node scripts/i18n/ledger-check.mjs`:3 complete/fresh/independently audited entries.
- Package rule lint passes. An extra whole-package formatter check fails on upstream's existing two-space style; exact upstream stdin control also fails. No formatting fix applied: retaining upstream text is intentional. Normal repo pre-push scripts/source lint and serial types remain unbypassed; actual result is in the handoff.
- Resolved package/manifest whitespace check passes. Broad whole-history whitespace checks also flag preserved raw logs and upstream's embedded `source-delta.patch`; that patch is byte-identical to incoming main. Neither forensic artifacts nor unrelated styles were rewritten.
- Targeted admission: Data23924732KiB, swapFREE1677.88MiB, memoryFREE56%; see `convergence-r3-resources.json`. Normal push has its own fresh admission in the session log.
- No full suite (CI owns it), PR comments, PR merge, release, installs, root-worktree changes or other sessions' untracked-file edits.
