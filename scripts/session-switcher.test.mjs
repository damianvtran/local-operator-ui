import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/**
 * The Ctrl+Tab recent-session switcher: its rows, its stepping, the chord, the
 * focus predicate that arbitrates it against the in-app browser, and the run's
 * three ways out.
 *
 * FOUR LANES, ONE FILE, for the reason the surface has four separate claims:
 *
 * - the ROWS and the STEPPING are the shipped model, driven directly
 *   (`session-switcher-model.ts`);
 * - the CHORD is `switcherPress`, the same function the listener calls, so a
 *   matrix here is the matrix the app answers;
 * - the FOCUS RULE is `browserOwnsTabChord` against a real jsdom browser root
 *   registered through `registerBrowserChordRoot` - the exported registry door,
 *   because the question is "does the browser own the keyboard right now" and a
 *   second copy of that rule is exactly what the predicate exists to prevent;
 * - the RUN is the mounted component. Held-Control, commit-on-release, the
 *   180 ms withhold, Escape and blur are all facts about listeners and timers, so
 *   they are pressed for real rather than described.
 *
 * The bundle is built in memory with the renderer's path aliases restated (esbuild
 * reads the ROOT tsconfig, and the renderer's mapping lives in
 * `tsconfig.app.json`) - the shape `palette-recents.test.mjs` and
 * `browser-chord-renderer.test.mjs` already use. React, react-dom, the router and
 * react-query stay EXTERNAL: the mounted tree has to share one instance of each
 * with this file, or the hooks see no context at all.
 */
/*
 * zustand's `persist` captures `localStorage` when the store module is EVALUATED,
 * so this stub has to exist before the bundle below is imported - the ordering
 * constraint `palette-recents.test.mjs` documents at length. A Map is enough: the
 * parked ring is the only persisted value these cases touch.
 */
const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};

/** The two esbuild filters, at module scope for the linter's rule table. */
const OPEN_CONVERSATION_MODULE = /\/open-conversation$/;
const ANY_MODULE = /.*/;

