import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the read-receipt skew harness only.
 *
 * Separate from `electron.vite.config.js` for the reason the toast-close
 * harness's config is: that config's renderer stage declares the app's own html
 * entries and the desktop HTTP proxy, and this harness is one page that talks
 * to no backend. Aliases are copied from the renderer stage so the shipped
 * modules resolve exactly as they do in the app.
 *
 * The root is the harness's own directory - the page, its stylesheet and this
 * config live together under `docs/evidence/`, the way the committed evidence
 * sets' harnesses do - and `readack-skew.css` carries the `@source` that keeps
 * Tailwind's scan pointed at the renderer tree from this root.
 *
 * Started by `readack-skew.mjs`, which picks the port.
 */
const root = resolve(import.meta.dirname, "../../../..");

export default defineConfig({
	root: import.meta.dirname,
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
		/* 5447: distinct from every rig default on this machine (the toast rig's
		 * list is the reference; 5432 is the operator's postgres). */
		port: Number(process.env.READACK_SKEW_PORT ?? 5447),
		strictPort: true,
	},
});
