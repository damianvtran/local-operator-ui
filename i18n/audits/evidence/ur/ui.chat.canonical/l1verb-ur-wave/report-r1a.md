# Urdu (`ur`) translation audit — slice L1 / tool-row verbs — pass **A**

- **Locale:** `ur` (RTL), target namespace `ui.chat.canonical`, group `tool_row.verb.*`
- **Keys audited:** 182 (91 settled/running pairs + 2 Python pair forms) — every key in the staged file
- **Translator:** openai/gpt-6.1-sol (session unknown to me) — I did **not** translate these and did **not** edit them
- **Auditor:** `i18n-auditor` (lopdev), session `c9b45c58db17`, slice `l1-au-ur-A`
- **Actual served model:** `deepseek/deepseek-flash` (session header; no provider fallback observed in this run)
- **Date:** 2026-11-11
- **Verdict:** **blocked** — the file does not pass the gate. 0 BLOCKER, 4 MAJOR, 6 MINOR, 5 NIT.
  (`blocked` = the locale fails the audit, no BLOCKER/MAJOR-free; the audit itself
  completed on all 182 keys. No BLOCKER: nothing here swaps a destructive verb for
  a read-only one, breaks a placeholder or states a false outcome.)

Inputs (sha256):

| Input | Path | sha256 |
|---|---|---|
| English source + context/notes | `_l1-prep/keys.json` | `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419` |
| Target (audited) | `_l1-prep/ur.json` | `7525521c04130f6b8182ba941850d0cbe76f0b08bd997aa8a9fe153d05dfb5fd` |
| Style guide `ur` | `local-operator/i18n/style-guides/ur.md` | `c0eecf7f7b5e89956b7de9ab7a9eb647ff1a7ef701ccf2a7f0264d5eea15ca60` |
| Style guide `en` | `local-operator/i18n/style-guides/en.md` | `c967c91037be79a7b184b3288b8c0326a261e4adae95b7db06d83e96f8ea6ec7` |
| Glossary | `local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| Shipped `ur` catalogue (consistency) | `src/i18n/catalogues/ur/ui.chat.canonical.json` @ `6c0b841872d8` | `e9c5c4e97476439567dd3efa26f14e9257fcfc581b8526d89bb5d05a4e3c9e11` |
| Shipped `en` catalogue | `src/i18n/catalogues/en/ui.chat.canonical.json` @ `6c0b841872d8` | `a385671b988e5f03df6f650beb4a06f73c9efaead2316dfa9ab15bf043798765` |

Full-corpus consistency reference: the **8,872** shipped `ur` strings in
`src/i18n/catalogues/ur/*.json` (count printed by `scripts/i18n/ur-activation.test.mjs`).

---

## 1. Mechanical — PASS

| Check | Result |
|---|---|
| Key set equal to `keys.json` | 182 / 182, **no keys added or dropped** |
| Key order | identical (`list(keys) == list(ur)`) |
| Valid JSON, both files | yes |
| Empty / whitespace-only values | 0 |
| Placeholders | none in source and none in target (`placeholders: none` in every sidecar entry) — nothing to corrupt |
| ICU plural/select | none in this group (no `{`, `}`, `#` in any source or target value) |
| Markup / Rich tags / backtick code / commands / flags | none present in this group; the only non-Urdu token is the technology name `Python` (glossary §1: keep official spelling) |
| Manual bidi controls (U+200E/200F/2066–2069) | 0 — matches the ur guide's "no manual bidi" rule and the shipped gate |
| Forbidden script/punctuation (`\u0964`, U+0900–097F, U+0643/064A/0629/0649) | 0 |
| NFC normalisation | all values NFC |
| Urdu punctuation only (`۔ ، ؟ ؛`) / no terminal punctuation | 0 punctuation characters — correct for verb-column labels |
| Duplicate values that collapse two different operations | 0 exact duplicates |
| Trailing/leading/double spaces | 0 |
| Word count vs the "one to four words" width hint | all 182 ≤ 4 words; longest 22 chars (`پروجیکٹس کی فہرست دیتا`) |

**Nearest-miss worth naming** (not an exact duplicate, caught by hand not by the
mechanical test): `listed_jobs.{settled,running}` = «کاموں کی فہرست دی/دیتا»
is the *same object phrase* as `read_todos`/`updated_todos` «کاموں کی فہرست …».
Two different tools read as the same list — see UR-A4.

Commands actually run (values paraphrased where long; outputs summarised, not invented):

```
python3 - <<'PY'  # key parity / order / empties / English-identical / placeholders / bidi / latin
  keys 182 ur 182 | missing [] extra [] | order equal True
  mechanical issues: 2   (both = the allowed 'Python' in ran_python.settled/.running)
  duplicate ur values: none
PY

python3 - <<'PY'  # mirror of scripts/i18n/ur-activation.test.mjs rules on the STAGED file
  MANUAL_BIDI / FORBIDDEN_SCRIPT / NFC / punctuation / spacing → problems: 0
  order equal: True | both valid JSON, 182 keys each: True
PY

node scripts/i18n/ur-activation.test.mjs
  ✔ shipped Urdu covers settings, console, onboarding and the wider UI … (14.8ms)
  ✔ counts render ungrouped and the two remediated count messages agree
  ✔ the bundled Urdu catalogue carries no manual bidi controls or forbidden script
    ur bundled values checked: 8872
  ℹ tests 3  pass 3  fail 0
```

The activation test and the catalogue gates (`generate --check`, `check-strings`,
`ledger-check`, `context-parity`) run against the **committed** catalogue, which
at `6c0b841872d8` does not yet contain these 182 keys (`ur` has 51 `tool_row.*`
verb keys, the bridge set; the 182 new ones are staged only). So the staged
file's mechanical conformance is the python mirror above, stated as such — not a
claim that a catalogue gate ran on these bytes.

---

## 2. Findings

### UR-A1 — MAJOR — `reset` rendered with the file's own *resume* word, not the shipped *reset* word

- `ui.chat.canonical.tool_row.verb.reset_agent.settled` — current **«ایجنٹ بحال کیا»**, English `Reset agent` (`agent` tool's `reset` operation)
- `ui.chat.canonical.tool_row.verb.reset_agent.running` — current **«ایجنٹ بحال کر رہا»**, English `Resetting agent`

**What the operation actually is** (checked, so the finding is not mis-framed):
`agent(reset)` = "Restore a role over an edited one to its packaged version,
reporting what it replaced" (`tool://agent`). So «بحال کیا» is *not* a false
statement about the outcome — the agent really is restored — and I am deliberately
**not** calling this a BLOCKER for wrong meaning (an earlier draft of this audit
did; this is the corrected reading).

**Problem.** Two things still make it a defect:

1. **Terminology.** Shipped `ur` renders the operation `reset` as «ری سیٹ» in **29**
   strings (`ui.common.viewer.reset_view` «منظر ری سیٹ کریں`,
   `ui.settings.appearance.editor.reset_role`, `ui.canvas.files.reset`, …) and uses
   «بحال» for *restore / reinstate / resume* in **57** — one shipped string draws
   the line explicitly: «… **ری سیٹ** کسی عمل کا ڈیفالٹ **بحال** کرتا ہے»
   ("reset restores an action's default"). The English label and the shipped gate
   say `reset`; the staged row says the other word.
2. **One word, two operations in the same column.** «بحال کر رہا» is what this file
   uses for `resumed` and `resumed_session`. A reader scanning the gutter now meets
   «ایجنٹ بحال کیا» and «سیشن بحال کیا» and has to reach for the noun to know which
   operation ran; the shipped copy keeps reset and resume apart.

**Suggested.** settled «ایجنٹ ری سیٹ کیا» · running «ایجنٹ ری سیٹ کر رہا» (matches
English and the shipped term). If the wave prefers a native word over the loanword,
it must not be «بحال» — that word is already `resume` in this file; «ڈیفالٹ پر واپس
کیا» is the honest alternative but is longer than the gutter wants.

---

### UR-A2 — MAJOR — 26 of 91 `running` values use the bare imperfective, not the progressive

The staged file is split: **63** running values end in «رہا» (correct
progressive, matches shipped copy), **26** end in a bare «تا/تی» imperfective.
Consequence: the live row reads as a habitual third-person statement ("[it]
gives a list"), not as the action in progress, and the pair stops matching its
settled sibling in aspect. `settled` is past («کیا / دی / لیا»), so the running
form must be the progressive.

Evidence this is not a style preference: every shipped verb-column running value
uses the progressive — the 17 shipped `tool_row.bridge.verb.*.running` keys end
in «رہا» (17/17), the `generic_verb.running` is «کال جاری», and the shipped
corpus has **no** bare-imperfective verb label. The ur guide's own command forms
are «محفوظ کریں / دوبارہ کوشش کریں»; nothing licenses a bare habitual here.

| key | current | suggested |
|---|---|---|
| `listed_variables.running` | متغیرات کی فہرست دیتا | متغیرات کی فہرست بنا رہا |
| `listed_agents.running` | ایجنٹوں کی فہرست دیتا | ایجنٹوں کی فہرست بنا رہا |
| `synced_agents.running` | ایجنٹ ہم آہنگ کرتا | ایجنٹ ہم آہنگ کر رہا |
| `listed_teams.running` | ٹیموں کی فہرست دیتا | ٹیموں کی فہرست بنا رہا |
| `paused.running` | عارضی طور پر روکتا | عارضی طور پر روک رہا |
| `listed_secrets.running` | رازوں کی فہرست دیتا | رازوں کی فہرست بنا رہا |
| `described_secret.running` | راز کی وضاحت کرتا | راز کی وضاحت کر رہا |
| `listed_projects.running` | پروجیکٹس کی فہرست دیتا | پروجیکٹس کی فہرست بنا رہا |
| `linked_session_to.running` | سیشن کا ربط جوڑتا | سیشن منسلک کر رہا (see UR-A7) |
| `unlinked_session_from.running` | سیشن کا ربط توڑتا | سیشن کا ربط ہٹا رہا (see UR-A7) |
| `updated_milestone.running` | سنگ میل تازہ کرتا | سنگ میل اپ ڈیٹ کر رہا (see UR-A3) |
| `read_todos.running` | کاموں کی فہرست پڑھتا | کاموں کی فہرست پڑھ رہا |
| `updated_todos.running` | کاموں کی فہرست بدلتا | کاموں کی فہرست اپ ڈیٹ کر رہا (see UR-A3) |
| `listed_wakes.running` | بیداریوں کی فہرست دیتا | بیداریوں کی فہرست بنا رہا |
| `listed_jobs.running` | کاموں کی فہرست دیتا | جابز کی فہرست بنا رہا (see UR-A4) |
| `listed_network_peers.running` | نیٹ ورک ساتھی گنواتا | نیٹ ورک کے ساتھی گنوا رہا (see UR-A9) |
| `read_network_log.running` | نیٹ ورک لاگ پڑھتا | نیٹ ورک لاگ پڑھ رہا |
| `invited_device.running` | ڈیوائس کو دعوت دیتا | ڈیوائس کو دعوت دے رہا |
| `joined_network.running` | نیٹ ورک سے جڑتا | نیٹ ورک سے جڑ رہا |
| `listed_consoles.running` | کنسولوں کی فہرست دیتا | کنسولوں کی فہرست بنا رہا |
| `captured_console.running` | کنسول کی تصویر لیتا | کنسول کی تصویر لے رہا |
| `resized_console.running` | کنسول کا حجم بدلتا | کنسول کا حجم بدل رہا |
| `updated_secure_input.running` | محفوظ ان پٹ بدلتا | محفوظ ان پٹ اپ ڈیٹ کر رہا (see UR-A3) |
| `listed_symbols.running` | علامتوں کی فہرست دیتا | علامتوں کی فہرست بنا رہا |
| `listed_sessions.running` | سیشنوں کی فہرست دیتا | سیشنوں کی فہرست بنا رہا |
| `peeked_at_session.running` | سیشن کی جھلک دیکھتا | سیشن کی جھلک دیکھ رہا |

Width note: «سیشنوں کی فہرست بنا رہا» is 5 tokens against the sidecar's
"one to four words" hint. That is shipped precedent, not a new risk —
`tool_row.bridge.verb.channels.running` already ships «گفتگوؤں کی فہرست بنا رہا».
If the gutter must stay at four, use the compact form already present in this
file — «سیشن گنوا رہا» — but then apply it to **all** list keys (UR-A5), not half.

---

### UR-A3 — MAJOR — *update* rendered «تازہ کیا», which shipped `ur` reserves for *refresh*

Affected (10 keys, 5 operations):

| settled (current) | running (current) | English |
|---|---|---|
| `updated_agent` ایجنٹ تازہ کیا | ایجنٹ تازہ کر رہا | Updated agent / Updating agent |
| `updated_team` ٹیم تازہ کی | ٹیم تازہ کر رہا | Updated team / Updating team |
| `updated_secret` راز تازہ کیا | راز تازہ کر رہا | Updated secret / Updating secret |
| `updated_project` پروجیکٹ تازہ کیا | پروجیکٹ تازہ کر رہا | Updated project / Updating project |
| `updated_milestone` سنگ میل تازہ کیا | سنگ میل تازہ کرتا | Updated milestone / Updating milestone |

**Problem.** Shipped `ur` uses «اپ ڈیٹ» for *update* in **395** strings — for this
very operation, `ui.common.errors.agent_update` «ایجنٹ {agentId} اپ ڈیٹ نہیں ہو
سکا» — and uses «تازہ کرنا / تازہ ہونا» for *refresh* in **58**
(`ui.code_review.code_review_pane.refresh_code_reviews` «کوڈ کے جائزے تازہ کریں»,
`ui.settings.imports.refresh` «تازہ کریں», «تازہ ہو رہے ہیں» for "refreshing").
As staged, "updated the agent" says "refreshed the agent", and the transcript's
own error row for the same action says «اپ ڈیٹ» — one operation, two words.
Same collision inside the file: `updated_todos` «کاموں کی فہرست بدلی» vs the
shipped todo count `ui.chat.canonical.fold.count.todo` «کاموں کی فہرست اپ ڈیٹ».

**Suggested.** settled «… اپ ڈیٹ کیا» · running «… اپ ڈیٹ کر رہا» for all five;
`updated_todos` → «کاموں کی فہرست اپ ڈیٹ کی» / «… اپ ڈیٹ کر رہا»;
`updated_secure_input` → «محفوظ ان پٹ اپ ڈیٹ کیا» / «… اپ ڈیٹ کر رہا».

---

### UR-A4 — MAJOR — `jobs` translated with the **todos** term (collides with a different tool)

Affected (6 keys):

| key | current | English |
|---|---|---|
| `listed_jobs.settled` | کاموں کی فہرست دی | Listed jobs (`jobs` tool `list`) |
| `listed_jobs.running` | کاموں کی فہرست دیتا | Listing jobs |
| `cancelled_job.settled` | کام منسوخ کیا | Cancelled job (`jobs` `cancel`) |
| `cancelled_job.running` | کام منسوخ کر رہا | Cancelling job |
| `waited_for_jobs.settled` | کاموں کا انتظار کیا | Waited for jobs (`wait`) |
| `waited_for_jobs.running` | کاموں کا انتظار جاری | Waiting for jobs |

**Problem.** «کاموں کی فہرست» is exactly what shipped `ur` calls **todos**
(`ui.projects.project_todos.to_dos` «کاموں کی فہرست», `ui.chat.run_details.todos.title`,
`fold.count.todo` «کاموں کی فہرست اپ ڈیٹ»), while shipped copy calls background
**jobs** «جاب / جابز» in 10 strings — including the same operation:
`ui.common.errors.jobs_list`-class «جابز کی فہرست کی درخواست ناکام»,
`ui.chat.run_details.jobs` «جابز», `ui.chat.sidebar.row.bg.jobs` «{count} جابز».
Staged, `listed_jobs` and `read_todos` both read "the task list", so a job that
was cancelled is indistinguishable from a todo that was edited. The glossary
leaves the `ur` cell for *job* as «—» (wave records it), and the `hi` column
already records जॉब — `جاب` is the same call and is already shipped here.

**Suggested.** «جابز کی فہرست بنائی» / «جابز کی فہرست بنا رہا» · «جاب منسوخ کیا» /
«جاب منسوخ کر رہا» · «جابز کا انتظار کیا» / «جابز کا انتظار کر رہا».
(Recording `job → جاب/جابز` in the ur guide would close the glossary gap.)

---

### UR-A5 — MINOR — three different renderings for the same `list` operation

`list` is expressed three ways in one column: «… کی فہرست دی» (`list_variables`,
`list_agents`, `list_teams`, `list_projects`, `list_secrets`, `list_symbols`,
`list_sessions`, `list_wakes`, `list_jobs`, `list_consoles`), «… گنوائے»
(`listed_networks`, `listed_subagents`, `listed_network_peers`) and «فہرست بنائی»
(`listed`, the `glob` tool). Shipped copy leans on «کی فہرست» (**109** strings)
and the shipped bridge row settles this exact operation as «گفتگوؤں کی فہرست
بنائی / بنا رہا»; «گنوائے» has **0** shipped occurrences.

**Suggested.** Pick one family. Recommended: settled «… کی فہرست بنائی», running
«… کی فہرست بنا رہا» everywhere (`listed_networks` → «نیٹ ورکس کی فہرست بنائی»,
`listed_subagents` → «ذیلی ایجنٹوں کی فہرست بنائی»). If width forces brevity,
the compact «… گنوا رہا» is acceptable — but then for every list key, including
`listed` (`glob`) and `listed_wakes`.

---

### UR-A6 — MINOR — `found_*` says "searched", not "found"

- `found_definition.settled` — **«تعریف تلاش کی»** (`lsp` `definitions`)
- `found_references.settled` — **«حوالے تلاش کیے»** (`lsp` `references`)

The settled row reports an outcome; «تلاش کی/کیے» reports the attempt, and it is
the same wording as the `grep` key `searched` «تلاش کیا», so "found definition"
and "searched" read identically in the column. (The running forms «تلاش کر رہا»
are correct.)

**Suggested.** settled «تعریف ملی» · «حوالے ملے» (or «تعریف ڈھونڈی» / «حوالے ڈھونڈے»).

---

### UR-A7 — MINOR — `link`/`unlink` phrasing is tautological and loses the "to"/"from" relation

- `linked_session_to.{settled,running}` — **«سیشن کا ربط جوڑا» / «سیشن کا ربط جوڑتا»**
- `unlinked_session_from.{settled,running}` — **«سیشن کا ربط توڑا» / «سیشن کا ربط توڑتا»**

«ربط جوڑنا» is literally "to join a connection". More importantly the English
carries trailing prepositions whose object follows on the row (`link session
**to** <project>`, `unlink session **from** <project>`); the Urdu states no
relation at all, so the row reads "joined the session's link" and stops.

**Suggested.** «سیشن منسلک کیا» / «سیشن منسلک کر رہا» (to: carried by the object
on the row) · «سیشن کا ربط ہٹایا» / «سیشن کا ربط ہٹا رہا».

---

### UR-A8 — MINOR — `sent_keys` settled is a homograph of the polite imperative

`sent_keys.settled` — **«کلیدیں بھیجیں»** (`console` `keys`), running «کلیدیں بھیج رہا» (fine).

«بھیجیں» is the correct feminine-plural past ("sent keys") but is spelled
identically to the respectful imperative that shipped `ur` uses on every button
(«محفوظ کریں», «بھیجیں» — the guide's command form). In a settled row beside
«کنسول میں لکھا» it can be read as an instruction to the user.

**Suggested.** «کلیدیں بھیجی گئیں» (explicit past, 3 words).

---

### UR-A9 — MINOR — `peer` rendered «ساتھی», which shipped `ur` uses for a human teammate

`listed_network_peers.{settled,running}` — **«نیٹ ورک ساتھی گنوائے» / «نیٹ ورک ساتھی گنواتا»**.

In shipped copy «ساتھی» is a *person*: `ui.teamBridgeTrial.active.invite`
«ساتھیوں کو مدعو کریں», `tool_row.bridge.fallback.teammate` «ایک ساتھی ایجنٹ».
Mesh peers here are **devices**, so «نیٹ ورک ساتھی» reads as "a network colleague".
(The compound also drops the genitive «کے» that "network's peers" wants.)

**Suggested.** Minimal fix — restore the genitive: «نیٹ ورک کے ساتھی گنوائے» /
«نیٹ ورک کے ساتھی گنوا رہا». Stronger fix — name the thing: «نیٹ ورک کی ساتھی
ڈیوائسز گنوائے» / «نیٹ ورک کی ساتھی ڈیوائسز گنوا رہا». («ہم منصب» is the exact Urdu
for *peer* but reads formal and is also person-oriented, so it does not by itself
remove the ambiguity.)

---

### UR-A10 — MINOR — two running forms are a state noun instead of the pair's verb

- `searched_the_web.running` — **«ویب پر تلاش جاری»** (settled «ویب پر تلاش کیا»)
- `waited_for_jobs.running` — **«کاموں کا انتظار جاری»** (settled «کاموں کا انتظار کیا»)

«جاری» is idiomatic as a status, but no shipped *verb-specific* key uses it —
only the generic fallback («کال جاری»). Here it swaps the pair's own verb for a
noun phrase, so the two halves no longer match in form.

**Suggested.** «ویب پر تلاش کر رہا» · «جابز کا انتظار کر رہا».

---

### NITs

- **UR-A11 — `browsed` «براؤز کیا» / «براؤز کر رہا»:** understandable loanword verb but the `browser` tool's noun ships as «براؤزر»; «براؤزر میں کھولا» / «براؤزر میں کھول رہا» is plainer. Widely understood as-is.
- **UR-A12 — `spawned_session` «سیشن شروع کیا»:** "started" vs *spawn*; «نیا سیشن بنایا» / «سیشن بنا رہا» keeps it distinct from `resumed_session` «سیشن بحال کیا».
- **UR-A13 — `previewed_rename` «تبدیلیٔ نام جھلکائی»:** izafat plus «جھلکایا» is heavy for a two-word gutter; «نام کی تبدیلی دکھائی» / «نام کی تبدیلی دکھا رہا» is plainer.
- **UR-A14 — `checked_network_status` «نیٹ ورک جانچا»:** "status" dropped; «نیٹ ورک کی حالت جانچی» is exact and still 4 words.
- **UR-A15 — `steered` «رہنمائی کی»:** «رہنمائی» in shipped copy means guidance given in copy/text; *steer* injects direction into a running turn. Acceptable, noting the nuance.

---

## 3. Register, terminology and RTL notes (no finding)

- **Address/register:** no verbatim commands in this group, so the آپ rule is not
  exercised; no «تم/تو», no «براہ کرم», no «!» anywhere. Correct.
- **Gender agreement** is handled carefully and correctly throughout — worth
  recording as a strength, not a defect: ٹیم (fem) «حذف کی / بنائی / دیکھی / تازہ
  کی» vs پروجیکٹ/ایجنٹ (masc) «حذف کیا / بنایا / دیکھا»; بیداری (fem) «منسوخ کی».
- **Terms checked against glossary/style guide and shipped copy, and confirmed
  consistent:** سیشن (guide's call), بیداری/بیداریوں (wake), ذیلی ایجنٹ
  (subagent), ٹیم, ورک اسپیس n/a, پروجیکٹ/پروجیکٹس (13 shipped), سنگ میل
  (26 shipped), کنسول, راز (23 shipped — the shipped word for *secret*), ریموٹ n/a,
  نیٹ ورک (31 shipped). Plural inflections سیشنوں/کنسولوں/رازوں/علامتوں are
  permitted by the ur guide ("inflect where it reads naturally").
- **Script hygiene:** Urdu yeh U+06CC, keheh U+06A9, heh-goal U+06C1, heh-dochashmee
  U+06BE throughout; zero Arabic yeh/kaf/teh-marbuta; all NFC. Correct.
- **Width:** all ≤ 4 words / ≤ 22 chars; no value is close to an overflow that a
  narrow gutter would clip (no `maxCells` is declared for this group, so the
  1–4-word hint is the only budget; the list family is the longest and is already
  shipped at 5 tokens in the bridge row).
- **RTL/bidi:** no manual controls (correct — the layer isolates). The one Latin
  island, `ran_python` «Python چلایا» / «Python چلا رہا», is right: the technology
  name stays byte-identical (glossary §1), and Urdu's verb-final order puts the
  object first in logical order, which reads correctly in an RTL run ("Python
  ran"). No mirrored glyph, arrow, parenthesis or sigil appears in this group, so
  there is no bidi hazard to report. Base-direction flip is the only theoretical
  risk for that pair and it stays readable in either direction — checked, cleared.
- **Settled/running pairing:** every pair shares its verb root (checked pair by
  pair). The defect is aspect consistency (UR-A2), not root consistency.

---

## 4. Ledger / record status — handoff (not a gate waiver)

The canonical ledger writer is the UI repo's `scripts/i18n/ledger-assemble.mjs`
(`status: audited` + `auditors[]`, severity-count `findings`, receipts under
`i18n/receipts/`). It **cannot be run on this slice yet, by design of the tool**:
it refuses unless the receipt names the sha256 of the target catalogue **on disk**
and the locale file's key set matches English — and at `6c0b841872d8` the `ur`
catalogue does not contain these 182 keys (they are staged in `_l1-prep/ur.json`).

What I produced instead, alongside this report:

- `_l1-prep/receipt-ur-A.json` — receipt-shaped record (auditor/instance/model,
  the three input hashes, verdict `changes_requested`, findings with IDs), so the
  landing commit can bind it or re-derive from it.
- Audited bytes are named by hash above; they are the staged file's, not a
  catalogue's.

For the landing commit (manager/coder step, not mine — I do not edit translations):

```
node scripts/i18n/ledger-assemble.mjs --locale ur \
  --file src/i18n/catalogues/ur/ui.chat.canonical.json \
  --auditor-instance l1-au-ur-A --auditor-model deepseek/deepseek-flash \
  --result <what the receipt supports> --receipt <receipt naming catalogue hashes>
```

That row must be written **after** the remediated values land in the catalogue and
a fresh audit (round 2, scoped to the remediation diff and the direct regression
surfaces) binds the merged file's hashes. Recording `passed` now would be false:
`changes_requested` is the supported status until UR-A1..A4 are fixed.

---

## 5. Verdict

**blocked** — `changes_requested`.

counts: **{blocker: 0, major: 4, minor: 6, nit: 5}**

Top findings, in fix order:
1. **UR-A2 (MAJOR)** 26/91 running values are bare imperfectives («… فہرست دیتا») — habitual, not in progress; shipped verbs are 17/17 progressive. Fixing this and UR-A5 in one pass is the single biggest quality win in the file.
2. **UR-A3 (MAJOR)** *update* as «تازہ کیا» collides with shipped *refresh* (`اپ ڈیٹ` = update, 395 shipped strings; `تازہ` = refresh, 58) — 10 keys.
3. **UR-A4 (MAJOR)** *jobs* translated with the *todos* term «کاموں کی فہرست»; shipped jobs are «جاب/جابز» (incl. «جابز کی فہرست») — 6 keys.
4. **UR-A1 (MAJOR)** `reset` says «بحال» (the file's *resume* word); shipped `ur` says «ری سیٹ» — 2 keys.

Everything mechanical passes (key parity and order, no placeholders or ICU in this
group, no manual bidi, correct Urdu codepoints, all NFC, no stray English but the
sanctioned `Python`). The meaning of the tool/operation in `context.role` is
preserved for all 182 values, and the dangerous classes (destructive vs read-only
swap, broken placeholder, wrong negation) are absent. What fails is idiom and
terminology consistency against 8,872 already-shipped Urdu strings — which is
exactly what this gate exists to catch before the copy ships.
