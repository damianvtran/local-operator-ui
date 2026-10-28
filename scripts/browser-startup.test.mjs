/** Production startup wiring, with Electron/native boundaries replaced only.
 * No browser engine, desktop window or live profile is booted. The actual host,
 * registry, restore store, HTTP listener, state writer and rollback path run. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const electron = `
import { EventEmitter } from 'node:events';
const f = () => globalThis.__browserStartupFixture;
// A real EventEmitter: production startup registers a module-level
// before-quit history flush (browser/index.ts), and a bare object stub
// turns that registration into a startup crash the app never has. The fake
// models the listener surface; the test never fires quit itself.
export const app = Object.assign(new EventEmitter(), { getVersion: () => 'isolated-test' });
export class BrowserWindow { constructor() { throw new Error('A test must never create a desktop window'); } }
export const shell = { openPath: async () => '' };
// The page context menu's two Electron members (LOH-13), modelled only so
// the shipped import in main/browser/index.ts resolves: startup never
// opens the menu, so building one is a no-op here rather than a fake menu.
export const Menu = { buildFromTemplate: () => ({ popup: () => {} }) };
export const clipboard = { writeText: () => {} };
export const webContents = { getAllWebContents: () => [] };
export class Notification { static isSupported() { return false; } }
export const safeStorage = { isEncryptionAvailable: () => false };
export const protocol = { registerSchemesAsPrivileged() {} };
export const ipcMain = {
 handle: (name, fn) => { if (f().handlers.has(name)) throw new Error("Attempted to register a second handler for '" + name + "'"); f().handlers.set(name, fn); },
 removeHandler: name => f().handlers.delete(name),
 on: () => {},
 removeListener: () => {} };
export const session = { fromPartition: () => f().session };
export class WebContentsView {
 constructor() {
  const wc = new EventEmitter();
  Object.assign(wc, { id: ++f().id, session: f().session,
   isDestroyed: () => !!wc.destroyed, isLoading: () => false, getURL: () => wc.url || 'about:blank', getTitle: () => '',
   getUserAgent: () => 'isolated-test', setUserAgent() {}, setAudioMuted() {}, setBackgroundThrottling() {},
   setZoomMode() {}, setZoomFactor() {}, getZoomFactor: () => 1,
   setWindowOpenHandler() {}, loadURL: async url => { wc.url = url; },
   close: () => { if (!wc.destroyed) { wc.destroyed = true; wc.emit('destroyed'); f().views.delete(wc.id); } },
   debugger: { isAttached: () => false },
   navigationHistory: { canGoBack: () => false, canGoForward: () => false,
     length: () => 1, getActiveIndex: () => 0,
     getEntryAtIndex: () => ({ url: wc.url || 'about:blank' }),
     restore: async ({ entries }) => { wc.url = entries[0]?.url; },
     getAllEntries: () => [{ url: wc.url || 'about:blank' }] }
  });
  this.webContents = wc; this.setBounds = () => {}; this.setVisible = () => {};
  // The card child reads its provisional width and sets its ground through
  // these; a launch that builds the card must not fail on a missing native
  // boundary, and the zero-width measurement returns before any DOM read.
  this.setBackgroundColor = () => {};
  this.getBounds = () => ({ x: 0, y: 0, width: 0, height: 0 });
  wc.executeJavaScript = async () => 0;
  f().views.add(wc.id); f().peak = Math.max(f().peak, f().views.size);
 }
}
`;
const bundled = await build({
	stdin: {
		contents: 'export * from "./src/main/browser/index";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	target: "node20",
	plugins: [
		{
			name: "startup-native-boundaries",
			setup(b) {
				b.onResolve({ filter: /^electron$/ }, () => ({
					path: "electron",
					namespace: "startup-test",
				}));
				b.onLoad({ filter: /.*/, namespace: "startup-test" }, () => ({
					contents: electron,
					loader: "js",
				}));
				b.onLoad({ filter: /main\/webauthn(?:\/index)?\.ts$/ }, () => ({
					contents: `
export async function installWebauthn() { globalThis.__browserStartupFixture.installs++; }
export class WebauthnChooser { dispose() {} state() { return null; } }
export function attachWebauthnChooser() { return () => {}; }
`,
					loader: "ts",
				}));
				b.onLoad({ filter: /main\/console\/index\.ts$/ }, () => ({
					contents: `
export async function startConsoleHost() {
 const f = globalThis.__browserStartupFixture;
 f.consoleCalls++;
 if (f.failConsole) throw new Error('injected console initialization exception');
 return { ok: false, reason: 'startup_failed', detail: 'isolated optional-console failure', stop: async () => {} };
}
`,
					loader: "ts",
				}));
				b.onLoad(
					{ filter: /main\/browser\/session-cookies-electron\.ts$/ },
					() => ({
						contents: `
export function createHiddenCookieJarTarget(view) { return { jar: {}, dispose: () => view.webContents.close() }; }
export const HIDDEN_COOKIE_JAR_WEB_PREFERENCES = {};
export function browserProfileCipher() { return {}; }
export function electronCookieCipher() { return {}; }
export function selectCookieCipher() { return {}; }
`,
						loader: "ts",
					}),
				);
				b.onLoad({ filter: /main\/browser\/session-cookies\.ts$/ }, () => ({
					contents: `
export function sessionCookiePaths() { return {}; }
export class SessionCookieVault { async restore() { return { status: 'empty' }; } async snapshot() {} }
`,
					loader: "ts",
				}));
			},
		},
	],
});
const harnessRoot = mkdtempSync(
	join(process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir(), "startup-module-"),
);
const modulePath = join(harnessRoot, "startup.mjs");
writeFileSync(modulePath, bundled.outputFiles[0].text);
const { startBrowserHost, stopBrowserHost } = await import(
	pathToFileURL(modulePath).href
);

