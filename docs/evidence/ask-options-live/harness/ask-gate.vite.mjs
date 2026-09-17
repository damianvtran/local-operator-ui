import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import { desktopProxyPlugin } from "../../../../scripts/vite-plugins/desktop-proxy.ts";

/**
 * Browser dev server for the REAL chat surface, used by the ask-gate click
 * proof.
 *
 * Why a config of its own rather than `pnpm dev`: `electron.vite.config.js`
 * roots at the repository, so Vite's dependency crawl pulls in the
 * `scripts/*-evidence.tsx` harnesses and fails to resolve their aliases before
 * the server is usable. Rooting at `src/renderer` serves exactly the app's own
 * `index.html` and `main.tsx`. This follows
 * `docs/evidence/desktop-413/harness/chat-413.vite.mjs`, which is the same
 * surface for a different defect.
 *
 * What this surface proves and what it does not: the components, the answer
 * path, the transport validator and the `/__desktop` route are the shipping
 * ones, and `desktopProxyPlugin` calls the same `requestDesktop` in
 * `src/main/desktop-transport.ts` that Electron's IPC handler calls. The
 * Electron IPC/preload channel and a packaged native window are NOT exercised
 * here, and the frames say so.
 *
 * `LOCAL_OPERATOR_DESKTOP_TOKEN` and `LOCAL_OPERATOR_DESKTOP_BACKEND_URL` are
 * read by this NODE process, never by a `VITE_*` variable, and the token is
 * never printed. Source them from the rig's own token file; see the README.
 */
const root = resolve(import.meta.dirname, "../../../..");

const SHIM_PATH = "/ask-gate-electron-shim.js";

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
	// runs several agent sessions at once.
	server: {
		port: Number(process.env.ASK_GATE_PORT ?? 5199),
		strictPort: true,
		/*
		 * The renderer's ordinary REST calls go to `VITE_LOCAL_OPERATOR_API_URL`,
		 * whose default is the operator's OWN backend on :1111. Left alone, a live
		 * pass on this surface would read and write the operator's real sessions.
		 * So the app is served with that variable pointed at this origin and the
		 * API prefix is proxied to the rig's backend instead — the alternative,
		 * widening the shipped CSP to reach a second port, would mean the frames
		 * came from a page the product does not serve.
		 */
		proxy: process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL
			? {
					/* `/health` is the probe the shell's connectivity banner reads (and
					 * that the first-time-user check waits on). Proxying only `/v1` left
					 * the app showing "The server is offline" against a live backend,
					 * and that banner is a lie the frames would have carried. */
					"/v1": {
						target: process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL,
						changeOrigin: false,
					},
					"/health": {
						target: process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL,
						changeOrigin: false,
					},
					/* The rig's own control route, answered by
					 * `harness/serve-gate.py`'s middleware rather than by the app.
					 * Same origin, so a manual run can arm the card with one curl and
					 * the driver never needs a second address. */
					"/rig-arm": {
						target: process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL,
						changeOrigin: false,
					},
				}
			: undefined,
	},
});

/**
 * The preload globals the app reads before it can render, and nothing more.
 *
 * `app.tsx` subscribes through `window.electron.ipcRenderer` at mount, which a
 * browser has no preload to supply, so the app throws before it draws anything.
 * `window.api.desktop` is deliberately ABSENT: its absence is what routes
 * `desktopRequest` down the `/__desktop` branch, which is the branch the
 * shipping transport validator and the answer op run on here.
 *
 * Served as a real module from the dev origin rather than inlined, because the
 * app's own `index.html` carries `script-src 'self'` — an inline tag is blocked
 * by CSP and the global never lands. Keeping the app's own CSP is the point.
 */
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
/*
 * The updater channels the app subscribes to, enumerated from the tree
 * (\`grep -rho 'window.api.updater.[A-Za-z]*' src/renderer/src\`) rather than
 * guessed. Deliberately NOT a catch-all proxy: when the app grows a
 * subscription and this list lags, it throws with the missing name —
 * \`window.api.updater.onBackendUpdateManualRequired is not a function\`, which
 * named this very gap — and that is a better failure than a shim that answers
 * anything and quietly reports success for channels it never received.
 *
 * The gap this mechanism is designed to expose recurred: \`onUpdateInstallInFlight\`
 * and \`quitForUpdateInstall\` arrived with the update-install work and were not
 * added here, so \`UpdateNotification\` threw at mount and the app never painted —
 * the harness could not be re-driven at all from this commit onwards (UX round 5).
 * Both are answerable by the same two shapes the list already uses: the app calls
 * \`quitForUpdateInstall\` and ignores its answer, and it subscribes with
 * \`onUpdateInstallInFlight\` and keeps the unsubscribe, which is what \`noop\`
 * returns. Re-run the grep above before adding to either list rather than
 * guessing which half a new name belongs in — the two lists are not
 * interchangeable and a subscription placed in the calling list throws on mount
 * instead of on subscribe.
 */
const updater = {};
for (const name of [
	"checkForUpdates", "checkForAllUpdates", "checkForBackendUpdates",
	"downloadUpdate", "quitAndInstall", "updateBackend",
	"quitForUpdateInstall",
]) updater[name] = async () => ({});
updater.getLastInstallAttempt = async () => null;
for (const name of [
	"onUpdateAvailable", "onUpdateNotAvailable", "onUpdateDevMode",
	"onUpdateNpxAvailable", "onUpdateDownloaded", "onUpdateError",
	"onUpdateProgress", "onUpdateInstallBlocked", "onUpdateInstallFailed",
	"onUpdateInstallInFlight", "onBeforeQuitForUpdate",
	"onBackendUpdateAvailable", "onBackendUpdateDevMode",
	"onBackendUpdateNotAvailable", "onBackendUpdateCompleted",
	"onBackendUpdateProgress",
	"onBackendUpdateError", "onBackendUpdateManualRequired",
]) updater[name] = noop;
window.api = {
	updater,
	systemInfo: {
		getAppVersion: async () => "0.19.5",
		getPlatformInfo: async () => ({ platform: "darwin", arch: "arm64" }),
	},
	ipcRenderer: { invoke: async () => ({}) },
	openExternal: async () => {},
	showItemInFolder: async () => {},
	getHomeDirectory: async () => "/Users/evidence",
	fileExists: async () => ({ success: true, exists: true }),
	directoryExists: async () => ({ success: true, exists: true }),
	openFile: async () => ({ success: false }),
	saveFile: async () => ({ success: true }),
	selectFile: async () => ({ canceled: true, filePaths: [] }),
	selectDirectory: async () => ({ canceled: true, filePaths: [] }),
	readFile: async () => ({ success: false }),
};
`;

function electronBridgeShim() {
	return {
		name: "ask-gate-electron-shim",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if ((req.url ?? "").split("?")[0] === SHIM_PATH) {
					res.setHeader("Content-Type", "application/javascript");
					res.end(SHIM_SOURCE);
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
