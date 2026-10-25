import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE DISMISS CHOOSER'S BEHAVIOUR, DRIVEN THROUGH THE SHIPPED PANEL.
 *
 * `ask-dismiss.test.mjs` pins the wire, the capability gate and the static copy.
 * This file pins what only a mounted card can show - the states UX round 1 measured
 * and design round 1 measured on a frame:
 *
 *  - D1: while the chooser is open it is the only live intent. The action row is
 *    UNMOUNTED, not disabled, so a misclick cannot send the answer the reader had
 *    stepped away from.
 *  - U2: Cancel returns the keyboard to the trigger it re-mounts (the layout effect,
 *    not the handler that measures the trigger before it exists), and a landed
 *    dismissal hands it to the next card's first control, or to the list when no
 *    card is left.
 *  - U3/U6: the pressed reason says what is in flight, and a refusal keeps the
 *    chooser and the chosen reason on screen so the reader does not re-pick.
 *  - U7: Escape inside the chooser closes the chooser, not the drawer above it.
 *  - M1/N1/U1: a settled dismissal names its reason from the wire, draws no answer
 *    frame, and prints the sentence once.
 *
 * The panel's two containers (the session drawer and the fleet pane) are not
 * mounted here; the gate that decides whether `onDismiss` reaches this panel is
 * pinned in `ask-dismiss.test.mjs`. jsdom's `document.activeElement` is the same
 * fact the drawer's own focus moves read; layout and painting are not claimed.
 */

