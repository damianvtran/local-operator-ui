import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/*
 * THE `$skill` TOKEN INK IN A SENT TURN (operator ask, 2026-11-03).
 *
 * A turn that invoked a skill used to read back as plain prose, so nothing in the
 * bubble said which words were the skill. `remark-skill-ink.ts` now wraps each
 * `$name` the turn ATTACHED in `span.lo-skill-token`, which `markdown.css` paints
 * in the `tokenCommand` role at weight 600.
 *
 * WHAT IS REAL: the shipped `MarkdownRenderer` (all four user-turn pipelines, math
 * on and off) and the shipped `CanonicalTranscript`, bundled from source by esbuild
 * and mounted in jsdom; the fixtures' invocation block is built by the app's own
 * `renderSkillBlock`, so the wire shape cannot drift from this file.
 *
 * WHAT IS NOT: colour and weight. jsdom has no cascade over a stylesheet the
 * bundler empties, so the paint is pinned as a source contract on `markdown.css`
 * and judged in the frames under `docs/pr-evidence/skill-token-ink/`.
 *
 * EVERY CASE CARRIES ITS NEGATIVE CONTROL: the same content rendered with no
 * `skillNames` (the plugin never enters the pipeline) must show no ink, so a pass
 * is the plugin's doing and not a property of the fixture.
 */
const CSS = readFileSync(
	"src/renderer/src/features/chat/components/markdown.css",
	"utf8",
);
const RENDERER = readFileSync(
	"src/renderer/src/features/chat/components/markdown-renderer.tsx",
	"utf8",
);

