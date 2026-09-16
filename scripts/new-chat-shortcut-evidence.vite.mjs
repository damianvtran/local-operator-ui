import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { desktopProxyPlugin } from "./vite-plugins/desktop-proxy";

/**
 * Vite config for the New chat shortcut evidence harness only.
 *
 * A SIBLING OF `draft-pick-evidence.vite.mjs`, and it carries the proxy for the
 * same reason: the row under the camera only exists while the session catalogue
 * answers, so the shipped `desktopRequest` has to take its same-origin
 * `/__desktop` branch against a real, isolated `local-operator serve`. The token
 * and the backend URL stay in THIS Node process and never reach the page.
 *
 * WHY ITS SIBLINGS DO NOT CARRY THE PROXY. The other `*-evidence.vite.mjs`
 * configs deliberately run WITHOUT `desktopProxyPlugin()` because each renders
 * one component against an injected fixture, and a proxy would let a capture
 * reach a backend it is not supposed to depend on. This one is the opposite
 * case: what is under the camera is a row the BACKEND decides whether to render.
 *
 * THE `/health` ENTRY IS NOT DECORATION. The renderer polls `${apiConfig.baseUrl}
 * /health` every 5 s for its connectivity banner, and the run must not ask the
 * operator's own backend (port 1111) whether it is up: an isolated harness that
 * borrows the real server's answer is a frame about the wrong machine, and one
 * that gets no answer at all paints the window-level "The server is offline…"
 * banner over the surface under review. So the page's own origin answers it, by
 * proxying to THIS harness's backend — the same shape `new-chat-row`'s harness
 * used for the same reason. Every other call still reaches the isolated backend
 * through the desktop proxy, which is the path the app ships for browser
 * development.
 *
 * Port 5206 by default, distinct from its siblings (5199 backend-error, 5201
 * usage-real, 5202 submit-latency, 5204 draft-pick), so several harnesses can run
 * at once.
 */
const root = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.NEW_CHAT_SHORTCUT_EVIDENCE_PORT ?? 5206);
const ORIGIN = `http://localhost:${PORT}`;

/*
 * The renderer's own environment, written rather than inherited.
 *
 * `loadConfig()` reads `Object.entries(import.meta.env)`, so a `define` for one
 * key would not reach it — Vite composes that object from `.env` files in
 * `envDir`. Pointing `envDir` at a scratch directory this file creates is what
 * makes `VITE_LOCAL_OPERATOR_API_URL` the harness's own origin instead of the
 * operator's backend at 1111, and it keeps a captured run from depending on a
 * `.env` sitting in the checkout.
 */
const ENV_DIR = resolve(tmpdir(), "lo-new-chat-shortcut-evidence-env");
mkdirSync(ENV_DIR, { recursive: true });
writeFileSync(
	resolve(ENV_DIR, ".env"),
	[
		"# Written by scripts/new-chat-shortcut-evidence.vite.mjs.",
		`# The page answers /health itself, proxied to this harness's backend.`,
		`VITE_LOCAL_OPERATOR_API_URL=${ORIGIN}`,
		"VITE_DISABLE_BACKEND_MANAGER=true",
		"",
	].join("\n"),
);

export default defineConfig({
	root: resolve(root, "scripts"),
	envDir: ENV_DIR,
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
		port: PORT,
		strictPort: true,
		proxy: {
			/*
			 * The connectivity ping, and ONLY the ping: everything the app needs a
			 * bearer for goes through `/__desktop`, which the desktop proxy owns.
			 * `changeOrigin` is left off so the request reaches the backend with the
			 * page's own Origin, which is what the backend's own origin policy is
			 * about.
			 */
			"/health": {
				target:
					process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL ??
					"http://127.0.0.1:1111",
				changeOrigin: false,
			},
		},
		/*
		 * The evidence README and any capture notes live under this root but are
		 * not part of the page. Without this, editing one triggers a full reload in
		 * the browser being driven — which lands mid-capture and photographs a
		 * document that is still mounting.
		 */
		watch: { ignored: ["**/*.mjs", "**/*.test.mjs", "**/*.md"] },
	},
});
