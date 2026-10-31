# i18n audit — hi / ui.agents.routing

- **Instance:** `7d5dd4bded37-agents3-hi`
- **Auditor:** i18n-auditor (agent), session `7d5dd4bded37`, model `radient/auto`
  (primary `anthropic/claude-sonnet-5-5` failed on provider quota; harness fell
  back `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`)
- **Independent of the translator:** by agent and session, yes — translated by
  the agents2-i18n lane, translator session `30bd8250d874` under manager session
  `3ef6295a5545` (per its `translator.log`); this audit neither wrote nor edited
  the values. Disclosed rather than claimed: that lane also ended on
  `radient/auto` after the same provider-quota fallback, so independence here is
  not independence of model.
- **Date:** 2026-10-30
- **Scope:** `ui.agents.routing`, 12 keys, hi vs en source + context sidecar.
- **Verdict:** PASS — 0 BLOCKER, 0 MAJOR, 4 MINOR, 4 NIT.

## What was checked

Mechanical, on the audited bytes: valid JSON, 12 members, no duplicate members,
key set and order identical to en, no ICU braces/plural/select in either file
(there are none to validate), no placeholders or `%s` tokens in either file, no
markup/Rich tags, no backticks, no code spans; NFC on all 12 values; no
zero-width characters, no NBSP, no space-before-punctuation; every value ends
with a danda (13 `।` = 12 finals + 1 internal).

Repo controls run (they cover the tree, NOT the unaudited scratch file —
`src/i18n/catalogues/hi/ui.agents.routing.json` does not exist yet):
`node scripts/i18n/generate.mjs --check` → keys.gen.ts byte-identical to a fresh
generation (exit 0).

Fit: no value is materially longer than English. Character ratios 0.75–1.07,
terminal-cell ratios 0.67–0.93 (max 323 cells, `copy_reviewer`, vs 354 en). The
card truncates at ~320 px with an ellipsis and English already overflows there,
so no regression is introduced.

Sibling consistency (`ui.agents.descriptions`, hi): agent→एजेंट, team→टीम,
run/review/खामियाँ/उपयोगकर्ता/लाइब्रेरी/एसेट्स/रेपो all agree between the two
families. Two shared wordings also share their defect (AI-isms, keyboard-first)
and are recorded against the keys that carry them here. One cross-family
divergence is worth the manager's attention, and it is the sibling that is
wrong: descriptions calls the librarian "लाइब्रेरी का व्यवस्थापक एजेंट"
(administrator), while this family correctly says "लाइब्रेरी को व्यवस्थित
करना"; the sibling audit's H1 already asked for exactly that fix.

Second independent pass: not performed. This is not one of the high-visibility
groups (onboarding, errors, settings) that require it; recorded rather than
implied.

## Findings

| ID | Sev | Key | Current → suggested |
|---|---|---|---|
| R1 | MINOR | aida | …कई एजेंटों **पर** साथ-साथ काम शुरू करवाना → …कई एजेंटों **में** साथ-साथ काम शुरू करवाना |
| R2 | MINOR | ux_reviewer | किसी बदलाव का उपयोगकर्ता “अनुभव” देखना → किसी बदलाव के “उपयोगकर्ता अनुभव” की समीक्षा करना |
| R3 | MINOR | copy_reviewer | …AI जैसी बनावटी **बातें** हटाना → …AI जैसी बनावटी **भाषा** हटाना |
| R4 | MINOR | librarian, reviewer, scout | ढूँढना → **ढूँढ़ना** (3×; plus 2 merged occurrences elsewhere) |
| R5 | NIT | coder | बिना और फ़ैसलों के → बिना किसी और फ़ैसले के |
| R6 | NIT | tui_designer | कीबोर्ड से चलने वाले फ़्लो → कीबोर्ड-प्रधान फ़्लो |
| R7 | NIT | designer | …UI की समीक्षा, लेआउट… → …UI की समीक्षा **कि** लेआउट… |
| R8 | NIT | reviewer | PR, MR, diff, commit रेंज या पैच → one script policy for the artefact list |

### R1 — aida (MINOR, idiom/accuracy)

`कई एजेंटों पर साथ-साथ काम शुरू करवाना` treats the agents as the place the
work is started *on*. The English ("starting parallel work across agents") makes
them the workers. `में` / `के बीच` carries that; the following clauses resolve
the intent, but a card is read at a glance.

### R2 — ux_reviewer (MINOR, clarity)

`किसी बदलाव का उपयोगकर्ता “अनुभव” देखना`: quoting अनुभव alone splits the
settled compound उपयोगकर्ता अनुभव, and `का` then reads उपयोगकर्ता as possessor
("the user of a change"). Quoting the compound and restoring समीक्षा keeps both
the English emphasis on EXPERIENCE and the review verb the rest of the roster
uses.

### R3 — copy_reviewer (MINOR, accuracy)

`AI जैसी बनावटी बातें` = "AI-like artificial things"; every other item in that
list names a property of the text, and हटाना then dangles at the end as if it
were the sentence's main verb. `भाषा` puts the object back. The same wording
sits in `ui.agents.descriptions.copy_reviewer` (already flagged MINOR there as
H2), so a fix is one edit in two places.

### R4 — nukta (MINOR, orthography)

ढ is written without its nukta in three keys. Standard Hindi spells ढूँढ़ना with
nukta and the hi style guide makes nukta part of the spelling. This is
house-wide, not local: the merged hi catalogue writes ढूँढ in `ui.teamBridge`
and `ui.agents.descriptions` and never writes ढूँढ़, so the fix belongs in one
sweep rather than per-namespace. Non-blocking by the audit contract.

### R5 — coder (NIT, idiom)

`बिना और फ़ैसलों के` is a calque of "without further decisions"; Hindi wants the
determiner and the oblique singular: `बिना किसी और फ़ैसले के`.

### R6 — tui_designer (NIT, accuracy)

"keyboard-first" flattened to "keyboard-driven". Priority is the claim, not the
mechanism: `कीबोर्ड-प्रधान फ़्लो`. Same wording and same defect in the sibling
descriptions key (H7 there).

### R7 — designer (NIT, syntax)

The "whether …" clause follows a comma as if it were another list member beside
"the review". `समीक्षा कि …` attaches it to the review it belongs to.

### R8 — reviewer (NIT, terminology)

One line treats the artefacts three ways: `PR, MR, diff` Latin, `commit` Latin
beside a Devanagari `रेंज`, `पैच` transliterated. Whichever policy the
programme picks, this line should follow one.

## Not findings

- `unicode` left lowercase Latin inside `रंग और unicode की अनुकूलता` — correct;
  it is a technology token.
- `PR` for "pull request" and `MR` for "merge request" — allowed; the hi
  developer register uses both, and the context sidecar keeps the team's own
  abbreviations.
- `विशेषज्ञ एजेंट` for "specialist" — the roster is all agents; the added noun
  disambiguates rather than adds meaning.
- No value is identical to English; no cognate-only value either.