const bundle = await build({
	stdin: {
		contents: [
			'export { buildSwitcherRows, stepSwitcherCursor, initialSwitcherCursor, commitSessionId, switcherPress, SESSION_SWITCHER_ROW_CAP, SESSION_SWITCHER_REVEAL_MS } from "./src/renderer/src/features/session-switcher/session-switcher-model";',
			'export { browserOwnsTabChord, registerBrowserChordRoot } from "./src/renderer/src/features/browser/hooks/use-browser-chords";',
			'export { interruptEscapeApplies } from "./src/renderer/src/features/chat/hooks/use-interrupt-on-escape";',
			'export { SessionSwitcher } from "./src/renderer/src/features/session-switcher/components/session-switcher";',
			'export { sessionSwitcherRunOpen } from "./src/renderer/src/features/session-switcher/use-session-switcher-keys";',
			'export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";',
			'export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";',
			'export { suppressBrowserView } from "./src/renderer/src/shared/browser-view-policy";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	write: false,
	/* The renderer compiles JSX with the automatic runtime (`tsconfig.app.json`);
	 * the root tsconfig esbuild would otherwise find is a solution file with no
	 * compilerOptions, so the runtime is named here. */
	jsx: "automatic",
	external: [
		"react",
		"react/jsx-runtime",
		"react-dom",
		"react-dom/client",
		"react-router-dom",
		"@tanstack/react-query",
	],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	plugins: [
		{
			/*
			 * THE COMMIT'S OUTWARD EDGE, stubbed to a spy. `openConversation` writes the
			 * route and starts the catalogue read; what this file has to prove is WHICH
			 * id the release chose and WHETHER it chose one at all, so the boundary is
			 * where the assertion belongs.
			 */
			name: "open-conversation-spy",
			setup(plugin) {
				plugin.onResolve({ filter: OPEN_CONVERSATION_MODULE }, () => ({
					path: "open-conversation",
					namespace: "switcher-test",
				}));
				plugin.onLoad(
					{ filter: ANY_MODULE, namespace: "switcher-test" },
					() => ({
						contents:
							"export function openConversation(navigate, sessionId) { globalThis.__opened.push(sessionId); return Promise.resolve(true); }",
					}),
				);
			},
		},
	],
	logLevel: "silent",
});

const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	createRequire(import.meta.url),
	module,
	module.exports,
);

const {
	buildSwitcherRows,
	stepSwitcherCursor,
	initialSwitcherCursor,
	commitSessionId,
	switcherPress,
	SESSION_SWITCHER_ROW_CAP,
	SESSION_SWITCHER_REVEAL_MS,
	browserOwnsTabChord,
	registerBrowserChordRoot,
	interruptEscapeApplies,
	SessionSwitcher,
	sessionSwitcherRunOpen,
	useCanonicalSessionsStore,
	useUiPreferencesStore,
	suppressBrowserView,
} = module.exports;

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

const session = (session_id, over = {}) => ({
	session_id,
	title: `title ${session_id}`,
	...over,
});

const rowsOf = (input) =>
	buildSwitcherRows({
		archiveEnabled: false,
		archiveFacts: {},
		...input,
	});

test("the current conversation is row 0 and the ring fills the rest, in visit order", () => {
	const rows = rowsOf({
		sessions: ["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => session(id)),
		/* The ring is most-recent-first and usually carries the current id at its
		 * head, because landing in a conversation is what records it. */
		recents: ["s2", "s3", "s1", "s4", "s5", "s6"],
		displayedSessionId: "s1",
	});
	assert.deepEqual(
		rows.map((row) => row.sessionId),
		["s1", "s2", "s3", "s4", "s5"],
		"current first, then the ring without a duplicate of it, capped at five",
	);
	assert.equal(SESSION_SWITCHER_ROW_CAP, 5);
});

test("with nothing displayed the ring's five most recent are the whole list", () => {
	const rows = rowsOf({
		sessions: ["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => session(id)),
		recents: ["s4", "s2", "s6", "s1", "s5", "s3"],
		displayedSessionId: null,
	});
	assert.deepEqual(
		rows.map((row) => row.sessionId),
		["s4", "s2", "s6", "s1", "s5"],
	);
});

test("a ring entry with no live row is skipped and the next one fills the slot", () => {
	/*
	 * The ring is ids, not rows (`ui-preferences-store.ts`): a conversation that
	 * was deleted or forgotten simply has no catalogue row, and the palette's pin
	 * already reads that as "not a candidate". The fifth slot goes to the next
	 * eligible id rather than being drawn empty.
	 */
	const rows = rowsOf({
		sessions: [session("a"), session("b"), session("d")],
		recents: ["a", "gone", "b", "deleted", "d"],
		displayedSessionId: "a",
	});
	assert.deepEqual(
		rows.map((row) => row.sessionId),
		["a", "b", "d"],
	);
});

test("archived conversations are skipped exactly when the sidebar would hide them", () => {
	const sessions = [session("a"), session("b"), session("c")];
	const facts = { b: { archived: true, answered: true } };
	assert.deepEqual(
		rowsOf({
			sessions,
			recents: ["a", "b", "c"],
			displayedSessionId: "a",
			archiveEnabled: true,
			archiveFacts: facts,
		}).map((row) => row.sessionId),
		["a", "c"],
		"an answered archive fact is the membership rule the sidebar uses",
	);
	assert.deepEqual(
		rowsOf({
			sessions,
			recents: ["a", "b", "c"],
			displayedSessionId: "a",
			archiveEnabled: false,
			archiveFacts: facts,
		}).map((row) => row.sessionId),
		["a", "b", "c"],
		"a backend that advertises no archive capability partitions nothing",
	);
	assert.deepEqual(
		rowsOf({
			sessions,
			recents: ["a", "b", "c"],
			displayedSessionId: "a",
			archiveEnabled: true,
			archiveFacts: { b: { archived: true, answered: false } },
		}).map((row) => row.sessionId),
		["a", "b", "c"],
		"an unanswered press changes nothing, exactly as in the sidebar",
	);
});

test("the current conversation is a row even before the catalogue has one", () => {
	const rows = rowsOf({
		sessions: [],
		recents: [],
		displayedSessionId: "brand-new",
	});
	assert.equal(rows.length, 1);
	assert.equal(rows[0].sessionId, "brand-new");
	assert.equal(rows[0].row, null);
	assert.equal(
		rows[0].title,
		null,
		"no title to draw; the copy is the component's",
	);
});

/* ------------------------------------------------------------------ *
 * Stepping, and what a release does
 * ------------------------------------------------------------------ */

test("the opening press steps - Ctrl+Tab to the previous, Ctrl+Shift+Tab to the last", () => {
	const withCurrent = { count: 5, hasCurrent: true };
	assert.equal(
		stepSwitcherCursor(initialSwitcherCursor(true), 1, withCurrent.count),
		1,
	);
	assert.equal(
		stepSwitcherCursor(initialSwitcherCursor(true), -1, withCurrent.count),
		4,
	);
	/* No conversation on screen: the cursor starts BEFORE row 0, so the two keys
	 * land on the first and last rows instead of both landing on row 0. */
	assert.equal(
		stepSwitcherCursor(initialSwitcherCursor(false), 1, withCurrent.count),
		0,
	);
	assert.equal(
		stepSwitcherCursor(initialSwitcherCursor(false), -1, withCurrent.count),
		4,
	);
});

test("stepping wraps at both ends, identically", () => {
	assert.equal(stepSwitcherCursor(4, 1, 5), 0, "forward off the end");
	assert.equal(stepSwitcherCursor(0, -1, 5), 4, "back off the start");
	assert.equal(stepSwitcherCursor(2, 1, 5), 3);
	assert.equal(stepSwitcherCursor(2, -1, 5), 1);
	assert.equal(stepSwitcherCursor(null, 1, 0), null, "no rows, no cursor");
});

test("releasing on the current conversation closes without navigating", () => {
	const rows = [{ sessionId: "a" }, { sessionId: "b" }];
	assert.equal(commitSessionId(rows, 0, "a"), null);
	assert.equal(commitSessionId(rows, 1, "a"), "b");
	assert.equal(commitSessionId(rows, null, "a"), null);
	assert.equal(commitSessionId([], 0, "a"), null);
});

/* ------------------------------------------------------------------ *
 * The chord
 * ------------------------------------------------------------------ */

const press = (over) => ({
	key: "Tab",
	ctrlKey: true,
	shiftKey: false,
	altKey: false,
	metaKey: false,
	repeat: false,
	...over,
});

test("Ctrl+Tab steps forward and Ctrl+Shift+Tab steps back", () => {
	assert.deepEqual(switcherPress(press({})), { delta: 1, repeat: false });
	assert.deepEqual(switcherPress(press({ shiftKey: true })), {
		delta: -1,
		repeat: false,
	});
});

test("Ctrl+` is the back alias, unshifted, and only there", () => {
	assert.deepEqual(switcherPress(press({ key: "`" })), {
		delta: -1,
		repeat: false,
	});
	assert.deepEqual(
		switcherPress(press({ key: "Unknown", code: "Backquote" })),
		{ delta: -1, repeat: false },
		"the physical key backs up a layout whose backtick reports another glyph",
	);
	assert.equal(switcherPress(press({ key: "`", shiftKey: true })), null);
});

test("the chord is the physical Control key: Cmd, Alt, an IME and a bare Tab are all refused", () => {
	assert.equal(switcherPress(press({ ctrlKey: false })), null);
	assert.equal(switcherPress(press({ metaKey: true })), null);
	assert.equal(switcherPress(press({ altKey: true })), null);
	assert.equal(switcherPress(press({ ctrlKey: false, key: "`" })), null);
	assert.equal(switcherPress(press({ isComposing: true })), null);
	assert.equal(switcherPress(press({ key: "Enter" })), null);
});

test("an auto-repeat is still the chord, and says it is one", () => {
	/*
	 * The press is recognised so the caller SWALLOWS it (a held Tab would move
	 * focus), and flagged so the caller does not step for it. One press, one step
	 * is the whole reason `repeat` is carried out of this function.
	 */
	assert.deepEqual(switcherPress(press({ repeat: true })), {
		delta: 1,
		repeat: true,
	});
});

/* ------------------------------------------------------------------ *
 * The focus rule
 * ------------------------------------------------------------------ */

const BROWSER_URL = "http://127.0.0.1:1/#/browser";
const CHAT_URL = "http://127.0.0.1:1/#/chat/abc";

function browserDom(url) {
	const dom = new JSDOM(
		`<div id="browser" data-tour-tag="browser-route">
			<div id="strip"><button id="tab-1">one</button></div>
			<div id="address-popout"><input id="address" aria-label="Address" /></div>
			<div id="page-slot"></div>
		</div>
		<div id="chat"><textarea id="composer"></textarea></div>
		<div id="sidebar"><button id="row">a conversation</button></div>`,
		{ url },
	);
	return dom;
}

test("focus inside the browser panel - strip, address popout, its root - is the browser's", () => {
	const { window } = browserDom(BROWSER_URL);
	const root = window.document.getElementById("browser");
	const release = registerBrowserChordRoot(root);
	try {
		assert.equal(
			browserOwnsTabChord(
				window.document,
				window.document.getElementById("tab-1"),
			),
			true,
			"the tab strip",
		);
		assert.equal(
			browserOwnsTabChord(
				window.document,
				window.document.getElementById("address"),
			),
			true,
			"the address bar/popout",
		);
		assert.equal(
			browserOwnsTabChord(window.document, root),
			true,
			"the surface root itself (the caret the keyboard close parks)",
		);
		assert.equal(
			browserOwnsTabChord(window.document, window.document.body),
			true,
			"a BODY rest-stop on the standalone browser route",
		);
	} finally {
		release();
	}
});

test("focus anywhere else is the app's - chat composer, sidebar, BODY on a chat route", () => {
	const { window } = browserDom(CHAT_URL);
	const root = window.document.getElementById("browser");
	const release = registerBrowserChordRoot(root);
	try {
		assert.equal(
			browserOwnsTabChord(
				window.document,
				window.document.getElementById("composer"),
			),
			false,
			"the chat composer",
		);
		assert.equal(
			browserOwnsTabChord(
				window.document,
				window.document.getElementById("row"),
			),
			false,
			"a sidebar row",
		);
		/* The same BODY the standalone route grants the browser is NOT a browser
		 * rest-stop on a chat route - the rule the chord door already keeps. */
		assert.equal(
			browserOwnsTabChord(window.document, window.document.body),
			false,
			"BODY on a chat route",
		);
	} finally {
		release();
	}
});

test("an overlay covering the browser hands the keyboard back to the app", () => {
	const { window } = browserDom(BROWSER_URL);
	const root = window.document.getElementById("browser");
	const release = registerBrowserChordRoot(root);
	const unsuppress = suppressBrowserView("session-switcher:test");
	try {
		assert.equal(
			browserOwnsTabChord(
				window.document,
				window.document.getElementById("tab-1"),
			),
			false,
		);
	} finally {
		unsuppress();
		release();
	}
});

test("an unregistered root owns nothing", () => {
	const { window } = browserDom(BROWSER_URL);
	assert.equal(
		browserOwnsTabChord(
			window.document,
			window.document.getElementById("tab-1"),
		),
		false,
	);
});

/* ------------------------------------------------------------------ *
 * The run: listeners, the 180 ms withhold, and the three ways out
 * ------------------------------------------------------------------ */

/**
 * The mounted tree. Only the commit's outward edge is stubbed (above); the
 * stores, the hook, the model and the overlay are the shipped ones.
 */
const REVEAL_WAIT_MS = SESSION_SWITCHER_REVEAL_MS + 120;

async function mountSwitcher({
	sessions = [],
	recents = [],
	displayed = null,
	/** The route the switcher is asked from: only a chat route has a conversation
	 * on screen (review round 1's F2). */
	route = "/chat/abc",
}) {
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: `http://127.0.0.1:1/#${route}`,
		pretendToBeVisual: true,
	});
	const installed = [];
	for (const key of [
		"window",
		"document",
		"navigator",
		"Node",
		"Element",
		"HTMLElement",
		"HTMLInputElement",
		"MutationObserver",
		"localStorage",
		"IS_REACT_ACT_ENVIRONMENT",
	]) {
		installed.push([key, Object.getOwnPropertyDescriptor(globalThis, key)]);
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key],
		});
	}
	globalThis.__opened = [];

	const { createElement: h, act } = await import("react");
	const { createRoot } = await import("react-dom/client");
	const { MemoryRouter } = await import("react-router-dom");
	const { QueryClient, QueryClientProvider } = await import(
		"@tanstack/react-query"
	);

	useUiPreferencesStore.setState({ conversationRecents: recents });
	useCanonicalSessionsStore.setState({
		sessions: sessions.map((id) => session(id)),
		archiveFacts: {},
		activeSessionId: displayed,
		activeDraftKey: null,
		drafts: {},
	});

	const container = dom.window.document.createElement("div");
	dom.window.document.body.append(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const root = createRoot(container);
	await act(async () => {
		root.render(
			h(
				MemoryRouter,
				{ initialEntries: [route] },
				h(QueryClientProvider, { client }, h(SessionSwitcher)),
			),
		);
	});

	const key = async (init) => {
		let event = null;
		await act(async () => {
			event = new dom.window.KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				...init,
			});
			dom.window.document.dispatchEvent(event);
		});
		/* Returned so a case can ask whether the press was CLAIMED: the difference
		 * between a key the app answers and one the browser still acts on (R2-2). */
		return event;
	};
	const keyup = async (init) => {
		await act(async () => {
			dom.window.document.dispatchEvent(
				new dom.window.KeyboardEvent("keyup", {
					bubbles: true,
					cancelable: true,
					...init,
				}),
			);
		});
	};
	const wait = async (ms) => {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, ms));
		});
	};
	/*
	 * A POINTER EVENT AND THE EVENT jsdom LACKS. jsdom implements no `PointerEvent`
	 * (checked at `typeof window.PointerEvent`, v27), so these are `MouseEvent`s
	 * dispatched under the pointer type names - which is all a listener matches on,
	 * and it carries the `button`, `ctrlKey` and `relatedTarget` the handlers read.
	 */
	const pointer = async (type, target, init = {}) => {
		let event = null;
		await act(async () => {
			event = new dom.window.MouseEvent(type, {
				bubbles: true,
				cancelable: true,
				...init,
			});
			target.dispatchEvent(event);
		});
		return event;
	};

	const mounted = {
		dom,
		act,
		key,
		keyup,
		pointer,
		wait,
		opened: () => globalThis.__opened,
		/* The overlay portals to `document.body`, so the panel is found there. */
		panel: () => dom.window.document.querySelector('[role="dialog"]'),
		/* The polite live region that speaks the selection (review round 1's F6). */
		status: () =>
			dom.window.document.querySelector("[data-session-switcher-announcement]")
				?.textContent ?? "",
		rows: () => [
			...dom.window.document.querySelectorAll('[role="dialog"] button'),
		],
		/* The cursor is the row the overlay marks as current; the id it names is
		 * the row the release would open. */
		active: () =>
			dom.window.document.querySelector(
				'[role="dialog"] [aria-current="true"]',
			),
		async unmount() {
			await act(async () => root.unmount());
			for (const [key, descriptor] of installed) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else delete globalThis[key];
			}
		},
	};
	return mounted;
}

