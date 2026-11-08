#!/usr/bin/env node
/**
 * The i18n ratchet for hardcoded user-facing strings (RFC §2.7, TS half).
 *
 * WHAT IT FLAGS, precisely — JSX text, the copy-bearing JSX attributes, and
 * (on the renderer surface, see below) the two data-object shapes that reach
 * the screen without ever being a JSX attribute: a copy-keyed object literal
 * and a JSX child expression. All found through the REAL TypeScript compiler
 * rather than a regex:
 *
 *   - `JsxText` nodes whose text contains a letter (whitespace-only,
 *     punctuation-only — `·`, `—` — and digit-only texts are ignored);
 *   - a JSX attribute named in `COPY_ATTRIBUTES` whose value carries English
 *     letters, in EITHER spelling: a literal (`label="Run details"`) or an
 *     expression whose static text reaches the screen (`label={cond ? "A" :
 *     "B"}`, `label={`Open ${name}`}`, `label={a ?? "B"}`, `label={"A" + b}`).
 *     Only the literal pieces count — a call such as `t("ui.x")` or a bare
 *     identifier exposes no static text, which is exactly what a keyed site
 *     looks like;
 *   - an OBJECT LITERAL property whose name is in `OBJECT_COPY_KEYS` and whose
 *     value is static text (`{ label: "By turn" }`, a menu/command/tour table,
 *     `{ title: cond ? "A" : "B" }`). This is the shape that hid a whole
 *     display vocabulary from the attribute rule: nothing in `{ running:
 *     "Running" }` is a JSX prop, so nothing looked;
 *   - a JSX CHILD expression whose static text renders (`{cond ? "A" : "B"}`,
 *     `{`Mark all ${n} read`}`, `{"A" + n}`). `JsxText` could never see it:
 *     the text lives inside braces, in an expression, not in a text node.
 *
 * WHERE THE DATA SHAPES APPLY, and why it is a surface rather than the whole
 * tree: `OBJECT_COPY_KEYS`/JSX-child are enabled under `src/renderer/` only.
 * Measured on the tree this landed against, the same rules over `src/main` and
 * `src/shared` add ~330 findings that are protocol validation messages, log
 * lines and IPC error strings — the main process's own vocabulary, not UI copy
 * — and a debt file three times its real size is a debt nobody pays. The gap
 * that leaves is stated in KNOWN BOUNDARIES, not implied.
 *
 * A TEMPLATE IS ONE SENTENCE, so the data shapes report it as ONE finding with
 * its substitutions elided (`Mark all ${…} read`), while a conditional's arms
 * are separate sentences and report one finding each. `staticTextNodes` (shared
 * with `check-added-strings.mjs`) keeps its per-piece contract for attributes;
 * `copyTexts` below is the finding-level renderer for these shapes. Two
 * functions rather than one flag, because the added-line guard counts pieces
 * and this counts sentences — the difference IS the fix, so it should not be
 * hidden behind a boolean.
 *
 * `COPY_ATTRIBUTES` is the measured list of props that carry prose (the
 * native four — `aria-label`, `placeholder`, `title`, `alt` — plus the design
 * system's own prose props: tooltip `content`, panel `label`/`closeLabel`,
 * form-field `description`/`helperText`/`busyLabel`/`saveLabel`/`dirtyHint`,
 * and so on). A prop is added only after reading what its component does with
 * the value: class names, ids, enum values, search terms and test ids are
 * tokens, never prose, and stay off the list. A prop that is prose on one
 * component and a token on another is flagged and the token site takes an
 * `// i18n: ignore <reason>` pragma, so the reason is on the line.
 *
 * KNOWN BOUNDARIES, stated rather than implied (the core checker's own
 * docstring has the same section, and for the same reason — a false negative
 * nothing reports is the one outcome this file must not quietly produce):
 *
 *   - Plain object literals and JSX child expressions ARE counted now, but only
 *     under `src/renderer/`. `src/main/` and `src/shared/` keep their object
 *     literals invisible (protocol validation text, IPC errors, log lines); a
 *     main-process dialog or notification string is still caught by nothing in
 *     this file. `src/shared/backend-status.ts` is the sharpest example: its
 *     `title`/`detail` prose IS rendered in the renderer, and it sits outside
 *     this ratchet's data shapes. Fixing that means widening the surface, which
 *     is a measured decision (see the ~330 finding figure above), not a patch.
 *   - A copy key that is prose in a component and a token in data (this tree's
 *     `tooltip: "never"`, `empty: "text-ink-muted"`, `content: "min-w-0"`,
 *     `name: <id>`, `action: <enum>`) is listed in `OBJECT_COPY_KEYS` only if
 *     its measured uses are prose. The key set is the prose vocabulary of the
 *     DATA, not the union of every prose-named prop — the two vocabularies
 *     overlap and are not the same.
 *   - A TEMPLATE in a plain `const X = …`, `return …` or array-literal element
 *     is NOT counted by this file, on either surface. Measured at this head,
 *     `src/renderer` carries 234 such templates with a letter in 108 files, and
 *     169 of them also hold two alphabetic words separated by whitespace — and
 *     most of both sets is machine text (`tool:${…}`, `/v1/agents/${…}/avatar`,
 *     `${…} KB`, `calc(…)`, `@keyframes …`). Listing them would put machine
 *     text in a debt ledger whose whole design (`OBJECT_COPY_KEYS`, below) is
 *     to keep machine text out of it, and no predicate this scanner owns
 *     separates the two classes in that position: there is no key vocabulary
 *     to appeal to. That shape is therefore the ONE the ratchet leaves to the
 *     diff guard: `check-added-strings.mjs` counts a template in
 *     `const`/`return`/array position on an ADDED line under `src/renderer`
 *     (the `template:` sinks), so new copy of that shape cannot land, and the
 *     historical 234 stay outside the allowance — a stated gap rather than a
 *     silent one.
 *   - A prop that is not in `COPY_ATTRIBUTES` is invisible. Adding a prose
 *     prop to a component is a reason to add its name here.
 *   - Prose assembled by a function and passed through (`label={describe(x)}`)
 *     is not counted at the attribute; its literals live in the helper, which
 *     is an object-literal/helper site under the first bullet.
 *   - Main-process strings (native dialogs, OS notifications) are outside
 *     `src/renderer` toast paths and are not counted here.
 *
 * THE RATCHET, mirroring `local-operator/scripts/i18n/check.py`:
 *
 *   - EVERY finding fails. There is no advisory scope: a ratchet that reports
 *     a breach without failing on it is a gate in name only (this file shipped
 *     that way once, and the operator measured it).
 *   - `i18n/baseline.json` carries per-file counts that may only stay equal or
 *     go down. `--init` writes it once (the capture of the tree as it stands);
 *     `--update <paths>` lowers entries and refuses to raise them.
 *   - A file with counted literals and NO baseline entry FAILS. Every new file
 *     would otherwise arrive exempt — "absent from the baseline" is the
 *     default state of a file anyone adds — so an absent entry can only mean
 *     "nobody recorded a ceiling for this file"; the fix is a reviewed
 *     `--init --force` capture, not silence. (A zero-literal file needs no
 *     entry; `--init` prunes those.)
 *   - `i18n/allowlist.json` exempts a file (or a directory prefix ending in
 *     `/`) with a REQUIRED reason; no globs (a glob silently spans
 *     directories; a directory is written as one, visibly).
 *   - `// i18n: ignore <reason>` (or the JSX-comment spelling
 *     `{/* i18n: ignore <reason> *​/}`) exempts a literal on its own line, and
 *     the NEXT line when the pragma stands alone on its own line. That is ONE
 *     rule, and it is stated in exactly one place — `pragmaCoveredLines` below,
 *     which `check-added-strings.mjs` imports rather than keeping a second
 *     reading.
 *
 *     ONE RULE BECAUSE TWO DISAGREED. The diff guard narrowed its reading to
 *     the literal's own line and the ratchet kept the element-wide one, so the
 *     same pragma exempted copy in one gate and charged it in the other:
 *     `agent-detail.tsx`'s `"inherit"` is annotated by a JSX comment written
 *     ABOVE the element, which the ratchet honoured and the narrowed diff guard
 *     did not. Both shapes this tree actually writes are covered — the trailing
 *     comment on the literal's line, and the annotation-above — while an
 *     enclosing element's whole span is NOT, because that reading let one
 *     glyph's reason silence its siblings: `slash-commands.tsx`'s `[x]` pragma
 *     also covered the `[ ]` arm one line below it (review M1/Q-2 on #1767).
 *
 *     An object-literal property needs no special case: its own line is already
 *     covered, which is the trailing comment on the property.
 *   - `i18n/literal-allowance.json` governs the data shapes INSTEAD of the
 *     baseline: one exact id per distinct `<kind> | <text>` (two identical
 *     sentences in one file share one id, which is what the writer emits), an
 *     owner, a
 *     payoff, and a base-ref growth check. A finding not listed FAILS and a
 *     listed id that is gone FAILS, so the file can only shrink — the debt is
 *     named and owed, never exempt. `--prune-allowance` is its one writing
 *     mode. See `docs/i18n/literal-allowance.md`.
 *   - Those two exemptions are the whole exemption surface: there is no scope
 *     list, no glob, and no severity that reports a breach without blocking it.
 *
 * THE COMPILER API, and why this file is the only place it is touched: this
 * repository's `typescript` is the native TS 7, whose programmatic surface is
 * `typescript/unstable/*` (the classic `ts.createSourceFile` no longer exists
 * in its package). `check-strings.test.mjs` drives every branch of this file
 * on fixtures that live in `scripts/i18n/fixtures/` — which are excluded from
 * the scan itself, exactly because they exist to be flagged.
 *
 * USAGE:
 *   node scripts/i18n/check-strings.mjs             # check (exit 1 on failure)
 *   node scripts/i18n/check-strings.mjs --init      # write the baseline once
 *   node scripts/i18n/check-strings.mjs --update <path>…   # lower ceilings
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

/* The payoff contract (an ISO date or a tracker key) is already enforced for
 * the coverage allowance; a second copy of the regex pair is a second thing to
 * get wrong, and the two gates must agree on what a promised payoff looks like.
 * `check-coverage.mjs` exports it and does nothing at import time. */
