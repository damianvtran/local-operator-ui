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
export const app = { getVersion: () => 'isolated-test' };
export class BrowserWindow { constructor() { throw new Error('A test must never create a desktop window'); } }
export const shell = { openPath: async () => '' };
export const webContents = { getAllWebContents: () => [] };
export class Notification { static isSupported() { return false; } }
export const safeStorage = { isEncryptionAvailable: () => false };
export const protocol = { registerSchemesAsPrivileged() {} };
export const ipcMain = { handle: (name, fn) => f().handlers.set(name, fn), removeHandler: name => f().handlers.delete(name) };
export const session = { fromPartition: () => f().session };
export class WebContentsView {
 constructor() {
  const wc = new EventEmitter();
  Object.assign(wc, { id: ++f().id, session: f().session,
   isDestroyed: () => !!wc.destroyed, isLoading: () => false, getURL: () => wc.url || 'about:blank', getTitle: () => '',
   getUserAgent: () => 'isolated-test', setUserAgent() {}, setAudioMuted() {}, setBackgroundThrottling() {},
   setWindowOpenHandler() {}, loadURL: async url => { wc.url = url; },
   close: () => { if (!wc.destroyed) { wc.destroyed = true; wc.emit('destroyed'); f().views.delete(wc.id); } },
   debugger: { isAttached: () => false },
   navigationHistory: { canGoBack: () => false, canGoForward: () => false,
     restore: async ({ entries }) => { wc.url = entries[0]?.url; },
     getAllEntries: () => [{ url: wc.url || 'about:blank' }], getActiveIndex: () => 0 }
  });
  this.webContents = wc; this.setBounds = () => {}; this.setVisible = () => {};
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
	const webContents = { id: 700, mainFrame, send() {} };
	const window = {
		isDestroyed: () => false,
		webContents,
		contentView: { addChildView() {}, removeChildView() {} },
		getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
	};
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
