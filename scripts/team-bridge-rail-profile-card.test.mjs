/**
 * Rail row vs profile card: the click is the conversation, the card is a dwell.
 *
 * WHY THIS EXISTS. Operator report 2026-10-26: clicking a person in the Team
 * Bridge rail showed their profile card and never opened the conversation. The
 * whole row was the card's Radix trigger with no click action: the press focused
 * the row (focus opened the card) and Radix's click toggle consumed it. These
 * tests mount the SHIPPED rail rows and card in jsdom with the real Radix popover
 * and drive the pointer, focus and keyboard paths with mocked timers, so each
 * dwell is asserted at its boundary rather than by sleeping.
 *
 * Component state, not geometry proof: placement and the rendered frame are the
 * Storybook capture's job (`team-bridge-rail-rows.stories.tsx`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, beforeEach, mock, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";

const dom = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of [
	"window",
	"document",
	"HTMLElement",
	"Element",
	"Node",
	"SVGElement",
	"Event",
	"MouseEvent",
	"FocusEvent",
	"KeyboardEvent",
	"CustomEvent",
	"MutationObserver",
	"DOMRect",
	"navigator",
]) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key],
	});
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
/*
 * Frames ride the REAL event loop (setImmediate is never mocked below), not the
 * mocked setTimeout: node's `mock.timers.tick` drains a self-rescheduling
 * zero-delay chain without bound inside one tick, so any frame-polling loop in
 * Radix/floating-ui would spin and allocate until the memory guard killed the
 * run (measured 2026-10-26: 46 GB and 91 GB against main's card code).
 */
globalThis.requestAnimationFrame = (fn) => setImmediate(() => fn(Date.now()));
globalThis.cancelAnimationFrame = clearImmediate;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");

