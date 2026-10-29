import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement } from "react";

/*
 * THE START PAGE AFTER A REFUSED ADDRESS (LOH-13 B, F1 round 2).
 *
 * WHY THIS FILE EXISTS, AND WHY THE ASSERTION IS MADE HERE RATHER THAN IN
 * `browser-chrome.test.mjs`. That file renders with `renderToStaticMarkup`,
 * which runs no effects and holds no state — so it can never observe the thing
 * this finding is about: what the surface DOES after an intent is refused. QA
 * round 1 found the defect through a runtime reading on the START PAGE'S OWN
 * FIELD, and its reproduction is the one this file encodes: submit an invalid
 * address from that field and the surface must come BACK to the start page with
 * the address restored, rather than stranding a blank rectangle behind the band.
 *
 * WHAT IT DRIVES. The SHIPPED `BrowserSurface`, mounted under jsdom against a
 * fake bridge whose `navigate` rejects the way main does for an unparseable
 * address (the preload forwards main's refusal as a rejection), and whose
 * `state` answers the tab's own projection. The field is filled and submitted
 * through real DOM events, so the component's own submit path runs.
 *
 * WHAT IS AND IS NOT EVIDENCE. jsdom has no layout engine and no native view:
 * what this asserts is the DOM contract — which surface is on screen and what
 * the field holds. The native half (the view actually hidden and restored in
 * the running app) belongs to `scripts/browser-chrome-proof.mjs`.
 */

// React DOM feature-detects input events at import time, so the document has to
// exist before it is loaded. A real origin, not jsdom's opaque default.
const dom = new JSDOM(
	'<!doctype html><html><body><div id="root"></div></body></html>',
	{
		pretendToBeVisual: true,
		url: "http://localhost/",
	},
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
/*
 * zustand's persist middleware writes through storage on every `setState`, and
 * `useCanonicalSessionsStore` (which the surface reads for its group chips) is
 * persisted: without a storage object the write throws inside the middleware.
 * The same shim `browser-chrome.test.mjs` carries, for the same reason.
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
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Accessors jsdom defines on the window take no new value; the DOM globals
		// this file needs are the ones already copied above.
	}
}
// jsdom implements neither, and the surface's own effects construct both.
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
dom.window.Element.prototype.scrollIntoView = () => {};
/*
 * `:modal` IS A JSDOM LANDMINE (measured 2026-09-28, recorded in
 * `browser-tab-strip-focus.test.mjs`): floating-ui's ancestor probe calls
 * `matches(":modal")`, which jsdom 26.1.0 answers by delegating back into its
 * own selector engine and spinning. A browser without `:modal` answers a
 * SyntaxError, which is what floating-ui's own try/catch is written for, so the
 * probe is made to answer that way here.
 */
const nativeMatches = dom.window.Element.prototype.matches;
dom.window.Element.prototype.matches = function matches(selector) {
	if (String(selector).includes(":modal")) {
		throw new dom.window.DOMException(
			":modal is not supported here",
			"SyntaxError",
		);
	}
	return nativeMatches.call(this, selector);
};
// React 18 reads this to decide whether `act` is real; without it every effect
// flush warns instead of being batched with the render it belongs to.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// `act` is imported here and `createRoot` inside the ENTRY bundle (which renders
// the surface): the test process only needs to drive flushes.
const { act } = await import("react");
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});
/*
 * The entry module is generated rather than committed as a fixture because the
 * subject is a COMPONENT: it takes the surface's own props and drives the same
 * controls the app's do.
 */
const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { BrowserSurface } from "./src/renderer/src/features/browser/components/browser-surface";
import { browserOwnStateFor } from "./src/renderer/src/features/browser/model/start-page";
export { browserOwnStateFor };

/**
 * Mount the surface over a fake bridge.
 *
 * THE BRIDGE MODELS MAIN. \"state\" answers the projection a real host would
 * publish — which is what makes this an end-to-end reading of the surface's own
 * gate rather than a unit test of a predicate. \"navigate\" REJECTS for an
 * unparseable address, exactly as the preload forwards main's \"nav_failed\"
 * ("that is not a URL", host.ts) for a stray string like "foo bar".
 *
 * The projection is FIXED at the start state: a refused navigation creates no
 * page, so this is the truth main would be publishing throughout — and it is
 * also the state that proves the fix, because the old gate hid the start page
 * against exactly this projection.
 */
