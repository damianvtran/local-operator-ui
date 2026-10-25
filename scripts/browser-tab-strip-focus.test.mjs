import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";

/** The caret a landed close leaves: the survivor's tab button (hoisted per
 * `useTopLevelRegex`, and shared by the assertions that name it). */
const LANDED_CLOSE_CARET = /^BUTTON role=tab in-tab=\d+$/;

/** The watch row names the tab it belongs to. The title is bidi-isolated
 * (design round 2, D7): FSI/PDI are invisible in the rendered row but are real
 * characters in `textContent`, so the words are read without them. */
const WATCH_ROW = /Watch "Tab 2"/;
const withoutIsolates = (text) => text.replace(/[\u2066-\u2069]/g, "");

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
	'<!doctype html><html><body><input id="outside"><div id="turn-progress">streaming</div><button id="turn-stop">Stop</button><div id="root"></div></body></html>',
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
 * RADIX'S DISMISSABLE LAYER DISPATCHES ITS OWN EVENT ON THE DOCUMENT when a layer
 * mounts (`new CustomEvent(...)` + `document.dispatchEvent`). The row's actions
 * are a NATIVE menu since 2026-10-25, so this file no longer opens that layer;
 * the strip it mounts still renders Radix `Tooltip` children, which take the same
 * path when one opens. Node defines
 * `Event`/`CustomEvent` as globals of its OWN, and the copy loop above keeps any
 * global that already exists, so without these two rebindings Radix builds a Node
 * event that jsdom's `dispatchEvent` refuses - "parameter 1 is not of type
 * 'Event'" - thrown from inside the layer's mount effect. `provider-chip-verdict.test.mjs`
 * rebinds the same pair for the same Radix layers; this is that shape, not a new one.
 */
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
/*
 * `:modal` IS A JSDOM LANDMINE UNDER FLOATING-UI (measured 2026-09-28). A Radix
 * popper's ancestor walk uses floating-ui's `getContainingBlock`, which probes
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
 *
 * THE MENU IS A NATIVE POPUP NOW (LOH-13 operator report, 2026-10-25), so there
 * is no panel in this DOM for a test to open. What the component hands to main
 * is the REQUEST - a plain object - and what main hands back is one item id. The
 * stub below is that second half: it records the request and leaves the answer
 * to the test, which is the only way jsdom can model an OS menu. What is NOT
 * modelled here (the popup's pixels, the page staying visible behind it) belongs
 * to `scripts/browser-chrome-proof.mjs`, which boots the built app.
 */
