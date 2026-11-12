# ur audit — ui.chat.canonical, S16f merge head (s16f-au3-ur)

**Verdict: PASSED** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT (no copy change; a renderer
observation for the merged `$0` line). `changes_requested` is not warranted: nothing
in the merged ur bytes is wrong, unsafe, unidiomatic or over a declared budget.

| field | value |
|---|---|
| Locale | `ur` (the RTL locale) |
| Namespace | `ui.chat.canonical` |
| PR | damianvtran/local-operator-ui#1876 |
| Audited head | `8180eff1f705eb79d4df5123d6108c539b585b2e` (merge of main `9ef579fe12a` into the PR) |
| Pre-merge PR head (10 keys) | `107ff1dd0bddd0dbefa60e27cb179ee636d923a1` |
| Auditor | `i18n-auditor`, session `a870ddd68b99`, model `deepseek/deepseek-flash` |
| Model source | harness session header; no model switch, fallback or provider degradation appeared in this run |
| Independence | I translated nothing and edited nothing: no repository write, no translation/MT service, no back-translation. Prior audits were read as input, then every value was re-judged here. |
| Date | 2026-11-12 |
| Scope | Catalogue audit of 15 merged keys + mechanical integrity of the other 452. **Not** rendered fit, activation, packaging or release. |

## Inputs (hashes computed in this worktree, not copied)

| input | path | sha256 |
|---|---|---|
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` | `905fb4d86bab02148e90dea09a1e7d74c628fcdeb3f40f49126b21f491a8d28e` |
| English context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` | `8f56e0d2b384c6b41add57a64e6c863e565cb61d5a7c0de482d42f380be3acfe` |
| ur target | `src/i18n/catalogues/ur/ui.chat.canonical.json` | `fd1116ccb5e847eb7f28c4cf5d1084efad95edf52d638d1a6144e065ce7d98a7` |
| ur style guide (read) | `~/local-operator/i18n/style-guides/ur.md` (working copy = local `HEAD` `b42471d`) | `c0eecf7f7b5e89956b7de9ab7a9eb647ff1a7ef701ccf2a7f0264d5eea15ca60` |
| ur style guide (origin/main) | `damianvtran/local-operator` `origin/main` | `7276e96210fe5f23fd82a39ae4cc0c88b2c1009d3a551d914efc3f61516eddc4` |
| Glossary | `~/local-operator/i18n/glossary.md` (identical on `origin/main`) | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |

The two style-guide hashes differ by one clause only — `origin/main` adds "macOS UI labels
stay in English, verbatim" (recorded from `cli.permissions` U3). It touches no key in this
scope, so both readings support the same judgments. Recorded here because a receipt that
quotes one hash should say which bytes it read.

## 1. Mechanical

- **Repo validator**: `node --test scripts/i18n/locale-parity.test.mjs` → **44/44 pass**,
  including all four ur assertions (carries every en key, names only defined keys,
  preserves every ICU placeholder, is not an English stub).
- **Independent AST comparison** (`check-icu.mjs`, real ICU parser): **15/15** keys have
  the same argument names and types, the same plural selectors and plural types, the same
  select branches and `other` arms as English. `badCategories` empty for all 15 against
  `new Intl.PluralRules("ur").pluralCategories` = `one,other`.
- **Negative control**: 7/7 mutants flagged (dropped `{total}`, dropped `has_attention
  other` arm, `one`→`few` (not an ur category), dropped `cancelled` branch, `{count}`→`{n}`,
  injected Hindi danda, injected RLM); 15/15 real values pass the same rules. (First run
  flagged 6/7 — the seventh mutant's regex had not changed the text; the mutant was fixed
  and re-run, not the checker.)
- **Surface**: no backticks, no angle tags, no manual bidi controls, no Arabic-only signs,
  no danda, no ASCII sentence punctuation, NFC-normalised, key sets identical (467 = 467).
- `media.image_label` / `media.sound_label` use `=1` + `other` exactly as the source does.
  `=1` is an exact-value selector: ur's `one` category is 1 and `=1` matches it, so no
  count can fall through — the union of branches is complete. Recorded as an observation,
  not a finding, because the alternative would diverge structurally from the source.

### Integrity of the rest of the file (script `integrity.py`)

| check | result |
|---|---|
| keys: disk / `origin/main` / pre-merge `107ff1dd` | 467 / 457 / 466 |
| union arithmetic 457 (main) + 10 (PR) = 467 | **True** |
| keys whose value differs from `origin/main` | **0** |
| the 452 keys that are neither PR-added nor main-added | **452/452 byte-identical to `origin/main`** |
| the 10 PR-added keys vs pre-merge `107ff1dd` | **10/10 identical** |
| the 5 main-added `loading.*` keys vs `origin/main` | **5/5 identical** |
| main's four deletions absent from disk | **True** (`older_history.loading`, `placeholder.loading`, `placeholder.region_label`, `transcript.stale_caption`) |
| keys present in disk but not in main | exactly the 10 PR keys, nothing else |

