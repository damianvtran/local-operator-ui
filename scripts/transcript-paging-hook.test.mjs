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
			'export { useScrollPaging } from "./src/renderer/src/features/chat/canonical/use-scroll-paging";\nexport { SETTLE_MS } from "./src/renderer/src/features/chat/canonical/scroll-paging";',
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
const { useScrollPaging, SETTLE_MS } = await import(
	new URL(`file://${bundlePath}`).href
);
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
	const onLoadOlder = options.onLoadOlder ?? (async () => false);
	let handle = null;
	let olderFailed = options.olderFailed ?? false;
	let sessionKey = options.sessionKey ?? "synthetic-session";
	function Harness() {
		handle = useScrollPaging({
			containerRef: { current: scroller },
			sessionKey,
			hiddenRows,
			hasMore: options.hasMore ?? true,
			onWiden: () => {
				widenCalls++;
			},
			onLoadOlder,
			// Only passed when a case supplies it, so the cases written before the
			// outcome-aware pump exercise the boolean path unchanged.
			...(options.onLoadOlderOutcome
				? { onLoadOlderOutcome: options.onLoadOlderOutcome }
				: {}),
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
		setScrollTop: (value) => {
			scrollTop = value;
		},
		setScrollHeight: (value) => {
			scrollHeight = value;
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
		setHiddenRows: (value) => {
			hiddenRows = value;
			render();
		},
		flushFrames: (count = 1) => {
			for (let i = 0; i < count; i++) flushFrame();
		},
		requestReveal,
		readerInput,
		growAboveAnchor,
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