const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
const originals = new Map();
const shims = {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	Node: window.Node,
	Element: window.Element,
	SVGElement: window.SVGElement,
	MouseEvent: window.MouseEvent,
	KeyboardEvent: window.KeyboardEvent,
	FocusEvent: window.FocusEvent,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	localStorage: window.localStorage,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => {
		callback(0);
		return 0;
	},
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	MutationObserver: window.MutationObserver,
	NodeFilter: window.NodeFilter,
	HTMLInputElement: window.HTMLInputElement,
	IntersectionObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	},
	matchMedia: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
};
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= shims.matchMedia;
window.Element.prototype.scrollIntoView = function scrollIntoView() {};
// A module in the renderer's import graph measures a console cell at load; a null
// context is what its own guard handles, and it silences jsdom's stderr noise.
window.HTMLCanvasElement.prototype.getContext = () => null;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const bundle = await build({
	stdin: {
		contents: [
			'export { MarkdownRenderer } from "./src/renderer/src/features/chat/components/markdown-renderer";',
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
			'export { copyTextForRecord } from "./src/renderer/src/features/chat/canonical/transcript-copy";',
			'export { remarkSkillInk } from "./src/renderer/src/features/chat/utils/remark-skill-ink";',
			'export { default as remarkGuardedMath } from "./src/renderer/src/features/chat/components/markdown-math-guarded";',
			'export { renderSkillBlock, skillBlockNames, skillMentions, skillMentionSpans } from "./src/renderer/src/features/chat/components/skill-invocation";',
			'export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		// One copy, so the provider here and the hook inside the bundle share a client.
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_skill-token-ink-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	MarkdownRenderer,
	CanonicalTranscript,
	copyTextForRecord,
	remarkSkillInk,
	remarkGuardedMath,
	renderSkillBlock,
	skillBlockNames,
	skillMentions,
	skillMentionSpans,
	useUiPreferencesStore,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* ------------------------------ top-level patterns ------------------------ */

const INK_SELECTOR = ".lo-skill-token";
const NESTED_INK_SELECTOR = ".lo-skill-token .lo-skill-token";
const INK_RULE = /\.lo-markdown \.lo-skill-token\s*\{([^}]*)\}/;
const CONTENT_DECLARATION = /\bcontent\s*:/;
const TEXT_TRANSFORM = /text-transform/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const COLOR_DECLARATION = /color:\s*var\(--lo-token-command\)/;
const WEIGHT_DECLARATION = /font-weight:\s*600/;
const INK_ONLY_FOR_CITATIONS = /citations && skillNames/;

/* --------------------------------- fixtures ------------------------------- */

const TS = 1_000_000;
const BODY = "# Research\n\nFind the sources and cite them.";

/** The wire shape of an invocation: the typed line, then the tail block. */
const payloadOf = (typed, names) =>
	`${typed}\n\n${renderSkillBlock(names.map((name) => ({ name, body: BODY })))}`;

const userRecord = (id, typed, names) => ({
	kind: "user",
	id,
	ts: TS,
	text: names.length === 0 ? typed : payloadOf(typed, names),
	images: [],
});
const assistantRecord = (id, text) => ({
	kind: "assistant",
	id,
	ts: TS,
	text,
	streaming: false,
	stopReason: "stop",
	error: false,
	complete: true,
});
const toolRecord = (id) => ({
	kind: "tool",
	id,
	ts: TS,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: { command: "ls" },
	phase: "done",
	argumentBytes: 4,
	output: "a\nb\n",
	isError: false,
	durationS: 0.1,
	startedAt: null,
	endedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	neverSent: false,
	notRunReason: null,
});

const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
});

/* --------------------------------- mounting ------------------------------- */

const closers = [];
/*
 * ONE `after` hook, in this order: unmount every root while the shimmed globals
 * still exist (React reads `window` on unmount), then tear the DOM down. Two
 * hooks would run in registration order and unmount against a closed window.
 */
after(async () => {
	for (const close of closers.splice(0)) await close();
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const settle = async () => {
	// The math stylesheet loads in a promise; two turns of the loop commit it.
	for (let tick = 0; tick < 3; tick++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
};

/** A user turn through the shipped MarkdownRenderer, as both callers mount it. */
const renderMarkdown = async (content, extra = {}) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const props = { content, credentialCitations: true, ...extra };
	await act(async () => {
		root.render(h(MarkdownRenderer, props));
	});
	await settle();
	closers.push(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	return {
		container,
		root,
		rerender: async (next) => {
			await act(async () => {
				root.render(h(MarkdownRenderer, { ...props, ...next }));
			});
			await settle();
		},
	};
};

const inked = (container) =>
	[...container.querySelectorAll(INK_SELECTOR)].map((span) => span.textContent);

/**
 * The mounted case and its control in one call: the same content with and without
 * the attached names, so every assertion is paired with proof it can fail.
 */
const both = async (content, names, extra = {}) => {
	const withInk = await renderMarkdown(content, {
		skillNames: names,
		...extra,
	});
	const control = await renderMarkdown(content, extra);
	assert.deepEqual(inked(control.container), [], "control: no names, no ink");
	return withInk;
};

const mountTranscript = async (records) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	let root;
	await act(async () => {
		root = createRoot(container);
	});
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(CanonicalTranscript, {
					frontend: null,
					transcript: transcriptOf(records),
					gate: null,
					waiting: false,
					loadingOlder: false,
					onLoadOlder: async () => true,
					containerRef: { current: container },
					isSmallView: false,
					status: "live",
					failure: null,
					awaitingHydration: false,
					onReconnect: () => {},
				}),
			),
		);
	});
	closers.push(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	return container;
};

/* -------------------------------- trap 1: code ---------------------------- */

test("trap 1: fenced and inline code carry no ink; the same token in prose does", async () => {
	const source = [
		"use $research here",
		"",
		"```",
		"$research --help",
		"```",
		"",
		"and `$research` inline",
	].join("\n");
	const mounted = await both(source, ["research"]);
	assert.deepEqual(inked(mounted.container), ["$research"], "prose only");
	assert.equal(
		mounted.container.querySelectorAll("pre .lo-skill-token").length,
		0,
	);
	assert.equal(
		mounted.container.querySelectorAll("code .lo-skill-token").length,
		0,
	);
	// The code is still there, verbatim.
	assert.equal(
		mounted.container.querySelector("pre code").textContent.trim(),
		"$research --help",
	);
	assert.equal(
		[...mounted.container.querySelectorAll("p code")]
			.map((c) => c.textContent)
			.join(),
		"$research",
	);
});

/* -------------------------------- trap 2: grammar ------------------------- */