export function mount(container, options = {}) {
	const { refuse = true } = options;
	/*
	 * A MUTABLE PROJECTION, because F6 needs a real unmount and F3 needs two tabs.
	 * A fixed startState cannot produce either: to pin restoreAddress the start
	 * page must UNMOUNT between the refusal and the re-read (otherwise React keeps
	 * the draft and removing the seed still passes), and to pin the per-tab keying a
	 * fresh tab must become active while the refused tab keeps its own note.
	 */
	const START = { url: "about:blank", title: "", loading: false };
	const state = {
		tabs: [
			{
				tabId: 1,
				title: "",
				url: "about:blank",
				owner: "user",
				sessionId: null,
				active: true,
				restored: false,
				handedOver: false,
				failed: false,
				loading: false,
			},
		],
		activeTabId: 1,
		url: "about:blank",
		title: "",
		loading: false,
		canGoBack: false,
		canGoForward: false,
		pendingConsent: [],
		approvals: [],
		navFailure: null,
	};
	const refused = [];
	/**
	 * EVERY view-visibility report, in order, as [visible, ownPage, ownStatePage].
	 *
	 * "ownPage" is the surface's answer to "why is the native view hidden?": its
	 * own state page (start page / load failure) versus an overlay covering the
	 * content area. Main keys shortcut ownership on the difference, so the pair
	 * is the wire contract this fake bridge records rather than infers.
	 */
	const visibility = [];
	/** Republish what state now holds, so every mounted reader sees the change. */
	let notify = () => {};
	const explicit = {
		state: async () => structuredClone(state),
		setViewVisible: async (visible, ownPage, ownStatePage) => {
			visibility.push([
				visible,
				ownPage === true,
				(ownStatePage ?? ownPage) === true,
			]);
		},
		// The projection store subscribes on the 0 -> 1 consumer edge and stops on
		// the way back, so these have to answer an unsubscribe function. The app's own
		// push is what notify imitates: a real host fires it on every change, and
		// without it a mutated state would never reach the surface.
		onStateChanged: (callback) => {
			notify = callback;
			return () => {
				notify = () => {};
			};
		},
		// The chord reporter subscribes the same way and CALLS the returned
		// unsubscribe on unmount, so it cannot take the Proxy's default (which
		// answers a promise): it needs a real function back.
		onChord: () => () => {},
		onConsentChanged: () => () => {},
		onConsentAttention: () => () => {},
		// REJECTS for an unparseable address when asked to, exactly as the preload
		// forwards main's "nav_failed" ("that is not a URL", host.ts) for a stray
		// string like "foo bar". refuse:false models the ACCEPTED case (F4): the
		// invoke resolves, and main has not yet pushed loading.
		navigate: async (url) => {
			refused.push(url);
			if (!refuse) return;
			throw new Error(
				"Error invoking remote method 'browser-navigate': Error: that is not a URL",
			);
		},
	};
	window.api = {
		browser: new Proxy(explicit, {
			get: (target, key) =>
				key in target ? target[key] : () => Promise.resolve(undefined),
		}),
	};
	const surface = () =>
		createElement(BrowserSurface, {
			tabScope: "all",
			requestScope: "all",
			hostSessionId: null,
			surfaceTag: "browser-route",
			dockSurfaceTag: "browser-route-dock",
		});
	const root = createRoot(container);
	root.render(surface());
	return {
		refused: () => refused,
		/** The visibility reports the surface has sent, in order. */
		visibility: () => visibility,
		/** Unmount everything, as leaving the route (or a tab switch that unmounts
		 * the start page) does. Used to prove restoreAddress is what puts the
		 * address back rather than a surviving draft (F6). */
		unmount: () => root.unmount(),
		/** Mount again from scratch, with the SAME bridge and state. */
		remount: () => {
			const again = createRoot(container);
			again.render(surface());
			return again;
		},
		/** Land a real page in tab 1, as main's own push would report it. */
		land: (url) => {
			state.tabs[0].url = url;
			state.tabs[0].title = "Loaded";
			state.url = url;
			state.title = "Loaded";
			notify();
		},
		/** Open + activate a FRESH tab, the cross-tab case F3 is about. */
		openFreshTab: () => {
			state.tabs[0].active = false;
			state.tabs.push({
				tabId: 2,
				title: "",
				url: "about:blank",
				owner: "user",
				sessionId: null,
				active: true,
				restored: false,
				handedOver: false,
				failed: false,
				loading: false,
			});
			state.activeTabId = 2;
			state.url = START.url;
			state.title = START.title;
			notify();
		},
		/** Switch back to tab 1, whose own note must still be there. */
		activateTab: (tabId) => {
			for (const tab of state.tabs) tab.active = tab.tabId === tabId;
			state.activeTabId = tabId;
			const current = state.tabs.find((tab) => tab.tabId === tabId);
			state.url = current.url;
			state.title = current.title;
			notify();
		},
	};
}
export { suppressBrowserView } from "./src/renderer/src/shared/browser-view-policy";
`;

const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "start-page.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		// `@assets` carries the brand mark, which the start page imports as a `.png`:
		// without the alias and a loader for the binary, esbuild leaves the specifier
		// for Node to resolve and the bundle throws `ERR_MODULE_NOT_FOUND` at import.
		// The image has no assertion here, so it loads empty — the same choice `.css`
		// already made (and the same pair `browser-chrome.test.mjs` carries).
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: { ".css": "empty", ".png": "empty" },
	write: false,
});
const bundlePath = new URL(`./_start-page-${process.pid}.mjs`, import.meta.url);
let mount;
let suppressBrowserView;
let browserOwnStateFor;
try {
	await writeFile(bundlePath, bundle.outputFiles[0].text);
	({ mount, suppressBrowserView, browserOwnStateFor } = await import(
		bundlePath.href
	));
} finally {
	await unlink(bundlePath).catch(() => {});
}

/**
 * What the surface is showing right now, read the way QA read it.
 *
 * SCOPED TO ONE CONTAINER, and that is not tidiness: every test here adds its own
 * mount point, so a document-wide query would find a PREVIOUS test's start page and
 * the readings would be about the wrong tree entirely (measured — the F3 fresh-tab
 * reading came back with the earlier test's "foo bar").
 */
function reading(container) {
	const within = container ?? document;
	// S5: the row is the only address field on every state, including this one.
	const field = within.querySelector('[data-tour-tag="browser-address"]');
	return {
		startPage: !!within.querySelector('[data-tour-tag="browser-start-page"]'),
		fieldValue: field ? field.value : null,
		placeholder: field ? field.placeholder : null,
		// `textContent`, not `innerText`: jsdom implements the first and leaves the
		// second undefined, which is exactly how this reading came back empty.
		band: within.querySelector('[data-tour-tag="browser-error"]')
			? within.querySelector('[data-tour-tag="browser-error"]').textContent
			: "",
	};
}

async function flush() {
	// Several turns: a refusal resolves a promise chain (run -> then), the
	// projection read that follows it is a second await, and a state push
	// (onStateChanged -> refreshBrowserProjection -> publish -> re-render) adds a
	// third. jsdom's microtask queue drains between them, so draining generously
	// here is what keeps the assertions about the surface rather than about timing.
	for (let i = 0; i < 6; i++) {
		await act(async () => {
			await new Promise((resolve) => setImmediate(resolve));
		});
	}
}

/** A clean mount point per test: reusing one container across `createRoot` calls is
 * what React warns about and what made the remount cases fight each other. */
function freshContainer() {
	const host = document.createElement("div");
	document.body.appendChild(host);
	return host;
}

test("an invalid address from the row returns to the start page with the address restored", async () => {
	const container = freshContainer();
	const handle = mount(container);
	await flush();

	assert.ok(
		reading(container).startPage,
		"the fresh tab shows the start page before anything is attempted",
	);
	assert.equal(
		reading(container).fieldValue,
		"",
		"and its field starts empty, so a restored value below is the fix rather than a leftover",
	);
	assert.equal(
		reading(container).placeholder,
		"example.com",
		"the empty start field carries the brief's placeholder rather than a bare globe",
	);

	// Drive the page's OWN field: the path QA's first matrix missed, and the one
	// the finding is about.
	const field = container.querySelector('[data-tour-tag="browser-address"]');
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(field, "refused.example");
		field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
	await act(async () => {
		field.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await flush();

	assert.deepEqual(
		handle.refused(),
		["refused.example"],
		"the typed address reached main through the surface's own navigate path",
	);
	const after = reading(container);
	assert.ok(
		after.startPage,
		`the start page comes back after the refusal, so the user has a surface to retry from (reading: ${JSON.stringify(after)})`,
	);
	assert.equal(
		after.fieldValue,
		"refused.example",
		`the refused address is restored into the field rather than lost with the unmount (reading: ${JSON.stringify(after)})`,
	);
	assert.ok(
		after.band.length > 0,
		`and the refusal is still stated in the band above (band: ${JSON.stringify(after.band)})`,
	);
	// Unmount so the SHARED projection store's subscription stops: it is a
	// module-level singleton, and a tree left mounted keeps the next test's bridge
	// from ever being registered (its `onStateChanged` is only called on the 0 -> 1
	// consumer edge).
	await act(async () => {
		handle.unmount();
	});
});

/*
 * The shared driver for the three cases below: type an address into the start
 * page's own field and submit it. Extracted because every test here drives the
 * same control, and a second copy of the event sequence is a second thing to keep
 * in step with the component.
 */
async function submitFromStartField(container, value) {
	// S5: the permanent row is the field the start state types into. Enter is the
	// commit path the row owns (there is no form to submit any more).
	const field = container.querySelector('[data-tour-tag="browser-address"]');
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(field, value);
		field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
	await act(async () => {
		field.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
}

test("the restored address SURVIVES the page being destroyed and rebuilt (F6, round 3)", async () => {
	// WHY THIS IS A SEPARATE TEST FROM F1. The F1 test leaves the start page
	// MOUNTED across the refusal, and React keeps a mounted component's state — so
	// its field would still hold the draft even if the `restoreAddress` seeding did
	// not exist, and the test would pass with that seeding deleted. This test
	// destroys the page between the refusal and the re-read, which is the only way
	// to make the seed the thing under test.
	//
	// HOW THE PAGE IS DESTROYED, AND WHY NOT BY UNMOUNTING THE SURFACE. Unmounting
	// `BrowserSurface` would take the HOOK's state with it (the refused note lives
	// there), so the address could not come back for any implementation — that would
	// assert the wrong thing. The real unmount is a TAB SWITCH: the surface renders
	// one start page, for the active tab, keyed by that tab (`browser-surface.tsx`),
	// so making another tab active destroys tab 1's page instance and switching back
	// builds a fresh one with an empty draft. The address must therefore come from
	// the seeded note. This is also a real user flow, not a synthetic one.
	const container = freshContainer();
	const handle = mount(container);
	await flush();

	await submitFromStartField(container, "refused.example");
	await flush();
	assert.equal(
		reading(container).fieldValue,
		"refused.example",
		"the refusal restored the address",
	);

	// Tab 2 becomes active: tab 1's start page is destroyed.
	await act(async () => {
		handle.openFreshTab();
	});
	await flush();

	// Back to tab 1: a BRAND NEW page instance (empty draft) whose field can only
	// hold the address if it was seeded from the note.
	await act(async () => {
		handle.activateTab(1);
	});
	await flush();
	assert.equal(
		reading(container).fieldValue,
		"refused.example",
		"the address is seeded into the rebuilt page; with the seed removed this reads empty",
	);
	await act(async () => {
		handle.unmount();
	});
});

test("a refused address does NOT leak into a fresh tab, and the refused tab keeps its own (F3, round 3)", async () => {
	// THE CROSS-TAB LEAK, exactly as the reviewer reproduced it: refuse an address on
	// tab 1, then open a fresh tab and read its start field. With a hook-level note
	// the fresh tab is seeded with tab 1's address; keyed to its own tab it starts
	// EMPTY, and switching back to tab 1 still restores tab 1's address.
	const container = freshContainer();
	const handle = mount(container);
	await flush();

	await submitFromStartField(container, "refused.example");
	await flush();
	assert.equal(
		reading(container).fieldValue,
		"refused.example",
		"tab 1 restored its refused address",
	);

	// A fresh tab becomes active: its field must be empty.
	await act(async () => {
		handle.openFreshTab();
	});
	await flush();
	const fresh = reading(container);
	assert.ok(fresh.startPage, "the fresh tab shows its own start page");
	assert.equal(
		fresh.fieldValue,
		"",
		`a fresh tab starts empty rather than inheriting another tab's refused address (reading: ${JSON.stringify(fresh)})`,
	);

	// Back to tab 1: its own address is still there.
	await act(async () => {
		handle.activateTab(1);
	});
	await flush();
	assert.equal(
		reading(container).fieldValue,
		"refused.example",
		"and the tab that made the attempt still restores its own address",
	);
	await act(async () => {
		handle.unmount();
	});
});

