import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import {
	bytecodePlugin,
	defineConfig,
	externalizeDepsPlugin,
} from "electron-vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { desktopProxyPlugin } from "./scripts/vite-plugins/desktop-proxy";
import { replaceBackendConfigPlugin } from "./scripts/vite-plugins/replace-backend-config";

// V8 bytecode is tied to the exact Electron (V8) version that produced it, so a
// .jsc built here is only loadable by an Electron we control. That holds for the
// electron-builder installers, which bundle their own pinned runtime, but NOT for
// the npm tarball: `npx local-operator-ui` resolves Electron through the
// surrounding environment (@electron-toolkit/utils declares an `electron: >=13`
// peer, so npm happily installs the latest major), and a newer V8 rejects our
// bytecode with `cachedDataRejected` before the app ever loads. See issue #88.
//
// So bytecode is opt-out for the packaged desktop builds and off for the npm
// build. `pnpm build` still emits bytecode; the npm publish path sets
// LOCAL_OPERATOR_UI_NO_BYTECODE=true to emit plain JS that any supported
// Electron can execute.
const emitBytecode = process.env.LOCAL_OPERATOR_UI_NO_BYTECODE !== "true";

// bytecodePlugin() returns a plugin object; dropping it entirely (rather than
// passing an option) is what makes electron-vite emit ordinary .js.
// NOTE FOR ANYONE EDITING A `src/main` CLASS: this transform CANNOT compile an
// arrow function inside a class PROPERTY. The failure is `[vite:bytecode]
// unknown file: Unable to transform arrow inside class property`, and it fires
// only on the bytecode build - the plain-JS `build:npm` path never sees it, so
// it is invisible to every gate that builds that way. Write the initialiser as a
// constructor assignment instead (`readonly x: T; ... this.x = new T(() =>
// this.y());`). Incident: `src/main/browser/host.ts:339`, all three v0.35.0
// platform builds, 2026-10-18 - a whole release spent because this constraint
// was discovered at publish rather than at the pull request.
const bytecodePlugins = emitBytecode ? [bytecodePlugin()] : [];

// The PRELOAD never gets bytecode, not even in the packaged desktop builds.
//
// electron-vite's bytecode loader requires Node's `vm` and `v8` modules and
// rewrites the cached data's flag hash. A RENDERER process does not accept that
// on Electron 44: it logs "The vm module of Node.js is unsupported in Electron's
// renderer process ... avoiding the module is highly recommended", then fails
// the load with `Error: Invalid or incompatible cached data
// (cachedDataRejected)`. `out/preload/index.js` therefore never ran,
// `window.electron` was undefined, and the renderer could not reach main at all
// — measured in both the built app and the electron-builder `--dir` artifact.
//
// The same .jsc loads correctly in the main process, which is how we know the
// bytecode matches the runtime and the renderer is the thing that changed: the
// loader is fine where Node's `vm` still works, and unusable where it does not.
// The preload is a few KB, so plain JS there costs nothing.