test("trap 2: money, shell variables, a lone dollar, a glued dollar and an unattached name get no ink", async () => {
	const source = [
		"$5 and $1,200.50 and $0.30/M",
		"$PATH and a lone $ and costs$5",
		"and $typo",
	].join("\n");
	const mounted = await both(`use $research\n${source}`, ["research"]);
	assert.deepEqual(inked(mounted.container), ["$research"]);
	// And with NO attached skill the same words are untouched prose.
	const plain = await renderMarkdown(source, { skillNames: [] });
	assert.deepEqual(inked(plain.container), []);
});

test("trap 2: a trailing dot is prose; dashed, underscored and dotted names ink whole", async () => {
	const dot = await both("run $research.", ["research"]);
	assert.deepEqual(inked(dot.container), ["$research"]);
	assert.equal(dot.container.textContent, "run $research.");

	for (const name of ["code-review", "my_skill", "v1.2"]) {
		const mounted = await both(`please use $${name} now`, [name]);
		assert.deepEqual(inked(mounted.container), [`$${name}`], name);
	}
});

/* --------------------- position mapping: what the parser consumes ---------- */

/*
 * The plugin maps each source mention onto the text node that holds it, and a text
 * node's value is the source with the parser's own consumption applied. A naive
 * `value index == source offset - node start` mapping inks the WRONG characters
 * (or none) the moment any byte is consumed, so every case here asserts the exact
 * characters inside the span, from the DOM and from the tree's own offsets.
 */

/** The plugin through unified directly, so the tree's offsets can be read back. */
const inkTree = (source, { math = false, names = ["research"] } = {}) => {
	const processor = unified().use(remarkParse).use(remarkGfm);
	if (math) processor.use(remarkGuardedMath);
	processor.use(remarkSkillInk, { names });
	const tree = processor.parse(source);
	processor.runSync(tree, { value: source });
	const tokens = [];
	const visit = (node) => {
		if (node.type === "skillToken") {
			const [text] = node.children;
			tokens.push({
				value: text.value,
				source: source.slice(
					text.position.start.offset,
					text.position.end.offset,
				),
			});
		}
		for (const child of node.children ?? []) visit(child);
	};
	visit(tree);
	return tokens;
};

const ALIGNED = [
	["CRLF line ending", "a\r\nb $research"],
	["lone CR line ending", "a\rb $research"],
	["emoji before the token", "\u{1F600}\u{1F600} $research"],
	["combining and CJK before the token", "e\u0301 \u65e5\u672c $research"],
	["token in a table cell", "| a | b |\n|---|---|\n| x | $research |"],
	["token in a list item", "- item $research\n- other"],
	["token on a list continuation line", "- a\n  b $research"],
	["token in a heading", "# head $research"],
	["bold neighbour text", "**bold** $research **more**"],
	["trailing blank before a line ending", "first $research \nsecond"],
	["trailing blank on the line before the token", "first \nsecond $research"],
	["trailing tab before a line ending", "x\t\ny $research"],
	["hard break by two blanks", "a  \nb $research"],
	["hard break by backslash", "a\\\nb $research"],
	["blockquote continuation marker", "> a\n> b $research"],
	["nested blockquote markers", "> > a\n> > b $research"],
	["a lazy blockquote line", "> a\nb $research"],
	["entity on the token's line", "Hi $research!\nHow &amp; why"],
	["entity before the token", "a &lt; $research"],
	[
		"entities before the token and a long tail",
		"&lt;&gt;&amp; $research and then a long tail of ordinary prose follows",
	],
	["a numeric entity before the token", "&#35; &#x1F600; $research"],
	["a named entity that decodes to two units", "&NotEqualTilde; $research"],
	["an entity after a line ending", "x &amp;\n$research"],
	["an escape and an entity together", "\\&amp; $research &amp;"],
	// Two complete readings (a reference is one unit then a blank, or two units),
	// and the token sits BEFORE the reference, so both readings agree on it (Q3).
	["a reference then an inline code span", "use $research &amp; `c`"],
	["a reference then bold", "use $research &lt; **b**"],
	["a reference then a link", "use $research &amp; [l](http://x.y)"],
	["a reference, two blanks, more text", "$research &amp; `c`  more"],
	// Ambiguity doubles per reference unless the readings are kept as a set (Q4).
	["fourteen references before the token", `${"&amp; ".repeat(14)}$research`],
	[
		"two hundred references before the token",
		`${"&amp; ".repeat(200)}$research`,
	],
	// A continuation line that opens with an escaped `>` (Q5).
	[
		"an escaped `>` opening a quoted continuation line",
		"> a\n> \\> b $research",
	],
	[
		"a decoded `>` opening a quoted continuation line",
		"> a\n> &gt; b $research",
	],
];

