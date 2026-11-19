# i18n audit — fr — namespace `ui.chat.canonical` (combined bytes, PR #1861 rebased on #1862)

```
locale:      fr
namespace:   ui.chat.canonical (src/i18n/catalogues/fr/ui.chat.canonical.json)
audit_id:    au-1861-fr
auditor:     i18n-auditor (agent), independent of the translators
session:     60da9ca1b9fc
model:       deepseek/deepseek-flash   (ACTUAL served model, from this session's harness state;
             no fallback used, no model pin requested by me)
date:        2026-11-11
subject:     git commit 659ef7e44b7c (branch cand-rebased-unaudited),
             worktree /Users/damian/local-operator-ui/.worktrees/i18n-l2-file-sizes
             read read-only via `git -C ... show 659ef7e44b7c:<path>`; nothing checked out,
             no install/build/test/generator run.
input_hashes:
  en:      src/i18n/catalogues/en/ui.chat.canonical.json
           sha256 38f1069648c9241799bb1b316820e0530bf9445dfba3151e1c28df70153916b3
  context: src/i18n/catalogues/en/ui.chat.canonical.context.json
           sha256 c258ab485de698eec85e81ffed506866e3b1e8caf29cb3ff434901388065b390
  fr:      src/i18n/catalogues/fr/ui.chat.canonical.json
           sha256 cea935cd4e6ba5627ffe19b4b129d4dd7f0ef60b3e8de96fa0bc1a48ca6249f1
key_count:   442 (en 442 / fr 442, identical key sets)
delta vs origin/main (87eec8192818): 2 added keys in this namespace
  ui.chat.canonical.tool.never_sent_composed  "jamais envoyé · texte rédigé : {size}"
  ui.chat.canonical.tool.never_sent_empty     "jamais envoyé · aucun texte rédigé"
verdict:     clean-with-findings
severity:    BLOCKER 0 · MAJOR 0 · MINOR 6 · NIT 3
ledger:      auditor result clean-with-findings, status audited (no blocker/major) — row to be
             written by the manager via `node scripts/i18n/ledger-assemble.mjs`; I am read-only
             and did not touch i18n/ledger.json.
```

Scope note on "the file-size keys": the size spelling itself is **not** in this
catalogue. `be4b470aa32` moved unit symbols/separators into
`src/i18n/format.ts::formatByteQuantity` (Intl/CLDR, no table, no keys). The
size-related *copy* added to this namespace is exactly the two `tool.never_sent_*`
keys above, which take `{size}`. So the delta I audited is those two keys; the
unit symbols are audited by inspecting the formatter, below.

## 1. Mechanical (all 442 keys)

Computed here in python over the `git show` blobs (not by the repo gate — see
"what I did not run"). Method mirrors `scripts/i18n/locale-parity.test.mjs`
(which I read at the audited commit) plus the extra type/skeleton and
CLDR-category checks this brief asks for.

| Check | Result |
|---|---|
| Valid JSON, parses | PASS (both files) |
| Key set equals English, no added/dropped/duplicate key | PASS 442/442 |
| Key ORDER identical to English | **one positional deviation** (NIT-3 below); the generator sorts (`generate.mjs:197` `Object.keys(data).sort()`), so on-disk order is not functional |
| Placeholder names per key (nested plurals/selects walked) | PASS 442/442, same name set |
| Placeholder TYPE / ICU skeleton per key (`{count, number, ::group-off}` etc.) | PASS — 0 mismatches (a naive brace scan shows 3 false positives because `{count, number, …}` sits inside a `#`-less arm; the recursive parse shows identical signatures) |
| Plural/select structure valid, all CLDR categories for fr (`one`/`many`/`other`) and no `few` | PASS on 56 of 58 plural messages; 2 messages carry `one`/`other` only → NIT-1 |
| Markup / `<Trans>` tags, backticks, code spans, flags, identifiers untouched | N/A-no tags in this namespace; the only literals are the `·` separator and punctuation, byte-identical where English-equal |
| Empty values | none |
| English-identical values | 7, all allowlisted in `scripts/i18n/locale-parity.test.mjs` `IDENTICAL_OK` with a reason: `image_label` ("Image", fr cognate, fr-scoped); `fold.count.named` (`{count} {name}` — machine token); `fold.unit_separator` (" · "); `fold.sentence.join` (`{first}, {second}`); `tool_row.bridge.summary.count` (`({count, number, ::group-off})`); `tool_row.bridge.detail.headline.target` (`{verb} {target}`); `supplement.withheld.reason_separator` (", "). No unlisted English value. |
| NFC normalisation | PASS (no value differs from its NFC form) |
| Stray spaces (leading/trailing, doubles, space before comma, ASCII quotes/apostrophes) | PASS; the two edge-space values (`reason_separator` ", ", `unit_separator` " · ") are deliberate separators and identical to source |
| French typography: U+202F before `: ; ! ?`, U+2019 apostrophe, « » spacing, `…`, spaced em dash | PASS — every prose colon/`;`/`?` uses U+202F (0x202F) and there is no ASCII apostrophe or ASCII quote in the file |
| Leftover English in values | none (prose scan for English function words: 0 hits) |
| RTL | not applicable (fr) |

