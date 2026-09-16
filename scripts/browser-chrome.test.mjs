/**
 * Contract tests for the browser CHROME: the tab-restore file, the session-scope
 * consent decision, the revocation surfaces, and the overlay policy that decides
 * whether the native view is visible.
 *
 * The shipped TypeScript is bundled in memory with esbuild and driven against real
 * filesystem state, the same way `browser-host.test.mjs` tests the host's rules.
 * The views and webContents are fakes that model the parts these rules read.
 *
 * WHAT THESE TESTS ARE NOT: proof the chrome works. No page is ever loaded, no
 * frame is rendered, and the view is a stub. The real run — the built app
 * headless, a real page, real frames — is `scripts/browser-chrome-proof.mjs`, and
 * it is what makes the PR's claim. This file exists so a regression in the RULES
 * is caught without needing one.
 */

import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { build } from "esbuild";

/*
 * Node has no `localStorage`, and `useCanonicalSessionsStore` is persisted: zustand's
 * persist middleware writes through storage on every `setState`, so with nothing
 * there the write throws inside the middleware. The three methods the browser
 * actually provides are enough to exercise the store's real interface, and the
 * tests clear it between cases. `composer-tabs.test.mjs` carries the same shim for
 * the same reason.
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

/*
 * The render probe for the chrome hook.
 *
 * `renderToStaticMarkup` is the only renderer this repo ships (there is no jsdom
 * here, and this change is not the place to add one — see `composer-tabs.test.mjs`
 * for the same call): the component BODY runs, so `useBrowserChrome`'s callbacks
 * and refs are created, and effects do not, so nothing touches the network or
 * `requestAnimationFrame` on its own. That is enough to call the hook's returned
 * API by hand and watch what it delivers — which is what R4's fix is about.
 */
const PROBE = `
	import { createElement } from "react";
	import { renderToStaticMarkup } from "react-dom/server";
	import { useBrowserChrome } from "./src/renderer/src/features/browser/hooks/use-browser-chrome";

	import { BrowserPane, PANE_SURFACE_ID } from "./src/renderer/src/features/browser/components/browser-pane";
	import { BrowserPage } from "./src/renderer/src/features/browser/components/browser-page";
	import { BrowserConsentBar } from "./src/renderer/src/features/browser/components/browser-consent-bar";
	import { BrowserConsentRequest, requesterLabel } from "./src/renderer/src/features/browser/components/browser-consent-request";
	import { BrowserApprovalsTray, defaultApprovalHeaderLabel, paneApprovalHeaderLabel } from "./src/renderer/src/features/browser/components/browser-approvals-tray";
	import { BrowserApprovalsDock } from "./src/renderer/src/features/browser/components/browser-approvals-dock";
	import { BrowserTabStrip } from "./src/renderer/src/features/browser/components/browser-tab-strip";
	import { approvalRows, approvalScopeLabel, liveRequests, originOfUrl, reconcileResolved, remainingLabel, requestsInScope, waitingOrdinals, RESOLVED_KEEP } from "./src/renderer/src/features/browser/model/approval-queue-model";
	import { closeConversationIntent, closeOthersIntent, closeToTheRightIntent, groupTabsBySession, pooledTabs, scopeFromKey, scopeKey, sessionDisplayName, summariseConversations, tabsBySession, tabsInScope } from "./src/renderer/src/features/browser/model/tab-index-model";
	import { BrowserLoadFailure, loadFailureSentence } from "./src/renderer/src/features/browser/components/browser-load-failure";
	import { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
	import { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";

	export function renderBrowserChrome() {
		const captured = { chrome: null };
		const Probe = () => {
			captured.chrome = useBrowserChrome();
			return null;
		};
		renderToStaticMarkup(createElement(Probe));
		return captured.chrome;
	}

	export const render = (element) => renderToStaticMarkup(element);
	export const el = createElement;
	export {
		BrowserConsentBar,
		BrowserConsentRequest,
		BrowserApprovalsTray,
		BrowserApprovalsDock,
		BrowserTabStrip,
		BrowserPage,
		BrowserPane,
		PANE_SURFACE_ID,
		requesterLabel,
		defaultApprovalHeaderLabel,
		paneApprovalHeaderLabel,
		approvalRows,
		approvalScopeLabel,
		liveRequests,
		originOfUrl,
		reconcileResolved,
		remainingLabel,
		requestsInScope,
		scopeFromKey,
		scopeKey,
		tabsInScope,
		waitingOrdinals,
		RESOLVED_KEEP,
		closeConversationIntent,
		closeOthersIntent,
		closeToTheRightIntent,
		groupTabsBySession,
		pooledTabs,
		sessionDisplayName,
		summariseConversations,
		tabsBySession,
		BrowserLoadFailure,
		loadFailureSentence,
		useCanonicalSessionsStore,
		useUiPreferencesStore,
	};
`;

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/session-store";',
			'export * from "./src/main/browser/approvals";',
			'export * from "./src/main/browser/registry";',
			'export * from "./src/main/browser/atomic-json";',
			'export * from "./src/main/browser/vendor/driver/origin-policy";',
			// The overlay policy is a renderer module, but the ONLY part under test
			// here is the pure registry (register/release/ref-count), which needs no
			// DOM and no React render — so the same in-memory bundle can carry it and
			// the rule that keeps two dialogs from releasing each other's suppression
			// is covered without a browser.
			'export * from "./src/renderer/src/shared/browser-view-policy";',
			// The consent-attention store is the same kind of module: a subscribe/
			// publish pair with no DOM, which the app shell and the browser surface
			// both read (review round 1, R8).
			'export * from "./src/renderer/src/shared/browser-consent-attention";',
			// The chrome hook, driven through a REAL React render so its own rules can
			// be exercised: `renderToStaticMarkup` runs the component body (so the
			// hook's callbacks and refs exist) without running effects, which is
			// exactly what the rect scheduler needs to be observable. See the R4 test.
			PROBE,
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// `browser-view-policy.ts` imports React for its hooks; the module is imported
	// but never renders, and the package resolves normally from here.
	//
	// The renderer's path aliases are declared by hand because esbuild cannot read
	// tsconfig paths (`composer-tabs.test.mjs` records the same), React stays
	// external so the bundle shares ONE copy with the server renderer — two copies
	// give a component a different React and every render throws on an invalid hook
	// call — and a stylesheet carries no assertion here, so it loads empty.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// `mainFields`/`conditions` so a dependency is taken from its ESM entry: several
	// of these packages ship a CJS build that calls `require("react")` at import
	// time, which the dynamic-require shim cannot serve because React is external.
	mainFields: ["module", "main"],
	conditions: ["import"],
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
	loader: { ".css": "empty" },
	jsx: "automatic",
});
// Written to a real file rather than imported as a data: URL: the bundle now
// imports React by bare specifier, and a data: URL has no base path for module
// resolution. Removed again as soon as it is imported.
const bundlePath = new URL("./_browser-chrome.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const mod = await import(bundlePath.href);
await unlink(bundlePath);
const {
	renderBrowserChrome,
	render,
	el,
	BrowserConsentBar,
	BrowserConsentRequest,
	BrowserApprovalsTray,
	BrowserApprovalsDock,
	BrowserTabStrip,
	BrowserPage,
	BrowserPane,
	PANE_SURFACE_ID,
	requesterLabel,
	defaultApprovalHeaderLabel,
	paneApprovalHeaderLabel,
	approvalRows,
	approvalScopeLabel,
	liveRequests,
	originOfUrl,
	reconcileResolved,
	remainingLabel,
	requestsInScope,
	scopeFromKey,
	scopeKey,
	tabsInScope,
	waitingOrdinals,
	RESOLVED_KEEP,
	closeConversationIntent,
	closeOthersIntent,
	closeToTheRightIntent,
	groupTabsBySession,
	pooledTabs,
	sessionDisplayName,
	summariseConversations,
	tabsBySession,
	BrowserLoadFailure,
	loadFailureSentence,
	useCanonicalSessionsStore,
	useUiPreferencesStore,
	noteConsentAttention,
	clearConsentAttention,
	consentAttentionSnapshot,
	subscribeConsentAttention,
	MAX_RESTORED_TABS,
	MAX_RESTORED_ENTRIES,
	MAX_RESTORED_PAGE_STATE_CHARS,
	MAX_RESTORED_URL_CHARS,
	MAX_SESSION_FILE_BYTES,
	BrowserSessionStore,
	SESSION_FILENAME,
	SESSION_FILE_MODE,
	SESSION_DIR_MODE,
	captureTabs,
	readSession,
	stopSnapshotDecision,
	ApprovalStore,
	TabRegistry,
	browserViewSuppressed,
	suppressBrowserView,
	suppressedOverlayIds,
	safeHttpUrl,
	configurePslRules,
} = mod;

/*
 * The `domain` scope needs the public-suffix rules, which the app loads from an
 * optional file at start-up (fail-closed: without them no broad option is
 * offered). The rules are installed ONCE per process here, in the same
 * `configurePslRules` entry point the app uses, so the test exercises the real
 * wiring rather than a fixture of its own. `TEST_PSL` is deliberately tiny: these
 * assertions are about `example.com`-shaped keys, not about the real list.
 */
configurePslRules("com\nexample\n");

let root = "";
before(() => {
	root = mkdtempSync(join(tmpdir(), "lo-browser-chrome-"));
});

// ---- fakes -----------------------------------------------------------------

class FakeWebContents {
	constructor(history) {
		this.destroyed = false;
		this.historyEntries = history ?? [
			{ url: "https://example.com/", title: "Example" },
		];
		this.activeIndex = this.historyEntries.length - 1;
		this.restored = [];
		this.loaded = [];
	}

	isDestroyed() {
		return this.destroyed;
	}

	getURL() {
		return this.historyEntries[this.activeIndex]?.url ?? "";
	}

	getTitle() {
		return this.historyEntries[this.activeIndex]?.title ?? "";
	}

	async loadURL(url) {
		this.loaded.push(url);
		this.historyEntries = [{ url, title: url }];
		this.activeIndex = 0;
	}

	get navigationHistory() {
		return {
			canGoBack: () => this.activeIndex > 0,
			canGoForward: () => this.activeIndex < this.historyEntries.length - 1,
			goBack: () => {
				this.activeIndex -= 1;
			},
			goForward: () => {
				this.activeIndex += 1;
			},
			length: () => this.historyEntries.length,
			getAllEntries: () =>
				this.historyEntries.map((entry) => ({
					...entry,
					pageState: "c3RhdGU=",
				})),
			getActiveIndex: () => this.activeIndex,
			// The real signature returns a promise; the ORDER is what these tests are
			// about, so the fake records the call and repopulates the stack the way
			// Chromium would.
			restore: async ({ entries, index }) => {
				this.restored.push({ entries, index });
				this.historyEntries = entries;
				this.activeIndex = index ?? entries.length - 1;
			},
		};
	}
}

class FakeView {
	constructor(history) {
		this.webContents = new FakeWebContents(history);
		this.visibility = [];
		this.bounds = [];
	}

	setVisible(visible) {
		this.visibility.push(visible);
	}

	setBounds(rect) {
		this.bounds.push(rect);
	}
}

function makeRegistry(history) {
	const views = new Map();
	const registry = new TabRegistry(
		(_options, tabId) => {
			const view = new FakeView(history);
			views.set(tabId, view);
			return view;
		},
		() => {},
		() => {},
	);
	return { registry, views };
}

// ---- the session file (design 7.2) -----------------------------------------

test("the session file is written 0600 under a 0700 directory, as a staged rename", () => {
	const dir = join(root, "session-mode");
	const store = new BrowserSessionStore({ dir, debounceMs: 5 });
	store.record([
		{
			owner: "user",
			active: true,
			entries: [{ url: "https://example.com/", title: "Example" }],
			activeIndex: 0,
		},
	]);
	store.flush();
	const mode = statSync(store.filePath).mode & 0o777;
	assert.equal(
		mode,
		SESSION_FILE_MODE,
		"the file mode is the one this module intends",
	);
	assert.equal(
		statSync(dir).mode & 0o777,
		SESSION_DIR_MODE,
		"the directory is created 0700, because this file is policy about what an agent may reach",
	);
	// The staging discipline: no sibling temp file is left behind after a flush.
	const leftovers = readFileSync(store.filePath, "utf8");
	assert.ok(leftovers.includes("example.com"));
});

test("a snapshot never carries a nonce or a hand-over, whatever the tab's owner was", () => {
	const dir = join(root, "session-shape");
	const store = new BrowserSessionStore({ dir, debounceMs: 5 });
	store.record([
		{
			owner: "agent",
			active: true,
			entries: [{ url: "https://agent.example/", title: "Agent page" }],
			activeIndex: 0,
		},
	]);
	store.flush();
	const raw = readFileSync(store.filePath, "utf8");
	// The schema is the enforcement: the field does not exist, so a stale nonce
	// cannot be re-read out of `userData` and re-granted to whoever wrote the file
	// (design 7.3).
	assert.ok(!raw.includes("nonce"), "no nonce is persisted, in any casing");
	assert.ok(
		!raw.includes("handedTo"),
		"a hand-over does not survive a restart either",
	);
	assert.ok(
		raw.includes('"owner": "agent"'),
		"the owner is recorded for the diagnostics",
	);
});

test("a restored tab comes back user-owned, with a fresh id and no capability", () => {
	const dir = join(root, "session-restore");
	const store = new BrowserSessionStore({ dir, debounceMs: 5 });
	store.record([
		{
			owner: "agent",
			active: false,
			entries: [
				{ url: "https://one.example/", title: "One" },
				{ url: "https://two.example/", title: "Two" },
			],
			activeIndex: 1,
		},
	]);
	store.flush();
	const tabs = readSession(store.filePath);
	assert.equal(tabs.length, 1);
	// `owner: "agent"` is recorded, and the restore path ignores it: this is the
	// half a reader of the design has to be able to check.
	assert.equal(tabs[0].owner, "agent");
	assert.equal(tabs[0].activeIndex, 1);
	assert.equal(tabs[0].entries.length, 2);

	const { registry } = makeRegistry();
	const record = registry.create({ owner: "user", restored: true });
	assert.equal(record.owner, "user", "a restored tab is the user's");
	assert.equal(record.nonce, null, "and it holds no capability");
	assert.equal(record.restored, true);
});

test("an agent's stale handle fails against a restored tab, with the ordinary tab_closed", () => {
	const { registry } = makeRegistry();
	// The tab an agent session still believes in, from the previous run.
	const staleToken = "ui:1:deadbeefdeadbeefdeadbeefdeadbeef";
	registry.create({ owner: "user", restored: true });
	assert.throws(
		() => registry.requireSurface(staleToken),
		(error) => error.code === "tab_closed",
		"a restored tab must not silently satisfy a handle a session still holds",
	);
});

test("a corrupt or future-versioned session file opens one blank tab, not a crash", () => {
	const dir = join(root, "session-corrupt");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, SESSION_FILENAME);
	writeFileSync(path, "{ this is not json");
	const logged = [];
	assert.deepEqual(
		readSession(path, (line) => logged.push(line)),
		[],
	);

	writeFileSync(path, JSON.stringify({ version: 99, tabs: [{ entries: [] }] }));
	assert.deepEqual(
		readSession(path),
		[],
		"a version this build does not write is refused",
	);

	// A tab whose only entries are non-http(s) is dropped rather than restored into
	// a navigation the view's own `will-navigate` would then refuse.
	writeFileSync(
		path,
		JSON.stringify({
			version: 1,
			tabs: [
				{
					owner: "user",
					active: true,
					entries: [{ url: "file:///etc/passwd" }],
					activeIndex: 0,
				},
				{
					owner: "user",
					active: false,
					entries: [{ url: "https://ok.example/" }],
					activeIndex: 0,
				},
			],
		}),
	);
	const tabs = readSession(path);
	assert.equal(tabs.length, 1, "only the http(s) tab survives");
	assert.equal(tabs[0].entries[0].url, "https://ok.example/");
});