const CTRL_TAB = {
	key: "Tab",
	ctrlKey: true,
	code: "Tab",
};

test("a quick tap commits the row the press moved to, and never paints", async () => {
	const { key, keyup, opened, panel, unmount } = await mountSwitcher({
		sessions: ["current", "previous", "older"],
		recents: ["current", "previous", "older"],
		displayed: "current",
	});
	try {
		await key(CTRL_TAB);
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), ["previous"], "row 1: the previous session");
		assert.equal(panel(), null, "the overlay never flashed");
	} finally {
		await unmount();
	}
});

test("holding the chord paints after the delay with the moved cursor, and releasing commits it", async () => {
	const { key, keyup, opened, panel, rows, active, wait, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous", "older"],
			recents: ["current", "previous", "older"],
			displayed: "current",
		});
	try {
		await key(CTRL_TAB);
		assert.equal(panel(), null, "nothing paints before the delay");
		await wait(REVEAL_WAIT_MS);
		assert.notEqual(panel(), null, "the overlay paints once the chord is held");
		assert.equal(rows().length, 3);
		assert.equal(
			active()?.dataset.sessionId,
			"previous",
			"row 1 is the cursor",
		);
		/* A second press while it is up steps again. */
		await key(CTRL_TAB);
		assert.equal(active()?.dataset.sessionId, "older");
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), ["older"]);
		assert.equal(panel(), null, "the commit takes the overlay with it");
	} finally {
		await unmount();
	}
});

