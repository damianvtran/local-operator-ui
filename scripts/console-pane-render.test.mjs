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
/*
 * Radix's focus management calls `scrollIntoView` when it moves focus into a
 * dialog, and jsdom does not implement it; the sibling dialog suites stub it the
 * same way. Without it the close question opens and throws inside the commit.
 */
window.Element.prototype.scrollIntoView = () => {};

globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, "navigator", {
	value: window.navigator,
	configurable: true,
	writable: true,
});
/*
 * EVERY DOM INTERFACE JSDOM OWNS IS FORCED ONTO THE GLOBAL (the recipe
 * `monitor-cancel-dialog.test.mjs` documents, and the reason this file needed it
 * is the test below that opens a Radix dialog): Node 26 defines `Event` and
 * `CustomEvent` itself, an event built from Node's realm is rejected by jsdom's
 * own `dispatchEvent` ("parameter 1 is not of type 'Event'"), and Node has no
 * `HTMLInputElement`, `NodeFilter` or `DOMRect` at all - while the focus trap
 * walks the tree with `instanceof` checks over exactly those interfaces. Names
 * Node also defines are pinned to jsdom's by the FORCE list below; everything
 * else is copied only when the global does not already exist, so the harness's
 * own shims (the storage stub above) survive.
 */
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
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
];
for (const key of Object.getOwnPropertyNames(window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
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
/** #754's question, as the one reading this file's close test needs. */
const CLOSE_QUESTION = /Close this terminal\?/;
/** U6's conditional sentence, asserted present for a retained row and absent for an
 * agent's (its `retain` is off, so promising it would be a lie). */
const OUTPUT_KEPT = /Its output is kept\./;
/** The handler's own clause inside a refusal, and the channel's wrapper the reader
 * must not be shown (U3). */
const STILL_RUNNING = /is still running/;
const IPC_WRAPPER = /Error invoking remote method/;
/** #929's ended banner: the notice the beat stands on, asserted where the beat's
 * own tests need to know the pane has SHOWN the exit. */
const ENDED_NOTICE = /This terminal has ended/;
/** #929's beat, imported from the pane rather than typed here: the tests below
 * WAIT on it, and a second copy would silently stop matching the shipped number
 * the day the design round tunes it. */

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
const installBridge = ({
	create,
	surfaces = [],
	readDelayMs = 0,
	close,
} = {}) => {
	const calls = { create: 0, state: 0, close: [] };
	const listeners = [];
	let listing = surfaces;
	// Main's own displayed-surface acknowledgement: `openPane`/`closePane` write it
	// and the push re-reads, exactly as the host does (Q-2's second cut).
	let displayedSurface = null;
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
					displayed_surface: displayedSurface,
				};
			},
			createSurface: async () => {
				calls.create += 1;
				return create({ calls, setListing });
			},
			closeSurface: async (surface, options) => {
				calls.close.push({ surface, options });
				if (close) await close({ calls, setListing, surface, options });
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
			openPane: async (surface) => {
				displayedSurface = surface;
				for (const listener of [...listeners]) listener();
			},
			closePane: async () => {
				displayedSurface = null;
			},
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

/** A pointer press, as the DOM sees it - the shape this file's other tests use for
 * the retry control, named once for the test below that presses four times. */
const press = async (element) => {
	element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await settle(1);
};

/** The open confirmation, wherever Radix's own portal put it. */
const confirmDialog = () => document.body.querySelector('[role="dialog"]');

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

const mountPane = async ({ sessionId = SESSION, onClose = () => {} } = {}) => {
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
			harness.createElement(harness.ConsolePane, { sessionId, onClose }),
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
			// Main's reply carries the id (`CreateSurfaceResult.surface`).
			return { surface: "con:1:render-test" };
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
			// Main's reply carries the id (`CreateSurfaceResult.surface`).
			return { surface: "con:1:render-test" };
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
			// Main's reply carries the id (`CreateSurfaceResult.surface`).
			return { surface: "con:1:render-test" };
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
		await settle(80);
		const live = harness.__terminals.filter(
			(terminal) => !terminal.wasDisposed,
		);
		assert.equal(live.length, 1, "the retry mounted one terminal");
		assert.equal(
			live[0].focusCount,
			1,
			"the caret lands in the terminal the empty state's create made (F-4)",
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
			// Main's reply carries the id (`CreateSurfaceResult.surface`).
			return { surface: "con:1:render-test" };
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

test("the + with a terminal already open shows the NEW surface and gives it the caret (#1084)", async () => {
	/*
	 * An explicit `+` is a request for a new terminal to work in. The stored lens used
	 * to win over the arrival, so the pane kept showing (and focusing) the old one and
	 * the new surface only appeared as a list row.
	 */
	resetIntent();
	const OLD = "con:1:plus-old";
	const NEW = "con:2:plus-new";
	harness.useUiPreferencesStore.getState().setConsoleActiveSurface(OLD);
	installBridge({
		surfaces: [surfaceRow(OLD)],
		create: async ({ setListing }) => {
			setListing([surfaceRow(OLD), surfaceRow(NEW, { last_activity: 2 })]);
			return { surface: NEW, cols: 80, rows: 24, pid: 2, live: true };
		},
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => TERMINAL.test(container.textContent ?? ""));
		await settle(80);
		const before = harness.__terminals.length;
		const plus = container.querySelector(
			'[data-tour-tag="console-new-surface"]',
		);
		assert.ok(plus, "the + is rendered");
		plus.click();
		// Wait for the create's round trip (the new row in the list), not for the fix.
		await waitFor(() => container.querySelector(`[data-surface="${NEW}"]`));
		await settle(80);
		assert.equal(
			harness.useUiPreferencesStore.getState().consoleActiveSurface,
			NEW,
			"the pane shows the surface the + created",
		);
		const live = harness.__terminals
			.slice(before)
			.filter((terminal) => !terminal.wasDisposed);
		assert.equal(live.length, 1, "the new surface's mirror mounted once");
		assert.equal(live[0].focusCount, 1, "the caret lands in the new terminal");
	} finally {
		root.unmount();
		container.remove();
	}
});

test("two quick presses of + before the bridge answers make exactly one create (F-2)", async () => {
	resetIntent();
	const OLD = "con:1:twice-old";
	const NEW = "con:2:twice-new";
	harness.useUiPreferencesStore.getState().setConsoleActiveSurface(OLD);
	let answer;
	const bridge = installBridge({
		surfaces: [surfaceRow(OLD)],
		create: ({ setListing }) =>
			new Promise((resolve) => {
				answer = () => {
					setListing([surfaceRow(OLD), surfaceRow(NEW, { last_activity: 2 })]);
					resolve({ surface: NEW });
				};
			}),
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => TERMINAL.test(container.textContent ?? ""));
		await settle(80);
		const plus = container.querySelector(
			'[data-tour-tag="console-new-surface"]',
		);
		// Two clicks in one tick, before React can commit the disabled button.
		plus.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		plus.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await settle(40);
		plus.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await settle(40);
		assert.equal(
			bridge.calls.create,
			1,
			"one create for the presses in flight",
		);
		assert.equal(
			plus.disabled,
			true,
			"the + is disabled while the create runs",
		);
		answer();
		await waitFor(() => container.querySelector(`[data-surface="${NEW}"]`));
		await settle(80);
		assert.equal(bridge.calls.create, 1, "still one create after it lands");
		assert.equal(
			plus.disabled,
			false,
			"the + is enabled again once it answered",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("a row picked while a + create is in flight is not overridden when it lands (F-3)", async () => {
	resetIntent();
	const A = "con:1:pick-a";
	const B = "con:2:pick-b";
	const C = "con:3:pick-c";
	harness.useUiPreferencesStore.getState().setConsoleActiveSurface(A);
	let answer;
	installBridge({
		surfaces: [surfaceRow(A), surfaceRow(B)],
		create: ({ setListing }) =>
			new Promise((resolve) => {
				answer = () => {
					setListing([
						surfaceRow(A),
						surfaceRow(B),
						surfaceRow(C, { last_activity: 3 }),
					]);
					resolve({ surface: C });
				};
			}),
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => TERMINAL.test(container.textContent ?? ""));
		await settle(80);
		container
			.querySelector('[data-tour-tag="console-new-surface"]')
			.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await settle(40);
		const rowB = container.querySelector(`[data-surface="${B}"] [role="tab"]`);
		assert.ok(rowB, "row B is rendered");
		rowB.click();
		await waitFor(
			() => harness.useUiPreferencesStore.getState().consoleActiveSurface === B,
		);
		const before = harness.__terminals.length;
		answer();
		await waitFor(() => container.querySelector(`[data-surface="${C}"]`));
		await settle(80);
		assert.equal(
			harness.useUiPreferencesStore.getState().consoleActiveSurface,
			B,
			"the user's later pick stands",
		);
		const focused = harness.__terminals
			.slice(before)
			.filter((terminal) => terminal.focusCount > 0);
		assert.equal(focused.length, 0, "the landing create arms no caret");
	} finally {
		root.unmount();
		container.remove();
	}
});

test("an empty-state create whose listing commits before its reply still gives the new terminal the caret (M-1)", async () => {
	/*
	 * THE SPLIT COMMIT the real app produces: main broadcasts the state change BEFORE
	 * the create's invoke reply, so the hook's coalesced re-read commits the listing,
	 * the lens-sync effect moves the lens to the new surface, and only then does the
	 * reply land. The press's `from` was null; the lens is already the created id.
	 */
	resetIntent();
	const NEW = "con:1:split-commit";
	let bridge;
	bridge = installBridge({
		create: async ({ setListing }) => {
			setListing([surfaceRow(NEW)]);
			bridge.fireStateChanged();
			await new Promise((r) => setTimeout(r, 400));
			return { surface: NEW };
		},
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => EMPTY_STATE.test(container.textContent ?? ""));
		const before = harness.__terminals.length;
		await press(
			container.querySelector('[data-tour-tag="console-new-surface"]'),
		);
		await waitFor(
			() =>
				harness.useUiPreferencesStore.getState().consoleActiveSurface === NEW,
		);
		assert.equal(bridge.calls.create, 1, "one create");
		await settle(600);
		const live = harness.__terminals
			.slice(before)
			.filter((terminal) => !terminal.wasDisposed);
		assert.equal(live.length, 1, "the new surface's mirror mounted once");
		assert.equal(live[0].focusCount, 1, "the caret lands in the new terminal");
	} finally {
		root.unmount();
		container.remove();
	}
});

test("an open that arrives while a create is in flight joins it instead of making a second (m-1)", async () => {
	resetIntent();
	/*
	 * THE OVERLAP THE OLD m-1 CELL DROVE, with the answer this branch chose: a `+`
	 * press starts a create, and the user then opens the console before it answers.
	 * The open is a request for a terminal, and one is already being made — so it
	 * JOINS that create (the pane is still disabled and the request stays filed)
	 * rather than making a second shell behind the pane. When the create answers, the
	 * created surface takes the lens and the caret, and the request is cleared.
	 *
	 * The alternative — two creates from one pair of gestures — was the behaviour the
	 * old cell pinned; it is also a second shell nobody asked for once the first
	 * answers, which is the class of defect this branch exists to remove.
	 */
	const answers = [];
	installBridge({
		create: ({ setListing, calls }) =>
			new Promise((resolve) => {
				const id = `con:${calls.create}:overlap`;
				answers.push(() => {
					setListing([surfaceRow(id)]);
					resolve({ surface: id });
				});
			}),
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => EMPTY_STATE.test(container.textContent ?? ""));
		const plus = container.querySelector(
			'[data-tour-tag="console-new-surface"]',
		);
		await press(plus);
		pressOpenConsole();
		assert.ok(
			await waitFor(() => answers.length === 1),
			"the open waited for the create already in flight",
		);
		await settle(120);
		assert.equal(
			container.querySelector('[data-tour-tag="console-new-surface"]').disabled,
			true,
			"the + stays disabled while that create runs",
		);
		answers[0]();
		assert.ok(
			await waitFor(
				() =>
					harness.useUiPreferencesStore.getState().consoleOpenIntent === null,
			),
			"the answered create served the open, which cleared its request",
		);
		assert.equal(
			answers.length,
			1,
			"and no second create was made for the same pair of gestures",
		);
		assert.match(
			container.textContent ?? "",
			TERMINAL,
			"the created terminal is the one on screen",
		);
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
			// Main's reply carries the id (`CreateSurfaceResult.surface`).
			return { surface: "con:1:render-test" };
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

test("the draft state closes on an unclaimed Escape; a live console keeps the key (UX U2)", async () => {
	/*
	 * The Run details and Code review notices a draft's doors open close on Escape,
	 * and the console's draft state is their sibling, so it does too. A LIVE console
	 * does not: Escape belongs to the program running in the terminal.
	 */
	resetIntent();
	installBridge({ create: async ({ setListing }) => setListing([]) });
	const pressEscape = () =>
		document.body.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
	let closes = 0;
	const draft = await mountPane({
		sessionId: null,
		onClose: () => {
			closes += 1;
		},
	});
	try {
		await settle(5);
		pressEscape();
		assert.equal(closes, 1, "the draft state closed on Escape");
	} finally {
		draft.root.unmount();
		draft.container.remove();
	}
	closes = 0;
	const live = await mountPane({
		onClose: () => {
			closes += 1;
		},
	});
	try {
		await settle(5);
		pressEscape();
		assert.equal(
			closes,
			0,
			"a conversation's console leaves Escape to its terminal",
		);
	} finally {
		live.root.unmount();
		live.container.remove();
	}
});

test("the commit record is not empty, so it cannot pass by observing nothing", async () => {
	/*
	 * recordPaint stores DISTINCT TEXT STATES, not one entry per Profiler commit.
	 * An immediately resolved create can batch updates or repeat the same text;
	 * neither guarantees two states. Hold the real bridge promise until the DOM
	 * independently exposes STARTING, then release and observe its final EMPTY
	 * state. Waiting on the recorder itself would make a disabled recorder fail
	 * by timeout, hiding the exact anti-vacuity oracle below.
	 *
	 * Node22 off-host held/suppressed controls qualified this stimulus: the same
	 * distinct DOM commits reached the recorder, and suppressing only recordPaint
	 * failed the named oracle while bridge/DOM progress remained valid. The old
	 * CI count-one event was not reproduced; this is fixture hardening, not a
	 * product/scheduler fix or a natural-flake-rate claim.
	 */
	resetIntent();
	let releaseCreate;
	let entered = false;
	let fulfilled = false;
	let createPromise;
	const gate = new Promise((resolve) => {
		releaseCreate = resolve;
	});
	const bridge = installBridge({
		create: async ({ setListing }) => {
			entered = true;
			await gate;
			setListing([]);
		},
	});
	const realCreate = window.api.console.createSurface;
	window.api.console.createSurface = (...args) => {
		// Observe fulfilment of the SAME promise the component receives. Callback
		// return is not promise fulfilment; do not substitute another promise.
		createPromise = realCreate(...args);
		createPromise.then(
			() => {
				fulfilled = true;
			},
			() => {},
		);
		return createPromise;
	};
	const { root, container } = await mountPane();
	try {
		assert.ok(
			await waitFor(() => EMPTY_STATE.test(container.textContent ?? "")),
			"initial empty state must settle before the mark",
		);
		const mark = paints.length;
		pressOpenConsole();
		assert.ok(
			await waitFor(
				() => entered && STARTING.test(container.textContent ?? ""),
			),
			"pending create must commit before release",
		);
		const pending = container.textContent ?? "";
		assert.match(pending, STARTING);
		assert.doesNotMatch(pending, EMPTY_STATE);
		releaseCreate();
		assert.ok(
			await waitFor(
				() => fulfilled && EMPTY_STATE.test(container.textContent ?? ""),
			),
			"fulfilled create must commit its final empty state",
		);
		const final = container.textContent ?? "";
		assert.match(final, EMPTY_STATE);
		assert.doesNotMatch(final, STARTING);
		assert.notEqual(pending, final);
		assert.equal(
			bridge.calls.create,
			1,
			"one open reaches one real bridge promise",
		);
		const states = since(mark);
		const pendingAt = states.indexOf(pending);
		const finalAt = states.indexOf(final);
		assert.ok(
			pendingAt >= 0 && finalAt > pendingAt,
			"recorder must retain both causally separated committed states",
		);
	} finally {
		releaseCreate();
		try {
			if (createPromise) await createPromise;
		} finally {
			window.api.console.createSurface = realCreate;
			root.unmount();
			container.remove();
		}
	}
});

test("a running close asks first and only the confirm reaches the bridge; an ended close dismisses outright", async () => {
	/*
	 * #754's interaction, driven on the REAL pane: the two rows the strip can hold
	 * (one running, one ended), the close control on each, and the two different
	 * things its press does. What this can prove and a still cannot: the QUESTION's
	 * order (nothing reaches the host before the confirm), the flags each path sends
	 * (`kill: true` only from the confirm; `retain: false` for the dismissal), and
	 * that the pane falls to its empty state rather than a dead selection once the
	 * last row goes. What it cannot: pixels (the live rig's frames), and a real pty
	 * behind the close (`console-host.test.mjs`'s fake pty owns that).
	 */
	resetIntent();
	const running = surfaceRow("con:1:running");
	const ended = surfaceRow("con:2:ended", {
		running: false,
		exit_code: 0,
		live: false,
	});
	// The stub's listing is what the close MUTATES: filtering the pristine pair on
	// every call would put the first surface back the second time one closes (which
	// this test caught by its last row reappearing under the empty-state wait).
	let remaining = [running, ended];
	const bridge = installBridge({
		surfaces: remaining,
		close: async ({ setListing, surface }) => {
			remaining = remaining.filter((row) => row.surface !== surface);
			setListing(remaining);
		},
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() =>
			container.querySelector('[data-surface="con:2:ended"]'),
		);
		const closeOf = (surface) =>
			container.querySelector(
				`[data-surface="${surface}"] [data-tour-tag="console-surface-close"]`,
			);
		// The control is on every row, and its name follows the state AND carries the
		// tablist's own position, because two shells made two "Close sh" (UX round 1, U4).
		assert.equal(
			closeOf("con:1:running").getAttribute("aria-label"),
			"Close zsh, tab 1 of 2",
		);
		assert.equal(
			closeOf("con:2:ended").getAttribute("aria-label"),
			"Clear zsh, tab 2 of 2 — deletes retained output",
		);

		// A RUNNING close asks before it does anything.
		await press(closeOf("con:1:running"));
		assert.ok(
			await waitFor(() => confirmDialog() !== null),
			"the press did not open the close question",
		);
		assert.match(confirmDialog().textContent, CLOSE_QUESTION);
		// The retained-output reassurance is said where the row's own `retain` says it is
		// true (UX round 1, U6).
		assert.match(confirmDialog().textContent, OUTPUT_KEPT);
		assert.equal(
			bridge.calls.close.length,
			0,
			"the question reached the host before it was answered",
		);

		// Cancel leaves the surface exactly where it was.
		await press(confirmDialog().querySelector("[data-cancel-action]"));
		assert.ok(await waitFor(() => confirmDialog() === null));
		assert.equal(bridge.calls.close.length, 0);
		assert.ok(container.querySelector('[data-surface="con:1:running"]'));

		// Confirm is the one place the kill goes through - and it carries `kill: true`.
		await press(closeOf("con:1:running"));
		assert.ok(await waitFor(() => confirmDialog() !== null));
		await press(confirmDialog().querySelector("[data-confirm-action]"));
		assert.ok(
			await waitFor(() => bridge.calls.close.length === 1),
			"the confirm did not close the surface",
		);
		assert.deepEqual(bridge.calls.close[0], {
			surface: "con:1:running",
			options: { kill: true },
		});
		assert.ok(
			await waitFor(
				() => !container.querySelector('[data-surface="con:1:running"]'),
			),
		);
		assert.equal(confirmDialog(), null, "the question stayed over the answer");
		// THE HANDOFF (UX round 1, U1): the row that held the keyboard is gone, so the
		// lens's neighbour has it — never `<body>`, where the next Tab restarts.
		assert.ok(
			await waitFor(
				() =>
					document.activeElement ===
					container.querySelector('[data-surface="con:2:ended"] [role="tab"]'),
			),
			"the keyboard was left on the document body after the close",
		);

		// An ENDED RETAINED close asks first too, because its X deletes output from
		// disk (design round 1, D6).
		await press(closeOf("con:2:ended"));
		assert.ok(
			await waitFor(() => confirmDialog() !== null),
			"a retained dismissal went through without a question",
		);
		assert.match(confirmDialog().textContent, /Clear this terminal\?/);
		await press(confirmDialog().querySelector("[data-confirm-action]"));
		assert.ok(
			await waitFor(() => bridge.calls.close.length === 2),
			"the dismissal did not reach the bridge",
		);
		assert.deepEqual(bridge.calls.close[1], {
			surface: "con:2:ended",
			options: { retain: false },
		});
		assert.ok(
			await waitFor(
				() => !container.querySelector('[data-surface="con:2:ended"]'),
			),
		);
		// With no surface left the pane shows its empty state rather than a selection
		// pointing at a terminal that no longer exists — and the keyboard lands on the
		// empty state's own control, not on `<body>`.
		assert.ok(
			await waitFor(() =>
				container.textContent.includes("No console in this session"),
			),
			"the pane did not fall to its empty state",
		);
		assert.ok(
			await waitFor(
				() =>
					document.activeElement ===
					container.querySelector('[data-tour-tag="console-new-surface"]'),
			),
			"the keyboard was left on the document body after the dismissal",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("the question withdraws when its subject leaves the listing, and no close is sent", async () => {
	/*
	 * UX round 1's U2 and Agent review round 1's F1, first shape: the row leaves the
	 * LISTING while the question stands (an agent's own console_close). The question
	 * goes rather than confirming against a surface that is no longer there, and
	 * nothing reaches the bridge.
	 */
	resetIntent();
	const bridge = installBridge({ surfaces: [surfaceRow("con:1:running")] });
	const { root, container } = await mountPane();
	try {
		await waitFor(() =>
			container.querySelector('[data-surface="con:1:running"]'),
		);
		const closeOf = () =>
			container.querySelector(
				'[data-surface="con:1:running"] [data-tour-tag="console-surface-close"]',
			);
		await press(closeOf());
		assert.ok(
			await waitFor(() => confirmDialog() !== null),
			"the press did not open the close question",
		);
		bridge.setListing([]);
		bridge.fireStateChanged();
		assert.ok(
			await waitFor(() => confirmDialog() === null),
			"the question stayed over a surface that left the listing",
		);
		assert.equal(
			bridge.calls.close.length,
			0,
			"a withdrawn question reached the bridge",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("the question withdraws when its subject exits while it stands, and no close is sent", async () => {
	/*
	 * Second shape of the same rule, and the half the effect could not see before:
	 * an EXITED row stays listed, so "not in the listing any more" never fired for
	 * it — the question would sit there claiming to end something that had already
	 * ended, and its confirm would send a kill to a surface with nothing to kill.
	 */
	resetIntent();
	const bridge = installBridge({ surfaces: [surfaceRow("con:1:running")] });
	const { root, container } = await mountPane();
	try {
		await waitFor(() =>
			container.querySelector('[data-surface="con:1:running"]'),
		);
		const closeOf = () =>
			container.querySelector(
				'[data-surface="con:1:running"] [data-tour-tag="console-surface-close"]',
			);
		await press(closeOf());
		assert.ok(
			await waitFor(() => confirmDialog() !== null),
			"the press did not open the close question",
		);
		bridge.setListing([
			surfaceRow("con:1:running", {
				running: false,
				exit_code: 0,
				live: false,
			}),
		]);
		bridge.fireStateChanged();
		assert.ok(
			await waitFor(() => confirmDialog() === null),
			"the question stayed over a terminal that had already ended",
		);
		// Withdrawn, not dismissed: the row is still there offering its Dismiss.
		assert.ok(
			container.querySelector('[data-surface="con:1:running"]'),
			"the exited row was removed rather than left in the strip",
		);
		assert.equal(
			bridge.calls.close.length,
			0,
			"a withdrawn question reached the bridge",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("a refused close keeps the question open, in the handler's own words, with the safe answer holding the keyboard", async () => {
	/*
	 * UX round 1's U3: the confirm used to clear in `.finally` as if every outcome
	 * had succeeded — "I pressed Close and nothing happened". The dialog stays, the
	 * refusal renders in the danger ink, and `focusCancelSignal` puts the keyboard
	 * back on Cancel so the next Enter cannot repeat a refused act.
	 */
	resetIntent();
	const bridge = installBridge({
		surfaces: [surfaceRow("con:1:running")],
		close: async () => {
			// The shape a real rejection arrives in: the channel's own prefix around the
			// handler's sentence, which is the half a person should not have to read.
			throw new Error(
				"Error invoking remote method 'console-close-surface': Error: con:1:running is still running; close it with kill: true, or wait for its process to exit",
			);
		},
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() =>
			container.querySelector('[data-surface="con:1:running"]'),
		);
		await press(
			container.querySelector(
				'[data-surface="con:1:running"] [data-tour-tag="console-surface-close"]',
			),
		);
		assert.ok(
			await waitFor(() => confirmDialog() !== null),
			"the press did not open the close question",
		);
		await press(confirmDialog().querySelector("[data-confirm-action]"));
		assert.ok(await waitFor(() => bridge.calls.close.length === 1));
		assert.ok(
			await waitFor(() =>
				STILL_RUNNING.test(confirmDialog()?.textContent ?? ""),
			),
			"a refused close cleared the question as if it had succeeded",
		);
		assert.doesNotMatch(
			confirmDialog().textContent,
			IPC_WRAPPER,
			"the channel's wrapper prefix was shown to the reader",
		);
		const cancel = confirmDialog().querySelector("[data-cancel-action]");
		assert.ok(
			await waitFor(() => document.activeElement === cancel),
			"the refusal left the keyboard on the destructive button",
		);
		await press(cancel);
		assert.ok(
			await waitFor(() => confirmDialog() === null),
			"Cancel no longer closed a refused question",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("the output reassurance is said only where the row says its history persists", async () => {
	/*
	 * UX round 1's U6, the half that would make the sentence a lie: an agent-owned
	 * surface is not retained (§7.2), so its question must not promise the output is
	 * kept. Same flow, the row's own `retain: false`.
	 */
	resetIntent();
	// The bridge is the mount's dependency, not a handle: this test drives the dialog
	// and reads its copy, and it sends nothing.
	installBridge({
		surfaces: [surfaceRow("con:1:agent", { agent_owned: true, retain: false })],
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() =>
			container.querySelector('[data-surface="con:1:agent"]'),
		);
		await press(
			container.querySelector(
				'[data-surface="con:1:agent"] [data-tour-tag="console-surface-close"]',
			),
		);
		assert.ok(
			await waitFor(() => confirmDialog() !== null),
			"the press did not open the close question",
		);
		assert.match(confirmDialog().textContent, CLOSE_QUESTION);
		assert.doesNotMatch(
			confirmDialog().textContent,
			OUTPUT_KEPT,
			"the question promised retention for a surface that is not retained",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

/*
 * #929's THREE LIFECYCLE CASES, on the real pane, in one family, because they are
 * one policy read three ways: a CLEAN exit clears itself after the beat (through
 * the same dismissal the row's X runs), a non-zero exit keeps its row so the error
 * stays readable, and a row restored from a previous run is never touched — there
 * the history is the point. The unit suite (`console-pane.test.mjs`) pins the rule
 * as a truth table; these pin what a reader of the pane would see: the notice, the
 * wait, and the row's actual departure (or its staying).
 *
 * WHAT THEY CANNOT PROVE: pixels, and a real pty behind the exit. The exit here is
 * main's listing changing shape — the same projection the app publishes — because
 * that IS where the policy reads it from; the frames and the live rig own the rest.
 */
// Negative comparison uses the old renderer's four-second delete window.
// The host is mocked here: these are real React flows, not native PTY evidence.
for (const protection of [
	{ name: "user retained", origin: "user", retain: true, secure: false },
	{ name: "agent retained", origin: "agent", retain: true, secure: false },
	{ name: "secure agent", origin: "agent", retain: false, secure: true },
	{
		name: "restored history",
		origin: "agent",
		retain: true,
		secure: false,
		live: false,
	},
]) {
	test(`a clean ${protection.name} exit is never discarded by a renderer timer`, async () => {
		resetIntent();
		const ended = surfaceRow("con:1:protected", {
			...protection,
			running: false,
			exit_code: 0,
			last_activity: 2,
		});
		const bridge = installBridge({ surfaces: [ended] });
		const { root, container } = await mountPane();
		try {
			assert.ok(
				await waitFor(() =>
					container.querySelector('[data-surface="con:1:protected"]'),
				),
			);
			await settle(4500);
			assert.ok(container.querySelector('[data-surface="con:1:protected"]'));
			assert.deepEqual(bridge.calls.close, []);
		} finally {
			root.unmount();
			container.remove();
		}
	});
}

test("the terminal's box paints the terminal's ground across the gutter, and the mirror keeps its inset (#929)", async () => {
	/*
	 * THE GROUND HALF's DOM shape: the box the mirror is OUTSIDE of — the one with the
	 * `px-2` gutter and, since #929, the terminal's own ground — is what the ground
	 * bleeds with, so the gutter and the foot show `sunken` and never the pane's
	 * `elevated`. Asserting the CLASSES rather than computed colours is deliberate:
	 * jsdom applies no stylesheet, so the class is the seam a render can be wrong
	 * about; the pixels are the desk's frames, and `console-pane.test.mjs` pins the
	 * class string against a splice.
	 */
	resetIntent();
	installBridge({ surfaces: [surfaceRow("con:1:ground")] });
	const { root, container } = await mountPane();
	try {
		await waitFor(() =>
			container.querySelector('[data-tour-tag="console-mirror"]'),
		);
		const host = container.querySelector('[data-tour-tag="console-mirror"]');
		assert.ok(host, "the mirror never rendered, so there is no box to judge");
		const box = host.parentElement;
		assert.ok(
			box.classList.contains("px-2"),
			"the terminal's box lost the gutter the grid is inset by",
		);
		assert.ok(
			box.classList.contains("bg-sunken"),
			"the terminal's box does not paint the terminal's ground, so the pane's ground frames it (#929)",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

/* ------------------------------------------------------------------ ended */

/**
 * THE OPERATOR'S FRAME (2026-10-21): an exited console looked alive. These cells
 * pin the three painterly facts the report named — no live-looking treatment, a
 * pane-owned end marker where the prompt was, and a key that announces itself
 * instead of vanishing — plus the open decision beside them, because the same
 * defect had a navigation half: opening with nothing live landed on the dead
 * history.
 */
const HISTORY_MARKER = '[data-tour-tag="console-history-end"]';
const HISTORY_ANNOUNCE = '[data-tour-tag="console-history-announce"]';

test("an ended surface paints dimmed history and a pane-owned end marker, never a live prompt", async () => {
	resetIntent();
	installBridge({
		surfaces: [
			surfaceRow("con:1:ended", { running: false, exit_code: 0, live: true }),
		],
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => ENDED_NOTICE.test(container.textContent ?? ""));
		const marker = container.querySelector(HISTORY_MARKER);
		assert.ok(marker, "the ended surface has no end-of-history marker");
		assert.match(
			container.textContent ?? "",
			/End of history/,
			"the marker is English in the English locale",
		);
		assert.match(
			container.textContent ?? "",
			/read-only/,
			"and says what the state means, not just that something ended",
		);
		const mirror = container.querySelector('[data-tour-tag="console-mirror"]');
		assert.ok(mirror, "the mirror should still be mounted over the history");
		assert.equal(
			mirror.contains(marker),
			false,
			"the marker is the pane's chrome, not bytes inside the terminal",
		);
		const live = container.querySelector(
			'[data-tour-tag="console-history-end"]',
		);
		assert.ok(live, "and it stays present while the history is shown");
		assert.equal(
			container.querySelector(HISTORY_ANNOUNCE)?.textContent,
			"",
			"nothing is announced until a key arrives",
		);

		// A key into the ended terminal. jsdom has no xterm DOM, so the event is
		// dispatched from a child of the mirror's own host — the subtree the pane's
		// capture guard addresses.
		const target = document.createElement("div");
		mirror.append(target);
		target.dispatchEvent(
			new KeyboardEvent("keydown", { key: "a", bubbles: true }),
		);
		await waitFor(() =>
			/that key was not sent/.test(
				container.querySelector(HISTORY_ANNOUNCE)?.textContent ?? "",
			),
		);
		assert.match(
			container.querySelector(HISTORY_ANNOUNCE)?.textContent ?? "",
			/that key was not sent/,
			"a swallowed key is said out loud rather than silently ignored",
		);
		const announce = container.querySelector(HISTORY_ANNOUNCE);
		assert.equal(
			announce?.tagName,
			"OUTPUT",
			"the announcement is an <output>, whose implicit role is status",
		);
		assert.equal(
			announce?.getAttribute("aria-live"),
			"polite",
			"and it is a polite live region a screen reader announces",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("a live surface has no history marker, so the ended treatment cannot leak", async () => {
	resetIntent();
	installBridge({ surfaces: [surfaceRow("con:1:live")] });
	const { root, container } = await mountPane();
	try {
		await waitFor(() => TERMINAL.test(container.textContent ?? ""));
		assert.equal(
			container.querySelector(HISTORY_MARKER),
			null,
			"a running terminal must not carry the ended marker",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("a refused key re-announces, and navigation never claims it was not sent (U2/m-3)", async () => {
	resetIntent();
	installBridge({
		surfaces: [
			surfaceRow("con:1:ended", { running: false, exit_code: 0, live: true }),
		],
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => ENDED_NOTICE.test(container.textContent ?? ""));
		const mirror = container.querySelector('[data-tour-tag="console-mirror"]');
		const announce = () => container.querySelector(HISTORY_ANNOUNCE);
		const dispatch = (key, options = {}) => {
			const target = document.createElement("div");
			mirror.append(target);
			target.dispatchEvent(
				new KeyboardEvent("keydown", { key, bubbles: true, ...options }),
			);
		};

		// Navigation and chords are somebody else's: no refusal sentence.
		for (const key of ["Tab", "Escape", "PageUp", "ArrowUp", "Home"]) {
			dispatch(key);
			await settle(70);
			assert.equal(
				announce()?.textContent,
				"",
				`${key} is not terminal input and must not be announced as refused`,
			);
		}
		dispatch("a", { metaKey: true });
		await settle(70);
		assert.equal(announce()?.textContent, "", "a chord is not announced");

		// A printable key announces, and a second press of the same key announces
		// AGAIN: the live region's text changes on every press.
		dispatch("a");
		await waitFor(() =>
			/that key was not sent/.test(announce()?.textContent ?? ""),
		);
		const first = Number(announce()?.getAttribute("data-announce-seq"));
		dispatch("b");
		await waitFor(
			() => Number(announce()?.getAttribute("data-announce-seq")) > first,
		);
		await waitFor(() =>
			/that key was not sent/.test(announce()?.textContent ?? ""),
		);
		assert.ok(first >= 1, "the first refusal was counted");
	} finally {
		root.unmount();
		container.remove();
	}
});

test("an ended tab labels its code, and a signalled exit says how it died (D5/Q-3)", async () => {
	resetIntent();
	installBridge({
		surfaces: [
			surfaceRow("con:1:code", {
				running: false,
				exit_code: 7,
				live: true,
				last_activity: 100,
			}),
			surfaceRow("con:2:signal", {
				running: false,
				exit_code: 0,
				exit_signal: "SIGKILL",
				live: true,
				last_activity: 200,
			}),
		],
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => container.querySelector('[data-surface="con:1:code"]'));
		const codeTab = container.querySelector('[data-surface="con:1:code"]');
		assert.match(codeTab.textContent ?? "", /exit 7/);
		const signalTab = container.querySelector('[data-surface="con:2:signal"]');
		assert.match(
			signalTab.textContent ?? "",
			/SIGKILL/,
			"a signalled exit shows its signal, not a clean zero",
		);
		await waitFor(() => /killed by SIGKILL/.test(container.textContent ?? ""));
	} finally {
		root.unmount();
		container.remove();
	}
});

test("a create's round trip shows its pending cue beside existing history (U5)", async () => {
	resetIntent();
	const ended = [
		surfaceRow("con:1:a", { running: false, exit_code: 0, live: true }),
	];
	installBridge({
		surfaces: ended,
		create: async ({ setListing }) => {
			await new Promise((r) => setTimeout(r, 300));
			const fresh = surfaceRow("con:2:fresh");
			setListing([...ended, fresh]);
			return { surface: fresh.surface };
		},
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => ENDED_NOTICE.test(container.textContent ?? ""));
		pressOpenConsole();
		await waitFor(() =>
			/Starting a console/.test(
				container.querySelector('[data-tour-tag="console-starting"]')
					?.textContent ?? "",
			),
		);
		await waitFor(
			() =>
				container.querySelector('[data-tour-tag="console-starting"]') === null,
			{ timeoutMs: 5000 },
		);
		assert.match(container.textContent ?? "", TERMINAL);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("a hidden completion's mark survives the open's fallback display until its row is looked at (Q-2)", async () => {
	resetIntent();
	const ended = surfaceRow("con:1:ended", {
		running: false,
		exit_code: 0,
		live: true,
	});
	harness.useUiPreferencesStore.setState({
		consoleUnseen: [
			{ sessionId: SESSION, surface: "con:1:ended", at: Date.now() },
		],
	});
	installBridge({
		surfaces: [ended],
		create: async ({ setListing }) => {
			await new Promise((r) => setTimeout(r, 200));
			const fresh = surfaceRow("con:2:fresh");
			setListing([ended, fresh]);
			return { surface: fresh.surface };
		},
	});
	const marked = () =>
		harness.useUiPreferencesStore
			.getState()
			.consoleUnseen.some((mark) => mark.surface === "con:1:ended");
	// jsdom reports no window focus; the clearing rule has a focus half, so the cell
	// supplies it rather than testing the branch that returns early.
	const realHasFocus = document.hasFocus;
	document.hasFocus = () => true;
	const { root, container } = await mountPane();
	try {
		await waitFor(() => ENDED_NOTICE.test(container.textContent ?? ""));
		pressOpenConsole();
		// While the create runs, the pane's fallback display is the ended row. The
		// mark must NOT be consumed by that transient paint.
		await settle(80);
		assert.equal(marked(), true, "the mark survived the creating window");
		await waitFor(
			() => container.querySelector('[data-surface="con:2:fresh"]') !== null,
			{ timeoutMs: 5000 },
		);
		await settle(80);
		assert.equal(
			marked(),
			true,
			"and it survives the new live surface being selected: it names the ended one",
		);
		// Looking at the ended row itself is what clears it.
		await press(
			container.querySelector('[data-surface="con:1:ended"] [role="tab"]'),
		);
		await waitFor(() => !marked(), {
			timeoutMs: 3000,
		});
	} finally {
		document.hasFocus = realHasFocus;
		harness.useUiPreferencesStore.setState({ consoleUnseen: [] });
		root.unmount();
		container.remove();
	}
});

test("two ended surfaces are created over, not focused, by the user's open", async () => {
	resetIntent();
	const ended = [
		surfaceRow("con:1:a", { running: false, exit_code: 0, live: true }),
		surfaceRow("con:2:b", { running: false, exit_code: 1, live: true }),
	];
	installBridge({
		surfaces: ended,
		create: async ({ setListing }) => {
			const fresh = surfaceRow("con:3:fresh");
			setListing([...ended, fresh]);
			return { surface: fresh.surface };
		},
	});
	const { root, container } = await mountPane();
	try {
		await waitFor(() => ENDED_NOTICE.test(container.textContent ?? ""));
		pressOpenConsole();
		await waitFor(() => container.querySelector(HISTORY_MARKER) === null, {
			timeoutMs: 5000,
		});
		assert.ok(
			container.querySelector(HISTORY_MARKER) === null,
			"the open replaced the recording with a live terminal",
		);
		assert.match(container.textContent ?? "", TERMINAL);
	} finally {
		root.unmount();
		container.remove();
	}
});

test("one live and one ended: the open focuses the live one and creates nothing", async () => {
	resetIntent();
	// The lens is the memory a previous cell could have left; null makes the pane
	// fall back to the most recent row, which is the ended one here.
	harness.useUiPreferencesStore.getState().setConsoleActiveSurface(null);
	installBridge({
		surfaces: [
			surfaceRow("con:1:live", { last_activity: 100 }),
			surfaceRow("con:2:ended", {
				running: false,
				exit_code: 0,
				live: true,
				last_activity: 300,
			}),
		],
		create: async () => {
			throw new Error("the open must not create when a live surface exists");
		},
	});
	const { root, container } = await mountPane();
	try {
		// The lens starts on the newest row, which is the ended one; the open moves it.
		await waitFor(() => ENDED_NOTICE.test(container.textContent ?? ""));
		pressOpenConsole();
		await waitFor(
			() =>
				harness.useUiPreferencesStore.getState().consoleActiveSurface ===
				"con:1:live",
		);
		assert.equal(
			harness.useUiPreferencesStore.getState().consoleActiveSurface,
			"con:1:live",
			"the caret lands on the running terminal, not the recording",
		);
		assert.equal(
			container.querySelector(HISTORY_MARKER),
			null,
			"and the ended treatment leaves the pane with it",
		);
	} finally {
		root.unmount();
		container.remove();
	}
});