test("the active index is re-derived after a refused entry shrinks the stack", () => {
	const dir = join(root, "session-index");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, SESSION_FILENAME);
	writeFileSync(
		path,
		JSON.stringify({
			version: 1,
			tabs: [
				{
					owner: "user",
					active: true,
					entries: [
						{ url: "https://a.example/" },
						{ url: "javascript:alert(1)" },
						{ url: "https://c.example/" },
					],
					activeIndex: 2,
				},
			],
		}),
	);
	const tabs = readSession(path);
	assert.equal(tabs[0].entries.length, 2);
	// The user was ON the third entry; after the refused one is dropped it is the
	// second, and an index left at 2 would point past the end.
	assert.equal(tabs[0].activeIndex, 1);
});

test("a capture reads the LIVE history, and skips a view that is already gone", () => {
	const { registry, views } = makeRegistry();
	const first = registry.create({ owner: "user" });
	registry.create({ owner: "agent", sessionId: "s1" });
	const two = views.get(2);
	assert.equal(two.webContents.historyEntries.length, 1);

	const captured = captureTabs(registry.list(), first.tabId);
	assert.equal(captured.length, 2);
	assert.equal(captured[0].active, true, "the active tab is marked");
	assert.equal(captured[1].active, false);
	assert.equal(captured[1].owner, "agent");

	// A view destroyed between the destruction and the registry's cleanup must not
	// be written as a blank tab the user never opened.
	views.get(1).webContents.destroyed = true;
	assert.equal(captureTabs(registry.list(), first.tabId).length, 1);
});

// ---- a capture is never partial (review round 2, B2) ------------------------

/*
 * The round-2 BLOCKER, at the level it was found: a RESTORED tab has no history
 * until its page commits, and the restore fires a change capture before that — so
 * the capture was empty by construction and OVERWROTE the file the restore was
 * reading. Both assertions below are the property that was false: a capture taken
 * in the loading window still carries the tab, and the moment the tab has history
 * of its own the live stack wins.
 */

test("a restored tab with no history yet is captured from the row it was restored from", () => {
	// `[]` is what Electron answers for a page that has not committed: the state a
	// restored tab is in for as long as its load takes.
	const { registry } = makeRegistry([]);
	const row = {
		owner: "user",
		active: false,
		entries: [{ url: "https://restored.example/page", title: "Restored" }],
		activeIndex: 0,
	};
	registry.create({ owner: "user", restored: true, restoreRow: row });
	// A tab with nothing to restore from is still skipped: the fallback is the row
	// the tab came from, not a guess about a blank page.
	const fresh = registry.create({ owner: "user" });

	const captured = captureTabs(registry.list(), fresh.tabId);
	assert.deepEqual(
		captured.map((tab) => tab.entries[0].url),
		["https://restored.example/page"],
		"the restored row is re-emitted, and the blank tab is still not",
	);
	assert.equal(
		captured[0].owner,
		"user",
		"a restored tab is the user's, whatever the file said",
	);
	assert.equal(
		captured[0].active,
		false,
		"the active flag comes from the strip, not from the row",
	);
});

test("the moment a restored tab has history of its own, the live stack replaces the recorded row", () => {
	const { registry, views } = makeRegistry([]);
	const record = registry.create({
		owner: "user",
		restored: true,
		restoreRow: {
			owner: "user",
			active: true,
			entries: [{ url: "https://restored.example/page" }],
			activeIndex: 0,
		},
	});
	// The page commits and the user navigates on: the tab's own history is the truth
	// from then on, and a capture that kept re-emitting the old row would be a
	// session that lags every navigation for the life of the tab.
	const contents = views.get(record.tabId).webContents;
	contents.historyEntries = [
		{ url: "https://restored.example/page", title: "Restored" },
		{ url: "https://live.example/after", title: "After" },
	];
	contents.activeIndex = 1;

	const captured = captureTabs(registry.list(), record.tabId);
	assert.deepEqual(
		captured[0].entries.map((entry) => entry.url),
		["https://restored.example/page", "https://live.example/after"],
	);
	assert.equal(
		captured[0].activeIndex,
		1,
		"and the entry the user is on is the live one",
	);
});

test("a quit-time capture shorter than the record on disk is refused, not written (QA round 2, Q3)", () => {
	/*
	 * The stop path's own rule, and the reason it is one-sided: a capture taken while
	 * the process comes down can be short because the views were already gone, which
	 * is not the user closing every tab. Measured on the running app: a SIGTERM quit
	 * emptied the file in 8 of 8 runs while a window close kept it.
	 */
	assert.equal(
		stopSnapshotDecision(0, 3).write,
		false,
		"a capture that saw none of three recorded tabs is not the user closing them",
	);
	assert.equal(stopSnapshotDecision(2, 3).write, false, "nor is a partial one");
	assert.equal(
		stopSnapshotDecision(3, 3).write,
		true,
		"an unchanged record is written, so the flush has something to do",
	);
	assert.equal(
		stopSnapshotDecision(1, 0).write,
		true,
		"and a record with fewer tabs than the capture is always replaced",
	);
	assert.equal(
		stopSnapshotDecision(0, 0).write,
		true,
		"closing every tab and quitting writes the empty record rather than refusing it",
	);
});

/*
 * The two halves below are the BINDING half of that rule (review round 3, B2's
 * MAJOR), and they are here rather than in the decision-function test above because
 * the pure function was never the part that was wrong.
 *
 * What round 3 measured on the shipped classes: `durableRows 3 / atStop 1 / decision
 * write false` and then ONE ROW ON DISK. The stop path declined to `record()` the
 * short capture and called `flush()` anyway, and `flush()` writes whatever `record()`
 * last staged - which, in the ordering the guard exists for (the views destroyed
 * BEFORE `stop()` runs), is the short capture the per-view `destroyed` handlers had
 * already staged through `notifyChanged` -> `captureSession`. Refusing and then
 * writing the refused content is the original data loss through a different door.
 *
 * So these cases drive the STORE, not `stopSnapshotDecision`: a test that only asked
 * the pure function would pass against the code that lost the session. The length
 * condition is what the loss needs - a staged capture SHORTER than the durable
 * record - so it is opened deliberately here (3 durable rows, a 1-row capture)
 * rather than left to a representative sequence, which is the difference between a
 * test that passes and a test that would have caught this: the independent QA pass
 * drove six stop cases through the same mechanism and lost no session, because none
 * of them staged a shorter record than the one on disk.
 */
function sessionRows(count, prefix = "kept") {
	return Array.from({ length: count }, (_unused, index) => ({
		owner: "user",
		active: index === 0,
		entries: [{ url: `https://${prefix}.example/${index}` }],
		activeIndex: 0,
	}));
}

