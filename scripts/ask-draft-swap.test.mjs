import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE ASK-MODE DRAFT SWAP, driven through the shipped components and the shipped
 * store.
 *
 * Why this file exists: the converged BLOCKER of round 1 was invisible to every
 * rig in the repo. `ask-queue.test.mjs` can assert the read model but not a
 * render; the composer suite predates these modules; and the store's own text
 * tests replace the composer with a stand-in. So the defect that mattered most -
 * a chat draft being submitted as the agent's ANSWER, and an answer being posted
 * as a chat message - had no possible signal in CI.
 *
 * WHAT THIS PINS
 *
 *  1. The door: a mount into a queue that is published but EMPTY must NOT fire the
 *     drawer's close door (a settle from the terminal or the phone, or a timeout)
 *     - reachable on every conversation switch, and firing there destroyed a
 *     draft, because the caller's swap moved the chat text into the ask buffer and
 *     wrote the empty ask buffer into the box. The old shape of this test also
 *     pinned a door that said "collapsed" to an already-collapsed page; there is
 *     no collapsed mount any more (the drawer is mounted only while open, and the
 *     flag that decides it is the store's), so that half is gone with the state it
 *     described rather than weakened.
 *  2. The authority: the swap has to reach the BOX, and the store's revision is
 *     what the composer mirrors on. `setCurrentInput` (the keystroke writer) must
 *     not bump it; `setComposerText` (the app's writer) must.
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
	packages: "external",
	jsx: "automatic",
	// The renderer's own alias, so the bundle reads the real modules rather than a
	// stand-in - the same alias the sibling component rigs declare.
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
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

/* --------------------------------------------------------------- the door ---- */

test("a MOUNT into an empty-but-published queue does not fire the close door", async () => {
	// Reachable on every pane mount: `SessionPanel` is keyed by conversation, so
	// this is every conversation switch, and the caller's swap would empty the box
	// of a draft retained for the conversation being opened.
	const calls = [];
	const view = await mount(
		h(AskDrawer, {
			frontend: frontend([]),
			scope: "session",
			onClose: () => calls.push(true),
		}),
	);
	assert.deepEqual(calls, [], "a mount is not an emptying");
	await view.unmount();
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
	await view.unmount();
});

/* ---------------------------------------------------------- the authority ---- */

test("only the app's writer bumps the revision the composer mirrors on", () => {
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
	// The app's writer: this is what makes the swap reach the box at all.
	store().setComposerText(id, "answer draft");
	assert.ok(
		(store().inputByConversation[id].textRevision ?? 0) > afterKeystroke,
		"the app's writer must bump the revision, or the box never adopts the swap",
	);
	assert.equal(store().inputByConversation[id].currentInput, "answer draft");
	// An EMPTY value is an instruction here, not "no change": switching into an
	// empty ask buffer means the box must be empty.
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

test("a filter whose half is empty says so, and the boundary label goes with the boundary (design D1 = UX U2)", async () => {
	/*
	 * THE REPORTED REPRO, on the shipped panel: one open ask, press the chip whose count
	 * is zero. Before the fix the pane went blank under the chips - no empty copy at all
	 * - which reads as "there are no asks" over a queue that has one, and the drawer's
	 * own bar was still saying "1 question waiting" above it.
	 */
	const view = await mount(
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
		text.includes("Waiting or moved on"),
		"and names the half that does hold the asks, so it cannot read as an empty queue",
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
	await view.unmount();
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

test("the bar counts what the surface shows, not only what the agent waits on (UX U5)", async () => {
	const movedOn = { ...radioAsk, ask_id: "a-moved", status: "timed_out" };
	const view = await mount(
		h(AskDrawer, {
			frontend: frontend([radioAsk, movedOn]),
			scope: "session",
		}),
	);
	const scope = view.container.querySelector("[data-ask-scope]");
	assert.equal(
		scope?.textContent,
		"This conversation · 1 waiting, 1 moved on",
		"both answerable cards the drawer draws are counted",
	);
	await view.unmount();
});

test("an answer that is not one of the labels is DRAWN as Other (design D2)", async () => {
	// What the composer's door produces: `sendToAsk` writes the raw typed text into
	// the first unanswered question's draft, so the value is a string no option row
	// could have written.
	const view = await mount(
		h(AskDrawer, {
			frontend: frontend([radioAsk]),
			scope: "session",
			drafts: { "a-7f3c": { target: ["prod"] } },
			onDraftChange: () => undefined,
		}),
	);
	const row = view.container.querySelector('[data-ask-option-other="prod"]');
	assert.ok(row, "the free-form answer is on the card");
	assert.equal(row.getAttribute("role"), "radio");
	assert.equal(row.getAttribute("aria-checked"), "true");
	assert.ok(
		(row.textContent ?? "").includes("Other"),
		"and it is marked as the other kind",
	);
	// The option rows are NOT selected: the value came from elsewhere, and the card
	// says so rather than showing an empty group beside a question already answered.
	const production = view.container.querySelector(
		'[data-ask-option="production"]',
	);
	assert.equal(production?.getAttribute("aria-checked"), "false");
	await view.unmount();
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
