import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE ASKS DRAWER, driven through the shipped components and the shipped store.
 *
 * Why this file exists: the converged BLOCKER of round 1 was invisible to every
 * rig in the repo. `ask-queue.test.mjs` can assert the read model but not a
 * render; the composer suite predates these modules; and the store's own text
 * tests replace the composer with a stand-in. The defect that mattered most then -
 * a chat draft being submitted as the agent's ANSWER, and an answer being posted
 * as a chat message - came from the composer's old ask mode (design §5.0, R7),
 * which swapped one box between a chat buffer and an answer buffer. That mode was
 * retired on 2026-10-07 (the main composer is an ordinary chat box in every state;
 * `ask-composer-no-routing.test.mjs` pins its absence), and with it the swap. What
 * this file keeps is the part that outlived it: the drawer's own mount behaviour.
 *
 * WHAT THIS PINS
 *
 *  1. The door: a mount into a queue that is published but EMPTY must NOT fire the
 *     drawer's close door (a settle from the terminal or the phone, or a timeout)
 *     - reachable on every conversation switch. The old shape of this test also
 *     pinned a door that said "collapsed" to an already-collapsed page; there is
 *     no collapsed mount any more (the drawer is mounted only while open, and the
 *     flag that decides it is the store's), so that half is gone with the state it
 *     described rather than weakened.
 *  2. The store's two writers: `setCurrentInput` (the keystroke writer) must not bump
 *     the revision the composer mirrors on; `setComposerText` (the app's writer)
 *     must. The ask lane no longer calls the second, but the contract is the
 *     store's and its other callers (the agents config box, the canonical store's
 *     held-draft return) rely on it.
 *
 * WHAT IT DOES NOT CLAIM: that a real keystroke produces the same state, or
 * anything about layout. The end-to-end wiring of the box is a frame-rig
 * measurement (the QA round drove it over CDP); this file is the regression
 * signal that would have caught the blocker without one.
 */

const bootstrap = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
// React refuses `act` outside a declared act environment, and says so on every render.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

const bundle = await build({
	stdin: {
		contents: `
			export { AskDrawer } from "./src/renderer/src/features/chat/components/asks/ask-drawer";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
		`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	/*
	 * EVERYTHING IS BUNDLED EXCEPT THE REACT FAMILY. The drawer reads the shared
	 * store since round-1 Q1 (`askOpenIntent`), and the store reaches `base-theme`,
	 * which imports `@mui/material/styles` - a directory import that Node's ESM
	 * loader refuses when it is left external; `ask-open-render.test.mjs` carries
	 * this same list and its derivation. React stays external so the hooks inside
	 * the bundle and the `react-dom/client` this file mounts with are ONE copy.
	 */
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"react/jsx-dev-runtime",
	],
	/* A CJS module inside the bundle calls `require("react")`, which an ESM bundle
	 * cannot satisfy on its own; the banner lets it reach the same React. */
	banner: {
		js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
	},
	// The renderer's own aliases, so the bundle reads the real modules rather than a
	// stand-in.
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
	logLevel: "silent",
});
const bundlePath = new URL(
	`./_ask-draft-swap-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { AskDrawer, useConversationInputStore } = await import(bundlePath.href);
await unlink(bundlePath).catch(() => {});

const h = React.createElement;
const TS = 1_760_000_000_000;

const openAsk = {
	ask_id: "a-7f3c",
	created_at: TS,
	expires_at: TS + 3_600_000,
	timeout_s: 3600,
	status: "open",
	delivered: false,
	questions: [
		{
			id: "target",
			question: "Which environment?",
			options: [{ label: "staging" }],
		},
	],
};

/** A published queue carrying `asks`, which is what the surfaces gate on. */
const frontend = (asks) => ({
	asks,
	asks_open:
		asks === null ? null : asks.filter((row) => row.status === "open").length,
	asks_truncated: null,
});

const mount = async (element) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(element);
	});
	return {
		container,
		async rerender(next) {
			await act(async () => {
				root.render(next);
			});
		},
		async unmount() {
			await act(async () => {
				root.unmount();
			});
			container.remove();
		},
	};
};

/**
 * MOUNT FOR A TEST, WITH THE TEARDOWN HANDED TO THE RUNNER (agent review round 2, N2).
 *
 * The tests below unmount at their own end, which is fine on the pass path and useless
 * on the fail path: a failing assertion throws before that line, the mounted drawer's
 * clock keeps the event loop alive, and the file-level run then waits out its bound
 * instead of reporting a clean red - measured on the round-0 tree (259 s, `cancelled 1`,
 * "Promise resolution is still pending"). `t.after` unmounts exactly once whether the
 * body passed, failed or threw, so a non-vacuity re-run is a red, not a hang.
 */
const mountFor = async (t, element) => {
	const view = await mount(element);
	t.after(() => view.unmount());
	return view;
};

/* --------------------------------------------------------------- the door ---- */

test("a mount over a queue with nothing to show closes itself, unless a door opened it", async () => {
	/*
	 * THE SWITCH (the stuck-slot defect). `SessionPanel` is keyed by conversation and
	 * the open flag is the STORE's, so a drawer left open in one conversation MOUNTS
	 * over the next conversation's frame with no door behind it. When that frame has
	 * nothing to show, the mount used to keep the right slot with nothing drawn at all
	 * - no bar, no dismiss, no exit - so it now closes itself.
	 */
	const switched = [];
	const view = await mount(
		h(AskDrawer, {
			frontend: frontend([]),
			scope: "session",
			onClose: () => switched.push(true),
		}),
	);
	assert.deepEqual(
		switched,
		[true],
		"a mount over a queue with nothing to show closes itself",
	);
	await view.unmount();

	/*
	 * THE DOOR: the fleet trigger is offered at ZERO outstanding asks, so a press on
	 * it opens this surface over an empty queue ON PURPOSE - closing that mount would
	 * be a control refusing its own door. The signal is the lane's own: the entry move
	 * accepts the composer chip (`ASK_ITEM_SELECTOR`) or the rail item
	 * (`ASK_RAIL_ITEM_SELECTOR`, the header trigger until #896), so the rig puts focus
	 * on the rail door before mounting, which is the state a press leaves behind.
	 */
	const pressed = [];
	const door = document.createElement("button");
	door.setAttribute("data-tour-tag", "ask-pane-trigger");
	document.body.appendChild(door);
	door.focus();
	const held = await mount(
		h(AskDrawer, {
			frontend: frontend([]),
			scope: "fleet",
			onClose: () => pressed.push(true),
		}),
	);
	assert.deepEqual(
		pressed,
		[],
		"the user's own press on a door keeps the surface that door opened",
	);
	await held.unmount();
	door.remove();
});

/*
 * THE UNREAD FRAME IS NOT AN EMPTY ONE (the WIRE FIX). `frontend: null` is "the read
 * has not answered" - the fleet pane's first commits, or a session frame that has not
 * landed - and it must close NOTHING: the drawer's own slot is claimed by the mount,
 * so a close fired on a pending read would take the surface away from a user whose
 * queue is about to arrive. It must also not TRAP: the chrome renders over it, and
 * the frame's absence is what the body states.
 */
test("an unresolved frame neither closes the drawer nor draws nothing", async (t) => {
	const calls = [];
	const view = await mountFor(
		t,
		h(AskDrawer, {
			frontend: null,
			scope: "session",
			onClose: () => calls.push(true),
		}),
	);
	assert.deepEqual(calls, [], "an unread frame is not an emptied queue");
	assert.ok(
		view.container.querySelector("[data-lo-ask-surfaces]") !== null,
		"the drawer drew nothing over an unread frame, which is the claimed slot with no close control the whole fix exists to remove",
	);
	assert.ok(
		view.container.textContent.includes("Reading the asks"),
		"the unread frame must say what the surface is doing rather than a count it cannot substantiate",
	);
	/*
	 * AND THE BAR NAMES NOTHING ELSE (design round 1, D5). The scope line used to carry
	 * `Not read yet` while the body said `Reading the asks…` - the same fact twice in the
	 * same register 30 px apart, which reads as one paragraph rather than as chrome plus
	 * body. The clause is gone and the body holds the fact.
	 */
	const bar = view.container.querySelector("[data-ask-scope]");
	assert.ok(bar !== null, "the bar is the thing being asserted about");
	assert.equal(
		bar.textContent.trim(),
		"This conversation",
		"the scope line drops its clause while unresolved, rather than dangling a separator",
	);
});

/*
 * THE UNREAD FRAME IS NOT AN UNSUPPORTED ONE EITHER (design round 1, D1). Both carry
 * no rows and neither is publishable, so they used to share their copy - which parked the
 * in-flight line on a runtime that can never answer, reachable because the header door is
 * offered at zero asks. `view.unread` is what tells them apart, and the difference is
 * visible: the bar states the capability it lacks, the body says what that means, and the
 * word `Reading` is not on the surface at all.
 */
test("a runtime that publishes no engine gets its own state, not the in-flight copy", async (t) => {
	const view = await mountFor(
		t,
		h(AskDrawer, {
			frontend: { asks: null, asks_open: null },
			scope: "session",
			onClose: () => {},
		}),
	);
	assert.ok(
		view.container.querySelector("[data-lo-ask-surfaces]") !== null,
		"the chrome renders, so the slot it claims always carries a close control",
	);
	assert.ok(
		view.container.textContent.includes("Asks unavailable"),
		"the bar must state the capability this runtime lacks",
	);
	assert.ok(
		view.container.textContent.includes("doesn't support queued asks"),
		"and the body must say what that means, rather than promising a read",
	);
	assert.ok(
		!view.container.textContent.includes("Reading the asks"),
		"a progress claim that can never complete is not this frame's to wear",
	);
});

/*
 * THE WIRE BOUND'S FRAME: NO ROWS, A LIVE TALLY (remediation round 1, R1). The runtime
 * drops the whole row list while deliberately keeping `asks_open`
 * (`_bound_asks_in_place`), so a mount can arrive over four answerable asks with nothing
 * to draw. Two things must not happen: the surface must not deny the count, and the
 * auto-close must not fire - closing over it releases the slot and leaves every one of
 * those asks unreachable, which is the reported defect with the sign flipped.
 */
test("a mount over dropped rows with a live tally keeps the drawer and states the count", async (t) => {
	const calls = [];
	const view = await mountFor(
		t,
		h(AskDrawer, {
			frontend: { asks: null, asks_open: 4, asks_truncated: true },
			scope: "session",
			onClose: () => calls.push(true),
		}),
	);
	assert.deepEqual(
		calls,
		[],
		"the drawer closed over a rowless frame that stands for four answerable asks",
	);
	assert.ok(
		view.container.textContent.includes("4 outstanding"),
		"the tally is what this frame carries, so the bar must count it",
	);
	assert.ok(
		!view.container.textContent.includes("No asks outstanding"),
		"the panel denied a count its own bar states",
	);
	assert.ok(
		!view.container.textContent.includes("carries the count, not the rows"),
		"the panel must not repeat the bar's count in wire vocabulary (D2-1, U2-2)",
	);
	assert.ok(
		view.container.textContent.includes(
			"details for these asks could not be loaded",
		),
		"the panel must say which half of the frame is missing, in the user's words",
	);
});

/*
 * THE ZERO-ROW PANE'S LANDING (UX round 2, U2-1). R3/Q1 gave a live-but-EMPTY queue a
 * door, and the pane that door opens has NO rows and no focusable control except the
 * bar's dismiss - so the entry move's landing chain used to stop at the bare `panel`
 * term, whose root is a plain `<div>` with no `tabIndex`. `focus()` on it is inert, the
 * `?? root` term below it was dead code, and focus stayed on the HEADER DOOR - which the
 * lane's Escape claim does NOT include - so Escape did nothing on a fully mounted pane.
 *
 * THE ASSERTIONS ARE THE CLAIM: with the door under focus, the mount must put the
 * keyboard INSIDE the surface (that is what makes Escape the lane's own), and an Escape
 * from there must close. The mount is door-opened, so the auto-close stands down and the
 * pane is genuinely on screen to be escaped from - which is the state the round-1 tests
 * could not reach, since the door was not offered on a zero-row queue then.
 */
test("a door-opened pane with no rows lands focus inside the surface, where Escape closes (U2-1)", async (t) => {
	const calls = [];
	const door = document.createElement("button");
	door.setAttribute("data-tour-tag", "ask-pane-trigger");
	document.body.appendChild(door);
	door.focus();
	const view = await mountFor(
		t,
		h(AskDrawer, {
			frontend: frontend([]),
			scope: "session",
			onClose: () => calls.push(true),
		}),
	);
	const surface = view.container.querySelector("[data-lo-ask-surfaces]");
	assert.ok(surface !== null, "the pane is mounted over the empty queue");
	assert.ok(
		surface.contains(document.activeElement),
		"the entry move left the keyboard outside the pane, where the lane's Escape claim does not reach",
	);
	assert.equal(
		document.activeElement,
		surface,
		"and it landed on the surface itself, the stop the chain's last resort names",
	);
	await act(async () => {
		document.activeElement.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	assert.deepEqual(
		calls,
		[true],
		"Escape from the landing must close the pane",
	);
	door.remove();
});

/*
 * THE RETRY BOUND, BEHAVIOURALLY (agent review round 1, R4). The structural check in
 * `fleet-asks.test.mjs` pins the source shape of the entry move (no dependency array, the
 * retry spelled on the frame); this is the same claim executed - a door under focus while
 * the frame is unread moves NOTHING, and the one-shot resolves on the commit that carries
 * the rows, once.
 */
test("the entry move waits for the frame and moves focus once it lands (R4)", async (t) => {
	const door = document.createElement("button");
	door.setAttribute("data-tour-tag", "ask-pane-trigger");
	document.body.appendChild(door);
	door.focus();
	const view = await mountFor(
		t,
		h(AskDrawer, { frontend: null, scope: "session", onClose: () => {} }),
	);
	const surface = view.container.querySelector("[data-lo-ask-surfaces]");
	assert.ok(surface !== null, "the chrome is up on the unread commit");
	assert.equal(
		document.activeElement,
		door,
		"the keyboard stayed on the door while the frame that carries its surface was unread",
	);
	await view.rerender(
		h(AskDrawer, {
			frontend: frontend([radioAsk]),
			scope: "session",
			onClose: () => {},
		}),
	);
	const active = document.activeElement;
	assert.ok(
		surface.contains(active),
		"the one-shot never resolved once the rows landed",
	);
	assert.equal(
		active?.getAttribute("data-ask-option"),
		"staging",
		"and it landed on the card's first option, as the entry rule says",
	);
	await view.unmount();
	door.remove();
});

test("the close door fires ONCE per emptying", async () => {
	const calls = [];
	const props = { scope: "session", onClose: () => calls.push(true) };
	const view = await mount(
		h(AskDrawer, { frontend: frontend([openAsk]), ...props }),
	);
	assert.deepEqual(calls, [], "mount with rows is not an emptying");
	await view.rerender(h(AskDrawer, { frontend: frontend([]), ...props }));
	assert.deepEqual(calls, [true], "one close, delivered once");
	// And not again on the renders that follow it.
	await view.rerender(h(AskDrawer, { frontend: frontend([]), ...props }));
	await view.rerender(h(AskDrawer, { frontend: frontend([]), ...props }));
	assert.deepEqual(calls, [true], "the transition fires once, not per render");
});

/* ---------------------------------------------------------- the authority ---- */

test("only the app's writer bumps the revision the composer mirrors on", () => {
	// The ask lane no longer writes the box (the routing is retired), but the store
	// contract stays: `setComposerText` is how the app moves the box's text at all.

	const store = () => useConversationInputStore.getState();
	const id = "sess-swap";
	// The keystroke path: the composer calls this on every change, so it must stay
	// silent or the composer would mirror its own typing back at itself.
	store().setCurrentInput(id, "chat draft");
	const afterKeystroke = store().inputByConversation[id].textRevision ?? 0;
	store().setCurrentInput(id, "chat draft two");
	assert.equal(
		store().inputByConversation[id].textRevision ?? 0,
		afterKeystroke,
		"the keystroke writer is not the box's author",
	);
	// The app's writer: this is what makes an app-side write reach the box at all.
	store().setComposerText(id, "answer draft");
	assert.ok(
		(store().inputByConversation[id].textRevision ?? 0) > afterKeystroke,
		"the app's writer must bump the revision, or the box never adopts the swap",
	);
	assert.equal(store().inputByConversation[id].currentInput, "answer draft");
	// An EMPTY value is an instruction here, not "no change": the box must be empty.
	store().setComposerText(id, "");
	assert.equal(store().inputByConversation[id].currentInput, "");
	assert.equal(store().inputByConversation[id].unredactedChars, 0);
});

/*
 * ---------------------------------------------------------------------------
 * The drawer's own affordances, on the same mount.
 *
 * WHY HERE. This file is the drawer's jsdom mount rig - the one place the shipped
 * `AskDrawer` renders against the shipped stores - so the claims the round-1 reviews
 * made about the SURFACE rather than about the swap are pinned on the same
 * instrument: where the keyboard lands when a card is there to land on (UX U4) and
 * when only settled rows are (agent review m1), what the settled header says (agent
 * review M1 = UX U1 = design D1), what the bar counts (UX U5), and what the card
 * draws for an answer the option list never offered (design D2's addendum). Each of
 * those was found by looking at a frame or driving the app; none of them had a
 * signal in CI, which is the defect this section closes.
 * ---------------------------------------------------------------------------
 */

/** An ask whose first question carries a radio pair, plus the settled fixtures. */
const radioAsk = {
	...openAsk,
	questions: [
		{
			id: "target",
			question: "Which environment?",
			options: [{ label: "staging" }, { label: "production" }],
		},
	],
};

const settled = (status, id) => ({
	...openAsk,
	ask_id: id,
	status,
	questions: [
		{
			id: "target",
			question: "Which environment?",
			options: [{ label: "staging" }, { label: "production" }],
		},
	],
});

test("the keyboard lands on the card's first option, not on the dismiss (UX U4)", async () => {
	// The trigger the app's own press leaves focus on: the chip is the only state
	// the mount's focus move accepts, which is what keeps it the user's gesture.
	const chip = document.createElement("button");
	chip.setAttribute("data-lo-ask-item-toggle", "");
	document.body.appendChild(chip);
	chip.focus();
	assert.equal(document.activeElement, chip);
	const view = await mount(
		h(AskDrawer, { frontend: frontend([radioAsk]), scope: "session" }),
	);
	const active = document.activeElement;
	assert.equal(
		active?.getAttribute("data-ask-option"),
		"staging",
		"the surface must not open with its own exit under the keyboard",
	);
	assert.notEqual(active?.getAttribute("aria-label"), "Close asks");
	// And the bar is still reachable: one Shift+Tab up, which jsdom cannot walk -
	// the assertion that it is focusable at all is the point here.
	const dismiss = view.container.querySelector('[aria-label="Close asks"]');
	assert.ok(dismiss, "the dismiss is still the bar's trailing control");
	await view.unmount();
	chip.remove();
});

test("a settled-only queue lands on the first settled row, never on the filter (agent review m1)", async () => {
	/*
	 * THE OTHER HALF OF U4, which the first fix left broken: scoping the entry walk to
	 * `[data-lo-ask-row]` holds while a pending card is drawn, but a settled row lives
	 * inside its own `Disclosure` and a COLLAPSED `Disclosure` paints no children - so a
	 * settled-only queue had no `[data-lo-ask-row]` at all and the walk fell through to
	 * the new filter's first button. This is the reproduction, kept as the pin: the
	 * filter is asserted PRESENT in the same render, because a render without it could
	 * not tell the two landings apart.
	 */
	const chip = document.createElement("button");
	chip.setAttribute("data-lo-ask-item-toggle", "");
	document.body.appendChild(chip);
	chip.focus();
	const view = await mount(
		h(AskDrawer, {
			frontend: frontend([
				/*
				 * BOTH TERMINAL, and deliberately not `answered`: an answered ask whose answer has
				 * not been delivered is a DELIVERING row, which the panel draws as a pending card
				 * - so a fixture built from one is not a settled-only queue at all, and the first
				 * draft of this test measured that instead (the chip and two landing targets).
				 * `declined` and `dismissed` are settled on both halves of the predicate.
				 */
				settled("declined", "a-declined"),
				settled("dismissed", "a-dismissed"),
			]),
			scope: "session",
		}),
	);
	assert.ok(
		view.container.querySelector("[data-lo-ask-filter]"),
		"the filter control is rendered here, which is what makes this test discriminate",
	);
	const group = view.container.querySelector("[data-lo-ask-settled]");
	assert.ok(group, "the settled group renders");
	const active = document.activeElement;
	assert.ok(
		active,
		"the entry move still lands somewhere in a settled-only queue",
	);
	assert.ok(
		group.contains(active),
		"the landing is inside the settled group rather than on the filter above the list",
	);
	assert.equal(
		active?.getAttribute("aria-expanded"),
		"false",
		"and it is the first settled row's own trigger, so the reader can open it",
	);
	await view.unmount();
	chip.remove();
});

test("a filter whose half is empty says so, and the boundary label goes with the boundary (design D1 = UX U2)", async (t) => {
	/*
	 * THE REPORTED REPRO, on the shipped panel: one open ask, press the chip whose count
	 * is zero. Before the fix the pane went blank under the chips - no empty copy at all
	 * - which reads as "there are no asks" over a queue that has one, and the drawer's
	 * own bar was still saying "1 question waiting" above it.
	 */
	const view = await mountFor(
		t,
		h(AskDrawer, { frontend: frontend([radioAsk]), scope: "session" }),
	);
	const chip = [
		...view.container.querySelectorAll("[data-lo-ask-filter] button"),
	].find((b) => (b.textContent ?? "").startsWith("Settled"));
	if (!chip) throw new Error("the zero-count chip is not rendered");
	assert.equal(
		chip.textContent,
		"Settled · 0",
		"the chip counts the empty half",
	);
	await act(async () => {
		chip.click();
	});
	const panel = view.container.querySelector("[data-lo-ask-panel]");
	const text = panel?.textContent ?? "";
	assert.ok(
		text.includes("No asks have settled yet"),
		"the empty half states its own emptiness rather than leaving the pane blank",
	);
	assert.ok(
		text.includes("They are all still pending."),
		"and names the half that does hold the asks, so it cannot read as an empty queue",
	);
	assert.ok(
		[...view.container.querySelectorAll("[data-lo-ask-filter] button")].some(
			(b) => b.textContent === "Pending · 1",
		),
		"the half is named `Pending`, the opposite of `Settled` (design round 1 on #1116, D1)",
	);
	assert.equal(
		view.container.querySelectorAll("[data-lo-ask-row]").length,
		0,
		"and the pending card it points at is genuinely not drawn under this filter",
	);
	/*
	 * THE OTHER HALF OF THE SAME PRESS (design round 1, D2 = UX round 1, U4): the settled
	 * boundary label is drawn only while there is a pending half above it, so under
	 * `Settled` it is absent - which is what stopped the pane reading `Settled · 3` twice.
	 * Asserted on the same mount by switching back to `All`.
	 */
	const allChip = [
		...view.container.querySelectorAll("[data-lo-ask-filter] button"),
	].find((b) => (b.textContent ?? "").startsWith("All"));
	if (!allChip) throw new Error("the All chip is not rendered");
	await act(async () => {
		allChip.click();
	});
	const group = view.container.querySelector("[data-lo-ask-settled]");
	assert.equal(
		group,
		null,
		"with one pending ask and none settled, there is no group to head",
	);
});

test("the settled group labels only what it holds, and each row carries its own word (M1 = U1 = D1)", async () => {
	const view = await mount(
		h(AskDrawer, {
			frontend: frontend([radioAsk, settled("declined", "a-declined")]),
			scope: "session",
		}),
	);
	const header = view.container.querySelector("[data-lo-ask-settled]");
	assert.ok(header, "the section renders for one settled ask");
	const text = header.textContent ?? "";
	assert.ok(
		text.includes("Settled"),
		"the section is still headed by the boundary label",
	);
	/*
	 * AND THE COUNT IS NOT RESTATED HERE (design round 1, D2 = UX round 1, U4): the
	 * `Settled · N` filter chip ~190px above owns the number, and under the `Settled`
	 * filter the group's heading is not drawn at all, because there is no pending half
	 * for it to separate from. Both halves of that are asserted where they are facts
	 * about the render (`ask-panel.tsx`); what this file can pin is that the heading no
	 * longer carries a count of its own.
	 */
	assert.ok(
		!text.includes("Settled ·"),
		"the boundary label does not restate the filter chip's count",
	);
	/*
	 * THE WORD MOVED FROM THE HEADER TO THE ROW (operator ask, 2026-10-05). The
	 * section used to name its statuses in a subtitle above the list; it now prints
	 * one status CHIP per row, so the word is still asserted here - and still only
	 * the word this section can hold - but it is read off the row that carries it.
	 */
	assert.ok(
		text.includes("Declined"),
		"the one word the section holds is named, on its own row",
	);
	// The two claims the fixed legend made and could not keep: `timed out` can never
	// be in the section (the outstanding set folds it in), and a word the section
	// does not hold must not be printed.
	assert.ok(!text.includes("timed out"), "a word the section cannot hold");
	assert.ok(
		!text.toLowerCase().includes("answered"),
		"a word not in this section",
	);
	assert.ok(!text.includes("dismissed"), "a word not in this section");
	await view.unmount();
});

test("the bar counts the Pending half, and a timed-out-only drawer is settled (design D2, UX U2)", async (t) => {
	const movedOn = { ...radioAsk, ask_id: "a-moved", status: "timed_out" };
	const view = await mountFor(
		t,
		h(AskDrawer, {
			frontend: frontend([radioAsk, movedOn]),
			scope: "session",
		}),
	);
	const scope = view.container.querySelector("[data-ask-scope]");
	assert.equal(
		scope?.textContent,
		"This conversation · 1 question waiting",
		"the timed-out ask is a settled row, and settled rows are not in the title",
	);
	const lapsedOnly = await mountFor(
		t,
		h(AskDrawer, { frontend: frontend([movedOn]), scope: "session" }),
	);
	assert.equal(
		lapsedOnly.container.querySelector("[data-ask-scope]")?.textContent,
		"This conversation · All asks settled",
	);
	const pendingChip = [
		...lapsedOnly.container.querySelectorAll("[data-lo-ask-filter] button"),
	].find((b) => (b.textContent ?? "").startsWith("Pending"));
	if (!pendingChip) throw new Error("the Pending chip is not rendered");
	await act(async () => {
		pendingChip.click();
	});
	assert.equal(
		lapsedOnly.container.querySelector("[data-lo-ask-empty]")?.textContent,
		"No asks are pending. They have all settled — see Settled.",
		"the empty Pending half and the bar now say the same thing",
	);
});

/*
 * AN ASK THAT LAPSES UNDER THE READER (UX round 1 on #1116, U1, MAJOR). The card used
 * to leave the pending half on the frame that lapsed it, so the next card slid up into
 * its place: that card's one-click, irreversible Decline landed exactly where the
 * reader's pointer was, and keyboard focus fell to BODY. The lapsed card now stays in
 * its slot, read-only, until the next mount files it under Settled.
 */
test("a card that lapses while the drawer is open stays in its slot, read-only (UX U1)", async (t) => {
	const a1 = { ...radioAsk, ask_id: "a-1", created_at: TS };
	const a2 = { ...radioAsk, ask_id: "a-2", created_at: TS + 10 };
	/*
	 * Document order of the cards and of a HELD row (a card that lapsed in place,
	 * `data-lo-ask-held`); a collapsed settled row paints no card, so it is absent.
	 */
	const order = (view) =>
		[
			...view.container.querySelectorAll(
				"[data-lo-ask-row], [data-lo-ask-held]",
			),
		].map((row) =>
			row.hasAttribute("data-lo-ask-held")
				? `${row.getAttribute("data-lo-ask-held")}:held`
				: `${row.getAttribute("data-lo-ask-row")}:pending`,
		);
	const props = { scope: "session" };
	const view = await mountFor(
		t,
		h(AskDrawer, { frontend: frontend([a1, a2]), ...props }),
	);
	assert.deepEqual(order(view), ["a-1:pending", "a-2:pending"]);
	await view.rerender(
		h(AskDrawer, {
			frontend: frontend([{ ...a1, status: "timed_out" }, a2]),
			...props,
		}),
	);
	assert.deepEqual(
		order(view),
		["a-1:held", "a-2:pending"],
		"the lapsed card collapses in its own slot, above a-2, not at the bottom",
	);
	const lapsed = view.container.querySelector('[data-lo-ask-held="a-1"]');
	const header = lapsed.querySelector("button[aria-expanded]");
	assert.equal(header?.getAttribute("aria-expanded"), "false", "collapsed");
	assert.match(header?.getAttribute("aria-label") ?? "", /^Timed out - /);
	assert.ok(
		!lapsed.closest("[data-lo-ask-settled]"),
		"held in the pending half, not filed under Settled yet",
	);
	/* Opened by the reader, it is read-only: no option, no Send answer, no Decline. */
	await act(async () => {
		header.click();
	});
	assert.equal(
		lapsed.querySelectorAll("button[data-ask-option]:not([disabled])").length,
		0,
		"held, but read-only: no enabled option",
	);
	assert.ok(
		![...lapsed.querySelectorAll("button")].some((b) =>
			["Send answer", "Decline"].includes(b.textContent ?? ""),
		),
		"no Send answer or Decline on the held row",
	);
	/* The next open of the drawer files it with the settled rows. */
	const reopened = await mountFor(
		t,
		h(AskDrawer, {
			frontend: frontend([{ ...a1, status: "timed_out" }, a2]),
			...props,
		}),
	);
	assert.deepEqual(order(reopened), ["a-2:pending"], "nothing is held");
	assert.ok(
		reopened.container.querySelector("[data-lo-ask-settled]"),
		"the lapsed ask is a collapsed settled row on the next open",
	);
});

test("focus inside a card that lapses stays on that card, never on BODY (UX U1)", async (t) => {
	const a1 = { ...radioAsk, ask_id: "a-1", created_at: TS };
	const a2 = { ...radioAsk, ask_id: "a-2", created_at: TS + 10 };
	const props = { scope: "session" };
	const view = await mountFor(
		t,
		h(AskDrawer, { frontend: frontend([a1, a2]), ...props }),
	);
	const option = view.container.querySelector(
		'[data-lo-ask-row="a-1"] [data-ask-option="production"]',
	);
	option.focus();
	assert.equal(document.activeElement, option);
	await view.rerender(
		h(AskDrawer, {
			frontend: frontend([{ ...a1, status: "timed_out" }, a2]),
			...props,
		}),
	);
	const active = document.activeElement;
	assert.notEqual(active, document.body, "focus must not fall to BODY");
	const header = view.container.querySelector(
		'[data-lo-ask-held="a-1"] button[aria-expanded]',
	);
	assert.equal(
		active,
		header,
		`focus lands on the lapsed row's own header, got ${active?.outerHTML?.slice(0, 80)}`,
	);
	assert.ok(
		!view.container.querySelector('[data-lo-ask-row="a-2"]').contains(active),
		"never on the next ask's controls",
	);
});

