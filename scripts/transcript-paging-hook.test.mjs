import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const ROOT = resolve(import.meta.dirname, "..");
const CACHE = join(ROOT, "node_modules", ".cache", "transcript-paging-hook");
const bundle = await build({
	stdin: {
		contents:
			'export { useScrollPaging, ANCHOR_HOLD_MS } from "./src/renderer/src/features/chat/canonical/use-scroll-paging";\nexport { MAX_ACT_ASKS, SETTLE_MS } from "./src/renderer/src/features/chat/canonical/scroll-paging";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	external: ["react"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "use-scroll-paging.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { useScrollPaging, ANCHOR_HOLD_MS, SETTLE_MS, MAX_ACT_ASKS } =
	await import(new URL(`file://${bundlePath}`).href);
const { createRoot } = await import("react-dom/client");

after(() => {
	Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

/**
 * Mount the production hook against just enough DOM to exercise its real event
 * listeners and layout effect. Geometry is controlled because jsdom has no
 * layout engine; the revision, hold, input dispatch and scrollTop write are not
 * mocked. This catches a missing hook-to-helper connection without pretending
 * to be a rendered browser capture.
 */
function mountHook(options = {}) {
	const dom = new JSDOM(
		'<!doctype html><div id="root"></div><div id="transcript"><div data-lo-transcript-content><div data-record-id="held-row"></div></div></div>',
		{ url: "http://localhost/", pretendToBeVisual: true },
	);
	const { window } = dom;
	const originals = new Map();
	const pendingFrames = new Map();
	let nextFrame = 1;
	const frame = (callback) => {
		const id = nextFrame++;
		pendingFrames.set(id, callback);
		return id;
	};
	const cancelFrame = (id) => pendingFrames.delete(id);
	const scroller = window.document.querySelector("#transcript");
	const row = scroller.querySelector("[data-record-id]");
	let scrollTop = -50;
	let scrollHeight = 1000;
	let anchorTop = 120;
	Object.defineProperties(scroller, {
		clientHeight: { configurable: true, value: 800 },
		scrollHeight: {
			configurable: true,
			get: () => scrollHeight,
		},
		scrollTop: {
			configurable: true,
			get: () => scrollTop,
			set: (value) => {
				scrollTop = value;
			},
		},
	});
	scroller.getBoundingClientRect = () => ({ top: 100, bottom: 900 });
	row.getBoundingClientRect = () => ({
		top: anchorTop,
		bottom: anchorTop + 30,
	});
	window.CSS = { escape: (value) => String(value).replaceAll('"', '\\"') };
	window.Element.prototype.scrollIntoView = () => {};
	window.ResizeObserver = class {
		observe() {}
		disconnect() {}
	};
	const globals = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Element: window.Element,
		Node: window.Node,
		Event: window.Event,
		KeyboardEvent: window.KeyboardEvent,
		WheelEvent: window.WheelEvent,
		CSS: window.CSS,
		ResizeObserver: window.ResizeObserver,
		requestAnimationFrame: frame,
		cancelAnimationFrame: cancelFrame,
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [name, value] of Object.entries(globals)) {
		originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value,
		});
	}
	Object.defineProperty(window, "requestAnimationFrame", {
		configurable: true,
		value: frame,
	});
	Object.defineProperty(window, "cancelAnimationFrame", {
		configurable: true,
		value: cancelFrame,
	});

	const root = createRoot(window.document.querySelector("#root"));
	let rowCount = 1;
	let widenCalls = 0;
	// Parameterised so a case can mount the reader in the state it is about
	// (rows held back, a landing to drive) without a second harness beside
	// this one.
	let hiddenRows = options.hiddenRows ?? 1;
	/*
	 * The reader's PAINT COUNT. A case opts in with `measuresPaint: true` and moves
	 * the value with `setPaintedRows` — the hook takes an accessor, so the harness
	 * IS that accessor, and a case that does not opt in leaves the option out
	 * exactly as a caller with no collapse model would.
	 */
	let painted = 0;
	const countedPainted = options.measuresPaint ? () => painted : undefined;
	const onLoadOlder = options.onLoadOlder ?? (async () => false);
	/*
	 * Asks the PUMP dispatched, whichever loader form the case supplied. Counted
	 * here rather than by the case's own callback so the invisible-reveal cases
	 * can assert on the chain without knowing which form they exercised.
	 */
	let asked = 0;
	const countedLoadOlder = async () => {
		asked += 1;
		return onLoadOlder();
	};
	const countedOutcome = options.onLoadOlderOutcome
		? () => {
				asked += 1;
				return options.onLoadOlderOutcome();
			}
		: undefined;
	let handle = null;
	let olderFailed = options.olderFailed ?? false;
	/*
	 * The read-out fact (remote-load-hydration, UX round 1 U1). Defaults false
	 * for the cases written before it existed — their arms are about paging, not
	 * about the retry's acknowledgement; the case that is about it passes it.
	 */
	let historyReadPending = options.historyReadPending ?? false;
	let sessionKey = options.sessionKey ?? "synthetic-session";
	function Harness() {
		handle = useScrollPaging({
			containerRef: { current: scroller },
			sessionKey,
			hiddenRows,
			hasMore: options.hasMore ?? true,
			/*
			 * The end claim's proof. Defaults true here for the cases written
			 * before the fact existed (their arms are about paging, not about
			 * the end statement); the two cases that are about it pass it.
			 */
			hydrationProven: options.hydrationProven ?? true,
			historyReadPending,
			onWiden: () => {
				widenCalls++;
			},
			onLoadOlder: countedLoadOlder,
			// Only passed when a case supplies it, so the cases written before the
			// outcome-aware pump exercise the boolean path unchanged.
			...(countedOutcome ? { onLoadOlderOutcome: countedOutcome } : {}),
			...(countedPainted ? { paintedRows: countedPainted } : {}),
			olderFailed,
			loadingOlder: false,
			rowCount,
			contentKey: "fixture",
		});
		return null;
	}
	const render = () => act(() => root.render(React.createElement(Harness)));
	const flushFrame = () => {
		const callbacks = [...pendingFrames.values()];
		pendingFrames.clear();
		act(() => {
			for (const callback of callbacks) callback(0);
		});
	};
	const flushInitial = () => {
		for (let i = 0; i < 4 && pendingFrames.size; i++) flushFrame();
	};
	const requestReveal = () => {
		act(() =>
			scroller.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: "Home",
					bubbles: true,
				}),
			),
		);
		flushFrame();
	};
	const readerInput = () =>
		act(() =>
			scroller.dispatchEvent(
				new window.WheelEvent("wheel", {
					deltaY: -80,
					bubbles: true,
				}),
			),
		);
	const growAboveAnchor = () => {
		scrollHeight += 400;
		anchorTop += 24;
		rowCount++;
		render();
	};
	/*
	 * A NON-INPUT viewport motion (round 1, R1-1): the held row dragged `px` down
	 * the viewport by something that is not a reader gesture - a browser re-clamp,
	 * a re-anchor - carrying the `scroll` event such a motion emits and no input.
	 * It arms the settle re-read, and it is never attributed to the reader (no
	 * `pointerdown` opened the drag window).
	 */
	const viewportMotion = (px) => {
		anchorTop += px;
		act(() => scroller.dispatchEvent(new window.Event("scroll")));
	};
	/** A pointer press ON the scroller: what opens the hook's drag window. */
	const pointerDown = () =>
		act(() =>
			scroller.dispatchEvent(
				new window.Event("pointerdown", { bubbles: true }),
			),
		);
	/** The `scroll` event such a write emits. */
	const scrollEvent = () =>
		act(() => scroller.dispatchEvent(new window.Event("scroll")));
	/*
	 * The COMPONENT's own write to the offset, done the way
	 * `canonical-transcript.tsx`'s press-anchor effect does it: the scroller is
	 * moved, and the handle is told the offsets around the assignment. With
	 * `acknowledge: false` it is the shape the code had before the fix, which is
	 * how the control arm reproduces the mis-attribution MINOR-3 inferred.
	 */
	const ownWrite = (delta, { acknowledge = true } = {}) => {
		const before = scrollTop;
		scroller.scrollTop = before + delta;
		if (acknowledge) handle.acknowledgeOwnWrite(before, scrollTop);
	};
	const close = () => {
		for (const id of pendingFrames.keys()) cancelFrame(id);
		act(() => root.unmount());
		dom.window.close();
		for (const [name, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	};

	render();
	flushInitial();
	return {
		close,
		get scrollTop() {
			return scrollTop;
		},
		get widenCalls() {
			return widenCalls;
		},
		/** Asks the pump dispatched, whichever loader form the case supplied. */
		get asked() {
			return asked;
		},
		/** The completion walk's authorisation, as the transcript reads it (1b). */
		mayAutoWalk: () => handle.mayAutoWalk(),
		setScrollTop: (value) => {
			scrollTop = value;
		},
		setScrollHeight: (value) => {
			scrollHeight = value;
		},
		/**
		 * Move the anchored row — CONTENT ARRIVING ABOVE THE READER, which is the
		 * only thing the reveal's growth is measured from now (agent review round
		 * 1, R1-3: the scroller's whole `scrollHeight` also grows when a live turn
		 * streams BELOW a tail-following reader, and that was being credited to the
		 * reveal). `setScrollHeight` alone is therefore "the extent changed, the
		 * reader's own row did not move" — the invisible case.
		 */
		setRowTop: (value) => {
			anchorTop = value;
		},
		get slotState() {
			return handle?.slotState;
		},
		requestOlder: () => act(() => handle.requestOlder()),
		setSessionKey: (value) => {
			sessionKey = value;
			render();
		},
		setOlderFailed: (value) => {
			olderFailed = value;
			render();
		},
		setHistoryReadPending: (value) => {
			historyReadPending = value;
			render();
		},
		setHiddenRows: (value) => {
			hiddenRows = value;
			render();
		},
		/**
		 * The rows the reader can see, for the condensed cases: held still across a
		 * reveal whose extent grew, which is what the operator's tape looks like and
		 * the only shape the pre-fix policy could not score invisible.
		 */
		setPaintedRows: (value) => {
			painted = value;
		},
		flushFrames: (count = 1) => {
			for (let i = 0; i < count; i++) flushFrame();
		},
		requestReveal,
		readerInput,
		growAboveAnchor,
		viewportMotion,
		pointerDown,
		scrollEvent,
		ownWrite,
	};
}

test("the mounted paging hook holds layout growth but yields to later reader input", () => {
	const layoutOnly = mountHook();
	try {
		layoutOnly.requestReveal();
		assert.equal(
			layoutOnly.widenCalls,
			1,
			"the real Home listener armed a reveal",
		);
		layoutOnly.growAboveAnchor();
		assert.equal(
			layoutOnly.scrollTop,
			-26,
			"layout-only growth is corrected by the production useLayoutEffect",
		);
	} finally {
		layoutOnly.close();
	}

	const laterInput = mountHook();
	try {
		laterInput.requestReveal();
		assert.equal(
			laterInput.widenCalls,
			1,
			"the real Home listener armed a reveal",
		);
		laterInput.readerInput();
		laterInput.growAboveAnchor();
		assert.equal(
			laterInput.scrollTop,
			-50,
			"real wheel input invalidates the hook's held sample before the row-count commit",
		);
	} finally {
		laterInput.close();
	}
});

/*
 * Round-1 review F1, at the layer it was reproduced against the pump: a
 * rule-6 widen owed because a landing happened inside the input debounce has
 * nobody to re-decide it when the landing itself returned `none` — the pump's
 * only delayed re-run for a `none` state was gated on an armed demand. The
 * pure suite can hold the debt (the policy returns it either way); only the
 * mounted hook shows whether the pump ever asks again on its own.
 *
 * TIMING NOTE, stated because the case is about a window: the landing must
 * happen within `SETTLE_MS` of the input for the debt to be unpaid at the
 * landing's own decide, which is the state the pump has to schedule for. No
 * real work happens between the two here (a wheel event, two frame flushes and
 * one prop commit), so the margin is the whole debounce; on a machine loaded
 * enough to lose 120 ms inside that, the case degenerates to the
 * already-settled path the pure suite covers and stops discriminating.
 */
test("a rule-6 debt landed inside the debounce is re-decided at the settle", async () => {
	let loads = 0;
	const hook = mountHook({
		hiddenRows: 0,
		onLoadOlder: async () => {
			loads += 1;
			return true;
		},
	});
	try {
		// Hard top: distance = scrollHeight - clientHeight - |scrollTop| = 2.
		hook.setScrollTop(-198);
		hook.readerInput();
		hook.flushFrames(4);
		assert.equal(loads, 1, "the hard-top push buys its round trip");
		// Let the fetch's promise resolve, then land the page the way the app
		// does: rows arrive, the extent grows under the reader, and the window
		// is still holding 60 of them back. The reader is now OFF the hard top
		// (distance 100) but inside the zone, which is the whole reason the
		// debt has to wait for a settle: `settled` is only free at the wall.
		await new Promise((resolve) => setTimeout(resolve, 0));
		hook.setScrollTop(-500);
		hook.setScrollHeight(1400);
		hook.setHiddenRows(60);
		hook.flushFrames(6);
		assert.equal(
			hook.widenCalls,
			0,
			"inside the debounce the debt waits rather than mounting under the reader",
		);
		// The pump must re-decide at the settle the debt is waiting for: no
		// further input, no further content change.
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 80));
		hook.flushFrames(6);
		assert.equal(
			hook.widenCalls,
			1,
			"the owed widen is paid at the settle it was waiting for",
		);
	} finally {
		hook.close();
	}
});

