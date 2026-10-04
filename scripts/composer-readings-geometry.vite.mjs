import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the composer-readings geometry harness only.
 *
 * Separate from `electron.vite.config.js` because that config's renderer stage
 * declares the app's own html entries and the desktop HTTP proxy; this harness is
 * one page, deliberately without the proxy, since nothing it renders talks to a
 * backend. Aliases are copied from the renderer stage so the shipped modules
 * resolve exactly as they do in the app.
 *
 * Started by `scripts/composer-readings-geometry.mjs`, which picks the port and
 * kills whatever it starts. `COMPOSER_READINGS_PORT` is read here rather than
 * only passed as a CLI flag because this config is shared verbatim between the
 * fix tree and the base tree, and the two are run from different directories with
 * different ports.
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
			/*
			 * The desktop CONTRACT, which the app imports by relative path from
			 * wherever it sits. This page lives one directory outside the root, and
			 * vite's dev server does not serve it a module from outside without an
			 * alias: measured on the sibling rigs, a page without this resolves
			 * `../src/shared/desktop-session-contract` only because the import is
			 * written relative to `scripts/`.
			 */
			"@contract": resolve(root, "src/shared"),
		},
	},
	plugins: [react(), tailwindcss()],
	server: {
		port: Number(process.env.COMPOSER_READINGS_PORT ?? 5431),
		strictPort: true,
		allowedHosts: ["127.0.0.1", "localhost"],
	},
});