/*
 * THE HELD SLOT KEEPS THE CARD'S HEIGHT (agent review round 2 on #1116, M1 = QA Q-3).
 * Collapsing the held card to its 32px header still slid everything below it up by the
 * card's height less the header's, and when the lapsing card had one more option row than
 * the next one that shift put the next card's live Decline exactly under the old Decline
 * point (QA: `onDecline("a-2")` fired). The slot now reserves the card's last measured
 * height until the next mount, header at the top, so nothing below it moves.
 *
 * jsdom has no layout, so the card's height is STUBBED per option count and the
 * assertion is on the reservation itself: a slot whose min-height equals the card it
 * replaced cannot move anything below it. The real-layout half (the next card's buttons
 * at the same point, and nothing actionable under the old Decline) is the Chrome rig's
 * measurement in the PR thread.
 */
const optionAsk = (id, count, at) => ({
	...radioAsk,
	ask_id: id,
	created_at: at,
	questions: [
		{
			id: "target",
			question: `Question ${id}?`,
			options: Array.from({ length: count }, (_, i) => ({
				label: `${id}-opt-${i + 1}`,
			})),
		},
	],
});
const cardHeight = (options) => 120 + 46 * options;
const stubCardLayout = (t) => {
	const proto = window.HTMLElement.prototype;
	const original = proto.getBoundingClientRect;
	proto.getBoundingClientRect = function () {
		const id = this.getAttribute?.("data-lo-ask-row");
		if (id !== null && id !== undefined) {
			const options = this.querySelectorAll("[data-ask-option]").length;
			const height = cardHeight(options);
			return {
				x: 0,
				y: 0,
				top: 0,
				left: 0,
				width: 536,
				height,
				right: 536,
				bottom: height,
			};
		}
		return original.call(this);
	};
	t.after(() => {
		proto.getBoundingClientRect = original;
	});
};