/*
 * THE STANDING READER-HOLD (fold rounds, 2026-09-27). The reveal-armed hold
 * above was bounded to the reveal's settling window, so the case the operator's
 * report names - a layout change with NO reveal behind it, like a fold's body
 * collapsing - found no sample and dragged every settled row in one frame
 * (measured on the rig: `rows moved 228` at a turn end, and a 217px viewport
 * jump away from the tail). The invariant now: while the reader is away from
 * the tail, the place their last gesture left the scroll at is held across
 * layout changes, refreshed once the gesture settles, and dropped again when
 * they return to the tail.
 */
test("after the reader's gesture settles, a later layout change is corrected again", async () => {
	// `hasMore: false` and no hidden rows: no page can be dispatched, so no
	// fetch-armed `holdAnchor` exists and any correction here is the STANDING
	// sample's - the thing this test is about.
	const hook = mountHook({ hiddenRows: 0, hasMore: false });
	try {
		hook.setScrollTop(-200);
		hook.readerInput();
		// The gesture settles: the rearm fires on its own timer (the same
		// SETTLE_MS the policy debounces input with), and nothing about the
		// settle itself may move the reader.
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 80));
		hook.flushFrames(2);
		assert.equal(hook.scrollTop, -200, "the settle itself writes nothing");
		// A collapse-shaped change: the extent shrinks and the held row is
		// dragged down 24px. The correction must land it back where the reader
		// left it.
		hook.growAboveAnchor();
		assert.equal(
			hook.scrollTop,
			-176,
			"the standing sample absorbs the change after a settle",
		);
	} finally {
		hook.close();
	}
});