test("an ACCEPTED navigation does not linger under the start page (F4, round 3)", async () => {
	// The window F4 is about: the user submits and main ACCEPTS, but the projection
	// still says about:blank / loading:false until main's own did-start-loading push
	// arrives. The start page must not paint over the navigation the user just
	// launched, and the pending note — set synchronously on submit — is what closes
	// that window.
	const container = document.getElementById("root");
	container.innerHTML = "";
	const handle = mount(container, { refuse: false });
	await flush();
	assert.ok(
		reading(container).startPage,
		"the fresh tab shows the start page first",
	);

	await submitFromStartField(container, "example.com");
	await flush();

	assert.deepEqual(
		handle.refused(),
		["example.com"],
		"the submit reached main",
	);
	const after = reading(container);
	assert.ok(
		!after.startPage,
		`an accepted submit does not leave the start page over the navigation (reading: ${JSON.stringify(after)})`,
	);
	await act(async () => {
		handle.unmount();
	});
});

/*
 * THE REASON IS PART OF THE CONTRACT (S4a).
 *
 * The surface hides the native view for its own state pages — the start page and
 * the load-failure panel — because the view is a blank native rectangle that
 * would paint OVER their DOM (design 11.3). Main used to read that hide as "no
 * browser chrome" and refuse Cmd+L/T/R, so the chords died on exactly the two
 * states where the user can see the browser but not a page.
 *
 * WHAT IS ASSERTED HERE: the two facts the surface sends main. `ownPage` true is
 * "this hide is my own state page"; false is "an overlay covers the content
 * area". Main's `chromeVisible` keeps shortcuts for the first and refuses them
 * for the second (`scripts/browser-chord.test.mjs`). jsdom has no native view,
 * so the view's actual paint is not what this reads — the wire contract is.
 */