test("a held slot reserves the lapsed card's last height, so nothing below it moves (M1 = Q-3)", async (t) => {
	stubCardLayout(t);
	for (const [above, below] of [
		[3, 2],
		[4, 3],
		[3, 3],
	]) {
		const a1 = optionAsk("a-1", above, TS);
		const a2 = optionAsk("a-2", below, TS + 10);
		const view = await mountFor(
			t,
			h(AskDrawer, { frontend: frontend([a1, a2]), scope: "session" }),
		);
		await view.rerender(
			h(AskDrawer, {
				frontend: frontend([{ ...a1, status: "timed_out" }, a2]),
				scope: "session",
			}),
		);
		const slot = view.container.querySelector('[data-lo-ask-held="a-1"]');
		if (!slot) throw new Error(`${above}-over-${below}: no held slot`);
		assert.equal(
			slot.style.minHeight,
			`${cardHeight(above)}px`,
			`${above}-over-${below}: the slot reserves the card's own height`,
		);
		assert.match(
			slot.firstElementChild
				?.querySelector("button[aria-expanded]")
				?.getAttribute("aria-label") ?? "",
			/^Timed out - Question a-1\?/,
			`${above}-over-${below}: the collapsed header sits at the top of the slot`,
		);
		assert.equal(
			slot.nextElementSibling?.getAttribute("data-lo-ask-row"),
			"a-2",
			`${above}-over-${below}: the next card follows the reserved slot directly`,
		);
	}
});

