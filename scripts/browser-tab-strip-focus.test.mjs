import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";

/** The caret a landed close leaves: the survivor's tab button (hoisted per
 * `useTopLevelRegex`, and shared by the assertions that name it). */
const LANDED_CLOSE_CARET = /^BUTTON role=tab in-tab=\d+$/;

/** The watch row names the tab it belongs to. */
const WATCH_ROW = /Watch "Tab 2"/;

/*
 * WHERE THE CARET GOES AFTER A CLOSE, INCLUDING A CLOSE THAT NEVER LANDS
 * (review round 2, A-2).
 *
 * WHY THIS IS A TEST AND NOT ONLY A PROBE. Round 1 found the same defect three
 * times over (review A2, UX U1, QA Q4) and its fix was proven by a probe that
 * lived outside the repository; round 2 then found the fix's own missing failure
 * exit by writing that probe again. A guard that exists only in a scratch
 * directory is a comment, so the whole contract is pinned here, against the
 * SHIPPED component and its own effects.
 *
 * WHAT IS AND IS NOT EVIDENCE HERE. jsdom has no layout engine, no native view
 * and no IPC: what this file asserts is the DOM focus contract — where the caret
 * is after a press, after a failure, and after the projection the press was
 * waiting for arrives or never does. The app-level half (the projection landing
 * after a real invoke, and the caret's position at 300ms/1.3s/2.8s) belongs to
 * `renderer-driver.mjs --scene browser-pane` and `browser-chrome-proof.mjs`,
 * which boot the built app.
 */

// React DOM feature-detects input events at import time, so the document has to
// exist before it is loaded. A real origin, not jsdom's opaque default.
const dom = new JSDOM(
	'<!doctype html><html><body><input id="outside"><div id="root"></div></body></html>',
	{ pretendToBeVisual: true, url: "http://localhost/" },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
	clear: () => {},
	key: () => null,
	length: 0,
};
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Accessors jsdom defines on the window take no new value; the DOM globals
		// this file needs are the ones already copied above.
	}
}
// jsdom implements neither of these, and both are used by the strip's own
// children: `scrollIntoView` on the reveal path and the observers in its effects.
dom.window.Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
/*
 * RADIX'S DISMISSABLE LAYER DISPATCHES ITS OWN EVENT ON THE DOCUMENT when a menu
 * layer mounts (`new CustomEvent(...)` + `document.dispatchEvent`), and this file
 * opens one: the row's actions are a Radix popout since 2026-09-28. Node defines
 * `Event`/`CustomEvent` as globals of its OWN, and the copy loop above keeps any
 * global that already exists, so without these two rebindings Radix builds a Node
 * event that jsdom's `dispatchEvent` refuses - "parameter 1 is not of type
 * 'Event'" - thrown from inside the layer's mount effect. `provider-chip-verdict.test.mjs`
 * rebinds the same pair for the same Radix layers; this is that shape, not a new one.
 */
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
/*
 * `:modal` IS A JSDOM LANDMINE UNDER FLOATING-UI (measured 2026-09-28). The popout's
 * popper walks its ancestors with floating-ui's `getContainingBlock`, which probes
 * each one with `element.matches(':modal')` (`isTopLayer`, floating-ui.utils.dom).
 * jsdom 26.1.0 answers `:modal` by delegating back into its own selector engine -
 * `nwsapi isModal -> matchesNative(node, ':modal') -> node.matches(':modal')` - and
 * that call re-enters the engine instead of resolving, so the file spins inside the
 * matcher for minutes with nothing thrown through to the caller. The hang is
 * floating-ui's ancestor probe against jsdom's `:modal`, not the component: a
 * browser WITHOUT `:modal` support answers a SyntaxError, which is exactly what
 * `isTopLayer`'s own try/catch is written for, so the probe is made to answer the
 * way it does in such a browser - the selector layer rejects it, nothing else does.
 */
const nativeMatches = dom.window.Element.prototype.matches;
dom.window.Element.prototype.matches = function matches(selector) {
	if (String(selector).includes(":modal")) {
		throw new dom.window.DOMException(
			":modal is not supported here",
			"SyntaxError",
		);
	}
	return nativeMatches.call(this, selector);
};
// React 18 reads this to decide whether `act` is real; without it every effect
// flush warns instead of being batched with the render it belongs to.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

/*
 * The entry module is generated rather than committed as a fixture because the
 * subject is a COMPONENT, not a page: it takes the strip's own props and drives
 * the same controls the app's do (the row's menu, then `Close N other tabs`).
 */