for (const [label, source] of ALIGNED) {
	test(`position mapping: ${label} inks exactly the token`, async () => {
		for (const math of [false, true]) {
			assert.deepEqual(
				inkTree(source, { math }),
				[{ value: "$research", source: "$research" }],
				`${label}: the tree's offsets name the typed token (math ${math})`,
			);
		}
		const mounted = await both(source, ["research"]);
		assert.deepEqual(inked(mounted.container), ["$research"], label);
	});
}

test("position mapping: a literal `>` the value holds is never eaten as a quote marker", async () => {
	// `&gt;` decodes to a `>` at the start of the continuation line: skipping it as
	// a marker would shift every later offset. The result is either the right
	// token or no ink, and it is never a span over other characters. This test
	// discriminates only the FINAL guard in `splitText` (value versus source at the
	// reported offsets), not `alignValue`: no input reaches that guard with a wrong
	// alignment (zero hits over ~33k tokens in review), so the ALIGNED table above
	// is what holds `alignValue` honest.
	for (const source of ["> a\n> &gt; b $research", "a\n\\> b $research"]) {
		for (const tokens of [inkTree(source), inkTree(source, { math: true })]) {
			for (const token of tokens) {
				assert.deepEqual(token, { value: "$research", source: "$research" });
			}
		}
		const mounted = await both(source, ["research"]);
		for (const text of inked(mounted.container)) {
			assert.equal(text, "$research", "never ink over other characters");
		}
	}
});

test("position mapping: when alignment cannot be proved the node gets NO ink, and the text is untouched", async () => {
	// Four hundred references that each decode to two units, then the token: the
	// readings fan out past the node's step budget, so the walk gives up. That is
	// the fail-closed path: no ink, never ink on a guess. (A naive offset
	// arithmetic would land the token's length on other characters INSIDE the node
	// and ink them, so the exact-characters assertion below is the discriminator.)
	const source = `${"&NotEqualTilde;".repeat(400)} $research and a tail of prose`;
	assert.deepEqual(inkTree(source), []);
	assert.deepEqual(inkTree(source, { math: true }), []);
	const mounted = await both(source, ["research"]);
	assert.deepEqual(inked(mounted.container), []);
	// The words are all still there: failing to ink must not lose or alter text.
	assert.equal(mounted.container.textContent.includes("$research"), true);
	// And a SECOND, alignable node in the same document still inks: the failure is
	// per node, not per turn.
	const other = await both(`${source}\n\nnext $research`, ["research"]);
	assert.deepEqual(inked(other.container), ["$research"]);
	assert.equal(
		other.container.querySelectorAll("p")[1].querySelector(INK_SELECTOR)
			.textContent,
		"$research",
	);
});

/* --------------------- cost: no input may stall the render path ------------- */

/*
 * `remarkSkillInk` runs on the main thread for any turn that attached a skill, and
 * the text it reads is whatever the reader pasted. The alignment search once cost
 * (character-reference forks) x (the rest of the node): `&amp;` x12 then 49,000
 * dashes took 1.5 s in the plugin alone, 12.8 s at 190,000 characters. It now
 * advances every reading together, so the cost is the node's length times the few
 * readings alive.
 *
 * Only the TRANSFORM is timed: `remark-parse` has its own cost on such input (1.7 s
 * here for the 49,000-dash shape, and it is not this plugin's), so the tree is
 * parsed once and a structured clone is transformed per repetition.
 *
 * The bound is 400 ms on the best of three runs. Measured on this host at a
 * 1-minute load near 50: the new walk 12-60 ms, the old one 935-1,478 ms on these
 * shapes. 400 ms is roughly 7x the slowest new reading and under half the fastest
 * old one; the best of three discards a scheduling spike without hiding a
 * super-linear walk, which is slow on every repetition.
 */
const TRANSFORM_BOUND_MS = 400;

