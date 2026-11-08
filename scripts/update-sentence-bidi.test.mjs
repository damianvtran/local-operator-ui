/**
 * A COMPOSED SENTENCE'S BACKTICK TOKENS ARE ISOLATED AT THE RENDER SITE, NOT IN
 * STORAGE (issue #1762).
 *
 * WHY THIS FILE EXISTS. `ui.updates.service.server_failure.rebuild_unchanged` says
 * "its `.lop-source` still names the same revision", and in `ur` that sentence is
 * rendered into an RTL paragraph (the document root carries `dir="rtl"`). The
 * token's leading full stop is a neutral between RTL text and an LTR letter, so
 * UAX #9 rule N1 gives it the paragraph direction and it prints on the far side of
 * the token - `lop-source.` instead of `.lop-source`. The Urdu catalogue "fixed"
 * that by storing two LRMs around the token; the `ur` activation guard
 * (`scripts/i18n/ur-activation.test.mjs`) fails the build on exactly that, because
 * the i18n policy says a stored value is logical order and carries no manual bidi
 * control. Both rules are right, so the control moved out of the string and into
 * the DOM: `isolatedTokenParts` finds the tokens and `update-notification.tsx`
 * wraps each in `<bdi dir="ltr">`, which is what `bdi` is for.
 *
 * WHAT IS PROVEN
 * 1. The splitter keeps every byte: text and token parts concatenate back to the
 *    input, and a token keeps its backticks so the panel's copy is unchanged
 *    apart from where the glyphs land.
 * 2. FAIL-SAFE: a sentence with no token, or with an odd backtick, is ONE text part
 *    - it renders exactly as it does today rather than half-isolated.
 * 3. NEGATIVE CONTROL: the splitter does not launder storage. Fed the value that
 *    shipped before this fix (LRMs included) it returns a token that still CONTAINS
 *    the controls, so the storage rule stays the guard's job and cannot be
 *    satisfied by rendering.
 * 4. THE REAL STRING: the shipped `ur` value splits so that `.lop-source` is its own
 *    token and carries no bidi control - the two facts the render site depends on.
 * 5. STATIC GUARD: `update-notification.tsx` renders the failure sentence through
 *    `<IsolatedTokens>` and never as a bare expression, so a later edit cannot drop
 *    the isolate while the copy still relies on it.
 *
 * WHAT IS NOT PROVEN HERE, and why: the reordering itself is the browser's UAX #9
 * implementation. The PR body carries the fribidi (`--rtl`) before/after, which is
 * the same discriminator the translation receipt used; a headless run of the panel
 * would prove layout, not the bidi algorithm, and no browser was launched for this
 * change.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/utils/update-error-copy";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});

const { isolatedTokenParts } = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

const MANUAL_BIDI = /[\u200e\u200f\u2066\u2067\u2068\u2069]/;

/**
 * A `{failure.sentence}` child in the panel - the form that drops the isolate.
 *
 * NO `text=` EXEMPTION (review round 1, M2). An earlier cut let `text={failure.sentence}`
 * through on the theory that a component taking the sentence as a `text` PROP would
 * isolate it itself. Nothing does: the panel has no such prop, so the exemption was
 * never exercised - it was a hole in the guard waiting for the first bare render to
 * arrive wearing a prop name. The needle is a braced EXPRESSION CHILD; a prop cannot
 * be one, so the exemption bought nothing and is gone.
 */
const BARE_SENTENCE_CHILD = /\{failure\.sentence\}/g;

/** The isolate itself, so the guard reads the element rather than a comment. */
const BDI_ISOLATE = /<bdi key=\{part\.at\} dir="ltr">/;

/** A `bdi` with no `dir` at all - the auto-direction form review round 1 M1 measured. */
const AUTO_BDI = /<bdi(?![^>]*\bdir=)/g;

/**
 * The sentence wrapper that carries NO direction of its own, open and close.
 *
 * A `<span>` is inline with `unicode-bidi: normal`, so the sentence resolves in the
 * paragraph's direction; the closing tag is asserted too, because a stray `</span>`
 * would mean the wrapper is not the element this guard thinks it is.
 */
const SPAN_WRAPPER = /<span>/;
const SPAN_WRAPPER_END = /<\/span>\s*$/;

const urCatalogue = JSON.parse(
	readFileSync("src/i18n/catalogues/ur/ui.updates.service.json", "utf8"),
);
const KEY = "ui.updates.service.server_failure.rebuild_unchanged";

/** The value this fix replaces, reconstructed byte for byte from the receipt. */
const SHIPPED_WITH_LRMS =
	"دوبارہ تعمیر مکمل ہو گئی لیکن اس تنصیب میں کوئی تبدیلی نہیں آئی: اس کی \u200e`.lop-source`\u200e اب بھی وہی ریویژن بتاتی ہے۔";

test("the splitter keeps every byte and isolates backtick tokens whole", () => {
	const sentence = "Ran `.lop-source` and `lop-update` on the same install.";
	const parts = isolatedTokenParts(sentence);
	assert.deepEqual(parts, [
		{ kind: "text", text: "Ran ", at: 0 },
		{ kind: "token", text: "`.lop-source`", at: 4 },
		{ kind: "text", text: " and ", at: 17 },
		{ kind: "token", text: "`lop-update`", at: 22 },
		{ kind: "text", text: " on the same install.", at: 34 },
	]);
	// `at` is where the part really starts, which is what makes it a stable key.
	assert.ok(sentence.slice(parts[1].at).startsWith("`.lop-source`"));
	assert.equal(
		parts.map((part) => part.text).join(""),
		sentence,
		"the parts must concatenate back to the sentence, so isolation cannot lose copy",
	);
	// Backticks stay INSIDE the token: the panel shows them literally today, and
	// this change is about which side of the token its punctuation lands on.
	assert.ok(parts[1].text.startsWith("`") && parts[1].text.endsWith("`"));
});