test("auto-repeat is swallowed and does not step", async () => {
	const { key, keyup, opened, panel, active, wait, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous", "older"],
			recents: ["current", "previous", "older"],
			displayed: "current",
		});
	try {
		await key(CTRL_TAB);
		await key({ ...CTRL_TAB, repeat: true });
		await key({ ...CTRL_TAB, repeat: true });
		await wait(REVEAL_WAIT_MS);
		assert.equal(
			active()?.dataset.sessionId,
			"previous",
			"one press, one step",
		);
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), ["previous"]);
		assert.equal(panel(), null);
	} finally {
		await unmount();
	}
});

test("the console's reader says whether a run is open, and says so only while one is", async () => {
	/*
	 * THE FLAG THE TERMINAL READS (review round 1's F4). `console-mirror.tsx` hands plain
	 * Tab back to the page while this is true, because a run that lost Control's keyup
	 * can only end on a press the terminal lets through. The console side of that branch
	 * is `console-mirror.test.mjs`; this is the half that has to be true for it.
	 */
	const { key, keyup, panel, wait, unmount } = await mountSwitcher({
		sessions: ["current", "previous"],
		recents: ["current", "previous"],
		displayed: "current",
	});
	try {
		assert.equal(sessionSwitcherRunOpen(), false, "nothing open yet");
		await key(CTRL_TAB);
		assert.equal(sessionSwitcherRunOpen(), true, "a run exists from the press");
		await wait(REVEAL_WAIT_MS);
		assert.notEqual(panel(), null);
		await keyup({ key: "Control", ctrlKey: false });
		assert.equal(sessionSwitcherRunOpen(), false, "and dies with the release");
	} finally {
		await unmount();
	}
});

