# i18n audit — `hi`, ui.chat.canonical (s16a, 14 new keys)

- **Audit id:** `s16a-au-hi` · **locale:** `hi` · **namespace:** `ui.chat.canonical`
- **PR:** damianvtran/local-operator-ui#1870 · **branch:** `feat/i18n-s16a-tool-state-words`
- **Head audited:** `93a61605b059ada503d75da6e9e38e8ef14e1b67` (worktree `~/local-operator-ui/.worktrees/i18n-s16a`, read-only)
- **Translator draft:** `$SCRATCHPAD(manager 3ef6295a5545)/s16a-drafts/hi-s16a.json`,
  sha256 `2b7d98192ccbe13deb01e0b24c2cad296c21fcdb1514cf50a56924f0dd685db6` (recomputed here — matches the brief)
- **Date:** 2026-11-11

## Verdict

**clean** — counts: **{blocker: 0, major: 0, minor: 0, nit: 0}**. `passed` (no BLOCKER/MAJOR).

The flagged `इमेज` vs `तस्वीर` choice is **correct**: keep `तस्वीर`.
Everything else in the draft is accurate, idiomatic, gender/number-agreeing and ICU-clean.
Three defensible departures are judged explicitly in §8 and are **not** recorded as findings
(they are not defects; recording them would downgrade the ledger row to
`clean-with-findings` for no copy change).

**Auditor:** `i18n-auditor` · model `deepseek/deepseek-flash` (session header, no fallback observed)
· session `2bc153cbf350` · instance `2bc153cbf350-s16a-au-hi`.
**Independent from the translator:** yes — the translator is a different agent on
`anthropic/claude-sonnet-5-5` (LLM translator lane). I did not translate these files, did not edit
them, and made no catalogue/ledger/commit change in the repo. I used no translation/MT service and
no back-translation; the verdict is my own native-reader reasoning over source, sidecar, call
sites, shipped hi catalogue and the hi style guide/glossary.

## Headline: the `इमेज` vs `तस्वीर` judgement (task item)

Counted by script over **all 9 086 shipped `hi` keys** (`src/i18n/catalogues/hi/*.json` @ `93a6160`):

| rendering | keys | occurrences | what it is |
|---|---|---|---|
| **तस्वीर** | 88 | 105 | the everyday noun for a picture/image: attachments, avatars, **and generation-run images** |
| **इमेज** | **2** | **2** | *only* inside the fixed compound `इमेज जनरेशन` |
| चित्र | 7 | 7 | "pictures" folder label, avatar source, FAL credential blurb |
| छवि | 5 | 5 | formal register: avatar decode/size errors, `ui.common.viewer.image_progress` |
| फ़ोटो | 13 | 15 | profile photo |

The two `इमेज` hits are `ui.chat.canonical.image_gen.progress` = "इमेज जनरेशन की प्रगति"
(en "Image generation progress", a progressbar `aria-label`) and
`ui.onboarding.tour.radient_account_settings.body.1` ("… वेब खोज, इमेज जनरेशन और बहुत कुछ …").
**In neither does `इमेज` stand alone as a countable noun** — it is the first half of the feature name
`इमेज जनरेशन`, itself carrying the English loan `जनरेशन`.

The four shipped keys that render an image *produced by a generation run* — i.e. the exact referent
the 14 new keys need — all say **तस्वीर**:

- `ui.chat.canonical.image_label` = "तस्वीर" (default label/title for an image, `canonical-transcript.tsx:3329`)
- `ui.chat.canonical.fold.images_aria` = "इस रन की {count_display} तस्वीर / तस्वीरें" (`fold-media.tsx:303`)
- `ui.chat.canonical.fold.more_images` = "+{count_display} और तस्वीर / तस्वीरें"
- `ui.chat.canonical.lightbox.show_image` = "कुल {count} में से तस्वीर {index} दिखाएँ" (`image-group-lightbox.tsx:448`)

**Judgement: `तस्वीर`.** Four same-family shipped keys, 105 vs 2 occurrences, an established plural
(`तस्वीर` → `तस्वीरें`, oblique `तस्वीरों`) that the drafted plural branches need, feminine agreement
that the draft gets right (`बन रही है / बन गई / बनाई जा सकी`), and the hi style-guide rule to prefer
the settled Hindi term over a loan where one exists. `इमेज` would also have forced a new plural
(`इमेजें`) with no shipped precedent. The translator's choice is endorsed; its **note understates the
margin** ("5 uses vs 1" — the real ratio is 88 keys/105 occurrences vs 2), so the decision is stronger
than the note claims.

## Translator claim verification (file:key checks the brief asked for)

Every reuse the notes cite was opened and confirmed; nothing was taken on trust:

