import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE STATE MACHINE AND THE ONE-SOURCE RULE, pinned without a browser.
 *
 * The scrollbar fade is two halves that can each rot silently: the module that
 * decides when a scroller is awake (an attribute write driven by events and one
 * shared timer), and the stylesheet that turns that attribute into a fade. This
 * suite pins both, because neither has a shape a green screenshot would catch —
 * a module that writes `active` on every event still LOOKS right, and it is the
 * exact defect the change exists to remove (a DOM write per event restarts the
 * transition, which is the flicker the operator reported).
 *
 * WHY DUCK-TYPED STUBS RATHER THAN A DOM. jsdom has no layout and no scroll
 * geometry, so it would answer none of the questions here; the module reads six
 * things from an element (`isConnected`, `isContentEditable`, `parentElement`,
 * `getAttribute`, `setAttribute`, `nodeType`) and two injected collaborators
 * (the clock and the scroller predicate). Stubbing those pins the contract
 * whole and needs no DOM at all. The clock is injected precisely so the timers
 * are virtual: a suite that slept 2.2 s to see the hold expire would be a suite
 * that measures the machine's load, not the module.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/shared/lib/scrollbar-activity";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	SCROLLBAR_ACTIVE,
	SCROLLBAR_ATTRIBUTE,
	SCROLLBAR_EASING,
	SCROLLBAR_FADE_IN_MS,
	SCROLLBAR_FADE_OUT_MS,
	SCROLLBAR_HOLD_MS,
	SCROLLBAR_IDLE,
	installScrollbarActivity,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/**
 * An element, as much of one as this module reads. Every `setAttribute` is
 * recorded, because the assertions that matter are about the WRITES: "nothing
 * was written while the element was already active" is the no-flicker rule, and
 * it is invisible to a test that only reads the final value.
 */
const element = ({
	scroller = false,
	editable = false,
	parent = null,
	connected = true,
} = {}) => ({
	nodeType: 1,
	isConnected: connected,
	isContentEditable: editable,
	parentElement: parent,
	scroller,
	attributes: new Map(),
	writes: [],
	getAttribute(name) {
		return this.attributes.has(name) ? this.attributes.get(name) : null;
	},
	setAttribute(name, value) {
		this.writes.push(`${name}=${value}`);
		this.attributes.set(name, value);
	},
	/** The element's attribute writes for the fade, in order. */
	fadeWrites() {
		return this.writes.filter((write) => write.startsWith(SCROLLBAR_ATTRIBUTE));
	},
});

/** The document, as much of one as this module reads. */
const fakeDocument = () => ({
	listeners: [],
	addEventListener(type, listener, options) {
		this.listeners.push({ type, listener, options });
	},
	removeEventListener(type, listener) {
		const index = this.listeners.findIndex(
			(entry) => entry.type === type && entry.listener === listener,
		);
		if (index >= 0) this.listeners.splice(index, 1);
	},
	/** Deliver an event to every registered listener of that type. */
	dispatch(type, target) {
		for (const entry of [...this.listeners]) {
			if (entry.type !== type) continue;
			entry.listener({ type, target });
		}
	},
	types() {
		return this.listeners.map((entry) => entry.type).sort();
	},
});

/** A clock the test drives, with one shared virtual timer queue. */
const fakeClock = () => {
	let now = 0;
	let sequence = 0;
	const timers = new Map();
	return {
		clock: {
			now: () => now,
			setTimer: (callback, delayMs) => {
				sequence += 1;
				timers.set(sequence, { at: now + delayMs, callback });
				return sequence;
			},
			clearTimer: (handle) => {
				timers.delete(handle);
			},
		},
		/** Move to `ms` from now, firing every timer that comes due, in order. */
		advance(ms) {
			const end = now + ms;
			for (;;) {
				let earliest = null;
				for (const [handle, timer] of timers) {
					if (timer.at > end) continue;
					if (earliest === null || timer.at < timers.get(earliest).at) {
						earliest = handle;
					}
				}
				if (earliest === null) break;
				const timer = timers.get(earliest);
				timers.delete(earliest);
				now = timer.at;
				timer.callback();
			}
			now = end;
		},
		outstanding() {
			return timers.size;
		},
	};
};

/** Install the module over a fresh document, with the predicate and clock given. */
const install = (scrollers, extra = {}) => {
	const doc = fakeDocument();
	const time = fakeClock();
	const uninstall = installScrollbarActivity({
		doc,
		clock: time.clock,
		isScroller: (candidate) => scrollers.has(candidate),
		...extra,
	});
	return { doc, time, uninstall };
};

