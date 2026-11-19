# Independent translation audit — vi `ui.chat.canonical` (S16f au3, merged head)

- **Verdict: PASSED** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT. Status `passed`.
- Audit id / instance: `49c5a10a37b4` · locale `vi` · namespace `ui.chat.canonical`
- Head: `8180eff1f705eb79d4df5123d6108c539b585b2e` (worktree `~/local-operator-ui/.worktrees/i18n-s16a`, clean; read-only for this audit — I edited, staged and committed nothing)
- Auditor: `i18n-auditor`, model **deepseek/deepseek-flash** (session model header; no model-switch card and no `[session incident]` in this run, so no fallback descent is disclosed). Independent: I did not translate these values and wrote no repository file.
- Authority: `~/local-operator/i18n/glossary.md` + `~/local-operator/i18n/style-guides/vi.md` (core `origin/main`), read before the locale file.
- Input hashes (full 64-hex, computed here):
  - en `905fb4d86bab02148e90dea09a1e7d74c628fcdeb3f40f49126b21f491a8d28e`
  - en context `8f56e0d2b384c6b41add57a64e6c863e565cb61d5a7c0de482d42f380be3acfe`
  - vi `a37a5690412c841379ea44d6d63f4a5314579f4a157ff3c7f67be2ee872fe750`

## Scope read

Audited **all 15 merged keys** in full: the 5 main-added `loading.*` keys and the 10
PR-added `media.*_label`, `sound.batch.*`, `sound.cost.*`, `supplement.sound_fallback_label`
keys. The ~452 other keys were **not** re-audited; they are covered only by the
integrity proof below.

## Mechanical result

- Repo validator (`node --test --test-name-pattern '[vi]' scripts/i18n/locale-parity.test.mjs`):
  6/6 pass — key set equals English, every ICU placeholder preserved, not an English stub.
- `check-duplicates`: 1437 files, 0 duplicate keys. `context-parity`: ok (129 allowed
  gaps, none in this namespace). `generate.mjs --check`: `keys.gen.ts` byte-identical.
- My own ICU check of the 15 keys (real `@formatjs/icu-messageformat-parser`): argument
  sets identical to English; **every plural carries `other`**, no branch outside vi's
  CLDR set (vi is `other`-only per the style guide, so the one/other collapse in
  `media.*_label` and `sound.batch.summary` is correct, not an omission); the `=1`
  exact branches and the `=0 {}` hide-branches are preserved; `has_attention` select
  keeps the *data* values `yes`/`other` untranslated; every number argument keeps its
  `::group-off` skeleton; all values NFC; ellipsis is U+2026 where English has it and
  absent in the `region_label` aria name; no space before punctuation; no English prose.
- Integrity vs history: merged file has 467 keys; **452 keys byte-identical to
  `origin/main`**, **5/5 `loading.*` equal to `origin/main`**, **10/10 PR-added equal to
  the pre-merge head `107ff1dd`**, **0 changed** values outside the 15, **0 keys** new
  or dropped beyond the moves, and the four renamed keys (`older_history.loading`,
  `placeholder.loading`, `placeholder.region_label`, `transcript.stale_caption`) are
  absent. 467 = 457 (main) + 10 (PR).

## Findings

None. No BLOCKER, MAJOR, MINOR or NIT survives review — see the observations for the
places I pushed hardest on and why they are clean.

## Observations (not findings)

1. `loading.older` = `Đang tải tin nhắn trước…` — `trước` can also parse as
   "in advance". **I concur with the earlier NIT disposition (no change):** three
   shipped siblings in this very product use the same words
   (`Tải tin nhắn trước`, `Không tải được tin nhắn trước`,
   `Tìm trong tin nhắn trước`), so changing it here alone would create the drift it
   claims to fix. Rewording would need to move the whole family.
2. `loading.revalidating` = `Đang kiểm tra tin nhắn mới…` — "checking **for** new
   messages" is rendered as `kiểm tra` + noun, exactly the shipped pattern for
   "checking for updates" (`Đang kiểm tra bản cập nhật…`, `ui.browser.extensions`).
   Calque-free and correct in register.
3. `sound.batch.item_status` / `sound.batch.summary` use shipped state vocabulary:
   `Thất bại` (`ui.settings.imports.outcome_failed`, `ui.code_review.ci.failing`),
   `Đã dừng` (`ui.projects.project_model.stopped`), `Không rõ trạng thái` (identical
   to `ui.ownerAudit.unknown_status`), `hoàn tất` (`ui.settings.imports.state_done`).
   The summary's English hedge "cancelled/stopped" collapses to `đã dừng`: truthful
   for both outcomes, and consistent with this card's own `cancelled → Đã dừng` row,
   so I do not read it as an omission.
4. `sound.batch.latest_update` = `Cập nhật gần nhất: {name} (mục {item}/{total}).` —
   the compact `mục 3/5` form keeps "item X of Y" without a calqued `của`; no meaning
   lost, and it keeps the line short for the wrapping row.
5. `supplement.sound_fallback_label` = `Âm thanh được tạo` — noun + passive is right for
   a *name*; the status line `Đã tạo hình ảnh` is verb-initial by role. I agree with the
   r3 INFO note: do not "unify" these two later.
6. `item_status`'s `Không rõ trạng thái` is three words against the sidecar's "one or
   two words" hint. Cleared: the sidecar says the line wraps (`break-words`), no
   `maxCells`/`maxChars` hint exists in this namespace's sidecar, and the identical
   three-word string ships in `ui.ownerAudit`. Shortening to `Không rõ` would drop
   "status" to save four characters.

## Prior audits — agreement, stated with evidence

`i18n/receipts/d29293b521fd.json` (2026-11-11, deepseek/deepseek-flash) passed the same
vi bytes (`65beedff…`) for these 10 keys with 0 findings; `15686088b7ce-vi.json`
passed the main-side bytes for the 5 `loading.*` keys, carrying three deferred NITs that
touch no key in this delta except `loading.older` (observation 1 above). My independent
pass reaches the same verdict, and I record the reason each time rather than deferring to
those receipts: I re-derived the placeholder/branch/NFC facts from the bytes and
re-checked every term against shipped vi copy before agreeing.

## Ledger binding

I did **not** run `ledger-assemble`: the worktree is read-only for this audit and the
manager owns the ledger rows for this merged-bytes reset. Instead I dry-ran the repo's
own derivation (`deriveReceiptAudit` from `scripts/i18n/ledger-rules.mjs`, the function
the writer applies) against my receipt bytes and these file hashes. It returned:

    agent i18n-auditor · instance 49c5a10a37b4 · model deepseek/deepseek-flash
    result clean · findings 0/0/0/0 · source_sha256 and target_sha256 both match

The receipt's own sha256 is deliberately not quoted here: this report's hash sits inside
the receipt, so embedding the receipt's hash in this file would make both values chase
each other. The integrator records the receipt hash when copying it into
`i18n/receipts/49c5a10a37b4.json`; `audit.log` §9 holds the derivation output.

So the receipt is ready for the integrator's copy into `i18n/receipts/49c5a10a37b4.json`
and the corresponding ledger row.

## Artifacts (session scratch; integrator copies into tracked evidence)

- receipt: `$SCRATCH/49c5a10a37b4-receipt.json`
- this report: `$SCRATCH/report.md`
- execution log: `$SCRATCH/audit.log` (real commands + actual output; execution log,
  not notes)
- integrity script: `$SCRATCH/integrity_vi.py` · ICU checker: `$SCRATCH/icu_vi_check.mjs`
