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
 *
 * THE THIRD PLACEMENT IS GONE. A footer line at the end of the transcript used
 * to state when the last thing in the conversation happened, gated so it stayed
 * away when the last row painted a stamp of its own; the transcript is
 * bottom-pinned and the working line sits at its foot, so during a live turn
 * that stamp landed under the thinking indicator (operator report, 2026-09-17).
 * The assertions that counted footers therefore INVERT here rather than being
 * deleted: the claim worth keeping is that no stamp is painted at the foot, in
 * any state.
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
/*
 * `matchMedia` ON THE JSDOM WINDOW AS WELL AS ON `globalThis`.
 *
 * The two are not the same object here, and which one a caller reaches for
 * depends on how it was written: the theme and preference stores read the
 * global, while `useMediaQuery` inside the working line - reached through the
 * transcript once a test mounts `waiting` - calls `window.matchMedia` and cannot
 * see the global at all (`TypeError: window.matchMedia is not a function`).
 */
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

const bundle = await build({
	stdin: {
		contents: [
			'export { formatTurnTimestamp } from "./src/renderer/src/shared/utils/date-utils";',
			'export { TurnTimestamp } from "./src/renderer/src/features/chat/components/message-item/turn-timestamp";',
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
			'export { ToolRow } from "./src/renderer/src/features/chat/components/trace/tool-row";',
			'export { useStampNow, msUntilNextLocalDay, localDayStart } from "./src/renderer/src/shared/hooks/use-calendar-day";',
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
const {
	formatTurnTimestamp,
	TurnTimestamp,
	CanonicalTranscript,
	ToolRow,
	useStampNow,
	msUntilNextLocalDay,
} = await import(bundlePath.href);
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
		root.render(h(TurnTimestamp, { timestamp: Number.NaN, scope: "turn" }));
	});
	assert.equal(container.innerHTML, "");
	act(() => root.unmount());
});

test("the stamp's own clock agrees with its title on a 24-hour locale", () => {
	/*
	 * The operator asked for am/pm, so `formatTurnTimestamp` forces `hour12`; the
	 * title used to take the LOCALE's cycle, so on a machine whose default clock is
	 * 24-hour one element stated the same instant two ways - `15 Sept, 3:42 pm`
	 * under `15 September 2026 at 15:42` (review round 1, R3).
	 *
	 * The locale is the fixture rather than the machine: jsdom's navigator is en-US,
	 * whose default cycle is ALREADY h12, which is why the forcing had no test at
	 * all until now (R4) - deleting `hour12` left this file green. de-DE defaults to
	 * h23, so the assertion below is red exactly when the option goes.
	 */
	const descriptor = Object.getOwnPropertyDescriptor(
		globalThis.navigator,
		"language",
	);
	const original = globalThis.navigator.language;
	Object.defineProperty(globalThis.navigator, "language", {
		value: "de-DE",
		configurable: true,
	});
	try {
		const instant = new Date(2026, 8, 15, 15, 42);
		const text = formatTurnTimestamp(instant, NOW);
		assert.match(text, /3:42 PM/, "the visible clock is the requested am/pm");
		assert.doesNotMatch(text, /15:42/, "not the locale's own 24-hour cycle");

		const container = document.createElement("div");
		const root = createRoot(container);
		act(() => {
			root.render(h(TurnTimestamp, { timestamp: instant, scope: "turn" }));
		});
		const label = container.querySelector("time").getAttribute("aria-label");
		assert.match(label, /15\. September 2026/);
		assert.match(label, /3:42 PM/, "and the title half agrees with it");
		assert.doesNotMatch(
			label,
			/15:42/,
			"the two halves of one element differ no more",
		);
		act(() => root.unmount());
	} finally {
		if (descriptor) {
			Object.defineProperty(globalThis.navigator, "language", descriptor);
		} else {
			// jsdom's `language` is a getter on the prototype, so the stub above is
			// an OWN property of the instance and removing it restores the getter.
			Object.defineProperty(globalThis.navigator, "language", {
				value: original,
				configurable: true,
			});
		}
	}
});

