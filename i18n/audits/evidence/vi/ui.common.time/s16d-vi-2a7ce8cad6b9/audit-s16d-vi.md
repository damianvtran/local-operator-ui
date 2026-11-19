# s16d — vi audit (`ui.common.time`, 4 new keys)

**Verdict: CLEAN** — blocker 0 · major 0 · minor 0 · nit 0.

- Locale: `vi` · namespace: `ui.common.time` · PR #1877 (S16d live-locale time words)
- Auditor: agent `i18n-auditor`, model **deepseek/deepseek-flash**, session `2a7ce8cad6b9`
- Independent of the translator (`i18n-translator`, anthropic/claude-sonnet-5-5); read-only audit, no edits/commits/posts.
- Scope: the four NEW values only. Landed `ui.common.time.yesterday_at` re-read as precedent/context, not re-audited.
- Worktree `~/local-operator-ui/.worktrees/i18n-s16d` @ `dcdcb6a9d8c4a80d239fc56498765c2b64417d38` (verified HEAD, clean `git status`); base `origin/main` @ `7c2b6af66486`.

## 1. Input hashes (verified, not assumed)

| input | sha256 |
|---|---|
| candidate `vi-s16d.json` (drafts) | `303a1bc3a27a886027516399574f2c9965e956965cd8526ddacab0237d3cf489` |
| candidate sorted-key compact digest | `8fea7522…` — **matches the recorded value** |
| `en/ui.common.time.json` | `bb0b3aa1a71679cc73cb40d73616b5e22057c7dcbc86705c2ec4425984971e13` |
| `en/ui.common.time.context.json` | `a9069037edc11c59288a7c2d3171496b1ef44a0982fc28e6a0edb4bcae0f98d2` |
| `vi/ui.common.time.json` (pre-landing) | `c0bed5df041a72992031e574f0f3a59cd29608a4c6dd13cb1d41186e05d1b60a` |
| translator notes `vi-s16d-notes.md` | `df8d38a92e36d75d…` |

## 2. Mechanical — passed

Ran my own grid through the app's own formatter path (`intl-messageformat` +
real `Intl.DateTimeFormat('vi', …)`, checker: `check-s16d-vi.mjs`):

- **Placeholders identical to English**: `today_at` `{time}`; `weekday_at` `{weekday}`+`{time}`; `date_at` `{date}`+`{time}`; `yesterday` none. No ICU `plural`/`select` in any of the four → no CLDR-category obligation (and vi is `other`-only per style guide §Plurals).
- **No keys added or dropped**: en gained exactly these 4 (`git diff origin/main...HEAD -- en/ui.common.time.json`), `keys.gen.ts` gained the same 4 with the right param shapes, candidate carries exactly the 4. Valid JSON, tab-indented, en key order.
- **NFC** ✓ on all four. Precedent: **0** `Cf`/format characters and **0** NFC violations across all **158** vi catalogue files — the candidate introduces none.
- **No throws**, no unresolved `{…}`, no key-fallback at render.
- **Negative controls 5/5 caught**: dropped placeholder, renamed placeholder (throws), English left (`Today lúc {time}`), NFD form, smuggled RLM. (First run "missed" the English mutant — my harness lacked a token check; fixed and re-run, stated here rather than papered over.)

**Not run, deliberately:** repo catalogue validators. `generate.mjs --check` compares en → `keys.gen.ts` only and validates no target value; `catalogue-locale.test.mjs` needs an esbuild build of the whole tree (resource holds). Substituted the formatter grid, which is what actually determines these strings.

## 3. Accuracy, idiom, register — accepted

Actual ICU arguments for vi and the composed result (2026-11-12):

| key | ICU args | rendered |
|---|---|---|
| `today_at` | time `9:05` | `Hôm nay lúc 9:05` |
| `yesterday_at` (landed) | time `23:50` | `Hôm qua lúc 23:50` |
| `weekday_at` | weekday `Thứ Hai`, time `15:42` | `Thứ Hai lúc 15:42` |
| `date_at` | date `5 tháng 11, 2026`, time `14:30` | `5 tháng 11, 2026 lúc 14:30` |
| `yesterday` | — | `Hôm qua` |

Each is grammatical, sentence-cased, pronoun-free, `!`-free, 24-hour (formatter-supplied), no hand-written digits — as the style guide requires. The added `lúc` is not a meaning addition: Vietnamese needs the "at" for a clock, and it is the **already-shipped** joiner for the sibling key.

