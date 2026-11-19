# i18n audit — `fr` · `ui.chat.canonical` (s16a tool-state words)

- **PR**: local-operator-ui #1870, branch `feat/i18n-s16a-tool-state-words`
- **Worktree / head**: `~/local-operator-ui/.worktrees/i18n-s16a` @ `93a61605b059ada503d75da6e9e38e8ef14e1b67` (read-only: nothing edited, nothing committed, no installs)
- **Scope**: the 14 new English keys at the end of `src/i18n/catalogues/en/ui.chat.canonical.json` —
  `tool.composing_sized`, `tool.composing_empty`, `tool.queued_sized`, `tool.queued_empty`,
  `image_gen.state.{queued,writing_request,queue_ahead,running,running_batch,done,done_batch,already_finished,failed,failed_batch}`
- **Target under audit**: the translator's draft, not a landed file —
  `/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16a-drafts/fr-s16a.json`,
  sha256 `e41dfcb15c773b829ab2c9fcf920a4642eb2e310c3ee79da8481f122d1830769` (computed here with `shasum -a 256`; equals the hash handed to me)
- **Source hashes**: en `d6d47d31667fe69448cf408f5a4fecf9948782e850506a6141217585de9db1fd`,
  context `ef8a12dea1835c241af3a166754322ce093af88592ec625036211458a50accac`,
  shipped target `src/i18n/catalogues/fr/ui.chat.canonical.json` `cea935cd4e6ba5627ffe19b4b129d4dd7f0ef60b3e8de96fa0bc1a48ca6249f1`
- **Glossary / style guide**: `~/local-operator/i18n/glossary.md` `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8`,
  `~/local-operator/i18n/style-guides/fr.md` `ae1519ab7617d19aa826918d607de1d018595094166edbc18aa58f6a8f0a4226` (both read in full, before judging)
- **Auditor**: i18n-auditor, instance `2105ebeeb3e9`, model **deepseek/deepseek-flash**
- **Translator** (for the independence test): i18n-translator, anthropic/claude-sonnet-5-5 — different agent, different model, no shared session

## Verdict

**`clean-with-findings`** — namespace status **`passed`**.

| BLOCKER | MAJOR | MINOR | NIT |
|---|---|---|---|
| 0 | 0 | 0 | 2 |

No BLOCKER or MAJOR remains, so the group passes. Both NITs are recorded observations with the author's choice accepted; neither asks for a change.

## Independence statement

The translator was an LLM translator (anthropic/claude-sonnet-5-5) working in a different session. I am a different agent on a different model (deepseek/deepseek-flash), I did not translate these strings, and I edited nothing — neither the draft nor the repository. No translation/MT service, API or back-translation was used to compare or rationalise any value; every judgement below is my own reading of the English source, its context sidecar and shipped French. Agreement here is a finding of "no defect", not agreement with the translator: I re-derived each term decision from the shipped corpus rather than accepting the translator's notes (see §4), and I disagreed with the reasoning in two places while accepting the wording (N1, and the `many` rationale in §3.1, which is right for the reason the guide gives, not the one the notes give).

## 1. Mechanical

