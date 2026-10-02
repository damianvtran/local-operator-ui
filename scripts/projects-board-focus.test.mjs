import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * WHERE THE CARET GOES AFTER A CARD'S STATUS MOVE (UX round 1 U2; the pin that
 * round 2's Q-2/Q-2 proved was measuring the wrong tree).
 *
 * WHY THIS FILE WAS REWRITTEN. Round 1 pinned a card-local effect: on the busy
 * edge, focus the trigger the card held. The pin passed and the LIVE app still
 * lost the caret, because a status move RE-PARENTS the card into another column
 * - React unmounts the old `li` and mounts a new one, so by the time the write
 * settles the instance that pressed the trigger is gone and its ref points at a
 * DETACHED node. The round-1 harness never relocated the card, so it asserted a
 * contract the product could not keep (QA round 2, Q-2).
 *
 * WHAT THIS FILE ASSERTS NOW, against the SHIPPED component and the shipped
 * `useMoveFocusHandoff` the page wires: the relocation really detaches the old
 * trigger; the relocated card does NOT grab the caret when it mounts; and the
 * page's hand-off - called after the listing settles - lands the caret on the
 * NEW trigger in the new column. A later render that moves nothing must not
 * steal it back.
 *
 * THE HARNESS IS THE PAGE'S SEQUENCE, not a stand-in for it: `beginMove` is
 * the write plus the refetched listing re-parenting the card (`movingKeys`
 * turning on and the status changing), `settleMove` is the write settling, and
 * `handOff` is what `projects-page.tsx`'s `moveTo` does once its refetch
 * resolves. jsdom, the shipped modules, a generated harness; the teardown and
 * client discipline follow `projects-card-click.test.mjs`, which is the file
 * that already carries `gcTime: 0` plus a `client.clear()` for this hazard.
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
// Loaded for its import-time feature detection (above), not for `createRoot`:
// the harness bundle owns the one root this file unmounts.
await import("react-dom/client");
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
import { ProjectBoard, useMoveFocusHandoff } from "./src/renderer/src/features/projects/components/project-board";

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
	/*
	 * gcTime: 0, AND THE CLIENT CLEAR IN TEARDOWN, ARE LOAD-BEARING rather than
	 * tidy-up. A mounted query client holds ref'd timers: React Query's
	 * five-minute collection timer, and the refetch interval of any query that
	 * arms one - this tree subscribes through useDesktopCapabilities, whose
	 * refetchInterval resolves to CAPABILITY_RENEGOTIATE_MS (15 s). query-core
	 * arms both only when it does NOT resolve isServer, which the jsdom window
	 * global defeats, so a harness is exactly the case that gets them. A client
	 * left armed therefore outlives the last assertion, which the runner reports
	 * as a file whose promise never resolves ("Promise resolution is still
	 * pending but the event loop has already resolved", measured). Reverting
	 * only gcTime/clear from this harness, keeping the corrected teardown,
	 * re-hangs it - that pair is what makes the corrected teardown exit.
	 */
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const Harness = () => {
		const [projects, setProjects] = useState([PROJECT]);
		const [moving, setMoving] = useState([]);
		const handOff = useMoveFocusHandoff();
		api = {
			/* The write goes in flight AND the refetched listing re-parents the
			 * card: React unmounts the old li and mounts one in the paused
			 * column. */
			beginMove: () => {
				setMoving(["p1"]);
				setProjects((current) => [{ ...current[0], status: "paused" }]);
			},
			/* The write settles: the trigger re-enables. */
			settleMove: () => setMoving([]),
			/* What the page does once its refetch resolves. */
			handOff: () => handOff("p1"),
			/* A render that moves nothing. */
			noop: () => setProjects((current) => [...current]),
		};
		return createElement(ProjectBoard, {
			projects,
			nowMs: Date.now(),
			onOpen: () => {},
			onEdit: () => {},
			onDelete: () => {},
			onMove: () => {},
			movingKeys: moving,
		});
	};
	/* The root is created HERE and handed back, so teardown unmounts the tree
	 * that actually rendered. The page creates its root once; the pre-fix
	 * harness created a second root on the same container and unmounted THAT,
	 * so the rendered tree was never released and its observers stayed
	 * subscribed (React warns about the recycled container). React empties the
	 * container itself, so what survives the spare root's unmount is the fiber
	 * tree, not the DOM. */
	const root = createRoot(container);
	root.render(
		createElement(
			QueryClientProvider,
			{ client },
			/* The card's popover asks the router where it is, exactly as the app's
			 * does; the focus contract under test does not care which route. */
			createElement(MemoryRouter, null, createElement(Harness)),
		),
	);
	return { root, client, api: () => api };
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