test("a filter press releases every hold, and a lapse under Pending leaves only an aria-hidden spacer (m1 = U4)", async (t) => {
	stubCardLayout(t);
	const a1 = optionAsk("a-1", 3, TS);
	const a2 = optionAsk("a-2", 2, TS + 10);
	const props = { scope: "session" };
	const chip = (view, name) => {
		const found = [
			...view.container.querySelectorAll("[data-lo-ask-filter] button"),
		].find((b) => (b.textContent ?? "").startsWith(name));
		if (!found) throw new Error(`no ${name} chip`);
		return found;
	};
	const press = async (view, name) => {
		const target = chip(view, name);
		await act(async () => {
			target.click();
		});
	};
	const view = await mountFor(
		t,
		h(AskDrawer, { frontend: frontend([a1, a2]), ...props }),
	);
	await press(view, "Pending");
	await view.rerender(
		h(AskDrawer, {
			frontend: frontend([{ ...a1, status: "timed_out" }, a2]),
			...props,
		}),
	);
	assert.equal(
		view.container.querySelector("[data-lo-ask-held]") === null,
		true,
		"no held ROW is drawn under Pending: it is not a pending ask",
	);
	const spacer = view.container.querySelector('[data-lo-ask-spacer="a-1"]');
	if (!spacer) throw new Error("no spacer holds the lapsed card's slot");
	assert.equal(spacer.getAttribute("aria-hidden"), "true");
	assert.equal(spacer.textContent, "", "the spacer says and offers nothing");
	assert.equal(spacer.style.minHeight, `${cardHeight(3)}px`);
	assert.equal(
		spacer.nextElementSibling?.getAttribute("data-lo-ask-row"),
		"a-2",
		"the still-pending card keeps its place under the spacer",
	);
	assert.equal(
		view.container.querySelector("[data-lo-ask-empty]") === null,
		true,
		"Pending is not empty, so no sentence is inserted above a-2",
	);
	assert.equal(chip(view, "Pending").textContent, "Pending · 1");
	/* The last pending ask lapses too: Pending is truly 0, so the sentence is owed. */
	await view.rerender(
		h(AskDrawer, {
			frontend: frontend([
				{ ...a1, status: "timed_out" },
				{ ...a2, status: "timed_out" },
			]),
			...props,
		}),
	);
	assert.equal(
		view.container.querySelector("[data-lo-ask-empty]")?.textContent,
		"No asks are pending. They have all settled — see Settled.",
	);
	/* A deliberate press is the reader's own act: it releases every hold. */
	await press(view, "Settled");
	await press(view, "Pending");
	assert.equal(
		view.container.querySelectorAll("[data-lo-ask-spacer], [data-lo-ask-held]")
			.length,
		0,
		"after a filter press nothing is held",
	);
	assert.equal(
		view.container.querySelector("[data-lo-ask-empty]")?.textContent,
		"No asks are pending. They have all settled — see Settled.",
	);
	await press(view, "All");
	assert.equal(
		view.container.querySelectorAll("[data-lo-ask-settled] [data-lo-ask-row]")
			.length +
			view.container.querySelectorAll(
				"[data-lo-ask-settled] button[aria-expanded]",
			).length,
		2,
		"under All both asks are filed under Settled, where the counts already put them",
	);
	/* Pressing the filter that is already selected releases too. */
	const again = await mountFor(
		t,
		h(AskDrawer, { frontend: frontend([a1, a2]), ...props }),
	);
	await again.rerender(
		h(AskDrawer, {
			frontend: frontend([{ ...a1, status: "timed_out" }, a2]),
			...props,
		}),
	);
	assert.ok(again.container.querySelector('[data-lo-ask-held="a-1"]') !== null);
	await press(again, "All");
	assert.equal(
		again.container.querySelector("[data-lo-ask-held]") === null,
		true,
		"a press on the selected chip is still the reader's act",
	);
});