test("a stamp re-decides the day when the local midnight passes", async (t) => {
	/*
	 * An always-on stamp is new in this feature, and so is the staleness it can
	 * carry: a settled conversation re-renders only when a record or a prop
	 * changes, so before `use-calendar-day` a window left open overnight kept
	 * printing a bare clock for a turn that had become yesterday's, which reads as
	 * today (review round 1, R5).
	 *
	 * The clock is mocked rather than waited for: the assertions are "same day,
	 * then yesterday", and the transition is the only thing under test.
	 */
	const midnight = new Date(2026, 3, 15, 0, 0, 0, 0).getTime();
	const elevenFifty = midnight - 10 * 60_000;
	t.mock.timers.enable({
		apis: ["setTimeout", "Date"],
		now: midnight - 60_000,
	});
	try {
		const container = document.createElement("div");
		const root = createRoot(container);
		act(() => {
			root.render(h(TurnTimestamp, { timestamp: elevenFifty, scope: "turn" }));
		});
		const text = () => plain(container.querySelector("time").textContent);
		assert.equal(
			text(),
			formatTurnTimestamp(elevenFifty, new Date(elevenFifty)),
		);
		assert.doesNotMatch(
			text(),
			/Yesterday/,
			"it is still today at a minute to midnight",
		);

		// Past the boundary the store re-reads the day and re-renders its subscribers.
		await act(async () => {
			t.mock.timers.tick(61_000);
		});
		assert.match(
			text(),
			/^Yesterday /,
			"after midnight the same turn is yesterday's, and says so",
		);
		act(() => root.unmount());
	} finally {
		t.mock.timers.reset();
	}
});