function fixture(failConsole) {
	const dir = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD || tmpdir(), "browser-startup-"),
	);
	mkdirSync(join(dir, "browser"));
	const saved = JSON.stringify({
		version: 1,
		tabs: Array.from({ length: 7 }, (_, index) => ({
			owner: "user",
			active: index === 0,
			entries: [{ url: `https://example.test/${index}` }],
			activeIndex: 0,
		})),
	});
	writeFileSync(join(dir, "browser", "session.json"), saved);
	const session = new EventEmitter();
	Object.assign(session, {
		getStoragePath: () => "",
		isPersistent: () => false,
		setUserAgent() {},
		getUserAgent: () => "isolated-test",
		setPermissionRequestHandler() {},
		setPermissionCheckHandler() {},
		setDevicePermissionHandler() {},
		protocol: { handle() {} },
		webRequest: {
			onBeforeRequest() {},
			onBeforeSendHeaders() {},
			onHeadersReceived() {},
		},
	});
	const mainFrame = { url: "http://localhost:5173/index.html" };
	const webContents = Object.assign(new EventEmitter(), {
		id: 700,
		mainFrame,
		send() {},
		isDestroyed: () => false,
		// The real Electron API ownsPage reads; this fake must model it so a host
		// that asks the focus fact cannot crash on the fake's shape.
		getFocusedWebContents: () =>
			globalThis.__browserStartupFixture?.focused ?? null,
		setIgnoreMenuShortcuts(value) {
			webContents.ignoringMenu = value;
		},
	});
	const window = Object.assign(new EventEmitter(), {
		isDestroyed: () => false,
		webContents,
		contentView: {
			children: [],
			addChildView(view) {
				this.children.push(view);
			},
			removeChildView(view) {
				const index = this.children.indexOf(view);
				if (index >= 0) this.children.splice(index, 1);
			},
		},
		getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
	});
	const f = {
		dir,
		saved,
		session,
		window,
		handlers: new Map(),
		views: new Set(),
		peak: 0,
		id: 800,
		installs: 0,
		consoleCalls: 0,
		failConsole,
		logs: [],
	};
	globalThis.__browserStartupFixture = f;
	return f;
}
function options(f) {
	return {
		window: f.window,
		expectedUrl: "http://localhost:5173",
		appVersion: "isolated-test",
		userDataDir: f.dir,
		windowShow: false,
		consoleCaptureUrl: "",
		log: (message) => f.logs.push(message),
	};
}

