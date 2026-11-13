# s16f — Hindi (`hi`) independent translation audit, ROUND 4 (delta at the landed remediation)

- **Auditor:** `i18n-auditor` (this run) · **Session:** `b04b0982d048` ·
  **Model:** `deepseek/deepseek-flash` — the model this session is running on
  (harness session header). No fallback, no model switch, no role/default pin,
  no tool change.
- **Independence:** not the translator of these values, and **not** the round-3
  auditor whose `changes_requested` verdict these bytes answer. Both are other
  instances; neither session id was supplied in my brief, so none is invented
  here. This is the first independent read of the corrected values.
- **Date:** 2026-11-12 (UTC) · **Namespace:** `ui.chat.canonical` · **Locale:** `hi`
- **PR:** #1876 · **Head audited:** `cbb8782a39b5692ae46bfc3aa6930840420e9b14`
  (verified equal to the PR's `headRefOid` — I audited the pushed head, not a
  local copy).
- **Worktree (manager-owned, read-only for me):**
  `~/local-operator-ui/.worktrees/i18n-s16a` — `git rev-parse HEAD` matched and
  `git status --porcelain` was empty before **and** after this run.
- **Read-only compliance:** no edits, commits, checkouts or installs. The ICU
  grid ran against the worktree in place; `node_modules` was **symlinked** from
  my scratch dir (never installed, never copied); nothing was written into the
  repository.
- **Baseline for the delta:** `8180eff1f705eb79d4df5123d6108c539b585b2e`.

## Verdict

**`passed`** — `{blocker: 0, major: 0, minor: 0, nit: 0}`. No finding in scope.

All three corrected values are right, and I accept them on my own evidence, not
because the translator or round 3 said so. The noun decision (bare noun **ध्वनि**)
is the settled term for the sound artifact in this catalogue, and the fixed
compound **साउंड इफ़ेक्ट** that stays in the `image_gen` state lines is the living
Hindi term for that material kind, not a drift. Details and the argument for that
split are in §4. The operator's requirement — no English left in the interface
when `hi` is selected — is unaffected: the three values are wholly Devanagari and
the namespace carries no English beyond mandated tokens.

## Inputs and hashes (SHA-256)

