# Audit — vi / ui.chat.canonical / S16f generation-card labels — round 3

- **Locale:** vi · **Namespace:** ui.chat.canonical · **Group:** S16f (last 10 keys) · **Round:** 3
- **Auditor:** i18n-auditor (independent; did not translate or edit) · **Session:** d29293b521fd
- **Model (actual):** `deepseek/deepseek-flash` — from this session's harness model header. No fallback occurred; no model pin was swapped.
- **Head audited:** `af876eb052db12ec587ef6353aecebd2c769ae22` (worktree `~/local-operator-ui/.worktrees/i18n-s16a`, READ-ONLY, `git status --porcelain` empty).
- **Authority:** `~/local-operator` @ origin/main — `i18n/glossary.md`, `i18n/style-guides/vi.md`.
- **Change vs round 2 landed bytes:** one value — `supplement.sound_fallback_label` is now `Âm thanh được tạo` (was `Âm thanh đã tạo`).

## Verdict: **clean** — 0 BLOCKER · 0 MAJOR · 0 MINOR · 0 NIT (+1 INFO observation, non-counting)

All ten landed values pass every mechanical gate and read as native Vietnamese product copy. The round-2 → round-3 change is a genuine improvement and is correct as landed.

## 1. Hashes of the landed 10 pairs

`sorted-key compact UTF-8 sha256` = `sha256(json.dumps({key: value}, sort_keys=True, separators=(',',':'), ensure_ascii=False))`.

| key | en sha256 | vi sha256 |
|---|---|---|
| sound.batch.item_status | `e358c22c488a70710e7bd3bd9e3c6211286461e1dacb8072367e49e73f559f10` | `6bbdfdb01cc6426c3f5c025703739683d4f076cdf35c95b4a2e322b9f4297f73` |
| sound.batch.summary | `09ae93966cdc6b3aa654ed80309002e7b6fb98d65d8011263b6018544764c6a1` | `ae3e310730d99bdcb460eb5ef7b4baf91b30763c9a960a66c69906e17ef67286` |
| sound.batch.latest_update | `427de0b397f0033745908950e3edcbd4931f51b6d4ee73547a72eb039fba74b2` | `53172f9764c32c0ca523542de59d1b82d8f34533fecc64e978bc8ee6aa5b5683` |
| sound.cost.unknown | `a34c87949511c3c4c516818f52886f4ece1067df07cf37d2ad397695d31bbd77` | `56c843e8ede7e35ac87a3d109955b4b7aeafef7eef02c42a7addd7eae2a2131a` |
| sound.cost.no_charge | `34fb349281118da77d1d41683e46d00f98e4afb1b86a1a80374358f57dc338e7` | `9d497ca62d1e73bb5b9ac4a2548ee27283c5506f81bb176822dae583a98eb442` |
| sound.cost.estimated_zero | `7a339de1c5eb417ab59accd72d89b9d84c7fbc808934bf2a21f6188868e85387` | `18213dc05daecb3ea08f41298642aaf3f9f217b9a402991592fdb2f790c53dfe` |
| sound.cost.batch_unknown | `8aabea74c95580d6499ea0030eb458088b49a68b209ce67334bd30efbf5d48fd` | `234a8b300784e059ae5c27937c8146912d889e09d26f8206e1daf1ea1e3a76ae` |
| media.image_label | `47631358ab381012419b4ee7b6159a1a88df04875314d2e205372f7b8890a78e` | `034d648845ec64223155559186d2ed69b9d3d59865752253c6685f983145a8ca` |
| media.sound_label | `50eaf18785e46954337a6e7c08dab1b016a4cd9bc0d11e03774ed24c33cf44a2` | `a8fc5d8445eaa46ff7f9d0fde5796f059e735c0630c396d426451613f6a019ca` |
| supplement.sound_fallback_label | `553bf2c11939d42e948de5fa4ea288b269eeda0b3090c65f567f625f9938cab1` | `1caf58a6f041028230fdf0a927f3b5183d5fd08cd9b6a888b683665eab4679f3` |