test("production startup owns IPC before awaits, rolls back seven restored views before each retry, and preserves history", async () => {
	const f = fixture(true);
	const pending = startBrowserHost(options(f));
	const second = startBrowserHost(options(f));
	assert.equal(pending, second, "same-window starts share one initializer");
	const read = f.handlers.get("browser-state");
	assert.equal(
		read({
			sender: f.window.webContents,
			senderFrame: f.window.webContents.mainFrame,
		}).availability.status,
		"starting",
	);
	try {
		await assert.rejects(pending, /injected console initialization exception/);
		assert.equal(f.consoleCalls, 3);
		assert.equal(f.views.size, 0, f.logs.join("\n"));
		assert.equal(
			f.session.listenerCount("will-download"),
			0,
			"no stale attempt download listeners",
		);
		assert.equal(
			f.peak,
			8,
			"seven tab views plus one cookie target, never two attempts mounted together",
		);
		assert.equal(
			readFileSync(join(f.dir, "browser", "session.json"), "utf8"),
			f.saved,
		);
		assert.equal(
			read({
				sender: f.window.webContents,
				senderFrame: f.window.webContents.mainFrame,
			}).availability.status,
			"unavailable",
		);
	} finally {
		await stopBrowserHost();
	}
});

/** S6c's launch option, exactly the shape `src/main/index.ts` now passes. */
function overlayOptions() {
	return {
		enabled: true,
		documentUrl: "file:///isolated/browser-approvals-overlay.html",
		preloadPath: "/isolated/browser-approvals-overlay.js",
	};
}

// Pinned to APPROVALS_OVERLAY_DISABLE_ENV in src/main/browser/approvals-overlay.ts;
// the unit test asserts the constant's exact spelling and values.
const APPROVALS_OVERLAY_DISABLE_ENV =
	"LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_DISABLE";

/** The card child among the restored tab views the fake window now records. */
function cardChildren(f) {
	return f.window.contentView.children.filter((view) =>
		view.webContents.getURL().includes("browser-approvals-overlay.html"),
	);
}

test("the approvals card is default-on: an ordinary launch builds its child", async () => {
	const previous = process.env[APPROVALS_OVERLAY_DISABLE_ENV];
	delete process.env[APPROVALS_OVERLAY_DISABLE_ENV];
	const f = fixture(false);
	try {
		await startBrowserHost({
			...options(f),
			approvalsOverlay: overlayOptions(),
		});
		assert.equal(
			cardChildren(f).length,
			1,
			"the enabled launch adds the native card child",
		);
		const projection = f.handlers.get("browser-state")({
			sender: f.window.webContents,
			senderFrame: f.window.webContents.mainFrame,
		});
		assert.equal(projection.approvalsCard.available, true);
	} finally {
		await stopBrowserHost();
		assert.equal(
			cardChildren(f).length,
			0,
			"stopping the host removes the card child",
		);
		if (previous === undefined) {
			delete process.env[APPROVALS_OVERLAY_DISABLE_ENV];
		} else {
			process.env[APPROVALS_OVERLAY_DISABLE_ENV] = previous;
		}
	}
});

test("the disable switch makes an ordinary launch create no card child at all", async () => {
	const previous = process.env[APPROVALS_OVERLAY_DISABLE_ENV];
	process.env[APPROVALS_OVERLAY_DISABLE_ENV] = "1";
	const f = fixture(false);
	try {
		await startBrowserHost({
			...options(f),
			approvalsOverlay: overlayOptions(),
		});
		assert.equal(cardChildren(f).length, 0, "the kill switch creates no child");
		const projection = f.handlers.get("browser-state")({
			sender: f.window.webContents,
			senderFrame: f.window.webContents.mainFrame,
		});
		assert.equal(projection.approvalsCard.available, false);
	} finally {
		await stopBrowserHost();
		if (previous === undefined) {
			delete process.env[APPROVALS_OVERLAY_DISABLE_ENV];
		} else {
			process.env[APPROVALS_OVERLAY_DISABLE_ENV] = previous;
		}
	}
});

