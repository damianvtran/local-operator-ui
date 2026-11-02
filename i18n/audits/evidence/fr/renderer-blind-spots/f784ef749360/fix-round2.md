# French sidebar remediation — round 2

Translator session: e09dd7897d52. Actual model: openai/gpt-6.1-sol (temporary fallback following provider quota failures; primary was anthropic/claude-sonnet-5-5).

Scope: `src/i18n/catalogues/fr/ui.chat.sidebar_view.json`; three existing values only. This is translator remediation, not an independent audit or rendered-fit verdict.

## FR-01 — accepted with French typography

Use `0 min` (U+202F narrow no-break space) in both `now` and fallback `other` arms of `relative_short`, replacing `à l’instant`. As compact elapsed-time sidebar metadata, zero elapsed minutes is natural and immediately legible in French, not a cryptic invented abbreviation. `min` is already the adjacent minute arm’s abbreviation; using its same spacing makes the sub-minute state consistent. It communicates a rounded elapsed time, not an exact zero-second timestamp. The longer accessible creation/activity sentences retain `à l’instant`, preserving their natural prose.

The replacement is five character cells (ASCII digit, one-cell U+202F, three ASCII letters), versus eleven for `à l’instant`, within the advisory six-cell budget. This is a linguistic/character-width judgement, not a claim about pixel fit; the parallel designer owns actual rendered-sidebar verification. Both `now` and `other` are changed so the same compact meaning stays consistent across selector fallback.

## FR-02 / FR-03 — accepted

French elides `de` before vowel-initial `heures` and `ans`: `d’heures`, `d’ans`. Use typographic U+2019 apostrophes as required by `i18n/style-guides/fr.md`, rather than the audit brief’s ASCII shorthand. Only the hour/year `many` arms change in each accessible sentence; every other arm stays byte-identical.

## Exact before/after values

### `ui.chat.sidebar_view.relative_short`

Before:
```text
{unit, select, now {à l’instant} minute {{count, number, ::group-off} min} hour {{count, number, ::group-off} h} day {{count, number, ::group-off} j} week {{count, number, ::group-off} sem} year {{count, number, ::group-off} an} other {à l’instant}}
```

After:
```text
{unit, select, now {0 min} minute {{count, number, ::group-off} min} hour {{count, number, ::group-off} h} day {{count, number, ::group-off} j} week {{count, number, ::group-off} sem} year {{count, number, ::group-off} an} other {0 min}}
```

### `ui.chat.sidebar_view.relative_created`

Before:
```text
{unit, select, now {créée à l’instant} minute {{count, plural, one {créée il y a # minute} many {créée il y a # de minutes} other {créée il y a # minutes}}} hour {{count, plural, one {créée il y a # heure} many {créée il y a # de heures} other {créée il y a # heures}}} day {{count, plural, one {créée il y a # jour} many {créée il y a # de jours} other {créée il y a # jours}}} week {{count, plural, one {créée il y a # semaine} many {créée il y a # de semaines} other {créée il y a # semaines}}} year {{count, plural, one {créée il y a # an} many {créée il y a # de ans} other {créée il y a # ans}}} other {créée à l’instant}}
```

After:
```text
{unit, select, now {créée à l’instant} minute {{count, plural, one {créée il y a # minute} many {créée il y a # de minutes} other {créée il y a # minutes}}} hour {{count, plural, one {créée il y a # heure} many {créée il y a # d’heures} other {créée il y a # heures}}} day {{count, plural, one {créée il y a # jour} many {créée il y a # de jours} other {créée il y a # jours}}} week {{count, plural, one {créée il y a # semaine} many {créée il y a # de semaines} other {créée il y a # semaines}}} year {{count, plural, one {créée il y a # an} many {créée il y a # d’ans} other {créée il y a # ans}}} other {créée à l’instant}}
```

### `ui.chat.sidebar_view.relative_active`

Before:
```text
{unit, select, now {dernière activité à l’instant} minute {{count, plural, one {dernière activité il y a # minute} many {dernière activité il y a # de minutes} other {dernière activité il y a # minutes}}} hour {{count, plural, one {dernière activité il y a # heure} many {dernière activité il y a # de heures} other {dernière activité il y a # heures}}} day {{count, plural, one {dernière activité il y a # jour} many {dernière activité il y a # de jours} other {dernière activité il y a # jours}}} week {{count, plural, one {dernière activité il y a # semaine} many {dernière activité il y a # de semaines} other {dernière activité il y a # semaines}}} year {{count, plural, one {dernière activité il y a # an} many {dernière activité il y a # de ans} other {dernière activité il y a # ans}}} other {dernière activité à l’instant}}
```

After:
```text
{unit, select, now {dernière activité à l’instant} minute {{count, plural, one {dernière activité il y a # minute} many {dernière activité il y a # de minutes} other {dernière activité il y a # minutes}}} hour {{count, plural, one {dernière activité il y a # heure} many {dernière activité il y a # d’heures} other {dernière activité il y a # heures}}} day {{count, plural, one {dernière activité il y a # jour} many {dernière activité il y a # de jours} other {dernière activité il y a # jours}}} week {{count, plural, one {dernière activité il y a # semaine} many {dernière activité il y a # de semaines} other {dernière activité il y a # semaines}}} year {{count, plural, one {dernière activité il y a # an} many {dernière activité il y a # d’ans} other {dernière activité il y a # ans}}} other {dernière activité à l’instant}}
```

## Verification and limits

Read the English catalogue and context sidecar, French catalogue, core French style guide/glossary, UI i18n contributor HOWTO and applicable AGENTS guidance. JSON parsed successfully before and after; key order and all other values are unchanged; output matches tab-indented canonical JSON with a final newline. The file was read back and its full contents matched the in-memory result. No translation service used. No glossary proposals or unresolved linguistic ambiguity.

No generator, package manager, build, tests, catalogue validator or git command was run, per the explicit task restriction. Independent post-fix audit and rendered verification remain with the manager’s independent audit/design lanes; no audit ledger or passed status was written.
