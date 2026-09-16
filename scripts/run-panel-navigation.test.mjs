/**
 * The pane's two ways out of a reader, executable: `docs/run-sidebar.md` § 5.5.
 *
 *     node --test scripts/run-panel-navigation.test.mjs
 *
 * WHY THIS FILE EXISTS. The rule it pins is invisible to every other kind of
 * evidence this repository has. A frame cannot carry it - the rig moves a
 * pointer and a still is byte-identical whether Back returned to the roster or
 * took the whole pane with it, because the two states differ by WHICH component
 * is mounted, not by a mark on a screen - and the design doc stated the old rule
 * in prose, which is what the operator's own bug report was against. Round 1's
 * rule (U1-3) sent a first-level Back out of the PANE, on the reasoning that the
 * reader is the pane; the operator reported the consequence from use, which is
 * that a first-level child's page had no way back up to the roster, because
 * Back, the `✕` and the breadcrumb's root crumb all took the same exit. This is
 * that claim, asserted against the SHIPPED pane.
 *
 * WHAT IT DRIVES. The `InteractivePane` harness in `run-details.stories.tsx` -
 * the real `RunPanel` with real state, real callbacks and the production
 * `ChatHeader`, mounted the way `chat-content.tsx` mounts it. That harness
 * exists precisely because these rules are interaction-visible, and driving it
 * rather than a second reproduction is what keeps this test and the story from
 * drifting apart: the story's `onReaderChildChange` writes the state Back reads.
 *
 * The four readings § 5.5 promises, in the order they can break:
 *
 *   1. reader at the first level + Back -> the ROSTER is rendered and the pane
 *      is still mounted (the reported defect: it closed the pane);
 *   2. the breadcrumb's root crumb -> the same landing (the crumb and Back
 *      agree at every depth, this one included);
 *   3. `PanelRightClose` -> the pane is gone (the one control that closes it);
 *   4. reader at depth 2 + Back -> the PARENT's page, i.e. the pop rule above
 *      the first level is untouched.
 *
 * plus the state the drill-in must not lose: the roster's disclosure
 * (`rosterExpanded`) is hoisted to the pane so it survives a drill-in, and a
 * Back that returns to the roster is now a second way to check that it does.
 *
 * And the two readings that are about a CALLBACK rather than a mount, because
 * § 5.5's landing is not "the roster is rendered" but "focus is where it belongs,
 * and is never `<body>`" - the round-2 Q2-1/U2-1 defect, in which the walk found
 * nothing to focus and every later key was refused:
 *
 *   5. Back at the first level -> `document.activeElement` IS the roster row the
 *      reader was opened from;
 *   6. a page the roster's cap hides, reached by the peer stepper -> there is no
 *      row of its own to land on, so focus is the header's trigger.
 *
 * Without 5 and 6 this file was green while the landing had never once run: the
 * walk reaches for `CSS.escape` as a bare global, jsdom ships no `CSS`, and the
 * `ReferenceError` thrown inside the walk's own `requestAnimationFrame` callback
 * is swallowed because nothing reads its effect (review R1-1, QA Q1 - found
 * independently, which is the reason both readings exist as assertions now).
 *
 * HOW IT STANDS IN FOR A BROWSER. jsdom, with React's own scheduler: this repo
 * ships jsdom (the same rig `suggestion-stack-react.test.mjs` uses) and the
 * assertions are structural - which components are mounted, what the current
 * breadcrumb crumb says, and where the DOM says focus is - not geometric, so a
 * DOM without a layout engine is the honest instrument. What this cannot show is
 * PIXELS: it is not visual evidence, and the frames committed under
 * `docs/evidence/` are.
 *
 * Focus is asserted from `document.activeElement`, one real animation frame after
 * the press (the landing is deferred by one rAF by design), against the shipped
 * selectors: the walk focuses a roster row's own button, so the element the
 * assertion names is the element a user presses.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const ROOT = resolve(import.meta.dirname, "..");

/*
 * React DOM feature-detects input events at import time, so a document has to
 * exist before it is loaded (the same bootstrap `suggestion-stack-react.test.mjs`
 * uses) rather than its legacy IE event polyfill being activated.
 */
