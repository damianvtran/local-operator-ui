import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

/*
 * THE `$skill` ROW'S BEHAVIOURS, driven through the SHIPPED transcript.
 *
 * `scripts/skill-row.test.mjs` asserts what the payload READS as; this file
 * asserts what a reader gets when the shipped row component paints it:
 *
 *   1. that the bubble shows the typed line and the skill's own purpose rather
 *      than the payload it was sent from — the header sentence, the `<skill>`
 *      tag and the whole SKILL.md body must not be in the document at all
 *      (the harness repo's `docs/design/history-fold-convergence.md` row D8, the
 *      defect the row exists to remove);
 *   2. that the instructions are one press away, and that the press puts them
 *      back — the collapsed body is UNMOUNTED, not merely hidden
 *      (`Disclosure` renders `isOpen && children`), which is what keeps a long
 *      SKILL.md out of a windowed transcript until it is asked for;
 *   3. that the turn's own COPY is the typed line, because an invocation is
 *      still the reader's message: copying a wall of skill body is the same
 *      defect in another surface;
 *   4. that an ordinary message is untouched — no seal, no disclosure, the text
 *      verbatim — which is the gate the recogniser has to keep.
 *
 * WHY A MOUNT AND NOT A FRAME. A frame says what the two states look like; it
 * cannot say that the body is unmounted while collapsed, nor what a press
 * copies. jsdom has no layout engine, so nothing here is geometry evidence —
 * the frames carry the pixels and this file carries the transitions. The
 * harness is `turn-collapse-behaviour.test.mjs`'s (same component, same
 * reasons), trimmed to the parts this file needs.
 */
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
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const bundle = await build({
	stdin: {
		contents:
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
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
		/* External so the provider here and the hook inside the bundle resolve to
		 * ONE copy: a bundled second copy carries a different React context object
		 * and `useQuery` would not find the client this file seeds. */
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(`./_skill-seal-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { CanonicalTranscript } = await import(bundlePath.href);
await unlink(bundlePath);

/*
 * Patterns the assertions below match against, hoisted to module scope so each is
 * compiled once (`lint/performance/useTopLevelRegex`). None carries the `g` or
 * `y` flag, so reusing one across calls has no `lastIndex` state to leak.
 */
const BODY_HEADING_RE = /Seal demo/;
const BODY_LINE_PLAIN_RE = /Answer with one line/;
const BODY_LINE_RE = /Answer with one line\./;
const FRONT_MATTER_KEY_RE = /name: seal-demo/;
const FRONT_MATTER_PURPOSE_RE = /description: Review a diff/;
const HEADER_SENTENCE_RE = /The user invoked/;
const INSTRUCTIONS_LABEL_RE = /Skill instructions sent with this message/;
const PAYLOAD_SKILL_TAG_RE = /<skill name=/;
const PAYLOAD_CLOSE_TAG_RE = /<\/skill>/;
const PURPOSE_RE = /Review a diff for the seal demo/;
const REQUEST_RE = /review the diff/;
const TOKEN_RE = /\$seal-demo/;
/** A line no reader typed: the payload, read back. */
const SEAL_TEXT = "$seal-demo review the diff";
/** An ordinary message that merely NAMES a skill: not a payload, so it is painted verbatim. */
const PLAIN_TEXT = "plain words about $seal-demo and its payload";

/* ------------------------------- fixtures ------------------------------- */

const TS = 1_000_000;

/*
 * The payload as the wire holds it: the header sentence, the attribute-carrying
 * tag, the SKILL.md file verbatim (front matter included — the resolver returns
 * the file, not a stripped copy) and the request last. A LITERAL, like the
 * fixtures in the other two `$skill` suites: an expectation recomputed from the
 * code under test would pin nothing.
 */
const SKILL_PAYLOAD = [
	"The user invoked the `seal-demo` skill directly. Follow it for this request. Its reference files, if any, are listed at the end of the body and are read with `skill://<name>/<path>`.",
	'<skill name="seal-demo" invocation="$seal-demo review the diff">',
	"---\nname: seal-demo\ndescription: Review a diff for the seal demo\n---\n\n# Seal demo\n\nAnswer with one line.\n</skill>",
	"review the diff",
].join("\n");

/** The record the reducer stamps for that payload (`transcript-reducer.ts`). */
const SKILL_RECORD = {
	kind: "user",
	id: "u-seal",
	ts: TS,
	text: SKILL_PAYLOAD,
	images: [],
	skill: {
		name: "seal-demo",
		token: "$seal-demo",
		request: "review the diff",
		purpose: "Review a diff for the seal demo",
		body: "# Seal demo\n\nAnswer with one line.",
	},
};

/**
 * A BARE invocation: the payload's request is empty and its SKILL.md carries no
 * `description:`, so the row is the token alone (review round 1's D3' case).
 *
 * UX round 1's NIT 2 reported that such a row offers no Copy or Quote, on the
 * reading that `isQuotable` saw an empty body. It sees the TYPED LINE here, not
 * the payload, so the row has words to offer — pinned below rather than assumed.
 */
const BARE_PAYLOAD = [
	"The user invoked the `seal-bare` skill directly. Follow it for this request. Its reference files, if any, are listed at the end of the body and are read with `skill://<name>/<path>`.",
	'<skill name="seal-bare" invocation="$seal-bare">',
	"---\nname: seal-bare\n---\n\n# Seal bare\n\nNo description above.\n</skill>",
	"",
].join("\n");

const BARE_RECORD = {
	kind: "user",
	id: "u-bare",
	ts: TS,
	text: BARE_PAYLOAD,
	images: [],
	skill: {
		name: "seal-bare",
		token: "$seal-bare",
		request: "",
		purpose: null,
		body: "# Seal bare\n\nNo description above.",
	},
};

const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
});

const written = [];

const mount = async (t, records) => {
	const mounted = {};
	t.after(async () => {
		await act(async () => {
			mounted.root?.unmount();
		});
		mounted.container?.remove();
	});
	mounted.container = document.createElement("div");
	document.body.appendChild(mounted.container);
	Object.defineProperty(window.navigator, "clipboard", {
		configurable: true,
		value: {
			writeText: async (text) => {
				written.push(text);
			},
		},
	});
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		mounted.root = createRoot(mounted.container);
	});
	await act(async () => {
		mounted.root.render(
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
					containerRef: { current: mounted.container },
					isSmallView: false,
					status: "live",
					failure: null,
					awaitingHydration: false,
					onReconnect: () => {},
				}),
			),
		);
	});
	mounted.text = () => mounted.container.textContent ?? "";
	mounted.seal = () =>
		mounted.container.querySelector("button[aria-expanded]") ?? null;
	/*
	 * The press the reader makes: the same pointer sequence every behaviour suite
	 * here uses, on the disclosure's own trigger. `aria-expanded` is then the
	 * component's own report of the state it painted.
	 */
	mounted.press = async (element) => {
		await act(async () => {
			element.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
	};
	return mounted;
};

/* -------------------------------- the cases ------------------------------ */

const INSTRUCTIONS_LABEL = "Skill instructions sent with this message";

test("the invocation paints the typed line, not the payload it was sent from", async (t) => {
	const mounted = await mount(t, [SKILL_RECORD]);
	const text = mounted.text();
	// The line, in the composer's own token, and the skill's own purpose.
	assert.match(text, TOKEN_RE);
	assert.match(text, PURPOSE_RE);
	// And the request, which is the reader's own words.
	assert.match(text, REQUEST_RE);
	// Nothing of the payload: not the header sentence, not the tag, not the body.
	assert.doesNotMatch(text, HEADER_SENTENCE_RE);
	assert.doesNotMatch(text, PAYLOAD_SKILL_TAG_RE);
	assert.doesNotMatch(text, PAYLOAD_CLOSE_TAG_RE);
	assert.doesNotMatch(text, FRONT_MATTER_KEY_RE);
	assert.doesNotMatch(text, BODY_LINE_PLAIN_RE);
	// The instructions are behind the row's own disclosure, closed by default.
	const seal = mounted.seal();
	assert.notEqual(seal, null, "the seal's disclosure is on the row");
	assert.equal(seal.getAttribute("aria-expanded"), "false");
});

test("the press discloses the instructions, and puts them back", async (t) => {
	const mounted = await mount(t, [SKILL_RECORD]);
	const seal = mounted.seal();
	assert.equal(
		mounted.text().includes(INSTRUCTIONS_LABEL),
		false,
		"closed: the label is not in the document",
	);
	await mounted.press(seal);
	assert.equal(seal.getAttribute("aria-expanded"), "true");
	const opened = mounted.text();
	assert.match(opened, INSTRUCTIONS_LABEL_RE);
	// The body, as the markdown it is: the heading renders as a heading, and the
	// front matter the payload carries is not part of it.
	assert.match(opened, BODY_HEADING_RE);
	assert.match(opened, BODY_LINE_RE);
	assert.doesNotMatch(opened, FRONT_MATTER_PURPOSE_RE);
	await mounted.press(seal);
	assert.equal(seal.getAttribute("aria-expanded"), "false");
	assert.equal(
		mounted.text().includes(INSTRUCTIONS_LABEL),
		false,
		"closed again: the block is unmounted, not hidden",
	);
});

test("Copy gives the typed line, not the payload", async (t) => {
	const mounted = await mount(t, [SKILL_RECORD]);
	const copy = mounted.container.querySelector(
		'[data-lo-user-actions] button[aria-label="Copy"]',
	);
	assert.notEqual(copy, null, "the user row's own Copy control");
	await mounted.press(copy);
	assert.deepEqual(written, [SEAL_TEXT]);
});

test("an ordinary message keeps its text and gains no seal", async (t) => {
	const mounted = await mount(t, [
		{
			kind: "user",
			id: "u-plain",
			ts: TS,
			text: PLAIN_TEXT,
			images: [],
		},
	]);
	assert.equal(mounted.text().includes(PLAIN_TEXT), true);
	assert.equal(mounted.seal(), null, "no disclosure on a plain message");
});

test("a bare invocation is the token alone, and still offers Copy", async (t) => {
	// The clipboard spy is module state, so an earlier case's copy is still in it.
	written.length = 0;
	const mounted = await mount(t, [BARE_RECORD]);
	const text = mounted.text();
	assert.match(text, /\$seal-bare/);
	assert.equal(
		text.includes("No description above"),
		false,
		"the body is behind the disclosure, closed by default",
	);
	assert.equal(
		text.includes("\u00b7"),
		false,
		"no orphan separator without a purpose",
	);
	const copy = mounted.container.querySelector(
		'[data-lo-user-actions] button[aria-label="Copy"]',
	);
	assert.notEqual(copy, null, "a bare invocation still has words to copy");
	await mounted.press(copy);
	assert.deepEqual(written, ["$seal-bare"]);
});
