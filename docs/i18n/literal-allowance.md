# The literal allowance

`i18n/literal-allowance.json` is the debt file for user-visible strings the
i18n ratchet can see but nobody has keyed yet. It is enforced by
`scripts/i18n/check-strings.mjs`, and it is **shrink-only**: an entry can lose
ids, and adding one is a reviewed decision with a named owner and a real payoff.

## Why the shapes exist

`check-strings.mjs` counted JSX text and the copy-bearing JSX attributes. A
catalogue-only measure — and the ratchet it drove — was blind to copy that never
becomes either: a sentence in a data object that a component renders, or a
sentence inside braces as a JSX child. The scanner's own header listed those
blind shapes; nothing failed on them, so nothing was ever paid down.

Two shapes close that gap, both under `src/renderer/`:

- **`object-literal:<key>`** — a property whose name is in `OBJECT_COPY_KEYS`
  and whose value is static text: `{ label: "By turn" }`, a menu or command
  table, `{ summary: cond ? "A" : "B" }`. `OBJECT_COPY_KEYS` is the prose
  vocabulary of *data*, measured at its uses and deliberately narrower than
  `COPY_ATTRIBUTES`: this tree's `name` holds ids, `action` holds enums,
  `tooltip` holds `never`. Those stay component props and stay out of this set.
- **`jsx-child-expression`** — a child expression whose static text renders:
  `{cond ? "A" : "B"}`, ``{`Mark all ${n} read`}``, `{"A" + n}`. No `JsxText`
  node exists for it: the text lives inside braces.

A template is **one sentence and therefore one finding**, with its substitutions
elided (`` `Mark all ${n} read` `` → `Mark all ${…} read`). A conditional's two
arms are two sentences and stay two findings. The id is
`<shape> | <exact text>`, and the text is part of the identity on purpose: a
count would let one literal be swapped for a different one of the same shape and
still "fit".

## What it does not see, stated rather than implied

- **`src/main/` and `src/shared/` keep their object literals invisible.** Over
  those trees the same rules add ~330 findings, and the overwhelming majority are
  protocol validation messages, log lines and IPC error strings — the main
  process's vocabulary, which no extractor will key. `src/shared/backend-status.ts`
  is the sharpest gap this leaves: its `title`/`detail` prose *is* rendered in the
  renderer and this ratchet cannot see it. Widening the surface is a measured
  decision, not a patch.
- **A value that is a catalogue key is never a finding.** `{ label:
  "ui.hub.pages.sort.newest" }` is the keyed spelling and the component calls
  `t(value)` on it; flagging it would report keyed copy as debt.
- **Fixture files are excluded** (`x.fixtures.ts`, `x-fixtures.ts`,
  `x.fixture.ts`, `x-fixture.ts`), the same class as `.stories.`: they carry 37%
  of this tree's raw data-shape findings and nobody translates sample data.
- **Prose assembled by a function and passed through** (`label={describe(x)}`)
  is still invisible at the call site; its literals live wherever the helper
  builds them.
- **Two identical sentences in one file share one id.** Extracting the sentence
  is one decision, and the call sites are found from the same entry.

## How a finding is paid down

1. Extract the sentence through the catalogue (`src/i18n/catalogues/en/…`) and
   render it with `t("ui.…")` at the call site, as every other keyed site does.
2. Run `node scripts/i18n/check-strings.mjs --prune-allowance`. It removes every
   id that is no longer found and deletes entries left empty. **It cannot add**,
   by construction.
3. Commit the code change and the shrunk allowance together — the allowance diff
   is the receipt that the debt fell.

A string that genuinely must stay a literal (a Tailwind class under a copy key, a
file-kind token) takes an inline `// i18n: ignore <reason>` pragma on its own
line, exactly as an exempt JSX attribute does. The reason is the review.

## How the checker binds it

| Rule | Failure |
| --- | --- |
| A data-shape finding not listed for its file | FAIL — "not in i18n/literal-allowance.json" |
| A listed id no longer found | FAIL — the allowance can only shrink; run `--prune-allowance` |
| An id present in the head allowance but not the base (`--allowance-base <ref>`, CI's pull-request base, else `origin/main`) | FAIL — growth is a reviewed decision, never a check-fix |
| `schema` not 1, unknown/missing field, empty or unsorted or duplicate ids, an id naming a shape the allowance does not govern, a payoff that is neither a real ISO date nor a tracker key | FAIL — the file would otherwise read as attributed debt while carrying no plan |

The per-file ceilings in `i18n/baseline.json` are **not** used for these shapes.
The data shapes were added with `baseline.json` untouched, because a ceiling
counts findings a file is *allowed* to accumulate while this file names each one
and gives it an owner. A finding counted by both gates would be a finding nobody
can reason about: one gate would be satisfied by raising a number the other
refuses to see.

`--init --force` remains for the empty case (a reviewed scanner-coverage change
that genuinely starts from zero); it does not touch this file.

## What this debt is

At the commit that introduced the shapes, the renderer carried **127** data-shape
literals across **42** files, listed here with the owner
(`the i18n renderer-keying lane`) and the payoff date. The list is the audit: the
counts below are what the checker reported, not an estimate.

Paying an entry down is ordinary keying work and needs no discussion. Growing one
does.