So the merged bytes are exactly main's 457 plus the PR's 10, and the 10 are the previously
audited PR bytes. Nothing else moved — no silent re-translation rode along with the merge.
**No re-audit of the 452 was performed or needed**, and nothing in the integrity result asks
for one.

The 5 main-added keys are renames, and the ur copy followed them: `loading.cold` == the old
`placeholder.loading`, `loading.region_label` == the old `placeholder.region_label`,
`loading.older` == the old `older_history.loading` plus the ellipsis. Vocabulary carried, not
re-invented.

## 2. Accuracy — each of the 15

| key | en | ur | judgment |
|---|---|---|---|
| `loading.cold` | Loading conversation… | گفتگو لوڈ ہو رہی ہے… | Correct; said of `گفتگو` (f.), so `ہو رہی ہے` agrees. U+2026 kept. |
| `loading.older` | Loading earlier messages… | پچھلے پیغامات لوڈ ہو رہے ہیں… | "Earlier/previous" is `پچھلے`, not `پرانے` (which would say *stale*); plural agreement correct. |
| `loading.region_label` | Loading conversation | گفتگو لوڈ ہو رہی ہے | Same words as `cold` minus the ellipsis, exactly as the source pair is built. Reads as an utterance for a live region. |
| `loading.remote` | Syncing from your other device… | آپ کی دوسری ڈیوائس سے ہم آہنگی ہو رہی ہے… | `سے` makes the other device the *source*, which is the fact the label exists to state. `ہم آہنگی` is the corpus's own rendering of sync (`tool_row.verb.synced_agents` → ہم آہنگ کر رہا). No polarity or object/subject error. |
| `loading.revalidating` | Checking for new messages… | نئے پیغامات کی جانچ ہو رہی ہے… | `جانچ` is this corpus's check verb (`checked_console`, `checked_network_status`) and is precisely the wording the deleted `transcript.stale_caption` used for this same condition ("نئے پیغامات کی جانچ جاری ہے"). Does not suggest the view is stale. |
| `media.image_label` | Image / Image {position} | تصویر / تصویر {position} | Noun-then-number, the shipped positional pattern (`تصویر {index} از {count}`). No number in the lone form. |
| `media.sound_label` | Sound / Sound {position} | آواز / آواز {position} | `آواز` is a playable thing in this corpus ("یہ آواز نہیں چلائی جا سکتی"), which is what an accessible play/pause name needs. Sound/audio split matches English (آواز vs آڈیو). |
| `sound.batch.item_status` | {label} · Failed / Stopped / Status unknown | {label} · ناکام / منسوخ / حالت نامعلوم | `Stopped` → `منسوخ` is the same word the style guide fixes for *cancel* (منسوخ کریں) and the same word the summary uses, so the two surfaces agree. `other` reads as unknown, never as success or failure. |
| `sound.batch.latest_update` | Latest update: {name} (item {item} of {total}). | تازہ ترین اپ ڈیٹ: {name} (آئٹم {item} از {total})۔ | States which item reported last, not a completion count. `از` matches five shipped positional strings; `آئٹم` matches `image_gen.batch_summary`. Sentence ends with the Urdu full stop. |
| `sound.batch.summary` | counts · counts. Needs attention: names | counts · counts۔ توجہ درکار: names | Counts always shown for completed/failed, `=0` arms empty for cancelled/unknown, `other` arm empty for `has_attention` — structurally identical to English. The sentence break is the Urdu `۔`, the right character for the job, and `توجہ درکار:` is idiomatic ("attention needed"). |
| `sound.cost.batch_unknown` | Total cost not yet known. | مجموعی لاگت ابھی معلوم نہیں۔ | "Total" = `مجموعی`, and the wording parallels the per-request sibling, which is the point of having two keys. |
| `sound.cost.estimated_zero` | Estimated cost $0; final charge not confirmed. | تخمینہ شدہ لاگت $0؛ حتمی چارج کی تصدیق نہیں ہوئی۔ | Keeps the estimate framing (does not collapse to "no charge"), keeps `$0` unsplit, uses the ur semicolon `؛`. |
| `sound.cost.no_charge` | No charge. | کوئی چارج نہیں۔ | A confirmed zero, distinct from both "unknown" and "estimated". Matches the corpus's `کوئی اضافی چارج نہیں۔`. |
| `sound.cost.unknown` | Cost not yet known. | لاگت ابھی معلوم نہیں۔ | Promises nothing and claims nothing. |
| `supplement.sound_fallback_label` | Generated sound | تیار کردہ آواز | `تیار کردہ` is the corpus's own "generated" (`image_gen.state.done` → تیار کردہ ویڈیو/وائس اوور/صوتی اثر). Bare noun, no punctuation, fits the player's control line. |

