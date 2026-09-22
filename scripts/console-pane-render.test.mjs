/**
 * The console pane's own STATES, rendered: what it shows while a user's open is
 * being answered, and what it shows when the create is refused.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS NOT `console-pane.test.mjs`. That file pins the
 * RULES — the listing's narrowing, the theme's roles, the completion ladder's
 * decisions — and it bundles for a node process with no DOM, which is the right
 * instrument for a pure function and the wrong one for a claim about what a user
 * SEES. The two findings this file closes are both about the render:
 *
 *   - design round 1, D1 (with agent review round 1, F-3): the pane's dispatcher is a
 *     passive `useEffect`, so the commit where the read has settled and `creating` is
 *     not yet set used to paint "No console in this session" with a live `+` — the
 *     exact greeting the operator's report exists to remove — and the read that follows
 *     a create was fired and not awaited, opening a second such window;
 *   - design round 1, U2: a create the host REFUSED rendered the unavailable state,
 *     whose copy says the console cannot exist in this app and advises updating it,
 *     directly above the machine line naming the real cause.
 *
 * Both are claims about which state is painted at which moment, so the instrument is a
 * rendered pane and a record of every commit — not a call to a model function. The
 * mirror suite (`console-mirror.test.mjs`) established the harness: jsdom for the DOM,
 * `@xterm/xterm` stubbed (a real Terminal needs layout, and `open()` behind jsdom
 * throws), and the shipped TypeScript bundled in memory with esbuild, so what renders
 * here is the code that ships.
 *
 * WHAT IS SUBSTITUTED AND WHAT THAT COSTS. The bridge is a stub — a scripted
 * `window.api.console` — because the thing under test is the pane's own state machine,
 * not a pty. So this proves the pane's STATES and their order; it proves nothing about
 * a program running, and the live readings (a real create, a real caret) stay with the
 * rig on the PR and QA's launch. The commit record below is a DOM mutation record, which
 * is the same claim a frame makes: a browser cannot paint a commit that never touched
 * the DOM, and this records every one that did.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE STORAGE SHIM, and it is not optional on this host (agent review round 3, M2). The
 * suite renders the REAL preferences store, which is persisted, so zustand's middleware
 * writes through `localStorage` on every `setState`. Node 22 — the version CI and the
 * repository pin — has no `localStorage` binding at all, and the middleware degrades with
 * its own "storage is currently unavailable" warning. THIS host's default node (26) has
 * the BINDING and it is `undefined`, so the storage object closes over undefined and
 * every write throws `TypeError: Cannot read properties of undefined (reading 'setItem')`
 * — five red tests on the machine the operator actually runs, green in CI. Four sibling
 * jsdom suites (`browser-chrome`, `composer-tabs`, …) already carry this shim; this is
 * theirs, for the same reason and with the same four methods plus `key`/`length`.
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

const dom = new JSDOM(
	'<!doctype html><html><body><div id="root"></div></body></html>',
	{
		pretendToBeVisual: true,
		url: "http://localhost/",
	},
);
const { window } = dom;

/*
 * The same three document-level stubs the mirror suite installs, for the same reasons:
 * the cell measurement asks a canvas for its metrics, the pane and the mirror observe
 * their boxes, and React reads `matchMedia`.
 */
window.HTMLCanvasElement.prototype.getContext = function getContext() {
	return { font: "", measureText: (text) => ({ width: text.length * 7.8 }) };
};
class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;
window.matchMedia = () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
});

globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, "navigator", {
	value: window.navigator,
	configurable: true,
	writable: true,
});
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.MutationObserver = window.MutationObserver;
globalThis.ResizeObserver = ResizeObserverStub;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