### Unit symbols — what I verified vs inferred

- **Verified by reading the code**: `.worktrees/.../src/i18n/format.ts` derives the
  symbol from `Intl.NumberFormat(locale, {style:"unit", unitDisplay:"narrow"})`
  (`fileSizeUnitLabel`) and the number↔unit glue from the SHORT kilobyte pattern
  (`fileSizeSeparator`); English is pinned to ASCII and `KiB/MiB/GiB` stay
  standard spellings. Digits, decimal mark, grouping and unit therefore follow
  CLDR for fr automatically — the catalogue holds no unit string to mistranslate.
- **Verified by measurement** (one `node -e` query of the local ICU 78 /
  CLDR 48 data, Node v24.22.1 — platform query only, no repo script, no install):
  fr narrow symbols `o / ko / Mo / Go / To / Po`; fr number↔unit literal is
  **U+202F**; fr `Intl.PluralRules` categories are `one` (0, 1, and decimals such
  as 0.5/1.2), `many` (exact multiples of 10⁶), `other`.
- **Inferred (not rendered here)**: that these arrive on screen unchanged —
  reading a rendered frame was out of scope for this read-only audit; the running
  claim is the code path above. Note the source comment's fr example `2,4 Mo`
  differs from the measured *default* `2,4Mo` (fr's own pattern has no space,
  the separator comes from the short-kilobyte literal instead); that is a comment
  nicety about a code path I did not execute, not a catalogue defect.

## 2. Delta focus — the two `tool.never_sent_*` keys

Meaning, register and fit are right: not delivered → "jamais envoyé" (masculine,
parallel to the shipped `tool_row.outcome.never_ran` "jamais exécuté"),
lower-case terse status, no trailing punctuation, middle dot kept with ordinary
spaces, U+202F before the French colon, and the two lines are parallel. Lengths
37 / 34 characters against English 28 / 29 (+32 % / +17 %) on a row that
truncates with an ellipsis — inside the guide's fr expectation (+15-25 %, with
the ellipsis fallback the row already carries).

One MINOR (M1) on wording, and I do **not** re-open the prior `l2-au-fr`
verdict on these bytes: my independent pass reached the same class of finding.

## 3. Findings

Attribution: "pre-existing" = present and unchanged on `origin/main`
(`87eec8192818`), i.e. **not** introduced by this rebase — the catalogue diff is
exactly the two added keys. They are still defects in the combined bytes this
audit claims, so they are listed and counted; none is a blocker or a major.