test("a layout change at the tail is not fought - the tail follows", async () => {
	const hook = mountHook({ hiddenRows: 0, hasMore: false });
	try {
		// Establish the standing sample away from the tail...
		hook.setScrollTop(-200);
		hook.readerInput();
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 80));
		hook.flushFrames(2);
		// ...then the reader returns to the newest end and content changes. The
		// tail gate must both refuse the correction and drop the sample: at the
		// tail the newest content is pinned, and holding anything there would
		// fight the following the transcript wants.
		hook.setScrollTop(0);
		hook.growAboveAnchor();
		assert.equal(hook.scrollTop, 0, "no correction is written at the tail");
	} finally {
		hook.close();
	}
});

/*
 * Round 1, R1-1: the reveal hold's expiry hand-over.
 *
 * The reveal-armed hold is FINITE, and past its window the reader's place has
 * to convert to a STANDING sample - that hand-over is what lets a motion the
 * hold missed (anything non-input: a browser re-clamp, a re-anchor) become the
 * new place rather than being reverted by the next correction. The guard in
 * `refreshReaderHold` read only `Number.isFinite(until)`, so an EXPIRED hold
 * kept returning: the expiry arm's hand-over was a no-op and the settle re-read
 * was blocked, and the next correction added the motion's own size back. This
 * case pins the adopted reading: `-26` (the grow's 24 absorbed against the
 * post-motion place) where the blocked reading ends `-2` (pre-motion sample, so
 * the correction undoes the motion too).
 */