test("focus in a card that lapses under Pending lands on the Pending chip, never on BODY", async (t) => {
	const a1 = optionAsk("a-1", 3, TS);
	const a2 = optionAsk("a-2", 2, TS + 10);
	const props = { scope: "session" };
	const view = await mountFor(
		t,
		h(AskDrawer, { frontend: frontend([a1, a2]), ...props }),
	);
	const pending = [
		...view.container.querySelectorAll("[data-lo-ask-filter] button"),
	].find((b) => (b.textContent ?? "").startsWith("Pending"));
	await act(async () => {
		pending.click();
	});
	const option = view.container.querySelector(
		'[data-lo-ask-row="a-1"] [data-ask-option="a-1-opt-2"]',
	);
	option.focus();
	assert.ok(document.activeElement === option, "the option holds focus");
	await view.rerender(
		h(AskDrawer, {
			frontend: frontend([{ ...a1, status: "timed_out" }, a2]),
			...props,
		}),
	);
	const active = document.activeElement;
	assert.ok(active !== document.body, "focus must not fall to BODY");
	assert.equal(
		active?.textContent,
		"Pending · 1",
		`focus lands on the filter the reader chose, got ${active?.outerHTML?.slice(0, 80)}`,
	);
});

test("an answer in progress on a card that lapses is announced as not sent (UX U5)", async (t) => {
	const a1 = optionAsk("a-1", 3, TS);
	const a2 = optionAsk("a-2", 2, TS + 10);
	const props = { scope: "session", onDraftChange: () => undefined };
	const note = (view) =>
		view.container.querySelector("[data-lo-ask-lapse-note]");
	const drafted = await mountFor(
		t,
		h(AskDrawer, {
			frontend: frontend([a1, a2]),
			drafts: { "a-1": { target: ["use blu"] } },
			...props,
		}),
	);
	assert.equal(note(drafted)?.textContent, "", "the region is mounted empty");
	await drafted.rerender(
		h(AskDrawer, {
			frontend: frontend([{ ...a1, status: "timed_out" }, a2]),
			drafts: { "a-1": { target: ["use blu"] } },
			...props,
		}),
	);
	assert.equal(
		note(drafted)?.textContent,
		"That question timed out; your answer was not sent.",
	);
	const blank = await mountFor(
		t,
		h(AskDrawer, { frontend: frontend([a1, a2]), ...props }),
	);
	await blank.rerender(
		h(AskDrawer, {
			frontend: frontend([{ ...a1, status: "timed_out" }, a2]),
			...props,
		}),
	);
	assert.equal(
		note(blank)?.textContent,
		"",
		"a card with nothing typed or picked loses nothing, so nothing is said",
	);
});

