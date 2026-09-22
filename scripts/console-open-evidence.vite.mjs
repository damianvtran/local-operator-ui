import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the console OPEN evidence harness only.
 *
 * Separate from `electron.vite.config.js` for the reason every `*-evidence.vite.mjs`
 * sibling is: that config declares the app's own html entries and the desktop HTTP proxy,
 * neither of which belongs under a camera pointed at one component. The aliases are
 * copied from the renderer stage so the shipped components resolve exactly as they do in
 * the app, and `tailwindcss` is here because the pane's own roles are utility classes.
 *
 * PORT 5207, distinct from the siblings (5199 backend-error, 5201 usage-real, 5202
 * submit-latency, 5204/5205 draft-splash), so two harnesses can be served at once.
 *
 * `strictPort` on purpose: a capture that silently moved to another port would be
 * photographed from a URL nobody wrote down.
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
		port: 5207,
		strictPort: true,
	},
});