test("an expired reveal hold hands over at the settle, and the later grow adopts the post-motion place", async () => {
	const hook = mountHook();
	try {
		hook.requestReveal();
		assert.equal(
			hook.widenCalls,
			1,
			"the real Home listener armed a reveal, so the finite hold exists",
		);
		// Past the hold's window: `ANCHOR_HOLD_MS` is over and the finite sample
		// is still in `anchor.current` (only input, the tail gate or a switch
		// clears it early).
		await new Promise((resolve) => setTimeout(resolve, ANCHOR_HOLD_MS + 100));
		// A non-input viewport motion with a `scroll` event: the held row is
		// dragged 24px down the viewport and the settle re-read is armed.
		hook.viewportMotion(24);
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 80));
		// A later layout change. The correction must absorb ITS 24px against the
		// post-motion place - `-50 + 24` lands at `-26` - rather than against the
		// pre-motion sample the expired hold kept, which would undo the motion
		// too and land at `-2`.
		hook.growAboveAnchor();
		assert.equal(
			hook.scrollTop,
			-26,
			"the standing hand-over adopts the post-motion place, so the grow corrects only its own 24px",
		);
	} finally {
		hook.close();
	}
});
/*
 * THE FAILED ROW HAS ONE OWNER: THE SESSION HOOK (loader-continuity R2).
 *
 * Before this the pump kept its own `failed` state and set it from `!ok` on ANY
 * non-applied result. `false` was also "someone else is loading" and "the session
 * changed in flight", so a healthy conversation could paint the red "Could not
 * load earlier messages" row; and a failure from the align fetch, the jump walk
 * or the mentioned-files scan never reached the row at all. These cases pin the
 * new contract at the mounted hook: the row follows `olderFailed`, and only a REAL
 * `failed` outcome from the pump counts toward the automatic budget.
 */
test("a stale or nothing-to-load outcome neither fails the row nor spends the budget", async () => {
	for (const kind of ["stale", "nothing-to-load"]) {
		let loads = 0;
		const hook = mountHook({
			hiddenRows: 0,
			onLoadOlderOutcome: async () => {
				loads += 1;
				return { kind };
			},
		});
		try {
			// Three deliberate asks: with the old `false` mapping this is exactly
			// `MAX_AUTO_ATTEMPTS` failures and the red row.
			for (let i = 0; i < 3; i++) {
				hook.requestOlder();
				hook.flushFrames(3);
				await new Promise((resolve) => setTimeout(resolve, 0));
				hook.flushFrames(3);
			}
			assert.ok(loads >= 3, `the pump asked ${loads} times`);
			assert.notEqual(
				hook.slotState,
				"failed",
				`${kind} painted the failed row`,
			);
		} finally {
			hook.close();
		}
	}
});

test("the failed row follows olderFailed, and clears the moment it does", () => {
	const hook = mountHook({ hiddenRows: 0, olderFailed: true });
	try {
		hook.flushFrames(2);
		assert.equal(
			hook.slotState,
			"failed",
			"olderFailed with nothing hidden is the failed row",
		);
		hook.setOlderFailed(false);
		hook.flushFrames(2);
		assert.notEqual(
			hook.slotState,
			"failed",
			"a later applied page clears the row without needing new input",
		);
	} finally {
		hook.close();
	}
});

/*
 * THE END CLAIM IS GATED ON PROOF (remote-load-hydration). `hasMore: false` is
 * the cursor's opinion about the conversation, and it is only true ABOUT the
 * conversation when the read that produced it could see it: a stored remote
 * session's cold open is served an empty page by a facade with no owner, and
 * the session hook refuses to count that read as proof (see
 * `sessionRowsLiveRemotely` and the proof rule in `walkTail`). These two cases
 * pin the consequence at the slot's own state machine: without proof the
 * exhausted copy must NOT render - the retry-able "not loaded" arm takes its
 * place - and with proof the end still states itself.
 */
test("an unproven end is not the end: hasMore false without hydration proof", () => {
	const hook = mountHook({
		hiddenRows: 0,
		hasMore: false,
		hydrationProven: false,
	});
	try {
		hook.flushFrames(2);
		assert.equal(
			hook.slotState,
			"unproven",
			`hasMore false with no proof claimed exhaustion: ${hook.slotState}`,
		);
	} finally {
		hook.close();
	}
});

/*
 * AND THE PRESS ON THAT ARM IS ACKNOWLEDGED (remote-load-hydration, UX round 1
 * U1 == reviewer F4). The retry fires the same read the cold open fires, and
 * with no paint for the read's duration the row repainted byte-identical -
 * same words, same enabled control - so the one moment this change exists to
 * serve looked like a dead button. While the read is out the unproven arm
 * paints the sibling `loading` row; when it settles still unproven the arm
 * states the fact again (a proven read moves it to the end copy instead, which
 * is the case above). The session hook's own half - the walk raising and
 * clearing `historyReadPending`, and refusing to stack a second walk - is
 * pinned in `session-load-recovery.test.mjs`.
 */
test("the unproven end paints the read while it is out, then states itself again", () => {
	const hook = mountHook({
		hiddenRows: 0,
		hasMore: false,
		hydrationProven: false,
		historyReadPending: true,
	});
	try {
		hook.flushFrames(2);
		assert.equal(
			hook.slotState,
			"loading",
			`a read out for an unproven end must paint the pending row, painted: ${hook.slotState}`,
		);
		hook.setHistoryReadPending(false);
		hook.flushFrames(2);
		assert.equal(
			hook.slotState,
			"unproven",
			`a settled-unproven read must state the fact again, painted: ${hook.slotState}`,
		);
	} finally {
		hook.close();
	}
});

test("a proven end still states itself once a page has been read", () => {
	const hook = mountHook({
		hiddenRows: 0,
		hasMore: false,
		hydrationProven: true,
	});
	try {
		hook.flushFrames(2);
		assert.equal(
			hook.slotState,
			"exhausted",
			"a genuinely hydrated end must keep the start-of-conversation arm",
		);
	} finally {
		hook.close();
	}
});

/*
 * Loader-continuity round 1, R1-4. The session-change effect replaces the policy
 * state and arms one `continuation` - the only demand `decide` honours with no
 * gesture behind it, which is what opens a short conversation whose history has
 * more behind it and whose pane cannot scroll to make one. An outcome that then
 * resolves for the PREVIOUS conversation used to be folded into that new state:
 * a late `stale` ran `noteAborted`, which clears `continuation`, and the new
 * conversation's only way to start loading was gone.
 *
 * The order is what makes it observable: the switch is committed but its frames
 * have not run when the old page settles, so the continuation is still unspent.
 */