test("Escape cancels without committing, and Control is still held when it is pressed", async () => {
	const { dom, act, key, keyup, opened, panel, wait, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous"],
			recents: ["current", "previous"],
			displayed: "current",
		});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		assert.notEqual(panel(), null);
		/*
		 * CONTROL IS DOWN. A run only exists while it is, so this is the shape the
		 * keyboard can actually produce during one - the round-1 review (F1) measured
		 * that the old test sent an Escape no keyboard sends here, and that the real
		 * shape fell through to the chord path and committed.
		 */
		let claimed = null;
		await act(async () => {
			const event = new dom.window.KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Escape",
				ctrlKey: true,
			});
			dom.window.document.dispatchEvent(event);
			claimed = event.defaultPrevented;
		});
		assert.equal(claimed, true, "Escape is claimed, not merely answered");
		assert.equal(panel(), null, "Escape closes it");
		/* The Control release that follows must not resurrect the run. */
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), []);
	} finally {
		await unmount();
	}
});

test("Escape during a run never reaches the chat pane's Esc-to-interrupt", async () => {
	const { dom, act, key, keyup, opened, panel, wait, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous"],
			recents: ["current", "previous"],
			displayed: "current",
		});
	/* The interrupt hook's own binding: `window`, bubble phase. A listener with the
	 * same shape is the stand-in for it, which is what makes this the real path and
	 * not a restatement of it. */
	const interruptSaw = [];
	const interruptStandIn = (event) => {
		if (event.key === "Escape") interruptSaw.push(event.defaultPrevented);
	};
	dom.window.addEventListener("keydown", interruptStandIn);
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		let pressed = null;
		await act(async () => {
			pressed = new dom.window.KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				key: "Escape",
				ctrlKey: true,
			});
			dom.window.document.dispatchEvent(pressed);
		});
		assert.deepEqual(
			interruptSaw,
			[],
			"the capture-phase claim stops the press before chat's listener",
		);
		/*
		 * AND THE PREDICATE AGREES even if it ever runs first: the claim is readable on
		 * the event, which is what `dispatchInterruptOnEscape` re-checks in its
		 * microtask. The unclaimed twin is the positive control - a busy turn WOULD be
		 * interrupted by an Escape nobody claimed, so the false below is the claim's
		 * doing and not a broken predicate.
		 */
		const busyTurn = {
			sessionId: "current",
			turnAlive: true,
			available: true,
		};
		assert.equal(interruptEscapeApplies(pressed, busyTurn), false);
		const unclaimed = new dom.window.KeyboardEvent("keydown", {
			key: "Escape",
			ctrlKey: true,
		});
		assert.equal(
			interruptEscapeApplies(unclaimed, busyTurn),
			true,
			"an unclaimed Escape during a busy turn is the interrupt's",
		);
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), []);
	} finally {
		dom.window.removeEventListener("keydown", interruptStandIn);
		await unmount();
	}
});

