import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE WHOLE CARD IS THE TARGET (operator report, 2026-09-28).
 *
 * The board card used to be a surface whose only door was its title: the facts
 * line, the chips and the progress row were inert, so a pointer over most of
 * the card read "nothing here". The card now carries the role, the click and
 * the keyboard activation itself, and its two nested doors - the `···` menu
 * and the sessions popover - stop the bubble at their own triggers.
 *
 * WHAT THIS FILE PINS, against the SHIPPED component:
 * - a press anywhere on the card opens it, EXACTLY once per press (the title
 *   is inside the card now, and a press on it must not double-fire);
 * - Enter and Space on the focused card open it, and Space is claimed
 *   (`preventDefault`) so the column under the caret does not scroll;
 * - a text selection inside the card suppresses the navigation the releasing
 *   click would otherwise perform;
 * - the menu and sessions doors act WITHOUT navigating the card, which is
 *   what a keyboard activation of either door would otherwise do (its click
 *   bubbles exactly like a mouse one);
 * - the menu still opens from its own trigger - the guards must not swallow
 *   the door's behaviour.
 *
 * THE HARNESS IS THE SHIPPED COMPONENT (jsdom + esbuild), modelled on
 * `projects-board-focus.test.mjs`; the providers are what the app gives the
 * board (react-query for the sessions door's read, the router for its rows).
 *
 * THE COST OF OPENING A DOOR HERE, measured rather than surprising anyone:
 * each Radix open path (menu, popover) burns ~15-18 SECONDS OF WALL TIME in
 * this DOM and almost no CPU - the open path's timer-driven loops never reach
 * their layout conditions under jsdom, so they spin their retry schedules out.
 * Stubbing `react-remove-scroll`/`aria-hidden` (both are imported by the open
 * path) and dropping `pretendToBeVisual` were tried and changed nothing; the
 * cost is accepted because these two tests are the only local proof that a
 * door's own press does not navigate the card, and the story's play covers the
 * same open against a real browser.
 */

// React DOM feature-detects input events at import time, so the document has
// to exist before it is loaded. A real origin, not jsdom's opaque default.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
	url: "http://localhost/",
});
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
/*
 * THE EVENT CONSTRUCTORS MUST COME FROM JSDOM'S REALM, not Node's. The copy
 * above skips them because Node defines same-named globals, and Radix's
 * focus/dismiss layers CONSTRUCT events through the global - jsdom then
 * refuses its own `dispatchEvent` ("parameter 1 is not of type 'Event'") and
 * every portal this file opens would throw during its mount effects.
 */
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	globalThis[name] = dom.window[name];
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
/* The sessions door's read must not reach a backend from a test run; the read
 * rejects, react-query records it, and the guard under test never inspects
 * the read's state. */
globalThis.fetch = () =>
	Promise.reject(new Error("no backend in this harness"));
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const ENTRY = `
import { createElement } from "react";
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
	target_date: "2026-10-15",
	completed_at: null,
	estimate: 13,
	estimate_unit: "points",
	sessions: 2,
	live_sessions: 1,
	milestones: [],
	milestones_completed: 2,
	milestones_total: 5,
};

export function mount(container) {
	/* A counter, not a spy library: the assertions are about how many
	 * navigations a press performs. */
	const calls = { open: 0, edit: 0, del: 0, move: 0 };
	/*
	 * gcTime: 0 is load-bearing for THIS file: the default five-minute
	 * collection timer is armed by the card's query on mount, and it keeps the
	 * process alive long after the last assertion - the runner reads that as a
	 * file whose promise never resolves ("Promise resolution is still pending
	 * but the event loop has already resolved", measured). The unmount also
	 * clears the client, so a cancelled run leaves no timer behind either.
	 */
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const root = createRoot(container);
	root.render(
		createElement(
			QueryClientProvider,
			{ client },
			/* The card's popover asks the router where it is, exactly as the
			 * app's does; the click contract does not care which route. */
			createElement(
				MemoryRouter,
				null,
				createElement(ProjectBoard, {
					projects: [PROJECT],
					nowMs: Date.now(),
					onOpen: () => {
						calls.open += 1;
					},
					onEdit: () => {
						calls.edit += 1;
					},
					onDelete: () => {
						calls.del += 1;
					},
					onMove: () => {
						calls.move += 1;
					},
					movingKeys: [],
				}),
			),
		),
	);
	return { calls, root, client };
}
`;

