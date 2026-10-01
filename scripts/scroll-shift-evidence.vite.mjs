import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the scroll-shift harness ONLY.
 *
 * Aliases are copied from the renderer stage so the shipped components resolve
 * exactly as they do in the app - minus any desktop proxy, because this rig
 * scripts its owner in the page (`scroll-shift-bridge.ts`) and a proxy would
 * only let a run reach a backend it is not supposed to depend on.
 *
 * Port 5212, distinct from the app's dev server and the sibling harnesses
 * (5199 backend-error, 5202 submit-latency, 5211 session-switch), so a run
 * never collides with the operator's own app or a capture.
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
			"@resources": resolve(root, "resources"),
			/*
			 * Present for the same reason the sibling configs carry their own
			 * aliases: Vite's dep scanner walks every `*.html` under the root, so
			 * a page this rig does not open (`composer-alert-geometry.html`) would
			 * otherwise fail the scan on an alias this config is expected to know,
			 * painting a startup error beside a working server.
			 */
			"@contract": resolve(root, "src/shared"),
		},
	},
	plugins: [react(), tailwindcss()],
	server: {
		port: 5212,
		strictPort: true,
		/* The driver lives in this root but is not part of the page; without
		   this, editing it reloads the browser mid-run. */
		watch: { ignored: ["**/*.mjs", "**/*.test.mjs"] },
	},
});
