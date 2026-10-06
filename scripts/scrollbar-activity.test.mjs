import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
	SCROLLBAR_RESTING_FLOOR,
	UNDO_SCOPE_ATTRIBUTE,
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
	focusVisible = true,
} = {}) => ({
	nodeType: 1,
	isConnected: connected,
	isContentEditable: editable,
	parentElement: parent,
	scroller,
	focusVisible,
	/** `:focus-visible` is the module's keyboard test; nothing else is asked. */
	matches(selector) {
		return selector === ":focus-visible" ? this.focusVisible : false;
	},
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
		["focusin", "pointerdown", "pointerover", "scroll"],
		"four document listeners, and no more — the fourth is the keyboard door",
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
 * THE KEYBOARD DOOR (review round 1: M1 / Q1 / D1 / U1). The cue exists for the
 * reader who has arrived at a scroller without moving it — no wheel, no pointer
 * — so the test has to arrive that way too: a cold element, never touched, no
 * attribute on it. The old CSS blip could not pass this test at all, because it
 * keyed on an attribute only the other two doors write.
 */
test("a keyboard arrival on a cold scroller reveals it, and a pointer's focus does not", () => {
	const cold = element({ scroller: true });
	const keyboard = install(new Set([cold]));
	keyboard.doc.dispatch("focusin", cold);
	assert.deepEqual(
		cold.fadeWrites(),
		[
			`${SCROLLBAR_ATTRIBUTE}=${SCROLLBAR_IDLE}`,
			`${SCROLLBAR_ATTRIBUTE}=${SCROLLBAR_ACTIVE}`,
		],
		"tabbing onto a scroller nothing has touched plays the reveal",
	);
	keyboard.time.advance(SCROLLBAR_HOLD_MS + 1);
	assert.equal(
		cold.getAttribute(SCROLLBAR_ATTRIBUTE),
		SCROLLBAR_IDLE,
		"and the hold is the ordinary one, so the bar leaves on time rather than being stamped",
	);

	// A click into a scroller is not `:focus-visible`: the pointer reader gets no
	// cue, which is what keeps the blip from becoming a click-triggered flash.
	const clicked = element({ scroller: true, focusVisible: false });
	const mouse = install(new Set([clicked]));
	mouse.doc.dispatch("focusin", clicked);
	assert.deepEqual(
		clicked.fadeWrites(),
		[],
		"a focus that did not come from the keyboard reveals nothing",
	);

	// Focus landing on a child reveals the scroller the reader is inside.
	const outer = element({ scroller: true });
	const child = element({ parent: outer });
	const nested = install(new Set([outer]));
	nested.doc.dispatch("focusin", child);
	assert.equal(
		outer.getAttribute(SCROLLBAR_ATTRIBUTE),
		SCROLLBAR_ACTIVE,
		"focus inside a scroller reveals that scroller",
	);
});

/*
 * THE SCOPE GUARD, ON BOTH PATHS AND ON BOTH SHAPES (review round 1: M2 / Q3,
 * Min1). The first version tested one inherited property and covered neither the
 * review-state shape the note § 9.8 is about (the editor root stops being
 * editable while the manager stays connected, and the diff bodies injected into
 * it carry `contenteditable="false"`) nor the `scroll` door at all.
 */
test("the scroll path is guarded against an undo-observed subtree too", () => {
	const container = element({ scroller: true });
	const scope = element({ parent: container });
	scope.setAttribute(UNDO_SCOPE_ATTRIBUTE, "true");
	const inside = element({ scroller: true, parent: scope });
	const { doc } = install(new Set([container, inside]));

	for (const type of ["scroll", "pointerover", "focusin"]) {
		doc.dispatch(type, inside);
		assert.deepEqual(
			inside.fadeWrites(),
			[],
			`${type} inside the undo-observed subtree writes nothing`,
		);
	}
	assert.deepEqual(
		container.fadeWrites(),
		[],
		"and the walk stops at the boundary rather than revealing the container above it",
	);

	doc.dispatch("scroll", container);
	assert.equal(
		container.getAttribute(SCROLLBAR_ATTRIBUTE),
		SCROLLBAR_ACTIVE,
		"while the container itself, outside the scope, still fades",
	);
});

test("the review-state diff shape is outside the fade's reach", () => {
	// The shape the reviewer reproduced: the diff container is not editable and
	// says so — `contenteditable="false"` — and the scroller is a `pre` inside it.
	const root = element();
	root.setAttribute("contenteditable", "false");
	const diff = element({ parent: root });
	const pre = element({ scroller: true, parent: diff });
	const { doc } = install(new Set([pre]));

	doc.dispatch("pointerover", pre);
	doc.dispatch("scroll", pre);
	assert.deepEqual(
		pre.fadeWrites(),
		[],
		"an explicit `contenteditable` attribute anywhere above is the boundary, whatever its value",
	);
});

/*
 * THE CACHED-NEGATIVE DEFECT (review round 1: M3 / Q2, reproduced in the real
 * renderer against a `hidden -> auto` flip). `overflow` is state-dependent on
 * live surfaces — the transcript flips between `overflow-hidden` and
 * `overflow-auto`, a detail part flips with `max-h-64 overflow-y-auto` — so a
 * remembered "not a scroller" outlives the state that produced it and the
 * element never reveals again, for the rest of the session.
 */
test("an overflow that flips on later is still revealed", () => {
	const late = element();
	const scrollers = new Set();
	const { doc } = install(scrollers);

	doc.dispatch("pointerover", late);
	assert.deepEqual(
		late.fadeWrites(),
		[],
		"not a scroller yet: nothing to reveal",
	);

	// The flip: the same element, now resolving as a scroller.
	late.scroller = true;
	scrollers.add(late);

	doc.dispatch("pointerover", late);
	assert.equal(
		late.getAttribute(SCROLLBAR_ATTRIBUTE),
		SCROLLBAR_ACTIVE,
		"the negative answer was not kept, so the flip is revealed",
	);
});

/*
 * A `scroll` whose target is the document reaches a document-level capture
 * listener the moment anything lets the viewport itself scroll, and
 * `getComputedStyle` throws on it (review round 1: Min2 / Q4). Latent in this
 * app today — `html, body, #app` are pinned `overflow: hidden` — which is why it
 * is one character of hardening and one test rather than a redesign.
 */
test("a scroll whose target is the document is ignored rather than thrown at", () => {
	const region = element({ scroller: true });
	const { doc, time } = install(new Set([region]));

	assert.doesNotThrow(() => doc.dispatch("scroll", { nodeType: 9 }));
	doc.dispatch("pointerover", { nodeType: 9 });
	doc.dispatch("focusin", null);
	assert.deepEqual(region.fadeWrites(), [], "no element, no write");
	assert.equal(
		time.outstanding(),
		0,
		"and no timer is armed for a target that is not one",
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
	/*
	 * The HOLD is deliberately NOT in the stylesheet: it is a timer in the module,
	 * not a duration a rule can express once the keyboard cue is a state (there is
	 * no animation left to carry it). This pins the split so a future edit cannot
	 * quietly reintroduce a second hold.
	 */
	assert.ok(
		!stylesSource.includes("SCROLLBAR_HOLD_MS"),
		"the hold lives in the module, and the sheet does not name it",
	);
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
			stylesSource.includes("initial-value: ${SCROLLBAR_RESTING_FLOOR};"),
		"the registered property is what makes it interpolatable at all, and it now starts at the resting floor rather than 0",
	);
	/*
	 * THE RESTING FLOOR (issue #845). Idle used to mean INVISIBLE, and the amendment is
	 * that rest is a FAINT state rather than the absence of one - so the two halves that
	 * must both hold are that the number is the module's single exported constant (this
	 * sheet interpolates it rather than restating it), and that it is the measured value
	 * the derivation beside the rule names. The band it was chosen in is 1.5:1 (so the
	 * thumb reads) to 2.5:1 (so it can never read as chrome, and stays under the 3:1
	 * non-text floor on every palette); the derivation and the frames are under
	 * `docs/evidence/sidebar-rest-intent/`.
	 */
	assert.equal(
		SCROLLBAR_RESTING_FLOOR,
		0.45,
		"the resting floor is the measured 0.45; re-derive the band before moving it",
	);
	assert.ok(
		stylesSource.includes("--lo-sb: ${SCROLLBAR_RESTING_FLOOR};"),
		"the base rule resets to the floor, not to 0",
	);
	assert.ok(
		!/initial-value: 0;/.test(stylesSource),
		"and nothing re-registers the property at 0, which would put the thumb back to invisible at rest",
	);
	/*
	 * THE TWO STATES THE AMENDMENT DID NOT TOUCH. `[data-lo-scrollbar="active"]` still
	 * pins the value at 1, and the thumb under the pointer is still solid at once, so the
	 * fade still runs floor -> 1 and the reader who has already found the bar is not made
	 * to wait out a floor.
	 */
	assert.ok(
		/\[\$\{SCROLLBAR_ATTRIBUTE\}="active"\]\s*\{[^}]*-lo-sb:\s*1;/.test(
			stylesSource,
		),
		"the active state still reaches the solid role",
	);
	assert.ok(
		/\*::-webkit-scrollbar-thumb:hover\s*\{\s*background-color:\s*var\(--color-control\);/.test(
			stylesSource,
		),
		"and the thumb under the pointer is still the solid role",
	);
	/*
	 * THE NON-COLLISION RULE (review round 1: U2 / U3). The cue used to be an
	 * `animation` on a focus-visible scroller, and the shorthand took
	 * `animation-name` — and reset `animation-timeline` — away from the
	 * transcript's own scroll-linked top fade, which then popped off and back
	 * around every keyboard scroll. The sheet animates nothing now; a state
	 * driven from the module composes with whatever else the element animates.
	 * The assertion reads the CSS BODY with its comments stripped, so the comment
	 * above that explains this rule cannot satisfy it.
	 */
	const styleBody = stylesSource
		.slice(stylesSource.indexOf("const SCROLLBAR_CSS"))
		.replace(/\/\*[\s\S]*?\*\//g, "");
	assert.ok(
		!styleBody.includes("animation") && !styleBody.includes("@keyframes"),
		"nothing in the scrollbar stylesheet animates an element, so no other animation on a scroller loses its properties",
	);
	assert.ok(
		!styleBody.includes(":focus-visible"),
		"and the cue is not a rule on focus state either — an idle, focused, never-touched scroller had no attribute to match, which is the defect the module's focusin door replaces",
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

/*
 * THE OTHER HALF OF THE SCOPE GUARD, DRIVEN BY THE REPO'S OWN CLASS (review round
 * 1: M2 / Q3 — the reviewer measured history 1 -> 3 with this manager and the
 * write landing in a diff body). The module's own tests above prove it stops
 * writing inside an undo-observed subtree; this one proves the second lock holds
 * if a write ever does land — the manager must not read the fade's attribute as
 * content. It drives the real `UndoManager` (bundled by this suite, no new
 * dependency) over a stub document, which is this repo's idiom for a class whose
 * collaborators are a `MutationObserver` and an `innerHTML`.
 */
const undoBundle = await build({
	stdin: {
		contents:
			'export { UndoManager } from "./src/renderer/src/shared/lib/undo-manager";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { UndoManager } = await import(
	`data:text/javascript;base64,${Buffer.from(undoBundle.outputFiles[0].text).toString("base64")}`
);

test("the undo manager does not count the fade's attribute as content", async () => {
	const observers = [];
	const saved = {
		MutationObserver: globalThis.MutationObserver,
		window: globalThis.window,
		document: globalThis.document,
	};
	/*
	 * The manager reads `options.debounceDelay || 500`, so 0 is NOT a zero debounce
	 * — it is the 500 ms default. One millisecond is the smallest value that is
	 * actually honoured, and the settle has to outlast it.
	 */
	const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
	try {
		globalThis.MutationObserver = class {
			constructor(callback) {
				this.callback = callback;
				observers.push(this);
			}
			observe() {}
			disconnect() {}
		};
		globalThis.window = { getSelection: () => null };
		globalThis.document = { addEventListener() {}, removeEventListener() {} };

		const host = {
			innerHTML: "<p>hello</p>",
			addEventListener() {},
			removeEventListener() {},
			contains: () => true,
		};
		const manager = new UndoManager(host, {
			debounceDelay: 1,
			onStateChange: () => {},
		});
		manager.connect();
		const observer = observers[observers.length - 1];
		assert.equal(
			manager.canUndo(),
			false,
			"a freshly connected manager has one state and nothing to undo",
		);

		observer.callback([
			{ type: "attributes", attributeName: "data-lo-scrollbar" },
		]);
		await settle();
		assert.equal(
			manager.canUndo(),
			false,
			"the fade's own attribute write is not a content change",
		);

		observer.callback([
			{ type: "attributes", attributeName: "data-highlight" },
		]);
		await settle();
		assert.equal(
			manager.canUndo(),
			false,
			"and neither is the highlighter's, the entry that was already ignored",
		);

		host.innerHTML = "<p>hello there</p>";
		observer.callback([{ type: "childList" }]);
		await settle();
		assert.equal(
			manager.canUndo(),
			true,
			"while a real content change still moves the stack — the ignore is specific, not a blanket",
		);
		// Nothing may still be pending when the stubs go back: a debounce timer
		// that fires after this test would read `window` from the next one.
		await settle();
	} finally {
		globalThis.MutationObserver = saved.MutationObserver;
		globalThis.window = saved.window;
		globalThis.document = saved.document;
	}
});

/*
 * THE MARKER IS A CONTRACT BETWEEN TWO FILES, so it is pinned: the editor root
 * carries the attribute the module tests for, spelled the same way. A rename on
 * one side only would leave the editor unwatched — silently, because nothing
 * else in the app can observe the difference.
 */
test("the editor root carries the undo-scope marker the module tests for", () => {
	const editorSource = readFileSync(
		"src/renderer/src/features/chat/components/canvas/wysiwyg-markdown-editor.tsx",
		"utf8",
	);
	assert.ok(
		editorSource.includes(`${UNDO_SCOPE_ATTRIBUTE}="true"`),
		`the undo manager's root carries ${UNDO_SCOPE_ATTRIBUTE}="true", which is what keeps the fade out of the undo stack`,
	);
});

/*
 * THE CENSUS, AS AN ASSERTION (review round 1: Min3, and D4 which reproduced the
 * failure mode). A scroller whose own class list carries `transition-…` (or an
 * `animate-…` utility) declares `transition` on the SAME element the fade
 * transitions, at the same specificity, so which one wins is a stylesheet-order
 * coin flip: measured on a fixture, `transition: background-color 1s` drove
 * `--lo-sb` from 0 to 1 with no intermediate value at all — a pop where the
 * design promises a fade. The claim used to be prose in the note; here it is the
 * check, so it cannot expire at the next commit. Scanned the way the note's
 * census was written down: every non-story source file, each `overflow-auto`
 * utility line with a four-line window around it for multi-line `cn(…)` lists.
 */
test("no shipped scroller carries a transition or animation list of its own", () => {
	const hits = [];
	const walk = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				walk(path);
				continue;
			}
			/*
			 * THE CASCADING SHEETS ARE HALF OF THIS CENSUS, and the half that is easy to
			 * forget: a scroller can be declared in CSS rather than by a class list
			 * (`features/chat/components/markdown.css`'s `.lo-md-table-scroll` is one, and
			 * it lands in this branch with main's markdown-table work), and a
			 * `transition` in the same rule overrides the fade's exactly as a utility
			 * would. Read per rule block rather than per line, because a sheet has no
			 * line-shaped equivalent of a `cn(…)` list.
			 */
			if (entry.name.endsWith(".css")) {
				const sheet = readFileSync(path, "utf8");
				for (const block of sheet.matchAll(/\{([^{}]*)\}/g)) {
					const body = block[1];
					if (!/overflow(?:-x|-y)?:\s*(?:auto|scroll)/.test(body)) continue;
					/*
					 * The same two token families the `.tsx` half flags, so the halves
					 * cannot drift apart while the test's own name promises both (review
					 * round 2, R2-2): a `transition` list and an `animation` /
					 * `@keyframes` on the scroller both take the fade's place.
					 */
					if (
						/transition/.test(body) ||
						/animation/.test(body) ||
						/keyframes/.test(body)
					) {
						hits.push(`${path}: a rule block`);
					}
				}
				continue;
			}
			if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".stories."))
				continue;
			const lines = readFileSync(path, "utf8").split("\n");
			lines.forEach((line, index) => {
				if (!/overflow-(?:x-|y-)?(?:auto|scroll)/.test(line)) return;
				const window = lines
					.slice(Math.max(0, index - 4), index + 5)
					.join("\n");
				if (/transition(?:-|:)/.test(window) || /\banimate-/.test(window)) {
					hits.push(`${path}:${index + 1}`);
				}
			});
		}
	};
	walk("src/renderer/src");
	assert.deepEqual(
		hits,
		[],
		"a scroller that declares its own transition list collapses the fade to a pop: name --lo-sb in that list, or move the transition off the element",
	);
});