const timedInk = (source) => {
	const processor = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkSkillInk, { names: ["research"] });
	const parsed = processor.parse(source);
	let best = Number.POSITIVE_INFINITY;
	let tokens = [];
	for (let run = 0; run < 3; run++) {
		const tree = structuredClone(parsed);
		const began = performance.now();
		processor.runSync(tree, { value: source });
		best = Math.min(best, performance.now() - began);
		tokens = [];
		const visit = (node) => {
			if (node.type === "skillToken") {
				const [text] = node.children;
				tokens.push({
					value: text.value,
					start: text.position.start.offset,
					end: text.position.end.offset,
				});
			}
			for (const child of node.children ?? []) visit(child);
		};
		visit(tree);
	}
	return { best, tokens };
};

const COST_SHAPES = [
	[
		"twelve `&amp;` then 49,000 dashes",
		`${"&amp;".repeat(12)}${"-".repeat(49_000)} `,
	],
	[
		"twelve `&lt;` then 48,000 characters of short words",
		`${"&lt;".repeat(12)}${"ab ".repeat(16_000)}`,
	],
	[
		"six `&nbsp;` then a 100,000-character pasted block",
		`${"&nbsp;".repeat(6)}${"word ".repeat(20_000)}`,
	],
];

for (const [label, lead] of COST_SHAPES) {
	test(`cost: ${label} is aligned in bounded time and inks exactly the token`, () => {
		const source = `${lead}$research`;
		const token = source.length - "$research".length;
		const { best, tokens } = timedInk(source);
		// Time first, so a regression reports the stall and not just the lost ink.
		assert.ok(
			best < TRANSFORM_BOUND_MS,
			`${label}: best of 3 took ${best.toFixed(0)} ms, bound ${TRANSFORM_BOUND_MS} ms`,
		);
		assert.deepEqual(tokens, [
			{ value: "$research", start: token, end: source.length },
		]);
	});
}

test("cost: a node whose readings outgrow the budget fails closed, fast, and leaves the text alone", () => {
	// 3,000 references that each decode to two units: far past the budget.
	const source = `${"&NotEqualTilde;".repeat(3000)} $research`;
	const { best, tokens } = timedInk(source);
	assert.deepEqual(tokens, []);
	assert.ok(
		best < TRANSFORM_BOUND_MS,
		`best of 3 took ${best.toFixed(0)} ms, bound ${TRANSFORM_BOUND_MS} ms`,
	);
});

/* ------------------------------ trap 3: copy and DOM ----------------------- */

test("trap 3 (the discriminator): copy fidelity - the DOM text equals the source and each span holds exactly the typed characters", async () => {
	const typed = "use $research then $code-review to check $5";
	const mounted = await both(typed, ["research", "code-review"]);
	assert.equal(mounted.container.textContent, typed);
	const spans = [...mounted.container.querySelectorAll(INK_SELECTOR)];
	assert.equal(spans.length, 2);
	assert.deepEqual(
		spans.map((span) => span.textContent),
		["$research", "$code-review"],
	);
	for (const span of spans) {
		assert.deepEqual([...span.classList], ["lo-skill-token"]);
		assert.equal(span.tagName, "SPAN");
		assert.equal(span.children.length, 0, "one text child, no elements");
		assert.equal(span.childNodes.length, 1);
		assert.equal(span.childNodes[0].nodeType, 3);
		assert.equal(span.hasAttribute("style"), false, "no inline colour");
	}
});

test("trap 3: the stylesheet rule uses the theme token and inserts no characters", () => {
	const rule = INK_RULE.exec(CSS);
	assert.ok(rule, "the two-class rule exists");
	assert.match(rule[1], COLOR_DECLARATION);
	assert.match(rule[1], WEIGHT_DECLARATION);
	assert.doesNotMatch(rule[1], HEX, "a role, never a hex");
	assert.doesNotMatch(rule[1], CONTENT_DECLARATION);
	assert.doesNotMatch(rule[1], TEXT_TRANSFORM);
	// No pseudo-element rule for the class anywhere in the sheet.
	assert.equal(CSS.includes(".lo-skill-token::"), false);
	assert.equal(CSS.includes(".lo-skill-token:before"), false);
	assert.equal(CSS.includes(".lo-skill-token:after"), false);
});