const bundle = await build({
	stdin: {
		contents: [
			'export { ConsolePane } from "./src/renderer/src/features/console/components/console-pane";',
			// The store is the real one: the user's open is raised through it, so the
			// flow under test is the flow the header drives rather than a prop the
			// harness invents.
			'export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";',
			'export { createRoot } from "react-dom/client";',
			'export { createElement, Profiler } from "react";',
			// The stub's own handles, exported through the same bundle so a test reads the very
			// terminals the component constructed rather than a second copy of the module.
			'export { __terminals } from "./scripts/console-xterm-stub";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	tsconfig: "./tsconfig.app.json",
	logLevel: "silent",
	define: { "process.env.NODE_ENV": '"test"' },
	alias: {
		"@xterm/xterm": "./scripts/console-xterm-stub.ts",
		"@xterm/addon-unicode11": "./scripts/console-addon-unicode11-stub.ts",
		"@xterm/xterm/css/xterm.css": "./node_modules/@xterm/xterm/css/xterm.css",
	},
	loader: { ".css": "empty" },
});
const harnessPath = join(
	tmpdir(),
	`lo-console-pane-render-harness-${process.pid}.mjs`,
);
writeFileSync(harnessPath, bundle.outputFiles[0].text);
const harness = await import(pathToFileURL(harnessPath).href);

/**
 * The literals this file asserts on, hoisted because biome's `useTopLevelRegex` (the
 * rule every sibling console suite carries as warnings) asks for them once rather than
 * per assertion, and because the names are what a reader checks a claim against.
 */
const EMPTY_STATE = /No console in this session/;
const WAITING = /Reading this session's console|Starting a console/;
const STARTING = /Starting a console/;
const CREATE_FAILED = /The console could not start in this session/;
const REPORTED_REASON = /spawn_failed/;
const CONSOLE_MISSING = /not available in this app/;
const NO_REASON_GIVEN = /did not say why/;
const TERMINAL = /zsh/;

const SESSION = "session-render-test";

/** One surface, in the shape main publishes (§10.2). */
const surfaceRow = (surface, extra = {}) => ({
	surface,
	session_id: SESSION,
	origin: "user",
	command: "zsh",
	argv_tail: "",
	cwd: "/tmp",
	cols: 80,
	rows: 24,
	running: true,
	exit_code: null,
	last_activity: 1,
	live: true,
	agent_owned: false,
	secure: false,
	retain: true,
	displayed: true,
	...extra,
});

/**
 * The bridge the pane talks to, with the two calls this file scripts.
 *
 * `createSurface` is the one under test: it resolves (with the surface appearing in the
 * listing) or rejects, on a delay the caller sets, which is what makes the window
 * between the press and the answer observable at all. The read is deliberately slow in
 * the transition test for the same reason.
 */
const installBridge = ({ create, surfaces = [], readDelayMs = 0 } = {}) => {
	const calls = { create: 0, state: 0 };
	const listeners = [];
	let listing = surfaces;
	const setListing = (next) => {
		listing = next;
	};
	window.api = {
		console: {
			state: async () => {
				calls.state += 1;
				if (readDelayMs) await new Promise((r) => setTimeout(r, readDelayMs));
				return {
					available: true,
					reason: null,
					detail: null,
					surfaces: listing,
				};
			},
			createSurface: async () => {
				calls.create += 1;
				return create({ calls, setListing });
			},
			subscribe: async () => ({ replay_base64: "", from_byte: 0 }),
			unsubscribe: async () => {},
			input: async () => {},
			keys: async () => {},
			onOutput: () => () => {},
			onExit: () => () => {},
			onReveal: () => () => {},
			onStateChanged: (listener) => {
				listeners.push(listener);
				return () => {
					const at = listeners.indexOf(listener);
					if (at >= 0) listeners.splice(at, 1);
				};
			},
			setContentRect: async () => ({ available: true, surfaces: listing }),
			openPane: async () => {},
			closePane: async () => {},
		},
	};
	return {
		calls,
		setListing,
		/*
		 * MAIN'S OWN SIGNAL, which is the route the finding is about: an agent's
		 * `console_create` reaches the pane as a change main reports, not as a press — so a
		 * test that wants a surface to appear "by another route" fires this and lets the
		 * hook's coalesced re-read do the rest.
		 */
		fireStateChanged: () => {
			for (const listener of [...listeners]) listener();
		},
	};
};

const settle = (ms = 0) =>
	new Promise((resolve) => setTimeout(resolve, ms || 1));

/**
 * WAIT ON THE EVENT, NEVER ON THE CLOCK — this repository's own rule, and this suite
 * learned it the hard way (agent review round 3): every wait here used to be a fixed
 * sleep sized on a quiet machine, so on a host at load 120 a 40 ms timer could take
 * longer than the 120 ms the test allowed for it and the suite failed on the *setup*
 * assertion instead of on the claim. A predicate removes the question; the timeouts are
 * a bound on the harness, not a schedule.
 *
 * A bounded settle is still used where the assertion is about something NOT happening
 * (a surface arriving later must not take the caret, a request must not be answered) —
 * an absence can only be observed over a window, and saying so is honest.
 */
const waitFor = async (predicate, { timeoutMs = 5000, stepMs = 10 } = {}) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await settle(stepMs);
	}
	return false;
};