import { isPayoff } from "./check-coverage.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const BASELINE = join(REPO, "i18n", "baseline.json");
export const ALLOWLIST = join(REPO, "i18n", "allowlist.json");
export const LITERAL_ALLOWANCE = join(REPO, "i18n", "literal-allowance.json");

/**
 * The scanned corpus, repo-relative. `scripts/i18n/` is scanned because the
 * tooling must not grow user-visible prose of its own.
 * `scripts/i18n/fixtures/` is EXCLUDED — those files exist to be
 * flagged by the tests, and they live outside the scan for exactly that
 * reason (the exclusion is asserted by `check-strings.test.mjs`).
 */
export const SCAN_ROOTS = ["src", "scripts/i18n"];
const SCAN_EXCLUDED = ["scripts/i18n/fixtures/"];

export const BASELINE_NOTE =
	"per-file literal ceilings (shrink-only). A file with counted literals and no " +
	"entry FAILS; a zero-literal file carries no entry and --init prunes it. " +
	"Add or raise an entry only through a reviewed `--init --force` capture. " +
	"See scripts/i18n/check-strings.mjs.";

/**
 * The copy-bearing JSX attributes.
 *
 * The first four are native HTML attributes the RFC's inventory measured. The
 * rest are PROPS of this repository's own components whose value is rendered
 * as prose (each was read at its component before being listed):
 *   - `label` / `closeLabel` / `ariaLabel` / `srLabel` / `triggerLabel` /
 *     `actionLabel` / `busyLabel` / `pendingLabel` / `saveLabel`: control and
 *     region names, visible or accessible;
 *   - `content`: the Tooltip body;
 *   - `description` / `helperText` / `hint` / `meaning` / `what` / `empty` /
 *     `emptyText` / `listNotice` / `dirtyHint` / `blockedReason`: sentences
 *     under, beside or in place of a field;
 *   - `titleText` / `summary` / `header` / `verb` / `text`: headings, disclosure
 *     summaries, code-block headers, status verbs and notice bodies.
 */
export const COPY_ATTRIBUTES = new Set([
	"aria-label",
	"placeholder",
	"title",
	"alt",
	"label",
	"content",
	"description",
	"closeLabel",
	"busyLabel",
	"titleText",
	"helperText",
	"saveLabel",
	"dirtyHint",
	"text",
	"verb",
	"summary",
	"ariaLabel",
	"actionLabel",
	"pendingLabel",
	"blockedReason",
	"empty",
	"emptyText",
	"header",
	"hint",
	"listNotice",
	"meaning",
	"what",
	"srLabel",
	"triggerLabel",
]);

/**
 * The copy-bearing property names of DATA objects — the object-literal half.
 *
 * DERIVED FROM THIS TREE, not copied from `COPY_ATTRIBUTES`, because the two
 * vocabularies only overlap. Measured over `src/renderer` (the shape's surface,
 * see the module docstring) at the commit that introduced this set. Each key
 * below was read at its uses, and the count is FINDINGS — one per rendered
 * sentence, which is what the allowance lists — not occurrences of the
 * property name:
 *
 *   - `label` 16, `text` 11, `message` 9, `description` 4, `detail` 4,
 *     `title` 1, `cancel` 1 — prose in every measured use;
 *   - `confirm`, `heading`, `placeholder`, `caption`, `summary`, `ariaLabel`,
 *     `hint` — 0 findings on this tree today, listed because a data key
 *     with that name is prose by definition; a token under one of them is the
 *     case the `i18n: ignore <reason>` pragma exists for.
 *
 * DELIBERATELY ABSENT, each measured as what adding the key would report at
 * this head: `action` 106 (enums such as `reauth`/`none`), `name` 99 (ids and
 * storage keys such as `agent-messages-onboarding`/
 * `canonical-sessions-storage`), `content` 2 (class names), `tooltip` 1
 * (`never`), `empty` 1 (`text-ink-muted`), `noun` 0 — tokens in the uses that
 * matter, so they stay in `COPY_ATTRIBUTES` (as a component PROP each renders
 * the value) and out of this set, because as a data KEY each names a token
 * here. A prop that becomes prose in data is a reason to add its name here,
 * exactly as a new prose prop is a reason to add it above.
 *
 * `verb` is the one key whose absence is a GAP rather than a token judgement,
 * and it is named rather than rounded away: it would add 27 findings, 25 of
 * them the trace-verb table in `trace-labels.ts` (`Read`, `Wrote`, `Ran code`,
 * `Delegated work`). That table is real copy and keying it is its own slice of
 * the lane; in the meantime it is invisible to BOTH gates, because `verb` is in
 * neither this set nor `COPY_PROPERTIES` in `check-added-strings.mjs`.
 *
 * The measurement behind every number above, run from the repository root:
 *
 *   node --input-type=module -e 'import("./scripts/i18n/check-strings.mjs").then(m=>{const r=m.runCheck();const n=new Map();for(const fs of r.scanned.values())for(const f of fs)if(m.governedByAllowance(f.kind))n.set(f.kind,(n.get(f.kind)??0)+1);console.log([...n].sort().join("\n"))})'
 *
 * — one `<count>\t<shape>` line per key. The "would add" counts for the absent
 * keys are that command with `m.OBJECT_COPY_KEYS.add("name")` in front of
 * `runCheck()` (one key per scratch run; adding several at once would count the
 * shared files, not each key).
 */
export const OBJECT_COPY_KEYS = new Set([
	"label",
	"title",
	"message",
	"description",
	"detail",
	"text",
	"cancel",
	"confirm",
	"heading",
	"placeholder",
	"caption",
	"summary",
	"ariaLabel",
	"hint",
]);

/**
 * The surface the data shapes (object literal, JSX child) are enabled on.
 *
 * `src/renderer/` is where copy is painted. The main process has prose too, but
 * it is interleaved with protocol/log/IPC text that no extractor will ever key,
 * and the measured ratio (~330 extra findings, most of them machine text) is
 * what makes a renderer-scoped rule the honest one. See KNOWN BOUNDARIES for
 * the gap this leaves.
 */
const DATA_SHAPE_ROOT = "src/renderer/";

/** Whether `rel` sits on the surface the data shapes are counted on. */
export function onDataShapeSurface(rel) {
	return rel.startsWith(DATA_SHAPE_ROOT);
}

/**
 * The English catalogue's key ids, read once.
 *
 * A data object may hold the KEY, not the sentence: `{ label:
 * "ui.hub.pages.sort.newest" }` is the keyed spelling, and the component calls
 * `t(entry.label)` on it. Flagging such a value would report keyed copy as
 * debt — the exact inversion this gate must not do — so a value that IS a
 * catalogue key is not a literal. Membership is checked against the real
 * catalogue rather than by matching the `ui.` shape, because a shape match would
 * also hide a typo'd key that translates to nothing.
 */
let englishKeys;
function englishCatalogueKeys() {
	if (englishKeys !== undefined) return englishKeys;
	const keys = new Set();
	const dir = join(REPO, "src", "i18n", "catalogues", "en");
	let names = [];
	try {
		names = readdirSync(dir);
	} catch {
		englishKeys = keys;
		return keys;
	}
	for (const name of names) {
		if (!name.endsWith(".json") || name.endsWith(".context.json")) continue;
		try {
			const data = JSON.parse(readFileSync(join(dir, name), "utf8"));
			for (const key of Object.keys(data)) keys.add(key);
		} catch {
			/* A catalogue the content gate will reject on its own terms must not
			 * stop this one; an unreadable file simply contributes no keys. */
		}
	}
	englishKeys = keys;
	return keys;
}

/** The data shapes never count a value that is a catalogue key (see above). */
function isCatalogueKey(text) {
	return englishCatalogueKeys().has(text);
}

/**
 * A template with its substitutions elided: `Mark all ${…} read`.
 *
 * The elision is what makes the LETTER test meaningful — a substitution carries
 * no prose — and what makes one interpolated sentence one finding instead of
 * two fragments around a hole.
 */
function renderTemplate(node) {
	let out = node.head.text;
	for (const span of node.templateSpans) out += `\${…}${span.literal.text}`;
	return out;
}

