import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE OPEN POLICY, DRIVEN THROUGH THE SHIPPED HOOK, STORES AND DRAWER.
 *
 * `ask-open-policy.test.mjs` pins the DECISION over facts. This file pins the other
 * half: that the React shell (`use-ask-open-policy.ts`) feeds that decision the right
 * facts and applies the verdict to the right place, with the REAL zustand stores and
 * the REAL `AskDrawer`. The failure modes it exists for are all shell failures that a
 * pure test cannot see: an effect that loops on a flag it also writes, a view that is
 * rebuilt under StrictMode (a second "once"), a dismissal that is read off the wrong
 * edge, and an open that moves the keyboard.
 *
 * THE HARNESS (`Pane`) IS `ChatContent`'s RELEVANT SLICE and nothing more: the same
 * hook call, the same session-scope mount gate (`isAskDrawerOpen && scope ===
 * "session" && sessionId`), the same close door (`setAskDrawerOpen(false, "session")`),
 * and a textarea labelled `Message` standing in for the composer. It is keyed by the
 * conversation exactly as `SessionPanel key={identity}` is, so a "switch" here is an
 * unmount and a mount - a new view. `ChatContent` itself cannot be mounted in a node
 * test (it needs the canonical stream), so the call site is pinned by source at the
 * bottom of this file, and the real path is the committed live frames.
 *
 * WHAT IT CANNOT CLAIM: layout, or that Electron's focus model matches jsdom's. Focus
 * here is `document.activeElement`, which is the same fact the drawer's entry move
 * reads; the live frames carry the rest.
 */

const bootstrap = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
// React refuses `act` outside a declared act environment, and says so on every render.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * jsdom implements no canvas and logs "Not implemented: HTMLCanvasElement.prototype.
 * getContext" the first time a measuring helper probes one. The drawer's rows do not
 * need a context, and the sibling rigs stub it the same way (`agents-composer-mount`),
 * so the log stays about the things this file asserts.
 */
bootstrap.window.HTMLCanvasElement.prototype.getContext = () => null;
const { createRoot } = await import("react-dom/client");

