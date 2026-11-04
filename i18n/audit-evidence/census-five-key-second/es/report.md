# Spanish census — second independent delta audit

Verdict: passed, terminal. Five assigned keys reviewed; no BLOCKER/MAJOR/MINOR/NIT findings.

- `low/medium/high`: Bajo / Medio / Alto are native scale labels, masculine singular agreeing with esfuerzo/nivel. Capitalization matches menu context, labels remain distinct; measured Unicode codepoint lengths 4/5/4, no combining/wide-glyph hazard.
- `armed_count`: despertar/despertares follows glossary; activado(s) communicates an enabled scheduled follow-up, not completed delivery. one/many/other present. count is numeric selector, count_display string is printed without grouping in every branch. Tested 0, 1, 2, 1.5, 1000000, 1500000 plus deliberately different RAW display sentinel.
- `cadence_once`: una vez is idiomatic lowercase adverbial Spanish. Two words rather than English one-word hint is necessary and not a hard maxCells/maxChars violation; length 7, no supplied numeric cap.
- Display/wire boundary: session-model.ts effortDisplay uses keyed labels only; comments and callers preserve raw lowercase rungs. No changed wire values.
- Cadence consumers: run-detail-model.ts 1690 returns cadence_once for null interval, 1832 assigns wake cadence, 1934 supplies monitor one-shot interval; run-detail-wakes.tsx 189 prints row.cadence as its own segment. scheduled-task-model.ts 203–208 uses a separate keep_as_once key for null intervals; formatWakeCadence interpolation is only its non-null branch. Thus source-side example “Keep as once” is not an actual new once-interpolation path there. Lines 717–739 also handle one-time schedules separately before recurring cadence sentence templates. Unchanged recurring English duration wording is outside this five-key audit.

Execution: audit.log is actual node execution output; mechanical.json is machine results; this report is audit_notes_not_execution_log. Initial full-namespace context assertion failed on six unrelated ui.chat gaps; baseline and head gaps independently compared equal, then scoped validator rerun passed. Original failed log retained as audit-initial-namespace-probe.log.

Limits: no native application, pseudo/pixel, layout, measured cell geometry or full UI-completeness proof; no MT/translation service. No first-audit artifacts read. No repository or ledger writes; manager owns durable retention and append using this ONE byte-identical receipt across two rows.