/* ------------------------------------------------------------------ *
 * A run that lost Control, and the route that decides what is current
 * ------------------------------------------------------------------ */

test("a press reporting Control up ends the run, and never commits", async () => {
	const { key, keyup, pointer, opened, panel, wait, dom, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous", "older"],
			recents: ["current", "previous", "older"],
			displayed: "current",
		});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		assert.notEqual(panel(), null);
		/* The shape of a lost Control keyup: a key that reports the modifier up. */
		await key({ key: "a", ctrlKey: false });
		assert.equal(panel(), null, "a press with Control up ends the run");
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), [], "and commits nothing");
	} finally {
		await unmount();
	}
});

test("a key release reporting Control up ends the run too", async () => {
	const { key, keyup, opened, panel, wait, unmount } = await mountSwitcher({
		sessions: ["current", "previous", "older"],
		recents: ["current", "previous", "older"],
		displayed: "current",
	});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		await keyup({ key: "a", ctrlKey: false });
		assert.equal(panel(), null);
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), []);
	} finally {
		await unmount();
	}
});

test("the Tab that ends a lost run is claimed, so focus stays where the run began", async () => {
	const { key, keyup, opened, panel, wait, unmount } = await mountSwitcher({
		sessions: ["current", "previous", "older"],
		recents: ["current", "previous", "older"],
		displayed: "current",
	});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		/*
		 * CONTROL'S KEYUP NEVER ARRIVED (agent review round 2, R2-2). The console hands
		 * this plain Tab back to the page BECAUSE a run is open (console-mirror), so an
		 * unclaimed press would move focus out of the terminal that produced it - the
		 * exact case that change was added for. Claimed, the caret stays put and the
		 * shell gets nothing, which is the lost run ending rather than a tab.
		 */
		const tab = await key({ key: "Tab", ctrlKey: false });
		assert.equal(
			tab.defaultPrevented,
			true,
			"the press that ends a run is claimed",
		);
		assert.equal(panel(), null, "and it ends the run");
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), [], "ending a run is not a choice of row");

		/* The same branch, any other key: the reader is typing, not choosing. */
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		const letter = await key({ key: "a", ctrlKey: false });
		assert.equal(letter.defaultPrevented, false, "a typed key is not claimed");
		assert.equal(panel(), null);
		await keyup({ key: "Control", ctrlKey: false });
	} finally {
		await unmount();
	}
});

test("a pointer press away from the rows ends the run, and a press on a row commits it", async () => {
	const { key, keyup, pointer, opened, panel, rows, wait, dom, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous", "older"],
			recents: ["current", "previous", "older"],
			displayed: "current",
		});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		assert.notEqual(panel(), null);
		/* Control up, press nowhere near the panel: nothing a release could commit. */
		await pointer("pointerdown", dom.window.document.body);
		assert.equal(panel(), null);
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), []);

		/*
		 * AND A PRESS ON A ROW IS A CHOICE. It commits on `pointerdown`, because on
		 * macOS the overlay only exists while Control is held, so every press here is
		 * a Ctrl+click - which Chromium turns into `contextmenu` with no `click` at
		 * all (review round 1's F5).
		 */
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		const row = rows()[1];
		await pointer("pointerdown", row, { button: 0 });
		assert.deepEqual(opened(), ["previous"], "the row that was pressed");
		assert.equal(panel(), null);
	} finally {
		await unmount();
	}
});

test("a right-click on a mounted row opens no context menu, and is not a commit", async () => {
	const { key, keyup, pointer, panel, rows, wait, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous"],
			recents: ["current", "previous"],
			displayed: "current",
		});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		/* A press that never commits - the row is still mounted, so its own handler
		 * is the one that answers (the committing press's menu is caught after the
		 * row is gone; see the two cases below). */
		const event = await pointer("contextmenu", rows()[1]);
		assert.equal(event.defaultPrevented, true);
		/* Still up: a context menu is not a commit. */
		assert.notEqual(panel(), null);
		await keyup({ key: "Control", ctrlKey: false });
	} finally {
		await unmount();
	}
});

/*
 * THE OTHER HALF, AND THE ONE THAT WAS MISSING (agent review round 2, R2-1). A
 * macOS Ctrl+click commits on `pointerdown`, which unmounts the row inside that
 * event; Chromium then raises `contextmenu` against whatever the panel covered.
 * Sending `contextmenu` to a row that is still mounted proved the `keep` case and
 * nothing about the real gesture, so these two drive the press first.
 */