- **Key set**: 14/14 keys present, no extra key, no dropped key. Valid JSON (parsed with `JSON.parse`).
- **Placeholders**: `{size}` in `composing_sized`/`queued_sized`; `{count}` in `queue_ahead`; `{material}` in `running`/`done`/`done_batch`/`failed`/`failed_batch`; `{material}`+`{total}` in `running_batch` — identical names, identical counts, no added or renamed argument (checked by extracting `{name}` sets from en and fr and comparing).
- **ICU select branches**: all four present in every select message — `video`, `voiceover`, `sound_effect`, `other` — for `running`, `running_batch`, `done`, `done_batch`, `failed`, `failed_batch`. The branch names match the callsite's `materialToken()` values (`image` maps to `other`), so no branch is dead.
- **CLDR categories for fr**: `new Intl.PluralRules('fr')` over 0,1,2,3,5,11,21,22,100,1000000 → `one, other, many` (0 and 1 → `one`; 1000000 → `many`). `queue_ahead` supplies `one`, `many`, `other`; each of the four `running_batch` plurals supplies `one`, `many`, `other` (counted: 4 `one {`, 4 `many {`, 4 `other {` plus the select's own `other`). Matches the glossary §3 row (`fr one/many/other, 0 is one`) and `scripts/i18n/tool-state-copy.test.mjs:534`.
- **`#` in nested plurals**: correct — `#` resolves to `{total}` inside each branch (proved by formatting, §2).
- **`::group-off`** kept byte-identically in `queue_ahead`.
- **Typography**: `U+00B7` MIDDLE DOT with ordinary spaces in both tool rows (matches the source and shipped `tool.never_sent_composed`); `U+2019` apostrophes throughout; `U+2026` ellipsis, 17 of them = 1 (`writing_request`) + 4 (`running`) + 12 (`running_batch`), same counts as English; accents NFC; no leading, trailing or doubled spaces. No `: ; ! ?` in this group, so the fr espace-fine-insécable rule is not engaged.
- **Coverage**: `fr` has 442 of the 456 `ui.chat.canonical` keys and the 14 missing ones are exactly this group — i.e. until the draft lands, French falls back to English for precisely these strings (relevant to the operator's "no English anywhere" acceptance for this namespace).

## 2. Formatting evidence (actually run, not described)

`node -e` against `intl-messageformat` from the worktree's `node_modules`, locale `fr`, with file sizes supplied the way `formatBytes` would supply them:

```
--- queue_ahead
0 (one)   => "0 devant"        1 (one)  => "1 devant"      2 (other) => "2 devant"
5 (other) => "5 devant"        21 (other) => "21 devant"   100 (other) => "100 devant"
1000000 (many) => "1000000 devant"        [::group-off, same as en]

--- running (per material)
image        => "Génération de l’image…"
video        => "Génération de la vidéo…"
voiceover    => "Génération de la voix off…"
sound_effect => "Génération de l’effet sonore…"

--- running_batch (total × material, representative rows)
image       0/1 => "Génération de 0 image…" / "Génération de 1 image…"     2 => "…2 images…"   1000000 => "Génération de 1 000 000 d’images…"
video       1   => "Génération de 1 vidéo…"                                3 => "…3 vidéos…"   1000000 => "Génération de 1 000 000 de vidéos…"
voiceover   1   => "Génération de 1 voix off…"                             3 => "…3 voix off…" 1000000 => "Génération de 1 000 000 de voix off…"
sound_effect 1  => "Génération de 1 effet sonore…"                         3 => "…3 effets sonores…" 1000000 => "Génération de 1 000 000 d’effets sonores…"

--- receipts / failures
done:    Image générée | Vidéo générée | Voix off générée | Effet sonore généré
done_batch: Lot d’images | Lot de vidéos | Lot de voix off | Lot d’effets sonores
failed:  L’image n’a pas pu être générée. | La vidéo n’a pas pu être générée. |
         La voix off n’a pas pu être générée. | L’effet sonore n’a pas pu être généré.
failed_batch: Échec du lot d’images. | Échec du lot de vidéos. |
              Échec du lot de voix off. | Échec du lot d’effets sonores.
queued => "En file d’attente"   writing_request => "Rédaction de la demande…"
already_finished => "Déjà terminé."
composing_sized => "rédaction · 2,4 Ko"   composing_empty => "rédaction"
queued_sized    => "en file d’attente · 2,4 Ko"  queued_empty => "en file d’attente"
```

Read against French grammar, every row is correct:

- `0`/`1` → singular noun ("0 image", "0 vidéo") — required in French and exactly what the glossary's `one` (0 and 1) buys; `2,3,5,11,21,22,100` → plural noun.
- `many` (1 000 000) → partitive `de`/`d’` before the noun, and a bare `de` for `devant` (no counted noun there) — matches the style guide's own model `many {# de sessions}`.
- Gender agreement holds in every material: *vidéo*, *voix off*, *image* → `générée`; *effet sonore* → `généré`. Elision correct (`l’image`, `l’effet sonore`, `d’images`, `d’effets sonores`; `de vidéos`, `de voix off`).
- No leftover braces, no English fragment, no placeholder rendered verbatim.

## 3. Translator claims, checked against the shipped corpus

Verified with file:key lookups in `src/i18n/catalogues/fr/`, not from the notes:

1. **"`many` takes de/d’"** — true, and *right for a better reason than the notes give*: the notes say it mirrors `fold.images_aria`/`lightbox.filmstrip_aria`; the binding reason is the style guide's plural model (`fr.md:53-56`) and the fact that every fr `many` value is an exact multiple of 10⁶. Both shipped examples do carry it: `ui.chat.canonical.fold.images_aria` `many {{count_display} d’images de cette exécution}`, `ui.chat.canonical.lightbox.filmstrip_aria` `many {{count_display} d’images}`. Note the guide's own list ("`many` … exact multiples of 10⁶ only; 1 500 000 → `other`") is a simplification of CLDR, which sends 1 500 000 to `many` as well; harmless here — a queue depth or batch size never reaches 10⁶, and "1 500 000 de vidéos" is the standard written form anyway.
2. **composing → "rédaction", parallel to shipped "texte rédigé"** — the shipped key is real: `ui.chat.canonical.tool.never_sent_composed` = `jamais envoyé · texte rédigé : {size}` and `tool.never_sent_empty` = `jamais envoyé · aucun texte rédigé`. The root is shared, though the notes overstate the parallelism: the sibling uses a participle of a *finished* measurement, the draft a noun for an *ongoing* action (see N1).
3. **queued → "en file d’attente", not "en attente"** — correct and better supported than the notes claim. "en file d’attente" is itself shipped for queued: `ui.chat.aside.adopt.queued` "En file d’attente — …", `ui.chat.ask_queue.status.open` "En file d’attente — l’agent continue", `ui.chat.pickers.info_model.queued` "{formatcount} en file d’attente", `ui.settings.imports.state_queued`/`phase_queued` "en file d’attente", `ui.chat.sidebar.row.bg.queued` (with the same one/many/other + `::group-off` shape). "En attente" is shipped for a *different* state — `ui.browser.browser_approvals_dock.waiting` "En attente", `ui.chat.ask_panel.filter.pending` "En attente", `ui.chat.asks.outstanding_aria` "… en attente" — so the distinction the notes assert is real, and the sidecar's "not 'pending'" warning is honoured.
4. **request → "demande"** — shipped `ui.chat.canonical.image_gen.control.stop_hint_running` "Demande l’arrêt ; …" (verb) and the noun is the ordinary French word for a request; no conflicting rendering in the corpus.
5. **image/vidéo** — shipped `ui.chat.canonical.image_label` "Image", `ui.library.kind.video` "Vidéo", `ui.library.category.video` "Vidéo". Consistent.
6. **batch → "lot"** — "lot/par lots" is shipped for batched work (`ui.settings.imports.selection_limit` "… importez-les par lots.", `ui.settings.configuration…` "… par lots limités"), and `image_gen.batch_summary` is the member-count word, not the batch word (`{count_display} élément(s)`) — so "Lot d’images" for the batch and "3 éléments" for its members coexist without contradiction in the same card.
7. **voiceover → "voix off", sound effect → "effet sonore" (new coinages)** — claim confirmed: across every `fr` catalogue in `ui.chat*`, `ui.library`, `ui.settings`, `ui.common` there is no shipped "voix off" and no "effet sonore" (nearest: `ui.library.kind.audio` "Audio"; the speech surfaces use "à voix haute", a different concept). Both are the standard French terms, both keep their number/gender agreement in the draft, and both are proposed for the glossary by the translator. Nothing to flag.
8. **generating → "Génération de …"** — shipped precedent `ui.chat.canonical.image_gen.progress` "Progression de la génération de l’image". Consistent.
9. **already_finished → "Déjà terminé."** — no shipped precedent to contradict; matches the sidecar (states only that the work had finished).

## 4. Findings

### N1 — NIT — `ui.chat.canonical.tool.composing_sized`, `ui.chat.canonical.tool.composing_empty`
- Current: `rédaction · {size}` / `rédaction`
- Observation: a bare noun where French UI copy more often names the ongoing action ("rédaction en cours", or the gerund). The style guide's "statuses are past participles" rule (`fr.md:17`) does *not* apply — a past participle would claim the writing is finished, which is the `never_sent` sibling's job.
- Why it is not a MAJOR: the row truncates, the sidecar asks for a terse lower-case status word, and the shipped sibling shares the root ("texte rédigé"). This is a defensible compression, not a defect.
- Proposed (not requested): keep. If a later pass wants the fuller register, `rédaction en cours · {size}` / `rédaction en cours` is the natural form and costs 8 more cells on the narrowest row in the app.

### N2 — NIT — `ui.chat.canonical.image_gen.state.queue_ahead`
- Current (all three categories): `{count, number, ::group-off} devant`
- Observation: the zero reading renders "0 devant", which is correct but telegraphic; French would rather say "aucun devant" / "rien devant".
- Why it is not a MAJOR: the sidecar requires a *number* in this datum (0 is "a real reading, not a missing one"), the datum is `::group-off` and never wraps, and "0 devant" states exactly what the count says without claiming a rank.
- Proposed (not requested): keep. An `=0 {rien devant}` arm would read better but adds an exception branch for a one-reader-in-a-thousand state.

## 5. Judged and deliberately not raised

- **Length (the translator's own first "unsure")**: `en file d’attente · 12,4 Ko` is 27 characters against en's 16 (+11); the tool row's object column truncates from the tail, so the *size* is lost first and the status word survives. The style guide prefers shorter synonyms over truncation (`fr.md:65-69`), but French has no shorter *faithful* word here: "en attente" is taken by the pending state (see §3.3), "en file" alone is not idiomatic, "file d’attente" is the same length. Verdict: keep "en file d’attente"; the translator's uncertainty is resolved in its favour.
- **"devant" vs "avant" (the translator's second "unsure")**: "devant" is right. "avant" is temporal / order-before ("avant 18 h", "la ligne avant") and would read as the previous item; "devant" is the spatial "in front of you" a queue depth means. Verdict: keep "devant".
- **`failed_batch` nominal shape** ("Échec du lot de vidéos." for "Video batch failed."): French failure copy is routinely nominal ("Échec de l’envoi"), it is terser than "Le lot de vidéos a échoué.", and the sidecar's tone is "plain failure statement". Not raised.
- **Fit**: `StateLine` renders `<p class="flex min-w-0 items-baseline gap-1.5">` with a wrapping text span and a `shrink-0` datum (`image-gen-card.tsx:339-477`), inside a `flex w-full flex-col` card body with no fixed height or clamp — so the +2…+11 character deltas wrap instead of clipping, and the datum (`bdi dir="auto"`, outside the isolate's "· " separator) keeps its place. No overflow finding. Longest string in the group is `Génération de l’effet sonore…` at 29 characters (+5 on en).
- **Register/formality**: no second person in this group, so the vous decision is not engaged; sentence case and lower-case compact statuses follow `fr.md:19-20`; no Title Case anywhere.
- **`image_gen.state.queued` vs `tool.queued_empty` differing only in the capital** ("En file d’attente" / "en file d’attente") is correct, not an inconsistency: one is a card state line (sentence case), the other a lower-case tool-row fragment, exactly as the two sidecars specify.
- **RTL**: not applicable to `fr`.

## 6. Honest gaps

- **No native speaker beyond my own fluency, and no rendered frame.** Fit is judged from the code paths above plus character counts, not from a screenshot; there is no `fr` runtime to launch in a read-only audit, and I did not start one.
- **No byte-level read of the draft.** A path guard refused `node`/`awk` reads of the manager session's scratchpad file, so I worked from the harness `read` view (which is the file's verbatim text) and re-read the four long lines (`queue_ahead`, `running`, `running_batch`, `failed`, `failed_batch`) to compare them against a local re-materialisation used for the ICU runs. The local copy is 15 bytes larger than the original, which I could not attribute to a value (the sizes reconcile exactly under tab indentation, so the difference most likely lives in indentation/newline whitespace, not in any translated string). No value discrepancy was visible on any line; the draft's sha256 was independently verified as `e41dfcb1…`.
- **`many`/millions readings are unreachable in practice** (queue depths and batch sizes are small); they were formatted and read anyway.
- I did not audit the other 13 locale/group assignments, the whole 456-key namespace, or any key outside the 14 — the English-leak check I ran (`fr` vs `en` identical values in this namespace: 7, all placeholder-only or genuinely identical such as "Image") is a sanity check, not a namespace verdict.
- **Second pass**: the manager asked for a second independent pass on high-visibility groups. This group (every tool row, every generation card, plus the failure fallbacks) qualifies, so I re-derived the group a second time with fresh sight on the failure/receipt strings; the second pass changed no verdict and added N1/N2 wording. It was the *same* auditor and model, so it is a second pass, **not** a second independent auditor — if the manager wants the letter of the rule, a different instance still owes this locale.
