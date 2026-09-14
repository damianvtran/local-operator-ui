import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import { desktopProxyPlugin } from "../../../../scripts/vite-plugins/desktop-proxy.ts";

/**
 * Browser dev server for the REAL chat surface, used to reproduce and verify
 * the oversize-message refusal.
 *
 * Why a separate config rather than `pnpm dev`: `electron.vite.config.js`
 * declares the repo root as its root, so Vite's dependency crawl pulls in the
 * `scripts/*-evidence.tsx` harnesses and fails to resolve their aliases before
 * the server is usable. Rooting at `src/renderer` serves exactly the app's own
 * `index.html` and `main.tsx`.
 *
 * Everything that matters to this change is the shipping code: the aliases and
 * plugins are copied from the renderer stage, and `desktopProxyPlugin` is the
 * SAME plugin the app uses in browser development - it calls the same
 * `requestDesktop` in `src/main/desktop-transport.ts` that Electron's IPC
 * handler calls. What this surface does NOT prove is packaged Electron IPC or
 * a native window; see the README beside the frames.
 */
const root = resolve(import.meta.dirname, "../../../..");

export default defineConfig({
	root: resolve(root, "src/renderer"),
	resolve: {
		alias: {
			"@renderer": resolve(root, "src/renderer/src"),
			"@components": resolve(root, "src/renderer/src/components"),
			"@features": resolve(root, "src/renderer/src/features"),
			"@shared": resolve(root, "src/renderer/src/shared"),
			"@assets": resolve(root, "src/renderer/src/assets"),
			"@hooks": resolve(root, "src/renderer/src/hooks"),
			"@api": resolve(root, "src/renderer/src/api"),
			"@store": resolve(root, "src/renderer/src/store"),
		},
	},
	plugins: [
		react(),
		tailwindcss(),
		tsconfigPaths(),
		desktopProxyPlugin(),
		electronBridgeShim(),
	],
	// `strictPort` so a busy port FAILS rather than silently serving on another
	// one and photographing a surface nobody drove. Overridable because this box
	// runs several agent sessions at once and 5199 may belong to someone else.
	server: {
		port: Number(process.env.DESKTOP_413_PORT ?? 5199),
		strictPort: true,
	},
});

/**
 * Supply the one preload global the app reads at mount, so the real chat
 * surface boots in a browser.
 *
 * `app.tsx` subscribes to `window.electron.ipcRenderer` for the command-palette
 * shortcut, which a browser has no preload to provide, so the app throws before
 * it renders. This stubs ONLY that subscription.
 *
 * `window.api` is deliberately NOT installed: leaving it absent is what routes
 * `desktopRequest` down the `/__desktop` branch, and that branch calls the same
 * `requestDesktop` in `src/main/desktop-transport.ts` that Electron's IPC
 * handler calls. So the size guard, the per-op budget lookup and the 413 under
 * test are the shipping ones - only the channel carrying them differs.
 */
const SHIM_PATH = "/desktop-413-electron-shim.js";
/** Where `scripts/make-fixtures.mjs` writes the synthetic Retina screenshots. */
const FIXTURE_DIR =
	process.env.DESKTOP_413_FIXTURES ?? "/tmp/desktop-413-fixtures";
/**
 * The preload globals the app reads at mount, and nothing more.
 *
 * Mirrors the shapes in `src/preload/index.ts`: `updater`'s `on*` subscriptions
 * return an unsubscribe function, and `systemInfo` answers the two invokes the
 * shell makes on load. Every method is inert - no update is ever announced, so
 * no update banner enters a captured frame.
 *
 * `window.api.desktop` is deliberately ABSENT. Its absence is what routes
 * `desktopRequest` down the `/__desktop` branch, and that branch calls the same
 * `requestDesktop` the Electron IPC handler calls, so the size guard under test
 * is the shipping one.
 *
 * `readFile` answers base64 for the file-attachment path, which is how a large
 * PNG on disk is attached without a native file dialog.
 */
