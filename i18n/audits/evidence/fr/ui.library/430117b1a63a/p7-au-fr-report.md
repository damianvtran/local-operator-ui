# P7 i18n audit — fr (round 1)

Slice: P7 / UI library organized-by actor sentences + audio position value
Locale: fr · Namespaces: ui.library, ui.chat · Keys audited: 6 (all of them)
Candidate: ~/local-operator-ui/.worktrees/_p7-prep/fr.json (translator: anthropic/claude-sonnet-5-5)
Auditor: i18n-auditor, session 430117b1a63a, ACTUAL served model deepseek/deepseek-flash
(independence: translator model ≠ auditor model; I did not translate these strings and edited nothing)

## Verdict: CLEAN — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT

| key | value | en | verdict |
|---|---|---|---|
| ui.library.preview.organized_by_agent | Classé par un agent {at} | Organized by an agent {at} | pass |
| ui.library.preview.organized_by_librarian | Classé par le Bibliothécaire {at} | Organized by the Librarian {at} | pass |
| ui.library.preview.organized_by_system | Classé automatiquement {at} | Organized automatically {at} | pass |
| ui.library.preview.organized_by_user | Classé par vous {at} | Organized by you {at} | pass |
| ui.library.preview.organized_unattributed | Classé {at} | Organized {at} | pass |
| ui.chat.audio.position_value | {current} sur {total} | {current} of {total} | pass |

## 1. Mechanical — PASS (executed)

Validator context: `scripts/i18n/check-coverage.mjs` has hardcoded repo paths and reasons from the
catalogue tree, so it is only meaningful once the 6 keys land in the catalogues (coding-PR gate). For
the standalone candidate I ran the parser the generator itself uses — `@formatjs/icu-messageformat-parser`
3.5.21 from this checkout's node_modules (`scripts/i18n/generate.mjs` imports the same module) — over
every en/candidate pair, plus a JSON/Unicode pass. Command: scratch `check_p7_fr.mjs`.

- key set and order: identical to keys.json (6 keys, none added/dropped, no duplicates)
- ICU: all 6 parse; no plural/select at all, so no CLDR-category question (no count in this slice)
- placeholders: en{at} = fr{at} for the five library keys; en{current,total} = fr{current,total} for
  position_value. Names and types identical, no reformatting inside the string
- markup / Rich tags / backticks / commands / flags / identifiers: none in en, none in fr
- JSON valid, UTF-8, no BOM; NFC everywhere; no zero-width or bidi-control characters; no
  NBSP/U+202F (none required: no `: ; ! ?` in these strings); no double spaces; no edge whitespace;
  apostrophe/quote question moot (no apostrophe in any value); not English-identical where it should differ
- envelope note (not a translation finding): the candidate file is 1-space-indented; the catalogue
  writers use tab-indented, alphabetically sorted files — the coder's formatting job, values unaffected

## 2. Accuracy / actor fidelity

All five actor states are preserved and kept distinct, which is what the fail-closed enum needs:

- agent → "un agent" (indefinite, as in "an agent"; not "l'agent")
- librarian → "le Bibliothécaire" (the named agent, definite article)
- system → "automatiquement" (adverb, no actor claimed — matches "Organized automatically", not
  "par le système")
- user → "vous" (direct address, no third-person slip)
- unattributed → "Classé" only: adds no actor, so a null/unknown `organized_by` claims nothing

No omission, addition, negation or polarity change. Nothing here is destructive/permission/error copy.

## 3. Idiom, register, {at} placement

`{at}` is not a bare timestamp: `relativeTime()` (library-model.ts:432-448) renders fr catalogue keys
whose text already begins "il y a" ("il y a 2 h", "il y a 11 mois", "à l'instant" for just_now). Every
candidate therefore linearises to natural French:

- "Classé par un agent il y a 2 h"
- "Classé par le Bibliothécaire il y a 2 h"
- "Classé automatiquement il y a 2 h"
- "Classé par vous il y a 2 h"
- "Classé il y a 2 h" (and "Classé à l'instant" for just_now)

No comma or preposition is missing before the adverbial phrase; end position is the only natural one in
fr, so the appended-placeholder shape costs nothing here. Register is the guide's vous, sentence case,
past-participle status form; no "Veuillez", no Title Case, no exclamation.

## 4. Terminology (recounted against shipped fr, origin/main a0464af9)

- "Classé": `ui.library.status.unorganized` "Non classés", `ui.library.preview.unorganized` "Pas encore
  classé", `ui.library.sort.organized` "Dernier classement", `ui.library.librarian.organize_now`
  "Classer maintenant" → "Classé" is the shipped positive form of the same verb; not "Organisé"
