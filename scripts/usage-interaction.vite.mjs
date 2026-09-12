import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the `/usage` INTERACTION harness only.
 *
 * Separate from `usage-real-evidence.vite.mjs` so both can run at once — that
 * one photographs the view against a real backend payload, this one drives the
 * container's click handlers and query lifecycle behind a fake bridge. Aliases
 * are copied from the renderer stage so the shipped components resolve exactly
 * as they do in the app.
 *
 * Port 5210, distinct from the evidence harness's 5201 and from the app's dev
 * server, so a capture and an interaction run never collide.
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
		port: 5210,
		strictPort: true,
		/* The driver script lives in this root but is not part of the page; without
		   this, editing it reloads the browser mid-run. */
		watch: { ignored: ["**/*.mjs", "**/*.test.mjs"] },
	},
});
