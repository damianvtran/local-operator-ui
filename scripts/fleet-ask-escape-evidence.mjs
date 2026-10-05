import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * ESCAPE, FROM THE RAIL DOOR — the fleet pane's claim, MEASURED.
 *
 * WHY THIS IS A RIG AND NOT A `.test.mjs`. The three facts below are true of one
 * mounted surface and one key press, and every attempt to keep a jsdom mount of
 * this graph inside `node --test` grew without bound (a runaway tree the fleet's
 * memory guard reaped). A one-shot process that mounts ONCE, asserts, prints its
 * transcript and exits is the same evidence at a bounded cost — and the repo
 * already keeps its browser/terminal rigs this way (`*-evidence.mjs`). The cheap
 * STRUCTURAL half of the same claim (which selectors, which listener, which key)
 * is pinned by `scripts/fleet-asks.test.mjs`, which is a suite member.
 *
 * WHAT IT PROVES, in order:
 *
 *  1. focus ENTERS the pane when the door is the conversation header's asks trigger —
 *     the drawer's entry move accepts either door, including the one whose press
 *     leaves the trigger's own DOM out of the pane entirely;
 *  2. an Escape pressed anywhere while the pane is open CLOSES it and calls
 *     `preventDefault`, and that `defaultPrevented` answer is exactly what makes
 *     the app's interrupt ladder stand down — so the agent's running turn
 *     survives. Asserted THROUGH `interruptEscapeApplies`, the real predicate:
 *     before the claim it answers `true` on a busy session (the reproduction of
 *     the state this fix removes), after it answers `false`;
 *  3. a press an open dialog owns is left to that dialog;
 *  4. the claim is the pane's own: once the pane unmounts, a later Escape is
 *     unclaimed again and the rung is reachable — no leak into the other
 *     right-slot occupants.
 *
 * WHAT IS REAL: the shipped `FleetAskDrawer` → `AskDrawer` → `AskPanel` subtree,
 * the shipped read over the desktop bridge, and the shipped interrupt predicate.
 * What is faked: the bridge's answers (one fixture payload) and a door button
 * carrying the row's own selector.
 *
 * RUN IT BOUNDED. It fans out through esbuild and settles around 150-200 MB RSS:
 *
 *   NODE_OPTIONS=--max-old-space-size=1024 timeout 120 \
 *     node scripts/fleet-ask-escape-evidence.mjs
 *
 * A WATCHDOG of 90 s inside the process means a stuck mount exits 3 with a
 * reason rather than hanging a shell.
 */

const WATCHDOG_MS = 90_000;
const watchdog = setTimeout(() => {
	console.error(
		"fleet-ask-escape-evidence: WATCHDOG fired — mount did not settle",
	);
	process.exit(3);
}, WATCHDOG_MS);
watchdog.unref?.();

const lines = [];
const say = (line) => {
	lines.push(line);
};
let failures = 0;
const check = (label, ok, detail) => {
	say(
		`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : `  [${detail}]`}`,
	);
	if (!ok) failures += 1;
};

/*
 * QUIET, DELIBERATELY: React dev-build warnings about a missing tooltip provider
 * are per-render and this file mounts a subtree that carries one. The runner's
 * own output is the transcript, and a warning flood is what makes a rig of this
 * shape expensive to run.
 */
const realError = console.error;
console.error = () => {};

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chat",
});
for (const key of [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
]) {
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const storage = new Map();
Object.defineProperty(DOM.window, "localStorage", {
	configurable: true,
	value: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, String(value)),
		removeItem: (key) => storage.delete(key),
		clear: () => storage.clear(),
		key: (index) => [...storage.keys()][index] ?? null,
		get length() {
			return storage.size;
		},
	},
});
globalThis.localStorage = DOM.window.localStorage;
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
};

/** One aggregate row: the frozen `PendingAsk` shape plus `session_id`/`cwd`. */
const now = Date.now();
const ROW = {
	ask_id: "a-1",
	session_id: "aaaa11112222",
	cwd: "/Users/someone/pergamon-labs",
	status: "open",
	created_at: now - 60_000,
	expires_at: now + 3_600_000,
	timeout_s: 1800,
	urgent: false,
	questions: [
		{
			id: "q",
			question: "Proceed with the migration?",
			options: [{ label: "qa" }, { label: "prod" }],
			multi: false,
		},
	],
};
DOM.window.api = {
	desktop: {
		request: async (request) =>
			request.op === "asks.list"
				? { status: 200, body: { result: { asks: [ROW] } } }
				: { status: 404, body: { detail: "not found" } },
	},
};

