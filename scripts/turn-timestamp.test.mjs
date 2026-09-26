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
 * ONE STAMP PER TURN, and the redesign moved WHERE it is painted.
 *
 * §D1 (the turn's own vocabulary: "nothing but space and treatment ... no
 * per-message timestamp") and §E3 (the turn-foot line) put the turn's single
 * stamp at the end of the foot line of the answer that closes the turn, in the
 * same row as `Worked for 12s · 8 actions · 1 failed`. The carriers this file was
 * written against are gone:
 *
 *   - `data-stamp="turn"`, under the user's bubble: REMOVED (design round 1's
 *     D7 measured six stamps in one 1380 viewport - one under every user block
 *     and one under every answer - as a third of the thread's vertical run, and
 *     the foot states the same instant once per turn);
 *   - `data-stamp="tool"`, at the foot of an open tool disclosure: REMOVED by the
 *     aggregation tier (§E2: the fold's summary and the turn's foot carry the
 *     facts a run of calls has, and a per-call clock inside an expansion was a
 *     third statement of one instant);
 *   - `data-stamp="answer"` survives, and it is now the ONLY carrier: the stamp
 *     the foot line draws for the turn it closes.
 *
 * The assertions below still ask per carrier, because a count alone cannot say
 * which regression added or removed a `<time>`; the two removed carriers are
 * asserted as ABSENT wherever they used to be counted, with the reason beside
 * each one. `allStamps` is the unqualified count those absence assertions rest on.
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

