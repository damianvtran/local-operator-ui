# P7 round 1 — independent i18n audit — locale `hi`

Slice: `P7 / UI library organized-by actor sentences + audio position value`, ROUND 1.
Audit date: 2026-11-11. Auditor: i18n-auditor (independent), session `c3a0aa29dee6`.
Served model (from this session transcript, constant across 15 entries): `deepseek/deepseek-flash` (provider `deepseek`).
Translator under audit: `anthropic/claude-sonnet-5-5` (from candidate `hi.json.model`) — independent from me.

## Verdict

Findings reach NIT level only: 0 BLOCKER / 0 MAJOR / 0 MINOR / 2 NIT (non-gating).
Ledger-eligible status for `hi` / this file group: **`passed`** (rule: passed only if no BLOCKER/MAJOR remains).

## Inputs and hashes (sha256)

| input | path | sha256 |
|---|---|---|
| candidate | `~/local-operator-ui/.worktrees/_p7-prep/hi.json` | `9f404cfc9ef0f9621b37bbc194697694486b5260afe8197e8973763f993f335c` |
| source+context sidecars | `~/local-operator-ui/.worktrees/_p7-prep/keys.json` | `c2b57addb849fb35720fac74c79b59c1c47078534c0c50cf9e8b58c368c0a35a` |
| callsites/risks (read) | `callsites.md`, `risks.md`, `manifest.json` (same dir) | — |
| en `ui.library` @ origin/main a0464af9 | `src/i18n/catalogues/en/ui.library.json` | `065ac47c67e2a82867070f9df0e33d25c0d96aedd77438b584114147db07fd71` |
| en `ui.chat` @ origin/main | `src/i18n/catalogues/en/ui.chat.json` | `ee4e2a9eeb841750244e94a681e33eda92f87cb9727439779b77809c1628ea15` |
| hi `ui.library` @ origin/main | `src/i18n/catalogues/hi/ui.library.json` | `276df1d52759ac97fc03b0569c7ce95db066b449a8a130435340f024fecc942d` |
| hi `ui.chat` @ origin/main | `src/i18n/catalogues/hi/ui.chat.json` | `2a6c484cf4b677a4fb9ba74fdbfbf74849c612b60c0a858804daf2ef4d21e03a` |
| style guide | `~/local-operator/i18n/style-guides/hi.md` | `82292dc8d13fcc93dc752457719264aed3cc20bb65ecfaba0f0e5a31f4cb40d5` |
| glossary | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |

Repo/worktree strictly read (`git show origin/main:…` for catalogues; no writes, no ledger edit, no validator run against the tree).

## 1. Mechanical (python3 pass — see audit.log below)

- Key set identical to source, same order (6/6, `organized_by_agent … organized_unattributed`, then `ui.chat.audio.position_value`).
- Placeholder parity per key: 5× `{at}` ✓; `position_value` `{current}`,`{total}` ✓ (names, not just set).
- No ICU plural/select in any candidate string, so no CLDR category requirement applies (source is plural-free too). `hi` categories `one`/`other` unused here.
- No additions/omissions of keys; no empty values; no English-identical value; all values NFC-normalised.
- No markup/Rich tags, no backtick code, commands, flags, identifiers in these 6 strings.
- No bidi/format controls (no U+200E/200F/2066-2069/LRI-PDI), no ZWJ/ZWNJ; Latin characters appear only inside placeholders.
- Duplicate-value scan against all shipped `hi` catalogues: none of the 6 duplicates a shipped value.
- Repo gates (`check-coverage`, `ledger-check`, `check-strings`, `generate --check`) operate on committed catalogues and cannot be pointed at a standalone candidate file; mechanical checking here is the prescribed direct pass, not a claim of running those gates.

## 2. Fidelity (actor per key)

| key | English | hi | judgement |
|---|---|---|---|
| `…organized_by_agent` | Organized by an agent {at} | एक एजेंट ने व्यवस्थित किया · {at} | actor = generic agent, `एक` correctly indefinite, not the Librarian ✓ |
| `…organized_by_librarian` | Organized by the Librarian {at} | लाइब्रेरियन ने व्यवस्थित किया · {at} | term identical to `ui.library.librarian.title` = लाइब्रेरियन ✓ |
| `…organized_by_system` | Organized automatically {at} | अपने-आप व्यवस्थित हुआ · {at} | no person/agent claimed; intransitive "got organized by itself" matches the sidecar note ("the catalog itself did it, no actor named") ✓ |
| `…organized_by_user` | Organized by you {at} | आपने व्यवस्थित किया · {at} | आप register per style guide ✓, second person direct ✓ |
| `…organized_unattributed` | Organized {at} | व्यवस्थित · {at} | no actor claim (bare participle), does not silently fall back to librarian ✓ |
| `ui.chat.audio.position_value` | {current} of {total} | {total} में से {current} | total-first is the Hindi "of" construction; roles map correctly (0:12 = set, 0:05 = part) ✓ |