Whole-file sha256 (the ledger's unit):

- `src/i18n/catalogues/en/ui.chat.canonical.json` → `12ec2698434dcb39497e288af62d11d70f0fd71d494a9becf3fd611d6568bbdd`
- `src/i18n/catalogues/vi/ui.chat.canonical.json` → `65beedffec6a88924e977f5aadafbf52ed4cfb508d46975481273c7103e12900`
- `src/i18n/catalogues/en/ui.chat.canonical.context.json` → `95aa203759416c93180b7eb4967e6fcf5bce0dffe20e9d005b431c645e9e11e6`

The ledger row for `vi/ui.chat.canonical` still records `source_sha256 d6d47d31…` / `target_sha256 c3d90f71…` (PR #1870 bytes). The S16f landing moved both files, so this audit binds the new bytes; assembling it supersedes the older audits on that row by the ledger's standing rule.

## 2. Mechanical — all green in a scratch mirror of the same HEAD

| gate | command | actual output |
|---|---|---|
| generator | `node scripts/i18n/generate.mjs --check` | `keys.gen.ts is byte-identical to a fresh generation.` (exit 0) |
| duplicates | `node scripts/i18n/check-duplicates.mjs` | `ok — 1428 file(s) scanned, 0 duplicate key(s)` |
| context parity | `node scripts/i18n/context-parity.mjs` | `ok — every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s)` (same allowance as base) |
| coverage | `node scripts/i18n/check-coverage.mjs` | `ok — 7 gated language(s) over 158 namespace(s); 0 allowed key(s) remain` |
| locale parity | `node --test scripts/i18n/locale-parity.test.mjs` | 44 tests, 44 pass, 0 fail (vi: every English key carried, no extra keys, placeholders preserved, no English stub) |
| surface tests | `generation-card-labels` + `generation-card-locale-switch` + `vi-activation` | 32 tests, 32 pass, 0 fail — includes the mounted render path repainting status words, summary and cost line on a language switch |

Own grid via the app's own formatter (`new IntlMessageFormat(message, "vi")` from `intl-messageformat`, the same call `src/i18n/messages.ts::formatterFor` makes) — **761 cases, 0 throws, 0 leftovers**:

- counts `0,1,2,3,5,11,21,22,100,1000,1000000` × statuses `failed/cancelled/other` × `has_attention yes/no`, plus `latest_update` numbering, both media labels, all four cost lines.
- `cancelled=0` / `unknown=0` genuinely hide their clauses (`0 hoàn tất · 0 thất bại`), separator never doubles.
- `has_attention=yes` always emits `. Cần chú ý: {labels}`; `no` never emits it.
- AST comparison against English: placeholder names identical and plural/select branch names identical for all 10 keys. vi's CLDR plural set is `{other}` only (`Intl.PluralRules("vi")`), and every plural here supplies `other`; `=0`/`=1` exact matches are structure inherited from English and correct for vi.
- All values NFC, zero combining marks, no double spaces, no stray leading/trailing whitespace, no introduced NBSP/narrow-NBSP.

Negative controls (proving the harness detects breakage, not merely that it is silent): removing an `other` branch → `THREW MISSING_OTHER_CLAUSE`; renaming a placeholder → `THREW "completed" was not provided`; unclosed brace → `THREW EXPECT_ARGUMENT_CLOSING_BRACE`; NFD-decomposed text → detected.

## 3. Judgement of the ten values

| key | landed vi | verdict |
|---|---|---|
| sound.batch.item_status | `{label} · Thất bại` / `· Đã dừng` / `· Không rõ trạng thái` | correct |
| sound.batch.summary | `N hoàn tất · N thất bại · N đã dừng · N không rõ trạng thái. Cần chú ý: {labels}` | correct |
| sound.batch.latest_update | `Cập nhật gần nhất: {name} (mục {item}/{total}).` | correct |
| sound.cost.unknown | `Chưa biết chi phí.` | correct |
| sound.cost.no_charge | `Không tính phí.` | correct |
| sound.cost.estimated_zero | `Chi phí ước tính là $0; khoản phí cuối cùng chưa được xác nhận.` | correct |
| sound.cost.batch_unknown | `Chưa biết tổng chi phí.` | correct |
| media.image_label | `Hình ảnh` / `Hình ảnh {position}` | correct |
| media.sound_label | `Âm thanh` / `Âm thanh {position}` | correct |
| supplement.sound_fallback_label | `Âm thanh được tạo` | correct — **the round-3 change is right** |

**The changed value, examined.** English `Generated sound` names a *player* (a fallback title), it is not a status sentence. Vietnamese distinguishes the two by word order: a **status** is verb-initial (`Đã tạo âm thanh` = "created the sound"), while a **name** must be noun + passive modifier (`Âm thanh được tạo` = "the sound that was generated"). Round 2's `Âm thanh đã tạo` put the tense marker `đã` on a subjectless verb in attributive position, which is the calque reading ("sound already created"); `được tạo` is the correct passive attributive. The correction therefore fixes a register error rather than trading one option for another — it reads as a name, which is what the sidecar requires.

**One word per state, across item_status and summary** — verified: `Thất bại`/`thất bại`, `Đã dừng`/`đã dừng`, `Không rõ trạng thái`/`không rõ trạng thái`; only sentence-position casing differs, never the word. The summary's `đã dừng` for English `cancelled/stopped` is a deliberate single-word collapse and is strictly better than carrying the English slash; English's own note says the two words mean the same state, so nothing is lost.

**Precedent cited from the existing catalogue** (this is what settles register, not opinion):

- `Thất bại` as the one-word state label: `ui.chat.run_details.reader.failed`, `ui.mesh.mesh_approvals.failed`, `ui.settings.appearance.layers.preview.danger`, `ui.chat.canonical.tool_row.bridge.detail.outcome.failed` (`Thất bại ({code}): {error}`). Lowercase clause use: 32 keys. Sentence form `không thành công` (43 keys) stays in prose, e.g. `image_gen.state.failed_batch` `Loạt video không thành công.` — the split between label and sentence is the catalogue's existing convention, and this group follows it.
- `Đã dừng` as the stopped label: `ui.chat.action.stopped`, `ui.projects.project_model.stopped`, `ui.chat.canonical.transcript.stopped_before_finishing`; lowercase `đã dừng` in clauses. (`đã hủy` exists for import cancellation — `ui.settings.imports.state_cancelled` — but this surface's English says *stopped*, and `dừng` is the matching word.)
- `hoàn tất` for completed: `ui.settings.imports.state_done`, `ui.chat.canonical.turn_summary.completed`, `ui.chat.canonical.image_gen.state.already_finished`.
- `Âm thanh` for sound: `ui.canvas.files.audio`, `ui.canvas.file_rows.sounds`, `ui.library.kind.audio`, `ui.settings.notifications.sound.heading`.
- `Hình ảnh` for image: 18 keys, incl. `image_gen` labels.
- `được tạo` as the passive attributive: `ui.canvas.create_file_dialog…` `Tệp sẽ được tạo trong thư mục làm việc này.`, `ui.mesh.mesh_actions.copy_notice`, `ui.chat.device.sentence.draft_here`. The one remaining `đã tạo` (`ui.onboarding.tour.canvas_files_view.body.1`) carries an explicit agent subject (`những tệp tác nhân đã tạo`), a different construction — it does not license `Âm thanh đã tạo`.
- `chi phí` for cost (glossary §2), `Chưa biết …` for "not yet known": `ui.chat.session_spend.context.window_unknown`.

**Casing, agreement, width.** Sentence case throughout, no Title Case, no terminal `!`. No plural agreement added anywhere (vi has none) — correct per style guide's `other`-only rule. Widths are within every hint the sidecar gives (no `maxCells` is set for these ten; hints are prose): `supplement.sound_fallback_label` 17 cells vs en 15 on a control line; `cost.estimated_zero` 63 vs en 46, and the hint already says it wraps at the meta step; `item_status` `Không rõ trạng thái` 18 cells vs en 14 sits on a `break-words` row that wraps. No wide-glyph risk: all NFC, no CJK, no combining sequences. The style guide's pinned budgets (`PERSIST_HINT`, tip pool, `/help`) do not cover this group.

## 4. Nothing English left

All 15 rendered samples are Vietnamese; the only Latin runs are forced user data (`{name}`/`{label}`) and the literal currency `$0`, which the sidecar requires to stay as written. Named exceptions: `{name}`/`{label}` (never translated), `$0` (USD, sign stays where the language writes it), and numbers rendered through ICU `::group-off` (source-design skeleton, identical to English — no hand-written grouping).

## 5. RTL — not applicable (vi is LTR)

## 6. INFO observation (recorded, not a defect, not counted)

`image_gen.state.done` in the same namespace renders `Generated video/voiceover/sound effect/image` as verb-initial `Đã tạo video / Đã tạo lời thuyết minh / Đã tạo hiệu ứng âm thanh / Đã tạo hình ảnh`, while `supplement.sound_fallback_label` now reads `Âm thanh được tạo`. The two look inconsistent side by side but are correct for their different grammatical roles — a completed-state line versus a player's name. Recorded so a later wave does not "unify" the name back into the calque form.

## 7. Retention

Evidence: `i18n/audits/evidence/vi/ui.chat.canonical/s16f-r3-d29293b5/` (`record.json`, `audit.log`, `report.md`); receipt `i18n/receipts/d29293b521fd.json` (copied by `ledger-assemble`). Held in this session's scratchpad because this audit is READ-ONLY and cannot commit.

## 8. Ledger command (run by the landing commit)

```
node scripts/i18n/ledger-assemble.mjs --locale vi \
  --file src/i18n/catalogues/vi/ui.chat.canonical.json \
  --auditor-instance d29293b521fd --auditor-model deepseek/deepseek-flash \
  --result clean --receipt i18n/receipts/d29293b521fd.json \
  --scope "S16f generation-card labels: the 10 keys added in 8b43dac1d5 at head af876eb0 (last 10 values of ui.chat.canonical); other 456 keys byte-identical and covered by the superseded row" \
  --note "vi S16f r3: 10 gen-card keys clean (0 blocker/major/minor/nit); envelope-delta re-read after the sound_fallback_label fix. Record: i18n/audits/evidence/vi/ui.chat.canonical/s16f-r3-d29293b5/record.json" \
  --date 2026-11-11
```

Validated by running this assemble in the mirror: `vi/ui.chat.canonical -> status audited | clean, 0 blocker, 0 major, 0 minor, 0 nit` (the row's 20 prior audits moved to `superseded`, as the standing rule requires for a source that moved). `node scripts/i18n/ledger-check.mjs` then reports **0 findings for vi**; its 18 remaining findings are all `es/fr/hi/ru/ur/zh-CN ui.chat.canonical` rows whose own S16f re-audits have not landed in this checkout.

**Receipt immutability (disclosed).** I tried to add the companion-artifact hashes into the receipt after the first successful assemble; `ledger-assemble` refused — *"instance d29293b521fd is already recorded on vi/ui.chat.canonical with a different receipt"*. That is the tool being right (one run, one immutable receipt), so I reverted the receipt to its exact first bytes rather than minting a second instance id for the same run. `record.json` binds the receipt, not the reverse.

**Final artifacts** (held in scratchpad; this audit is read-only and cannot commit):

| file | sha256 |
|---|---|
| `receipt-vi-s16f-r3.json` (= `i18n/receipts/d29293b521fd.json`) | `445c6bb7d6cf81a868de174e3a8b0118bd123d986be20096964587deceb3dcf5` |
| `audit.log` (execution log) | `8a84b9802cbeab5942633e2a06e0ec2b4fc2654d1eec31305308ce512221713e` |
| `record.json` | see `record.json` (self; hashes every input and companion) |

Landing commit: copy the bundle to `i18n/audits/evidence/vi/ui.chat.canonical/s16f-r3-d29293b5/` (`record.json`, `audit.log`, `report.md`, `receipt.json`) and the receipt to `i18n/receipts/d29293b521fd.json`, then run the command above.