test("the session drawer is remounted per conversation, so a hold never crosses one (UX U6)", async () => {
	/*
	 * The hold lives for the panel's mount. The session drawer is mounted inside
	 * `ChatContent`, which renders only inside `SessionPanel`, and the page keys that by
	 * the conversation's identity - so a switch is an unmount and a mount, and A -> B -> A
	 * files a lapsed A ask under Settled. `ChatPage` cannot be mounted in a node test, so
	 * the chain is pinned by source.
	 */
	const { readFileSync } = await import("node:fs");
	const page = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	const panelStart = page.indexOf("function SessionPanel(");
	const pageStart = page.indexOf("export function ChatPage(");
	const content = page.indexOf("<ChatContent", panelStart);
	assert.ok(
		panelStart !== -1 && content > panelStart && content < pageStart,
		"ChatContent renders inside SessionPanel",
	);
	assert.match(
		page.slice(pageStart),
		/<SessionPanel\s+key=\{identity\}/,
		"SessionPanel is keyed by the conversation's identity",
	);
	assert.match(
		page.slice(pageStart),
		/const identity = panelIdentityFor\(draftKey, id\);/,
		"and that identity is the conversation (session id, else draft key)",
	);
	const chat = readFileSync(
		"src/renderer/src/features/chat/components/chat-content.tsx",
		"utf8",
	);
	assert.ok(
		chat.includes("<AskDrawer"),
		"ChatContent mounts the session drawer",
	);
});