const ENTRY = `
import { createElement, useState } from "react";
// The bundle keeps packages external, so this resolves to the same react-dom the
// test itself imported — after the document existed.
import { createRoot } from "react-dom/client";
import { BrowserTabStrip } from "./src/renderer/src/features/browser/components/browser-tab-strip";
// THE SHIPPED POLICY MODULE, from this bundle's own module graph: the suppression
// store is readable here and nowhere else, because a second import in the test
// process would be a second instance with a second store.
import { suppressedOverlayIds } from "./src/renderer/src/shared/browser-view-policy";
// THE SHIPPED WIRE VALIDATOR: the request this component builds must be one main
// would accept, not merely one this test recognises.
export { tabActionsMenuRequestOrThrow } from "./src/shared/browser-tab-actions-menu";

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
	const menu = { request: null, settle: null };
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
			/** The ONE request the strip handed main, or null. */
			menuRequest: () => menu.request,
			/** Main's answer: the selected item id, or null for a dismissal. */
			resolveMenu: (id) => menu.settle?.(id),
			/** The last tab this strip asked its host to activate. */
			activated: () => window.__activated,
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
			onActivate: (tabId) => {
				window.__activated = tabId;
			},
			onClose: () => Promise.resolve(false),
			onNewTab: () => {},
			onCloseTabs: close,
			onHandOver: () => {},
			onRevokeHandOver: () => {},
			onShowTabActionsMenu: (request) => {
				menu.request = request;
				return new Promise((resolve) => {
					menu.settle = resolve;
				});
			},
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
/*
 * WRITTEN AND REMOVED ON EVERY EXIT, INCLUDING A KILL (agent review round 1,
 * MINOR-3, measured on the ask-answer worktree 2026-10-01). The bundle has to be
 * a real file beside this test - esbuild's ESM output resolves `@shared` and
 * `@features` through the alias table above, and a `data:` URL has no directory
 * to resolve them from - so the unlink has to be a `finally` rather than the next
 * statement. Without it, a run that is killed on the suite's own bound leaves
 * `_strip-focus-<pid>.mjs` behind: 131 KB of esbuild output, untracked and not
 * gitignored, which turns `biome check scripts/` red for whoever stages it next.
 */
let mount;
let tabActionsMenuRequestOrThrow;
try {
	await writeFile(bundlePath, bundle.outputFiles[0].text);
	({ mount, tabActionsMenuRequestOrThrow } = await import(bundlePath.href));
} finally {
	// The import's own failure is the one that matters, so a failed unlink must not
	// replace it - and there is nothing to remove if the write never happened.
	await unlink(bundlePath).catch(() => {});
}

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
	/** Press one row's menu trigger and wait for the request to reach main. */
	const openMenu = async (tabId = 2) => {
		const trigger = document.querySelector(
			`[data-tab-id="${tabId}"] [data-tour-tag="browser-tab-menu"]`,
		);
		await act(() => trigger.click());
		return trigger;
	};
	/** Main's answer, delivered the way the IPC promise delivers it. */
	const choose = async (itemId) => {
		await act(async () => {
			controls.resolveMenu(itemId);
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	};
	/**
	 * The press the caret tests make: open the row's menu and pick `Close 2 other
	 * tabs`, which is the batch close the old panel test drove.
	 */
	const press = async () => {
		await openMenu(2);
		await choose("close-others");
	};
	return {
		controls,
		press,
		openMenu,
		choose,
		/** The suppression ids the shipped policy holds - the store's own reading. */
		suppressed: () => controls.suppressed(),
		/** The ONE request main would receive for the last opened menu. */
		request: () => controls.menuRequest(),
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
		menuTrigger: (tabId = 2) =>
			document.querySelector(
				`[data-tab-id="${tabId}"] [data-tour-tag="browser-tab-menu"]`,
			),
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

test("opening the tab menu registers NO suppression and hands main one valid request", async () => {
	const view = await open("landed");
	const trigger = await view.openMenu(2);
	const request = view.request();
	assert.ok(request, "the strip handed main a request");
	// The request is one the SHIPPED boundary would accept.
	const validated = tabActionsMenuRequestOrThrow(request);
	assert.equal(validated.tabId, 2);
	assert.equal(validated.anchor.x, 0); // jsdom has no layout: the rect is empty
	// This harness wires the closes and hand-over but not `onReorder`/
	// `onTabAction`, so the move and per-tab-action items are correctly absent;
	// the full list is pinned in `browser-tab-actions-menu.test.mjs`.
	assert.deepEqual(
		validated.items.map((entry) => entry.id),
		[
			"header",
			"watch",
			"hand-over",
			"separator",
			"close",
			"close-others",
			"close-right",
			"close-conversation",
			"separator",
			"copy-url",
		],
	);
	const watch = validated.items.find((entry) => entry.id === "watch");
	assert.equal(withoutIsolates(watch.label), 'Watch "Tab 2"');
	assert.equal(
		validated.items.find((entry) => entry.id === "header").enabled,
		false,
	);
	assert.equal(
		validated.items.find((entry) => entry.id === "close-others").label,
		"Close 2 other tabs",
	);
	// NOTHING IS SUPPRESSED, and nothing was mounted in the DOM for the menu to
	// intersect: the native popup draws above the page.
	assert.deepEqual(view.suppressed(), []);
	assert.equal(
		document.querySelector('[data-tour-tag="browser-tab-actions"]'),
		null,
		"no renderer panel exists",
	);
	// The trigger reports its own popup state while main holds the menu.
	assert.equal(trigger.getAttribute("aria-haspopup"), "menu");
	assert.equal(trigger.getAttribute("aria-expanded"), "true");
	await view.choose(null);
	assert.equal(trigger.getAttribute("aria-expanded"), null);
	assert.deepEqual(view.suppressed(), []);
	await view.unmount();
});

test("the menu opens from an INACTIVE tab, names it, and Watch is what activates it (UX round 1, U4)", async () => {
	const view = await open("landed");
	await view.openMenu(2);
	const request = view.request();
	assert.ok(
		request.items.some((entry) => entry.id === "watch"),
		"an inactive tab offers Watch",
	);
	assert.equal(
		window.__activated,
		undefined,
		"opening a menu does not activate",
	);
	await view.choose("watch");
	assert.equal(window.__activated, 2, "the Watch item is the activation");
	assert.equal(
		document.activeElement,
		view.menuTrigger(2),
		`the caret returns to the trigger: ${view.caret()}`,
	);
	await view.unmount();
});

test("a dismissal returns the caret to the ⋯ trigger", async () => {
	const view = await open("landed");
	await view.openMenu(2);
	// The native menu took the caret while it was up; the renderer puts it back
	// when main reports the dismissal.
	view.menuTrigger(2).blur();
	await view.choose(null);
	assert.equal(
		document.activeElement,
		view.menuTrigger(2),
		`the caret after dismissal: ${view.caret()}`,
	);
	await view.unmount();
});

test("opening the tab menu leaves the running turn exposed and its Stop control pressable", async () => {
	const view = await open("landed");
	const stop = document.getElementById("turn-stop");
	let stopPresses = 0;
	const onStop = () => {
		stopPresses += 1;
	};
	stop.addEventListener("click", onStop);
	try {
		await view.openMenu(2);
		/*
		 * THE NATIVE MENU IS NOT A RENDERER LAYER. The old popout was a Radix
		 * layer that `aria-hidden`ed every sibling and set `pointer-events: none`
		 * on the body while it was open; the OS menu paints outside this DOM
		 * entirely, so none of that may exist here. (Whether the OS menu consumes
		 * the first outside click is a platform fact the jsdom test cannot see; the
		 * committed `scripts/browser-tab-menu-native-proof.mjs` records the page's
		 * pixels and the menu-open state, and the OS popup's own pointer path stays a
		 * hand check because this host denies the permissions a capture needs.)
		 */
		assert.equal(
			document.body.style.pointerEvents,
			"",
			"the menu must not disable the body's pointer events",
		);
		assert.equal(
			stop.closest('[aria-hidden="true"]'),
			null,
			"the Stop control is not hidden from assistive tech",
		);
		assert.ok(
			stop.getBoundingClientRect !== undefined,
			"the Stop control is still in the document",
		);
		await act(() => {
			stop.dispatchEvent(
				new dom.window.MouseEvent("click", {
					bubbles: true,
					cancelable: true,
					button: 0,
				}),
			);
		});
		assert.equal(stopPresses, 1, "the press reached the Stop control");
		await view.choose(null);
	} finally {
		stop.removeEventListener("click", onStop);
		await view.unmount();
	}
});
