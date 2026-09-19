import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the toast-close geometry harness only.
 *
 * Separate from `electron.vite.config.js` for the reason the composer-alert
 * harness is: that config's renderer stage declares the app's own html entries
 * and the desktop HTTP proxy, and this harness is one page that talks to no
 * backend. Aliases are copied from the renderer stage so the shipped modules
 * resolve exactly as they do in the app.
 *
 * Started by `scripts/toast-close-geometry.mjs`, which picks the port.
 */
const root = resolve(import.meta.dirname, "..");

export default defineConfig({
	root: resolve(root, "scripts"),
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
	plugins: [react(), tailwindcss()],
	server: {
		port: Number(process.env.TOAST_CLOSE_PORT ?? 5431),
		strictPort: true,
	},
});
