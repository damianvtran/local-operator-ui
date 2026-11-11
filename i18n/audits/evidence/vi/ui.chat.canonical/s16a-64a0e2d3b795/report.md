# vi audit — `ui.chat.canonical`, S16a draft v3 (14 new keys)

**Audit id:** `64a0e2d3b795-v3-vi` · **Date:** 2026-11-11
**Repo / PR:** `damianvtran/local-operator-ui` #1870 · worktree `~/local-operator-ui/.worktrees/i18n-s16a` @ `93a61605b059ada503d75da6e9e38e8ef14e1b67` (read-only)
**Locale:** `vi` · **Namespace:** `ui.chat.canonical` · **Keys:** 14
**Audited artifact:** `$SCRATCH/s16a-drafts/vi-s16a-v3.json`
`sha256 = a7929d1bb641cafa0a30d22e3ac7262840f1bb57d33e18232cae4ce739916518` — **verified against the expected value before reading** (matches).

## Verdict

**clean-with-findings** — `{blocker: 0, major: 0, minor: 0, nit: 2}`.

No BLOCKER or MAJOR. All 14 values are accurate to the English role, idiomatic
native copy in the product's vi register, structurally sound (placeholders,
select branches, `other`-only plurals, `::group-off`, U+00B7, U+2026, trailing
full stops), NFC-clean, and within the sidecars' stated length classes. The four
values changed in v3 — `tool.queued_sized`, `tool.queued_empty`,
`image_gen.state.queued`, `image_gen.state.already_finished` — are **correct**,
for reasons I rebuilt independently below rather than inheriting from the v1/v2
history.

## Independence and provenance

- Fresh instance `64a0e2d3b795` (this session). I am **not** the translator
  (the brief names `anthropic/claude-sonnet-5-5`), not either earlier vi auditor
  of this slice, and not the PR's coder. I edited nothing in the repo.
