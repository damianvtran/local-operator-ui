# ur · `ui.chat.canonical` · s16a tool-state words — independent audit

- **Verdict: clean-with-findings (status `passed`)** — blocker 0 · major 0 · minor 1 · nit 3
- Locale: `ur` (RTL) · namespace (file group): `ui.chat.canonical` · audit id: `s16a-au-ur`
- Branch `feat/i18n-s16a-tool-state-words` · worktree `~/local-operator-ui/.worktrees/i18n-s16a` · HEAD `93a61605b059ada503d75da6e9e38e8ef14e1b67` · base `5acfe0a2d92365b7c9b029a9d870326d9b022d25`
- Draft audited: `$LOCAL_OPERATOR_SCRATCHPAD/s16a-drafts/ur-s16a.json` (manager session scratchpad `3ef6295a5545`), sha256 `d29803e14b77a500f91f59651fe3858eed4cfe74a0f1330e5826bb45877b5c72` — matches the hash I was given.
- Inputs and hashes: see `record.json`.

## Independence

I did not translate these values and cannot edit them: the draft is a different agent's work
(`i18n-translator`, model `anthropic/claude-sonnet-5-5`) and I read it only. I am
`i18n-auditor`, session `b97613446a7a`, served model `deepseek/deepseek-flash` (session
default, no provider fallback occurred in this run). No translation/MT service was used to
compare or back-translate; every judgment below is reasoning over the English source, its
context sidecar, the shipped `ur` corpus and the locale style guide/glossary.

## Scope

The 14 new English keys (`tool.composing_sized`, `tool.composing_empty`, `tool.queued_sized`,
`tool.queued_empty`, `image_gen.state.{queued,writing_request,queue_ahead,running,running_batch,done,done_batch,already_finished,failed,failed_batch}`).
Derived from the branch diff rather than assumed: `git diff 5acfe0a2d92..HEAD` on
`en/ui.chat.canonical.json` shows 14 genuinely new keys plus `tool.never_sent_empty`
re-inserted by the same line rewrite — that key already shipped at the base
(`git show 5acfe0a2d92:src/i18n/catalogues/ur/ui.chat.canonical.json` contains it, as does the
current `ur` file), so it is correctly outside this group.

## 1. Mechanical — all pass

- **JSON valid; key set exact.** The draft has exactly the 14 keys, none added or dropped.
  The `ur` catalogue on this head (442 keys) does not yet carry them — expected, translations
  are pending merge.
- **AST/placeholder parity with English** (`intl-messageformat` `getAst()`, argument names,
  plain vs structural use, and each `select`/`plural` option-key set compared):
  `ok` for all 14 keys — `{size}`, `{count}`, `{total}`, `{material}` names and kinds
  identical; `material` select carries exactly `video | voiceover | sound_effect | other` in
  all six select keys; `total`/`count` plurals carry exactly `one | other`.
- **ur CLDR categories present.** `Intl.PluralRules("ur")` needs `one, other` only;
  samples 0,1,2,3,5,11,21,22,100,1000000 → `other,one,other,other,other,other,other,other,other,other`.
  Both categories are present in `queue_ahead` and in every one of the four
  `running_batch` branches.
- **`::group-off` and `#` intact.** Formatting `1000000` renders `1000000` (ungrouped) inside
  Urdu text, matching the English branch; `#` renders the count in all eight nested plural
  branches (outputs below).
- **Typographic invariance.** Separator is U+00B7 with single ASCII spaces (`20 B7 20`) in both
  `*_sized` keys; ellipsis U+2026 in `writing_request`, `running`, `running_batch`; full stop
  U+06D4 (۔) in `already_finished`, `failed`, `failed_batch`. Code-point scan over all 14
  values: no ASCII `.`, no `...`, no U+2022 bullet, no Devanagari ।, no Arabic-Indic digits
  (U+0660–0669, U+06F0–06F9), no Arabic `،`/`؟`, and **no bidi control characters**
  (U+200E/200F/202A–202E/2066–2069) — which is what the style guide requires (manual controls
  are double-applied by the render layer) and what `scripts/i18n/ur-activation.test.mjs` gates.
- **English leakage: none in these values.** The only Latin in the draft is ICU syntax
  (`size`, `count`, `total`, `material`, `select`, `plural`, `number`, `group-off`, and the
  branch selectors), i.e. structure, not copy.

