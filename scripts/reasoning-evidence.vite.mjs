import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite config for the reasoning-stream evidence harness only.
 *
 * Deliberately WITHOUT `desktopProxyPlugin()`, unlike its sibling
 * `submit-latency-evidence.vite.mjs`. That harness photographs a round trip and
 * a proxy is the whole point; this one photographs a RENDER of a scripted event
 * sequence, and a proxy would let the page reach a backend it must not depend
 * on. There is no backend in this harness's claim at all: the reasoning channel
 * is display-only and never persisted, the mock provider cannot emit it, and
 * the real one is unreachable from this machine (18.09 s to a 401 for
 * `api.deepseek.com/v1/models`, measured 2026-09-20).
 *
 * The port is overridable so the SAME harness can be served from two worktrees
 * at once - the branch and a merge-base checkout - which is what makes the
 * before/after pair a pair: same script, same pacing, same viewport, one
 * variable. 5204 and 5205 are clear of the siblings (5199 backend-error, 5201
 * usage-real, 5202 submit-latency).
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
		port: Number(process.env.LO_EVIDENCE_PORT ?? 5204),
		strictPort: true,
		/*
		 * The harness's own documentation and notes live under this root but are
		 * not part of the page. Without this, editing one reloads the browser
		 * mid-run and discards the transcript a frame was about to show.
		 */
		watch: { ignored: ["**/*.mjs", "**/*.test.mjs", "**/*.md"] },
	},
});
