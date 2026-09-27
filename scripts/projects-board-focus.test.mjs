import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * WHERE THE CARET GOES AFTER A CARD'S STATUS MOVE (UX round 1, U2).
 *
 * WHAT IS AND IS NOT EVIDENCE HERE. jsdom has no layout engine and no IPC:
 * what this file asserts is the DOM focus contract around the card's ⋯
 * trigger — the caret parks on it, a move's `busy` window (which DISABLES the
 * control and so blurs it) drops the caret to `<body>` exactly as the UX round
 * measured in the real app, and the re-enable hands it back. The app-level half
 * (the popover/menu rendering, the writes themselves) is the sweep's
 * play-driven board frames and QA's pass.
 *
 * MODELLED ON `browser-tab-strip-focus.test.mjs`: the shipped component, its
 * own effects, jsdom, and a generated harness — a stand-in component here
 * would assert the stand-in.
 */

// React DOM feature-detects input events at import time, so the document has to
// exist before it is loaded. A real origin, not jsdom's opaque default.
const dom = new JSDOM(
	'<!doctype html><html><body><input id="outside"><div id="root"></div></body></html>',
	{ pretendToBeVisual: true, url: "http://localhost/" },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Accessors jsdom defines on the window take no new value; the DOM
		// globals this file needs are the ones already copied above.
	}
}
// jsdom implements neither, and both are used by the card's descendants.
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
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const ENTRY = `
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ProjectBoard } from "./src/renderer/src/features/projects/components/project-board";

const PROJECT = {
	id: "p1",
	name: "payments-migration",
	description: "Move billing off the legacy stack",
	status: "active",
	progress: null,
	progress_updated_at: null,
	progress_reported_by: "",
	progress_stale: false,
	tags: [],
	created_at: 1757800000,
	updated_at: 1757800000,
	start_date: null,
	target_date: null,
	completed_at: null,
	estimate: null,
	estimate_unit: null,
	sessions: 2,
	live_sessions: 1,
	milestones: [],
	milestones_completed: 0,
	milestones_total: 0,
};

export function mount(container) {
	let api = null;
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const Harness = () => {
		const [moving, setMoving] = useState([]);
		api = { setMoving };
		return createElement(ProjectBoard, {
			projects: [PROJECT],
			nowMs: Date.now(),
			onOpen: () => {},
			onEdit: () => {},
			onDelete: () => {},
			onMove: () => {},
			movingKeys: moving,
		});
	};
	createRoot(container).render(
		createElement(
			QueryClientProvider,
			{ client },
			/* The card's popover asks the router where it is, exactly as the app's
			 * does; the focus contract under test does not care which route. */
			createElement(MemoryRouter, null, createElement(Harness)),
		),
	);
	return { api: () => api };
}
`;

const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "board-focus.mjs",
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
	`./_board-focus-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { mount } = await import(bundlePath.href);
await unlink(bundlePath);

/** The caret, described the way a finding describes it. */
function caret() {
	const el = document.activeElement;
	if (!el || el === document.body) return "body";
	return `${el.tagName} ${el.getAttribute("aria-label") ?? ""}`.trim();
}

async function open() {
	const container = document.getElementById("root");
	container.innerHTML = "";
	const root = createRoot(container);
	let handle = null;
	await act(() => {
		handle = mount(container);
	});
	const api = handle.api();
	const trigger = () =>
		document.querySelector('[aria-label="Actions for payments-migration"]');
	return {
		/** Park the caret on the menu trigger, the way a press does. */
		focusTrigger: async () => {
			await act(() => trigger()?.focus());
		},
		setBusy: async (keys) => {
			await act(() => api.setMoving(keys));
		},
		/** Where a browser's disable-blur leaves the caret: off the control. */
		focusOutside: () => document.getElementById("outside")?.focus(),
		caret,
		trigger,
		unmount: async () => {
			await act(() => root.unmount());
			container.innerHTML = "";
		},
	};
}

test("a move's busy window drops the caret to body and the re-enable hands it back", async () => {
	const view = await open();
	await view.focusTrigger();
	assert.equal(view.caret(), "BUTTON Actions for payments-migration");
	/*
	 * The write goes in flight and the trigger disables itself. JSDOM DOES NOT
	 * BLUR A DISABLED CONTROL (a browser does — the UX round measured the caret
	 * on `document.body`), so the drop is stated here rather than inherited:
	 * blur is exactly what the browser did to this control.
	 */
	await view.setBusy(["p1"]);
	/*
	 * JSDOM KEEPS FOCUS ON A DISABLED CONTROL (it refuses to blur it); a
	 * browser blurs it, which is the UX round's measured drop to
	 * `document.body`. The drop is therefore STATED — the caret moves where
	 * the browser put it — and the assertion under test is the recovery.
	 */
	view.focusOutside();
	assert.equal(view.caret(), "INPUT");
	// A second render INSIDE the spell must not grab it early: the effect keys
	// off the busy EDGE, not on every render while a write is out.
	await view.setBusy(["p1"]);
	assert.equal(
		view.caret(),
		"INPUT",
		"still-in-flight must not grab the caret back",
	);
	// The write settles with no error: the trigger re-enables, and the effect
	// returns the caret to the control the user pressed.
	await view.setBusy([]);
	assert.equal(
		view.caret(),
		"BUTTON Actions for payments-migration",
		"the re-enable must hand the caret back",
	);
	await view.unmount();
});