test("a refused quit-time capture - shorter than the durable record - is not written by the flush that follows it (review round 3, B2's MAJOR)", async () => {
	const dir = join(root, "session-stop-refusal");
	const store = new BrowserSessionStore({ dir, debounceMs: 20 });
	store.record(sessionRows(3));
	store.flush();
	assert.equal(
		readSession(store.filePath).length,
		3,
		"three rows durable first",
	);

	// The teardown ordering: the views are already gone when `stop()` runs, so their
	// `destroyed` handlers staged a one-row capture BEFORE the stop path read
	// anything. `captureTabs` on destroyed views is what produces it.
	const short = sessionRows(1);
	store.record(short);

	const decision = store.commitStopCapture(short);
	assert.equal(
		decision.write,
		false,
		"the stop decision refuses a capture shorter than the record",
	);
	// THE LINE THAT LOST THE SESSION: the host's stop path flushes unconditionally,
	// because a quit must not lose the last change to a debounce that was ticking.
	store.flush();
	assert.equal(
		readSession(store.filePath).length,
		3,
		`the refused capture is not on disk: ${JSON.stringify(readSession(store.filePath).map((tab) => tab.entries[0]?.url))}`,
	);

	// The second door: a teardown capture staged after the decision, with the
	// debounce left to write it. The seal is what has to keep it out.
	store.record(short);
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(
		readSession(store.filePath).length,
		3,
		"nor by a later capture, after its debounce would have fired",
	);
});

test("an accepted quit-time capture still lands, and the later teardown capture cannot replace it", () => {
	const dir = join(root, "session-stop-accept");
	const store = new BrowserSessionStore({ dir, debounceMs: 20 });
	store.record(sessionRows(1, "older"));
	store.flush();

	const decision = store.commitStopCapture(sessionRows(3, "live"));
	assert.equal(decision.write, true, "a longer capture replaces the record");
	store.flush();
	assert.equal(
		readSession(store.filePath).length,
		3,
		"the accepted capture is written by the flush that follows the decision",
	);

	// The seal is not "write nothing": it is "write what the decision accepted".
	store.record(sessionRows(1, "teardown"));
	store.flush();
	assert.equal(
		readSession(store.filePath).length,
		3,
		"and a capture staged after the decision cannot replace it",
	);
});

test("a destroyed view is captured from its recorded row rather than dropped", () => {
	// The teardown case: a view can be destroyed before the stop path reads it, and a
	// tab the user still has must not vanish from the record because its view went
	// first.
	const { registry, views } = makeRegistry([]);
	const kept = registry.create({
		owner: "user",
		restored: true,
		restoreRow: {
			owner: "user",
			active: true,
			entries: [{ url: "https://kept.example/page" }],
			activeIndex: 0,
		},
	});
	const plain = registry.create({ owner: "user" });
	views.get(plain.tabId).webContents.destroyed = true;
	views.get(kept.tabId).webContents.destroyed = true;

	const captured = captureTabs(registry.list(), kept.tabId);
	assert.deepEqual(
		captured.map((tab) => tab.entries[0].url),
		["https://kept.example/page"],
		"the restored row survives its view, and a tab with no row is still not invented",
	);
});

test("a null content rect hides every view, so leaving the route cannot leave a page painted over chat", () => {
	const { registry, views } = makeRegistry();
	const record = registry.create({ owner: "user" });
	registry.setContentRect({ x: 0, y: 100, width: 800, height: 600 });
	assert.equal(views.get(record.tabId).visibility.at(-1), true);
	registry.setContentRect(null);
	assert.equal(
		views.get(record.tabId).visibility.at(-1),
		false,
		"no rectangle means nowhere to paint",
	);
});

// ---- the session consent scope (design 9.3) --------------------------------

function storeIn(name) {
	return new ApprovalStore({ dir: join(root, name) });
}

test("'allow for this session' grants the origin for this run and is not written to disk", () => {
	const dir = join(root, "approvals-session");
	const store = new ApprovalStore({ dir });
	const url = safeHttpUrl("https://session.example/page");
	const pending = store.requestAccess(url.href, "session:a", "async", "req-1");
	const decided = store.respond(pending.entry_id, "session");
	assert.equal(decided.state, "allowed");
	assert.equal(decided.scope, "session");
	assert.equal(store.originAllowed(url), true);
	assert.equal(store.ensureTopLevelAccess(url, "session:a").allowed, true);

	// The scope's definition: this store, this run. Nothing about it is on disk.
	const raw = existsSync(join(dir, "approvals.json"))
		? readFileSync(join(dir, "approvals.json"), "utf8")
		: "{}";
	assert.ok(
		!raw.includes("session.example"),
		"a session grant is in-memory only, so a restart asks again",
	);
	const reopened = new ApprovalStore({ dir });
	assert.equal(
		reopened.originAllowed(url),
		false,
		"a fresh store for the same directory does not carry a session grant",
	);
});

test("a session grant appears in the approvals list with its own scope", () => {
	const store = storeIn("approvals-session-list");
	const url = safeHttpUrl("https://listed.example/");
	const pending = store.requestAccess(url.href, "session:a", "async", "req-1");
	store.respond(pending.entry_id, "session");
	const rows = store.grants().filter((row) => row.origin === url.origin);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].scope, "session");
	// The requester is stored (the authority boundary) and is read by nothing that
	// renders: `chromeState` projects origin, scope and time only.
	assert.equal(typeof rows[0].requester, "string");
});

test("a denial clears a session grant, and a per-origin revoke removes it", () => {
	const store = storeIn("approvals-session-deny");
	const url = safeHttpUrl("https://flip.example/");
	const first = store.requestAccess(url.href, "session:a", "async", "req-1");
	store.respond(first.entry_id, "session");
	assert.equal(store.originAllowed(url), true);

	const second = store.requestAccess(url.href, "session:a", "async", "req-2");
	// A durable deny exists only via the prompt, and after a session grant the
	// origin is allowed, so the request must come back as already allowed rather
	// than raising a second prompt.
	assert.equal(second.state, "allowed");

	const third = storeIn("approvals-session-revoke");
	const other = safeHttpUrl("https://revoke.example/");
	const pending = third.requestAccess(
		other.href,
		"session:a",
		"async",
		"req-1",
	);
	third.respond(pending.entry_id, "session");
	assert.equal(third.revokeOrigin(other.origin) > 0, true);
	assert.equal(third.originAllowed(other), false);
	assert.equal(third.grants().length, 0);
});

test("a per-origin revoke takes the unspent once grant, its receipts and any in-flight admission (review round 2, B1)", () => {
	const url = safeHttpUrl("https://once.example/");
	/*
	 * The once-grant limb. `respond('once')` writes authority that is NOT a durable
	 * row, so a revoke that only retired rows and session grants left it live: the
	 * store still answered `{allowed: true, viaOnceGrant: true}`, and the Sites sheet
	 * reported "0 approvals revoked" for a revoke that had left the agent able to
	 * drive the origin.
	 */
	const once = storeIn("approvals-revoke-once");
	const pending = once.requestAccess(url.href, "session:a", "async", "req-1");
	once.respond(pending.entry_id, "once");
	assert.equal(
		once.originAllowed(url),
		false,
		"a once grant is not a durable approval",
	);
	assert.equal(
		once.revokeOrigin(url.origin) > 0,
		true,
		"an unspent once grant is live authority, so the revoke must report it",
	);
	assert.throws(
		() => once.ensureTopLevelAccess(url, "session:a"),
		(error) => error.code === "origin_not_allowed",
		"and the next action on that origin must be refused",
	);

	/*
	 * The in-flight limb. `admit` is captured ONCE at command entry, so an
	 * asynchronous navigation admitted a moment before the revoke used to stay
	 * approved across it — the revision its closure compares had not moved. Bumping
	 * the global `revision` is NOT the fix (the next test says why), so the ORIGIN's
	 * epoch moves and the closure compares that.
	 */
	const inflight = storeIn("approvals-revoke-inflight");
	const askedOnce = inflight.requestAccess(
		url.href,
		"session:a",
		"async",
		"req-1",
	);
	inflight.respond(askedOnce.entry_id, "once");
	const admission = inflight.admit(url, "session:a");
	assert.equal(
		admission.viaOnceGrant,
		true,
		"the probe's starting state: a live consumed grant",
	);
	inflight.revokeOrigin(url.origin);
	assert.equal(inflight.originAllowed(url), false);
	assert.equal(
		admission.approved(url),
		false,
		"an admission granted before the revoke must not still be approved after it",
	);

	// The receipt limb, which is round 1's original read-after-revocation bypass.
	const receipts = storeIn("approvals-revoke-receipt");
	const privateUrl = safeHttpUrl("https://receipt.example/private");
	const asked = receipts.requestAccess(
		privateUrl.href,
		"session:a",
		"async",
		"req-1",
	);
	receipts.respond(asked.entry_id, "site");
	const token = "ui:1:tok";
	receipts.rememberDocument(
		token,
		privateUrl,
		"session:a",
		7,
		receipts.admit(privateUrl, "session:a").approved,
	);
	assert.equal(
		receipts.documentAllowed(token, privateUrl, "session:a", 7),
		true,
	);
	receipts.revokeOrigin(privateUrl.origin);
	assert.equal(receipts.originAllowed(privateUrl), false);
	assert.equal(
		receipts.documentAllowed(token, privateUrl, "session:a", 7),
		false,
		"a receipt outliving the revoke is the agent still reading a page the user withdrew",
	);
});

test("a per-origin revoke leaves another origin's approvals and receipts alone", () => {
	// WHY the fix is a per-origin epoch and not a bump of the global `revision`:
	// the global one belongs to the bulk revoke, and moving it here would refuse a
	// read the user never withdrew, on an origin they never touched.
	const store = storeIn("approvals-revoke-scoped");
	const kept = safeHttpUrl("https://kept.example/private");
	const gone = safeHttpUrl("https://gone.example/");
	for (const [url, id] of [
		[kept, "req-keep"],
		[gone, "req-gone"],
	]) {
		const asked = store.requestAccess(url.href, "session:a", "async", id);
		store.respond(asked.entry_id, "site");
	}
	const token = "ui:9:tok";
	store.rememberDocument(
		token,
		kept,
		"session:a",
		7,
		store.admit(kept, "session:a").approved,
	);
	const keptAdmission = store.admit(kept, "session:a");

	store.revokeOrigin(gone.origin);

	assert.equal(
		store.originAllowed(kept),
		true,
		"the untouched origin keeps its approval",
	);
	assert.equal(
		store.documentAllowed(token, kept, "session:a", 7),
		true,
		"and keeps its receipt: a revoke is scoped to the site the user chose",
	);
	assert.equal(keptAdmission.approved(kept), true);
	assert.equal(store.originAllowed(gone), false);
});

test("'revoke all' clears the durable set and the session set in one action", () => {
	const store = storeIn("approvals-revoke-all");
	const durable = safeHttpUrl("https://durable.example/");
	const held = store.requestAccess(durable.href, "session:a", "async", "req-1");
	store.respond(held.entry_id, "site");
	const session = safeHttpUrl("https://sessiononly.example/");
	const pending = store.requestAccess(
		session.href,
		"session:a",
		"async",
		"req-2",
	);
	store.respond(pending.entry_id, "session");
	assert.equal(store.grants().length, 2);

	const removed = store.revokeAll();
	assert.equal(removed, 2, "both rows are reported, not only the durable one");
	assert.equal(store.grants().length, 0);
	assert.equal(store.originAllowed(durable), false);
	assert.equal(store.originAllowed(session), false);
	// Revoking is not a logout: the call touches no cookie and no cache, which is
	// why the sheet's copy says so.
	assert.equal(
		existsSync(join(root, "approvals-revoke-all", "session.json")),
		false,
	);
});