const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
globalThis.sessionStorage = bootstrap.window.sessionStorage;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrap.window.close();
	/*
	 * `Reflect.deleteProperty` rather than `delete`, and that is not style: the two
	 * are the same operation, but this file has to satisfy `pnpm lint:scripts`
	 * (`scripts/` sits outside `pnpm lint`'s path list, so that gate is the only
	 * thing that reads these files), and its `noDelete` rule flags the operator
	 * form with a fix that is NOT equivalent - `= undefined` leaves the key
	 * present, so a later reader of `"window" in globalThis` would be told the
	 * wrong thing about a global this file set up.
	 */
	for (const name of ["window", "document", "localStorage", "sessionStorage"]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

/*
 * React and React Query stay OUT of the bundle and everything else goes in.
 *
 * React, because the mounted pane has to share THIS process's copy: element
 * symbols and `act` are per-instance, and a second copy would render a tree this
 * test cannot flush. React Query for the same reason one level up - the provider
 * below and the hooks inside the pane have to be the same module, or the context
 * they hand each other is a different object and every query refuses to mount.
 *
 * Everything else is bundled, which is the opposite of what
 * `suggestion-stack-react.test.mjs` does (`packages: "external"` throughout):
 * the pane's body reaches MUI through DEEP specifiers
 * (`@mui/material/styles`), and node's ESM resolver refuses a directory import,
 * so leaving those external makes the bundle unloadable rather than merely
 * larger. The bundle is written to a real file either way, because bare
 * specifiers have to resolve at run time.
 */
const EXTERNAL = /^(react|react-dom|@tanstack\/react-query)(\/.*)?$/;
/** Any bare specifier, so staying out of the bundle means being named above. */
const BARE_SPECIFIER = /^[^./]/;
const CACHE = join(ROOT, "node_modules", ".cache", "run-panel-navigation");
const SOURCE = "src/renderer/src/features/chat/components/run-details";
const bundle = await build({
	stdin: {
		contents: `
			export { InteractivePane } from "./${SOURCE}/run-details.stories";
			export { RunPanel } from "./${SOURCE}/run-panel";
			/*
			 * The production header, because the focus rule's FALLBACK lands on its
			 * trigger (section 5.5 of docs/run-sidebar.md) and a harness without one
			 * could only assert the happy path. It is the same composition the stories
			 * use, so the element the assertion names is the element a user presses.
			 */
			export { ChatHeader } from "./src/renderer/src/features/chat/components/chat-header";
			export { deriveRunDetails } from "./${SOURCE}/run-detail-model";
			export * as fixtures from "./${SOURCE}/run-details.fixtures";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	/*
	 * `module` FIRST: MUI ships both builds and its package `main` is the CJS one
	 * (`./node/index.js`), which calls `require("react")` at run time - a dynamic
	 * require that esbuild's ESM output refuses to carry, so the bundle would load
	 * and then die on the first MUI import. Resolving the ESM build instead makes
	 * React a real (external) import rather than a call.
	 */
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	/*
	 * `import.meta.env` is Vite's, and story modules read it at import time
	 * (`shared/config/app-config.ts` parses the whole schema on load and throws on
	 * an undefined object). Every field in that schema has a default, so an empty
	 * object would be enough for the SCHEMA - the base URL is filled in anyway,
	 * and that is the point of naming it: the schema's default is
	 * `http://localhost:1111`, which on this machine is the operator's OWN running
	 * backend. The pane's header mounts a health poll, so the default would have
	 * this test making real requests to a real service and - measured while this
	 * file was being written - waiting on its answers, which is both a leak into
	 * state this test does not own and a source of minutes-long, load-dependent
	 * run times. A dead port is the isolation the driver harness buys the same way
	 * (`docs/agent-driver.md`): nothing is listening, so the poll refuses at once
	 * and nothing here depends on a service outside this repository.
	 */
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45999" };',
	},
	plugins: [
		{
			name: "react-stays-out",
			setup(builder) {
				builder.onResolve({ filter: BARE_SPECIFIER }, (args) =>
					EXTERNAL.test(args.path) ? { path: args.path, external: true } : null,
				);
			},
		},
	],
	// The stories import the app's stylesheet; none of its rules can act here.
	loader: { ".css": "empty" },
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "pane.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const { InteractivePane, RunPanel, ChatHeader, deriveRunDetails, fixtures } =
	await import(pathToFileURL(bundlePath).href);
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

/* ----------------------------------------------------------------- selectors */

/*
 * The pane's own hooks, not text: a test that found the roster by its copy would
 * pass on the day the copy changed and fail on the day an unrelated heading
 * moved.
 */
const PANE = "[data-run-panel-pane]";
const ROW = "[data-run-panel-row]";
/** The reader's breadcrumb, which only the reader's chrome draws (`§ 5.2`). */
const CRUMB_NAV = 'nav[aria-label="Subagent path"]';
const BACK = 'button[aria-label="Back"]';
const CLOSE = 'button[aria-label="Close run details"]';
const DESCEND = 'button[aria-label="Open 1 child subagent"]';
const DISCLOSURE = "[data-run-panel-disclosure]";
/*
 * The peer stepper, which is the ONLY way to reach a member the roster's cap
 * hides: a hidden member has no row to press (`§ 4`), and the stepper walks the
 * authoritative sibling order rather than the capped slice (`siblingsOf`).
 */
const NEXT = 'button[aria-label="Next subagent"]';
const PREVIOUS = 'button[aria-label="Previous subagent"]';
/** The header's trigger: `leaveReader`'s own fallback target (`§ 5.5`). */
const TRIGGER = "[data-run-panel-trigger]";
/** `job-audit` is a top-level member; `job-verify` is a child of it (§ 4). */
const MEMBER = "job-audit";
/** The grandchild's own label, which is what its crumb says once it is open. */
const GRANDCHILD_LABEL = "Verify the totals";

const currentCrumb = (window) =>
	window.document.querySelector(`${CRUMB_NAV} [aria-current="page"]`)
		?.textContent ?? null;

/**
 * `CSS.escape`, which nothing in this environment provides.
 *
 * jsdom 26 ships no `CSS` object at all (`window.CSS` and `globalThis.CSS` are
 * both `undefined`), and `leaveReader` reaches for the global BARE - so before
 * this existed the focus walk threw `ReferenceError: CSS is not defined` inside
 * its own `requestAnimationFrame` callback, where jsdom swallows it: every case
 * in this file was green while the landing it asserts had never once run (review
 * R1-1, QA Q1). The algorithm is the CSSOM one rather than "these fixture ids
 * happen to be simple", because the row selector is built from an arbitrary id -
 * a leading digit, a colon or a control character must still produce a selector
 * that matches the row it names.
 */
const escapeCssIdent = (value) => {
	const string = String(value);
	let result = "";
	for (let index = 0; index < string.length; index += 1) {
		const code = string.charCodeAt(index);
		if (code === 0x00) {
			result += "\uFFFD";
			continue;
		}
		if (
			(code >= 0x01 && code <= 0x1f) ||
			code === 0x7f ||
			(index === 0 && code >= 0x30 && code <= 0x39) ||
			(index === 1 &&
				code >= 0x30 &&
				code <= 0x39 &&
				string.charCodeAt(0) === 0x2d)
		) {
			result += `\\${code.toString(16)} `;
			continue;
		}
		if (
			(index === 0 && code === 0x2d && string.length === 1) ||
			code >= 0x80 ||
			code === 0x2d ||
			code === 0x5f ||
			(code >= 0x30 && code <= 0x39) ||
			(code >= 0x41 && code <= 0x5a) ||
			(code >= 0x61 && code <= 0x7a)
		) {
			result += string.charAt(index);
			continue;
		}
		result += `\\${string.charAt(index)}`;
	}
	return result;
};

/* ------------------------------------------------------------------ harness */

/**
 * A plain DOM for one case, with the shims the shipped components reach for and
 * jsdom does not implement. Only the ones they actually touch, so a component
 * that starts needing another fails loudly here rather than silently no-oping.
 */
async function mount(render) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const { window } = dom;
	const originals = new Map();
	const shims = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Element: window.Element,
		Node: window.Node,
		Event: window.Event,
		CustomEvent: window.CustomEvent,
		MouseEvent: window.MouseEvent,
		KeyboardEvent: window.KeyboardEvent,
		// `leaveReader` defers its focus to the next frame, and it calls these BARE
		// rather than off the window, so jsdom's own `window.requestAnimationFrame`
		// is not enough.
		requestAnimationFrame: window.requestAnimationFrame.bind(window),
		cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
		/*
		 * `leaveReader` builds its row selector with `CSS.escape`, BARE, and jsdom
		 * provides no `CSS` at all. It is listed here because the focus cases below
		 * FAIL without it - and the reason they did not before is worth keeping: a
		 * missing global reached from inside a rAF callback produces an uncaught
		 * error jsdom swallows, so this map's "fails loudly" promise needs an
		 * assertion that actually reads the effect, not just the list (R1-1, Q1).
		 */
		CSS: { escape: escapeCssIdent },
		// Radix reads a node's computed style to tell a real `<button>` from a
		// non-element child; it reaches for the BARE global, like the two above.
		getComputedStyle: window.getComputedStyle.bind(window),
		// The UI-preferences store persists through zustand, which reaches for the
		// GLOBAL storage at each write rather than for this window's.
		localStorage: window.localStorage,
		sessionStorage: window.sessionStorage,
		IS_REACT_ACT_ENVIRONMENT: true,
		// MUI's `useMediaQuery` refuses without one, and the reader's own body is
		// the parent's transcript grammar, which is MUI-backed.
		matchMedia: (query) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener() {},
			removeListener() {},
			addEventListener() {},
			removeEventListener() {},
			dispatchEvent: () => false,
		}),
		ResizeObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	};
	for (const [key, value] of Object.entries(shims)) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: shims.matchMedia,
	});
	const client = new QueryClient({
		/*
		 * `gcTime: 0` is not a simplification: React Query's default is five minutes
		 * of garbage-collection timer per unmounted cache, and `node --test` waits
		 * for the event loop to drain - so the default makes this file sit for five
		 * minutes after its assertions have passed. Nothing here reads a cache twice
		 * across an unmount, so there is nothing for a collection window to protect.
		 */
		defaultOptions: {
			queries: { retry: false, gcTime: 0 },
			mutations: { retry: false, gcTime: 0 },
		},
	});
	const root = createRoot(window.document.getElementById("root"));
	const api = {
		window,
		document: window.document,
		pane: () => window.document.querySelector(PANE),
		reader: () => window.document.querySelector(CRUMB_NAV),
		rows: () => [...window.document.querySelectorAll(ROW)],
		crumb: () => currentCrumb(window),
		click: async (selector) => {
			const target = window.document.querySelector(selector);
			assert.ok(target, `no element matched ${selector}`);
			/*
			 * Two passes, and neither is a sleep.
			 *
			 * The SYNCHRONOUS one runs the press: Radix's own handlers, the store
			 * write, the effects it starts and the DOM they produce - all of it is
			 * flushed by the time this call returns, which is what lets every
			 * assertion below be a statement about the DOM rather than about a
			 * clock. The EMPTY async act that follows is React's own "flush what
			 * the press scheduled" pass (Radix defers a tooltip's own open), and it
			 * is bounded by that work rather than by any duration this test picks.
			 *
			 * Why the split is deliberate: an AWAITED act whose callback dispatches
			 * the press keeps flushing until React's queue is quiet, and this pane
			 * unmounts a transcript of MUI-backed rows when it closes - that pass
			 * was measured at 110-160 s on a host at load average 85-106, against
			 * 0.9 s for the synchronous form in the same runs. The wait was real
			 * and the assertions were idle behind it, which is exactly the shape a
			 * gate must not have.
			 */
			act(() => {
				target.dispatchEvent(
					new window.MouseEvent("click", {
						bubbles: true,
						cancelable: true,
					}),
				);
			});
			await act(async () => {});
		},
		render: async (element) => {
			// The same two-pass shape as `click`, for the same reason.
			act(() => {
				root.render(
					React.createElement(QueryClientProvider, { client }, element),
				);
			});
			await act(async () => {});
		},
	};
	try {
		await render(api);
	} finally {
		act(() => root.unmount());
		await act(async () => {});
		client.clear();
		window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	}
}

