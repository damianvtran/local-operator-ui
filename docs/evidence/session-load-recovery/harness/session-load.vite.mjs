import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import { desktopProxyPlugin } from "../../../../scripts/vite-plugins/desktop-proxy.ts";

/**
 * Browser dev server for the REAL chat surface, used to photograph what the app
 * does when its session stream is refused.
 *
 * Why a separate config rather than `pnpm dev`: `electron.vite.config.js`
 * declares the repo root as its root, so Vite's dependency crawl pulls in the
 * `scripts/*-evidence.tsx` harnesses and fails to resolve their aliases before
 * the server is usable. Rooting at `src/renderer` serves exactly the app's own
 * `index.html` and `main.tsx`. (`docs/evidence/desktop-413/harness` documents
 * the same constraint for the same reason.)
 *
 * Everything that matters to this change is the shipping renderer: the hook,
 * the transcript, the composer, the stylesheet. `desktopProxyPlugin` is the
 * plugin the app itself uses in browser development, so the transport under the
 * renderer is the same `requestDesktop` in `src/main/desktop-transport.ts` that
 * Electron's IPC handler calls - only the channel differs. What the frames do
 * NOT exercise is named in the README beside them.
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
	// `strictPort` so a busy port FAILS rather than serving on another one and
	// photographing a surface nobody drove. This box runs several agent sessions
	// at once, so the port is overridable.
	server: {
		port: Number(process.env.SESSION_LOAD_UI_PORT ?? 5211),
		strictPort: true,
	},
});

/**
 * Supply the preload globals the app reads at mount, so the real chat surface
 * boots in a browser.
 *
 * `window.api.desktop` is deliberately ABSENT. Its absence is what routes the
 * transport down the `/__desktop` branch (the same `requestDesktop` the IPC
 * handler calls) and the stream through the same-origin SSE proxy, so both the
 * refusals and the recovery under test are produced by the shipping code.
 */
const SHIM_PATH = "/session-load-electron-shim.js";

const SHIM_SOURCE = `
const noop = () => () => {};
window.electron = {
	ipcRenderer: {
		on: noop,
		once: noop,
		send: () => {},
		invoke: async () => ({ canceled: true, filePaths: [] }),
		removeListener: () => {},
		removeAllListeners: () => {},
	},
	process: { platform: "darwin" },
};
const updater = {};
for (const name of [
	"checkForUpdates", "checkForAllUpdates", "checkForBackendUpdates",
	"downloadUpdate", "quitAndInstall", "updateBackend",
	"quitForUpdateInstall",
]) updater[name] = async () => ({});
// Every subscription on the preload updater surface. A missing one is not
// cosmetic: UpdateNotification calls them at mount, and a TypeError there
// takes the whole tree to the error boundary - which is a frame of the crash
// screen rather than of the chat.
for (const name of [
	"onUpdateAvailable", "onUpdateNotAvailable", "onUpdateDevMode",
	"onUpdateNpxAvailable", "onUpdateDownloaded", "onUpdateError",
	"onUpdateProgress", "onUpdateInstallBlocked", "onUpdateInstallFailed",
	"onUpdateInstallInFlight", "onBeforeQuitForUpdate",
	"onBackendUpdateAvailable", "onBackendUpdateDevMode",
	"onBackendUpdateNotAvailable", "onBackendUpdateCompleted",
	"onBackendUpdateError", "onBackendUpdateManualRequired",
]) updater[name] = noop;
updater.getLastInstallAttempt = async () => null;
window.api = {
	updater,
	systemInfo: {
		getAppVersion: async () => "0.19.6",
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
		name: "session-load-electron-shim",
		apply: "serve",
		// Served as a real module from the dev origin, not inlined: the app's own
		// index.html carries `script-src 'self'`, so an inline tag is blocked by
		// CSP and the global never lands. Keeping the app's CSP intact matters -
		// relaxing it would mean the frames came from a page the product does not
		// serve.
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = (req.url ?? "").split("?")[0];
				if (path === SHIM_PATH) {
					res.setHeader("Content-Type", "application/javascript");
					res.end(SHIM_SOURCE);
					return;
				}
				next();
			});
		},
		transformIndexHtml() {
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
