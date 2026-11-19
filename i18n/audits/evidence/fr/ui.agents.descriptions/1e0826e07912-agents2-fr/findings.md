# i18n audit, round 2 — `fr` — `ui.agents.descriptions` + `ui.agents.detail.install`

- Instance: `1e0826e07912-agents2-fr`
- Auditor: `i18n-auditor`, session `1e0826e07912`
- Model: `radient/auto` — fallback. The session's primary `anthropic/claude-sonnet-5-5` failed on
  provider quota and fell back `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`. Recorded
  because the identity must be the model that actually judged the copy.
- Audit date: 2026-10-30
- Verifies: round 1, session `6b56c14dd76e` (`scratchpad/agents-audit/fr/receipt.json`),
  verdict **CHANGES_REQUESTED**, 0 BLOCKER / 1 MAJOR / 6 MINOR / 2 NIT.
- **Verdict: PASS** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 2 NIT over 14 values.

Independence: I did not write these values (translator session `3ef6295a5545`), and I am not
session `6b56c14dd76e`, which ran round 1. No translation or MT service was used to compare or
back-translate; every judgement below is a reading of the French against the English source and
its sidecar.

## Round-1 findings, re-verified on the bytes

`claimcheck.py` asserts, against the current target file, that the objected-to form is absent and
the repaired form present — not that a fix was promised. All nine pass except N2, which is
withdrawn (below).

| R1 id | Sev | Key(s) | Current fragment | Status |
| --- | --- | --- | --- | --- |
| F1 | MAJOR | manager, qa_tester, scout | `rend compte honnêtement` · `fournit une matrice QA ciblée` · `présente ses constats, preuves à l'appui` | **fixed** — all three bare transitive `rend` gone; three different reporting verbs, all correct |
| F2 | MINOR | aida | `orchestre des agents et des équipes en votre nom` | **fixed** — partitives restored, `en votre nom` is *on your behalf* |
| F3 | MINOR | architect | `peut rédiger des documents, mais ne modifie jamais le code existant` | **fixed** — finite verb carries the negation |
| F4 | MINOR | coder | `Réalise de bout en bout une tranche de travail délimitée … puis rend compte des changements` | **fixed** — *implements*→`Réalise`, *reports*→`rend compte`, *slice*→`tranche` |
| F5 | MINOR | copy_reviewer | `compréhension, ton, étayage des affirmations, tics de l'IA` | **fixed** — a criterion, parallel with the other two |
| F6 | MINOR | qa_tester | `pré-vérifie le banc d'essai, … les cas négatifs` | **fixed** — the *pre-* is back, `cas négatifs` is QA French, `banc d'essai` idiomatic (see NIT-2 for the coinage's spelling) |
| F7 | MINOR | tui_designer | `parcours pensés d'abord pour le clavier, densité dans de petites zones d'affichage fixes` | **fixed** — four parallel noun phrases; *viewport* no longer `fenêtres` |
| N1 | NIT | reviewer | `ne modifie jamais le code qu'il relit` | **fixed** |
| N2 | NIT | scout | `dans l'espace de travail et sur le web` (unchanged) | **withdrawn — the suggestion was wrong** |

**N2, withdrawn on evidence.** Round 1 called `espace de travail` a consistency call and suggested
`dossier de travail`. The core glossary (`i18n/glossary.md` §2) pins *workspace* → **espace de
travail** for fr, so the suggestion would have broken the glossary, not fixed a deviation. The 12
catalogue values round 1 cited are a different concept: they are the session's working
*directory* as a filesystem path (`Chemin du dossier de travail`, `Impossible de résoudre ce
fichier dans le dossier de travail de la session`). Keeping `espace de travail` is the correct
reading; no action.

Two round-1 evidence figures were slightly off, and the corrections do not change its
conclusions: `cheffe de cabinet` appears in 8 shipped values, not 6 (`chef de cabinet`, masculine:
0); `dossier de travail` is 12 case-insensitively — 9 lowercase plus 3 sentence-initial.

## Did a correction introduce a new fault?

Mostly no. The install file is **byte-identical to round 1's target** (`a80c0c68…`), so nothing
can have changed there. The descriptions were edited in nine places; reading them again for
faults the fix itself could have planted:

- Sentence grammar, agreement, punctuation and typography: clean. Every `:` / `;` still carries
  U+202F, every apostrophe is U+2019, no straight quotes, no `...`, NFC throughout, tab indent,
  LF, trailing newline.
- Claim drift: none. Each repaired sentence still says what the English says, no more and no less.
- The two things a second pass does notice are both NITs below, and neither is a regression in
  meaning — one is a coined verb, one is length the fixes added.

## Findings

### NIT-1 — `coder` and `tui_designer` grow past the guide's length band (fit)

Measured characters, target vs English (`validate.mjs` + count): `coder` 159 / 121 = **1.31**;
`tui_designer` 224 / 178 = **1.26**. The fr guide records that French "runs roughly 15-25% longer
than en" and asks for shorter synonyms over truncation. Group mean is now **1.195** (round-1's fit
block recorded 1.14 before the fixes); five of fourteen values are over 1.20 —
`coder` 1.31, `tui_designer` 1.26, `ux_reviewer` 1.24, `architect` 1.22, `install_to_edit` 1.53 —
three of which the remediation pushed there.