/** The `InteractivePane` story's own element, rendered as Storybook renders it. */
const interactivePane = () => InteractivePane.render();

/**
 * A row that can actually be opened, by its own hook.
 *
 * Not "the first row": a capped roster leads with its priority slice, and a
 * settled or failed member has no button at all - the interactive row is only
 * offered for a child the runtime can still address (`§ 10.2`).
 */
const openableRow = (api) =>
	[...api.document.querySelectorAll(ROW)].find((entry) =>
		entry.querySelector("button"),
	);

/**
 * Open a member's reader the way a user does: the roster's own row button.
 *
 * `leaveReader` focuses `[data-run-panel-row="<id>"] button`, which is the same
 * element, so the selector is the shipped one rather than a test-only hook.
 */
const openMember = async (api, id = MEMBER) => {
	await api.click(`[data-run-panel-row="${id}"] button`);
	assert.ok(api.reader(), "the reader's breadcrumb should be on screen");
	assert.equal(
		api.rows().length,
		0,
		"the reader replaces the roster rather than sitting beside it",
	);
};

/**
 * One real animation frame, which is what `leaveReader`'s landing waits for.
 *
 * The focus walk is deferred by ONE rAF - the roster has to paint before its
 * button can take focus - and jsdom's rAF is a real timer rather than a
 * synchronous flush, so reading `activeElement` straight after the press reads the
 * state BEFORE the landing rather than the landing itself.
 */
