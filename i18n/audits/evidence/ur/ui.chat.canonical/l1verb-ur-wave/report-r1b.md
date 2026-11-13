# L1 tool-row verbs — ur (RTL) — independent audit B

Auditor: i18n-auditor (l1-au-ur-B), model anthropic/claude-sonnet-5-5. Translator: openai/gpt-6.1-sol (session unknown). No edits made.
Inputs read: keys.json, ur.json, style-guides/ur.md, glossary.md, shipped ur ui.chat.canonical.json (tool_row.generic_verb.*, bridge.*), shipped ur catalogue for term usage.
**Verdict: blocked** — {blocker:1 (6 keys), major:3 (30 keys), minor:7, nit:4}

## Mechanical (python3, actually run)
- key set + order equal to keys.json: True (182). Empty values: none. English-identical: none.
- Latin script only in `Python` (ran_python.*) — allowed. Manual bidi/RLM/LRM/FSI/PDI chars: none. Punctuation chars in values: none. Max 4 words, max 22 chars: width OK.
- Settled/running pairs by suffix: every pair shares the same object noun and root verb EXCEPT the form issues below (26 running forms lack «رہا»).
- Different-English duplicates (identical Urdu for different English): none.

## BLOCKER
B1 — «گنوانا» = "to lose/squander" (its dominant meaning), used for "list". Reads as a destructive loss on a read-only op.
- listed_subagents.settled «ذیلی ایجنٹ گنوائے» / .running «ذیلی ایجنٹ گنوا رہا» → «ذیلی ایجنٹوں کی فہرست دی» / «ذیلی ایجنٹوں کی فہرست دے رہا»
- listed_networks.settled «نیٹ ورک گنوائے» / .running «نیٹ ورک گنوا رہا» → «نیٹ ورکوں کی فہرست دی» / «… دے رہا»
- listed_network_peers.settled «نیٹ ورک ساتھی گنوائے» / .running «نیٹ ورک ساتھی گنواتا» → «نیٹ ورک ساتھیوں کی فہرست دی» / «… دے رہا»
  (4 words max: fine). Elsewhere the file already uses «فہرست دی» for every other `list` op, so this is also an inconsistency.

## MAJOR
M1 — Running forms truncated to a bare habitual «-تا» (no «رہا»): «دیتا/کرتا/پڑھتا/بدلتا/لیتا/جوڑتا» read as habitual ("gives"), not progressive, and break the pair with the settled form and the shipped «رہا» pattern (generic_verb/bridge: «پڑھ رہا», «بھیج رہا»). 26 keys, all `*.running`:
 listed_variables «متغیرات کی فہرست دیتا», listed_agents, listed_teams, listed_secrets, listed_projects, listed_wakes, listed_jobs, listed_consoles, listed_symbols, listed_sessions (all «…کی فہرست دیتا») → «… کی فہرست دے رہا»;
 synced_agents «ایجنٹ ہم آہنگ کرتا» → «… کر رہا»; paused «عارضی طور پر روکتا» → «عارضی طور پر روک رہا»; described_secret «راز کی وضاحت کرتا» → «… کر رہا»; linked_session_to «سیشن کا ربط جوڑتا» → «… جوڑ رہا»; unlinked_session_from «… توڑتا» → «… توڑ رہا»; updated_milestone «سنگ میل تازہ کرتا» → «… کر رہا»; read_todos «کاموں کی فہرست پڑھتا» → «… پڑھ رہا»; updated_todos «… بدلتا» → «… بدل رہا»; read_network_log «نیٹ ورک لاگ پڑھتا» → «… پڑھ رہا»; invited_device «ڈیوائس کو دعوت دیتا» → «… دے رہا»; joined_network «نیٹ ورک سے جڑتا» → «… جڑ رہا»; captured_console «کنسول کی تصویر لیتا» → «… لے رہا»; resized_console «کنسول کا حجم بدلتا» → «… بدل رہا»; updated_secure_input «محفوظ ان پٹ بدلتا» → «… بدل رہا»; peeked_at_session «سیشن کی جھلک دیکھتا» → «… دیکھ رہا».
 Width note: «X کی فہرست دے رہا» is 4–5 words; if the gutter budget bites, the shortest safe alternative is «فہرست دکھا رہا» pattern (e.g. «ذیلی ایجنٹ دکھا رہا»/settled «ذیلی ایجنٹ دکھائے») — but keep settled/running on the same verb. «ذیلی ایجنٹوں کی فہرست دے رہا» (5 words) is the one case over the 1–4 hint; use «ذیلی ایجنٹ دکھائے»/«دکھا رہا» for B1 listed_subagents.
