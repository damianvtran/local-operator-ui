import type { Plugin } from "vite";
import { requestDesktopMedia } from "../../src/main/desktop-media";
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
				// The renderer's EventSource carries its session and cursor in the
				// query string, so match the path, not the whole URL: an exact
				// comparison fell through to Vite's SPA fallback and the stream
				// "opened" as index.html.
				const requestPath = (req.url ?? "").split("?")[0];
				if (requestPath === "/__desktop/stream") {
					// Authenticated SSE proxy for browser development. Same trust
					// rules as the JSON route: same-origin loopback only, and the
					// bearer stays in this Node process. The renderer's EventSource
					// talks to this same-origin URL; it cannot reach the backend.
					const address = server.httpServer?.address();
					const port =
						typeof address === "object" && address
							? address.port
							: server.config.server.port;
					const allowed = new Set([
						`http://127.0.0.1:${port}`,
						`http://localhost:${port}`,
					]);
					// A same-origin EventSource GET carries no Origin header (browsers
					// only add it to cross-origin and non-GET requests), so the
					// boundary falls back to the Referer's origin. A cross-site
					// request always carries Origin, and an absent Referer is refused,
					// so the check is still fail-closed.
					const referer = req.headers.referer;
					let refererOrigin: string | null = null;
					if (referer) {
						try {
							refererOrigin = new URL(referer).origin;
						} catch {
							refererOrigin = null;
						}
					}
					const origin = req.headers.origin ?? refererOrigin;
					if (req.method !== "GET" || !origin || !allowed.has(origin)) {
						res.statusCode = 403;
						res.setHeader("Content-Type", "application/json");
						res.end(
							JSON.stringify({
								detail: "This origin cannot use desktop controls.",
							}),
						);
						return;
					}
					const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
					const sessionId = requestUrl.searchParams.get("session") ?? "";
					if (!/^[a-f0-9]{12}$/.test(sessionId)) {
						res.statusCode = 422;
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ detail: "Invalid stream session." }));
						return;
					}
					const epoch = requestUrl.searchParams.get("epoch") ?? "";
					if (epoch && !/^[a-zA-Z0-9_-]{1,128}$/.test(epoch)) {
						res.statusCode = 422;
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ detail: "Invalid stream epoch." }));
						return;
					}
					const afterSeq = Number.parseInt(
						requestUrl.searchParams.get("after_seq") ?? "0",
						10,
					);
					if (!Number.isInteger(afterSeq) || afterSeq < 0) {
						res.statusCode = 422;
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ detail: "Invalid stream cursor." }));
						return;
					}
					const token = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN || null;
					if (!token) {
						res.statusCode = 503;
						res.setHeader("Content-Type", "application/json");
						res.end(
							JSON.stringify({
								detail:
									"Restart with a desktop-managed backend to use these controls.",
							}),
						);
						return;
					}
					const backendUrl =
						process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL ||
						"http://127.0.0.1:1111";
					const query = new URLSearchParams();
					if (epoch) query.set("epoch", epoch);
					if (afterSeq > 0) query.set("after_seq", String(afterSeq));
					const suffix = query.size > 0 ? `?${query}` : "";
					try {
						const upstream = await fetch(
							new URL(
								`/v1/desktop/sessions/${sessionId}/events${suffix}`,
								backendUrl,
							),
							{
								headers: {
									Accept: "text/event-stream",
									Authorization: `Bearer ${token}`,
								},
								redirect: "error",
							},
						);
						if (!upstream.ok || !upstream.body) {
							res.statusCode = upstream.status;
							res.setHeader("Content-Type", "application/json");
							res.end(
								JSON.stringify({
									detail: "The event stream was refused.",
								}),
							);
							return;
						}
						res.statusCode = 200;
						res.setHeader("Content-Type", "text/event-stream");
						res.setHeader("Cache-Control", "no-store");
						for await (const chunk of upstream.body) {
							res.write(chunk);
						}
						res.end();
					} catch {
						res.statusCode = 503;
						res.setHeader("Content-Type", "application/json");
						res.end(
							JSON.stringify({
								detail: "The backend stream could not be reached.",
							}),
						);
					}
					return;
				}
				if (req.url === "/__desktop/media") {
					// Browser-development counterpart of main's binary/multipart
					// relay: the renderer posts the raw bytes plus an
					// `x-desktop-media` JSON header naming the operation; this
					// process rebuilds the upstream request with the bearer.
					const origin = req.headers.origin;
					const address = server.httpServer?.address();
					const port =
						typeof address === "object" && address
							? address.port
							: server.config.server.port;
					const allowed = new Set([
						`http://127.0.0.1:${port}`,
						`http://localhost:${port}`,
					]);
					if (req.method !== "POST" || !origin || !allowed.has(origin)) {
						res.statusCode = 403;
						res.setHeader("Content-Type", "application/json");
						res.end(
							JSON.stringify({
								detail: "This origin cannot use desktop controls.",
							}),
						);
						return;
					}
					const header = req.headers["x-desktop-media"];
					let operation: unknown;
					try {
						operation = JSON.parse(typeof header === "string" ? header : "");
					} catch {
						res.statusCode = 422;
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ detail: "Invalid media operation." }));
						return;
					}
					const chunks: Buffer[] = [];
					let total = 0;
					for await (const chunk of req) {
						total += (chunk as Buffer).length;
						if (total > 16 * 1024 * 1024) {
							res.statusCode = 413;
							res.setHeader("Content-Type", "application/json");
							res.end(JSON.stringify({ detail: "This file is too large." }));
							return;
						}
						chunks.push(chunk as Buffer);
					}
					const bytes =
						total > 0 ? new Uint8Array(Buffer.concat(chunks)) : null;
					const result = await requestDesktopMedia(
						operation,
						bytes,
						process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL ||
							"http://127.0.0.1:1111",
						process.env.LOCAL_OPERATOR_DESKTOP_TOKEN || null,
					);
					res.statusCode = result.status;
					if (result.kind === "bytes") {
						res.setHeader("Content-Type", result.mimeType);
						res.end(Buffer.from(result.data));
					} else if (result.kind === "json") {
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify(result.body));
					} else {
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify({ detail: result.detail }));
					}
					return;
				}
				if (req.url !== "/__desktop") return next();
				const origin = req.headers.origin;
				const address = server.httpServer?.address();
				const port =
					typeof address === "object" && address
						? address.port
						: server.config.server.port;
				const allowed = new Set([
					`http://127.0.0.1:${port}`,
					`http://localhost:${port}`,
				]);
				res.setHeader("Cache-Control", "no-store");
				res.setHeader("Content-Type", "application/json");
				if (
					req.method !== "POST" ||
					!origin ||
					!allowed.has(origin) ||
					!req.headers["content-type"]?.startsWith("application/json")
				) {
					res.statusCode = 403;
					res.end(
						JSON.stringify({
							detail: "This origin cannot use desktop controls.",
						}),
					);
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
						process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL ||
							"http://127.0.0.1:1111",
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