The three cost states stay three distinguishable statements, which is the accuracy risk the
context sidecar warns about; read as a native reader, they do not blur.

## 3. Idiom and register

Formality is `آپ` throughout, and every verb form is the respectful register (…ہو رہی ہے، …نہیں
ہوئی). No `تم`/`تو`, no exclamation marks, no padding. Where the English leans on a compressed
fragment ("No charge."), the Urdu adds the minimal grammatical scaffolding a native sentence
needs (`کوئی چارج نہیں۔`) instead of aping the fragment; that is the adaptation the en guide asks
for, not padding.

Punctuation is Urdu throughout: `۔` `؛` `:` `(` `)` `…` and the middle dot `·` with spaces —
matching the ten shipped ur values that already use `·`. No ASCII `.`/`;`/`,`, no danda, no
Arabic question mark.

## 4. Terminology

Glossary rows touching this scope: `device → ڈیوائس` ✓ (used in `loading.remote`). No other
glossary term appears in the 15. Kept-English policy is not exercised — the only Latin run is
the `$0` amount, which the guide keeps as Latin digits with the currency sign where the
sentence puts it.

Corpus consistency checked rather than assumed: `گفتگو` (28 values), `جانچ` (6), `آئٹم` (2),
`تیار کردہ` (2), `ہم آہنگ` (2), `از` for X-of-Y (5), `·` (10). Every term in the 15 joins an
existing pattern; none invents a synonym.

## 5. Fit (no `maxCells`/`maxChars` on any of the 15 — measured, not declared)

| key | en cells | ur cells | where it renders | judgment |
|---|---|---|---|---|
| `loading.cold` | 21 | 20 | transcript placeholder, truncating pill | fine |
| `loading.older` | 25 | 29 | busy Button in the older-history row (`min-w-0`, label `truncate`) | fine at full row width; no declared budget |
| `loading.region_label` | 20 | 19 | `aria-label` only | not painted |
| `loading.remote` | 31 | 41 | same truncating pill | longest of the four; see considered-not-raised |
| `loading.revalidating` | 26 | 30 | transcript foot slot | fine |
| `media.*` | 73 | 73 / 71 | alt text + fold-strip tile name | fine |
| `item_status` | 106 | 101 | wrapping line (`break-words`) | fine |
| `latest_update` | 89 | 92 | wrapping meta line | fine |
| `summary` | 579 | 534 | wrapping paragraph | fine |
| cost lines | 10–46 | 15–49 | meta line | fine |
| `sound_fallback_label` | 15 | 14 | player control line | fine |

Arabic-script text measures ≈1 cell per character (style guide), and no value carries FSI/PDI
in the catalogue bytes, so `len()` is the cell count here. Nothing exceeds a declared budget,
because none is declared for these keys. No rendered measurement was made (see limitations).

## 6. RTL and bidi

Method: each value rendered with representative parameters, wrapped in the runtime's own
isolation (`src/i18n/bidi.ts`: FSI/PDI around Latin-led plain string arguments), then handed to
GNU FriBidi 1.0.16 for the visual order of an RTL paragraph. 29/29 assertions pass
(`bidi-evidence.py` in the log). Reading order in an RTL line runs right-to-left, so a token
read earlier has a higher visual index — the assertions state that direction explicitly.

- The four loading labels and both cost lines with no Latin run: pure RTL, ellipsis at the
  visual left, nothing to reorder.
- `item_status`: the request name is an isolated island, keeps its internal order, sits right of
  `·` — so it is read before the state word. Embedded user data never reorders.
- `latest_update`: `(آئٹم 3 از 10)` mirrors correctly — one bracket pair, `3` read before `10`,
  and the sentence's `۔` lands at the visual left. The bracketed group sits between RTL words,
  so no bidi hazard.
- `summary`: counts read first, the joined attention list is one island at the left, read last.
  The `۔` before `توجہ درکار` terminates the clause list in the right place.
- `media` labels: the numeral is the last logical token, so it is the leftmost glyph run and
  reads `<noun> <n>` — the positional pattern that already ships elsewhere.
- **NIT-1 (below)** is the one place where a sign and a digit meet: `$0`.

