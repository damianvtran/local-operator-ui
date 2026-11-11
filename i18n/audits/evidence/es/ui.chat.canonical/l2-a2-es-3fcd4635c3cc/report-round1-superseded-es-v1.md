# Independent translation audit — `es` — slice L2 (file sizes, chat tool row)

- **Auditor:** `i18n-auditor` (subagent), session `8cb1d5c93c95`, **actual served
  model `deepseek/deepseek-flash`** (harness-reported for this session; no
  fallback swap observed, no model pin requested).
- **Independent of the translator:** yes — translations authored by a different
  agent (`openai/gpt-6.1-sol`). This auditor did not translate, cannot edit, and
  used no translation/MT service, no back-translation.
- **Date:** 2026-11-11
- **Keys audited:** 2 of 2 in the group (every key, no sampling).
  - `ui.chat.canonical.tool.never_sent_composed`
  - `ui.chat.canonical.tool.never_sent_empty`
- **Inputs (read-only):**
  - en + context/notes: `~/local-operator-ui/.worktrees/_l2-prep/keys.json`
    sha256 `a8cd6e7d8adbc43a55bf2b812ba32eafa9f32931830e45f84b12d8ceb60ec71b`
  - target: `~/local-operator-ui/.worktrees/_l2-prep/es.json`
    sha256 `8b2dd7bcb015b2301adf0da0fb539c87d27397e17253098fe61fa3c5be75cc64`
  - style guide: `~/local-operator/i18n/style-guides/es.md` (+ `en.md`)
  - glossary: `~/local-operator/i18n/glossary.md`
  - shipped copy for consistency:
    `~/local-operator-ui/.worktrees/i18n-l2-file-sizes/src/i18n/catalogues/es/ui.chat.canonical.json`
    (258 keys; the two audited keys are the only additions, matching the en
    catalogue's 260)

## Verdict

**clean-with-findings** — counts `{blocker: 0, major: 0, minor: 1, nit: 2}`.

No BLOCKER and no MAJOR remains, so the ledger status for this group is
**`passed`**: the pair is shippable as written. The one MINOR is a
number-agreement edge that a one-line rewording removes; the NITs are judgment
calls where the translator's choice is defensible.

## Findings

### F1 — MINOR — `ui.chat.canonical.tool.never_sent_composed`

- Current: `nunca enviado · {size} redactados`
- Problem: the participle is hardcoded **masculine plural**, but `{size}` is
  produced by `formatBytes` (`src/i18n/format.ts`), which renders **exactly one
  unit** for the 1000–1049 range in every scale (`maximumFractionDigits: 1`,
  trailing zeros stripped by `Intl`). Measured in this worktree with the real
  ladder + `Intl` es unit label: a 1000/1024/1049-byte request renders
  `1 kB`, so the line reads **`nunca enviado · 1 kB redactados`** — singular
  quantity with a plural adjective, which reads as a bug to a native reader
  (cf. correct `12,4 kB redactados`, `512 B redactados`, `0 B redactados`).
  This is a grammar/agreement defect, not a meaning change: the intended
  reading (bytes of request the model had written) survives.
- Suggested (number-immune, and it also makes the pair parallel — both lines
  then use singular `redactado`):
  - `nunca enviado · {size} de texto redactado`
  - sibling unchanged: `nunca enviado · nada redactado`
  
  Alternative if the +9 characters are unwanted: keep the plural and accept the
  rare singular case (state it as a recorded decision), or drop the adjective
  for `nunca enviado · {size} redactado` — **not** recommended, since that is
  plainly wrong for the common plural amounts.
- Not a gate: the defect needs a request whose composed content lands in
  [1000, 1050) bytes of a unit, and the row truncates with an ellipsis anyway.

### F2 — NIT — `ui.chat.canonical.tool.never_sent_empty`

- Current: `nunca enviado · nada redactado`
- Problem: grammatical and unambiguous, but the bare `nada` + participle is a
  clipped shape; es status copy more often reads `sin …` (shipped siblings:
  `sin publicar`, `sin confirmar`, `entrega sin confirmar`).
- Suggested: `sin texto redactado`, or simply `sin redactar` if the 30-cell
  width matters. **No change required** — `nada redactado` pairs better with
  F1's current `redactados`, and with F1 applied (`de texto redactado`) the
  current wording still reads correctly. Choose one pair, not both halves
  independently.

### F3 — NIT — both keys

- Current: `nunca enviado` (×2)
- Problem: `nunca` pre-modifying a participle reads slightly literary as a
  status fragment; the shipped status register in this namespace is
  `rechazado` / `interrumpido` / `completado` / `no se ejecutó` / `sin publicar`.
  `no enviado` or `sin enviar` is the more usual Spanish UI shape.
- Why it is only a NIT: form matches the shipped register (masc. sg. participle
  default for a fragment with no noun), and `nunca` is the honest rendering of
  *never* — `sin enviar` would blur "never reached a tool" into "not sent yet",
  which is a meaning change the source notes explicitly distinguish. **No change
  recommended**; recorded here so the choice is deliberate, not accidental.

## Mechanical verification (all passed)

Run over both keys with `python3` (see *Commands actually run*):

| Check | Result |
|---|---|
| JSON valid, UTF-8, no BOM, newline-terminated | PASS |
| Key set identical to source (2/2), no added/dropped keys | PASS |
| `{size}` present exactly once in `never_sent_composed`, absent in `never_sent_empty`; placeholder names/types identical | PASS |
| No ICU plural/select introduced (neither key needs one; both are plain messages, so no CLDR category obligation) | PASS |
| Markup / Rich tags / backtick code / commands / flags / identifiers | none in source, none added — PASS |
| Empties, English-identical values, leading/trailing whitespace, control characters | PASS (0 issues) |
| Middle dot U+00B7 as separator, exactly one per value, single spaces either side (matches shipped `falló · {code}`, `· Trabajo {id}`) | PASS |
| No English residue after locale switch (operator acceptance): both lines fully Spanish; `B`/`kB` are CLDR unit symbols from `Intl`, not catalogue English | PASS |
| Trailing punctuation / sentence case | PASS — no trailing stop (es guide: terse fragment), lowercase fragment |
| es punctuation rules: no space before `:`/`;`/`?`/`!` (fr-only rule not applicable); no `¡`/`¿` needed (not a question/exclamation) | PASS |
| Width (raw template cells, `{size}` counted as 6): line 1 en 28 → es 33 (+5, +18 %), line 2 en 29 → es 30 (+3 %), inside the guide's 15–25 % es growth allowance; no `maxCells` numeric budget in the sidecar, row truncates by design | PASS |
| RTL | N/A (es) |
| Glossary terms | none of the §2 terms appear in either string; no newly coined term needing a row |

## Considered and rejected (no finding)

- **`redactados` reads as "proofread/edited".** No: es `redactado` = drafted/
  written; there is no redaction-ambiguity in Spanish.
- **`{size} redactados` is a calque of "N composed".** No: `5 GB usados`,
  `12 MB descargados` is established Spanish UI usage for a measured quantity;
  the adjective agreeing with the implied unit noun is idiomatic.
- **Word-order calque of `never sent · X`.** No: both halves are re-orderable
  Spanish, and the `·` separator is a catalogue-wide convention here, not
  English syntax.
- **`nunca enviado` vs the row's tool name colliding.** The row supplies the
  tool name; the fragment carries no noun, so no agreement target is visible —
  this is exactly the shipped pattern (`rechazado · {code}`).

## Second pass (high-visibility group)

The chat transcript tool row is user-visible but not one of the named
high-visibility groups (onboarding, errors, settings). A second read-through of
every key was still performed after the mechanical pass; it produced no
additional findings and confirmed F1's measured singular case. If the manager
wants an independent second auditor for this group, that round is still
outstanding — this report is one auditor's pass.

## Commands actually run

```
# inputs
ls -la ~/local-operator-ui/.worktrees/_l2-prep/
cat ~/local-operator-ui/.worktrees/_l2-prep/keys.json
cat ~/local-operator-ui/.worktrees/_l2-prep/es.json
cat ~/local-operator/i18n/style-guides/es.md        # + en.md head
cat ~/local-operator/i18n/glossary.md

# shipped-copy consistency (es catalogue, 258 keys; en 260)
python3 -c "...json scan of src/i18n/catalogues/{en,es}/ui.chat.canonical.json..."

# mechanical checks (python3, over both keys)
#   key set / placeholder multiset / empties / en-identical / ICU scan /
#   U+00B7 count + position / control chars / non-basic chars / length
python3 - <<'PY'  ... (checked: 2 source keys, 2 target keys, key set equal,
  placeholders ['size']==['size'] count 1, U+00B7 x1 each, no control chars,
  no non-ASCII beyond U+00B7, len 33 / 30)  PY

# singular-size proof (Node 24.22.1, es):
node -e 'Intl.NumberFormat("es",{style:"unit",unit:"kilobyte",unitDisplay:"narrow"})'
        -> unit label "kB"; separator (short style literal) " "
node -e '<formatBytes ladder replayed for es>' -> 0 B / 512 B / 1 kB / 13 kB
        => "nunca enviado · 1 kB redactados"   (F1 evidence)

# hashes
shasum -a 256 keys.json es.json

# repo catalogue gates in the audit's worktree (context only — the two es keys
# are NOT yet in that catalogue, so these gates cannot validate them; they ran
# clean on the tree that will receive them)
node scripts/i18n/context-parity.mjs
  -> context-parity: ok — every English key is covered, apart from 129
     allowed gap(s) in 4 namespace(s)
node scripts/i18n/check-duplicates.mjs
  -> check-duplicates: ok — 1428 file(s) scanned, 0 duplicate key(s)
```

No ledger row and no ledger/evidence write was performed by this auditor: this
slice is report-only, and the evidence bundle for the canonical
`i18n/audits/evidence/<locale>/<namespace>/<audit-id>/` root belongs to the
catalogue commit that ships the keys. Record-shaped metadata for that bundle is
in the appendix so the manager can embed it verbatim.

## Appendix — record metadata for the eventual evidence bundle

```json
{
  "locale": "es",
  "namespace": "ui.chat.canonical",
  "audit_date": "2026-11-11",
  "key_count": 2,
  "auditor": {
    "agent": "i18n-auditor",
    "session": "8cb1d5c93c95",
    "model": "deepseek/deepseek-flash",
    "independent_from_translator_session": true,
    "translator_model": "openai/gpt-6.1-sol",
    "actual_model_source": "harness session header (no fallback applied)"
  },
  "input_hashes": {
    "en": "a8cd6e7d8adbc43a55bf2b812ba32eafa9f32931830e45f84b12d8ceb60ec71b",
    "context": "a8cd6e7d8adbc43a55bf2b812ba32eafa9f32931830e45f84b12d8ceb60ec71b",
    "es": "8b2dd7bcb015b2301adf0da0fb539c87d27397e17253098fe61fa3c5be75cc64"
  },
  "current_report_verdict": {
    "status": "clean-with-findings",
    "ledger_status": "passed",
    "unresolved_blocker_major_count": 0,
    "finding_ids": ["F1", "F2", "F3"]
  },
  "audit_notes_not_execution_log": false
}
```