test("the stamp is a machine-readable time element whose text is the friendly one", () => {
	const instant = new Date(2026, 8, 15, 15, 42);
	const container = document.createElement("div");
	const root = createRoot(container);
	act(() => {
		root.render(h(TurnTimestamp, { timestamp: instant, scope: "turn" }));
	});
	const time = container.querySelector("time");
	assert.ok(time, "a stamp is a <time>, not a span");
	assert.equal(time.getAttribute("datetime"), instant.toISOString());
	// And it says which of the transcript's two stamps it is, because they render
	// identically on purpose and a caller that mixed them up would be invisible
	// in the text.
	assert.equal(time.getAttribute("data-stamp"), "turn");
	/*
	 * The full date and time ride in the accessible name and in the tooltip, where
	 * the stamp's own four-word shape has had to abbreviate - and they carry the
	 * DAY, which "3:42 PM" alone does not. A `title` used to hold this and was
	 * pointer-only, which is why it moved to `aria-label` on the element itself
	 * (review round 1, R7) with the app's shared `Tooltip` for the pointer half
	 * (design round 1, D5).
	 */
	assert.match(time.getAttribute("aria-label"), /September 15, 2026/);
	assert.match(
		time.getAttribute("aria-label"),
		/3:42 PM/,
		"in the 12-hour shape the operator asked for",
	);
	assert.equal(time.getAttribute("title"), null, "no second, native tooltip");
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

/*
 * The transcript paints ONE kind of stamp, a turn's own (`data-stamp="turn"`),
 * and WHERE it is placed is the whole claim: under a user turn's bubble, or at
 * the foot of an open tool call. The assertions key on the attribute rather than
 * counting `<time>` elements so a test can ask where a stamp is, not only how
 * many there are.
 *
 * THE ATTRIBUTE USED TO CARRY A SECOND VALUE. `"footer"` named the transcript's
 * footer line, which is REMOVED (the operator's report of 2026-09-17), so the
 * assertions that once counted footers now assert their absence - and they assert
 * it as a count over the whole container, because "no footer" and "nothing at the
 * foot of the transcript" are the same claim now that only one placement exists.
 * `allStamps` is the unqualified count those absence assertions rest on.
 */
const stamps = (container, kind) => [
	...container.querySelectorAll(`time[data-stamp="${kind}"]`),
];

/** Every stamp on the page, whichever placement it names. */
const allStamps = (container) => [...container.querySelectorAll("time")];

const mount = (records, over = {}) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const render = (next) => {
		act(() => {
			root.render(
				h(CanonicalTranscript, {
					transcript: transcriptOf(next),
					gate: null,
					// The working line at the foot of the transcript: the state the
					// operator's report was taken in, and the only way to photograph a
					// stamp that used to land beneath it.
					waiting: over.waiting ?? false,
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
	};
	render(records);
	return {
		container,
		/** Re-render with a new transcript, which is what the reducer's routes do. */
		rerender: render,
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
};

test("a user turn carries one stamp, under the bubble and outside it", async () => {
	const { container, unmount } = mount([userRecord("user:1")]);
	const turns = stamps(container, "turn");
	assert.equal(turns.length, 1, "exactly one stamp per user turn");
	assert.equal(
		allStamps(container).length,
		1,
		"and nothing else on the page states a time: the footer is gone",
	);
	const [stamp] = turns;
	assert.equal(stamp.getAttribute("datetime"), new Date(TS).toISOString());

	/*
	 * Placement, as far as a layout-less DOM can state it: the stamp is a
	 * sibling of the bubble's row, it comes AFTER it in document order, and it
	 * is not inside the bubble's own card. The last one is the fact the design
	 * needs - a stamp inside the bubble would be a line of the message, and
	 * would travel with a quote.
	 *
	 * KEYED ON THE CARD, NOT ON A MEASURE CLASS. These two assertions read
	 * `.lo-measured` until 2026-09-16, when that class was retired: the user
	 * bubble no longer opts its prose into a 62ch reading measure, because the
	 * measure is the card's own width now (the operator report of that date;
	 * `markdown.css`'s measure comment carries it and the numbers). A selector
	 * for a class nothing applies names no box, so the same two facts are asked
	 * of `.rounded-frame` - which is what the user bubble actually is - and the
	 * assistant side renders no card at all, which is what keeps the negative
	 * assertion in the test below meaningful.
	 */
	const column = stamp.parentElement;
	const bubbleRow = stamp.previousElementSibling;
	assert.ok(bubbleRow, "the stamp follows the bubble's own row");
	assert.ok(
		bubbleRow.querySelector(".rounded-frame"),
		"the bubble's card is the box in the row above the stamp",
	);
	assert.equal(
		container.querySelector(".rounded-frame").contains(stamp),
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
	// The foot of the transcript states no time of its own any more. That line is
	// what the operator had removed (a stamp under the working line during a live
	// turn), and its absence is what these assertions ask for now.
	assert.equal(
		allStamps(container).length,
		0,
		"a closed tool row paints no stamp at all - the row, and the transcript's foot",
	);

	const trigger = container.querySelector('button[aria-expanded="false"]');
	assert.ok(trigger, "the row offers its disclosure");
	await act(async () => {
		trigger.click();
	});

	const pane = container.querySelector("[data-detail-section]");
	assert.ok(pane, "the expansion is open");
	const turns = stamps(container, "turn");
	assert.equal(turns.length, 1, "the expanded row carries one stamp");
	const [stamp] = turns;
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
	/*
	 * AND IT IS THE ONLY STAMP ON THE PAGE, which is the half of the old footer's
	 * rule that survives its removal. The footer used to state when the last thing
	 * in the conversation happened; while this row was closed it was the only time
	 * on screen, and now that it is open the row's own stamp states that instant a
	 * few pixels above it. Both the duplicate and the line it was on are gone, so
	 * the claim is now about the whole container rather than about a footer.
	 */
	assert.equal(
		allStamps(container).length,
		1,
		"the opened row's own stamp is the only time on the page",
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
	assert.equal(stamps(container, "turn").length, 0, "the row paints nothing");
	assert.equal(container.querySelector("button[aria-expanded]"), null);
	unmount();
});

test("no stamp is painted at the foot of the transcript, on any last row", async () => {
	/*
	 * THE FOOTER IS REMOVED, and what replaces it is an absence on every shape of
	 * last row rather than a gate on some of them. The operator asked for the time
	 * "only beside user messages and in tool traces when expanded" (2026-09-17): a
	 * transcript that ends on prose, on a settled row nobody opened, or on a system
	 * notice states no time at its foot.
	 *
	 * The assertions count stamps over the WHOLE container rather than filtering by
	 * `data-stamp`, because the attribute no longer has a second value to filter
	 * for - "no footer" and "no stamp at the foot" are one claim now. Comparing
	 * against `allStamps` also catches a regression that reintroduced the line
	 * under a different value name.
	 */
	const answer = {
		kind: "assistant",
		id: "a",
		ts: TS + 60_000,
		text: "Reconciled.",
		streaming: false,
		stopReason: null,
		error: false,
	};

	// Ends on a USER turn: that turn's stamp is under its bubble, and the foot is
	// empty. This was the case the footer's gate was written for, and the absence
	// is now unconditional rather than a suppression.
	const endsOnUser = mount([
		{ ...answer, ts: TS },
		userRecord("user:1", { ts: TS + 60_000 }),
	]);
	assert.equal(stamps(endsOnUser.container, "turn").length, 1);
	assert.equal(
		allStamps(endsOnUser.container).length,
		1,
		"the turn's own stamp is the only time on the page",
	);
	endsOnUser.unmount();

	// Ends on an ANSWER: the case the footer used to exist for, and the case the
	// operator's "only beside user messages and in tool traces when expanded"
	// removes it from. MEASURED AGAINST THE BEHAVIOUR THAT WAS REMOVED: this fixture
	// used to paint TWO stamps - the user turn's, and the footer under the answer -
	// and the count below is what says the second one is gone.
	const endsOnAnswer = mount([userRecord("user:1"), answer]);
	assert.equal(
		allStamps(endsOnAnswer.container).length,
		1,
		"the user turn's stamp, and nothing at the foot under the answer",
	);
	assert.equal(stamps(endsOnAnswer.container, "turn").length, 1);
	endsOnAnswer.unmount();

	// Ends on a CLOSED ledger row: the row paints nothing, and the transcript no
	// longer states the time on its behalf - which is the trade this removal makes,
	// recorded in `turn-timestamp.tsx`'s own header rather than hidden here. Also a
	// two-stamp fixture before the change.
	const endsOnRow = mount([
		userRecord("user:1"),
		toolRecord("tool:1", { args: { command: "pnpm build" }, output: "built" }),
	]);
	assert.equal(
		allStamps(endsOnRow.container).length,
		1,
		"a settled row nobody opened states no time either",
	);
	endsOnRow.unmount();

	// Ends on a NOTICE, which never carried a stamp of its own and used to inherit
	// one from the footer line underneath it.
	const endsOnNotice = mount([
		userRecord("user:1"),
		{
			kind: "notice",
			id: "notice:1",
			ts: TS + 90_000,
			text: "The run was stopped by the reader.",
			level: "info",
		},
	]);
	assert.equal(
		allStamps(endsOnNotice.container).length,
		1,
		"a trailing notice states no time at the foot",
	);
	endsOnNotice.unmount();
});

test("a transcript ending on the working line paints no stamp beneath it", async () => {
	/*
	 * THE OPERATOR'S REPORT, as an assertion, and the reason the line was removed
	 * rather than re-gated. Mid-turn the newest record is the call that is running
	 * and the aggregate working line is the last thing on screen; the footer was
	 * keyed to that record, so its stamp painted directly under the thinking
	 * indicator - "the time that shows up below messages also seems to be showing up
	 * below the thinking indicator" (2026-09-17).
	 *
	 * ASSERTED STRUCTURALLY, not only by count: the working line has to be the LAST
	 * thing in the transcript's own box. A count alone would also pass if a stamp
	 * were moved above the line, and moving it above the line is the shape this
	 * whole change exists to refuse - the operator asked for a stamp BESIDE A USER
	 * MESSAGE or inside an expanded trace, not one anywhere at the foot.
	 */
	const { container, unmount } = mount(
		[
			userRecord("user:1"),
			// The call in flight: no outcome glyph and a live clock, which is the
			// state the report was taken in.
			toolRecord("tool:1", {
				args: { command: "pnpm test:desktop" },
				output: null,
				phase: "running",
				durationS: null,
			}),
		],
		{ waiting: true },
	);
	const line = container.querySelector("[data-lo-working-line]");
	assert.ok(line, "the working line is on screen");
	assert.equal(
		line.parentElement.nextElementSibling,
		null,
		"and it is the last thing in the transcript: nothing is painted below it",
	);
	/*
	 * ONE stamp, and BELOW the line is not where it is.
	 *
	 * The turn's own stamp is still there, under the bubble - this is the removal
	 * of the foot's line, not of the stamp the operator asked to keep - and the
	 * document-order comparison is what makes the claim about the FOOT rather than
	 * about a total: the stamp precedes the working line, so nothing states a time
	 * beneath the thinking indicator. A count alone would also pass with the stamp
	 * moved under the line, which is the reported bug.
	 */
	assert.equal(allStamps(container).length, 1);
	const [only] = stamps(container, "turn");
	assert.ok(only, "the user turn's own stamp is still painted");
	assert.notEqual(
		line.compareDocumentPosition(only) & Node.DOCUMENT_POSITION_PRECEDING,
		0,
		"and it sits ABOVE the working line: no stamp under the thinking indicator",
	);
	unmount();
});

test("assistant prose carries no stamp of its own", async () => {
	// The stamp is a fact about the two things the operator named: a user turn
	// and an open tool call. An answer is neither, so the only turn stamp on the
	// page is the user's - proven by where it sits, not only by its count.
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
	const turns = stamps(container, "turn");
	assert.equal(turns.length, 1, "only the user turn is stamped");
	assert.ok(
		// The card, not `.lo-measured`: that class was retired on 2026-09-16 (the
		// note in the placement test above records why), and an answer still
		// renders no card of its own for a stamp to hang on.
		turns[0].parentElement.querySelector(".rounded-frame"),
		"and it is the user turn's: the answer has no card to hang one on",
	);
	assert.equal(
		allStamps(container).length,
		1,
		"and the answer paints no stamp of its own either",
	);
	unmount();
});

test("the only stamps on the page are the ones inside the disclosures a reader opened", async () => {
	/*
	 * The removed footer used to be the third thing this test pinned, and its
	 * absence is now the same fact stated a different way: the page carries exactly
	 * as many stamps as there are OPEN disclosures, and never a fourth element at
	 * the foot. The four states below are still the matrix that says the count
	 * tracks the reader's own clicks rather than anything keyed to the last row.
	 */
	const first = toolRecord("tool:first", {
		args: { command: "pnpm test:desktop" },
		output: "tests 40\npass 40\n",
	});
	const last = toolRecord("tool:last", {
		args: { command: "pnpm build" },
		output: "built\n",
	});
	const { container, unmount } = mount([first, last]);
	const triggers = () => [
		...container.querySelectorAll("button[aria-expanded]"),
	];
	assert.equal(triggers().length, 2, "both rows offer their disclosure");

	// The order the frames can show.
	await act(async () => {
		triggers()[1].click();
	});
	assert.equal(
		allStamps(container).length,
		1,
		"the row the reader opened paints its stamp",
	);

	// The order that broke the old gate: an EARLIER row, with the last one open.
	await act(async () => {
		triggers()[0].click();
	});
	assert.equal(
		allStamps(container).length,
		2,
		"both open rows paint a stamp, and still nothing else does",
	);

	// Closing the earlier row takes one stamp with it and no others.
	await act(async () => {
		triggers()[0].click();
	});
	assert.equal(allStamps(container).length, 1);

	// And with the last row closed the page is quiet: the foot no longer states
	// the time on its behalf, which is the trade this removal makes.
	await act(async () => {
		triggers()[1].click();
	});
	assert.equal(
		allStamps(container).length,
		0,
		"a settled transcript carries no stamp at all",
	);
	unmount();
});

test("a new record OBJECT for an open row keeps its stamp", async () => {
	/*
	 * The route QA reached the round-2 defect by, from the app's own reducer rather
	 * than from a click: `buildRows`/`upsert` mint a NEW record object whenever a
	 * call changes (a `tool_execution_end`, a full resync), which was a new prop
	 * identity for the row AND a new inline callback for it. The reporting that fed
	 * the footer's gate is gone, but the thing the row must keep doing is the same:
	 * a re-render of an open row is not a closure, so its stamp stays on screen
	 * (QA round 2, Q2-1; review round 3, R3-1).
	 */
	const first = toolRecord("tool:first", {
		args: { command: "pnpm test:desktop" },
		output: "tests 40\npass 40\n",
	});
	const last = toolRecord("tool:last", {
		args: { command: "pnpm build" },
		output: "built\n",
	});
	const { container, rerender, unmount } = mount([first, last]);
	await act(async () => {
		[...container.querySelectorAll("button[aria-expanded]")][1].click();
	});
	assert.equal(
		allStamps(container).length,
		1,
		"the row is still open, so it still paints its stamp",
	);

	// The call changes: a new record object for the same id, still open.
	rerender([
		first,
		{ ...last, output: "built\n\ndone in 1.2s", durationS: 1.2 },
	]);
	assert.equal(
		allStamps(container).length,
		1,
		"and a new record object does not close it",
	);

	// And a whole-transcript resync, which re-mints every record object at once.
	rerender([
		{ ...first },
		{ ...last, output: "built\n\ndone in 1.2s", durationS: 1.2 },
	]);
	assert.equal(allStamps(container).length, 1, "nor does a resync");
	unmount();
});

test("a row rendered already open paints its stamp without a click", () => {
	/*
	 * `defaultOpen` is how the stories and the evidence harnesses paint an
	 * expansion without a click, and it is the one path where the disclosure is
	 * open before any handler runs. WHAT USED TO BE ASSERTED HERE is gone with the
	 * footer: the row reported its open state upward (`onOpenChange`) so the
	 * transcript could know whether its last row painted a stamp of its own, and
	 * that reporting existed only for that gate. What the row still owes is the
	 * placement inside its own body, which is one of the two this change keeps.
	 */
	const container = document.createElement("div");
	const root = createRoot(container);
	act(() => {
		root.render(
			h(ToolRow, {
				toolName: "bash",
				summary: "pnpm build",
				outcome: "success",
				durationS: 0.4,
				defaultOpen: true,
				details: h(TurnTimestamp, { timestamp: TS, scope: "turn" }),
			}),
		);
	});
	const painted = container.querySelectorAll("time");
	assert.equal(
		painted.length,
		1,
		"the stamp inside the open body is painted, with no click",
	);
	assert.equal(painted[0].getAttribute("data-stamp"), "turn");
	act(() => root.unmount());
});

test("the day store arms one timer to the next midnight, not a tick", async (t) => {
	/*
	 * The store's header makes the one-timer / one-render-per-day property
	 * load-bearing - a stamp that woke every second would put a render behind every
	 * token of a streaming turn - and the midnight test above pins the day FLIP,
	 * which a store that re-armed every 1000ms satisfies just as well. This is the
	 * assertion that decision is for: a minute of ticking costs nothing, and the day
	 * turning costs exactly one render (review round 2, R2-3).
	 */
	const nineAm = new Date(2026, 3, 15, 9, 0, 0, 0).getTime();
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: nineAm });
	/*
	 * The TIMER IS WHAT IS COUNTED, not the renders, and that is the whole lesson
	 * of this assertion: `useSyncExternalStore` skips a re-render when the snapshot
	 * it reads is unchanged, so a store that re-armed every 1000ms produces the same
	 * renders as one armed to midnight (measured - the 1000ms mutation left the
	 * render assertions green). What a tick costs is a wakeup per second for a value
	 * that changes once a day, so the spy below is the assertion the decision is
	 * actually for.
	 */
	const scheduled = [];
	const mockedSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = (fn, ms, ...rest) => {
		scheduled.push(ms ?? 0);
		return mockedSetTimeout(fn, ms, ...rest);
	};
	try {
		let renders = 0;
		const Probe = () => {
			useStampNow();
			renders += 1;
			return null;
		};
		const container = document.createElement("div");
		const root = createRoot(container);
		act(() => {
			root.render(h(Probe));
		});
		/*
		 * Two renders at mount, not one: the store re-reads the day when the first
		 * subscriber arrives, and here that differs from the value its module
		 * initialisation took from the real clock. What the decision is about is not
		 * that number but that it STOPS: a store re-arming on a tick would keep
		 * rendering while the clock moved.
		 */
		const afterMount = renders;
		assert.ok(
			afterMount <= 2,
			`the mount settles in at most two renders (was ${afterMount})`,
		);
		const afterMountTimers = scheduled.length;
		assert.deepEqual(
			scheduled.filter((ms) => ms > 1_000),
			[msUntilNextLocalDay(nineAm)],
			"the armed deadline IS the next local midnight, not merely a long timer",
		);
		assert.equal(
			scheduled.filter((ms) => ms >= 60_000).length,
			1,
			"exactly one timer is aimed further out than a minute: the next local midnight",
		);

		// The armed deadline is the next local midnight, so a minute passes silently -
		// and costs no wakeups beyond whatever React itself scheduled.
		assert.ok(
			msUntilNextLocalDay(nineAm) > 60_000,
			"the deadline is the next midnight rather than a tick",
		);
		await act(async () => {
			t.mock.timers.tick(60_000);
		});
		assert.equal(renders, afterMount, "a minute of clock costs no render");
		assert.ok(
			scheduled.length - afterMountTimers <= 3,
			`a minute of clock arms at most a couple of timers, not one per second (armed ${
				scheduled.length - afterMountTimers
			})`,
		);

		// And crossing midnight costs exactly one render, and re-arms for the day after.
		await act(async () => {
			t.mock.timers.tick(msUntilNextLocalDay(nineAm));
		});
		assert.equal(
			renders,
			afterMount + 1,
			"the day turning re-renders once, not repeatedly",
		);
		assert.ok(
			scheduled.filter((ms) => ms >= 60_000).length >= 2,
			"and the store arms the NEXT midnight, so the day keeps turning",
		);
		act(() => root.unmount());
	} finally {
		globalThis.setTimeout = mockedSetTimeout;
		t.mock.timers.reset();
	}
});