| claim | verified? |
|---|---|
| queued → "कतार में" at `ui.chat.aside.adopt.queued`, `ui.chat.ask_queue.status.open`, `ui.chat.pickers.info_model.queued`, `ui.chat.sidebar.row.bg.queued` | ✔ all four exact; 12 shipped keys use "कतार में" (also `ui.settings.imports.state_queued`/`phase_queued`) |
| composing → "लिखा" from `ui.chat.canonical.tool.never_sent_composed` = "नहीं भेजा गया · {size} लिखा गया" | ✔ exact; sibling `never_sent_empty` = "नहीं भेजा गया · कुछ नहीं लिखा गया" |
| image → तस्वीर, 5 vs 1 | ✔ direction right, magnitude understated (see above) |
| video → "वीडियो" (`ui.library.kind.video`, `ui.chat.directory.folder.videos`) | ✔ |
| sound effect → shipped "साउंड" in `ui.chat.canonical.sound.player_failed`; no shipped full term | ✔ ("यह साउंड नहीं बजाया जा सका"); nukta spelling of `इफ़ेक्ट` also matches shipped `ui.agents.routing.qa_tester` "साइड इफ़ेक्ट" |
| voiceover → no shipped term | ✔ 0 hits for `वॉइसओवर` and `वॉयसओवर`; `वॉइसओवर` (U+0935 U+0949 …) is the correct spelling |
| generating → "बन रहा/रही है", aligned with `ui.chat.canonical.image_gen.control.restart` = "फिर से बनाएँ" | ✔; also 5 shipped `बन रहा है` building strings |
| batch → no shipped term; `image_gen.batch_summary` uses "आइटम" | ✔ (en is "{count} items", so no conflict) |
| failed → "विफल" shipped | ✔ 79 keys |
| plurals hi = one/other, 0 and 1 → one | ✔ `Intl.PluralRules("hi")` → {one, other}; 0→one, 1→one, 2/3/5/11/21/22/100/1e6→other |
| "आगे {count} अनुरोध" count 0 renders "आगे 0 अनुरोध" | ✔ rendered |
| gender: तस्वीर f, others m | ✔ every branch rendered and read |