test("trap 3 property pin (not a discriminator; passes on main too): Copy and Quote read the record, so the typed line is what they hold", () => {
	const typed = "use $research then $code-review to check $5";
	const record = userRecord("u-copy", typed, ["research", "code-review"]);
	assert.equal(copyTextForRecord(record), typed);
	// The record carries the block; the copy does not.
	assert.ok(record.text.includes("<operator-skills>"));
});

/* ---------------------------- trap 4: escape, many, rerender -------------- */

test("trap 4: an escaped dollar is literal while a later real token inks", async () => {
	const mounted = await both("not \\$research but $research", ["research"]);
	assert.deepEqual(inked(mounted.container), ["$research"]);
	assert.equal(mounted.container.textContent, "not $research but $research");
	// The ink is the SECOND occurrence: the span follows the literal one.
	const p = mounted.container.querySelector("p");
	assert.equal(p.firstChild.textContent.includes("$research"), true);
	assert.equal(
		p.querySelector(INK_SELECTOR).previousSibling.textContent.endsWith("but "),
		true,
	);
});

test("trap 4: several skills ink, with the math pipeline off and on", async () => {
	// Two `$` in one line turns the math gate on (the pipeline selector's decision).
	const typed = "use $research then $code-review";
	const off = await both("use $research", ["research"]);
	assert.deepEqual(inked(off.container), ["$research"]);
	const on = await both(typed, ["research", "code-review"]);
	assert.deepEqual(inked(on.container), ["$research", "$code-review"]);
	assert.equal(on.container.textContent, typed);

	// Math really is on in a case that holds a formula beside a token.
	const withMath = await both("$x^2$ and $research", ["research"]);
	assert.ok(withMath.container.querySelector(".katex"), "math pipeline active");
	assert.deepEqual(inked(withMath.container), ["$research"]);
});

test("trap 4: a repeated skill inks every occurrence", async () => {
	const typed = "$research first, then again $research and $Research";
	const mounted = await both(typed, ["research"]);
	assert.deepEqual(inked(mounted.container), [
		"$research",
		"$research",
		"$Research",
	]);
	assert.equal(mounted.container.textContent, typed);
	// The submit path still dedupes: one body per skill.
	assert.equal(skillMentions(typed, ["research"]).length, 1);
	assert.equal(skillMentionSpans(typed, ["research"]).length, 3);
});

test("trap 4: a re-render, with the same or changed props, leaves one span per token", async () => {
	const typed = "use $research then $code-review";
	const names = ["research", "code-review"];
	const mounted = await renderMarkdown(typed, { skillNames: names });
	assert.equal(mounted.container.querySelectorAll(INK_SELECTOR).length, 2);
	await mounted.rerender({});
	await mounted.rerender({ skillNames: [...names] });
	await mounted.rerender({ className: "unrelated", linkify: false });
	await mounted.rerender({ linkify: true, documentId: "another" });
	assert.equal(mounted.container.querySelectorAll(INK_SELECTOR).length, 2);
	assert.equal(
		mounted.container.querySelectorAll(NESTED_INK_SELECTOR).length,
		0,
	);
	assert.equal(mounted.container.textContent, typed);
	for (const span of mounted.container.querySelectorAll(INK_SELECTOR)) {
		assert.equal(span.childElementCount, 0);
	}
	// And dropping the names drops the ink: the pipeline follows the prop.
	await mounted.rerender({ skillNames: [] });
	assert.equal(mounted.container.querySelectorAll(INK_SELECTOR).length, 0);
});

/* --------------------------- trap 5: both transcript views ---------------- */

test("trap 5: the user row inks in by-turn and in by-response, with a tool turn between", async () => {
	const typed = "use $research then $code-review to check $5 and \\$escaped";
	const records = [
		userRecord("u1", typed, ["research", "code-review"]),
		toolRecord("t1"),
		assistantRecord("a1", "Done with $research and $code-review."),
		userRecord("u2", "second turn with $research", ["research"]),
		toolRecord("t2"),
		assistantRecord("a2", "Final answer mentions $research too."),
	];
	for (const mode of ["by-turn", "by-response"]) {
		useUiPreferencesStore.setState({ transcriptDisplayMode: mode });
		const container = await mountTranscript(records);
		const texts = inked(container);
		assert.deepEqual(
			texts,
			["$research", "$code-review", "$research"],
			`${mode}: both user rows ink, no agent row does`,
		);
		assert.equal(
			container.querySelectorAll(NESTED_INK_SELECTOR).length,
			0,
			mode,
		);
		// Every ink is inside a user row's body, never an agent's.
		assert.equal(
			container.textContent.includes("<operator-skills>"),
			false,
			`${mode}: the block is not painted`,
		);
	}
});

