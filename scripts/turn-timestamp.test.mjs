import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
			/* The i18n locale store, for the 24-hour-locale case's fixture:
			 * the formatters it exercises read THIS store, not the jsdom
			 * navigator (the store resolves the device locale once). */
			'export { currentLocale, setLocale } from "./src/renderer/src/shared/i18n";',
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
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		/* One copy with the provider the mount wraps in; the hook inside the
		 * bundle must find the client. */
		"@tanstack/react-query",
	],
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
	currentLocale,
	setLocale,
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
	 * The locale is the fixture rather than the machine, and the fixture now goes
	 * through the i18n locale store: this test used to redefine
	 * `navigator.language`, which the formatters read at call time; they read the
	 * store now (the device locale is resolved ONCE - a process's device locale
	 * cannot change - with `setLocale` as the documented test seam). de-DE
	 * defaults to h23, so the assertion below is red exactly when the option
	 * goes.
	 */
	const original = currentLocale();
	setLocale("de-DE");
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
		setLocale(original);
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

/**
 * A settled answer, which is the shape that carries the agent-side stamp.
 *
 * `streaming: false` is the discriminator the component reads, so it is spelled
 * out here rather than defaulted by omission: a fixture that forgot it would be
 * a streaming record, and the assertion "a settled answer paints one" would then
 * be testing the wrong row (see the streaming case below).
 */
const answerRecord = (id, over = {}) => ({
	kind: "assistant",
	id,
	ts: TS,
	text: "Four invoices were late: 1042, 1088, 1103 and 1177.",
	streaming: false,
	stopReason: null,
	error: false,
	...over,
});

/*
 * THE STAMPS ARE PER MESSAGE (operator, 2026-10-20), and this file was rewritten
 * from the opposite rule.
 *
 * The rule now: EVERY user message carries its own absolute time on its action
 * line (`data-stamp="turn"`, "Sent …"), and EVERY final response carries its own
 * (`data-stamp="answer"`, "Answered …"). A final response is settled, paints
 * text and carries no `tool_calls` of its own
 * (`turn-segments.ts::isFinalResponse`), so a turn can state its time several
 * times - once per user message and once per handover - and the operator's
 * sentence is explicit that this is wanted: "The timestamp must appear on ALL
 * final responses and on user messages ... If it is a final response, it has a
 * time."
 *
 * What the superseded rule got right is kept as ABSENCE, because it is still the
 * boundary a count alone cannot see:
 *
 *   - an IN-BETWEEN STATUS ROW (narration carrying its own `tool_calls`) is
 *     in-progress rather than a handover, and paints no stamp - its control is
 *     the hover-only overlay in the gutter;
 *   - a STREAMING answer paints none until it settles;
 *   - a ledger row paints none, closed or open: the collapsed fold and the foot
 *     line carry a run of calls' facts (§E2), and a per-call clock inside an
 *     expansion was a second statement of one instant.
 *
 * `data-stamp="tool"` survives only as a component contract (`TurnTimestamp`'s
 * union) and is asserted absent from every transcript shape here.
 *
 * Counts are per carrier rather than one total, because a total cannot say WHICH
 * carrier a regression added or removed; `allStamps` is what makes "nothing else
 * on the page" checkable.
 */
const stamps = (container, kind) => [
	...container.querySelectorAll(`time[data-stamp="${kind}"]`),
];

/** Every stamp on the page, whichever carrier it names. */
const allStamps = (container) => [...container.querySelectorAll("time")];

/**
 * WHAT "UNDER THE ANSWER, ON THE AGENT RAIL" MEANS NOW (§E3).
 *
 * The stamp is no longer the answer row's direct child with a sibling content
 * box beside it: it is the last element of the turn's FOOT line, in the same row
 * as `Worked for 12s · 8 actions · 1 failed`. So the two facts the old assertions
 * carried are asked of the record box instead, which is where they still hold and
 * is the box a reader's eye actually measures:
 *
 *   - the stamp is not inside the answer's words (`.lo-markdown`), so a selection
 *     drag cannot sweep a clock into a quote;
 *   - it comes AFTER the content box in document order, i.e. under the message and
 *     not above it.
 */
const footPlacement = (stamp) => {
	const recordBox = stamp.closest("[data-record-id]");
	const markdown = recordBox?.querySelector(".lo-markdown") ?? null;
	return {
		recordBox,
		inWords: stamp.closest(".lo-markdown") !== null,
		afterContent:
			markdown !== null && (markdown.compareDocumentPosition(stamp) & 4) === 4, // DOCUMENT_POSITION_FOLLOWING
	};
};

/**
 * THE ACTION LINE A USER MESSAGE'S STAMP RIDES (operator, 2026-10-20).
 *
 * The operator's placement is "at the right of the action line, below the
 * message, which is where `10:16 PM` already sits", and the constraint is that
 * "the time must not move the icons, and the icons must not move the time". So
 * the claims are asked of the LINE rather than of the bubble:
 *
 *   - it is the direct child of the turn's `items-end` column, which is what
 *     right-aligns it to the bubble's right edge;
 *   - it is not one of the toolbar's controls, and no ancestor of it carries the
 *     reveal's `opacity-0` - the stamp is painted at rest and cannot fade with
 *     the icons;
 *   - the toolbar PRECEDES it in document order and keeps its width at rest
 *     (`ACTION_ROW_REVEAL_CLASSES` is opacity-only), so the arrival of the
 *     pointer moves neither element.
 */
