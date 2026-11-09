# French audit — `ui.agents.upload`, round 1

| | |
|---|---|
| Locale / namespace | `fr` / `ui.agents.upload` |
| Branch / head | `i18n/slice-upload-agent-dialog` @ `2b72db6a56ad8204ec7f30a0ba6ffbc941be3b82` |
| Base | `3378319980ff898892f316ae3a17cc22c089b7d3` (`origin/main` at the time of the slice) |
| Scope | the 15 keys added by `3378319980f..2b72db6a56a`, `src/i18n/catalogues/fr/ui.agents.upload.json` only |
| Auditor | `i18n-auditor` (lopdev reviewer role), session `500cc1a88ba7`, independent of the translator |
| Model | `deepseek/deepseek-flash` — three provider-quota fallbacks from `anthropic/claude-sonnet-5-5` (`claude-opus-5-5` → `openai/gpt-6.1-sol` → `deepseek/deepseek-flash`) before the first catalogue read; no finding formed before they settled |
| Verdict | **changes_requested** — 1 MAJOR, 1 NIT |

## Inputs (SHA-256 recomputed from the bytes on disk)

| Input | sha256 |
|---|---|
| `en/ui.agents.upload.json` | `3676c1b366cc5159b94be65acdaea925bd193d20c2524ff3f410a8a5ddff514f` |
| `en/ui.agents.upload.context.json` | `76323fe386f9b15d490c3a48feaddbd924f04148f1c893e927c2acde06f11cec` |
| `fr/ui.agents.upload.json` (head) | `3b1a270ec474f530a88c5560874ddf489aacb65ec722379463b9113b4d980eff` |
| `fr/ui.agents.upload.json` @ `3378319980f` | `54c6b08c1dcdd9df5e91dc2c8c1448e3461c051bce64da070ba61344640ea096` (= `origin/main`) |
| `local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| `local-operator/i18n/style-guides/fr.md` | `ae1519ab7617d19aa826918d607de1d018595094166edbc18aa58f6a8f0a4226` |

## Findings

### M1 — MAJOR — `ui.agents.upload.intro.public`: the qualifier is stranded after the complement

**Rendered (ICU, locale `fr`):**

> Vous êtes sur le point de publier le jeu d’instructions de cet agent sur **le Hub des agents public**. Seul ce qui décrit l’agent est publié :

`public` sits after the PP `des agents`, not beside `Hub`. The nearest noun it can agree with is `agents`, which is plural — so the reading the eye lands on first is *agents public*, an agreement failure whose grammatical repair (*agents publics*) means *public agents* and reverses the sentence. The intended reading, `public` modifying `Hub` across the complement, is the post-complement placement French reserves for title-like relational adjectives (*le directeur des ventes adjoint*); with a plain qualifier it reads as an error, and French names this concept pre-nominally.

The delta contradicts itself on exactly this point: `target.visibility_hint_public` in the same 15 keys renders *public hub* as « le hub public », the locale's shipped `ui.hub.pages.scope.public` is « Hub public », and `intro.public` is the only value that puts the qualifier after the complement. The context sidecar also pins the name — `intro.public.note`: render "Agent Hub" the way this locale renders `ui.hub.pages.header.title` (`fr/ui.hub.pages.json:6` = **« Hub des agents »**), "not as a second name"; « Hub des agents public » is a third form of it, on the primary public flow.

Render site: `src/renderer/src/features/agents/components/upload-agent-dialog.tsx:952`.

**Fix (one line):** `sur le Hub public des agents.` — « Hub public » is this locale's own value for the concept and « des agents » keeps the header title's noun. The sibling values are already right: pre-existing `title.publish_public` = « Publier « {name} » sur le Hub des agents ? ».

### N1 — NIT — `ui.agents.upload.target.blocked_hint`, `one` arm: `de {org}` cannot elide

Rendered at `count: 1` with `org: "Acme"`:

> … Un propriétaire de Acme peut l’activer dans la console Radient.

French needs `d’Acme` (elision) or an article (`de l’organisation Acme`); ICU cannot elide, and the construction is exactly the one the shipped sibling `ui.hub.teams.org.plan_body` uses (« Un propriétaire de {org} peut l’activer dans la console Radient »). Because the translator matched the shipped locale rather than inventing a second construction, this is recorded for a locale-wide sweep, not as a defect of this diff, and it does not gate. A fix that is grammatical for every organisation name: `Un propriétaire de l’organisation {org}`.

## Criterion-by-criterion

1. **Naturalness / register against the 31 pre-existing values — pass apart from M1.** `vous` throughout; terse past-participle receipt headings (`Fiche mise à jour`, `Publié sur le hub`); the long sentences keep the pre-existing frames (`Rien d’autre ne quitte cette machine : …`, `Seul ce qui décrit l’agent est publié :`). `not_leaving.*` reproduces `sign_in.nothing_left`'s item order and adds exactly the two items the English has there (`mémoire ni aucun apprentissage`) — nothing added, dropped or reordered, per the context note.
2. **Terminology consistency — pass, translator's claims verified against the corpus.** « fiche » for *listing*: matches `action.open_listing` « Ouvrir la fiche », `ui.agents.publication.action.update_listing` « Mettre à jour la fiche existante », `title.republished` « Fiche de « {name} » mise à jour ». « l’offre Team »: matches `ui.hub.teams.org.plan_body` « fait partie de l’offre Team » and `ui.teamBridgeTrial.*` « l’offre Team ». Also checked: *instruction set* → « jeu d’instructions » (`ui.agents.pages.ask.body_agent`, `ui.common.errors.publish_unsupported`); *built-in agent* → « agent intégré » (`ui.agents.publication.name_reserved_builtin.*`, `ui.agents.detail.alert.builtin_title`); *Agent Hub* → « Hub des agents » (`ui.hub.pages.header.title`); short *hub* → « le hub » (pre-existing `published.listed`, `sign_in.needed`, and the context note forbidding expansion in `receipt.title_hub`); *Radient console* → « console Radient » (sibling). No concept is named twice.
3. **Placeholders / ICU argument sets — pass, exact.** Parsed both sides with the project's own `@formatjs/icu-messageformat-parser`: every one of the 15 keys has an identical argument set — `{name}`, `{destination}`, `{count}` + `{org}`, or none. The only AST difference is fr's extra `many` category in `target.blocked_hint`, which is required (see 4). `keys.gen.ts` types the call site `{ count: number; org: string }`.
4. **CLDR plural categories for fr — pass.** `new Intl.PluralRules('fr').resolvedOptions().pluralCategories` → `['one','many','other']`; `select()` gives `one` for 0 and 1, `other` for 2/5, `many` for 1 000 000. The value carries exactly `one`, `many`, `other`; the `one` arm keeps the named organisation and both other arms say « l’une des organisations indiquées ci-dessus », as `plural_guidance` requires. Matches the fr style guide's plural section (and the shipped `ui.schedules.count.hidden` / `ui.projects.*` parents).
5. **No English left — pass.** The only Latin tokens outside the placeholders are `hub`, `Team`, `Radient`, `console` — `Team` licensed by the context ("the product tier's name"), `Radient` a product name, `hub`/`console` this locale's shipped renderings. No English sentence or calque elsewhere.
6. **Width sanity for the footer/button keys — pass, by arithmetic on the shipped CSS (no rendered measurement).**
   - `action.publish` « Publier » 7 chars vs en 7; `action.publishing` « Publication… » 12 vs 11 (one word + one U+2026, as the sidecar budgets); `action.update_listing` « Mettre à jour la fiche » 22 vs 14 (**+57%**, the one value above the style guide's 15–25% band).
   - Geometry: `DialogFooter` is `flex flex-col-reverse gap-2 sm:flex-row sm:justify-end` (`ui/dialog.tsx:174`) inside a panel capped at `max-w-xl` = 576 px (`MAX_WIDTHS.sm`, `base-dialog.tsx`), content padding `p-6` → 528 px inner. Buttons are `size="lg"` `px-4` `gap-2`, `shrink-0` + `whitespace-nowrap`, floor `min-w-25` (100 px) — so labels neither wrap nor shrink; the risk class is overflow, not truncation.
   - Worst state is the three-button footer (`Annuler` from `ui.common.actions.cancel`, `Modifier l'agent`, this label): ≈83 + 148 + 192 px + 2 gaps ≈ **456 px of 528 px**. English control ≈398 px. Fits with ~70 px spare; nothing forces a shorter French word.
   - Disclosed: this is an estimate from the class strings and per-character advance, not a screenshot — this role has no browser tool. The zh-CN sibling audit of the same head discloses the same limit.