test("an answer that is not one of the labels is DRAWN as Other (design D2)", async (t) => {
	/*
	 * A draft value no option row could have written. The card's own `Other` field writes
	 * the typed text into the question's draft (the retired composer routing used to), so
	 * it arrives as a plain string - and the card has to SHOW it as the user's own answer
	 * rather than draw an empty group beside a question that is already answered.
	 *
	 * What changed with the explicit `Other` row: the value is no longer a separate
	 * readout row keyed by its text (`data-ask-option-other="prod"`); the trailing
	 * `Other` row IS that readout. It mounts selected, with the field open and holding
	 * the text, and takes no focus (the full matrix is `ask-other.test.mjs`).
	 * `mountFor`, not `mount`: a failing assertion before a manual unmount leaves the
	 * drawer's clock running and the file waits out its whole bound.
	 */
	const view = await mountFor(
		t,
		h(AskDrawer, {
			frontend: frontend([radioAsk]),
			scope: "session",
			drafts: { "a-7f3c": { target: ["prod"] } },
			onDraftChange: () => undefined,
		}),
	);
	const row = view.container.querySelector("[data-ask-option-other]");
	assert.ok(row, "the free-form answer is on the card");
	assert.equal(row.getAttribute("role"), "radio");
	assert.equal(row.getAttribute("aria-checked"), "true");
	assert.ok(
		(row.textContent ?? "").includes("Other"),
		"and it is marked as the other kind",
	);
	assert.equal(
		view.container.querySelector("textarea[data-ask-other]")?.value,
		"prod",
		"the value is shown in the field the row opened",
	);
	assert.equal(
		document.activeElement,
		document.body,
		"and mounting it took no focus",
	);
	// The option rows are NOT selected: the value came from elsewhere, and the card
	// says so rather than showing an empty group beside a question already answered.
	const production = view.container.querySelector(
		'[data-ask-option="production"]',
	);
	assert.equal(production?.getAttribute("aria-checked"), "false");
});