export default defineConfig({
	assetsInclude: ["**/*.sh", "**/*.ps1"],
	main: {
		plugins: [
			externalizeDepsPlugin(),
			...bytecodePlugins,
			replaceBackendConfigPlugin(),
		],
	},
	preload: {
		// No bytecode plugin here on purpose -- see the note above. It is absent
		// rather than an empty spread, so the decision reads as one.
		plugins: [externalizeDepsPlugin()],
		/*
		 * TWO PRELOADS. The app window's is `index`; S6b's card gets its own
		 * purpose-built bridge so the smallest possible surface (two verbs) is the
		 * one exposed to a second document. An explicit object input is required:
		 * electron-vite otherwise builds the single default `index` entry and the
		 * card's preload path would not exist at runtime.
		 */
		build: {
			rollupOptions: {
				input: {
					index: resolve(__dirname, "src/preload/index.ts"),
					"browser-approvals-overlay": resolve(
						__dirname,
						"src/preload/browser-approvals-overlay.ts",
					),
				},
			},
		},
	},
	renderer: {
		resolve: {
			alias: {
				"@renderer": resolve("src/renderer/src"),
				"@components": resolve("src/renderer/src/components"),
				"@features": resolve("src/renderer/src/features"),
				"@shared": resolve("src/renderer/src/shared"),
				"@assets": resolve("src/renderer/src/assets"),
				"@hooks": resolve("src/renderer/src/hooks"),
				"@api": resolve("src/renderer/src/api"),
				"@store": resolve("src/renderer/src/store"),
			},
		},
		// tailwindcss() must run for BOTH renderer html entries (index.html and
		// installer.html); it is a renderer-level plugin, so registering it here
		// covers both inputs declared below.
		plugins: [react(), tailwindcss(), tsconfigPaths(), desktopProxyPlugin()],
		input: {
			index: resolve(__dirname, "src/renderer/index.html"),
			installer: resolve(__dirname, "src/renderer/installer.html"),
			/*
			 * The mini view's own document (quick-send design §D.1). It is listed in
			 * BOTH places for the reason the console capture's block below records:
			 * this list serves the document in development (`pnpm dev` is a
			 * `normal` launch, so the hotkey must work there — §C.4), and
			 * `rollupOptions.input` is what the BUILD emits. Declaring only one
			 * shipped a 404 at the first use; the two lists are asserted to agree
			 * for this document by a case in `scripts/console-host.test.mjs`.
			 */
			mini: resolve(__dirname, "src/renderer/mini.html"),
			/*
			 * S1's inert address-overlay document. Listed in BOTH halves for the
			 * reason the mini and console-capture documents are: this list is what
			 * the dev server serves, and `rollupOptions.input` is what the BUILD
			 * emits. Declaring only one ships a 404 at the first probe show, which
			 * is exactly the failure mode the other two documents recorded. No JS
			 * entry on purpose — the document is static by contract.
			 */
			addressOverlay: resolve(
				__dirname,
				"src/renderer/browser-address-overlay.html",
			),
			/*
			 * S2's scripted mirror document. Unlike S1's inert document it has a real
			 * module entry, so it MUST be in both halves of the config for the same
			 * measured reason as the documents above: the dev server serves this list
			 * and the BUILD emits `rollupOptions.input`. Declaring only one ships a
			 * document whose script 404s at the first projection.
			 */
			addressOverlayList: resolve(
				__dirname,
				"src/renderer/browser-address-overlay-list.html",
			),
			/*
			 * S6a's inert approvals card. Listed in BOTH halves for the same reason
			 * as the address documents: this list serves it in development and
			 * `rollupOptions.input` emits it in the build. A document declared in only
			 * one half 404s in the other, which is how the S1 probe first failed.
			 */
			approvalsOverlay: resolve(
				__dirname,
				"src/renderer/browser-approvals-overlay.html",
			),
		},
		build: {
			// electron-vite defaults the renderer to minify:false on the assumption
			// that a local app does not pay for bytes. It still pays for parse time,
			// and this renderer is large enough that the unminified entry chunk was
			// over 13 MB. esbuild minification is name-mangling plus whitespace
			// removal only; nothing here reads Function.name or constructor.name.
			minify: "esbuild",
			rollupOptions: {
				input: {
					index: resolve(__dirname, "src/renderer/index.html"),
					installer: resolve(__dirname, "src/renderer/installer.html"),
					/*
					 * The console's capture view (design 13.2/13.3): a third document, for
					 * the same reason the installer is one. A renderer that exists to be
					 * photographed must mount nothing that reaches the app's stores or
					 * streams, so it cannot be a route inside the app's shell - but it IS
					 * the same component the pane mounts, which is what keeps the two from
					 * drifting in font, theme or renderer.
					 *
					 * It is here, in `rollupOptions.input`, rather than in the renderer's own
					 * `input` above: that one tells the dev server what it may serve, and this
					 * one is what the BUILD emits. Declaring it only above produced a config
					 * that served the page in development and shipped no such document, which
					 * fails at the first offscreen capture as a 404 — measured, and the reason
					 * the two lists are asserted to agree below.
					 */
					consoleCapture: resolve(
						__dirname,
						"src/renderer/console-capture.html",
					),
					/*
					 * The mini view's document (quick-send design §D.1), never a route inside
					 * the app's shell: a hotkey-summoned window must mount the composer and
					 * nothing that boots the session store, the feed subscription or the
					 * sidebar, so this is a fourth document for the console capture's own
					 * reason. It is also in the renderer's `input` above, so the dev server
					 * serves it — both halves are load-bearing and a test pins them.
					 */
					mini: resolve(__dirname, "src/renderer/mini.html"),
					/*
					 * S1's address-overlay document: the BUILD half of the pair above.
					 * A static HTML input with no module script still gets emitted, and
					 * the probe asserts `out/renderer/browser-address-overlay.html`
					 * exists before launching the built app.
					 */
					addressOverlay: resolve(
						__dirname,
						"src/renderer/browser-address-overlay.html",
					),
					/*
					 * S2's mirror document: the BUILD half of the pair above, with its own
					 * module script and stylesheet emitted as assets.
					 */
					addressOverlayList: resolve(
						__dirname,
						"src/renderer/browser-address-overlay-list.html",
					),
					/* S6a's card: the BUILD half of the pair above. */
					approvalsOverlay: resolve(
						__dirname,
						"src/renderer/browser-approvals-overlay.html",
					),
				},
			},
		},
	},
});