/**
 * The static texts an expression renders as copy, one entry per SENTENCE.
 *
 * Deliberately distinct from `staticTextNodes` (which returns one entry per
 * literal PIECE and is what the attribute rule and `check-added-strings.mjs`
 * count): here a template is one sentence, so it is one finding, while a
 * conditional's two arms are two sentences and stay two. Calls, identifiers and
 * member accesses expose nothing — a `t("ui.key")` site yields nothing, which
 * is what a keyed site must look like.
 */
export function copyTexts(node) {
	switch (node.kind) {
		case SyntaxKind.StringLiteral:
		case SyntaxKind.NoSubstitutionTemplateLiteral:
			return [node.text];
		case SyntaxKind.TemplateExpression:
			return [renderTemplate(node)];
		case SyntaxKind.ConditionalExpression:
			return [...copyTexts(node.whenTrue), ...copyTexts(node.whenFalse)];
		case SyntaxKind.BinaryExpression: {
			const operator = node.operatorToken.kind;
			if (operator === SyntaxKind.AmpersandAmpersandToken)
				return copyTexts(node.right);
			if (
				operator === SyntaxKind.PlusToken ||
				operator === SyntaxKind.BarBarToken ||
				operator === SyntaxKind.QuestionQuestionToken
			)
				return [...copyTexts(node.left), ...copyTexts(node.right)];
			return [];
		}
		case SyntaxKind.ParenthesizedExpression:
		case SyntaxKind.AsExpression:
		case SyntaxKind.SatisfiesExpression:
		case SyntaxKind.NonNullExpression:
			return copyTexts(node.expression);
		default:
			return [];
	}
}

/** Any Unicode letter — the line between prose and punctuation/format tokens. */
const LETTER_RE = /\p{L}/u;

/*
 * `// i18n: ignore <reason>`, and the JSX block-comment spelling of the same
 * pragma between braces (a slash-star comment — its closer is deliberately
 * not written out here, because it would end THIS comment) — non-newline
 * whitespace only, so the reason cannot be the prose on the next line (the
 * core's line-bounded `\s+\S`, kept for the same false-positive reason).
 *
 * TWO patterns rather than one, because the block form's CLOSER would
 * otherwise supply the reason: in a reasonless block pragma the character
 * after `ignore` is the closing `*`, which a single `\S` arm would count as
 * a reason. The block pattern therefore requires the reason to START with a
 * character that is neither whitespace nor `*` (the `//` form needs no such
 * care: its comment runs to end of line).
 */
const LINE_PRAGMA_RE = /\/\/[^\S\n]*i18n:[^\S\n]*ignore[^\S\n]+\S/g;
const BLOCK_PRAGMA_RE =
	/\/\*[^\S\n]*i18n:[^\S\n]*ignore[^\S\n]+([^\s*][^\n]*?)\*\//g;

const SCRIPT_RE = /\.(ts|tsx|mjs)$/;

/* Fixture files, in both spellings this tree uses: `x.fixtures.ts` and
 * `x-fixtures.ts`. Matched on a filename COMPONENT, so `my-fixtures-helper.ts`
 * (a helper FOR fixtures) is not silently exempt — only a file whose own name
 * ends in `fixtures`. */
const FIXTURE_FILE_RE = /(?:^|[.-])fixtures?\.[^/]+$/;

function toPosix(path) {
	return path.split(sep).join("/");
}

/** The repo-relative path of `abs`, or null when it is outside `repo`. */
function repoRelative(repo, abs) {
	const rel = toPosix(relative(repo, abs));
	if (rel === "" || rel.startsWith("..") || rel.includes("/../")) return null;
	return rel;
}

