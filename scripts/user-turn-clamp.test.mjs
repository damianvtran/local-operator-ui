import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

/*
 * The long user-turn clamp (D2), mounted through the shipped `CanonicalTranscript`.
 *
 *     node --test scripts/user-turn-clamp.test.mjs
 *
 * THE DEFECT THIS PINS. The first build applied `max-h-[174px] overflow-hidden`
 * only once a layout read had found the box overflowing - but the box it read
 * was uncapped, so `scrollHeight` always equalled `clientHeight` and nothing was
 * ever clamped (measured on the session-switch fixture with `?userLines=12`: 0
 * of 31 user rows capped, a 1,078-character turn at 413px against the 174px
 * cap). And had the read ever succeeded, the cap would have arrived a commit
 * after the first paint: a height jump on open.
 *
 * WHAT A JSDOM MOUNT CAN AND CANNOT SAY. JSDOM has no layout, so the box's
 * geometry is a stated model (`contentHeight` below, eight 80-character lines
 * at D2's 21.7px line), installed as the `scrollHeight`/`clientHeight` getters
 * the component reads. What is asserted is the component's DECISION against
 * that model - which classes the box carries at the moment of its first layout
 * read, and whether the control exists - not pixels. The pixels, the
 * first-commit-vs-settled row heights and the forced-layout counts are the PR's
 * rendered evidence (`scripts/session-switch.tsx?userLines=12`).
 */

const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;

/*
 * The ResizeObserver stand-in remembers WHICH observer watches each element
 * (several components in the transcript make one), so a case can deliver the
 * notification a real browser would send that element's observer after a
 * column narrows.
 */
const observers = new Map();
const observedHeights = new Map();
class FakeResizeObserver {
	constructor(callback) {
		this.callback = callback;
	}
	observe(element) {
		observers.set(element, this.callback);
		observedHeights.set(element, modeledBorderHeight(element));
	}
	unobserve(element) {
		observers.delete(element);
		observedHeights.delete(element);
	}
	disconnect() {}
}

/*
 * Mounting CanonicalTranscript also mounts its speech-capable action rows.
 * Never rely on jsdom's unimplemented media methods for silence: install the
 * same fake Audio used by message-actions.test.mjs before importing the bundle.
 * This is a real safety boundary, not a rename to evade the audio-suite guard.
 */
class FakeAudio {
	constructor() {
		this.src = null;
		this.played = false;
		this.paused = true;
		this.currentTime = 0;
		this.duration = 0;
		this.volume = 1;
		this.playbackRate = 1;
		this.preload = "";
		this.onended = null;
		this.onerror = null;
	}
	play() {
		this.played = true;
		this.paused = false;
		return Promise.resolve();
	}
	pause() {
		this.paused = true;
	}
	removeAttribute(name) {
		if (name === "src") this.src = null;
	}
	load() {}
}
const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
globalThis.Audio = FakeAudio;

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
	ResizeObserver: FakeResizeObserver,
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

/*
 * THE GEOMETRY MODEL. A user turn's content is `ceil(chars / 80)` lines of
 * 21.7px; `charsPerLine` is a knob so a case can narrow the column. The box's
 * client height is that content height, capped at 174px when the box carries
 * the cap class - which is exactly how a browser answers, and why a cap gated
 * on this read can never engage.
 *
 * Every read made inside a user row is LOGGED with the classes the box had at
 * that moment: the first entry is the first commit's layout effect, i.e. the
 * box as it would be painted.
 */
const LINE_PX = 21.7;
const CAP_CLASS = "max-h-[174px]";
let charsPerLine = 80;
let intrinsicHeight = null;
const reads = [];
const contentHeight = (element) =>
	intrinsicHeight ??
	Math.ceil((element.textContent ?? "").length / charsPerLine) * LINE_PX;
const modeledBorderHeight = (element) =>
	element.classList.contains(CAP_CLASS)
		? Math.min(contentHeight(element), 174)
		: contentHeight(element);
/*
 * Deliver only REAL size changes in this explicit geometry model. Calling a
 * callback on an unchanged capped box would hide R1's missing notification.
 * Group by observer, just as the browser batches a notification delivery.
 */
const deliverSizeChanges = () => {
	const batches = new Map();
	for (const [element, callback] of observers) {
		if (!element.isConnected) continue;
		const height = modeledBorderHeight(element);
		if (height === observedHeights.get(element)) continue;
		observedHeights.set(element, height);
		const entries = batches.get(callback) ?? [];
		entries.push({ target: element });
		batches.set(callback, entries);
	}
	for (const [callback, entries] of batches) callback(entries);
};
const inUserRow = (element) =>
	Boolean(element.closest?.('[data-record-kind="user"]'));
