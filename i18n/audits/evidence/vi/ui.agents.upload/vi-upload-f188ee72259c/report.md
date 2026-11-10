# Audit report — vi / ui.agents.upload / vi-upload-f188ee72259c

- Locale `vi`, file group `ui.agents.upload`: 15 keys added by `2b72db6a56a` under audit, 46 keys in the file.
- Branch `i18n/slice-upload-agent-dialog`; base `b915083bd96`, head `2b72db6a56a`.
- Verdict **changes-requested** — blocker 0, major 1, minor 0, nit 2, info 5.
- Companion record `record.json`; receipt `i18n/receipts/vi-upload-r1-f188ee72259c.json`.

## Method

Read the vi style guide, the shared glossary and the English context sidecar first; bound the bytes by
sha256 before reading any content; then the machine checks (key set and order, placeholder multiset
parity, ICU parse of all 15 values, NFC), then accuracy, idiom/register, terminology against the
locale's shipped siblings, and width against each key's stated `length_hint`. The one judgement call
the brief asked for — `target.blocked_hint` — was settled by rendering, not by reading: the catalogue
bytes were formatted with the repository's own formatter (`intl-messageformat`, locale `vi`) at
count 1, 2 and 12, and `Intl.PluralRules` was asked which cardinal categories Vietnamese actually has.

Everything else passes. Placeholders match the English source key for key (multiset, including the
nested `{org}` and `{count}`); all 15 values parse as ICU; the file is NFC-clean; key set and order
match the English catalogue exactly; the five-item "nothing else leaves this machine" promise is
neither added to, dropped from nor reordered; typography follows the style guide (`“ ”`, U+2026, no
space before punctuation); terminology reuses the locale's shipped wording instead of inventing
second names.

## Findings

### vi-r1-m1 — MAJOR — `ui.agents.upload.target.blocked_hint`

**Current.** `Chia sẻ tác nhân trong một tổ chức thuộc gói Team. {count, plural, other {Chủ sở hữu của tổ chức được đánh dấu ở trên (chẳng hạn {org})}} có thể kích hoạt gói này trong Radient Console.`

**Problem.** The single `other` arm names one organization. The sidecar forbids exactly that for every
non-`one` category: *"The 'one' arm names the organization the reader has to ask; every other category
says 'any of the organizations marked above', without naming one, and must stay usable for a count of
two as well as a dozen."* Vietnamese has only `other` (CLDR, confirmed: `Intl.PluralRules('vi')`
returns `other` for 0/1/2/5/12/100), so there is no `one` arm that may legitimately carry the name —
the translator kept the naming affordance by gluing a parenthetical into the only arm it had.

Rendered at counts 1, 2 and 12 the string is byte-identical: *"…Chủ sở hữu của tổ chức được đánh dấu
ở trên (chẳng hạn Acme Corporation) có thể kích hoạt gói này…"*. Two defects follow, in opposite
directions:

1. **At count ≥ 2** the string presupposes exactly one organization (`của tổ chức được đánh dấu ở
   trên`, singular definite) and names `blockedTargets[0]` — the first blocked organization in the
   picker's order, which is arbitrary from the message's point of view — as if it were exemplary. The
   design's whole point for this arm is that several organizations may be marked and the reader owes
   any of their owners a request.
2. **At count = 1** it is wrong the other way: `chẳng hạn` (*for example*) hedges a singleton, implying
   further organizations that do not exist, where the English `one` arm simply states *"An owner of
   Acme Corporation"*.

So the parenthetical is a workaround that shows through rather than a natural rendering — it works at
neither count. It does, however, fix something real: the draft it replaced put `{org}` straight after
`được đánh dấu ở trên`, where `trên Acme Corporation` parses as a prepositional phrase (*marked above
Acme*) before the reader recovers *marked above: Acme*. That garden path is genuine (recorded as
vi-r1-i4 so a remediation does not reintroduce it).

**Proposed fix.** Remove the placeholder and let the arm carry the `other` semantics, which is also
the shape the locale already ships for the same subject
(`ui.agents.publication.team_plan_required.body`: *"Chia sẻ tác nhân trong một tổ chức thuộc gói
Team. Hãy nhờ chủ sở hữu tổ chức kích hoạt gói này trong Radient Console, rồi xuất bản lại."* — no
organization named at all):