test("the recommendation survives the selection moving (operator ask, 2026-10-04)", async () => {
	// The recommendation is a mark of its OWN, and the selection is the draft's
	// ground plus its drawn radio. The two must be readable at once, and the
	// reason is the wire's own shape: the harness hoists the recommended option to
	// index 0, so the two coincide until the user clicks something else - and a
	// mark that were the selection's twin would be ERASED by the first click on
	// the alternative the user is choosing against.
	//
	// THE FIXTURE CARRIES THE WIRE'S OWN SHAPE (agent review round 1, R1-1): the
	// recommendation is the QUESTION's integer index, the option object is exactly
	// `{label, description}`. The earlier version of this case put a
	// `recommended: true` flag on the option - a key no producer emits (the core'
	// `AskOption` forbids extras) - so it proved a story, not the surface, while
	// the drawer read a field that was never there.
	const recommended = {
		...radioAsk,
		questions: [
			{
				id: "target",
				question: "Which environment?",
				recommended: 0,
				options: [{ label: "staging" }, { label: "production" }],
			},
		],
	};
	const view = await mount(
		h(AskDrawer, {
			frontend: frontend([recommended]),
			scope: "session",
			// The draft sits on the option the model did NOT recommend.
			drafts: { "a-7f3c": { target: ["production"] } },
			onDraftChange: () => undefined,
		}),
	);
	const staging = view.container.querySelector('[data-ask-option="staging"]');
	const production = view.container.querySelector(
		'[data-ask-option="production"]',
	);
	assert.equal(staging?.getAttribute("aria-checked"), "false");
	assert.equal(production?.getAttribute("aria-checked"), "true");
	const stagingText = staging?.textContent ?? "";
	assert.ok(
		stagingText.includes("Recommended"),
		"the advice is still on the row after the selection moved",
	);
	// Not colour alone: the glyph is what survives a colour-blind reader, a
	// greyscale screenshot and the terminal's own badge.
	assert.ok(stagingText.includes("▸"), "the mark carries its glyph");
	// The label is bolded where it is recommended - the half of the signal that
	// survives a reader who skims past the badge.
	assert.ok(
		(staging?.querySelector(".font-semibold")?.textContent ?? "").includes(
			"staging",
		),
		"the recommended option's label is emphasised",
	);
	assert.equal(
		production?.querySelector(".font-semibold"),
		null,
		"the selected row is not the recommended one, and must not borrow its weight",
	);
	assert.ok(!(production?.textContent ?? "").includes("Recommended"));
	await view.unmount();
});

/*
 * THE INDEX IS VALIDATED, NOT CLAMPED (agent review round 1, R1-1).
 *
 * The dock card has proven this range since the ask-picker contract landed
 * (`ask-options.test.mjs`: "recommended is optional, and marks only a real
 * index"). The drawer card had no such case, which is half of why its dead
 * `option.recommended` read survived every rig in the repo - so the same range
 * is pinned here, on the shape the queued-ask wire actually sends.
 *
 * `bad` is every value that must badge NOTHING rather than the wrong row: absent,
 * null, out of range, negative, a float, and the two malformed values a
 * truthiness read would have accepted (the STRING "0", and `NaN`). A real index
 * still marks exactly its own row and no other.
 */
test("the drawer badges nothing for an index that is not a real row", async () => {
	const marked = async (recommended) => {
		const view = await mount(
			h(AskDrawer, {
				frontend: frontend([
					{
						...radioAsk,
						questions: [
							{
								id: "target",
								question: "Which environment?",
								options: [
									{ label: "staging" },
									{ label: "production" },
									{ label: "sandbox" },
								],
								...(recommended === undefined ? {} : { recommended }),
							},
						],
					},
				]),
				scope: "session",
				onDraftChange: () => undefined,
			}),
		);
		const labels = ["staging", "production", "sandbox"];
		const badged = labels.filter((label) =>
			(
				view.container.querySelector(`[data-ask-option="${label}"]`)
					?.textContent ?? ""
			).includes("Recommended"),
		);
		const bolded = labels.filter((label) =>
			Boolean(
				view.container
					.querySelector(`[data-ask-option="${label}"]`)
					?.querySelector(".font-semibold"),
			),
		);
		await view.unmount();
		return { badged, bolded };
	};

	for (const bad of [undefined, null, 99, -1, 1.5, "0", Number.NaN]) {
		const { badged, bolded } = await marked(bad);
		assert.deepEqual(
			badged,
			[],
			`recommended ${String(bad)} must not badge a row`,
		);
		assert.deepEqual(
			bolded,
			[],
			`recommended ${String(bad)} must not bold a row`,
		);
	}

	// And a REAL index that is not 0 still marks exactly the row it names - which
	// is what rules out a "truthiness" read resolving it to index 0.
	const real = await marked(2);
	assert.deepEqual(real.badged, ["sandbox"]);
	assert.deepEqual(real.bolded, ["sandbox"]);
});