test("a user turn carries no stamp of its own", async () => {
	/*
	 * §D1's own sentence, as an assertion: the user's block is `time`-less, and the
	 * turn's one stamp belongs to the foot line of the answer that closes it (§E3).
	 * Design round 1's D7 is where this was measured - one stamp under every user
	 * block in a 1380 viewport - and the placement facts the old assertions carried
	 * (outside the bubble, not part of what a quote of the turn sweeps) are the
	 * foot's properties now, asserted in the closing answer's own test below.
	 */
	const { container, unmount } = mount([userRecord("user:1")]);
	assert.equal(
		stamps(container, "turn").length,
		0,
		"the user block states no time of its own (design round 1, D7)",
	);
	assert.equal(
		allStamps(container).length,
		0,
		"and a turn with no answer yet has no foot to carry one: liveness is the working line's job (§ 7)",
	);
	assert.ok(
		container.querySelector(".rounded-frame"),
		"the bubble is what the turn is, and it carries no clock",
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

test("the only stamps a transcript paints are its turns' own feet", async () => {
	/*
	 * WHAT THIS PINS, in the redesign's vocabulary: a `<time>` on the page belongs
	 * to a turn's foot, and a turn paints a foot only when an ANSWER closes it
	 * (§E3 - the foot is `Worked for … · N actions`, which is a fact about work
	 * that finished). So the four shapes of last row below say, in order: an
	 * answer's foot even though the transcript ends on a later user turn; an
	 * answer's foot when the answer IS the last row; nothing at all when the turn
	 * ends on a closed ledger row or on a statement, because those rows own no
	 * foot and the transcript states no time on their behalf.
	 *
	 * THE COUNTS ARE PER CARRIER rather than a bare total, because a count alone
	 * could not say WHICH carrier a regression added: `turn` and `tool` are
	 * asserted absent throughout, and `allStamps` is what makes "nothing else on
	 * the page" checkable.
	 */
	const settled = answerRecord("answer:1", { ts: TS + 60_000 });

	// Ends on a USER turn: the answer above it still closes the turn it belongs to,
	// so its foot is painted and the trailing user block has none.
	const endsOnUser = mount([
		{ ...settled, ts: TS },
		userRecord("user:1", { ts: TS + 60_000 }),
	]);
	assert.equal(stamps(endsOnUser.container, "turn").length, 0);
	assert.equal(stamps(endsOnUser.container, "answer").length, 1);
	assert.equal(
		allStamps(endsOnUser.container).length,
		1,
		"the closing turn's foot alone: nothing is painted beneath the last user block",
	);
	endsOnUser.unmount();

	// Ends on an ANSWER, which is the row whose foot carries the turn's stamp.
	const endsOnAnswer = mount([userRecord("user:1"), settled]);
	assert.equal(
		stamps(endsOnAnswer.container, "answer").length,
		1,
		"the closing answer's own foot stamp",
	);
	assert.equal(stamps(endsOnAnswer.container, "tool").length, 0);
	assert.equal(allStamps(endsOnAnswer.container).length, 1);
	endsOnAnswer.unmount();

	// Ends on a CLOSED ledger row: the row paints nothing, and the turn has no foot
	// because no answer closed it.
	const endsOnRow = mount([
		userRecord("user:1"),
		toolRecord("tool:1", { args: { command: "pnpm build" }, output: "built" }),
	]);
	assert.equal(
		allStamps(endsOnRow.container).length,
		0,
		"a settled row nobody opened, in a turn that never handed over an answer, states no time",
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
	assert.equal(
		allStamps(endsOnNotice.container).length,
		0,
		"a trailing notice states no time at the foot",
	);
	endsOnNotice.unmount();
});

test("a settled answer's turn carries one stamp, on the foot line", async () => {
	/*
	 * ONE stamp per turn, at the foot of the answer that closes it (§E3, design
	 * round 1's D7/D8): the foot line states `Worked for 12s · 8 actions` and the
	 * clock at its trailing edge dates the turn. The user's block carries none, so
	 * a turn of prose and an answer is exactly one `<time>` on the page.
	 *
	 * The placement facts the old assertions carried - not inside the answer's
	 * words, and after the content rather than above it - are asked through
	 * `footPlacement`, which is where they hold now that the stamp is the foot's
	 * last element rather than a sibling of the content box.
	 */
	const { container, unmount } = mount([
		userRecord("user:1"),
		answerRecord("answer:1", { ts: TS + 60_000 }),
	]);
	assert.equal(
		stamps(container, "turn").length,
		0,
		"the user's block carries none (D7)",
	);
	assert.equal(
		stamps(container, "answer").length,
		1,
		"exactly one for the turn, on the foot line",
	);
	assert.equal(
		allStamps(container).length,
		1,
		"and the turn states its time once, not twice",
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
	 * intent/response". A turn whose answer is still arriving is not captioned
	 * either - see the test below - and that is asserted here on both sides: the
	 * unfinished record carries none, and the settled prose the turn OPENED with
	 * does not inherit the caption just because the streaming one cannot take it.
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
		0,
		"and nothing else does either: liveness is the working line's job (§ 7), and the user's block carries no stamp (D7)",
	);
	unmount();
});

test("a turn paints exactly one stamp, on the answer it closes with", async () => {
	/*
	 * THE SHAPE ROUND 1 FOUND THE PREVIOUS GATE PAINTING WRONG (design D1, QA Q-2).
	 * Prose, the calls it narrates, more prose: gating on `!record.streaming` put a
	 * caption under EACH settled prose row, so this fixture carried two identical
	 * clocks interleaved with the ledger in one turn - and the frames showed the
	 * worst version of it, two clocks 56px apart with one sentence between them.
	 *
	 * The count that matters is therefore per TURN here, while the assertion that
	 * says WHICH row carries it is positional: the turn's last settled answer, and
	 * nothing under the narration the turn opened with. The ORDER is asserted for
	 * the same reason the old test asserted it - a caption that drifted one row up
	 * or down would still produce the right total, so the total alone is not the
	 * claim.
	 */
	const { container, unmount } = mount([
		userRecord("user:1"),
		answerRecord("answer:1", { text: "Reading the ledger." }),
		toolRecord("tool:1"),
		toolRecord("tool:2"),
		answerRecord("answer:2", { text: "Four invoices were late." }),
	]);
	const captions = stamps(container, "answer");
	assert.equal(
		captions.length,
		1,
		"one caption per turn, not one per settled prose row",
	);
	assert.equal(
		captions[0].closest("[data-record-id]")?.getAttribute("data-record-id"),
		"answer:2",
		"and it is the row the turn closes on rather than the narration it opened with",
	);
	assert.equal(
		stamps(container, "tool").length,
		0,
		"and a closed ledger row still carries none",
	);
	assert.deepEqual(
		allStamps(container).map((time) => time.getAttribute("data-stamp")),
		["answer"],
		"one carrier, on the row that closes the turn",
	);
	unmount();
});

test("a turn still working carries no caption, on any of its settled rows", async () => {
	/*
	 * Two shapes of "the answer has not been handed over yet", which the old gate
	 * captioned anyway because it asked a record its own question.
	 *
	 * A turn whose LAST row is a ledger row: the prose above it is a preface to work
	 * that is still going on, and a clock under it would state a time for the turn's
	 * answer while the answer is still to come. This is the ordinary mid-turn state
	 * of the app's own sessions - it is what `prose-between-calls` photographs.
	 *
	 * And a turn whose settled prose is followed by an answer still arriving: the
	 * settled row is no longer what the reader is being handed, and the streaming
	 * row cannot carry a caption, so the turn carries none. That is also why the
	 * caption is not simply "the last settled assistant row": the turn's last row
	 * is the test, and it has to have settled.
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
			"a turn whose answer is still arriving",
			[
				userRecord("user:1"),
				answerRecord("answer:1", { text: "Checking the ledger first." }),
				toolRecord("tool:1"),
				answerRecord("answer:2", { text: "Four were late", streaming: true }),
			],
		],
	]) {
		const { container, unmount } = mount(records);
		assert.equal(
			stamps(container, "answer").length,
			0,
			`${name} paints no caption: the turn has not handed the reader its answer`,
		);
		assert.deepEqual(
			allStamps(container).map((time) => time.getAttribute("data-stamp")),
			[],
			"and the user's block carries none either (D7): the turn states no time until it hands one over",
		);
		unmount();
	}
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
	 * - a ledger row still strips the caption (the agent is working; the answer it
	 *   will end on has not been written);
	 * - a streaming answer still carries none (the answer has not settled, and the
	 *   settled prose above it is narration rather than the row being handed over).
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
			1,
			"the turn's one stamp, on the foot line, and no second one for the statement",
		);
		unmount();
	}

	// The control the fix must NOT have widened: a ledger row still ends the work.
	const endsOnCall = mount([
		userRecord("user:1"),
		answerRecord("answer:1", { text: "Checking the ledger first." }),
		toolRecord("tool:1"),
	]);
	assert.equal(
		stamps(endsOnCall.container, "answer").length,
		0,
		"a turn ending on a ledger row still carries no caption",
	);
	endsOnCall.unmount();

	// And the same for an answer that has not settled.
	const endsStreaming = mount([
		userRecord("user:1"),
		answerRecord("answer:1", { text: "Checking the ledger first." }),
		answerRecord("answer:2", { text: "Four were late", streaming: true }),
	]);
	assert.equal(
		stamps(endsStreaming.container, "answer").length,
		0,
		"a turn whose answer is still arriving still carries no caption",
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
	 * The turn's own stamp is still there, under the bubble - this is the removal
	 * of the foot's line, not of the stamp the operator asked to keep - and the
	 * document-order comparison is what makes the claim about the FOOT rather than
	 * about a total: the stamp precedes the working line, so nothing states a time
	 * beneath the thinking indicator. A count alone would also pass with the stamp
	 * moved under the line, which is the reported bug.
	 */
	assert.equal(
		allStamps(container).length,
		0,
		"and the turn paints none at all while it is still working: the foot line is a settled turn's",
	);
	unmount();
});

test("the turn's one stamp is the closing answer's, and the displaced carriers are gone", async () => {
	/*
	 * THE CONTRACT THIS REPLACES, stated so the deletion is legible: the stamp used
	 * to be a fact about ONE thing (a user turn), and an open tool call borrowed its
	 * name; the answer's caption made a third carrier, and this test pinned that the
	 * three stayed distinguishable by `data-stamp`.
	 *
	 * There is one carrier now (§D1, §E3), so what is worth pinning is the shape of
	 * the absence as well as the presence: a turn+answer paints exactly one `<time>`
	 * and it is the answer's, and a transcript of ONLY a user turn or ONLY a tool
	 * row paints none at all - the two places the removed carriers used to be.
	 */
	const { container, unmount } = mount([
		userRecord("user:1"),
		answerRecord("assistant:1", { ts: TS + 1000 }),
	]);
	assert.equal(
		stamps(container, "turn").length,
		0,
		"the user block carries none",
	);
	assert.equal(stamps(container, "tool").length, 0);
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

	const userOnly = mount([userRecord("user:1")]);
	assert.equal(
		allStamps(userOnly.container).length,
		0,
		"a user turn alone states no time",
	);
	userOnly.unmount();

	const callOnly = mount([toolRecord("tool:1")]);
	assert.equal(
		allStamps(callOnly.container).length,
		0,
		"and neither does a ledger row in a turn that handed over no answer",
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
