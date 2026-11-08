# Update-flow keying: translation and audit provenance (PR #1760)

Date: 2026-11-08. Branch `i18n/update-flow-keying`. English keys and the call-site
keying landed in `a71f64a822c`; this document covers the seven-locale translations
that were added in the same PR on top of it.

## Scope and limits (read first)

PR #1760 keys the update flow's remaining user-visible English and pairs the
translation in the same PR, so the coverage allowance is not grown for these keys
(`check-coverage` reports 0 allowed keys remaining). Three namespaces, 48 keys,
seven shipped locales (zh-CN, fr, es, ru, vi, hi, ur) give 21 ledger rows:

| Namespace | Keys |
| --- | --- |
| `ui.updates.service` | 38 |
| `ui.updates.status` | 3 |
| `ui.installer.setup_cause` | 7 |

**Labelled relayed, not verified here.** The translator and auditor identities,
the models they ran on and the order of events (including the hi revision below)
are relayed from the coordinating (manager) session's brief to the coder session
that assembled this PR. That coder session did **not** run, observe or re-execute
any translator or auditor session and did not verify which model actually
executed them. No translator job ids were supplied, so none are recorded. What
the coder session did verify, by reading and hashing files on disk:

- every receipt's recorded sha256 values for the target and English catalogues
  equal the bytes in the working tree at the time of the ledger write
  (`ledger-assemble` re-derives and refuses a mismatch; the session also hashed
  them independently before running it);
- instance, model string, status and finding severities as written in the seven
  receipts listed below; the counts in the audit table are counted from those
  files, not restated from the brief;
- the generated `keys.gen.ts` drift is caused only by the 21 new catalogue
  files (21 imports and 21 spreads, nothing else).

**Locale-wide.** The translator is recorded for each locale's run across the
three namespaces; the relayed record does not attribute individual keys. Ledger
`translator` fields: agent `translator`, model `anthropic/claude-sonnet-5-5`,
date `2026-11-08`. Each row's `translator.note` points here.

**Model identity.** Translators and auditors are recorded as
`anthropic/claude-sonnet-5-5` (translator agent `translator`, auditor agent
`i18n-auditor`). Each receipt self-reports that model; nothing here confirms
execution-time identity beyond the receipts' own claim.

**Independence.** The audits are separate sessions from the translators and the
receipts say the auditor authored none of the audited values (the vi receipt, and the new
zh-CN receipt, state this explicitly). One shared account means the file authors prove
nothing; this is the receipts' claim, relayed.

## Audits (one multi-namespace receipt per locale)

Each receipt audited all three namespaces of its locale in one run, so the three
rows of a locale cite the same receipt; they are not independent audits per
namespace. All statuses are `passed` (no blocker, no major). Finding counts come
from the receipts' `findings` arrays.

| Locale | Auditor instance | Receipt | `ui.updates.service` | `ui.updates.status` | `ui.installer.setup_cause` |
| --- | --- | --- | --- | --- | --- |
| `zh-CN` | `a4d27c58-uf2-zh-cn` | [`a4d27c58-uf2-zh-cn.json`](../../i18n/receipts/a4d27c58-uf2-zh-cn.json) | 8 minor, 1 nit | 0 findings | 4 minor |
| `fr` | `fd05d0c1-uf-fr` | [`fd05d0c1-uf-fr.json`](../../i18n/receipts/fd05d0c1-uf-fr.json) | 11 minor, 2 nit | 1 nit | 3 minor, 1 nit |
| `es` | `8048eb56-uf-es` | [`8048eb56-uf-es.json`](../../i18n/receipts/8048eb56-uf-es.json) | 5 minor, 1 nit | 0 findings | 1 minor |
| `ru` | `3f9a2c1d-uf-ru` | [`3f9a2c1d-uf-ru.json`](../../i18n/receipts/3f9a2c1d-uf-ru.json) | 7 minor, 2 nit | 0 findings | 1 minor, 2 nit |
| `vi` | `b7e41c09-uf-vi` | [`b7e41c09-uf-vi.json`](../../i18n/receipts/b7e41c09-uf-vi.json) | 1 minor, 2 nit | 0 findings | 0 findings |
| `hi` | `5d1b7e42-uf2-hi` | [`5d1b7e42-uf2-hi.json`](../../i18n/receipts/5d1b7e42-uf2-hi.json) | 3 minor, 1 nit | 0 findings | 1 nit |
| `ur` | `6f522c60-uf-ur` | [`6f522c60-uf-ur.json`](../../i18n/receipts/6f522c60-uf-ur.json) | 5 minor, 2 nit (+1 info) | 0 findings | 1 minor |

