import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * S6d: THE APPROVALS ROUTE, DRIVEN THROUGH THE SHIPPED `BrowserSurface`.
 *
 * WHAT THIS PROVES, and why it is a mount rather than a string match:
 *  1. ABSENCE. With the native card available (the product default) the DOM dock
 *     and the consent band are not mounted: no `[data-dock-layout]`, no dock
 *     title, no `browser-consent-bar` band, even with a request pending. They are
 *     present only when the host reports `approvalsCard.available: false` (the
 *     kill switch, or a post-construction child failure). A source grep cannot
 *     tell "gated" from "mounted and hidden"; the DOM can.
 *  2. THE BADGE follows the expiry-aware live count and falls on the renderer's
 *     own clock when an entry runs out its TTL (main fires nothing at expiry).
 *  3. THE TOOLBAR CONTROL: with a request pending it opens the card through the
 *     bridge's `openApprovalsCard` and toggles it closed; with nothing pending it
 *     opens the Approvals DIALOG instead, where revoke, revoke all, forget this
 *     site and clear browsing data each reach the host bridge with the arguments
 *     the user chose.
 *
 * WHAT IT CANNOT PROVE: jsdom has no layout or native view. The native half (the
 * real card child, its geometry and focus) is `browser-approvals-s6b-probe.mjs`
 * and the S6d capture rig.
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
/*
 * NODE HAS ITS OWN `Event`, AND THE COPY LOOP ABOVE KEEPS IT (`key in globalThis`).
 * A component that does `window.dispatchEvent(new Event(...))` after a click then
 * hands jsdom a foreign Event and throws "parameter 1 is not of type 'Event'",
 * which the start-page file never meets because it never presses anything. The
 * event constructors this file's clicks and the surface's effects use are jsdom's.
 */