| input | path | sha256 |
|---|---|---|
| English catalogue (467 keys) | `src/i18n/catalogues/en/ui.chat.canonical.json` | `905fb4d86bab02148e90dea09a1e7d74c628fcdeb3f40f49126b21f491a8d28e` |
| Hindi catalogue (467 keys, on disk now) | `src/i18n/catalogues/hi/ui.chat.canonical.json` | `5bad55ca446e6e2e0bc853d503d94280f444cd009402431c65e8ce997528689b` |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` | `8f56e0d2b384c6b41add57a64e6c863e565cb61d5a7c0de482d42f380be3acfe` |
| Glossary | `~/local-operator/i18n/glossary.md` (core @ `4981010c6`) | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| Hindi style guide | `~/local-operator/i18n/style-guides/hi.md` (core @ `14f73c4dc`) | `82292dc8d13fcc93dc752457719264aed3cc20bb65ecfaba0f0e5a31f4cb40d5` |

The glossary and hi style-guide hashes equal the ones the round-2 audit bound
(`0eb34437…`, `82292dc8…`), so no terminology or style-guide revision intervened
between that verdict and this one; the reference rules are the same rules.

Per-key Hindi hashes (sorted-key compact single-value JSON, UTF-8):

| key | sha256 |
|---|---|
| `ui.chat.canonical.media.sound_label` | `3388248df8e4a4d4866919ea437a58a5e3cec81ae6ebb1d6950a4312d26e541f` |
| `ui.chat.canonical.sound.player_failed` | `5388fac56746ac587cae8e336a7ae886bfd23d1ce2e17b1660b7eed9311d984f` |
| `ui.chat.canonical.supplement.sound_fallback_label` | `0d31c4a481e3871a5a82d4a65ab71a00d5f7e5ebcd141ef78b3414c1f1b83b42` |

`audit.log` in this bundle is the **execution log** (real commands, real output,
re-executed for the log rather than pasted). This report is the reasoning about
that output.

## 1. Mechanical — validators and my own grid

Repo validators (run in place, from the worktree root):

| command | result |
|---|---|
| `node --test scripts/i18n/locale-parity.test.mjs` | **44/44 pass**, 0 fail — key parity, placeholder integrity via the real ICU parser, no-English-stub |
| `node scripts/i18n/check-duplicates.mjs` | `ok — 1437 file(s) scanned, 0 duplicate key(s)` |
| `node scripts/i18n/context-parity.mjs` | `ok — every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s)` (shrink-only allowance; none of them here) |
| `node scripts/i18n/generate.mjs --check` | `src/i18n/keys.gen.ts is byte-identical to a fresh generation` |
| `node --test scripts/i18n/generation-card-labels.test.mjs` | 27/27 pass — the slice's own guard that these labels come from keyed helpers |
| `node --test scripts/i18n/hi-activation.test.mjs` | 3/3 pass — the hi activation/plural sanity the change touches |

I did not stop at a green suite. `check-hi-s16f-au4.mjs` (in this bundle)
re-derives, for the 9 keys in scope, argument names+types and every
plural/select branch keyword with the same `@formatjs/icu-messageformat-parser`
the validator uses, and prints both ASTs:

- placeholder names **and** explicit types identical for all 9 keys;
- plural/select structure identical, including the full
  `material[video|voiceover|sound_effect|other]` select in every `image_gen`
  state line — no branch dropped, none added;
- every plural in the target carries `other` (the mandatory CLDR fallback);
  `media.sound_label` keeps `=1`/`other` exactly as English writes it;
- CLDR categories for the locale are `one/other` (measured with
  `Intl.PluralRules('hi')`), and the `one`/`other` structure of the plural keys
  in scope is preserved against English;
- no keys added or dropped: 467 `en`, 467 `hi`, symmetric difference 0.

Unicode hygiene on the 3 changed values: no ZWJ/ZWNJ, no bidi controls, no BOM,
no precomposed `फ़` (U+095E) introduced — the catalogue uses combining U+093C
everywhere (2 610 occurrences, 0 precomposed), and the untouched
`साउंड इफ़ेक्ट` follows that same spelling.

## 2. Integrity — exactly the landed values moved, nothing else

| check | measured |
|---|---|
| key set vs `8180eff1` | equal (467/467) |
| key **order** vs `8180eff1` | identical |
| values byte-identical to `8180eff1` | **464 of 467** |
| values differing | **3** — `media.sound_label`, `sound.player_failed`, `supplement.sound_fallback_label`, and only those |
| raw file | 469 lines before and after, **3 differing lines** |
| added/merged 15-key group (10 the PR adds over `origin/main` + 5 `main` brought in the `8180eff1` merge) | 13 unchanged from their previous audited values; the 2 that moved are `media.sound_label` and `supplement.sound_fallback_label`, both in this commit's scope; `sound.player_failed` is a pre-existing key whose only change is also in scope |
| JSON validity / serialisation shape | parses; tab-indented catalogue shape preserved; file ends with a newline |

So the commit did what it says: it changed three values in one namespace and
nothing else, and every retained key is byte-identical to the head whose audit
it carries.

## 3. Accuracy of the three changed keys

### 3.1 `ui.chat.canonical.media.sound_label`

- EN: `{count, plural, =1 {Sound} other {Sound {position, number, ::group-off}}}`
- HI was: `{count, plural, =1 {साउंड} other {साउंड {position, number, ::group-off}}}`
- HI now: `{count, plural, =1 {ध्वनि} other {ध्वनि {position, number, ::group-off}}}`

Sidecar role: *accessible name of a sound a tool produced when the tool sent no
file name; numbered when several share a row*; tone *bare noun, capitalised,
number after the noun in English*; and it "becomes the audio player's play and
pause accessible name … so it must read as a thing that can be played."

Correct. Devanagari has no capitalisation, so the sidecar's "capitalised"
requirement is satisfied structurally as in the sibling `media.image_label`
(`तस्वीर`). The number still follows the noun, as the sidecar requires. The noun
is now the one this product uses for the artifact:

| surface | en | hi |
|---|---|---|
| `ui.canvas.file_rows.sounds` (the row a generated audio file lands in) | Sounds | **ध्वनियाँ** |
| `ui.settings.notifications.sound.heading` | Sound | **ध्वनि** |
| `ui.settings.notifications.list.label` | Notification sound | **सूचना ध्वनि** |
| `ui.settings.notifications.custom.rename_label` | Sound name | **ध्वनि का नाम** |
| `ui.settings.notifications.preview.failed` | Couldn't play this sound. | **यह ध्वनि नहीं चल सकी।** |

Census, measured here: **ध्वनि in 27 keys / 32 occurrences** across
`ui.settings.notifications` (23 keys), `ui.canvas` (1) and this namespace (3).
(The commit message says "28 times"; my count is 32 occurrences over 27 keys. The
difference does not touch the decision — the term is overwhelmingly the
catalogue's own word for this artifact — and I record it only so the number in
the message is not mistaken for a measured figure.)

Composed the way the callsite composes it (`ui.chat.json` templates):

- `ui.chat.audio.play_label` → **ध्वनि चलाएँ**
- `ui.chat.audio.pause_label` → **ध्वनि रोकें**
- `ui.chat.audio.position_label` → **ध्वनि की प्लेबैक स्थिति**

That reads as a thing that can be played, verb-last and unremarkable — exactly
the property the sidecar demands. With the old `साउंड` it read as a loanword
sitting beside a system that calls the same object `ध्वनि` everywhere else; that
was a real internal inconsistency, and calling it MAJOR in round 3 was right.

### 3.2 `ui.chat.canonical.sound.player_failed`

- EN: `This sound could not be played`
- HI was: `यह साउंड नहीं बजाया जा सका`
- HI now: `यह ध्वनि नहीं चलाई जा सकी`

Sidecar: inline error beside the shared player's transport; plain failure, no
trailing punctuation, one short clause that must not wrap the row.

Correct, and better than the old string on three counts:

1. **Noun** — same argument as 3.1.
2. **Gender agreement** — `ध्वनि` is feminine, so `चलाई … सकी` is the agreeing
   form. The old `बजाया … सका` agreed with the masculine loan `साउंड`; it was
   grammatical but only because the noun was the loan. The change is internally
   consistent, not a gender guess.
3. **Verb choice** — `चलाना` is the product's playback verb: the button on this
   very player is `ui.chat.audio.play` = **चलाएँ**, and
   `ui.settings.notifications.preview.failed` says **नहीं चल सकी**. Had the
   translator kept `बजाना` it would have needed `बजाई` to agree, and the error
   line would then use a different verb from the control next to it. `चलाई` is
   the better call and I accept it.

No meaning added, no remediation implied (the sidecar explicitly wants "not why
or what to do next"), no negation error, no trailing punctuation — matching the
English, which also has none. It is not a translation of a destructive or
permission string; it is a failure notice, and it neither overstates nor
understates.

### 3.3 `ui.chat.canonical.supplement.sound_fallback_label`

- EN: `Generated sound`
- HI was: `बनाया गया साउंड`
- HI now: `बनाई गई ध्वनि`

Sidecar: name of a sound player in a supplement card when the card sent no
title; *bare noun phrase, sentence case, no punctuation*. Correct: attributive
participle + noun, feminine agreement with `ध्वनि`, no punctuation, two words.
The pattern matches the catalogue's own agreement family for feminine nouns
(`ui.notices.files.created` = `फ़ाइल "{name}" बनाई गई।`,
`ui.canvas.files.emptyDetail` = `एजेंट द्वारा बनाई गई … फ़ाइलें`), and it matches
the sibling state line `image_gen.state.done` (`तस्वीर बन गई`) rather than
importing the loan `जनरेट`. Word order `बनाई गई ध्वनि` is the natural Hindi
order for the English `Generated sound`; the alternative `ध्वनि बनाई गई` would
read as a finished sentence, not a label.

## 4. The noun split — judgement on the remaining `साउंड इफ़ेक्ट`

Six keys in this namespace still carry `साउंड इफ़ेक्ट` and were left alone
deliberately. I judged each, and I judge the split **correct**, not a leftover:

| key | hi |
|---|---|
| `image_gen.state.done` | `… sound_effect {साउंड इफ़ेक्ट बन गया} …` |
| `image_gen.state.done_batch` | `… sound_effect {साउंड इफ़ेक्ट का बैच} …` |
| `image_gen.state.failed` | `… sound_effect {साउंड इफ़ेक्ट नहीं बनाया जा सका।} …` |
| `image_gen.state.failed_batch` | `… sound_effect {साउंड इफ़ेक्ट का बैच विफल रहा।} …` |
| `image_gen.state.running` | `… sound_effect {साउंड इफ़ेक्ट बन रहा है…} …` |
| `image_gen.state.running_batch` | `… sound_effect {{total, plural, one {# साउंड इफ़ेक्ट बन रहा है…} other {# साउंड इफ़ेक्ट बन रहे हैं…}}} …` |

Reasons, in the order that decided it:

1. **Different referent, different word.** `ध्वनि` names *the sound artifact* (a
   playable thing, the canvas row, the notification sound, the player's
   accessible name). `साउंड इफ़ेक्ट` names *a kind of generated material*, and it
   sits in a `material` select beside `वीडियो` and `वॉइसओवर` — kept English loans
   by the style guide's own product-name/technical-term policy. The family is
   already mixed (`तस्वीर` is native, the other two are loans); adding `ध्वनि
   प्रभाव` would make it the only literal calque in its own paradigm.
2. **`ध्वनि प्रभाव` / `ध्वनि इफ़ेक्ट` would be worse.** The first is a dictionary
   calque no one says in product copy; the second is a hybrid that is neither.
   The style guide's rule is explicit: prefer the settled Hindi term where one
   exists, and *keep* the English loan where the loan is the living term.
   `साउंड इफ़ेक्ट` is the living term for this kind; `ध्वनि` is the settled term
   for the generic artifact. The guide's two rules point in opposite directions
   here only because the two phrases mean different things.
3. **The juxtaposition is not a defect.** On a sound-effect card a reader may see
   `साउंड इफ़ेक्ट बन गया` and then the player's name `बनाई गई ध्वनि`. English does
   exactly the same (`Generated sound effect` / `Generated sound`), and the two
   words denote the kind and the thing — a normal, idiomatic pairing in Hindi as
   in English.
4. **Consistency holds where it matters.** What the round-3 finding was really
   about — one concept, one noun, in the same product — is now satisfied for the
   artifact term everywhere (27 keys). The compound keeps its own settled form
   consistently across all six keys too: same spelling, always `का`-connected in
   the batch forms, and the masculine agreement (`बन गया`, `बनाया जा सका`, `बन रहा
   है`) is right for `इफ़ेक्ट` throughout.
5. The batch plural reads naturally: `# साउंड इफ़ेक्ट बन रहे हैं…` leaves the loan
   compound uninflected while the verb carries the plural — standard Hindi for a
   fixed compound. `तस्वीरें` in the same select inflects because `तस्वीर` is a
   native count noun. No change needed.

If a future wave decides the compound should also move, that is a product
terminology decision for the whole `image_gen` family (and would need
`वीडियो`/`वॉइसओवर` looked at too), not a defect in these bytes. It does not gate
this verdict.

## 5. Idiom, register, typography

- **आप register** throughout; no तुम/तू, no honorific padding, no exclamation
  marks anywhere in the three values.
- **Tone match:** bare noun stays bare (`ध्वनि`); error stays a plain clause with
  no trailing danda, matching the English's lack of punctuation; the fallback
  label stays a noun phrase with no punctuation. The English side of each sidecar
  constraint is met, not just approximated.
- **Script/punctuation:** the changed values are Devanagari copy; the only Latin
  in them is ICU syntax in `media.sound_label` (`count`, `plural`, `other`,
  `position`, `number`, `group-off`) — message syntax, not interface text, and
  byte-identical to English as the contract requires. No Devanagari digits
  (Latin digits per §2.8 policy), no exclamation mark in any of the three. The
  U+2026 ellipses in the untouched `image_gen.state.running*` keys are single
  characters (4 and 8 of them respectively), not three periods; danda `।` is
  used in the sentence-form keys only and absent in the label/error forms, which
  is the correct distinction.
- **Nukta:** `इफ़ेक्ट` keeps `फ़` as फ + U+093C, consistent with the whole
  catalogue (2 610 such occurrences, zero precomposed U+095E).
- **No calque** in the three changed values; `बनाई गई ध्वनि` is how a Hindi
  speaker names a produced sound, not a word-for-word copy of "generated".

## 6. Fit / width

No `maxCells`/`maxChars` hint exists for any key in this sidecar (measured: 0
keys carry either field), so fit is judged against the sidecar's prose budgets
and the surfaces named there. Cell counts (naive wide-glyph measure, which is an
upper bound for Devanagari conjuncts):

| key | en cells | hi before | hi now | consequence |
|---|---|---|---|---|
| `media.sound_label` | 73 | 71 | 71 | accessible name only, no box |
| `sound.player_failed` | 30 | 24 | **23** | sits on the player's control line and must not wrap — it got shorter, so no new wrap risk |
| `supplement.sound_fallback_label` | 15 | 14 | **12** | label on the player's control line — shorter |

Every changed value is the same length or shorter than the byte string it
replaced and shorter than English. Both nouns measure 4 cells by the naive
wide-glyph count (`साउंड` 5 codepoints / 4 cells, `ध्वनि` 5 / 4), so the noun swap
is width-neutral; the label's 2-cell saving comes from `बनाई गई` (13 codepoints)
replacing `बनाया गया` (15), and the error line's cell comes from dropping `बजाया`
in favour of `चलाई`. The batch state strings are unchanged and were already
within budget. No overflow, no wide-glyph/combining-mark risk introduced.

## 7. Findings

**None.** `{blocker: 0, major: 0, minor: 0, nit: 0}`.

I record the soft points below as observations, explicitly **not** findings,
because none is wrong, none needs a change on this head, and manufacturing a NIT
to look thorough would be the failure mode I am here to avoid:

- **O1 (INFO).** `sound.player_failed` (`…नहीं चलाई जा सकी`) and
  `ui.settings.notifications.preview.failed` (`…नहीं चल सकी।`) render the same
  idea with two constructions in one product. Both are idiomatic and each mirrors
  its own English (`could not be played` / `Couldn't play this sound.`); the chat
  string is a different surface with a different source. Not unified, not a
  defect.
- **O2 (INFO).** `media.sound_label` mirrors English's `=1`/`other` rather than
  hi's `one`/`other`. Because count 0 cannot occur for this label (a set with no
  sounds has nothing to name), the rendered output matches English's behaviour for
  every reachable count; switching to `one` would move the string away from the
  source structure for no gain. Deliberate, correct as-is.
- **O3 (INFO).** The commit message's "28 times" for `ध्वनि` is a near-count; I
  measure 32 occurrences over 27 keys. Immaterial to the decision, recorded so
  the figure is not later read as an audit measurement.
- **O4 (INFO).** Rendered frames were not captured (read-only lane, machine near
  its RAM limit; `ui.chat.canonical` is chat-copy, not a settings/onboarding
  surface). Fit is argued from cell counts and the surfaces named in the
  sidecar; a rendered check of the player's control line remains QA/design work.

## 8. Limits of this audit

Reading, the repo's validators and a real ICU-AST comparison; no rendered frame,
no runtime session. This is a **delta** audit: the 3 changed keys plus every key
in the namespace carrying the same noun were read in full, and the retention of
the other 464 values rests on the byte-identity proof in §2, not on a re-read.
The namespace as a whole was last read in full by the round-2/round-3 rounds.