- **Model actually served: `deepseek/deepseek-flash`** (this session's header).
  No fallback occurred in this session; I have no independent channel that
  reports a different served model, so that is the value I claim.
- No translation/MT API, SDK or service was used, and no back-translation. Every
  verdict below is reasoning from the English source, its `role`/`tone`/`length`
  context, shipped vi usage grepped at `file:key`, and the binding core guides.
- I read the prior history (v1 → v2 → v3 diff) **after** forming per-key
  verdicts, and treat it as claims to check, not evidence. Verified: v3 = v1 with
  exactly four values changed (`git diff` of the three draft files), as the brief
  states.

### Guides actually used (they are not in the UI worktree)

`i18n/style-guides/vi.md` and `i18n/glossary.md` **do not exist anywhere in the
`local-operator-ui` history** (`git log --all -- i18n/style-guides/vi.md` → empty;
`git ls-tree HEAD | grep i18n/style-guides` → 0). They live in the **core** repo,
which is where an existing record's `reference_hashes` point:

| Input | Path | sha256 |
|---|---|---|
| Style guide (binding) | `~/local-operator/i18n/style-guides/vi.md` | `e4901497ed553e2b2ae4a2660bf776adb787b89e11d7eb0f8d08f3da4b227888` |
| Glossary (binding) | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| Core revision | `~/local-operator` @ `b42471d3935cb7e95d64428af27c32626665f4c0` | (blobs above re-hashed from `git show HEAD:` — identical) |

All three hashes equal those already recorded in
`i18n/audits/evidence/vi/ui.chat.canonical/3b93a13f3f5b-1652r2-vi/record.json`,
so the guide content is the revision the programme has been auditing against.

### Inputs

| Input | Path | sha256 |
|---|---|---|
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` (456 keys) | `d6d47d31667fe69448cf408f5a4fecf9948782e850506a6141217585de9db1fd` |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` | `ef8a12dea1835c241af3a166754322ce093af88592ec625036211458a50accac` |
| Target locale catalogue on disk | `src/i18n/catalogues/vi/ui.chat.canonical.json` (442 keys, 14 missing) | `325e37d1a3b5e8a0bbdfbf57bbb5ea3208fb377e35407ca989cba6d5e08b6cb8` |
| **Audited draft (target)** | `$SCRATCH/s16a-drafts/vi-s16a-v3.json` | `a7929d1bb641cafa0a30d22e3ac7262840f1bb57d33e18232cae4ce739916518` |

## 1. Mechanical layer

Script: `mech.mjs` (my own, in this audit dir; read-only against the repo,
using the worktree's `@formatjs/icu-messageformat-parser` and
`intl-messageformat` via `createRequire`). Output: `mech.log`.

| Check | Result |
|---|---|
| Valid JSON, 14 values, key set == the 14 keys added by `93a61605b` | PASS (no key added, none dropped, none duplicated) |
| Placeholder names and argument types identical to source (`{size}` text, `{count}` number, `{material}` select, `{total}` number) | PASS |
| `select` branch sets identical to English (`video`, `voiceover`, `sound_effect`, `other`) in all 6 select messages | PASS |
| Plural categories legal and complete for `vi` (CLDR `Intl.PluralRules('vi')` → `["other"]`; style guide §Plurals: "`other` only … never add one/other branches") | PASS — `other` only, exactly as the guide demands |
| `::group-off` skeleton preserved (`queue_ahead`) | PASS |
| U+00B7 separator present, same count, spaces on both sides (`composing_sized`, `queued_sized`) | PASS (codepoint scan: `0xb7 MIDDLE DOT`) |
| U+2026 ellipsis preserved where English has one; no ASCII `...`; no ASCII hyphen separator | PASS (`0x2026 HORIZONTAL ELLIPSIS`) |
| Trailing full stop parity per key (present in `already_finished`, `failed`, `failed_batch`; absent elsewhere) | PASS |
| No markup/Rich tags, backticks, commands, flags or identifiers to preserve — none present in source or draft | n/a (parser ran with `ignoreTag: false`) |
| NFC / precomposed Vietnamese (style guide §Width: "always the precomposed (NFC) form") | PASS — zero combining marks, zero non-NFC strings |
| No NBSP/U+202F/zero-width/bidi-control characters, no double spaces, no edge whitespace, no `!` | PASS |
| No value identical to its English source (untranslated) | PASS |

**Counterfactual control (proves the checker bites, not just that it is quiet):**
on a deliberately corrupted copy (`neg.json`) the same script reported the
injected faults — `queued_sized: middle dot mismatch`, `running: select branches
differ en=other,sound_effect,video,voiceover vi=other,video`,
`already_finished: VI identical to EN (untranslated)`. It does **not** flag an
*extra* legal plural category (e.g. a stray `one` in vi), by design: ICU accepts
unreachable categories, so that is dead weight rather than invalidity — noted so
nobody reads the green as stronger than it is.

**Repo gates run as a control (they describe the committed tree, not the draft):**
`node scripts/i18n/context-parity.mjs` → `ok — every English key is covered,
apart from 129 allowed gap(s) in 4 namespace(s)`. `node
scripts/i18n/check-strings.mjs` was **killed** by the run's resource guard before
printing a verdict (exit −9): it is reported here as *not run*, not as passing.

## 2. Real formatting evidence (`intl-messageformat`, locale `vi`)

Counts `0,1,2,3,5,11,21,22,100,1000000` × materials
`image, video, voiceover, sound_effect` (full table in `mech.log`):

```
queue_ahead 0        -> "0 yêu cầu trước"
queue_ahead 1        -> "1 yêu cầu trước"
queue_ahead 21       -> "21 yêu cầu trước"
queue_ahead 1000000  -> "1000000 yêu cầu trước"     ← ::group-off honoured (no "1.000.000")
running image        -> "Đang tạo hình ảnh…"
running voiceover    -> "Đang tạo lời thuyết minh…"
running sound_effect -> "Đang tạo hiệu ứng âm thanh…"
running_batch image total=1        -> "Đang tạo 1 hình ảnh…"   ← vi plural `other` selected for 1
running_batch video total=1000000  -> "Đang tạo 1.000.000 video…"  ← `#` formats with vi grouping
done sound_effect    -> "Đã tạo hiệu ứng âm thanh"
done_batch video     -> "Loạt video"
failed video         -> "Không thể tạo video."
failed_batch image   -> "Loạt hình ảnh không thành công."
composing_sized      -> "đang soạn · 12.4 KB"
queued_sized         -> "đang xếp hàng · 12.4 KB"
already_finished     -> "Đã hoàn tất rồi."
```

EN control through the same library: `queue_ahead 3 -> "3 ahead"` (matches the
byte-identity expectations the PR's own suite pins). `#` inside the nested
plural resolves to the count (verified at every count above), and the
`::group-off` vs `#` asymmetry is inherited from the English shape, not
introduced by vi.

## 3. Per-key verdicts (all 14, read as a native reader)

| # | Key | vi v3 | Verdict |
|---|---|---|---|
| 1 | `tool.composing_sized` | `đang soạn · {size}` | PASS — "drafting · 12.4 KB"; `đang` = in progress, matches shipped `tool.never_sent_composed` `đã soạn` (vi `ui.chat.canonical.json:442`) and is the correct imperfective sibling. Lower-case terse line per sidecar. |
| 2 | `tool.composing_empty` | `đang soạn` | PASS — same state, size off. |
| 3 | `tool.queued_sized` | `đang xếp hàng · {size}` | PASS — see §4. |
| 4 | `tool.queued_empty` | `đang xếp hàng` | PASS — see §4. |
| 5 | `image_gen.state.queued` | `Đang xếp hàng` | PASS — see §4. |
| 6 | `image_gen.state.writing_request` | `Đang viết yêu cầu…` | PASS with NIT **VI-S16A-1** (verb differs from the row's `đang soạn` for the same phase). |
| 7 | `image_gen.state.queue_ahead` | `{count, plural, other {{count, number, ::group-off} yêu cầu trước}}` | PASS with NIT **VI-S16A-2** (`yêu cầu trước` also reads as "the previous request"). Zero reads "0 requests ahead", not a rank — the sidecar's hard requirement holds. |
| 8 | `image_gen.state.running` | `Đang tạo video… / Đang tạo lời thuyết minh… / Đang tạo hiệu ứng âm thanh… / Đang tạo hình ảnh…` | PASS — present participle per sidecar; one whole message per material as demanded; `hình ảnh` matches shipped `image_gen.progress` (`:5`), `video` matches shipped `ui.canvas.files.videos`. |
| 9 | `image_gen.state.running_batch` | `Đang tạo # …` × 4 materials, `other` only | PASS — `#` bound to `total`; vi needs no `one` arm (style guide §Plurals) and the singular-total case renders correctly as "Đang tạo 1 hình ảnh…". |
| 10 | `image_gen.state.done` | `Đã tạo video / Đã tạo lời thuyết minh / Đã tạo hiệu ứng âm thanh / Đã tạo hình ảnh` | PASS — receipt; `Đã tạo …` is the shipped settled-verb shape (`tool_row.verb.created_agent.settled` `Đã tạo tác nhân`, `:274`). Reads correctly as the per-item aria label the sidecar says it also feeds. |
| 11 | `image_gen.state.done_batch` | `Loạt video / Loạt lời thuyết minh / Loạt hiệu ứng âm thanh / Loạt hình ảnh` | PASS — noun phrase, capitalised per branch, no punctuation, exactly the English shape. `loạt` is the natural short word for a batch produced together; the card context rules out the "series" reading. |
| 12 | `image_gen.state.already_finished` | `Đã hoàn tất rồi.` | PASS — see §4. |
| 13 | `image_gen.state.failed` | `Không thể tạo video.` etc. | PASS — "could not be generated", pro-drop subject is native; claims nothing and blames nobody; `hoàn tất`/`tạo` family consistent with `image_gen.control.stop_hint_running` (`:175`). |
| 14 | `image_gen.state.failed_batch` | `Loạt video không thành công.` etc. | PASS — full sentence + full stop per sidecar; `không thành công` is the shipped sentence-register failure word (`ui.common.errors.media_request`), distinct from the terse outcome word `thất bại` (`tool_row.outcome.failed`, `:78`) by design. |

## 4. The four v3 values — rebuilt independently

### `queued` → `đang xếp hàng` (tool row, lower-case) / `Đang xếp hàng` (card, sentence case)

Every candidate checked against shipped vi, at `file:key`:

| Form | Shipped where | Reading |
|---|---|---|
| `đã xếp hàng` | `ui.settings.imports.state_queued` (`vi/ui.settings.imports.json:60`), `…phase_queued` (`:65`), `ui.chat.aside.adopt.queued` (`vi/ui.chat.aside.json:5`), `ui.chat.ask_queue.status.open` (`vi/ui.chat.ask_queue.json:43`) | perfective: the *act of queueing* is complete — fine for an import-state label or a "we queued it for you" confirmation |
| `đang xếp hàng` | `ui.chat.aside.ask_queued` (`vi/ui.chat.aside.json:16`: "…đang xếp hàng để vào cuộc trò chuyện") | progressive: it *is* queueing — the ongoing sense |
| `trong hàng đợi` | `ui.chat.sidebar.row.bg.queued` (`N trong hàng đợi`), `ui.chat.status.degraded` ("đang nằm trong hàng đợi") | locative noun phrase; used for counts and for prose, and it opens with a preposition, so it is weak as a bare status word |
| `đang chờ` | `ui.chat.canonical.tool_row.pending` (`vi/ui.chat.canonical.json:28`) | taken: it is this namespace's word for a *different* state (a call still running, screen-reader only) |

The English role is explicitly "dictation is over but the call has not started".
The perfective `đã` frames a not-started state as completed work — and on this
same single-element card state line the neighbouring settled states read `Đã tạo
…` and `Đã hoàn tất rồi.` — so `đã xếp hàng` there is a genuine mis-read hazard.
`đang xếp hàng` states the progressive truth and is the shipped ongoing form.
**I reach the v3 answer on my own evidence.**

*Does `Đang xếp hàng` read as "is lining up / arranging"?* No: transitive `xếp
hàng` needs an object (arranging *what* in rows). Bare, with `đang`, the
intransitive reading ("is queueing / is in the queue") is the natural one, and
the datum beside it fixes it ("· 2 yêu cầu trước").

### `already_finished` → `Đã hoàn tất rồi.`

`đã … rồi` is the standard Vietnamese "already" frame; dropping `rồi` (`Đã hoàn
tất.`, v1/v2) loses the counter-expectation the English "Already finished."
carries, which matters because this receipt exists precisely because a stop lost
the race with completion. Register is neutral, not colloquial: shipped vi uses
sentence-final `rồi.` in product copy (`ui.agents.publication.name_taken.owned_body`,
`vi/ui.agents.publication.json:67`: "Bạn đã xuất bản “{name}” rồi."). `hoàn tất`
is the shipped completion word in this very card
(`image_gen.control.stop_hint_running`, `:175`). Sentence case + full stop match
the sidecar. **Correct; no change.**

## 5. Findings

### VI-S16A-1 — NIT — `ui.chat.canonical.image_gen.state.writing_request`

- **Current:** `Đang viết yêu cầu…`
- **Problem:** same phase as the tool row's new `tool.composing_*` (`đang soạn`,
  "the model is still writing the call's arguments"); two verbs for one action in
  one feature. `viết` is correct Vietnamese, so this is alignment, not an error,
  and the two strings rarely coexist (the card *replaces* the ledger row for an
  image-gen call — `canonical-transcript.tsx:2560-2580` — though the fold header
  can still print `toolRecordSummary` for the same record).
- **Suggested:** `Đang soạn yêu cầu…` (same length, same register, one verb).

### VI-S16A-2 — NIT — `ui.chat.canonical.image_gen.state.queue_ahead`

- **Current:** `{count, plural, other {{count, number, ::group-off} yêu cầu trước}}`
  → "2 yêu cầu trước"
- **Problem:** two small things. (a) The sidecar asks for a noun-less, terse
  datum ("no noun; the card already says 'Queued'"), and this adds one — though
  bare "2 trước" is ungrammatical, so a noun is unavoidable and the choice is
  defensible. (b) `yêu cầu trước` can momentarily read as "the previous
  request(s)"; the leading `Đang xếp hàng` resolves it, so the risk is small.
- **Suggested:** `{count, plural, other {{count, number, ::group-off} lượt trước}}`
  → "2 lượt trước": shorter, uses `lượt` ("turn", already shipped in
  `ui.chat.aside.adopt.queued`: "khi lượt hiện tại kết thúc"), and cannot mean
  "previous request". Either form may ship; this is the tighter one.

**Not findings** (considered and rejected as findings, recorded so they are not
re-litigated): `lời thuyết minh` for voiceover — no shipped term exists, `giọng
đọc` is taken for the TTS voice (`ui.common.speech.*`) and `lồng tiếng` means
dubbing, so this is a sound coinage and it is used consistently across
`running`/`running_batch`/`done`/`done_batch`/`failed`/`failed_batch`;
`Loạt` for batch; `đang chờ lượt` for queued (shorter but ignores the shipped
`đang xếp hàng` term); `thất bại` for the batch failure (the English sentence
register matches `không thành công`).

## 6. Fit / width

- **No `maxCells` or `maxChars` in this sidecar** — the UI sidecars carry prose
  `length` hints instead ("One word", "Two to three words", "Short; shares one
  row … truncates with an ellipsis when narrow"). Judged against those, and
  against shipped vi of the same surfaces.
- Tool row (`tool.*`): English `queued` 6 chars → vi `đang xếp hàng` 13;
  `queued · {size}` 15 → 22. The sidecar permits "one word or short phrase" and
  says the row truncates with an ellipsis when narrow, so growth degrades by
  design. The shipped sibling is longer still — `không được gửi · đã soạn {size}`
  (`:442`) — so the row already carries this length.
- Card state line: `text-body-sm` = 0.8125rem (13px, `styles/index.css:1287`),
  datum `text-meta` = 0.75rem (12px). The line is `flex min-w-0 items-baseline
  gap-1.5`: the **text span wraps** (`min-w-0`, no `truncate`), the **datum is
  `shrink-0`** with `· <bdi dir="auto">` and never wraps
  (`image-gen-card.tsx:464-478`). Worst realistic queued line is
  `Đang xếp hàng · 123 yêu cầu trước` ≈ 31 characters ≈ ~195px at those sizes
  against a card whose media is `w-[240px] max-w-full` inside a full-width
  column — it fits, and if a pane is narrower the state text wraps before the
  datum does.
- **Gap, stated plainly:** I did **not** render the card. No pixel measurement,
  no wrapped-line count, no screenshot in this audit. The numbers above are
  glyph-free estimates from character counts plus the layout invariants read in
  source; rendered fit for vi on this card remains unproven.
- Wide-glyph/combining-mark risk: none — vi is Latin, all characters NFC
  precomposed, no fullwidth punctuation.

## 7. Handoff notes (read before landing)

1. **Ledger step not performed** — this worktree is read-only for me. The UI
   repo's contract is `i18n/receipts/<id>.json` + `scripts/i18n/ledger-assemble.mjs`
   (severity counts `{blocker, major, minor, nit}`, `result` must be
   `clean-with-findings` when nits exist, `instance` a real run id). I ship a
   receipt-shaped `receipt.json` here for that step.
2. **The target hash will change when the draft lands.** `ledger-assemble`
   refuses a receipt that does not name the bytes **on disk**, so
   `target_sha256` must be recomputed from the committed
   `src/i18n/catalogues/vi/ui.chat.canonical.json` (currently `325e37d1…`, 442
   keys) **after** the 14 entries are added — not pasted from this record's draft
   hash `a7929d1b…`. The draft's hash identifies exactly the 14 values audited.
3. `check-strings.mjs` did not complete here (resource guard). CI owns it.
4. Suggested evidence path: `i18n/audits/evidence/vi/ui.chat.canonical/64a0e2d3b795-v3-vi/`
   (`record.json`, `report.md`, `mech.mjs`, `mech.log`, `neg.json`,
   `receipt.json`), ledger note referencing that path, ≤ 280 chars.

## Artifacts (this directory)

`record.json`, `receipt.json`, `mech.mjs`, `mech.log`, `neg.json`, `report.md`.
`mech.log` is real execution output; `neg.json` is the counterfactual control
input. Nothing here is a rendered-frame or CI artifact.