## Findings

### NIT-1 — `sound.cost.estimated_zero`: the `$` sign is not covered by the runtime's sigil isolation

- **Key**: `ui.chat.canonical.sound.cost.estimated_zero`
- **Current**: `تخمینہ شدہ لاگت $0؛ حتمی چارج کی تصدیق نہیں ہوئی۔`
- **Problem**: `src/i18n/bidi.ts` isolates a sigil only when it opens a *Latin word*
  (`LATIN_WORD = /^[A-Za-z]…/`), so `$` + digit is left bare. Measured with FriBidi 1.0.16,
  the `$` resolves to the paragraph (RTL) level 1 while `0` sits at level 2, so the pair is
  *drawn* `0$`; reading the line right-to-left still yields `$0`, which is why the value
  reads correctly. UAX#9 W5, though, takes an ET adjacent to an EN into the number run — so a
  conformant engine (Chromium/ICU, i.e. the Electron surface) should draw `$0`. The two
  authorities disagree here and **I did not exercise the Electron surface** (RAM budget), so
  the painted result is unproven in this pass.
- **Suggestion**: **no copy change.** Reordering the value or inserting an LRM would violate
  the style guide ("do not insert manual bidi control characters") and store RTL-hostile
  bytes. If a rendered capture shows `0$`, the fix belongs in `isolateSigils` (accept a digit
  after the sigil), with the same regression test shape as the existing sigil cases — a
  renderer ticket, not a translation one.
- **Disposition**: open as information for whoever owns rendered fit; it does not gate this
  catalogue, and it does not change the verdict.

## Considered and not raised

- `loading.remote` at 41 cells against 31 for English: the longest of the four labels, in a
  `truncate` pill. No `maxCells` is declared, the pill is in the wide transcript column, and
  shortening `ہم آہنگی` would break the corpus's sync vocabulary. Recorded, not flagged.
- `loading.older` is six words against the sidecar's "three or four"; the sidecar's hints are
  word counts, which do not transfer to a language whose postpositional verb phrase needs the
  extra words. 29 cells in a full-width button.
- `sound.cost.no_charge` is three words against "one or two": `کوئی چارج نہیں` is the smallest
  natural Urdu statement of a confirmed zero; `چارج نہیں` alone is curt, and this is the copy
  that must not be mistaken for the *unknown* state.
- `summary` renders `cancelled/stopped` as the single word `منسوخ`. English carries two words
  because English has two UI words for the same outcome; Urdu has one, and it is the same word
  `item_status` uses, so the omission is a language fact, not a dropped meaning.
- `latest_update` uses `از` for "of" where a purist might write `میں سے`; five shipped values
  already use `از` for exactly this X-of-Y construction, and consistency in the direction a
  user actually sees beats a lone improvement.
- `sound_label` is `آواز` while audio attachments elsewhere say `آڈیو`: that split mirrors the
  English sound/audio split rather than contradicting it.
- `cost.unknown` / `cost.batch_unknown` / `cost.no_charge` / `cost.estimated_zero` are four
  strings a hurried translator would collapse into two; they are correctly kept apart.
- Prior audit (session `33f0800c30f3`, the round-2 receipt for these 10 keys) reached the same
  judgments on `منسوخ`, `مجموعی لاگت`, `از`, `کوئی چارج نہیں` and `آواز` vs `آڈیو`. I re-derived
  each from the corpus before reading that receipt's conclusions, and I agree with all of them;
  its `findings: []` on the 10 keys is supported by what I measured. Its style-guide hash
  (`7276e96…`) is `origin/main`'s copy; the working tree here is `c0eecf7…` — same guide for this
  scope, one added macOS clause.

## Limitations (stated, not implied)

- Catalogue audit only. No rendered frame, no activation run, no packaging and no release claim.
- The `$0` question in NIT-1 was measured with FriBidi, not with Chromium/Electron; the
  rendered answer is still open and belongs to design/QA.
- Integrity was checked against `origin/main` as it stands in this worktree's
  `refs/remotes/origin/main` (`9ef579fe12a`). A later main would need the check re-run.
- I did not run the ledger gate or the ledger writer; the integrator owns those, and the
  receipt in this directory is what they consume.

## Artifacts

- `audit.log` — every command run here with its real output (the first bidi block is marked
  SUPERSEDED; the corrected assertion run follows it).
- `integrity.py`, `check-icu.mjs`, `check-mutants.mjs`, `typography.py`, `bidi-evidence.py` —
  the checkers, kept so the numbers can be reproduced.
- `receipt.json` — the ledger receipt for this audit.
- `record.json` — the retention record (same provenance).