test("production shared browser serves seven restored user-owned tabs even when console is unavailable", async () => {
	const f = fixture(false);
	try {
		const handle = await startBrowserHost(options(f));
		const health = await (
			await fetch(`http://127.0.0.1:${handle.port}/health`)
		).json();
		assert.equal(health.host, "ui");
		assert.equal(health.console, false);
		assert.equal(typeof health.instance_id, "string");
		const projection = f.handlers.get("browser-state")({
			sender: f.window.webContents,
			senderFrame: f.window.webContents.mainFrame,
		});
		assert.equal(projection.availability.status, "ready");
		assert.equal(projection.tabs.length, 7);
		assert.equal(f.session.listenerCount("will-download"), 1);
		assert.ok(projection.tabs.every((tab) => tab.owner === "user"));
	} finally {
		await stopBrowserHost();
		assert.equal(f.views.size, 0);
		assert.equal(f.session.listenerCount("will-download"), 0);
	}
});

test("chrome focus is reset by a renderer reload or crash, and the listeners detach on stop (review R7)", async () => {
	const f = fixture(false);
	const contents = f.window.webContents;
	let handle;
	try {
		handle = await startBrowserHost(options(f));
		const setFocus = f.handlers.get("browser-set-chord-focus");
		const sender = { sender: contents, senderFrame: contents.mainFrame };
		const reportFocus = (value) => setFocus(sender, value);
		const ignoring = () => contents.ignoringMenu;
		reportFocus(true);
		assert.equal(
			handle.host.chordFocus,
			true,
			"renderer reported logical ownership",
		);
		// An in-page route change or a subframe load is NOT a renderer reload.
		contents.emit("did-start-navigation", {
			isMainFrame: true,
			isSameDocument: true,
		});
		contents.emit("did-start-navigation", {
			isMainFrame: false,
			isSameDocument: false,
		});
		// This startup fixture never presents browser chrome. Retaining the DOM's
		// logical owner is necessary across in-page navigation, but it must NOT
		// authorize a menu action without presentation and foreground window facts.
		assert.equal(
			handle.host.chordFocus,
			true,
			"logical focus survives non-reloads",
		);
		assert.equal(
			handle.chords.menu("close-tab"),
			false,
			"unpresented chrome cannot execute a menu despite logical ownership",
		);
		// A main-frame, cross-document navigation is a reload: no unmount cleanup runs.
		contents.emit("did-start-navigation", {
			isMainFrame: true,
			isSameDocument: false,
		});
		assert.equal(
			handle.host.chordFocus,
			false,
			"reload dropped the logical owner",
		);
		assert.equal(
			handle.chords.menu("close-tab"),
			false,
			"reload cannot authorize a menu",
		);
		assert.equal(ignoring(), false);
		reportFocus(true);
		assert.equal(
			handle.host.chordFocus,
			true,
			"logical owner restored before crash",
		);
		contents.emit("render-process-gone", {}, { reason: "crashed" });
		assert.equal(
			handle.host.chordFocus,
			false,
			"crash dropped the logical owner",
		);
		assert.equal(
			handle.chords.menu("close-tab"),
			false,
			"crash cannot authorize a menu",
		);
		assert.equal(contents.listenerCount("did-start-navigation") >= 1, true);
	} finally {
		await stopBrowserHost();
	}
	assert.equal(
		contents.listenerCount("did-start-navigation"),
		0,
		"stop detached",
	);
	assert.equal(
		contents.listenerCount("render-process-gone"),
		0,
		"stop detached",
	);
});

/** The ipcMain stub above now throws on a duplicate `handle`, exactly as
 * Electron does. That makes this test the regression guard F1 asked for: an
 * exhausted startup must leave the window able to start again — the handlers
 * stay live for the open window, and a later start re-registers them
 * idempotently instead of throwing "second handler for 'browser-state'". */
