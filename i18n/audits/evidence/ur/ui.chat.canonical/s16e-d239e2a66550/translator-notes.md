# s16e — `ur` (Urdu, RTL) translation notes

Slice: 12 keys, namespace `ui.chat.canonical`, generation card stop / settlement /
failure-class copy. Translator: i18n-translator (ur), session 67f256dc8662,
model `deepseek/deepseek-flash` (no fallback used).

Draft: `draft-ur-s16e.json` (this scratchpad), sha256
`e9666a75e6d318448b530290d99ab3c88b8a29901e3fa8beeb5c3411f7fa4051`.

## Inputs read (path · sha256)

| Input | Path | sha256 |
|---|---|---|
| Slice brief (en source + context sidecars) | `~/.local-operator/sessions/3ef6295a5545/scratchpad/s16e-brief.json` | `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` (matches the expected hash) |
| en catalogue (source of truth for the 12 values) | worktree `src/i18n/catalogues/en/ui.chat.canonical.json` | `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| ur catalogue (shipped terminology on this surface) | worktree `src/i18n/catalogues/ur/ui.chat.canonical.json` | `fd1116ccb5e847eb7f28c4cf5d1084efad95edf52d638d1a6144e065ce7d98a7` |
| UI i18n HOWTO (contract) | worktree `docs/I18N.md` | `d58ad473701f098b3c2c24343c3a7e7236f22db22cc871016c4cb75f25f41f5c` |
| Core i18n RFC (contract §§2, 4, 6) | `~/local-operator/docs/design/i18n.md` | `92eca5a123b65c4dea7e7ec2db9ddd4fec0b04c0fa038d10ba540e30f0d7e096` |
| Glossary (binding per-term decisions) | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| ur style guide (binding, locale-specific) | `~/local-operator/i18n/style-guides/ur.md` | `c0eecf7f7b5e89956b7de9ab7a9eb647ff1a7ef701ccf2a7f0264d5eea15ca60` |

Worktree: `~/local-operator-ui/.worktrees/i18n-s16e` @ `bd8e90542506e8bec4a98862b868095409b28329`
(PR damianvtran/local-operator-ui #1884). Read-only: I wrote nothing into it.

`docs/design/i18n.md` does **not** exist in the UI worktree at that SHA (the UI
HOWTO links the core repo's copy and that is the file above; `git ls-files` in
the worktree lists no `docs/design/i18n*`). Read from the core repo instead.

## Register and address

- **آپ** throughout (style guide §Formality): `آپ سے کوئی چارج نہیں لیا جائے گا`.
  Respectful imperative for the one instruction (`دوبارہ کوشش کریں`), matching
  the shipped `ui.chat.canonical.image_gen.control.restart` = «دوبارہ شروع کریں».
- Terse, everyday educated Urdu; no Hindi-ised or over-Persianised vocabulary,
  no exclamation marks, no padding.
- The English's terse noun-phrase register for the failure-class labels is kept
  (no verbs added except the established `ناکام` pairing), because these are
  labels above a sentence, per the sidecars.

## Term decisions (evidence from the shipped ur catalogue)

| English | ur | Evidence |
|---|---|---|
| provider | فراہم کنندہ | `image_gen.control.stop_hint_queued`, `sound.stop.warning`, `transcript.connect_provider` — the same word on this very surface |
| charge | چارج | `sound.cost.no_charge` «کوئی چارج نہیں۔», `sound.cost.estimated_zero` «حتمی چارج کی تصدیق نہیں ہوئی» |
| cost/lāgat | لاگت | `sound.cost.unknown`, `sound.stop.warning` — kept for cost *amounts*, not used for the charge facts in this slice |
| stopped | روک دیا گیا | `transcript.stopped_before_finishing` «…روک دیا گیا»; `control.stop` «روکیں» |
| stop request | روکنے کی درخواست | `sound.stop.request_stop`, `sound.stop.confirm_label` |
| endpoint (kept Latin) | `endpoint` | `sound.stop.warning` leaves it Latin; glossary §Wave-2 kept-English set |
| batch | مجموعہ | `image_gen.state.failed_batch` «… کا مجموعہ تیار نہیں ہو سکا۔» — the sibling line this one must read as the same family |
| video / voiceover / sound effect | ویڈیوز / وائس اوورز / صوتی اثرات | same `failed_batch` branch nouns, reused verbatim |
| tool | ٹول | glossary §2 (tool → ٹول); 55 occurrences, e.g. `code_review.tool.more` |
| arguments | آرگیومنٹس | `ui.settings.integrations.add_integration_form.arguments` «آرگیومنٹس», `ui.chat.pickers.destination_pickers.argument` |
| duplicate | مکرر | `ui.mesh.mesh_drop.duplicate_key` «… کی کلید مکرر ہے» |
| id (kept Latin) | `id` | `transcript.job_suffix` «· جاب {id}»; identifier, glossary §1 |
| denied/refused | مسترد | 66 occurrences, e.g. `ui.common.errors.desktop_refusal.refused`, `ui.chat.composer_notes.default_not_saved_fallback` «بیک اینڈ نے اسے مسترد کر دیا» |
| gate | گیٹ | `ui.chat.pickers.goal.placeholder` «تمام گیٹس کامیاب ہونے پر…» — already transliterated in shipped copy |
| rate limit | شرح کی حد | `ui.chat.error_block.rate_limit.before` «… شرح کی حد تک پہنچ گئے ہیں»; label uses the adjective form (see judgement calls) |
| busy | مصروف | `ui.chat.canonical.send_failure.busy`, `ui.agents.publication.pull.busy` |
| pending | زیر التوا | `ui.chat.canonical.tool_row.pending` «زیر التوا», `ui.nativeBadge.nativeBadge.pending` |
| to appear | دکھائی دے گا | `tool_row.bridge.delivery.inbox_only.note` «… دکھائی دے گا» |

No English words remain except `endpoint` and `id`, both kept for the reasons
above and both already Latin in shipped ur copy.

## Judgement calls (one line each)

1. `state.cancelled_batch` — reuses `failed_batch`'s exact branch nouns and the
   impersonal passive (`روک دیا گیا`) used by `transcript.stopped_before_finishing`,
   so the two batch state lines read as one family; each branch is a whole
   translated sentence naming the material, ICU keywords left English.
2. `cancel.queued` — «کال کیے جانے سے پہلے» mirrors the shipped
   `stop_hint_queued` construction «درخواست بھیجے جانے سے پہلے», and «آپ سے کوئی
   چارج نہیں لیا جائے گا» states the no-charge promise flatly rather than
   softening it into a maybe.
3. `cancel.running` — «روکنے کی درخواست دی گئی۔» announces the request without
   implying it took effect; the second sentence reuses `sound.stop.warning`'s
   own wording «فراہم کنندہ کے پاس منسوخی کا endpoint نہیں ہے» and «تخلیق جاری
   رہے گی», and carries the charge condition as «آڈیو بننے پر چارج لگے گا» —
   the same «بننے پر» conditional the shipped warning uses, so no version reads
   as a guarantee of no charge.
4. Semicolon kept as ؛ in keys 2 and 3 — the three existing ur values with
   «؛» (`sound.stop.warning`, `stop_hint_running`, `cost.estimated_zero`) show
   it is live in this catalogue and it carries the same clause-join as English.
5. `cancel.checking` — «تصفیے کی جانچ جاری ہے۔» keeps the present-progressive
   status force of "Checking…", uses the established `جانچ` verb root
   (`checked_console` «کنسول جانچا»), and stays a complete sentence with its own
   full stop because the callsite joins it to `cancel.running`.
6. `settlement.pending` — em dash **kept**. The brief allows the locale's own
   natural punctuation; the ur catalogue already ships six values using «—» as
   an appositive break (e.g. `older_history.windowed.title_gesture`, `notice.
   compaction_not_run_after_colon`), so replacing it would be a needless
   divergence. «زیر التوا ہے» supplies the finite verb the bare «زیر التوا» label
   lacks; «فراہم کنندہ کی رپورٹ آنے پر دکھائی دے گا» states the outstanding charge
   without an amount and without a zero.
7. `error.audio_rate_limited` — «ابھی مصروف ہے۔ تھوڑی دیر بعد دوبارہ کوشش
   کریں۔» reuses `pull.busy`'s exact second sentence «تھوڑی دیر بعد دوبارہ کوشش
   کریں۔» (so no specific wait time is implied), and commits to no success
   promise.
8. `error_class.audio_rate_limited` — «آڈیو کی شرح محدود» (adjective form of the
   established «شرح کی حد»). Considered and rejected «آڈیو کی شرح کی حد»: it
   reads as a bare noun heading and drops "limited"; «شرح» is the repo's word
   for *rate* (`کیش ہٹ کی شرح`, `ڈیکوڈ کی رفتار`).
9. `error_class.invalid_arguments` — «غلط آرگیومنٹس» keeps the established
   `آرگیومنٹس` loanword; «ناجائز» has no precedent in ur copy and reads heavier
   in label register.
10. `error_class.duplicate_id` — «مکرر id» puts the Urdu modifier first and keeps
    `id` Latin (bidi isolation is the render layer's job; no control characters
    inserted, per the style guide).
11. `error_class.denied` — one word «مسترد», the catalogue's word for a refused
    request/credential; «انکار» is the noun for declining an invitation
    (`teamBridge.invitations.decline`) and would drift.
12. `error_class.gate_failed` — «گیٹ ناکام», label-shaped like the shipped
    «کال مکمل» (`tool_row.generic_verb.settled`) and «ناکام».

## Width

Labels (must not wrap — the sidecars cap them at 1–3 words):

| key | en chars | ur chars |
|---|---|---|
| error_class.audio_rate_limited | 17 | 17 |
| error_class.unknown_tool | 12 | 11 |
| error_class.invalid_arguments | 17 | 13 |
| error_class.duplicate_id | 12 | 7 |
| error_class.denied | 6 | 5 |
| error_class.gate_failed | 11 | 9 |

No sidecar gave `maxCells`, so parity with the English cell count is the budget
I held to; every label is at or under the English length in characters, and the
style guide measures Arabic script at ≈1 cell per character. The four sentence
keys are longer than English in characters as expected for ur; all four wrap
inside the card per their sidecars. Nothing was truncated.

Plurals: none of the 12 keys carries a plural argument (the only ICU argument is
the `{material}` select), so the ur `one`/`other` categories are not engaged by
this slice.

## ICU structure check (actually executed)

The repo's catalogue validator cannot run here: I am read-only on the worktree
and my draft lives outside any catalogue, so there is no catalogue to validate.
Instead I ran a single small node script (0.2 s, no installs, no builds) that
requires the ICU parser and formatter from the **primary checkout's** existing
`~/local-operator-ui/node_modules` (`@formatjs/icu-messageformat-parser`,
`intl-messageformat`, no writes) and checked:

- every one of the 12 values parses;
- vs the English AST: same argument names, same argument kinds, same select
  option keyword set (`video` / `voiceover` / `sound_effect` / `other`) and no
  added or dropped argument;
- every `{material}` branch renders under locale `ur` (all four materials);
- ending-punctuation parity with English (full stop where the English has one,
  none on the six labels);
- NFC normalisation of every value.

Result: `STRUCTURE: PASS (0 failures)` (first pass flagged two checker bugs of my
own — literal-text comparison and a punctuation rule that ignored the label
register and the select key — both fixed in the checker, not by changing copy).

Script: `icu-check-ur-s16e.cjs` in this scratchpad.

## Glossary proposals

- `settlement` → **تصفیہ** (financial settlement of the final charge; no repo
  precedent — `حتمی چارج کی تصدیق` is the neighbouring phrase, kept for
  confirmation wording). Used in `cancel.checking` and `settlement.pending`.
- `charge` → **چارج** as the noun for a billed amount, distinct from `لاگت`
  (cost). Already de facto in the catalogue; propose recording the pair.
- `rate limit` → **شرح کی حد** (noun) — already in use; propose recording it and
  that the label/adjective form is **شرح محدود**.
- `gate` (policy gate) → **گیٹ** (transliterated, already in shipped copy;
  plural گیٹس). Worth a glossary row so future waves do not reach for a
  different word.
- `arguments` (of a tool call) → **آرگیومنٹس** (already in use) — propose a row
  so it is not later "corrected" to دلائل, which in ur also means *reasons*.

## Open questions

1. `settlement` is a new noun for the ur catalogue. If the auditor prefers to
   stay with shipped vocabulary, the fallback is «حتمی چارج کی تصدیق» in both
   settlement keys — it costs length in `cancel.checking` (3 → 5 words) but uses
   only existing terms.
2. `error_class.audio_rate_limited` offers «آڈیو کی شرح محدود» (chosen) vs
   «آڈیو کی شرح کی حد» (noun form, closer to the dictionary collocation, reads
   as a heading). Either is defensible; the adjective form keeps "limited".
3. `state.cancelled_batch` asserts «روک دیا گیا» (stopped) although
   `cancel.running` says a stop is only a request for the in-flight case — the
   English source makes the same assertion, so I matched the source rather than
   weakening it. Flagging in case the state copy is revised.

I did not audit this locale; a separate i18n-auditor owns that.
