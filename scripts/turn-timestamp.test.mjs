import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

/*
 * The turn stamp: its FORMAT (pure, asserted against a fixed `now`) and its
 * PLACEMENT (rendered through the production `CanonicalTranscript`, because
 * "under the bubble" and "inside the expanded section" are properties of the
 * composition rather than of the stamp).
 *
 * Why jsdom rather than `renderToStaticMarkup`, which the notice tests use: the
 * expanded half only exists after the row's own trigger is clicked, and the
 * claim being checked is precisely that the stamp is NOT painted until then. A
 * static render can only assert the collapsed half of that pair.
 *
 * jsdom has no layout engine, so nothing here is geometry evidence: the frames
 * in `docs/evidence/` carry "it is under the bubble and against its right edge"
 * and this file carries "it is there, once, at the right moment". The globals
 * are installed the way `composer-tabs.test.mjs` installs them, including the
 * reasons for each shim - React DOM feature-detects `document` at import time,
 * Radix's tooltip (inside `Disclosure`) reaches for `Element`,
 * `getComputedStyle` and a `ResizeObserver` by name rather than through
 * `window`, and a real rAF frame loop would leave node:test unable to exit.
 */
/*
 * A REAL ORIGIN, not jsdom's default opaque one: the transcript's imports reach
 * the preference stores, whose `persist` middleware resolves `localStorage` once
 * at module init and stays storage-less for the whole file if that read throws.
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
	/*
	 * jsdom's navigator, so `navigator.language` is a fixture rather than
	 * whatever the machine happens to be set to: the formatter reads it for the
	 * month and day order, and a test that passed in en-US and failed in en-GB
	 * would be measuring the developer's locale.
	 */
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
	// `window.matchMedia`, which jsdom does not implement at all and the theme
	// and preference stores read on import.
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
		contents: [
			'export { formatTurnTimestamp } from "./src/renderer/src/shared/utils/date-utils";',
			'export { TurnTimestamp } from "./src/renderer/src/features/chat/components/message-item/turn-timestamp";',
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
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
	/*
	 * `import.meta.env` is Vite's, and the transcript reads `.DEV` in an effect
	 * (its own `performance.mark` hook). Left undefined, that read is a
	 * TypeError inside a commit rather than a falsy branch, so the empty object
	 * is the production shape: the dev-only path is off, and nothing here
	 * asserts on it.
	 */
	define: { "import.meta.env": "{}" },
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
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});
const bundlePath = new URL(
	`./_turn-timestamp-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { formatTurnTimestamp, TurnTimestamp, CanonicalTranscript } =
	await import(bundlePath.href);
await unlink(bundlePath);

/*
 * A FIXED `now`, which is the whole reason the formatter takes one: the two
 * boundaries it has are the calendar day and the calendar year, and neither is
 * reachable through a clock the test does not own. Every instant below is built
 * with the LOCAL-field constructor, so the expectations hold in any time zone -
 * a formatter that went through `toISOString()` would shift them all by the
 * machine's offset.
 *
 * 2026-09-16 15:42 local, a Wednesday.
 */
const NOW = new Date(2026, 8, 16, 15, 42);

/*
 * ICU spells en-US am/pm with a NARROW NO-BREAK SPACE (U+202F) in some
 * versions and a plain space in others, and which one this host runs is not a
 * property of the code under test. Normalising both to a plain space keeps the
 * assertions about the SHAPE of the stamp rather than about a Unicode
 * revision - the same reason the frames are judged by eye rather than by bytes.
 */
const plain = (text) => text.replace(/[\u202f\u00a0]/g, " ");

test("today is a bare clock time", () => {
	assert.equal(
		plain(formatTurnTimestamp(new Date(2026, 8, 16, 15, 42), NOW)),
		"3:42 PM",
	);
	// Nine in the morning, so a leading zero is not assumed anywhere.
	assert.equal(
		plain(formatTurnTimestamp(new Date(2026, 8, 16, 9, 5), NOW)),
		"9:05 AM",
	);
});

test("midnight and noon are spelled 12, not 0 or 24", () => {
	// The two instants the 12-hour cycle gets wrong when it is done by
	// arithmetic: hour 0 is 12 AM and hour 12 is 12 PM, not the other way round.
	assert.equal(
		plain(formatTurnTimestamp(new Date(2026, 8, 16, 0, 0), NOW)),
		"12:00 AM",
	);
	assert.equal(
		plain(formatTurnTimestamp(new Date(2026, 8, 16, 12, 0), NOW)),
		"12:00 PM",
	);
});

test("yesterday names the day", () => {
	assert.equal(
		plain(formatTurnTimestamp(new Date(2026, 8, 15, 15, 42), NOW)),
		"Yesterday 3:42 PM",
	);
});

test("yesterday is a calendar day, not twenty-four hours back", () => {
	// 00:10 today against 23:50 last night: twenty minutes apart and a reader
	// still calls the second one yesterday. An elapsed-hours rule would say
	// "23:50" with no day at all, which is the shape this formatter exists to
	// avoid.
	const justAfterMidnight = new Date(2026, 8, 16, 0, 10);
	assert.equal(
		plain(
			formatTurnTimestamp(new Date(2026, 8, 15, 23, 50), justAfterMidnight),
		),
		"Yesterday 11:50 PM",
	);
	// And the mirror: 00:05 today is TODAY when the reader reads it at 23:55.
	assert.equal(
		plain(
			formatTurnTimestamp(
				new Date(2026, 8, 16, 0, 5),
				new Date(2026, 8, 16, 23, 55),
			),
		),
		"12:05 AM",
	);
});

test("earlier this year carries the month and day, and no year", () => {
	assert.equal(
		plain(formatTurnTimestamp(new Date(2026, 8, 12, 15, 42), NOW)),
		"Sep 12, 3:42 PM",
	);
	// The first day of the current year is still this year, so it still drops
	// the year: the boundary is the calendar year, not 365 days back.
	assert.equal(
		plain(formatTurnTimestamp(new Date(2026, 0, 1, 0, 30), NOW)),
		"Jan 1, 12:30 AM",
	);
});

test("an earlier year carries the year", () => {
	assert.equal(
		plain(formatTurnTimestamp(new Date(2025, 8, 12, 15, 42), NOW)),
		"Sep 12, 2025, 3:42 PM",
	);
	// The year boundary itself, one minute either side of it.
	assert.equal(
		plain(formatTurnTimestamp(new Date(2025, 11, 31, 23, 59), NOW)),
		"Dec 31, 2025, 11:59 PM",
	);
	assert.equal(
		plain(
			formatTurnTimestamp(
				new Date(2026, 0, 1, 0, 1),
				new Date(2026, 0, 1, 9, 0),
			),
		),
		"12:01 AM",
	);
});

test("epoch milliseconds, the shape a record carries, are accepted", () => {
	// `TranscriptRecord.ts` is a number, and every caller in the transcript
	// hands the raw value over; a formatter that only took `Date` would make
	// every call site do the conversion.
	const instant = new Date(2026, 8, 15, 15, 42);
	assert.equal(
		plain(formatTurnTimestamp(instant.getTime(), NOW)),
		"Yesterday 3:42 PM",
	);
});

test("an instant that cannot be read states nothing", () => {
	// An empty string and a garbage string are the two shapes a wire value
	// arrives in; neither may render "Invalid Date" under a turn.
	assert.equal(formatTurnTimestamp(undefined, NOW), "");
	assert.equal(formatTurnTimestamp(null, NOW), "");
	assert.equal(formatTurnTimestamp("not a date", NOW), "");
	// And the component refuses rather than throwing: `toISOString()` on an
	// invalid Date is what a missing guard would hit, taking the transcript
	// down over one bad row.
	const container = document.createElement("div");
	const root = createRoot(container);
	act(() => {
		root.render(h(TurnTimestamp, { timestamp: Number.NaN }));
	});
	assert.equal(container.innerHTML, "");
	act(() => root.unmount());
});

test("the stamp is a machine-readable time element whose text is the friendly one", () => {
	const instant = new Date(2026, 8, 15, 15, 42);
	const container = document.createElement("div");
	const root = createRoot(container);
	act(() => {
		root.render(h(TurnTimestamp, { timestamp: instant }));
	});
	const time = container.querySelector("time");
	assert.ok(time, "a stamp is a <time>, not a span");
	assert.equal(time.getAttribute("datetime"), instant.toISOString());
	// The full date and time ride in the title, where the stamp's own four-word
	// shape has had to abbreviate.
	assert.match(time.getAttribute("title"), /September 15, 2026/);
	assert.equal(plain(time.textContent), formatTurnTimestamp(instant));
	act(() => root.unmount());
});

// ---------------------------------------------------------------- placement

const TS = 1_760_000_000_000;

const transcriptOf = (records) => ({
	records,
	index: new Map(records.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
});

const userRecord = (id, over = {}) => ({
	kind: "user",
	id,
	ts: TS,
	text: "Which invoices were late last month?",
	images: [],
	...over,
});

const toolRecord = (id, over = {}) => ({
	kind: "tool",
	id,
	ts: TS,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: null,
	phase: "done",
	argumentBytes: 0,
	output: "ok",
	isError: false,
	durationS: 0.4,
	startedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	...over,
});

const mount = (records) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(
			h(CanonicalTranscript, {
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
		);
	});
	return {
		container,
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
};

test("a user turn carries one stamp, under the bubble and outside it", async () => {
	const { container, unmount } = mount([userRecord("user:1")]);
	const stamps = [...container.querySelectorAll("time")];
	assert.equal(stamps.length, 1, "exactly one stamp per user turn");
	const [stamp] = stamps;
	assert.equal(stamp.getAttribute("datetime"), new Date(TS).toISOString());

	/*
	 * Placement, as far as a layout-less DOM can state it: the stamp is a
	 * sibling of the bubble's row, it comes AFTER it in document order, and it
	 * is not inside the bubble's own measure box. The last one is the fact the
	 * design needs - a stamp inside the bubble would be a line of the message,
	 * and would travel with a quote.
	 */
	const column = stamp.parentElement;
	const bubbleRow = stamp.previousElementSibling;
	assert.ok(bubbleRow, "the stamp follows the bubble's own row");
	assert.ok(
		bubbleRow.querySelector(".lo-measured"),
		"the bubble's reading measure is the row above the stamp",
	);
	assert.equal(
		container.querySelector(".lo-measured").contains(stamp),
		false,
		"the stamp is not part of the message's words",
	);
	assert.equal(
		column.lastElementChild,
		stamp,
		"the stamp is the last thing in the turn",
	);
	assert.match(
		column.className,
		/items-end/,
		"the column right-aligns the stamp against the bubble's own edge",
	);

	/*
	 * And the turn's own text is untouched by it: the stamp's text is not part
	 * of what a quote of this turn carries.
	 */
	assert.equal(
		bubbleRow.textContent.includes(plain(stamp.textContent)),
		false,
		"the friendly stamp text is not inside the bubble",
	);
	unmount();
});

test("a collapsed tool row has no stamp at all, and one appears when it is opened", async () => {
	/*
	 * The operator's constraint is that the ledger stays quiet: a run of calls
	 * is a run of lines, and the stamp belongs to the expansion. So the strong
	 * form of the assertion is at rest - ZERO `time` elements on the page while
	 * the row is closed - and then exactly one once the reader clicks.
	 */
	const record = toolRecord("tool:1", {
		args: { command: "pnpm test:desktop" },
		output: "tests 40\npass 40\n",
	});
	const { container, unmount } = mount([record]);
	assert.equal(
		container.querySelectorAll("time").length,
		0,
		"a closed tool row paints no stamp",
	);

	const trigger = container.querySelector('button[aria-expanded="false"]');
	assert.ok(trigger, "the row offers its disclosure");
	await act(async () => {
		trigger.click();
	});

	const pane = container.querySelector("[data-detail-section]");
	assert.ok(pane, "the expansion is open");
	const stamps = [...container.querySelectorAll("time")];
	assert.equal(stamps.length, 1, "the expanded row carries one stamp");
	const [stamp] = stamps;
	assert.equal(stamp.getAttribute("datetime"), new Date(TS).toISOString());
	/*
	 * OUTSIDE the scrolling pane, which is the placement claim the pane's own
	 * two `overflow-auto` sections make load-bearing: the remainder report under
	 * each section is the last line true at rest, and a stamp inside either
	 * scroller is off screen at rest on a long payload.
	 */
	assert.equal(
		stamp.closest("[data-detail-section]"),
		null,
		"the stamp is below the pane, not inside a scrolling section",
	);
	assert.equal(
		pane.contains(stamp),
		false,
		"the pane does not contain the stamp",
	);
	unmount();
});

test("a tool row with nothing to disclose stays a line, stamp and all", async () => {
	// `hasDetail` is false for a call with no readable arguments and no output,
	// and the ledger row then renders its disabled branch. There is no
	// expansion for a reader to open, so there is no stamp to place.
	const { container, unmount } = mount([
		toolRecord("tool:1", { args: {}, output: null, toolName: "team" }),
	]);
	assert.equal(container.querySelectorAll("time").length, 0);
	assert.equal(container.querySelector("button[aria-expanded]"), null);
	unmount();
});

test("the transcript footer does not repeat a clock the turn above it already states", async () => {
	/*
	 * The footer line is the transcript's own "when was the last thing here". On
	 * a conversation asked and not yet answered the last thing is the user's turn,
	 * which now carries its own stamp one line above - and an ungated footer
	 * printed the same time twice with nothing between them. The pair below is the
	 * rule in both directions, so gating it cannot silently delete the footer from
	 * the rows that have no stamp of their own.
	 *
	 * The footer's own stamp is `MessageTimestamp`, which is a hover span and not
	 * a `<time>`; `cursor-help` is the class that says it has a tooltip, and it is
	 * the honest hook because there is nothing semantic in the hover row's markup
	 * to grab: it lives inside a `span`, exactly like the text around it.
	 */
	const endsOnUser = mount([
		{
			kind: "assistant",
			id: "a",
			ts: TS,
			text: "Reconciled.",
			streaming: false,
			stopReason: null,
			error: false,
		},
		userRecord("user:1", { ts: TS + 60_000 }),
	]);
	assert.equal(
		endsOnUser.container.querySelectorAll("time").length,
		1,
		"the user turn is stamped",
	);
	assert.equal(
		endsOnUser.container.querySelectorAll(".cursor-help").length,
		0,
		"and the footer does not state the same clock a second time",
	);
	endsOnUser.unmount();

	const endsOnAnswer = mount([
		userRecord("user:1"),
		{
			kind: "assistant",
			id: "a",
			ts: TS + 60_000,
			text: "Reconciled.",
			streaming: false,
			stopReason: null,
			error: false,
		},
	]);
	assert.equal(
		endsOnAnswer.container.querySelectorAll(".cursor-help").length,
		1,
		"an answer carries no stamp, so the footer keeps its own",
	);
	endsOnAnswer.unmount();
});

test("assistant prose carries no stamp", async () => {
	// The stamp is a fact about the two things the operator named: a user turn
	// and an open tool call. An answer is neither, and the transcript's own
	// footer line (which is a hover-model span, not a `time`) is unchanged.
	const { container, unmount } = mount([
		userRecord("user:1"),
		{
			kind: "assistant",
			id: "assistant:1",
			ts: TS + 1000,
			text: "Three invoices were late.",
			streaming: false,
			stopReason: null,
			error: false,
		},
	]);
	assert.equal(
		container.querySelectorAll("time").length,
		1,
		"only the user turn is stamped",
	);
	unmount();
});