Precedent cited (not invented):
- `ui.common.time.yesterday_at` = `Hôm qua lúc {time}` — landed sibling, same shape.
- `ui.teamBridge.threadRow.last` = `… today {hôm nay lúc {time}} yesterday {hôm qua lúc {time}} …` — this exact composition already ships, lowercase only because it sits mid-sentence.
- `ui.notifications.group.yesterday` = `Hôm qua` / `.group.today` = `Hôm nay`; `ui.chat.sidebar_view.section.today` = `Hôm nay` — the standalone word is a byte-exact match for the existing one.
- `ui.chat.run_details.wake.cancel_wake_due` = `… kích hoạt lúc {due}`; `ui.chat.ask_queue.context.messages_since` = `… gần nhất lúc {time}` — `lúc` + clock throughout the catalogue.

Judgements checked and accepted: day-first order (en sidecar explicitly allows swap; vi reads day-first); `lúc` over a comma for `date_at` — the ICU long date already carries `, 2026`, so a comma joiner would stack two commas in a 26-cell label; weekday capital `Thứ` is CLDR output at label start, consistent with sentence case. Register is `bạn`-free plain verb style, matching neighbouring keys.

## 4. Nothing English left

The four values contain no English word tokens (token-level check against the English source, not a "has Latin" heuristic — vi is Latin-script). The clock, weekday and date fragments are all formatter output. No exceptions needed.

## 5. Fit

Longest rendered value 26 cells (`date_at`) vs English's 25, in a full-width thin divider; no `maxCells` hint on this group. `yesterday` 7 cells in the narrow meta row. No overflow risk, no wide-glyph or combining-mark risk (NFC, no CJK).

## 6. Observations (not findings — no count impact)

1. `date_at` renders `5 tháng 11, 2026 lúc 14:30`: the `, 2026` comma is ICU's, not catalogue text. Correct division of labour; recorded so nobody "fixes" it in the catalogue later.
2. `weekday_at` inherits CLDR's capital `Thứ`. Harmless at label start. It would read wrong only if a future site embedded `{weekday}` mid-sentence — no current site does (the meta row uses bare weekday separately).
3. Landing adds 4 keys to a file that currently holds only `yesterday_at` → 5 keys, en order.

## 7. Receipt status — predicted bytes, must be re-derived after landing

The value is **not landed**, so no receipt can bind the real on-disk bytes yet. I predict the landed file exactly and say how:

- Landed content = current `vi/ui.common.time.json` + the 4 candidate values, in **en key order**, tab indent, one key per line, trailing newline.
- That serializer reproduces **four existing files byte-for-byte** (`ui.common.time.json`, `ui.chat.ask_queue.json`, `ui.notifications.json`, `ui.hub.json`) — so the prediction is mechanical, not hopeful.
- **Predicted landed `vi/ui.common.time.json` sha256: `f87b908a4add8d24d3f52e8663b3f9198a20d77d93f6817ec413375d62a7b4fb`**

The receipt (`receipt-s16d-vi.json`) carries that hash with `target_hash_status: "predicted_pre_landing"`. `ledger-assemble` refuses a receipt that does not name the bytes on disk, so a mismatch fails safe (exit 2) — the integrator then re-derives the hash and, if it differs, re-runs assembly with the real value.

### Exact ledger command (run AFTER landing, from the repo root)

```
node scripts/i18n/ledger-assemble.mjs \
  --locale vi \
  --file src/i18n/catalogues/vi/ui.common.time.json \
  --auditor-instance 2a7ce8cad6b9 \
  --auditor-model deepseek/deepseek-flash \
  --result clean \
  --receipt /Users/damian/.local-operator/sessions/2a7ce8cad6b9/scratchpad/receipt-s16d-vi.json \
  --scope "S16d delta: the four new ui.common.time values (today_at, yesterday, weekday_at, date_at) under PR #1877; the landed yesterday_at is precedent, not re-audited." \
  --note "S16d vi delta clean: real vi ICU args composed (Hôm nay lúc 9:05 · Thứ Hai lúc 15:42 · 5 tháng 11, 2026 lúc 14:30). Record: i18n/audits/evidence/vi/ui.common.time/s16d-vi-2a7ce8cad6b9/record.json"
```

`--auditor-model` must stay `deepseek/deepseek-flash` (the receipt names it; a different value is refused). `--translator-agent` is not required: the vi/`ui.common.time` row already exists (target `c0bed5df…`); landing changes the target, so the row's prior audit is superseded as designed.

## Files

- `audit-s16d-vi.md` (this report) · `check-s16d-vi.mjs` (checker) · `receipt-s16d-vi.json` · `record-s16d-vi.json`
- All in `~/.local-operator/sessions/2a7ce8cad6b9/scratchpad/`; I made no repo edits.