No negation/polarity flips, no omissions, no additions. Nothing destructive/permission/error-related in this slice.

## 3. Grammar, idiom, word order with `{at}`

`{at}` for `hi` renders as `2 घंटे पहले` / `अभी-अभी` (`ui.library.time.hours_h_ago`, `…just_now`), i.e. already a postpositional "ago" phrase. Appending it after `·` is the shipped pattern being replaced: `ui.library.preview.organized_by` = `{by} ने व्यवस्थित किया · {at}`, and `ui.library.librarian.last_organized` = `पिछली बार व्यवस्थित {at}`. Candidate keeps that exact frame with the actor inlined, so the five variants are grammatical and read naturally in sequence (`लाइब्रेरियन ने व्यवस्थित किया · 2 घंटे पहले`). No case/postposition problem: `ने` marks the agent for all three personal/agent actors, and the two actorless variants avoid `ने` correctly.

Voice spread inside the parallel set: three `…ने व्यवस्थित किया` (active, required where an actor is named) + one `व्यवस्थित हुआ` (intransitive, system) + one bare participle (unattributed). Grammatical, and it is the minimum spread Hindi forces when the actor disappears; see NIT-2 for an optional harmonisation.

## 4. Terminology

- Librarian → लाइब्रेरियन — matches shipped `ui.library.librarian.title` and `librarian.control_failed` ✓; glossary policy is translate-with-recorded-rendering, shipped spelling respected.
- agent → एजेंट — matches glossary §2 (`… · एजेंट`) and shipped usage (एजेंट / एजेंटों, `ui.chat`, `ui.settings`) ✓; no उप-एजेंट confusion (subagent term untouched here).
- organized → व्यवस्थित — matches `ui.library.sort.organized` (`पिछली बार व्यवस्थित`), `preview.unorganized` (`अभी व्यवस्थित नहीं किया गया`), `librarian.last_organized` ✓.
- automatically → अपने-आप — attested in shipped `hi` (`अपने-आप नाम देना फिर शुरू होता है`); `स्वतः` would also be admissible but the shipped catalogue's living form is used, which beat guessing. Consistent with the guide's "everyday standard Hindi over heavy Sanskritisation".
- Register: आप throughout ✓; no तुम/तू; no `कृपया`; no exclamation marks.
- Punctuation/typography: `·` with single spaces on both sides, no danda and no full stop (metadata fragment) — matches shipped `organized_by`; Devanagari conjuncts and nukta normal, no invented ZWJ/ZWNJ ✓.

## 5. Fit / width

English source characters are 26/31/28/21/14 and 20. Candidate rendered widths (Devanagari aware cell estimate, matras and virama counted zero-width, conjuncts estimated):

| key | en chars | hi chars | hi cells |
|---|---|---|---|
| agent | 28 (with `2h ago`) | 40 | 30 |
| librarian | 33 | 43 | 31 |
| system | 30 | 35 | 28 |
| user | 23 | 33 | 25 |
| unattributed | 16 | 23 | 18 |
| position_value | 12 | 16 | 13 |