test("the first scroll writes idle then active, and a second scroll resets the hold", () => {
	const region = element({ scroller: true });
	const { doc, time } = install(new Set([region]));

	doc.dispatch("scroll", region);
	assert.deepEqual(
		region.fadeWrites(),
		[
			`${SCROLLBAR_ATTRIBUTE}=${SCROLLBAR_IDLE}`,
			`${SCROLLBAR_ATTRIBUTE}=${SCROLLBAR_ACTIVE}`,
		],
		"first sight writes the idle state the transition rule needs, then the reveal",
	);

	// Halfway through the hold, a second scroll re-arms it.
	time.advance(SCROLLBAR_HOLD_MS - 200);
	doc.dispatch("scroll", region);
	assert.deepEqual(
		region.fadeWrites(),
		[
			`${SCROLLBAR_ATTRIBUTE}=${SCROLLBAR_IDLE}`,
			`${SCROLLBAR_ATTRIBUTE}=${SCROLLBAR_ACTIVE}`,
		],
		"a second scroll while active writes NOTHING — a write would restart the fade",
	);

	time.advance(200);
	assert.equal(
		region.getAttribute(SCROLLBAR_ATTRIBUTE),
		SCROLLBAR_ACTIVE,
		"the original expiry was moved out by the second scroll",
	);

	time.advance(SCROLLBAR_HOLD_MS - 200 + 1);
	assert.equal(
		region.getAttribute(SCROLLBAR_ATTRIBUTE),
		SCROLLBAR_IDLE,
		"the hold expires against the LAST qualifying event",
	);
});

test("the sweep drops a disconnected element without writing to it", () => {
	const live = element({ scroller: true });
	const gone = element({ scroller: true });
	const { doc, time } = install(new Set([live, gone]));

	doc.dispatch("scroll", live);
	doc.dispatch("scroll", gone);
	gone.isConnected = false;
	time.advance(SCROLLBAR_HOLD_MS + 1);

	assert.equal(live.getAttribute(SCROLLBAR_ATTRIBUTE), SCROLLBAR_IDLE);
	assert.deepEqual(
		gone.fadeWrites(),
		[
			`${SCROLLBAR_ATTRIBUTE}=${SCROLLBAR_IDLE}`,
			`${SCROLLBAR_ATTRIBUTE}=${SCROLLBAR_ACTIVE}`,
		],
		"the removed element keeps only its reveal: the sweep does not write to it",
	);

	// And it is gone from the map: nothing is left for the timer to wake for.
	assert.equal(
		time.outstanding(),
		0,
		"the shared timer goes dormant when idle",
	);

	/*
	 * A node that is no longer in the document is never written to, from either
	 * side: the sweep above drops it, and an event that still reaches the module
	 * with a detached target is dropped at the reveal. The second half is what
	 * keeps a detached subtree out of the `Map` in the first place — an event
	 * arriving during an unmount must not leave the module holding a node the
	 * document has already let go of.
	 */
	const detached = element({ scroller: true, connected: false });
	const detachedRun = install(new Set([detached]));
	detachedRun.doc.dispatch("scroll", detached);
	detachedRun.doc.dispatch("pointerover", detached);
	assert.deepEqual(
		detached.fadeWrites(),
		[],
		"an event whose target is already out of the document writes nothing",
	);
	assert.equal(detachedRun.time.outstanding(), 0, "and arms no timer for it");
});

test("pointerover walks up to the innermost scroller, and a non-scroller gets nothing", () => {
	const outer = element({ scroller: true });
	const inner = element({ scroller: true, parent: outer });
	const leaf = element({ parent: inner });
	const plain = element({ parent: element() });
	const { doc } = install(new Set([outer, inner]));

	doc.dispatch("pointerover", leaf);
	assert.equal(
		inner.getAttribute(SCROLLBAR_ATTRIBUTE),
		SCROLLBAR_ACTIVE,
		"the INNERMOST scroller is the one revealed",
	);
	assert.equal(
		outer.getAttribute(SCROLLBAR_ATTRIBUTE),
		null,
		"the outer scroller is left alone — revealing it would leak into the inner one",
	);

	doc.dispatch("pointerover", plain);
	assert.equal(
		plain.getAttribute(SCROLLBAR_ATTRIBUTE),
		null,
		"an element with no scroller above it receives no attribute",
	);
});

test("a scroller inside a contenteditable region is never written to", () => {
	/*
	 * The real shape this models is the canvas wysiwyg editor: the element the
	 * undo manager watches is the editable root, and the scroll container that
	 * carries the bar is an ANCESTOR of it. `isContentEditable` is inherited down
	 * the tree in a real document, so the stub marks the descendants too.
	 */
	const container = element({ scroller: true });
	const editor = element({ editable: true, parent: container });
	const inside = element({ scroller: true, parent: editor, editable: true });
	const { doc } = install(new Set([container, editor, inside]));

	doc.dispatch("pointerover", inside);
	assert.deepEqual(
		inside.fadeWrites(),
		[],
		"the undo manager watches its own subtree, so nothing is written inside it",
	);

	doc.dispatch("pointerover", editor);
	assert.deepEqual(
		[...editor.fadeWrites(), ...container.fadeWrites()],
		[],
		"nor on the editable element itself — the walk stops at the boundary rather than reaching the container above it",
	);

	doc.dispatch("scroll", container);
	assert.equal(
		container.getAttribute(SCROLLBAR_ATTRIBUTE),
		SCROLLBAR_ACTIVE,
		"the editor's own scroll container is outside the region and still fades",
	);
});

