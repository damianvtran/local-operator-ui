import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

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
// The plugin is prepended to whichever hoisted array the selector chose, so it
// precedes every plugin in it, and only when the caller opted into citations.
const INK_PREPENDED =
	/\[\[remarkSkillInk, \{ names: inkKey\.split\("\\0"\) \}\], \.\.\.base\]/;
const INK_ONLY_FOR_CITATIONS = /citations && skillNames/;
const HOISTED_ARRAY_MENTION = /^const GFM_[A-Z_]+ = \[[^\]]*remarkSkillInk/m;

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

/* ------------------------------ trap 3: copy and DOM ----------------------- */

test("trap 3: the DOM text is the source, the span is the one class, and nothing is inserted", async () => {
	const typed = "use $research then $code-review to check $5";
	const mounted = await both(typed, ["research", "code-review"]);
	assert.equal(mounted.container.textContent, typed);
	const spans = [...mounted.container.querySelectorAll(INK_SELECTOR)];
	assert.equal(spans.length, 2);
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

test("trap 3: Copy and Quote read the record, and the typed line is what they hold", () => {
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
	// And the plugin is wired ahead of everything in the selected array, for the
	// user-turn (citations) pipelines only.
	assert.match(RENDERER, INK_PREPENDED);
	assert.match(RENDERER, INK_ONLY_FOR_CITATIONS);
	assert.doesNotMatch(RENDERER, HOISTED_ARRAY_MENTION);
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