No layout is at risk, so this is not MINOR: the roster line is `truncate` inside a 256 px row with
the full sentence in the row's `title` (`agents-page.tsx`, line-2 blurbs), the detail page wraps
the same sentence in a `ReadBlock`, and `install_to_edit` is an auto-width secondary `Button`
beside a primary action (`agent-detail.tsx:914-921`) — 1.53× on a label that sizes to itself.

If the locale owner wants the card line denser, `coder` has one compression that stays inside the
band: `Réalise de bout en bout une tranche de travail délimitée avec tous les outils, puis rend
compte des changements et de leur vérification.` — 136 chars, 1.12×, at the cost of "how it was
verified" becoming "their verification". `tui_designer` has none that keeps both the viewport and
the Unicode nuance, and its length is intrinsic (34 words vs 21). **No action required.**

### NIT-2 — `qa_tester`: `pré-vérifie` is a coinage, and hyphenated

Current: `… : pré-vérifie le banc d'essai, …`. The fix is right on meaning — the English
*preflights* keeps its "before the run" sense, which round 1 correctly asked for. The word itself
is a construction: French forms `pré-` + verb solid (`préinscrire`, `prévisualiser`,
`préremplir`, `prévalider`), so the hyphen is nonstandard, and the settled phrasing would be
`vérifie au préalable` / `contrôle en amont`. A native reader understands it immediately, so this
is a NIT, not a defect: take `vérifie au préalable` only if the line is touched for another
reason — it costs 11 characters the card does not have to spare.

## Each of the 14 values, judged

| Key | Claim | Idiom / register | Length |
| --- | --- | --- | --- |
| `aida` | yes — orchestrates, watches, reports back; `en votre nom` | native; `cheffe de cabinet` is the shipped form (8 values), feminine matches the sidecar's "her role" | 1.13 |
| `architect` | yes | native; `conception ou solution technique avec ses compromis` reads as a proposal, as intended | 1.22 |
| `coder` | yes | native | 1.31 (NIT-1) |
| `copy_reviewer` | yes — both copy classes kept, `étayage` is the criterion, `tics de l'IA` is exact | native | 1.05 |
| `designer` | yes — judged from the rendering, not the code; D kept | native | 1.12 |
| `librarian` | yes — names/describes/tags, learns vocabulary, keeps the catalogue usable; `Bibliothèque` capital kept | native; `vous conservez` is the right person for a product addressing the operator | 1.09 |
| `manager` | yes — done / in flight / blocked and who it waits on | native; `de qui cela dépend` is exactly *on whom* | 1.18 |
| `qa_tester` | yes — preflight, real paths, negative cases, scoped QA matrix, no repo edits | native except NIT-2 | 1.14 |
| `reviewer` | yes — `diff`/`MR`/`PR` kept, `gravité` for severity, never edits what it reviews | native | 1.13 |
| `scout` | yes — read-only research, workspace and web, evidence, changes nothing | native; `preuves à l'appui` is idiomatic | 1.14 |
| `tui_designer` | yes — keyboard-first flows, fixed viewports, colour/Unicode fallbacks, measured geometry, T kept | native; `zones d'affichage` is the right rescue of *viewport* | 1.26 (NIT-1) |
| `ux_reviewer` | yes — real flow end to end, discoverability, feedback, error recovery, keyboard paths, copy | native; `retours` for feedback is fr UX register | 1.24 |
| `install_to_edit` | yes — installs to edit, not shortened to bare `Installer` (sidecar forbids it); `modifier` matches the sibling Edit label (`ui.agents.detail.action.edit` = `Modifier`) | native | 1.53 (label sizes itself) |
| `installing` | yes — one word + U+2026, as the sidecar demands so the row does not jump | native | 1.18 |