/*
 * Loader-continuity round 2, R2-1 - the same hazard as R1-4, one step smaller.
 * The ask's own outcome carries an epoch guard (above); the two rAF
 * continuations a landing schedules did NOT, so a landing observed across a
 * session change wrote the NEW conversation's policy state. Two frames wide
 * rather than a round trip, and benign in direction - it cannot clear
 * `continuation`, which is `true` for a freshly reset state - but it can clear
 * the new conversation's failure budget and set `pageWidenOwed` on rows that are
 * not its own, which is a widen nobody asked for.
 *
 * WHERE THE DEBT IS OBSERVABLE. `decide` refuses a bare continuation when the
 * scroller can scroll (`geo.scrollable && !(pageWidenOwed && widen)`) and spends
 * one when `pageWidenOwed` is set. So on a SCROLLABLE pane holding rows back, the
 * new conversation's own state spends nothing and the state a stale landing wrote
 * spends exactly one widen - the difference `widenCalls` reads.
 */
test("a landing observed across a session change cannot hand the new conversation a rule-6 widen", async () => {
	let settleAsk;
	const hook = mountHook({
		hiddenRows: 0,
		onLoadOlderOutcome: () =>
			new Promise((resolve) => {
				settleAsk = resolve;
			}),
	});
	try {
		// Scrollable (1400 > 800) and at the hard top: distance = 1400 - 800 - 600 = 0,
		// so the reader's own push buys the page without waiting out the debounce.
		hook.setScrollHeight(1400);
		hook.setScrollTop(-600);
		hook.readerInput();
		hook.flushFrames(4);
		assert.ok(settleAsk, "the hard-top push bought its page");

		// The page lands `applied`, which schedules the landing continuation; it has
		// not run yet when the reader changes conversation.
		settleAsk({ kind: "applied", newRecords: 12, exhausted: false });
		await new Promise((resolve) => setTimeout(resolve, 0));
		hook.setSessionKey("session-b");
		// Rows the NEW conversation is holding back. The stale continuation reads this
		// and settles the FRESH state with `hiddenRowsAfter > 0` - rule 6's debt.
		hook.setHiddenRows(6);
		hook.flushFrames(8);
		assert.equal(
			hook.widenCalls,
			0,
			"the previous conversation's landing owes the new one nothing",
		);
	} finally {
		hook.close();
	}
});