## Cleared items worth recording

- **Key parity and containment:** 46 keys in both files, identical order, no duplicates; base `3378319980f` has 31 keys, head 46, **0 removed and 0 pre-existing values changed** (base file sha == `origin/main` file sha), so the audited delta is exactly the 15 added values.
- **All 15 keys are used** exactly once each in `upload-agent-dialog.tsx` (footer 756–762, receipt 832–851, intro 946–962, picker hint 1040, availability 1227) — no dead key, no leftover literal at those sites.
- **Typography:** U+202F before every `:` and `;` in prose, U+2019 apostrophes (no straight `'`), U+2026 ellipsis (no `...`), « … » with U+202F inside; NFC on every value; no bidi controls, no edge whitespace, no double spaces. Conforms to `style-guides/fr.md` "Punctuation & typography".
- **`count: 0`:** the caller guards the branch (`blockedTargets.length > 0`), so the render path never reaches the count-0 case; fr's `one` covering 0 is therefore unreachable today. Checked, not a finding — but it is why the `one` arm must keep a real `{org}`.
- **Repo gate:** `node --test scripts/i18n/locale-parity.test.mjs` → `tests 44 / pass 44 / fail 0`, which includes fr key coverage, unknown-key, ICU placeholder preservation and not-an-English-stub for this namespace.

## Not checked

- The other six locales on this branch (separate auditors).
- A rendered pixel capture of the dialog footer/header (no browser tool in this role) — the width claim above is CSS arithmetic, stated as such.
- Runtime activation / release: catalogue-only audit.

## Verdict

`changes_requested` — one MAJOR (`intro.public` word order, one-line fix) and one NIT (`blocked_hint` `de {org}` elision, deferred). Everything else in the 15-key delta passes; the 31 pre-existing values are byte-identical to `origin/main` and were not re-judged.