const TRIGGER = "BUTTON Actions for payments-migration";

async function open() {
	const container = document.getElementById("root");
	container.innerHTML = "";
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
		/** Where a browser's disable-blur leaves the caret: off the control. */
		focusOutside: () => document.getElementById("outside")?.focus(),
		beginMove: async () => {
			await act(() => api.beginMove());
		},
		settleMove: async () => {
			await act(() => api.settleMove());
		},
		handOff: async () => {
			await act(() => api.handOff());
		},
		noop: async () => {
			await act(() => api.noop());
		},
		caret,
		trigger,
		unmount: async () => {
			/* Unmount the root the harness owns and clear the client: the query's
			 * refetch interval dies with the observer, the collection timer with
			 * the cache. Either one left armed holds the event loop open. */
			await act(() => {
				handle.root.unmount();
				handle.client.clear();
			});
			container.innerHTML = "";
		},
	};
}

test("a status move lands the caret on the trigger in the NEW column, and nothing grabs it on the way", async () => {
	const view = await open();
	/* Teardown runs on the RED path too, so a failing assertion reports and the
	 * file still exits. Whether an unguarded teardown would hang instead is
	 * host-dependent - it held to its bound for a mutated copy on this host
	 * while the reviewer's runs of the pre-fix file all exited - so this is
	 * written as the safe shape rather than as a reproduced failure. */
	try {
		await view.focusTrigger();
		const old = view.trigger();
		assert.ok(old, "the card has a menu trigger");
		assert.equal(view.caret(), TRIGGER);

		// THE MOVE: the write is in flight and the refetched listing re-parents the
		// card. React DETACHES the node the caret was on - this is the relocation
		// the round-1 pin never performed.
		await view.beginMove();
		assert.equal(
			old.isConnected,
			false,
			"the move must re-parent the card (detaching the old trigger)",
		);
		/*
		 * BELT AND BRACES, NOT THE GUARD. This one cannot fail as written: the
		 * relocated trigger is `disabled` while `movingKeys` lists the project,
		 * and jsdom refuses focus on a disabled control, so nothing is able to
		 * take the caret at this instant. The assertion that actually catches a
		 * focus-grabbing mount is the no-steal pin below - the mutation that
		 * re-focuses on every render fails there, not here. Kept because it starts
		 * discriminating the day the trigger can be enabled while a move is in
		 * flight, which is a contract worth pinning the moment it exists.
		 */
		assert.notEqual(
			view.caret(),
			TRIGGER,
			"the card must not grab the caret when it mounts in its new column",
		);

		// The listing settles and the page hands the caret back.
		await view.settleMove();
		await view.handOff();
		assert.equal(
			view.caret(),
			TRIGGER,
			"the hand-off must land the caret on the trigger's new node",
		);
		const fresh = view.trigger();
		assert.ok(fresh && fresh !== old && fresh.isConnected);

		// A later render that moves nothing must not steal it back.
		view.focusOutside();
		assert.equal(view.caret(), "INPUT");
		await view.noop();
		assert.equal(
			view.caret(),
			"INPUT",
			"an unrelated render must not steal the caret",
		);
	} finally {
		await view.unmount();
	}
});
