# s16f-au4-ru — independent delta audit, `ru` / `ui.chat.canonical`

- **PR:** damianvtran/local-operator-ui#1876
- **Head audited:** `cbb8782a39b5692ae46bfc3aa6930840420e9b14` (worktree `~/local-operator-ui/.worktrees/i18n-s16a`, clean before and after; read-only for this auditor)
- **Previous audited head:** `8180eff1f705eb79d4df5123d6108c539b585b2e` (independent round-3)
- **Auditor:** `i18n-auditor`, instance `6e7c2663da44-s16f-au4-ru`, session `6e7c2663da44`, model `deepseek/deepseek-flash` (session header line)
- **Date:** 2026-11-12
- **Verdict:** **passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT

## What this audit was asked to settle

Round 3 returned `changes_requested` for ru with MAJOR RU-S16F-01:
`ui.chat.canonical.media.sound_label` was lower case (`звук`) against the
sidecar's *"bare noun, capitalised"*. The landed commit capitalises all five
branches. My job was to re-derive the call from the bytes rather than inherit
either the round-3 finding or the landed commit's rationale — and the commit's
own rationale for ru is one I reject while accepting the change (below).

## The changed value

```
src/i18n/catalogues/ru/ui.chat.canonical.json:460
"{count, plural, =1 {Звук} one {Звук {position, number, ::group-off}} few {Звук {position, number, ::group-off}} many {Звук {position, number, ::group-off}} other {Звук {position, number, ::group-off}}}"
```

**Verdict on that value: correct, and the capitalisation is required by more than
the sidecar.** Four independent pieces of evidence, all derived here:

1. **Sentence case is the locale's rule, and a one-word label in sentence case
   starts capitalised.** `i18n/style-guides/ru.md` bans Title Case and
   "пожалуйста"-style padding; it does not ask for lower-case labels. `звук`
   lower case was the only lower-case bare-noun label in the file.
2. **The sibling in the same file is capitalised.** `media.image_label` reads
   `=1 {Изображение} …` — a picture tile and a sound tile sit in the same fold
   strip, so `Звук` next to `Изображение` is the consistent pair; `звук` next to
   `Изображение` was a visible inconsistency, not a stylistic choice.
3. **The locale already ships this exact label capitalised elsewhere.**
   `ru/ui.settings.notifications.json`: `ui.settings.notifications.sound.heading`
   = `"Звук"` (bare noun, capitalised, no punctuation), plus
   `"Добавить звук…"`, `"Название звука"`; `ru/ui.canvas.json`
   `file_rows.sounds` = `"Звуки"`, `ru/ui.library.json` `category.sounds` =
   `"Звуки"`. The noun family is established, and its bare-label form is capital.
4. **The glossary has no `sound`/`audio` row**, so this is a locale call, and the
   ru guide's "Prefer Russian where settled" settles it on the Cyrillic `звук`,
   not a `саунд` loan — which is what ships.

**Where I part company with the landed commit's rationale.** The commit message
justifies the capital by saying the label is spliced into the audio button labels
("a lowercase Russian noun read as a mid-sentence common noun"). That argument is
weak, and the opposite of the round-3 NIT's reasoning: inside
`ui.chat.audio.play_label` (`"Воспроизвести {label}"`) lower case was
*grammatically* right — `звук` is the accusative of an inanimate masculine noun,
so "Воспроизвести звук 2" is correct Russian, while today's composition,
"Воспроизвести **З**вук 2", carries a capital mid-phrase. The change is right on
the surfaces it governs (alt text, fold-strip tile name, player title), where a
label starts a string; the composed accessible name is a different namespace's
problem and should be fixed there, not by lowering this label. I recommend the
follow-up re-audit of `ru/ui.chat.json` take the label as capitalised and
restructure the template to a colon form — `"Воспроизвести: {label}"` /
`"Приостановить: {label}"` — which reads correctly to a screen reader
("Воспроизвести: Звук 2") and needs no change to this key. This is the manager's
recorded deferral: noted, not gated here, and not a finding against this
namespace.

### Alternatives considered and rejected (second pass, deliberately adversarial)

