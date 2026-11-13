import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * THE WAITING LABEL A BUSY SEND EARNS (spec §C), in three parts:
 *
 * 1. `busyWaitLabels` — the pure rule. Which ids get a label, and which
 *    sentence each one earns: the mode it was sent with, `joined` when a steer
 *    is waiting too, `deferred` when the turn ended with the message still
 *    queued, and NOTHING when either source is missing.
 * 2. `evaluateBusySend().waitMode` — the page's own seam answering the label's
 *    mode, including the case the body cannot carry: a plain-Enter steer send
 *    has no `delivery` field, and still waits.
 * 3. The row, rendered: the label appears from `frontend.queued_steering`
 *    membership, disappears when the id leaves the queue, and stays away when
 *    the mode is known but the id is not queued (or the message failed to be
 *    delivered). This is the half a pure test cannot see — that the pane
 *    provides the map and the row reads it.
 */

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

/*
 * THE MOUNT AT THE END OF THIS FILE IS `transcript-foot-slot.test.mjs`'s BOOT,
 * verbatim in shape: the production `CanonicalTranscript` in jsdom with the
 * shims the renderer's imports expect (React DOM feature-detects `document` at
 * import time, the preference readers want `matchMedia` on the global and on
 * the jsdom window, and the tool rows observe their own mutations). It is
 * installed BEFORE the bundle is imported, for that reason. Everything above
 * the mount is unaffected: `renderToStaticMarkup` beside these globals is still
 * the server renderer it was.
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
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
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
/* `useMediaQuery` inside the rows reads the jsdom window's, not the global. */
window.matchMedia ??= shims.matchMedia;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

