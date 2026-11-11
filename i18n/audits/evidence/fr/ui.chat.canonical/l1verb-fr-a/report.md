# Independent translation audit — `fr`, slice L1 tool-row verbs (pass A)

- **Locale:** `fr` · **Namespace / file group:** `ui.chat.canonical` · **Keys:** 182 = 91 settled/running pairs
- **Audit date:** 2026-11-11 · **Audit ID:** `l1verb-fr-a`
- **Auditor:** `i18n-auditor` (team `lopdev`), session `2cb2b603e46b`
- **Served model:** `deepseek/deepseek-flash` — source: this session's harness header line (`Model: deepseek/deepseek-flash`); no fallback observed, no role/model pin applied
- **Independent from the translator:** yes — translator was `openai/gpt-6.1-sol` (different agent, different session), and this auditor did not translate, edit or re-key a single byte of `fr.json`
- **Verdict:** `changes_requested` — **0 BLOCKER · 3 MAJOR · 6 MINOR · 3 NIT**
- **Unresolved blocker/major:** 3 (F-01, F-02, F-03)

Audited bytes (this is the object of the verdict; the file is a prep artifact, not yet merged):

| Input | Path | SHA-256 |
|---|---|---|
| target | `.worktrees/_l1-prep/fr.json` | `6d62a57b3a14a5bf248826d7b6da8d27ae04a9700cd1e64f3462d20a4765b078` |
| en source + notes/context | `.worktrees/_l1-prep/keys.json` | `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419` |
| en catalogue on disk (source of truth the keys.json copy mirrors) | `src/i18n/catalogues/en/ui.chat.canonical.json` | `a385671b988e5f03df6f650beb4a06f73c9efaead2316dfa9ab15bf043798765` |
| en context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` | `2e755f12e46bb6dded6dbf950eda6402b0a7bcb05e9489fa17f7369543f3ac7f` |
| shipped fr catalogue (consistency reference only) | `src/i18n/catalogues/fr/ui.chat.canonical.json` | `72353c812ac37c1728af21c33d429fa04e9c3ebf8e55c701b22617d443fb6d2e` |

Read first, in this order: `i18n/style-guides/fr.md`, `i18n/style-guides/en.md`,
`i18n/glossary.md`, the en source with each key's `context.role`/`notes`/`width`,
then the 182 `fr` values, then the shipped `fr` `tool_row.*` column for
consistency. Every key was read; every pair read a second time against its
`context.role` (the tool/operation that row belongs to).

---

## 1. Mechanical verification — clean, with one collision

Commands and actual output are in `audit.log` (execution log, not notes).

| Check | Result |
|---|---|
| JSON valid, 182/182 string values, no empty/blank | pass |
| Key set **and order** identical to `keys.json` | `order equal: True \| count 182` |
| ICU parse (`@formatjs/icu-messageformat-parser`, repo's own dependency, `requiresOtherClause`) | `parsed 182 keys; ICU/placeholder problems: 0` |
| Placeholder parity vs en | pass — **0 placeholders on either side** (see caveat below) |
| `IntlMessageFormat(value,'fr')` for every value | `IntlMessageFormat(fr) failures: 0` |
| Markup / backtick code / `<Rich>` / `{}` / `%s` in values | none present, none added |
| Trailing punctuation, leading/trailing or double spaces, `...`, `:`, ASCII `'` or `"` | none — `’` (U+2019) used throughout; no colons in values |
| Control / bidi-format characters (Cc/Cf/Zl/Zp) | none — no manual bidi characters (fr is LTR anyway) |
| Letters outside French orthography | none |
| English left in a value | none (only `Python` — an allowed technology name — and `Internet`, a French word) |
| Width | no value exceeds the 4-word ceiling (the sidecar's own limit) — but **60 of 182 sit exactly at 4 words**, because the leading `A` spends one; 5 values exceed 26 cells, max 30 (`raised_panic`, F-04) |
| **Duplicate renderings where the English differs** | **1 class, 2 keys per state — F-02** |

Caveat recorded honestly: the 182 messages carry no ICU structure at all (`placeholders: 'none'`,
no plurals), so a plural-category (`one`/`many`/`other`) check has nothing to
apply to here; `fr`'s `few`-category rule is not exercised by this slice. Nothing
in this group can break on ICU.

## 2. The surface this copy lands in (why width and column convention matter)

`src/renderer/src/features/chat/components/trace/tool-row.tsx` renders the row as
`[glyph] [verb in sans, shrink-0 whitespace-nowrap] [object in mono, truncates]`,
"the verb and the object are one phrase, 8px apart", and states the verb is
"at most three short words" because the object is the half that truncates.
The verb **never** truncates — so a long verb is paid for by the object.
`tool-row-model.ts` says the row is meant to read as a sentence
(`Ran pnpm vitest run`), `settled` = past tense a finished row prints,
`running` = present participle a live row prints.

Crucially, the **same column already ships in French** for the Team Bridge rows
(`tool_row.bridge.verb.*`, 17 settled/running pairs in the shipped fr catalogue).
Their convention is uniform:

- settled = **bare past participle**: `Créé :`, `Réservé :`, `Libéré :`,
  `Lu dans`, `Publié dans`, `Envoyé à`, `Répondu à`, `Transmis à`,
  `Fil lu dans`, `Conversations listées`, `Réaction retirée dans`,
  `Annuaire de l’équipe consulté`, `Team Bridge utilisé`, …
- running = **deverbal noun**: `Création :`, `Réservation :`, `Libération :`,
  `Lecture dans`, `Publication dans`, `Envoi à`, `Réponse à`, `Transmission à`,
  `Liste des conversations`, `Consultation de l’annuaire`,
  `Retrait de la réaction dans`, `Prise en charge :`, `Utilisation de Team Bridge`, …
- generic verbs: `Appel :` / `Appel en cours :`

17/17 shipped pairs follow it; 0/17 use an auxiliary verb or a bare indicative.
This slice introduces a **third** convention into the same gutter (F-03).

## 3. Findings — MAJOR

### F-01 · MAJOR · `updated_*` renders "update" as *actualiser* (refresh), while the product says *mise à jour*

Keys (7): `updated_agent`, `updated_team`, `updated_secret`, `updated_project`,
`updated_milestone`, `updated_todos`, `updated_secure_input`.

| Key | en | current fr | suggested fr |
|---|---|---|---|
| `updated_agent` | Updated agent / Updating agent | `A actualisé l’agent` / `Actualise l’agent` | `A mis à jour l’agent` / `Met à jour l’agent` |
| `updated_team` | Updated team / Updating team | `A actualisé l’équipe` / `Actualise l’équipe` | `A mis à jour l’équipe` / `Met à jour l’équipe` |
| `updated_secret` | Updated secret | `A actualisé le secret` / `Actualise le secret` | `A mis à jour le secret` / `Met à jour le secret` |
| `updated_project` | Updated project | `A actualisé le projet` / `Actualise le projet` | `A mis à jour le projet` / `Met à jour le projet` |
| `updated_milestone` | Updated milestone | `A actualisé le jalon` / `Actualise le jalon` | `A mis à jour le jalon` / `Met à jour le jalon` |
| `updated_todos` | Updated todos | `A actualisé les tâches` / `Actualise les tâches` | `A mis à jour les tâches` / `Met à jour les tâches` |
| `updated_secure_input` | Updated secure input | `Saisie sécurisée actualisée` / `Actualise la saisie sécurisée` | `A mis à jour la saisie sécurisée` / `Met à jour la saisie sécurisée` |

**Problem.** In this product's shipped French, `actualiser`/`actualisation` is the
word for **refresh** and `mise à jour` is the word for **update** — counted in the
shipped fr catalogue: `mise à jour` 206, `mis à jour` 49, `mettre à jour` 36
(update family, e.g. `ui.agents.pages.change.updated` EN "Updated" → `Mis à jour`,
`ui.agents.skills.badge.updated` EN "Updated" → `Mise à jour`), against
`actualiser` 10 / `actualisation` 13 / `actualisez` 2 / `actualisé` 2, and both of
those last two are literally EN "refresh"/"has been refreshed". A French reader
therefore reads `A actualisé l’agent` as *reloaded the agent's data*, not *wrote
the agent's config* — a wrong claim about a write operation, which is exactly the
class of error that matters in a trace. This is a glossary-adjacent consistency
violation (the term is not in `glossary.md`, but it is settled product vocabulary),
not a nit.

Width note: `A mis à jour la saisie sécurisée` is 31 cells — equal to the widest
shipped bridge value (`Annuaire de l’équipe consulté`, 31), so it is in family, but
it is the one to watch if the gutter tightens.

### F-02 · MAJOR · `peeked_at` / `peeked_at_session` collapse onto the `viewed_*` wording — two different operations print identically

| Key | en | current fr | collision | suggested fr |
|---|---|---|---|---|
| `peeked_at_session` | Peeked at session / Peeking at session | `A consulté la session` / `Consulte la session` | **byte-identical** to `viewed_session` | `A survolé la session` / `Survole la session` |
| `peeked_at` | Peeked at / Peeking at | `A consulté` / `Consulte` | same rendering as every `viewed_*` | `A survolé` / `Survole` |

Also affected as the *losing* side: `viewed_session` (`sessions`'s `info`),
`viewed_agent` (`agent`'s `show`), `viewed_team`, `viewed_project`, `viewed_network`.

**Problem.** Mechanical duplicate: `A consulté la session` and `Consulte la session`
are each used by two keys whose English differs (`Viewed session` / `Peeked at
session`), and the two are different operations on different tools —
`sessions … info` returns metadata, `sessions … peek` reads conversation steps;
`hub`/`jobs … peek` likewise reads content. A reader auditing what the agent did
cannot tell a metadata read from a content read, which is a privacy-relevant
distinction the English deliberately keeps. `context.role` for `peeked_at`
explicitly separates the two ops (`hub` `peek` + `jobs` `peek`) from `show`/`info`.

**Suggested wording.** `survoler` is transitive, short (10 cells) and reads as a
non-committal look, keeping the 1–4 word budget. If the team prefers the fuller
idiom, `A jeté un œil à la session` / `Jette un œil à la session` works and keeps
the trailing `à` relation to the object, but it is 5–6 words (width cost). Either
way `viewed_*` keeps `consulter`.

### F-03 · MAJOR · the settled column breaks the `fr` style guide's past-participle rule and the shipped verb column's convention

Keys: **87 of 91 settled values** (all except `linked_session_to`,
`unlinked_session_from`, `read_network_log`, `updated_secure_input`).

Examples:

| Key | en | current fr | suggested fr (option a) |
|---|---|---|---|
| `ran` | Ran | `A exécuté` | `Exécuté` |
| `read` | Read | `A lu` | `Lu` |
| `edited` | Edited | `A modifié` | `Modifié` |
| `listed_variables` | Listed variables | `A listé les variables` | `Listé les variables` |
| `found_definition` | Found definition | `A trouvé la définition` | `Trouvé la définition` |
| `cancelled` | Cancelled | `A annulé` | `Annulé` |

**Problem.** `i18n/style-guides/fr.md` §Formality & tone is binding on the
auditor ("everything here is fr-specific and binding for translators and the
auditor"): *"Terse: statuses are past participles («Enregistré», «Repris») —
never «Votre session a bien été enregistrée avec succès»"*. The wave instead wrote
passé composé throughout (`A exécuté`, `A lu`, …), which is also a third
convention in a column whose shipped fr half is uniformly bare participle
(`Créé :`, `Lu dans`, `Conversations listées`) — the operator will see
`Créé : #general` one row above `A créé le réseau`. The auxiliary also costs 2–3
cells in a gutter whose verb never truncates.

**Why this is reported as MAJOR and not BLOCKER, and what makes it non-trivial.**
Meaning is intact everywhere; this is register/convention. Two admissible
remediations:

- **(a) Rework to the shipped convention** — drop the leading `A ` from the 87
  values (the participle does not agree with anything, so this is mechanical:
  `A listé les variables` → `Listé les variables`). Caveat to handle explicitly:
  for `wrote` the bare participle *is* the 3sg present (`Écrit`), and for
  `joined_network` it is too (`Rejoint`), so those two pairs would become
  indistinguishable in a bare-participle settled column unless the running form
  takes the shipped deverbal noun (`Écriture`, `Connexion au réseau`) — which is
  what the shipped column already does.
- **(b) Record the exception** — if the team prefers the fuller clause (it does
  read as a sentence, which is what `tool-row-model.ts` asks for), the choice must
  be recorded in `fr.md` as a wave call with its reason, because as written the
  guide forbids it. The 4 object-first values (`Session liée à`,
  `Journal réseau lu`, `Saisie sécurisée actualisée`, `Session dissociée de`) would
  then also need to be brought into line, since they break the wave's own pattern.

The running half (all 91 present indicative: `Exécute`, `Lit`, `Écrit`) diverges
from the shipped nominals the same way, but I am **not** filing that as MAJOR:
the nominal alternative is measurably longer (`Mise à jour de la saisie sécurisée`
36 cells, `Redimensionnement de la console` 31) and the guide says nothing about
running forms. If (a) is taken, take the nominal running form for `wrote` and
`joined_network` at minimum.

## 4. Findings — MINOR

| ID | Key | en | current fr | problem | suggested fr |
|---|---|---|---|---|---|
| F-04 | `raised_panic` | Raised panic / Raising panic | `A déclenché l’alerte d’urgence` / `Déclenche l’alerte d’urgence` | `panic` in this product is not an alert: `network … panic` is *"Incident: broadcast a revoke and rotate"* (it revokes members, rotates the epoch and marks the network untrusted — `local_operator/network/cli.py:744`). "Emergency alert" understates that something was revoked. It is also the longest value in the slice (30 cells / 4 words; en is 12 cells) against a gutter whose verb never truncates. | `A déclenché la panique` / `Déclenche la panique` (23/21 cells) — or `A déclenché le panic` if the team prefers the operation's own name in English. |
| F-05 | `searched_the_web` | Searched the web | `A recherché sur Internet` / `Recherche sur Internet` | Shipped fr calls this surface *le web*, lowercase: `Recherchez sur le web…`, `Recherche web`, `pages web`, `seules les pages web…` (5+ occurrences). `Internet` (capitalised) appears in shipped copy only for the connection (`une connexion Internet`). | `A recherché sur le web` / `Recherche sur le web` |
| F-06 | `checked_network_status` | Checked network status | `A vérifié le réseau` / `Vérifie le réseau` | Drops *status*: reads as "checked the network" (its existence/health) rather than "checked the network's status", which is what `network … doctor` reports. Omission of a noun the English carries. | `A vérifié l’état du réseau` / `Vérifie l’état du réseau` (26 cells — in family) |
| F-07 | `typed_in_console` | Typed in console | `A saisi en console` / `Saisit en console` | `saisir en console` is telegraphic; the shipped column keeps a determiner (`Lu dans`, `Réaction dans`, `Lecture dans`). Unidiomatic for product copy. | `A saisi dans la console` / `Saisit dans la console` |
| F-08 | `read_network_log`, `updated_secure_input`, `linked_session_to`, `unlinked_session_from` | Read network log / Linked session to / … | `Journal réseau lu` / `Lit le journal réseau`; `Saisie sécurisée actualisée` / `Actualise la saisie sécurisée`; `Session liée à` / `Lie la session à`; `Session dissociée de` / `Dissocie la session de` | The settled half flips to object-first while its own running twin is verb-first, so the pair does not read as one phrase (`Journal réseau lu` + object vs `Lit le journal réseau` + object). Every other pair in the slice keeps both halves parallel. | Make both halves verb-first: `A lu le journal réseau`, `A mis à jour la saisie sécurisée`, `A lié la session à`, `A dissocié la session de` (or, under F-03(a), object-first in **both** halves). |
| F-09 | `paused`, `steered` | Paused / Steered | `A suspendu` / `Suspend`; `A réorienté` / `Réoriente` | Shipped fr settles these differently in the very same feature: EN "Paused" → `En pause`, "Pause {label}" → `Mettre {label} en pause`, "Pause schedule" → `Mettre la planification en pause`; EN "Steered" → `Orienté`, "Steer the agent" → `Orienter l’agent`, "steers the running turn" → `infléchit le tour en cours`. `réorienter` adds a "re-" that the English does not have and reads spatial. | `A mis en pause` / `Met en pause`; `A orienté` / `Oriente` |

## 5. Findings — NIT (capped at 5; 3 filed)

| ID | Key | current fr | note | suggested fr |
|---|---|---|---|---|
| F-10 | `listed_network_peers` | `A listé les pairs` / `Liste les pairs` | Drops *network*; the row's object is the network name, so it stays inferable — acceptable to keep if width matters. | `A listé les pairs du réseau` / `Liste les pairs du réseau` |
| F-11 | `captured_console` | `A capturé la console` / `Capture la console` | `console … screenshot`; `capturer la console` can be read as capturing the process/terminal object rather than taking a screenshot of it. | `A fait une capture de la console` / `Fait une capture de la console` |
| F-12 | `sent_keys` | `A envoyé des touches` / `Envoie des touches` | The row's object is the specific key sequence, so the definite article reads better. | `A envoyé les touches` / `Envoie les touches` |

## 6. Results I checked and am **not** filing

- **Meaning fidelity**: all 91 operations keep their own verb and no
  read/write polarity is swapped — `deleted_*`/`removed_*`/`cancelled*` →
  `supprimé`/`retiré`/`annulé`; reads stay `lu`/`listé`/`consulté`. No negation or
  polarity error, no added agent, no destructive verb that the English does not
  carry.
- **Glossary**: `session`→session, `subagent`→sous-agent, `agent`→agent,
  `team`→équipe, `project`→projet, `appareil`(device), `réveil`(wake),
  `planification`(schedule), `jalon`(milestone), `tâche`(job **and** todo — the
  shipped corpus already renders `todo` as `tâche`, e.g. `mise à jour de tâches`,
  `lecture de tâches`, and `glossary.md` fixes `job` → `tâche`, so the overlap is
  not a violation), `réseau`, `secret`. No kept-English term was translated
  (`panic` aside, F-04).
- **Formality**: `vous` nowhere needed in this group (no address), imperatives not
  used; sentence case throughout, no Title Case.
- **Trailing prepositions** that must bind to the following monospace object:
  `à` kept in `messaged`/`linked_session_to`/`dm`-like rows and in `A écrit à`;
  `de` kept in `unlinked_session_from`/`dissociée de`. Only F-02's fix has to
  preserve one (`à`), and the suggested wording does.
- **`settled`/`running` pairing**: all 91 pairs share the same verb stem
  (`exécuté`/`Exécute`, `lu`/`Lit`, `repris`/`Reprend`); F-02 is the only pair that
  is not distinct from *another* pair, and F-08 the only pairs that are not
  parallel to themselves.
- **RTL / bidi**: not applicable to `fr`; no bidi controls present, no mirrored
  glyphs, no arrows in copy.
- **Width** (cells, verbs are `whitespace-nowrap shrink-0`): median settled
  expansion 1.36× the English, which is normal French; the only outlier is
  `raised_panic` (2.5×, 30 cells → F-04). No value exceeds the 4-word ceiling,
  but 60 sit exactly on it, and it is the leading `A` that spends the fourth
  slot (`A réinitialisé l’agent`, `A synchronisé les agents`, `A prévisualisé le
  renommage`); dropping it under F-03(a) brings the whole column to 1–3 words.

## 7. Method, and what was not done

- No translation/MT service, API or SDK was used to produce, compare or
  back-translate any string; no external translator tooling of any kind. Judgement
  is reading-based, on the en source, the per-key `context.role`/`notes`, the two
  style guides, `glossary.md`, and the shipped fr corpus.
- Nothing was edited: `fr.json`, the catalogues, the context sidecar, the ledger
  and every existing receipt are byte-identical to what I received (verified with
  `git status --porcelain` after each write attempt — see `audit.log`).
- I read no other auditor's report for this slice.
- A second independent pass for this high-visibility group is the manager's call;
  this is pass **A** only, and I re-read all 182 values against their roles twice
  within it.
- Ledger: `ledger-assemble` **refused** (exit 2) because the shipped fr catalogue
  does not carry the 182 keys yet —
  `fr/ui.chat.canonical is not key-complete against English (182 missing, 0 extra) - an incomplete locale cannot be recorded`.
  The row must be assembled by the landing PR, against the landed catalogue, with
  this receipt as the audit it records (translator: `openai/gpt-6.1-sol`).

## 8. Remediation ledger for the coder (one batched commit)

1. F-01 — 7 keys, `actualisé*` → `mis`/`mise à jour`.
2. F-02 — 2 keys (`peeked_at`, `peeked_at_session`), distinct from `viewed_*`.
3. F-03 — a column decision: rework 87 settled values to bare participles (plus a
   distinct running form for `wrote` and `joined_network`), **or** record the
   exception in `fr.md` and align the 4 object-first values with the rest.
4. F-04 … F-09, F-10 … F-12 — wording fixes, no structural work.
