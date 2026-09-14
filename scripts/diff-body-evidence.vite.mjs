import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the write/edit diff-body real-payload harness only.
 *
 * Separate from `electron.vite.config.js` because that config's renderer stage
 * declares the app's own html entries and the desktop HTTP proxy; this harness
 * is a single page that renders the shipped reducer and the shipped transcript
 * over a durable history page. Aliases are copied from the renderer stage so
 * the shipped modules resolve exactly as they do in the app.
 *
 * The payload is served from a TEMP FILE named by `DIFF_BODY_PAYLOAD` rather
 * than committed beside this config: the page is one of the operator's real
 * conversations, and a frame is evidence while a transcript of somebody's work
 * sitting in a public repository is not. `scripts/diff-body-evidence.mjs`
 * writes the file, starts this server and deletes it.
 */
const root = resolve(import.meta.dirname, "..");

export default defineConfig({
	root: resolve(root, "scripts"),
	/*
	 * The harness root is `scripts/`, which is outside `src/renderer/src`, so
	 * every role utility (`text-mono-sm`, `min-h-5`) would compile as ABSENT
	 * without an explicit `@source` at the renderer tree — the rows would then
	 * measure a different pitch and read as a layout regression that is not
	 * there. `docs/evidence/tool-rows/README.md` records the same trap from the
	 * first real-conversation surface.
	 */
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
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "diff-body-payload",
			configureServer(server) {
				server.middlewares.use("/__diff-payload", (_req, res) => {
					const path = process.env.DIFF_BODY_PAYLOAD;
					if (!path) {
						res.statusCode = 404;
						res.end("DIFF_BODY_PAYLOAD is not set");
						return;
					}
					res.setHeader("content-type", "application/json");
					res.end(readFileSync(path));
				});
			},
		},
	],
	server: {
		port: Number(process.env.DIFF_BODY_PORT ?? 5198),
		strictPort: true,
	},
});
