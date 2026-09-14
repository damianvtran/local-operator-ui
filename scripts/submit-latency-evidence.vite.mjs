import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { desktopProxyPlugin } from "./vite-plugins/desktop-proxy";

/**
 * Vite config for the submit-latency evidence harness only.
 *
 * WHY THIS ONE CARRIES THE PROXY AND ITS SIBLINGS DO NOT. The other
 * `*-evidence.vite.mjs` configs deliberately run WITHOUT `desktopProxyPlugin()`
 * because each renders one component against an injected fixture, and a proxy
 * would let a capture reach a backend it is not supposed to depend on. This
 * harness is the opposite case: the thing under the camera IS the round trip.
 * A frame of the submit path that stubbed the transport would photograph a
 * mock and prove nothing about the latency the operator reported.
 *
 * With the proxy mounted, the shipped `desktopRequest` takes its same-origin
 * `/__desktop` branch (desktop-api.ts:62-82) because `window.api?.desktop` is
 * absent in a browser - so the renderer under test is the SHIPPED one, taking a
 * path it already ships, not a harness-only fork of it. The bearer and the
 * backend URL are read by THIS Node process from the environment and never
 * reach the page; there is no browser token and no production proxy fallback.
 *
 * Port 5202, distinct from its siblings (5199 backend-error, 5201 usage-real),
 * so several harnesses can run at once.
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
	plugins: [react(), tailwindcss(), desktopProxyPlugin()],
	server: {
		port: 5202,
		strictPort: true,
		/*
		 * The evidence README and any capture notes live under this root but are
		 * not part of the page. Without this, editing one triggers a full reload
		 * in the browser being driven - which lands mid-capture and photographs a
		 * document that is still mounting, or worse, discards a transcript the
		 * frame was about to show.
		 */
		watch: { ignored: ["**/*.mjs", "**/*.test.mjs", "**/*.md"] },
	},
});