const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "card-click.mjs",
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
const bundlePath = new URL(`./_card-click-${process.pid}.mjs`, import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { mount } = await import(bundlePath.href);
await unlink(bundlePath);

const CARD = '[data-project-name="payments-migration"]';
const MENU = '[aria-label="Actions for payments-migration"]';
const SESSIONS = '[data-project-sessions="p1"]';

/** Mount the board on its own host and return the handles the tests drive. */
async function open() {
	const host = document.createElement("div");
	document.body.append(host);
	const handle = await act(() => mount(host));
	const card = () => host.querySelector(CARD);
	const press = async (el) => {
		assert.ok(el, "the harness must find the element it presses");
		await act(() =>
			el.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
			),
		);
	};
	/* What a real press is for a Radix trigger: pointerdown opens the door,
	 * the click that follows is the one the card's guard must stop. */
	const pointer = async (el) => {
		assert.ok(el, "the harness must find the trigger it presses");
		await act(() =>
			el.dispatchEvent(
				new dom.window.MouseEvent("pointerdown", {
					bubbles: true,
					cancelable: true,
					button: 0,
				}),
			),
		);
		await press(el);
	};
	return {
		calls: handle.calls,
		card,
		press,
		pointer,
		unmount: async () => {
			await act(() => {
				handle.root.unmount();
				handle.client.clear();
			});
			host.remove();
		},
	};
}

test("a press anywhere on the card opens it, exactly once per press", async () => {
	const view = await open();
	const card = view.card();
	assert.ok(card, "the card is mounted");
	/* The card's background; the name/description block; a fact chip; the
	 * progress row - the kinds of surface the operator pointed at. */
	await view.press(card);
	await view.press(card.querySelector("span.block.truncate"));
	await view.press(card.querySelector("span.bg-sunken"));
	await view.press(card.querySelector("span.min-w-0.truncate"));
	assert.equal(
		view.calls.open,
		4,
		"one press, one open - four presses, four opens (no double-fire)",
	);
	await view.unmount();
});

test("Enter and Space on the focused card open it; Space is claimed", async () => {
	const view = await open();
	const card = view.card();
	await act(() => card.focus());
	assert.equal(document.activeElement, card, "the card takes focus");
	const enter = new dom.window.KeyboardEvent("keydown", {
		key: "Enter",
		bubbles: true,
		cancelable: true,
	});
	await act(() => card.dispatchEvent(enter));
	assert.equal(view.calls.open, 1, "Enter opens the card");
	const space = new dom.window.KeyboardEvent("keydown", {
		key: " ",
		bubbles: true,
		cancelable: true,
	});
	await act(() => card.dispatchEvent(space));
	assert.equal(view.calls.open, 2, "Space opens the card");
	assert.equal(
		space.defaultPrevented,
		true,
		"Space does not scroll the column",
	);
	await view.unmount();
});

test("a selection inside the card suppresses the releasing press", async () => {
	const view = await open();
	const card = view.card();
	const name = card.querySelector("span.block.truncate").firstChild;
	const range = dom.window.document.createRange();
	range.selectNodeContents(name);
	const selection = dom.window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	assert.equal(
		selection.isCollapsed,
		false,
		"the harness has a real selection",
	);
	await view.press(card);
	assert.equal(
		view.calls.open,
		0,
		"a press ending a selection does not navigate",
	);
	selection.removeAllRanges();
	await view.press(card);
	assert.equal(view.calls.open, 1, "a plain press after it does navigate");
	await view.unmount();
});

test("the menu door acts without navigating the card, and still opens", async () => {
	const view = await open();
	await view.pointer(document.querySelector(MENU));
	assert.equal(
		view.calls.open,
		0,
		"the trigger's press does not navigate the card",
	);
	assert.ok(
		(document.body.textContent ?? "").includes("Set status"),
		"the menu opened from its own trigger",
	);
	await view.unmount();
});

test("the sessions door acts without navigating the card", async () => {
	const view = await open();
	await view.pointer(document.querySelector(SESSIONS));
	assert.equal(
		view.calls.open,
		0,
		"the sessions door's press does not navigate",
	);
	await view.unmount();
});