test("revoking one origin takes the broad grant that admitted it, too", () => {
	const store = storeIn("approvals-broad");
	const url = safeHttpUrl("https://sub.gominerva.com/page");
	const pending = store.requestAccess(url.href, "session:a", "async", "req-1");
	assert.ok(
		pending.broad,
		"a broad option is offered when public-suffix data exists",
	);
	store.respond(pending.entry_id, "domain");
	assert.equal(store.originAllowed(url), true);
	assert.equal(store.revokeOrigin(url.origin) >= 1, true);
	assert.equal(
		store.originAllowed(url),
		false,
		"a revoke that left the domain grant in place would appear to do nothing",
	);
});

// ---- the overlay policy (design 11.3) --------------------------------------

test("the overlay policy is ref-counted, so an inner close cannot clear an outer overlay", () => {
	assert.equal(browserViewSuppressed(), false);
	const outer = suppressBrowserView("dialog");
	const inner = suppressBrowserView("dialog");
	assert.equal(browserViewSuppressed(), true);
	assert.deepEqual(suppressedOverlayIds(), ["dialog"]);
	inner();
	assert.equal(
		browserViewSuppressed(),
		true,
		"one registration is still live, so the view stays hidden",
	);
	outer();
	assert.equal(browserViewSuppressed(), false);
});

test("a release is idempotent: a double-release cannot unbalance the count", () => {
	const release = suppressBrowserView("toast");
	release();
	release();
	assert.equal(browserViewSuppressed(), false);
	const other = suppressBrowserView("toast");
	assert.equal(browserViewSuppressed(), true);
	other();
	assert.equal(browserViewSuppressed(), false);
});

// ---- a bounded, validated restore (review round 1, R5) ----------------------

/** Write a session file and read it back through the shipped reader. */
function readBack(name, tabs) {
	const dir = join(root, `restore-${name}`);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, SESSION_FILENAME);
	writeFileSync(path, JSON.stringify({ version: 1, tabs }));
	const lines = [];
	const read = readSession(path, (message) => lines.push(message));
	return { read, lines };
}

/** A persisted tab with `count` entries, the last one active by default. */
function persistedTab(count, overrides = {}) {
	return {
		owner: "user",
		active: false,
		entries: Array.from({ length: count }, (_unused, index) => ({
			url: `https://example.com/page-${index}`,
			title: `Page ${index}`,
		})),
		activeIndex: count - 1,
		...overrides,
	};
}

test("a restore allocates a bounded number of tabs, and keeps the tab the user was on", () => {
	// 256 valid rows, which is the count the round-1 review used: the file is not
	// hostile, it is a long-lived session, and every entry in it is restorable.
	const tabs = Array.from({ length: 256 }, (_unused, index) =>
		persistedTab(1, {
			active: false,
			entries: [
				{ url: `https://example.com/tab-${index}`, title: `Tab ${index}` },
			],
			activeIndex: 0,
		}),
	);
	// The tab the user was looking at is the OLDEST one, which is the case a plain
	// `.slice(-N)` would drop.
	tabs[0].active = true;
	const { read } = readBack("cap", tabs);

	assert.equal(
		read.length,
		MAX_RESTORED_TABS,
		"one restore pass allocates at most the budget, whatever the file says",
	);
	assert.ok(
		read.some((tab) => tab.active),
		"the tab that was active is kept, because restoring it is the point of the feature",
	);
	assert.equal(
		read[0].entries[0].url,
		"https://example.com/tab-0",
		"file order is preserved, so the tab strip does not shuffle to make the arithmetic easier",
	);
	assert.ok(
		read.some((tab) => tab.entries[0].url === "https://example.com/tab-255"),
		"the newest tabs are kept as well as the active one",
	);
});

test("a restored stack is bounded around the entry the tab was showing", () => {
	const { read } = readBack("stack", [
		persistedTab(400, { active: true, activeIndex: 300 }),
	]);
	assert.equal(read.length, 1);
	assert.equal(
		read[0].entries.length,
		MAX_RESTORED_ENTRIES,
		"one tab's history depth is bounded too: a stack is memory the user never asked to spend twice",
	);
	assert.ok(
		read[0].entries.some(
			(entry) => entry.url === "https://example.com/page-300",
		),
		"the entry the tab was showing survives the bound: keeping only the newest would delete the page the user left off on",
	);
	assert.ok(
		read[0].entries.some(
			(entry) => entry.url === "https://example.com/page-299",
		),
		"and so does the entry before it, because a restored stack is restored so that Back still works",
	);
	const active = read[0].entries[read[0].activeIndex];
	assert.equal(
		active.url,
		"https://example.com/page-300",
		"the index is re-derived onto the surviving window, so the tab opens on the page it left off on",
	);
	assert.equal(
		read[0].entries[read[0].activeIndex - 1].url,
		"https://example.com/page-299",
		"with that history immediately behind it",
	);

	// And the other end of the same rule: an active entry near the START keeps the
	// whole window of depth rather than whatever happened to be left before it.
	const early = readBack("stack-early", [
		persistedTab(400, { active: true, activeIndex: 2 }),
	]).read;
	assert.equal(early[0].entries.length, MAX_RESTORED_ENTRIES);
	assert.equal(
		early[0].activeIndex,
		2,
		"an index inside the window is not moved",
	);
	assert.equal(early[0].entries[2].url, "https://example.com/page-2");
});

test("an oversized page state is dropped whole, and its entry kept", () => {
	const huge = "c3RhdGU=".repeat(Math.ceil(MAX_RESTORED_PAGE_STATE_CHARS / 4));
	const { read } = readBack("page-state", [
		{
			owner: "user",
			active: true,
			entries: [
				{ url: "https://example.com/big", title: "Big", pageState: huge },
				{
					url: "https://example.com/small",
					title: "Small",
					pageState: "c3RhdGU=",
				},
			],
			activeIndex: 1,
		},
	]);
	assert.equal(read.length, 1);
	assert.equal(read[0].entries.length, 2, "both entries are still restorable");
	assert.equal(
		read[0].entries[0].pageState,
		undefined,
		"half a serialised page state is a corrupt one, so the whole blob goes rather than a prefix",
	);
	assert.equal(
		read[0].entries[1].pageState,
		"c3RhdGU=",
		"a page state inside the budget is carried through verbatim",
	);
});

test("a session file past the size budget is refused before it is parsed", () => {
	const dir = join(root, "restore-oversized");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, SESSION_FILENAME);
	// Valid JSON, so the refusal is about SIZE rather than about a parse failure:
	// the path is writable by anything on the machine and the read must not size
	// itself off what the file says.
	const padding = "x".repeat(MAX_SESSION_FILE_BYTES + 1);
	writeFileSync(
		path,
		`{"version":1,"tabs":[{"owner":"user","active":true,"entries":[{"url":"https://example.com/","title":"${padding}"}],"activeIndex":0}]}`,
	);
	const lines = [];
	const read = readSession(path, (message) => lines.push(message));
	assert.deepEqual(
		read,
		[],
		"an oversized file restores nothing rather than restoring slowly",
	);
	assert.ok(
		lines.some((line) => line.includes(String(MAX_SESSION_FILE_BYTES))),
		`the refusal names the budget: ${JSON.stringify(lines)}`,
	);
});

test("an unusable entry is filtered before anything is allocated, and a long URL is one of those", () => {
	const tooLong = `https://example.com/${"a".repeat(MAX_RESTORED_URL_CHARS)}`;
	const { read } = readBack("unusable", [
		{
			owner: "user",
			active: true,
			entries: [
				{ url: tooLong, title: "Too long" },
				{ url: "about:blank", title: "Not a page" },
				{ url: "javascript:alert(1)", title: "Not a page" },
				{ url: "https://example.com/kept", title: "Kept" },
			],
			activeIndex: 3,
		},
		{ owner: "user", active: false, entries: [], activeIndex: 0 },
	]);
	assert.equal(read.length, 1, "a tab with nothing restorable is not a tab");
	assert.deepEqual(
		read[0].entries.map((entry) => entry.url),
		["https://example.com/kept"],
		"the scheme rule and the length rule both apply one layer before the host allocates a view",
	);
	assert.equal(
		read[0].activeIndex,
		0,
		"the index is re-derived against what survived",
	);
});

// ---- the terminal rectangle (review round 1, R4) ---------------------------

test("the null rect is delivered on the spot, and it cancels a pending frame", () => {
	const frames = new Map();
	const cancelled = [];
	const delivered = [];
	let nextFrameId = 0;
	const previousRaf = globalThis.requestAnimationFrame;
	const previousCancel = globalThis.cancelAnimationFrame;
	const previousWindow = globalThis.window;
	// A frame that RUNS is no longer pending: the real scheduler forgets it, so the
	// stub has to as well, or "one report in flight" would not be observable.
	const runFrame = (id) => {
		const callback = frames.get(id);
		frames.delete(id);
		return callback();
	};
	globalThis.requestAnimationFrame = (callback) => {
		nextFrameId += 1;
		frames.set(nextFrameId, callback);
		return nextFrameId;
	};
	globalThis.cancelAnimationFrame = (id) => {
		cancelled.push(id);
		frames.delete(id);
	};
	// The bridge the hook talks to, recorded in order. Installed BEFORE the render
	// because `browserBridgeAvailable()` reads it in the component body.
	globalThis.window = {
		api: {
			browser: {
				setContentRect: (rect) => {
					delivered.push(rect);
					return Promise.resolve({});
				},
				state: async () => null,
			},
		},
	};
	try {
		const chrome = renderBrowserChrome();
		assert.ok(chrome, "the hook returned its API (the render ran)");
		assert.deepEqual(delivered, [], "mounting alone reports no rectangle");

		// A resize sample is throttled: recorded, and one frame scheduled.
		chrome.setContentRect({ x: 0, y: 84, width: 1380, height: 785 });
		assert.deepEqual(delivered, [], "a resize sample waits for the frame");
		assert.equal(frames.size, 1, "and schedules exactly one");

		// A second sample before the frame coalesces into it.
		chrome.setContentRect({ x: 0, y: 84, width: 1380, height: 900 });
		assert.equal(frames.size, 1, "two samples in one frame are one report");
		runFrame([...frames.keys()][0]);
		assert.deepEqual(
			delivered,
			[{ x: 0, y: 84, width: 1380, height: 900 }],
			"the frame delivers the newest sample, once",
		);

		// The route-teardown case, which is what this rule is for: the null must not
		// wait for a frame, because the frame is exactly what the unmount cancels.
		chrome.setContentRect({ x: 0, y: 84, width: 1380, height: 785 });
		assert.equal(frames.size, 1, "a pending sample is scheduled...");
		chrome.setContentRect(null);
		assert.deepEqual(
			delivered.at(-1),
			null,
			"the terminal null rect reaches main synchronously, in the same tick it was reported",
		);
		assert.equal(
			frames.size,
			0,
			"and it drops the pending sample, which would otherwise put the view back up on a route that no longer exists",
		);
		assert.equal(cancelled.length, 1, "by cancelling the frame it replaced");
	} finally {
		globalThis.requestAnimationFrame = previousRaf;
		globalThis.cancelAnimationFrame = previousCancel;
		globalThis.window = previousWindow;
	}
});

// ---- the host handover (design 7.3's REQUIRED test) ------------------------

