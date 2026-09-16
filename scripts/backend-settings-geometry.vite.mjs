import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the backend-settings geometry rig only.
 *
 * Separate from `electron.vite.config.js` because that config's renderer stage
 * declares the app's own html entries and the desktop HTTP proxy; this rig
 * deliberately runs WITHOUT that proxy, because its whole point is to exercise
 * the Electron bridge branch. Aliases are copied from the renderer stage so the
 * shipped components resolve exactly as they do in the app.
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
		port: Number(process.env.RIG_PORT ?? 5251),
		strictPort: true,
		// Vite refuses a request whose Host is not in this list; the rig is
		// reached over loopback by literal IP, so the address has to be named.
		allowedHosts: ["127.0.0.1", "localhost"],
	},
});
