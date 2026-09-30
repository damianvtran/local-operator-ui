import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { desktopProxyPlugin } from "./vite-plugins/desktop-proxy";

/**
 * Vite config for the REAL-BACKEND open harness (`session-open-live.html`).
 *
 * The switch harness's config (`session-switch.vite.mjs`) plus one plugin: the
 * app's own development desktop proxy, so the page's `desktopRequest` and
 * `subscribeDesktopStream` take their browser transports (`/__desktop`,
 * `/__desktop/stream`) to a real `local-operator serve` - the bearer stays in
 * this Node process, exactly as in `pnpm dev`. The backend is named by
 * `LOCAL_OPERATOR_DESKTOP_BACKEND_URL` and `LOCAL_OPERATOR_DESKTOP_TOKEN` in the
 * environment this server is started with; `session-open-live.mjs` says how.
 *
 * The port comes from `SESSION_OPEN_LIVE_PORT` (default 5213, distinct from the
 * switch harness's 5211) so two trees - a base and a branch - can be served side
 * by side and measured interleaved against ONE backend.
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
	plugins: [react(), tailwindcss(), desktopProxyPlugin()],
	server: {
		port: Number(process.env.SESSION_OPEN_LIVE_PORT || 5213),
		strictPort: true,
		host: "127.0.0.1",
		watch: { ignored: ["**/*.mjs", "**/*.test.mjs"] },
	},
});