const ENTRY = `
import { createElement, useState } from "react";
// The bundle keeps packages external, so this resolves to the same react-dom the
// test itself imported — after the document existed.
import { createRoot } from "react-dom/client";
import { BrowserTabStrip } from "./src/renderer/src/features/browser/components/browser-tab-strip";
// THE SHIPPED POLICY MODULE, from this bundle's own module graph: the registration
// the strip makes is readable here and nowhere else, because a second import in the
// test process would be a second instance with a second store.
import { suppressedOverlayIds } from "./src/renderer/src/shared/browser-view-policy";

const view = (tabId, sessionId) => ({
	tabId,
	title: "Tab " + tabId,
	url: "https://example.test/" + tabId,
	owner: "user",
	sessionId,
	active: false,
	restored: false,
	handedOver: false,
	failed: false,
	loading: false,
});

/**
 * One mount, and the three shapes of a close's outcome:
 *  - "refused": the invoke is refused, so NOTHING is dropped (the reported case);
 *  - "stale":   the intent is accepted and one named id is still there after it,
 *               which is what an id main did not take looks like from here;
 *  - "landed":  the intent is accepted and every named id goes.
 */
export function mount(container, mode) {
	const INITIAL = [view(1, "conv-a"), view(2, "conv-a"), view(3, null)];
	let api = null;
	const Harness = () => {
		const [tabs, setTabs] = useState(INITIAL);
		const [activeTabId, setActiveTabId] = useState(1);
		const drop = (ids) =>
			setTabs((current) => {
				const next = current.filter((tab) => !ids.includes(tab.tabId));
				setActiveTabId(next.length ? next[next.length - 1].tabId : null);
				return next;
			});
		api = {
			/** The intent the press produced, so a check can say what it named. */
			intent: () => window.__intent,
			/** The suppressions the SHIPPED policy holds right now. */
			suppressed: () => suppressedOverlayIds(),
			/** An unrelated arrival: an agent opening a tab. */
			addTab: () =>
				setTabs((current) => [...current, view(9, null)]),
			/** A tab leaving the list the close never took. */
			dropOutside: (tabId) => drop([tabId]),
			rows: () =>
				Array.from(document.querySelectorAll("[data-tab-id]")).map((row) =>
					row.getAttribute("data-tab-id"),
				),
		};
		const close = (intent) => {
			window.__intent = JSON.stringify(intent);
			const ids =
				intent.mode === "ids"
					? [...intent.tabIds]
					: tabs
							.filter((tab) => tab.sessionId === intent.sessionId)
							.map((tab) => tab.tabId);
			api.ids = ids;
			if (mode === "refused") return Promise.resolve(false);
			if (mode === "stale") {
				// The first id goes, the anchor is left: main resolved the intent against
				// a registry that had forgotten one of the names.
				setTimeout(() => drop(ids.slice(0, 1)), 20);
				return Promise.resolve(true);
			}
			setTimeout(() => drop(ids), 20);
			return Promise.resolve(true);
		};
		return createElement(BrowserTabStrip, {
			tabs,
			sessions: [],
			activeTabId,
			waiting: {},
			onActivate: () => {},
			onClose: () => Promise.resolve(false),
			onNewTab: () => {},
			onCloseTabs: close,
			onHandOver: () => {},
			onRevokeHandOver: () => {},
		});
	};
	createRoot(container).render(createElement(Harness));
	return { api: () => api };
}
`;