// One bundle for the whole file: the transcript is the heavy import, and the
// pure exports ride along rather than spinning a second esbuild instance.
const bundle = await build({
	stdin: {
		contents: `export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
 export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
 export { busyWaitLabels, NO_BUSY_WAIT_LABELS } from "./src/renderer/src/features/chat/canonical/busy-wait";
 export { evaluateBusySend } from "./src/renderer/src/features/chat/composer-send-key";
 export { noteBusySend } from "./src/renderer/src/shared/store/canonical-sessions-store";
 export { MemoryRouter } from "react-router-dom";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	// The renderer's `import.meta.env`, which `@shared/config` reads at module
	// scope; nothing here reads a VITE_ variable (the recipe every transcript
	// DOM suite in this directory uses).
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const bundlePath = new URL("./_busy-wait.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let CanonicalTranscript;
let EMPTY_TRANSCRIPT;
let busyWaitLabels;
let NO_BUSY_WAIT_LABELS;
let evaluateBusySend;
let noteBusySend;
let MemoryRouter;
try {
	({
		CanonicalTranscript,
		EMPTY_TRANSCRIPT,
		busyWaitLabels,
		NO_BUSY_WAIT_LABELS,
		evaluateBusySend,
		noteBusySend,
		MemoryRouter,
	} = await import(bundlePath.href));
} finally {
	await unlink(bundlePath);
}

/* ------------------------------------------------------------------ */
/* 1. The pure rule                                                    */
/* ------------------------------------------------------------------ */

const queue = (...ids) =>
	ids.map((id) => ({ id, text: "x", status: "queued" }));
const modes = (entries) => new Map(entries);

test("an id the mode map knows but the queue does not list gets no label", () => {
	// The press is not the wait: `noteBusySend` runs before the request leaves,
	// and the backend says "queued" only once it holds the message.
	assert.deepEqual(
		[...busyWaitLabels([], true, modes([["req-1", "queue"]]))],
		[],
	);
	assert.deepEqual(
		[...busyWaitLabels(queue("req-2"), true, modes([["req-1", "queue"]]))],
		[],
		"a DIFFERENT id waiting must not label this one",
	);
});

test("a queued id the mode map does not know gets no label", () => {
	// The reverse half: the owner can list a message this client did not press
	// (another client, a reload). No sentence here is true for it.
	assert.deepEqual([...busyWaitLabels(queue("req-9"), true, modes([]))], []);
});

test("each queued mode gets its own sentence", () => {
	// One id at a time: a steer sharing the queue would relabel the other two
	// `joined` (the next test owns that rule).
	for (const mode of ["steer", "queue", "both"]) {
		assert.deepEqual(
			[...busyWaitLabels(queue("only"), true, modes([["only", mode]]))],
			[["only", mode]],
		);
	}
});

test("a waiting steer turns the queue and queue-then-steer rows into joined", () => {
	const labels = busyWaitLabels(
		queue("q", "b", "s"),
		true,
		modes([
			["q", "queue"],
			["b", "both"],
			["s", "steer"],
		]),
	);
	assert.equal(labels.get("q"), "joined", "the queue row goes out with it");
	assert.equal(labels.get("b"), "joined", "so does the both row");
	assert.equal(
		labels.get("s"),
		"steer",
		"the steer row keeps its own sentence: it is the one being joined",
	);
});

test("the turn ending with a message still queued gives deferred, whatever the mode", () => {
	assert.deepEqual(
		[
			...busyWaitLabels(
				queue("a", "b"),
				false,
				modes([
					["a", "queue"],
					["b", "steer"],
				]),
			),
		],
		[
			["a", "deferred"],
			["b", "deferred"],
		],
		"a steer cannot steer a turn that has ended; it waits for the next message",
	);
});

test("an unknown mode, a missing id and a non-string id are all no label", () => {
	assert.deepEqual(
		[...busyWaitLabels(queue("a"), true, modes([["a", "later"]]))],
		[],
		"an unknown mode has no true sentence here",
	);
	assert.deepEqual(
		[...busyWaitLabels([{ text: "no id" }], true, modes([["a", "queue"]]))],
		[],
		"an item without an id cannot be joined to anything",
	);
	assert.deepEqual(
		[...busyWaitLabels([{ id: 7 }], true, modes([["7", "queue"]]))],
		[],
		"an id that is not a string is not a message id",
	);
});

test("no labels is ONE shared frozen map, so a turn's start and end repaint no row", () => {
	// R-4: the pane hands this map to a React context. A fresh empty map per
	// frame is a new context value on every turn start and end, which re-renders
	// every user row for an answer that says nothing.
	const settled = busyWaitLabels([], true, modes([["x", "queue"]]));
	const ended = busyWaitLabels(queue("y"), false, modes([]));
	assert.equal(settled, ended, "both label-less frames read the same instance");
	assert.equal(settled, NO_BUSY_WAIT_LABELS);
	assert.equal(settled.size, 0);
	assert.ok(Object.isFrozen(settled), "and the shared instance is frozen");
	assert.notEqual(
		busyWaitLabels(queue("y"), true, modes([["y", "queue"]])),
		settled,
		"a frame that does label gets its own map",
	);
});

/* ------------------------------------------------------------------ */
/* 2. The page's seam answers the label's mode                         */
/* ------------------------------------------------------------------ */

const settings = (mode) => [{ key: "delivery.busy_default", value: mode }];

test("a busy steer send names steer even though no delivery field rides the body", () => {
	const evaluation = evaluateBusySend({
		chordDelivery: null,
		settings: settings("steer"),
		busy: true,
		busyDeliverySupported: true,
	});
	assert.equal(evaluation.refused, false);
	assert.equal(
		evaluation.delivery,
		undefined,
		"steer is the legacy body: nothing to send",
	);
	assert.equal(
		evaluation.waitMode,
		"steer",
		"but it still waits for the turn, which the label must say",
	);
});

test("a busy send with a queue default (or a chord) names that mode on both fields", () => {
	const byDefault = evaluateBusySend({
		chordDelivery: null,
		settings: settings("queue"),
		busy: true,
		busyDeliverySupported: true,
	});
	assert.equal(byDefault.delivery, "queue");
	assert.equal(byDefault.waitMode, "queue");

	const byChord = evaluateBusySend({
		chordDelivery: "both",
		settings: settings("queue"),
		busy: true,
		busyDeliverySupported: true,
	});
	assert.equal(byChord.delivery, "both", "the chord's mode wins the body");
	assert.equal(
		byChord.waitMode,
		"both",
		"and the label follows the same press",
	);
});

test("an idle send and a refused send name no mode at all", () => {
	const idle = evaluateBusySend({
		chordDelivery: "queue",
		settings: settings("queue"),
		busy: false,
		busyDeliverySupported: true,
	});
	assert.equal(idle.delivery, undefined);
	assert.equal(idle.waitMode, null, "nothing is waiting on an idle send");

	const refused = evaluateBusySend({
		chordDelivery: "queue",
		settings: settings("queue"),
		busy: true,
		busyDeliverySupported: false,
	});
	assert.equal(refused.refused, true);
	assert.equal(
		refused.waitMode,
		null,
		"a refused send was not sent, so it cannot be waiting",
	);
});

/* ------------------------------------------------------------------ */
/* 3. The row, rendered                                                */
/* ------------------------------------------------------------------ */

const TS = 1_760_000_000_000;

/** The shape `appendPendingUser` paints and the durable row keeps: id = request id. */
const userRow = (id, text = "Ship the busy-send receipts.") => ({
	kind: "user",
	id,
	ts: TS,
	text,
	images: [],
});

/** A frame with the one field this surface reads, plus a live turn. */
const frame = (queued, streaming = true) => ({
	session_id: "s-busy",
	streaming,
	queued_steering: queued,
});

function render({ records, frontend, undelivered = null }) {
	return renderToStaticMarkup(
		h(
			MemoryRouter,
			{},
			h(
				QueryClientProvider,
				{ client: queryClient },
				h(CanonicalTranscript, {
					transcript: { ...EMPTY_TRANSCRIPT, records },
					frontend,
					gate: null,
					waiting: false,
					awaitingHydration: false,
					loadingOlder: false,
					onLoadOlder: async () => true,
					containerRef: { current: null },
					isSmallView: false,
					status: "live",
					failure: null,
					undelivered,
					onReconnect: () => {},
				}),
			),
		),
	);
}

const LABELS = {
	steer: "Steering — may stop a running tool",
	queue: "Queued — waits, tools keep running",
	both: "Queued — waits, then steers if slow",
	joined: "Steering — goes out with your steer",
	deferred: "Still queued — sends with that next message",
};

/** Every `data-busy-wait` line's text, in document order. */
const labelLines = (markup) =>
	[...markup.matchAll(/data-busy-wait="true"[^>]*>(.*?)<\/div>/g)].map(
		(match) => match[1],
	);

test("the waiting line appears while the backend lists the id, and clears when it leaves", () => {
	const records = [userRow("req-1")];
	noteBusySend("req-1", "queue");

	const queued = render({ records, frontend: frame(queue("req-1")) });
	assert.deepEqual(
		labelLines(queued),
		[LABELS.queue],
		"a queued message says what Enter did",
	);

	const delivered = render({ records, frontend: frame([]) });
	assert.deepEqual(
		labelLines(delivered),
		[],
		"delivery takes the line with it: the queue is the only source of waiting-ness",
	);
});

test("the mode recorded at the press draws nothing until the owner reports the id", () => {
	const records = [userRow("req-2")];
	noteBusySend("req-2", "both");
	const beforeAdmission = render({ records, frontend: frame([]) });
	assert.deepEqual(labelLines(beforeAdmission), []);
});

test("a waiting steer relabels the queue rows that ride with it", () => {
	const records = [userRow("req-q"), userRow("req-s"), userRow("req-b")];
	noteBusySend("req-q", "queue");
	noteBusySend("req-s", "steer");
	noteBusySend("req-b", "both");
	const markup = render({
		records,
		frontend: frame(queue("req-q", "req-s", "req-b")),
	});
	assert.deepEqual(
		labelLines(markup),
		[LABELS.joined, LABELS.steer, LABELS.joined],
		"both queue rows go out with the steer; the steer keeps its own line",
	);
});

test("an ended turn leaves the still-queued message deferred", () => {
	const records = [userRow("req-d")];
	noteBusySend("req-d", "queue");
	const markup = render({
		records,
		frontend: frame(queue("req-d"), false),
	});
	assert.deepEqual(labelLines(markup), [LABELS.deferred]);
});

test("a message that failed to be delivered shows its failure, never a wait", () => {
	const records = [userRow("req-u")];
	noteBusySend("req-u", "queue");
	const markup = render({
		records,
		frontend: frame(queue("req-u")),
		undelivered: { recordId: "req-u", message: null },
	});
	assert.deepEqual(
		labelLines(markup),
		[],
		"an undelivered message is not waiting: the failure sentence is the truth about it",
	);
	assert.ok(markup.includes("Not delivered"), "and the failure line is there");
});

test("a queued id the mode map never saw draws no line, though the row renders", () => {
	const records = [userRow("req-x", "Reloaded session.")];
	const markup = render({ records, frontend: frame(queue("req-x")) });
	assert.ok(markup.includes("Reloaded session."), "the message is on screen");
	assert.deepEqual(
		labelLines(markup),
		[],
		"with no recorded mode there is no sentence, so nothing is drawn",
	);
});

/** The waiting line's own alignment: `text-end` beside the flex placement. */
const LABEL_ALIGNMENT = /data-busy-wait="true"[^>]*\btext-end\b/;

test("a wrapped waiting line aligns to the stamp's edge, in both writing directions", () => {
	// `justify-end` places the flex box; a sentence long enough to wrap sets its
	// own lines' alignment, which follows `text-align` and not the flex axis.
	// `text-end` is the writing-direction end: right in LTR, left in RTL, the
	// edge the stamp above the line sits on (agent review round 1, D1).
	const records = [userRow("req-align")];
	noteBusySend("req-align", "queue");
	const markup = render({ records, frontend: frame(queue("req-align")) });
	assert.match(
		markup,
		LABEL_ALIGNMENT,
		"the line's own alignment follows the writing direction, like the stamp",
	);
});

/* ------------------------------------------------------------------ */
/* 4. The pane's memo, across a second render                          */
/* ------------------------------------------------------------------ */

/**
 * The same pane the static renders above use, MOUNTED rather than serialized:
 * a memo can only be judged by rendering a second time. `mounted.render` takes
 * the next frame and settles it inside `act`, so the rows' commits land before
 * an assertion reads the DOM.
 */
const mountPane = (records) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const pane = {
		container,
		render: async (nextFrontend) => {
			await act(async () => {
				root.render(
					h(
						MemoryRouter,
						{},
						h(
							QueryClientProvider,
							{ client: queryClient },
							h(CanonicalTranscript, {
								transcript: { ...EMPTY_TRANSCRIPT, records },
								frontend: nextFrontend,
								gate: null,
								waiting: false,
								awaitingHydration: false,
								loadingOlder: false,
								onLoadOlder: async () => true,
								containerRef: { current: container },
								isSmallView: false,
								status: "live",
								failure: null,
								onReconnect: () => {},
							}),
						),
					),
				);
			});
		},
		labels: () =>
			[...container.querySelectorAll("[data-busy-wait]")].map(
				(node) => node.textContent,
			),
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
	return pane;
};

test("flipping the streaming flag relabels the SAME queued row on the next render", async () => {
	// The pane re-derives its labels through ONE signature string, and the turn's
	// liveness is half of it: the same queue reads "queued" while the turn runs
	// and "deferred" after it ends. Dropping `streaming` from that signature
	// leaves the first render's map in the memo, so the row keeps a sentence the
	// ended turn has just made false (agent review round 1, R-3).
	const records = [userRow("req-flip")];
	noteBusySend("req-flip", "queue");
	// ONE queue array for both frames: the streaming flag is the only input that
	// moves between the renders, which is what makes the assertion its own.
	const queued = queue("req-flip");
	const pane = mountPane(records);
	await pane.render(frame(queued, true));
	assert.deepEqual(
		pane.labels(),
		[LABELS.queue],
		"a live turn: the message waits for it",
	);
	await pane.render(frame(queued, false));
	assert.deepEqual(
		pane.labels(),
		[LABELS.deferred],
		"the same queue after the turn ends is a deferral, and only the streaming flag says so",
	);
	await pane.unmount();
});