**M1 — MINOR (delta key)** `ui.chat.canonical.tool.never_sent_composed`
- current: `jamais envoyé · texte rédigé : {size}`
- problem: adds the noun "texte", absent from the source (the measured thing is
  the model's composed request, which may be arguments rather than prose), and
  puts two delimiters (`·` then ` : `) on a line that English separates once.
  Nothing is unsafe or wrong; it is heavier than the source.
- proposal: `jamais envoyé · {size} rédigé` (keeps source order, one delimiter;
  "rédigé" stays invariable here so no agreement with the pre-localised unit) —
  or keep the current wording; both are shippable.

**M2 — MINOR (pre-existing)** `ui.chat.canonical.tool_row.bridge.fallback.conversation`
- current: `cette conversation` (en: `a conversation`)
- problem: the sidecar's own instruction is "indefinite noun phrase, lowercase …
  stands where a name would go after the verb ('Posted in a conversation')"; the
  definite "cette" points at a conversation the app explicitly does not know, and
  its three siblings on the same row keep the indefinite (`un message direct`,
  `un message`, `un coéquipier`).
- proposal: `une conversation`.

**M3 — MINOR (pre-existing, #1862 set)** `ui.chat.canonical.tool_row.verb.retrieved_secret.running` / `.settled`
- current: `Chargement de secret` / `Chargé le secret` (en: `Retrieving secret` / `Retrieved secret`; the row names the `secret` tool's **`retrieve`** operation per the sidecar)
- problem: "charger" = load, not retrieve; the same namespace already renders
  fetch/retrieve with "récupérer" (`tool_row.verb.fetched.*` → "Récupération de"
  / "Récupéré"), so the row names one operation with two verbs.
- proposal: `Récupération de secret` / `Récupéré le secret`.

**M4 — MINOR (pre-existing, #1862 set)** `ui.chat.canonical.tool_row.bridge.verb.directory.failed` / `.running` / `.settled`
- current: `Impossible de consulter l’annuaire` / `Consultation de l’annuaire` / `Annuaire de l’équipe consulté`
- problem: English says "the team directory" in all three; the settled form names
  the team, the other two drop it, so the live→settled transition changes the
  object the row talks about.
- proposal: use `l’annuaire de l’équipe` in all three (or drop it in all three).

**M5 — MINOR (pre-existing)** `ui.chat.canonical.tool_row.bridge.verb.shared_history.settled`
- current: `Lu dans la conversation partagée` (en: `Read shared conversation`)
- problem: its own running form is `Lecture de la conversation partagée`, and the
  added "dans" shifts "read the conversation" to "read inside the conversation";
  the sibling `shared_conversations.settled` uses the passive shape
  (`Conversations partagées listées`).
- proposal: `Conversation partagée lue`.

**M6 — MINOR (pre-existing, cross-file)** `ui.chat.canonical.supplement.file_actions.reveal_in_finder`
- current: `Afficher dans Finder` (en: `Reveal in Finder`)
- problem: the same fr action in `src/i18n/catalogues/fr/ui.library.json:72`
  (`ui.library.menu.reveal_in_finder`) reads `Afficher dans le Finder`, which is
  also macOS's own French menu wording; two spellings of one menu action across
  the shipped fr corpus.
- proposal: `Afficher dans le Finder`.

**N1 — NIT (pre-existing)** `ui.chat.canonical.tool_row.diff.more` / `.truncated`
- fr carries `one`/`other` only; fr also has `many` (exact multiples of 10⁶),
  where French needs "de": at 1 000 000 the rows render "1 000 000 lignes …"
  instead of "1 000 000 de lignes …". Only reachable at absurd diff sizes; add a
  `many` arm if it is free.

**N2 — NIT (pre-existing, #1862 set)** `ui.chat.canonical.tool_row.verb.raised_panic.running` / `.settled`
- current: `Révocation d’urgence de` / `Révoqué d’urgence` (en: `Raising panic` / `Raised panic`)
- problem: the row no longer names the `network` tool's `panic` operation at all;
  the sidecar asks to keep the tool's own meaning. The rendering is defensible
  (panic IS an emergency revoke), so this is a note, not a request.

**N3 — NIT (mechanical, pre-existing)** key order
- `ui.chat.canonical.fold.count.actions_partial` sits at position 249 in fr where
  English has it at 241 (it is last inside a 9-key block instead of first); the
  same divergence exists on `origin/main`. Immaterial: `generate.mjs` sorts keys
  when it emits `keys.gen.ts`; it only costs diff churn.

## 4. What I did NOT run (and why)

- No `pnpm check-i18n`, no `node --test`, no `generate.mjs`, no ledger command:
  this audit is read-only against a shared worktree under an active memory guard,
  and those runs are installs/builds/tests/generator by the manager's brief. The
  mechanical table above is my own implementation of the same checks, and I read
  `locale-parity.test.mjs`, `context-parity.mjs` and `generate.mjs` at the audited
  commit to mirror their rules — so this is not a claim of repo-validator output.
- One platform query outside the repo (`node -e` with `Intl`) for CLDR fr unit,
  separator and plural-category data; disclosed above with its readings.
- No rendered frame, no browser, no Electron: fit findings are cell measurements
  over the strings, not a screenshot claim.

## 5. Ledger / evidence

- Recommended auditor entry for the ledger writer: `result: clean-with-findings`,
  severity `blocker 0 / major 0 / minor 6 / nit 3`, `instance` = this session's
  audit (`au-1861-fr`, session `60da9ca1b9fc`), receipt noting the three
  input sha256 values above — `ledger-assemble.mjs` requires both the English and
  the fr sha256 to appear in the receipt, and rejects a placeholder instance.
- This report is the served artifact of record (session scratchpad); the tracked
  copy belongs in `i18n/audits/evidence/fr/ui.chat.canonical/au-1861-fr/`
  (`record.json` + this report + execution log) and is for the manager to commit —
  I made no repo writes.
- Prior, separate audits on these bytes: `l2-au-fr` (the two never-sent keys, on
  the PR head) and the #1862 `tool_row.verb.*` audit on main. This pass is the
  first one covering the COMBINED file at 659ef7e44b7c.