// The rail's one chat-sidebar import, stubbed with the shipped literal (same
// reason as `team-bridge-directory.test.mjs`: the real module drags MUI in).
const rowCurrentLiteral = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
).match(/export const rowCurrent =\s*("[^"]+")/)?.[1];
if (!rowCurrentLiteral) throw new Error("rowCurrent literal not found");

const CHAT_SIDEBAR_SEAM = /chat\/components\/chat-sidebar$/;
// The plate's photo hook, by the path the plate actually imports
// (`@shared/hooks/use-account-avatar`). The old `/^\.\/use-team-bridge-avatar$/`
// matched no import at all: the stub was inert and the "no bytes are fetched"
// claim unenforced, and this PR then deleted the export it named (agent review
// round 1, N1). Stubbing `useIdentityAvatar` keeps the isolation real.
const AVATAR_SEAM = /hooks\/use-account-avatar$/;
const ANY_SEAM = /.*/;
const bundle = await build({
	stdin: {
		contents: [
			'export {PersonRailRow, ChiefRailRow} from "./src/renderer/src/features/team-bridge/team-bridge-rail";',
			'export {TeamBridgeProfileCard} from "./src/renderer/src/features/team-bridge/team-bridge-profile-card";',
			'export {QueryClient, QueryClientProvider} from "@tanstack/react-query";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	write: false,
	jsx: "automatic",
	tsconfig: "tsconfig.app.json",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	plugins: [
		{
			name: "seams",
			setup(b) {
				b.onResolve({ filter: CHAT_SIDEBAR_SEAM }, () => ({
					path: "chat-sidebar",
					namespace: "seam",
				}));
				// Avatars are not under test; no bytes are fetched.
				b.onResolve({ filter: AVATAR_SEAM }, () => ({
					path: "avatar",
					namespace: "seam",
				}));
				b.onLoad({ filter: ANY_SEAM, namespace: "seam" }, (args) => ({
					contents:
						args.path === "avatar"
							? "export const useIdentityAvatar = () => undefined;"
							: `export const rowCurrent = ${rowCurrentLiteral};`,
					loader: "js",
				}));
			},
		},
	],
});
const file = new URL(
	`./_rail-profile-card-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(file, bundle.outputFiles[0].text);
const {
	PersonRailRow,
	ChiefRailRow,
	TeamBridgeProfileCard,
	QueryClient,
	QueryClientProvider,
} = await import(file.href);
await unlink(file);
after(() => dom.window.close());

const bea = {
	account_id: "acct_bea",
	display_label: "Bea",
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
};
const chief = {
	person: { ...bea, account_id: "acct_cos", display_label: "Atlas" },
	endpointId: "ep_1",
	agentName: "Atlas",
	paused: false,
};

beforeEach(() => {
	mock.timers.reset();
	// setInterval too: the open card's 60 s clock would otherwise be a real
	// interval that keeps the process alive after a failing assertion.
	mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
});

async function mount(element) {
	const host = document.createElement("ul");
	document.body.append(host);
	const root = createRoot(host);
	const client = new QueryClient();
	await act(async () =>
		root.render(h(QueryClientProvider, { client }, element)),
	);
	return {
		host,
		async close() {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}
const card = () => document.querySelector("[data-profile-card]");
/*
 * Assert on a BOOLEAN, never on the element: a failing `assert.equal(node, null)`
 * makes node's assert `util.inspect` a live jsdom node for its diff, which walks
 * the whole window graph - that, not the component, is what grew the failing
 * run to tens of GB before the memory guard killed it (2026-10-26).
 */
const isOpen = () => card() !== null;
const tick = async (ms) =>
	act(async () => {
		mock.timers.tick(ms);
		// Let frames scheduled by what the tick ran (focus into the card) land.
		await new Promise((resolve) => setImmediate(resolve));
	});
// React listens for mouseenter/leave via mouseover/mouseout at the root.
const enter = async (node, from = document.body) =>
	act(async () => {
		node.dispatchEvent(
			new MouseEvent("mouseover", { bubbles: true, relatedTarget: from }),
		);
	});
const leave = async (node) =>
	act(async () => {
		node.dispatchEvent(
			new MouseEvent("mouseout", {
				bubbles: true,
				relatedTarget: document.body,
			}),
		);
	});
const press = async (node) =>
	act(async () => {
		// The browser's order for a pointer press on a button.
		node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
		node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		node.focus();
		node.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
		node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
		node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});

function personRow(onSelect, patch = {}) {
	return h(PersonRailRow, {
		member: bea,
		selfAccountId: "acct_self",
		identityKnown: true,
		selected: false,
		dm: null,
		readOnly: false,
		onSelect,
		onStartGroup: () => {},
		...patch,
	});
}
const rowOf = (host) => host.querySelector("[data-team-bridge-person]");

test("a click on a person row selects it at once and opens no card", async () => {
	let selected = 0;
	const m = await mount(personRow(() => selected++));
	try {
		const row = rowOf(m.host);
		await enter(row);
		await press(row);
		assert.equal(selected, 1, "the click opened the conversation");
		assert.equal(isOpen(), false, "no card on click or focus");
		// The dwell the pointer started before the click is cancelled by it.
		await tick(5_000);
		assert.equal(isOpen(), false, "a pending dwell does not outlive the click");
		// The row keeps its own name: it is the conversation, not "Open profile".
		assert.equal(row.getAttribute("aria-label"), "Message Bea");
		assert.equal(row.getAttribute("aria-haspopup"), null);
	} finally {
		await m.close();
	}
});

test("a chief-of-staff row selects on click too", async () => {
	let selected = 0;
	const m = await mount(
		h(ChiefRailRow, {
			chief,
			label: "Atlas",
			selected: false,
			dm: null,
			readOnly: false,
			onSelect: () => selected++,
			onStartGroup: () => {},
		}),
	);
	try {
		const row = m.host.querySelector("[data-team-bridge-chief]");
		await press(row);
		assert.equal(selected, 1);
		assert.equal(isOpen(), false);
	} finally {
		await m.close();
	}
});

test("a short hover opens nothing; a long dwell opens the card", async () => {
	const m = await mount(personRow(() => {}));
	try {
		const row = rowOf(m.host);
		await enter(row);
		await tick(1_100);
		assert.equal(isOpen(), false, "1.1 s is a pass across the rail");
		await leave(row);
		await tick(2_000);
		assert.equal(isOpen(), false, "leaving cancels the dwell");

		await enter(row);
		await tick(1_199);
		assert.equal(isOpen(), false);
		await tick(1);
		assert.ok(isOpen(), "a 1.2 s dwell opens the card");
		assert.ok(
			document.activeElement === document.body,
			"hover never steals focus",
		);
	} finally {
		await m.close();
	}
});

test("hovering the avatar opens the card at the normal delay", async () => {
	const m = await mount(personRow(() => {}));
	try {
		const row = rowOf(m.host);
		const avatar = row.querySelector("[data-team-bridge-avatar]");
		assert.ok(avatar, "the row's avatar carries the fast-path marker");
		await enter(avatar);
		await tick(399);
		assert.equal(isOpen(), false);
		await tick(1);
		assert.ok(isOpen(), "400 ms on the avatar opens the card");
	} finally {
		await m.close();
	}
});

test("leaving the avatar for the row resumes the long dwell, not a fresh one", async () => {
	const m = await mount(personRow(() => {}));
	try {
		const row = rowOf(m.host);
		const avatar = row.querySelector("[data-team-bridge-avatar]");
		const name = [...row.querySelectorAll("span")].find(
			(span) => span.textContent === "Bea",
		);
		await enter(avatar);
		await tick(300);
		await act(async () => {
			name.dispatchEvent(
				new MouseEvent("mouseover", { bubbles: true, relatedTarget: avatar }),
			);
		});
		await tick(899);
		assert.equal(isOpen(), false);
		await tick(1);
		assert.ok(isOpen(), "1.2 s from entering the row, not 1.2 s from the name");
	} finally {
		await m.close();
	}
});

test("moving into the open card keeps it; a row click then selects and closes it", async () => {
	let selected = 0;
	const m = await mount(personRow(() => selected++));
	try {
		const row = rowOf(m.host);
		await enter(row);
		await tick(1_200);
		assert.ok(isOpen());
		// Row -> the 6 px gap (body) -> card, the path a real pointer takes.
		await leave(row);
		await tick(100);
		await enter(card());
		await tick(1_000);
		assert.ok(isOpen(), "the pointer in the card holds it open");
		await enter(row, card());
		await press(row);
		await tick(0);
		assert.equal(selected, 1);
		assert.equal(isOpen(), false, "the click closed the card");
	} finally {
		await m.close();
	}
});

test("focus does not open the card; Shift+F10 opens it and moves focus in", async () => {
	const m = await mount(personRow(() => {}));
	try {
		const row = rowOf(m.host);
		await act(async () => row.focus());
		await tick(2_000);
		assert.equal(isOpen(), false, "Tab onto a row is not a request for a card");
		assert.equal(
			row.getAttribute("aria-keyshortcuts"),
			"Shift+F10 ContextMenu",
		);
		assert.equal(row.getAttribute("aria-expanded"), "false");
		await act(async () => {
			row.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "F10",
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await tick(16);
		assert.ok(isOpen(), "the keyboard reaches the card");
		assert.equal(row.getAttribute("aria-expanded"), "true");
		assert.ok(
			card().contains(document.activeElement),
			"focus lands in the card so its actions are one key away",
		);
		await act(async () => {
			document.activeElement.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await tick(16);
		assert.equal(isOpen(), false);
		assert.ok(document.activeElement === row, "Escape returns to the row");
		await act(async () => {
			row.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ContextMenu",
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await tick(16);
		assert.ok(isOpen(), "the context-menu key is the same route");
	} finally {
		await m.close();
	}
});

/*
 * Review R1-2: a card closed by `leave()` (here, Tab out of a keyboard-opened
 * card while the pointer still rests on the row) used to keep the row's entry
 * time, so the next crossing onto the avatar computed a negative dwell and
 * reopened the card at 0 ms. Every close now forgets it.
 */
test("a card closed by blurring out does not reopen at 0 ms on the next avatar crossing", async () => {
	const m = await mount(personRow(() => {}));
	try {
		const row = rowOf(m.host);
		const avatar = row.querySelector("[data-team-bridge-avatar]");
		await enter(row);
		await tick(100);
		await act(async () => {
			row.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "F10",
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await tick(16);
		assert.ok(isOpen());
		assert.equal(card().contains(document.activeElement), true);
		await act(async () => document.activeElement.blur());
		await tick(200);
		assert.equal(isOpen(), false, "blurring out of the card closes it");
		// Long past the row's 1.2 s dwell from the original entry.
		await tick(1_500);
		await act(async () => {
			avatar.dispatchEvent(
				new MouseEvent("mouseover", { bubbles: true, relatedTarget: row }),
			);
		});
		await tick(0);
		assert.equal(isOpen(), false, "no 0 ms reopen from a stale entry time");
		await tick(2_000);
		assert.equal(
			isOpen(),
			false,
			"closed until the pointer leaves and returns",
		);

		await leave(row);
		await enter(avatar);
		await tick(399);
		assert.equal(isOpen(), false);
		await tick(1);
		assert.equal(isOpen(), true, "a fresh visit dwells normally again");
	} finally {
		await m.close();
	}
});

test("an inert row selects nothing but still reaches its card on a long dwell", async () => {
	let selected = 0;
	for (const patch of [
		{ member: { ...bea, account_id: "acct_self" } },
		{ member: { ...bea, bridge_enabled: false, bridge_state: "disabled" } },
		{ identityKnown: false },
	]) {
		const m = await mount(personRow(() => selected++, patch));
		try {
			const row = rowOf(m.host) ?? m.host.querySelector("button");
			await press(row);
			assert.equal(isOpen(), false);
			await leave(row);
			await enter(row);
			await tick(1_200);
			assert.ok(isOpen(), `card reachable: ${JSON.stringify(patch)}`);
		} finally {
			await m.close();
		}
	}
	assert.equal(selected, 0, "inert rows never open a conversation");
});

test("message-list triggers keep the default card: 400 ms hover, focus and click open it", async () => {
	// The same anchor shape `team-bridge-message-list.tsx` passes (sender name),
	// with no rail props: the defaults ARE the message-list behaviour.
	const sender = () =>
		h(
			TeamBridgeProfileCard,
			{ member: bea, label: "Bea", onMessage: () => {} },
			h("button", { type: "button", "data-sender": "known" }, "Bea"),
		);
	let m = await mount(sender());
	try {
		const button = m.host.querySelector("[data-sender]");
		assert.equal(button.getAttribute("aria-label"), "Open profile for Bea");
		assert.equal(button.getAttribute("aria-haspopup"), "dialog");
		await enter(button);
		await tick(399);
		assert.equal(isOpen(), false);
		await tick(1);
		assert.ok(isOpen(), "400 ms hover");
	} finally {
		await m.close();
	}
	m = await mount(sender());
	try {
		await act(async () => m.host.querySelector("[data-sender]").focus());
		assert.ok(isOpen(), "focus opens it at once");
	} finally {
		await m.close();
	}
	m = await mount(sender());
	try {
		const button = m.host.querySelector("[data-sender]");
		await act(async () =>
			button.dispatchEvent(new MouseEvent("click", { bubbles: true })),
		);
		assert.ok(isOpen(), "click toggles it open (Radix trigger)");
	} finally {
		await m.close();
	}
});
