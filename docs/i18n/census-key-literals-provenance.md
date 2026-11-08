# Keyed chat census strings: translation and audit provenance (PR #1753)

Date: 2026-11-08. Branch `i18n/key-census-literals`; English keys added in
`874446c2c80`, first translations in `dab70a8e114`.

## Scope and limits (read first)

PR #1753 keyed 86 English strings that the rendered census found and
translated them into seven locales (zh-CN, fr, es, ru, vi, hi, ur). The keys
sit in seven namespaces, so the ledger carries 49 rows (7 locales x 7
namespaces) that this PR changed:

| Namespace | Keys added by this PR |
| --- | --- |
| `ui.chat.asks` | 8 |
| `ui.chat.canonical` | 55 |
| `ui.chat.pickers` | 8 |
| `ui.chat.run_details` | 2 |
| `ui.chat.sidebar` | 7 |
| `ui.chat.user_turn` | 3 |
| `ui.hub.pages` | 3 |

Counts are the ones stated in each row's auditor `scope`; they sum to 86.

**Labelled relayed, not verified here.** Every identity, job id, finding count
and model name below is relayed from the coordinating (manager) session's
briefs and launch records. The coder session that wrote this addendum
(`fb174ff8bfeb`) did **not** run, observe or re-execute any of these
translator or auditor sessions and did not verify which model actually
executed them. What this session did verify is limited to:

- the final auditor receipts in `i18n/receipts/` and the ledger rows that cite
  them (instance, model string, result, finding counts were read from those
  files);
- the job id -> label -> session id mapping, derived by reading the manager
  session's task-launch records (job id, label, agent, launch model) and the
  `label` field of each subagent session's `origin.json`. No transcript was
  read beyond locating those launch records.