**Precedent the notes missed (in the draft's favour):** `ui.mesh.mesh_approvals_tray.writing_the_decision`
= "फ़ैसला लिखा जा रहा है…" is a shipped, structurally identical rendering of "Writing the &lt;noun&gt;…" —
the draft's `अनुरोध लिखा जा रहा है…` matches it exactly.

## Mechanical checks

- Draft is valid JSON; **14 keys, no key added or dropped** vs the 14 English keys (hi catalogue @ head
  has 442 keys, en 456 — exactly the 14 gap).
- Placeholder/structure: parsed both sides with `@formatjs/icu-messageformat-parser`. Every argument
  (`{size}`, `{count}`, `{total}`, `{material}`) is present with the same name and type; both nested
  plurals use `#`; `{count, number, ::group-off}` preserved; select branches **video / voiceover /
  sound_effect / other** all present and none duplicated; all four `running_batch` material branches
  carry **both** hi categories (`one`, `other`). The only AST difference is element *order*
  (number-after-literal instead of before) — explicitly allowed by the sidecar ("word order can
  follow the target language").
- Separators/typography: middle dot U+00B7 kept in both `*_sized` keys; U+2026 ellipsis in
  `writing_request` / `running` / `running_batch` (no ASCII `...`); danda U+0964 as the full stop in
  `already_finished` / `failed` / `failed_batch`, matching hi house style; no `!`.
- Unicode: all 14 values NFC, no Cf/Cc, no ZWJ/ZWNJ/bidi controls, no leading/trailing or double
  spaces, no user-visible Latin (the only Latin characters are inside ICU syntax, which does not render).
- RTL: n/a for `hi` (LTR). No Latin tokens or paths in any value, so no bidi isolation question arises.

## ICU formatting evidence

Run in-session from the worktree's own `node_modules` (`intl-messageformat` + the formatjs parser);
full log beside this report as `icu-matrix.log` (sha256 `eef8537af58e03c86c7cb02c5fb9dc08e213340f54532634d9f5e77ab5ad6c2a`).
Counts 0,1,2,3,5,11,21,22,100,1000000; materials image/video/voiceover/sound_effect/unknown.

```
composing_sized   लिखा जा रहा है · 12.4 KB   |  लिखा जा रहा है · 1.2 MB
composing_empty   लिखा जा रहा है
queued_sized      कतार में · 12.4 KB   |  कतार में · 1.2 MB
queued_empty      कतार में
state.queued      कतार में
writing_request   अनुरोध लिखा जा रहा है…
queue_ahead       0→आगे 0 अनुरोध  1→आगे 1 अनुरोध  2→आगे 2 अनुरोध  3→आगे 3 अनुरोध
                  5→आगे 5 अनुरोध  11→आगे 11 अनुरोध  21→आगे 21 अनुरोध  22→आगे 22 अनुरोध
                  100→आगे 100 अनुरोध  1000000→आगे 1000000 अनुरोध        (group-off honoured)
running           [image] तस्वीर बन रही है…  [video] वीडियो बन रहा है…
                  [voiceover] वॉइसओवर बन रहा है…  [sound_effect] साउंड इफ़ेक्ट बन रहा है…
running_batch     [image] 0→0 तस्वीर बन रही है…  1→1 तस्वीर बन रही है…
                            2→2 तस्वीरें बन रही हैं…  1000000→10,00,000 तस्वीरें बन रही हैं…
                  [video] 1→1 वीडियो बन रहा है…  2→2 वीडियो बन रहे हैं…
                  [voiceover] 1→1 वॉइसओवर बन रहा है…  2→2 वॉइसओवर बन रहे हैं…
                  [sound_effect] 1→1 साउंड इफ़ेक्ट बन रहा है…  2→2 साउंड इफ़ेक्ट बन रहे हैं…
done              [image] तस्वीर बन गई  [video] वीडियो बन गया  [voiceover] वॉइसओवर बन गया
                  [sound_effect] साउंड इफ़ेक्ट बन गया
done_batch        [image] तस्वीरों का बैच  [video] वीडियो का बैच  [voiceover] वॉइसओवर का बैच
                  [sound_effect] साउंड इफ़ेक्ट का बैच
already_finished  यह पहले ही पूरा हो चुका है।
failed            [image] तस्वीर नहीं बनाई जा सकी।  [video] वीडियो नहीं बनाया जा सका।
                  [voiceover] वॉइसओवर नहीं बनाया जा सका।  [sound_effect] साउंड इफ़ेक्ट नहीं बनाया जा सका।
failed_batch      [image] तस्वीरों का बैच विफल रहा।  [video] वीडियो का बैच विफल रहा।
                  [voiceover] वॉइसओवर का बैच विफल रहा।  [sound_effect] साउंड इफ़ेक्ट का बैच विफल रहा।
```

No output leaves a brace, a stray `#`, or an unrendered category; unknown materials fall through to
`other` (image), as in the source.

## Per-key judgement (accuracy, idiom, register)

| key | hi draft | judgement |
|---|---|---|
| `tool.composing_sized` | लिखा जा रहा है · {size} | accurate ("being written · 12.4 KB"); passive participle parallels the shipped `never_sent_composed`; dot kept |
| `tool.composing_empty` | लिखा जा रहा है | same state minus the size, as the sidecar requires; reads correctly alone in the object column |
| `tool.queued_sized` | कतार में · {size} | accurate; "कतार में" is the shipped state word (12 keys) |
| `tool.queued_empty` | कतार में | ✔ |
| `image_gen.state.queued` | कतार में | ✔ one word in feel (no copula), matches English "Queued" and the shipped queued state |
| `state.writing_request` | अनुरोध लिखा जा रहा है… | ✔ reads exactly like the shipped `mesh_approvals_tray.writing_the_decision`; ellipsis kept |
| `state.queue_ahead` | आगे {count} अनुरोध | accurate, not a rank (see §8.1) |
| `state.running` | … बन रहा/रही है… | ✔ four branches, gender correct per material, no assembly from parts |
| `state.running_batch` | # … बन रहे हैं… / तस्वीरें बन रही हैं… | ✔ number agreement both ways; 0/1 singular per hi CLDR; `#` and Indian grouping correct |
| `state.done` | … बन गया / तस्वीर बन गई | ✔ past receipt, gender correct, no punctuation |
| `state.done_batch` | … का बैच / तस्वीरों का बैच | ✔ noun phrase, oblique plural correct |
| `state.already_finished` | यह पहले ही पूरा हो चुका है। | ✔ states the finish and claims no duration, as the note requires |
| `state.failed` | … नहीं बनाया जा सका। / तस्वीर नहीं बनाई जा सकी। | ✔ plain failure, no blame, no invented remedy, danda |
| `state.failed_batch` | … का बैच विफल रहा। | ✔ "विफल" is the shipped failure word (79 keys) |

## Judged deviations — deliberate, not defects (not counted as findings)

1. **`queue_ahead` carries the noun `अनुरोध`** although the sidecar's tone line says "no noun". Hindi
   cannot leave a bare "आगे 2": the noun is grammatically required, it stays within the "two to three
   words" hint and the datum is `shrink-0`/never-wraps-safe. `अनुरोध` is the shipped term for "request"
   (148 keys). Endorsed.
2. **`queue_ahead` at 0 reads "आगे 0 अनुरोध"** ("0 requests ahead"), not a sentence. The sidecar's
   requirement is that zero must not read as a *rank*; it does not. An `=0 {आगे कोई अनुरोध नहीं}`
   branch is possible but would add copy the English does not have; not requested, not needed.
3. **`बैच` is a new loan in hi** (0 shipped uses). It conflicts with nothing: the shipped
   `image_gen.batch_summary` says "आइटम" because its English says "items", not "batch". Per glossary
   §4 the wave that first needs a term records it — worth a line in the hi style guide's wave list
   (`वॉइसओवर`, `साउंड इफ़ेक्ट`, `बैच`), which is a docs task, not a copy defect.

Also judged, and endorsed: the translator's flagged "unsure" item — `कतार में` serving both the
tool-call queued state and the generation card's queued state. Same state, and the English reuses
"Queued"; one rendering is the glossary-consistent answer.

## Out-of-scope observation (pre-existing, does not gate this draft)

On `main` (not introduced here), the generation card is already split inside itself:
`ui.chat.canonical.image_gen.progress` = "इमेज जनरेशन की प्रगति" (its progressbar `aria-label`,
`image-gen-card.tsx:735`) uses `इमेज जनरेशन`, while `image_label` / `fold.images_aria` /
`lightbox.show_image` in the same card say `तस्वीर`. A screen-reader user will therefore hear
"इमेज जनरेशन" and then "तस्वीर बन रही है". Not a defect in the 14 new keys and not something the
translator touched; if the manager wants alignment, it belongs in its own follow-up (align the
`aria-label` to the card's own noun), not in this translation wave.

## Width / fit

Devanagari measures optimistically; the relevant slots both tolerate length: the tool-row object
column truncates with an ellipsis (status word first, so the state survives truncation) and the
generation card's state line is a wrapping `<p>` with a `shrink-0` datum. Code-point lengths vs English:
`composing_sized` 23/18, `composing_empty` 14/9, `queued_sized` 17/15, `queued_empty` 8/6,
`state.queued` 8/6, `writing_request` 22/20, `running` 142/145, `running_batch` 368/372, `done` 125/137,
`done_batch` 128/121, `already_finished` 27/17, `failed` 173/209, `failed_batch` 168/153. No value is
materially over its English budget; the largest relative growth is `already_finished` (27 vs 17 cp,
one short sentence that wraps). No `maxCells` hint exists in the sidecar for these keys. **No rendered
frame was captured** (see gaps).

## Second pass

The high-visibility pressure here is the failure/completion copy (`failed`, `failed_batch`,
`already_finished`, `done`). I re-derived those four from the English text and its context notes
without consulting my first-pass wording: the draft's choices (`नहीं बनाया जा सका / नहीं बनाई जा सकी`,
`विफल रहा`, `पूरा हो चुका है`, `बन गया/बन गई`) are the ones I would produce independently, and no
polarity or culpability error survived the reread. That second pass is the same model in the same
session — it is a re-derivation, **not** a second independent agent pass; if the manager wants a truly
independent second reader for the error-adjacent strings, it needs another session.

## What I could not check (honest gaps)

- **No native-speaker review and no rendered frame.** All judgements are reading-level plus formatter
  output; no screenshot of the tool row or the generation card in `hi`, so real px overflow/wrapping
  was not observed (geometry above is code-point length only).
- **The translator's draft is not in the catalogue**, so the repo's own gates cannot validate it yet:
  `pnpm check-i18n:*` / `ledger-check` run against the branch state and report, as expected,
  `hi/ui.chat.canonical: missing 14 key(s)` + stale source hash for every locale.
- **`ledger-assemble` was not run** (it writes `i18n/ledger.json`, this worktree is read-only for me;
  and by contract it refuses a receipt whose target sha256 is not the on-disk catalogue, which is
  exactly the case for a draft). The ready row/receipt content is in `record.json`
  (`ledger_row_proposal`) for the manager to land with the translation commit.
- Two things resting on my reading rather than proof: that `कतार में` in the truncated tool-row object
  column is unambiguous to a Hindi reader (no frame), and that `बैच` reads as the living loan it is
  (no shipped hi precedent to compare against).

## Artifacts (this session's scratchpad; the tracked copy under
`i18n/audits/evidence/hi/ui.chat.canonical/s16a-au-hi/` is for the manager to commit)

- `report.md` (this file)
- `record.json`
- `icu-matrix.log` — the formatting matrix above, raw
- `icu-check.mjs` — the script that produced it (reproducible: `node icu-check.mjs` needs this
  scratchpad's `node_modules` symlink to the worktree's `node_modules`)