test("a committing press leaves no context menu for the element underneath it", async () => {
	const { key, keyup, pointer, opened, panel, rows, wait, dom, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous"],
			recents: ["current", "previous"],
			displayed: "current",
		});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		await pointer("pointerdown", rows()[1], { button: 0 });
		assert.deepEqual(opened(), ["previous"], "the press commits its row");
		assert.equal(panel(), null, "and takes the row that would have answered");
		/* The menu Chromium raises next, hit-tested at the element underneath. */
		const menu = await pointer("contextmenu", dom.window.document.body);
		assert.equal(menu.defaultPrevented, true, "the press still owns its menu");
		/* One press, one guard: a later right-click is nobody's to swallow. */
		const later = await pointer("contextmenu", dom.window.document.body);
		assert.equal(later.defaultPrevented, false, "the guard was one-shot");
		await keyup({ key: "Control", ctrlKey: false });
	} finally {
		await unmount();
	}
});

test("the press's own pointerup disarms the context menu guard", async () => {
	const { key, keyup, pointer, panel, rows, wait, dom, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous"],
			recents: ["current", "previous"],
			displayed: "current",
		});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		await pointer("pointerdown", rows()[1], { button: 0 });
		assert.equal(panel(), null);
		/* A press that released without raising a menu - a real move of the pointer,
		 * not a Ctrl+click - must not leave the guard behind for the next one. */
		await pointer("pointerup", dom.window.document.body);
		const later = await pointer("contextmenu", dom.window.document.body);
		assert.equal(later.defaultPrevented, false, "nothing left armed");
		await keyup({ key: "Control", ctrlKey: false });
	} finally {
		await unmount();
	}
});

/*
 * PREVENTING IS NOT ENOUGH ON ITS OWN (agent review round 3, R3-1). Radix's
 * composed trigger skips a prevented event, but the page's plain `onContextMenu`
 * handlers open their own menu without checking - `sidebar-navigation.tsx`,
 * `chat-tag-header.tsx` and the canvas files view among them. A narrow window
 * puts the panel over those elements, so the guard has to stop the event, not
 * only cancel it.
 */
test("a committing press's context menu never reaches a plain handler underneath", async () => {
	const { key, keyup, pointer, opened, panel, rows, wait, dom, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous"],
			recents: ["current", "previous"],
			displayed: "current",
		});
	try {
		/* The covered page from the event's side: a handler that prevents and
		 * opens its own menu without asking, the shape of the non-Radix menus. */
		const underneath = dom.window.document.createElement("div");
		dom.window.document.body.append(underneath);
		let plainMenus = 0;
		underneath.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			plainMenus += 1;
		});

		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		await pointer("pointerdown", rows()[1], { button: 0 });
		assert.deepEqual(opened(), ["previous"], "the press commits its row");
		assert.equal(panel(), null, "and takes the row that would have answered");
		/* The menu Chromium raises next, hit-tested at the element underneath. */
		const menu = await pointer("contextmenu", underneath);
		assert.equal(menu.defaultPrevented, true, "the press still owns its menu");
		assert.equal(plainMenus, 0, "and no handler underneath ran");
		/* One press, one guard: the next right-click is the page's again. Its own
		 * handler prevents it, so the count - not `defaultPrevented` - is the tell. */
		await pointer("contextmenu", underneath);
		assert.equal(plainMenus, 1, "the later menu is the page's own");
		await keyup({ key: "Control", ctrlKey: false });
	} finally {
		await unmount();
	}
});

/*
 * AND THE BOUND IS A WAY OUT TOO (agent review round 3, R3-N1). A press dragged
 * out of the window raises no `pointerup` here and no menu either, so the timer
 * is the only thing that can end the guard.
 */
test("the context menu guard disarms at its bound", async () => {
	const { key, keyup, pointer, panel, rows, wait, dom, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous"],
			recents: ["current", "previous"],
			displayed: "current",
		});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		await pointer("pointerdown", rows()[1], { button: 0 });
		assert.equal(panel(), null);
		/* Past the guard's 1000 ms (`PRESS_CONTEXT_MENU_GUARD_MS`), with neither a
		 * menu nor a `pointerup` to disarm it first. */
		await wait(1100);
		const later = await pointer("contextmenu", dom.window.document.body);
		assert.equal(later.defaultPrevented, false, "the bound ended the guard");
		await keyup({ key: "Control", ctrlKey: false });
	} finally {
		await unmount();
	}
});

test("a resting pointer leaves the opening selection alone, and a moving one takes it", async () => {
	const { key, keyup, pointer, opened, active, rows, wait, dom, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous", "older"],
			recents: ["current", "previous", "older"],
			displayed: "current",
		});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		assert.equal(active().dataset.sessionId, "previous");
		/*
		 * THE POINTER IS RESTING WHERE THE PANEL PAINTED (design round 2, D6).
		 * Chromium raises boundary events on an element inserted under a stationary
		 * cursor, so `pointerover`/`mouseover` arrive here with no movement at all -
		 * and on this surface the release IS the commit, so a row that selected
		 * itself on the way past would open a conversation nobody chose.
		 */
		await pointer("pointerover", rows()[2], {
			relatedTarget: dom.window.document.body,
		});
		assert.equal(
			active().dataset.sessionId,
			"previous",
			"a boundary event is not movement",
		);
		await pointer("mouseover", rows()[2], {
			relatedTarget: dom.window.document.body,
		});
		assert.equal(
			active().dataset.sessionId,
			"previous",
			"nor is the mouse flavour of it",
		);
		/* A real move still selects - that is what shows the row a press commits. */
		await pointer("mousemove", rows()[2]);
		assert.equal(active().dataset.sessionId, "older", "the pointer moved it");
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), ["older"]);
	} finally {
		await unmount();
	}
});

