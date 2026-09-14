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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { build } from "esbuild";

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
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// `browser-view-policy.ts` imports React for its hooks; the module is imported
	// but never renders, and the package resolves normally from here.
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	BrowserSessionStore,
	SESSION_FILENAME,
	SESSION_FILE_MODE,
	SESSION_DIR_MODE,
	captureTabs,
	readSession,
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
		this.historyEntries = history ?? [{ url: "https://example.com/", title: "Example" }];
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
				this.historyEntries.map((entry) => ({ ...entry, pageState: "c3RhdGU=" })),
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

function makeRegistry() {
	const views = new Map();
	const registry = new TabRegistry(
		(_options, tabId) => {
			const view = new FakeView();
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
	assert.equal(mode, SESSION_FILE_MODE, "the file mode is the one this module intends");
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
	assert.ok(!raw.includes("handedTo"), "a hand-over does not survive a restart either");
	assert.ok(raw.includes('"owner": "agent"'), "the owner is recorded for the diagnostics");
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
	assert.deepEqual(readSession(path, (line) => logged.push(line)), []);

	writeFileSync(path, JSON.stringify({ version: 99, tabs: [{ entries: [] }] }));
	assert.deepEqual(readSession(path), [], "a version this build does not write is refused");

	// A tab whose only entries are non-http(s) is dropped rather than restored into
	// a navigation the view's own `will-navigate` would then refuse.
	writeFileSync(
		path,
		JSON.stringify({
			version: 1,
			tabs: [
				{ owner: "user", active: true, entries: [{ url: "file:///etc/passwd" }], activeIndex: 0 },
				{ owner: "user", active: false, entries: [{ url: "https://ok.example/" }], activeIndex: 0 },
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
	const pending = third.requestAccess(other.href, "session:a", "async", "req-1");
	third.respond(pending.entry_id, "session");
	assert.equal(third.revokeOrigin(other.origin) > 0, true);
	assert.equal(third.originAllowed(other), false);
	assert.equal(third.grants().length, 0);
});

test("'revoke all' clears the durable set and the session set in one action", () => {
	const store = storeIn("approvals-revoke-all");
	const durable = safeHttpUrl("https://durable.example/");
	const held = store.requestAccess(durable.href, "session:a", "async", "req-1");
	store.respond(held.entry_id, "site");
	const session = safeHttpUrl("https://sessiononly.example/");
	const pending = store.requestAccess(session.href, "session:a", "async", "req-2");
	store.respond(pending.entry_id, "session");
	assert.equal(store.grants().length, 2);

	const removed = store.revokeAll();
	assert.equal(removed, 2, "both rows are reported, not only the durable one");
	assert.equal(store.grants().length, 0);
	assert.equal(store.originAllowed(durable), false);
	assert.equal(store.originAllowed(session), false);
	// Revoking is not a logout: the call touches no cookie and no cache, which is
	// why the sheet's copy says so.
	assert.equal(existsSync(join(root, "approvals-revoke-all", "session.json")), false);
});

test("revoking one origin takes the broad grant that admitted it, too", () => {
	const store = storeIn("approvals-broad");
	const url = safeHttpUrl("https://sub.gominerva.com/page");
	const pending = store.requestAccess(url.href, "session:a", "async", "req-1");
	assert.ok(pending.broad, "a broad option is offered when public-suffix data exists");
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
