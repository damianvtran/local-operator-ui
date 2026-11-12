# S16e — second independent pass vs first pass (divergence ledger)

My per-key judgement of all 84 values was written down and the mechanical pass run **before** I opened
`…/s16e/audits/<locale>/report.md`. This file records only where the two passes differ, so the manager can
see what a second independent read changed. Both passes are independent of the translator; neither is a
self-audit.

Slice-wide agreement: **0 BLOCKER, 0 MAJOR in either pass, in all 7 locales.** The promise ladder holds in
every locale under both reads: `cancel.queued` keeps a flat no-charge promise, `cancel.running` keeps a stop
*request* with a charge conditional on producing audio, `settlement.pending` states an outstanding charge
without an amount or a zero, and the six failure-class labels stay distinct from each other and from the
sentence rendered under them.

The operator's actual requirement — *switching locale must leave no English anywhere* — holds for the copy:
across all 84 values the only Latin retained is glossary-sanctioned (`endpoint`, exactly where each locale's
shipped `ui.chat.canonical.sound.stop.warning` already keeps it; the documented `id`/`ID` token; and zh-CN's
own shipped 接口 instead of `endpoint`). No untranslated English sentence survives in any of the 84 values,
including the hi/ur Latin `endpoint` islands, which the glossary records as kept-English for every locale.

| Locale | First pass | This pass | What changed, and why |
|---|---|---|---|
| `fr` | F1 NIT, F2 NIT | FR-2-01 NIT, FR-2-02 NIT | **Agree, same severity.** F1 (rate-limit construction) and F2 (`règlement` as a new programme term) both reproduce on my own reading of the shipped corpus. |
| `es` | 0 findings (3 INFO) | 0 findings | **Agree.** «Bloqueo por política» and «Audio saturado» are the right calls for this locale and I reached the same conclusion independently before reading the report. |
| `ru` | N1 NIT (subject of «перегружена»), N2 NIT («Лимит аудио») | 0 findings | **Diverge on both, neither gates.** The English itself makes the activity the subject («Audio generation is busy right now»), so «Генерация аудио сейчас перегружена» is faithful, not a subject slip. «Лимит аудио» uses the corpus's own noun (18 shipped «лимит» values, e.g. «исчерпали лимит запросов»); a class label naming the limit is a legitimate shape. Both remain available as optional polish; I did not want to record findings I would not defend. |
| `vi` | F1 MINOR (settlement drift), F2 MINOR («Tạo âm thanh đang bận»), F3 NIT («Trùng id») | VI-2-01 MINOR, VI-2-02 MINOR, **VI-2-03 NIT (new)**, F3 → INFO | **Agree on F1/F2.** F2 is independently confirmed: all 7 shipped «đang bận» values put a noun in the subject slot («Tác nhân», «Trung tâm», «Trạng thái đã đọc»), so a bare verb phrase is the outlier. **F3 demoted, not disputed:** shipped vi has 4 prose lowercase «id» usages, English is lowercase, so it is house-consistent rather than drift. **New:** `error_class.gate_failed` «Bị cổng chặn» — «cổng» is also this UI's word for a network port (`destination_pickers.ports` «Cổng», `info_model.control_port` «Cổng điều khiển»), so the bare label is vaguer than the other five. |
| `zh-CN` | S16e-zhCN-01 MINOR (callsite joiner), S16e-zhCN-02 NIT | ZH-2-01 MINOR, 02 → INFO | **Agree on the composition finding, independently verified** at `image-gen-card.tsx:341` (`${running} ${t(...checking)}`), which puts a half-width space between two 。-terminated Chinese sentences. Recorded against the composition, not the draft. **S16e-zhCN-02 demoted to INFO:** «音频生成当前繁忙» mirrors the English personification and the sentence is actionable; a service-noun variant is polish. |
| `hi` | HI-S16E-01 MINOR (rate-limit label), HI-S16E-02 NIT (checking line) | HI-2-01 MINOR, HI-2-02 NIT | **Both re-graded, same two strings, opposite severities.** The checking line («शुल्क की पुष्टि जाँची जा रही है।») is the more serious of the two: जाँचना makes the *confirmation* the thing being examined, which is a semantic slip inside a status line, so I grade it MINOR. The rate-limit label («ऑडियो दर सीमा») is grammatical as a bare compound and shipped hi attests the noun form («दर-सीमा अवधि», «दर सीमा लगी है»); the only loss is the "limited" state, so I grade it NIT. |
| `ur` | UR-S16E-01 MINOR (id casing), UR-S16E-02 MINOR (rate-limit construction), UR-S16E-03/04 NIT | UR-2-01 NIT, UR-2-02 NIT, UR-2-03 NIT | **Both MINORs re-graded to NIT.** UR-01: the token is cosmetic case with no glossary rule and the English source is lowercase «id»; the corpus preference is real (25/25 prose «ID») but the effect is a token form, not a meaning or register defect. UR-02: «آڈیو کی شرح محدود» is comprehensible and distinct; the settled noun «شرح کی حد» makes it a consistency call. UR-03/04 recorded as INFO and I agree with the first pass that no draft change is owed — the `sound.stop.warning` side is the one to harmonise later. |

## What this pass adds that neither the first pass nor the translator had

1. **Mechanical pass with 5 negative controls** run on the repo's own ICU parser against all 84 values
   (`mech.log`), plus a **codepoint scan** (`typo.log`) proving fr U+202F/U+2019 discipline and the absence
   of manual bidi controls in ur — the two typography rules a rendered screenshot would not catch.
2. **A cross-locale check of what Latin actually survives** (kept-English audit) rather than per-locale
   impression: the answer is `endpoint` (6 locales, matching each locale's shipped sibling), `id`/`ID`, and
   `{material}` — nothing else, in any of the 84 values.
3. **Independent confirmation of the zh-CN composition defect in code**, which is the one user-visible
   defect in the slice and is not a copy defect.
4. **The two severity swaps above** — recorded so the manager can see that a second read did not simply
   ratify the first.

## Not claimed by this pass

No build, browser, Storybook, Electron or renderer run; no rendered frames, no pseudo-localization, no
native-speaker review (explicitly not a gate); no full-file audit hashes (the 12 keys are a draft slice,
0 of them present in the shipped catalogues); no ledger append. The coder still owes post-integration
byte-compatibility proof and the `ledger.py append` binding.