test("the selection is announced with its position, on open and on every step", async () => {
	const { key, keyup, status, rows, wait, unmount } = await mountSwitcher({
		sessions: ["current", "previous", "older"],
		recents: ["current", "previous", "older"],
		displayed: "current",
	});
	try {
		assert.equal(status(), "", "nothing to say while the panel is closed");
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		assert.equal(status(), "title previous, 2 / 3");
		await key(CTRL_TAB);
		assert.equal(status(), "title older, 3 / 3");
		assert.equal(rows().length, 3);
		await keyup({ key: "Control", ctrlKey: false });
	} finally {
		await unmount();
	}
});

test("on a route with no conversation on screen the ring is the whole list and row 0 is the first press", async () => {
	const { key, keyup, opened, active, panel, wait, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous", "older", "fourth", "fifth"],
			recents: ["current", "previous", "older", "fourth", "fifth"],
			/* The store still holds the conversation that was left; the route is what
			 * decides it is not on screen (review round 1's F2). */
			displayed: "current",
			route: "/settings",
		});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		assert.notEqual(panel(), null);
		assert.equal(
			active().dataset.sessionId,
			"current",
			"the first press lands on row 0 when nothing is on screen",
		);
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(
			opened(),
			["current"],
			"and releasing it goes back to the conversation that was left",
		);
	} finally {
		await unmount();
	}
});

test("on a chat route the conversation on screen is current: stepping back to it commits nothing", async () => {
	const { key, keyup, opened, active, wait, unmount } = await mountSwitcher({
		sessions: ["current", "previous", "older"],
		recents: ["current", "previous", "older"],
		displayed: "current",
		route: "/chat/current",
	});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		assert.equal(active().dataset.sessionId, "previous");
		await key({ key: "Tab", ctrlKey: true, shiftKey: true });
		assert.equal(active().dataset.sessionId, "current");
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), [], "a release on the current row is a no-op");
	} finally {
		await unmount();
	}
});

test("losing the window cancels without committing", async () => {
	const { key, keyup, dom, act, opened, panel, wait, unmount } =
		await mountSwitcher({
			sessions: ["current", "previous"],
			recents: ["current", "previous"],
			displayed: "current",
		});
	try {
		await key(CTRL_TAB);
		await wait(REVEAL_WAIT_MS);
		assert.notEqual(panel(), null);
		await act(async () => {
			dom.window.dispatchEvent(new dom.window.Event("blur"));
		});
		assert.equal(panel(), null);
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), []);
	} finally {
		await unmount();
	}
});

test("fewer than two rows is no overlay and no navigation, but the press is still swallowed", async () => {
	const { keyup, opened, panel, dom, act, unmount } = await mountSwitcher({
		sessions: ["only"],
		recents: ["only"],
		displayed: "only",
	});
	try {
		let prevented = null;
		await act(async () => {
			const event = new dom.window.KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				...CTRL_TAB,
			});
			dom.window.document.dispatchEvent(event);
			prevented = event.defaultPrevented;
		});
		assert.equal(prevented, true, "the key must not move focus instead");
		assert.equal(panel(), null);
		await keyup({ key: "Control", ctrlKey: false });
		assert.deepEqual(opened(), []);
	} finally {
		await unmount();
	}
});

test("a press from inside the browser panel never opens the switcher", async () => {
	const { panel, opened, dom, act, wait, unmount } = await mountSwitcher({
		sessions: ["current", "previous"],
		recents: ["current", "previous"],
		displayed: "current",
	});
	const browserRoot = dom.window.document.createElement("div");
	browserRoot.dataset.tourTag = "browser-route";
	browserRoot.innerHTML = '<button id="tab-1">one</button>';
	dom.window.document.body.append(browserRoot);
	const release = registerBrowserChordRoot(browserRoot);
	try {
		await act(async () => {
			dom.window.document.getElementById("tab-1").dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					...CTRL_TAB,
				}),
			);
		});
		await wait(REVEAL_WAIT_MS);
		assert.equal(panel(), null, "the browser's tab chord, not the app's");
		assert.deepEqual(opened(), []);
		/*
		 * THE POSITIVE CONTROL: the same press from a node OUTSIDE the browser root
		 * opens the run. Without it this case would also pass on a rig whose listener
		 * or whose rows were broken, which is the failure a negative assertion cannot
		 * see.
		 */
		release();
		await act(async () => {
			dom.window.document.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					bubbles: true,
					cancelable: true,
					...CTRL_TAB,
				}),
			);
		});
		await wait(REVEAL_WAIT_MS);
		assert.notEqual(panel(), null, "the app's chord from the app's own focus");
	} finally {
		release();
		await unmount();
	}
});
