import { resolve } from "node:path";
import {
	defineConfig,
	externalizeDepsPlugin,
	bytecodePlugin,
} from "electron-vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	assetsInclude: ["**/*.sh", "**/*.ps1"],
	main: {
		plugins: [externalizeDepsPlugin(), bytecodePlugin()],
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
		plugins: [react(), tsconfigPaths()],
		input: {
			index: resolve(__dirname, "src/renderer/index.html"),
			installer: resolve(__dirname, "src/renderer/installer.html"),
		},
		build: {
			rollupOptions: {
				input: {
					index: resolve(__dirname, "src/renderer/index.html"),
					installer: resolve(__dirname, "src/renderer/installer.html"),
				},
			},
		},
	},
});