**Locale-wide, not per-namespace.** The translator of a locale is recorded for
the locale's whole run across all seven namespaces. The relayed record does not
attribute individual namespaces or keys to a translation job, and this
addendum does not invent that attribution. Each ledger row's `translator`
object keeps its prior content (baseline and earlier-PR provenance, including
`ui.chat.canonical`'s earlier multi-pass note); the PR #1753 identities are
identified only by a pointer to this document in `translator.note`. The
ledger's `translator.model` / `agent` / `date` values are unchanged.

**Model identity.** All translator and auditor jobs were launched as
subagents on the manager session's model, `anthropic/claude-sonnet-5-5`
(launch records show `model_selection_source: parent`; no fallback was
reported). That is the launch-time model recorded by the manager; this session
did not confirm execution-time identity. The final auditor receipts
self-report `anthropic/claude-sonnet-5-5` and the ones read for this document
state that no fallback was reported or used; that is the auditor's own claim.

## Translators (relayed; job id resolved to session id where possible)

Agent for all rows: `translator`. Model at launch: `anthropic/claude-sonnet-5-5`.

| Locale | First wave: job -> session | Post-audit fix: job -> session |
| --- | --- | --- |
| fr | `0914e11030a8` -> `d0cfee435764` (`ui1753-fr`) | `16f6c075eca2` -> `3aba7c202541` (`ui1753fix-fr`) |
| es | `d47c673e2ce4` -> `a4af2093a838` (`ui1753-es`) | `1a45306f2987` -> `c7fada526815` (`ui1753fix-es`) |
| zh-CN | `8bfb42408a7d` -> `7c86bf0bcccb` (`ui1753-zh-CN`) | `488503fb2caa` -> `32f947ea8db1` (`ui1753fix-zh-CN`) |
| ru | `7f1dd6ec1bbf` -> `b37f8773320f` (`ui1753-ru`) | `612aad04981f` -> `5e02250d2ed8` (`ui1753fix-ru`) |
| vi | `123c94cccc45` -> `91240259ef0c` (`ui1753-vi`) | `5cb11a915211` -> `c8e014883212` (`ui1753fix-vi`) |
| hi | `34bc8c5b867c` -> `dbc368f70792` (`ui1753-hi`) | `d866cbff3a50` -> `5950bbb5ce35` (`ui1753fix-hi`) |
| ur | `007aaead4e4e` -> `961f29d56288` (`ui1753-ur`) | `49c7ec4bab12` -> `3a2ea2f850fe` (`ui1753fix-ur`) |

Stamp fixes (the `ui.chat.user_turn` "sent/answered/ran at" stamps, which
repeated the date connector in hi and vi):

| Locale | Job -> session |
| --- | --- |
| hi | `91adb6a818a3` -> `9f1c7adf9c9a` (`ui1753fix-hi-stamp`) |
| vi | `d6bc9801978b` -> `313ff982da5e` (`ui1753fix-vi-stamp`) |
| vi | `aca5f672ceb8` -> `fb88d6f72b97` (`ui1753fix-vi-stamp2`) |

Every job id above resolved to exactly one session; none is "job id only".

## Audit chain (relayed)

All auditors are agent `translation-auditor`, launched on
`anthropic/claude-sonnet-5-5`. Findings are `{blocker, major, minor, nit}`.

1. **Round-1 audits** of the first-wave translations.

   | Locale | Job -> session | Findings | Verdict |
   | --- | --- | --- | --- |
   | fr | `19cd76852a52` -> `d7d13ae8c1d8` | {0,0,3,4} | pass |
   | es | `5166ce1c5b88` -> `6e09beeec957` | {0,0,1,3} | pass |
   | zh-CN | `dd1c719680b7` -> `e6c67290f3ef` | {0,1,4,5} | fail |
   | ru | `f5f024d1759c` -> `09ee9c89de09` | {0,2,3,2} | fail |
   | vi | `dd90448fa3ac` -> `3aeef12a11e5` | {0,1,6,5} | fail |
   | hi | `1184f82f559d` -> `c9a1a4b454a6` | {0,0,1,6} | pass |
   | ur | `ae592ecba6a9` -> `34601ca54069` | {0,1,5,4} | fail |

2. **Post-audit fix wave**: the seven fix translators above, one per locale
   (the passing locales fr/es/hi also took their accepted minors and nits).

3. **Delta re-audits** of the fixes. Finding counts for these were not relayed
   and are not recorded here.

   | Locale | Job -> session |
   | --- | --- |
   | zh-CN | `679ae783a3f4` -> `a7ad086141c3` (`reaudit-ui1753-zh-CN`) |
   | ru | `9e15f5c47676` -> `e44bdcfcf82e` (`reaudit-ui1753-ru`) |
   | vi | `69e4d2e6cf4d` -> `4190efcc7818` (`reaudit-ui1753-vi`) |
   | ur | `e2a907711a31` -> `207ff3e5f79b` (`reaudit-ui1753-ur`) |
   | fr, es, hi (one combined audit) | `4a77a691a861` -> `588ef7ab7ea5` (`reaudit-ui1753-fr-es-hi`) |

4. **Final audits** at the committed bytes. These are the receipts the ledger
   cites; they replace the round-1 and delta audits as the repo record. Every
   result below was read from the receipt-backed ledger rows.

   | Locale | Final auditor instance (session) | Receipt | Row results |
   | --- | --- | --- | --- |
   | fr | `6ff7a7a1f3b4-ui1753-fr` | [`6ff7a7a1f3b4-ui1753-fr.json`](../../i18n/receipts/6ff7a7a1f3b4-ui1753-fr.json) | all 7 rows clean, 0 findings |
   | es | `78c4c8dbce2e-ui1753-es` | [`78c4c8dbce2e-ui1753-es.json`](../../i18n/receipts/78c4c8dbce2e-ui1753-es.json) | `canonical` clean-with-findings (1 nit); other 6 rows clean, 0 findings |
   | zh-CN | `7d3d4a9a80a4-ui1753-zh-cn` | [`7d3d4a9a80a4-ui1753-zh-cn.json`](../../i18n/receipts/7d3d4a9a80a4-ui1753-zh-cn.json) | `hub.pages` clean-with-findings (1 nit); other 6 rows clean, 0 findings |
   | ru | `05dd4fa2b221-ui1753-ru` | [`05dd4fa2b221-ui1753-ru.json`](../../i18n/receipts/05dd4fa2b221-ui1753-ru.json) | all 7 rows clean, 0 findings |
   | vi | `200a953fa085-ui1753-vi` | [`200a953fa085-ui1753-vi.json`](../../i18n/receipts/200a953fa085-ui1753-vi.json) | `canonical` clean-with-findings (2 nits); `asks`, `pickers`, `run_details`, `sidebar`, `hub.pages` clean (`user_turn` is covered by the stamp-fix audit below) |
   | hi | `050f568ab597` | [`050f568ab597.json`](../../i18n/receipts/050f568ab597.json) | `canonical` 2 nits, `pickers` 2 minors, `run_details` 1 minor, `asks`, `sidebar`, `hub.pages` clean (`user_turn` is covered by the stamp-fix audit below) |
   | ur | `ab407cfa3e46-ui1753-ur` | [`ab407cfa3e46-ui1753-ur.json`](../../i18n/receipts/ab407cfa3e46-ui1753-ur.json) | `canonical` 1 minor + 1 nit, `pickers` 1 minor, `run_details` 1 minor, other 4 rows (incl. `user_turn`) clean, 0 findings |

   Stamp-fix audits, covering `ui.chat.user_turn` only for hi and vi (the
   stamp fix landed after those locales' final audits, so the ledger cites
   these receipts for that one namespace):

   | Locale | Auditor instance | Receipt | Result |
   | --- | --- | --- | --- |
   | hi | `0e5b8e88d94d-ut-hi` | [`0e5b8e88d94d-ut-hi.json`](../../i18n/receipts/0e5b8e88d94d-ut-hi.json) | clean, 0 findings |
   | vi | `d72e2ab29486-ut2-vi` | [`d72e2ab29486-ut2-vi.json`](../../i18n/receipts/d72e2ab29486-ut2-vi.json) | clean, 0 findings |

   The vi stamp took two translator attempts (`d6bc9801978b`, then
   `aca5f672ceb8`). An auditor (`c5c351187aed-ut-vi`) returned
   `changes_requested` on the first attempt; the receipt was written by the
   auditor, is not ledgered and is not committed in this PR (the current bytes
   superseded it). The
   `-ut2-` audit above is the one the ledger cites.

   Where several rows cite one receipt, that is one multi-namespace audit, not
   independent audits per namespace.

## What each wave fixed (relayed, with the repo commits that carry it)

- **First wave** (`dab70a8e114`): the seven locale translations of the 86 keys.
- **Post-audit fixes**: each audit-failing locale (zh-CN, ru, vi, ur) was
  corrected for its blocker/major and minor findings; fr, es and hi took their
  accepted minors and nits. Finding-by-finding detail lives in the auditor
  receipts and the delta re-audit sessions listed above, not restated here.
- **Renderer follow-ups found during the audit** (code, not translation):
  `c7395d796fc` and `15749351106` give fold count units the locale direction
  and isolate the tooltip only for right-to-left locales; `90ebc747456` shows
  the whole archived-chats hint in longer locales.
- **Stamp fixes** (`e940eaeb251`): hi and vi turn stamps no longer repeat the
  date connector.

## Accepted and deferred (relayed)

- **ur, slash-command bidi**: the bidirectional rendering of slash commands in
  Urdu is renderer-level and follows the same pattern as already-shipped copy.
  Accepted, not changed in the catalogue.
- **ur, todo number-binding**: minor; deferred.
- **hi, minors** on the term for "insert": deferred.
- **es and ru width observations**: recorded as observations; no fit
  sign-off.
- **M3, en-GB `hour12` behaviour change**: noted; a behaviour change, not a
  translation defect.
- **`foldSummary` tooltip joiners**: deferred.

## Open gates

These are static linguistic/mechanical audits. They are not native or
pseudo-rendered fit sign-offs and do not clear any locale. Ledger validation
(`audited` status) is not language completion.