Not run: the repo's `check-i18n` validator family, because it reads committed catalogue files
and the ledger, and this draft is not in the repo (read-only audit). I replicated the
predicates it applies to these values — AST parity, plural-category coverage,
control-character ban, punctuation/code-point scan — directly, and every one is reported above
as executed.

## 2. ICU formatting evidence (actually run)

`node` + the worktree's `intl-messageformat@12.1.3`, `new IntlMessageFormat(value, "ur")`,
counts 0,1,2,3,5,11,21,22,100,1000000 and all four materials. Selected actual output:

| key | input | output |
|---|---|---|
| tool.composing_sized | size=12.4 KB | `لکھا جا رہا · 12.4 KB` |
| tool.composing_sized | size=0 B | `لکھا جا رہا · 0 B` |
| tool.queued_sized | size=1.2 MB | `قطار میں · 1.2 MB` |
| tool.composing_empty | – | `لکھا جا رہا` |
| tool.queued_empty | – | `قطار میں` |
| state.queued | – | `قطار میں` |
| state.writing_request | – | `درخواست لکھی جا رہی ہے…` |
| state.queue_ahead | 0 / 1 / 2 / 100 / 1000000 | `0 آگے` / `1 آگے` / `2 آگے` / `100 آگے` / `1000000 آگے` |
| state.running | video / voiceover / sound_effect / image | `ویڈیو تیار کی جا رہی ہے…` / `وائس اوور تیار کیا جا رہا ہے…` / `صوتی اثر تیار کیا جا رہا ہے…` / `تصویر تیار کی جا رہی ہے…` |
| state.running_batch | video 1 / video 2 | `1 ویڈیو تیار کی جا رہی ہے…` / `2 ویڈیوز تیار کی جا رہی ہیں…` |
| state.running_batch | voiceover 2 | `2 وائس اوورز تیار کیے جا رہے ہیں…` |
| state.running_batch | sound_effect 2 | `2 صوتی اثرات تیار کیے جا رہے ہیں…` |
| state.running_batch | image 2 | `2 تصاویر تیار کی جا رہی ہیں…` |
| state.done | video / voiceover / sound_effect / image | `تیار کردہ ویڈیو` / `تیار کردہ وائس اوور` / `تیار کردہ صوتی اثر` / `تیار کردہ تصویر` |
| state.done_batch | video / voiceover / sound_effect / image | `ویڈیوز کا مجموعہ` / `وائس اوورز کا مجموعہ` / `صوتی اثرات کا مجموعہ` / `تصاویر کا مجموعہ` |
| state.already_finished | – | `یہ پہلے ہی مکمل ہو چکا ہے۔` |
| state.failed | video / voiceover / sound_effect / image | `ویڈیو تیار نہیں کی جا سکی۔` / `وائس اوور تیار نہیں کیا جا سکا۔` / `صوتی اثر تیار نہیں کیا جا سکا۔` / `تصویر تیار نہیں کی جا سکی۔` |
| state.failed_batch | video / voiceover / sound_effect / image | `ویڈیوز کا مجموعہ تیار نہیں ہو سکا۔` / `وائس اوورز کا مجموعہ تیار نہیں ہو سکا۔` / `صوتی اثرات کا مجموعہ تیار نہیں ہو سکا۔` / `تصاویر کا مجموعہ تیار نہیں ہو سکا۔` |

No compile error, no leftover braces, no `#`/`::group-off` leakage into output, in any run.

## 3. Accuracy and grammar (incl. gender agreement per material)

| material | grammatical gender (evidence) | agreement in the draft |
|---|---|---|
| ویڈیو | feminine — shipped `ui.canvas.video_preview.this_video_could_not_be_played` = `یہ ویڈیو نہیں چلائی جا سکی` | singular `کی جا رہی ہے`, plural `کی جا رہی ہیں`, failure `نہیں کی جا سکی` ✓ |
| تصویر | feminine | same feminine pattern ✓ |
| وائس اوور | masculine | `کیا جا رہا ہے`, plural `کیے جا رہے ہیں`, failure `نہیں کیا جا سکا` ✓ |
| صوتی اثر | masculine | `کیا جا رہا ہے`, plural `کیے جا رہے ہیں`, failure `نہیں کیا جا سکا` ✓ |

