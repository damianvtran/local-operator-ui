# i18n audit — `fr` — `ui.agents.routing` (12 values)

- Instance: `00cfed525b6e-agents3-fr`
- Auditor: `i18n-auditor`, session `00cfed525b6e`; model `radient/auto` after the session's
  primary `anthropic/claude-sonnet-5-5` hit provider quota and fell back
  `openai/gpt-6-astra` -> `kimi/k3.1-pro` -> `radient/auto`.
- Date: 2026-10-30. Source `en` `d7903758…`, target `fr` `e11467ee…`.
- **Verdict: PASS** — 0 BLOCKER, 0 MAJOR, 5 MINOR, 4 NIT.

These are the shipped routing sentences an installed agent card and the destination
pickers show. I did not write them (translator session `3ef6295a5545`); every judgement
below is a reading of the French against the English and its sidecar. No MT service.

## Mechanical — clean

Valid JSON; 12/12 keys in source order; NFC; LF, tab indent, no BOM, no CR. No ICU
braces, rich tags or backticks anywhere in either file, so placeholder/type parity and
CLDR category coverage are vacuous here. Typography exact: U+202F before all seven `:`
and the one `;`, no ASCII space before any; U+2019 only; no ASCII quotes; no `...`; em
dash spaced. 0/12 values equal English. `check-strings`, `context-parity` and
`generate --check` are green at `98a9125f5cc`, but none of them reads this file — it is
not in the fr catalogue yet — so they are context, not evidence about the namespace.

## Meaning — preserved on every key

Aida's three occasions, Architect's HOW, Coder's bounded slice, Copy Reviewer's two
surfaces and five criteria, Designer's LOOKS, Librarian's Library, Manager's roll-up,
QA's end-to-end proof, Reviewer's five artefact kinds, Scout's read-only promise,
TUI Designer's five terminal concerns, UX Reviewer's EXPERIENCE and its contrast with a
visual review: all present, nothing added, no negation or polarity tilt. The emphasis
devices survive as VOIT / COMMENT / EXPÉRIENCE, and Scout's `rien n'est modifié` keeps
its force.

## Fit

Every key is inside the guide's 15–25% band (max 1.1975 on `reviewer`, total 1.128 over
the 12 values, 2,422 -> 2,732 chars). Both languages truncate at the card width named by
the sidecar, so French adds no new overflow risk.

## Findings

| id | sev | key(s) | what |
| --- | --- | --- | --- |
| M1 | MINOR | aida | `lancer du travail … entre agents` — `entre` collocates with *répartir*, not *lancer* (calque of "across agents") |
| M2 | MINOR | copy_reviewer | `billets de blog, posts LinkedIn et X` — same object in two languages; the fr corpus uses no form of *post* |
| M3 | MINOR | copy_reviewer | `Pour le texte visible, jamais …` — EN imperative lost its verb, leaving a note fragment |
| M4 | MINOR | scout | `sur un fonctionnement` — bare ellipsis, vague without an antecedent |
| M5 | MINOR | copy_reviewer × descriptions | `AI-isms` (routing, per its sidecar) vs `tics de l'IA` (sibling) — one house concept, two labels on the same agent; the deviation is sibling-side |
| N1 | NIT | designer | `un changement visible` drops "user-visible"; sibling says `visible par l'utilisateur` |
| N2 | NIT | ux_reviewer | `une revue … sur l'apparence` — looser than `de son apparence` |
| N3 | NIT | manager | `entre agents ou dépôts` drops "several" |
| N4 | NIT | copy_reviewer | `UI` rendered `chaînes d'interface`; permitted (guide pins TUI, not UI), flagged only against the brief's token list |

Everything else reads as native product French, including the places calque usually shows:
`peser les compromis`, `planifier une refonte`, `les effets de bord`, `repérer ce qui
mérite attention`, `relancer ce qui est bloqué`, `en toute indépendance`,
`de bout en bout`, `divulgation progressive`, `sans accroc`.

## Sibling consistency

`agent/agents`, `équipe(s)`, `travail`, `dépôt(s)`, `changement`, `prose grand public`,
`étayage des affirmations`, `Bibliothèque` capitalised, `éléments` for saved assets, `UX`,
`en terminal`, `de bout en bout` all agree with `ui.agents.descriptions`. The one
divergence is M5. The routing family's infinitive occasion phrases versus the
descriptions' third-person noun summaries is the sidecars' design, not drift.