test("a second start after an exhausted startup re-registers IPC and does not throw", async () => {
	const f = fixture(true);
	await assert.rejects(
		startBrowserHost(options(f)),
		/injected console initialization exception/,
	);
	// The window is still open: the renderer must still be able to read the typed
	// projection rather than a missing handler.
	assert.ok(
		f.handlers.has("browser-state"),
		"an exhausted startup keeps the window's read handler live",
	);
	// A later start is a fresh invocation: it re-registers cleanly (no duplicate
	// handler throw) and reaches the same typed failure rather than crashing.
	await assert.rejects(
		startBrowserHost(options(f)),
		/injected console initialization exception/,
		"the retry start must not throw a duplicate-handler error",
	);
	await stopBrowserHost();
	assert.equal(f.handlers.size, 0, "stop releases every handler");
});

/** D1a: the `unavailable` state is a dead end without a recovery control, so the
 * typed availability carries `canRetry` and the namespace exposes a
 * `browser-retry` channel that restarts THIS window's host through the one
 * lifecycle path. The handler is reachable with a host absent (that is the whole
 * point) and exercises the same failure, proving the click re-enters startup
 * rather than throwing a missing-handler or no-op. */
test("the unavailable state offers a retry that re-enters startup for the same window", async () => {
	const f = fixture(true);
	await assert.rejects(
		startBrowserHost(options(f)),
		/injected console initialization exception/,
	);
	const projection = f.handlers.get("browser-state")({
		sender: f.window.webContents,
		senderFrame: f.window.webContents.mainFrame,
	});
	assert.equal(projection.availability.status, "unavailable");
	assert.equal(
		projection.availability.canRetry,
		true,
		"an exhausted startup must offer the recovery control",
	);
	const retry = f.handlers.get("browser-retry");
	assert.ok(retry, "the retry channel is registered");
	const callsBefore = f.consoleCalls;
	// The retry resolves `{ retried: true }` even when startup fails again: the
	// failure is reported through the typed availability the renderer already
	// reads, not as an IPC rejection a click handler would have to unwrap.
	assert.deepEqual(
		await retry({
			sender: f.window.webContents,
			senderFrame: f.window.webContents.mainFrame,
		}),
		{ retried: true },
	);
	assert.ok(
		f.consoleCalls > callsBefore,
		"the retry actually re-entered startup",
	);
	assert.equal(
		f.handlers.get("browser-state")({
			sender: f.window.webContents,
			senderFrame: f.window.webContents.mainFrame,
		}).availability.status,
		"unavailable",
		"the retry's own failure lands back on the unavailable state",
	);
	// The channel runs the SAME sender-authorization gate as the rest of the
	// namespace. Without this assertion, deleting `authorizeSender` from the
	// retry handler fails no test (round 2, Q-R2-1): a foreign webContents, or the
	// right webContents with a foreign frame, must be refused before the host is
	// touched.
	await assert.rejects(
		() =>
			Promise.resolve().then(() =>
				retry({
					sender: { id: 999 },
					senderFrame: f.window.webContents.mainFrame,
				}),
			),
		/This window cannot use the browser controls/,
		"a foreign sender must be refused by browser-retry",
	);
	await assert.rejects(
		() =>
			Promise.resolve().then(() =>
				retry({
					sender: f.window.webContents,
					senderFrame: { ...f.window.webContents.mainFrame },
				}),
			),
		/This window cannot use the browser controls/,
		"a foreign frame must be refused by browser-retry",
	);
	// A doubled click needs no guard of its own: `startBrowserHost` is already
	// single-flight for this window, so concurrent retries collapse to one
	// startup sequence (round 2, Q-R2-2). Asserted rather than assumed.
	const callsBeforeDouble = f.consoleCalls;
	const boundedAttempts = f.handlers.get("browser-state")({
		sender: f.window.webContents,
		senderFrame: f.window.webContents.mainFrame,
	}).availability.maxAttempts;
	await Promise.all([
		retry({
			sender: f.window.webContents,
			senderFrame: f.window.webContents.mainFrame,
		}),
		retry({
			sender: f.window.webContents,
			senderFrame: f.window.webContents.mainFrame,
		}),
	]);
	assert.equal(
		f.consoleCalls - callsBeforeDouble,
		boundedAttempts,
		"two concurrent retries run ONE bounded startup sequence, not two",
	);
	await stopBrowserHost();
});