export function isScanned(rel) {
	if (!SCRIPT_RE.test(rel) || rel.endsWith(".d.ts")) return false;
	/* Stories are NOT product copy: they exist to render component states in
	 * Storybook and the gallery, nobody translates them, and counting them
	 * would inflate every ceiling with literals no extraction slice ever
	 * lowers. A story that grows product copy is a story that should render a
	 * real translated component instead. */
	if (rel.includes(".stories.")) return false;
	/* Fixtures are the same class as stories, measured the same way: the five
	 * `.fixtures.ts` files under `src/renderer` carried 96 of this scanner's
	 * first 263 data-shape findings — 37% of the debt would have been sample
	 * data rendered by tests and the gallery, which nobody translates. They
	 * exist to drive a component into a state; product copy is what the
	 * component renders when a real session feeds it. */
	if (FIXTURE_FILE_RE.test(rel)) return false;
	if (SCAN_EXCLUDED.some((prefix) => rel.startsWith(prefix))) return false;
	return SCAN_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`));
}

// ---------------------------------------------------------------------------
// The walker
// ---------------------------------------------------------------------------

function lineOf(sourceFile, position) {
	return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

/** The 1-based [first, last] lines a node spans (position is its own span). */
export function lineSpan(sourceFile, node) {
	const start = node.getStart(sourceFile);
	const end = Math.max(start, node.getEnd() - 1);
	return [
		sourceFile.getLineAndCharacterOfPosition(start).line + 1,
		sourceFile.getLineAndCharacterOfPosition(end).line + 1,
	];
}

/**
 * The literal text nodes whose value is statically present in an expression
 * that becomes copy: the arms of a conditional, `||` / `??` / `+` operands,
 * the right side of `&&` (the left is its guard), and every literal span of a
 * template. Calls, identifiers and member accesses expose no static text, so a
 * `t("ui.key")` site yields nothing - which is what a keyed site must look
 * like. Shared with `check-added-strings.mjs` so the two guards cannot drift
 * on what "static copy" means.
 */
export function staticTextNodes(node) {
	switch (node.kind) {
		case SyntaxKind.StringLiteral:
		case SyntaxKind.NoSubstitutionTemplateLiteral:
			return [node];
		case SyntaxKind.TemplateExpression:
			return [node.head, ...node.templateSpans.map((span) => span.literal)];
		case SyntaxKind.ConditionalExpression:
			return [
				...staticTextNodes(node.whenTrue),
				...staticTextNodes(node.whenFalse),
			];
		case SyntaxKind.BinaryExpression: {
			const operator = node.operatorToken.kind;
			if (operator === SyntaxKind.AmpersandAmpersandToken) {
				return staticTextNodes(node.right);
			}
			if (
				operator === SyntaxKind.PlusToken ||
				operator === SyntaxKind.BarBarToken ||
				operator === SyntaxKind.QuestionQuestionToken
			) {
				return [...staticTextNodes(node.left), ...staticTextNodes(node.right)];
			}
			return [];
		}
		case SyntaxKind.ParenthesizedExpression:
		case SyntaxKind.AsExpression:
		case SyntaxKind.SatisfiesExpression:
		case SyntaxKind.NonNullExpression:
			return staticTextNodes(node.expression);
		default:
			return [];
	}
}

/** Whether a node sits directly between JSX braces as a child, not as a value. */
function isJsxChild(node) {
	const parent = node.parent;
	return (
		parent !== undefined &&
		(parent.kind === SyntaxKind.JsxElement ||
			parent.kind === SyntaxKind.JsxFragment)
	);
}

/**
 * An object-literal property's name as written, or undefined.
 *
 * Both spellings name the same key: `{ label: … }` (an Identifier) and
 * `{ "label": … }` (a StringLiteral, which the formatter keeps when a key has
 * to be quoted). A computed key (`{ [k]: … }`) discloses nothing statically and
 * is skipped rather than guessed at.
 */
function propertyName(name) {
	if (name === undefined) return undefined;
	if (name.kind === SyntaxKind.Identifier) return name.text;
	if (name.kind === SyntaxKind.StringLiteral) return name.text;
	return undefined;
}

/**
 * What a pragma stands between, once its own bytes are removed, to count as
 * written on a line of its own: whitespace and the braces of the JSX spelling
 * (`{` + a slash-star comment + `}`), nothing else.
 */
const STANDALONE_PRAGMA_SURROUNDINGS_RE = /^[\s{}]*$/;

/**
 * THE PRAGMA SCOPE RULE, stated once. Both gates call this: `findViolations`
 * below, and `findAddedCopyViolations` in `check-added-strings.mjs` — which is
 * why it is exported rather than duplicated. They disagreed once, and the copy
 * the diff guard charged while the ratchet called it exempt was
 * `agent-detail.tsx`'s `"inherit"`.
 *
 * A pragma covers:
 *   1. the line it is written on — the inline shape, `"lop exec" /* i18n:
 *      ignore … *\/`;
 *   2. the NEXT line, when the pragma stands alone on its own line — the
 *      annotation-above shape, `{/* i18n: ignore … *\/}` written on the line
 *      whose next line opens the element it annotates.
 *
 * It stops there. It does NOT cover an enclosing JSX element's whole span: that
 * reading let one glyph's reason silence its siblings, which in
 * `slash-commands.tsx` meant the pragma written for the `[x]` mark also
 * exempted the `[ ]` arm one line below it (review M1/Q-2 on #1767). Nor is the
 * narrowing to "own line only" enough, which is how rule 2 came to exist: three
 * of this tree's pragmas annotate the element under them instead of trailing
 * their literal.
 */
export function pragmaCoveredLines(sourceFile) {
	const covered = new Set();
	/*
	 * One pragma's contribution. `toEndOfLine` exists because the LINE form's
	 * pattern stops at the FIRST character of its reason — it only has to prove
	 * a reason exists — so `// i18n: ignore icon-only control` matches as
	 * `// i18n: ignore i` and the rest of the comment would otherwise read as
	 * code standing beside the pragma. The `//` form runs to end of line, so that
	 * arm removes the tail; the block form's match carries both delimiters and is
	 * exact.
	 */
	const addPragma = (index, length, toEndOfLine) => {
		const { line, character } = sourceFile.getLineAndCharacterOfPosition(index);
		covered.add(line + 1);
		const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
		const lineEnd = sourceFile.text.indexOf("\n", lineStart);
		const text = sourceFile.text.slice(
			lineStart,
			lineEnd === -1 ? undefined : lineEnd,
		);
		const surroundings =
			text.slice(0, character) +
			(toEndOfLine ? "" : text.slice(character + length));
		/* `line + 2` on the file's last line is past the end, which can never
		 * match a node's span - harmless, and simpler than a bounds test. */
		if (STANDALONE_PRAGMA_SURROUNDINGS_RE.test(surroundings)) {
			covered.add(line + 2);
		}
	};
	for (const pragma of sourceFile.text.matchAll(LINE_PRAGMA_RE)) {
		addPragma(pragma.index, pragma[0].length, true);
	}
	for (const pragma of sourceFile.text.matchAll(BLOCK_PRAGMA_RE)) {
		addPragma(pragma.index, pragma[0].length, false);
	}
	return covered;
}

export function inSpan([first, last], lines) {
	for (let line = first; line <= last; line += 1) {
		if (lines.has(line)) return true;
	}
	return false;
}

/** One line of display text, shorter than the source line in the report. */
export function collapse(text) {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * The findings of one parsed file: `{ kind, line, text }`, in source order.
 *
 * `kind` is `jsx-text` or `attribute:<name>` for the original shapes, and
 * `jsx-child-expression` or `object-literal:<key>` for the data shapes, whose
 * `kind` is also the id prefix the literal allowance records (see
 * `literalId`). `line` is where the report can point a reader. The pragma check
 * is the shared scope rule (`pragmaCoveredLines`), never this file's own
 * reading.
 *
 * `dataShapes: false` reproduces the pre-widening walker exactly, which is how
 * the fixtures prove each new shape is genuinely new rather than incidentally
 * visible to the old rule.
 */
export function findViolations(sourceFile, { dataShapes = true } = {}) {
	const pragmas = pragmaCoveredLines(sourceFile);
	const findings = [];
	const push = (kind, node, text) => {
		findings.push({
			kind,
			line: lineOf(sourceFile, node.getStart(sourceFile)),
			text: collapse(text),
		});
	};
	const exempt = (node) => inSpan(lineSpan(sourceFile, node), pragmas);
	const visit = (node) => {
		if (node.kind === SyntaxKind.JsxText) {
			if (LETTER_RE.test(node.text) && !exempt(node)) {
				push("jsx-text", node, node.text);
			}
		} else if (node.kind === SyntaxKind.JsxAttribute) {
			const name = node.name?.text;
			const initializer = node.initializer;
			if (name !== undefined && COPY_ATTRIBUTES.has(name) && initializer) {
				/* `label="Run details"` is a literal initializer; `label={...}` is a
				 * JsxExpression whose static text (conditional arms, template spans,
				 * `??` fallbacks) is just as visible to the user. Both spellings are
				 * the same defect, so both are counted - one finding per literal
				 * piece, because a template with two pieces needs two keys' worth of
				 * attention and a count of one would let a second slip in. */
				const pieces =
					initializer.kind === SyntaxKind.StringLiteral
						? [initializer]
						: initializer.kind === SyntaxKind.JsxExpression &&
								initializer.expression
							? staticTextNodes(initializer.expression)
							: [];
				if (!exempt(node)) {
					for (const piece of pieces) {
						if (!LETTER_RE.test(piece.text)) continue;
						push(`attribute:${name}`, piece, piece.text);
					}
				}
			}
		} else if (
			dataShapes &&
			node.kind === SyntaxKind.JsxExpression &&
			node.expression &&
			isJsxChild(node)
		) {
			/* `{cond ? "A" : "B"}` and ``{`Mark all ${n} read`}`` render prose that
			 * no `JsxText` node ever carries: the text sits inside braces. The
			 * expression is unchanged whether it is a child or an attribute value,
			 * so the SAME `copyTexts` decides what is static; only the position
			 * differs, and an attribute value has already been counted above. */
			if (!exempt(node)) {
				for (const text of copyTexts(node.expression)) {
					if (LETTER_RE.test(text)) push("jsx-child-expression", node, text);
				}
			}
		} else if (
			dataShapes &&
			node.kind === SyntaxKind.PropertyAssignment &&
			node.initializer
		) {
			/* `{ label: "By turn" }`: the data half of the same defect. The key set
			 * is what keeps tokens out - `{ status: "connecting" }`, `{ id: ... }`,
			 * `{ kind: ... }` are data, and a machine position is a key, not a
			 * value. The pragma scope is the shared rule like everywhere else: the
			 * property's own line (a trailing `// i18n: ignore <reason>`) and the
			 * line after a pragma written above it. */
			const key = propertyName(node.name);
			if (key !== undefined && OBJECT_COPY_KEYS.has(key) && !exempt(node)) {
				for (const text of copyTexts(node.initializer)) {
					if (LETTER_RE.test(text) && !isCatalogueKey(text))
						push(`object-literal:${key}`, node.initializer, text);
				}
			}
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);
	return findings.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// Allowlist and baseline (shapes mirror check.py, JSON instead of TOML)
// ---------------------------------------------------------------------------

/**
 * `[{ path, reason }]` entries. A missing reason is a hard error: the reason
 * is the whole reason the entry is reviewable.
 */
export function loadAllowlist(path) {
	let data;
	try {
		data = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw new Error(`${path}: ${error.message}`);
	}
	const entries = data?.entries ?? [];
	if (!Array.isArray(entries)) {
		throw new Error(
			`${path}: \`entries\` must be a list of { path, reason } objects`,
		);
	}
	return entries.map((entry) => {
		if (
			typeof entry !== "object" ||
			entry === null ||
			typeof entry.path !== "string"
		) {
			throw new Error(
				`${path}: every allowlist entry must be { "path": ..., "reason": ... }`,
			);
		}
		if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
			throw new Error(
				`${path}: allowlist entry ${JSON.stringify(entry.path)} has no reason`,
			);
		}
		return { path: entry.path, reason: entry.reason };
	});
}

/**
 * The reason this repo-relative path is exempt, or undefined.
 *
 * Two forms, both exact: a file path, or a directory prefix ending in `/`.
 * No globs on purpose (the core checker's rule, kept).
 */
export function allowlistReason(rel, entries) {
	for (const entry of entries) {
		if (entry.path.endsWith("/")) {
			if (rel.startsWith(entry.path)) return entry.reason;
		} else if (rel === entry.path) {
			return entry.reason;
		}
	}
	return undefined;
}

/**
 * The baseline object; a missing or damaged file reads as empty (fail closed —
 * every counted file then has no recorded ceiling, and every one fails).
 *
 * Schema 1 is still accepted, but its `enforced` field is IGNORED: enforcement
 * is global now, and a scope list left in an older baseline must not resurrect
 * a report-only mode. Its ceilings still apply.
 */
export function loadBaseline(path) {
	let data = {};
	try {
		data = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		// Missing or damaged: `files: {}` below fails every counted file.
	}
	if (typeof data !== "object" || data === null) data = {};
	const files = data.files;
	return {
		schema: Number.isInteger(data.schema) ? data.schema : 1,
		note: typeof data.note === "string" ? data.note : BASELINE_NOTE,
		/*
		 * A malformed ceiling is DROPPED, never coerced. `Number("twelve")` is
		 * NaN, and `ratchetFindings` only fails when `count > ceiling` — false
		 * for NaN — so coercion would silently exempt the file it was meant to
		 * hold to. Dropping the entry makes the file unrecorded, which fails
		 * closed, the same way the reader already treats a damaged FILE as
		 * empty rather than as an unlimited one.
		 */
		files:
			typeof files === "object" && files !== null
				? Object.fromEntries(
						Object.entries(files).flatMap(([key, value]) =>
							Number.isInteger(value) && value >= 0 ? [[key, value]] : [],
						),
					)
				: {},
	};
}

/**
 * Write the baseline as schema 2: `{ schema, note, files }`, one sorted entry
 * per line.
 *
 * Rendered by hand rather than JSON.stringify'd, because the repo's formatter
 * (biome) re-formats a stringified dump — key order, indentation, short arrays
 * collapsed onto one line — and this file is read by humans in review, so the
 * writer and the formatter must agree or every re-init churns the file. The
 * per-line `files` object below is the shape biome already leaves alone.
 */
export function saveBaseline(path, files, note) {
	const sorted = Object.keys(files).sort();
	const lines = ["{", '\t"schema": 2,', `\t"note": ${JSON.stringify(note)},`];
	if (sorted.length === 0) {
		lines.push('\t"files": {}');
	} else {
		lines.push('\t"files": {');
		sorted.forEach((key, index) => {
			const comma = index < sorted.length - 1 ? "," : "";
			lines.push(`\t\t${JSON.stringify(key)}: ${files[key]}${comma}`);
		});
		lines.push("\t}");
	}
	lines.push("}");
	writeFileSync(path, `${lines.join("\n")}\n`);
}

// ---------------------------------------------------------------------------
// Scanning a snapshot
// ---------------------------------------------------------------------------

/**
 * Open a snapshot with the two tsconfig projects plus any extra files.
 *
 * Extra files are how fixtures are scanned: with no tsconfig above them they
 * land in the compiler's inferred project, which parses TSX fine (pinned by
 * the tests). The caller MUST `api.close()` — that is what reaps the compiler
 * server child.
 */
export function openSnapshot(repo, extraFiles = []) {
	const api = new API({ cwd: repo });
	const snapshot = api.updateSnapshot({
		openProjects: [
			join(repo, "tsconfig.app.json"),
			join(repo, "tsconfig.node.json"),
		],
		openFiles: extraFiles,
	});
	return { api, snapshot };
}

/** `scripts/i18n`'s own top-level scripts — scanned, fixtures excluded. */
export function toolingFiles(repo) {
	const dir = join(repo, "scripts", "i18n");
	return readdirSync(dir)
		.filter((name) => name.endsWith(".mjs"))
		.map((name) => join(dir, name));
}

/**
 * Violations per scanned file: `Map<repoRelativePath, findings[]>`.
 *
 * Two corpora, one at a time. With no `extraScan`, the corpus is the scan
 * roots: candidates come from both projects' programs plus the top-level
 * `scripts/i18n` scripts no project includes, filtered by `isScanned`.
 * With `extraScan` (repo-relative fixture paths), the corpus is EXACTLY those
 * files, whatever the roots would say — that is how the tests scan the
 * fixtures, which deliberately live inside the excluded fixtures directory.
 */
export function scanSnapshot(snapshot, repo, { extraScan = [] } = {}) {
	const scanned = new Map();
	const add = (rel, sourceFile) => {
		if (sourceFile && !scanned.has(rel)) {
			/* The data shapes are on for the renderer surface. A fixture corpus
			 * (`extraScan`) has them on wherever it lives: a fixture exists to
			 * exercise the rule, and the surface boundary itself is asserted
			 * against `findViolations` directly (see "the data shapes are a
			 * surface, not the tree" in check-strings.test.mjs). */
			const dataShapes = extraScan.length > 0 || onDataShapeSurface(rel);
			scanned.set(rel, findViolations(sourceFile, { dataShapes }));
		}
	};
	if (extraScan.length > 0) {
		for (const rel of extraScan) {
			const abs = join(repo, rel);
			const project = snapshot.getDefaultProjectForFile(abs);
			add(rel, project?.program.getSourceFile(abs));
		}
		return scanned;
	}
	for (const project of snapshot.getProjects()) {
		for (const name of project.program.getSourceFileNames()) {
			const rel = repoRelative(repo, name);
			if (rel === null || !isScanned(rel)) continue;
			add(rel, project.program.getSourceFile(name));
		}
	}
	for (const abs of toolingFiles(repo)) {
		const rel = repoRelative(repo, abs);
		if (rel === null || !isScanned(rel)) continue;
		const project = snapshot.getDefaultProjectForFile(abs);
		add(rel, project?.program.getSourceFile(abs));
	}
	return scanned;
}

/**
 * Per-file counts after the allowlist, files with none omitted.
 *
 * The data shapes are NOT counted here: they are governed by
 * `i18n/literal-allowance.json`, which is stricter than a ceiling (one exact id
 * per finding, an owner, a payoff and a base-ref growth check). Counting them in
 * both places would make the allowance pointless — every renderer file with a
 * payable finding would need a raised baseline entry, which is precisely the
 * baseline edit this design exists to avoid.
 */
export function countsOf(scanned, allowlist) {
	const counts = {};
	for (const [rel, violations] of scanned) {
		if (allowlistReason(rel, allowlist) !== undefined) continue;
		const counted = violations.filter(
			(finding) => !governedByAllowance(finding.kind),
		);
		if (counted.length > 0) counts[rel] = counted.length;
	}
	return counts;
}

/**
 * The counted files that exceed — or are missing from — their ceiling.
 *
 * A missing entry is a FAILURE, not an implicit ceiling of 0: "absent" is the
 * default state of every file anyone adds, so reading it as exempt would make
 * every new file silent — the defect this rule exists to close.
 */
export function ratchetFindings(counts, files) {
	const out = [];
	for (const rel of Object.keys(counts).sort()) {
		/* `countsOf` never records zero-count files; a hand-built map (tests,
		 * callers) may, and a zero count is at-or-below any ceiling — including
		 * the implicit 0 of a file with no entry. */
		if (counts[rel] === 0) continue;
		const ceiling = Object.prototype.hasOwnProperty.call(files, rel)
			? files[rel]
			: undefined;
		if (ceiling === undefined)
			out.push({ path: rel, count: counts[rel], ceiling: null });
		else if (counts[rel] > ceiling)
			out.push({ path: rel, count: counts[rel], ceiling });
	}
	return out;
}

// ---------------------------------------------------------------------------
// The literal allowance: the data shapes' named, owned, shrink-only debt
// ---------------------------------------------------------------------------

/**
 * The shapes `i18n/literal-allowance.json` governs.
 *
 * These are the shapes the widened walker added. The original ones stay on the
 * baseline ratchet, unchanged — a shape does not migrate gates, because the
 * baseline's per-file ceiling and the allowance's per-finding id answer
 * different questions and a finding counted by both is a finding nobody can
 * reason about.
 */
export function governedByAllowance(kind) {
	return kind === "jsx-child-expression" || kind.startsWith("object-literal:");
}

/**
 * The exact identity an entry lists: `<kind> | <text>`.
 *
 * The text is part of the id on purpose. A count would let one literal be
 * replaced by a different one of the same shape and still "fit" — the debt would
 * look unchanged while its content drifted. Paying a finding down REMOVES its
 * id, and the id that replacing it introduces is unlisted, which fails.
 *
 * ` | ` is the separator and the reader splits on the FIRST occurrence: a text
 * may itself contain ` | ` (prose often does), a kind never does.
 */
export function literalId(finding) {
	return `${finding.kind} | ${finding.text}`;
}

/** The kind prefix of an id; undefined when the id has no separator. */
export function literalIdKind(id) {
	const at = id.indexOf(" | ");
	return at === -1 ? undefined : id.slice(0, at);
}

const ALLOWANCE_FIELDS = ["file", "ids", "owner", "payoff", "reason"];

/**
 * Read `i18n/literal-allowance.json`. A missing file is an EMPTY allowance, not
 * an error: with no entries every governed finding is unlisted, so the check
 * fails closed on exactly the tree that has debt. A damaged file throws, because
 * "we could not read the reason this string is allowed" must not read as
 * "nothing is allowed" any more than as "everything is".
 */
export function loadLiteralAllowance(path = LITERAL_ALLOWANCE) {
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return { schema: 1, note: "", entries: [] };
		throw new Error(`${path}: ${error.message}`);
	}
	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new Error(`${path}: ${error.message}`);
	}
}

/**
 * Validate the allowance's shape and return `file -> Set(id)` plus the problems.
 *
 * Shape rules, each mirroring `check-coverage.mjs`'s `validateAllowance` so the
 * two debt files cannot drift: schema 1, a known exact field set, a non-empty
 * `file`/`owner`/`reason`, a payoff that is a real ISO date or a tracker key, a
 * non-empty duplicate-free SORTED id list, ids that name a governed shape, and
 * one entry per file. An empty id list is a problem rather than a no-op: an
 * entry that no longer allows anything must be deleted, or the file cannot be
 * read as a ledger of what is still owed.
 */
export function validateLiteralAllowance(allowance) {
	const problems = [];
	const allowed = new Map();
	if (
		allowance === null ||
		typeof allowance !== "object" ||
		Array.isArray(allowance)
	) {
		return { allowed, problems: ["allowance must be an object"] };
	}
	if (allowance.schema !== 1) problems.push("`schema` must be 1");
	if (!Array.isArray(allowance.entries)) {
		problems.push("`entries` must be an array");
		return { allowed, problems };
	}
	for (const [index, entry] of allowance.entries.entries()) {
		const where = `entries[${index}]`;
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
			problems.push(`${where} must be an object`);
			continue;
		}
		const missingFields = ALLOWANCE_FIELDS.filter((field) => !(field in entry));
		const extraFields = Object.keys(entry).filter(
			(field) => !ALLOWANCE_FIELDS.includes(field),
		);
		if (missingFields.length > 0)
			problems.push(
				`${where} is missing field(s): ${missingFields.join(", ")}`,
			);
		if (extraFields.length > 0)
			problems.push(`${where} has unknown field(s): ${extraFields.join(", ")}`);
		for (const field of ["file", "owner", "reason"]) {
			if (typeof entry[field] !== "string" || entry[field].trim() === "")
				problems.push(`${where}.${field} must be a non-empty string`);
		}
		if (!isPayoff(entry.payoff))
			problems.push(
				`${where}.payoff ${JSON.stringify(entry.payoff) ?? "undefined"} is not a payoff: use an ISO date (YYYY-MM-DD) or a ticket reference such as MIN-1234`,
			);
		const file = entry.file;
		if (typeof file !== "string" || file.trim() === "") continue;
		if (allowed.has(file)) {
			problems.push(`${where} duplicates ${file}`);
			continue;
		}
		const ids = entry.ids;
		let idsValid = true;
		if (!Array.isArray(ids)) {
			problems.push(`${where}.ids must be an array`);
			idsValid = false;
		} else if (ids.length === 0) {
			problems.push(
				`${where} (${file}) lists no ids; remove the complete entry`,
			);
			idsValid = false;
		} else {
			for (const id of ids) {
				if (typeof id !== "string" || id.length === 0) {
					problems.push(`${where}.ids has a non-string or empty id`);
					idsValid = false;
					continue;
				}
				const kind = literalIdKind(id);
				if (kind === undefined) {
					problems.push(
						`${where}.ids has an id without a " | " separator: ${JSON.stringify(id)}`,
					);
					idsValid = false;
				} else if (!governedByAllowance(kind)) {
					problems.push(
						`${where}.ids lists ${JSON.stringify(kind)}, which is not a shape this allowance governs`,
					);
					idsValid = false;
				}
			}
			if (idsValid) {
				if (new Set(ids).size !== ids.length) {
					problems.push(`${where}.ids has duplicate ids`);
					idsValid = false;
				}
				const sorted = [...ids].sort();
				if (sorted.some((id, at) => id !== ids[at])) {
					problems.push(`${where}.ids is not sorted`);
					idsValid = false;
				}
			}
		}
		if (idsValid) allowed.set(file, new Set(ids));
	}
	return { allowed, problems };
}

