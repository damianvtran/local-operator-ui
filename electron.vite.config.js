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

export default defineConfig({
	assetsInclude: ["**/*.sh", "**/*.ps1"],
	main: {
		plugins: [
			externalizeDepsPlugin(),
			bytecodePlugin(),
			replaceBackendConfigPlugin(),
		],
	},
	preload: {
		plugins: [externalizeDepsPlugin(), bytecodePlugin()],
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
		plugins: [react(), tailwindcss(), tsconfigPaths()],
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