test("a stale outcome from the conversation the reader left cannot cancel the new one's continuation", async () => {
	const asks = [];
	let settleFirst;
	const hook = mountHook({
		hiddenRows: 0,
		onLoadOlderOutcome: () =>
			new Promise((resolve) => {
				asks.push(resolve);
				if (asks.length === 1) settleFirst = resolve;
			}),
	});
	try {
		// A pane that cannot scroll (700 < 800), at its hard top, with history behind
		// it: clause L's shape. The reader's push buys the first ask.
		hook.setScrollHeight(700);
		hook.setScrollTop(0);
		hook.readerInput();
		hook.flushFrames(4);
		assert.equal(asks.length, 1, "the first conversation has a page out");

		// The reader changes conversation; its frames have not run yet.
		hook.setSessionKey("session-b");
		settleFirst({ kind: "stale" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		hook.flushFrames(6);
		assert.equal(
			asks.length,
			2,
			"the new conversation still auto-continues: the old page's outcome is not its",
		);
	} finally {
		hook.close();
	}
});

/*
 * The DOM half's half of the visible reveal (loader-continuity 1b): `growthPx`.
 *
 * The policy cannot know whether a landing changed anything on screen - the
 * extent lives in the scroller - so the hook measures `scrollHeight` at the
 * dispatch and again at the settle and hands the policy the difference. These
 * two cases are the wiring: an extent that did NOT move inside a transcript
 * with more behind it leaves the act unanswered (the pump asks again by
 * itself), and an extent that moved ends the chain (one ask per act).
 *
 * The extent is the real DOM property here, read through the hook's own
 * `measure()`, so a hook that passed a constant would fail the second case
 * while the first still passed.
 */
const askable = (extra = {}) =>
	mountHook({
		hiddenRows: 0,
		hasMore: true,
		onLoadOlderOutcome: async () => ({
			kind: "applied",
			newRecords: 12,
			exhausted: false,
		}),
		...extra,
	});

test("an invisible landing is followed by another ask without input", async () => {
	// Hard top of a scrollable pane: 1400 - 800 - 600 = 0.
	const hook = askable();
	try {
		hook.setScrollHeight(1400);
		hook.setScrollTop(-600);
		hook.readerInput();
		hook.flushFrames(4);
		assert.ok(hook.asked >= 1, "the hard-top push buys its page");
		/*
		 * The page lands and the extent does NOT move: the reader saw nothing, so
		 * the pump asks again on its own. Driven to a standstill rather than one
		 * round, because the assertion is about the CHAIN and the chain is what
		 * has to stop: an unbounded one would leave the frames below queued when
		 * the harness tears its globals down.
		 */
		let last = -1;
		for (let round = 0; round < 30 && hook.asked !== last; round += 1) {
			last = hook.asked;
			await new Promise((resolve) => setTimeout(resolve, 0));
			hook.flushFrames(12);
		}
		assert.ok(
			hook.asked > 1,
			`an invisible reveal must chain (asked ${hook.asked})`,
		);
		/*
		 * THE RENDERER PATH AT ITS BOUND (QA round 1, Q-4 asked for exactly this:
		 * the policy's own test cannot see the hook's door accounting). `MAX_ACT_ASKS`
		 * is the sum one act may buy across every door; a hook that spent one ask
		 * past it would fail here.
		 */
		assert.equal(
			hook.asked,
			MAX_ACT_ASKS,
			`the chain spends the act's whole budget and stops (asked ${hook.asked})`,
		);
	} finally {
		hook.close();
	}
});

/*
 * CONTRACT PIN, NOT A REGRESSION (operator rule: a test that cannot fail is not
 * evidence - the round-3 reviewer caught exactly this shape). This case passes on
 * the pristine tree too, because a reveal that DID grow the extent was already
 * answering the act before 1b. It is here so the refund added above cannot become
 * unconditional: the discriminating half is the invisible case, which fails
 * before the change ("an invisible reveal must chain (asked 1)"). Relabelled
 * rather than deleted because a fix that refunds on EVERY settle would pass the
 * invisible case and silently break rule 2 for a visible one.
 */
/*
 * AGENT REVIEW ROUND 1, R1-3 — DISCRIMINATING, not a contract pin: before this
 * round the reveal's growth was the scroller's WHOLE `scrollHeight` delta, so a
 * live turn streaming BELOW a tail-following reader read as a visible reveal,
 * ended the chain and left the act's round trip spent. The measurement is now the
 * held row's own displacement (`sampleAnchor`/`measureHeld`), and this is that
 * exact state: the extent grows, the reader's row does not move.
 */
test("growth BELOW the reader's own row does not answer the act (R1-3)", async () => {
	const hook = askable();
	try {
		hook.setScrollHeight(1400);
		hook.setScrollTop(-600);
		hook.readerInput();
		hook.flushFrames(4);
		assert.equal(hook.asked, 1, "one act, one round trip");
		// A turn streams in BELOW the reader: the extent grows and the held row
		// stays exactly where it was.
		hook.setScrollHeight(2400);
		let last = -1;
		for (let round = 0; round < 30 && hook.asked !== last; round += 1) {
			last = hook.asked;
			await new Promise((resolve) => setTimeout(resolve, 0));
			hook.flushFrames(12);
		}
		assert.ok(
			hook.asked > 1,
			`the reader saw nothing of it, so the act is not answered (asked ${hook.asked})`,
		);
	} finally {
		hook.close();
	}
});

test("a visible landing answers the act: the chain stops there (contract pin)", async () => {
	const hook = askable();
	try {
		hook.setScrollHeight(1400);
		hook.setScrollTop(-600);
		hook.readerInput();
		hook.flushFrames(4);
		assert.equal(hook.asked, 1, "one act, one round trip");
		// The page lands and DOES move the content above the reader: the held row
		// is pushed down by the rows that arrived over it, which is what "the reader
		// saw it" means (and the extent grows with it). The next reveal therefore
		// needs a gesture of their own (rule 2 for a scrollable pane).
		hook.setScrollHeight(2400);
		hook.setRowTop(120 + 400);
		await new Promise((resolve) => setTimeout(resolve, 0));
		hook.flushFrames(12);
		assert.equal(
			hook.asked,
			1,
			"a visible reveal answers the act; nothing more is spent",
		);
	} finally {
		hook.close();
	}
});

/*
 * The completion walk's authorisation (loader-continuity 1b, spec section 7
 * clause b), asked of the hook rather than of a copy of its arithmetic: the walk
 * may ask only while the reader FOLLOWS THE TAIL and has given no input for
 * `SETTLE_MS`. Both terms are the module's own - `followingTail` comes from the
 * one geometry `decide` reads, and the quiet window from the policy's own input
 * clock - so this is the accessor the transcript calls rather than a second
 * derivation beside it.
 */
test("the walk is authorised only at the tail, and only after the input has settled", async () => {
	const hook = mountHook({ hiddenRows: 0 });
	try {
		// scroller: scrollHeight 1400, clientHeight 800. -600 from the tail is the
		// hard top (distance 0) and NOT the tail; -20 is inside TAIL_EPS_PX (24).
		hook.setScrollHeight(1400);
		hook.setScrollTop(-600);
		assert.equal(
			hook.mayAutoWalk(),
			false,
			"a reader up in the history is not walked on their behalf",
		);
		hook.setScrollTop(-20);
		assert.equal(
			hook.mayAutoWalk(),
			true,
			"at the tail, and quiet: the walk may ask",
		);
		hook.readerInput();
		assert.equal(
			hook.mayAutoWalk(),
			false,
			"input arms a demand; the walk waits out the settle window",
		);
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 40));
		assert.equal(
			hook.mayAutoWalk(),
			true,
			"once the input has settled the position is the whole question again",
		);
	} finally {
		hook.close();
	}
});

/*
 * A bar press's own correction must not be read as reader input (agent review
 * round 2, MINOR-3; the review could only infer it from the source).
 *
 * THE PRESS OPENS THE DRAG WINDOW. `onPointerDown` on this scroller sets
 * `dragUntil = Infinity`, so the `scroll` event a programmatic write fires takes
 * the READER branch of `onScroll` unless the write is acknowledged: it calls
 * `input(moved > 0 ? "up" : "down", ...)`, which records layout motion as the
 * reader dragging older-ward and drops the standing hold with it.
 *
 * The harness stands in for the browser's own `scroll` event after a programmatic
 * write - jsdom emits none, so a leftover acknowledgement from an earlier
 * correction would otherwise absorb the event under test and the arms below
 * would agree (`drain`).
 */
test("an acknowledged own-write is not attributed to the reader (MINOR-3)", () => {
	const hook = mountHook();
	try {
		hook.requestReveal();
		hook.growAboveAnchor();
		hook.scrollEvent(); // drain the correction's own acknowledgement
		assert.equal(hook.scrollTop, -26, "the reader's hold is standing");
		hook.pointerDown(); // the bar press
		hook.ownWrite(-30); // the press-anchor write, acknowledged
		hook.scrollEvent(); // the event that write fires
		hook.growAboveAnchor();
		assert.equal(
			hook.scrollTop,
			-8,
			"the write is our own motion: the hold survives it and the growth is corrected",
		);
	} finally {
		hook.close();
	}

	/*
	 * THE CONTROL: the same flow with the write NOT acknowledged. Without the
	 * handle the event falls to the reader path, `input("up", true)` runs, the
	 * hold is dropped, and the same growth is left uncorrected - the defect this
	 * test exists to keep out.
	 */
	const control = mountHook();
	try {
		control.requestReveal();
		control.growAboveAnchor();
		control.scrollEvent();
		control.pointerDown();
		control.ownWrite(-30, { acknowledge: false });
		control.scrollEvent();
		control.growAboveAnchor();
		assert.equal(
			control.scrollTop,
			-56,
			"unacknowledged, the write is read as reader input and the hold is dropped",
		);
	} finally {
		control.close();
	}
});