| Candidate | Why rejected |
|---|---|
| keep `звук` lower case (round-3 NIT's interim disposition) | visible label would be the only lower-case one-word label in the catalogue and would contradict `Изображение` one line above it; it optimises for an out-of-namespace screen-reader string at the cost of the visible UI |
| `Аудио` | vaguer than the settled noun and would not match `Созданный звук` / settings `Звук` |
| `Звукозапись` | wrong referent — a generated sound effect is not a recording |
| `Звуковой файл` | two words, pedantic, and the tile is not necessarily a file |
| `Звук № 2` for the numbered form | the `№` convention reads as documents/line items, not media; would diverge from `Изображение 2` |
| `Звуки` in the `few`/`many` arms | would change the meaning: the label names *one* artifact at position N, the count only selects numbered vs unnumbered |

## Noun consistency in the namespace (`звук` family, all read in full)

| Key | ru | Judgment |
|---|---|---|
| `media.sound_label` | `Звук` / `Звук {position}` | correct (above) |
| `sound.player_failed` | `Не удалось воспроизвести звук` | accurate for "This sound could not be played", impersonal per the guide, no trailing punctuation per the sidecar; accusative correct. No change. |
| `supplement.sound_fallback_label` | `Созданный звук` | "Generated sound" — matches the material verb the locale uses for generation (`создано`), not the `сгенерированный` calque. No change. |
| `image_gen.state.{running,running_batch,done,done_batch,failed,failed_batch}` `sound_effect` arms | `Звуковой эффект`, `Генерация звукового эффекта…`, `Набор звуковых эффектов`, … | **judged explicitly, as asked: consistent, and deliberately a different term.** `звуковой эффект` is the dictionary term for a sound *effect*, and the English source distinguishes the material (`sound_effect`) from a plain sound. Agreement and genitive forms are right (`Генерация # звуковых эффектов…`, `Не удалось создать звуковой эффект.`). Keeping the compound does not contradict the bare `Звук` label — one names a material kind, the other names one produced audio artifact. No change. |
| whole locale, other namespaces | `ui.chat.audio.mute` `Выключить звук`, `ui.settings.notifications.*` `звук`/`звуки`, `ui.canvas`/`ui.library` `Звуки` | the same noun throughout, no competing loan. |

No key in this namespace mixes a competing term for the same object.

## Mechanical / integrity (derived here, commands and output in `audit.log`)

| Check | Actual result |
|---|---|
| key set vs English | 467 = 467, no duplicate keys, no added/dropped key |
| ru file vs `8180eff1` | exactly one differing line (460); values of the other **466** keys byte-identical; the only value difference is `media.sound_label`, and it is exactly the `звук → Звук` substitution in five arms (`replaceAll` equality check) |
| English untouched by the landed commit | 0 changed en values (`905fb4d8…` identical at both heads) |
| 10 PR-added keys | present, values equal the round-3-audited values except `media.sound_label` |
| 5 main-added keys (`loading.cold/older/region_label/remote/revalidating`) | values equal `origin/main`'s ru file and the round-3 head |
| ICU argument sets (AST, `@formatjs/icu-messageformat-parser`) | all 467 keys: identical argument name/type set to English (ru's extra arms normalised), plural-vs-select shape identical |
| CLDR categories | 63 ru plural messages, every one carries `one`+`few`+`many`+`other`; `=N` hide-arms preserved where English has them |
| render through the app's path (`intl-messageformat`, the package `src/i18n/messages.ts` uses) | 12 counts × 3 positions, no throw; unnumbered only at count 1; every other count reads `Звук <position>`; `::group-off` holds at position 1000 |
| text hygiene | all 467 values NFC; no bidi control characters |
| width | `Звук` / `Звук 1000` (4 / 9 cells) — far inside any tile/label budget; the sidecar sets no `maxCells` for these keys |

Repo validators, run in the worktree (cheap, memory-safe):

| Command | Actual result |
|---|---|
| `node --test scripts/i18n/locale-parity.test.mjs` | 44/44 pass, 0 fail (ru included) |
| `node scripts/i18n/check-duplicates.mjs` | `ok — 1437 file(s) scanned, 0 duplicate key(s)` |
| `node scripts/i18n/context-parity.mjs` | `ok — every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s)`; `ui.chat.canonical` is **not** among the allowance namespaces, so all 10 new keys are sidecar-covered |
| `node scripts/i18n/generate.mjs --check` | `src/i18n/keys.gen.ts is byte-identical to a fresh generation` |

## Record

| Artifact | Path (this session's scratchpad, `~/.local-operator/sessions/6e7c2663da44/scratchpad/s16f-au4-ru/`) |
|---|---|
| receipt | `receipt.json` — sha256 `679693ab40c06fa90f1bbd809663007e5759e830b7770860a091b5f82e23f006`, status `passed`, 0 findings |
| report | `report.md` (this file) |
| execution log | `audit.log` — every block is a command actually run here with its verbatim output |
| scripts | `integrity.mjs` (byte identity, key sets, carry, hygiene), `icu.mjs` (AST + render), `run-audit.sh` (log builder) |

The receipt was validated against the repo's own writer, not just against a schema
by eye: a minimal mirror (`scripts/i18n/{ledger-assemble,ledger-rules}.mjs`, the
en+ru catalogue files, `i18n/ledger.json`, `i18n/languages.json`) was copied into
this scratchpad and

```
node scripts/i18n/ledger-assemble.mjs --repo <mirror> --locale ru \
  --file src/i18n/catalogues/ru/ui.chat.canonical.json \
  --auditor-instance 6e7c2663da44-s16f-au4-ru --auditor-model deepseek/deepseek-flash \
  --result clean --receipt <scratchpad>/receipt.json \
  --scope "round-4 delta: media.sound_label capitalisation + same-noun family" \
  --note "delta re-audit (round 4) of the round-3 sound_label fix; scratchpad record 6e7c2663da44/s16f-au4-ru" \
  --date 2026-11-12
```

returned `status audited (prior audits were of older bytes: moved to superseded) |
clean, 0 blocker, 0 major, 0 minor, 0 nit`, and the mirror's row binds
`source_sha256 905fb4d8…` / `target_sha256 fddef089…` with my audit as its only
current auditor. The worktree stayed clean throughout: assemble wrote to the
mirror only.

**Provenance gap to decide, not mine to close:** the row's `translator` block is
carried from the previous row (i18n-translator, `anthropic/claude-sonnet-5-5`,
S16a keys). The round-4 fix and the three hi values were produced by an
independent translator in this remediation round, and the shared commit account
cannot name that instance. If the manager wants the row to name it,
`--update-translator` with both fields is the supported path; otherwise the
receipt's `translator` field is the only place that records the distinction.

## Limits of this audit

Catalogue-level only. No rendered frames, no activation, no release — the delta
touches no layout and makes no string longer; the design/QA streams own pixels.
I did not run the PR's heavier desktop tests (memory holds; not the diff's own new
tests). Nothing here substitutes for the independent QA matrix.

## Cross-check outside my record: `hi` (not my locale)

I was not assigned hi and record no verdict for it; the manager's hi auditor owns
that row. Since the same commit edits it, I read the three changed keys anyway,
as a second pair of eyes, and derived the counts myself rather than trusting the
commit message:

- `ध्वनि` now appears **32 times across 3 hi catalogue files** (`ui.settings.notifications`
  23, `ui.chat.canonical` 3 lines, `ui.canvas` 1); the commit added 4 occurrences
  (media.sound_label ×2, supplement ×1, player_failed ×1), so the pre-change count
  was 28 — the commit's figure checks out.
- The bare-noun precedent is the same shape as ru's: `ui.settings.notifications.sound.heading`
  = `"ध्वनि"`, `ui.canvas.file_rows.sounds` = `"ध्वनियाँ"` — the row a generated audio
  file lands in.
- `साउंड` survives only inside `साउंड इफ़ेक्ट`, **7 occurrences in the 6 `image_gen.state.*`
  keys** — exactly the deliberately kept compound for the material, and no bare
  `साउंड` is left anywhere. That is the consistency question the manager asked to be
  judged, and it holds.
- Gender agreement the change introduces is correct: `बनाई गई ध्वनि` (feminine
  participle), `यह ध्वनि नहीं चलाई जा सकी`. Devanagari has no case, so the composed
  aria-label (`"{label} चलाएँ"` → "ध्वनि चलाएँ") has none of the ru problem.

I saw nothing I would raise as BLOCKER or MAJOR. This is a cross-check, not an
audit, and it is not part of the ru record.
