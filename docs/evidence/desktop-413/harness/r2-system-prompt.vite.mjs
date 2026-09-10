import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the R2 evidence harness only.
 *
 * Deliberately WITHOUT `desktopProxyPlugin`, unlike `chat-413.vite.mjs` beside
 * it: R2 is about the client pre-flight and the edit state, so the harness
 * injects its own `window.api.desktop` and must take the Electron IPC branch
 * rather than the browser-dev HTTP one. Aliases are copied from the renderer
 * stage so the shipped components resolve exactly as they do in the app.
 *
 * `strictPort` so a busy port FAILS rather than silently serving on another one
 * and photographing a surface nobody drove -- this box runs several agent
 * sessions at once, so the port is overridable.
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
		port: Number(process.env.R2_PORT ?? 5401),
		strictPort: true,
	},
});
