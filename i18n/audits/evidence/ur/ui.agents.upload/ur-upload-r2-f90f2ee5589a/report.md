# Urdu i18n audit — round 2

Reviewer: independent reviewer, session f90f2ee5589a; actual model openai/gpt-6.1-sol.
Scope: 2b72db6a56ad8204ec7f30a0ba6ffbc941be3b82..269ef259c0523fd61c9f40b2a700bed27b838055
Request: audit only the Urdu remediation delta, retain deferred N1, judge org_unnamed in every receiver, verify runtime bidi ownership and absence of other drift. No PR exists; no PR comment attempted.
Allocation: bounded fix/patch audit, ≤30 min.

## Verdict
clean — terminal: no new BLOCKER, MAJOR, MINOR or NIT. Prior round N1 remains deferred by design, not reopened.

- اس تنظیم is the natural oblique demonstrative noun phrase required before میں and کے. All seven receiving messages supply these postpositions rather than an extra organization noun, so no duplicated noun or case mismatch results.
- Grammatical composition checked in all seven real translate() outputs: intro.org (اس تنظیم میں), not_leaving.org (اس تنظیم کے ارکان), title.published_org (اس تنظیم میں), receipt.title_org (اس تنظیم میں), published.org_listed (اس تنظیم کے مشترک ایجنٹس میں), title.publish_org (اس تنظیم میں), ui.hub.subscriptions.enable_private (اس تنظیم میں).
- Fallback contains no manual bidi controls; all 47 Urdu upload values are control-free. Runtime translate() still applies FSI/PDI to Latin-led arguments, not to this Urdu-led fallback. Named-organization positive controls and translateRaw negative controls pass in every receiver. Existing runtime files are byte-unchanged across the delta.
- All 46 existing Urdu upload values, including target.visibility_hint_public and every target sibling, are unchanged. No other Urdu catalogue file changed. Round-1 wording N1 is retained deferred, with no correctness regression.
- Round-1 receipt is cited only for its deferred N1/history; round-2 invariants and seven runtime outputs were derived independently in this session.

## Evidence and limitations
- verify.json: independently asserted delta identity, unchanged values, runtime bytes, and catalogue controls.
- runtime.json: actual shipping translate()/translateRaw outputs for all seven receivers plus named-organization isolation controls; runtime.mjs is the executable source.
- Executed: NODE_OPTIONS=--max-old-space-size=1024 node "$LOCAL_OPERATOR_SCRATCHPAD/ur-r2-runtime.mjs" from the briefed worktree; exit 0. One Node process, shared existing dependencies, no installs or servers.
- Catalogue/composed-text audit only. No browser tool in this role, so no rendered screenshot, glyph shaping, geometry or visual-fit claim; existing rendered proof is not re-claimed.
- Model fallback disclosed: sonnet → opus → openai/gpt-6.1-sol due to quota per harness notices; all review commands ran on the final served model.