test("a sentence with no token, or an odd backtick, is one plain text part", () => {
	for (const sentence of [
		"The update check could not finish.",
		"One `unbalanced backtick only",
	]) {
		assert.deepEqual(isolatedTokenParts(sentence), [
			{ kind: "text", text: sentence, at: 0 },
		]);
	}
	// Nothing to render is nothing to render, not an empty text node.
	assert.deepEqual(isolatedTokenParts(""), []);
});

test("NEGATIVE CONTROL: the splitter does not launder a stored bidi control", () => {
	// The pre-fix value, exactly as it shipped. If this ever passed as a clean
	// token, the storage rule would be enforceable only by rendering order, which
	// is the confusion this fix removes.
	assert.ok(
		MANUAL_BIDI.test(SHIPPED_WITH_LRMS),
		"the reconstructed pre-fix value must carry LRMs, or this control proves nothing",
	);
	// The LRMs sat OUTSIDE the backticks, so they land in a text part beside the
	// token - which is the point: the splitter moves nothing and strips nothing.
	// Isolation is a DOM rule, so the storage rule has to stay the guard's job.
	const parts = isolatedTokenParts(SHIPPED_WITH_LRMS);
	const rejoined = parts.map((part) => part.text).join("");
	assert.equal(
		rejoined,
		SHIPPED_WITH_LRMS,
		"splitting must not drop or rewrite a stored character",
	);
	assert.ok(
		MANUAL_BIDI.test(rejoined),
		"the controls survive splitting: rendering order cannot launder a stored control",
	);
	assert.ok(
		parts.some((part) => part.kind === "token"),
		"the pre-fix value still yields the token, so the isolate has something to wrap",
	);
});

test("the shipped urdu value isolates the dotfile token and stores no control", () => {
	const value = urCatalogue[KEY];
	assert.ok(value, "the ur catalogue has no rebuild_unchanged value");
	assert.ok(
		!MANUAL_BIDI.test(value),
		"the stored value carries a manual bidi control - the ur activation guard fails on this",
	);
	const token = isolatedTokenParts(value).find((part) => part.kind === "token");
	assert.equal(
		token?.text,
		"`.lop-source`",
		"the dotfile must be its own token, or the render site has nothing to isolate",
	);
	assert.ok(
		!MANUAL_BIDI.test(token.text),
		"the token itself must be clean: the isolate is a DOM element, not a character",
	);
});

test("STATIC GUARD: the panel renders the failure sentence only through the isolate", () => {
	const source = readFileSync(
		"src/renderer/src/shared/components/common/update-notification.tsx",
		"utf8",
	);
	// `{isolatedTokenNodes(failure.sentence)}` is the isolated form; a BARE
	// `{failure.sentence}` as a child is the one that renders without the isolate.
	const bare = source.match(BARE_SENTENCE_CHILD) ?? [];
	assert.deepEqual(
		bare,
		[],
		"a bare {failure.sentence} drops the bidi isolate this fix exists to add",
	);
	const isolated =
		source.match(/\{isolatedTokenNodes\(failure\.sentence\)\}/g) ?? [];
	assert.ok(
		isolated.length >= 2,
		`expected both failure paragraphs to isolate the sentence, found ${isolated.length}`,
	);
	assert.match(
		source,
		BDI_ISOLATE,
		'the token must render inside <bdi dir="ltr">',
	);
});

/**
 * The wrapper element `isolatedTokenNodes` actually returns, so a guard can read it.
 *
 * Comments are stripped: this block explains the `bdi` defect in prose, and a guard that
 * read the prose would either pass on a comment or fail on one - neither is a fact about
 * the markup. `dir` on `bdi` defaults to AUTO, so only the JSX can answer the question.
 */
const sentenceWrapper = (() => {
	const source = readFileSync(
		"src/renderer/src/shared/components/common/update-notification.tsx",
		"utf8",
	);
	const start = source.indexOf("const isolatedTokenNodes");
	return start === -1
		? ""
		: source
				.slice(start, source.indexOf("\n);", start))
				.replace(/\/\*[\s\S]*?\*\//g, "");
})();

test("REGRESSION (review round 1, M1): the wrapper inherits direction, it never auto-detects it", () => {
	assert.ok(
		sentenceWrapper,
		"isolatedTokenNodes is not in the shape this guard reads - fix the guard, it is checking nothing",
	);
	/*
	 * `dir` on a `bdi` DEFAULTS TO THE AUTO STATE, so a bare `<bdi>` is an isolate whose
	 * direction comes from the sentence's own FIRST STRONG character rather than the
	 * paragraph's. That is invisible for today's value and wrong the moment a sentence
	 * opens with a strong-L run - `not_effective` opens with `{target}`, `exited` with an
	 * exit code - which is the defect review round 1 M1 measured.
	 */
	assert.deepEqual(
		sentenceWrapper.match(AUTO_BDI) ?? [],
		[],
		"<bdi> with no dir is dir=\"auto\": it takes the sentence's first strong character instead of the paragraph's direction",
	);
	// A `<span>` is inline with `unicode-bidi: normal` and carries no direction of its
	// own, so the sentence resolves in the paragraph's direction whatever it starts with.
	assert.match(
		sentenceWrapper,
		SPAN_WRAPPER,
		"the sentence wrapper must be a <span> - the element that has no direction of its own",
	);
	assert.match(
		sentenceWrapper,
		SPAN_WRAPPER_END,
		"the sentence wrapper must close on </span>, or it is wrapping something else",
	);
});