M2 — reset_agent «ایجنٹ بحال کیا/بحال کر رہا» ("restored") ≠ reset; shipped ur uses «بحال» for restore/unarchive (47×) and «ری سیٹ» for reset (32×), and this value is identical in verb to resumed/resumed_session — "reset" and "resume" read the same. → «ایجنٹ ری سیٹ کیا» / «ایجنٹ ری سیٹ کر رہا».
M3 — previewed_rename «تبدیلیٔ نام جھلکائی» / «تبدیلیٔ نام جھلکا رہا»: «جھلکانا» is rare/odd (not an established "preview" verb) and the hamza-izafat «تبدیلیٔ نام» is literary. → «ری نیم کا جائزہ لیا» / «ری نیم کا جائزہ لے رہا» (or «نام بدلنے کا جائزہ لیا», 4 words).

## MINOR
m1 — Three different verbs for "list": «فہرست بنائی» (listed/glob), «فہرست دی» (×14), «گنوائے» (B1). Recommend «فہرست دی» throughout except glob (file listing) where «فہرست بنائی» matches shipped bridge «گفتگوؤں کی فہرست بنائی» — acceptable.
m2 — linked_session_to / unlinked_session_from «سیشن کا ربط جوڑا/توڑا» followed by the monospace project: the "to"/"from" relation is carried only by جوڑا/توڑا; reads as "joined the session's link <name>". Suggest «سیشن پروجیکٹ سے جوڑا» / «سیشن پروجیکٹ سے الگ کیا» (+ running «… جوڑ رہا» / «… الگ کر رہا»).
m3 — read_todos / updated_todos «کاموں کی فہرست …» vs listed_jobs «کاموں کی فہرست دی»: different tools, identical object noun, differing only in verb. todos = «کاموں کی فہرست» is the shipped rendering (run_details.todos.title), so keep; consider listed_jobs → «پس منظر کے کاموں کی فہرست دی» (shipped «پس منظر کا کام») if width allows (6 words — too long; accept as-is and note).
m4 — typed_in_console «کنسول میں لکھا» collides with wrote «لکھا» and loses "typed". → «کنسول میں ٹائپ کیا» / «… ٹائپ کر رہا».
m5 — checked_network_status «نیٹ ورک جانچا» drops "status"; → «نیٹ ورک کی حالت جانچی» / «… جانچ رہا».
m6 — diagnosed_network «نیٹ ورک پرکھا» ("assessed") for `doctor`; → «نیٹ ورک کی تشخیص کی» / «… کر رہا».
m7 — steered «رہنمائی کی» ("gave guidance") is softer than redirecting a running agent; → «ہدایت دی» / «ہدایت دے رہا» (optional). Also searched_the_web.running «ویب پر تلاش جاری» and waited_for_jobs.running «کاموں کا انتظار جاری» use a noun+«جاری» pattern vs settled verb forms — pair is coherent in meaning and matches the shipped generic_verb «کال جاری/مکمل», so accepted.

## NIT
n1 found_definition «تعریف تلاش کی» — «تعریف» also means "praise"; fine in context of lsp (alt «ڈیفینیشن»).
n2 sent_keys «کلیدیں بھیجیں» — could read as cryptographic keys; «کی اسٹروک» alternative, low risk.
n3 listed_symbols «علامتوں» — fine; «سمبلز» is the tech-loanword alternative.
n4 raised_panic «ہنگامی بندش کی» — drops the word "panic"; acceptable given tool-name-in-object.

## Passed checks
Glossary: ایجنٹ, ذیلی ایجنٹ, پروجیکٹ, ٹیم, سیشن, شیڈول, بیداری (noun, per guide) all used correctly; no نشست; «آپ»-address N/A (verbs). Register: terse masculine-self «رہا» matches shipped pattern. Destructive ops preserved: deleted_* «حذف», cancelled «منسوخ», stopped «روکا» vs paused «عارضی طور پر روکا», removed «ہٹایا», left «چھوڑا» — correct. No stray English beyond Python. RTL: Urdu verb + Latin object order natural (verb at the RTL start); only `Python` as an LTR island at string start in ran_python.* (isolation handled by render layer; no manual bidi chars) — OK. Pair root-verb match holds for all 91 pairs.