for (const [name, height] of [
	["scrollHeight", (element) => contentHeight(element)],
	[
		"clientHeight",
		(element) =>
			element.classList.contains(CAP_CLASS)
				? Math.min(contentHeight(element), 174)
				: contentHeight(element),
	],
]) {
	Object.defineProperty(window.HTMLElement.prototype, name, {
		configurable: true,
		get() {
			if (inUserRow(this))
				reads.push({ name, element: this, className: this.className });
			return height(this);
		},
	});
}

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	bootstrapDOM.window.close();
	if (originalAudio) Object.defineProperty(globalThis, "Audio", originalAudio);
	else Reflect.deleteProperty(globalThis, "Audio");
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const bundle = await build({
	stdin: {
		contents: `
			export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
			export { USER_TURN_CLAMP_PX, overflowsUserTurnClamp } from "./src/renderer/src/features/chat/canonical/user-turn-clamp";
		`,
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
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_user-turn-clamp-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { CanonicalTranscript, USER_TURN_CLAMP_PX, overflowsUserTurnClamp } =
	await import(bundlePath.href);
await unlink(bundlePath);

const TOGGLE_RE = /^Show (more|less)$/;
const CAP_RE = /max-h-\[174px\]/;
const OVERFLOW_RE = /overflow-hidden/;
const TAIL_RE = /THE-TAIL/;

const TS = 1_000_000;
const user = (id, text) => ({ kind: "user", id, ts: TS, text, images: [] });
/** `lines` full 80-character lines, with a recognisable tail on the last. */
const linesOf = (lines) => `${"x".repeat(80 * lines - 9)} THE-TAIL`;

const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
});

const mount = async (t, records) => {
	reads.length = 0;
	const mounted = { container: document.createElement("div"), written: [] };
	Object.defineProperty(window.navigator, "clipboard", {
		configurable: true,
		value: { writeText: async (text) => mounted.written.push(text) },
	});
	document.body.appendChild(mounted.container);
	t.after(async () => {
		await act(async () => mounted.root?.unmount());
		mounted.container.remove();
		charsPerLine = 80;
		intrinsicHeight = null;
	});
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		mounted.root = createRoot(mounted.container);
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
	mounted.row = (id) =>
		mounted.container.querySelector(
			`[data-record-kind="user"][data-record-id="${id}"]`,
		);
	/** The prose box the clamp is on: the user row's element carrying the turn's text that the clamp read. */
	mounted.body = (id) =>
		reads.find((read) => mounted.row(id)?.contains(read.element))?.element ??
		null;
	mounted.firstRead = (id) =>
		reads.find((read) => mounted.row(id)?.contains(read.element)) ?? null;
	mounted.toggle = (id) =>
		[...(mounted.row(id)?.querySelectorAll("button") ?? [])].find((button) =>
			TOGGLE_RE.test(button.textContent ?? ""),
		) ?? null;
	mounted.press = async (element) => {
		await act(async () => {
			element.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
	};
	return mounted;
};

test("a long turn carries the cap from its first commit, and offers Show more", async (t) => {
	const mounted = await mount(t, [user("u-long", linesOf(12))]);
	const first = mounted.firstRead("u-long");
	assert.ok(first, "the clamp read the long turn's box");
	assert.match(
		first.className,
		CAP_RE,
		"the cap is on the box at the first commit's layout read - the frame that is painted - not added after it",
	);
	assert.match(first.className, OVERFLOW_RE);
	const body = mounted.body("u-long");
	assert.match(body.className, CAP_RE, "and it is still there settled");
	const toggle = mounted.toggle("u-long");
	assert.ok(toggle, "a turn hiding text offers the control");
	assert.equal(toggle.textContent, "Show more");
	assert.equal(toggle.getAttribute("aria-expanded"), "false");
	assert.equal(
		body.contains(toggle),
		false,
		"the control sits outside the capped box, so the cap can never clip it",
	);
	assert.match(
		body.textContent,
		TAIL_RE,
		"the hidden part is still in the DOM: selection, copy and quoting reach all of it",
	);
});

test("Show more removes the cap, Show less restores it", async (t) => {
	const mounted = await mount(t, [user("u-long", linesOf(12))]);
	await mounted.press(mounted.toggle("u-long"));
	const body = mounted.body("u-long");
	assert.doesNotMatch(body.className, CAP_RE);
	assert.equal(mounted.toggle("u-long")?.textContent, "Show less");
	assert.equal(mounted.toggle("u-long")?.getAttribute("aria-expanded"), "true");
	await mounted.press(mounted.toggle("u-long"));
	assert.match(mounted.body("u-long").className, CAP_RE);
	assert.equal(mounted.toggle("u-long")?.textContent, "Show more");
});

test("a short turn and a turn exactly at the cap get no control", async (t) => {
	const mounted = await mount(t, [
		user("u-short", "check the workspace, briefly."),
		user("u-eight", linesOf(8)),
		user("u-nine", linesOf(9)),
	]);
	assert.equal(mounted.toggle("u-short"), null, "one line reveals nothing");
	assert.equal(
		mounted.toggle("u-eight"),
		null,
		"eight lines (173.6px) fit under the 174px cap",
	);
	assert.ok(
		mounted.toggle("u-nine"),
		"the ninth line is hidden, so the control exists",
	);
});

test("a turn that starts overflowing after mount gains the control from the shared observer", async (t) => {
	const mounted = await mount(t, [user("u-six", linesOf(6))]);
	assert.equal(mounted.toggle("u-six"), null);
	const intrinsic = mounted
		.row("u-six")
		.querySelector("[data-lo-user-turn-intrinsic]");
	assert.ok(observers.has(intrinsic), "the uncapped content is observed");
	charsPerLine = 40; // the column narrowed: six lines become twelve
	await act(async () => {
		deliverSizeChanges();
	});
	assert.ok(
		mounted.toggle("u-six"),
		"the control follows the box across the cap",
	);
});

/*
 * R1: hold text and width fixed while an asynchronous image/font changes only
 * intrinsic height. At 174 AND 175 the observed clipped box would remain 174,
 * so a model that invokes callbacks regardless of target size would falsely
 * pass. `deliverSizeChanges` compares each observation target's actual modeled
 * border height and sends nothing for an unchanged box. This is a geometry-
 * model test of the shipped React wiring, NOT a native-renderer reproduction.
 */
for (const boundary of [174, 175]) {
	test(`intrinsic ${boundary}px → 1200px and back invalidates without text/viewport changes`, async (t) => {
		intrinsicHeight = boundary;
		const mounted = await mount(t, [
			user("u-intrinsic", "unchanged image-bearing prose"),
		]);
		const body = mounted.body("u-intrinsic");
		const row = mounted.row("u-intrinsic");
		const text = body.textContent;
		assert.equal(mounted.toggle("u-intrinsic"), null);
		assert.equal(modeledBorderHeight(body), 174);
		intrinsicHeight = 1200;
		await act(async () => deliverSizeChanges());
		assert.equal(
			modeledBorderHeight(body),
			174,
			"the collapsed viewport never resized",
		);
		assert.equal(
			body.textContent,
			text,
			"no text-prop update requested remeasurement",
		);
		assert.equal(mounted.toggle("u-intrinsic")?.textContent, "Show more");

		await mounted.press(mounted.toggle("u-intrinsic"));
		assert.equal(modeledBorderHeight(body), 1200);
		assert.equal(mounted.toggle("u-intrinsic")?.textContent, "Show less");
		intrinsicHeight = boundary;
		await act(async () => deliverSizeChanges());
		assert.equal(
			mounted.toggle("u-intrinsic"),
			null,
			"expanded shrink removes a redundant control",
		);
		intrinsicHeight = 1200;
		await act(async () => deliverSizeChanges());
		assert.equal(
			mounted.toggle("u-intrinsic")?.textContent,
			"Show less",
			"growth retains expanded view state",
		);
		await mounted.press(mounted.toggle("u-intrinsic"));
		intrinsicHeight = boundary;
		await act(async () => deliverSizeChanges());
		assert.equal(modeledBorderHeight(body), 174);
		assert.equal(
			mounted.toggle("u-intrinsic"),
			null,
			"collapsed shrink also removes the control",
		);
		const intrinsic = row.querySelector("[data-lo-user-turn-intrinsic]");
		assert.ok(
			observers.has(intrinsic),
			"only uncapped intrinsic content owns this observation",
		);
		assert.equal(observers.has(body), false);
		await act(async () => mounted.root.unmount());
		mounted.root = null;
		assert.equal(
			observers.has(intrinsic),
			false,
			"unmount unobserves the exact intrinsic target",
		);
		assert.equal(observedHeights.has(intrinsic), false);
		intrinsicHeight = 1200;
		await act(async () => deliverSizeChanges());
	});
}

test("a 10,000-character collapsed turn retains full selection and full-copy text", async (t) => {
	const text = `${"x".repeat(9_991)} THE-TAIL`;
	assert.equal(text.length, 10_000);
	const mounted = await mount(t, [user("u-extreme", text)]);
	const body = mounted.body("u-extreme");
	assert.match(body.className, CAP_RE);
	assert.ok(mounted.toggle("u-extreme"));
	const selection = window.getSelection();
	const range = document.createRange();
	range.selectNodeContents(body);
	selection.removeAllRanges();
	selection.addRange(range);
	assert.equal(
		selection.toString(),
		text,
		"clipping never deletes hidden text",
	);
	selection.removeAllRanges();
	const copy = mounted
		.row("u-extreme")
		.querySelector('button[aria-label="Copy"]');
	assert.ok(copy, "the user row's full-copy action is still present");
	await mounted.press(copy);
	assert.deepEqual(
		mounted.written,
		[text],
		"the shipped action copies the source, not the clipped box",
	);
});

test("the rule and the class spell the same cap", () => {
	assert.equal(USER_TURN_CLAMP_PX, 174);
	const source = readFileSync(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		"utf8",
	);
	assert.match(source, new RegExp(`max-h-\\[${USER_TURN_CLAMP_PX}px\\]`));
	assert.equal(overflowsUserTurnClamp(174), false);
	assert.equal(overflowsUserTurnClamp(175), false, "1px of sub-pixel slack");
	assert.equal(overflowsUserTurnClamp(176), true);
});