## What each wave fixed

- **First wave**: the seven locale translations of the 48 keys, audited as
  uncommitted working-tree files at `a71f64a822c`.
- **hi, one revision**: the first hi audit
  ([`c9399dc9-uf-hi.json`](../../i18n/receipts/c9399dc9-uf-hi.json),
  instance `c9399dc9-uf-hi`) returned `changes_requested` for
  `ui.updates.service` with 2 majors, 5 minors and 3 nits (`ui.updates.status`
  passed; `ui.installer.setup_cause` passed with 2 minors). The majors were
  `fleet.busy.lead` (the verb sat outside the plural block, so it rendered
  singular for every count, e.g. 'इस मशीन पर 5 सत्र अब भी काम कर रहा है', plus an
  'और # और' stutter) and `server_failure.target_fallback` (the fallback rendered
  'नया रिलीज़ पर', a gender-agreement error; रिलीज़ is feminine in the shipped
  locale). The translator revised hi, then a fresh independent audit read every
  key from scratch
  ([`5d1b7e42-uf2-hi.json`](../../i18n/receipts/5d1b7e42-uf2-hi.json),
  instance `5d1b7e42-uf2-hi`): no blocker/major, 3 minors and 1 nit in
  `ui.updates.service`, 1 nit in `ui.installer.setup_cause`. The ledger cites
  only the second receipt; the first is kept as superseded history because it
  described older bytes (the ledger tool would refuse it against the current
  files).
- **zh-CN, first receipt rejected and superseded**: the first zh-CN audit receipt (`7c3e91a4-uf-zh-CN`, a clean pass with minors and nits on the same bytes) carried a mixed-case `instance`. `ledger-assemble` refuses an instance outside `[a-z0-9_-]` as a placeholder, so no ledger row cites it and it is not committed. Receipts are immutable evidence, so it was not edited; a fresh, independent zh-CN audit was run instead, recorded as `a4d27c58-uf2-zh-cn`.
- **Other locales**: no blocker or major in the first audit, so no revision.
  Their minors and nits were not applied (see below).

## Accepted and deferred

Every minor and nit below is deferred: none changes meaning, placeholders,
plural shape or tokens, and the auditors passed the locale with them open. They
stay recorded in the receipts, which carry the proposed wording for each. Reasons
are the receipts' own, shortened. `info` entries (ur `message_minutes`: identical
plural branches are correct) require no change and are not listed.

### zh-CN