/**
 * Compare the tree against the allowance. Nothing here prints or exits.
 *
 * `unlisted` is every governed finding no entry lists — the discriminating
 * failure: new copy landed and nobody recorded a debt for it. `stale` is every
 * listed id that no longer exists — a paid-down finding whose id was left
 * behind. Both are failures, which is what makes the file shrink-only without a
 * git ref: it can only move down on its own, and the base-ref check
 * (`allowanceGrowth`) catches a hand-added id in review.
 */
export function literalAllowanceFindings(scanned, allowed) {
	const unlisted = [];
	const found = new Map();
	for (const [rel, violations] of scanned) {
		const governed = violations.filter((finding) =>
			governedByAllowance(finding.kind),
		);
		if (governed.length === 0) continue;
		const entry = allowed.get(rel);
		const ids = new Set();
		for (const finding of governed) {
			const id = literalId(finding);
			ids.add(id);
			if (!entry?.has(id)) unlisted.push({ path: rel, ...finding });
		}
		found.set(rel, ids);
	}
	const stale = [];
	for (const [file, ids] of [...allowed].sort(([a], [b]) => (a < b ? -1 : 1))) {
		const live = found.get(file) ?? new Set();
		const gone = [...ids].filter((id) => !live.has(id)).sort();
		if (gone.length > 0) stale.push({ file, ids: gone });
	}
	return { unlisted, stale };
}