const userLine = (stamp) => {
	const line = stamp.parentElement;
	const toolbar = line?.querySelector("[data-lo-user-actions]") ?? null;
	return {
		line,
		column: line?.parentElement ?? null,
		toolbar,
		outsideReveal: stamp.closest(".opacity-0") === null,
		afterToolbar:
			toolbar === null || (toolbar.compareDocumentPosition(stamp) & 4) === 4, // DOCUMENT_POSITION_FOLLOWING
	};
};

const mount = (records, over = {}) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	/*
	 * The transcript reads its cross-session visibility through react-query now;
	 * unseeded is the fail-closed path (nothing hidden), which is the rendering
	 * these placement claims are made against.
	 */
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const render = (next) => {
		act(() => {
			root.render(
				h(
					QueryClientProvider,
					{ client: queryClient },
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
				),
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

test("a user turn carries its own stamp on its action line", async () => {
	/*
	 * THE OPERATOR'S RULE, AS AN ASSERTION (2026-10-20): "User messages get the
	 * time too - on their row beneath the message, same position, right-aligned."
	 * This replaces design round 1's D7 test, which asserted the opposite (a
	 * `time`-less user block, with the turn's one stamp on the closing answer).
	 * D7's measurement - six stamps in one 1380 viewport - was a reaction to the
	 * prototype's per-row stamps; the operator has since required the message's
	 * own time, and the rule is per MESSAGE rather than per TURN.
	 *
	 * The facts asked here are the ones a regression can take away one at a time:
	 * the stamp exists, it is the `turn` carrier with the `Sent` name, it rides
	 * the action line right-aligned under the bubble, and it is OUTSIDE the hover
	 * reveal - a stamp inside the toolbar would fade with the icons and, worse,
	 * would move them when the pointer arrived.
	 */
	const { container, unmount } = mount([userRecord("user:1")]);
	const [stamp] = stamps(container, "turn");
	assert.ok(stamp, "the user message states its own time");
	assert.equal(stamp.getAttribute("datetime"), new Date(TS).toISOString());
	assert.match(stamp.getAttribute("aria-label"), /^Sent /);
	const placed = userLine(stamp);
	assert.ok(
		placed.line?.className.includes("gap-2"),
		"it rides the action line, with a static gap before the stamp",
	);
	assert.ok(
		placed.column?.className.includes("flex-col") &&
			placed.column?.className.includes("items-end"),
		"the line is the turn column's child, right-aligned to the bubble's edge",
	);
	assert.ok(
		placed.line?.previousElementSibling?.querySelector(".rounded-frame"),
		"and the bubble's own row is its previous sibling - directly under the message",
	);
	assert.equal(
		stamp.closest("[data-lo-user-actions]"),
		null,
		"it is a sibling of the toolbar, not one of its controls",
	);
	assert.equal(
		placed.outsideReveal,
		true,
		"outside the opacity-only reveal, so it is painted at rest",
	);
	assert.ok(
		placed.toolbar?.className.includes("opacity-0"),
		"and the toolbar is the thing that is hidden at rest, opacity only",
	);
	assert.equal(
		placed.afterToolbar,
		true,
		"the stamp follows the icons, so their arrival never moves it",
	);
	assert.equal(
		allStamps(container).length,
		1,
		"a user turn with no answer yet states its time once",
	);
	unmount();
});

test("a message with no words of its own still states its time", async () => {
	/*
	 * AN ATTACHMENT-ONLY SEND is still the reader's message - it has a moment,
	 * and the operator's rule is about messages, not about prose. The action row
	 * is gated on `isQuotable` (nothing settled to quote), so this is the shape
	 * where the stamp must exist while the toolbar does not: the line is the
	 * message's, and the fold-out is the words'.
	 */
	const { container, unmount } = mount([
		userRecord("user:1", {
			text: "",
			images: [{ data_b64: "x", mime_type: "image/png" }],
		}),
	]);
	const [stamp] = stamps(container, "turn");
	assert.ok(stamp, "the attachment-only message keeps its own time");
	assert.equal(
		container.querySelector("[data-lo-user-actions]"),
		null,
		"the action row stands down: there are no words to copy, quote or speak",
	);
	assert.equal(
		userLine(stamp).outsideReveal,
		true,
		"and the stamp is still outside any reveal",
	);
	unmount();
});

test("a tool row states no time, closed or open", async () => {
	/*
	 * §E2's aggregation tier and §E3's foot line carry a run of calls' facts, so a
	 * per-call stamp inside the disclosure was a third statement of one instant -
	 * and the operator's own constraint was that the ledger stays quiet: a run of
	 * calls is a run of lines. The strong form of the assertion is therefore on
	 * BOTH states: zero `time` elements while the row is closed, and still zero
	 * with the reader's own disclosure open.
	 */
	const record = toolRecord("tool:1", {
		args: { command: "pnpm test:desktop" },
		output: "tests 40\npass 40\n",
	});
	const { container, unmount } = mount([record]);
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
	assert.equal(
		stamps(container, "tool").length,
		0,
		"and opening it adds none (§E2 removed the per-call clock)",
	);
	assert.equal(
		allStamps(container).length,
		0,
		"so a lone call states no time anywhere, open or closed",
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
	assert.equal(stamps(container, "tool").length, 0, "the row paints nothing");
	assert.equal(container.querySelector("button[aria-expanded]"), null);
	unmount();
});

test("every user message and every final response paints its own stamp, and nothing else does", async () => {
	/*
	 * THE PER-MESSAGE MODEL, in the four shapes of last row the old test walked.
	 * A `<time>` now belongs to a MESSAGE: the user's own (its action line) and
	 * each final response's (the closing answer's foot, or a mid-turn handover's
	 * meta row). The shapes below say, in order: both stamps when the transcript
	 * ends on a later user turn; both when the answer is the last row; the user's
	 * alone when the turn ends on a closed ledger row; the user's alone when it
	 * ends on a statement, because statements own no stamp and the transcript
	 * states no time on their behalf.
	 *
	 * THE COUNTS ARE PER CARRIER rather than a bare total, because a count alone
	 * could not say WHICH carrier a regression added: `tool` is asserted absent
	 * throughout, and `allStamps` is what makes "nothing else on the page"
	 * checkable.
	 */
	const settled = answerRecord("answer:1", { ts: TS + 60_000 });

	// Ends on a USER turn: the answer above still closes its own turn, so its foot
	// is painted, and the trailing user block carries its own stamp.
	const endsOnUser = mount([
		{ ...settled, ts: TS },
		userRecord("user:1", { ts: TS + 60_000 }),
	]);
	assert.equal(
		stamps(endsOnUser.container, "turn").length,
		1,
		"the last user message carries its own time",
	);
	assert.equal(stamps(endsOnUser.container, "answer").length, 1);
	assert.equal(
		allStamps(endsOnUser.container).length,
		2,
		"the closing answer's foot plus the trailing message's own time",
	);
	endsOnUser.unmount();

	// Ends on an ANSWER, which is the row whose foot closes the turn.
	const endsOnAnswer = mount([userRecord("user:1"), settled]);
	assert.equal(
		stamps(endsOnAnswer.container, "answer").length,
		1,
		"the closing answer's own foot stamp",
	);
	assert.equal(stamps(endsOnAnswer.container, "turn").length, 1);
	assert.equal(stamps(endsOnAnswer.container, "tool").length, 0);
	assert.equal(allStamps(endsOnAnswer.container).length, 2);
	endsOnAnswer.unmount();

	// Ends on a CLOSED ledger row: the row paints nothing, and the turn has no foot
	// because no answer closed it. The reader's own message keeps its time.
	const endsOnRow = mount([
		userRecord("user:1"),
		toolRecord("tool:1", { args: { command: "pnpm build" }, output: "built" }),
	]);
	assert.deepEqual(
		allStamps(endsOnRow.container).map((time) =>
			time.getAttribute("data-stamp"),
		),
		["turn"],
		"a settled row nobody opened states no time; the user's message still does",
	);
	endsOnRow.unmount();

	// Ends on a NOTICE, which never carried a stamp of its own.
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
	assert.deepEqual(
		allStamps(endsOnNotice.container).map((time) =>
			time.getAttribute("data-stamp"),
		),
		["turn"],
		"a trailing notice states no time of its own",
	);
	endsOnNotice.unmount();
});

test("a settled answer carries its own stamp on the foot line, beside the user's", async () => {
	/*
	 * TWO stamps, ONE PER MESSAGE (operator, 2026-10-20): the user's own time on
	 * its action line, and the closing answer's at the foot of the `Worked for
	 * 12s · 8 actions` line. The closing answer's is still the foot's last
	 * element, so the placement facts stay asked through `footPlacement`.
	 *
	 * The sentence this replaces ("one stamp per turn") is the rule the operator
	 * widened; the foot's stamp did not move, it simply stopped being the only
	 * one a turn paints.
	 */
	const { container, unmount } = mount([
		userRecord("user:1"),
		answerRecord("answer:1", { ts: TS + 60_000 }),
	]);
	assert.equal(
		stamps(container, "turn").length,
		1,
		"the user's message carries its own time on the action line",
	);
	assert.equal(
		stamps(container, "answer").length,
		1,
		"and the closing answer carries its own, on the foot line",
	);
	assert.equal(
		allStamps(container).length,
		2,
		"two messages, two stamps - not one shared turn stamp",
	);
	const [stamp] = stamps(container, "answer");
	assert.equal(
		stamp.getAttribute("datetime"),
		new Date(TS + 60_000).toISOString(),
	);
	const placed = footPlacement(stamp);
	assert.equal(
		placed.inWords,
		false,
		"the stamp is not inside the answer's words",
	);
	assert.equal(
		placed.afterContent,
		true,
		"and it follows the content box it captions",
	);
	assert.equal(
		placed.recordBox?.getAttribute("data-record-id"),
		"answer:1",
		"on the row that closes the turn, rather than on the narration before it",
	);
	/*
	 * AND THE NAME IS TRUTHFUL: the foot's stamp is the answer's, so it says
	 * `Answered` rather than `Sent` - the user block it used to describe is not
	 * where it is drawn any more.
	 */
	assert.match(stamp.getAttribute("aria-label"), /^Answered /);
	unmount();
});

test("an answer that is still arriving carries none", async () => {
	/*
	 * The other half of the same sentence: "not the in-progress tool
	 * intent/response". A response that is still arriving states no time - the
	 * operator's "if it is a final response, it has a time" is a rule about a
	 * SETTLED handover, and this fixture holds exactly one record (the streaming
	 * one) so the absence belongs to it alone. A settled final response earlier
	 * in the same turn is a different row and does carry one; the test below is
	 * where that shape is pinned.
	 * A durable entry may also carry no stop reason at all, which is why neither
	 * `stopReason` nor "is this the last record" is the discriminator.
	 */
	const { container, unmount } = mount([
		userRecord("user:1"),
		answerRecord("answer:1", {
			streaming: true,
			text: "Four invoices were",
		}),
	]);
	// The partial answer IS on screen, so the absence below is about the caption
	// and not about a row that never rendered.
	assert.ok(container.querySelector(".lo-markdown"));
	assert.equal(
		stamps(container, "answer").length,
		0,
		"no stamp while the answer is still being written",
	);
	assert.equal(
		allStamps(container).length,
		1,
		"only the reader's own message states a time: liveness is the working line's job (§ 7)",
	);
	assert.equal(
		allStamps(container)[0].getAttribute("data-stamp"),
		"turn",
		"and it is the user message's, not a caption for the partial answer",
	);
	unmount();
});

test("a collapsed turn re-homes the answer's stamp to the bar, and the user's stays put", async () => {
	/*
	 * THE SHAPE ROUND 1 FOUND THE PREVIOUS GATE PAINTING WRONG (design D1, QA Q-2).
	 * Prose, the calls it narrates, more prose: gating on `!record.streaming` put a
	 * caption under EACH settled prose row, so this fixture carried two identical
	 * clocks interleaved with the ledger in one turn - and the frames showed the
	 * worst version of it, two clocks 56px apart with one sentence between them.
	 *
	 * THE ANSWER'S STAMP IS STILL ONE PER FINAL RESPONSE, and the collapse still
	 * moves its carrier: a turn with in-between rows condenses (the frozen
	 * design's §4), and the closing answer's stamp moves up to the bar with the
	 * foot it re-homes. The narration that opened the turn carries its own
	 * `tool_calls`, so it is not a final response and paints nothing; the user's
	 * message keeps its own stamp outside the bar, because it is the reader's
	 * message and not a fact of the collapsed run.
	 */
	const { container, unmount } = mount([
		userRecord("user:1"),
		/*
		 * THE NARRATION CARRIES ITS OWN CALLS: this sentence opened the turn and the
		 * calls below are the ones it announced (`isFinalResponse` reads the wire
		 * fact, not the fixture's intent). Without it V5 pins the row on screen and
		 * the stamp's carrier moves off the bar - the CI failure this fixture caused
		 * (round 3, finding 1).
		 */
		answerRecord("answer:1", { text: "Reading the ledger.", callsTools: true }),
		toolRecord("tool:1"),
		toolRecord("tool:2"),
		answerRecord("answer:2", { text: "Four invoices were late." }),
	]);
	const captions = stamps(container, "answer");
	assert.equal(
		captions.length,
		1,
		"one answer stamp for the turn, not one per settled prose row",
	);
	assert.ok(
		captions[0].closest("[data-turn-summary]"),
		"and with a bar over the run, the bar is what carries it",
	);
	assert.equal(
		captions[0].closest("[data-record-id]")?.getAttribute("data-record-id"),
		"answer:1",
		"the bar stands at the first hidden row's slot, and the stamp sits in it",
	);
	assert.equal(
		container.textContent.includes("Worked"),
		false,
		"the foot line it replaces is not painted beside it",
	);
	assert.equal(
		stamps(container, "tool").length,
		0,
		"and a closed ledger row still carries none",
	);
	assert.deepEqual(
		allStamps(container).map((time) => time.getAttribute("data-stamp")),
		["turn", "answer"],
		"the user's message states its own time; the collapsed run states the answer's once",
	);
	unmount();

	/*
	 * THE PAIR THE COLLAPSE MUST NOT BREAK: with nothing between the user row and
	 * the answer, there is no bar and the foot line keeps the stamp exactly where
	 * it always was - one stamp either way, and the FOOT is the carrier.
	 */
	const plain = mount([
		userRecord("user:1"),
		answerRecord("answer:1", { text: "Four invoices were late." }),
	]);
	assert.equal(
		plain.container.querySelector("[data-turn-summary]"),
		null,
		"nothing in between: nothing to collapse",
	);
	const footStamp = stamps(plain.container, "answer");
	assert.equal(footStamp.length, 1);
	assert.equal(
		stamps(plain.container, "turn").length,
		1,
		"and the user's own stamp is painted either way",
	);
	assert.equal(
		footStamp[0].closest("[data-record-id]")?.getAttribute("data-record-id"),
		"answer:1",
		"the answer's own closing block keeps the stamp where it always was",
	);
	assert.equal(
		footStamp[0].closest("[data-turn-summary]"),
		null,
		"and no bar exists to carry it (nothing hides)",
	);
	plain.unmount();
});

test("a working turn stamps each settled final response, and paints no closing caption", async () => {
	/*
	 * THE OPERATOR'S "FINAL RESPONSES EVEN IN BETWEEN" CASE (2026-10-20), and the
	 * two shapes of "the turn has not handed over its last answer yet" that the
	 * old gate used to caption with nothing at all.
	 *
	 * The rule it replaces said a mid-turn handover states no time because "a
	 * mid-turn handover has none to state". The operator's rule is the reverse:
	 * the time is the MESSAGE's, not the turn's, so a settled final response
	 * states it wherever it lands in the turn. What the working turn must NOT
	 * paint is the closing caption: no foot line, and no `Worked for` caption on
	 * a row that did not settle the turn.
	 *
	 * The stamp's placement is the meta row the final response already owns -
	 * after the action row, inside the same right-aligned span - so a pointer
	 * arriving on the row fades the icons in beside a stamp that was already
	 * painted.
	 */
	for (const [name, records] of [
		[
			"a turn ending on a closed ledger row",
			[
				userRecord("user:1"),
				answerRecord("answer:1", { text: "Checking the ledger first." }),
				toolRecord("tool:1"),
			],
		],
		[
			"a turn whose last answer is still arriving",
			[
				userRecord("user:1"),
				answerRecord("answer:1", { text: "Checking the ledger first." }),
				toolRecord("tool:1"),
				answerRecord("answer:2", { text: "Four were late", streaming: true }),
			],
		],
	]) {
		const { container, unmount } = mount(records);
		const captions = stamps(container, "answer");
		assert.equal(
			captions.length,
			1,
			`${name}: the settled final response states its own time once`,
		);
		const [caption] = captions;
		assert.equal(
			caption.closest("[data-record-id]")?.getAttribute("data-record-id"),
			"answer:1",
			`${name}: and it is the settled handover's, not the unfinished row's`,
		);
		assert.equal(
			caption.closest("[data-turn-summary]"),
			null,
			`${name}: no bar covers it`,
		);
		assert.equal(
			container.textContent.includes("Worked"),
			false,
			`${name}: no "Worked for" caption, because the turn has not settled`,
		);
		const control = caption
			.closest("[data-record-id]")
			.querySelector("[data-lo-response-actions]");
		assert.ok(control, "the row it stamps is the final response's own");
		assert.ok(
			(control.compareDocumentPosition(caption) & 4) === 4, // DOCUMENT_POSITION_FOLLOWING
			"the stamp follows the action row in document order",
		);
		assert.equal(
			caption.closest("[data-lo-response-actions]"),
			null,
			"and it is outside the toolbar, so the reveal cannot fade it",
		);
		assert.equal(
			caption.closest(".opacity-0"),
			null,
			"outside the opacity-only reveal altogether",
		);
		assert.deepEqual(
			allStamps(container).map((time) => time.getAttribute("data-stamp")),
			["turn", "answer"],
			"two messages on the page, two stamps: the user's and the final response's",
		);
		unmount();
	}
});

test("a reply-only final response still states its time, without a toolbar", async () => {
	/*
	 * REVIEW ROUND 1, C3. The row used to be gated on `quotable`, so a settled
	 * non-closing handover whose whole body is the `<reply-to>` transport markup
	 * had no visible text to copy and shipped no row at all - no stamp either -
	 * while a CLOSING answer in the same shape kept its foot stamp. The operator's
	 * rule has no such exception ("If it is a final response, it has a time"), so
	 * the row now renders on `isFinalResponse` and only the toolbar stays behind
	 * the copy gate.
	 */
	const { container, unmount } = mount([
		userRecord("user:1"),
		answerRecord("answer:1", {
			text: "<reply-to>What was the total?</reply-to>",
		}),
		toolRecord("tool:1"),
		answerRecord("answer:2", { text: "Four were late." }),
	]);
	const row = container.querySelector('[data-record-id="answer:1"]');
	assert.ok(row, "the reply-only handover is on screen");
	assert.equal(
		row.querySelector("[data-lo-response-actions]"),
		null,
		"no words to copy, so no toolbar",
	);
	const stamp = row.querySelector('time[data-stamp="answer"]');
	assert.ok(stamp, "and it still states its own time");
	assert.equal(
		stamp.closest("[data-lo-response-actions]"),
		null,
		"outside the (absent) toolbar",
	);
	assert.equal(
		stamps(container, "answer").length,
		2,
		"the reply-only handover and the closing answer each state one",
	);
	unmount();
});

test("a statement after the answer does not take the answer's caption away", async () => {
	/*
	 * DESIGN ROUND 2's D2-1 and DESIGN ROUND 3's D3-1: the FIVE statement kinds, and
	 * the control cases that turn on them. The first gate keyed on the turn's last
	 * PAINTING row, so any row after the answer stripped the caption — and for a
	 * statement that is not a rendering preference but a lost fact: a notice, a
	 * compaction receipt, a custom row, a peer receipt and a wake receipt all paint
	 * no `<time>` of their own and have no disclosure to open, so the turn's only
	 * time was gone from the screen with nothing to click.
	 *
	 * COVERAGE, stated rather than implied because it differs per kind: `notice` and
	 * `peer` have committed frame shapes (`chat-canonical-notices--notice-lengths`,
	 * `chat-canonical-notices--session-incidents` and the peer half of
	 * `chat-tool-rows--answer-then-statement`), while `custom`, `wake` and
	 * `compaction` have no story that puts them after an answer — QA round 3 said so
	 * for the first two and the designer for the third — so THEY ARE TEST-LEVEL ONLY
	 * here rather than claiming a frame that does not exist.
	 *
	 * The two rows that DO end a turn's work keep their old behaviour, and they are
	 * asserted here beside the new ones rather than left to the tests above, because
	 * the fix is one predicate and the way to break it is to widen it:
	 *
	 * - a ledger row still ends the handover (the agent is working; the answer it
	 *   will end on has not been written). The settled final response above it
	 *   keeps its own stamp under the per-message rule; the ledger row adds none;
	 * - a streaming answer still carries none: it has not settled, so its message
	 *   has no time to state yet.
	 */
	const STATEMENT_ROWS = [
		[
			"notice",
			{
				kind: "notice",
				id: "notice:1",
				ts: TS + 90_000,
				text: "The run was stopped by the reader.",
				level: "info",
			},
		],
		[
			"compaction",
			/*
			 * The live spelling of a pass (`compaction:<generation>:<before>:<after>`),
			 * which is the id shape the reducer mints. Design round 3's D3-1: a
			 * compaction receipt renders exactly like a notice - receipt line, no
			 * `<time>`, no disclosure - so it belonged in this table, and it is the one
			 * kind here with NO story shape on purpose (see the note above the loop).
			 */
			{
				kind: "compaction",
				id: "compaction:1:41000:9000",
				ts: TS + 90_000,
				text: "Context compacted from 41k to 9k tokens.",
			},
		],
		[
			"custom",
			{
				kind: "custom",
				id: "custom:1",
				ts: TS + 90_000,
				customType: "job_result",
				level: "info",
				category: null,
				provider: null,
				headline: "The session incident was recorded.",
				detail: null,
				text: "The session incident was recorded.",
			},
		],
		[
			"peer",
			{
				kind: "peer",
				id: "peer:1",
				ts: TS + 90_000,
				body: "Which invoices were paid late?",
				// Every identity field is present: the row derives its own headline from
				// them, and a fixture that skipped them would fail in the row rather
				// than in the rule this test is about.
				sender: {
					pid: "92064",
					conversationName: "review-agent",
					cwd: "/Users/damian/local-operator-ui",
					sessionId: "01J8ZQ4K7XABCDEF",
					modelLabel: "deepseek/deepseek-flash",
				},
			},
		],
		[
			"wake",
			{
				kind: "wake",
				id: "wake:1",
				ts: TS + 90_000,
				text: "<envelope>\n\nCheck the deploy.",
			},
		],
	];

	for (const [name, statement] of STATEMENT_ROWS) {
		const { container, unmount } = mount([
			userRecord("user:1"),
			answerRecord("answer:1"),
			statement,
		]);
		const captions = stamps(container, "answer");
		assert.equal(
			captions.length,
			1,
			`a ${name} row after the answer leaves its caption alone: the turn handed its answer over before the statement arrived`,
		);
		assert.equal(
			captions[0].closest("[data-record-id]")?.getAttribute("data-record-id"),
			"answer:1",
			"and the caption is on the answer rather than on the statement row",
		);
		assert.equal(
			allStamps(container).length,
			2,
			"the user's message and the answer's foot, and no third one for the statement",
		);
		unmount();
	}

	/*
	 * THE CONTROLS THE FIX MUST NOT HAVE WIDENED. A ledger row still ends the
	 * handover: the settled final response above it states its own time, but the
	 * turn has no closing caption and the ledger row states nothing.
	 */
	const endsOnCall = mount([
		userRecord("user:1"),
		answerRecord("answer:1", { text: "Checking the ledger first." }),
		toolRecord("tool:1"),
	]);
	assert.deepEqual(
		allStamps(endsOnCall.container).map((time) =>
			time.getAttribute("data-stamp"),
		),
		["turn", "answer"],
		"the settled final response's own stamp, and the user's - nothing for the ledger row",
	);
	assert.equal(
		endsOnCall.container.textContent.includes("Worked"),
		false,
		"and no closing foot line, because no answer closed the turn",
	);
	endsOnCall.unmount();

	// And the same for an answer that has not settled: it states nothing itself.
	const endsStreaming = mount([
		userRecord("user:1"),
		answerRecord("answer:1", { text: "Checking the ledger first." }),
		answerRecord("answer:2", { text: "Four were late", streaming: true }),
	]);
	const streamingCaptions = stamps(endsStreaming.container, "answer");
	assert.equal(
		streamingCaptions.length,
		1,
		"one answer stamp, for the settled handover above it",
	);
	assert.equal(
		streamingCaptions[0]
			.closest("[data-record-id]")
			?.getAttribute("data-record-id"),
		"answer:1",
		"the streaming row itself states no time",
	);
	endsStreaming.unmount();
});

test("a multi-paragraph answer in one record still carries exactly one stamp", async () => {
	/*
	 * The other side of the same rule, and the reason it is not "one caption per
	 * paragraph": three paragraphs in ONE record are one answer, so they carry one
	 * caption - the case that made the whole-notice/whole-answer distinction worth
	 * stating. `chat-canonical-quote/sent-turn-quote` is the frame for it.
	 */
	const { container, unmount } = mount([
		userRecord("user:1"),
		answerRecord("answer:1", {
			text: "Four invoices were late.\n\nThe oldest is 41 days.\n\nI sent reminders.",
		}),
	]);
	const captions = stamps(container, "answer");
	assert.equal(
		captions.length,
		1,
		"one caption for the record, not one per paragraph",
	);
	const placed = footPlacement(captions[0]);
	assert.equal(
		placed.afterContent,
		true,
		"and it sits under the whole content box rather than under a paragraph in it",
	);
	assert.equal(placed.inWords, false, "outside the prose it captions");
	unmount();
});

test("the answer's caption sits under the content in its other shapes too", async () => {
	/*
	 * The answer row renders more than prose: a reply quote above it, a refusal's
	 * danger ink, and a `Stopped before finishing` line under an aborted turn. The
	 * operator's constraint is that the caption sits under the MESSAGE CONTENT in
	 * every one of them and appears once - which is about where the wrapper sits,
	 * not about the words, so it is asserted structurally.
	 *
	 * IMAGES ARE NOT ONE OF THE SHAPES and that is checked rather than assumed: the
	 * `assistant` record carries no `images` field (`transcript-reducer.ts`),
	 * `CanonicalImage` is reached from `UserRow` and from the tool row's `details`,
	 * and `AssistantRow` renders none - so there is no image shape for this caption
	 * to fall above.
	 */
	for (const [name, over] of [
		["a refusal", { stopReason: "refusal", error: true }],
		["an aborted turn", { stopReason: "aborted" }],
		["an error", { error: true }],
	]) {
		const { container, unmount } = mount([
			userRecord("user:1"),
			answerRecord("answer:1", over),
		]);
		const found = stamps(container, "answer");
		assert.equal(found.length, 1, `${name} paints exactly one caption`);
		const placed = footPlacement(found[0]);
		assert.equal(
			placed.afterContent,
			true,
			`and ${name}'s caption is still under its content box`,
		);
		unmount();
	}
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
	 * The user's own stamp is still there, under its bubble - this is the removal
	 * of the foot's line, not of the stamps the operator asked to keep - and the
	 * document-order comparison is what makes the claim about the FOOT rather than
	 * about a total: the stamp precedes the working line, so nothing states a time
	 * beneath the thinking indicator. A count alone would also pass with the stamp
	 * moved under the line, which is the reported bug.
	 */
	const [stamp] = allStamps(container);
	assert.equal(
		allStamps(container).length,
		1,
		"the reader's own message keeps its time while the turn works",
	);
	assert.equal(
		stamp.getAttribute("data-stamp"),
		"turn",
		"and it is the message's, not a caption for the work in flight",
	);
	assert.ok(
		(stamp.compareDocumentPosition(line) & 4) === 4, // DOCUMENT_POSITION_FOLLOWING
		"the working line follows the stamp: nothing states a time beneath it",
	);
	unmount();
});

test("the two carriers stay distinguishable, and the displaced one stays gone", async () => {
	/*
	 * THE CONTRACT THIS REPLACES, stated so the revision is legible: the stamp
	 * used to be a fact about ONE thing (a user turn), an open tool call borrowed
	 * its name, and the answer's caption made a third carrier. The tool carrier
	 * was removed (§E2) and the per-message rule brings the user's back beside the
	 * answer's, so what is worth pinning is that `data-stamp` still tells the two
	 * apart - they answer different questions ("Sent" vs "Answered") - and that
	 * the removed carrier stays absent.
	 */
	const { container, unmount } = mount([
		userRecord("user:1"),
		answerRecord("assistant:1", { ts: TS + 1000 }),
	]);
	assert.equal(stamps(container, "turn").length, 1, "the user message's");
	assert.equal(stamps(container, "tool").length, 0, "no per-call carrier");
	assert.equal(
		stamps(container, "answer").length,
		1,
		"the closing answer's foot does",
	);
	assert.equal(
		stamps(container, "answer")[0].closest(".rounded-frame"),
		null,
		"and it is not attached to a card: an answer renders none",
	);
	unmount();

	/*
	 * A TRANSCRIPT OF ONE MESSAGE keeps exactly that message's stamp: a lone user
	 * turn states one time, and a lone ledger row states none (there is no
	 * message to date, and the per-call clock is still removed).
	 */
	const userOnly = mount([userRecord("user:1")]);
	assert.deepEqual(
		allStamps(userOnly.container).map((time) =>
			time.getAttribute("data-stamp"),
		),
		["turn"],
		"a user turn alone states its own time",
	);
	userOnly.unmount();

	const callOnly = mount([toolRecord("tool:1")]);
	assert.equal(
		allStamps(callOnly.container).length,
		0,
		"and a ledger row in a turn with no message states nothing",
	);
	callOnly.unmount();
});

test("opening and closing disclosures never changes how many clocks are on the page", async () => {
	/*
	 * The removed per-call carrier had a property worth keeping as an ABSENCE: the
	 * count used to track the reader's own clicks, so a regression could put a clock
	 * inside an expansion and show up here as a number that moved. The page's count
	 * is the turns' feet now, and the four states below - one row open, both open,
	 * the earlier one closed, both closed - are the matrix that says the reader's
	 * clicks cannot move it.
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

	for (const [state, click] of [
		["the last row opened", () => triggers()[1].click()],
		["both rows opened", () => triggers()[0].click()],
		["the earlier row closed again", () => triggers()[0].click()],
		["both rows closed again", () => triggers()[1].click()],
	]) {
		await act(async () => {
			click();
		});
		assert.equal(
			allStamps(container).length,
			0,
			`${state}: a run of calls states no time, in a turn that handed over no answer`,
		);
	}
	unmount();
});

test("a new record OBJECT for an open row keeps its expansion", async () => {
	/*
	 * The route QA reached the round-2 defect by, from the app's own reducer rather
	 * than from a click: `buildRows`/`upsert` mint a NEW record object whenever a
	 * call changes (a `tool_execution_end`, a full resync), which was a new prop
	 * identity for the row AND a new inline callback for it. The stamp this used to
	 * be measured by is no longer painted by the row (§E2), so the same defect is
	 * asked of the expansion itself: a re-render of an open row is not a closure,
	 * and a whole-transcript resync is not one either (QA round 2, Q2-1; review
	 * round 3, R3-1).
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
	const openDetail = () => container.querySelector("[data-detail-section]");
	await act(async () => {
		[...container.querySelectorAll("button[aria-expanded]")][1].click();
	});
	assert.ok(openDetail(), "the row the reader opened is open");

	// The call changes: a new record object for the same id, still open.
	rerender([
		first,
		{ ...last, output: "built\n\ndone in 1.2s", durationS: 1.2 },
	]);
	assert.ok(openDetail(), "and a new record object does not close it");

	// And a whole-transcript resync, which re-mints every record object at once.
	rerender([
		{ ...first },
		{ ...last, output: "built\n\ndone in 1.2s", durationS: 1.2 },
	]);
	assert.ok(openDetail(), "nor does a resync");
	assert.equal(
		allStamps(container).length,
		0,
		"and none of it painted a clock the turn did not own",
	);
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

test("many stamps mounting together arm ONE timer per deadline, and a clock jump re-arms", async (t) => {
	/*
	 * THE STORE USED TO CLEAR AND RE-ARM ON EVERY SUBSCRIBE: one
	 * `clearTimeout` + `setTimeout` pair per stamped row, so a 61-row transcript
	 * paid 61 scheduler round trips inside its one mount task to end up with the
	 * timer it started with (renderer profile §4 L2-d). It now re-arms only when
	 * the freshly computed deadline differs from the pending one, or when the
	 * wall clock has moved against the monotonic clock since arming - the second
	 * is the suspend/resume case the deadline alone cannot see.
	 *
	 * Counted with spies over the mocked timers: every timer aimed at the next
	 * midnight (>= a minute out; React's own scheduler timers are shorter) and
	 * every `clearTimeout`. Forty stamps mounted in one commit must arm exactly
	 * one and clear none. Then the mocked wall clock jumps half an hour while the
	 * monotonic clock (`performance.now`, which these mocks do not move) stands
	 * still - the signature a resumed machine presents - and the next subscriber
	 * must replace the timer with one aimed from the new clock.
	 */
	const nineAm = new Date(2026, 3, 15, 9, 0, 0, 0).getTime();
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: nineAm });
	// Both clocks start fixed: a loaded runner taking >1s to mount is not a
	// simulated suspend. Only the explicit wall-clock jump below creates drift.
	t.mock.method(performance, "now", () => 0);
	const armed = [];
	let cleared = 0;
	const mockedSetTimeout = globalThis.setTimeout;
	const mockedClearTimeout = globalThis.clearTimeout;
	globalThis.setTimeout = (fn, ms, ...rest) => {
		const id = mockedSetTimeout(fn, ms, ...rest);
		if ((ms ?? 0) >= 60_000) armed.push(ms);
		return id;
	};
	globalThis.clearTimeout = (id) => {
		cleared += 1;
		return mockedClearTimeout(id);
	};
	try {
		const Probe = () => {
			useStampNow();
			return null;
		};
		const container = document.createElement("div");
		const root = createRoot(container);
		act(() => {
			root.render(
				h(
					"div",
					null,
					Array.from({ length: 40 }, (_, at) => h(Probe, { key: at })),
				),
			);
		});
		t.diagnostic(
			`40 stamps: ${armed.length} midnight timer(s) armed, ${cleared} clearTimeout call(s)`,
		);
		assert.deepEqual(
			armed,
			[msUntilNextLocalDay(nineAm)],
			"forty subscribers share one timer aimed at the next local midnight",
		);
		assert.equal(cleared, 0, "and no subscriber cleared it to arm it again");

		// The resumed machine: wall time moved 30 minutes, monotonic time did not.
		t.mock.timers.setTime(nineAm + 30 * 60_000);
		const late = document.createElement("div");
		const lateRoot = createRoot(late);
		act(() => {
			lateRoot.render(h(Probe));
		});
		assert.equal(cleared, 1, "the stale timer is cleared");
		assert.deepEqual(
			armed.slice(1),
			[msUntilNextLocalDay(nineAm + 30 * 60_000)],
			"and replaced by one aimed from the resumed clock",
		);
		act(() => lateRoot.unmount());
		act(() => root.unmount());
	} finally {
		globalThis.setTimeout = mockedSetTimeout;
		globalThis.clearTimeout = mockedClearTimeout;
		t.mock.timers.reset();
	}
});
