# Independent Hindi transcript audit — round 1

Verdict: **clean**. BLOCKER 0 · MAJOR 0 · MINOR 0 · NIT 0.

Repository: damianvtran/local-operator-ui. Branch: i18n/slice-transcript.
Head: `2cf1ea7b5fd95b85d6c8bfaa264f6bd3c4e5c3b9`; base: `6031bc9ad71e1b9fc83e0d1a9714e52a19301913`.
Auditor: reviewer, session `ab2f2fb6eeff`, actual model `openai/gpt-6.1-sol`.
Provider quota fallback: sonnet-5-5 → opus-5-5 → gpt-6.1-sol. Did not author these translations.
Budget: narrow audit / hotfix, ≤30 minutes. Scope: eight transcript keys and one publication fallback; no code redesign, no whole-namespace verdict.

## Linguistic findings and positive checks

- **Duration and non-success semantics — PASS.** `काम किया` acknowledges work performed without duration. `{duration} तक काम किया` adds the elapsed interval naturally before `तक`. Neither claims `सफल` or completion of the task; the verb phrase describes working, not “it worked” in the sense of a successful outcome. Source call site chooses the duration form only when `foot.durationS !== null`, and supplies `formatDuration(foot.durationS)` unchanged.
- **Demonstrative agreement — PASS.** Actual notices are `इस उत्तर का पहले का पाठ स्क्रीन पर नहीं है` and `इस उत्तर का कुछ हिस्सा गायब हो सकता है`. `इस` is the correct oblique demonstrative before masculine singular `उत्तर` with the genitive postposition. Masculine singular `पाठ` and `हिस्सा` take `का`; first notice ends `है`, second `हो सकता है`. No plural `इन` or feminine `की` mismatch. `पहले का पाठ` is somewhat longer than an alternative like `पहला पाठ` but correctly means earlier text, not the first text; no correction warranted.
- **Sibling consistency — PASS.** Existing `transcript.credential_lost` begins `इस उत्तर में ...`; `transcript.no_answer_given` uses `उत्तर`. Existing `missing_session` has feminine `यह बातचीत ... है`, and its detail `यह किसी ऐसी मशीन की है`; these different gender/possession constructions do not justify changing `इस उत्तर का`. Implementation at canonical-transcript.tsx:1974–1978 renders the two new notices as alternatives of one truncation conditional, not simultaneously stacked notices. Their paired wording nevertheless agrees.
- **Vocabulary — PASS.** New `रोका गया` exactly matches `tool_row.outcome.interrupted`; `नहीं चला` is the same negative past construction as existing `tool_row.outcome.never_ran` = `कभी नहीं चला`, omitting only the emphasis “ever.” For a status label this retains “not executed,” not a success verdict. `उत्तर` matches existing transcript notice vocabulary (other surfaces use `जवाब`, not a defect within this narrow scope). `जॉब` appears in existing fold count/receipt strings and matches the Hindi style guide/glossary.
- **Placeholder and separator contracts — PASS.** All nine keys checked against English. Only `worked_for` has `{duration}`; only `job_suffix` has `{id}`. Names and multiplicity exact; other seven keys have no placeholders. Job value is exactly `· जॉब {id}` (U+00B7 middle dot), with preceding inter-fragment space supplied by the call site.
- **Publication fallback — PASS.** `एजेंट प्रकाशित नहीं किया जा सका। फिर कोशिश करें।` is natural, calm, concise Hindi: inability to publish followed by polite retry imperative. It preserves both English sentences and Hindi danda punctuation. The dialog catch path uses it only as the untyped exception fallback.
- **English/bidi residue — PASS.** Scanned all nine values after removing permitted placeholders: no Latin prose, bidi marks/overrides/isolates, or unintended English residue. Devanagari loans `स्क्रीन`, `जॉब`, `एजेंट` are natural UI vocabulary. Runtime placeholder substitutions were not altered or audited.

## Evidence and limitations

Derived directly from `git diff 6031bc9ad71e1b9fc83e0d1a9714e52a19301913..2cf1ea7b5fd95b85d6c8bfaa264f6bd3c4e5c3b9`, the frozen on-disk English/Hindi catalogues, English context sidecars, and changed renderer call sites under `src/renderer/src/features/`. Reference policy read: local-operator repository `i18n/style-guides/hi.md` and `i18n/glossary.md`; Hindi job policy explicitly endorses `जॉब`. Full byte SHA256s and exact audited pairs are in record.json. Python assertions checked identity, placeholders, literal middle dot, notice prefixes/endings, sibling interrupted equality, never-ran consistency, and residue scan. All passed.

No browser tool in this role: no rendered-frame or layout/overflow claim. No test suite or Node process started (shared host memory guard respected). No PR exists per brief: no PR lookup or comment attempted. Only own receipt and evidence written; no product edits or commits.