All are at or below the English cell width. For the widest case (librarian) the same row today renders `librarian ने व्यवस्थित किया · 2 घंटे पहले` = 32 cells, and the new line is `लाइब्रेरियन ने व्यवस्थित किया · 2 घंटे पहले` = 30 cells, i.e. 2 cells narrower than shipped and 3 under the 33-cell English line, because the Devanagari term measures narrower than the raw Latin id it replaces. No `maxCells` hint is set on these keys (the sidecar says only "comparable width"). `position_value` is announced, not laid out. No overflow risk flagged. Not verified against a rendered frame (nothing to render from a candidate file; a hi preview screenshot belongs to the coding PR's QA pass, not this audit).

## 6. RTL

Not applicable — `hi` is LTR. Verified anyway that no manual bidi/isolate characters were introduced (see §1) and that the time phrase order follows LTR Hindi prose.

## Findings

**NIT-1 — `ui.chat.audio.position_value`** · current: `{total} में से {current}` · suggested (optional): `कुल {total} में से {current}`.
Why: in a *spoken* aria-valuetext the total is heard before the value, and shipped `hi` frequently prefixes the total with `कुल` when it comes first (`कुल {total} में से {completed} पूरे`, `ui.projects.project_model.milestone_summary`; `कुल {count} में से छवि {index}`, `ui.common.viewer.image_progress`) precisely to stop that order being ambiguous. Counter-evidence, which is why this is only a NIT: the unprefixed form also ships (`{total} में से टर्न {turn}`, `ui.chat.checkpoint.turn`; `{iterations} में से {completed}`, `ui.chat.pickers.destination_pickers.completed_of`; `संदर्भ: {window} में से {used} टोकन।`, `ui.miniView.context_window`). Current text is correct and comprehensible; change only if the audio stream wants maximum clarity on first listen.

**NIT-2 — `ui.library.preview.organized_unattributed`** · current: `व्यवस्थित · {at}` · suggested (optional): `व्यवस्थित किया गया · {at}`.
Why: the other four lines in this row land on a finite verb, and `ui.library.preview.unorganized` in the same component is `अभी व्यवस्थित नहीं किया गया`; a passive `किया गया` would keep voice uniform while still naming no actor. The current bare participle is shipped-style (`ui.library.sort.organized` = `पिछली बार व्यवस्थित`) and reads fine behind the `·`, so this is polish, not a defect. Do not change it if the shorter form is preferred for the metadata line.

## Observations (not findings, not `hi`-specific)

- `relativeTime()` returns `""` when seconds is falsy, so any of these five strings renders with a trailing `" · "` in that state. Identical behaviour exists today with the shipped `ui.library.preview.organized_by`, so it is not a regression introduced by this key set; flagged only so the coding PR's callsite (`organizedByLabel`) can trim the separator if it wants to.
- Repo gates that will consume these 6 keys (coverage allowance is shrink-only, ledger re-audit for changed `ui.library`/`ui.chat` source hashes) are the coding PR's obligation; I did not touch the ledger.

## Ledger record proposal (manager to apply; I did not write it)

- locale `hi`, namespace `ui.library` + `ui.chat` (this group), status **`passed`**, auditor `i18n-auditor` (session `c3a0aa29dee6`, model `deepseek/deepseek-flash`), independent of translator session (`anthropic/claude-sonnet-5-5`), source hash = `c2b57add…` (keys.json) / `065ac47c…`+`ee4e2a9e…` (en catalogues), note ≤280 chars: "6 keys, 0 blocker/major; 2 NIT (optional कुल on aria-valuetext; passive alternative for unattributed) not gating. Report: scratchpad p7-round1-audit-hi.md".

## audit.log (executed, verbatim commands and outcomes)

```
python3 key-set/order/placeholder/empties/NFC pass   -> 6/6 keys match, order matches, placeholder parity per key True, empty False, ident-to-en False, NFC True, braces balanced
python3 script/bidi-control scan                     -> latin only inside placeholders; no Cf/Cc bidi controls; only '·'(U+00B7) and spaces as punctuation
python3 duplicate-value scan vs shipped hi           -> no duplicate for any of the 6 values
git -C ~/local-operator-ui show origin/main:src/i18n/catalogues/hi/ui.library.json | grep organized_by  -> "{by} ने व्यवस्थित किया · {at}"
   -> same file: librarian.title = "लाइब्रेरियन"; sort.organized = "पिछली बार व्यवस्थित"; preview.unorganized = "अभी व्यवस्थित नहीं किया गया"
git show origin/main:src/i18n/catalogues/hi/ui.library.json | time strings -> hours_h_ago = "{hours, plural, one {{hours, number, ::group-off} घंटे पहले} other {…}}"  ({at} shape confirmed)
python3 "में से" total-first census (58 occurrences, 17 with कुल / 25 without among numeric forms; several of the 'without' hits are कुल forms my regex missed) -> both orders ship; basis for NIT-1 being a NIT, not a MAJOR
python3 cell-width comparison (Devanagari matra/virama zero-width estimate) -> hi cells 30/31/28/25/18 vs en 28/33/30/23/16; position_value 16ch/13 cells vs 12/12
session transcript model scan -> "provider":"deepseek" (65), "model":"deepseek-flash" (15), no other model
```

`audit_notes_not_execution_log`: §1-§5 prose is reasoning; the block above is the record of what was executed.
