import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { desktopProxyPlugin } from "../../../../scripts/vite-plugins/desktop-proxy.ts";

/**
 * Browser dev server for the RIGHT SLOT's per-conversation memory (#894).
 *
 * WHY A CONFIG OF ITS OWN rather than `pnpm dev`: `electron.vite.config.js` roots
 * at the repository, so Vite's dependency crawl pulls in the `scripts/*-evidence.tsx`
 * harnesses and fails to resolve their aliases before the server is usable.
 * Rooting at `src/renderer` serves exactly the app's own `index.html` and
 * `main.tsx`. This follows `docs/evidence/ask-drawer-stuck/harness/asks-rig.vite.mjs`
 * and, through it, `docs/evidence/desktop-413/harness/chat-413.vite.mjs`.
 *
 * WHY AN EVIDENCE RIG GETS TWO TREES FROM ONE FILE. The unit under test is a
 * relationship between a conversation and the slot's occupant, so the claim is
 * "on the fixed tree the hop to another conversation changes the occupant; on
 * `main` it does not" - which needs both renderers over ONE daemon, or the two
 * frames depict two different sets of conversations. The repository root is
 * derived from THIS file's own location, so the same config serves the after arm
 * (this checkout) and the before arm (a checkout of `main` that the harness
 * copies itself into - `rig-up.sh`); a clone can therefore re-take both arms.
 * The config is never told which arm it is: it serves whatever tree it sits in.
 *
 * WHAT THIS SURFACE PROVES AND WHAT IT DOES NOT. The components, the stores, the
 * router, the canonical frame's transport validator and the `/__desktop` route
 * are the shipping ones, and `desktopProxyPlugin` calls the same `requestDesktop`
 * in `src/main/desktop-transport.ts` that Electron's IPC handler calls. The
 * Electron IPC/preload channel and a packaged native window are NOT exercised
 * here, and the README says so beside the frames.
 *
 * `LOCAL_OPERATOR_DESKTOP_TOKEN` and `LOCAL_OPERATOR_DESKTOP_BACKEND_URL` are
 * read by this NODE process, never by a `VITE_*` variable, and the token is
 * never printed. Source them from the rig's own token file; see the README.
 */
/*
 * THE REPOSITORY ROOT, derived from THIS file's own location rather than named:
 * the harness is committed so its frames are re-derivable, and an absolute path
 * would make these frames a picture of one machine's checkout. Four levels up
 * from `docs/evidence/<set>/harness/`.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const SHIM_PATH = "/slot-rig-electron-shim.js";

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
		port: Number(process.env.SLOT_RIG_PORT ?? 5321),
		strictPort: true,
		/*
		 * The renderer's ordinary REST calls go to `VITE_LOCAL_OPERATOR_API_URL`,
		 * whose default is the operator's OWN backend on :1111. Left alone, a live
		 * pass on this surface would read and write the operator's real sessions
		 * (and its own SSE stream would land in a committed frame). So the app is
		 * served with that variable pointed at this origin and the API prefix is
		 * proxied to the rig's own daemon instead - the alternative, widening the
		 * shipped CSP to reach a second port, would mean the frames came from a
		 * page the product does not serve.
		 */
		proxy: process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL
			? {
					/* `/health` is the probe the shell's connectivity banner reads (and
					 * that the first-time-user check waits on). Proxying only `/v1` left
					 * the app showing "The server is offline" against a live backend, and
					 * that banner is a lie the frames would have carried. */
					"/v1": {
						target: process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL,
						changeOrigin: false,
					},
					"/health": {
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
 * shipping transport validator runs on here.
 *
 * AND THE DEV DRIVER'S BRIDGE, because this set's numbers are the app's own
 * `state()` verb rather than a reading inferred from the DOM. `install.ts` is
 * the RENDERER's half of that driver (`window.__loDevDriver.install(verbs)` at
 * the bottom of `main.tsx`), and in an armed Electron launch the PRELOAD is what
 * hands it the object - `src/preload/dev-driver.ts`, gated on main's own
 * `additionalArguments`. A browser has no preload, so the bridge is the rig's
 * here: exactly the contract the preload publishes (`armed`, `outDir`, `verbs`,
 * `install`, `call`), implemented with a plain object, and the verbs that run
 * are the app's own code - stores, the router, real DOM controls. The rig
 * supplies the CHANNEL and the app supplies the verb table, which is the same
 * split `window.electron` above already uses.
 *
 * `capture()` and `facts()` are the preload's other two, and both are refused
 * rather than faked: `webContents.capturePage()` (main photographing itself) and
 * main's window facts have no meaning on a page served to a browser, and a rig
 * that answered them with something plausible would be inventing a reading. The
 * driver photographs through CDP and reports window facts from CDP instead.
 */
const SHIM_SOURCE = `
/*
 * The same first-run seed the driver writes (\`seedOnboardingComplete\`): without
 * it the served app boots into the onboarding modal and the chats are behind it.
 * Injecting it here is the module-script spelling of the driver's
 * Page.addScriptToEvaluateOnNewDocument — the app's own CSP (script-src 'self')
 * refuses an inline tag, which is why this whole shim is served as a module.
 */
try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (error) { /* a profile without storage is not a reason to fail the boot */ }
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
 * Re-run that grep before adding to either list rather than guessing which half
 * a new name belongs in: the two lists are not interchangeable, and a
 * subscription placed in the calling list throws on mount instead of on
 * subscribe.
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
	"onUpdateInstallProgress", "onUpdateInstallSucceeded",
	"onUpdateInstallInFlight", "onBeforeQuitForUpdate",
	"onBackendUpdateAvailable", "onBackendUpdateDevMode",
	"onBackendUpdateNotAvailable", "onBackendUpdateCompleted",
	"onBackendUpdateProgress",
	"onBackendUpdateError", "onBackendUpdateManualRequired",
]) updater[name] = noop;
window.api = {
	updater,
	systemInfo: {
		getAppVersion: async () => "0.33.5",
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
(() => {
	const verbs = new Map();
	window.__loDevDriver = {
		armed: true,
		outDir: "/dev/null",
		verbs: () => [...verbs.keys()].sort(),
		install: (table) => {
			for (const [name, fn] of Object.entries(table ?? {})) verbs.set(name, fn);
			return [...verbs.keys()].sort();
		},
		call: (name, payload) => {
			const fn = verbs.get(name);
			if (typeof fn !== "function") throw new Error("no dev driver verb " + name);
			return fn(payload);
		},
		capture: async () => { throw new Error("this rig photographs through CDP, not webContents.capturePage()"); },
		facts: async () => { throw new Error("this rig reads window facts over CDP, not from main"); },
	};
})();
`;

function electronBridgeShim() {
	return {
		name: "slot-rig-electron-shim",
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