test("the surface reports WHY the view is hidden: its own state page versus a real overlay", async () => {
	const container = freshContainer();
	const handle = mount(container);
	await flush();
	const visibility = handle.visibility();
	assert.deepEqual(
		visibility.at(-1),
		[false, true, true],
		`the start page hides the view for its OWN page (reports: ${JSON.stringify(visibility)})`,
	);

	// A real dialog over the start page is a DIFFERENT fact: the keyboard belongs
	// to the dialog, not to the browser.
	let release;
	await act(async () => {
		release = suppressBrowserView("dialog:test");
	});
	await flush();
	assert.deepEqual(
		visibility.at(-1),
		[false, false, true],
		`an overlay owns the keyboard, but the START PAGE is still not a controllable page (reports: ${JSON.stringify(visibility)})`,
	);
	await act(async () => release());
	await flush();
	assert.deepEqual(
		visibility.at(-1),
		[false, true, true],
		"closing the dialog restores the state page's keyboard reason",
	);

	// Landing a page restores the native view; the reason no longer applies.
	await act(async () => {
		handle.land("https://example.test/");
	});
	await flush();
	assert.deepEqual(
		visibility.at(-1),
		[true, false, false],
		`a live page shows the native view again (reports: ${JSON.stringify(visibility)})`,
	);
	// The renderer wire for the loaded page under an overlay: neither reason is
	// "own page", so main's `hiddenByOverlay` admits a page control (round-4
	// reviewer minor). This is the counterpart of the start-page case above.
	await act(async () => {
		release = suppressBrowserView("dialog:landed");
	});
	await flush();
	assert.deepEqual(
		visibility.at(-1),
		[false, false, false],
		`a loaded page under an overlay reports no own-state reason (reports: ${JSON.stringify(visibility)})`,
	);
	await act(async () => release());
	await flush();
	assert.deepEqual(visibility.at(-1), [true, false, false]);
	await act(async () => {
		handle.unmount();
	});
});

test("own-state treats an empty start projection as a page to refuse until a submission is pending", () => {
	assert.equal(
		browserOwnStateFor({ url: "" }, null),
		true,
		"a fresh empty projection is a start page even if the projection also says loading",
	);
	assert.equal(
		browserOwnStateFor({ url: "about:blank" }, "https://example.com"),
		false,
		"a submitted navigation makes the blank tab a page the controls may act on",
	);
	assert.equal(
		browserOwnStateFor({ url: "https://example.com" }, null),
		false,
		"a loaded page is never own-state",
	);
});