const nextFrame = (window) =>
	new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

/**
 * Let the landing settle: the walk's own frame, then one more.
 *
 * This promise is registered after the press, so within a frame it runs behind
 * the pane's own callback; the second frame is what separates "it landed" from
 * "it landed and stayed" - the difference a landing undone by its own re-render
 * would otherwise hide.
 */
const settleFocus = async (window) => {
	await nextFrame(window);
	await nextFrame(window);
};

/**
 * Where focus actually is, as one short string.
 *
 * The assertions compare THIS rather than the node, and that is a correctness
 * point rather than a taste one: `assert.equal` on two jsdom elements makes
 * node build a structural diff of two whole DOM trees, and on a failure that
 * cost measured minutes before the process was killed for memory - a failing
 * case would have reported an out-of-memory kill instead of the landing it
 * found. This string can only be one of a few things, so the same failure
 * reports as `body` and reads at a glance.
 */
const focused = (api) => {
	const element = api.document.activeElement;
	if (!element || element === api.document.body) return "body";
	if (element.closest(TRIGGER)) return "trigger";
	const row = element.closest("[data-run-panel-row]")?.dataset.runPanelRow;
	return row
		? `${element.tagName.toLowerCase()} in row ${row}`
		: `${element.tagName.toLowerCase()}[aria-label="${element.getAttribute("aria-label") ?? ""}"]`;
};