const bundle = await build({
	stdin: {
		contents: [
			'export { FleetAskDrawer } from "../src/renderer/src/features/chat/components/asks/fleet-ask-drawer";',
			'export { interruptEscapeApplies } from "../src/renderer/src/features/chat/hooks/use-interrupt-on-escape";',
			'export { ASK_HEADER_ITEM_SELECTOR, ASK_ITEM_SELECTOR } from "../src/renderer/src/features/chat/ask-queue";',
			'export { createRoot } from "react-dom/client";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
		].join("\n"),
		resolveDir: `${process.cwd()}/scripts`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	alias: {
		"@shared": join(process.cwd(), "src/renderer/src/shared"),
		"@features": join(process.cwd(), "src/renderer/src/features"),
		"@assets": join(process.cwd(), "src/renderer/src/assets"),
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	define: { "import.meta.env": "{}" },
	logLevel: "silent",
});
const bundlePath = `${process.cwd()}/.fleet-ask-escape-evidence.bundle.mjs`;
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	FleetAskDrawer,
	interruptEscapeApplies,
	ASK_HEADER_ITEM_SELECTOR,
	ASK_ITEM_SELECTOR,
	QueryClient,
	QueryClientProvider,
	createRoot,
} = await import(bundlePath);

const flush = async (times = 6) => {
	for (let i = 0; i < times; i += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
};

const pressEscape = async (target) => {
	const event = new DOM.window.KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	await act(async () => {
		target.dispatchEvent(event);
	});
	return event;
};

const busySession = {
	sessionId: "aaaa11112222",
	busy: true,
	available: true,
};

const client = new QueryClient({
	defaultOptions: { queries: { retry: false, staleTime: 0 } },
});
const container = document.createElement("div");
document.body.append(container);
const door = document.createElement("button");
door.setAttribute("data-tour-tag", "ask-pane-trigger");
door.textContent = "Open asks";
document.body.append(door);
door.focus();

say(
	`door selector: ${ASK_HEADER_ITEM_SELECTOR}   chip selector: ${ASK_ITEM_SELECTOR}`,
);
say(
	`door matches the header selector: ${door.matches(ASK_HEADER_ITEM_SELECTOR)}`,
);
say(
	`door holds focus before the pane opens: ${document.activeElement === door}`,
);

const closes = [];
const root = createRoot(container);
try {
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(FleetAskDrawer, {
					onClose: () => closes.push(Date.now()),
				}),
			),
		);
	});
	await flush();

	const pane = document.querySelector('[data-ask-drawer="fleet"]');
	check("1. the pane mounts from the fixture read", Boolean(pane));
	/*
	 * THE POINT OF THE WHOLE RIG, and the state the fix had to reach: the drawer's
	 * first render carries no rows (the read has not answered), so the entry move
	 * must not be consumed there.
	 */
	check(
		"1. focus ENTERS the pane from the rail door",
		Boolean(pane) &&
			pane.contains(document.activeElement) &&
			document.activeElement !== door,
		`active=${document.activeElement?.tagName ?? "null"}`,
	);
	check(
		"1. the card carries its conversation line",
		Boolean(container.querySelector("[data-lo-ask-conversation]")),
	);

	/*
	 * THE REPRODUCTION. With the press unclaimed and the session busy, the ladder
	 * WOULD stop the turn — this is what the first cut shipped.
	 */
	check(
		"2. the ladder is live for this state (the shipped defect)",
		interruptEscapeApplies(
			{
				key: "Escape",
				defaultPrevented: false,
				isComposing: false,
				target: document.body,
			},
			busySession,
		) === true,
	);

	const claimed = await pressEscape(document.body);
	check(
		"2. an Escape from ANYWHERE is claimed (preventDefault)",
		claimed.defaultPrevented === true,
	);
	check(
		"2. and the pane closes",
		closes.length === 1,
		`closes=${closes.length}`,
	);
	check(
		"2. the claimed press never reaches the interrupt rung — the turn survives",
		interruptEscapeApplies(
			{
				key: "Escape",
				defaultPrevented: claimed.defaultPrevented,
				isComposing: false,
				target: document.body,
			},
			busySession,
		) === false,
	);

	/* 3. A press a layer owns stays that layer's (the canvas's own guard). */
	const dialog = document.createElement("div");
	dialog.setAttribute("role", "dialog");
	const inDialog = document.createElement("button");
	dialog.append(inDialog);
	document.body.append(dialog);
	inDialog.focus();
	const before = closes.length;
	const owned = await pressEscape(inDialog);
	check(
		"3. an Escape inside an open dialog is not claimed",
		owned.defaultPrevented === false && closes.length === before,
	);
	dialog.remove();

	/* 4. Unmounting takes the claim with it. */
	await act(async () => {
		root.unmount();
	});
	client.clear();
	check(
		"4. the pane is gone after unmount",
		document.querySelector('[data-ask-drawer="fleet"]') === null,
	);
	const after = await pressEscape(document.body);
	check(
		"4. a later Escape is unclaimed again (no leak)",
		after.defaultPrevented === false,
	);
	check(
		"4. and the rung is reachable again",
		interruptEscapeApplies(
			{
				key: "Escape",
				defaultPrevented: after.defaultPrevented,
				isComposing: false,
				target: document.body,
			},
			busySession,
		) === true,
	);

	say(
		`VERDICT: ${failures === 0 ? "all checks PASS" : `${failures} check(s) FAILED`}`,
	);
	await unlink(bundlePath).catch(() => {});
	console.log(lines.join("\n"));
	realError(`rss ${Math.round(process.memoryUsage().rss / 1e6)} MB`);
	process.exit(failures === 0 ? 0 : 1);
} catch (error) {
	say(`THREW: ${error?.stack ?? error}`);
	console.log(lines.join("\n"));
	process.exit(2);
}
