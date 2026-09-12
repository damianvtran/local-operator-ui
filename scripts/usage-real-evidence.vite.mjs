import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the real-data `/usage` evidence harness only.
 *
 * Separate from `electron.vite.config.js` for the same reason
 * `backend-error-evidence.vite.mjs` is: that config's renderer stage declares
 * the app's own html entries and the desktop HTTP proxy, neither of which this
 * harness wants — it renders one component against a payload injected into the
 * page, and must not proxy anything. Aliases are copied from the renderer stage
 * so the shipped components resolve exactly as they do in the app.
 *
 * Port 5201, distinct from the other harnesses, so two can run at once.
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
		port: 5201,
		strictPort: true,
		/*
		 * The capture SCRIPT lives in this root but is not part of the page.
		 * Without this, editing `usage-real-evidence.mjs` triggers a full page
		 * reload in the browser the script is driving — which lands mid-capture
		 * and photographs a document that is still mounting.
		 */
		watch: { ignored: ["**/*.mjs", "**/*.test.mjs"] },
	},
});