const SHIM_SOURCE = `
const noop = () => () => {};
window.electron = {
	ipcRenderer: {
		on: noop,
		once: noop,
		send: () => {},
		// show-open-dialog is the app's real attach path (handleAttachFile in
		// message-input.tsx): it reads filePaths and calls addAttachment for
		// each. Answering it with the fixture screenshots attaches them through
		// the product's own code, with no native dialog.
		invoke: async (channel) =>
			channel === "show-open-dialog"
				? {
						canceled: false,
						filePaths: (
							new URLSearchParams(location.search).get("attach") ??
							"screenshot-1.png,screenshot-2.png,screenshot-3.png,screenshot-4.png,screenshot-5.png"
						)
							.split(",")
							.filter(Boolean),
					}
				: { canceled: true, filePaths: [] },
		removeListener: () => {},
		removeAllListeners: () => {},
	},
	process: { platform: "darwin" },
};
const updater = {};
for (const name of [
	"checkForUpdates", "checkForAllUpdates", "checkForBackendUpdates",
	"downloadUpdate", "quitAndInstall", "updateBackend",
]) updater[name] = async () => ({});
for (const name of [
	"onUpdateAvailable", "onUpdateNotAvailable", "onUpdateDevMode",
	"onUpdateNpxAvailable", "onUpdateDownloaded", "onUpdateError",
	"onUpdateProgress", "onBackendUpdateAvailable", "onBackendUpdateDevMode",
	"onBackendUpdateNotAvailable", "onBackendUpdateCompleted",
]) updater[name] = noop;
window.api = {
	updater,
	systemInfo: {
		getAppVersion: async () => "0.16.0",
		getPlatformInfo: async () => ({ platform: "darwin", arch: "arm64" }),
	},
	openExternal: async () => {},
	showItemInFolder: async () => {},
	getHomeDirectory: async () => "/Users/evidence",
	fileExists: async () => ({ success: true, exists: true }),
	openFile: async () => ({ success: false }),
	saveFile: async () => ({ success: true }),
	selectFile: async () => ({ canceled: true, filePaths: [] }),
	selectDirectory: async () => ({ canceled: true, filePaths: [] }),
	readFile: async (path) => {
		const response = await fetch(
			"/desktop-413-fixture?path=" + encodeURIComponent(path),
		);
		if (!response.ok) return { success: false };
		return { success: true, data: await response.text() };
	},
};
`;

function electronBridgeShim() {
	return {
		name: "desktop-413-electron-shim",
		apply: "serve",
		// Served as a real module from the dev origin, not inlined: the app's own
		// index.html carries `script-src 'self'`, so an inline tag is blocked by
		// CSP and the global never lands. Keeping the app's CSP intact matters -
		// relaxing it for the capture would mean the frames came from a page the
		// product does not serve.
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = (req.url ?? "").split("?")[0];
				if (path === SHIM_PATH) {
					res.setHeader("Content-Type", "application/javascript");
					res.end(SHIM_SOURCE);
					return;
				}
				// Stands in for main's `readFile(path, "base64")`, so a large PNG on
				// disk can be attached without a native file dialog. The bytes are
				// real and unmodified; only the channel that fetches them differs.
				if (path === "/desktop-413-fixture") {
					const name = new URL(
						req.url ?? "",
						"http://localhost",
					).searchParams.get("path");
					const file = resolve(FIXTURE_DIR, basename(name ?? ""));
					if (!existsSync(file)) {
						res.statusCode = 404;
						res.end("");
						return;
					}
					res.setHeader("Content-Type", "text/plain");
					res.end(readFileSync(file).toString("base64"));
					return;
				}
				next();
			});
		},
		transformIndexHtml() {
			// head-prepend so it runs before the app's own module entry: module
			// scripts execute in document order.
			return [
				{
					tag: "script",
					attrs: { type: "module", src: SHIM_PATH },
					injectTo: "head-prepend",
				},
			];
		},
	};
}
