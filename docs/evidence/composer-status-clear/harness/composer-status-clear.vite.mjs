import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the composer-status-row clear-affordance harness only.
 *
 * Separate from `electron.vite.config.js` because that config's renderer stage
 * declares the app's own html entries and the desktop HTTP proxy; this harness
 * deliberately runs WITHOUT that proxy, since its whole point is to exercise the
 * Electron bridge branch (`window.api.desktop`) instead. Aliases are copied from
 * the renderer stage so the shipped component resolves exactly as it does in the
 * app.
 *
 * `root` is the REPOSITORY, not this directory, for the reason
 * `mcp-auth-complete.vite.mjs` records: the app's stylesheet carries no `@source`
 * list, so Tailwind's automatic source detection is rooted at the Vite root and
 * would scan only the harness tree — every utility the row uses lives under
 * `src/renderer` and none of them would be emitted, so a frame would be an
 * unstyled row that looks plausible at a glance. Rooting at the repository scans
 * `src/renderer` the way the app's own build does.
 */
const root = resolve(import.meta.dirname, "../../../..");

export default defineConfig({
	root,
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
		port: Number(process.env.COMPOSER_STATUS_CLEAR_PORT ?? 5214),
		strictPort: true,
	},
});