/**
 * Step the peer stepper until its page is `label`, in ONE direction.
 *
 * Bounded by the sibling count rather than by a timeout, and it stops when the
 * control is disabled rather than pressing a button that refuses.
 */
const stepUntil = async (api, selector, label, limit) => {
	for (let step = 0; step < limit; step += 1) {
		if (api.crumb() === label) return true;
		const control = api.document.querySelector(selector);
		if (!control || control.disabled) return false;
		await api.click(selector);
	}
	return api.crumb() === label;
};

/**
 * A harness for the one claim the story's fixture cannot carry: `crowded()` has
 * more members than the roster's cap, so it is the fixture with a disclosure to
 * lose. Otherwise it is the story's harness, one prop apart.
 */
const crowdedHarness = () => {
	const details = React.useMemo(() => deriveRunDetails(fixtures.crowded()), []);
	const [readerChildId, setReaderChildId] = React.useState(null);
	return React.createElement(
		"div",
		{ className: "flex h-screen overflow-hidden" },
		/*
		 * The same composition as the story's own ground - the production header
		 * above the pane, not a pane on its own - because `leaveReader`'s FALLBACK
		 * target is the header's trigger (`§ 5.5`), and a harness without one could
		 * only ever assert the case where a row is waiting to be focused.
		 */
		React.createElement(
			"div",
			{ className: "flex min-w-0 flex-1 flex-col" },
			React.createElement(ChatHeader, {
				agentName: "Core",
				description: "Invoices workspace · on this machine",
				onOpenOptions: () => undefined,
				runDetails: details,
				mcpServers: [],
				listOnScreen: readerChildId === null,
				readerChildId,
			}),
		),
		React.createElement(RunPanel, {
			details,
			mcpServers: [],
			mcpGrantRunning: false,
			mcpRemedy: {
				press: () => undefined,
				pressKey: async () => true,
				cancel: () => undefined,
				reload: async () => true,
				pendingName: null,
				failureFor: () => null,
				clearFailure: () => undefined,
				refusalFor: () => null,
			},
			sessionId: "a1b2c3d4e5f6",
			pulses: {},
			childrenOpenable: true,
			paneWidth: 420,
			readerChildId,
			previewPage: fixtures.childPage({ includeTool: true }),
			onReaderChildChange: setReaderChildId,
			onClose: () => undefined,
		}),
	);
};