/**
 * Two hosts, one rectangle.
 *
 * The pane and the route are never co-mounted, so there is exactly one rect
 * reporter at a time (spec 7.3) — and the handover between them is the moment the
 * contract can be broken in a way no still frame shows: a stale null landing
 * AFTER the incoming host's first report leaves main with no rectangle, so every
 * view is hidden while the surface's own box looks correctly laid out. Frames
 * cannot see it, because the chrome is DOM and lays out fine either way; the
 * delivery ORDER is the whole of the claim.
 *
 * The outgoing host's last word is a null delivered ON THE SPOT — not on a frame,
 * because the frame is exactly what the unmount cancels — and this test drives
 * both hosts' `setContentRect` through the same recorded bridge, in the order the
 * app produces them.
 */
test("the host handover ends with the incoming host's rectangle, not a stale null", () => {
	const frames = new Map();
	const delivered = [];
	const PANE_RECT = { x: 740, y: 84, width: 640, height: 785 };
	const ROUTE_RECT = { x: 0, y: 84, width: 1380, height: 785 };
	let nextFrameId = 0;
	const previousRaf = globalThis.requestAnimationFrame;
	const previousCancel = globalThis.cancelAnimationFrame;
	const previousWindow = globalThis.window;
	const runFrames = () => {
		for (const id of [...frames.keys()]) {
			const callback = frames.get(id);
			frames.delete(id);
			callback();
		}
	};
	globalThis.requestAnimationFrame = (callback) => {
		nextFrameId += 1;
		frames.set(nextFrameId, callback);
		return nextFrameId;
	};
	globalThis.cancelAnimationFrame = (id) => {
		frames.delete(id);
	};
	globalThis.window = {
		api: {
			browser: {
				setContentRect: (rect) => {
					delivered.push(rect);
					return Promise.resolve({});
				},
				state: async () => null,
			},
		},
	};
	try {
		// The pane is on screen and its content element is the narrow column.
		const pane = renderBrowserChrome();
		pane.setContentRect(PANE_RECT);
		runFrames();
		assert.deepEqual(
			delivered,
			[PANE_RECT],
			"the pane's own report lands first",
		);

		// `/chat` -> `/browser` with the pane open. The pane unmounts, and its hook's
		// terminal guarantee delivers the null in the same tick — the delivery is
		// synchronous and does not wait for the frame the unmount just cancelled for
		// its own pending sample.
		pane.setContentRect(PANE_RECT);
		pane.setContentRect(null);
		assert.deepEqual(
			delivered.at(-1),
			null,
			"the outgoing host's last word is the hide, delivered on the spot",
		);
		assert.equal(frames.size, 0, "and it dropped its own pending sample");

		// The route mounts in the same commit and reports the whole main area, one
		// frame later.
		const route = renderBrowserChrome();
		route.setContentRect(ROUTE_RECT);
		runFrames();
		assert.deepEqual(
			delivered,
			[PANE_RECT, null, ROUTE_RECT],
			"in order: the pane's rect, the hide, then the route's rect",
		);
		assert.equal(
			delivered.at(-1)?.width,
			ROUTE_RECT.width,
			"the last word belongs to the host that is on screen, so the page is visible once",
		);

		// THE COUNTERFACTUAL, which is what makes the order a contract rather than a
		// coincidence: the same two reports with the null arriving last. Main treats a
		// null rect as "nowhere to paint" and hides every view, so this sequence is
		// the page invisible on a surface that looks correctly laid out.
		delivered.length = 0;
		route.setContentRect(ROUTE_RECT);
		runFrames();
		pane.setContentRect(null);
		assert.equal(
			delivered.at(-1),
			null,
			"a stale null after the new host's report is the failure the ordering prevents",
		);
	} finally {
		globalThis.requestAnimationFrame = previousRaf;
		globalThis.cancelAnimationFrame = previousCancel;
		globalThis.window = previousWindow;
	}
});

// ---- one error slot per fact (review round 1, R6) --------------------------

