import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the hosting-picker census evidence harness only (issue 93).
 *
 * Aliases are copied from the renderer stage so the shipped components resolve
 * exactly as they do in the app.
 *
 * ## `root` is the REPOSITORY, not `scripts/`
 *
 * The backend-error harness set `root: scripts/`, which put Tailwind v4's
 * automatic source detection under `scripts/` -- so it never scanned
 * `src/renderer` and every frame captured through it came out with no utility
 * classes at all. An achromatic frame cannot show the state its caption claims,
 * and the failure is silent: the harness boots, React mounts, the components
 * render their real text, and only the colour is missing.
 *
 * Rooting at the repository puts `src/renderer` inside the scanned tree, and
 * the html entry is addressed by its path under that root. `assertFramePaints`
 * from `check-evidence.mjs` is run over every captured frame afterwards as the
 * actual proof, since a config that looks right is not evidence that it was.
 */
const root = resolve(import.meta.dirname, "..");

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
	server: { port: 5198, strictPort: true },
});
