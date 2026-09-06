import { resolve } from "node:path";
import {
	defineConfig,
	externalizeDepsPlugin,
	bytecodePlugin,
} from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { replaceBackendConfigPlugin } from "./scripts/vite-plugins/replace-backend-config";
import { desktopProxyPlugin } from "./scripts/vite-plugins/desktop-proxy";

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
const bytecodePlugins = emitBytecode ? [bytecodePlugin()] : [];

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
		plugins: [externalizeDepsPlugin(), ...bytecodePlugins],
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
				},
			},
		},
	},
});