test("uninstall removes every listener and clears the outstanding timer", () => {
	const region = element({ scroller: true });
	const { doc, time, uninstall } = install(new Set([region]));

	assert.deepEqual(
		doc.types(),
		["pointerdown", "pointerover", "scroll"],
		"three document listeners, and no more",
	);
	for (const entry of doc.listeners) {
		assert.deepEqual(
			entry.options,
			{ capture: true, passive: true },
			`the ${entry.type} listener observes and never blocks a scroll`,
		);
	}

	doc.dispatch("scroll", region);
	assert.equal(time.outstanding(), 1, "a reveal arms the one shared timer");

	uninstall();
	assert.deepEqual(doc.types(), [], "every listener is off");
	assert.equal(time.outstanding(), 0, "the timer is cleared, not left to fire");

	// A dispatch after uninstall is inert rather than an error: nothing is
	// listening, and the module holds no state that could act on it.
	const writes = region.fadeWrites().length;
	doc.dispatch("scroll", region);
	assert.equal(region.fadeWrites().length, writes);
});

test("the shared timer is armed once and goes dormant when nothing is pending", () => {
	const first = element({ scroller: true });
	const second = element({ scroller: true });
	const { doc, time } = install(new Set([first, second]));

	doc.dispatch("scroll", first);
	assert.equal(time.outstanding(), 1, "the first reveal arms it");
	doc.dispatch("scroll", second);
	assert.equal(
		time.outstanding(),
		1,
		"a second scroller does not add a timer — one for the whole app",
	);

	time.advance(SCROLLBAR_HOLD_MS + 1);
	assert.equal(
		time.outstanding(),
		0,
		"and it goes dormant once both have expired",
	);
});

/*
 * THE ONE-SOURCE RULE. The stylesheet and the module must not be able to drift:
 * the durations and the hold are exported once and read into the CSS at build
 * time, so a number written literally in the stylesheet would be a second
 * source. The shape is asserted, not a line number.
 */
const stylesSource = readFileSync(
	"src/renderer/src/shared/components/common/global-scrollbar-styles.tsx",
	"utf8",
);

test("the stylesheet takes every duration from the module's exported constants", () => {
	for (const [name, value] of [
		["SCROLLBAR_FADE_IN_MS", SCROLLBAR_FADE_IN_MS],
		["SCROLLBAR_FADE_OUT_MS", SCROLLBAR_FADE_OUT_MS],
		["SCROLLBAR_HOLD_MS", SCROLLBAR_HOLD_MS],
	]) {
		assert.ok(
			stylesSource.includes(`\${${name}}ms`),
			`the stylesheet interpolates ${name}`,
		);
		assert.ok(
			!new RegExp(`\\b${value}ms\\b`).test(stylesSource),
			`and does not also carry ${value}ms as a literal (that is the second source this pins against)`,
		);
	}
});

test("the stylesheet keeps the shipped look and adds the fade's rules", () => {
	assert.ok(
		stylesSource.includes("width: 8px;") &&
			stylesSource.includes("height: 8px;"),
		"the bar is still 8px on both axes — the gutter geometry does not move",
	);
	assert.ok(
		stylesSource.includes("border-radius: 4px;"),
		"and still paints radius 4 (the contract line says 2; the operator kept the look)",
	);
	assert.ok(
		stylesSource.includes(
			"color-mix(in srgb, var(--color-control) calc(var(--lo-sb) * 100%), transparent)",
		),
		"the fade is the thumb's own colour, mixed towards transparent",
	);
	assert.ok(
		stylesSource.includes("@property --lo-sb") &&
			stylesSource.includes("initial-value: 0;"),
		"the registered property is what makes it interpolatable at all",
	);
	assert.ok(
		stylesSource.includes("@keyframes lo-sb-blip"),
		"the keyboard blip is an animation, which cannot get stuck",
	);
	assert.ok(
		stylesSource.includes(
			'[${SCROLLBAR_ATTRIBUTE}]:focus-visible:not([${SCROLLBAR_ATTRIBUTE}="active"])',
		),
		"and it yields to the driving paths: an animation beats a normal declaration",
	);
	assert.ok(
		stylesSource.includes("forced-colors: active"),
		"and forced colors suppresses the fade rather than hiding a control",
	);
	assert.ok(
		stylesSource.includes("${SCROLLBAR_EASING}"),
		"the curve is the shared constant too",
	);
	assert.ok(
		!stylesSource.includes(SCROLLBAR_EASING),
		"and the curve is not also spelled out in the stylesheet, which would be a second source",
	);
});