test("a write that changes nothing claims nothing, so the reader's next motion is attributed (MINOR-3)", () => {
	const hook = mountHook();
	try {
		hook.requestReveal();
		hook.growAboveAnchor();
		hook.scrollEvent();
		assert.equal(hook.scrollTop, -26, "the hold is standing");
		hook.pointerDown();
		/*
		 * A clamp at the scroller's range (or a write landing on the number already
		 * there) produces no offset change, and therefore no `scroll` event to
		 * consume an acknowledgement. An unguarded `+= 1` would sit pending and
		 * swallow the reader's NEXT scroll - the same mis-attribution mirrored.
		 */
		hook.ownWrite(0);
		hook.setScrollTop(-56); // the reader's own motion, arriving right after
		hook.scrollEvent();
		hook.growAboveAnchor();
		assert.equal(
			hook.scrollTop,
			-56,
			"the reader's motion was attributed to them: no acknowledgement was left pending",
		);
	} finally {
		hook.close();
	}
});

test("R3-1: two acknowledged writes coalescing into one frame leave no claim behind", () => {
	const hook = mountHook();
	try {
		hook.requestReveal();
		hook.growAboveAnchor();
		hook.scrollEvent(); // drain the correction's own acknowledgement
		assert.equal(hook.scrollTop, -26, "the reader's hold is standing");
		hook.pointerDown(); // the bar press: the drag window is open
		/*
		 * TWO writes in one frame, which is the real shape: the hook's own
		 * `correctAnchor` and the transcript's press-anchor write share a layout
		 * phase, and the browser emits ONE `scroll` event for the pair. A counter
		 * acknowledgement spends one claim here and keeps the other, so the
		 * reader's next scroll is swallowed; an offset cannot.
		 */
		hook.ownWrite(-30);
		hook.ownWrite(10);
		hook.scrollEvent(); // the single event the pair emits
		hook.setScrollTop(-80); // the reader's own motion, right after
		hook.scrollEvent();
		hook.growAboveAnchor();
		assert.equal(
			hook.scrollTop,
			-80,
			"the reader's scroll was attributed to them, so no hold corrected it away",
		);
	} finally {
		hook.close();
	}
});

/* ------------------------------------------------------------------------ *
 * THE READER'S PAINT COUNT, AND THE TWO STATES IT CLOSES (design §5)            *
 *                                                                               *
 * The operator's report: "the full set of condensed messages don't load and     *
 * then I have to scroll which loads more but then I can't scroll past that",    *
 * plus a slot that said "Loading earlier messages" for ever, and a failure row  *
 * offered only to a reader who had already scrolled past everything. The hook   *
 * now settles a reveal in the rows it PAINTED — the count `widenTarget`         *
 * searches with, sampled through both doors — so the condensed tape (rows held  *
 * back, a widen that mounts sixty, a collapse that paints none of them) is      *
 * judged by what reached the screen rather than by an extent that grew off it.  *
 * ------------------------------------------------------------------------ */

test("a condensed widen that paints nothing chains on, with no further input", async () => {
	const hook = mountHook({
		hiddenRows: 600,
		hasMore: true,
		// The reader's screen, constant across every reveal: what a condensed
		// transcript looks like from the outside.
		measuresPaint: true,
		onLoadOlder: async () => true,
	});
	try {
		hook.setScrollHeight(1400);
		hook.setScrollTop(-600);
		// Forty rows on screen and forty after every reveal: the condensed tape.
		hook.setPaintedRows(40);
		hook.readerInput();
		hook.flushFrames(4);
		assert.equal(hook.widenCalls, 1, "the hard-top push buys its widen");

		let last = -1;
		for (let round = 0; round < 3 && hook.widenCalls !== last; round += 1) {
			last = hook.widenCalls;
			hook.flushFrames(12);
		}
		assert.ok(
			hook.widenCalls > 1,
			`the chain carries on with no gesture (widenCalls ${hook.widenCalls})`,
		);

		/*
		 * And when the window has nothing left to hold back, the network is reached
		 * on the same terms — still with no gesture. The chain is deliberately cut
		 * short of its own bound here (`MAX_CHAIN_REVEALS`), because an act that has
		 * spent its whole budget legitimately stops and waits for the reader: the
		 * point is that the DOOR changes, not that an act is unbounded.
		 */
		hook.setHiddenRows(0);
		let lastAsked = -1;
		for (let round = 0; round < 24 && hook.asked !== lastAsked; round += 1) {
			lastAsked = hook.asked;
			await new Promise((resolve) => setTimeout(resolve, 0));
			hook.flushFrames(12);
		}
		assert.ok(
			hook.asked >= 1,
			`the window emptied, so the network is asked with no further gesture (asked ${hook.asked})`,
		);
	} finally {
		hook.close();
	}
});