## Mechanical, measured here

| Layer | Result |
| --- | --- |
| JSON, key set and key order vs English | 12/12 and 2/2 identical order |
| ICU parse with the repo's own `@formatjs/icu-messageformat-parser` | all 28 values (14 × 2 locales) parse; all are literal — no arguments, plurals, selects or tags. Placeholder/CLDR parity is **vacuous** here, not merely untested |
| NFC | 14/14 |
| U+202F before every `:` `;` `!` `?` | 14/14 (0 violations) |
| Apostrophes / ellipsis / NBSP / doubled spaces / BOM / line endings | all U+2019; one U+2026, no `...`; no U+00A0; no doubled or edge spaces; no BOM; LF; tab indent; trailing newline |
| Identical to English | none |
| Tokens kept | `diff`, `MR`, `PR`, `QA`, `UX`, `Unicode`, `web`, `IA` (settled fr, 27 values), finding prefixes C/D/T/U |

Commands and their real output: `audit.log`. Validator: `validate.mjs` (exit 0). Claim check:
`claimcheck.py` (exit 0).

**What the repo gates can and cannot see.** `generate.mjs --check` and `context-parity.mjs` pass,
and `ledger-check.mjs` passes over 742 entries — but the fr targets are **not** in
`src/i18n/catalogues/fr/`, and the ledger has **no entry** for either namespace, so none of that
green is evidence about these two files. It is evidence about the tree as it stands. Adding the
ledger rows (with both hashes) is the coordinator's step.

**Provenance the ledger must not lose.** The handed-over `*.en.json` copies are value-identical to
the repo sources but re-indented with one space, so their hashes differ. The ledger row must carry
the repo hashes:

| File | Repo (canonical) | Handed copy |
| --- | --- | --- |
| `en/ui.agents.descriptions.json` | `ec18513f0ebaa99be4c329a8ea5896631fd2b9e4f4d53febdc5c7acd049b5511` | `c865345f…` |
| `en/ui.agents.descriptions.context.json` | `6311128dc89d50d886f3066f9cea2c802482a7db9979d9c5cc4bd93cdd8a7398` | — |
| `en/ui.agents.detail.install.json` | `964c83098370d82d74df8c21d6f1f69e74a76f4ea73b3af7bc16ac06981fbcf0` | `cb0674b7…` |
| `en/ui.agents.detail.install.context.json` | `f82578e4390f18d396fa229286d5395492618bd93ccbfa43d8d0dbe5a6530307` | — |
| `fr/ui.agents.descriptions.json` (target) | not in tree — `c97aa95926e4a6ddd1e07b9cedb0178b18fddcd940db3c06d5bd3f7cf1418f02` | — |
| `fr/ui.agents.detail.install.json` (target) | not in tree — `a80c0c6880cd9417dd3eff3c0ad60115367219e58249998296efa3cf3eb63b59` | — |

## Limits of this audit

- **No rendered frame.** The fr targets are not in the tree, so no locale rig this session could
  render these strings; fit is judged from the components' own source (`truncate` + `title` in the
  roster, `ReadBlock` on the detail page, auto-width `Button` for the install label), not from a
  screenshot. A rendered check belongs with the commit that lands the files.
- **One pass, done twice-over but by one session.** No third reader saw these bytes.
- Ledger assembly and the evidence bundle under `i18n/audits/evidence/fr/…` belong to the
  coordinator; this directory is staging, not the record of record.
