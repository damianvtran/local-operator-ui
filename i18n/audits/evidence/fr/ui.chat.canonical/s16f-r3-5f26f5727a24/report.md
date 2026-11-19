# Audit — S16f generation-card labels, `fr`, round 3

- **Locale:** fr · **Namespace:** `ui.chat.canonical` · **Keys audited:** 10 (the S16f delta)
- **Head audited:** `af876eb052db12ec587ef6353aecebd2c769ae22` (PR #1876, worktree `~/local-operator-ui/.worktrees/i18n-s16a`; HEAD verified, `git status` clean)
- **Auditor:** i18n-auditor, session `5f26f5727a24`, model `deepseek/deepseek-flash` (as stated in this session's runtime model header; no fallback used, none reported)
- **Independence:** this session did not translate these keys (translator `i18n-translator`, `anthropic/claude-sonnet-5-5`); it is a fresh round-3 instance. No round-1/2 report is committed in the repo, so this verdict rests on the landed bytes, the fr style guide (`~/local-operator` `origin/main`), the glossary and the shipped catalogue precedent.
- **Verdict:** `clean-with-findings` — 0 blocker, 0 major, **1 minor**, **1 nit** → ledger status `passed`.

## 1. Bytes under audit

Per-key hash: sha256 over UTF-8 of `json.dumps({key: value}, ensure_ascii=False, sort_keys=True, separators=(',',':'))`.

| key | fr sha256 (16) | en sha256 (16) |
|---|---|---|
| `sound.batch.item_status` | `baf91da58de738da` | `e358c22c488a7071` |
| `sound.batch.summary` | `e7a58def97a3c606` | `09ae93966cdc6b3a` |
| `sound.batch.latest_update` | `0d1f2b6f787b994e` | `427de0b397f00337` |
| `sound.cost.unknown` | `6234473a4f9b57ed` | `a34c87949511c3c4` |
| `sound.cost.no_charge` | `dd7eb405d3b14c53` | `34fb349281118da7` |
| `sound.cost.estimated_zero` | `0c7f9fff71e4231c` | `7a339de1c5eb417a` |
| `sound.cost.batch_unknown` | `6633f156ace5ed40` | `8aabea74c95580d6` |
| `media.image_label` | `47631358ab381012` | `47631358ab381012` (identical by design) |
| `media.sound_label` | `896840e3a17fe2e6` | `50eaf18785e46954` |
| `supplement.sound_fallback_label` | `c707d0bf8f62a342` | `553bf2c11939d42e` |

Whole files (raw-byte sha256):
- `fr/ui.chat.canonical.json` `34a0fdbf1ef412e9e16e3c9da7558e4c1f23ba52ef0cb7638ecd545d49404202` (466 keys)
- `en/ui.chat.canonical.json` `12ec2698434dcb39497e288af62d11d70f0fd71d494a9becf3fd611d6568bbdd` (466 keys)
- `en/ui.chat.canonical.context.json` `95aa203759416c93180b7eb4967e6fcf5bce0dffe20e9d005b431c645e9e11e6`

Both file hashes are the ones `ledger-check` derives for the current tree, so the receipt binds the landed bytes exactly.

## 2. Mechanical (mirror of `git archive HEAD`: `src/i18n`, `scripts`, `i18n`, `package.json`, `tsconfig*`; `node_modules` symlinked, nothing installed)

| gate | result |
|---|---|
| `generate.mjs --check` | pass — `keys.gen.ts` byte-identical to a fresh generation |
| `check-duplicates.mjs` | pass — 1428 files, 0 duplicate keys |
| `check-coverage.mjs` | pass — 7 locales × 158 namespaces, 0 allowed keys |
| `context-parity.mjs` | pass — every English key covered (129 pre-existing allowed gaps) |
| `locale-parity.test.mjs` | pass — 44/44 (fr carries every key, names no extra key, every placeholder preserved, not an English stub) |
| `check-strings.mjs` | pass — 1668 files, 0 new literals (ran read-only against the worktree; `git status` clean before and after) |
| diff's own tests | pass — `generation-card-labels.test.mjs` 27/27, `generation-card-locale-switch.test.mjs` 1/1 |
| own ICU grid | pass — see below |

**Own grid, rendered with the app's own formatter** (`intl-messageformat`, the library `src/i18n/messages.ts` uses), not with a hand-rolled comparison:

- `summary`: 1452 renders over completed/failed ∈ {0,1,2,3,5,11,21,22,100,1000,1000000} × cancelled, unknown ∈ {0,1,2} × `has_attention` ∈ {yes,no}. No throws, no ICU syntax left, no `undefined`. `cancelled`/`unknown` clauses hidden at 0, shown when non-zero. `one` (0 and 1) singular, `many` (10⁶, 2·10⁶, 10⁹ — `de`/`d’` with correct elision: « de terminés », « d’échoués », « d’arrêtés »), `other` plural; 1 500 000 → `other` → « 1500000 terminés » (no partitive, correct French). All three fr CLDR categories (`one|many|other`) are reachable and all three are declared.
- `item_status`: 4 statuses × 3 labels (including a Latin label); unrecognised status falls to `other` → « Statut inconnu », the name is preserved verbatim.
- `latest_update`, the four cost lines, the two media labels and the supplement label: no throws; `count=1` yields the unnumbered form (« Image », « Son »).
- **Negative controls, all 8 caught:** dropped `many` arm, dropped partitive `de`, renamed `{label}`→`{nom}`, dropped the `item_status` `other` arm, ASCII space before `;`, NFD `é`, English « Sound » left in, a second word for the unknown state.
- Typography: all 10 values NFC; no ASCII apostrophe; no ASCII space before French punctuation; `estimated_zero` carries U+00A0 between `0` and the currency sign and U+202F before `;` as landed; `latest_update` U+202F before `:`; summary U+202F before `:` in « À examiner ». The U+00A0 before the currency sign is exactly what `Intl.NumberFormat('fr', {currency:'USD'})` emits, so the space class is right (the corpus's U+202F is its rule for `%`, not for currency).

## 3. Findings

### M1 — MINOR — `ui.chat.canonical.sound.cost.estimated_zero`

- **Landed:** `Coût estimé à 0` U+00A0 `$` U+202F `; frais finaux non confirmés.`
- **Problem:** the bare `$` is the only dollar rendering in fr. The shipped fr prose spells the ISO code — `ui.providers.phone.action.activate` « Activer pour {amount} USD par mois », `ui.common.account.low_credits_dialog.detail` « {detail} USD » — and the formatter the app itself uses for money renders fr USD as `0 $US` (`Intl.NumberFormat('fr',{style:'currency',currency:'USD'}).format(0) === "0\u00a0$US"`). In French an unqualified `$` is the generic dollar sign and, in a Canadian reading, defaults to CAD; `$US`/`USD` is the disambiguated form, and USD is what this product bills.
- **Not MAJOR:** the amount is zero, so no monetary misreading is possible, and the sentence's actual claim (estimate, not a confirmed bill — the point the sidecar forbids shortening away) survives unchanged.
- **Exact replacement:** `Coût estimé à 0\u00a0$US\u202f; frais finaux non confirmés.` (U+00A0 after `0`, U+202F before `;`). Corpus-consistent alternative if a code is preferred to the sign: `Coût estimé à 0\u00a0USD\u202f; frais finaux non confirmés.`
- **If the integrator rejects this as churn:** it is MINOR and does not gate the round; disagreement is fine, the record stands either way.

### N1 — NIT — `ui.chat.canonical.sound.batch.item_status` (no change requested)

State words are capitalised after « · » (« Échoué », « Arrêté », « Statut inconnu »), while this same file's other middle-dot clauses are lower-case (`tool_row.bridge.outcome.failed` « échoué · {code} », `tool.composing_sized` « rédaction · {size} »). Capitalised trailing state labels are also precedented (`ui.hub.links.source_private` « {organization} · Privé », `ui.chat.ask_queue.chip.label_collapse` « · Prioritaire ») and the English source capitalises here, so this is a recorded choice rather than a defect.

## 4. Judgement of the 10 values (beyond mechanics)

- **`item_status`** — « Échoué »/« Arrêté »/« Statut inconnu » match the en states one-for-one with one word per state, and the same words as `summary` (case only differs by position). Masculine singular is the unmarked default for a state attached to a name; it also agrees with `latest_update`'s « élément » (m.), so the four states share one implied noun. « Arrêté » uses the same term family as the shipped `sound.stop.warning` (« La demande d’arrêt… ») and carries the sidecar's “a cancelled request, not a fault” reading. No negation or polarity drift.
- **`summary`** — reads as native terse status copy: clauses lower-case after counts, « · » separators, one full stop before the attention list, then « À examiner : {labels} ». The `many` arms are the part that usually goes wrong in fr and they are right here (partitive + elision). « 0 terminé · 0 échoué » is correct French (zero takes the singular). The consequence wording ("needs attention", not "failed") is preserved.
- **`latest_update`** — « Dernière mise à jour : {name} (élément {item} sur {total}). » « sur » is the idiomatic fr pairing for “item X of Y”; the note's prohibition on rewording into a completion count is respected.
- **`cost.unknown`** / **`cost.batch_unknown`** — « Coût encore inconnu. » / « Coût total encore inconnu. » mirror en's “not yet known” and promise nothing; the batch sibling is visibly about the whole batch.
- **`cost.no_charge`** — « Sans frais. » matches the shipped `ui.providers.provider_catalog.*` « Sans frais supplémentaires. » vocabulary and, per the sidecar, is used only where a zero bill is confirmed.
- **`cost.estimated_zero`** — meaning, tone and the estimate-vs-bill distinction are correct; only the currency rendering is at issue (M1).
- **`media.image_label`** — « Image » is the French word; identical to English by design and now carries a scoped exemption in `locale-parity.test.mjs` with its reason. Numbering (« Image 2 ») is correct.
- **`media.sound_label`** — « Son »/« Son 2 » is the settled French word for audio and composes with the existing accessible names (« Lire Son 2 », « Mettre Son 2 en pause »).
- **`supplement.sound_fallback_label`** — « Son généré » is a two-word bare noun phrase, matching the sidecar's length hint and the sibling « Image »/« Son » family.

- **Fit** — the sidecar for these keys carries prose length hints, not `maxCells`, so fit is judged on the rendered strings (fr cells = characters here: no wide glyphs, NFC so no combining marks): `item_status` 35 cells vs en 35 (wraps, `break-words`); `summary` 94 vs en 101 (fr is *shorter* than en because it names one state word where en writes « cancelled/stopped »), one wrapping paragraph; `latest_update` 60 vs en 43 (longer by the noun « élément », still one short sentence that wraps); the cost lines 11–47 cells at the meta step; `Son généré` 10 cells on a player control line. No truncation risk and no budget overrun.

## 5. No English left

None of the 10 values is English. Named exceptions: `media.image_label` is the French word « Image » (identical to English by design, with the PR's own scoped exemption), and `{label}`/`{labels}` are user data (a request's own name), not copy.

## 6. Receipt and ledger

- Receipt: `~/.local-operator/sessions/5f26f5727a24/scratchpad/receipt-fr-s16f-r3.json` (not in the repo).
- Proven command (run in the mirror, `--repo` pointed at it; on the repo drop `--repo`):

```
node scripts/i18n/ledger-assemble.mjs --locale fr \
  --file src/i18n/catalogues/fr/ui.chat.canonical.json \
  --auditor-instance 5f26f5727a24 \
  --auditor-model deepseek/deepseek-flash \
  --result clean-with-findings \
  --receipt <scratchpad>/receipt-fr-s16f-r3.json \
  --scope "the 10 new S16f generation-card keys (fr) at the landed af876eb bytes, round 3 after the round-2 corrections; other 456 keys unchanged" \
  --note "S16f r3 fr: 10 generation-card keys at landed af876eb; 1 MINOR (0 \$ -> 0 \$US, currency under-specified for fr), 1 NIT. Validators + 1452-render ICU grid green. Evidence: i18n/audits/evidence/fr/ui.chat.canonical/s16f-r3-5f26f5727a24"
```

- Observed: `ledger-assemble: fr/ui.chat.canonical -> status audited (prior audits were of older bytes: moved to superseded) | clean-with-findings, 0 blocker, 0 major, 1 minor, 1 nit`.
- `ledger-check.mjs` after assembling in the mirror: **0 findings for `fr`**. The gate as a whole still reports **18 findings (6 locales × 3) for es, hi, ru, ur, vi, zh-CN** — their `ui.chat.canonical` rows still name the pre-S16f English bytes — so the PR merges only once those six receipts land (not this lane).

## 7. What this audit did not do

- No edits, commits, pushes or PR comments (read-only lane).
- Not re-audited: the other 456 keys of `ui.chat.canonical` (unchanged bytes; covered by the superseded row audits), rendered frames or a live app pass (QA/design lane), and the other six locales.
- Ran no translation/MT service, no back-translation; every judgement is reasoning against the style guide, glossary and shipped precedent.