const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "strip-focus.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	loader: { ".css": "empty" },
	write: false,
});
const bundlePath = new URL(
	`./_strip-focus-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { mount } = await import(bundlePath.href);
await unlink(bundlePath);

/** Mount one scenario and hand back the controls a test drives it with. */
async function open(mode) {
	// A fresh container per test: `createRoot` on a used one is how a previous
	// test's tree leaks into the next.
	const container = document.getElementById("root");
	container.innerHTML = "";
	const root = createRoot(container);
	let handle = null;
	await act(() => {
		handle = mount(container, mode);
	});
	const controls = handle.api();
	/*
	 * THE PRESS A REAL POINTER MAKES, delivered as the event the control opens on.
	 *
	 * The row's actions are a Radix popout now (2026-09-28): its trigger opens on
	 * `pointerdown` - the event a real press sends - and a bare `.click()` is not
	 * one, so the driver sends the pointerdown a press sends. Everything after it
	 * is unchanged: the menu ITEM still selects on its own click, and the caret
	 * contract these tests are about is asserted exactly as it was.
	 */
	const press = async () => {
		// The band opens from the row's own menu, exactly as a press does in the app.
		const trigger = document.querySelector(
			'[data-tab-id="2"] [data-tour-tag="browser-tab-menu"]',
		);
		await act(() => {
			trigger.dispatchEvent(
				new dom.window.MouseEvent("pointerdown", {
					bubbles: true,
					cancelable: true,
					button: 0,
				}),
			);
		});
		const item = document.querySelector(
			'[data-tour-tag="browser-tab-close-others"]',
		);
		await act(() => item.click());
		/*
		 * RADIX RETURNS FOCUS TO THE TRIGGER WHEN THE MENU CLOSES, AND IT DOES SO OFF A
		 * MACROTASK: FocusScope's unmount cleanup runs its autofocus on a `setTimeout(0)`
		 * (focus-scope/dist, the `AUTOFOCUS_ON_UNMOUNT` dispatch), so the caret lands
		 * back on the trigger one task after the item's click - before any person could
		 * have moved it themselves. The driver flushes that task here so the tests below
		 * observe the state a human's next action starts from, not a focus that was still
		 * in flight when the assertion ran.
		 */
		await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
	};
	return {
		controls,
		press,
		/**
		 * Open one row's menu with the pointerdown a press sends, and STOP there: no item
		 * is pressed, so a scenario can assert the OPEN state (which item it offers, what
		 * it registers) before anything closes it.
		 */
		openMenu: async (tabId = 2) => {
			const trigger = document.querySelector(
				`[data-tab-id="${tabId}"] [data-tour-tag="browser-tab-menu"]`,
			);
			await act(() => {
				trigger.dispatchEvent(
					new dom.window.MouseEvent("pointerdown", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
			});
			return trigger;
		},
		/** The suppression ids the shipped policy holds - the registration's own store. */
		suppressed: () => controls.suppressed(),
		/** The caret, described the way a finding describes it. */
		caret: () => {
			const el = document.activeElement;
			if (!el) return "none";
			const row = el.closest?.("[data-tab-id]");
			return [
				el.tagName,
				el.getAttribute("role") ? `role=${el.getAttribute("role")}` : null,
				row ? `in-tab=${row.getAttribute("data-tab-id")}` : null,
				el.id ? `id=${el.id}` : null,
			]
				.filter(Boolean)
				.join(" ");
		},
		/** Let the harness's own emission land (it is a timer, not an IPC round trip). */
		settle: () =>
			act(async () => new Promise((resolve) => setTimeout(resolve, 80))),
		unmount: async () => {
			await act(() => root.unmount());
			container.innerHTML = "";
		},
	};
}

test("a press parks the caret in the strip, so removing the row cannot drop it to <body>", async () => {
	const view = await open("refused");
	await view.press();
	assert.equal(
		document.activeElement.closest(
			'[data-tour-tag="browser-tab-strip-row"]',
		) !== null,
		true,
		`the caret after the press: ${view.caret()}`,
	);
	await view.unmount();
});

test("a REFUSED close leaves the caret where the user put it (review round 2, A-2)", async () => {
	const view = await open("refused");
	await view.press();
	// The user moves on.
	document.getElementById("outside").focus();
	assert.equal(view.caret(), "INPUT id=outside");
	// An unrelated arrival is what took the caret back before the fix: the record
	// was still armed and its guard focused the scroller on every `tabs` change.
	await act(() => view.controls.addTab());
	assert.equal(
		view.caret(),
		"INPUT id=outside",
		"an unrelated tab stole the caret",
	);
	// And the same for a later change of the SAME content, which is the shape the
	// `refresh()` after a failed invoke produces.
	await view.settle();
	assert.equal(view.caret(), "INPUT id=outside");
	// A refused close can never remove the ids, so nothing here may take the caret.
	await act(() => view.controls.dropOutside(1));
	assert.equal(
		view.caret(),
		"INPUT id=outside",
		"a tab leaving the list on its own took the caret back into the strip",
	);
	await view.unmount();
});

test("a named id the close did not take does not leave the caret armed forever (review round 2, A-2)", async () => {
	const view = await open("stale");
	await view.press();
	await view.settle();
	// The projection carrying the part of the close that DID land has arrived, and
	// the record's own outcome says the close is over: the surviving id is not
	// something to wait for, so the wait is over too.
	document.getElementById("outside").focus();
	await act(() => view.controls.addTab());
	assert.equal(
		view.caret(),
		"INPUT id=outside",
		"an unrelated tab stole the caret",
	);
	// The stale id finally goes, by something that is not this close.
	await act(() => view.controls.dropOutside(2));
	assert.equal(
		view.caret(),
		"INPUT id=outside",
		"the stale id leaving took the caret back into the strip",
	);
	await view.unmount();
});

test("a close that DOES land still moves the caret onto the surviving tab", async () => {
	const view = await open("landed");
	await view.press();
	await view.settle();
	/*
	 * THE CARET IS POLLED, NOT SAMPLED ONCE (QA round 2, Q2-1). The close's focus
	 * effect and the projection re-render race at this granularity: 2 of 20 full-file
	 * runs under fleet load caught the caret one tick before the effect ran, while the
	 * assertion's own bytes were unchanged. The wait is bounded - the same shape the
	 * harness's `caretInStripSoon` uses - and an expired poll still fails with the
	 * caret it saw, so the leg discriminates the defect (which never lands in the
	 * strip at all) exactly as before.
	 */
	let caret = view.caret();
	const deadline = Date.now() + 2000;
	while (!LANDED_CLOSE_CARET.test(caret) && Date.now() < deadline) {
		await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
		caret = view.caret();
	}
	assert.match(
		caret,
		LANDED_CLOSE_CARET,
		`the caret after the close landed: ${caret} (rows ${view.controls.rows().join(",")})`,
	);
	await view.unmount();
});

test("the menu's tab leaving the list on its own takes the menu AND the suppression with it (review round 1, M-1)", async () => {
	const view = await open("landed");
	await view.openMenu(2);
	assert.ok(
		document.querySelector('[data-tour-tag="browser-tab-actions"]'),
		"the menu is up before the removal",
	);
	assert.equal(
		view.suppressed().some((id) => id.startsWith("browser-tab-actions")),
		true,
		`the strip's registration is held while the menu is open: ${JSON.stringify(view.suppressed())}`,
	);

	/*
	 * THE REMOVAL THE MENU NEVER HEARD OF: an agent tool closing the tab in main, or any
	 * close this strip did not initiate. No pointer event reaches the menu; the row (and
	 * its portalled content) simply leaves the list, which is the shape the reviewer's
	 * probe measured. Before the guard, `actionsTabId` kept naming the gone tab: the
	 * suppression stayed up with no menu to dismiss, and the caret dropped to `<body>`.
	 */
	await act(() => view.controls.dropOutside(2));
	// Radix's unmount autofocus runs off a `setTimeout(0)`; flush it so the assertion
	// reads the settled state rather than a focus still in flight.
	await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

	assert.equal(
		document.querySelector('[data-tour-tag="browser-tab-actions"]'),
		null,
		"the menu is gone with its row",
	);
	assert.deepEqual(
		view.suppressed(),
		[],
		`the registration released with it: ${JSON.stringify(view.suppressed())}`,
	);
	assert.equal(
		document.activeElement.closest(
			'[data-tour-tag="browser-tab-strip-row"]',
		) !== null,
		true,
		`the caret parked in the strip rather than on <body>: ${view.caret()}`,
	);
	await view.unmount();
});