const bootstrap = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
for (const name of [
	"Node",
	"Element",
	"HTMLElement",
	"SVGElement",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"PointerEvent",
	"FocusEvent",
	"InputEvent",
	"DOMRect",
	"DocumentFragment",
]) {
	if (bootstrap.window[name] !== undefined)
		globalThis[name] = bootstrap.window[name];
}
for (const name of [
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
]) {
	if (typeof bootstrap.window[name] === "function")
		globalThis[name] = bootstrap.window[name].bind(bootstrap.window);
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
bootstrap.window.HTMLCanvasElement.prototype.getContext = () => null;

const { createRoot } = await import("react-dom/client");

const bundle = await build({
	stdin: {
		contents: [
			'export { AskPanel } from "./src/renderer/src/features/chat/components/asks/ask-panel";',
			'export { askQueueView } from "./src/renderer/src/features/chat/ask-queue";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});

const bundlePath = new URL("./_ask-dismiss-panel.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { AskPanel, askQueueView } = await import(bundlePath.href);
await unlink(bundlePath);

const { createElement } = React;
const NOW = 1_700_000_000_000;

const openAsk = (id, overrides = {}) => ({
	ask_id: id,
	created_at: NOW - 60_000,
	expires_at: NOW + 600_000,
	timeout_s: 900,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [
		{
			id: "q1",
			question: "Which environment?",
			options: [{ label: "staging" }],
		},
	],
	...overrides,
});

const panelElement = (asks, extra = {}) =>
	createElement(AskPanel, {
		view: askQueueView({
			asks,
			asks_open: asks.filter((ask) => ask.status === "open").length,
		}),
		nowMs: NOW,
		answering: false,
		drafts: {},
		onDraftChange: () => undefined,
		onAnswer: () => undefined,
		onDecline: () => undefined,
		...extra,
	});

async function mount(element) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const render = async (next) => {
		await act(async () => root.render(next));
	};
	await render(element);
	return {
		container,
		render,
		async unmount() {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

const rowOf = (container, id) =>
	container.querySelector(`[data-lo-ask-row="${id}"]`);
const buttonWithText = (root, text) =>
	[...root.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === text,
	);
const fire = (node, event) => {
	act(() => {
		node.dispatchEvent(event);
	});
};

test("the chooser is the only live intent, says what is in flight, and survives a refusal", async () => {
	const dismissed = [];
	const asks = [openAsk("a-1"), openAsk("a-2", { ask_id: "a-2" })];
	const rig = await mount(
		panelElement(asks, {
			onDismiss: (ask, reason) => dismissed.push([ask.ask_id, reason]),
		}),
	);
	const row = rowOf(rig.container, "a-1");
	assert.ok(
		buttonWithText(row, "Send answer"),
		"the action row is there before the press",
	);

	await act(async () => buttonWithText(row, "Dismiss…").click());

	// D1: the accent action is not on screen at all while the chooser is open.
	assert.equal(
		buttonWithText(rowOf(rig.container, "a-1"), "Send answer"),
		undefined,
		"the action row gives the chooser its place",
	);
	assert.equal(
		buttonWithText(rowOf(rig.container, "a-2"), "Send answer") !== undefined,
		true,
		"the neighbouring card is untouched",
	);
	// D2/U5: the heading sits on the quiet rung and the notes are the half that yields.
	const heading = [...rowOf(rig.container, "a-1").querySelectorAll("p")].find(
		(node) => node.textContent === "Dismiss this ask",
	);
	assert.equal(heading.className.includes("text-ink-muted"), true);
	assert.equal(heading.className.includes("text-meta"), true);
	const note = rowOf(rig.container, "a-1").querySelector(
		'[data-lo-ask-dismiss-reason="moot"] .truncate',
	);
	assert.ok(note, "the note yields before the controls do");

	const moot = rowOf(rig.container, "a-1").querySelector(
		'[data-lo-ask-dismiss-reason="moot"]',
	);
	fire(moot, new window.MouseEvent("click", { bubbles: true }));
	assert.deepEqual(dismissed, [["a-1", "moot"]]);

	// U3: the request in flight is named on the row that carries it.
	await rig.render(
		panelElement(asks, {
			onDismiss: () => undefined,
			outcomes: { "a-1": { sending: true, refused: null } },
		}),
	);
	const pressed = rowOf(rig.container, "a-1").querySelector(
		'[data-lo-ask-dismiss-reason="moot"]',
	);
	assert.equal(pressed.textContent.includes("Dismissing…"), true);

	// U6: a refusal keeps the chooser and the chosen reason visible, and shows the
	// route's sentence verbatim.
	await rig.render(
		panelElement(asks, {
			onDismiss: () => undefined,
			outcomes: {
				"a-1": {
					sending: false,
					refused: "already answered by desktop.",
					refusedByOwner: true,
				},
			},
		}),
	);
	const afterRefusal = rowOf(rig.container, "a-1");
	assert.equal(
		afterRefusal.textContent.includes("already answered by desktop."),
		true,
	);
	assert.equal(
		afterRefusal.textContent.includes(
			"Couldn't dismiss this ask — nothing was sent.",
		),
		true,
		"the band says what did not happen before the route's reason",
	);
	assert.equal(
		buttonWithText(afterRefusal, "Cancel") !== undefined,
		true,
		"the chooser is still the surface the refusal landed on",
	);
	assert.equal(
		afterRefusal
			.querySelector('[data-lo-ask-dismiss-reason="moot"]')
			.className.includes("bg-sunken"),
		true,
		"the chosen reason is still marked",
	);
	await rig.unmount();
});

test("cancel returns the keyboard to the trigger it re-mounts", async () => {
	const rig = await mount(
		panelElement([openAsk("a-1")], { onDismiss: () => undefined }),
	);
	const row = rowOf(rig.container, "a-1");
	await act(async () => buttonWithText(row, "Dismiss…").click());
	await act(async () => buttonWithText(row, "Cancel").click());
	const trigger = buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…");
	assert.equal(document.activeElement, trigger, "focus is back on the door");
	await rig.unmount();
});

test("escape closes the chooser and nothing above it", async () => {
	const rig = await mount(
		panelElement([openAsk("a-1")], { onDismiss: () => undefined }),
	);
	const row = rowOf(rig.container, "a-1");
	await act(async () => buttonWithText(row, "Dismiss…").click());
	const reason = rowOf(rig.container, "a-1").querySelector(
		'[data-lo-ask-dismiss-reason="moot"]',
	);
	assert.equal(document.activeElement, reason, "the chooser took the keyboard");
	const escapeKey = new window.KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	fire(reason, escapeKey);
	assert.equal(escapeKey.defaultPrevented, true, "the chooser claimed the key");
	const after = rowOf(rig.container, "a-1");
	assert.equal(
		buttonWithText(after, "Cancel"),
		undefined,
		"the chooser closed",
	);
	assert.equal(
		document.activeElement,
		buttonWithText(after, "Dismiss…"),
		"and the door has the keyboard",
	);
	await rig.unmount();
});

test("a landed dismissal hands the keyboard to the next card, or to the list", async () => {
	const asks = [openAsk("a-1"), openAsk("a-2", { ask_id: "a-2" })];
	const rig = await mount(panelElement(asks, { onDismiss: () => undefined }));
	await act(async () =>
		buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…").click(),
	);
	await act(async () =>
		rowOf(rig.container, "a-1")
			.querySelector('[data-lo-ask-dismiss-reason="moot"]')
			.click(),
	);
	// The row leaves the frame the wire publishes next.
	await rig.render(
		panelElement([asks[1]], {
			onDismiss: () => undefined,
			outcomes: {
				"a-1": { sending: false, refused: null, dismissed: "moot" },
			},
		}),
	);
	const next = rowOf(rig.container, "a-2");
	assert.equal(
		next.contains(document.activeElement),
		true,
		"focus moved to the card that took the slot",
	);
	assert.equal(document.activeElement.tagName, "BUTTON");

	/*
	 * The last card: the composer takes it, not the list. The list is the element the
	 * drawer's #864 auto-close removes in the NEXT commit (QA round 2, Q-1), so landing
	 * there loses the keyboard to BODY one frame later - which is what the reader saw.
	 */
	const composer = document.createElement("textarea");
	composer.setAttribute("aria-label", "Message");
	document.body.append(composer);
	await act(async () =>
		buttonWithText(rowOf(rig.container, "a-2"), "Dismiss…").click(),
	);
	await act(async () =>
		rowOf(rig.container, "a-2")
			.querySelector('[data-lo-ask-dismiss-reason="moot"]')
			.click(),
	);
	await rig.render(
		panelElement([], {
			onDismiss: () => undefined,
			outcomes: {
				"a-1": { sending: false, refused: null, dismissed: "moot" },
				"a-2": { sending: false, refused: null, dismissed: "moot" },
			},
		}),
	);
	assert.equal(
		document.activeElement,
		composer,
		"the composer takes the keyboard when no card is left",
	);
	composer.remove();
	await rig.unmount();
});

test("with no composer in reach, the empty panel keeps the keyboard on its list", async () => {
	const asks = [openAsk("a-1")];
	const rig = await mount(panelElement(asks, { onDismiss: () => undefined }));
	await act(async () =>
		buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…").click(),
	);
	await act(async () =>
		rowOf(rig.container, "a-1")
			.querySelector('[data-lo-ask-dismiss-reason="moot"]')
			.click(),
	);
	await rig.render(
		panelElement([], {
			onDismiss: () => undefined,
			outcomes: {
				"a-1": { sending: false, refused: null, dismissed: "moot" },
			},
		}),
	);
	assert.equal(
		document.activeElement,
		rig.container.querySelector("[data-lo-ask-panel]"),
		"the fleet pane, which has no composer, lands on the list",
	);
	await rig.unmount();
});

test("the response hands the keyboard on before the frame removes the card", async () => {
	const composer = document.createElement("textarea");
	composer.setAttribute("aria-label", "Message");
	document.body.append(composer);
	const asks = [openAsk("a-1")];
	const rig = await mount(panelElement(asks, { onDismiss: () => undefined }));
	await act(async () =>
		buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…").click(),
	);
	await act(async () =>
		rowOf(rig.container, "a-1")
			.querySelector('[data-lo-ask-dismiss-reason="moot"]')
			.click(),
	);
	await rig.render(
		panelElement(asks, {
			onDismiss: () => undefined,
			outcomes: { "a-1": { sending: true, refused: null } },
		}),
	);
	/*
	 * THE GAP UX ROUND 3 MEASURED: the response lands, the chooser and the focused
	 * reason unmount, and the card stays until the next ask-state frame ~1.2 s later.
	 * Sampled on the response frame, with the card still drawn.
	 */
	await rig.render(
		panelElement(asks, {
			onDismiss: () => undefined,
			outcomes: { "a-1": { sending: false, refused: null, dismissed: "moot" } },
		}),
	);
	assert.equal(
		rowOf(rig.container, "a-1") !== null,
		true,
		"the card is still drawn: this is the delayed-frame case",
	);
	assert.equal(
		document.activeElement,
		composer,
		"the response hands off at once",
	);
	assert.notEqual(document.activeElement, document.body);
	await rig.render(
		panelElement([], {
			onDismiss: () => undefined,
			outcomes: { "a-1": { sending: false, refused: null, dismissed: "moot" } },
		}),
	);
	assert.equal(document.activeElement, composer);
	composer.remove();
	await rig.unmount();
});

test("the response hands the next card's first control the keyboard, before the frame", async () => {
	const asks = [openAsk("a-1"), openAsk("a-2", { ask_id: "a-2" })];
	const rig = await mount(panelElement(asks, { onDismiss: () => undefined }));
	await act(async () =>
		buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…").click(),
	);
	await act(async () =>
		rowOf(rig.container, "a-1")
			.querySelector('[data-lo-ask-dismiss-reason="moot"]')
			.click(),
	);
	await rig.render(
		panelElement(asks, {
			onDismiss: () => undefined,
			outcomes: { "a-1": { sending: false, refused: null, dismissed: "moot" } },
		}),
	);
	const next = rowOf(rig.container, "a-2");
	assert.equal(next.contains(document.activeElement), true);
	assert.equal(document.activeElement.tagName, "BUTTON");
	await rig.unmount();
});

test("a dismissal that loses the race to another surface still hands off", async () => {
	const composer = document.createElement("textarea");
	composer.setAttribute("aria-label", "Message");
	document.body.append(composer);
	const asks = [openAsk("a-1")];
	const rig = await mount(panelElement(asks, { onDismiss: () => undefined }));
	await act(async () =>
		buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…").click(),
	);
	await act(async () =>
		rowOf(rig.container, "a-1")
			.querySelector('[data-lo-ask-dismiss-reason="moot"]')
			.click(),
	);
	// Another surface settles the ask: the row leaves while this press is in flight.
	await rig.render(
		panelElement([], {
			onDismiss: () => undefined,
			outcomes: { "a-1": { sending: true, refused: null } },
		}),
	);
	assert.equal(document.activeElement, composer, "the departure hands off");
	// The held request then returns its 409.
	await rig.render(
		panelElement([], {
			onDismiss: () => undefined,
			outcomes: {
				"a-1": {
					sending: false,
					refused: "already answered by desktop.",
					refusedByOwner: true,
				},
			},
		}),
	);
	assert.equal(
		document.activeElement,
		composer,
		"the late refusal moves nothing",
	);
	assert.notEqual(document.activeElement, document.body);
	composer.remove();
	await rig.unmount();
});

test("a refusal that lands before the departure does not lose the keyboard either", async () => {
	const composer = document.createElement("textarea");
	composer.setAttribute("aria-label", "Message");
	document.body.append(composer);
	const asks = [openAsk("a-1")];
	const rig = await mount(panelElement(asks, { onDismiss: () => undefined }));
	await act(async () =>
		buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…").click(),
	);
	await act(async () =>
		rowOf(rig.container, "a-1")
			.querySelector('[data-lo-ask-dismiss-reason="moot"]')
			.click(),
	);
	const refused = panelElement(asks, {
		onDismiss: () => undefined,
		outcomes: {
			"a-1": {
				sending: false,
				refused: "already answered by desktop.",
				refusedByOwner: true,
			},
		},
	});
	await rig.render(refused);
	// The other surface's frame removes the row after the refusal.
	await rig.render(
		panelElement([], {
			onDismiss: () => undefined,
			outcomes: {
				"a-1": {
					sending: false,
					refused: "already answered by desktop.",
					refusedByOwner: true,
				},
			},
		}),
	);
	assert.equal(document.activeElement, composer);
	composer.remove();
	await rig.unmount();
});

test("a settled dismissal names its reason and draws no answer frame", async () => {
	const rig = await mount(
		panelElement(
			[
				openAsk("a-1", {
					status: "dismissed",
					dismissed_reason: "moot",
				}),
			],
			{ onDismiss: () => undefined },
		),
	);
	const disclosure = rig.container.querySelector(
		'[data-lo-ask-panel] button[aria-expanded="false"]',
	);
	assert.ok(disclosure, "the settled row is collapsed");
	await act(async () => disclosure.click());
	const text = rig.container.querySelector("[data-lo-ask-panel]").textContent;
	assert.equal(text.includes("Dismissed — no longer needed"), true);
	assert.equal(text.includes("No answer given"), false);

	await rig.render(
		panelElement([openAsk("a-1", { status: "dismissed" })], {
			onDismiss: () => undefined,
		}),
	);
	const older = rig.container.querySelector(
		'[data-lo-ask-panel] button[aria-expanded="false"]',
	);
	if (older) await act(async () => older.click());
	const olderText = rig.container.querySelector(
		"[data-lo-ask-panel]",
	).textContent;
	assert.equal(olderText.includes("Dismissed — no reply was sent"), true);

	// The wire and the local outcome agree: one sentence, not two.
	await rig.render(
		panelElement(
			[openAsk("a-1", { status: "dismissed", dismissed_reason: "moot" })],
			{
				onDismiss: () => undefined,
				outcomes: {
					"a-1": { sending: false, refused: null, dismissed: "moot" },
				},
			},
		),
	);
	const again = rig.container.querySelector(
		'[data-lo-ask-panel] button[aria-expanded="false"]',
	);
	if (again) await act(async () => again.click());
	const agree = rig.container.querySelector("[data-lo-ask-panel]").textContent;
	assert.equal(
		agree.split("Dismissed — no longer needed").length - 1,
		1,
		"the status line is the receipt",
	);
	await rig.unmount();
});

test("a single-ask dismissal keeps the keyboard through the panel's unmount", async () => {
	const composer = document.createElement("textarea");
	composer.setAttribute("aria-label", "Message");
	document.body.append(composer);
	const asks = [openAsk("a-1")];
	const rig = await mount(panelElement(asks, { onDismiss: () => undefined }));
	await act(async () =>
		buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…").click(),
	);
	const reason = rowOf(rig.container, "a-1").querySelector(
		'[data-lo-ask-dismiss-reason="moot"]',
	);
	await act(async () => reason.click());
	// In flight: the pressed control keeps focus (aria-disabled, not disabled).
	await rig.render(
		panelElement(asks, {
			onDismiss: () => undefined,
			outcomes: { "a-1": { sending: true, refused: null } },
		}),
	);
	assert.equal(
		document.activeElement,
		rowOf(rig.container, "a-1").querySelector(
			'[data-lo-ask-dismiss-reason="moot"]',
		),
		"the pressed reason keeps focus while the POST is in flight",
	);
	assert.equal(document.activeElement.getAttribute("aria-disabled"), "true");
	assert.equal(
		document.activeElement.hasAttribute("disabled"),
		false,
		"not a native disabled: that is what drops the element out of focus",
	);
	assert.notEqual(document.activeElement, document.body);
	// The frame that empties the queue: the composer is handed the keyboard before
	// the panel can unmount, and the unmount below must not take it away.
	await rig.render(
		panelElement([], {
			onDismiss: () => undefined,
			outcomes: {
				"a-1": { sending: false, refused: null, dismissed: "moot" },
			},
		}),
	);
	assert.equal(document.activeElement, composer);
	await rig.unmount();
	assert.equal(
		document.activeElement,
		composer,
		"the panel's unmount leaves the keyboard where it landed, not on the body",
	);
	composer.remove();
});

test("a refusal drops the hand-off, so a later departure cannot steal focus", async () => {
	const composer = document.createElement("textarea");
	composer.setAttribute("aria-label", "Message");
	document.body.append(composer);
	const asks = [openAsk("a-1"), openAsk("a-2")];
	const rig = await mount(panelElement(asks, { onDismiss: () => undefined }));
	await act(async () =>
		buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…").click(),
	);
	await act(async () =>
		rowOf(rig.container, "a-1")
			.querySelector('[data-lo-ask-dismiss-reason="moot"]')
			.click(),
	);
	await rig.render(
		panelElement(asks, {
			onDismiss: () => undefined,
			outcomes: {
				"a-1": {
					sending: false,
					refused: "already answered by desktop.",
					refusedByOwner: true,
				},
			},
		}),
	);
	const band = rowOf(rig.container, "a-1").querySelector("output");
	assert.equal(
		band.textContent,
		"Couldn't dismiss this ask — nothing was sent. already answered by desktop.",
	);
	// The reader gives up and goes back to the composer; the row then leaves for
	// another surface's answer. Focus must not be pulled back into the panel.
	composer.focus();
	await rig.render(
		panelElement([asks[1]], {
			onDismiss: () => undefined,
			outcomes: {
				"a-1": {
					sending: false,
					refused: "already answered by desktop.",
					refusedByOwner: true,
				},
			},
		}),
	);
	assert.equal(document.activeElement, composer);
	composer.remove();
	await rig.unmount();
});

test("a transport refusal says what did not happen without repeating the wire", async () => {
	const asks = [openAsk("a-1")];
	const rig = await mount(panelElement(asks, { onDismiss: () => undefined }));
	await act(async () =>
		buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…").click(),
	);
	await act(async () =>
		rowOf(rig.container, "a-1")
			.querySelector('[data-lo-ask-dismiss-reason="moot"]')
			.click(),
	);
	await rig.render(
		panelElement(asks, {
			onDismiss: () => undefined,
			outcomes: {
				"a-1": {
					sending: false,
					refused: "Desktop controls could not reach the backend process.",
				},
			},
		}),
	);
	const band = rowOf(rig.container, "a-1").querySelector("output");
	assert.equal(
		band.textContent,
		"Couldn't dismiss this ask — nothing was sent.",
	);
	await rig.unmount();
});

test("escape is claimed at the card, so a click elsewhere in it does not lose the panel", async () => {
	const asks = [openAsk("a-1")];
	const rig = await mount(panelElement(asks, { onDismiss: () => undefined }));
	await act(async () =>
		buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…").click(),
	);
	const option = rowOf(rig.container, "a-1").querySelector(
		"button[data-ask-option]",
	);
	assert.ok(option, "the card still holds another control");
	await act(async () => option.focus());
	const key = new KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	act(() => {
		option.dispatchEvent(key);
	});
	assert.equal(key.defaultPrevented, true);
	assert.equal(
		rowOf(rig.container, "a-1").querySelector("[data-lo-ask-dismiss-reason]"),
		null,
	);
	assert.equal(
		buttonWithText(rowOf(rig.container, "a-1"), "Dismiss…") !== undefined,
		true,
	);
	await rig.unmount();
});

test("an unknown dismissed_reason falls back to the no-reply sentence", async () => {
	const rig = await mount(
		panelElement(
			[
				openAsk("a-1", {
					status: "dismissed",
					dismissed_reason: "not-a-reason",
				}),
			],
			{ onDismiss: () => undefined },
		),
	);
	const disclosure = rig.container.querySelector(
		'[data-lo-ask-panel] button[aria-expanded="false"]',
	);
	assert.ok(disclosure);
	await act(async () => disclosure.click());
	const text = rig.container.querySelector("[data-lo-ask-panel]").textContent;
	assert.equal(text.includes("Dismissed — no reply was sent"), true);
	assert.equal(text.includes("no longer needed"), false);
	await rig.unmount();
});