test("trap 5 control: the same transcript without the attached block has no ink", async () => {
	const records = [
		userRecord("u1", "use $research then $code-review", []),
		assistantRecord("a1", "ok"),
	];
	for (const mode of ["by-turn", "by-response"]) {
		useUiPreferencesStore.setState({ transcriptDisplayMode: mode });
		const container = await mountTranscript(records);
		assert.deepEqual(
			inked(container),
			[],
			`${mode}: a prose $name stays plain`,
		);
	}
});

/* -------------------------------- guards ---------------------------------- */

test("ordering: ink survives the linkifier, the citations and the soft breaks behind it", async () => {
	const typed =
		"line one\nline two $research\n   third /tmp/a.txt and $code-review";
	const mounted = await both(typed, ["research", "code-review"]);
	assert.deepEqual(inked(mounted.container), ["$research", "$code-review"]);
	// The soft breaks still become <br>.
	assert.equal(mounted.container.querySelectorAll("br").length, 2);
	// A token beside emphasis and a link keeps its ink too.
	const mixed = await both("*see* [docs](https://example.com) then $research", [
		"research",
	]);
	assert.deepEqual(inked(mixed.container), ["$research"]);
	assert.equal(mixed.container.querySelectorAll("a").length, 1);
	assert.equal(mixed.container.querySelector("a .lo-skill-token"), null);
	// Being FIRST is what the three cases above prove: the linkifier, the citation
	// chips and the soft breaks all emit position-less text nodes, so behind any
	// of them the plugin would find nothing to map by and ink nothing. The one
	// source pin left is that the ink is wired for the user-turn pipelines only.
	assert.match(RENDERER, INK_ONLY_FOR_CITATIONS);
});

test("agent guard: an assistant row never inks, and an unflagged render ignores names", async () => {
	const container = await mountTranscript([
		assistantRecord("a1", "You can run $research or $code-review."),
	]);
	assert.deepEqual(inked(container), []);
	// An agent-facing render (no citations opt-in) is not the user pipeline.
	const agent = await renderMarkdown("run $research", {
		credentialCitations: false,
		skillNames: ["research"],
	});
	assert.deepEqual(inked(agent.container), []);
});

test("the block names are read from the record, and a block body never inks", async () => {
	const text = payloadOf("use $research", ["research"]);
	assert.deepEqual(skillBlockNames(text), ["research"]);
	assert.deepEqual(skillBlockNames("use $research"), []);
	// A body quoting the token is the skill documenting itself, not the reader's
	// token: the whole payload through the renderer inks nothing.
	const quoting = payloadOf("no token here", ["research"]).replace(
		"Find the sources",
		"Run $research",
	);
	assert.equal(quoting.includes("Run $research"), true);
	const mounted = await renderMarkdown(quoting, { skillNames: ["research"] });
	assert.deepEqual(inked(mounted.container), []);
});

test("a legacy seal keeps its single ink: no span is added beside it", async () => {
	const payload = [
		"The user invoked the `seal-demo` skill directly. Follow it for this request. Its reference files, if any, are listed at the end of the body and are read with `skill://<name>/<path>`.",
		'<skill name="seal-demo" invocation="$seal-demo review $seal-demo">',
		"---\nname: seal-demo\ndescription: Review\n---\n\n# Seal demo\n\nBody.\n</skill>",
		"review $seal-demo",
	].join("\n");
	const container = await mountTranscript([
		{
			kind: "user",
			id: "u-legacy",
			ts: TS,
			text: payload,
			images: [],
			skill: {
				name: "seal-demo",
				token: "$seal-demo",
				request: "review $seal-demo",
				purpose: "Review",
				body: "# Seal demo\n\nBody.",
			},
		},
	]);
	assert.deepEqual(inked(container), []);
	assert.equal(container.querySelectorAll(".slash-run-bold").length >= 1, true);
});