/* -------------------------------------------------------------------- cases */

test("Back at the first level returns to the roster and keeps the pane open", async () => {
	await mount(async (api) => {
		await api.render(interactivePane());
		await openMember(api);
		await api.click(BACK);
		assert.ok(api.pane(), "the pane must still be mounted");
		assert.equal(api.reader(), null, "the reader is left");
		assert.ok(
			api.rows().length > 0,
			"the roster is the view Back lands on (§ 5.5)",
		);
	});
});

test("the breadcrumb's root crumb returns to the roster too", async () => {
	await mount(async (api) => {
		await api.render(interactivePane());
		await openMember(api);
		const root = `${CRUMB_NAV} button`;
		assert.equal(
			api.document.querySelector(root).textContent,
			"Run details",
			"the root crumb is the first button of the breadcrumb",
		);
		await api.click(root);
		assert.ok(api.pane(), "the pane must still be mounted");
		assert.equal(api.reader(), null, "the reader is left");
		assert.ok(api.rows().length > 0, "the roster is rendered");
	});
});

test("Close run details is the control that closes the pane", async () => {
	await mount(async (api) => {
		await api.render(interactivePane());
		await openMember(api);
		await api.click(CLOSE);
		assert.equal(api.pane(), null, "the pane is gone");
		assert.equal(api.reader(), null, "and with it the reader");
	});
});

test("Back at depth 2 still lands on the parent's page", async () => {
	await mount(async (api) => {
		await api.render(interactivePane());
		await openMember(api);
		const member = api.crumb();
		assert.ok(member, "the member's page names itself in the breadcrumb");
		await api.click(DESCEND);
		assert.equal(
			api.crumb(),
			GRANDCHILD_LABEL,
			"descending moves the current crumb to the child's page",
		);
		await api.click(BACK);
		assert.ok(api.pane(), "the pane stays mounted at every depth");
		assert.ok(api.reader(), "still a reader: one level up is not out");
		assert.equal(
			api.crumb(),
			member,
			"one level up is the page the reader came from",
		);
	});
});