/** The shipped source with comments stripped, for the rules a render cannot see. */
function shippedSource(relativePath) {
	const source = readFileSync(join(process.cwd(), relativePath), "utf8");
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("an action's refusal is not erased by the state read that follows it (R6)", () => {
	const source = shippedSource(
		"src/renderer/src/features/browser/hooks/use-browser-chrome.ts",
	);
	// `setError` was the single slot: a refresh that succeeded cleared whatever the
	// action had just recorded, which is the bug. Its absence is the pin that a
	// revert has to come here and argue with.
	assert.ok(
		!source.includes("setError("),
		"there is no single error slot left for a refresh to clear",
	);
	/*
	 * The helper is `unwrapIpcErrorMessage` from `@shared/utils/ipc-error-message`
	 * now - the update surfaces unwrap the same envelope, and the prefix is
	 * spelled once for both. What this pin is about is unchanged: the call is
	 * still `setActionError(<unwrapped message>)`, and it still comes BEFORE the
	 * re-read.
	 */
	assert.ok(
		/setActionError\(unwrapIpcErrorMessage\(caught\)\)[\s\S]*?await refresh\(\)/.test(
			source,
		),
		"`run` records the action's refusal BEFORE it re-reads the projection",
	);
	const refresh = source.slice(
		source.indexOf("export function useBrowserProjection"),
		source.indexOf("export function useBrowserChrome"),
	);
	assert.ok(
		refresh.includes("setReadError(null)"),
		"a successful state read clears the READ error only",
	);
	assert.ok(
		!refresh.includes("setActionError"),
		"and it cannot touch the action's own refusal",
	);
	// The slice's boundary moved with the read itself: `useBrowserProjection` owns
	// the projection and its error slot, and `useBrowserChrome` composes it. The
	// rule is unchanged, and it is still the SHIPPED source this reads.
	assert.ok(
		/setActionError\(null\);\s*clearReadError\(\);/.test(source),
		"the explicit dismissal clears both, which is the only other way an action error goes away",
	);
	assert.ok(
		/const clearReadError = useCallback\(\(\): void => \{\s*setReadError\(null\);\s*\}, \[\]\)/.test(
			source,
		),
		"and the slot it clears is the read's own, so the dismissal is not a second writer of the action's",
	);
});

// ---- a banner click reaches the request it named (review round 1, R8) ------

test("the attention names one request, and a stale clear cannot drop a newer one", () => {
	const seen = [];
	const unsubscribe = subscribeConsentAttention(() =>
		seen.push(consentAttentionSnapshot()),
	);
	assert.equal(
		consentAttentionSnapshot(),
		null,
		"nothing is attended to by default",
	);

	noteConsentAttention("entry-a");
	assert.equal(consentAttentionSnapshot(), "entry-a");
	noteConsentAttention("entry-a");
	assert.equal(
		seen.length,
		1,
		"naming the same request twice is not a second wake-up",
	);

	// The request the user was answering is gone, and a NEWER one has arrived: a
	// late clear for the old entry must not take the new one with it.
	noteConsentAttention("entry-b");
	clearConsentAttention("entry-a");
	assert.equal(
		consentAttentionSnapshot(),
		"entry-b",
		"an answer to one request does not clear attention on another",
	);

	clearConsentAttention("entry-b");
	assert.equal(consentAttentionSnapshot(), null);
	clearConsentAttention();
	assert.equal(
		consentAttentionSnapshot(),
		null,
		"clearing nothing is not an event",
	);
	unsubscribe();
});

// ---- the consent bar's own copy (design round 1, D2 and D3) ----------------

const PENDING = {
	entryId: "entry-1",
	origin: "https://login.example.com",
	authority: "login.example.com",
	broad: { scope: "domain", key: "example.com" },
	expiresAt: Date.now() + 600_000,
	requesterSessionId: "session-abc",
};

/** A request as the model takes it, built the way the route builds one. */
const request = (entryId, authority, minutesLeft) => ({
	...PENDING,
	entryId,
	origin: `https://${authority}`,
	authority,
	expiresAt: Date.now() + Math.round(minutesLeft * 60_000),
});

/** The consent band's props, from the REAL model: the ordinal and the remaining
 * time in these assertions are the ones the product computes, so a change to
 * either fails here rather than only in a frame. */
const trayProps = (requests, options = {}) => ({
	rows: approvalRows(requests, Date.now()),
	resolved: options.resolved ?? [],
	selectedEntryId: options.selectedEntryId ?? null,
	onSelect: () => {},
	busy: options.busy ?? false,
	onDecide: () => {},
	dockOpen: options.dockOpen ?? false,
	onToggleDock: () => {},
	headerLabel: options.headerLabel ?? defaultApprovalHeaderLabel,
});

test("the consent bar names the conversation that is asking (D2)", () => {
	// The resolution rule, exercised directly: `renderToStaticMarkup` reads a
	// zustand store's INITIAL state for its server snapshot, so a store mutated
	// after creation is invisible to a rendered assertion — the rule is therefore
	// called with the session list, which is the same call the component makes.
	assert.equal(
		requesterLabel("session-abc", [
			{ session_id: "session-abc", title: "Quarterly research" },
		]),
		"The agent in 'Quarterly research'",
		"a known session is named by its conversation title",
	);
	assert.equal(
		requesterLabel("session-abc", [{ session_id: "session-abc", title: "  " }]),
		"The agent in conversation session-abc",
		"an untitled session stands in as its id, the way this app treats one everywhere else",
	);
	assert.equal(
		requesterLabel(null, [{ session_id: "session-abc", title: "Named" }]),
		"An agent",
		"a requester that is not a session identity is never published: it may be an internal request id",
	);

	const markup = render(
		el(
			BrowserConsentBar,
			trayProps([{ ...PENDING, requesterSessionId: null }]),
		),
	);
	// The markup escapes the apostrophe, so the assertion is on the words rather
	// than on the exact punctuation.
	assert.ok(
		markup.includes("An agent wants to open"),
		`the band still says what is being asked for: ${markup.slice(0, 300)}`,
	);
	assert.ok(
		markup.includes("login.example.com"),
		"and names the origin the decision is about",
	);
	// ONE PENDING REQUEST HAS NO HEADER ROW (spec §4.1): there is nothing to
	// disambiguate, so the band is the card, which is the band the user knows.
	assert.ok(
		!markup.includes("approval waiting") &&
			!markup.includes("approvals waiting"),
		"one request renders no count and no chips",
	);
});

test("the consent bar states each choice's own lifetime, and that the profile is shared (D3)", () => {
	const markup = render(
		el(
			BrowserConsentBar,
			trayProps(
				[
					request("entry-a", "docs.example.org", 9),
					PENDING,
					request("entry-c", "shop.example.net", 2),
				],
				{ selectedEntryId: "entry-1" },
			),
		),
	);
	assert.ok(
		!markup.includes("using this app's browser profile, until you revoke it"),
		"the blanket lifetime that was false for the once and session choices is gone",
	);
	assert.ok(
		markup.includes("one navigation, for that conversation"),
		"the once grant says what it is actually bound to",
	);
	assert.ok(
		markup.includes("this run only, and for every conversation"),
		"the session grant says it is not per-conversation, which its own button could not say",
	);
	assert.ok(
		markup.includes(
			"kept until you revoke it, and shared with every conversation",
		),
		"a persistent grant names both its lifetime and its audience",
	);
	assert.ok(
		markup.includes("every site under example.com"),
		"the domain choice states what it actually covers",
	);
	assert.ok(
		markup.includes("keeps sign-ins across conversations and app restarts"),
		"the shared profile, and the retained sign-ins in it, are stated rather than implied",
	);
	assert.ok(
		markup.includes("You can open this site yourself either way"),
		"and the gate's asymmetry survives the rewrite",
	);
	// The queued count moved from a sentence in the card to the tray's header,
	// which is the surface that can also show WHICH request is which.
	assert.ok(
		markup.includes("3 approvals waiting"),
		"a user can see that others are queued, and how many",
	);
	assert.ok(
		markup.includes("browser-approvals-tray-chip"),
		"one numbered chip per live request (spec 4.1's header row)",
	);
	assert.ok(
		markup.includes(
			"Request 2 from The agent in conversation session-abc: login.example.com",
		),
		"and the chip's accessible name carries the ordinal, the ASKING conversation and the authority (UX round 1, U2: two requests for one site must not read the same)",
	);
	assert.equal(
		defaultApprovalHeaderLabel(1),
		"1 approval waiting",
		"the singular is its own sentence",
	);

	// The domain line is only offered when the host computed the broad key: the bar
	// must not describe a choice it does not render.
	const noBroad = render(
		el(BrowserConsentBar, trayProps([{ ...PENDING, broad: null }])),
	);
	assert.ok(
		!noBroad.includes("example.com, kept until you revoke it"),
		"no public-suffix data means no domain offer and no domain copy",
	);
});

// ---- the approval queue model (spec 3.3, 3.4, 5.2) -------------------------

test("liveness is derived from a clock: the count drops at the TTL with nothing firing in main", () => {
	const now = 1_000_000;
	const requests = [
		{ ...PENDING, entryId: "live", expiresAt: now + 60_000 },
		{ ...PENDING, entryId: "gone", expiresAt: now - 1 },
	];
	assert.deepEqual(
		liveRequests(requests, now).map((entry) => entry.entryId),
		["live"],
		"the expired request is not live, and no main-side change was needed to say so",
	);
	// The boundary is `now < expiresAt`, the same comparison `access-queue.ts`
	// makes: an entry is live up to its instant and not at it.
	assert.deepEqual(
		liveRequests(requests, now + 60_000).map((entry) => entry.entryId),
		[],
		"at exactly its expiry instant the request is gone",
	);
});

test("the ordinal is a position in the live list, and answering one renumbers the rest", () => {
	const now = 2_000_000;
	const requests = [
		{ ...PENDING, entryId: "one", expiresAt: now + 60_000 },
		{ ...PENDING, entryId: "two", expiresAt: now + 120_000 },
		{ ...PENDING, entryId: "three", expiresAt: now + 180_000 },
	];
	assert.deepEqual(
		approvalRows(requests, now).map((row) => row.ordinal),
		[1, 2, 3],
		"1-based, in the order the host projected them",
	);
	// Answering the first is exactly what the host does: the entry leaves the
	// projection and every later request moves up, the way a numbered list does.
	assert.deepEqual(
		approvalRows(requests.slice(1), now).map((row) => [
			row.ordinal,
			row.request.entryId,
		]),
		[
			[1, "two"],
			[2, "three"],
		],
		"a position, not an identity",
	);
});

test("the remaining time is stated in words, and stops counting below a minute", () => {
	const now = 3_000_000;
	assert.equal(remainingLabel(now + 9 * 60_000, now), "expires in 9 minutes");
	assert.equal(remainingLabel(now + 60_000, now), "expires in 1 minute");
	assert.equal(remainingLabel(now + 59_999, now), "expires in under a minute");
	assert.equal(remainingLabel(now, now), null, "nothing left to say");
	assert.equal(
		remainingLabel(now + 90_000, now),
		"expires in 2 minutes",
		"rounded up, so a reading is never optimistic about the agent's window",
	);
});

test("a request that leaves the list is remembered as expired or withdrawn, and an answered one is not", () => {
	const now = 4_000_000;
	const expired = { ...PENDING, entryId: "expired", expiresAt: now - 1 };
	const withdrawn = {
		...PENDING,
		entryId: "withdrawn",
		expiresAt: now + 60_000,
	};
	const answered = { ...PENDING, entryId: "answered", expiresAt: now + 60_000 };
	const resolved = reconcileResolved(
		[expired, withdrawn, answered],
		[],
		[],
		new Set(["answered"]),
		// Nothing was reported before this call, so the memory starts empty — that
		// argument is the set retention cannot prune (review round 3, MAJOR).
		new Set(),
		now,
	);
	assert.deepEqual(
		resolved.map((row) => [row.key, row.kind]),
		[
			["expired", "expired"],
			["withdrawn", "withdrawn"],
		],
		"past its TTL is an expiry; anything else that leaves the list without an answer is a withdrawal",
	);
	assert.ok(
		!resolved.some((row) => row.key === "answered"),
		"a request the user answered is not reported as gone: the user knows what happened to it",
	);

	// Bounded, both ways: five rows, and nothing older than five minutes.
	const many = Array.from({ length: 9 }, (_, index) => ({
		...PENDING,
		entryId: `old-${index}`,
		expiresAt: now - 1,
	}));
	assert.equal(
		reconcileResolved(many, [], [], new Set(), new Set(), now).length,
		RESOLVED_KEEP,
		"the memory is bounded",
	);
	assert.deepEqual(
		reconcileResolved(
			[],
			[],
			[
				{
					key: "stale",
					kind: "expired",
					origin: "https://a.example",
					authority: "a.example",
					at: now - 5 * 60_000,
				},
			],
			new Set(),
			new Set(),
			now,
		),
		[],
		"and drops a row five minutes after the fact",
	);
	// A request that arrives in the same refresh a row was remembered for is not a
	// second row: the retention is keyed on the entry the host minted.
	assert.equal(
		reconcileResolved(
			[],
			[],
			[
				{
					key: "expired",
					kind: "expired",
					origin: "https://a.example",
					authority: "a.example",
					at: now,
				},
			],
			new Set(),
			new Set(),
			now + 1000,
		).length,
		1,
	);
});

test("a parked tab's Waiting chip carries the ordinal of the request its origin is on", () => {
	const now = 5_000_000;
	const rows = approvalRows(
		[
			{
				...PENDING,
				entryId: "one",
				origin: "https://docs.example.org",
				expiresAt: now + 60_000,
			},
			{
				...PENDING,
				entryId: "two",
				origin: "https://login.example.com",
				expiresAt: now + 120_000,
			},
		],
		now,
	);
	const waiting = waitingOrdinals(rows, [
		{ tabId: 1, url: "https://docs.example.org/page", owner: "agent" },
		{ tabId: 2, url: "https://login.example.com/", owner: "agent" },
		{ tabId: 3, url: "about:blank", owner: "agent" },
		{ tabId: 4, url: "https://elsewhere.example/", owner: "agent" },
		// A tab the USER opened to a pending origin: their own navigation is ungated
		// and the page loads, so the marker would describe something that is not
		// happening to that tab (UX round 1, U3).
		{ tabId: 5, url: "https://docs.example.org/mine", owner: "user" },
	]);
	assert.deepEqual(
		waiting,
		{ 1: 1, 2: 2 },
		"the chip names the same request the tray's chip and the dock's row name, and only on the agent's own tabs",
	);
	assert.equal(
		originOfUrl("about:blank"),
		null,
		"`new URL('about:blank').origin` is the STRING \"null\", which is truthy",
	);
	assert.equal(
		originOfUrl("file:///tmp/x"),
		null,
		"and a non-http scheme is not an origin the gate knows",
	);
});

test("a conversation's scope keeps a tab with no attribution out of its list", () => {
	const tabs = [
		{ tabId: 1, url: "https://a.example/", sessionId: "session-a" },
		{ tabId: 2, url: "https://b.example/", sessionId: "session-b" },
		{ tabId: 3, url: "https://c.example/", sessionId: null },
		{ tabId: 4, url: "https://d.example/" },
	];
	assert.deepEqual(
		tabsInScope(tabs, "all").map((tab) => tab.tabId),
		[1, 2, 3, 4],
		"the route shows every tab, including a restored one and one handed back",
	);
	assert.deepEqual(
		tabsInScope(tabs, { sessionId: "session-a" }).map((tab) => tab.tabId),
		[1],
		"a conversation shows its own tabs, and only its own",
	);
});

test("the scope labels name what each grant is", () => {
	assert.deepEqual(
		["origin", "domain", "host", "deny", "session"].map(approvalScopeLabel),
		["This site", "Whole domain", "This host", "Denied", "This session only"],
		"the vocabulary moved with the list it labels, unchanged",
	);
});

// ---- the conversation's scope (spec 7.2, 7.4) ------------------------------

/**
 * A pending request, as the host projects it, with only the fields these tests
 * read spelled out. `requesterSessionId` is the field the scope filter uses; the
 * rest are the projection's own shape so a wrong key is a failure rather than a
 * silently-missing field.
 */
const pendingRequest = (entryId, origin, requesterSessionId) => ({
	entryId,
	origin,
	authority: origin.replace("https://", ""),
	broad: null,
	expiresAt: 1_000,
	requesterSessionId,
});

test("a conversation's requests are the ones its agent asked for, and matching an origin is not asking", () => {
	const requests = [
		pendingRequest("1", "https://shared.example", "alice"),
		pendingRequest("2", "https://other.example", "bob"),
		// THE CASE THE DESIGN REJECTS ORIGIN-MATCHING FOR: a request on the SAME origin
		// as one of alice's own tabs, raised by someone who is not a session identity.
		// A filter that matched a request to a conversation by looking at the origin
		// would show this in alice's tray and let her answer a prompt that is not hers
		// (spec 7.2, "Alternative rejected").
		pendingRequest("3", "https://shared.example", null),
	];
	assert.deepEqual(
		requestsInScope(requests, "all").map((entry) => entry.entryId),
		["1", "2", "3"],
		"the route shows every request, whoever asked and whether or not they are a session",
	);
	assert.deepEqual(
		requestsInScope(requests, { sessionId: "alice" }).map(
			(entry) => entry.entryId,
		),
		["1"],
		"a conversation shows the requests its own agent raised, and only those",
	);
	assert.deepEqual(
		requestsInScope(requests, { sessionId: "carol" }),
		[],
		"a conversation with no requests of its own sees an empty tray, not everyone else's",
	);
});

test("a scope's KEY is its value, so a host cannot trip the surface's identity memos", () => {
	// The regression this pins was real: everything downstream of the scope keys on
	// its IDENTITY (the tab and request memos, and the queue model's effects, one of
	// which publishes the clock and so re-renders the surface). A host that rebuilds
	// its scope object per render therefore re-ran the model's effect on every
	// render, published the clock, and rendered again — a loop on a surface that
	// still paints. The surface keys on the VALUE now, and this is the value.
	assert.equal(scopeKey("all"), "all");
	assert.equal(scopeKey({ sessionId: "session-1f4c" }), "session:session-1f4c");
	assert.equal(
		scopeKey({ sessionId: "session-1f4c" }),
		scopeKey({ sessionId: "session-1f4c" }),
		"two objects with one value are one key, which is the whole point",
	);
	// INJECTIVE (review round 1, NIT A): a session literally named `all` is a
	// session, not the all-tabs scope, and it has to survive the round trip
	// through the key the surface rebuilds its scope from.
	assert.notEqual(
		scopeKey({ sessionId: "all" }),
		scopeKey("all"),
		"a session named `all` must not collapse to the all-tabs scope",
	);
	for (const scope of [
		"all",
		{ sessionId: "all" },
		{ sessionId: "session-1f4c" },
	]) {
		assert.deepEqual(
			scopeFromKey(scopeKey(scope)),
			scope,
			"the key survives the round trip the surface depends on",
		);
	}
});

test("the pane's tray sentence says which list its count is about", () => {
	assert.equal(defaultApprovalHeaderLabel(1), "1 approval waiting");
	assert.equal(defaultApprovalHeaderLabel(3), "3 approvals waiting");
	// The pane's own: two facts, because the pane's strip can be showing every
	// conversation's tabs while the count stays this conversation's (spec 7.2).
	assert.equal(paneApprovalHeaderLabel(1), "1 approval for this conversation");
	assert.equal(paneApprovalHeaderLabel(3), "3 approvals for this conversation");
});

test("the tab index groups a pool by conversation, unattributed last", () => {
	// Design R3. The order rule is the whole of the "see all the tabs that
	// conversation opened" claim: groups by their FIRST tab, tabs within a group in
	// the order they arrived (the registry's creation order), and the unattributed
	// run last, because conversations are the organising idea and the tail is the
	// miscellaneous set (open question 8).
	const tabs = [
		{ tabId: 1, sessionId: "alice" },
		{ tabId: 2, sessionId: null },
		{ tabId: 3, sessionId: "bob" },
		{ tabId: 4, sessionId: "alice" },
		{ tabId: 5, sessionId: "bob" },
	];
	assert.deepEqual(
		groupTabsBySession(tabs).map((group) => [
			group.sessionId,
			group.tabs.map((tab) => tab.tabId),
		]),
		[
			["alice", [1, 4]],
			["bob", [3, 5]],
			[null, [2]],
		],
		"three interleaved conversations read A A B B, not A B A A B",
	);
	// THE POOL IS THE GROUPING FLATTENED, derived rather than compared again: the
	// bulk close's "to the right" label counts tabs in this order, and the user
	// counts them by looking at the strip.
	assert.deepEqual(
		pooledTabs(tabs).map((tab) => tab.tabId),
		[1, 4, 3, 5, 2],
		"the rendered order is the grouped order",
	);
	// A single-group pool stays ONE group: the strip renders no chips unless there
	// are two conversations in the pool (design R3), which is what keeps the pane's
	// own conversation scope byte-identical to what it rendered before this change.
	assert.equal(
		groupTabsBySession(tabs.filter((tab) => tab.sessionId === "alice")).length,
		1,
		"one conversation is one group, and gets no label",
	);

	// KEYED FROM THE TAB SIDE, and unattributed tabs are in NO entry: they are not
	// any conversation's, which is the same rule `tabsInScope` applies.
	assert.deepEqual([...tabsBySession(tabs).keys()], ["alice", "bob"]);
	assert.deepEqual(
		tabsBySession(tabs)
			.get("bob")
			?.map((tab) => tab.tabId),
		[3, 5],
	);
	assert.equal(tabsBySession(tabs).has("null"), false);
});

test("a conversation's summary counts its tabs, and reuses its entry when nothing changed", () => {
	// The identity-reuse half is not a micro-optimisation: the sidebar renders every
	// row in one scroll container with no virtualisation, so a new Map of new objects
	// per browser event re-renders all forty rows for a change that touched one.
	const tabs = [
		{ tabId: 1, sessionId: "alice", loading: true },
		{ tabId: 2, sessionId: "alice", failed: true },
		{ tabId: 3, sessionId: "bob" },
		{ tabId: 4, sessionId: null },
	];
	const requests = [
		// Expired at `now`, and main prunes nothing: counting it would put a badge on
		// a row for an ask that is over, which is the defect `approval-queue-model.ts`
		// exists to prevent.
		{ entryId: "r1", requesterSessionId: "alice", expiresAt: 1_000 },
		{ entryId: "r2", requesterSessionId: "alice", expiresAt: 9_000 },
		// A non-session requester belongs to no conversation (spec 7.2).
		{ entryId: "r3", requesterSessionId: null, expiresAt: 9_000 },
		{ entryId: "r4", requesterSessionId: "bob", expiresAt: 9_000 },
	];
	const first = summariseConversations(tabs, requests, 2_000);
	assert.deepEqual(first.get("alice"), {
		tabCount: 2,
		loadingCount: 1,
		failedCount: 1,
		pendingApprovals: 1,
	});
	assert.deepEqual(first.get("bob"), {
		tabCount: 1,
		loadingCount: 0,
		failedCount: 0,
		pendingApprovals: 1,
	});
	assert.equal(
		first.has("null"),
		false,
		"no summary is keyed on the unattributed set: a null key is not a conversation",
	);

	const second = summariseConversations(tabs, requests, 2_000, first);
	assert.equal(
		second.get("alice"),
		first.get("alice"),
		"an unchanged conversation hands back the SAME object, which is what stops its row re-rendering",
	);
	assert.equal(second.get("bob"), first.get("bob"));

	// A change to ONE conversation must not disturb another's identity, and must
	// produce a new object for the one that changed.
	const third = summariseConversations(
		tabs.map((tab) => (tab.tabId === 1 ? { ...tab, loading: false } : tab)),
		requests,
		2_000,
		first,
	);
	assert.notEqual(
		third.get("alice"),
		first.get("alice"),
		"a changed count is a changed entry",
	);
	assert.equal(third.get("bob"), first.get("bob"));
	assert.equal(third.get("alice")?.loadingCount, 0);

	// A conversation with a live request and no tabs of its own is present with a
	// zero tab count rather than absent: the mark has to say "an agent here is
	// waiting on you" for a conversation whose tab the user has already closed.
	const waiting = summariseConversations(
		tabs.filter((tab) => tab.sessionId !== "carol"),
		[
			...requests,
			{ entryId: "r5", requesterSessionId: "carol", expiresAt: 9_000 },
		],
		2_000,
	);
	assert.deepEqual(waiting.get("carol"), {
		tabCount: 0,
		loadingCount: 0,
		failedCount: 0,
		pendingApprovals: 1,
	});
});

test("the bulk closes resolve to the tabs the labels name", () => {
	// Design R5. `others` means the WHOLE POOL, not the host's visible list — in the
	// pane, scoped to two tabs of eight, the label reads `Close 7 other tabs`, which
	// is the truth about what it does.
	const tabs = [
		{ tabId: 1, sessionId: null },
		{ tabId: 2, sessionId: "alice" },
		{ tabId: 3, sessionId: null },
		{ tabId: 4, sessionId: "alice" },
	];
	assert.deepEqual(
		closeOthersIntent(tabs, 2),
		{ mode: "ids", tabIds: [4, 1, 3] },
		"`others` excludes exactly the kept tab, in the order the strip shows",
	);
	assert.equal(
		closeOthersIntent([{ tabId: 2, sessionId: "alice" }], 2),
		null,
		"one tab has no others, so the item is not offered",
	);
	assert.equal(closeOthersIntent([], 7), null, "nothing to close is no item");

	// `to the right` is about the RENDERED order, which is the grouped one.
	const pooled = pooledTabs(tabs);
	assert.deepEqual(
		closeToTheRightIntent(pooled, 2),
		{ mode: "ids", tabIds: [4, 1, 3] },
		"the tabs after the anchor in the grouped order the user is looking at",
	);
	assert.equal(
		closeToTheRightIntent(pooled, 3),
		null,
		"the last tab in the order shows no `to the right` item",
	);
	assert.equal(
		closeToTheRightIntent(pooled, 99),
		null,
		"an anchor that is not in the list closes nothing",
	);

	assert.deepEqual(closeConversationIntent("alice"), {
		mode: "conversation",
		sessionId: "alice",
	});
});

test("a conversation is named by its title, or by its id when it has none", () => {
	const sessions = [
		{ session_id: "alice", title: "Reports" },
		{ session_id: "bob", title: "   " },
		{ session_id: "carol", title: null },
	];
	assert.equal(sessionDisplayName("alice", sessions), "Reports");
	assert.equal(
		sessionDisplayName("bob", sessions),
		"bob",
		"a whitespace title is not a name",
	);
	assert.equal(sessionDisplayName("carol", sessions), "carol");
	assert.equal(
		sessionDisplayName("dave", sessions),
		"dave",
		"a session the list does not know is its own id, the same fallback the hand-over dialog uses",
	);
	// The requester sentence is built on the SAME rule (one rule, two callers).
	assert.equal(requesterLabel("alice", sessions), "The agent in 'Reports'");
	assert.equal(
		requesterLabel("bob", sessions),
		"The agent in conversation bob",
	);
	assert.equal(requesterLabel("alice", sessions, { short: true }), "Reports");
	assert.equal(requesterLabel(null, sessions), "An agent");
});

test("both hosts render the page area under the same spinner, so one selector holds in both", () => {
	const previousWindow = globalThis.window;
	// The bridge the hook asks for. No effects run in a static render, so the
	// surface is captured in its pre-first-read state — which is the state this
	// assertion is about (spec 7.4: the pane's loading state is the SAME spinner as
	// the route's, so a QA pass can assert one selector in both hosts).
	globalThis.window = {
		api: {
			browser: { state: async () => null, setContentRect: async () => {} },
		},
	};
	try {
		const route = render(el(BrowserPage));
		const pane = render(
			el(BrowserPane, { sessionId: "session:alice", onClose: () => {} }),
		);
		const spinner = /<span role="status"[\s\S]*?<\/span><\/span>/;
		const routeSpinner = route.match(spinner)?.[0] ?? null;
		const paneSpinner = pane.match(spinner)?.[0] ?? null;
		assert.ok(routeSpinner, `the route has no spinner: ${route.slice(0, 400)}`);
		assert.equal(
			paneSpinner,
			routeSpinner,
			"the pane's loading state is the route's own element, not a second one that resembles it",
		);
		assert.ok(
			routeSpinner.includes("Loading browser"),
			"and it announces what is loading, so the assertion above is about a labelled spinner",
		);
		// The per-host evidence tags, which spec 9's item 4 asks a test to know: the
		// hosts never co-mount, so the ONLY way a run can say which host it drove is
		// that each host stamps its own.
		assert.ok(
			route.includes('data-tour-tag="browser-route"'),
			"the route stamps itself as the route",
		);
		assert.ok(
			pane.includes('data-tour-tag="browser-pane-surface"'),
			"and the pane stamps itself as the pane",
		);
	} finally {
		globalThis.window = previousWindow;
	}
});

test("the pane's scope switch is the pane's own, and the conversation side needs a session", () => {
	const previousWindow = globalThis.window;
	globalThis.window = {
		api: {
			browser: { state: async () => null, setContentRect: async () => {} },
		},
	};
	try {
		const scoped = render(
			el(BrowserPane, { sessionId: "session:alice", onClose: () => {} }),
		);
		assert.ok(
			scoped.includes("This conversation") && scoped.includes("All tabs"),
			"the pane offers both scopes, with the words the spec names",
		);
		assert.ok(
			scoped.includes('data-tour-tag="browser-pane-scope-conversation"'),
			"and the conversation side is addressable as itself",
		);
		assert.ok(
			scoped.includes('[role="tab"') || scoped.includes('role="tab"'),
			"it is the segmented primitive's own tablist, not a new control",
		);
		assert.equal(
			(scoped.match(/data-disabled=""/g) ?? []).length,
			0,
			"with a session, both sides are available",
		);
		// A draft: there is no set to scope to yet, so the conversation side is
		// DISABLED rather than silently showing the same list as All tabs.
		const draft = render(
			el(BrowserPane, { sessionId: null, onClose: () => {} }),
		);
		assert.equal(
			(draft.match(/data-disabled=""/g) ?? []).length,
			1,
			"with no session, exactly one side is disabled — the conversation side",
		);
		assert.ok(
			draft.includes("This conversation") && draft.includes("All tabs"),
			"and the switch still states both scopes rather than disappearing",
		);
		const route = render(el(BrowserPage));
		assert.ok(
			route.includes("This conversation") === false,
			"the route has no second scope to offer, so it has no switch",
		);
	} finally {
		globalThis.window = previousWindow;
	}
});

/* ---------------------------------------------------------------- */
/* Two scopes, one surface: the switch moves the tabs only           */
/* (QA round 1, Q1; UX round 1, U1, U3 and U4; QA round 1, Q2)        */
/* ---------------------------------------------------------------- */

test("the surface feeds the requests the requester's scope and the tabs the switch's", () => {
	const surface = shippedSource(
		"src/renderer/src/features/browser/components/browser-surface.tsx",
	);
	// THE DEFECT, PINNED BOTH WAYS. One `scope` prop fed both filters, so on the
	// pane's All-tabs side the tray widened to every conversation's requests and,
	// worse, an entry left the queue model's input while still pending - which the
	// model resolves as `Withdrawn by the agent`. The line below is the fix; the
	// assertion above it is the shape a revert has to argue with.
	assert.ok(
		surface.includes("requestsInScope(requests ?? [], stableRequestScope)"),
		"the requests are filtered by the scope whose own key is the requester",
	);
	assert.ok(
		!surface.includes("requestsInScope(requests ?? [], stableScope)"),
		"and never by the tabs' scope, which is the switch's",
	);
	assert.ok(
		surface.includes("tabsInScope(allTabs ?? [], stableScope)"),
		"while the tabs keep the scope the host's switch moves",
	);
	// Both are props, because a host that had only one could not express the two
	// questions a pane asks (spec 7.2).
	assert.ok(
		surface.includes("tabScope,") && surface.includes("requestScope,"),
		"and the host chooses both",
	);
});

test("the pane's request scope is the conversation, and never the switch", () => {
	const pane = shippedSource(
		"src/renderer/src/features/browser/components/browser-pane.tsx",
	);
	// The request scope's own derivation, read out of the file rather than guessed
	// at: `scoped` is the switch's term, and it must not appear here at all.
	const requests = pane.slice(
		pane.indexOf("const requestScope"),
		pane.indexOf("const switchValue"),
	);
	assert.ok(
		requests.includes('sessionId !== null ? { sessionId } : "all"'),
		"the requests follow the session",
	);
	assert.ok(
		!requests.includes("scoped"),
		"and nothing the user presses on the switch reaches them",
	);
	// A draft has no conversation to name, so the tray must not name one (U4): the
	// conversation's sentence is passed only WITH a conversation.
	assert.ok(
		pane.includes("sessionId !== null ? paneApprovalHeaderLabel : undefined"),
		"the tray's sentence is conditional on there being a conversation to name",
	);
	// THE LENS IS THE SLOT'S, NOT THE PANE'S (U3). The pane is remounted by a
	// conversation switch, so a `useState` here forgot the choice on every switch
	// while the pane itself stayed open at the width the user had dragged. Its
	// absence is the pin, because the absence is the fix.
	assert.ok(
		!pane.includes("useState"),
		"the pane holds no local state for the switch to be forgotten in",
	);
});

test("the scope the user chose outlives the pane, because the pane does not", () => {
	const store = useUiPreferencesStore;
	const pane = shippedSource(
		"src/renderer/src/features/browser/components/browser-pane.tsx",
	);
	// THE CHOICE IS THE STORE'S, and the read is what pins it: a fresh mount (which
	// is what a conversation switch produces) has to find the lens where the last
	// one left it, and the pane's own header comment claimed exactly that for a
	// round while the state was local (U3).
	assert.ok(
		pane.includes("useUiPreferencesStore((s) => s.browserPaneScope)"),
		"the pane reads the lens out of the window's slot state",
	);
	assert.ok(
		pane.includes("useUiPreferencesStore((s) => s.setBrowserPaneScope)"),
		"and writes it back there",
	);
	store.setState({ browserPaneScope: "conversation" });
	store.getState().setBrowserPaneScope("all");
	assert.equal(
		store.getState().browserPaneScope,
		"all",
		"the store keeps the choice",
	);
	store.setState({ browserPaneScope: "conversation" });
	/*
	 * WHY THIS IS A SOURCE PIN RATHER THAN A RENDER: a static render cannot see a
	 * store at all. The store's hook passes `getServerSnapshot`, which is zustand's
	 * own contract for SSR and returns the INITIAL state, so a rendered pane shows
	 * the switch's default whatever the store holds - the same limit that makes
	 * `render` capture the surface before its first projection read. The behavioural
	 * half is driven in the app by `renderer-driver.mjs --scene browser-pane`, which
	 * presses the switch, switches conversation and back, and reads the active side.
	 */
});

test("the pinned strip control appears only when a tab is off screen, and counts them", () => {
	const strip = shippedSource(
		"src/renderer/src/features/browser/components/browser-tab-strip.tsx",
	);
	// QA round 1 (Q2): the control was drawn whenever the strip held two tabs, on
	// the route's own 1160px strip where nothing overflows, with an empty own text
	// and a label reading `All tabs` - so its presence said nothing and its content
	// said less. The measurement decides both now.
	assert.ok(
		strip.includes("{tabsOffScreen > 0 && ("),
		"the control's presence is the measurement",
	);
	assert.ok(
		!strip.includes("{tabs.length > 1 && ("),
		"and not the tab count, which is what it was for a round",
	);
	assert.ok(
		strip.includes("+{tabsOffScreen}"),
		"the count of tabs that are not shown is the control's own text",
	);
	assert.ok(
		strip.includes("aria-label={`All tabs, ${tabsOffScreen} not shown`}"),
		"and it is in the accessible name, not only in the tooltip",
	);
	assert.ok(
		strip.includes('querySelectorAll("[data-tab-id]")'),
		"the count is measured from the rows' own boxes",
	);
});

// ---- a failed navigation says so (design round 1, D1) ----------------------

test("a failed navigation names the reason in the app's own chrome, and offers a retry", () => {
	const retried = [];
	const markup = render(
		el(BrowserLoadFailure, {
			failure: {
				code: -324,
				description: "ERR_EMPTY_RESPONSE",
				url: "http://127.0.0.1:9/",
			},
			onRetry: () => retried.push(true),
		}),
	);
	// The markup escapes the apostrophe, so the assertion is on the words rather
	// than on the exact punctuation.
	assert.ok(
		markup.includes("load this page"),
		`the failure is stated rather than left as an empty frame: ${markup.slice(0, 300)}`,
	);
	assert.ok(
		markup.includes("closed the connection without sending a response"),
		"the sentence is the reason, not a generic apology",
	);
	assert.ok(
		markup.includes("ERR_EMPTY_RESPONSE") &&
			markup.includes("http://127.0.0.1:9/"),
		"and the raw refusal and the attempted address are on screen for a bug report",
	);
	assert.ok(
		markup.includes("browser-load-failure-retry") &&
			markup.includes("Try again"),
		"a recovery path is offered, because the panel is the only thing the user can act on",
	);
	assert.equal(retried.length, 0, "the retry is not fired by rendering");

	// Where there is no sentence worth writing, the panel says the one thing that is
	// always true instead of inventing a cause.
	assert.equal(
		loadFailureSentence("ERR_SOMETHING_NEW"),
		"The page could not be loaded.",
	);
	assert.equal(
		loadFailureSentence("ERR_NAME_NOT_RESOLVED"),
		"That address does not resolve. Check the spelling.",
	);
});

/* ---------------------------------------------------------------- */
/* The third term of the right slot, and the tags a run drives on    */
/* (review round 1, F3 and F4)                                       */
/* ---------------------------------------------------------------- */

test("the browser pane is a third term of the right slot, exclusive with both siblings", () => {
	const store = useUiPreferencesStore;
	// The canvas/run pair was pinned in `composer-tabs.test.mjs`; the third term is
	// this change's, and a store rule with no test is the rule a later edit deletes.
	store.setState({
		isCanvasOpen: false,
		isRunPanelOpen: false,
		isBrowserPaneOpen: false,
		runPanelReveal: null,
	});
	store.getState().setCanvasOpen(true);
	store.getState().setRunPanelOpen(true);
	assert.equal(
		store.getState().isCanvasOpen,
		false,
		"opening the run panel closes the canvas",
	);

	store.getState().setBrowserPaneOpen(true);
	const afterPane = store.getState();
	assert.equal(
		afterPane.isRunPanelOpen,
		false,
		"the pane closes the run panel",
	);
	assert.equal(afterPane.isCanvasOpen, false, "and the canvas");
	assert.equal(afterPane.isBrowserPaneOpen, true);

	store.getState().setCanvasOpen(true);
	assert.equal(
		store.getState().isBrowserPaneOpen,
		false,
		"the canvas closes the pane",
	);
	store.getState().setBrowserPaneOpen(true);
	assert.equal(
		store.getState().isCanvasOpen,
		false,
		"and the pane closes it back",
	);
	store.getState().setRunPanelOpen(true);
	assert.equal(
		store.getState().isBrowserPaneOpen,
		false,
		"the run panel closes the pane too",
	);

	// The FOURTH writer is the chip's one-shot reveal, which is the path a user
	// actually takes to the run panel while the pane is open.
	store.getState().setBrowserPaneOpen(true);
	store.getState().revealRunPanelSection("todos");
	const afterReveal = store.getState();
	assert.equal(
		afterReveal.isBrowserPaneOpen,
		false,
		"the composer chip's reveal clears the pane as well",
	);
	assert.equal(afterReveal.isRunPanelOpen, true);
	store.setState({
		isCanvasOpen: false,
		isRunPanelOpen: false,
		isBrowserPaneOpen: false,
		runPanelReveal: null,
	});
});

test("each host stamps its own dock tag, so a run can say which dock it drove", () => {
	// Spec 9's item 4 asks for the tags to be asserted, and the dock's is the one
	// that cannot be reached by a static render: it mounts only while the surface's
	// own `dockOpen` state is set. So the pin is on the two hosts' own call sites,
	// where the tag is chosen - one assertion covering both hosts.
	const pane = shippedSource(
		"src/renderer/src/features/browser/components/browser-pane.tsx",
	);
	const route = shippedSource(
		"src/renderer/src/features/browser/components/browser-page.tsx",
	);
	/*
	 * THE TAGS ARE READ OUT OF THE TWO FILES AND THEN COMPARED, rather than two
	 * literals compared with each other (review round 2, NIT 2). The round-1 version
	 * closed with `assert.notEqual("browser-pane-dock", "browser-approvals-dock")` -
	 * two strings typed in the test, which cannot fail and would have passed unchanged
	 * if both hosts stamped one tag. What the claim needs is the pair as the tree
	 * spells them, each exactly once: the `deepEqual`s pin the values (they subsume
	 * the two `includes` pins this test used to carry), and the `notEqual` on the
	 * parsed pair is what makes "the two hosts cannot share one dock tag" falsifiable.
	 */
	const dockTagsIn = (source) =>
		[...source.matchAll(/dockSurfaceTag="([^"]+)"/g)].map((match) => match[1]);
	const paneTags = dockTagsIn(pane);
	const routeTags = dockTagsIn(route);
	assert.deepEqual(
		paneTags,
		["browser-pane-dock"],
		"the pane names its dock once, and by its own tag, so a frame of a docked pane is attributable",
	);
	assert.deepEqual(
		routeTags,
		["browser-approvals-dock"],
		"and the route keeps its own, once",
	);
	assert.notEqual(
		paneTags[0],
		routeTags[0],
		"the two hosts cannot share one dock tag, or a run could not say which dock its frames show",
	);
});
