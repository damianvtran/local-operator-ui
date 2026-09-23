import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { desktopProxyPlugin } from "../../../../scripts/vite-plugins/desktop-proxy.ts";

/**
 * Browser dev server for the REAL chat surface, used to photograph what the
 * composer does with a refusal the session owner raised before admission.
 *
 * Why a separate config rather than `pnpm dev`: `electron.vite.config.js`
 * declares the repo root as its root, so Vite's dependency crawl pulls in the
 * `scripts/*-evidence.tsx` harnesses and fails to resolve their aliases before
 * the server is usable. Rooting at `src/renderer` serves exactly the app's own
 * `index.html` and `main.tsx`.
 *
 * Everything that matters to this change is the shipping code. The aliases and
 * plugins are copied from the renderer stage, and `desktopProxyPlugin` is the
 * SAME plugin the app uses in browser development: it calls the same
 * `requestDesktop` in `src/main/desktop-transport.ts` that Electron's IPC
 * handler calls, so the refusal body under test crosses the shipping transport,
 * the shipping store and the shipping composer. What this surface does NOT
 * prove is packaged Electron IPC, a native window, or the backend's own ladder
 * deciding the verdict - see the README beside the frames.
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
	plugins: [react(), tailwindcss(), tsconfigPaths(), desktopProxyPlugin(), electronBridgeShim()],
	// `strictPort` so a busy port FAILS rather than silently serving on another
	// one and photographing a surface nobody drove. Overridable because this box
	// runs several agent sessions at once.
	server: {
		port: Number(process.env.OWNER_REFUSAL_APP_PORT ?? 5197),
		strictPort: true,
	},
});

/**
 * Supply the one preload global the app reads at mount, so the real chat
 * surface boots in a browser.
 *
 * `app.tsx` subscribes to `window.electron.ipcRenderer` for the command-palette
 * shortcut, which a browser has no preload to provide, so the app throws before
 * it renders. This stubs ONLY that subscription's channel and the handful of
 * `window.api` methods the shell calls on load.
 *
 * `window.api.desktop` is deliberately NOT installed: leaving it absent is what
 * routes `desktopRequest` down the `/__desktop` branch, and that branch calls
 * the same `requestDesktop` in `src/main/desktop-transport.ts` that Electron's
 * IPC handler calls. So the error decoding, the `retry_after_ms` read and the
 * refusal body under test are the shipping ones - only the channel carrying
 * them differs.
 */
const SHIM_PATH = "/owner-refusal-electron-shim.js";

const SHIM_SOURCE = `
const noop = () => () => {};
window.electron = {
	ipcRenderer: {
		invoke: async () => ({ canceled: true, filePaths: [] }),
		send: () => {},
		on: noop,
		once: noop,
		removeListener: () => {},
		removeAllListeners: () => {},
	},
	process: { platform: "darwin" },
};
const updater = {};
for (const name of ["checkForUpdates", "checkForAllUpdates", "checkForBackendUpdates",
	"downloadUpdate", "quitAndInstall", "updateBackend", "quitForUpdateInstall"])
	updater[name] = async () => ({});
updater.getLastInstallAttempt = async () => null;
for (const name of ["onUpdateAvailable", "onUpdateNotAvailable", "onUpdateDevMode",
	"onUpdateNpxAvailable", "onUpdateDownloaded", "onUpdateError", "onUpdateProgress",
	"onUpdateInstallBlocked", "onUpdateInstallFailed", "onUpdateInstallProgress",
	"onUpdateInstallSucceeded", "onUpdateInstallInFlight", "onBeforeQuitForUpdate",
	"onBackendUpdateAvailable", "onBackendUpdateDevMode", "onBackendUpdateNotAvailable",
	"onBackendUpdateCompleted", "onBackendUpdateProgress", "onBackendUpdateError",
	"onBackendUpdateManualRequired"])
	updater[name] = noop;
window.api = {
	updater,
	systemInfo: {
		getAppVersion: async () => "0.30.17",
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
	readFile: async () => ({ success: false }),
};
`;

function electronBridgeShim() {
	return {
		name: "owner-refusal-electron-shim",
		apply: "serve",
		// Served as a real module from the dev origin, not inlined: the app's own
		// index.html carries `script-src 'self'`, so an inline tag is blocked by
		// CSP and the global never lands. Keeping the app's CSP intact matters -
		// relaxing it for the capture would mean the frames came from a page the
		// product does not serve.
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if ((req.url ?? "").split("?")[0] !== SHIM_PATH) return next();
				res.setHeader("Content-Type", "application/javascript");
				res.end(SHIM_SOURCE);
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