/**
 * Render the allowance so the committed file and the repository's formatter
 * agree.
 *
 * `JSON.stringify(…, null, "\t")` puts every array element on its own line, but
 * biome COLLAPSES an array that fits its 80-column budget — so a pruned file and
 * a formatted file would disagree on every short entry, and each prune would
 * churn the whole file. `i18n/baseline.json`'s writer documents the same trap for
 * object keys; this is its array-aware sibling. The budget is calibrated against
 * the formatter's own output for this schema (a tab counts as two columns, the
 * line width is biome's default 80), and only the `ids` list can ever be short
 * enough to collapse — which is why the rule is applied there alone.
 */
export function renderAllowance(
	allowance,
	{ lineWidth = 80, tabWidth = 2 } = {},
) {
	const width = (line) =>
		line.split("").reduce((sum, ch) => sum + (ch === "\t" ? tabWidth : 1), 0);
	const lines = [
		"{",
		'\t"schema": 1,',
		`\t"note": ${JSON.stringify(allowance.note)},`,
	];
	if (allowance.entries.length === 0) {
		lines.push('\t"entries": []');
	} else {
		lines.push('\t"entries": [');
		allowance.entries.forEach((entry, index) => {
			lines.push("\t\t{");
			lines.push(`\t\t\t"file": ${JSON.stringify(entry.file)},`);
			const inline = `\t\t\t"ids": [${entry.ids.map((id) => JSON.stringify(id)).join(", ")}],`;
			if (width(inline) <= lineWidth) {
				lines.push(inline);
			} else {
				lines.push('\t\t\t"ids": [');
				entry.ids.forEach((id, at) => {
					const comma = at < entry.ids.length - 1 ? "," : "";
					lines.push(`\t\t\t\t${JSON.stringify(id)}${comma}`);
				});
				lines.push("\t\t\t],");
			}
			lines.push(`\t\t\t"owner": ${JSON.stringify(entry.owner)},`);
			lines.push(`\t\t\t"payoff": ${JSON.stringify(entry.payoff)},`);
			lines.push(`\t\t\t"reason": ${JSON.stringify(entry.reason)}`);
			lines.push(index < allowance.entries.length - 1 ? "\t\t}," : "\t\t}");
		});
		lines.push("\t]");
	}
	lines.push("}", "");
	return lines.join("\n");
}

/** Every id an allowance records, as `file`-qualified strings. */
export function allowanceIds(allowance) {
	const out = [];
	for (const entry of allowance?.entries ?? []) {
		for (const id of entry.ids ?? []) out.push(`${entry.file}\0${id}`);
	}
	return out.sort();
}

/** Ids HEAD records that the base allowance did not — the growth set. */
export function allowanceGrowth(base, head) {
	const before = new Set(allowanceIds(base));
	return allowanceIds(head).filter((id) => !before.has(id));
}

/**
 * The allowance at `ref`, read out of git, and a growth report against HEAD.
 *
 * A new id is a NEW debt, and adding one must be a reviewed decision with an
 * owner and a payoff — not something a failing check talks you into. The base is
 * the CI pull-request base when set, else `origin/main`.
 *
 * A base that resolved but does not carry the file yet is the pull request that
 * INTRODUCES the allowance: there is nothing to compare against, and the
 * comparison legitimately returns nothing. A base that did not resolve at all is
 * not that case — the caller has to say so, and `allowanceBaseReport` is where
 * it does (a failure when the base was required, a stated gap when it was not).
 */
export function checkAllowanceGrowth(
	ref,
	{ repo = REPO, allowancePath = LITERAL_ALLOWANCE, allowance, base } = {},
) {
	/* `base` is the seam the tests use: the comparison is the same code with the
	 * base handed in rather than read out of git, so a growth test does not need
	 * a repository (and cannot drift from the real check). */
	if (base !== undefined) {
		const head = allowance ?? loadLiteralAllowance(allowancePath);
		return allowanceGrowth(base, head).map(growthLine);
	}
	if (!ref) return [];
	/* The base that does not carry the file yet is the pull request that
	 * INTRODUCES this allowance: there is nothing to compare against, and
	 * reporting every id as growth would make its first commit unsatisfiable.
	 * Every other read failure still surfaces as a failure below. */
	try {
		execFileSync(
			"git",
			["cat-file", "-e", `${ref}:i18n/literal-allowance.json`],
			{
				cwd: repo,
				stdio: ["ignore", "ignore", "ignore"],
			},
		);
	} catch {
		return [];
	}
	let before;
	try {
		const shown = execFileSync(
			"git",
			["show", `${ref}:i18n/literal-allowance.json`],
			{
				cwd: repo,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			},
		);
		before = JSON.parse(shown);
	} catch (error) {
		return [`cannot compare allowances: ${error.message}`];
	}
	const head = allowance ?? loadLiteralAllowance(allowancePath);
	return allowanceGrowth(before, head).map(growthLine);
}

/** The CI pull-request base commit, when the scanner runs inside one. */
function ciAllowanceBase() {
	if (process.env.GITHUB_EVENT_NAME !== "pull_request") return null;
	const eventPath = process.env.GITHUB_EVENT_PATH;
	if (!eventPath) return null;
	try {
		const event = JSON.parse(readFileSync(eventPath, "utf8"));
		const base = event?.pull_request?.base;
		return { sha: base?.sha, ref: base?.ref };
	} catch {
		return null;
	}
}

/**
 * Resolve the ref the allowance is compared against. Mirrors
 * `check-coverage.mjs` deliberately: an explicit ref or the CI pull-request base
 * is REQUIRED and an unresolvable one fails the gate rather than silently
 * skipping the comparison — a growth check that quietly passes when its base is
 * missing is the same "gate in name only" this file's docstring rejects.
 *
 * A local checkout with neither is the one case that is NOT required — a clone
 * with no `origin/main` must still be runnable — and that is a skip the caller
 * has to REPORT: `allowanceBaseReport` prints the gap and the success line
 * repeats it, so "not required" never reads as "compared and passed".
 *
 * The single `git fetch` is the CI case `actions/checkout` creates (a shallow
 * checkout has the merge commit and not its base); no fetch happens when the ref
 * already resolves, which is every local run.
 */