test("the popout opens from an INACTIVE tab and offers `Watch` for it, leaving the active tab alone (UX round 1, U4)", async () => {
	const view = await open("landed");
	// The harness mounts with tab 1 active, so tab 2 is exactly the state `Watch this
	// tab` exists for - and the row the proof harness's own section 7 prefers when the
	// strip has one (its committed run did not).
	await view.openMenu(2);
	const menu = document.querySelector('[data-tour-tag="browser-tab-actions"]');
	assert.ok(menu, "the menu opened from the inactive row's trigger");
	const watch = menu.querySelector('[data-tour-tag="browser-tab-watch"]');
	assert.ok(
		watch,
		"and offers the watch row for a tab that is not the one on screen",
	);
	assert.match(
		watch.textContent ?? "",
		WATCH_ROW,
		`the watch row names its own tab: ${watch.textContent}`,
	);
	assert.equal(
		document
			.querySelector('[data-tab-id="1"] [role="tab"]')
			?.getAttribute("aria-selected"),
		"true",
		"and opening a tab's menu is not activating it",
	);
	await view.unmount();
});

test("an outside press dismisses the popout and returns focus to its ⋯ trigger (UX round 1, U4)", async () => {
	const view = await open("landed");
	await view.openMenu(2);
	assert.ok(
		document.querySelector('[data-tour-tag="browser-tab-actions"]'),
		"the menu is up",
	);

	/*
	 * THE OUTSIDE PRESS. Radix dismisses on a `pointerdown` outside its layer; in the
	 * browser the modal layer sets `pointer-events: none` on the body so the click a
	 * person makes lands on the layer and dismisses without reaching the control
	 * underneath, and a jsdom dispatch to the element directly exercises the same
	 * dismissal path (`onPointerDownOutside` -> `onDismiss` -> `onOpenChange(false)`).
	 */
	await act(() => {
		document.getElementById("outside")?.dispatchEvent(
			new dom.window.MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);
	});
	// The close-return focus lands one macrotask later (FocusScope's `setTimeout(0)`).
	await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

	assert.equal(
		document.querySelector('[data-tour-tag="browser-tab-actions"]'),
		null,
		"the menu is gone",
	);
	assert.equal(
		document.activeElement,
		document.querySelector(
			'[data-tab-id="2"] [data-tour-tag="browser-tab-menu"]',
		),
		`the caret returned to the trigger that opened it: ${view.caret()}`,
	);
	await view.unmount();
});