const bundle = await build({
	stdin: {
		contents: `
			export { AskDrawer } from "./src/renderer/src/features/chat/components/asks/ask-drawer";
			export { useAskOpenPolicy } from "./src/renderer/src/features/chat/use-ask-open-policy";
			export { askDismissals } from "./src/renderer/src/features/chat/ask-open-policy";
			export { askQueueView } from "./src/renderer/src/features/chat/ask-queue";
			export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";
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
	 * EVERYTHING IS BUNDLED EXCEPT THE REACT FAMILY. The stores reach `base-theme`, which
	 * imports `@mui/material/styles` - a directory import that Node's ESM loader refuses
	 * when it is left external - and the sibling rigs that load these stores
	 * (`right-slot-width.test.mjs`) bundle for the same reason. React stays external so
	 * the hook inside the bundle and the `react-dom/client` this file mounts with are ONE
	 * copy: two copies give the component a different dispatcher than the renderer.
	 */
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"react/jsx-dev-runtime",
	],
	/* `@shared/config` runs `Object.entries(import.meta.env)` at module scope. */
	define: { "import.meta.env": "{}" },
	/*
	 * A CJS module inside the bundle calls `require("react")`, which an ESM bundle cannot
	 * satisfy on its own. The bundle is written next to this file, so `createRequire`
	 * resolves the SAME React the test mounts with - one copy, as the note above needs.
	 */
	banner: {
		js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
	},
	// The renderer's own aliases: the stores reach `@features` for the slot arithmetic.
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
	logLevel: "silent",
});
const bundlePath = new URL(
	`./_ask-open-render-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	// Removed even when the import throws: a stray bundle in `scripts/` is repo scratch.
	await unlink(bundlePath).catch(() => {});
}
const {
	AskDrawer,
	useAskOpenPolicy,
	askDismissals,
	askQueueView,
	useUiPreferencesStore,
	useConversationInputStore,
} = mod;

const h = React.createElement;

/*
 * The call site and its import, as patterns hoisted to module scope (a regex literal in
 * a test body is rebuilt per call). The call is matched whole - three named arguments -
 * so a rewiring that dropped one (the composer key, say) is a failure, not a pass.
 */
const HOOK_CALL =
	/useAskOpenPolicy\(\{\s*sessionId,\s*composerId: conversationId,\s*view: sessionAsksView,\s*\}\)/;
const HOOK_IMPORT =
	/import \{ useAskOpenPolicy \} from "\.\.\/use-ask-open-policy";/;

/* ------------------------------------------------------------- the wire ---- */

let counter = 0;
const NOW = () => Date.now();
/** One ask as the wire carries it. Old by default: queued a minute before the view. */
const ask = (status = "open", extra = {}) => {
	counter += 1;
	return {
		ask_id: `ask-${counter}`,
		created_at: NOW() - 60_000 + counter,
		expires_at: NOW() + 3_600_000,
		timeout_s: 3600,
		status,
		delivered: status !== "open" && status !== "timed_out",
		questions: [
			{
				id: "target",
				question: "Which environment?",
				options: [{ label: "staging" }],
			},
		],
		...extra,
	};
};
const OUTSTANDING = new Set(["open", "timed_out"]);
const withRows = (rows) => ({
	asks: rows,
	asks_open: rows.filter((row) => OUTSTANDING.has(row.status)).length,
	asks_truncated: null,
});
const liveEmpty = () => ({ asks: null, asks_open: 0 });
/** The wire's bounded PREFIX: the rows that fit, and the true outstanding count beside them. */
const prefixOf = (rows, tally) => ({
	asks: rows,
	asks_open: tally,
	asks_truncated: true,
});
/** The same row, settled: an answered ask is no longer outstanding and never comes back. */
const answered = (row) => ({ ...row, status: "answered", delivered: true });

/* ------------------------------------------------------------ the harness ---- */

/** `ChatContent`'s slice: the hook, the session mount gate, the close door, a composer. */
const Pane = ({ sessionId, frontend }) => {
	const view = React.useMemo(() => askQueueView(frontend), [frontend]);
	useAskOpenPolicy({ sessionId, composerId: sessionId, view });
	const open =
		useUiPreferencesStore(
			(s) => s.isAskDrawerOpen && s.askDrawerScope === "session",
		) && Boolean(sessionId);
	const setAskDrawerOpen = useUiPreferencesStore((s) => s.setAskDrawerOpen);
	return h(
		"div",
		null,
		h("textarea", { "aria-label": "Message", id: "composer" }),
		open
			? h(AskDrawer, {
					frontend,
					scope: "session",
					onClose: () => setAskDrawerOpen(false, "session"),
				})
			: null,
	);
};

/** Mount a pane for `sessionId`, keyed by it (a switch is an unmount and a mount). */
const rig = async (t, { strict = false } = {}) => {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const wrap = (el) => (strict ? h(React.StrictMode, null, el) : el);
	const api = {
		container,
		async show(sessionId, frontend) {
			await act(async () => {
				root.render(wrap(h(Pane, { key: sessionId, sessionId, frontend })));
			});
		},
		drawer: () => container.querySelector("[data-ask-drawer]"),
		composer: () => container.querySelector("#composer"),
		flag: () => useUiPreferencesStore.getState().isAskDrawerOpen,
		async press(label) {
			const button = container.querySelector(`[aria-label="${label}"]`);
			assert.ok(button, `no control labelled ${label}`);
			await act(async () => {
				button.dispatchEvent(
					new window.MouseEvent("click", { bubbles: true, cancelable: true }),
				);
			});
		},
	};
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	return api;
};

/** A clean store, a clean record and a clean document for every case. */
const reset = () => {
	askDismissals.clear();
	useUiPreferencesStore.setState({
		isAskDrawerOpen: false,
		askDrawerScope: "session",
		askDrawerEvictedPane: null,
		isCanvasOpen: false,
		isRunPanelOpen: false,
		isBrowserPaneOpen: false,
		isConsolePaneOpen: false,
	});
	useConversationInputStore.setState({ inputByConversation: {} });
	for (const node of document.body.querySelectorAll("[data-test-door]")) {
		node.remove();
	}
	document.body.focus();
};
test.beforeEach(reset);

/** A focused control standing in for one of the drawer's two doors. */
const doorFocused = () => {
	const door = document.createElement("button");
	door.setAttribute("data-tour-tag", "ask-pane-trigger");
	door.setAttribute("data-test-door", "");
	document.body.appendChild(door);
	door.focus();
	return door;
};

/* ======================================================== the four states ==== */

test("state 1 - no asks on open: the drawer stays closed, and an arriving ask does not open it", async (t) => {
	const view = await rig(t);
	/*
	 * THE FLAG'S WRITES, NOT ITS END VALUE, because the end value cannot tell a policy that
	 * stayed out from one that opened and was closed again: the drawer closes itself over a
	 * resolved queue with nothing outstanding (#864), so an over-eager open over this frame
	 * writes `true` and then `false`, and every end-state assertion in this case still reads
	 * a closed drawer. Measured with the `pendingRows <= 0` gate removed from
	 * `decideAskAutoOpen` (mutant M1 in `harness/mutate.py`): the writes over this frame were
	 * [true,false] and this case still passed. Other tests kill M1, but the case NAMED for
	 * the state did not, which is the one a reader would trust to. Same instrument, for the
	 * same reason, as the E2/E3 case below.
	 */
	const writes = [];
	const stop = useUiPreferencesStore.subscribe((state) => {
		writes.push(state.isAskDrawerOpen);
	});
	t.after(stop);
	await view.show("c-a", liveEmpty());
	assert.equal(
		writes.includes(true),
		false,
		`the policy opened the drawer over a queue with nothing pending (flag writes: ${JSON.stringify(writes)})`,
	);
	assert.equal(view.flag(), false);
	assert.equal(view.drawer(), null);
	await view.show(
		"c-a",
		withRows([ask("open", { created_at: NOW() + 30_000 })]),
	);
	assert.equal(
		view.flag(),
		false,
		"an ask ARRIVING never forces the surface open",
	);
	assert.equal(view.drawer(), null);
});

test("state 2 - pending on open: the drawer opens by itself, once", async (t) => {
	const view = await rig(t);
	const rows = [ask("open")];
	await view.show("c-a", withRows(rows));
	assert.equal(view.flag(), true);
	assert.ok(view.drawer() !== null, "the drawer is on screen");
	assert.equal(
		useUiPreferencesStore.getState().askDrawerScope,
		"session",
		"it opens the SESSION queue, the one the conversation owns",
	);
});

test("state 3 - all addressed on open: closed, and settling never re-opens", async (t) => {
	const view = await rig(t);
	await view.show("c-a", withRows([ask("answered"), ask("declined")]));
	assert.equal(view.flag(), false);
	assert.equal(view.drawer(), null);
	await view.show(
		"c-a",
		withRows([ask("answered"), ask("open", { created_at: NOW() + 30_000 })]),
	);
	assert.equal(view.flag(), false, "the view decided closed on open");
});

test("state 4 - dismissed while pending: stays closed through a re-render, a refresh, an arrival, and a switch away and back", async (t) => {
	const view = await rig(t);
	const rows = [ask("open")];
	await view.show("c-a", withRows(rows));
	assert.equal(view.flag(), true);

	// The user closes it with the chrome's X while the ask is still pending.
	await view.press("Close asks");
	assert.equal(view.flag(), false);
	assert.equal(askDismissals.has("c-a"), true, "the close was recorded");

	// A re-render with the same frame, a refreshed frame, and a NEW ask: all stay closed.
	await view.show("c-a", withRows(rows));
	await view.show("c-a", withRows([{ ...rows[0] }]));
	await view.show(
		"c-a",
		withRows([...rows, ask("open", { created_at: NOW() + 30_000 })]),
	);
	await view.show("c-a", withRows([{ ...rows[0], status: "timed_out" }]));
	assert.equal(view.flag(), false);
	assert.equal(view.drawer(), null);

	// Switch away (a conversation with nothing) and back: a NEW view, still closed.
	await view.show("c-b", liveEmpty());
	assert.equal(view.flag(), false);
	await view.show("c-a", withRows(rows));
	assert.equal(
		view.flag(),
		false,
		"a switch away and back must not undo a dismissal",
	);
	assert.equal(view.drawer(), null);
});

/* ================================================== every writer of the flag ==== */

test("Escape inside the drawer is a dismissal too: the watch is on the flag, not on a button", async (t) => {
	const view = await rig(t);
	await view.show("c-a", withRows([ask("open")]));
	const surface = view.container.querySelector("[data-lo-ask-surfaces]");
	assert.ok(surface !== null);
	await act(async () => {
		surface.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	assert.equal(view.flag(), false);
	assert.equal(askDismissals.has("c-a"), true);
});

test("another pane taking the slot is read as a dismissal: the user chose something else for it", async (t) => {
	const view = await rig(t);
	const row = ask("open");
	await view.show("c-a", withRows([row]));
	await act(async () => {
		useUiPreferencesStore.getState().setCanvasOpen(true);
	});
	assert.equal(view.flag(), false, "the canvas claimed the slot");
	assert.equal(askDismissals.has("c-a"), true);
	await view.show("c-b", liveEmpty());
	/* The SAME ask is still outstanding, so what was waved off is still waved off. */
	await view.show("c-a", withRows([row]));
	assert.equal(view.flag(), false);
});

test("the drawer's own close over a queue that emptied is NOT a dismissal", async (t) => {
	const view = await rig(t);
	const row = ask("open");
	await view.show("c-a", withRows([row]));
	assert.equal(view.flag(), true);
	/*
	 * The queue EMPTIES under the open drawer (rows gone, tally zero): `ask-drawer.tsx`
	 * closes itself (#864), through the same door a user's press uses. Nothing in that is
	 * the user turning the surface away, so nothing is recorded.
	 */
	await view.show("c-a", liveEmpty());
	assert.equal(
		view.flag(),
		false,
		"the drawer closed itself over the empty queue",
	);
	assert.equal(askDismissals.has("c-a"), false);
	// A later view of the same conversation with a fresh pending ask opens normally.
	await view.show("c-b", liveEmpty());
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(view.flag(), true);
});

test("a settled-only queue keeps the drawer open (#864), and closing it records nothing", async (t) => {
	const view = await rig(t);
	const row = ask("open");
	await view.show("c-a", withRows([row]));
	assert.equal(view.flag(), true);
	// Answered: the row is still a ROW, so the drawer stays up to read the history.
	await view.show(
		"c-a",
		withRows([{ ...row, status: "answered", delivered: true }]),
	);
	assert.equal(
		view.flag(),
		true,
		"a settled row is history, not an emptied queue",
	);
	await view.press("Close asks");
	assert.equal(view.flag(), false);
	assert.equal(
		askDismissals.has("c-a"),
		false,
		"nothing remained to turn away: this close is not a dismissal",
	);
	// ...and it never re-opens while the view lives.
	await view.show(
		"c-a",
		withRows([ask("open", { created_at: NOW() + 30_000 })]),
	);
	assert.equal(view.flag(), false);
});

/* ============================================================== the guards ==== */

test("an unresolved frame opens nothing; the frame landing later opens once", async (t) => {
	const view = await rig(t);
	await view.show("c-a", null);
	assert.equal(view.flag(), false, "an unread frame is not pending asks");
	await view.show("c-a", { asks: null, asks_open: null });
	assert.equal(
		view.flag(),
		false,
		"a runtime that publishes no engine is not pending asks",
	);
	await view.show("c-a", { asks: null, asks_open: 4, asks_truncated: true });
	assert.equal(view.flag(), false, "a tally with no rows is not pending asks");
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(
		view.flag(),
		true,
		"the frame that can answer is the one that decides",
	);
});

test("a draft (no conversation) never opens anything", async (t) => {
	const view = await rig(t);
	await view.show(undefined, withRows([ask("open")]));
	assert.equal(view.flag(), false);
});

test("opening never takes the keyboard: the composer keeps focus and the drawer takes none", async (t) => {
	const view = await rig(t);
	await view.show("c-a", liveEmpty());
	const composer = view.composer();
	composer.focus();
	assert.equal(document.activeElement, composer);
	// The ask lands on a view that is still deciding: simulate by mounting a fresh view
	// over pending asks with the composer focused and EMPTY.
	await view.show("c-b", withRows([ask("open")]));
	assert.equal(
		view.flag(),
		true,
		"an empty, focused composer does not stop the open",
	);
	const next = view.composer();
	next.focus();
	assert.equal(document.activeElement, next, "the composer keeps the keyboard");
	const surface = view.container.querySelector("[data-lo-ask-surfaces]");
	assert.ok(surface !== null);
	assert.equal(
		surface.contains(document.activeElement),
		false,
		"the drawer must not have pulled focus into itself",
	);
});

test("the focus is still where it was after an auto-open that happens while the composer is focused", async (t) => {
	const view = await rig(t);
	await view.show("c-a", null);
	const composer = view.composer();
	composer.focus();
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(view.flag(), true);
	assert.equal(
		document.activeElement,
		view.composer(),
		"the very element that held focus before the open still holds it",
	);
});

test("the composer holding text keeps the drawer shut, and sending/clearing later does not open it", async (t) => {
	const view = await rig(t);
	useConversationInputStore.getState().setCurrentInput("c-a", "half a thought");
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(view.flag(), false, "the user is mid-sentence");
	useConversationInputStore.getState().setCurrentInput("c-a", "");
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(
		view.flag(),
		false,
		"the view decided on open; clearing the box later is not 'on open'",
	);
});

test("the keyboard on a door keeps the drawer shut: an open there would read as a press", async (t) => {
	const view = await rig(t);
	const door = doorFocused();
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(view.flag(), false);
	assert.equal(document.activeElement, door, "and the door keeps the keyboard");
});

test("a drawer the user already opened is left alone", async (t) => {
	const view = await rig(t);
	await act(async () => {
		useUiPreferencesStore.getState().setAskDrawerOpen(true, "session");
	});
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(view.flag(), true);
	await view.press("Close asks");
	assert.equal(view.flag(), false);
});

test("a fleet pane the user opened is not swapped for this conversation's", async (t) => {
	const view = await rig(t);
	await act(async () => {
		useUiPreferencesStore.getState().setAskDrawerOpen(true, "fleet");
	});
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(useUiPreferencesStore.getState().askDrawerScope, "fleet");
	assert.equal(
		view.drawer(),
		null,
		"the session drawer is not mounted over the fleet pane",
	);
});

test("StrictMode's second effect pass is not a second 'once'", async (t) => {
	const view = await rig(t, { strict: true });
	let opens = 0;
	const off = useUiPreferencesStore.subscribe((state, prev) => {
		if (state.isAskDrawerOpen && !prev.isAskDrawerOpen) opens += 1;
	});
	t.after(off);
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(opens, 1);
	await view.press("Close asks");
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(
		opens,
		1,
		"the double-invoked effect must not re-open a closed drawer",
	);
	assert.equal(view.flag(), false);
});

test("the policy opens through the store's one writer, borrowing a durable pane the close gives back", async (t) => {
	const view = await rig(t);
	await act(async () => {
		useUiPreferencesStore.getState().setCanvasOpen(true);
	});
	await view.show("c-a", withRows([ask("open")]));
	const state = () => useUiPreferencesStore.getState();
	assert.equal(state().isAskDrawerOpen, true);
	assert.equal(
		state().isCanvasOpen,
		false,
		"the slot is borrowed from the canvas",
	);
	assert.equal(state().askDrawerEvictedPane, "isCanvasOpen");
	await view.press("Close asks");
	assert.equal(state().isCanvasOpen, true, "and the close gives it back");
});

/* ================================================ the flag follows the user ==== */

test("a policy-opened drawer carried onto a dismissed conversation is closed before it paints", async (t) => {
	const view = await rig(t);
	// B is dismissed: opened, then closed by the user.
	const waved = ask("open");
	await view.show("c-b", withRows([waved]));
	await view.press("Close asks");
	assert.equal(askDismissals.has("c-b"), true);
	// A opens by policy; the flag then FOLLOWS the user to B.
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(view.flag(), true);
	await view.show("c-b", withRows([waved]));
	assert.equal(
		view.flag(),
		false,
		"the carried drawer was closed for the dismissed conversation",
	);
	assert.equal(view.drawer(), null);
});

/* ========================= the record names the asks it waved off (U10), in the app ==== */

/**
 * Dismiss `waved` on c-a, then land on c-b, whose pending ask the policy opens for: the
 * drawer flag is UP (and policy-opened) when the user goes back to c-a, which is the one
 * path where a stale record and a carried drawer meet.
 */
const dismissThenCarry = async (view) => {
	const waved = ask("open");
	await view.show("c-a", withRows([waved]));
	await view.press("Close asks");
	assert.equal(askDismissals.has("c-a"), true);
	await view.show("c-b", withRows([ask("open")]));
	assert.equal(
		view.flag(),
		true,
		"c-b's drawer is up: the flag is carried to c-a",
	);
	return waved;
};

test("E1 - a partial resolve holds, through the carried drawer: the same waved-off ask keeps c-a shut", async (t) => {
	const view = await rig(t);
	const a = ask("open");
	const b = ask("open");
	await view.show("c-a", withRows([a, b]));
	await view.press("Close asks");
	await view.show("c-b", withRows([ask("open")]));
	assert.equal(view.flag(), true);
	/* a was answered while away; b was not, and a newer ask sits beside it. */
	await view.show("c-a", null);
	await view.show("c-a", withRows([answered(a), b, ask("open")]));
	assert.equal(askDismissals.has("c-a"), true, "b is still outstanding");
	assert.equal(
		view.flag(),
		false,
		"the carried drawer was closed and stays closed",
	);
	assert.equal(view.drawer(), null);
});

test("E2/E3 - resolved while away and a new batch queued: c-a opens a fresh view, frame landing after the mount", async (t) => {
	const view = await rig(t);
	const waved = await dismissThenCarry(view);
	/*
	 * THE REAL APP'S ORDER: the pane mounts on an UNREAD frame and the real one lands a
	 * beat later. The carried drawer is closed at mount (nothing is known yet, and
	 * under-opening is the safe failure), and that close is the POLICY's own, not the
	 * user's - so it must not spend the view's one decision, or the frame that proves the
	 * record stale would arrive to a view that had already decided.
	 */
	await view.show("c-a", null);
	assert.equal(
		view.flag(),
		false,
		"nothing is known yet: the carried drawer is shut",
	);
	await view.show("c-a", withRows([answered(waved), ask("open")]));
	assert.equal(askDismissals.has("c-a"), false, "the record proved stale");
	assert.equal(view.flag(), true, "and the new batch opens a fresh view");
	assert.ok(view.drawer() !== null);
});

test("E2/E3 - the same, when the pane mounts with the frame already resolved", async (t) => {
	const view = await rig(t);
	const waved = await dismissThenCarry(view);
	/*
	 * No unread beat (a story, a rig, a seeded frame): the record must be settled against
	 * the mounting frame BEFORE the carried drawer is judged, or the layout effect would
	 * close the very drawer the view then opens for the new batch.
	 */
	await view.show("c-a", withRows([answered(waved), ask("open")]));
	assert.equal(askDismissals.has("c-a"), false);
	assert.equal(view.flag(), true);
	assert.ok(view.drawer() !== null);
});

test("E2/E3 - settling the record at mount means the carried drawer is never closed and re-opened", async (t) => {
	const view = await rig(t);
	const waved = await dismissThenCarry(view);
	/*
	 * THE END STATE CANNOT TELL THESE TWO PATHS APART, which is why the case before this one
	 * passes either way: without the mount-time settle the layout effect closes the carried
	 * drawer (the record still reads as held), and the passive effect then opens it again for
	 * the new batch - the same open drawer, one close-and-reopen later. That beat is a frame
	 * of the asks vanishing and returning on the one conversation that is supposed to get a
	 * fresh look, so the observable is the flag's WRITES: from the moment the pane mounts, the
	 * drawer flag must never read `false`.
	 */
	const seen = [];
	const stop = useUiPreferencesStore.subscribe((state) => {
		seen.push(state.isAskDrawerOpen);
	});
	t.after(stop);
	await view.show("c-a", withRows([answered(waved), ask("open")]));
	stop();
	assert.equal(
		seen.includes(false),
		false,
		`the carried drawer was closed on the way to being opened again (writes: ${JSON.stringify(seen)})`,
	);
	assert.equal(view.flag(), true);
	assert.ok(view.drawer() !== null);
});

test("U2 - a truncated frame cannot prove a record stale, so a refill beside it stays shut", async (t) => {
	const view = await rig(t);
	const a = ask("open");
	/* The close happened over a bounded PREFIX: one id named of three outstanding. */
	await view.show("c-a", prefixOf([a], 3));
	assert.equal(view.flag(), true);
	await view.press("Close asks");
	assert.equal(askDismissals.has("c-a"), true);
	await view.show("c-b", liveEmpty());
	/* A complete frame that lists none of the named ids: the unnamed two might be any of them. */
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(askDismissals.has("c-a"), true);
	assert.equal(view.flag(), false, "an unknown id list HOLDS");
	/* Only a complete, empty queue settles it; the refill after that opens. */
	await view.show("c-b", liveEmpty());
	await view.show("c-a", liveEmpty());
	assert.equal(askDismissals.has("c-a"), false);
	await view.show("c-b", liveEmpty());
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(view.flag(), true);
});

test("U2 - a sticky asks_truncated flag does not mute the conversation: the record clears on the frame that shows nothing outstanding", async (t) => {
	/*
	 * The core's text budget keeps seven of eight long asks and sets `asks_truncated`, and the
	 * flag STAYS set while the dropped row remains in the projection (see the policy suite's
	 * case of the same name for the four frames and where they come from). Through the real
	 * hook and drawer: close over the prefix, answer everything while away, and the frame that
	 * shows nothing outstanding must forget the record even though the flag is still on it -
	 * which is what lets the next batch open. The first cut read the flag and never did.
	 */
	const view = await rig(t);
	const settled = (count) =>
		Array.from({ length: count }, () => ask("answered"));
	await view.show(
		"c-a",
		prefixOf(
			Array.from({ length: 7 }, () => ask("open")),
			8,
		),
	);
	assert.equal(view.flag(), true, "pending on open over a bounded prefix");
	await view.press("Close asks");
	assert.equal(askDismissals.has("c-a"), true);
	await view.show("c-b", liveEmpty());
	await view.show("c-a", {
		asks: settled(7),
		asks_open: 0,
		asks_truncated: true,
	});
	assert.equal(
		askDismissals.has("c-a"),
		false,
		"complete, nothing outstanding: forgotten, flag or no flag",
	);
	assert.equal(view.flag(), false, "and nothing is pending to open over");
	await view.show("c-b", liveEmpty());
	await view.show("c-a", {
		asks: [ask("open"), ...settled(6)],
		asks_open: 1,
		asks_truncated: true,
	});
	assert.equal(
		view.flag(),
		true,
		"the new batch opens, on a frame whose flag is still set",
	);
	assert.ok(view.drawer() !== null);
});

/**
 * A conversation whose only ask is already answered: the policy leaves it alone
 * (`nothing-pending`), and the drawer stays up if it is opened over it (a settled row is
 * history, #864). It is where a USER-opened drawer can live without the drawer's own
 * "door-less mount over an empty queue closes itself" rule (#864) taking it away.
 */
const settledOnly = () => withRows([ask("answered")]);

test("a drawer the USER opened follows them onto a dismissed conversation, as it always did", async (t) => {
	const view = await rig(t);
	/*
	 * The SAME waved-off ask on the way back: a different one would make the record stale
	 * (the waved-off ask would no longer be outstanding), and this case would then be
	 * about a conversation that is not dismissed any more - it would pass for that reason
	 * and prove nothing about the user's own drawer.
	 */
	const waved = ask("open");
	await view.show("c-b", withRows([waved]));
	await view.press("Close asks");
	assert.equal(askDismissals.has("c-b"), true);
	await view.show("c-a", settledOnly());
	await act(async () => {
		useUiPreferencesStore.getState().setAskDrawerOpen(true, "session");
	});
	assert.equal(view.flag(), true, "the user's own open on c-a");
	await view.show("c-b", withRows([waved]));
	assert.equal(askDismissals.has("c-b"), true, "c-b is still dismissed");
	assert.equal(
		view.flag(),
		true,
		"a drawer the user opened is theirs to keep: it follows them, as it always did",
	);
});

test("provenance does not outlive the flag: a policy open, a close, then a hand-open is the user's", async (t) => {
	const view = await rig(t);
	// The policy opens c-a; the user closes it. The provenance must die with the flag.
	await view.show("c-a", withRows([ask("open")]));
	assert.equal(view.flag(), true);
	await view.press("Close asks");
	// c-b is dismissed too.
	const waved = ask("open");
	await view.show("c-b", withRows([waved]));
	await view.press("Close asks");
	assert.equal(askDismissals.has("c-b"), true);
	// The user now opens the drawer by hand over a conversation that keeps it...
	await view.show("c-c", settledOnly());
	await act(async () => {
		useUiPreferencesStore.getState().setAskDrawerOpen(true, "session");
	});
	assert.equal(view.flag(), true);
	// ...and walks onto the dismissed conversation: a stale provenance would close it.
	await view.show("c-b", withRows([waved]));
	assert.equal(askDismissals.has("c-b"), true, "c-b is still dismissed");
	assert.equal(
		view.flag(),
		true,
		"a stale policy provenance closed a drawer the user opened by hand",
	);
});

/* ============================================ the call site, pinned by source ==== */

test("ChatContent calls the hook with the conversation, the composer key and the queue view", async () => {
	const { readFileSync } = await import("node:fs");
	const source = readFileSync(
		"src/renderer/src/features/chat/components/chat-content.tsx",
		"utf8",
	);
	assert.match(
		source,
		HOOK_CALL,
		"the open policy is no longer wired at the mount that owns the drawer",
	);
	assert.match(source, HOOK_IMPORT);
	const wired = source.indexOf("useAskOpenPolicy({");
	const viewDecl = source.indexOf("const sessionAsksView = useMemo(");
	assert.ok(
		viewDecl !== -1 && wired > viewDecl,
		"the hook reads the view, so it must be called after the view is built",
	);
});

test("the wiring leaves the composer's routing alone", async () => {
	const { readFileSync } = await import("node:fs");
	const hook = readFileSync(
		"src/renderer/src/features/chat/use-ask-open-policy.ts",
		"utf8",
	);
	for (const forbidden of [
		"sendToAsk",
		"askAnswering",
		"askComposerPlaceholder",
		"freeForm",
		"setComposerText",
	]) {
		assert.ok(
			!hook.includes(forbidden),
			`the open policy must not touch the composer's routing (${forbidden})`,
		);
	}
});