export function resolveAllowanceBase(base, { repo = REPO } = {}) {
	const git = (args) => {
		try {
			execFileSync("git", args, {
				cwd: repo,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
			return 0;
		} catch {
			return 1;
		}
	};
	const explicit = typeof base === "string" && base.length > 0;
	const ci = explicit ? null : ciAllowanceBase();
	const ref = (explicit ? base : null) ?? ci?.sha ?? "origin/main";
	const required = explicit || Boolean(ci?.sha);
	if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === 0)
		return { ref, required };
	if (git(["fetch", "--no-tags", "--depth=1", "origin", ref]) === 0)
		return { ref: "FETCH_HEAD", required };
	if (
		ci?.ref &&
		git(["fetch", "--no-tags", "--depth=1", "origin", ci.ref]) === 0
	)
		return { ref: "FETCH_HEAD", required };
	return { ref: null, required };
}

/** One growth failure line. */
function growthLine(id) {
	return `allowance grew by ${JSON.stringify(id.replace("\0", " | "))}: a new debt needs an owner, a payoff and a reviewer's decision, not a check that failed`;
}

/**
 * Drop every id no longer found, and every entry left empty. The ONE writing
 * mode: it can only remove. Returns what it removed, so the caller can print a
 * diff a reviewer can read.
 */
export function pruneLiteralAllowance(
	scanned,
	{ allowancePath = LITERAL_ALLOWANCE } = {},
) {
	const allowance = loadLiteralAllowance(allowancePath);
	const { problems } = validateLiteralAllowance(allowance);
	if (problems.length > 0) return { removed: 0, removedEntries: 0, problems };
	const live = new Map();
	for (const [rel, violations] of scanned) {
		live.set(
			rel,
			new Set(
				violations
					.filter((finding) => governedByAllowance(finding.kind))
					.map(literalId),
			),
		);
	}
	let removed = 0;
	const kept = [];
	for (const entry of allowance.entries) {
		const present = live.get(entry.file) ?? new Set();
		const ids = entry.ids.filter((id) => present.has(id));
		removed += entry.ids.length - ids.length;
		if (ids.length > 0) kept.push({ ...entry, ids });
	}
	const removedEntries = allowance.entries.length - kept.length;
	if (removed === 0 && removedEntries === 0)
		return { removed: 0, removedEntries: 0, problems: [] };
	writeFileSync(
		allowancePath,
		renderAllowance({ ...allowance, entries: kept }),
	);
	return { removed, removedEntries, problems: [] };
}

// ---------------------------------------------------------------------------
// The check, and the CLI
// ---------------------------------------------------------------------------

/**
 * Run the whole check. Returns everything the caller (CLI or test) needs;
 * nothing here prints or exits.
 */
export function runCheck({
	repo = REPO,
	extraScan = [],
	allowlist,
	baseline,
	allowlistPath = ALLOWLIST,
	baselinePath = BASELINE,
	allowancePath = LITERAL_ALLOWANCE,
	allowance,
} = {}) {
	const entries = allowlist ?? loadAllowlist(allowlistPath);
	const { api, snapshot } = openSnapshot(
		repo,
		extraScan.map((rel) => join(repo, rel)),
	);
	try {
		const scanned = scanSnapshot(snapshot, repo, { extraScan });
		const counts = countsOf(scanned, entries);
		const loaded = baseline ?? loadBaseline(baselinePath);
		const failures = ratchetFindings(counts, loaded.files);
		const debt = allowance ?? loadLiteralAllowance(allowancePath);
		const { allowed, problems } = validateLiteralAllowance(debt);
		const { unlisted, stale } = literalAllowanceFindings(scanned, allowed);
		return {
			scanned,
			counts,
			failures,
			baseline: loaded,
			allowance: debt,
			allowanceProblems: problems,
			unlisted,
			stale,
		};
	} finally {
		api.close();
	}
}

function findingLine(finding) {
	if (finding.ceiling === null) {
		return `${finding.path}: ${finding.count} literal(s) — not in baseline.json; a file with no recorded ceiling fails`;
	}
	return `${finding.path}: ${finding.count} literal(s) against a ceiling of ${finding.ceiling}`;
}

/**
 * The remedy sentence printed after a failed check.
 *
 * The two failure shapes have different remedies, and naming both at once
 * misdirects: a ceiling breach means the file gained literals that must be
 * extracted, while `--init --force` exists for a file with NO recorded entry
 * (and rewrites the whole baseline, recording the literal the breach just
 * added). So the capture clause is only printed when a missing entry is
 * actually among the failures.
 */
export function failureSummary(failures) {
	const missingEntry = failures.some((finding) => finding.ceiling === null);
	return `check-strings.mjs: FAILED — ${failures.length} finding(s). Extract the string, add \`i18n: ignore <reason>\`, or (for a file-level exemption) record it in i18n/allowlist.json with a reason.${
		missingEntry
			? " A file with no recorded ceiling is fixed by a reviewed `--init --force` capture."
			: ""
	}`;
}

/**
 * The remedy sentence for the literal allowance, printed only after a failure
 * THAT IS ONE.
 *
 * The failure shapes have different remedies and naming the wrong one is how a
 * gate teaches a contributor to weaken it: an UNLISTED finding is paid by
 * extracting the string; a STALE id is paid by pruning the entry (never by
 * leaving it, and never by re-adding the literal); an id that GREW relative to
 * the base is a reviewer's decision, not something a failing check can talk you
 * into; the allowance's own shape is fixed in the file. No part applies and the
 * sentence is empty — a baseline breach, an unresolved base or a `--prune`
 * problem has its own line above, and this one used to print an empty pair of
 * parentheses over all of them (agent review round 1, N1 / QA Q-1).
 */
export function allowanceSummary({
	unlisted,
	stale,
	allowanceProblems,
	growth,
}) {
	const parts = [];
	if (toCount(allowanceProblems) > 0) parts.push("fix the allowance's shape");
	if (toCount(unlisted) > 0)
		parts.push(
			"extract the unlisted string through the catalogue, or record it in i18n/literal-allowance.json with an owner and a payoff — a new id is a reviewed decision, not a check-fix",
		);
	if (toCount(stale) > 0)
		parts.push(
			"run `node scripts/i18n/check-strings.mjs --prune-allowance` for the ids that are no longer found — the allowance can only shrink",
		);
	if (toCount(growth) > 0)
		parts.push(
			"revert the ids this branch added relative to the base, or take them to a reviewer — growth is a decision, never a check-fix",
		);
	if (parts.length === 0) return "";
	return `check-strings.mjs: FAILED — the data shapes (${parts.join("; ")}). See docs/i18n/literal-allowance.md.`;
}

/**
 * The growth check's own line: a FAILURE when the base was required, and a
 * stated GAP when it was not.
 *
 * `resolveAllowanceBase` cannot fail the run by itself — a local checkout with
 * no `origin/main` is a legitimate run — so the reporting lives here, and the
 * one thing it must never do is stay quiet: a growth comparison that did not
 * run is a check that did not look, and the success line repeats it so no one
 * reads an `ok` as a comparison that happened (agent review round 1, M1).
 */
export function allowanceBaseReport({ ref, required }) {
	if (ref !== null) return { lines: [], failed: false };
	if (required)
		return {
			lines: [
				"i18n/literal-allowance.json: cannot resolve the base ref to compare growth against (`--allowance-base <ref>` or the CI pull-request base) — the growth check cannot be skipped silently.",
			],
			failed: true,
		};
	return {
		lines: [
			"i18n/literal-allowance.json: the growth check DID NOT RUN — no base ref resolved (no `--allowance-base`, no CI pull-request base, and no `origin/main` in this checkout), so ids added since the base are not compared here. Pass `--allowance-base <ref>` to run it.",
		],
		failed: false,
	};
}

function toCount(value) {
	return Array.isArray(value) ? value.length : 0;
}

/**
 * The review-visible diff between the old ceilings and a capture, as lines.
 *
 * `--init --force` exists for a scanner-coverage change, and a capture that
 * printed only totals would let a RAISE pass review as a number nobody can
 * diff. Listing every added / raised / lowered / pruned entry is what makes a
 * raise an explicit, reviewable baseline edit rather than a silent one.
 */
function captureSummary(previous, counts) {
	const added = [];
	const raised = [];
	const lowered = [];
	const pruned = [];
	for (const rel of Object.keys(counts).sort()) {
		const next = counts[rel];
		if (!Object.prototype.hasOwnProperty.call(previous, rel)) {
			added.push(`${rel}: ${next}`);
			continue;
		}
		const before = previous[rel];
		if (next > before) raised.push(`${rel}: ${before} -> ${next}`);
		else if (next < before) lowered.push(`${rel}: ${before} -> ${next}`);
	}
	for (const rel of Object.keys(previous).sort()) {
		if (!Object.prototype.hasOwnProperty.call(counts, rel)) {
			pruned.push(`${rel}: ${previous[rel]} -> 0`);
		}
	}
	const lines = [];
	const section = (label, entries) => {
		lines.push(`${label} ${entries.length}:`);
		for (const entry of entries) lines.push(`  ${entry}`);
	};
	section("added", added);
	section("raised", raised);
	section("lowered", lowered);
	section("pruned", pruned);
	return lines;
}

/**
 * The counted set a writing mode acts on.
 *
 * `counts` is the fixture seam. `--update` and `--init` rewrite a baseline from
 * whatever the tree counts, and this tree's own counted set is now EMPTY: the
 * migration finished, so no product file sits below a ceiling any more. A
 * live-corpus input therefore leaves the lowering, raising and pruning branches
 * with nothing to act on — which is exactly how `check-strings.test.mjs` went red
 * at the first head where the ratchet reached zero. The suite passes a scanned
 * fixture corpus instead, so those branches stay exercised regardless of what
 * the product tree happens to contain, while the CLI's own runs (no `counts`)
 * keep scanning the real tree through the same code path.
 */
function countedFiles(counts, entries) {
	if (counts !== undefined) return counts;
	const { api, snapshot } = openSnapshot(REPO);
	try {
		return countsOf(scanSnapshot(snapshot, REPO), entries);
	} finally {
		api.close();
	}
}

export function main(
	argv,
	{
		baselinePath = BASELINE,
		allowlistPath = ALLOWLIST,
		counts: fixtureCounts,
		allowancePath = LITERAL_ALLOWANCE,
	} = {},
) {
	let mode = "check";
	let force = false;
	let allowanceBase;
	const updatePaths = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--init") mode = "init";
		else if (arg === "--update") {
			mode = "update";
			while (
				argv[index + 1] !== undefined &&
				!argv[index + 1].startsWith("--")
			) {
				updatePaths.push(argv[++index]);
			}
		} else if (arg === "--force") force = true;
		else if (arg === "--prune-allowance") mode = "prune-allowance";
		else if (arg === "--allowance-base") {
			allowanceBase = argv[index + 1];
			if (!allowanceBase) {
				process.stderr.write(
					"check-strings.mjs: --allowance-base needs a ref\n",
				);
				return 2;
			}
			index += 1;
		} else if (arg.startsWith("--allowance-base=")) {
			allowanceBase = arg.slice("--allowance-base=".length);
		} else if (arg === "--help" || arg === "-h") {
			process.stdout.write(
				"usage: node scripts/i18n/check-strings.mjs [--init [--force]] [--update <path>…]\n" +
					"       node scripts/i18n/check-strings.mjs [--allowance-base <ref>]\n" +
					"       node scripts/i18n/check-strings.mjs --prune-allowance\n",
			);
			return 0;
		} else {
			process.stderr.write(`check-strings.mjs: unknown argument ${arg}\n`);
			return 2;
		}
	}

	if (mode === "init") {
		// ANY existing baseline refuses without --force — an empty file must
		// not read as "no baseline" (the core's round-1 n3 lesson, kept).
		let exists = true;
		try {
			readFileSync(baselinePath);
		} catch {
			exists = false;
		}
		if (exists && !force) {
			process.stdout.write(
				"check-strings.mjs --init: a baseline already exists; use --force only for a " +
					"reviewed scanner-coverage change (say so in the PR body).\n",
			);
			return 2;
		}
		const entries = loadAllowlist(allowlistPath);
		const counts = countedFiles(fixtureCounts, entries);
		const preserved = loadBaseline(baselinePath);
		saveBaseline(baselinePath, counts, BASELINE_NOTE);
		const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
		process.stdout.write(
			`check-strings.mjs --init: baseline written: ${Object.keys(counts).length} ` +
				`file(s), ${total} literal(s)\n`,
		);
		for (const line of captureSummary(preserved.files, counts)) {
			process.stdout.write(`${line}\n`);
		}
		return 0;
	}

	if (mode === "prune-allowance") {
		const { api, snapshot } = openSnapshot(REPO);
		let result;
		try {
			const scanned = scanSnapshot(snapshot, REPO);
			result = pruneLiteralAllowance(scanned, { allowancePath });
		} finally {
			api.close();
		}
		if (result.problems.length > 0) {
			for (const problem of result.problems)
				process.stdout.write(`check-strings.mjs: ${problem}\n`);
			return 1;
		}
		if (result.removed === 0) {
			process.stdout.write(
				"check-strings.mjs --prune-allowance: nothing to lower — every listed id is still found.\n",
			);
			return 0;
		}
		const emptied =
			result.removedEntries > 0
				? ` and ${result.removedEntries} emptied entr(y/ies)`
				: "";
		process.stdout.write(
			`check-strings.mjs --prune-allowance: removed ${result.removed} id(s)${emptied}. It never adds; extract the string instead.\n`,
		);
		return 0;
	}

	if (mode === "update") {
		if (updatePaths.length === 0) {
			process.stderr.write(
				"check-strings.mjs --update: name at least one path\n",
			);
			return 2;
		}
		const entries = loadAllowlist(allowlistPath);
		const counts = countedFiles(fixtureCounts, entries);
		const loaded = loadBaseline(baselinePath);
		const files = loaded.files;
		for (const raw of updatePaths) {
			const rel = toPosix(raw);
			if (allowlistReason(rel, entries) !== undefined) {
				process.stdout.write(
					`check-strings.mjs --update: ${rel} is allowlisted; nothing to lower\n`,
				);
				continue;
			}
			const next = counts[rel] ?? 0;
			const previous = Object.prototype.hasOwnProperty.call(files, rel)
				? files[rel]
				: undefined;
			if (previous === undefined) {
				if (next > 0) {
					process.stdout.write(
						`check-strings.mjs --update: ${rel} has ${next} literal(s) with no recorded ceiling — a file with no recorded ceiling fails: extract, pragma, or allowlist instead of recording one.\n`,
					);
					return 1;
				}
				continue;
			}
			if (next > previous) {
				process.stdout.write(
					`check-strings.mjs --update: ${rel} went ${previous} -> ${next}; the baseline may only stay equal or go down.\n`,
				);
				return 1;
			}
			if (next > 0) files[rel] = next;
			else delete files[rel];
		}
		saveBaseline(baselinePath, files, loaded.note);
		process.stdout.write(
			`check-strings.mjs --update: baseline now ${Object.keys(files).length} file(s)\n`,
		);
		return 0;
	}

	const result = runCheck({ allowancePath });
	const { scanned, counts, failures } = result;
	for (const failure of failures) {
		process.stdout.write(`${findingLine(failure)}\n`);
		const details = (scanned.get(failure.path) ?? []).filter(
			(finding) => !governedByAllowance(finding.kind),
		);
		for (const detail of details.slice(0, 40)) {
			process.stdout.write(
				`  ${failure.path}:${detail.line}: ${detail.kind} ${JSON.stringify(detail.text)}\n`,
			);
		}
	}
	let failed = failures.length > 0;
	if (failed) process.stdout.write(`${failureSummary(failures)}\n`);

	for (const problem of result.allowanceProblems) {
		process.stdout.write(`i18n/literal-allowance.json: ${problem}\n`);
		failed = true;
	}
	const base = resolveAllowanceBase(allowanceBase);
	const baseReport = allowanceBaseReport(base);
	for (const line of baseReport.lines) process.stdout.write(`${line}\n`);
	if (baseReport.failed) failed = true;
	const growth =
		base.ref === null
			? []
			: checkAllowanceGrowth(base.ref, {
					allowancePath,
					allowance: result.allowance,
				});
	for (const line of growth) {
		process.stdout.write(`i18n/literal-allowance.json: ${line}\n`);
		failed = true;
	}
	for (const finding of result.unlisted) {
		process.stdout.write(
			`${finding.path}:${finding.line}: ${finding.kind} ${JSON.stringify(finding.text)} — not in i18n/literal-allowance.json\n`,
		);
		failed = true;
	}
	for (const entry of result.stale) {
		process.stdout.write(
			`i18n/literal-allowance.json: ${entry.file} lists ${entry.ids.length} id(s) no longer found (${entry.ids.slice(0, 3).join(", ")}${entry.ids.length > 3 ? ", …" : ""}) — the allowance can only shrink\n`,
		);
		failed = true;
	}
	if (failed) {
		const summary = allowanceSummary({ ...result, growth });
		if (summary) process.stdout.write(`${summary}\n`);
		return 1;
	}
	const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
	const owed = [...scanned].flatMap(([rel, findings]) =>
		findings
			.filter((finding) => governedByAllowance(finding.kind))
			.map(() => rel),
	).length;
	/* The ok line must not read as a comparison that did not run: the gap line
	 * above says the same thing, and a reader who skipped it reads it here
	 * (agent review round 1, M1). */
	const growthNote =
		base.ref === null
			? "; the growth comparison against the base DID NOT run (see above)"
			: "";
	process.stdout.write(
		`check-strings.mjs: ok — ${scanned.size} file(s) scanned, ${total} literal(s) at or below the baseline; ${owed} literal(s) in the data shapes, all listed in i18n/literal-allowance.json (shrink-only)${growthNote}\n`,
	);
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