test("the roster's disclosure survives leaving the reader", async () => {
	await mount(async (api) => {
		await api.render(React.createElement(crowdedHarness));
		/*
		 * The disclosure's own NAME is the measurement, not its `data-` value: the
		 * control unmounts once nothing is hidden (`hidden > 0` gates it), so
		 * "expanded" is the state in which NO disclosure is on screen and the whole
		 * roster is. A capped roster is 6 rows plus the control; an expanded one is
		 * every member and no control.
		 */
		assert.ok(
			api.document.querySelector(DISCLOSURE),
			"the fixture is over the cap, so the disclosure is on screen",
		);
		const capped = api.rows().length;
		await api.click(DISCLOSURE);
		const expanded = api.rows().length;
		assert.ok(
			expanded > capped,
			`expanding renders the hidden members (${capped} -> ${expanded})`,
		);
		assert.equal(
			api.document.querySelector(DISCLOSURE),
			null,
			"nothing is hidden any more, so the control stands down",
		);
		const member = openableRow(api);
		assert.ok(member, "an opened member needs a row to leave");
		await api.click(
			`[data-run-panel-row="${member.dataset.runPanelRow}"] button`,
		);
		assert.ok(api.reader(), "the reader is open");
		await api.click(BACK);
		assert.ok(api.pane(), "the pane is still mounted");
		assert.equal(
			api.rows().length,
			expanded,
			"the disclosure is hoisted to the pane, so a drill-in and back cannot collapse the roster under the reader (§ 4)",
		);
	});
});

test("Back at the first level lands focus on the row the reader came from", async () => {
	await mount(async (api) => {
		await api.render(interactivePane());
		const row = openableRow(api);
		assert.ok(row, "the walk needs a row to open");
		const id = row.dataset.runPanelRow;
		await api.click(`[data-run-panel-row="${id}"] button`);
		assert.ok(api.reader(), "the reader is open");
		await api.click(BACK);
		assert.equal(api.reader(), null, "the reader is left");
		await settleFocus(api.window);
		assert.equal(
			focused(api),
			`button in row ${id}`,
			"focus lands on the row's own button - the row the reader was opened from (§ 5.5)",
		);
		assert.notEqual(
			focused(api),
			"body",
			"and never on <body> - the round-2 Q2-1/U2-1 state, in which every later key was refused",
		);
	});
});

test("a member the roster's cap hides lands focus on the trigger", async () => {
	await mount(async (api) => {
		await api.render(React.createElement(crowdedHarness));
		const rendered = new Set(
			api.rows().map((entry) => entry.dataset.runPanelRow),
		);
		const members = deriveRunDetails(fixtures.crowded()).subagents;
		const hidden = members.find((member) => !rendered.has(member.id));
		assert.ok(
			hidden,
			`the fixture is over the cap (${rendered.size} rows of ${members.length} members)`,
		);
		const row = openableRow(api);
		assert.ok(row, "the walk needs a row to open");
		await api.click(`[data-run-panel-row="${row.dataset.runPanelRow}"] button`);
		assert.ok(api.reader(), "the reader is open");
		/*
		 * The ONLY route to this page: a hidden member has no row to press, and the
		 * stepper walks the authoritative sibling order rather than the capped slice,
		 * so it can name a member the roster is not showing.
		 */
		const reached =
			(await stepUntil(api, NEXT, hidden.label, members.length)) ||
			(await stepUntil(api, PREVIOUS, hidden.label, members.length));
		assert.ok(
			reached,
			`the stepper reaches ${hidden.label}, which has no row of its own`,
		);
		await api.click(BACK);
		assert.equal(api.reader(), null, "the reader is left");
		await settleFocus(api.window);
		assert.equal(
			api.document.querySelector(`[data-run-panel-row="${hidden.id}"]`),
			null,
			"the landing page has no row of its own once the roster is capped again",
		);
		assert.equal(
			focused(api),
			"trigger",
			"so the fallback lands on the trigger (§ 5.5)",
		);
		assert.notEqual(focused(api), "body", "and never on <body>");
	});
});
