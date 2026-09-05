import type { Plugin } from "vite";
import { requestDesktop } from "../../src/main/desktop-transport";

/** Browser-only development uses the same typed vocabulary as Electron IPC.
 * The token is read by this Node process, never by Vite's client env machinery.
 * Production renderer bundles have no proxy fallback server or bundled secret.
 */
export function desktopProxyPlugin(): Plugin {
	return {
		name: "desktop-control-proxy",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				if (req.url !== "/__desktop") return next();
				const origin = req.headers.origin;
				const address = server.httpServer?.address();
				const port = typeof address === "object" && address ? address.port : server.config.server.port;
				const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
				res.setHeader("Cache-Control", "no-store");
				res.setHeader("Content-Type", "application/json");
				if (req.method !== "POST" || !origin || !allowed.has(origin) ||
					!req.headers["content-type"]?.startsWith("application/json")) {
					res.statusCode = 403;
					res.end(JSON.stringify({ detail: "This origin cannot use desktop controls." }));
					return;
				}
				try {
					const chunks: Buffer[] = [];
					let size = 0;
					for await (const chunk of req) {
						size += chunk.length;
						if (size > 262144) {
							res.statusCode = 413;
							res.end(JSON.stringify({ detail: "This request is too large." }));
							return;
						}
						chunks.push(Buffer.from(chunk));
					}
					const result = await requestDesktop(
						JSON.parse(Buffer.concat(chunks).toString("utf-8")),
						process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL || "http://127.0.0.1:1111",
						process.env.LOCAL_OPERATOR_DESKTOP_TOKEN || null,
					);
					res.end(JSON.stringify(result));
				} catch {
					res.statusCode = 422;
					res.end(JSON.stringify({ detail: "Invalid desktop operation." }));
				}
			});
		},
	};
}
