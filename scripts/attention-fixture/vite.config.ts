import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { desktopProxyPlugin } from "../vite-plugins/desktop-proxy";

// Supported browser transport, not an Electron IPC/focus impersonation. The
// production proxy owns authentication and forwards the hook's real request.
export default defineConfig({
	root: process.cwd(),
	plugins: [react(), tailwindcss(), desktopProxyPlugin()],
	resolve: {
		alias: {
			"@shared": resolve("src/renderer/src/shared"),
			"@features": resolve("src/renderer/src/features"),
			"@": resolve("src/renderer/src"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 18765,
		strictPort: true,
		proxy: { "/fixture": process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL! },
	},
});