- No omission, addition, negation or polarity error in any of the 14 values; every failure
  string states the negative once and nothing else (no apology, no cause — as the sidecars
  require). `already_finished` claims completion only, no duration.
- Meaning of the count datum is preserved as *requests ahead*, not a rank: `0 آگے`…`100 آگے`
  follow the English `0 ahead`…`100 ahead` exactly, and 0 does not become a position.
- The batch lines keep the noun-phrase shape (`done_batch`) versus the failure sentence shape
  (`failed_batch`), matching the English split and the sidecar note ("do not build it from the
  batch title").
- Register: terse, no copula padding in the tool rows (parallel to shipped
  `ui.chat.canonical.tool.never_sent_composed` = `نہیں بھیجا گیا · {size} لکھا گیا`);
  no `!`, no `براہ کرم`, no second person where English has none; `آپ` policy not exercised.

## 4. Terminology — translator claims verified against the shipped corpus

| claim | verdict |
|---|---|
| image `تصویر` / `تصاویر` | ✓ `ur/ui.chat.canonical.json:image_label` = `تصویر`; `fold.more_images` = `… مزید تصاویر` |
| video `ویڈیو` fem, `ویڈیوز` | ✓ `ui.canvas.file_rows.video` = `ویڈیو`, `ui.canvas.files.videos` = `ویڈیوز`, fem agreement at `ui.canvas.video_preview.this_video_could_not_be_played` |
| queued `قطار میں` | ✓ `ui.settings.imports.state_queued` = `قطار میں`; `ui.chat.status.degraded` = `… آپ کے پیغامات قطار میں ہیں۔` |
| generating `تیار کیا جا رہا ہے` | ✓ `ui.chat.checkpoint.generating_name` = `نام تیار کیا جا رہا ہے…` |
| generated `تیار کردہ` | ✓ (citation imprecise: the key is `ui.library.origin.generated`, not `ui.library:generated`) |
| composing `لکھا جا رہا` | ✓ parallel register to `tool.never_sent_composed`; the fragment-without-copula style is shipped, not invented |
| request `درخواست` | ✓ same card's shipped `sound.stop.confirm_label` = `روکنے کی درخواست کی تصدیق` |
| voiceover `وائس اوور` | confirmed NEW: no shipped `ur` value contains `وائس اوور` |
| sound effect `صوتی اثر` | confirmed NEW: no shipped `ur` value contains `صوتی` (see UR-1) |
| batch `مجموعہ` | no shipped term for a runtime batch; `مجموعہ` is used elsewhere as "collection" (see UR-2) |

## 5. Fit / width (measured, Arabic script ≈ 1 cell per code point per the ur guide)

| key | ur cells | en cells |
|---|---|---|
| tool.composing_sized (`… · 12.4 KB`) | 20 | 18 |
| tool.queued_sized (`… · 12.4 KB`) | 17 | 15 |
| tool.composing_empty / queued_empty | 11 / 8 | 9 / 6 |
| state.queued | 8 | 6 |
| state.writing_request | 23 | 20 |
| state.queue_ahead (rendered `2 آگے`) | 5 (datum only, no wrap: `shrink-0`) | 7 |
| state.running (video/voiceover/sound_effect/image) | 24 / 29 / 28 / 24 | 17 / 21 / 24 / 17 |
| state.running_batch n=2 | 28 / 33 / 33 / 28 | 20 / 24 / 27 / 20 |
| state.done | 15 / 19 / 18 / 15 | 15 / 19 / 22 / 15 |
| state.done_batch | 16 / 20 / 20 / 16 | 11 / 15 / 18 / 11 |
| state.failed | 26 / 31 / 30 / 26 | 33 / 37 / 40 / 33 (ur shorter ✓) |
| state.failed_batch | 34 / 38 / 38 / 34 | 19 / 23 / 26 / 19 |

Reading the layout rather than assuming it: the tool-row object column truncates by default
(`src/renderer/src/features/chat/components/trace/tool-row.tsx:248,906` — `summaryWrap`
defaults false and only the dismissed row passes true), so the two `*_sized` rows lose ~2 cells
of headroom and the tail that can be clipped is the size datum. The generation-card state line
does **not** truncate or nowrap (`image-gen-card.tsx:464-466`: `flex min-w-0` + a `min-w-0` span),
so the longer Urdu state lines wrap instead of clipping. See UR-4.

## 6. bidi / RTL specifics (the group's special ask)

- **`{size}` (`12.4 KB`) inside the two `*_sized` keys — no manual isolation needed, and none
  may be added.** The value is not in the catalogue at all; `needsIsolation("12.4 KB")` is
  `true` because it contains a Latin letter (`src/i18n/bidi.ts:113-119`, `LATIN_OR_KEYGLYPH`),
  so `translate()` wraps it in FSI…PDI for an RTL-answered message
  (`src/i18n/bidi.ts:127-141`, called at `src/i18n/messages.ts:239`). The isolate gives the
  size its own LTR run, so `12.4 KB` cannot paint as `KB 12.4`. Inserting RLM/FSI in the
  catalogue would double-apply it, which is exactly what the ur guide forbids — the draft
  correctly inserts none (code-point scan in §1).
- **Middle-dot separator order.** The message is stored logically and the dot is inside the
  message, so in the RTL paragraph the status word paints rightmost, the `·` in the middle and
  the size leftmost — the mirror of the English order, which is the intent. Storage order
  (`status SPACE U+00B7 SPACE size`) is byte-identical to the English shape.
- **Digits inside RTL runs.** `queue_ahead` starts with a weak digit: in an RTL paragraph the
  European-number run keeps LTR order and paints first (rightmost), so it reads `2 آگے` in
  reading order — correct, no isolation needed (a bare number is deliberately not isolated,
  `src/i18n/bidi.ts:59-65`). The state line's datum additionally renders inside
  `<bdi dir="auto">` with `· ` **outside** the isolate (`image-gen-card.tsx:468-476`); for
  `2 آگے` `dir=auto` resolves RTL from آگے, and for a size datum it resolves LTR. Both correct.
- No Latin path/token appears in these 14 values, so the sigil/URL cases do not arise.

## 7. Findings

### UR-1 — MINOR — terminology consistency with shipped sound copy
Key: `ui.chat.canonical.image_gen.state.{running,running_batch,done,done_batch,failed,failed_batch}` (sound_effect branch).
Current: `صوتی اثر` / `صوتی اثرات`.
Problem: the same generation is named differently in the same card. Shipped `ur` calls it
`آواز`/`آڈیو`: `ui.chat.canonical.sound.stop.question` = `آواز کی تخلیق روکیں؟`,
`sound.stop.warning` = `… تخلیق جاری رہے گی اور آڈیو بننے پر لاگت لگے گی`, `sound.player_failed`
= `یہ آواز نہیں چلائی جا سکی`. A user who sees `صوتی اثر تیار کیا جا رہا ہے…` and then opens
that stop confirmation reads two names for one thing. The glossary's invariant is one term per
concept where the locale already names it.
Why MINOR and not MAJOR: the meaning is right, the coinage is transparent, and the
translator's stated reason is sound — shipped `آواز` is also the word for the assistant's
*voice* (`ui.settings.speech.speech_section.*`), and this card's `voiceover` material sits in
the same select, so `آواز` alone would blur the two materials.
Corrected value: none forced. Preferred: keep the draft values and record `صوتی اثر / صوتی اثرات`
as the endorsed material noun in `i18n/style-guides/ur.md`, then align the shipped
`sound.stop.question` / `sound.stop.warning` / `sound.player_failed` copy to the same noun in a
later wave. If the wave prefers one word now, the consistent set is (note: `آواز` is feminine,
so every aux agrees feminine): running `آواز تیار کی جا رہی ہے…`; running_batch one
`# آواز تیار کی جا رہی ہے…` / other `# آوازیں تیار کی جا رہی ہیں…`; done `تیار کردہ آواز`;
done_batch `آوازوں کا مجموعہ`; failed `آواز تیار نہیں کی جا سکی۔`; failed_batch
`آوازوں کا مجموعہ تیار نہیں ہو سکا۔`

### UR-2 — NIT — `done_batch` "مجموعہ" sits at the literary end of the register
Key: `ui.chat.canonical.image_gen.state.done_batch` → `ویڈیوز کا مجموعہ` / `وائس اوورز کا مجموعہ` / `صوتی اثرات کا مجموعہ` / `تصاویر کا مجموعہ`.
Problem: `مجموعہ` is the corpus's formal "collection" noun (a compendium, an issue); a runtime
batch label reads a shade elevated for a one-line state. It is not wrong and no better single
word exists (`بیچ` is a worse loanword), so no change is required — recorded for the guide.

### UR-3 — NIT — `already_finished` uses the masculine default beside feminine materials
Key: `ui.chat.canonical.image_gen.state.already_finished` → `یہ پہلے ہی مکمل ہو چکا ہے۔`
Problem: the card's subject may be feminine (`ویڈیو`, `تصویر`), where a careful writer might
write `مکمل ہو چکی ہے`. Urdu's default for an unspecified subject is masculine singular and the
key carries no material branch, so this is defensible; noted because a second reader may raise
it. No change required.

### UR-4 — NIT — fit watch on the two truncating `*_sized` rows
Keys: `tool.composing_sized` (20 cells vs 18), `tool.queued_sized` (17 vs 15).
Problem: the object column truncates, and the ~2 extra cells mean the trailing size datum is the
first thing clipped, slightly earlier than in English. The shipped sibling
(`نہیں بھیجا گیا · {size} لکھا گیا`) is far longer in the same column, so this is consistent
with existing practice rather than a regression. No change required; recorded so rendered QA can
look at it.

## 8. The translator's "unsure" items, judged

1. **`وائس اوور` vs `صوتی تبصرہ`** — `وائس اوور` is right. `صوتی تبصرہ` means an audio commentary
   track, a different artefact; the loanword is settled in Urdu media writing and the guide
   permits Urdu-script loanwords (`سیشن، ٹوکن، فائل`). Keep.
2. **`queue_ahead` with identical `one`/`other` and bare `آگے`** — correct. ur needs only
   `one, other` (verified with `Intl.PluralRules`), English is identical in both branches too,
   and the noun is elided there because the card already says `قطار میں`. `0 آگے` reads as
   "nothing ahead", not a rank, matching the sidecar's explicit warning. Keep.
3. **Voiceless passives in the tool rows** — verified against shipped
   `tool.never_sent_composed`; the fragmentary register is the shipped one, not an invention.
   Keep.

## 9. Second pass (independent re-read, as requested for a visible group)

I re-read all 14 values a second time in a different order, against the English one key at a
time, with the failure/negative strings and the batch shapes read first (the order in which a
mis-read polarity error would surface). It produced no new finding and no reclassification: the
polarity of `failed`/`failed_batch` is single-negative in all four branches, `already_finished`
claims no duration, `done_batch`/`failed_batch` keep the noun-phrase versus sentence split, and
the gender pattern in §3 holds per material. Findings stay at 1 minor + 3 nit.

## 10. Out-of-scope observation (English still visible in the same card — not a defect of these keys)

While reading the card to judge register I found English copy that the draft cannot fix:
- `src/renderer/src/features/chat/canonical/image-gen-card.tsx:456` —
  `` `${batchMaterialTitle(view.material ?? "sound-effect")} batch stopped.` ``, and
  `imageGenMaterialNoun` (`image-gen-card-model.ts:244`) returns English nouns (`video`,
  `voiceover`, `sound effect`, `image`), so a stopped batch shows English in `ur` and `fr`.
- `image-gen-card-model.ts:217-222` — `CANCEL_QUEUED_COPY`, `CANCEL_RUNNING_COPY` and
  `AUDIO_RATE_LIMITED_COPY` are hard-coded English literals used as state text.

Under the operator's acceptance ("no English anywhere"), these belong to a later keying slice,
not to this review; flagging them so the manager can place them.

## 11. Honest gaps

- I am not a native speaker; the idiom/register judgments are reasoning over the shipped corpus
  and the guide, not lived fluency.
- No rendered frame: I did not run the app. Widths are measured code-point counts under the
  guide's ≈1 cell/character rule, not painted geometry, and I did not verify whether the
  generation card has a fixed height that would clip a wrapped two-line state line.
- The repo's own `check-i18n` gates cannot vet an unmerged draft; I replicated their predicates
  (see §1) but did not run `pnpm check-i18n` against this branch.
- Ledger/receipt: nothing written to the repo (read-only audit). The `ur` row for
  `ui.chat.canonical` currently records `source_sha256 38f1069…`, which the 14 new English keys
  invalidate; once the translation lands, that row needs the merged catalogue hash, a fresh
  auditor entry and a receipt — my `record.json` carries the shapes and the hashes I derived so
  the implementer can paste them.
