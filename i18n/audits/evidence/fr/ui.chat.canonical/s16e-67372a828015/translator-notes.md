# fr — S16e-renderer (12 keys, `ui.chat.canonical`) — translator notes

Slice: S16e-renderer, generation card stop / settlement / failure-class copy.
Locale: `fr` (français). Namespace: `ui.chat.canonical`. Keys: 12.
Draft: `scratchpad://draft-fr-s16e.json`. This run is a translator only — I did not audit.

## 1. Inputs actually read (path + sha256)

| Input | sha256 |
|---|---|
| `~/local-operator/i18n/glossary.md` (core glossary, §1 keep-English, §2–3 term policy) | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| `~/local-operator/i18n/style-guides/fr.md` (binding fr style guide) | `ae1519ab7617d19aa826918d607de1d018595094166edbc18aa58f6a8f0a4226` |
| `~/local-operator/docs/design/i18n.md` (RFC: ICU subset §2, parity §6.4, ledger §6) | `92eca5a123b65c4dea7e7ec2db9ddd4fec0b04c0fa038d10ba540e30f0d7e096` |
| worktree `docs/I18N.md` (UI HOWTO) | `d58ad473701f098b3c2c24343c3a7e7236f22db22cc871016c4cb75f25f41f5c` |
| worktree `src/i18n/catalogues/en/ui.chat.canonical.json` (English source) | `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| worktree `src/i18n/catalogues/fr/ui.chat.canonical.json` (shipped fr terminology, 467 keys) | `99f7c0b27d6c75b16935cc58874477cab24da430284576defaacf19e209c88f6` |
| brief `sessions/3ef6295a5545/scratchpad/s16e-brief.json` (verified against the task's hash `a0326137…55bef0c`) | matches |

The UI worktree carries no locale style guide of its own (`glob **/*glossary*` → no match); the
core repo's `i18n/style-guides/fr.md` + `i18n/glossary.md` are the authoritative pair, as
`docs/I18N.md` itself points at the core HOWTO/RFC. `docs/design/i18n.md` exists only in the
core repo, so its hash above is the core file.

## 2. Register

- **vous**, lowercase mid-sentence, per `fr.md` §Formality. No "Veuillez…".
- State lines are past-participle / nominal-sentence terse ("Arrêtée avant…", "Lot de vidéos arrêté."),
  never "Votre génération a bien été arrêtée avec succès" (`fr.md` §Formality: "statuses are past
  participles").
- Sentence case everywhere; the failure-class labels are label register (initial capital, **no**
  full stop), matching `ui.chat.canonical.older_history.failed.short` = "Chargement échoué".
- Full stops exactly where English has them: the five state/error sentences and
  `cancel.checking` end with `.`; all six `error_class.*` labels carry none.

## 3. Term choices, with shipped-catalogue evidence

Every choice below is the word the shipped fr `ui.chat.canonical` already uses on this very surface.

| English | fr | Evidence in shipped fr catalogue |
|---|---|---|
| provider | **fournisseur** | `image_gen.control.stop_hint_queued` "S’arrête avant l’appel au fournisseur."; `sound.stop.warning` "Le fournisseur ne dispose d’aucun endpoint d’annulation."; `transcript.connect_provider` "Connecter un fournisseur" |
| (cancellation) endpoint | **endpoint** (English kept) | `sound.stop.warning` same word; `fr.md` kept-English list names endpoint |
| generation / generated | **génération**, **générer** | `image_gen.progress` "Progression de la génération de l’image" |
| charge (verb) | **facturer** | `sound.stop.warning` "…et sera facturée si elle produit un audio." |
| charge (noun, final) | **frais finaux** | `sound.cost.estimated_zero` "…; frais finaux non confirmés."; `sound.cost.no_charge` "Sans frais." |
| stop (request) | **arrêt**, **demande d’arrêt** | `sound.stop.request_stop` "Demander l’arrêt"; `sound.stop.confirm_label` "Confirmation de la demande d’arrêt" |
| stopped (state) | **arrêté/arrêtée** | `transcript.stopped_before_finishing` "Arrêtée avant la fin"; `sound.batch.item_status` `cancelled` → "Arrêté" |
| batch | **lot** | `image_gen.state.done_batch` "Lot de vidéos / Lot de voix off / Lot d’effets sonores / Lot d’images"; `image_gen.state.failed_batch` "Échec du lot d’images." |
| video / voiceover / sound effect / image | **vidéo / voix off / effet sonore / image** | `image_gen.state.running` "Génération de la vidéo… / de la voix off… / de l’effet sonore… / de l’image…" |
| audio | **audio** (invariable, kept) | `sound.stop.warning` "si elle produit un audio"; `ui.common.errors.audio_playback` "Erreur de lecture audio." |
| rate limit | **limite de débit / limité en débit** | `ui.chat.error_block.rate_limit.before` "la limite de débit de votre fournisseur d’IA"; `ui.code_review.host.cooling` "{host} limité en débit jusqu’à {time}." |
| invalid | **invalide** | `ui.browser.chrome.invalid_order` "Ordre des onglets du navigateur invalide." |
| id | **ID** (uppercase, as shipped) | `ui.agents.settings.general.id` "ID"; `ui.agentMessages.settings.allowlist.agent_id` "ID de l’agent" |
| denied | **refusé** | `ui.teamBridge.invitations.declined` "Refusé pour {agent}."; `ui.teamBridge.delivery.refused` "Refusé par la modération." |

## 4. Key-by-key

1. **state.cancelled_batch** — `{material, select, video {Lot de vidéos arrêté.} voiceover {Lot de voix off arrêté.} sound_effect {Lot d’effets sonores arrêté.} other {Lot d’images arrêté.}}`
   Same family as the line it replaces: `state.failed_batch` ("Échec du lot de vidéos.") and
   `state.done_batch` ("Lot de vidéos"). Nominal sentence, not "Le lot de vidéos a été arrêté." —
   the latter is 7 words against the brief's "two to four words" and would break the column of
   sibling state lines. Masculine agreement on **lot** throughout.
2. **cancel.queued** — "Arrêtée avant l’appel au fournisseur ; vous ne serez pas facturé."
   Feminine participle because the subject is *la génération*, exactly as
   `transcript.stopped_before_finishing` ("Arrêtée avant la fin") does it. "avant l’appel au
   fournisseur" is the shipped `control.stop_hint_queued` wording. The no-charge promise is kept
   flat and unhedged ("vous ne serez pas facturé"), per the context note; semicolon preserved as
   in English, with the fr narrow no-break space (U+202F).
3. **cancel.running** — "Arrêt demandé. Le fournisseur ne dispose d’aucun endpoint d’annulation ; la génération continue et sera facturée si elle produit un audio."
   Second and third clauses are the shipped `sound.stop.warning` sentence verbatim
   ("Le fournisseur ne dispose d’aucun endpoint d’annulation. La génération continue et sera
   facturée si elle produit un audio.") — the same factual claim, so it must read identically
   wherever it appears. "Arrêt demandé." mirrors `sound.stop.request_stop`'s "demande d’arrêt"
   noun. No promise added, no wait time, no guarantee language.
4. **cancel.checking** — "Vérification du règlement."
   Three words, complete sentence, own full stop, renders correctly joined after (3):
   "…si elle produit un audio. Vérification du règlement."
5. **settlement.pending** — "Règlement en attente — les frais finaux apparaîtront dès que le fournisseur les aura communiqués."
   Em dash kept: fr uses " — " (plain spaces) 265 times across the shipped fr catalogues, so it is
   the locale's own punctuation, not an English import. "frais finaux" is the shipped term;
   "communiqués" agrees with the preceding direct object *les* (= les frais). States an outstanding
   charge, never an amount, never zero.
6. **error.audio_rate_limited** — "La génération audio est très sollicitée en ce moment. Patientez un instant et réessayez."
   Two short sentences, calm and actionable, no promise that the retry will succeed, no specific
   wait time ("un instant" is deliberately vague). "très sollicitée" renders "is busy right now"
   without claiming a hard cap; "limite de débit" would state a mechanism the *sentence* (not the
   label) does not need and would read technical on a card.
7. **error_class.audio_rate_limited** — "Débit audio limité" (18 cells vs English 18).
   Label register, short enough not to wrap at the same width as English. Built from the shipped
   "débit limité / limite de débit" family.
8. **error_class.unknown_tool** — "Outil inconnu". Glossary §"tool" = *outil*; the harness's own
   reason sits below, so the label stays a bare class.
9. **error_class.invalid_arguments** — "Arguments invalides" (19 vs 17 cells; "non valides" would
   add three cells for no gain).
10. **error_class.duplicate_id** — "ID en double" (12 vs 12). "en double" is the fr term for a
    duplicate; "ID" keeps the shipped uppercase form.
11. **error_class.denied** — "Refusé" (6 vs 6). No referent in a class label, so the unmarked
    masculine, exactly as the shipped "Refusé pour {agent}."
12. **error_class.gate_failed** — "Échec du contrôle" (17 vs 11 cells).
    The gate is a configured policy gate that stopped the call; the shipped corpus names a
    verification of this kind *contrôle* (`ui.updates.panel.seal.startup.message` "n’a pas réussi
    son contrôle d’intégrité"). "gate" is not on the fr kept-English list, so it is translated;
    the gate's own reason is rendered below the label, so the class name does not have to carry the
    mechanism. This is the one label whose fr form is longer than English — see §6.

## 5. Width

Rendered lengths (characters ≈ cells; no CJK, no wide glyphs):

| key | en | fr |
|---|---|---|
| state.cancelled_batch (4 branches) | 20 / 24 / 27 / 20 | 21 / 23 / 28 / 20 |
| cancel.queued | 64 | 65 |
| cancel.running | 125 | 138 |
| cancel.checking | 24 | 26 |
| settlement.pending | 79 | 97 |
| error.audio_rate_limited | 64 | 88 |
| error_class.audio_rate_limited | 18 | 18 |
| error_class.unknown_tool | 12 | 13 |
| error_class.invalid_arguments | 17 | 19 |
| error_class.duplicate_id | 12 | 12 |
| error_class.denied | 6 | 6 |
| error_class.gate_failed | 11 | 17 |

The five wrapping sentences are inside the card and carry no cell budget in the brief; they run
+1 % to +37 % over English, inside `fr.md`'s stated 15–25 % band apart from the two long ones
(`settlement.pending`, `error.audio_rate_limited`) which are deliberately plainer-shorter than a
literal rendering would be ("Règlement en attente" not "Le règlement est en attente").
The six short labels — the ones the brief says must not wrap — are within 0–6 cells of English,
the single exception being `gate_failed` (+6).

## 6. Judgement calls

- **U+202F before `;`** — required by `fr.md` §Punctuation and present in the shipped file
  ("Demande l’arrêt\u202f; le fournisseur peut quand même terminer."). Both semicolons in the draft
  carry U+202F, verified by byte scan.
- **Apostrophe** — U+2019 throughout ("d’aucun", "d’annulation", "d’effets", "d’images",
  "l’appel"); no ASCII `'` anywhere (also important because ICU does not treat U+2019 as an escape
  character, unlike ASCII `'`).
- **Em dash kept** and idiomatic in fr (§4.5), plain spaces both sides per corpus norm.
- **`endpoint`, `audio`, `ID`** stay as shipped: `endpoint` is on the fr kept-English list, `audio`
  is invariable and used unquoted in the shipped corpus, `ID` is the shipped label form.
- **`gate` translated, not kept** — not on the kept-English list; see §4.12. Flagged as a
  glossary proposal rather than improvised silently.
- **Nothing judged identical-to-English by omission**: no string was left in English. The only
  English tokens in the draft are *endpoint*, *ID* and *audio*, each already shipped in the fr
  catalogue on this same surface.

## 7. Glossary proposals (terms missing from `i18n/glossary.md`)

1. **provider → fournisseur** (fr). Not in the glossary; the fr catalogue uses it consistently
   (5+ shipped strings cited in §3). Worth a row so future waves cannot drift to "prestataire".
2. **charge / settle → facturer, frais finaux, règlement** (fr). The glossary has no cost row;
   shipped fr uses "sera facturée", "frais finaux", "Sans frais.". "règlement" for *settlement* is
   my choice for this slice — it is not yet attested in the shipped fr corpus (the corpus only has
   "frais finaux non confirmés"), so an auditor may prefer "décompte". Both readings are correct in
   fr billing; the pair (4) "Vérification du règlement." / (5) "Règlement en attente" is internally
   consistent either way, but the two must change together.
3. **gate (policy gate) → contrôle** (fr). Glossary has a `settings.configuration` gate row only as
   a `{gate}` placeholder (the configured gate's *name*, which stays as-is). The failure-class
   noun needed a rendering; propose *contrôle* with the note that a named gate keeps its own name.

## 8. Validation performed (actual commands and output)

Memory guard: no builds, no test runs, no `pnpm`. I ran the repo's own ICU parser
(`@formatjs/icu-messageformat-parser`, the same package `src/i18n/messages.ts` compiles with,
resolved from the primary checkout's `node_modules` because the worktree has none) on one small
script — 0.29 s, and `intl-messageformat` render — 0.72 s.

- `node check-fr-s16e.mjs` → 12 × `STRUCT OK`, `keys: 12 fails: 0`.
  The check compares AST shape against English: argument names, argument kinds (select vs plural
  vs pound vs tag), **the sorted option-key set of every select/plural**, `offset`, nested branch
  shapes, and that no branch is empty. So `state.cancelled_batch` is proven to carry exactly the
  branches `sound_effect | other | video | voiceover` with `{material}` as the argument, in both
  languages.
- `node render-fr-s16e.mjs` (IntlMessageFormat, locale `fr`) → the four branches render as
  `Lot de vidéos arrêté.` / `Lot de voix off arrêté.` / `Lot d’effets sonores arrêté.` /
  `Lot d’images arrêté.`
- Python audit: valid UTF-8, NFC-normal on every value, 12 keys in exactly the brief/English order,
  trailing newline, no ASCII apostrophe, U+202F present before every `;`, no trailing full stop on
  any label, full stop on every sentence.
- **Not run, deliberately:** `pnpm check-i18n*` (whole-tree node runs and a build-shaped gate are
  excluded by the memory guard, and the worktree is read-only for me). The catalogue-level gates
  (key parity, `mustCompile`/ICU parity, context parity) are therefore for the integrator/QA; the
  structural parity they check for these 12 keys is what §8's AST comparison already establishes.

## 9. Open questions for the integrator / auditor

- Should `règlement` (settlement) be confirmed against a fr reviewer preference for `décompte`
  before the audit locks it in? Both keys (4) and (5) must move together.
- The 12 keys are absent from the shipped fr catalogue (verified: the 12 are exactly the
  `image_gen.*` keys English has and fr lacks), so today they fall back to English. The draft is a
  flat key→value object in brief order, tab-indented, for direct merge into
  `src/i18n/catalogues/fr/ui.chat.canonical.json`.
- **Insertion point, verified rather than assumed:** insert the 12 as ONE contiguous block
  immediately after `ui.chat.canonical.image_gen.state.failed_batch` and before
  `ui.chat.canonical.loading.cold`. In the English file the same 12 sit there in the same order,
  and fr's tail from `loading.cold` onward is already key-for-key identical to English from its
  `loading.cold` onward — so the block keeps both files aligned. Do **not** append at the end of
  the file, and do not read the whole fr order as English-mirroring: the shipped fr order departs
  from English at 9 of its 467 positions (first at fr position 236, the `transcript.*` area around
  `fold.count.actions_partial`), which predates this slice and is not mine to reorder.
- No catalogue gate enforces key order (`scripts/i18n/*` checks parity, duplicates, context
  sidecars and the ledger, not sequence); the block placement above is for reviewer legibility and
  to keep the family adjacency the brief asks for.

## 10. Model actually used

`deepseek/deepseek-flash` — the model this session was launched on (session's declared model, no
fallback, no model switch during the run). Translation was reasoned by me directly: no translation
API, SDK, MT service or website was called, at any point.