for (const name of [
	"Event",
	"CustomEvent",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"PointerEvent",
	"InputEvent",
]) {
	if (dom.window[name]) globalThis[name] = dom.window[name];
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
 * The entry module is generated rather than committed: the subject is a
 * COMPONENT and the bridge is a fake that records every call.
 */
const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { BrowserSurface } from "./src/renderer/src/features/browser/components/browser-surface";

const TAB = {
	tabId: 1,
	title: "Example",
	url: "https://example.com/",
	owner: "user",
	sessionId: null,
	active: true,
	restored: false,
	handedOver: false,
	failed: false,
	loading: false,
};

/** One live request; \`ttlMs\` lets a test make it die on the clock. */
export function pending(id, ttlMs = 600_000) {
	return {
		entryId: id,
		origin: "https://" + id + ".example",
		authority: id + ".example",
		broad: null,
		expiresAt: Date.now() + ttlMs,
		requestedAt: Date.now(),
		requesterSessionId: null,
	};
}

/**
 * Mount the surface over a fake bridge that models main's projection and
 * RECORDS every approvals call. \`card\` is the projection's approvalsCard.
 */
export function mount(container, options = {}) {
	const state = {
		tabs: [TAB],
		activeTabId: 1,
		url: TAB.url,
		title: TAB.title,
		loading: false,
		canGoBack: false,
		canGoForward: false,
		pendingConsent: options.pending ?? [],
		approvals: options.approvals ?? [],
		navFailure: null,
		approvalsCard: options.card ?? { available: true, open: false },
	};
	const calls = [];
	let notify = () => {};
	const record = (name) => async (...args) => {
		calls.push([name, ...args]);
		if (name === "openApprovalsCard") {
			state.approvalsCard = { ...state.approvalsCard, open: true };
			notify();
		}
		if (name === "closeApprovalsCard") {
			state.approvalsCard = { ...state.approvalsCard, open: false };
			notify();
		}
		if (name === "revokeApproval") {
			state.approvals = state.approvals.filter((row) => row.origin !== args[0]);
			notify();
		}
		if (name === "revokeAllApprovals") {
			state.approvals = [];
			notify();
		}
	};
	const explicit = {
		state: async () => structuredClone(state),
		setViewVisible: async () => {},
		onStateChanged: (callback) => {
			notify = callback;
			return () => {
				notify = () => {};
			};
		},
		onChord: () => () => {},
		onConsentChanged: () => () => {},
		onConsentAttention: () => () => {},
		openApprovalsCard: record("openApprovalsCard"),
		closeApprovalsCard: record("closeApprovalsCard"),
		setApprovalsCardContext: async () => {},
		revokeApproval: record("revokeApproval"),
		revokeAllApprovals: record("revokeAllApprovals"),
		forgetSite: record("forgetSite"),
		clearData: record("clearData"),
	};
	window.api = {
		browser: new Proxy(explicit, {
			get: (target, key) =>
				key in target ? target[key] : () => Promise.resolve(undefined),
		}),
	};
	const root = createRoot(container);
	root.render(
		createElement(BrowserSurface, {
			tabScope: "all",
			requestScope: "all",
			hostSessionId: null,
			surfaceTag: "browser-route",
			dockSurfaceTag: "browser-route-dock",
		}),
	);
	return { calls: () => calls, unmount: () => root.unmount() };
}
`;

const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "approvals-route.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: { ".css": "empty", ".png": "empty" },
	write: false,
});
const bundlePath = new URL(
	`./_approvals-route-${process.pid}.mjs`,
	import.meta.url,
);
let mount;
let pending;
try {
	await writeFile(bundlePath, bundle.outputFiles[0].text);
	({ mount, pending } = await import(bundlePath.href));
} finally {
	await unlink(bundlePath).catch(() => {});
}

async function flush() {
	for (let i = 0; i < 6; i++) {
		await act(async () => {
			await new Promise((resolve) => setImmediate(resolve));
		});
	}
}
const q = (selector) => document.querySelector(selector);
const qa = (selector) => [...document.querySelectorAll(selector)];
function freshContainer() {
	for (const node of qa("[data-tour-tag]")) void node;
	const host = document.createElement("div");
	document.body.appendChild(host);
	return host;
}
/** A real click through React's delegated handler. */
async function click(node) {
	await act(async () => {
		node.dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	await flush();
}
const GRANTS = [
	{
		origin: "https://granted.example",
		scope: "origin",
		grantedAt: 1700000000000,
	},
	{
		origin: "https://other.example",
		scope: "session",
		grantedAt: 1700000001000,
	},
	{ origin: "https://denied.example", scope: "deny", grantedAt: 1700000002000 },
];
const toolbarButton = () =>
	qa('button[data-tour-tag="browser-approvals"]')[0] ?? null;
const badge = () => q('[data-tour-tag="browser-approvals-badge"]');

test("with the card available, no dock, no dock title and no consent band are mounted, even with a request pending", async () => {
	const host = freshContainer();
	const handle = mount(host, { pending: [pending("a")], approvals: GRANTS });
	await flush();
	assert.equal(q("[data-dock-layout]"), null, "no dock layout node exists");
	assert.equal(
		q('[data-tour-tag="browser-approvals-dock-title"]'),
		null,
		"no dock heading exists",
	);
	assert.equal(
		q('[data-tour-tag="browser-consent-bar"]'),
		null,
		"the DOM-pushing approvals band is not mounted",
	);
	assert.ok(toolbarButton(), "the toolbar Approvals control is the entry");
	handle.unmount();
});

test("with the card unavailable (kill switch or child failure) the dock and the band are the fallback", async () => {
	const host = freshContainer();
	const handle = mount(host, {
		pending: [pending("a")],
		approvals: GRANTS,
		card: { available: false, open: false },
	});
	await flush();
	assert.ok(
		q('[data-tour-tag="browser-consent-bar"]'),
		"the band returns when no card exists",
	);
	await click(toolbarButton());
	assert.ok(q("[data-dock-layout]"), "the toolbar control opens the dock");
	assert.ok(q('[data-tour-tag="browser-approvals-dock-title"]'));
	assert.equal(
		q('[data-tour-tag="browser-approvals-dialog"]'),
		null,
		"the dialog is the card build's route, not the fallback's",
	);
	handle.unmount();
});

test("the toolbar badge shows the live count and falls when an entry expires on the renderer's clock", async () => {
	const host = freshContainer();
	const handle = mount(host, {
		pending: [pending("live"), pending("dies", 400)],
	});
	await flush();
	assert.equal(badge()?.textContent, "2", "two live requests");
	await new Promise((resolve) => setTimeout(resolve, 1700));
	await flush();
	assert.equal(
		badge()?.textContent,
		"1",
		"the expired entry leaves the badge with no new projection",
	);
	handle.unmount();
});

test("the toolbar control opens the card when something is pending and toggles it closed", async () => {
	const host = freshContainer();
	const handle = mount(host, { pending: [pending("a")] });
	await flush();
	await click(toolbarButton());
	const opened = handle
		.calls()
		.filter(([name]) => name === "openApprovalsCard");
	assert.equal(opened.length, 1, "one explicit open");
	assert.equal(
		q('[data-tour-tag="browser-approvals-dialog"]'),
		null,
		"a pending request opens the CARD, not the dialog",
	);
	await click(toolbarButton());
	assert.equal(
		handle.calls().filter(([name]) => name === "closeApprovalsCard").length,
		1,
		"the second press closes it",
	);
	handle.unmount();
});

test("with nothing pending the toolbar control opens the Approvals dialog, whose actions reach the host", async () => {
	const host = freshContainer();
	const handle = mount(host, { approvals: GRANTS });
	await flush();
	assert.equal(badge(), null, "no badge at zero");
	await click(toolbarButton());
	assert.equal(
		handle.calls().filter(([name]) => name === "openApprovalsCard").length,
		0,
		"no empty card is opened",
	);
	const dialog = q('[data-tour-tag="browser-approvals-dialog"]');
	assert.ok(dialog, "the Approvals dialog is open");
	assert.equal(q("[data-dock-layout]"), null, "and it is not the dock");
	const text = dialog.textContent;
	for (const origin of ["granted.example", "other.example", "denied.example"]) {
		assert.ok(text.includes(origin), `${origin} is listed`);
	}

	// Revoke one grant: the origin the row names reaches the host.
	const revokes = qa('[data-tour-tag="browser-revoke-approval"]');
	assert.equal(revokes.length, 2, "one Revoke per granted site");
	await click(revokes[0]);
	assert.deepEqual(
		handle.calls().filter(([name]) => name === "revokeApproval"),
		[["revokeApproval", "https://granted.example"]],
	);

	// Forget this site names the ACTIVE TAB's origin, not a grant row.
	await click(q('[data-tour-tag="browser-forget-site"]'));
	assert.deepEqual(
		handle.calls().filter(([name]) => name === "forgetSite"),
		[["forgetSite", "https://example.com"]],
	);

	// Clear browsing data, one button per scope.
	await click(q('[data-tour-tag="browser-clear-cookies"]'));
	assert.deepEqual(
		handle.calls().filter(([name]) => name === "clearData"),
		[["clearData", "cookies"]],
	);

	// Revoke all drops every grant at once.
	const revokeAll = qa("button").find((button) =>
		button.textContent.includes("Revoke all site approvals"),
	);
	assert.ok(revokeAll, "Revoke all is in the dialog");
	await click(revokeAll);
	assert.equal(
		handle.calls().filter(([name]) => name === "revokeAllApprovals").length,
		1,
	);
	handle.unmount();
});

test("the page menu's Approvals item opens the dialog even while a request is pending", async () => {
	const host = freshContainer();
	const handle = mount(host, { pending: [pending("a")], approvals: GRANTS });
	await flush();
	const trigger = q('[data-tour-tag="browser-page-menu"]');
	assert.ok(trigger, "the page menu trigger exists");
	await act(async () => trigger.focus());
	await act(async () => {
		trigger.dispatchEvent(
			new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
	});
	await flush();
	const item = qa('[role="menuitem"][data-tour-tag="browser-approvals"]')[0];
	assert.ok(item, "the menu lists Approvals");
	await act(async () => {
		item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	});
	await flush();
	assert.ok(
		q('[data-tour-tag="browser-approvals-dialog"]'),
		"the dialog opens from the menu",
	);
	assert.equal(
		handle.calls().filter(([name]) => name === "openApprovalsCard").length,
		0,
		"the menu route never opens the card",
	);
	handle.unmount();
});
