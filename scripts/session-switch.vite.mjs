import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the session-switch latency harness ONLY.
 *
 * Aliases are copied from the renderer stage so the shipped components resolve
 * exactly as they do in the app. Port 5211, distinct from the app's dev server
 * and from the other `scripts/` harnesses, so a run never collides with the
 * operator's own app or with a capture.
 *
 * The fonts and the theme stylesheet are imported by the page itself, which is
 * what makes a frame from this server comparable to one from Storybook: the
 * same faces, the same roles.
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
		},
	},
	plugins: [react(), tailwindcss()],
	server: {
		port: 5211,
		strictPort: true,
		/* The driver script lives in this root but is not part of the page;
		   without this, editing it reloads the browser mid-run. */
		watch: { ignored: ["**/*.mjs", "**/*.test.mjs"] },
	},
});
