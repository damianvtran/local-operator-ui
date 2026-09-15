import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { desktopProxyPlugin } from "./vite-plugins/desktop-proxy";

/**
 * Vite config for the draft-splash evidence harness only.
 *
 * WHY IT CARRIES THE PROXY AND ITS SIBLINGS DO NOT. The other
 * `*-evidence.vite.mjs` configs run WITHOUT `desktopProxyPlugin()` because each
 * renders one component against an injected fixture, and a proxy would let a
 * capture reach a backend it is not supposed to depend on. Here the pane under
 * the camera is `chat-page.tsx`, which decides what the band renders from state
 * that arrives over the desktop transport: `useDesktopCapabilities` gates the
 * canonical pane at all, and the draft pane is reached through the shipped
 * "New chat" control of a catalogue that has to load first. A frame of that
 * against a stub would photograph the stub.
 *
 * With the proxy mounted, the shipped `desktopRequest` takes its same-origin
 * `/__desktop` branch (`desktop-api.ts:62-82`) because `window.api?.desktop` is
 * absent in this harness - so the renderer under test is the SHIPPED one,
 * taking a path it already ships. The bearer and the backend URL are read by
 * THIS Node process from the environment and never reach the page.
 *
 * The port is `LO_DRAFT_SPLASH_PORT` so the before and after trees can be
 * served at once against the same backend and photographed side by side, which
 * is the only way the pair differs by the change alone. 5204 is the branch and
 * 5205 the merge-base, distinct from the siblings' 5202 (submit-latency), 5201
 * (usage-real) and 5199 (backend-error).
 */
const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.LO_DRAFT_SPLASH_PORT ?? 5204);

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
		port,
		strictPort: true,
		/*
		 * BOUND TO THE IPv4 LOOPBACK ADDRESS, and the address a shutter uses is
		 * `127.0.0.1` rather than the friendlier `localhost`.
		 *
		 * WHY: Vite's default host is the string `localhost`, which node binds
		 * through the resolver - and on this machine that resolves to the IPv6
		 * loopback, so the server listens on `[::1]` only. A browser cannot reach
		 * it when it resolves `localhost` to `127.0.0.1`, which is what the paired
		 * browser did: `net::ERR_CONNECTION_REFUSED` on a page the same machine
		 * could fetch with curl (measured in this pass, and the first capture
		 * attempt of it). Binding the literal address removes the resolver from the
		 * instrument: the address the harness prints is the address it is
		 * reachable at, for every client.
		 */
		host: "127.0.0.1",
		/*
		 * The evidence README and any capture notes live under this root but are
		 * not part of the page. Without this, editing one triggers a full reload
		 * in the browser being driven - which lands mid-capture and photographs a
		 * document that is still mounting.
		 */
		watch: { ignored: ["**/*.mjs", "**/*.test.mjs", "**/*.md"] },
	},
});