/**
 * Everything the pane commits, in order, as the text a reader would see.
 *
 * THE INSTRUMENT IS REACT'S OWN `Profiler`, and the first version of this file used a
 * `MutationObserver` instead — which silently could not see the thing it was written
 * for. React flushes pending passive effects before the next render inside one task, so
 * the commit where the read has settled and `creating` is not yet set and the commit
 * that follows it land in a single observer callback: the record showed the final DOM
 * twice-deduped and the intermediate state was never in it. `onRender` fires per COMMIT,
 * after that commit's DOM mutations and before the passive effects it schedules, which
 * is exactly the granularity the finding is about — and a commit is what a browser can
 * paint, which is the claim these tests make.
 *
 * WHAT IT STILL IS NOT: pixels. jsdom does not paint, so this cannot show that a frame
 * reached the screen; the frames on the PR are the live half. What it can show, and the
 * half that would silently regress, is that no commit of the pane ever contained the
 * greeting.
 */
const paints = [];
const recordPaint = (container) => {
	const text = container.textContent ?? "";
	if (paints[paints.length - 1] !== text) paints.push(text);
};

const mountPane = async () => {
	/*
	 * A CONTAINER PER TEST, appended to the body, because the shared `#root` of the
	 * mirror suite's harness is not enough here: a test that fails before its unmount
	 * would leave its pane mounted, and the NEXT test would then read two panes' text
	 * out of one node and report the first test's state as its own.
	 */
	const container = document.createElement("div");
	document.body.append(container);
	const root = harness.createRoot(container);
	root.render(
		harness.createElement(
			harness.Profiler,
			{ id: "console-pane", onRender: () => recordPaint(container) },
			harness.createElement(harness.ConsolePane, {
				sessionId: SESSION,
				onClose: () => {},
			}),
		),
	);
	await settle(1);
	return { root, container };
};

/** Each test starts from no pending request, whoever failed before it. */
const resetIntent = () => {
	const { consoleOpenIntent, clearConsoleOpenIntent } =
		harness.useUiPreferencesStore.getState();
	if (consoleOpenIntent !== null) clearConsoleOpenIntent(consoleOpenIntent);
};

/** The commits from a point in the record onward, as the states to judge. */
const since = (mark) => paints.slice(mark);

/** The user's own press: the header's trigger, through the store. */
const pressOpenConsole = () =>
	harness.useUiPreferencesStore.getState().requestConsoleOpen(SESSION);