> `Chia sẻ tác nhân trong một tổ chức thuộc gói Team. Chủ sở hữu của một trong các tổ chức được đánh dấu ở trên có thể kích hoạt gói này trong Radient Console.`

Verified to parse and to render identically at count 1, 2 and 12; 156 characters against the current
185, so it also shortens the longest hint in the dialog. The call site
(`upload-agent-dialog.tsx:1040-1045`) can keep passing `org`: `IntlMessageFormat` ignores an argument
the message does not reference, and `keys.gen.ts` declares `{ count: number; org: string }` either way.
The cost is the named organization at count = 1 — an affordance Vietnamese cannot express without a
`one` arm, and one the picker itself already provides by printing each blocked organization's name
directly above the hint.

### vi-r1-n1 — NIT — `ui.agents.upload.published.org_listed`

`nằm trong tác nhân được chia sẻ của {destination}` puts a bare noun after `trong` where the sense is
*among* the shared agents; `nằm trong số tác nhân` or `nằm trong các tác nhân` reads better. Meaning is
not lost — Vietnamese tolerates bare nouns in this frame — so this is recorded as a wording
improvement, not a defect. Suggested: `“{name}” nằm trong số tác nhân được chia sẻ của {destination}
dưới dạng bộ chỉ dẫn.`

### vi-r1-n2 — NIT — `ui.agents.upload.availability.reserved_named` / `reserved_unnamed`

75 and 74 characters against sidecar budgets of *"about 60"* and *"about 55"* for one line under the
name field. Vietnamese runs long by rule (vi style guide, *"Width rules: vi runs long; tighten"*), so
this is recorded as a wrap risk on a single line, not an observed clip — this audit rendered no dialog.
If it wraps or clips, `Trung tâm dành riêng “{name}” cho một trong các tác nhân tích hợp.` (70) drops
`của mình` and stays idiomatic.

## Rulings asked for

### vi-r1-i1 — `{count}` declared but never rendered is correct

The sidecar says it outright: *"It selects the organization phrase; it never renders as a digit."* The
English source behaves identically — neither of its arms prints `{count}` — and the argument cannot be
dropped, because a plural arm needs a selector. Not a defect.

### vi-r1-i2 — the single-category collapse is correct; only the arm's content is at issue

Identical output at every count is what a one-category locale *should* produce, and it is not evidence
of a broken plural. CLDR gives Vietnamese one cardinal category, the vi style guide is binding on the
point (*"`other` only — Vietnamese has no plural agreement; never add one/other branches"*), and every
plural message in this namespace plus twelve other shipped vi keys use `other` alone. This is stated
separately from vi-r1-m1 so the MAJOR is not misread as "the plural is wrong": the collapse is right,
what the arm says is wrong.

## Consistency, and one merge prerequisite

`vi-r1-i3` — terminology matches the shipped siblings rather than inventing second names: `Trung tâm
tác nhân` (Agent Hub, 26 shipped uses), `mục đăng` (listing, 9), `bộ chỉ dẫn` (instruction set, 7),
`tác nhân tích hợp` (built-in agent, 5), `Radient Console` capitalised as shipped (10), `gói Team` as
shipped (6). No English residue beyond the product and tier names the sidecar protects.

`vi-r1-i5` — **merge prerequisite, not a vi defect:** all seven locale rows for `ui.agents.upload` in
`i18n/ledger.json` are stale on both hashes at this head — row source `45760232…` against disk
`3676c1b3…`, and each row's target likewise — identically for es/fr/hi/ru/ur/vi/zh-CN. The source-side
drift is inherited from the base `b915083bd96` (the English keying commit), the target-side from this
commit, so it is a property of the PR, not of the Vietnamese values. Reassemble each row with
`ledger-assemble` and its new receipt.

## Notes versus execution

This report and the record's finding text are reasoned notes. The commands actually run and their
verbatim output are in `record.json` → `checks`; no command output is asserted here that is not
recorded there. Repo-wide gates (`ledger-check`, `check-clean-view`, `generate --check`, the vitest
suite) were **not** run — they are CI's and the manager's — so this bundle claims no verdict on them.
