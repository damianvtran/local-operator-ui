# S16f round-3 audit — `ru` / `ui.chat.canonical` (10 generation-card label keys)

- Auditor: `i18n-auditor` · session `9f927eaac669` · instance `9f927eaac669-s16f-r3-ru`
- Model: `deepseek/deepseek-flash` (this session's own header line; role default, no mid-run fallback)
- Audited bytes: `af876eb052db12ec587ef6353aecebd2c769ae22` (PR #1876 worktree, HEAD verified, status clean)
- Read-only: nothing in the repository was edited, committed or pushed. All checks ran against a
  `git archive HEAD` mirror in this session's scratchpad (`src/i18n`, `scripts`, `i18n`,
  `package.json`, `tsconfig*`; `node_modules` symlinked to the manager's worktree).

## Verdict

**clean-with-findings** — 0 BLOCKER · 0 MAJOR · 0 MINOR · 2 NIT. Both nits are *accepted, no change
requested*; the second one exists so a later wave does not silently reverse a call that reads
correctly today. Ledger status `passed`.

## Hashes (sorted-key compact UTF-8 sha256)

Whole files — `ru/ui.chat.canonical.json` `be3f1256ee39…` · `en/ui.chat.canonical.json`
`12ec2698434d…` · `en/ui.chat.canonical.context.json` `95aa20375941…` (full digests in
`receipt-ru-s16f-r3.json` and `record.json`).

Per-key hash of the one-key pair object (`{"<key>": "<value>"}`, sorted keys, compact, no trailing
newline) — ru / en:

| key (after `ui.chat.canonical.`) | ru | en |
|---|---|---|
| `sound.batch.item_status` | `a2a3ae600a95…` | `e358c22c488a…` |
| `sound.batch.summary` | `81b39afad951…` | `09ae93966cdc…` |
| `sound.batch.latest_update` | `0e8e2c76c9c2…` | `427de0b397f0…` |
| `sound.cost.unknown` | `d9290a54d106…` | `a34c87949511…` |
| `sound.cost.no_charge` | `6a71e331f4ca…` | `34fb34928111…` |
| `sound.cost.estimated_zero` | `cec2ca9573b8…` | `7a339de1c5eb…` |
| `sound.cost.batch_unknown` | `f5aa68905da7…` | `8aabea74c955…` |
| `media.image_label` | `e6f99345c87a…` | `47631358ab38…` |
| `media.sound_label` | `2dde0462dc7d…` | `50eaf18785e4…` |
| `supplement.sound_fallback_label` | `9a06c08562a0…` | `553bf2c11939…` |

Group hash over all 10 pairs: ru `ffeb74c0b046…` · en `bdd1d9d1cfcd…`.

## Mechanical (all green, and the checkers were proved able to fail)

| Gate | Result |
|---|---|
| `generate.mjs --check` | PASS byte-identical (mirror) |
| `check-duplicates.mjs` | PASS 1428 files, 0 duplicates |
| `check-coverage.mjs` | PASS 7 languages × 158 namespaces, 0 allowed keys left |
| `locale-parity.test.mjs` | PASS 44/44 (ru: complete, no unknown keys, placeholders preserved, not an English stub) |
| `check-strings.mjs` | PASS 1668 files (run in the real worktree; the mirror reports a false FAIL because it deliberately carries no `src/renderer`) |
| `context-parity.mjs` | PASS (129 allowed gaps, 4 namespaces) |
| `ledger-check.mjs` | ru had 3 stale findings before this audit → **0 after** the receipt is assembled in the mirror |

**ICU grid through the app's own path** (`src/i18n/messages.ts` → `intl-messageformat`, i.e. the
same `new IntlMessageFormat(message, locale)` the renderer builds): 1167 renderings over counts
{0,1,2,3,5,11,21,22,100,1000,1000000} × statuses {failed, cancelled, other, queued, undefined} ×
`has_attention` {yes, no}. No throws, no leftover ICU braces, no raw key, no empty render, no
English leftover, all output NFC.

- CLDR: `completed`/`failed`/`cancelled`/`unknown` each carry `one`+`few`+`many`+`other`;
  `cancelled`/`unknown` keep the `=0` hide-branch and `unknown=0` renders **no** clause (verified
  at render, not just in the AST).
- Placeholders: argument name/type sets identical to English (the multiset differs only because ru
  has 4 arms where en has 2). `select` branch keys unchanged (`failed`/`cancelled`/`other`,
  `yes`/`other`) — machine values, correctly not localised.
- Markup/code/flags: none in this group; `$0` kept byte-identical.
- Special spaces: 0 × U+00A0, 0 bidi controls, 0 zero-width characters; formatter still renders
  ru grouping as NBSP (`1 234 567,5`) and `::group-off` ungrouped, matching `en`.
- **Negative controls, 6/6 CAUGHT** in memory against the same verifier: drop one CLDR arm, rename
  a placeholder, drop a `=0` branch, inject U+200F, decompose to NFD, unbalanced brace.

## Judgement of the 10 values

All ten read as native product copy. Round-3 delta **approved**: `sound.batch.summary` now says
`· статус неизвестен: {unknown}` in all four arms, which gives the same state **one word** in the
row (`item_status` `other` = «Статус неизвестен») and in the summary — the round-2
«неизвестный статус:» gave the same state two names.

Checked and correct, with precedent:

- `item_status` — «Сбой» follows `tool_row.outcome.failed = сбой`; «Остановлено» follows
  `transcript.stopped_before_finishing` and `ui.chat.action.stopped`; the `other` arm reads
  "unknown" and cannot be mistaken for success or failure (the sidecar's explicit requirement),
  including for an unmapped/absent status (grid-tested with `queued` and `undefined`).
- `summary` — colon-count clauses are idiomatic ru dashboard copy («Завершено: 3 · сбоев: 1 ·
  остановлено: 2»); `=0` hides the clause *with* its separator because the " · " lives inside the
  non-zero arms; «Требуется внимание:» carries the one full stop; `labels` are data.
- `latest_update` — «элемент {item} из {total}» is the exact construction of
  `ui.projects.project_updates.show_asset_name` («… , элемент {index} из {count}»).
- `cost.*` — стоимость/плата preserves the source's cost/charge distinction; «пока» carries
  "not yet"; `no_charge` asserts no charge *happened* (safe wording for a money claim);
  `estimated_zero` keeps `$0` and does not collapse into "No charge" (the sidecar's warning).
- `media.image_label` — «Изображение» capitalised, number after the noun; matches
  `ui.chat.composer_media.pasted_image` and `ui.teamBridge.attachments.position`.
- `supplement.sound_fallback_label` — «Созданный звук» follows `image_gen.state.done`
  («Видео создано»), 2 words as the hint asks.

## Findings

### S16F-RU-R3-01 · NIT · `ui.chat.canonical.media.sound_label` — accepted, no change

«звук» is lower case where the sibling `media.image_label` («Изображение») and fr/es/vi all
capitalise (Son, Sonido, Âm thanh), and the sidecar tone says "bare noun, capitalised". It is not an
oversight: the value is substituted into `ui.chat.audio.play_label` / `pause_label`
(«Воспроизвести {label}»), where a capital would be a mid-sentence spelling error in Russian. The
visible tile label argues for «Звук»; the invisible composed aria-label argues for «звук». Recorded
rather than requested, because the current bytes are grammatically correct on the composed surface,
which is the one a reader cannot fix by eye.

If it is ever changed: `{count, plural, =1 {Звук} one {Звук {position, number, ::group-off}} few
{Звук …} many {Звук …} other {Звук …}}` **and** accept «Воспроизвести Звук 2», or lower case the
play/pause template instead — decide both surfaces in one commit, never this key alone.

### S16F-RU-R3-02 · NIT · `ui.chat.canonical.sound.batch.summary` — accepted, no change

«статус неизвестен: 5» is the only full predication in a colon-count list whose siblings are labels.
It is the better of the two readings available, because it is the only wording that keeps one state
word across row and summary. If a later wave reworks it, change `item_status` `other` and this
clause together.

## Nothing English left

No English remains in the ten values except the named exceptions the guide allows: `$0` (currency
literal in `sound.cost.estimated_zero`) and the user data `{label}`/`{name}`/`{labels}`. No Latin
product terminology was translated away and no kept-English term was invented.

## Receipt

`receipt-ru-s16f-r3.json` (this scratchpad) is ledger-ready and validates:

```
node scripts/i18n/ledger-assemble.mjs \
  --locale ru \
  --file src/i18n/catalogues/ru/ui.chat.canonical.json \
  --auditor-instance 9f927eaac669-s16f-r3-ru \
  --auditor-model deepseek/deepseek-flash \
  --result clean-with-findings \
  --date 2026-11-11 \
  --receipt <scratchpad>/receipt-ru-s16f-r3.json \
  --scope "the 10 S16f generation-card label keys of ru/ui.chat.canonical (sound.batch.*, sound.cost.*, media.*_label, supplement.sound_fallback_label) incl. the round-3 summary unknown-clause change; the other 456 keys read only as precedent and carried on prior audits" \
  --note "S16f r3 ru: 10 keys, 0 blocker/major/minor, 2 nits (sound_label case trade-off; summary clause). Record: i18n/audits/evidence/ru/ui.chat.canonical/s16f-9f927eaac669-r3/record.json"
```

Run against a `git archive HEAD` mirror this produced
`ledger-assemble: ru/ui.chat.canonical -> status audited | clean-with-findings, 0 blocker, 0 major,
0 minor, 2 nit` and then `ledger-check` reported **0 findings for `ru`** (the 18 remaining findings
are ur/vi/zh-CN, outside this locale). The prior ru audits were moved to `superseded` as the tool
requires.

Note 179 chars. Receipt sha256 `3d28f9cb02155fd090eecae2291759b7bcef865450e72e631d1bfaa9429b00ac`.