- "Bibliothécaire": `ui.library.librarian.title` "Bibliothécaire", `librarian.control_failed`
  "Le Bibliothécaire n'a pas répondu." Capital B mid-sentence is the consistent rendering of the named
  agent (the entity, not a job title); lowercasing would read as a generic person and break the
  one-term rule. Accepted, not a finding
- "agent": glossary §2 fr = agent (not "assistant"/"mandataire") ✓
- "par vous": shipped precedent in fr — "Ajouté par vous", "Conversation créée par vous",
  "Ignorée par vous{hasVia, …}" — so "Classé par vous" is the corpus's own idiom, not a calque of
  "by you"; "-même" would add emphasis the English does not carry. Accepted
- "sur": shipped precedent for out-of-N — `ui.library.preview.slide_of` "Diapositive {index} sur
  {count}", "{shown} sur {total} fichiers", "{loaded} sur {total} chargés", "Question {index} sur
  {total}". "0:05 sur 0:12" is the same construction, reads correctly for a screen reader, and does
  not repeat "Position" (position_label already names the slider)

## 5. Fit / width

No maxCells/maxChars hint is attached to these six (context says "comparable width"). Measured with
the placeholder actually rendered — en `2h ago` (6 chars) vs fr `il y a 2 h` (11), which is where the
length comes from:

| key | en rendered | fr rendered | fr with `il y a 11 mois` |
|---|---|---|---|
| organized_by_agent | 28 | 30 (+2) | 34 |
| organized_by_librarian | 33 | 39 (+6) | 43 |
| organized_by_system | 30 | 33 (+3) | 37 |
| organized_by_user | 23 | 26 (+3) | 30 |
| organized_unattributed | 16 | 17 (+1) | 21 |
| position_value (0:05 / 0:12) | 12 | 13 (+1) | 13 |

So fr is longer by 1-6 characters (up to +18%, on `organized_by_librarian`) — inside the guide's
expected 15-25% fr expansion and not a finding; noting it because the delta comes almost entirely from
the already-localized `{at}`, not from the sentence. Rendered in `library-preview.tsx` the string sits
in a `flex flex-wrap` meta row (kind badge, origin badge, size, dimensions, then this span) with no
truncate/nowrap: the worst case wraps, it does not clip. Only é (U+00E9, 1 cell, no combining marks)
is non-ASCII, so no terminal-wide-glyph risk. position_value is aria-only, never painted.

## 6. RTL

Not applicable to fr; recorded for completeness: no bidi controls needed or present, and fr is LTR.

## Ledger note the manager can file (237 chars, ≤280)

"P7 fr R1 clean: 0 findings, ICU+placeholder parity PASS (@formatjs 3.5.21). Classé, Bibliothécaire,
'par vous', 'sur' match shipped fr; {at}='il y a 2 h' appends naturally. keys.json c2b57ad, fr.json
746470f. i18n-auditor/deepseek-flash."

## Provenance

Inputs read (sha256, origin/main a0464af9e0a8d13e87409a4e2fd410e87b6bcdcc):

- en/src/i18n/catalogues/en/ui.library.json 065ac47c67e2a82867070f9df0e33d25c0d96aedd77438b584114147db07fd71
- en/ui.chat.json ee4e2a9eeb841750244e94a681e33eda92f87cb9727439779b77809c1628ea15
- en/ui.library.context.json f799fe911107aa1f7b83b0c026ee277d5c21ee5eba297e3ae13c2da51135cc8e
- en/ui.chat.context.json 84fd75c47f8a888724affda05175936bd7eacf58da592eb4485e512cb42b08bf
- fr/ui.library.json (shipped) 5b2b439c0837be164d52fc50a53a40a8e0ea0b5940f1dff96359f5b18f61bc0f
- fr/ui.chat.json (shipped) b524ab1132756d282986a666f82c25465a26dae0aa85ff77fe696812d0d08c96
- _p7-prep/keys.json (en+context for the 6) c2b57addb849fb35720fac74c79b59c1c47078534c0c50cf9e8b58c368c0a35a
- _p7-prep/fr.json (candidate) 746470fefad1c2cb33870bea6876f4486c13c80cf6819ca9fd84afc897531e01
- _p7-prep/callsites.md 25fc999688b693d45b3ad3cbcd5e11180087cd969ce6031d586fc200390f94ff

Style guide: ~/local-operator/i18n/style-guides/fr.md (+ en.md, glossary.md §1-§2). No MT service,
no back-translation, no edits to repo or ledger (per slice brief). Scratch artifacts:
scratchpad://check_p7_fr.mjs (executed), scratchpad://p7-au-fr-report.json, this file.