test("the pane never paints the empty state between the user's open and the terminal", async () => {
	/*
	 * THE FLOW THE OPERATOR DESCRIBED, in the order it happens: the pane is open and
	 * empty (legitimate — nothing has been asked for yet), the user opens a console
	 * from it, and a shell arrives. The read is slow and the create slower, so every
	 * one of the commits in between is recorded.
	 */
	resetIntent();
	installBridge({
		readDelayMs: 40,
		create: async ({ setListing }) => {
			await new Promise((r) => setTimeout(r, 60));
			setListing([surfaceRow("con:1:render-test")]);
		},
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => EMPTY_STATE.test(container.textContent ?? ""));
		assert.match(
			container.textContent,
			EMPTY_STATE,
			"the pane starts empty, which is not the state under test",
		);

		const mark = paints.length;
		pressOpenConsole();
		await waitFor(() => TERMINAL.test(container.textContent ?? ""));
		await settle(60);

		const afterPress = since(mark);
		assert.ok(
			afterPress.length > 1,
			`the press has to produce commits to judge, saw ${JSON.stringify(afterPress)}`,
		);
		for (const [index, state] of afterPress.entries()) {
			assert.doesNotMatch(
				state,
				EMPTY_STATE,
				`the greeting and its New console button must not come back once the user has asked for a terminal (D1) — commit ${index} of ${afterPress.length}: ${JSON.stringify(
					afterPress.map((entry) => entry.slice(0, 44)),
				)}`,
			);
		}
		assert.ok(
			afterPress.some((state) => STARTING.test(state)),
			"the create's own wait says what it is waiting for, not that the pane is reading a listing (U4)",
		);
		/*
		 * THE FIRST COMMIT AFTER THE PRESS IS A WAIT, and which sentence it carries is not
		 * fixed: the press is answered in the commit that follows it only when the read has
		 * already settled, and a pane that is still reading says so. What must hold is that
		 * it is a wait and not the greeting.
		 */
		assert.match(
			afterPress[0],
			WAITING,
			`the first commit after the press is a wait, saw ${JSON.stringify(afterPress[0]?.slice(0, 80))}`,
		);
		assert.match(
			afterPress[afterPress.length - 1],
			TERMINAL,
			"and the flow lands on the terminal",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("the pending open masks the empty state in the commit before the dispatcher runs", async () => {
	/*
	 * THE NARROW HALF OF D1, isolated from the create: the request is raised while the
	 * read is still in flight, so the pane's own effect cannot have run (its `loading`
	 * gate makes `consoleOpenAction` answer "none" until the read settles). The render
	 * after the read lands and before the effect runs is the one that used to be the
	 * empty state, and it is the render this assertion is about.
	 */
	resetIntent();
	installBridge({
		readDelayMs: 30,
		create: async ({ setListing }) => {
			setListing([surfaceRow("con:1:render-test")]);
		},
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => EMPTY_STATE.test(container.textContent ?? ""));

		const mark = paints.length;
		pressOpenConsole();
		await waitFor(() => TERMINAL.test(container.textContent ?? ""));
		await settle(60);

		const afterPress = since(mark);
		assert.ok(
			afterPress.length > 1,
			`the press has to commit more than once, saw ${JSON.stringify(afterPress)}`,
		);
		for (const state of afterPress) {
			assert.doesNotMatch(state, EMPTY_STATE);
		}
	} finally {
		root.unmount();
		container.remove();
	}
});

test("a create the host refused reports the refusal, with its reason and a retry", async () => {
	const reason =
		"Error invoking remote method 'console-create-surface': Error: console_unavailable: the pty could not be started (spawn_failed)";
	let fail = true;
	installBridge({
		create: async ({ setListing }) => {
			if (fail) throw new Error(reason);
			setListing([surfaceRow("con:1:render-test")]);
		},
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => EMPTY_STATE.test(container.textContent ?? ""));
		pressOpenConsole();
		await waitFor(() => CREATE_FAILED.test(container.textContent ?? ""));

		const text = container.textContent;
		assert.match(
			text,
			CREATE_FAILED,
			"the state names the attempt, not the app (U2)",
		);
		assert.match(
			text,
			REPORTED_REASON,
			"the host's own words are on the machine line, unedited",
		);
		assert.doesNotMatch(
			text,
			CONSOLE_MISSING,
			"the host answered: the console exists here and one attempt failed",
		);
		assert.doesNotMatch(
			text,
			NO_REASON_GIVEN,
			"the state cannot tell the user the app stayed silent while quoting it",
		);

		/*
		 * AND THE RETRY IS THE SAME ACTION AS THE HEADER'S `+`: pressing it tries again,
		 * which is the check that this state is a door rather than a dead end.
		 */
		const retry = container.querySelector(
			'[data-tour-tag="console-create-retry"]',
		);
		assert.ok(retry, "the refusal offers a retry");
		fail = false;
		retry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await waitFor(() => TERMINAL.test(container.textContent ?? ""));
		assert.match(
			container.textContent,
			TERMINAL,
			"the retry runs another create and the pane lands on the terminal",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("a refused create arms nothing: a surface arriving later does not take the caret", async () => {
	/*
	 * AGENT REVIEW ROUND 3, M1, and the case UX's U1 named. The caret request used to be
	 * armed on the way INTO a create — before any mirror existed to spend it — and the
	 * create's own `.finally` cleared only the request, not the token. A create that
	 * FAILED therefore left the token armed with nothing that would ever spend it, and
	 * the next surface to appear in that conversation by any route mounted a mirror that
	 * inherited it and pulled the caret out of the composer. `bridge.fireStateChanged()`
	 * is that route: main reporting a change is exactly how an agent's `console_create`
	 * reaches this pane, with no press and no request of the user's.
	 */
	resetIntent();
	const bridge = installBridge({
		create: async () => {
			throw new Error(
				"Error invoking remote method 'console-create-surface': Error: console_unavailable: the pty could not be started (spawn_failed)",
			);
		},
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => EMPTY_STATE.test(container.textContent ?? ""));
		pressOpenConsole();
		await waitFor(() => CREATE_FAILED.test(container.textContent ?? ""));
		assert.match(
			container.textContent,
			CREATE_FAILED,
			"the refusal is the state under test, so the create has to have failed",
		);

		const before = harness.__terminals.length;
		bridge.setListing([surfaceRow("con:1:agent-created")]);
		bridge.fireStateChanged();
		await waitFor(
			() => harness.__terminals.slice(before).some((t) => !t.wasDisposed),
			{ timeoutMs: 6000 },
		);
		// The mirror is mounted; this is the window in which an armed token WOULD be spent,
		// so the absence below is asserted over it.
		await settle(120);

		const live = harness.__terminals
			.slice(before)
			.filter((terminal) => !terminal.wasDisposed);
		assert.ok(
			live.length >= 1,
			"the surface that appeared by another route mounted a mirror",
		);
		for (const terminal of live) {
			assert.equal(
				terminal.focusCount,
				0,
				"a refused create must leave nothing for a later mount to inherit",
			);
		}
	} finally {
		root.unmount();
		container.remove();
	}
});

test("a create that answers with a surface still arms the caret for it", async () => {
	/*
	 * THE CONTRAST, and the half a fix must not cost: the request is now armed by the
	 * ANSWER, so the successful path has to keep taking the caret. Same rig, same press,
	 * one difference — the create answers with a surface.
	 */
	resetIntent();
	installBridge({
		create: async ({ setListing }) => {
			setListing([surfaceRow("con:1:render-test")]);
		},
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => EMPTY_STATE.test(container.textContent ?? ""));
		const before = harness.__terminals.length;
		pressOpenConsole();
		await waitFor(() => TERMINAL.test(container.textContent ?? ""));
		// The mirror's focus effect runs after the commit that shows the terminal.
		await settle(80);

		const live = harness.__terminals
			.slice(before)
			.filter((terminal) => !terminal.wasDisposed);
		assert.equal(live.length, 1, "the created surface's mirror mounted once");
		assert.equal(
			live[0].focusCount,
			1,
			"the user's own open still puts the caret in the terminal it asked for",
		);
		assert.match(container.textContent, TERMINAL);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("a request made for another conversation is not answered here", async () => {
	/*
	 * THE OTHER HALF OF F-6, and the half only a render can pin: the store's request
	 * carries the conversation it was made for, and a pane showing a DIFFERENT one has
	 * to leave it alone. The pane is remounted on a session switch, so without this the
	 * intent a user raised and then navigated away from would be answered by whichever
	 * conversation they landed on — a shell started in a conversation nobody asked about.
	 */
	resetIntent();
	installBridge({
		create: async ({ setListing }) => {
			setListing([surfaceRow("con:1:render-test")]);
		},
	});
	const { root, container } = await mountPane();
	try {
		await settle(30);
		harness.useUiPreferencesStore
			.getState()
			.requestConsoleOpen("session-a-different-conversation");
		await settle(200);

		assert.match(
			container.textContent,
			EMPTY_STATE,
			"this pane has no surface and no request of its own, so it stays empty",
		);
		assert.equal(
			harness.useUiPreferencesStore.getState().consoleOpenIntent,
			"session-a-different-conversation",
			"and the other conversation's request is still waiting for its own pane",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("the commit record is not empty, so it cannot pass by observing nothing", async () => {
	/*
	 * A GUARD ON THE INSTRUMENT, because an assertion that every recorded state lacks a
	 * string is satisfied by a record of no states at all. This is the smallest case
	 * that must produce one.
	 */
	resetIntent();
	installBridge({ create: async ({ setListing }) => setListing([]) });
	const { root, container } = await mountPane();
	try {
		const mark = paints.length;
		pressOpenConsole();
		await waitFor(() => since(mark).length >= 2);
		assert.ok(
			since(mark).length >= 2,
			`the recorder sees commits, saw ${since(mark).length}`,
		);
	} finally {
		root.unmount();
		container.remove();
	}
});