- minor `service.server_failure.not_run`: '运行到得出结论' is a word-for-word rendering of 'run to a verdict'
- minor `service.server_failure.stopped`: '启动的内容' (started content) is imprecise
- minor `service.install_not_found.message`: Glossary drift: shipped ui.common.updates renders 'this machine' as 本机 (45 uses catalogue-wide
- minor `service.fleet.unknown.credentials_refused`: Glossary drift: shipped ui.common.updates renders 'this machine' as 本机 (45 uses catalogue-wide
- minor `service.fleet.unknown.unreadable`: Glossary drift: shipped ui.common.updates renders 'this machine' as 本机 (45 uses catalogue-wide
- minor `service.fleet.busy.lead`: Glossary drift: shipped ui.common.updates renders 'this machine' as 本机 (45 uses catalogue-wide
- minor `service.global.source_build.remedy`: Glossary drift: shipped ui.common.updates renders 'this machine' as 本机 (45 uses catalogue-wide
- minor `service.global.source_rebuild.remedy`: Glossary drift: shipped ui.common.updates renders 'this machine' as 本机 (45 uses catalogue-wide
- nit `service.global.legacy_installer.remedy`: English 'interrupt sessions mid-turn' says the cut lands inside a turn
- minor `setup_cause.disk_full`: Glossary: the shipped installer panel renders 'setup' as 安装 (取消安装, 安装完成, 所有安装内容)
- minor `setup_cause.locked`: Same 设置 vs 安装 glossary drift against the shipped ui.installer panel.
- minor `setup_cause.file_missing`: Same 设置 vs 安装 glossary drift against the shipped ui.installer panel.
- minor `setup_cause.clock_or_expired`: '这台设备' vs shipped 本机 for 'this machine' (same drift as ui.updates.service).

### fr

- minor `service.attempt_running.message_unknown_age`: 'à un moment illisible' calques 'a time that could not be read'
- minor `service.attempt_running.message_moments`: 'une seconde' = 'a second (of time)' homograph
- minor `service.attempt_running.message_minutes`: Same 'une seconde' homograph, here next to a minutes count.
- minor `service.disk_space.message`: Rendered with free=1: '1 Mo seulement sont disponibles' (plural verb with 1
- minor `service.server_failure.not_run`: Calque of 'run to a verdict' ('verdict' is not idiomatic for an exit status) and glossary drift: shipped ui.common.updates renders 'installer' as 'ins…
- minor `service.server_failure.pointer_below`: Glossary drift: shipped ui.common.updates uses 'Sortie de l’installateur' for the same installer output block directly beneath this sentence.
- minor `service.server_failure.pointer_log`: Same installer glossary drift as pointer_below.
- minor `service.fleet.closing`: 'build' is 'compilation' in shipped ui.common.updates (e.g.
- minor `service.global.source_rebuild.remedy`: English is a third-person description
- minor `service.global.legacy_installer.remedy`: 'non disruptif' is a business-jargon calque of 'non-disruptive'
- nit `service.server_failure.stopped`: English says 'something it started'
- nit `service.server_failure.not_effective`: With a bare version the sentence reads 'vers 0.42.7'
- minor every key using `;` or `:`: Nearest shipped precedent ui.updates.panel (same failure panel) uses U+202F before every 
- nit `status.dev_mode.backend`: 1.37× the English length (49→67 chars) in a single-line snackbar
- minor `setup_cause.tls_interception`: 'this app already trusts that store' is a trust statement
- minor `setup_cause.clock_or_expired`: 'a lu ... comme' calques 'read ...
- nit `setup_cause.not_started`: 'démarrer' is the natural verb for a backend/service starting.
- minor every key using `;` or `:`: Same typography precedent as ui.updates.service (ui.updates.panel uses U+202F).

### es

- minor `service.attempt_running.message_unknown_age`: 'a su lado' is a word-for-word rendering of 'beside it'
- minor `service.attempt_running.message_moments`: Same calque of 'beside it'.
- minor `service.attempt_running.message_minutes`: Same calque of 'beside it'
- minor `service.server_failure.run_yourself`: 'tú mismo' hard-codes masculine gender for every reader
- minor `service.global.legacy_installer.remedy`: 'no disruptivo' is a calque of 'non-disruptive'
- nit `service.disk_space.message`: 'app … app' repetition in one clause
- minor `setup_cause.tls_interception`: Capitalised 'TI' directly after 'a' can be misread as 'a ti' (you)

### ru

- minor `service.attempt_running.message_unknown_age`: 'рядом с ним' is a calque of 'beside it' (a concurrent second run is 'параллельно')
- minor `service.attempt_running.message_moments`: Same calque of 'beside it' and same clumsy last-sentence order
- minor `service.attempt_running.message_minutes`: Same calque; plural branches one/few/many/other are correct (rendered 0,1,2,5,11,21,22,100,101 correctly) and unchanged.
- minor `service.disk_space.message`: 'MB' is Latin in a Cyrillic sentence (shipped ru is mixed: MB in ui.agents.avatar/settings, МБ in ui.settings.notifications
- minor `service.not_installed.message`: Same inversion of 'the environment serving this app'.
- minor `service.fleet.busy.body`: 'их' is plural but the lead sentence renders count=1 ('в 1 сессии'), so the pronoun disagrees with the sentence before it (rendered: 'Ход ещё выполняе…
- minor `service.global.legacy_installer.remedy`: 'non-disruptive' (does not interrupt sessions) is rendered 'неразрушающий' (non-destructive), which reads as a data-safety claim and sits oddly next t…
- nit `service.fleet.closing`: 'загруженной' also reads as 'downloaded'
- nit `service.global.source_build.remedy`: Source is singular ('your change is merged')
- minor `setup_cause.tls_interception`: 'не удалось проверить соединение… сеть его проверяет' reuses one verb for two different acts (verify vs inspect), so the cause reads as a contradictio…
- nit `setup_cause.clock_or_expired`: 'оператор индекса' is a calque of 'the index's operator'
- nit `setup_cause.file_missing`: 'Не хватило файла' is colloquial next to the calm technical register of the other causes.

### vi

- minor `service.global.legacy_installer.remedy`: "ghi lại" reads as 'record again'
- nit `service.disk_space.message`: Adds an emphasis ('only') the English does not state
- nit `service.server_failure.rebuild_unchanged`: 'bản sửa đổi' is not otherwise used in the shipped vi updates copy so it has no glossary precedent

### hi

- minor `service.release_unreadable.message`: 'को नहीं छेड़ा' (छेड़ना = tease/provoke) is a calque of 'left alone' and reads oddly for an environment
- minor `service.disk_space.message`: Same 'नहीं छेड़ा' calque as release_unreadable
- minor `service.global.legacy_installer.remedy`: 'अपडेट ऐप संभालता है' can be parsed as the compound noun 'update app' with a missing object
- nit `service.fleet.unknown.credentials_refused`: Shipped ui.common.connection renders 'refused/rejected credential' as 'अस्वीकार'
- nit `setup_cause.tls_interception`: English 'then retry' marks the sequence (certificate first, retry after)

### ur

- minor `service.disk_space.message`: 'سروس دینے والے' calques 'serving' and 'ایپ نے اس ایپ کو' repeats ایپ in one clause
- minor `service.server_failure.rebuild_unchanged`: Rendered with the UBA (fribidi, RTL paragraph) the leading '.' of the dotfile token is reordered to the END of the run, displaying `lop-source.`
- minor `service.global.source_rebuild.remedy`: 'آدھا گھنٹہ تک' is ungrammatical (postposition needs 'آدھے گھنٹے تک')
- minor `service.global.legacy_installer.remedy`: 'غیر خلل انداز' is a calque of 'non-disruptive' with no shipped precedent
- minor `service.fleet.unknown.body`: Shipped ui.common.updates / ui.settings render 'idle' as 'غیر فعال'
- nit `service.attempt_running.message_moments`: 'شروع کی ہوئی ... شروع ہوئی تھی' says 'started' twice and stacks relative clauses
- nit `service.fleet.unknown.credentials_refused`: Shipped ui.common.errors uses 'اسناد مسترد' for refused credentials
- minor `setup_cause.clock_or_expired`: 'پڑھا' calques 'read ...

## Open gates

These are static linguistic and mechanical audits (ICU rendered with
intl-messageformat at plural values 0, 1, 2, 5, 11, 21, 100 in the receipts that
say so). They are not native or pseudo-rendered fit sign-offs and do not clear any
locale. fr `status.dev_mode.backend` is flagged for a rendered width check
(1.37x the English length in a single-line snackbar). Ledger validation
(`audited` status) is not language completion.