test('a REJECTING loader neither strands the slot at "loading" nor kills the pump', async () => {
	let loads = 0;
	const hook = mountHook({
		hiddenRows: 0,
		hasMore: true,
		onLoadOlderOutcome: async () => {
			loads += 1;
			throw new Error("backend down");
		},
	});
	try {
		hook.setScrollHeight(1400);
		hook.setScrollTop(-600);
		hook.readerInput();
		hook.flushFrames(4);
		assert.equal(loads, 1, "the hard-top push buys its round trip");
		await new Promise((resolve) => setTimeout(resolve, 0));
		hook.flushFrames(6);
		assert.notEqual(
			hook.slotState,
			"loading",
			"a rejected loader must not pin the loading paint for ever",
		);
		/*
		 * And the pump is alive: the reader's own retry — the deliberate act the
		 * slot's failure row offers — still buys its load. The failure is counted,
		 * not fatal, and `noteFailed` refunds the act's round trip for it.
		 */
		hook.requestOlder();
		hook.flushFrames(6);
		assert.equal(
			loads,
			2,
			"and the reader's next push still buys a load (the failure is counted, not fatal)",
		);
		/*
		 * Drain the second outcome before the teardown removes the frame globals:
		 * the rejected ask's own `requestAnimationFrame(schedule)` runs in a
		 * microtask, and letting it land after `close()` is an unhandled rejection
		 * from the harness rather than anything the hook got wrong.
		 */
		await new Promise((resolve) => setTimeout(resolve, 0));
		hook.flushFrames(4);
	} finally {
		hook.close();
	}
});

test("a failed older-history load paints the failure row even while rows are windowed", () => {
	const hook = mountHook({ hiddenRows: 600, hasMore: true, olderFailed: true });
	try {
		assert.equal(
			hook.slotState,
			"failed",
			"a dead backend must not tell the reader to keep scrolling (D4/D9)",
		);
	} finally {
		hook.close();
	}
});

/*
 * M3 (agent review round 1): the failure row must not be sticky for the session.
 *
 * `olderFailed` is set by any failed ask and cleared only by an applied one, so
 * the D4/D9 precedence above left "Could not load earlier messages - Try again"
 * up for the rest of the session after a single blip - even while later LOCAL
 * widens were revealing rows the reader could already see, where the row stopped
 * telling them that scrolling still works. A reveal the reader COULD SEE now
 * supersedes it, and the next failure - from the pump or from any of the
 * session's other writers - puts it back, so the row states what is true now.
 */
test("a reveal the reader could see supersedes a standing failure row", async () => {
	const hook = mountHook({
		hiddenRows: 600,
		hasMore: true,
		olderFailed: true,
		// The reader's own paint count, which is how the policy decides the
		// reveal was visible.
		measuresPaint: true,
		onLoadOlderOutcome: async () => ({ kind: "failed", reason: "request" }),
	});
	try {
		assert.equal(
			hook.slotState,
			"failed",
			"the failure row stands while its asks are the whole story",
		);
		hook.setScrollHeight(1400);
		hook.setScrollTop(-600);
		hook.setPaintedRows(40);
		hook.readerInput();
		hook.flushFrames(4);
		assert.equal(hook.widenCalls, 1, "the hard-top push buys its widen");
		/*
		 * The widen lands and PAINTS rows (40 -> 80, above `INVISIBLE_PAINT_MIN_ROWS`)
		 * while rows are still held back: rows the reader could not see are on screen,
		 * which is exactly the state the sticky row mis-described.
		 */
		hook.setPaintedRows(80);
		hook.setHiddenRows(540);
		hook.flushFrames(12);
		assert.equal(
			hook.slotState,
			"windowed",
			"a visible local reveal supersedes the past blip (M3)",
		);
		/*
		 * The local rows run out, the reader asks again ("Try again" - a deliberate
		 * act, which is what arms a demand after the swallow a hard-top notch gets),
		 * and that ask fails: the failure is the present fact again, so the row
		 * returns rather than being forgiven.
		 */
		hook.setHiddenRows(0);
		hook.flushFrames(2);
		hook.requestOlder();
		hook.flushFrames(4);
		await new Promise((resolve) => setTimeout(resolve, 0));
		hook.flushFrames(6);
		assert.ok(hook.asked >= 1, "the emptied window is asked for a page");
		assert.equal(
			hook.slotState,
			"failed",
			"the failure that is current now is the row again",
		);
	} finally {
		hook.close();
	}
});

test("a fresh failure from any writer re-asserts the row after a superseding reveal", async () => {
	const hook = mountHook({
		hiddenRows: 600,
		hasMore: true,
		olderFailed: true,
		measuresPaint: true,
	});
	try {
		hook.setScrollHeight(1400);
		hook.setScrollTop(-600);
		hook.setPaintedRows(40);
		hook.readerInput();
		hook.flushFrames(4);
		hook.setPaintedRows(80);
		hook.setHiddenRows(540);
		hook.flushFrames(12);
		assert.equal(hook.slotState, "windowed", "the reveal superseded the row");
		/*
		 * The align fetch, the jump walk and the mentioned-files scan all write
		 * `olderFailed` through the session, and this hook never sees those asks: the
		 * RISING edge is what re-asserts the row for them.
		 */
		hook.setOlderFailed(false);
		hook.flushFrames(2);
		hook.setOlderFailed(true);
		hook.flushFrames(2);
		assert.equal(
			hook.slotState,
			"failed",
			"a new failure is the present fact again, whatever a previous reveal did",
		);
	} finally {
		hook.close();
	}
});

test("a deliberate retry holds the reader's place on the landing's own frame", async () => {
	const hook = mountHook({
		hiddenRows: 0,
		hasMore: true,
		onLoadOlder: async () => true,
	});
	try {
		hook.setScrollHeight(1400);
		hook.setScrollTop(-600);
		hook.readerInput();
		hook.flushFrames(4);
		await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 80));
		hook.flushFrames(2);

		const before = hook.scrollTop;
		hook.requestOlder();
		/*
		 * The retry's page lands on the same frame the ask was dispatched on —
		 * before the pump's first frame, which is the window a deliberate ask is
		 * the only input that can be held across.
		 */
		hook.growAboveAnchor();
		assert.equal(
			hook.scrollTop,
			before + 24,
			"the deliberate retry's landing is corrected on the frame it lands",
		);
	} finally {
		hook.close();
	}
});
