import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act, useState } from "react";

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
	const press = async () => {
		// The band opens from the row's own menu, exactly as a press does in the app.
		const trigger = document.querySelector(
			'[data-tab-id="2"] [data-tour-tag="browser-tab-menu"]',
		);
		await act(() => trigger.click());
		const item = document.querySelector(
			'[data-tour-tag="browser-tab-close-others"]',
		);
		await act(() => item.click());
	};
	return {
		controls,
		press,
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
	assert.match(
		view.caret(),
		/^BUTTON role=tab in-tab=\d+$/,
		`the caret after the close landed: ${view.caret()} (rows ${view.controls.rows().join(",")})`,
	);
	await view.unmount();
});
